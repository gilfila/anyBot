import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSign, generateKeyPairSync } from "node:crypto";
import { Coordinator } from "../runtime/coordinator.mjs";
import { createMobileGateway } from "../runtime/mobile-gateway.mjs";
import { createJwtVerifier } from "../runtime/identity.mjs";

async function fixture(t, members = [], statePath = null, auditPath = null, membersPath = null) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-mobile-"));
  const c = new Coordinator({
    directory,
    probe: async () => [],
    runner: async () => "Test response",
  });
  await c.initialize();
  await c.command("runtime.pause");
  await c.command("employees.create", {
    name: "Test employee",
    role: "Tester",
    instructions: "Private instructions",
    harness: "codex",
    trusted: true,
  });
  let time = Date.now();
  const gateway = createMobileGateway({
    command: (...args) => c.command(...args),
    allowInsecureLoopback: true,
    origins: ["https://localhost"],
    members,
    membersPath,
    statePath,
    auditPath,
    clock: () => time,
  });
  const address = await gateway.listen(),
    origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await gateway.close();
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, options = {}) => fetch(origin + "/v1" + path, options);
  const post = (path, payload, token) =>
    request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  const pair = async ({ role = "operator", memberId = "owner" } = {}) => {
    const response = await post("/pair", {
      code: gateway.createPairing({ role, memberId }).code,
      name: "Test phone",
    });
    assert.equal(response.status, 201);
    return response.json();
  };
  return {
    c,
    gateway,
    request,
    post,
    pair,
    advance: (n) => {
      time += n;
    },
  };
}
test("mobile gateway requires TLS outside explicit loopback development mode", () => {
  assert.throws(() => createMobileGateway({ command: () => {} }), /TLS/);
  assert.throws(
    () =>
      createMobileGateway({
        command: () => {},
        host: "0.0.0.0",
        allowInsecureLoopback: true,
      }),
    /TLS/,
  );
});
test("configured human members are exposed as safe pairing choices", async (t) => {
  const f = await fixture(t, [
    { id: "owner", name: "Workspace owner", role: "owner" },
    { id: "alice", name: "Alice", role: "member" },
  ]);
  assert.deepEqual(f.gateway.members(), [
    { id: "owner", name: "Workspace owner", role: "owner" },
    { id: "alice", name: "Alice", role: "member" },
  ]);
  const pairing = f.gateway.createPairing({ role: "viewer", memberId: "alice" });
  assert.ok(pairing.code);
  assert.equal(pairing.expiresAt > Date.now(), true);
});

test("external RS256 identity maps only configured humans and cannot self-elevate", async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const makeToken = (claims = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: "https://id.example.test",
      aud: "anybot",
      sub: "alice",
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })).toString("base64url");
    const input = `${header}.${payload}`;
    const sign = createSign("RSA-SHA256");
    sign.update(input);
    sign.end();
    return `${input}.${sign.sign(privateKey).toString("base64url")}`;
  };
  const directory = await mkdtemp(join(tmpdir(), "anybot-oidc-"));
  const c = new Coordinator({ directory, probe: async () => [], runner: async () => "Test response" });
  await c.initialize();
  const gateway = createMobileGateway({
    command: (...args) => c.command(...args),
    allowInsecureLoopback: true,
    members: [{ id: "alice", name: "Alice", role: "member" }],
    identity: createJwtVerifier({
      issuer: "https://id.example.test",
      audience: "anybot",
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      deviceRole: "viewer",
    }),
  });
  const address = await gateway.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await gateway.close();
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  const valid = await fetch(`${origin}/v1/overview`, {
    headers: { Authorization: `Bearer ${makeToken()}` },
  });
  assert.equal(valid.status, 200);
  const body = await valid.json();
  assert.equal(body.memberId, "alice");
  assert.equal(body.deviceRole, "viewer");
  assert.equal(
    (await fetch(`${origin}/v1/overview`, {
      headers: { Authorization: `Bearer ${makeToken({ iss: "https://evil.example" })}` },
    })).status,
    401,
  );
});

