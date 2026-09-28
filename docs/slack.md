# Slack

Any bot can have its own Slack app. You DM it, or @mention it in a channel, and its reply comes back in Slack. The conversation also shows in the bot's chat in Any Bot.

## Connect a bot

In the sidebar, open the bot's **⋯** menu and choose **Connect to Slack**. The panel walks through four steps:

1. **Create the bot's Slack app.** **Open Slack** opens Slack's "Create an app" page, already filled in from a manifest with the bot's name. You pick the workspace and click **Next**, then **Create**. **Copy the manifest** is the fallback: on api.slack.com/apps, choose **Create New App**, then **From a manifest**, and paste it.
2. **Install it.** Under **Install App**, click **Install to workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Make an app token.** Under **Basic Information → App-Level Tokens**, click **Generate Token and Scopes** and add `connections:write`. Copy the token (`xapp-…`).
4. **Paste both tokens** and click **Connect**.

Any Bot then shows a six-digit code. DM that code to the app in Slack, and you're paired. Only paired people can give the bot work. Use **Pair someone else** to add a teammate.

To use the bot in a channel, invite it with `/invite @name`, then @mention it. It replies in a thread under your message. In a DM it answers in the DM.

Want the bot's picture in Slack? Upload it under **Basic Information → Display Information**. Slack apps can't set their own icon from a manifest.

## How it works

- **Nothing reaches your computer from outside.** Socket Mode means Any Bot opens an outbound WebSocket to Slack for each connected bot. There's no public URL and no relay (`runtime/slack-bridge.mjs`, in the main process).
- **Your message becomes a message in the bot's direct chat,** marked `[Slack DM]` or `[Slack channel]` so the bot knows where it came from. The bot then works as usual.
  - While it works, your Slack message shows 👀.
  - When the run finishes, its reply is posted back to Slack, converted to Slack formatting.
  - If the run fails, the first line of the error is posted instead.
- **Approvals:** when the bot needs your OK for a risky action, Slack shows **Approve** and **Deny** buttons. Only a paired person's click counts.
- **The app's scopes:** `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`, `reactions:write`, `users:read`. Its events are `app_mention` and `message.im`. The bot doesn't read channel messages that don't mention it.

## Security

- **Tokens are stored encrypted** with Windows' per-user encryption (`safeStorage`) in `<userData>/slack.json`. They are never shown again, never sent to the app's window, and never written to logs. The diagnostics log masks `xox…` and `xapp-…` tokens.
- **Anyone in the workspace can DM the app,** but only paired people reach the bot. Anyone else gets one polite refusal an hour, and their message is dropped.
- **Pairing codes** work once, expire after 10 minutes, and are only accepted by DM.
- **A paired person gives the bot work as if they were you.** The bot runs on this computer with its own permission mode and workspace, so pair only people you trust with that.

## Limits

- Follow-ups in a channel thread need a fresh @mention; the app doesn't read the rest of the thread.
- Any Bot has to be running (the tray is enough) for the bot to answer. Messages sent while it's closed are not picked up later. Slack gives up on them.
- Each bot needs its own Slack app. Connecting one app to two bots is refused.
