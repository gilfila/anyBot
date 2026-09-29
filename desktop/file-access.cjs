// File links from chat (files.check / files.preview / files.open /
// files.reveal in main.cjs). Paths come from employee output, which is
// attacker-influenced, so every rule lives here in main and is re-run in full
// on every action. Tested by tests/file-access.test.mjs with an injected fs.
//
// Order of checks for a path: refusal() on the raw text before any filesystem
// call; resolveCandidate() against the conversation's folders; an lstat walk
// that refuses links to network or device targets before anything follows
// them; realpath; refusal() again on the real path; containment in the base;
// stat; then policy() on the real name decides open / reveal / copy.
const fsp = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");

const MAX_PATH = 1024;
const MAX_TEXT = 512 * 1024;
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_CHECK_PATHS = 64;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// Bidi and zero-width marks: an RLO can show report<RLO>fdp.exe as "reportexe.pdf".
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)(\..*)?$/i;
// Shell namespace folders (GodMode, Control Panel) and files named like them.
const GUID_NAME = /\.\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;

const set = (list) => new Set(list.split(" ").map((ext) => `.${ext}`));
const IMAGE_EXTENSIONS = set("png jpg jpeg gif webp bmp tif tiff heic heif avif ico svg");
const VIDEO_EXTENSIONS = set("mp4 m4v mov webm mkv avi wmv mpg mpeg");
const AUDIO_EXTENSIONS = set("mp3 wav m4a aac flac ogg oga opus wma aiff");
const DOCUMENT_EXTENSIONS = set("pdf docx xlsx pptx html htm doc xls ppt odt ods odp rtf");
const ARCHIVE_EXTENSIONS = set("zip 7z rar tar gz tgz bz2 xz");
// The only types shell.openPath ever gets. Anything else is never opened.
const OPEN_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...set("pdf docx xlsx pptx txt md csv tsv log json html htm zip"),
]);
// Shell pointer files: selecting them in Explorer has itself leaked NTLM
// hashes (CVE-2025-24054), so they only get Copy path and a text preview.
const COPY_EXTENSIONS = set(
  "lnk url website webloc inetloc desktop library-ms search-ms searchconnector-ms settingcontent-ms scf shb shs theme themepack deskthemepack msstyles appref-ms",
);
// Types that run code, install things, or carry macros. Never tier "open"
// (tests/file-access.test.mjs checks both lists).
const BLOCKED_EXTENSIONS = set(
  [
    "exe com scr pif cpl msc msi msp mst msu msix msixbundle appx appxbundle appinstaller application appref-ms xbap gadget",
    "dll ocx sys drv efi cab jar jnlp xll wll xla xlam ppa ppam bat cmd btm ps1 ps1xml ps2 ps2xml psc1 psc2 psd1 psm1 pssc",
    "cdxml msh msh1 msh2 mshxml msh1xml msh2xml vb vbe vbs vbscript js jse ws wsc wsf wsh sct hta py pyw pyc pyo pyz pyzw",
    "rb rbw pl tcl php lua sh bash zsh ksh csh ahk au3 kix lnk url website webloc inetloc desktop library-ms search-ms",
    "searchconnector-ms settingcontent-ms scf shb shs theme themepack deskthemepack msstyles reg inf ins isp diagcab diagcfg",
    "diagpkg xnk mof cer crt der p7b p7c p12 pfx spc sst stl iso img vhd vhdx udf wim dmg docm dotm xlsm xltm xlsb pptm",
    "potm ppsm sldm doc dot xls xlt ppt pot pps ppsx odt ods odp odg rtf mht mhtml chm hlp mdb mde accdb accde accdr adp ade",
    "mda mdt mdw mdz mam maf mag maq mar mas mat mau mav maw prf pst iqy slk dqy rqy oqy asx wax wvx wmx wpl m3u m3u8 pls",
    "xspf app pkg mpkg command tool terminal workflow action scpt scptd applescript run bin appimage deb rpm apk",
  ].join(" "),
);
// Previewed in the app (text in a <pre>, images as data: URLs).
const IMAGE_PREVIEW = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
const TEXT_EXTENSIONS = set(
  [
    "txt md markdown csv tsv log json jsonl ndjson yaml yml toml ini cfg conf env xml html htm css scss sass less",
    "js mjs cjs jsx ts mts cts tsx py pyw rb go rs java kt kts c h cc cpp hpp cs fs php pl lua r swift dart scala",
    "sh bash zsh ps1 psm1 psd1 bat cmd sql graphql gql vue svelte astro proto gradle properties lock tex rst adoc",
    "srt vtt diff patch",
  ].join(" "),
);

