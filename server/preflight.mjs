import { access, constants, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeServerConfig } from "./index.mjs";
import { createJwtVerifier } from "../runtime/identity.mjs";

export async function preflight(config, { hosted = false } = {}) {
  const normalized = normalizeServerConfig(config);
  if (hosted) {
    const publicHost = new URL(normalized.publicUrl).hostname;
    if (!normalized.tls) throw new Error("Hosted preflight requires TLS certificate and key");
    if (normalized.allowInsecureLoopback) throw new Error("Hosted preflight cannot allow insecure loopback mode");
    if (["127.0.0.1", "::1", "localhost"].includes(publicHost))
      throw new Error("Hosted preflight requires a non-loopback publicUrl");
    if (!normalized.identity) throw new Error("Hosted preflight requires external identity verification");
    if (!normalized.members.some((member) => member?.role === "owner"))
      throw new Error("Hosted preflight requires an owner member");
    for (const origin of normalized.origins) {
      if (origin === "*") throw new Error("Hosted preflight rejects wildcard CORS origins");
      if (origin === "capacitor://localhost" || origin === "https://localhost") continue;
      let parsed;
      try { parsed = new URL(origin); } catch { throw new Error("Hosted preflight requires valid CORS origins"); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
        throw new Error("Hosted preflight requires HTTPS browser origins");
    }
  }
  await mkdir(normalized.dataDir, { recursive: true });
  await access(normalized.dataDir, constants.R_OK | constants.W_OK);
  if (normalized.identity) {
    const keyPath = normalized.identity.jwksPath || normalized.identity.publicKeyPath;
    const keyText = await readFile(path.resolve(keyPath), "utf8");
    if (normalized.identity.jwksPath) {
      const jwks = JSON.parse(keyText);
      const keys = Object.fromEntries(jwks.keys.map((key) => [key.kid, key]));
      // Exercise the same key-shape checks used at server startup without
      // accepting a token or making an external network request.
      if (!Object.keys(keys).length) throw new Error("Identity JWKS is empty");
    } else if (!keyText.includes("BEGIN PUBLIC KEY")) {
      throw new Error("Identity public key is not PEM encoded");
    }
    if (normalized.identity.publicKey) createJwtVerifier(normalized.identity);
  }
  const result = {
    status: "ready",
    host: normalized.host,
    port: normalized.port,
    dataDir: normalized.dataDir,
    tls: Boolean(normalized.tls),
    members: normalized.members.length,
    identity: Boolean(normalized.identity),
  };
  if (hosted) {
    result.warnings = [
      "Harness workers share the server account; isolate each trust boundary before admitting mutually untrusted users.",
      "Identity tokens are verified here, but provider-side revocation and organization tenancy remain deployment responsibilities.",
    ];
  }
  return result;
}

const configPath = process.argv.indexOf("--config");
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (configPath < 0) throw new Error("Usage: node server/preflight.mjs --config <file>");
  const config = JSON.parse(await readFile(path.resolve(process.argv[configPath + 1]), "utf8"));
  console.log(JSON.stringify(await preflight(config, { hosted: process.argv.includes("--hosted") }), null, 2));
}
