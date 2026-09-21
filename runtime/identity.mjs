import { createPublicKey, createVerify } from "node:crypto";

const decode = (value) => {
  const text = Buffer.from(value, "base64url").toString("utf8");
  return JSON.parse(text);
};

/**
 * Verify a short-lived RS256 JWT issued by an external OIDC provider.
 * Discovery and browser login stay with the identity provider; the gateway
 * only accepts already-issued access tokens and maps their subject to a
 * configured anyBot human member.
 */
export function createJwtVerifier({
  issuer,
  audience,
  publicKey,
  publicKeys = null,
  publicKeysLoader = null,
  memberClaim = "sub",
  deviceRole = "contributor",
  clock = Date.now,
}) {
  if (typeof issuer !== "string" || !issuer.trim())
    throw new Error("Identity issuer is required");
  if (typeof audience !== "string" || !audience.trim())
    throw new Error("Identity audience is required");
  if (publicKey !== undefined &&
      (typeof publicKey !== "string" || !publicKey.includes("BEGIN PUBLIC KEY")))
    throw new Error("Identity public key is invalid");
  if (!publicKey && (!publicKeys || typeof publicKeys !== "object" || !Object.keys(publicKeys).length))
    throw new Error("Identity public key set is empty");
  if (publicKeysLoader !== null && typeof publicKeysLoader !== "function")
    throw new Error("Identity public key loader is invalid");
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(memberClaim))
    throw new Error("Identity memberClaim is invalid");
  if (!["viewer", "contributor", "operator"].includes(deviceRole))
    throw new Error("Identity deviceRole is invalid");
  return {
    deviceRole,
    verify(token) {
      try {
        if (typeof token !== "string" || token.length < 40 || token.length > 8192)
          return null;
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const header = decode(parts[0]);
        if (!header || header.alg !== "RS256" || header.typ !== "JWT") return null;
        const currentKeys = publicKeysLoader ? publicKeysLoader() : publicKeys;
        const selectedKey = currentKeys
          ? (typeof header.kid === "string" ? currentKeys[header.kid] : null)
          : publicKey;
        if (typeof selectedKey !== "string") return null;
        const payload = decode(parts[1]);
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          return null;
        const signature = Buffer.from(parts[2], "base64url");
        const verifier = createVerify("RSA-SHA256");
        verifier.update(`${parts[0]}.${parts[1]}`);
        verifier.end();
        if (!verifier.verify(selectedKey, signature)) return null;
        if (payload.iss !== issuer) return null;
        const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!audiences.includes(audience)) return null;
        const now = Math.floor(clock() / 1000);
        if (!Number.isInteger(payload.exp) || payload.exp <= now) return null;
        if (payload.nbf !== undefined &&
            (!Number.isInteger(payload.nbf) || payload.nbf > now + 30)) return null;
        const memberId = payload[memberClaim];
        if (typeof memberId !== "string" || !memberId || memberId.length > 160)
          return null;
        return {
          memberId,
          expiresAt: payload.exp * 1000,
          subject: typeof payload.sub === "string" ? payload.sub : memberId,
        };
      } catch {
        return null;
      }
    },
  };
}