// Why a path is refused before any filesystem call, or null. Runs on the raw
// text, on a decoded file: URL, and on every readlink and realpath result.
function refusal(raw, { platform = process.platform } = {}) {
  if (typeof raw !== "string") return "invalid";
  let text = raw;
  if (!text || text.length > MAX_PATH || text !== text.trim()) return "invalid";
  if (CONTROL.test(text) || INVISIBLE.test(text)) return "invalid";
  if (/^file:/i.test(text)) {
    // Only file:///X:/…; a host means SMB, and SMB leaks the NTLM hash.
    if (!/^file:\/\/\/[A-Za-z]:\//i.test(text)) return "network";
    try {
      text = decodeURIComponent(text.slice(8));
    } catch {
      return "invalid";
    }
    if (CONTROL.test(text) || INVISIBLE.test(text)) return "invalid";
  }
  // path.win32.isAbsolute() is true for UNC paths, so it is never the check.
  if (/^[\\/]{2}/.test(text)) return /^[\\/]{2}[?.][\\/]/.test(text) ? "device" : "network";
  if (/[<>"|?*]/.test(text)) return "invalid";
  if (platform === "win32") {
    const drive = /^[A-Za-z]:[\\/]/.test(text);
    // Alternate data streams (evil.exe::$DATA stats fine) and C:relative.
    if ((drive ? text.slice(2) : text).includes(":")) return "stream";
    if (!drive && /^[\\/]/.test(text)) return "rooted";
    for (const segment of text.replace(/^[A-Za-z]:/, "").split(/[\\/]+/)) {
      if (!segment || segment === "." || segment === "..") continue;
      if (RESERVED.test(segment)) return "device";
      // Windows strips these, so "evil.exe." would open evil.exe.
      if (/[ .]$/.test(segment)) return "invalid";
    }
  }
  return null;
}

function inside(p, base, full, allowEqual) {
  const rel = p.relative(base, full);
  if (!rel) return allowEqual;
  return rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
}

// Lexical resolution: { options: [{ path, within }] } in base order, or
// { refused }. `within` is the folder the real path must stay inside.
function resolveCandidate(raw, { bases = [], home = "", platform = process.platform } = {}) {
  const why = refusal(raw, { platform });
  if (why) return { refused: why };
  const p = platform === "win32" ? path.win32 : path.posix;
  let text = raw;
  if (/^file:/i.test(text)) text = decodeURIComponent(text.slice(8));
  text = platform === "win32" ? text.replace(/[\\/]+/g, "\\") : text.replace(/\/+/g, "/");
  if (text === "~" || /^~[\\/]/.test(text)) {
    if (!home) return { refused: "invalid" };
    const full = p.resolve(home, text.slice(2) || ".");
    return inside(p, home, full, true) ? { options: [{ path: full, within: home }] } : { refused: "outside" };
  }
  if (platform === "win32" ? /^[A-Za-z]:\\/.test(text) : text.startsWith("/"))
    return { options: [{ path: p.resolve(text), within: null }] };
  const options = [];
  for (const base of bases) {
    if (typeof base !== "string" || !base || !p.isAbsolute(base) || refusal(base, { platform })) continue;
    const full = p.resolve(base, text);
    if (inside(p, base, full, false)) options.push({ path: full, within: base });
  }
  return options.length ? { options } : { refused: "outside" };
}

function kindOf(ext) {
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (!ext || TEXT_EXTENSIONS.has(ext)) return "text";
  return "other";
}

// What a click may do with a file or folder of this name. Tier "open" may
// reach shell.openPath; "reveal" may be shown in Explorer; "copy" only has
// Copy path. `action` is the default click in the renderer.
function policy(name, { folder = false } = {}) {
  const lower = String(name || "").toLowerCase();
  if (folder) {
    if (GUID_NAME.test(lower))
      return { tier: "copy", kind: "folder", open: false, reveal: false, preview: null, action: "menu", reason: "shell-pointer" };
    return { tier: "open", kind: "folder", open: true, reveal: true, preview: null, action: "open" };
  }
  const ext = path.extname(lower);
  const kind = kindOf(ext);
  if (COPY_EXTENSIONS.has(ext) || GUID_NAME.test(lower))
    return { tier: "copy", kind, open: false, reveal: false, preview: "text", action: "menu", reason: "shell-pointer" };
  const preview = IMAGE_PREVIEW[ext] ? "image" : kind === "text" || TEXT_EXTENSIONS.has(ext) ? "text" : null;
  if (BLOCKED_EXTENSIONS.has(ext) || !OPEN_EXTENSIONS.has(ext)) {
    const reason = BLOCKED_EXTENSIONS.has(ext) ? "runs-programs" : "not-supported";
    return { tier: "reveal", kind, open: false, reveal: true, preview, action: preview ? "preview" : "reveal", reason };
  }
  const inApp = kind === "text" || (kind === "image" && preview === "image");
  return { tier: "open", kind, open: true, reveal: true, preview, action: inApp ? "preview" : "open" };
}

const RANK = { open: 0, reveal: 1, copy: 2 };
const stricter = (a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a);

class Slow extends Error {}

// inspect(raw, { bases, walks }) -> FileRef. Every fs call is timed per
// drive: one that takes longer than slowMs marks the drive slow for coolMs,
// and its candidates answer "unknown" without touching it again (a dead
// mapped drive can pin libuv threads for tens of seconds).
function createInspector({ fs = fsp, platform = process.platform, home = os.homedir(), slowMs = 800, coolMs = 5 * 60_000, now = Date.now } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const slow = new Map();
  const driveOf = (full) => (platform === "win32" ? full.slice(0, 2).toUpperCase() : `/${full.split("/")[1] || ""}`);
  const isSlow = (drive) => {
    const until = slow.get(drive);
    if (until === undefined) return false;
    if (until > now()) return true;
    slow.delete(drive);
    return false;
  };
  const timed = (drive, call) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        slow.set(drive, now() + coolMs);
        reject(new Slow("slow drive"));
      }, slowMs);
      Promise.resolve()
        .then(call)
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });

  // lstat each component from the root; a link is followed only if its target
  // is refusal-free (so a link to \\server\x is never touched). Cached per batch.
  async function linkProblem(full, drive, walks) {
    const root = p.parse(full).root;
    let current = root;
    for (const part of full.slice(root.length).split(p.sep).filter(Boolean)) {
      const parent = current;
      current = p.join(current, part);
      const key = `walk:${platform === "win32" ? current.toLowerCase() : current}`;
      if (!walks.has(key)) {
        const at = current;
        walks.set(
          key,
          (async () => {
            const stat = await timed(drive, () => fs.lstat(at));
            if (!stat.isSymbolicLink()) return false;
            const target = await timed(drive, () => fs.readlink(at));
            return Boolean(refusal(String(target), { platform }) || refusal(p.resolve(parent, String(target)), { platform }));
          })(),
        );
      }
      if (await walks.get(key)) return true;
    }
    return false;
  }

  async function realBase(base, walks) {
    const key = `base:${base}`;
    if (!walks.has(key)) walks.set(key, timed(driveOf(base), () => fs.realpath(base)));
    return walks.get(key);
  }

  async function inspectOption(option, walks) {
    const drive = driveOf(option.path);
    if (await linkProblem(option.path, drive, walks)) return { state: "refused", reason: "link" };
    // fs.promises.realpath is native: it expands 8.3 names and junctions.
    const real = String(await timed(drive, () => fs.realpath(option.path)));
    const why = refusal(real, { platform });
    if (why) return { state: "refused", reason: why };
    if (option.within && !inside(p, String(await realBase(option.within, walks)), real, true))
      return { state: "refused", reason: "outside" };
    const stat = await timed(drive, () => fs.stat(real));
    const name = p.basename(real) || real;
    if (stat.isDirectory()) return { state: "folder", path: real, name, ...policy(name, { folder: true }) };
    if (!stat.isFile()) return { state: "refused", reason: "device" };
    // The stricter of the real name and the name as written (a link or an
    // 8.3 short name can hide the real extension).
    const rule = stricter(policy(name), policy(p.basename(option.path)));
    return { state: "file", path: real, name, size: stat.size, ...rule };
  }

  async function inspect(raw, { bases = [], walks = new Map() } = {}) {
    const resolved = resolveCandidate(raw, { bases, home, platform });
    if (resolved.refused) return { state: "refused", reason: resolved.refused };
    for (const option of resolved.options) {
      if (isSlow(driveOf(option.path)) || (option.within && isSlow(driveOf(option.within)))) return { state: "unknown" };
      try {
        return await inspectOption(option, walks);
      } catch (error) {
        if (error instanceof Slow) return { state: "unknown" };
        // ENOENT, ENOTDIR, EACCES, EPERM, EBUSY, EINVAL and the rest all read
        // as missing (access denied looks the same); the next base may have it.
      }
    }
    return { state: "missing" };
  }

  return { inspect, isSlow, driveOf };
}

