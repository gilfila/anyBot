const transactionKey = "anybot.oidc.pkce.v1";

function cleanIssuer(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("OIDC issuer must be an HTTPS URL without credentials or query parameters.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomText(length = 64, cryptoObject = globalThis.crypto) {
  const bytes = new Uint8Array(length);
  cryptoObject.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challenge(verifier, cryptoObject = globalThis.crypto) {
  const digest = await cryptoObject.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

async function discover(issuer, fetchImpl) {
  const normalized = cleanIssuer(issuer);
  const response = await fetchImpl(`${normalized}/.well-known/openid-configuration`, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) throw new Error("OIDC provider discovery failed.");
  const metadata = await response.json();
  if (cleanIssuer(metadata.issuer) !== normalized)
    throw new Error("OIDC discovery issuer does not match the configured issuer.");
  for (const field of ["authorization_endpoint", "token_endpoint"]) {
    const endpoint = new URL(metadata[field]);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash)
      throw new Error(`OIDC ${field} must use HTTPS.`);
  }
  if (!Array.isArray(metadata.response_types_supported) || !metadata.response_types_supported.includes("code"))
    throw new Error("OIDC provider does not support authorization code flow.");
  if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes("S256"))
    throw new Error("OIDC provider does not support PKCE S256.");
  return metadata;
}

export async function beginOidc({
  workspaceAddress,
  issuer,
  clientId,
  redirectUri,
  scopes = ["openid", "profile"],
  fetchImpl = globalThis.fetch,
  storage = globalThis.sessionStorage,
  cryptoObject = globalThis.crypto,
}) {
  if (typeof clientId !== "string" || !/^[A-Za-z0-9._~-]{1,200}$/.test(clientId))
    throw new Error("OIDC client ID is invalid.");
  const redirect = new URL(redirectUri);
  if (!workspaceAddress) throw new Error("Workspace address is required before OIDC sign-in.");
  if (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && redirect.hostname === "127.0.0.1"))
    throw new Error("OIDC redirect must use HTTPS.");
  const metadata = await discover(issuer, fetchImpl);
  const verifier = randomText(64, cryptoObject);
  const state = randomText(32, cryptoObject);
  storage.setItem(transactionKey, JSON.stringify({
    issuer: cleanIssuer(issuer), clientId, workspaceAddress, redirectUri: redirect.href, verifier, state,
    tokenEndpoint: metadata.token_endpoint,
  }));
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect.href);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await challenge(verifier, cryptoObject));
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

export async function consumeOidcCallback({
  locationObject = globalThis.location,
  historyObject = globalThis.history,
  fetchImpl = globalThis.fetch,
  storage = globalThis.sessionStorage,
}) {
  const params = new URL(locationObject.href).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const providerError = params.get("error");
  if (!code && !providerError) return null;
  const transaction = JSON.parse(storage.getItem(transactionKey) || "null");
  storage.removeItem(transactionKey);
  if (providerError) throw new Error(params.get("error_description") || `OIDC sign-in failed: ${providerError}`);
  if (!transaction || state !== transaction.state) throw new Error("OIDC state validation failed.");
  const response = await fetchImpl(transaction.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: transaction.clientId,
      redirect_uri: transaction.redirectUri,
      code_verifier: transaction.verifier,
    }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.access_token !== "string" || payload.token_type?.toLowerCase() !== "bearer")
    throw new Error(payload.error_description || "OIDC provider did not return a bearer access token.");
  historyObject.replaceState({}, "", `${locationObject.pathname}${locationObject.hash || ""}`);
  return { token: payload.access_token, workspaceAddress: transaction.workspaceAddress };
}
