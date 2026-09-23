import http from "node:http";
import https from "node:https";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest();
const pick = (value, keys) =>
  Object.fromEntries(keys.map((key) => [key, value[key]]));
const employeeKeys = ["id", "name", "role", "harness", "archived", "timeoutMinutes"];
const runKeys = [
  "id",
  "conversation",
  "employee",
  "message",
  "parent",
  "status",
  "output",
  "error",
  "created",
  "started",
  "ended",
];
// Audio a phone may upload for transcription. The desktop voice service makes
// the ElevenLabs call, so the phone never holds the API key.
const audioTypes = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4", "audio/aac"]);
const maxAudioBytes = 10 * 1024 * 1024;
const voiceCallsPerMinute = 30;
const deviceRoles = new Set(["viewer", "contributor", "operator"]);
const humanRoles = new Set(["owner", "member", "viewer"]);
const memberIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;
const normalizeMemberList = (members) => {
  if (!Array.isArray(members) || members.length > 256)
    throw new Error("Human member list is invalid");
  const seen = new Set();
  return new Map(members.map((member) => {
    if (!member || typeof member !== "object" ||
        typeof member.id !== "string" || !memberIdPattern.test(member.id) ||
        seen.has(member.id))
      throw new Error("Human member IDs must be unique and well formed");
    const value = {
      id: member.id,
      name: String(member.name || member.id).slice(0, 60),
      role: member.role || "member",
    };
    if (!humanRoles.has(value.role)) throw new Error("Unknown human member role");
    seen.add(value.id);
    return [value.id, value];
  }));
};