test("owner member management persists and cannot remove the owner", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-members-"));
  const f = await fixture(
    t,
    [{ id: "owner", name: "Owner", role: "owner" }],
    null,
    null,
    join(directory, "members.json"),
  );
  const owner = await f.pair({ memberId: "owner" });
  const add = await f.post("/members", { id: "alice", name: "Alice", role: "member" }, owner.token);
  assert.equal(add.status, 201);
  assert.equal((await add.json()).members.at(-1).id, "alice");
  const alice = await f.pair({ memberId: "alice" });
  assert.equal((await f.request("/members", { headers: { Authorization: `Bearer ${owner.token}` } })).status, 200);
  assert.equal((await f.post("/members", { id: "owner", name: "Attacker", role: "member" }, owner.token)).status, 400);
  const removeOwner = await f.request("/members/owner", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(removeOwner.status, 400);
  const removeAlice = await f.request("/members/alice", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(removeAlice.status, 200);
  assert.equal(
    (await f.request("/overview", { headers: { Authorization: `Bearer ${alice.token}` } })).status,
    401,
  );
  assert.doesNotMatch(await readFile(join(directory, "members.json"), "utf8"), /alice/);
  await rm(directory, { recursive: true, force: true });
});
test("pairing is expiring, single-use, rate-limited and revocable", async (t) => {
  const f = await fixture(t),
    code = f.gateway.createPairing().code;
  assert.equal((await f.request("/overview")).status, 401);
  const session = await (await f.post("/pair", { code })).json();
  assert.equal((await f.post("/pair", { code })).status, 401);
  assert.equal(
    (
      await f.request("/overview", {
        headers: { Authorization: `Bearer ${session.token}` },
      })
    ).status,
    200,
  );
  f.gateway.revoke(session.id);
  assert.equal(
    (
      await f.request("/overview", {
        headers: { Authorization: `Bearer ${session.token}` },
      })
    ).status,
    401,
  );
  const expired = f.gateway.createPairing().code;
  f.advance(120001);
  assert.equal((await f.post("/pair", { code: expired })).status, 401);
  for (let i = 0; i < 5; i++) await f.post("/pair", { code: "BAD" });
  assert.equal((await f.post("/pair", { code: "BAD" })).status, 429);
});
test("mobile API projects safe fields, rejects untrusted origins and has no admin RPC", async (t) => {
  const f = await fixture(t),
    session = await f.pair(),
    headers = { Authorization: `Bearer ${session.token}` };
  const response = await f.request("/overview", { headers });
  const data = await response.json();
  assert.equal(data.employees.length, 1);
  assert.equal(data.employees[0].workspace, undefined);
  assert.equal(data.employees[0].instructions, undefined);
  assert.equal(data.runtime.directory, undefined);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await f.request("/overview", {
        headers: { ...headers, Origin: "https://attacker.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.post("/employees.create", {}, session.token)).status,
    404,
  );
  f.advance(24 * 60 * 60 * 1000 + 1);
  assert.equal((await f.request("/overview", { headers })).status, 401);
});
test("device roles limit remote write and cancellation capabilities", async (t) => {
  const f = await fixture(t),
    code = f.gateway.createPairing({ role: "viewer" }).code,
    session = await (await f.post("/pair", { code })).json();
  assert.equal(session.role, "viewer");
  assert.equal(
    (await f.post("/conversations", { title: "Denied", members: [] }, session.token))
      .status,
    403,
  );
  assert.throws(() => f.gateway.createPairing({ role: "owner" }), /Unknown device role/);
});
test("configured human members are isolated by conversation invitations", async (t) => {
  const f = await fixture(t, [
      { id: "owner", name: "Owner", role: "owner" },
      { id: "alice", name: "Alice", role: "member" },
      { id: "bob", name: "Bob", role: "member" },
    ]),
    owner = await f.pair({ memberId: "owner" }),
    alice = await f.pair({ memberId: "alice" }),
    bob = await f.pair({ memberId: "bob" });
  assert.equal(owner.memberId, "owner");
  assert.equal(alice.memberId, "alice");
  const conversation = await (
    await f.post(
      "/conversations",
      { title: "Private team", members: [f.c.snapshot().employees[0].id] },
      owner.token,
    )
  ).json();
  const aliceBefore = await f.request("/overview", {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal((await aliceBefore.json()).conversations.length, 0);
  assert.equal(
    (
      await f.post(
        `/conversations/${conversation.id}/humans`,
        { members: ["alice"] },
        owner.token,
      )
    ).status,
    200,
  );
  const aliceAfter = await f.request("/overview", {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal((await aliceAfter.json()).conversations.length, 1);
  assert.equal(
    (
      await f.request(`/conversations/${conversation.id}`, {
        headers: { Authorization: `Bearer ${bob.token}` },
      })
    ).status,
    404,
  );
  assert.ok(f.gateway.audit().some((entry) => entry.actor === "alice"));
});
test("conversation membership survives gateway restart without persisting sessions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-mobile-state-")),
    statePath = join(directory, "membership.json"),
    members = [
      { id: "owner", name: "Owner", role: "owner" },
      { id: "alice", name: "Alice", role: "member" },
      { id: "bob", name: "Bob", role: "member" },
    ],
    auditPath = join(directory, "audit.jsonl"),
    f = await fixture(t, members, statePath, auditPath),
    owner = await f.pair({ memberId: "owner" });
  const conversation = await (
    await f.post(
      "/conversations",
      { title: "Durable ACL", members: [f.c.snapshot().employees[0].id], humanMembers: ["alice"] },
      owner.token,
    )
  ).json();
  await f.gateway.close();
  const restarted = createMobileGateway({
    command: (...args) => f.c.command(...args),
    allowInsecureLoopback: true,
    origins: ["https://localhost"],
    members,
    statePath,
    auditPath,
  });
  const address = await restarted.listen(),
    origin = `http://127.0.0.1:${address.port}`,
    code = restarted.createPairing({ role: "operator", memberId: "alice" }).code,
    paired = await (await fetch(`${origin}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "Alice after restart" }),
    })).json(),
    response = await fetch(`${origin}/v1/conversations/${conversation.id}`, {
      headers: { Authorization: `Bearer ${paired.token}` },
    });
  assert.equal(response.status, 200);
  const saved = await readFile(statePath, "utf8");
  assert.deepEqual(JSON.parse(saved)[conversation.id], ["owner", "alice"]);
  assert.ok(!saved.includes(owner.token));
  assert.ok(!saved.includes(paired.token));
  const audit = await readFile(auditPath, "utf8");
  assert.ok(audit.includes('"session.paired"'));
  assert.ok(!audit.includes(owner.token));
  const bobCode = restarted.createPairing({ role: "operator", memberId: "bob" }).code;
  const bob = await (await fetch(`${origin}/v1/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: bobCode }),
  })).json();
  assert.equal((await fetch(`${origin}/v1/conversations/${conversation.id}`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  })).status, 404);
  assert.equal((await fetch(`${origin}/v1/overview`, { headers: { Authorization: `Bearer ${owner.token}` } })).status, 401);
  assert.ok(restarted.audit().some((entry) => entry.action === "session.paired"));
  await restarted.close();
  t.after(() => rm(directory, { recursive: true, force: true }));
});
test("malformed saved grants fail closed instead of falling back to owner access", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-acl-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "membership.json");
  for (const saved of ["[]", "null", '{"private":"owner"}', '{"private":[null]}']) {
    await writeFile(statePath, saved);
    assert.throws(() => createMobileGateway({
      command: () => {}, allowInsecureLoopback: true, statePath,
    }), /invalid or unreadable/);
  }
});
test("human viewers cannot acquire writes through an operator device and operators cannot read ungranted conversations", async (t) => {
  const f = await fixture(t, [
    { id: "owner", role: "owner" }, { id: "reader", role: "viewer" },
  ]);
  await f.c.command("conversations.create", {
    title: "Desktop private", members: [f.c.snapshot().employees[0].id],
  });
  const reader = await f.pair({ memberId: "reader", role: "operator" });
  assert.equal((await f.post("/conversations", {
    title: "Forbidden", members: [f.c.snapshot().employees[0].id],
  }, reader.token)).status, 403);
  const overview = await (await f.request("/overview", {
    headers: { Authorization: `Bearer ${reader.token}` },
  })).json();
  assert.deepEqual(overview.conversations, []);
});
test("audit endpoint is owner/operator-only and cursor-paginates without tokens", async (t) => {
  const f = await fixture(t, [
      { id: "owner", role: "owner" }, { id: "reader", role: "member" },
    ]),
    owner = await f.pair({ memberId: "owner", role: "operator" }),
    reader = await f.pair({ memberId: "reader", role: "viewer" });
  const denied = await f.request("/audit", {
    headers: { Authorization: `Bearer ${reader.token}` },
  });
  assert.equal(denied.status, 403);
  const response = await f.request("/audit?limit=1", {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].action, "session.paired");
  assert.equal(JSON.stringify(page).includes(owner.token), false);
  assert.equal(JSON.stringify(page).includes(reader.token), false);
});
test("mobile messages are admitted once across retries and cancellation reaches coordinator", async (t) => {
  const f = await fixture(t),
    session = await f.pair();
  const conversation = await (
    await f.post(
      "/conversations",
      {
        title: "Phone conversation",
        members: [f.c.snapshot().employees[0].id],
      },
      session.token,
    )
  ).json();
  const message = {
    body: "A message 🐝",
    recipients: conversation.members,
    requestId: crypto.randomUUID(),
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await f.post(
          `/conversations/${conversation.id}/messages`,
          message,
          session.token,
        )
      ).status,
      202,
    );
  assert.equal(f.c.snapshot().runs.length, 1);
  assert.equal(
    (
      await f.post(
        `/runs/${f.c.snapshot().runs[0].id}/cancel`,
        {},
        session.token,
      )
    ).status,
    200,
  );
  assert.equal(f.c.snapshot().runs[0].status, "cancelled");
  assert.equal(
    (await f.post("/conversations/outsider/messages", message, session.token))
      .status,
    404,
  );
});

test("the phone doesn't list archived (deleted) projects", async (t) => {
  const f = await fixture(t);
  await f.c.command("employees.create", { name: "Second", role: "Helper", harness: "codex", trusted: true });
  const members = f.c.snapshot().employees.map((e) => e.id);
  await f.c.command("conversations.create", { title: "Launch", members });
  const project = f.c.snapshot().conversations.at(-1);
  const { token } = await f.pair();
  const overview = async () =>
    (await (await f.request("/overview", { headers: { Authorization: `Bearer ${token}` } })).json()).conversations.map((c) => c.id);
  assert.ok((await overview()).includes(project.id));
  await f.c.command("conversations.setArchived", { conversation: project.id, archived: true });
  assert.ok(!(await overview()).includes(project.id));
  const direct = await f.request(`/conversations/${project.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.notEqual(direct.status, 200);
});