// files.check batching: per-message folder context (60 s), per-result cache
// (15 s), at most 4 inspections at a time, 2 batches at a time, and a 1.5 s
// deadline after which unfinished paths answer "unknown".
function createFileLinks({ inspector, context, now = Date.now, deadlineMs = 1500, concurrency = 4, maxBatches = 2 }) {
  const contexts = new Map();
  const results = new Map();
  const waiting = [];
  let running = 0;
  const prune = (map) => {
    if (map.size > 2000) for (const key of [...map.keys()].slice(0, 1000)) map.delete(key);
  };

  async function basesFor(message) {
    const hit = contexts.get(message);
    if (hit && hit.until > now()) return hit.bases;
    const answer = await context(message);
    const bases = Array.isArray(answer?.bases) ? answer.bases.filter((base) => typeof base === "string").slice(0, 16) : [];
    prune(contexts);
    contexts.set(message, { bases, until: now() + 60_000 });
    return bases;
  }
  // A finished batch hands its slot straight to the next one waiting.
  const slot = () => {
    if (running < maxBatches) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  async function check(payload) {
    const message = payload?.message;
    const paths = payload?.paths;
    if (
      typeof message !== "string" ||
      !message ||
      message.length > 100 ||
      !Array.isArray(paths) ||
      paths.length > MAX_CHECK_PATHS ||
      !paths.every((raw) => typeof raw === "string" && raw.length >= 1 && raw.length <= MAX_PATH)
    )
      throw new Error("Invalid file check");
    const bases = await basesFor(message);
    const unique = [...new Set(paths)];
    const out = {};
    await slot();
    let stopped = false;
    let timer;
    try {
      const walks = new Map();
      let next = 0;
      const worker = async () => {
        while (!stopped && next < unique.length) {
          const raw = unique[next++];
          const key = `${bases.join("\u0001")}\u0002${raw}`;
          const hit = results.get(key);
          if (hit && hit.until > now()) {
            out[raw] = hit.ref;
            continue;
          }
          const ref = await inspector.inspect(raw, { bases, walks });
          out[raw] = ref;
          if (ref.state !== "unknown") {
            prune(results);
            results.set(key, { ref, until: now() + 15_000 });
          }
        }
      };
      const deadline = new Promise((resolve) => {
        timer = setTimeout(resolve, deadlineMs);
      });
      await Promise.race([Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker)), deadline]);
    } finally {
      stopped = true;
      clearTimeout(timer);
      release();
    }
    const answer = {};
    for (const raw of unique) answer[raw] = out[raw] || { state: "unknown" };
    return { results: answer };
  }

  // Actions always re-inspect; the result cache is only for showing links.
  async function resolve(payload) {
    const message = payload?.message;
    const raw = payload?.path;
    if (typeof message !== "string" || !message || message.length > 100 || typeof raw !== "string" || !raw || raw.length > MAX_PATH)
      throw new Error("Invalid file request");
    const bases = await basesFor(message);
    return { raw, ref: await inspector.inspect(raw, { bases }) };
  }

  return { check, resolve };
}

