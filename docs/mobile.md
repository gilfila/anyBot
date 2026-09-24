# Mobile companion

## Connect your phone (the easy way)

1. On the computer, open **Settings → Your phone** and click **Connect a phone**. A QR code appears.
2. On the phone, open Any Bot and tap **Scan QR code**. Point the camera at the code.

That's all. The phone stays paired across restarts and works on Wi-Fi or mobile data. Remove it any time from the same Settings card, or with **Disconnect** on the phone.

**How it works:**
- **The relay:** the phone and the desktop both connect out to a small relay ([relay/README.md](../relay/README.md)). Nothing listens on a port and no certificate is involved.
- **Encryption:** everything between them is end-to-end encrypted with keys from the QR code ([runtime/link-protocol.mjs](../runtime/link-protocol.mjs)). The QR code carries the desktop's public key and a one-time secret that works for ten minutes, for one phone.
  - The phone proves it scanned the code.
  - The desktop proves it holds the key in the code.
  - Each connection mixes in fresh keys, so recorded traffic stays private even if a device key later leaks, and replayed frames are rejected.
- **Where keys are kept:**
  - Desktop: its keys sit in `phone-link.json` in the app's data folder, encrypted with Windows' per-user protection.
  - Phone: its private key is created non-extractable in the WebView's key store.
- **Access:** a paired phone gets the same routes as the HTTPS gateway below, as the owner with full control. Requests go through the same `handle()` in `runtime/mobile-gateway.mjs`.

The rest of this page covers the original self-hosted setup: an HTTPS gateway with your own TLS certificate. It is still available for advanced use, under **Advanced: connect to a server** on the phone.

## Self-hosted gateway

The mobile implementation has a touch-first React client, Capacitor iOS/Android projects, and an opt-in HTTPS gateway attached to the desktop coordinator. It uses the existing Open Design visual direction. The gateway is a local multi-human foundation, not yet a hosted identity provider: it can bind sessions to configured members, invite those members to conversations, and retain bounded audit records.

## What works

- Pair using a single-use 12-character connection code, valid for two minutes, or use a short-lived RS256 access token when the headless server's external identity verifier is configured.
- See employees and recent conversations, create team conversations, select recipients, send assignments, see responses and run status, and cancel work.
- A lost send response can be retried with the same request ID to avoid duplicate task execution. In-memory drafts and pending requests are kept per conversation; they are not persisted across closing the client.
- The mobile web build is installable as a standalone PWA on supported iOS and Android browsers. It includes a small offline shell cache for reopening the client while the workspace connection is unavailable; authenticated API data is never cached.

## Native build checks

`npm run mobile:sync` keeps the Capacitor projects current. `npm run mobile:build` automatically detects the standard Android Studio JDK and SDK locations on Windows, while honoring explicit `JAVA_HOME` and `ANDROID_HOME` overrides. The current debug APK is `release/anyBot-mobile-debug.apk`; it was installed and launched as `dev.anybot.mobile` on an attached Android emulator during verification. The repository also includes `.github/workflows/mobile-build.yml`, which builds the Android debug target on Ubuntu and compiles the unsigned iOS Simulator target on macOS. Apple signing, App Store provisioning, push notifications, and device distribution remain release steps outside this repository workflow.
- Sessions expire after 24 hours, can be revoked from desktop, and are all revoked on gateway restart. The server stores session-token hashes; the mobile client keeps its token only in memory.
- Pairing codes now grant an explicit device role: `viewer` can read, `contributor` can create conversations and send work, and `operator` can also cancel runs. Desktop also binds the code to a human member ID. Conversation creators are automatically members; owners/operators can invite configured members, and overview/history/run responses are filtered to the session's conversation memberships.
- The mobile **New conversation** sheet now displays configured human members and submits invitations with the conversation. A member's own identity is omitted from the invite list; unauthorized invitation attempts remain server-enforced.
- The mobile conversation composer includes a microphone control that appends browser speech recognition to the draft without sending audio to the gateway. It stops cleanly when the view unmounts and reports a clear message when the browser does not expose speech recognition.
- One-to-one mobile conversations also expose **Voice chat**: speech recognition submits the assignment, the client waits for the employee response, and the device speech-synthesis engine reads it aloud. Group conversations remain text-first so several agents do not speak over one another.
- Owners and operators can review token-free audit entries at `GET /v1/audit?limit=100&before=<cursor>`. The endpoint returns only bounded action metadata and is denied to human viewers and ordinary contributors.
- Owners can manage durable human identities from Mobile → Settings when the gateway has a `membersPath`: add member/viewer identities, review the current list, and remove non-owner members. The server still enforces the same owner-only rules if a client is modified.
- Native project generation and Android debug APK build. iOS requires Xcode on a Mac for actual compilation and signing.

## Browser OIDC sign-in

The mobile connect screen accepts an HTTPS issuer and public OIDC client ID. **Sign in with provider** fetches the issuer's discovery document, requires authorization-code flow with PKCE S256, redirects to the provider, exchanges the code without a client secret, and sends the resulting short-lived bearer token to the configured anyBot gateway. The PKCE verifier and state are kept in `sessionStorage` only for the redirect transaction; the access token remains in memory and is never written to storage. Register the current mobile origin and path as the provider redirect URI, and configure the server's `identity.memberClaim` so the token maps to an existing human member. The provider token endpoint must permit the public-client code exchange from the mobile origin; pairing remains the fallback for providers that require a backend callback.

