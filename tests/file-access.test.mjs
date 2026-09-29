import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  BLOCKED_EXTENSIONS,
  COPY_EXTENSIONS,
  OPEN_EXTENSIONS,
  actionProblem,
  createFileLinks,
  createInspector,
  ownerPath,
  policy,
  readPreview,
  refusal,
  resolveCandidate,
} = require("../desktop/file-access.cjs");

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-files-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const enoent = () => Object.assign(new Error("not found"), { code: "ENOENT" });

// An fs that records every call. `files` maps path -> size, `dirs` lists
// folders, `links` maps path -> readlink target, `real` maps path -> realpath,
// `contents` maps path -> file bytes (open/read), anything under a `hang`
// prefix never answers, and one under a `lag` prefix answers after lagMs.
function fakeFs({ files = {}, dirs = [], links = {}, real = {}, contents = {}, hang = [], lag = [], lagMs = 0 } = {}) {
  const calls = [];
  const known = [...Object.keys(files), ...dirs, ...Object.keys(links), ...Object.keys(contents)].map((p) => p.toLowerCase());
  const exists = (p) => known.some((k) => k === p.toLowerCase() || k.startsWith(`${p.toLowerCase()}\\`));
  const under = (list, p) => list.some((prefix) => p.toUpperCase().startsWith(prefix.toUpperCase()));
  const call = (name, p, answer) => {
    calls.push([name, p]);
    if (under(hang, p)) return new Promise(() => {});
    if (under(lag, p)) return new Promise((resolve) => setTimeout(resolve, lagMs)).then(answer);
    return answer();
  };
  const dirent = (name, full) => ({
    name,
    isSymbolicLink: () => Boolean(links[full]),
    isDirectory: () => !links[full] && (dirs.includes(full) || known.some((k) => k.startsWith(`${full.toLowerCase()}\\`))),
    isFile: () => !links[full] && (files[full] !== undefined || contents[full] !== undefined),
  });
  return {
    calls,
    lstat: (p) =>
      call("lstat", p, async () => {
        if (links[p]) return { isSymbolicLink: () => true };
        if (!exists(p)) throw enoent();
        return { isSymbolicLink: () => false };
      }),
    readlink: (p) => call("readlink", p, async () => links[p]),
    realpath: (p) =>
      call("realpath", p, async () => {
        if (real[p]) return real[p];
        if (!exists(p)) throw enoent();
        return p;
      }),
    stat: (p) =>
      call("stat", p, async () => {
        if (files[p] !== undefined) return { isFile: () => true, isDirectory: () => false, size: files[p] };
        if (dirs.includes(p)) return { isFile: () => false, isDirectory: () => true, size: 0 };
        throw enoent();
      }),
    readdir: (p) =>
      call("readdir", p, async () => {
        const prefix = `${p.toLowerCase()}\\`;
        const all = [...Object.keys(files), ...dirs, ...Object.keys(links), ...Object.keys(contents)];
        const names = new Set(all.filter((k) => k.toLowerCase().startsWith(prefix)).map((k) => k.slice(prefix.length).split("\\")[0]));
        return [...names].map((name) => dirent(name, `${p}\\${name}`));
      }),
    open: (p) =>
      call("open", p, async () => {
        if (contents[p] === undefined) throw enoent();
        const bytes = Buffer.from(contents[p]);
        return {
          read: async (buffer, offset, length, position) => ({ bytesRead: bytes.copy(buffer, offset, position, position + length) }),
          close: async () => {},
        };
      }),
  };
}
const win = (fs, options = {}) => createInspector({ fs, platform: "win32", home: "C:\\Users\\me", ...options });

