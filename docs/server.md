# Headless server mode

The desktop app and the headless server use the same coordinator and mobile gateway. The server mode is intended for a private VPS, a LAN host, or a local development service; it does not add a second execution engine.

## Local loopback smoke test

```powershell
Copy-Item server/config.example.json server/server.local.json
# Keep allowInsecureLoopback true only while host is loopback.
node server/index.mjs --config (Resolve-Path server/server.local.json)
```

The server keeps its SQLite workspace under `dataDir`, probes the installed harness CLIs, and exposes the scoped `/v1` mobile API. Stop it with Ctrl+C; the coordinator closes SQLite and the gateway before exit.

Run the deployment preflight before starting a service. It validates the normalized server configuration, writable data directory, TLS material, and configured identity key shape without launching harnesses or making a provider request:

```powershell
node server/preflight.mjs --config C:\etc\anybot\server.json
```

For a VPS release gate, add `--hosted`. That stricter check requires TLS, a non-loopback public URL, configured RS256 identity verification, and at least one owner member; local loopback development continues to use the command above without the flag.

`GET /healthz` is an unauthenticated, read-only liveness endpoint for a process supervisor or reverse proxy. It returns `{ "status": "ok" }` and does not expose workspace data or pairing state.

## VPS shape

1. Put `server/index.mjs` behind a private network or a TLS reverse proxy. For direct TLS, configure absolute `certPath` and `keyPath` under `tls` in the server config and set an HTTPS `publicUrl`.
2. Mount the SQLite `dataDir` on encrypted persistent storage and back it up with the database's WAL-aware backup process. Do not put provider credentials in the image or config.
3. Install and authenticate each harness under the service account that owns the server. The server uses that account's local credentials; it does not copy desktop OAuth state.
4. Configure exact `origins` and the `members` list. Pair a separate device code for each human, or configure the optional RS256 identity verifier below. The verifier maps an issuer-approved subject to an existing member; it never accepts a role or organization from the token.
5. Keep the coordinator's host private. A reverse proxy should terminate TLS, restrict source networks, apply rate limits, and forward only the API paths needed by the mobile client.

For a simple single-tenant VPS, start from [server/config.vps.example.json](../server/config.vps.example.json) with the server bound to loopback, run Caddy from [server/Caddyfile.example](../server/Caddyfile.example) for HTTPS, and set the exact public origin in both files. This keeps provider credentials and the SQLite volume on the worker host while the proxy owns the public certificate. Install the harness CLIs and authenticate them as the `anybot` service account, then adapt [server/anybot.service.example](../server/anybot.service.example) for systemd so the coordinator restarts after a crash or host reboot.

`server/Dockerfile` is a starting image for the coordinator and API. It runs as the unprivileged `anybot` user, declares a liveness health check, and deliberately does not bundle harness credentials, TLS keys, a reverse proxy, or a database migration service. [`docker-compose.example.yml`](../server/docker-compose.example.yml) applies a read-only root filesystem, dropped Linux capabilities, a private `/data` volume, explicit 2 GiB/2 CPU/256-process ceilings, and an explicitly mounted read-only config/key directory while binding only to loopback. A production VPS deployment still needs those operational controls, process supervision, backups, monitoring, and isolated workers; this image's user boundary is defense in depth, not a harness sandbox.

## External identity (OIDC access tokens)

For a private VPS or an organization that already has an OIDC provider, the headless server can validate short-lived RS256 access tokens. The provider's browser login and PKCE flow remain outside anyBot; the gateway only verifies the resulting token. Add this block to the server config and keep the public key file readable only by the service account:

```json
{
  "identity": {
    "issuer": "https://login.example.com/",
    "audience": "anybot",
    "jwksPath": "/etc/anybot/oidc-jwks.json",
    "memberClaim": "sub",
    "deviceRole": "contributor"
  }
}
```

The claim named by `memberClaim` must exactly match an ID in `members`. Tokens must use `RS256`, the configured issuer and audience, and a future `exp`; `nbf` is checked with a small clock-skew allowance. A `jwksPath` file uses standard RSA signing keys selected by JWT `kid`; the running server reloads an atomically replaced file on the next token verification, so key rotation does not require a process restart. `publicKeyPath` remains supported for a single-key deployment. The configured `deviceRole` applies to every external token, so a token cannot self-elevate to operator. Human roles still come from the server membership configuration, and conversation ACLs remain enforced. The mobile client keeps a pasted token in memory only and uses it instead of a pairing code.

Hosted preflight output includes explicit warnings that harness workers share the server account and that provider-side token revocation and organization tenancy remain deployment responsibilities. Treat a hosted configuration as suitable only for a trusted workspace until isolated workers and durable organization policy are in place.

When the server is running, its membership file is `members.json` beside the SQLite database. An authenticated owner can list members with `GET /v1/members`, add a member with `POST /v1/members` using `{ "id", "name", "role" }`, and remove a non-owner member with `DELETE /v1/members/:id`. These mutations are owner-only, atomic, audited, and immediately affect pairing and external-token mapping. Conversation grants for a removed member remain as historical IDs but no longer authorize access; re-adding the same ID restores only the configured identity, not a deleted session.

This is an identity boundary, not a complete hosted multi-tenant release. Use a durable organization membership service, token revocation strategy, isolated workers, and PostgreSQL before serving mutually untrusted organizations.

## Local backup procedure

Stop the server before copying its data directory so SQLite WAL state and the membership/audit files are consistent. The bundled backup command copies the SQLite files, artifacts, employee workspaces, durable human membership grants, and token-free audit log into an atomic timestamped directory with SHA-256 entries:

```powershell
node server/backup.mjs --source C:\anyBot\server-data --destination D:\backups\anybot
```

The backup refuses symbolic links and special files and includes the durable `members.json` identity mapping. Keep the destination encrypted and separate from the live volume; restoring should be performed into a new data directory and verified with the manifest before switching the service over.

Restore into a new directory only after the backup has been copied to the target host:

```powershell
node server/restore.mjs --backup D:\backups\anybot\anybot-backup-20260920T130000Z --destination C:\anyBot\restored-data
```

Restore verifies every recorded size and hash, refuses an existing destination, and writes a `restore-manifest.json`. Stop the service, inspect the restored directory, then point a new server configuration at it before resuming traffic.
