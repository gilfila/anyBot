import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSign, generateKeyPairSync } from "node:crypto";
import { normalizeServerConfig, startServer } from "../server/index.mjs";
import { preflight } from "../server/preflight.mjs";

test("hosted image and service examples keep the coordinator unprivileged", async () => {
  const dockerfile = await readFile(new URL("../server/Dockerfile", import.meta.url), "utf8");
  const service = await readFile(new URL("../server/anybot.service.example", import.meta.url), "utf8");
  const compose = await readFile(new URL("../server/docker-compose.example.yml", import.meta.url), "utf8");
  assert.match(dockerfile, /USER anybot/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /PrivateDevices=true/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:/);
  assert.match(compose, /127\.0\.0\.1:4319:4319/);
  assert.match(compose, /mem_limit: 2g/);
  assert.match(compose, /pids_limit: 256/);
});

test("loopback workers may advertise an HTTPS reverse-proxy public URL", () => {
  const config = normalizeServerConfig({
    host: "127.0.0.1",
    port: 4319,
    publicUrl: "https://agents.example.com",
    dataDir: "C:\\anybot-data",
    allowInsecureLoopback: true,
  });
  assert.equal(config.publicUrl, "https://agents.example.com");
});

test("server preflight validates a writable local deployment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-preflight-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const freshDataDir = join(directory, "new", "server-data");
  assert.deepEqual(await preflight({
    host: "127.0.0.1",
    port: 4319,
    publicUrl: "http://127.0.0.1:4319",
    dataDir: freshDataDir,
    allowInsecureLoopback: true,
    members: [{ id: "owner", name: "Owner", role: "owner" }],
  }), {
    status: "ready",
    host: "127.0.0.1",
    port: 4319,
    dataDir: freshDataDir,
    tls: false,
    members: 1,
    identity: false,
  });
});

test("hosted preflight rejects a loopback or unauthenticated deployment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-hosted-preflight-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    preflight({
      host: "127.0.0.1",
      port: 4319,
      publicUrl: "http://127.0.0.1:4319",
      dataDir: directory,
      allowInsecureLoopback: true,
      members: [{ id: "owner", name: "Owner", role: "owner" }],
    }, { hosted: true }),
    /requires TLS/,
  );
});

test("hosted preflight accepts a TLS identity configuration", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-hosted-ready-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certPath = join(directory, "fullchain.pem");
  const keyPath = join(directory, "key.pem");
  const jwksPath = join(directory, "jwks.json");
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(certPath, "test certificate");
  await writeFile(keyPath, "test private key");
  await writeFile(jwksPath, JSON.stringify({
    keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }],
  }));
  const result = await preflight({
    host: "127.0.0.1",
    port: 4319,
    publicUrl: "https://agents.example.com",
    dataDir: join(directory, "data"),
    tls: { certPath, keyPath },
    members: [{ id: "owner", name: "Owner", role: "owner" }],
    identity: {
      issuer: "https://id.example.test",
      audience: "anybot",
      jwksPath,
    },
  }, { hosted: true });
  assert.equal(result.status, "ready");
  assert.equal(result.tls, true);
  assert.equal(result.identity, true);
  assert.match(result.warnings[0], /share the server account/);
  assert.match(result.warnings[1], /revocation/);
});

test("hosted preflight rejects wildcard or insecure browser origins", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-hosted-origin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certPath = join(directory, "cert.pem"), keyPath = join(directory, "key.pem"), jwksPath = join(directory, "jwks.json");
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(certPath, "test certificate");
  await writeFile(keyPath, "test private key");
  await writeFile(jwksPath, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] }));
  await assert.rejects(
    preflight({
      host: "127.0.0.1",
      port: 4319,
      publicUrl: "https://agents.example.com",
      dataDir: directory,
      tls: { certPath, keyPath },
      origins: ["*"],
      members: [{ id: "owner", name: "Owner", role: "owner" }],
      identity: { issuer: "https://id.example.test", audience: "anybot", jwksPath },
    }, { hosted: true }),
    /wildcard CORS origins/,
  );
});

test("headless server exposes the same scoped gateway on loopback", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-server-"));
  const service = await startServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      publicUrl: "http://127.0.0.1:4319",
      dataDir: directory,
      allowInsecureLoopback: true,
      members: [
        { id: "owner", name: "Owner", role: "owner" },
        { id: "alice", name: "Alice", role: "member" },
      ],
    },
    probe: async () => [],
  });
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${service.address.port}`;
  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const code = service.gateway.createPairing({ role: "operator", memberId: "owner" }).code;
  const pair = await fetch(`${origin}/v1/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: "Server test" }),
  });
  assert.equal(pair.status, 201);
  const session = await pair.json();
  const overview = await fetch(`${origin}/v1/overview`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  assert.equal(overview.status, 200);
  const payload = await overview.json();
  assert.deepEqual(payload.humanMembers.map((member) => member.id), ["owner", "alice"]);
});

test("headless server wires configured RS256 identity to the gateway", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-server-oidc-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPath = join(directory, "oidc-jwks.json");
  await writeFile(
    keyPath,
    JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] }),
  );
  const service = await startServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      publicUrl: "http://127.0.0.1:4319",
      dataDir: directory,
      allowInsecureLoopback: true,
      members: [{ id: "alice", name: "Alice", role: "member" }],
      identity: {
        issuer: "https://id.example.test",
        audience: "anybot",
        jwksPath: keyPath,
        deviceRole: "viewer",
      },
    },
    probe: async () => [],
  });
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://id.example.test",
    aud: "anybot",
    sub: "alice",
    exp: Math.floor(Date.now() / 1000) + 300,
  })).toString("base64url");
  const input = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(input);
  sign.end();
  const token = `${input}.${sign.sign(privateKey).toString("base64url")}`;
  const response = await fetch(`http://127.0.0.1:${service.address.port}/v1/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).memberId, "alice");

  // A running server reloads an atomically replaced JWKS on the next token.
  const { privateKey: nextPrivateKey, publicKey: nextPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(
    keyPath,
    JSON.stringify({ keys: [{ ...nextPublicKey.export({ format: "jwk" }), kid: "k2", alg: "RS256", use: "sig" }] }),
  );
  const nextHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k2" })).toString("base64url");
  const nextInput = `${nextHeader}.${payload}`;
  const nextSign = createSign("RSA-SHA256");
  nextSign.update(nextInput);
  nextSign.end();
  const nextToken = `${nextInput}.${nextSign.sign(nextPrivateKey).toString("base64url")}`;
  const rotated = await fetch(`http://127.0.0.1:${service.address.port}/v1/overview`, {
    headers: { Authorization: `Bearer ${nextToken}` },
  });
  assert.equal(rotated.status, 200);
  const retired = await fetch(`http://127.0.0.1:${service.address.port}/v1/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(retired.status, 401);
});