test("unsafe paths are refused before any filesystem call, with the reason", async () => {
  const table = {
    network: ["\\\\h\\s\\x", "//h/s/x", "/\\h\\s", "\\/h/s", "file://host/x", "file://localhost/C:/x"],
    device: ["\\\\?\\C:\\x", "\\\\.\\pipe\\x", "\\\\.\\PhysicalDrive0", "C:\\x\\CON", "nul.txt", "COM1", "COM¹.txt", "LPT9.log", "CONIN$", "C:\\x\\aux.md"],
    stream: ["a.txt:x", "C:\\x\\evil.exe::$DATA", "C:foo"],
    rooted: ["\\Windows\\x.txt", "/Windows/x.txt"],
    invalid: [
      "C:\\x\\evil.exe.",
      "C:\\x\\evil.exe ",
      "C:\\x \\a.md",
      " C:\\x\\a.md",
      "C:\\x\\a\u0007.md",
      "C:\\x\\a\u0085.md",
      "file:///C:/x/a%00.md",
      "C:\\x\\report\u202efdp.exe",
      "C:\\x\\a\u200b.md",
      "C:\\x\\*.md",
      "C:\\x\\a?.md",
      `C:\\${"a".repeat(1025)}`,
      "",
      42,
    ],
  };
  const fs = fakeFs();
  const inspector = win(fs);
  for (const [reason, inputs] of Object.entries(table))
    for (const raw of inputs) {
      assert.equal(refusal(raw, { platform: "win32" }), reason, JSON.stringify(raw));
      assert.deepEqual(await inspector.inspect(raw, { bases: ["C:\\ws"] }), { state: "refused", reason }, JSON.stringify(raw));
    }
  assert.deepEqual(fs.calls, []);
  for (const raw of ["C:\\x\\a.md", "C:/x/a b/c.md", "file:///C:/x/a%20b.md", "src/a.md", "~/a.md", "..\\x.md"])
    assert.equal(refusal(raw, { platform: "win32" }), null, raw);
});

test("relative paths resolve inside each base in order, and ~ goes to home", () => {
  const options = { bases: ["C:\\ws", "D:\\shared"], home: "C:\\Users\\me", platform: "win32" };
  assert.deepEqual(resolveCandidate("C:\\\\Users\\\\me\\\\Videos", options), {
    options: [{ path: "C:\\Users\\me\\Videos", within: null }],
  });
  assert.deepEqual(resolveCandidate("file:///C:/x/a%20b.md", options), { options: [{ path: "C:\\x\\a b.md", within: null }] });
  assert.deepEqual(resolveCandidate("src/a.md", options).options, [
    { path: "C:\\ws\\src\\a.md", within: "C:\\ws" },
    { path: "D:\\shared\\src\\a.md", within: "D:\\shared" },
  ]);
  assert.deepEqual(resolveCandidate("a/../b.md", options).options[0], { path: "C:\\ws\\b.md", within: "C:\\ws" });
  assert.deepEqual(resolveCandidate("../escape/x.md", options), { refused: "outside" });
  assert.deepEqual(resolveCandidate("a/../../x.md", options), { refused: "outside" });
  assert.deepEqual(resolveCandidate("src/a.md", { ...options, bases: [] }), { refused: "outside" });
  // Bases that are themselves unsafe are skipped.
  assert.deepEqual(resolveCandidate("a.md", { ...options, bases: ["\\\\nas\\share", "relative", "C:\\ok"] }).options, [
    { path: "C:\\ok\\a.md", within: "C:\\ok" },
  ]);
  assert.deepEqual(resolveCandidate("~/.claude/settings.json", options), {
    options: [{ path: "C:\\Users\\me\\.claude\\settings.json", within: "C:\\Users\\me" }],
  });
  assert.deepEqual(resolveCandidate("~/../other/x.md", options), { refused: "outside" });
});

// The design's blocked list (survey design:file-links). None of these may
// ever reach shell.openPath.
const DESIGN_BLOCKED = `exe com scr pif cpl msc msi msp mst msu msix msixbundle appx appxbundle appinstaller application
appref-ms xbap gadget dll ocx sys drv efi cab jar jnlp xll wll xla xlam ppa ppam bat cmd btm ps1 ps1xml ps2 ps2xml psc1
psc2 psd1 psm1 pssc cdxml msh msh1 msh2 mshxml msh1xml msh2xml vb vbe vbs vbscript js jse ws wsc wsf wsh sct hta py pyw
pyc pyo pyz pyzw rb rbw pl tcl php lua sh bash zsh ksh csh ahk au3 kix lnk url website webloc inetloc desktop library-ms
search-ms searchconnector-ms settingcontent-ms scf shb shs theme themepack deskthemepack msstyles reg inf ins isp diagcab
diagcfg diagpkg xnk mof cer crt der p7b p7c p12 pfx spc sst stl iso img vhd vhdx udf wim dmg docm dotm xlsm xltm xlsb pptm
potm ppsm sldm doc dot xls xlt ppt pot pps ppsx odt ods odp odg rtf mht mhtml chm hlp mdb mde accdb accde accdr adp ade mda
mdt mdw mdz mam maf mag maq mar mas mat mau mav maw prf pst iqy slk dqy rqy oqy asx wax wvx wmx wpl m3u m3u8 pls xspf app
pkg mpkg command tool terminal workflow action scpt scptd applescript run bin appimage deb rpm apk`
  .split(/\s+/)
  .map((ext) => `.${ext}`);

