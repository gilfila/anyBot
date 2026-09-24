import http from "node:http";
import https from "node:https";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest();
const pick = (value, keys) =>
  Object.fromEntries(keys.map((key) => [key, value[key]]));
const employeeKeys = ["id", "name", "role", "harness", "archived"];
const runKeys = [
  "id",
  "conversation",
  "employee",
  "status",
  "output",
  "error",
  "created",
  "started",
  "ended",
];
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
  clock = Date.now,
  // false: no HTTPS listener; only phones paired by QR code reach handle().
  serve = true,
}) {
  if (serve && !tls && !(allowInsecureLoopback && host === "127.0.0.1"))
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
  // Every request goes through here, whether it came over HTTPS with a
  // bearer token or from a phone paired by QR code (runtime/phone-link.mjs),
  // which arrives already authenticated as `linked`. Returns { status, value }.
  const reply = (status, value) => ({ status, value });
  async function handle({ method, url, remote = "unknown", headers = {}, readBody, linked = null }) {
    if (method === "GET" && url.pathname === "/healthz")
      return reply(200, { status: "ok" });
    if (method === "POST" && url.pathname === "/v1/pair") {
      if (linked) return reply(404, { error: "Endpoint not available" });
      const key = remote || "unknown",
        previous = attempts.get(key);
      const counter =
        previous && previous.until > clock()
          ? previous
          : { count: 0, until: clock() + 60000 };
      if (attempts.size > 1000)
        for (const [k, v] of attempts)
          if (v.until < clock()) attempts.delete(k);
      if (attempts.size > 1000 && !attempts.has(key))
        return reply(429, { error: "Try again later" });
      attempts.set(key, counter);
      if (++counter.count > 5)
        return reply(429, {
          error: "Too many pairing attempts; wait a minute",
        });
      const input = await readBody();
      if (
        typeof input.code !== "string" ||
        !pairing ||
        pairing.until < clock() ||
        !timingSafeEqual(
          hash(input.code.trim().toUpperCase()),
          pairing.digest,
        )
      )
        return reply(401, { error: "Pairing code invalid or expired" });
      const pairedRole = pairing.role,
        pairedMember = pairing.member;
      pairing = null;
      for (const [k, v] of sessions)
        if (v.expiresAt <= clock()) sessions.delete(k);
      if (sessions.size >= 16)
        return reply(409, {
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
      return reply(201, { token, ...session });
    }
    const token = linked ? "" : (headers.authorization || "").replace(/^Bearer /, "");
    const key = linked ? null : hash(token).toString("hex");
    let session = linked || sessions.get(key);
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
    // Revoked, expired, or (for a linked phone) removed on the desktop.
    const live = () =>
      linked ? linked.active() : (session.external || sessions.get(key) === session) && session.expiresAt > clock();
    if (!session || !live()) {
      if (!linked && !session?.external) sessions.delete(key);
      return reply(401, { error: "Connect this device again" });
    }
    if (method === "DELETE" && url.pathname === "/v1/session") {
      if (linked) linked.disconnect();
      else sessions.delete(key);
      return reply(200, { disconnected: true });
    }
    const invoke = async (method, payload, resource = null) => {
      if (!live()) throw new Error("Session revoked");
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
      method === "POST" &&
      (url.pathname === "/v1/conversations" ||
        url.pathname.endsWith("/messages")) &&
      !can("write")
    )
      return reply(403, { error: "Device role cannot send work" });
    if (method === "POST" && url.pathname.endsWith("/cancel") && !can("cancel"))
      return reply(403, { error: "Device role cannot cancel work" });
    const allowed = (conversation) => {
      const access = conversationAccess.get(conversation.id);
      if (access) return access.has(session.memberId);
      return session.humanRole === "owner";
    };
    const state = await invoke("snapshot");
    if (!live()) return reply(401, { error: "Session revoked" });
    const visibleConversations = state.conversations.filter((c) => allowed(c) && !c.archived),
      visibleIds = new Set(visibleConversations.map((conversation) => conversation.id));
    if (method === "GET" && url.pathname === "/v1/audit") {
      if (session.humanRole !== "owner" && session.role !== "operator")
        return reply(403, { error: "Audit access requires owner or operator access" });
      const requestedLimit = Number(url.searchParams.get("limit") || 100),
        limit = Number.isInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100,
        before = Number(url.searchParams.get("before") || auditLog.length),
        end = Math.min(auditLog.length, Math.max(0, before));
      if (!Number.isInteger(before) || before < 0)
        return reply(400, { error: "Invalid audit cursor" });
      const start = Math.max(0, end - limit);
      return reply(200, {
        entries: auditLog.slice(start, end),
        olderCursor: start ? start : null,
      });
    }
    if (url.pathname === "/v1/members") {
      if (session.humanRole !== "owner" || !can("write"))
        return reply(403, { error: "Only an owner can manage human members" });
      if (method === "GET")
        return reply(200, { members: [...configuredMembers.values()] });
      if (!membersPath)
        return reply(409, { error: "Durable member management is not configured" });
      if (method === "POST") {
        const input = await readBody();
        try {
          return reply(201, { members: addMember(input, session.memberId) });
        } catch (error) {
          return reply(400, { error: error.message });
        }
      }
    }
    const memberDelete = url.pathname.match(/^\/v1\/members\/([^/]+)$/);
    if (method === "DELETE" && memberDelete) {
      if (session.humanRole !== "owner" || !can("write"))
        return reply(403, { error: "Only an owner can manage human members" });
      if (!membersPath)
        return reply(409, { error: "Durable member management is not configured" });
      try {
        return reply(200, { members: removeMember(memberDelete[1], session.memberId) });
      } catch (error) {
        return reply(error.message === "Human member not found" ? 404 : 400, { error: error.message });
      }
    }
    if (method === "GET" && url.pathname === "/v1/overview")
      return reply(200, {
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
    if (method === "POST" && url.pathname === "/v1/conversations") {
      const input = await readBody();
      const humanMembers = Array.isArray(input.humanMembers) ? input.humanMembers : [];
      if (humanMembers.some((id) => typeof id !== "string" || (configuredMembers.size && !configuredMembers.has(id))))
        return reply(400, { error: "Unknown human member" });
      const next = await invoke(
        "conversations.create",
        pick(input, ["title", "members", "delegation"]),
      );
      const created = next.conversations.at(-1);
      setAccess(created.id, [session.memberId, ...humanMembers]);
      return reply(201, created);
    }
    const match = url.pathname.match(
      /^\/v1\/conversations\/([\w-]+)(?:\/(messages))?$/,
    );
    if (match) {
      const conversation = visibleConversations.find(
        (c) => c.id === match[1],
      );
      if (!conversation)
        return reply(404, { error: "Conversation not found" });
      if (method === "GET" && !match[2]) {
        const all = state.messages.filter(
          (m) => m.conversation === conversation.id,
        );
        const before = url.searchParams.get("before");
        const end = before
          ? all.findIndex((m) => m.id === before)
          : all.length;
        if (end < 0) return reply(400, { error: "Invalid cursor" });
        const start = Math.max(0, end - 100),
          messages = all.slice(start, end);
        return reply(200, {
          conversation,
          messages,
          olderCursor: start ? messages[0].id : null,
          runs: state.runs
            .filter((r) => r.conversation === conversation.id)
            .slice(-30)
            .map((r) => pick(r, runKeys)),
        });
      }
      if (method === "POST" && match[2] === "messages") {
        const input = await readBody();
        await invoke("messages.send", {
          ...pick(input, ["body", "recipients", "requestId"]),
          conversation: conversation.id,
        }, conversation.id);
        return reply(202, {
          accepted: true,
          requestId: input.requestId,
        });
      }
    }
    const humans = url.pathname.match(/^\/v1\/conversations\/([\w-]+)\/humans$/);
    if (method === "POST" && humans) {
      const conversation = state.conversations.find((c) => c.id === humans[1]);
      if (!conversation || !allowed(conversation))
        return reply(404, { error: "Conversation not found" });
      if (!can("write") || (session.humanRole !== "owner" && session.role !== "operator"))
        return reply(403, { error: "Only an owner or operator can invite people" });
      const input = await readBody(), invited = Array.isArray(input.members) ? input.members : [];
      if (!invited.length || invited.some((id) => typeof id !== "string" || (configuredMembers.size && !configuredMembers.has(id))))
        return reply(400, { error: "Unknown human member" });
      const access = new Set(conversationAccess.get(conversation.id) || [session.memberId]);
      invited.forEach((id) => access.add(id));
      setAccess(conversation.id, access);
      recordAudit({ actor: session.memberId, action: "humans.invite", resource: conversation.id, at: clock() });
      return reply(200, { members: [...access] });
    }
    const cancel = url.pathname.match(/^\/v1\/runs\/([\w-]+)\/cancel$/);
    if (method === "POST" && cancel) {
      const run = state.runs.find((r) => r.id === cancel[1]);
      if (!run || !visibleIds.has(run.conversation))
        return reply(404, { error: "Run not found" });
      await invoke("runs.cancel", { id: cancel[1] }, run.conversation);
      return reply(200, { cancelled: true });
    }
    return reply(404, { error: "Endpoint not available" });
  }
  const server = serve
    ? (tls ? https : http).createServer(tls || {}, async (req, res) => {
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
            res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
            return json(res, 204, null);
          }
          const out = await handle({
            method: req.method,
            url: new URL(req.url, "https://gateway.invalid"),
            remote: req.socket.remoteAddress || "unknown",
            headers: req.headers,
            readBody: () => body(req),
          });
          return json(res, out.status, out.value);
        } catch {
          if (!res.headersSent)
            json(res, 400, {
              error: "Request could not be completed. Check its fields and runtime connection.",
            });
          else res.end();
        }
      })
    : null;
  if (server) {
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
  }
  const memberFor = (memberId) =>
    configuredMembers.get(memberId) ||
    (configuredMembers.size ? null : { id: memberId, name: memberId, role: memberId === "owner" ? "owner" : "member" });
  return {
    server,
    handle,
    // A session for a phone paired by QR code. It never expires on its own;
    // `active()` turns false when the owner removes the phone.
    linkedSession({ id, name, role = "operator", memberId = "owner", active, disconnect }) {
      if (!deviceRoles.has(role)) throw new Error("Unknown device role");
      const member = memberFor(memberId);
      if (!member) throw new Error("Unknown human member");
      return {
        id,
        name: String(name || "Phone").slice(0, 60),
        role,
        memberId: member.id,
        memberName: member.name,
        humanRole: member.role,
        expiresAt: Infinity,
        linked: true,
        active,
        disconnect,
      };
    },
    async listen() {
      if (!server) throw new Error("This gateway has no HTTPS listener");
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    createPairing({ role = "contributor", memberId = "owner" } = {}) {
      if (!deviceRoles.has(role)) throw new Error("Unknown device role");
      const member = memberFor(memberId);
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
      if (!server) return Promise.resolve();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