export function createMobileGateway({
  command,
  tls,
  host = "127.0.0.1",
  port = 0,
  origins = ["capacitor://localhost", "https://localhost"],
  allowInsecureLoopback = false,
  members = [],
  membersPath = null,
  identity = null,
  statePath = null,
  auditPath = null,
  voice = null,
  clock = Date.now,
}) {
  if (!tls && !(allowInsecureLoopback && host === "127.0.0.1"))
    throw new Error("Mobile access requires TLS");
  let configuredMembers = normalizeMemberList(members);
  const saveMembers = () => {
    if (!membersPath) return;
    mkdirSync(path.dirname(membersPath), { recursive: true });
    const next = `${membersPath}.tmp`;
    writeFileSync(next, JSON.stringify([...configuredMembers.values()]), { encoding: "utf8", mode: 0o600 });
    renameSync(next, membersPath);
  };
  if (membersPath && existsSync(membersPath)) {
    try {
      configuredMembers = normalizeMemberList(JSON.parse(readFileSync(membersPath, "utf8")));
    } catch {
      throw new Error("Gateway human membership state is invalid or unreadable");
    }
  } else if (membersPath) saveMembers();
  const addMember = ({ id, name, role = "member" } = {}, actor = "owner") => {
    const requestedId = String(id || "");
    const existing = configuredMembers.get(requestedId);
    if (!requestedId || (existing?.role === "owner") || role === "owner")
      throw new Error("The owner role is managed outside this endpoint");
    const next = new Map(configuredMembers);
    next.set(requestedId, {
      id: requestedId,
      name: String(name || requestedId).slice(0, 60),
      role,
    });
    configuredMembers = normalizeMemberList([...next.values()]);
    saveMembers();
    recordAudit({ actor, action: "member.added", resource: requestedId, at: clock() });
    return [...configuredMembers.values()];
  };
  const removeMember = (id, actor = "owner") => {
    const member = configuredMembers.get(String(id || ""));
    if (!member) throw new Error("Human member not found");
    if (member.role === "owner" || member.id === actor)
      throw new Error("The owner cannot be removed");
    const next = new Map(configuredMembers);
    next.delete(member.id);
    configuredMembers = normalizeMemberList([...next.values()]);
    for (const [key, session] of sessions || [])
      if (session.memberId === member.id) sessions.delete(key);
    saveMembers();
    recordAudit({ actor, action: "member.removed", resource: member.id, at: clock() });
    return [...configuredMembers.values()];
  };
  const sessions = new Map(),
    attempts = new Map(),
    voiceUse = new Map(),
    conversationAccess = new Map(),
    auditLog = [];
  const loadAudit = () => {
    if (!auditPath || !existsSync(auditPath)) return;
    try {
      const lines = readFileSync(auditPath, "utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-1000)) {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== "object" || typeof entry.action !== "string" ||
            typeof entry.at !== "number") throw new Error("Invalid audit entry");
        auditLog.push(entry);
      }
    } catch {
      throw new Error("Gateway audit state is invalid or unreadable");
    }
  };
  const recordAudit = (entry) => {
    const safe = { actor: String(entry.actor || "system"), action: String(entry.action), resource: entry.resource || null, at: Number(entry.at || clock()) };
    auditLog.push(safe);
    if (auditLog.length > 1000) auditLog.splice(0, auditLog.length - 1000);
    if (auditPath) {
      mkdirSync(path.dirname(auditPath), { recursive: true });
      appendFileSync(auditPath, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  };
  const loadAccess = () => {
    if (!statePath || !existsSync(statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(statePath, "utf8"));
      if (!saved || typeof saved !== "object" || Array.isArray(saved))
        throw new Error("Invalid membership document");
      for (const [conversation, ids] of Object.entries(saved)) {
        if (!conversation || !Array.isArray(ids) ||
            !ids.every((id) => typeof id === "string" && id.length > 0))
          throw new Error("Invalid membership entry");
        conversationAccess.set(conversation, new Set(ids));
      }
    } catch {
      throw new Error("Gateway membership state is invalid or unreadable");
    }
  };
  const saveAccess = (grants = conversationAccess) => {
    if (!statePath) return;
    mkdirSync(path.dirname(statePath), { recursive: true });
    const next = `${statePath}.tmp`;
    writeFileSync(
      next,
      JSON.stringify(Object.fromEntries([...grants].map(([id, ids]) => [id, [...ids]]))),
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(next, statePath);
  };
  const setAccess = (conversation, ids) => {
    const next = new Map(conversationAccess);
    next.set(conversation, new Set(ids));
    saveAccess(next);
    conversationAccess.set(conversation, next.get(conversation));
  };
  loadAccess();
  loadAudit();
  let pairing = null;
  const json = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  async function body(req) {
    if (
      !String(req.headers["content-type"] || "").startsWith("application/json")
    )
      throw new Error("JSON required");
    let bytes = 0,
      chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 32768) throw new Error("Request too large");
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error("Invalid request");
    return value;
  }
  async function audioBody(req) {
    const type = String(req.headers["content-type"] || "").split(";")[0].trim();
    if (!audioTypes.has(type)) throw Object.assign(new Error("Unsupported audio format"), { status: 415 });
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > maxAudioBytes) throw Object.assign(new Error("Recording too long"), { status: 413 });
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxAudioBytes) throw Object.assign(new Error("Recording too long"), { status: 413 });
      chunks.push(chunk);
    }
    if (!bytes) throw Object.assign(new Error("No audio was recorded"), { status: 400 });
    return { audio: Buffer.concat(chunks), mime: type };
  }
  // Voice calls spend the owner's ElevenLabs credits; cap each device.
  const voiceAllowed = (sessionId) => {
    const now = clock();
    const recent = (voiceUse.get(sessionId) || []).filter((at) => at > now - 60000);
    if (recent.length >= voiceCallsPerMinute) return false;
    recent.push(now);
    voiceUse.set(sessionId, recent);
    return true;
  };
  const voiceSettings = () => {
    const settings = voice?.settings();
    const cloud = Boolean(settings?.elevenlabs?.configured);
    return {
      cloud,
      stt: cloud ? settings.stt : "system",
      tts: cloud ? settings.tts : "system",
    };
  };
  const server = (tls ? https : http).createServer(
    tls || {},
    async (req, res) => {
      try {
        const origin = req.headers.origin;
        if (origin && !origins.includes(origin))
          return json(res, 403, { error: "Origin not allowed" });
        if (origin) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
        }
        if (req.method === "OPTIONS") {
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE");
          res.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type",
          );
          return json(res, 204, null);
        }
        const url = new URL(req.url, "https://gateway.invalid");
        if (req.method === "GET" && url.pathname === "/healthz")
          return json(res, 200, { status: "ok" });
        if (req.method === "POST" && url.pathname === "/v1/pair") {
          const key = req.socket.remoteAddress || "unknown",
            previous = attempts.get(key);
          const counter =
            previous && previous.until > clock()
              ? previous
              : { count: 0, until: clock() + 60000 };
          if (attempts.size > 1000)
            for (const [k, v] of attempts)
              if (v.until < clock()) attempts.delete(k);
          if (attempts.size > 1000 && !attempts.has(key))
            return json(res, 429, { error: "Try again later" });
          attempts.set(key, counter);
          if (++counter.count > 5)
            return json(res, 429, {
              error: "Too many pairing attempts; wait a minute",
            });
          const input = await body(req);
          if (
            typeof input.code !== "string" ||
            !pairing ||
            pairing.until < clock() ||
            !timingSafeEqual(
              hash(input.code.trim().toUpperCase()),
              pairing.digest,
            )
          )
            return json(res, 401, { error: "Pairing code invalid or expired" });
          const pairedRole = pairing.role,
            pairedMember = pairing.member;
          pairing = null;
          for (const [k, v] of sessions)
            if (v.expiresAt <= clock()) sessions.delete(k);
          if (sessions.size >= 16)
            return json(res, 409, {
              error: "Revoke an existing device before pairing another",
            });
          const token = randomBytes(32).toString("base64url");
          const session = {
            id: randomBytes(12).toString("hex"),
            name: String(input.name || "Mobile device").slice(0, 60),
            role: pairedRole,
            memberId: pairedMember.id,
            memberName: pairedMember.name,
            humanRole: pairedMember.role,
            expiresAt: clock() + 24 * 60 * 60 * 1000,
          };
          sessions.set(hash(token).toString("hex"), session);
          recordAudit({ actor: session.memberId, action: "session.paired", resource: session.id });
          return json(res, 201, { token, ...session });
        }
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        const key = hash(token).toString("hex");
        let session = sessions.get(key);
        if (!session && identity && token) {
          const external = identity.verify(token),
            member = external && configuredMembers.get(external.memberId);
          if (external && member)
            session = {
              id: `oidc-${key.slice(0, 24)}`,
              name: "External identity",
              role: identity.deviceRole,
              memberId: member.id,
              memberName: member.name,
              humanRole: member.role,
              expiresAt: external.expiresAt,
              external: true,
              subject: external.subject,
            };
        }
        if (!session || session.expiresAt <= clock()) {
          if (!session?.external) sessions.delete(key);
          return json(res, 401, { error: "Connect this device again" });
        }
        if (req.method === "DELETE" && url.pathname === "/v1/session") {
          sessions.delete(key);
          return json(res, 200, { disconnected: true });
        }
        const invoke = async (method, payload, resource = null) => {
          if ((!session.external && sessions.get(key) !== session) || session.expiresAt <= clock())
            throw new Error("Session revoked");
          if (method !== "snapshot")
            recordAudit({
              actor: session.memberId,
              action: method,
              resource,
              at: clock(),
            });
          return command(method, payload);
        };
        const can = (capability) => capability === "read" || (session.humanRole !== "viewer" && (
          session.role === "operator" ||
          (session.role === "contributor" && capability !== "cancel") ||
          (session.role === "viewer" && capability === "read")));
        if (
          req.method === "POST" &&
          (url.pathname === "/v1/conversations" ||
            url.pathname.endsWith("/messages")) &&
          !can("write")
        )
          return json(res, 403, { error: "Device role cannot send work" });
        if (req.method === "POST" && url.pathname.endsWith("/cancel") && !can("cancel"))
          return json(res, 403, { error: "Device role cannot cancel work" });
        if (req.method === "GET" && url.pathname === "/v1/voice")
          return json(res, 200, voiceSettings());
        if (req.method === "POST" && (url.pathname === "/v1/voice/transcribe" || url.pathname === "/v1/voice/speak")) {
          if (!can("write")) return json(res, 403, { error: "Device role cannot use voice" });
          if (!voiceSettings().cloud)
            return json(res, 409, { error: "Connect ElevenLabs in the desktop app's Voice settings first" });
          if (!voiceAllowed(session.id))
            return json(res, 429, { error: "Too many voice requests; wait a minute" });
          const speak = url.pathname.endsWith("/speak");
          let input;
          try {
            input = speak ? await body(req) : await audioBody(req);
          } catch (error) {
            return json(res, error.status || 400, { error: error.status ? error.message : "Invalid voice request" });
          }
          if ((!session.external && sessions.get(key) !== session) || session.expiresAt <= clock())
            return json(res, 401, { error: "Session revoked" });
          recordAudit({ actor: session.memberId, action: speak ? "voice.speak" : "voice.transcribe", resource: null, at: clock() });
          try {
            if (!speak) return json(res, 200, await voice.transcribe(input));
            const result = await voice.speak({
              text: typeof input.text === "string" ? input.text : "",
              employeeId: typeof input.employeeId === "string" ? input.employeeId : "",
            });
            res.writeHead(200, {
              "Content-Type": result.mime,
              "Content-Length": result.audio.byteLength,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            return res.end(Buffer.from(result.audio));
          } catch (error) {
            // Voice service errors are written for people ("ElevenLabs
            // rejected the API key") and carry no secrets.
            return json(res, 502, { error: String(error.message).slice(0, 200) });
          }
        }
        const allowed = (conversation) => {
          const access = conversationAccess.get(conversation.id);
          if (access) return access.has(session.memberId);
          return session.humanRole === "owner";
        };
        const state = await invoke("snapshot");
        if ((!session.external && sessions.get(key) !== session) || session.expiresAt <= clock())
          return json(res, 401, { error: "Session revoked" });
        const visibleConversations = state.conversations.filter(allowed),
          visibleIds = new Set(visibleConversations.map((conversation) => conversation.id));
        if (req.method === "GET" && url.pathname === "/v1/audit") {
          if (session.humanRole !== "owner" && session.role !== "operator")
            return json(res, 403, { error: "Audit access requires owner or operator access" });
          const requestedLimit = Number(url.searchParams.get("limit") || 100),
            limit = Number.isInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100,
            before = Number(url.searchParams.get("before") || auditLog.length),
            end = Math.min(auditLog.length, Math.max(0, before));
          if (!Number.isInteger(before) || before < 0)
            return json(res, 400, { error: "Invalid audit cursor" });
          const start = Math.max(0, end - limit);
          return json(res, 200, {
            entries: auditLog.slice(start, end),
            olderCursor: start ? start : null,
          });
        }
        if (url.pathname === "/v1/members") {
          if (session.humanRole !== "owner" || !can("write"))
            return json(res, 403, { error: "Only an owner can manage human members" });
          if (req.method === "GET")
            return json(res, 200, { members: [...configuredMembers.values()] });
          if (!membersPath)
            return json(res, 409, { error: "Durable member management is not configured" });
          if (req.method === "POST") {
            const input = await body(req);
            try {
              return json(res, 201, { members: addMember(input, session.memberId) });
            } catch (error) {
              return json(res, 400, { error: error.message });
            }
          }
        }
        const memberDelete = url.pathname.match(/^\/v1\/members\/([^/]+)$/);
        if (req.method === "DELETE" && memberDelete) {
          if (session.humanRole !== "owner" || !can("write"))
            return json(res, 403, { error: "Only an owner can manage human members" });
          if (!membersPath)
            return json(res, 409, { error: "Durable member management is not configured" });
          try {
            return json(res, 200, { members: removeMember(memberDelete[1], session.memberId) });
          } catch (error) {
            return json(res, error.message === "Human member not found" ? 404 : 400, { error: error.message });
          }
        }
        if (req.method === "GET" && url.pathname === "/v1/overview")
          return json(res, 200, {
            employees: state.employees.map((e) => pick(e, employeeKeys)),
            conversations: visibleConversations.slice(-100),
            runs: state.runs.filter((run) => visibleIds.has(run.conversation)).slice(-100).map((r) => pick(r, runKeys)),
            humanMembers: [...configuredMembers.values()].map((member) => pick(member, ["id", "name", "role"])),
            memberId: session.memberId,
            memberRole: session.humanRole,
            deviceRole: session.role,
            runtime: pick(state.runtime, ["paused", "active", "version"]),
            moreConversations: visibleConversations.length > 100,
          });
        if (req.method === "POST" && url.pathname === "/v1/conversations") {
          const input = await body(req);
          const humanMembers = Array.isArray(input.humanMembers) ? input.humanMembers : [];
          if (humanMembers.some((id) => typeof id !== "string" || (configuredMembers.size && !configuredMembers.has(id))))
            return json(res, 400, { error: "Unknown human member" });
          const next = await invoke(
            "conversations.create",
            pick(input, ["title", "members", "delegation"]),
          );
          const created = next.conversations.at(-1);
          setAccess(created.id, [session.memberId, ...humanMembers]);
          return json(res, 201, created);
        }
        const match = url.pathname.match(
          /^\/v1\/conversations\/([\w-]+)(?:\/(messages))?$/,
        );
        if (match) {
          const conversation = state.conversations.find(
            (c) => c.id === match[1],
          );
          if (!conversation || !allowed(conversation))
            return json(res, 404, { error: "Conversation not found" });
          if (req.method === "GET" && !match[2]) {
            const all = state.messages.filter(
              (m) => m.conversation === conversation.id,
            );
            const before = url.searchParams.get("before");
            const end = before
              ? all.findIndex((m) => m.id === before)
              : all.length;
            if (end < 0) return json(res, 400, { error: "Invalid cursor" });
            const start = Math.max(0, end - 100),
              messages = all.slice(start, end);
            return json(res, 200, {
              conversation,
              messages,
              olderCursor: start ? messages[0].id : null,
              runs: state.runs
                .filter((r) => r.conversation === conversation.id)
                .slice(-30)
                .map((r) => pick(r, runKeys)),
            });
          }
          if (req.method === "POST" && match[2] === "messages") {
            const input = await body(req);
            await invoke("messages.send", {
              ...pick(input, ["body", "recipients", "requestId"]),
              conversation: conversation.id,
            }, conversation.id);
            return json(res, 202, {
              accepted: true,
              requestId: input.requestId,
            });
          }
        }
        const humans = url.pathname.match(/^\/v1\/conversations\/([\w-]+)\/humans$/);
        if (req.method === "POST" && humans) {
          const conversation = state.conversations.find((c) => c.id === humans[1]);
          if (!conversation || !allowed(conversation))
            return json(res, 404, { error: "Conversation not found" });
          if (!can("write") || (session.humanRole !== "owner" && session.role !== "operator"))
            return json(res, 403, { error: "Only an owner or operator can invite people" });
          const input = await body(req), invited = Array.isArray(input.members) ? input.members : [];
          if (!invited.length || invited.some((id) => typeof id !== "string" || (configuredMembers.size && !configuredMembers.has(id))))
            return json(res, 400, { error: "Unknown human member" });
          const access = new Set(conversationAccess.get(conversation.id) || [session.memberId]);
          invited.forEach((id) => access.add(id));
          setAccess(conversation.id, access);
          recordAudit({ actor: session.memberId, action: "humans.invite", resource: conversation.id, at: clock() });
          return json(res, 200, { members: [...access] });
        }
        const cancel = url.pathname.match(/^\/v1\/runs\/([\w-]+)\/cancel$/);
        if (req.method === "POST" && cancel) {
          const run = state.runs.find((r) => r.id === cancel[1]);
          if (!run || !visibleIds.has(run.conversation))
            return json(res, 404, { error: "Run not found" });
          await invoke("runs.cancel", { id: cancel[1] }, run.conversation);
          return json(res, 200, { cancelled: true });
        }
        return json(res, 404, { error: "Endpoint not available" });
      } catch (error) {
        if (!res.headersSent)
          json(res, 400, {
            error:
              "Request could not be completed. Check its fields and runtime connection.",
          });
        else res.end();
      }
    },
  );
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    createPairing({ role = "contributor", memberId = "owner" } = {}) {
      if (!deviceRoles.has(role)) throw new Error("Unknown device role");
      const member = configuredMembers.get(memberId) ||
          (configuredMembers.size ? null : { id: memberId, name: memberId, role: memberId === "owner" ? "owner" : "member" });
      if (!member) throw new Error("Unknown human member");
      const code = randomBytes(6).toString("hex").toUpperCase();
      pairing = { digest: hash(code), role, member, until: clock() + 120000 };
      return { code, expiresAt: pairing.until };
    },
    devices() {
      return [...sessions.values()].filter((s) => s.expiresAt > clock());
    },
    members() {
      return [...configuredMembers.values()].map(({ id, name, role }) => ({
        id,
        name,
        role,
      }));
    },
    addMember(member) {
      if (!membersPath) throw new Error("Durable member management is not configured");
      return addMember(member, "owner");
    },
    removeMember(id) {
      if (!membersPath) throw new Error("Durable member management is not configured");
      return removeMember(id, "owner");
    },
    revoke(id) {
      for (const [k, v] of sessions) if (v.id === id) {
        sessions.delete(k);
        recordAudit({ actor: v.memberId, action: "session.revoked", resource: id, at: clock() });
      }
    },
    audit() {
      return auditLog.map((entry) => ({ ...entry }));
    },
    close() {
      sessions.clear();
      pairing = null;
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