test("blocked types are never opened, in any case", () => {
  for (const ext of DESIGN_BLOCKED) {
    assert.ok(BLOCKED_EXTENSIONS.has(ext), `${ext} is in the blocked list`);
    for (const name of [`x${ext}`, `X${ext.toUpperCase()}`, `x${ext[0]}${ext[1].toUpperCase()}${ext.slice(2)}`, `report.pdf${ext}`]) {
      const rule = policy(name);
      assert.notEqual(rule.tier, "open", name);
      assert.equal(rule.open, false, name);
    }
  }
  assert.deepEqual([...OPEN_EXTENSIONS].filter((ext) => BLOCKED_EXTENSIONS.has(ext)), []);
  assert.equal(policy("EVIL.EXE").reason, "runs-programs");
  assert.equal(policy("x.Js").action, "preview"); // code is previewed as text, never run
  assert.equal(policy("report.pdf.exe").action, "reveal");
  assert.equal(policy("x.tar.gz").open, false);
  for (const ext of COPY_EXTENSIONS) assert.equal(policy(`x${ext}`).tier, "copy", ext);
  assert.deepEqual(policy("x.lnk"), { tier: "copy", kind: "other", open: false, reveal: false, preview: "text", action: "menu", reason: "shell-pointer" });
  assert.equal(policy("GodMode.{ED7BA470-8E54-465E-825C-99712043E01C}", { folder: true }).tier, "copy");
  assert.equal(policy("projects", { folder: true }).action, "open");
});

test("each type gets its default click", () => {
  const click = (name) => [policy(name).tier, policy(name).action, policy(name).preview];
  assert.deepEqual(click("Makefile"), ["reveal", "preview", "text"]); // extensionless: preview only
  assert.deepEqual(click("notes.md"), ["open", "preview", "text"]);
  assert.deepEqual(click("shot.png"), ["open", "preview", "image"]);
  assert.deepEqual(click("photo.heic"), ["open", "open", null]);
  assert.deepEqual(click("clip.mp4"), ["open", "open", null]);
  assert.deepEqual(click("report.pdf"), ["open", "open", null]);
  assert.deepEqual(click("main.ts"), ["reveal", "preview", "text"]);
  assert.deepEqual(click("setup.exe"), ["reveal", "reveal", null]);
  assert.deepEqual(click("disk.iso"), ["reveal", "reveal", null]);
  // Bot reports and pages open like a double-click in Explorer would; the
  // macro kinds never do. SVG previews in the app, and Explorer's zip view
  // draws the icons inside, so a zip is only shown in its folder.
  assert.deepEqual(click("deck.pptx"), ["open", "open", null]);
  assert.deepEqual(click("notes.docx"), ["open", "open", null]);
  assert.deepEqual(click("sheet.xlsx"), ["open", "open", null]);
  assert.deepEqual(click("page.html"), ["open", "open", "text"]);
  assert.deepEqual(click("macros.docm"), ["reveal", "reveal", null]);
  assert.deepEqual(click("old.doc"), ["reveal", "reveal", null]);
  assert.deepEqual(click("icon.svg"), ["reveal", "preview", "image"]);
  assert.deepEqual(click("bundle.zip"), ["reveal", "reveal", null]);
});