const safeExtension = (name) => {
  const ext = path.extname(String(name || "")).toLowerCase();
  return /^\.[a-z0-9-]{1,20}$/.test(ext) ? ext : "";
};
const shownName = (raw) => {
  const name = String(raw || "").split(/[\\/]+/).filter(Boolean).pop() || "that file";
  return name.length > 80 ? `${name.slice(0, 77)}…` : name;
};
const REFUSED = {
  network: "Network locations aren't opened from chat.",
  device: "That path points at a device, not a file, so Any Bot won't use it.",
  outside: "That path is outside the bot's folders, so Any Bot won't use it.",
  link: "That path goes through a link to a place Any Bot won't follow.",
};

// Why `action` (open, reveal, or preview) can't run on this inspected ref,
// as an owner-facing message; `record` marks refusals for the diagnostics log.
function actionProblem(ref, action, raw) {
  if (ref.state === "missing") return { message: `That file isn't there any more: ${shownName(raw)}` };
  if (ref.state === "unknown") return { message: "That drive isn't responding right now. Try again in a few minutes." };
  if (ref.state === "refused")
    return {
      message: REFUSED[ref.reason] || "That doesn't look like a file path Any Bot can use.",
      record: true,
      reason: ref.reason,
      ext: "",
    };
  const ext = safeExtension(ref.name);
  const named = ext ? `${ext} files` : "these files";
  if (action === "open" && !ref.open) {
    const message =
      ref.reason === "runs-programs"
        ? `Any Bot doesn't open ${named} from chat because they can run programs. Use Show in folder.`
        : ref.reason === "shell-pointer"
          ? ref.state === "folder"
            ? "Special system folders aren't opened from chat. Right-click to copy the path."
            : "Shortcut files aren't opened from chat. Right-click to copy the path."
          : `Any Bot doesn't open ${named} from chat. Use Preview or Show in folder.`;
    return { message, record: true, reason: ref.reason || "not-open", ext };
  }
  if (action === "reveal" && !ref.reveal)
    return {
      message: "Shortcut files aren't shown in their folder from chat. Right-click to copy the path.",
      record: true,
      reason: ref.reason || "not-reveal",
      ext,
    };
  if (action === "preview" && ref.state !== "file") return { message: "Folders can't be previewed. Open the folder instead." };
  return null;
}

