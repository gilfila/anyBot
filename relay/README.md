# Any Bot phone relay

A phone paired by QR code (**Settings → Your phone**) reaches its desktop through this relay. Both sides dial out to it, so nobody opens ports, sets up certificates, or signs in. It is a Cloudflare Worker with one Durable Object "room" per desktop.

## What the relay can and can't see

The phone and the desktop encrypt everything end to end ([`runtime/link-protocol.mjs`](../runtime/link-protocol.mjs)). The relay only forwards opaque frames.

**It can see:**
- the random id of each room and each phone
- when they connect
- how big their frames are

**It can't see or do:**
- read messages, bots, or work
- change a frame without the receiver noticing
- impersonate either side

**Room ownership:** the first desktop to open a room stores a hash of its secret. After that, only that secret can connect as the room's desktop.

**Limits:**
- 64 KB per frame
- 16 phones per room

**Keepalives:** `ping`/`pong` is answered without waking the room, so idle connections cost next to nothing.

## Deploy (once)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. From the repository root, sign in to Cloudflare. This opens a browser window to approve access:

   ```bash
   npx wrangler@4 login
   ```

3. Deploy the relay:

   ```bash
   npx wrangler@4 deploy --config relay/wrangler.toml
   ```

   It prints the relay's address, for example `https://anybot-relay.<your-subdomain>.workers.dev`.
4. Put that address in `DEFAULT_RELAY_URL` in `desktop/main.cjs` and ship a release. Setting `ANYBOT_RELAY_URL` overrides it for one machine.

The Workers free plan covers personal use; Durable Objects with SQLite storage are included. Changing `worker.mjs` or `room.mjs` only needs step 3 again.

## Run it yourself

The same room logic runs on plain Node for tests and self-hosting:

```bash
node relay/node-server.mjs --port 8787
```

Phones only connect over `wss://`, so put it behind a TLS reverse proxy and point `ANYBOT_RELAY_URL` at the proxy's `https://` address.

## Test

`npm test` covers the protocol and the relay on Node (`tests/phone-link.test.mjs`). To run the same suite against the real Worker locally:

```bash
npx wrangler@4 dev --config relay/wrangler.toml --port 8792 --persist-to <short folder>
```

Then, in a second terminal:

```bash
ANYBOT_TEST_RELAY=http://127.0.0.1:8792 node --test tests/phone-link.test.mjs
```

On Windows, keep `--persist-to` short (for example `%TEMP%\wr`). Room storage paths otherwise pass 260 characters, and the room fails with a bare "internal error".