test("a folder named like a file gets that file's rules, so a swap can't open a program", () => {
  const folder = (name) => policy(name, { folder: true });
  for (const name of ["projects", ".git", "photos.png", "notes.pdf"]) assert.equal(folder(name).action, "open", name);
  for (const name of ["setup.exe", "run.BAT", "v1.2", "site.github.io"]) {
    const rule = folder(name);
    assert.deepEqual([rule.tier, rule.open, rule.reveal, rule.action, rule.kind, rule.reason], ["reveal", false, true, "reveal", "folder", "folder-name"], name);
  }
  assert.deepEqual([folder("x.lnk").tier, folder("x.lnk").reveal, folder("x.lnk").action], ["copy", false, "menu"]);
  const exe = { state: "folder", name: "setup.exe", ...folder("setup.exe") };
  assert.match(actionProblem(exe, "open", "setup.exe").message, /^Any Bot doesn't open folders named like \.exe files\. Use Show in folder\.$/);
  assert.equal(actionProblem(exe, "reveal", "setup.exe"), null);
});

test("inspect finds files and folders, and the first base that has the path wins", async (t) => {
  const root = await temp(t);
  const first = join(root, "first");
  const second = join(root, "second");
  await mkdir(join(first, "src"), { recursive: true });
  await mkdir(join(second, "src"), { recursive: true });
  await writeFile(join(second, "src", "a.md"), "second");
  await writeFile(join(first, "notes.md"), "first");
  const inspector = createInspector({ home: root });
  const bases = [first, second];
  const file = await inspector.inspect("src/a.md", { bases });
  assert.equal(file.state, "file");
  assert.equal(file.path, join(second, "src", "a.md"));
  assert.equal(file.size, 6);
  assert.equal(file.action, "preview");
  assert.equal((await inspector.inspect("notes.md", { bases })).path, join(first, "notes.md"));
  const folder = await inspector.inspect("src/", { bases });
  assert.equal(folder.state, "folder");
  assert.equal(folder.path, join(first, "src"));
  assert.deepEqual(await inspector.inspect("src/missing.md", { bases }), { state: "missing" });
  assert.deepEqual(await inspector.inspect(join(root, "nope", "x.md")), { state: "missing" });
  assert.equal((await inspector.inspect("~/first/notes.md")).state, "file");
});

test("a junction inside a base that points outside it is refused", { skip: process.platform !== "win32" }, async (t) => {
  const root = await temp(t);
  const base = join(root, "base");
  const outside = join(root, "outside");
  await mkdir(base);
  await mkdir(outside);
  await writeFile(join(outside, "secret.md"), "secret");
  await symlink(outside, join(base, "j"), "junction");
  const inspector = createInspector();
  assert.deepEqual(await inspector.inspect("j/secret.md", { bases: [base] }), { state: "refused", reason: "outside" });
  // Written as an absolute path it is followed: the target is a local folder.
  const direct = await inspector.inspect(join(base, "j", "secret.md"));
  assert.equal(direct.state, "file");
  assert.equal(direct.path, join(outside, "secret.md"));
});

test("a link to a network path is refused without following it", async () => {
  const fs = fakeFs({ files: { "C:\\ws\\share\\x.md": 1 }, links: { "C:\\ws\\share": "\\\\server\\x" } });
  assert.deepEqual(await win(fs).inspect("C:\\ws\\share\\x.md"), { state: "refused", reason: "link" });
  assert.ok(!fs.calls.some(([name]) => name === "realpath" || name === "stat"), JSON.stringify(fs.calls));
  assert.ok(!fs.calls.some(([, p]) => p.startsWith("\\\\")), "never touched the share");
});

test("a chain of links is walked hop by hop, so a -> b -> share is refused before anything follows a", async () => {
  const links = { "C:\\ws\\a": "C:\\ws\\b", "C:\\ws\\b": "\\\\evil\\share" };
  for (const raw of ["C:\\ws\\a", "C:\\ws\\a\\x.txt"]) {
    const fs = fakeFs({ files: { "C:\\ws\\c.txt": 1 }, links });
    assert.deepEqual(await win(fs).inspect(raw), { state: "refused", reason: "link" }, raw);
    assert.ok(!fs.calls.some(([name]) => name === "realpath" || name === "stat"), JSON.stringify(fs.calls));
    // Only link-free paths were asked about: never the share, never through a.
    assert.deepEqual(fs.calls.filter(([name]) => name === "lstat").map(([, p]) => p), ["C:\\ws", "C:\\ws\\a", "C:\\ws\\b"], raw);
  }
  const relative = fakeFs({ files: { "C:\\ws\\c.txt": 1 }, links });
  assert.deepEqual(await win(relative).inspect("a\\x.txt", { bases: ["C:\\ws"] }), { state: "refused", reason: "link" });
  // A chain of local links resolves to the file at its end.
  const fs = fakeFs({ files: { "C:\\data\\x.txt": 3 }, links: { "C:\\ws\\a": "C:\\ws\\b", "C:\\ws\\b": "..\\data" } });
  const ref = await win(fs).inspect("C:\\ws\\a\\x.txt");
  assert.equal(ref.state, "file");
  assert.equal(ref.path, "C:\\data\\x.txt");
  assert.ok(fs.calls.some(([name, p]) => name === "realpath" && p === "C:\\data\\x.txt"), "realpath gets the walked path");
  // A loop runs out of hops.
  const loop = fakeFs({ links: { "C:\\ws\\a": "C:\\ws\\b", "C:\\ws\\b": "C:\\ws\\a" } });
  assert.deepEqual(await win(loop).inspect("C:\\ws\\a\\x.txt"), { state: "refused", reason: "link" });
});

test("the real name's extension decides, so an 8.3 short name can't hide one", async () => {
  const long = "C:\\ws\\averyveryverylongname.settingcontent-ms";
  const fs = fakeFs({ files: { [long]: 10, "C:\\ws\\AVERYV~1.SET": 10 }, real: { "C:\\ws\\AVERYV~1.SET": long } });
  const ref = await win(fs).inspect("C:\\ws\\AVERYV~1.SET");
  assert.equal(ref.state, "file");
  assert.equal(ref.path, long);
  assert.equal(ref.tier, "copy");
  // A link named like a document that resolves to a program keeps the stricter rule.
  const fs2 = fakeFs({ files: { "C:\\ws\\evil.exe": 10, "C:\\ws\\notes.md": 10 }, real: { "C:\\ws\\notes.md": "C:\\ws\\evil.exe" } });
  const hidden = await win(fs2).inspect("C:\\ws\\notes.md");
  assert.equal(hidden.open, false);
  assert.equal(hidden.reason, "runs-programs");
});

test("a slow drive answers unknown and is skipped for a while", async () => {
  let clock = 1000;
  const fs = fakeFs({ files: { "C:\\ws\\a.md": 1, "D:\\slow\\b.md": 1 }, hang: ["D:"] });
  const inspector = win(fs, { slowMs: 20, coolMs: 60_000, now: () => clock });
  assert.deepEqual(await inspector.inspect("D:\\slow\\b.md"), { state: "unknown" });
  assert.equal(inspector.isSlow("D:"), true);
  const before = fs.calls.length;
  assert.deepEqual(await inspector.inspect("D:\\slow\\other.md"), { state: "unknown" });
  assert.equal(fs.calls.length, before, "no filesystem call on a slow drive");
  assert.equal((await inspector.inspect("C:\\ws\\a.md")).state, "file");
  clock += 60_001;
  assert.equal(inspector.isSlow("D:"), false);
});

test("a drive that answers late was only busy: its slow mark clears once the call returns", async () => {
  const fs = fakeFs({ files: { "C:\\ws\\a.md": 1 }, lag: ["C:\\ws"], lagMs: 60 });
  const inspector = win(fs, { slowMs: 20, coolMs: 60_000 });
  assert.deepEqual(await inspector.inspect("C:\\ws\\a.md"), { state: "unknown" });
  assert.equal(inspector.isSlow("C:"), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(inspector.isSlow("C:"), false);
});

test("files.check validates, caches the context, and answers unknown past the deadline", async () => {
  const contexts = [];
  const inspector = {
    inspect: (raw) =>
      raw === "C:\\hang.md" ? new Promise(() => {}) : Promise.resolve(raw.endsWith("a.md") ? { state: "file", path: raw } : { state: "missing" }),
  };
  const links = createFileLinks({
    inspector,
    deadlineMs: 50,
    context: async (message) => {
      contexts.push(message);
      if (message === "gone") throw new Error("Message not found");
      return { bases: ["C:\\ws"] };
    },
  });
  for (const bad of [null, {}, { message: "m", paths: "x" }, { message: "m", paths: [""] }, { message: "m", paths: Array(65).fill("a") }, { message: "x".repeat(101), paths: [] }])
    await assert.rejects(links.check(bad), /Invalid file check/);
  await assert.rejects(links.check({ message: "gone", paths: ["a.md"] }), /Message not found/);
  const { results } = await links.check({ message: "m1", paths: ["C:\\a.md", "C:\\b.md", "C:\\hang.md", "C:\\a.md"] });
  assert.deepEqual(results, {
    "C:\\a.md": { state: "file", path: "C:\\a.md" },
    "C:\\b.md": { state: "missing" },
    "C:\\hang.md": { state: "unknown" },
  });
  await links.check({ message: "m1", paths: ["C:\\a.md"] });
  assert.deepEqual(contexts, ["gone", "m1"]);
  await assert.rejects(links.resolve({ message: "m1", path: "" }), /Invalid file request/);
  assert.deepEqual(await links.resolve({ message: "m1", path: "C:\\a.md" }), { raw: "C:\\a.md", ref: { state: "file", path: "C:\\a.md" } });
});

test("actions explain in plain words why they can't run", () => {
  assert.deepEqual(actionProblem({ state: "missing" }, "open", "C:\\x\\report.md"), { message: "That file isn't there any more: report.md" });
  assert.match(actionProblem({ state: "refused", reason: "network" }, "open", "x").message, /^Any Bot doesn't open network locations\.$/);
  assert.equal(actionProblem({ state: "refused", reason: "network" }, "preview", "x").record, true);
  const exe = { state: "file", name: "setup.exe", ...policy("setup.exe") };
  assert.deepEqual(actionProblem(exe, "open", "setup.exe"), {
    message: "Any Bot doesn't open .exe files because they can run programs. Use Show in folder.",
    record: true,
    reason: "runs-programs",
    ext: ".exe",
  });
  assert.equal(actionProblem(exe, "reveal", "setup.exe"), null);
  assert.equal(actionProblem(exe, "preview", "setup.exe"), null);
  const lnk = { state: "file", name: "x.lnk", ...policy("x.lnk") };
  assert.match(actionProblem(lnk, "reveal", "x.lnk").message, /^Any Bot doesn't show shortcut files in their folder\./);
  const god = { state: "folder", name: "GodMode.{ED7BA470-8E54-465E-825C-99712043E01C}", ...policy("GodMode.{ED7BA470-8E54-465E-825C-99712043E01C}", { folder: true }) };
  assert.match(actionProblem(god, "open", "x").message, /^Any Bot doesn't open special system folders\./);
  assert.match(actionProblem(god, "reveal", "x").message, /^Any Bot doesn't show special system folders in Explorer\./);
  // The same links show in attachments and the Files panel, so no message says "from chat".
  for (const [ref, action] of [[exe, "open"], [lnk, "open"], [lnk, "reveal"], [god, "open"], [{ state: "file", name: "a.xyz", ...policy("a.xyz") }, "open"]])
    assert.doesNotMatch(actionProblem(ref, action, "x").message, /chat/);
  const md = { state: "file", name: "a.md", ...policy("a.md") };
  assert.equal(actionProblem(md, "open", "a.md"), null);
});

// Explorer draws a folder with the icons its pointer files name; one on
// \\host sends the NTLM hash. Written as a fake fs so no real file points
// anywhere.
test("a folder is only opened, or a file shown in it, when no shortcut in it points to the network", async () => {
  const unc = "[InternetShortcut]\r\nURL=https://example.com/\r\nIconFile=\\\\evil\\s\\i.ico\r\nIconIndex=0\r\n";
  const localIni = Buffer.from("\ufeff[.ShellClassInfo]\r\nIconResource=%SystemRoot%\\system32\\imageres.dll,-3\r\n", "utf16le");
  const remoteIni = Buffer.from("\ufeff[.ShellClassInfo]\r\nIconResource=\\\\evil\\s\\i.ico,0\r\n", "utf16le");
  const folder = { state: "folder", path: "C:\\ws\\out" };
  const file = { state: "file", path: "C:\\ws\\out\\tool.exe" };
  const problem = (contents, ref = folder, action = "open", extra = {}) =>
    win(fakeFs({ files: { "C:\\ws\\out\\tool.exe": 1 }, contents, ...extra })).explorerProblem(ref, action);

  assert.equal(await problem({ "C:\\ws\\out\\zz.url": unc }), "pointer");
  assert.equal(await problem({ "C:\\ws\\out\\zz.url": unc }, file, "reveal"), "pointer", "Show in folder draws the same folder");
  assert.equal(await problem({ "C:\\ws\\out\\desktop.ini": remoteIni }), "pointer", "UTF-16 desktop.ini");
  assert.equal(await problem({ "C:\\ws\\out\\sub\\desktop.ini": remoteIni }), "pointer", "a subfolder's desktop.ini");
  assert.equal(await problem({ "C:\\ws\\out\\x.scf": "[Shell]\r\nIconFile=//evil/s/i.ico\r\n" }), "pointer");
  assert.equal(await problem({ "C:\\ws\\out\\x.url": "[InternetShortcut]\r\nURL=file://evil/s/x\r\n" }), "pointer");
  assert.equal(await problem({}, folder, "open", { links: { "C:\\ws\\out\\share": "\\\\evil\\s" } }), "pointer", "a link to a share");
  // Ordinary shortcuts, desktop.ini, and web links are fine, and so is a
  // pointer file in some other folder.
  assert.equal(await problem({ "C:\\ws\\out\\desktop.ini": localIni, "C:\\ws\\out\\site.url": "[InternetShortcut]\r\nURL=https://example.com/a\r\n" }), null);
  assert.equal(await problem({ "C:\\ws\\other\\zz.url": unc }), null);
  assert.equal(await problem({ "C:\\ws\\out\\zz.url": unc }, file, "open"), null, "opening a file doesn't draw its folder");
  const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`C:\\ws\\out\\f${i}.txt`, "x"]));
  assert.equal(await problem(many), "crowded");
  // readdir calls a OneDrive folder a link, but it isn't one (readlink says
  // EINVAL): it's checked as a folder. A real link that can't be read isn't shown.
  const reparse = (isLink) => ({
    readdir: async () => [{ name: "OneDrive", isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }],
    readlink: async () => {
      throw Object.assign(new Error("invalid"), { code: "EINVAL" });
    },
    lstat: async () => ({ isSymbolicLink: () => isLink, isDirectory: () => !isLink }),
    open: async () => {
      throw enoent();
    },
  });
  assert.equal(await win(reparse(false)).explorerProblem(folder, "open"), null);
  assert.equal(await win(reparse(true)).explorerProblem(folder, "open"), "pointer");

  const links = createFileLinks({ inspector: win(fakeFs({ contents: { "C:\\ws\\out\\zz.url": unc } })), context: async () => ({ bases: [] }) });
  assert.deepEqual(await links.explorerProblem(folder, "open"), {
    message: "That folder has a shortcut or desktop.ini that points to a network location, so Any Bot won't show it. Right-click to copy the path.",
    record: true,
    reason: "pointer",
    ext: "",
  });
  assert.equal(await links.explorerProblem(folder, "preview"), null);
});

test("previews read at most 512 KB of text and 2 MB of image", async (t) => {
  const root = await temp(t);
  const inspector = createInspector();
  const preview = async (name, bytes) => {
    await writeFile(join(root, name), bytes);
    return readPreview(await inspector.inspect(join(root, name)));
  };
  const text = await preview("a.md", "# Hello\nworld");
  assert.equal(text.kind, "text");
  assert.equal(text.text, "# Hello\nworld");
  assert.equal(text.truncated, false);
  assert.equal(text.open, true);
  assert.equal((await preview("bin.txt", Buffer.from([65, 0, 66]))).kind, "file");
  const long = await preview("long.log", "x".repeat(600 * 1024));
  assert.equal(long.kind, "text");
  assert.equal(long.text.length, 512 * 1024);
  assert.equal(long.truncated, true);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const small = await preview("shot.png", png);
  assert.equal(small.kind, "image");
  assert.equal(small.url, `data:image/png;base64,${png.toString("base64")}`);
  assert.equal((await preview("huge.png", Buffer.alloc(3 * 1024 * 1024))).kind, "file");
  assert.equal((await preview("clip.mp4", "not really")).kind, "file");
  assert.equal((await preview("setup.exe", "MZ")).kind, "file");
  // A different file at the path than the one inspect() checked shows no content.
  await writeFile(join(root, "swapped.md"), "secret");
  const ref = await inspector.inspect(join(root, "swapped.md"));
  assert.match(ref.identity, /^\d+:\d+$/);
  assert.equal((await readPreview(ref)).kind, "text");
  assert.equal((await readPreview({ ...ref, identity: "0:0" })).kind, "file");
});

test("owner paths for revealPath and listDirectory refuse device paths and hidden characters", () => {
  for (const ok of ["C:\\Users\\me\\a.md", "\\\\nas\\share\\folder", "/home/me"]) assert.equal(ownerPath(ok), ok);
  for (const bad of ["\\\\?\\C:\\x", "\\\\.\\pipe\\x", "//./pipe/x", "C:\\x\u0000", "C:\\x\u202e", "", "a".repeat(2049), null, 7])
    assert.throws(() => ownerPath(bad), /isn't a folder or file path/, JSON.stringify(bad));
});