// files.preview: the first 512 KB of text (binary if the first 8 KB has a
// NUL), images up to 2 MB as data: URLs, else just the file's details. Reads
// through one handle whose fstat must be a regular file.
async function readPreview(ref, { fs = fsp } = {}) {
  const base = { name: ref.name, path: ref.path, size: ref.size, open: Boolean(ref.open), reveal: Boolean(ref.reveal) };
  const ext = path.extname(String(ref.name || "")).toLowerCase();
  if (ref.state !== "file" || !ref.preview) return { ...base, kind: "file" };
  if (ref.preview === "image" && (!IMAGE_PREVIEW[ext] || ref.size > MAX_IMAGE)) return { ...base, kind: "file" };
  const handle = await fs.open(ref.path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { ...base, kind: "file" };
    const size = stat.size;
    if (ref.preview === "image" && size > MAX_IMAGE) return { ...base, size, kind: "file" };
    const want = ref.preview === "image" ? size : Math.min(size, MAX_TEXT);
    const buffer = Buffer.alloc(want);
    let offset = 0;
    while (offset < want) {
      const { bytesRead } = await handle.read(buffer, offset, want - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const bytes = buffer.subarray(0, offset);
    if (ref.preview === "image") {
      if (offset !== size) return { ...base, size, kind: "file" };
      return { ...base, size, kind: "image", url: `data:${IMAGE_PREVIEW[ext]};base64,${bytes.toString("base64")}` };
    }
    if (bytes.subarray(0, 8192).includes(0)) return { ...base, size, kind: "file" };
    return { ...base, size, kind: "text", text: bytes.toString("utf8"), truncated: size > MAX_TEXT };
  } finally {
    await handle.close();
  }
}

// anybot:revealPath and anybot:listDirectory take owner-chosen paths
// (attachments, the rail explorer). They may be UNC (a NAS the owner picked),
// but never device paths, control or bidi characters, or huge strings.
function ownerPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    CONTROL.test(value) ||
    INVISIBLE.test(value) ||
    /^[\\/]{2}[?.][\\/]/.test(value)
  )
    throw new Error("That isn't a folder or file path Any Bot can use.");
  return value;
}

module.exports = {
  BLOCKED_EXTENSIONS,
  COPY_EXTENSIONS,
  OPEN_EXTENSIONS,
  MAX_TEXT,
  MAX_IMAGE,
  actionProblem,
  createFileLinks,
  createInspector,
  ownerPath,
  policy,
  readPreview,
  refusal,
  resolveCandidate,
  safeExtension,
};