Not yet implemented: persistent OS-protected session storage, QR scanning, push notifications, artifact browsing/upload, mobile approvals, full history search, event streaming, hosted multi-organization membership, production signing/store distribution, and iOS device verification. Local/headless single-organization membership is durable in `members.json`; external RS256 token verification, live JWKS rotation, and browser OIDC authorization-code + PKCE sign-in are available. Polling currently refreshes every four seconds while visible. The gateway still obtains full internal coordinator snapshots before projecting resources; large-workspace database query optimization remains necessary.

## Build and verify

```powershell
npm ci
npm run mobile:dev
npm run mobile:build
npm run mobile:sync
npx playwright test --config playwright.mobile.config.mjs
```

On Windows, the Playwright configs use `PLAYWRIGHT_BROWSER_PATH` when set, otherwise the installed Chrome executable when present, and fall back to Playwright's managed Chromium elsewhere. This keeps acceptance tests usable on hosts where Windows blocks managed-browser process creation.

The development preview is at `http://127.0.0.1:5174`. Production clients require an HTTPS workspace address. The dev client permits HTTP only to `127.0.0.1`; this exception is absent from the production build. The Android manifest disables cleartext traffic and app backup. No credentials are bundled into web assets or native projects.

Android: open `android` in Android Studio, or run `npm run mobile:build`. The script detects the Android Studio JDK and SDK on Windows; set `JAVA_HOME` or `ANDROID_HOME` explicitly when using nonstandard locations. The verified debug APK is `release/anyBot-mobile-debug.apk` (SHA-256 `E80B57723CABEB85D1F7A60BC34BA9E70A767133A14CE06495E51EF3DB5F6465`). It is for testing, not a signed production release.

iOS: run `npm ci` and `npm run mobile:sync` on the Mac, open the generated project in `ios/App`, configure your development team, and build/run with Xcode. No iOS binary is claimed by a successful Windows web build or Capacitor sync.

### Connect to your actual desktop team

An older desktop build may predate the gateway and member ACLs. Use the current 0.2.11 desktop source or installer before attempting pairing. Remote access is off unless explicitly configured; this implementation does not open firewall ports, publish a tunnel, or change TLS trust automatically.

Create `mobile-access.json` in the desktop app's data directory, shown under **Runtime & privacy**:

```json
{
  "enabled": true,
  "host": "127.0.0.1",
  "port": 4319,
  "publicUrl": "https://your-workspace.example:4319",
  "certPath": "C:\\private\\tls\\fullchain.pem",
  "keyPath": "C:\\private\\tls\\key.pem",
  "webOrigins": [],
  "members": [
    { "id": "owner", "name": "Workspace owner", "role": "owner" },
    { "id": "alice", "name": "Alice", "role": "member" },
    { "id": "bob", "name": "Bob", "role": "member" }
  ]
}
```

Supply a real certificate matching the public URL and trusted by the phone. Configure a private network/VPN and an appropriate bind address if connecting directly from a phone; loopback alone is deliberately not reachable from another device. A TLS gateway behind an explicitly configured proxy is also possible. Do not bypass phone certificate warnings or disable certificate verification. The gateway itself requires TLS even behind a proxy.

Native origins `capacitor://localhost` and `https://localhost` are allowed. For a browser-hosted mobile client, add its exact HTTPS origin to `webOrigins`. CORS is an additional browser check, not authentication. Do not add wildcards. The app's TLS private key remains on the host; it never goes into the phone or source repository.

Fully quit and restart desktop after changing configuration. Under **Runtime & privacy → Mobile companion**, choose a device role and human member ID, then generate a connection code. Enter the workspace URL and code on the phone. A created conversation starts with that human and its selected employees; an owner or operator can invite another configured member through the scoped gateway route. A member who is not invited receives a 404 for that conversation, which avoids leaking its existence. The pairing code is still a bootstrap credential, so use a private channel or an external identity provider before exposing this beyond a trusted local network.

Codes are never returned over an unauthenticated status endpoint. Pairing attempts are limited to five per source address per minute, with bounded tracking; at most 16 active sessions are allowed. Renewed connection codes replace prior unredeemed codes. Desktop can list and revoke device sessions. The authenticated API has resource-specific routes and does not expose arbitrary coordinator RPC, employee configuration, local file paths, harness configuration, or launcher registration.

## Verification boundaries

Conversation grants now persist in `mobile-membership.json` under the desktop or headless server data directory. Token-free gateway audit entries persist in `mobile-audit.jsonl`; bearer sessions remain memory-only and require pairing again after restart. Invalid saved grant or audit documents stop gateway startup. Run one gateway per data directory; these files are not a concurrent membership database. Back them up alongside the workspace. Existing ungranted desktop conversations are visible only to a human owner, never merely because a device has the operator role. A human viewer cannot gain write or invite permissions through an operator device.

This controls gateway resource access only. Harnesses still share the host account and can read local files outside application conversations. It is not sufficient isolation for mutually untrusted humans; coordinator-level identity, durable audit, and isolated execution remain required.

Node integration tests cover TLS enforcement, unauthenticated denial, code expiry/reuse/rate limits, session expiry/revocation, allowed origins, field projection, unavailable admin routes, idempotent sends, cancellation through real SQLite coordination, and the member/conversation ACL boundary.

The 390 × 844 browser workflow uses the real gateway and coordinator with a clearly simulated provider. It pairs, creates a two-employee conversation, deliberately loses the first send response, retries, confirms one run, displays literal HTML safely as text, and revokes the session. This proves the client/API interaction, not a live provider response on a phone. Native Android launch checks are recorded separately in verification.md. A TLS-configured real desktop-to-phone conversation is still an acceptance gate.
