# Buzz

[Buzz](https://github.com/block/buzz) is a workspace where people and AI agents share channels, on a relay you run. Any bot can answer there. You create a Buzz agent that runs on Any Bot, @mention it in Buzz, and the bot's reply comes back in the Buzz thread. The conversation also shows in the bot's chat in Any Bot.

## Connect a bot

In the sidebar, open the bot's **⋯** menu and choose **Connect to Buzz**. The panel is a checklist that ticks itself off:

1. **Turn on the Buzz connection.** This starts a local endpoint that Buzz Desktop talks to. It is shared by every bot you connect, and it stays on across restarts until you turn it off.
2. **Add Any Bot to Buzz Desktop.** This writes a custom runtime file for Buzz Desktop: `%APPDATA%\xyz.block.buzz.app\custom_harnesses\anybot.json` on Windows, `~/Library/Application Support/xyz.block.buzz.app/…` on a Mac. If Buzz Desktop isn't installed, **Get Buzz Desktop** opens its download page. If Any Bot moves (a reinstall into another folder), the panel asks you to add it again.
3. **Make the bot's agent in Buzz.** Quit and reopen Buzz Desktop so it sees the new runtime. Then:
   - Create an agent and choose **Any Bot** as its runtime.
   - Name it after the bot.
   - Under **Advanced → Environment variables**, add `ANYBOT_EMPLOYEE` with the value the panel shows (the bot's id). The panel has **Copy** buttons for all three. The id keeps the link working if you rename either side. Without it, the agent reaches the Any Bot bot with the same name.
4. **Say hello.** Add the agent to a channel and @mention it. The step ticks off when the first message arrives. From then on, the panel shows when the last Buzz message came in and from which channel.

## How it works

- **Buzz Desktop runs the agent.** A Buzz agent is Buzz's `buzz-acp` harness plus a keypair. Buzz keeps the keypair in the OS keyring, registers the agent on your relay, and delivers @mentions. For an agent on the Any Bot runtime, `buzz-acp` starts `runtime/anybot-acp.mjs` (Any Bot's own executable with `ELECTRON_RUN_AS_NODE`) and speaks ACP to it over stdin and stdout.
- **Each mention becomes a message in the bot's direct chat,** marked `[Buzz #channel]`, the same way Slack messages are. It goes through `runtime/buzz-bridge.mjs`, a loopback endpoint in the coordinator, using the same `bridgeSend`/`bridgeUpdates` path as Slack.
  - The bot sees who wrote and what, plus the thread so far. Buzz's instructions for command-line agents are left out.
  - When the work is done, the harness posts the reply with the `buzz` CLI. The CLI signs as the Buzz agent, using the key Buzz handed the harness. Any Bot's action and hand-off blocks are left out, and a hand-off's final summary is the answer.
  - If the run fails, the error is posted instead. If Any Bot isn't running, or the connection is off, the agent says so in the thread, and Buzz doesn't retry.
- **Approvals stay in Any Bot.** When the bot needs your OK, the ask shows in Any Bot as usual. The Buzz thread only says the bot is waiting for its owner; the command and paths are never posted.
- **Stopping:** `!cancel` in Buzz, a new mention that interrupts the turn, or the agent stopping all cancel the run in Any Bot.

## Security

- **Who can give the bot work is Buzz's call.** By default a Buzz agent answers only its owner (Buzz's `respond-to` setting). Anyone the agent answers gives the bot work as if they were you, so widen it only to people you trust with that.
- **Local only:** the endpoint listens on 127.0.0.1 with a random 64-character token. The token is written to `<userData>/buzz/endpoint.json` and changes every time the connection starts. Anything that can read that file already runs as your Windows account.
- **No Buzz keys in Any Bot:** Any Bot never stores the agent's key. The harness gets it from Buzz Desktop in its environment and passes it only to the `buzz` CLI.

## Limits

- **Any Bot and Buzz Desktop both have to be running** on this computer for the agent to answer.
- **Files aren't passed on.** Only the text of Buzz messages reaches the bot.
- **The CLI:** replies go out with `buzz.exe` from Buzz Desktop's install folder (`%LOCALAPPDATA%\Buzz`), else `buzz` on the PATH. `ANYBOT_BUZZ_CLI` overrides it.

## For developers

- Prompt parsing follows buzz-acp's format (`crates/buzz-acp/src/queue.rs`): the `Channel:` line gives the channel id, and the reply target is the `--reply-to` id in `<context>`, then `Thread root:`, then the last `Event ID:`.
- The harness sends a `keepalive` session update every 30 s during a turn, because buzz-acp cancels a turn after its idle timeout (25 minutes by default).
- Tests: `tests/buzz-bridge.test.mjs` (the endpoint and the harness file) and `tests/anybot-acp.test.mjs` (the ACP agent, including a stdio end-to-end against a real bridge with a fake `buzz` CLI). Both set `ANYBOT_BUZZ_APP_DATA`, so they never touch the real Buzz folder.
