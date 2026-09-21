import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beginOidc, consumeOidcCallback } from "../mobile/oidc.mjs";

test("mobile web client ships an installable offline shell", async () => {
  const html = await readFile(new URL("../mobile/index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../mobile/public/manifest.webmanifest", import.meta.url), "utf8"));
  const serviceWorker = await readFile(new URL("../mobile/public/sw.js", import.meta.url), "utf8");
  assert.match(html, /rel="manifest"/);
  assert.match(html, /serviceWorker\.register/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.match(serviceWorker, /cache\.addAll\(SHELL\)/);
  assert.match(serviceWorker, /self\.clients\.claim/);
  assert.match(serviceWorker, /pathname\.includes\("\/v1\/"\)/);
  assert.match(serviceWorker, /headers\.has\("authorization"\)/);
});

test("mobile OIDC uses issuer discovery, PKCE state, and memory-only bearer output", async () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key) || null, removeItem: (key) => values.delete(key) };
  const metadata = {
    issuer: "https://login.example.test/realms/team",
    authorization_endpoint: "https://login.example.test/authorize",
    token_endpoint: "https://login.example.test/token",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
  };
  const discovery = async (url) => ({ ok: true, json: async () => metadata });
  const authorization = await beginOidc({
    workspaceAddress: "https://agents.example.test",
    issuer: metadata.issuer,
    clientId: "anybot-mobile",
    redirectUri: "https://phone.example.test/",
    fetchImpl: discovery,
    storage,
  });
  const transaction = JSON.parse(values.values().next().value);
  assert.match(authorization, /code_challenge_method=S256/);
  assert.equal(transaction.workspaceAddress, "https://agents.example.test");
  const callbackUrl = `https://phone.example.test/?code=abc&state=${encodeURIComponent(transaction.state)}`;
  const result = await consumeOidcCallback({
    locationObject: { href: callbackUrl, pathname: "/", hash: "" },
    historyObject: { replaceState() {} },
    storage,
    fetchImpl: async (url, options) => ({
      ok: true,
      json: async () => ({ access_token: "short-lived-token", token_type: "Bearer" }),
    }),
  });
  assert.deepEqual(result, { token: "short-lived-token", workspaceAddress: "https://agents.example.test" });
  assert.equal(values.size, 0);
});
