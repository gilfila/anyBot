import fs from "node:fs";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey } from "node:crypto";
import { Coordinator } from "../runtime/coordinator.mjs";
import { createMobileGateway } from "../runtime/mobile-gateway.mjs";
import { createJwtVerifier } from "../runtime/identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const text = (value, name, max = 2000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} must be a non-empty string`);
  return value.trim();
};

function createJwksLoader(jwksPath, initialKeys) {
  let stamp = "initial";
  let keys = initialKeys;
  return () => {
    const stat = fs.statSync(jwksPath);
    const nextStamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
    if (nextStamp === stamp) return keys;
    const jwks = JSON.parse(readFileSync(jwksPath, "utf8"));
    if (!jwks || !Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length > 32)
      throw new Error("Identity JWKS must contain 1–32 keys");
    const next = {};
    for (const key of jwks.keys) {
      if (!key || key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" ||
          typeof key.kid !== "string" || !key.kid || key.kid.length > 120)
        throw new Error("Identity JWKS contains an unsupported key");
      if (next[key.kid]) throw new Error("Identity JWKS contains duplicate key IDs");
      next[key.kid] = createPublicKey({ key, format: "jwk" }).export({ type: "spki", format: "pem" });
    }
    keys = next;
    stamp = nextStamp;
    return keys;
  };
}

export function normalizeServerConfig(input = {}) {
  const host = input.host || "127.0.0.1",
    port = Number(input.port || 4319),
    dataDir = path.resolve(input.dataDir || path.join(here, "../.anybot-server")),
    allowInsecureLoopback = input.allowInsecureLoopback === true;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Server port must be between 0 and 65535");
  if (!path.isAbsolute(dataDir)) throw new Error("Server dataDir must be absolute");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost" && !input.tls)
    throw new Error("A non-loopback server requires TLS certificate and key paths");
  let tls;
  if (input.tls) {
    const certPath = path.resolve(text(input.tls.certPath, "TLS certPath"));
    const keyPath = path.resolve(text(input.tls.keyPath, "TLS keyPath"));
    if (!fs.statSync(certPath).isFile() || !fs.statSync(keyPath).isFile())
      throw new Error("TLS certificate and key must be readable files");
    tls = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  } else if (!(allowInsecureLoopback && (host === "127.0.0.1" || host === "::1" || host === "localhost"))) {
    throw new Error("Server access requires TLS, or explicit loopback development mode");
  }
  const publicUrl = text(input.publicUrl || `${tls ? "https" : "http"}://${host}:${port}`, "publicUrl", 3000);
  const url = new URL(publicUrl);
  if (tls && url.protocol !== "https:") throw new Error("TLS server publicUrl must use HTTPS");
  if (!tls && !["http:", "https:"].includes(url.protocol))
    throw new Error("Server publicUrl must use HTTP or HTTPS");
  const concurrency = Number(input.concurrency || 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("Server concurrency must be between 1 and 8");
  const members = Array.isArray(input.members) ? input.members : [];
  let identity = null;
  if (input.identity !== undefined) {
    if (!input.identity || typeof input.identity !== "object")
      throw new Error("identity must be an object");
    let publicKey, publicKeys;
    if (input.identity.jwksPath) {
      const jwksPath = path.resolve(text(input.identity.jwksPath, "identity jwksPath"));
      if (!fs.statSync(jwksPath).isFile()) throw new Error("Identity JWKS must be a readable file");
      const jwks = JSON.parse(readFileSync(jwksPath, "utf8"));
      if (!jwks || !Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length > 32)
        throw new Error("Identity JWKS must contain 1–32 keys");
      publicKeys = Object.fromEntries(jwks.keys.map((key) => {
        if (!key || key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" ||
            typeof key.kid !== "string" || !key.kid || key.kid.length > 120)
          throw new Error("Identity JWKS contains an unsupported key");
        return [key.kid, createPublicKey({ key, format: "jwk" }).export({ type: "spki", format: "pem" })];
      }));
    } else {
      const publicKeyPath = path.resolve(text(input.identity.publicKeyPath, "identity publicKeyPath"));
      if (!fs.statSync(publicKeyPath).isFile()) throw new Error("Identity public key must be a readable file");
      publicKey = readFileSync(publicKeyPath, "utf8");
    }
    identity = {
      issuer: text(input.identity.issuer, "identity issuer", 1000),
      audience: text(input.identity.audience, "identity audience", 300),
      ...(input.identity.jwksPath ? { jwksPath: path.resolve(text(input.identity.jwksPath, "identity jwksPath")) } :
        { publicKeyPath: path.resolve(text(input.identity.publicKeyPath, "identity publicKeyPath")) }),
      ...(publicKeys ? { publicKeys } : { publicKey }),
      memberClaim: input.identity.memberClaim || "sub",
      deviceRole: input.identity.deviceRole || "contributor",
    };
  }
  return {
    host,
    port,
    dataDir,
    tls,
    publicUrl: url.origin,
    allowInsecureLoopback,
    concurrency,
    origins: ["capacitor://localhost", "https://localhost", ...(Array.isArray(input.origins) ? input.origins : [])],
    members,
    membersPath: path.join(dataDir, "members.json"),
    identity,
    statePath: path.join(dataDir, "mobile-membership.json"),
    auditPath: path.join(dataDir, "mobile-audit.jsonl"),
  };
}

export async function startServer({ config, probe } = {}) {
  const normalized = normalizeServerConfig(config);
  mkdirSync(normalized.dataDir, { recursive: true });
  const coordinator = new Coordinator({
    directory: normalized.dataDir,
    concurrency: normalized.concurrency,
    ...(probe ? { probe } : {}),
  });
  await coordinator.initialize();
  const gateway = createMobileGateway({
    command: (method, payload) => coordinator.command(method, payload),
    host: normalized.host,
    port: normalized.port,
    tls: normalized.tls,
    allowInsecureLoopback: normalized.allowInsecureLoopback,
    origins: normalized.origins,
    members: normalized.members,
    membersPath: normalized.membersPath,
    identity: normalized.identity
      ? createJwtVerifier({
          ...normalized.identity,
          ...(normalized.identity.jwksPath
            ? { publicKeysLoader: createJwksLoader(normalized.identity.jwksPath, normalized.identity.publicKeys) }
            : {}),
        })
      : null,
    statePath: normalized.statePath,
    auditPath: normalized.auditPath,
  });
  const address = await gateway.listen();
  let closed = false;
  return {
    config: normalized,
    coordinator,
    gateway,
    address,
    async close() {
      if (closed) return;
      closed = true;
      await gateway.close();
      await coordinator.close();
    },
  };
}

function configPathFromArgs(argv) {
  const index = argv.indexOf("--config");
  return index >= 0 ? argv[index + 1] : process.env.ANYBOT_SERVER_CONFIG;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(here, "index.mjs")) {
  const configPath = configPathFromArgs(process.argv.slice(2));
  if (!configPath) throw new Error("Pass --config /absolute/path/server.json");
  const config = JSON.parse(readFileSync(path.resolve(configPath), "utf8"));
  const service = await startServer({ config });
  console.log(`anyBot server listening at ${service.config.publicUrl}`);
  const shutdown = async () => {
    await service.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
