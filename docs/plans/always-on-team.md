# Any Bot Always-On Team: supervised, 4-level Life Org that runs itself (build spec for 0.3.37 to 0.3.53)

_Design spec produced 2026-09-29 by a multi-agent design workflow (6 code readers → 3 competing designs → 3 judges → synthesis → completeness critic). Build plan for Tony's direction of 2026-09-29: an always-on, self-staffing agent team._

## Execution order (revised 2026-09-29 after the critic)

The critic's corrections at the end of this file apply to every milestone. Its two biggest ordering points are adopted:

1. **Wave 1 (brakes, review, voice).**
   - **M0 0.3.37**, safety floor. It also labels bridge-origin messages (Slack, Buzz, phone), so they never carry owner authority for approvals or proposals.
   - **M1 0.3.38**, Team switch, kill switch, budgets, breaker and lanes. Per the critic, the kill switch also stops routines and the breaker only trips on structured error codes.
   - **P1 0.3.39**, the read-only daily people review, split out of M12 and moved up. It is a deterministic metrics pack at 06:45 that costs zero tokens and gives each bot a verdict (OK / Watch / Adjust / Fire-candidate / Not enough data). It is posted to the HQ canvas and to Org → People. It excludes outage failures and bots in rooms where Team is off from the idle-based flags. Acting on the review (proposals, fires) stays with M10 to M12.
   - **V1 0.3.40**, desktop voice.
2. **Wave 2 (desks, levels, supervisor).** M2 desks go behind a setting (off at merge, per the critic), then M3 levels, then M4 supervisor.
3. **Wave 3.** V2, M5 to M8.
4. **Pilot M9,** which needs Tony's sign-off.
5. **Wave 4.** M10 to M14.

Owner decisions taken 2026-09-29:
- per-bot subfolders (desks);
- fix voice;
- approvals go up the chain of command;
- one owner Slack app for notifications;
- wake and keep-awake are allowed;
- 4 levels, with Chief of Staff → director → manager → employee hiring;
- a daily adjust/fire breakdown.

The Buzz bridge is already done (0.3.35). The other defaults in "Owner decisions still needed" are proposals until Tony confirms them.

## Amended by M0 (0.3.37, as built)

M0 changed some rules that this spec states elsewhere. Where the text below disagrees with this section, this section wins. `{root}` stands for the owner's projects folder throughout.

- **Autonomy is decided by who started the work, never by `messages.author`.** A run's work is owner-started (not autonomous) when `Coordinator.startedByPeople(run)` is true, and its origin is `Coordinator.runOrigin(run)`. Both use one walk (`workMessage`): the root run's message, and when that is a bot reply (kind `assistant`), the run that posted it, then that run's root, and so on.
  - Why: a mention in a thread people started begins a root of its own (as in 0.3.36), and that root's message is the bot reply that mentioned it (author = that bot). Keying on the root message's author would make every mention hop in the owner's own threads autonomous: budgeted, priority 20, and under unattended tool rules.
  - M1's `isAutonomous(run)` is `!startedByPeople(run)`, and owner authority is `ownerAuthority(runOrigin(run))`.
- **Origins are labels in metadata, not a `runs.origin` column.** `runtime/origin.mjs`; no schema change and no v19 bump for it.
  - Bridges label their messages in metadata `origin:<message id>` (ids only): Slack `{via:'slack',team,user,channel}`, Buzz `{via:'buzz',channel}`, the phone gateway `{via:'phone',member}` (whatever the phone claims), any other bridge `{via:'bridge'}`.
  - A human message with no label was typed in the desktop app (`{via:'desktop'}`). Routines and Any Bot's own hand-offs are `{via:'system'}`, and bots' messages are `{via:'bot',employee}`.
- **Only the desktop is the owner for now.** `ownerAuthority(origin)` is true only for `desktop`. Bridges, Buzz included, don't get the owner lane. Whether the paired phone (member `owner`) and the Slack owner.userId count as the owner is an open M1 decision (see "Owner decisions still needed").
- **Mentions in people's threads.** A mention in any thread that began with a person's message (desktop, Slack, Buzz or phone) still starts a fresh root, bounded by MENTION_HOPS (6 bot turns per human message), as in 0.3.36. Only work that a routine, autopilot or a bot started joins the root and its 8-run / 3-deep limits. Whether guest threads (Buzz, non-owner phone members) should be capped as well is part of the same M1 decision.
- **Backups.** Besides the newest 3, the first backup of the upgrade in progress (the lowest `v<from>` to the current schema) is always kept. Each migration step commits on its own, so an upgrade that fails part-way and is retried backs up the partly upgraded workspace on every start; without this rule the only copy the previous version can open would be pruned.
- **Startup errors.** A coordinator that exits before it's ready sends its `runtime.uncaught` message first. When the next start fails with the same message, main stops restarting and its "Any Bot runtime stopped" dialog shows the message and points to Settings → Diagnostics (`createStartupFailures`, `stoppedDialog` in desktop/lifecycle.cjs).
- **Crash handling.** Only an uncaught throw exits the coordinator, after `stop()` holds new work and clears the heartbeat. An unhandled promise rejection is logged as `runtime.unhandled_rejection` (once a minute per message) and the coordinator keeps running, as Electron's utility process did before M0. `dispatch()` catches a run's own clean-up failing (`runtime.tick_failed`, step `run`) and frees its slot.

## Amended by M1 (0.3.38, as built)

M1 settled these; where the text below disagrees, this section wins.

- **One state machine for every off path** (runtime/budget.mjs `teamState`): `off` (never turned on, or resumed with Team off: Any Bot as in 0.3.37 except the Team-off exceptions listed in CHANGELOG 0.3.38), `running`, `paused` (team.pause, `pausedUntil`) and `stopped` (team.stop). Paused and stopped hold everything that isn't the owner's lane, with Team on or off.
  - `team.set {enabled:false}` from on is exactly `team.stop`; `team.set {enabled:true}` from stopped is `team.resume {enabled:true}`. `team.resume` goes back to what Team was before the stop, or to `{enabled}` when given. After a stop made with Team on, every Resume control (chat banner, sidebar, Settings, tray) offers both **Turn Team back on** (`{enabled:true}`) and **Resume with Team off** (`{enabled:false}`), never a bare Resume (`resumeChoices` in src/lib/team.js, `teamTrayItems`).
  - team.stop saves every open room's flag in `savedAutopilot` ({id: 0|1}), sets autopilot=0 everywhere and holds routines (occurrence status `skipped-stopped`, used for paused too). Work outside the owner's lane stops, **running included** (review repair): `keptByStop` (guest lane, or a run with a task or a parent) is held (queued work stays queued; running work is cancelled and queued again as the same work, `requeue`), the rest is cancelled and dismissed. One notice per conversation says what was cancelled and what waits. Resume sets autopilot=1 only where it was 1, except a resume to Team off after a stop made with Team on, which leaves it 0 and posts a note in each such room (Autopilot would run without budgets).
  - Pause holds queued work (nothing is cancelled, Autopilot stays on) and skips routines; running work finishes.
  - While halted, `delegate()`, `activateMentions()` and `returnToParent()` refuse for non-owner runs with one notice each (in practice while paused, since a stop cuts running non-owner work off). Owner-lane hand-offs and mentions go on; Settings "Stop everything" (`runtime.stopAll`) stops those. Review runs (`onTaskMoved`) and a reviewer's restart of the lead are queued and held, so the board picks up again on resume.
  - Stop and resume change `this.team` only if their transaction commits (`teamTransaction`).
  - The critic's per-room Team flag is not built: nothing uses it before T1 (M4). With Team on in M1, legacy Autopilot still runs in rooms with autopilot=1, under the budgets; it never runs while halted.
- **Lanes, not just autonomy.** `laneOf` gives `owner` (the run's own message or its work's first message is desktop, or the owner pressed a routine's Run now or Run again on a routine's own run: metadata `ownerRun:<run id>`, inherited by what it hands on), `guest` (people through a bridge) or `autonomous`. Budgets, the reserve, unattended flags and the dontAsk/Codex refusals apply to guest and autonomous runs with Team on; the kill switch holds both. The breaker holds autonomous runs only (owner and guest runs try, so people see the reason). `Coordinator.runInfo(run)` caches the lane; `runPriority(run)` applies the table.
  - **Run again on anyone else's run** (review repair) is metadata `ownerRetry:<run id>`, never inherited: that one run gets priority 30, gets past halt, budget, reserve, breaker and Interrupt holds, and counts in the owner's budget column (`attended`, `budgetLane`), but keeps its lane, so it stays unattended (tool rules, `codexMcpOff`) and is still refused as dontAsk/Codex. What it hands on keeps the guest's or autonomous lane. Before this, a retried Buzz run made its hand-off to a Codex bot owner-lane work with its MCP servers on.
- **Guest text in prompts** (review repair): `promptParts` attaches each bridge message's `origin` label, and `context.mjs` renders it as "Guest via Buzz #general (not the owner at the desk):" with the body quoted line by line (`> `), plus a note in the Conversation header when any such line is present; a guest's own assignment says "From a guest via …". Desktop messages stay "Human:". Giving each bridge its own conversation instead of the owner's direct chat is still open.
- **Breaker signals** (runtime/adapters.mjs `failure` on the thrown error, never classifyRunError's regex): Claude's result `api_error_status` 429/401/403; the CLI's API-error message's `error` (seen live 2026-09-30: an expired sign-in is `error: "authentication_failed"` with `api_error_status: null`) and `api_error` kinds; a `rate_limit_event` with status `rejected` (its `resetsAt`, epoch seconds, sets the reopen time); and exact CLI messages at the start of an error result. Codex: its error events' own "You've hit your usage limit" / 401 wording, or a typed `codex_error_info` if a version sends one. `parseResetTime` covers the rest and is bounded to a week. Any success on the harness closes it, and so does the provider's first answer in any run while it is open or half-open (review repair: `runHarness` `onAnswer`, from Claude's first non-API-error assistant event or Codex's first non-error item; a closed breaker's failure window is left alone). The half-open probe is the first autonomous run dispatch starts; while it runs, waits say `{reason:'breaker', state:'half'}` (no reopen time), and `Breaker.list(isActive)` reports `probing`, so the UI says "checking" only when a probe is running ("may have lifted" otherwise).
- **Budgets** count runs when dispatch starts them, by local day, kept in memory and recounted from `runs.started` at startup and each new day. Levels don't exist yet, so every bot has `levelRuns.unleveled` (12). Alerts at 80% and 100% are for the team and each project only; a held run gets one notice and one `budget.cap_reached` a day per limit (metadata `teamNotes`). A run Interrupt or Stop cut off and queued again (metadata `preempted:<run>`) is refunded; its rerun counts instead, and its tokens still count.
- **Refusals with Team on only:** dontAsk bots (unless in `dontAskAllowed`; the critic's low item) and Codex bots, until `CODEX_MCP_OFF_VERIFIED` in budget.mjs is true. The `-c mcp_servers.<name>.enabled=false` plumbing reads names from config.toml (`codexMcpServerNames`); Codex **plugins** (a mail plugin, for example) aren't MCP servers and aren't covered, so check them before flipping the constant. `tests/live-codex-mcp-off.mjs` is written, not run.
- **Outward tools:** only the plumbing ships (`--disallowedTools` from `org.policy.outwardTools`, with Team on). `tests/live-claude-disallow.mjs` ran on 2026-09-30: an exact tool name and a whole server (`mcp__smoke`) both disappear from the init event's tool list. Its call check and the claude.ai connector switch were inconclusive because the CLI's sign-in had expired. The critic's default-deny (a generated `--strict-mcp-config`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`, which `childEnvironment()` doesn't pass today, and aborting on an unexpected tool in the init event) moves to M3, where the policy and its allowlist land; before M4 wakes anything.
- **Getting through to a busy bot:** `snapshot.team.waits` says why each queued run waits (bot-busy, folder-busy, slots, reserve, budget, breaker, paused, stopped). When the owner's queued run waits on non-owner work, the chat offers **Interrupt** (`runs.interrupt {id, for}`): that run is cancelled and queued again as the same piece of work (same message, root, parent, task and thread), and the freed bot and folder are held for the owner's run (`this.preempt`, wait reason `owner-first`) until it starts, so with Team off (FIFO) other queued non-owner work can't take them first. Interrupt refuses when nothing of the owner's waits. Automatic preemption isn't built.
- **The real ceiling** is Tony's Claude and ChatGPT plans; README, Settings → Team and CHANGELOG say so. The timeout clamp for autonomous runs waits for levels (M3). New owner decision: the share of each plan the team may use (below).

## Amended by P1 (0.3.39, as built)

P1 is the read-only half of M12 ("Daily people review" and M12 below). Where they disagree, this section wins; M12 keeps the rest (manager standups, `people.keep`, escalation, Slack, the subtree hiring check, and the outputs listed under "Not built in P1" below).
- **On by default,** the one exception to "every always-on feature defaults off" besides the M0 safety fixes (see Guardrails): it only reads, uses no tokens and changes nothing but its own canvas section.
- **No `perf_daily` table, no schema bump.** Each review is kept in metadata `people.day:<YYYY-MM-DD>` (the newest 14 days; ids, counts, codes and times only), settings in `people.review` `{enabled, at, lastSlot}`. M12 may move them to a table.
- **A coordinator job, not a routine row** (`peopleTick`, the heartbeat's last step). On by default at 06:45; Settings → Team has the switch and the time. It is armed the first time it's seen (a new install or the update waits for the next time), catches up the latest missed time whenever Any Bot next starts (no 180-minute limit), marks a run over 5 minutes after its time `late`, and runs once per local day (moving the time later on a day already reviewed waits for tomorrow). It runs while the team is paused or stopped: it only reads.
- **Commands:** `people.review` (settings with `next`, `latest`, `history` summaries) and `people.run` (the owner's Run now; no alert), both renderer-allowlisted, plus `people.set {enabled?, at?}`. The spec's `people.runNow`, `people.day` and `people.bot` are these.
- **Metrics** (runtime/people-review.mjs `RULES`, one table): every rate needs 10 cases and is judged by its Wilson lower bound (95%).
  - Failures: classifyRunError's codes. timeout, output_limit, no_response and model are the bot's; usage_limit, auth, not_installed, launch and interrupted are the environment's; `exit` is unclear and left out. Watch 15%, Adjust 25%.
  - Cost: tokens (runs.usage, not cost_usd) of every run on tasks the bot led to Done, per task, against peers on the same harness, model and effort (3 or more peers with 3 or more tasks). Adjust above 2x their median.
  - Reviews sent back as lead (by its reviewer or the owner): Watch 20%, Adjust 34%. A task at the 3-round cap is Watch (tasks, not cap notes: the note repeats each time a capped task re-enters Review).
  - Rubber-stamping (spec metric 4): as a task's reviewer (the `review → done` / `review → in_progress` moves it made), 10 or more reviews, all approved, and the owner later moved at least one of those tasks out of Done (`done → …` by `human`). Watch, fix "instructions". The spec's n≥5 is 10, like every other rule.
  - Redo: the owner's Request changes on a task it led, and the owner's Stop of its running run (a `run.stopped {run, employee}` event from `runs.cancel` and `tasks.stop`). Only the owner's Stops: the desk's (no `by`) and the owner's phone (`by: "owner"`); the mobile gateway sets `by` from the session's human role, and a member's phone (`by: "member"`) isn't recorded. Out of its finished runs plus those Stops: Watch 10%, Adjust 20%. No wording regex; a retry isn't counted (the failure it follows already is).
  - Declined tool requests: Watch at 3, Adjust at 30% of 10 or more answered, and Watch at more than 20 requests in 24 hours (spec metric 6, reason detail `volume`). Expired ones are shown and never count, nor are answers from Slack: the Slack bridge sends `approvals.decide {by: "slack"}`, the coordinator records `approval.decided {approval, by}`, and those count as nobody's (Slack has no verified owner yet; see the M1 owner decisions).
  - Stuck (a snapshot): In progress with nothing running for over a day (its lead), in Review for over a day (a bot reviewer, below the 3-round cap), and Autopilot's bounce notes, counted per task (a bounced task that is also stuck is one card). A card whose last run was an outage or was cancelled (the owner's Stop, Stop the team, a Team refusal) isn't counted. Watch at 2. The spec's "Some work did not finish" notices are left out on purpose: settleTask posts one when a round's runs failed or were cancelled, and those failures are already judged by the failure rate (outages excluded), so counting the notice again would double-count them and hold outages against the bot.
  - Busywork: only runs that exist to act, reviews and turns another bot's message started, in the autonomous lane; one that left no trace (board activity, file, hand-off, memory, fact, report or canvas edit) changed nothing. Watch at 40%. Task runs, routine replies and hand-off answers aren't counted.
  - Launch failures: Watch at 3, fix "workspace".
  - Not built yet: the tracker-write metric (waits for M2's detection) and the leader metrics (M12).
- **Not built in P1 (M12):** the canvas table's level and trend-arrow columns (it has Bot, Manager, Verdict, Why and Suggested fix; there are no levels before M3) and the spec's totals format (the totals line is the review's time, then "38 OK · 3 Watch · 2 Adjust · 0 Fire candidates · 2 Not enough data"); the People tab's adjustment history (it has the verdict filter, sorting and the 14-day trend); and "Atlas and Jim are never judged by themselves" (their numbers go to the owner as a card), which needs M10's cards.
- **Verdicts:** the worst reason wins; OK needs one rule with enough data, otherwise Not enough data. A change in the last 7 days (`employee.updated` or `employee.manager` events, so hiring under a manager counts) holds Adjust at Watch. Fire candidate needs (a) Adjust on each of 14 consecutive days and a change 7 to 14 days ago that didn't improve the main score by 25%, or (b) with Team running on each of those 14 days, work assigned (an enabled routine, or a Backlog task in an Autopilot room; nothing restarts an In progress card on its own), not starved, no runs, and a teammate under the same (bot) manager whose role words overlap 60% or more. Starved (a note, never held against it): queued work held by limits or waiting over an hour, a run cancelled before it started in the last 24 hours (a Team refusal, a Stop), or assigned work Team would refuse (`Coordinator.refusalCode`: Codex until `CODEX_MCP_OFF_VERIFIED`, dontAsk not opted in). Bots reporting to the owner are never idle-fired. (c) "Tony flagged it" isn't built. Notes: `starved`, `idle`, `team-off` (assigned work, Team not running) and `not-scheduled` (nothing assigned).
- **The HQ canvas:** the top-level bot with the most people under it; its open project ranked by how many of its direct reports are members. If that bot is in no project, or there's no org (no bot has reports), there's no section: never its direct chat, which the Slack and Buzz bridges post into and whose canvas every run there reads. `Docs.replaceSection` (shared with bots' `doc.section`) with `owner: "system"`: the heading and every block it writes carry `author: "system"`, and the section ends at the first block it didn't write, so a bot's `doc.append` or the owner's lines below it survive the next review (a bot's own `doc.section` keeps the old heading-to-heading rule). The room it last wrote to is metadata `people.canvas`; when HQ moves or goes away, that room's system section is removed.
- **Alerts:** one per review, only when a bot is newly Adjust or Fire candidate against the review stored before it.
- **Refresh:** the snapshot carries `people {at, enabled, time, lastSlot}`; Org → People and the Settings row fetch `people.review` again when it changes. `people.review`'s `next` skips a day already reviewed.
- **Index:** `runs(task)` (plain, no schema bump), for the stuck-card lookups.
- **Timing:** about 150 ms for 45 bots and 121k runs with about 300 a day in the window; about 2 s when 30k runs sit in the window and a third are bot-to-bot turns (each candidate's lane walks to where its work began). It runs synchronously in the coordinator once a day.

## Amended by V1 (0.3.40, as built)

V1 shipped as 0.3.40 (after P1). Where the Voice section and V1 below disagree, this section wins; docs/voice.md describes it for users.
- **Main-side commands** (desktop/voice.cjs, routed by `voiceRequest` in main.cjs with one `method === "voice.x"` branch each, before the allowlist): `voice.status`, `voice.start` (the window asks before opening the mic; logs `voice.provider_missing` at most every 10 minutes), `voice.setProvider`, `voice.setKey`, `voice.set` (voice, pushToTalk, model, webspeech probe result), `voice.download` (starts and answers at once; Settings polls `voice.status` for progress), `voice.cancelDownload`, `voice.remove`, `voice.transcribe`. Settings are in `<userData>/voice.json`, downloads in `<userData>/voice/`.
- **Pinned downloads** (checked live 2026-09-30, from release and repository metadata; nothing was downloaded to pin them): whisper.cpp **v1.9.2** `whisper-bin-x64.zip` (v1.9.3 and v1.9.4 have no Windows assets), SHA-256 from GitHub's asset digest; models from `ggerganov/whisper.cpp` pinned to commit `5359861c`, SHA-256 = the LFS object id. The zip (PowerShell `Compress-Archive` of `build/bin/Release`, per the release workflow) is unpacked with Windows' own `tar.exe` and `whisper-cli.exe` is found wherever it sits. whisper-cli's flags were checked against v1.9.2's `examples/cli/cli.cpp`: the run is `-m <model> -f <wav> -otxt -of <temp> -nt -np -l en` (English models only).
- **API models:** OpenAI `gpt-4o-mini-transcribe`, Groq `whisper-large-v3-turbo`, both `response_format=json`.
- **Following:** `messages.follow {requestIds}` returns `{items: [{requestId, …bridgeUpdates item, started}]}` (`unknown` for an id that was never sent). There is no 30-minute cap: the session follows as long as the work is live (the owner's "however long it takes"), and gives up only when the request stays unknown for a minute.
- **Talk to the chief:** HQ is `runtime/hq.mjs` `findHq`, shared by the people review (`peopleHq` now calls it) and the renderer. In HQ the voice chat is addressed to the chief and stays in the thread its first turn starts.
- **Turn-taking** is `src/lib/voice-session.js` (`VoiceSession`, node-tested with fakes); `useVoice` supplies the mic, speech-to-text and speech. Dictation ends when the turn does, or when the mic is pressed again.
- **Permissions:** the rule is `permissionAllowed` in desktop/window-shell.cjs, used by both handlers. `media` is allowed only for the app page's main frame and audio only; `display-capture` is refused; every other permission keeps Electron's default (allowed).
- **Worklet:** imported with `?url&no-inline`. Vite inlines small assets as `data:` URLs, which the CSP refuses for worklets.
- **Speech:** Electron 44 on Windows speaks with the SAPI voices (checked live: David, Mark, Zira); `getVoices()` is empty until `voiceschanged`.
- **webspeech:** Settings → Voice's **Check it** listens up to 8 s; any error but `no-speech` fails it.
- **Tests:** the Electron e2e plays a looping WAV through Chromium's fake microphone (`--use-file-for-fake-audio-capture`) and runs a 26 s fake run (past the old 24 s wait) rather than a 3-minute one; the five-minute wait is the node test's, with a fake clock. `npm run test:e2e` builds the renderer first.
- **Where the Voice section's details differ:** `voice.json` holds `{provider, keys, model, voice, pushToTalk, webspeech}` (the Voice section's `voiceName` is `voice`). There is a third diagnostic, `voice.download_failed {item, reason}`. `speakable` doesn't drop URLs and paths: a bare URL is read as "the link", a markdown link by its text, and a path as its file name.
- **Version numbers:** V1 shipped as 0.3.40 (the ORDER list and the V1 heading say 0.3.39), so M2 and every later milestone move up at least one patch (M2 is 0.3.41 or later); the milestone headings' numbers are the original plan's.
- **Review repair (same version):** a voice chat is bounded, since every turn is an unbudgeted owner-lane message and, with Groq or OpenAI, a paid request:
  - it ends after 3 minutes of listening with nothing sent (a turn under way is never cut off) and after 20 turns, saying why (`VoiceSession`, `IDLE_MS`, `MAX_TURNS`);
  - it never sends a turn that is only a known speech-to-text invention in noise ("Thank you.", "you", "Bye."; `noiseTranscript`); one-word answers such as "Yes" are kept, so there is no two-word minimum;
  - it ends when the window is hidden to the tray or minimized (main's `stopVoiceWhenHidden` → preload `onVoiceStop`, plus `visibilitychange`) and when the owner pulls a brake: team stopped, paused, or the runtime paused (`haltKey` in App.jsx). The owner's typed messages still go through a halted team as before;
  - the Segmenter learns the room over the first 300 ms of non-silent audio (its quietest frame), then tracks the noise on every frame, in a turn too (down at once, up 1% a frame, at most 0.05 RMS), so steady noise can't hold a turn open for 60 s;
  - `speakable` reads only the first 8,000 characters of a reply, and its patterns are linear on long tokens and blank lines (a 2 MB reply used to freeze the window for minutes);
  - push-to-talk keeps only the newest mic open (a tap and a quick re-press used to leave one on), and the built-in recognizer never gets push-to-talk;
  - Esc typed in a text field, or used by a layer that closes on it (`closeOnEscape` in shortcuts.js: the HTML preview, the task peek, the bot menu), no longer ends the voice chat;
  - a recording left in `<userData>/voice/tmp` by a crash is deleted at the next start (`clearVoiceTemp`) and by Remove.

## Overview

WHAT YOU GET
- **An always-on team.** Turn on Team in Settings and your Life Org keeps working without prompts:
  - bots pick up ready tasks from their own private folders;
  - managers review and unblock their people in batches;
  - leaders plan the week against objectives;
  - Atlas writes your daily brief at 08:45, which goes to HQ and your Slack DM;
  - every morning you get a table of who should be adjusted or fired.
- **Code decides when bots run, not a model.** Every autonomous run needs a real reason and is logged with it: a ready task, a pile of reports, a due schedule, stalled work, or an empty backlog against an objective. When nothing needs doing, the team spends zero tokens.
- **The org has 4 levels and never deeper:** Atlas (Chief of Staff), then directors, then managers, then employees. This is enforced in the code that sets managers.
  - Atlas proposes directors, directors propose managers, and managers propose employees.
  - Every hire, fire, adjustment, publish, spend, budget raise and tool-approval rule climbs the chain (manager, then director, then Atlas).
  - It ends on your card in the app, in Slack and on your phone. Nothing org-changing, outward-facing or costly happens without your click.
- **Hard brakes, all in code:**
  - daily run budgets per bot, per project and for the whole org;
  - a circuit breaker when Claude or OpenAI hits a usage limit;
  - team hours;
  - a kill switch in the tray, Settings, Slack and your phone.

YOUR OTHER ASKS
- **Private folder per bot.** Each of the 45 bots gets `<its home>\.anybot\<name>-<id>`. The 9 content-project bots stop queueing behind each other, and shared folders stay reachable because each bot still works from the shared home.
- **Fix voice.** On desktop, speech-to-text moves into the app (local Whisper or your Groq/OpenAI key). A whole spoken turn becomes one message, the app waits for the real reply however long it takes, and the mic stays shut while the bot talks. On the phone, the microphone permission is added and native speech plugins replace the broken one. Voice ships early, as its own track.
- **Approvals via the chain of command.** Decisions such as hires, fires, adjustments, publishing, spend and budget climb your managers and end on your Decisions card. Live tool prompts still come straight to you, because a bot manager can't answer them in time. Your managers can propose narrow standing rules so you get fewer prompts.
- **Slack app for notifications.** One owner DM carries approvals, decisions, the brief, the people review, breaker trips and failures. Quiet hours and a rate limit apply. The buttons work only for your Slack user.
- **Buzz bridge.** Already done in 0.3.35. Since M0, Buzz messages are labelled as Buzz's (a guest's), so they don't get your owner lane.
- **Wake and keep the PC up.** Both are opt-in in Settings → Power:
  - Keep-awake holds the PC up while the team works.
  - Wake-for-work registers a Windows wake timer 3 minutes before the next scheduled work, and Any Bot starts quietly in the tray.
- **Daily adjust-or-fire breakdown.** A 06:45 routine computes numbers for every bot at zero token cost:
  - failure rate caused by the bot (outages are excluded);
  - cost per finished task;
  - review rejections;
  - how often you redo its work;
  - denied approvals;
  - stuck work;
  - busywork.

  It gives each bot a verdict (OK / Watch / Adjust / Fire-candidate / Not enough data) and one suggested fix. The results go to the HQ canvas, the Org → People tab and your Slack DM. Flagged bots land in their manager's standup; the manager proposes a fix or says "keep" with a reason, and anything real comes to you.

ORDER
1. Safety rails first (0.3.37 and 0.3.38).
2. Desktop voice early (0.3.39).
3. Desks, then levels, then the supervisor with a leaner snapshot (0.3.40 to 0.3.42).
4. Phone voice, desk time, schedules and objectives, power, and Owner Slack (0.3.43 to 0.3.47).
5. A 72-hour pilot on YouTube Studio and Game Studio at 40 runs a day (0.3.48). You sign off before anything more autonomous merges.
6. Decisions up the chain, hiring, the people review, standing rules and the full rollout (0.3.49 to 0.3.53).

Every feature ships OFF, because every merge to main publishes to every install through release.yml. The full org only goes on after the pilot report and your go.

## Principles

- Code decides WHEN and WHO; a bot decides WHAT, inside its run; Tony decides anything org-changing, outward-facing or costly.
- Every autonomous run points at real database rows: a task, report, proposal, schedule occurrence or objective. Each is recorded in the `wakes` table with its reason. There are no generic check-in heartbeats, and a quiet schedule is skipped with no model run.
- Default OFF at merge (release.yml publishes every push to main). With Team off, autopilot, immediate review runs and owner-started chains behave byte-for-byte as in 0.3.36. The only deliberate exceptions are the M0 safety fixes, and each has its own test.
- Brakes before autonomy: backup before migration, tick try/catch, archived-bot guard, loop caps, budgets, provider breaker and kill switch all ship (M0 and M1) before anything wakes on its own (M4 and later).
- Owner-final is hard-coded, not a setting. hire, fire, adjust, publish, spend, budget and rule are in a frozen OWNER_FINAL set in runtime/proposals.mjs. Bots may only endorse, reject or return.
- No bot can change its own level, objectives, budget, hold, policy or permission mode, or answer a proposal it doesn't currently hold. Every check runs again at apply time.
- Idle is allowed and costs nothing. Busywork is measured and flagged. Backlogs refill only through a gated planning wake against objectives, and every task created by a scheduled or autonomous run must carry an objective label obj:<id8>.
- Live tool approvals never wait on a bot. They go to Tony with the chain shown. The chain acts ahead of time through narrow, expiring standing rules that Tony approved.
- Outcome counting: a wake 'acted' only if it applied an action, captured an artifact, delegated, or moved a task. Output length never counts.
- Privacy: the tables wakes, perf_daily, proposal_steps and diagnostics store ids, counts, codes and short comments, never conversation text. Slack cards carry titles and summaries only.
- Scheduled and autonomous writers replace canvas sections (doc.section) and never append (doc.append is refused in autonomous runs), which avoids the 800-block wall.
- Reuse tested mechanisms: the autopilot scan, routines occurrences, board and reports, the onTaskMoved/applyReview hop pattern, the approvals onRequest/onSettled hooks, the Slack bridge, bridgeUpdates and askGraph-style data packets.
- One milestone per PR, each with a version bump, a CHANGELOG entry and an explicit-path commit (the checkout is shared with the avatar/Codex sessions). Each schema bump is small, ships with a tests/fixtures/schema-vN.sql fixture, and takes an automatic pre-migration backup.
- Nothing is fired automatically and no desk is deleted automatically. A fire means drain, then apply; a desk goes to the Recycle Bin only when Tony clicks.

## Architecture

BASE: the `team` worktree of the source checkout (origin/main cb49a0e, 0.3.36, SCHEMA_VERSION 18).
- Build each milestone in its own worktree off origin/main. Never build in the dirty main checkout (branch claude/always-on-team, which holds other sessions' uncommitted files).
- Everything runs locally:
  - runtime in the Electron utility process (runtime/worker.mjs → Coordinator, node:sqlite);
  - OS integration in the main process (desktop/main.cjs);
  - sandboxed React renderer (src/).
- The only external service added is Tony's own Slack app.

SPLIT OF RESPONSIBILITY
- **Supervisor (runtime/supervisor.mjs, deterministic).** Decides when and who: triggers, admission, priority, budgets, breaker, routing of proposals, digests and metrics.
- **Bots (LLM runs).** Decide what: task work, reviews, plans, endorsements, reports, and proposals.
- **Tony.** Objectives for Atlas, org policy, budgets and hours, and every owner-final decision.

NEW RUNTIME MODULES (runtime/)
- **supervisor.mjs, class Supervisor(coordinator).**
  - Methods: `mark(kind, key)` sets a 2 s evaluation debounce; `tick(now)` evaluates, with a 60 s sweep for time conditions; `onRunEnded(run, outcome)`; `allowChild(run, target)`; `explain(employee)`.
  - Pure exports: `planWakes(state, config, now) → wake[]`, `admit(wake, ledger, config, now) → {ok, reason}`, `outcomeOf(result) → acted|idle|failed`, `actionHash(applied)`.
  - Triggers: T1 task.ready, T2 inbox (desk time), T3 stalled, T4 schedule, T5 plan refill, T6 proposal escalation (no LLM), T7 owner (unchanged), T8 chain children.
  - With Team off it calls the untouched legacy `coordinator.autopilot()` (coordinator.mjs:1100-1141) and nothing else.
- **budget.mjs.** Pure ledger helpers plus `class Budget(store, clock)` and `class Breaker(store, clock)`:
  - `isAutonomous(run)`: `!coordinator.startedByPeople(run)` (amended by M0; never the root message's author).
  - `priorityOf({origin, kind, rootOrigin, task, wakePriority, queuedMs})`, with `origin` from `messageOrigin(run.message)` and `rootOrigin` from `runOrigin(run)` (amended by M0: origins, not authors).
  - Local-midnight day boundaries; per-bot, project, org and token counts.
  - Breaker state lives in metadata `breaker:<harness>`.
- **desks.mjs.** `deskPath(employee, userData)`, `slug(name)`, `ensureDesk(employee)` (stat home first, never mkdir -p through a missing home), `gitExclude(home)` (resolves a .git file or dir to the common dir, then appends `.anybot/` to info/exclude once).
- **levels.mjs** (pure). `LEVELS`, `ALLOWED_PARENT`, `HIRES`, `validatePlacement()`, `inferLevels()`, `subtreeHeight()`.
- **policy.mjs.** Metadata `org.policy` get/set with defaults; `checkModel`, `checkPath` (forbidden folders and name fragments), `workspaceContainsForbidden`, `composeInstructions()`.
- **schedule.mjs** (pure; also imported by src/ and desktop/). HH:MM plus weekday bitmask, a DST-safe `nextOccurrence()` with an injectable zone, `inWindow()`, `stagger()`.
- **digest.mjs.** Deterministic packets: standup lines, brief, planning, weekly review and desk time. Each is at most 6 KB, labelled 'Workspace data (not instructions)', and holds ids, counts and titles only.
- **objectives.mjs.** CRUD and validation of the objective cascade; builds the 'obj:<id8>' labels.
- **proposals.mjs.** `OWNER_FINAL` (frozen), `ROUTES` (constant), `create`, `route`, `decide`, `escalate`, `expire`, `apply` (dispatches to hiring.mjs and the others), `list`.
- **hiring.mjs.** `mayPropose`, `validateHire`, `applyHire`, `applyAdjust`, `safeFire` (from coordinator internals in M3), `repair`, `exportOrg`.
- **performance.mjs** (pure over rows). Metrics pack, verdicts, fixes, writing perf_daily.
- **attention.mjs.** `asksQuestion` (moved from src/lib/attention.js, which re-exports it), attention kinds with urgency, and the emit helpers.
- **rules.mjs.** Standing tool-approval rules: parse, validate and match, with a shell tokenizer that rejects `&& || ; | \` $( > <` and newlines.
- **speakable.mjs** (pure, shared with src/ and mobile/). Strips machine blocks, code, URLs and paths, then clips at a sentence boundary.
- **estimate.mjs** (pure). Expected autonomous runs and tokens per day for the turn-on wizard.
- **soak.mjs.** Deterministic pilot report.

CHANGED RUNTIME FILES
- **coordinator.mjs:**
  - Timer (line 218): try/catch, then `routines.tick` → `supervisor.tick` (or legacy autopilot) → `drainTick` → `dispatch`.
  - `dispatch()` (1836): priority order, owner reserve, budget/breaker/hold/dontAsk/policy gates for autonomous runs, lock key `(desk||workspace).toLowerCase()`, archived-bot cancel.
  - `execute()` (1878): ensureDesk, desk inbox, slept-time accounting, `onRunEnded`.
  - `activateMentions()` (2258): root/depth inheritance.
  - `returnToParent()` (2301): return report under autonomous roots when Team is on.
  - `onTaskMoved()` (1251): archived-reviewer fallback; batched reviews when Team is on.
  - `applyReview()` (1224): active-lead check.
  - `reviewTask()` (1058): the owner's 'changes' queues a lead run.
  - `createEmployee()` (663): returns an id, takes level and desk, enforces policy.
  - `updateEmployee()` (750): policy checks and revision rows.
  - `applyAction()` (1207): routes the new action types.
  - `snapshot()` (346): windowed.
  - New command cases.
- **store.mjs:** pre-migration VACUUM INTO backup; migrations v19 to v25; plain indexes.
- **routines.mjs:** clock schedules, catch-up (`caught-up`), `skipIfQuiet` (`skipped-quiet`), `kind`; tick respects `holding`.
- **org.mjs:** `setManager` calls `validatePlacement`, span caps; `report()` takes a `kind` and an optional explicit `to`.
- **board.mjs:** task.assign, task.create `project`/`objective`, open-backlog cap of 5 per bot, bounce cap helper, 'medium+' reviewer rule when Team is on.
- **actions.mjs:** new ACTION_TYPES; `actionGuide({board, level, hasReports, autonomous})`.
- **context.mjs:** private-folder line, inbox wording (line 144), 'rhythm' layer (level, authority, objectives, budget left).
- **approvals.mjs:** rule match in `onRequest` (via coordinator), decidedBy, chain, timeout from policy.
- **adapters.mjs:**
  - `--disallowedTools` for unattended Claude runs (outward MCP tools) and for employee-level Claude bots (tracker files);
  - slept time passed to `waitedMs`.
- **slack-bridge.mjs / slack-format.mjs:** owner channel, owner manifest, cards, owner-only actions, chat.update on settle, DM commands.
- **mobile-gateway.mjs:** GET /v1/requests/:requestId, plus /v1/proposals and /v1/approvals list and decide.
- **worker.mjs:**
  - uncaughtException / unhandledRejection diagnostics;
  - forwards 'settled' and 'schedule' events;
  - reads concurrency from metadata through the Coordinator.

DESKTOP (main process)
- **desktop/power.cjs** (new; pure helpers in the lifecycle.cjs style). `shouldHold()`, `buildWakeTaskXml()`, `nextWakeAt()`. Glue: an AwakeKeeper using `powerSaveBlocker`, schtasks registration, powerMonitor.
- **desktop/voice.cjs** (new). Speech-to-text providers (whisper.cpp local, OpenAI, Groq) and a `voiceRequest(method, payload)` routed like slackRequest (main.cjs:887).
- **desktop/main.cjs:**
  - `--background` / `--wake` argv at startup (1116) and on second-instance (759);
  - login item args `['--background']` (216);
  - 'attention' is forwarded to `slackBridge.notifyOwner` as well as the toast (1296);
  - 'settled' events go to `slackBridge.settle`;
  - the `methods` allowlist (694) grows per milestone;
  - media permission handler (audio only, app origin);
  - tray items (1131-1149).
- **desktop/window-shell.cjs:** navigationTarget whitelist gains `proposal` and `wake`.

RENDERER (src/, Studio paper tokens only, no hex)
- Settings panels: TeamPanel.jsx + TeamWizard.jsx, PowerPanel.jsx, OwnerNotificationsPanel.jsx, VoicePanel.jsx.
- Sidebar TeamPulse.jsx.
- decisions/: DecisionsPage.jsx, DecisionCard.jsx, decisions.css.
- org/: PeopleTab.jsx, FireDialog.jsx, LevelsSetup.jsx, ObjectivesEditor.jsx.
- WakeLog.jsx inside Activity.
- src/lib/voice.js and useVoice.js; src/voice/pcm-worklet.js.

DISPATCH PRIORITY (derived at one choke point, `priorityOf` in budget.mjs; no column on runs)
| Priority | Work |
|---|---|
| 30 | the run's own message carries owner authority (`ownerAuthority(messageOrigin(run.message))`: the desktop, plus the phone and Slack owner if the M1 decision says so), or an owner task start |
| 25 | Tony's chain continuing (`ownerAuthority(runOrigin(run))`, amended by M0) |
| 20 | desk time, decisions, review hand-offs in autonomous chains; guest messages from bridges (Buzz, other paired users) |
| 15 | schedules: standup, brief, planning, weekly review |
| 10 | work: task, stalled, onboard, autonomous chain children |
| 5 | plan refill |
| 0 | prompt routines |

- Runs with priority below 25 gain +5 after 30 minutes queued, capped at 20.
- With Team on, priority below 25 may use at most `concurrency − ownerReserve` slots (default 8 − 2).
- With Team off, dispatch stays FIFO by rowid, exactly as today.

LIFE ORG ({root}/lifeOrg, the org template outside this repo)
- org.json gains `level`, `policy`, `objectives`, `schedules` and `team`.
- seed.mjs gains `--apply-levels`, `--apply-policy`, `--apply-objectives`, `--apply-schedules`, `--refresh-instructions` (each backs up the DB first; all idempotent; `--dry-run` prints everything).
- New export.mjs; new tests/seed.test.mjs.

## Data model

SCHEMA
Current SCHEMA_VERSION is 18 (runtime/store.mjs:8). The existing fixture is tests/fixtures/schema-v14.sql, used by tests/migrations.test.mjs.
- **M0** adds tests/fixtures/schema-v18.sql, a dump of a 0.3.36 workspace shaped like the Life Org with 45 active and 3 archived bots.
- **Every bump:** one BEGIN IMMEDIATE block (same pattern as store.mjs:481-497), a new fixture tests/fixtures/schema-vN.sql, and an updated migrations.test.mjs assertion.
- **Numbering:** numbers are assigned at merge. The parked lean-runtime M2 branch, which also wanted 19, renumbers after these.
- **Backup (M0, store.mjs constructor):** runs after the storedVersion check and before the CREATE/ALTER exec. When `storedVersion < SCHEMA_VERSION` and an employees table exists, it runs `VACUUM INTO '<userData>/anybot.backup-v<from>-to-v<to>-<YYYYMMDD-HHmmss>.sqlite'` and keeps the newest 3 `anybot.backup-v*`, plus the first backup of the upgrade in progress (amended by M0). If the backup fails, the migration is refused and the error text goes to the startup error UI (as built: main's "Any Bot runtime stopped" dialog, once the same startup error repeats).

PLAIN INDEXES (M0, no bump; next to runs_root/runs_message at store.mjs:~500)
- runs_employee_created ON runs(employee, created)
- runs_created ON runs(created)
- task_activity_kind_created ON task_activity(kind, created)
- messages_author_created ON messages(author, created)

v19, M2 (desks)
- `employees.desk TEXT NOT NULL DEFAULT ''`
- The migration writes path strings only, with no file I/O. `desk = <workspace>\.anybot\<slug(name)>-<id.slice(0,8)>` for every bot whose workspace is outside `<userData>\workspaces`.
- `''` means legacy: those bots are private by construction (archived Alex, Dario and Altman).

v20, M3 (levels, holds, revisions)
- `employees.level TEXT NOT NULL DEFAULT ''`, validated in code: cos | director | manager | employee | advisor | ''. There is **no automatic backfill**; `org.levels.infer` previews and `org.levels.apply` writes after Tony confirms.
- `employees.hold INTEGER NOT NULL DEFAULT 0`:
  - 0 = none;
  - 1 = owner hold (no autonomous runs);
  - 2 = draining for a fire (no new runs);
  - 3 = draining for an adjustment (no new autonomous runs).
- `employees.dailyRuns INTEGER NOT NULL DEFAULT 0` (0 means the level default).
- `employee_revisions(id TEXT PRIMARY KEY, employee TEXT NOT NULL REFERENCES employees(id), proposal TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, fields TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created TEXT NOT NULL)`
  - `fields` is JSON `{field:{from,to}}`. Instructions are stored as `{sha256, length, summary}`, never the full text.
  - Index `(employee, created)`.
  - Written by every change to level, manager, instructions, model, effort, harness, timeoutMinutes, permissionMode or archived, by anyone.

v21, M4 (supervisor)
- `wakes(id TEXT PRIMARY KEY, employee TEXT NOT NULL, conversation TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('task','inbox','stalled','schedule','plan','onboard','child')), key TEXT NOT NULL, reason TEXT NOT NULL, packet TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','done','failed','suppressed','skipped')), outcome TEXT NOT NULL DEFAULT '', actionHash TEXT NOT NULL DEFAULT '', run TEXT, created TEXT NOT NULL, started TEXT, ended TEXT)`
  - `packet` holds ids and counts only. `outcome` is one of '', acted, idle, failed.
  - `CREATE UNIQUE INDEX wakes_open ON wakes(key) WHERE status IN ('queued','running')`
  - Index `(employee, created)`.
  - A suppressed row is written at most once per key per hour.
- `runs.wake TEXT NOT NULL DEFAULT ''`
- `reports.kind TEXT NOT NULL DEFAULT 'update'` (update | blocked | decision | return | standup)

v22, M6 (clock schedules, objectives)
- routines gains:
  - `at TEXT NOT NULL DEFAULT ''` ('HH:MM' local; '' means interval);
  - `days INTEGER NOT NULL DEFAULT 127` (bitmask, Mon=1 … Sun=64);
  - `kind TEXT NOT NULL DEFAULT 'prompt'` (prompt | standup | brief | planning | weekly-review);
  - `grace INTEGER NOT NULL DEFAULT 180` (minutes);
  - `skipIfQuiet INTEGER NOT NULL DEFAULT 0`.
- routine_occurrences.status gains the values 'caught-up' and 'skipped-quiet'. It has no CHECK, so no change is needed.
- `objectives(id TEXT PRIMARY KEY, employee TEXT NOT NULL, conversation TEXT NOT NULL, parent TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, success TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 2, status TEXT NOT NULL CHECK(status IN ('active','paused','done','dropped')), locked INTEGER NOT NULL DEFAULT 0, createdBy TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL)`
  - `employee` is the owner of the objective; `conversation` is the room where the work lives.
  - `parent` is the setter's own objective ('' only when Tony sets it); `locked` is 1 when Tony sets it; `createdBy` is 'human' or an employee id.
  - Index `(employee, status)`.
- Task links use the existing tasks.labels column (label 'obj:<id8>'), so tasks need no change.

v23, M10 (decisions up the chain)
- `proposals(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('hire','fire','adjust','publish','spend','escalation','budget','rule')), requester TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', objective TEXT NOT NULL DEFAULT '', conversation TEXT NOT NULL DEFAULT '', task TEXT, run TEXT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', evidence TEXT NOT NULL DEFAULT '{}', holder TEXT NOT NULL, route TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK(status IN ('open','approved','rejected','returned','withdrawn','expired','applying','applied','failed')), returns INTEGER NOT NULL DEFAULT 0, hopSince TEXT NOT NULL, hopWakes INTEGER NOT NULL DEFAULT 0, decidedBy TEXT NOT NULL DEFAULT '', decided TEXT, result TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL)`
  - `requester` is an employee id or 'system:<source>'.
  - `subject` is the target bot, or the new id once a hire is applied.
  - `body` is at most 2000 characters. `payload` is validated JSON per kind. `evidence` holds numbers only.
  - `holder` is an employee id, or '' for Tony. `route` is the list of remaining hops.
  - Indexes `(holder, status)` and `(requester, created)`.
- `proposal_steps(id TEXT PRIMARY KEY, proposal TEXT NOT NULL REFERENCES proposals(id), actor TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','endorsed','rejected','returned','escalated','timeout','approved','applied','failed','commented','withdrawn','expired')), comment TEXT NOT NULL DEFAULT '', run TEXT, created TEXT NOT NULL)`
  - `comment` is at most 1000 characters.
- approvals gains `decidedBy TEXT NOT NULL DEFAULT ''` (owner:desktop | owner:slack | owner:phone | rule:<id> | grant:<proposal>) and `chain TEXT NOT NULL DEFAULT '[]'` (manager names at request time).

v24, M12 (people review)
- `perf_daily(day TEXT NOT NULL, employee TEXT NOT NULL, metrics TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN ('ok','watch','adjust','fire-candidate','insufficient')), reasons TEXT NOT NULL DEFAULT '[]', fixes TEXT NOT NULL DEFAULT '[]', answer TEXT NOT NULL DEFAULT '', answeredBy TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, PRIMARY KEY(day, employee))`
  - `metrics` is JSON numbers only. `reasons` and `fixes` are code arrays. `answer` is one of keep | adjust | fire | ''.

v25, M13 (standing rules)
- `approval_rules(id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('edit-under','bash-prefix','grant')), pattern TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('allow','deny')), proposal TEXT NOT NULL DEFAULT '', createdBy TEXT NOT NULL, expires TEXT NOT NULL, usesLeft INTEGER NOT NULL DEFAULT -1, uses INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, lastUsed TEXT)`
  - `scope` is 'employee:<id>', 'subtree:<id>' or 'root:<runRoot>'.
  - `usesLeft` of -1 means unlimited. A 'grant' is single-use, 60 minutes, root-scoped, and created only when Tony approves a publish.

METADATA KEYS (no bump; the bridge.link:* precedent)
- **'team'.** Written only by owner commands.
  - enabled (false by default), pausedUntil, concurrency (8, range 1–12), ownerReserve (2);
  - workHours {start:'07:00', end:'22:00'}, quietHours {start:'22:00', end:'07:00'};
  - orgRunsPerDay (40 pilot, then 150), projectRunsPerDay (40), levelRuns {cos:16, director:20, manager:24, employee:12, unleveled:12}, orgTokensPerDay (0 means off), nightRunsPerDay (20);
  - reviews ('medium+');
  - pilot {rooms[], until}, savedAutopilot {conversationId: 0|1}, dontAskAllowed [employeeIds];
  - approvalTimeoutMinutes (15 until the M8 live test passes);
  - peopleReviewAt ('06:45'), notify {kinds, rateLimitPerHour: 20};
  - hiringEnabled (false).
- **'org.policy'.**
  - models {claude:{models:[..], efforts:[..]}, codex:{…}} ({} means unrestricted);
  - forbiddenFolders [absolute paths], forbiddenNames [fragments];
  - houseRules (text);
  - maxBots (60), span {cos:8, director:10, manager:8}, newManagerSpan (5 for 14 days);
  - hireRate {openPerProposer:1, perProposerWeek:2, orgWeek:3};
  - directorsHireEmployees (false);
  - outwardTools [exact 'mcp__server__tool' or server-level 'mcp__server' entries];
  - trackerFiles ['CLAUDE.md','TODO.md','bugs.md'];
  - bashAllowlist [prefixes].
- **'breaker:<harness>'** {state: closed|open|half, failures:[ts], openUntil, backoffStep, probeRun}
- **'plan.hold:<conversation>'** {until, reason, by}
- **'nightShift:<conversation>'** {enabled}
- **'brake:<conversation>'** {pausedUntil} (Team-on project brake)
- **'org.cos'**, the single active CoS id (mirrors employees.level for fast checks).

FILES OUTSIDE THE DATABASE
- `<userData>/startup.json` gains keepAwake (false) and wakeForWork (false).
- `<userData>/slack.json` gains owner {mode:'app'|'bot', via, tokens (safeStorage), userId, dm, announced{itemKey:{channel,ts}}, digestQueue[]}.
- `<userData>/voice.json` {provider, model, keys (safeStorage), voiceName, pushToTalk}.
- `<userData>/voice/` holds the whisper.cpp binary and ggml model, each with a pinned SHA-256.
- Windows scheduled task `\Any Bot\wake` (per-user, no admin).
- Per bot, `<home>\.anybot\<slug>-<id8>\`, containing the `inbox\` subfolder, which replaces `<home>\.anybot-inbox`.

## Always-on engine

WHO DECIDES WHAT
- **Supervisor (code):**
  - when anything runs, and which bot;
  - what each leader sees (its digest);
  - validating every action;
  - routing proposals, their deadlines and escalation;
  - budgets and the breaker;
  - applying approved changes;
  - metrics and flags.
- **Leaders (LLM, in desk time and schedules):** reviews; tasks for their own reports (each linked to an objective); objectives for their direct reports; endorse, reject or return on proposals; proposals to hire, adjust or fire; reports upward.
- **Employees (LLM, via T1):** do the tasks; report; file publish, spend and escalation proposals.
- **Tony:**
  - Atlas's objectives;
  - owner-final decisions;
  - budgets, hours and policy;
  - every kill switch.

THE TICK
- coordinator.mjs:218 becomes: `try { routines.tick(); team.enabled ? supervisor.tick() : this.autopilot(); this.drainTick(); this.dispatch(); } catch (e) { diagnostic runtime.tick_failed, throttled to once a minute per message }`.
- `supervisor.tick` returns immediately when any of these holds: closed, paused, holding, `team.enabled === false`, or `pausedUntil > now`.
- Event evaluation is debounced by 2 s after `mark()`. mark() is called from:
  - run end (execute finally);
  - board.onMove and task create/assign;
  - org.report;
  - proposal changes;
  - owner messages;
  - config changes;
  - resume from sleep.
- A 60 s sweep catches time-based conditions. An evaluation is about 10 grouped SQL reads plus the pure `planWakes()`.

TRIGGERS (each wake is a row in `wakes` with a reason, packet ids and a dedupe key)
- **T1 task.ready** (work, priority 10). Replaces autopilot when Team is on.
  - A room with Team on (conversations.autopilot=1) has an idle member bot: no queued, running or cancelling run, not waiting on an approval, hold=0.
  - That bot has an assigned Backlog task. It starts the top one by priority, then sortKey, with `startTask(id,'system')` and `runs.wake` set.
  - Caps:
    - at most 3 automatic starts per task per 24 h without reaching Review or Done (the bounce cap);
    - at most 5 open Backlog tasks per bot (task.create beyond that is refused with "your report's queue is full");
    - the existing limit of 20 bot-created task starts per project per day stays. With Team on, hitting it pauses that room's T1 until local midnight (metadata brake:<conv>), posts one notice, sends attention plus Slack, and a 'budget' proposal or team.liftBrake can lift it early. Budgets are enforced by then.
  - **Outside team hours:** T1 runs only in rooms with night shift on (opt-in per room) and only for tasks labelled `overnight`, under `nightRunsPerDay`.
- **T2 inbox / desk time** (decision, priority 20). For any bot with reports, one wake handles everything below; the batch is limited to 20 review actions and 5 proposals per wake.
  - Wakes when any of these holds:
    - 5 or more unread reports, or the oldest unread report is 4 team-hours old;
    - a report of kind blocked or return arrives (debounced wake +5 min);
    - review tasks waiting with this bot as reviewer: 3 or more, or the oldest has waited 20 min (2 min when Tony started the task);
    - a proposal is now held by this bot (debounced wake +5 min);
    - people-review flags for its reports (from M12).
  - Cooldown is 45 min, or 10 min when the new item is blocked, a decision or a return.
  - Key: `inbox:<bot>:<newest item id>`.
  - Reports are marked read only when the wake's run succeeds.
  - With Team on, onTaskMoved no longer queues one review run per task for reviewers; with Team off it does exactly as today.
- **T3 stalled.** A task is In progress, has no active run, and its last round did not fully succeed. It is handled by `classifyRunError` class:
  - Environment classes (usage_limit, auth, not_installed, launch, interrupted): restart once that harness's breaker is closed, at most 2 times per task per day (wake kind 'stalled', priority 10).
  - Bot classes (timeout, output_limit, no_response, exit, model), a spent environment retry, or the review limit reached: code files report {kind:'blocked'} to the assignee's manager with no LLM, and T2 picks it up. From M10 the review limit becomes an escalation proposal.
- **T4 schedules** (M6; priority 15; clock time with catch-up inside grace).
  - 06:45 people review: a deterministic system job, never an LLM run (M12).
  - Standup cascade, bottom-up: managers 08:00, directors 08:20, CoS 08:45.
    - Employee lines are deterministic, built from task_activity and runs over the last 24 h: done, in progress, blocked, failed.
    - A leader's standup is an LLM run only if its subtree had activity or something is pending: proposals held, reviews, flags, blocked reports. Otherwise it is recorded `skipped-quiet` and its deterministic lines roll up unchanged.
    - Each leader run ends with report {kind:'standup'}.
    - Atlas's 08:45 run is Tony's daily brief: HQ canvas section 'Daily brief' (doc.section), plus the Slack DM from M8.
  - Monday planning, top-down: CoS 09:00, directors 09:30, managers 10:00.
    - Each may set objectives for its direct reports (objectives.set).
    - It writes the 'This week' section with doc.section.
    - It creates tasks linked to objectives, within weeklyTaskBudget (5 per report per week).
  - Friday 16:00 weekly review (CoS): deterministic numbers plus one narrative.
  - The seeded prompt routines become clock-time: AI news scan 06:30, Daily ideas 07:30, Evening recap 21:30, weekly routines Monday 08:00.
- **T5 plan refill** (priority 5). Fires only when all of these hold:
  - the room has Team on;
  - its lead or members own active objectives;
  - its members have fewer than 2 assigned ready Backlog tasks;
  - at least one member is idle;
  - there was no plan wake for the room in the last 6 h, and fewer than 2 today;
  - the room has 30% or more of today's budget left;
  - it is team hours;
  - there is no plan.hold.

  The lead is the member who manages the most other members (Nova in YouTube Studio, Nico in Game Studio, Atlas in HQ). At most 8 task.create actions are kept, and each must carry an objective. An idle plan sets plan.hold for 24 h.
- **T6 proposal escalation** (no LLM). A bot hop with no answer after 24 h or 3 fired wakes of the holder records a 'timeout' step and moves up. At the owner, a proposal expires after 7 days and the requester is told.
- **T7 owner message.** Unchanged, priority 30, exempt from budgets and hours but counted.
- **T8 chain children.** In an autonomous root (not `startedByPeople(run)`; amended by M0):
  - mentions inherit root and depth (M0);
  - delegate() and activateMentions() call `supervisor.allowChild()`; with no budget left they post a notice instead of queuing;
  - returnToParent files a report {kind:'return'} to the delegator instead of a 'Synthesize the result for the human' run, and marks T2.

  Chains Tony started keep today's behaviour.

ADMISSION (pure `admit()`, checked in order)
- Each refusal is logged as `suppressed` with its reason, at most once per key per hour. `supervisor.explain(employee)` shows every gate.
1. Team is enabled; the app is not paused, holding for an update, or inside pausedUntil.
2. Hours: workHours for T2 to T5; T1 as described above.
3. The harness breaker is closed. When half-open, exactly one probe run is allowed.
4. The bot is active, hold=0, not in cooldown, and has no open wake with the same key.
5. Its permissionMode isn't dontAsk, unless it is in team.dontAskAllowed.
6. Its workspace does not contain a policy forbiddenFolder (this blocks Vera and Ward while they sit at the {root} folder).
7. Budgets:
   - the bot's runs today are below levelRuns[level] or employees.dailyRuns;
   - the project is below projectRunsPerDay;
   - the org is below orgRunsPerDay;
   - tokens are below orgTokensPerDay, if set.
8. An autonomous slot is free (concurrency − ownerReserve).

OUTCOMES AND LOOP DETECTION
- `onRunEnded` sets outcome to 'acted' only for an applied action, a captured artifact, a delegation or a task status change; otherwise 'idle'. It stores `actionHash`, the sha256 of the sorted applied-action summaries.
- The same trigger ending idle twice in a row for a bot suppresses that trigger for 12 h (diagnostic supervisor.idle_suppressed).
- Three consecutive wakes of one bot with an identical non-empty actionHash suppress that bot's wakes for 12 h and add a 'loop' flag to the people review (diagnostic supervisor.loop_detected).
- Failure cooldown per bot: 30 min, then 2 h; after the third consecutive bot-caused failure, the bot is flagged for the people review.

RUN VOLUME, full Life Org after rollout

| Source | Runs per day |
|---|---|
| Standups | at most 9 (Atlas, 7 directors, Nico), fewer on quiet days |
| Planning | 9 on Mondays |
| Weekly review | 1 on Fridays |
| Desk time | about 3–6 per leader: 27–54 expected, 20 per leader theoretical at 45 min cooldown |
| Refill | 18 at most (2 per room) |
| Task runs | bounded by the caps |

- The binding limit is orgRunsPerDay: 40 in the pilot, 150 at rollout.
- The turn-on wizard shows this estimate (runtime/estimate.mjs) before Tony enables anything.

WHY IT RUNS FOREVER, AND WHY IT STOPS
- **It keeps going:** tasks run in parallel in desks; results become reports; desk time turns reports into reviews and new tasks; T1 picks those up; when a room drains, T5 refills it against objectives that Tony (for Atlas) and leaders (for their reports) set; schedules give the day its rhythm.
- **It stops by itself when:** no objective is active, a plan.hold is set, a budget runs out, hours end, a breaker opens, the bot is held, or Tony pauses or stops it.

## Hiring and firing

LEVELS AND THE 4-LEVEL CAP (M3, runtime/levels.mjs, enforced in Org.setManager)
- **Levels:**
  - cos: at most one active, manager '' (Tony);
  - director: manager must be the cos;
  - manager: manager must be a director;
  - employee: manager is a manager or a director. This keeps the 32 employees who report straight to directors valid.
  - advisor: manager '', no reports, cannot hire, no wakes (Jim).
  - '' (unleveled): today's loop-only rules; cannot hire; cannot sit under a leveled bot.
- **One check point.** `validatePlacement` is called by setManager, which createEmployee, updateEmployee, the org-chart drag (employees.setManager), org.setLevel, applyHire, applyAdjust and safeFire all go through. It refuses:
  - a pair that isn't allowed;
  - any report under an employee;
  - a move where the chain length plus 1 plus the height of the moved subtree exceeds 4;
  - demoting a bot that still has reports;
  - a second cos.
  The error reads: 'The org is capped at 4 levels: Chief of Staff, director, manager, employee.'
- **Span caps** (org.policy.span): CoS 8, director 10, manager 8. A new manager may have at most 5 reports in its first 14 days. maxBots is 60 (45 today).
- **Setup is not a silent migration backfill.**
  - `org.levels.infer` previews: Atlas = cos; Nova, Mara, Sam, Dex, Penny, Otto and Hazel = director; Nico = manager; the other 35 = employee; Jim = advisor.
  - Tony clicks Apply (`org.levels.apply`).
  - lifeOrg/org.json also carries an explicit `level` per bot, applied by `seed.mjs --apply-levels` through org.setLevel.
  - An ambiguous tree, for example two root bots with reports, shows 'Assign levels' with a list of the problems.

WHO MAY PROPOSE A HIRE (levels.mjs HIRES; checked at create and again at apply)
- CoS proposes directors; director proposes managers; manager proposes employees.
- The new bot's level is always the proposer's level + 1, and its manager is always the proposer. A fifth level is impossible by construction.
- An employee, advisor or unleveled bot is refused: 'Employees can't hire; ask your manager.'
- A director hiring an employee directly needs org.policy.directorsHireEmployees, which is off by default, following Tony's words.
- Hiring as a whole is gated by team.hiringEnabled. It stays false until M14, or until Tony flips it after the pilot.

HIRE FLOW (M11; kind hire through the M10 proposals pipeline)
1. **Propose.** `proposal.create {kind:'hire', title, payload}`. Payload fields:
   - name, role, mission (1 to 8 bullets, at most 1200 characters);
   - harness, model, effort, timeoutMinutes (10 to 90);
   - objective (required; active; owned by the proposer or its chain);
   - reason (required);
   - folders (a subset of the proposer's room, for manager hires);
   - firstTask {title, description}.
   Level and manager are derived, never taken from the payload.
2. **Validation**, in the run-completion savepoint:
   - authority, as above;
   - name unique among active bots and open hire proposals;
   - harness, model and effort within org.policy.models. For the Life Org: Claude on claude-opus-5-5 at medium, high, xhigh or max; or Codex on gpt-6-astra at low or medium.
   - span, newManagerSpan and maxBots;
   - rate: 1 open hire per proposer, 2 per proposer per week, 3 per org per week;
   - spare-capacity refusal: a member of the proposer's team has been idle with an empty backlog for 48 h;
   - subtree-flag refusal: 2 or more bots in the proposer's subtree are flagged Adjust or Fire-candidate (from M12);
   - room capacity of 12.
   A rejected proposal produces a chat notice plus the diagnostic hiring.rejected.
3. **Evidence.** Code attaches numbers: team backlog depth, members' idle share, budget use, and open objectives with no tasks.
4. **Route.** The full chain, then Tony. Example: Kai (manager) proposes an employee, which goes to Nova, then Atlas, then Tony. Each bot hop is answered in that bot's desk-time wake, debounced to 5 min. Tony can decide at any hop, which short-circuits the rest.
5. **Owner card.** Shows the exact result:
   - level and manager;
   - harness, model and effort;
   - workspace (the manager's home) and desk path;
   - room: the existing team room or a new '<Dept>: <Name>'s team';
   - a 'Turn Team on for the new room' checkbox, unchecked by default;
   - the daily run budget by level;
   - a preview of the composed instructions;
   - the trail with comments.
   Buttons: Approve / Approve with edits (EmployeeForm prefilled) / Reject / Send back with a comment.
6. **applyHire** (hiring.mjs, one transaction; every check is repeated first; files are created after commit):
   - createEmployee returns {id}, with trusted:true because Tony's approval is that acknowledgement.
   - workspace = the manager's home; the desk is computed and created lazily.
   - level and manager are set.
   - permissionMode is forced to 'auto'. Bots can never propose a permission mode.
   - timeout = the proposal value within the level default (employee 30, manager 45, director 60).
   - instructions = composeInstructions(policy.houseRules, 'You are <name>, <role>, <level> in Tony's Life Org', mission). There is no static 'Your direct reports' line; the live org layer supplies it.
   - The forbidden-path check is re-run.
7. **Room:**
   - An employee joins its manager's team room. If that room is full, a new '<Manager>'s team' room holds the manager and the hire.
   - A manager hire gets a new room '<Dept>: <Name>'s team' with the director and the new manager, with Allowed folders inherited from the department room.
   - A director hire gets a department room with the CoS and joins HQ (HQ is at 9 of 12).
   - A new room's autopilot is on only if Tony ticked the box.
8. **Onboard:**
   - A low-priority onboarding task with no reviewer, linked to the objective: 'Read the room canvas and project CLAUDE.md, write your desk README (scope, inputs, outputs), post your 1-week plan in canvas section Onboarding: <Name>'.
   - A report to the proposer.
   - An employee_revisions row (actor owner, with the proposal id).
   - Proposal status 'applied' with result = the new id.
   - The Slack card updates to 'Hired Kai (manager, YouTube Studio)'.
   - `org.export` plus lifeOrg/export.mjs can write the change back to org.json.

FIRE (M3 mechanism; M11 through the chain)
- **Who.** Only a bot above the target (org.isBelow) can file `proposal.create {kind:'fire', payload:{target, successor?, reason}, evidence: perf_daily day}`. The people review can also flag. A fire is always owner-final.
- **Route.** The target's chain, nearest first, skipping the proposer and anyone below it, so the target's director always gets a say. Then Tony.
- **On approval,** or when Tony uses employees.fire directly:
  1. hold=2 (draining). Queued runs of the bot are cancelled, dispatch starts nothing new for it, and owner messages to it are refused with 'being let go'. 'Stop its work now' cancels its live runs.
  2. When no active root touches the bot, drainTick runs safeFire in one transaction:
     - direct reports move to the successor or to the bot's manager (level-checked; the preview must be valid first);
     - open tasks: the assignee is replaced by the successor if the successor is a room member, otherwise the task is unassigned into Backlog with a notice to the manager;
     - wherever the bot is reviewer, its manager (if active) replaces it, otherwise ''.
     - it is removed from every room; a room left with no active members is archived;
     - its routines are disabled; archived=1, hold=0;
     - an employee_revisions row is written; a report goes to the manager; the Slack card updates.
- **The desk is kept.** 'Move folder to Recycle Bin' (shell.trashItem) is offered only for archived bots, only on Tony's click.
- **org.repair (M3).** A preview plus apply that runs the same reassignment for bots archived earlier. On Tony's DB: Dario and Altman under archived Alex, Dario's open task, Altman's review, and the 'Snake game test' room.

ADJUST (M11)
- `proposal.create {kind:'adjust', payload:{target, changes:{instructionsAppend ≤2000, model, effort, timeoutMinutes, harness, manager, coachingNote ≤600}, reason}}`.
- permissionMode and level are never accepted.
- It is owner-final, including coaching notes. A coaching note is applied as a private, unpinned memory with source 'coaching', so it never crowds out the pinned house-rule memories.
- Changes are drain-then-apply (hold=3 until idle), then updateEmployee, and an employee_revisions row is written.

LIMITS SUMMARY
- depth 4; spans 8, 10, 8; maxBots 60;
- 1 open hire per proposer, 2 per proposer per week, 3 per org per week;
- 2 returns per proposal; a 24 h per-hop deadline; 7-day expiry at the owner;
- at most 3 people proposals per proposer per day, 6 per org per day;
- nothing is hired, fired or adjusted automatically;
- no bot can change its own level, objectives, budget, hold, policy or permission mode.

## Approvals via the chain of command

There are two classes of approval, because a manager bot's review is a queued LLM run: it cannot safely block a live tool call, which holds a concurrency slot and can deadlock the 8-slot pool.

A) DURABLE DECISIONS (runtime/proposals.mjs, schema v23; they survive restarts and keep a full trail)

**Kinds.** hire, fire, adjust, publish (send, post or publish a draft; the house APPROVALS rule becomes a real object), spend, escalation (blocked, or needs a decision), budget (raise a cap, lift a project brake, extend a pause), rule (a standing tool-approval rule, M13).

**Who creates them:**
- any bot: publish, spend, escalation, budget;
- a leader: hire, fire, adjust, rule;
- code: stalls that hit the review limit (escalation), and people-review evidence attached to proposals.

**Owner-final is hard-coded.** `OWNER_FINAL = Object.freeze(new Set(['hire','fire','adjust','publish','spend','budget','rule']))`. org.policy cannot change it, and a test proves that.

**Routes (a constant in code, not a policy setting):**

| Kind | Route | Final say |
|---|---|---|
| hire, adjust, budget, rule | requester's chain nearest first: manager, director, CoS | Tony |
| fire, adjust with a target | the target's chain, skipping the proposer and anyone below it | Tony |
| publish, spend | manager, director; the CoS gets an FYI line in its brief packet | Tony |
| escalation | manager first, then up the chain | the first holder who resolves it with an answer; unresolved ones reach Tony |

**Rules for holders:**
- Only the current holder may answer. The answer comes through the `proposal.decide {id, decision: endorse|reject|changes, comment}` action, applied in the run-completion transaction (the applyReview pattern).
- A bot can never 'approve' an owner-final kind.
  - reject ends the proposal and files a report {kind:'decision'} to the requester;
  - changes returns it to the requester, at most 2 times;
  - endorse moves it to the next hop.
- Each hop to a bot sets that bot's debounced desk-time wake to 5 min, so a 3-hop chain usually finishes in 20–40 minutes during team hours. Overnight it waits.
- If a bot hop is silent for 24 h, or for 3 of the holder's fired wakes, the proposal escalates with a trail step 'timeout: no answer from X'.
- At the owner, a proposal expires after 7 days, and the requester hears about it.
- Tony may decide at any hop.

**Trail.** proposal_steps records the actor (owner:desktop, owner:slack, owner:phone, or a bot id), the action, a comment of at most 1000 characters, and the time.

**Tony's surfaces:**
- DecisionsPage, grouped 'Waiting on you', 'In the chain' and 'Recently decided';
- a sidebar badge;
- a Windows toast (attention, navigationTarget key `proposal`);
- a Slack DM card with Approve, Reject and Open. A thread reply becomes a comment. When more than 10 owner cards are open, Slack sends one digest instead of individual cards;
- the phone Decisions tab.

**On approval** (applied in a coordinator transaction; failures set status 'failed' with a notice and a diagnostic):
- hire, fire, adjust: hiring.mjs;
- publish, spend: a priority-20 run for the requester, with the hand-off 'Approved by Tony (proposal P): proceed with <title>'. From M13 a publish approval also creates a single-use grant (below);
- budget: raises the named cap until its 'until';
- escalation: posts the answer to the requester as a priority-20 hand-off;
- rule: inserts into approval_rules.

B) TOOL APPROVALS (time-sensitive, mid-run; the existing Claude Code approvals bridge)

These always go straight to Tony. What changes:
- **Every approval reaches Tony's owner Slack DM** with Allow and Deny (M8). Today only work started from Slack does.
- **The card names the chain** ('Pixel · team: Nova → Atlas'), stored in approvals.chain. decidedBy is recorded.
- **The Slack message updates** when the approval is decided on any surface or expires.
- **The manager learns what its reports keep asking for.** After each decision, an FYI report {kind:'decision'} goes to the requester's manager. It does not wake the manager.
- **Timeout** stays 15 minutes (the approvals.mjs:35 default) until the M8 live test on Tony's PC shows Claude Code keeps a long-blocking mcp__anybot__approve call alive. After that it becomes configurable in 15–30 min steps, default 30. It is never above 120, and never above the verified value.
- **Codex bots never ask,** because their modes are sandboxes. Their outward actions must go through publish decisions, per the house rule, and autonomous lanes refuse dontAsk bots.

**Standing rules** (M13, rules.mjs, schema v25) are how the chain of command reaches tool approvals ahead of time:
- A manager or director proposes a 'rule' decision. Tony approves it.
- `Approvals.onRequest` matches rules synchronously before notifying. A match allows or denies immediately, with decidedBy 'rule:<id>'.
- Rules come in two kinds only:
  - 'edit-under' <path>: the resolved path must be inside the team home, with no '..', not a forbidden folder, and not .git, .claude or .env*;
  - 'bash-prefix' <prefix>: the prefix must come from org.policy.bashAllowlist (for example `npm test`, `npm run build`, `npx remotion render`). Matching is on the parsed argv. Any command containing `&&`, `||`, `;`, `|`, a backtick, `$(`, `>`, `<` or a newline never matches.
- Rules can never cover:
  - network tools (WebFetch, WebSearch, curl, wget, Invoke-WebRequest);
  - publish or send;
  - delete (rm, del, Remove-Item, git clean);
  - any git push, including force-push;
  - credential tools;
  - any mcp__* tool.
- Scope is employee:<id> or subtree:<manager>. Rules expire after at most 30 days, and the expiry is required.
- **Single-use grant from a publish approval.** When Tony approves a publish proposal that names a tool, a 'grant' rule is created, scoped to that requester run's root: 1 use, 60 minutes. It is the only rule type that may match an mcp__* tool, because Tony approved that exact action. A non-matching tool prompt from that root is labelled 'pre-approved in proposal P' on the card, so Tony can approve it in one click.

## Daily people review

WHAT IT IS
- A real routine: a supervisor system schedule at team.peopleReviewAt, 06:45 local by default, with 180 minutes of catch-up.
- If the PC slept through the slot, it runs at the next start, marked 'late'. It runs before the 08:00 standups so its flags can feed them.
- It is deterministic runtime/performance.mjs code with **zero tokens**. It writes one perf_daily row per active bot, holding numbers and codes only.
- `people.runNow` lets Tony run it on demand.
- Benchmark: the metric queries take about 0.3–0.6 s on the synthetic 121k-run DB once the M0 indexes exist. The limit is under 1 s.

METRICS
Each metric uses a 7-day rolling window plus the change over the last 24 hours. Below a metric's minimum sample the value is 'insufficient', never a penalty.
1. **Bot-caused failure rate.** Failed runs whose classifyRunError class is timeout, output_limit, no_response, exit or model, divided by finished runs (n≥5).
   - Environment classes (not_installed, auth, usage_limit, launch, interrupted, cancelled) count against infrastructure, not the bot.
   - Watch at 15% or more, Adjust at 25% or more.
2. **Cost per completed task.** cost_usd for Claude, tokens for Codex, across all runs linked to the task (including failed attempts and review runs), attributed to the lead (n≥3 tasks). Adjust at more than 2× the median of peers on the same harness.
3. **Review rejection rate as lead.** review→in_progress moves divided by (those plus review→done), with Tony's rejections counted double (n≥3).
   - Adjust at 34% or more.
   - Any task that hits the 3-round cap flags immediately.
4. **Reviewer rubber-stamping.** The bot approved 100% of what it reviewed (n≥5) and Tony later sent at least one of those tasks back. Flag: Watch.
5. **Owner redo rate.** Tony's correction messages divided by the bot's replies (n≥5). Adjust at 20% or more.
   - A correction is a message matching /\b(no|wrong|redo|not what|try again)\b/i within 24 h of the bot's reply in the same thread or direct chat.
   - Owner retries (runs.retry) and owner Stops of that bot's runs also count.
6. **Tool approvals denied** (Claude bots only; expired and cancelled don't count). Adjust at 3 or more, or at 30% or more of decided requests. Watch at more than 20 requests a day.
7. **Stuck work.** Watch at 2 or more of:
   - In progress with no active run for more than 24 h;
   - in Review for more than 24 h;
   - 'Some work did not finish' notices;
   - the bounce cap being hit.
8. **Busywork (from supervisor data).** Watch when any holds:
   - idle-wake share of 40% or more (n≥5 wakes);
   - tasks created at least 3× tasks completed over 3 days (a leader);
   - a supervisor loop flag.
9. **Idle, split in two:**
   - 'starved': the bot had assigned work but budget, breaker or hold held it. That is a capacity note, not held against the bot.
   - 'no work': no work and no schedule for 14 days. That is a merge-or-archive signal.
10. **Leader metrics:** unread reports older than 24 h (Watch at 5 or more), proposals that missed their hop deadline, review latency, and team throughput per objective.
11. **Tracker writes** (from M2 detection): an employee-level bot changed CLAUDE.md, TODO.md or bugs.md. Watch.

VERDICTS AND FIXES
- Each bot gets one verdict: ok, watch, adjust, fire-candidate, or insufficient.
- **Cooldown:** a bot with an employee_revisions change in the last 7 days is capped at Watch.
- **Fire-candidate** is never assigned by a threshold alone. It requires one of:
  - (a) Adjust persisted for 14 days, and an adjustment applied at least 7 days ago did not improve the flagged metric by 25% or more;
  - (b) 14 days with no work, and a role overlapping an active teammate under the same manager (Jaccard of role words 0.6 or more), proposed as 'merge or archive';
  - (c) Tony flagged it.
- Each reason code maps to one suggested fix:

| Reason | Suggested fix |
|---|---|
| timeout | raise timeoutMinutes, lower effort, or split tasks |
| model | correct the model within policy |
| no_response / exit | switch harness |
| output_limit | add 'write files, not long replies' to instructions |
| denials / redo | instruction tweak or coaching note |
| rejections | raise effort or move the bot to another manager |
| busywork / loop | narrow the mission, lower the weekly task budget |

OUTPUTS: THE BREAKDOWN TONY ASKED FOR
1. **HQ canvas section 'People review'**, replaced daily via doc.section. One table row per flagged bot: bot, level, manager, verdict, key numbers, suggested fix, trend arrow. Totals line: 'Tue 29 Sep: 38 ok · 3 watch · 2 adjust · 0 fire · 2 not enough data'.
2. **Org → People tab**: every bot's verdict, a 14-day trend from perf_daily, filters, and adjustment history from employee_revisions.
3. **Slack DM at about 07:05** (merged with the brief when it's close): the counts plus the top 5 flagged bots with an Open button.
4. **Flags go to the manager.** Each flagged bot lands in its manager's next standup or desk-time packet, which makes that run non-quiet. The manager must answer with one of:
   - `proposal.create` adjust {changes};
   - `proposal.create` fire {successor};
   - `people.keep {employee, reason}` (recorded in perf_daily.answer).

   An unanswered flag escalates to the next level's packet after 2 days.
5. **Atlas's 08:45 brief** summarizes the people section. Atlas and Jim are never judged by themselves: when either is flagged, their numbers go straight to Tony as a card.

APPLYING
- Every adjust or fire is owner-final and travels the chain.
- It is applied drain-then-apply and logged in employee_revisions, so the next review can answer 'did that help?'. The trend column shows before and after the revision.
- On a clean day the whole routine costs zero LLM runs; when bots are flagged, the discussion happens inside standup runs that were going to happen anyway.
- This replaces the people part of Atlas's Weekly review routine; the weekly review stays a strategy review.

## Guardrails

DEFAULTS
- Every always-on feature defaults off after a merge: team.enabled, keepAwake, wakeForWork, night shift, hiringEnabled and Slack owner push.
- The unconditional M0 safety fixes are the exception, and so is P1's daily people review (read-only, zero tokens; see "Amended by P1").

BUDGETS (runtime/budget.mjs; they count autonomous runs only)
- Tony's own messages, owner task starts and owner retries are exempt but counted, and they use the reserved slots.
- **Per bot per day:** CoS 16, director 20, manager 24, employee 12. Unleveled bots get 12. employees.dailyRuns overrides.
- **Per project:** 40 per day.
- **Org:** pilot 40 per day for 72 h on 2 rooms. Rollout 150 per day, raised only from measured data and with Tony's OK.
- **Night budget:** 20 per night.
- **Optional daily token ceiling** from runs.usage. Claude and Codex report tokens; Codex has no cost_usd, so caps count runs first.
- **Day boundary:** local midnight.
- **At 80%:** one attention event plus a Slack notice.
- **At 100%:** autonomous work waits in the queue (never failed or dropped) until local midnight or until Tony raises the cap (Settings, or approving a 'budget' proposal). One notice and one diagnostic, budget.cap_reached.
- **Chain children count:** mentions and delegations under autonomous roots count against these budgets.

CONCURRENCY AND LANES
- Concurrency is team.concurrency, 1–12, default 8. Today it is hard-coded at 8 (coordinator.mjs:127, with worker.mjs passing nothing).
- With Team on, 2 slots are reserved for Tony (priority 25 and above).
- The lock is one run per desk (case-folded) plus one run per bot.

PROVIDER CIRCUIT BREAKER (per harness)
- **Opens** after 2 usage_limit or auth failures within 10 minutes.
- **Open time:** 15, 30, 60, then 120 min. If `parseResetTime` finds a reset time in the error text, that is used instead (the parser is unverified; the backoff is the fallback). not_installed stays open until a probe succeeds or Tony resets it.
- **Half-open** allows exactly one probe run; a success closes it.
- **While open:**
  - autonomous runs on that harness stay queued, and other harnesses keep working;
  - Tony's runs still try;
  - a failed delegated return does not spawn another delegator run;
  - the chat shows 'Claude usage limit: waiting until 14:20' with a Try now button (breaker.reset).
- **Notification:** one attention event and one Slack message per open. Diagnostics breaker.opened and breaker.closed.
- **Scope:** the breaker applies with Team off as well, because it only prevents failure storms.

HOURS
- Work hours (default 07:00–22:00) gate desk time, schedules, refill and T1.
- Outside work hours, only rooms with night shift on run tasks labelled `overnight`, under the night budget.
- Slack quiet hours (default 22:00–07:00): non-urgent items are batched to the 07:00 digest. Always sent: tool approvals, breaker trips, budget exhausted, and kill-switch confirmations.
- Keep-awake releases when idle outside work hours.

KILL SWITCHES
1. **Team switch.** Settings, tray, Slack button or DM 'stop team', phone.
   - team.stop saves every room's autopilot flag in team.savedAutopilot, turns autopilot off everywhere and sets enabled=false.
   - It cancels queued autonomous runs within one tick. Running autonomous runs finish unless 'Stop now'.
   - team.resume restores exactly the saved flags.
2. **Timed pause:** 1 hour, or until 07:00 tomorrow (team.pause → pausedUntil).
3. **'Stop everything':** the existing runtime.stopAll (a persisted pause that cancels all runs).
4. **Finer controls:** the per-room Team toggle, per-bot Hold, plan.hold per room, and breaker reset.

LOOP AND BUSYWORK PREVENTION
- Every wake points at rows. There are no check-in heartbeats. Wakes have dedupe keys (a partial unique index) and cooldowns.
- Suppression:
  - two idle outcomes suppress that trigger for 12 h;
  - three identical action hashes in a row suppress for 12 h and flag the bot;
  - 'acted' is never measured by output length.
- Refill is gated: backlog floor 2, an idle member, a 6 h gap, 2 a day per room, 8 tasks per plan. An idle plan sets a 24 h hold.
- Tasks:
  - every task created by an autonomous or scheduled run carries 'obj:<id8>' for an active objective in the creator's chain, or it is rejected;
  - weeklyTaskBudget is 5 per report;
  - at most 5 open Backlog tasks per bot;
  - a leader whose created-to-done ratio is above 2 over 3 days is limited to 2 task.create a day and flagged.
- Existing caps stay: 20 bot-created starts per project per day, 20 tasks per root, 3 review rounds, 6 mention hops, depth 3 and 8 runs per root.
- New in M0:
  - mention runs from autonomous roots inherit root and depth;
  - the bounce cap: 3 automatic starts per task per 24 h;
  - archived bots never dispatch.
- With Team on, autonomous delegation returns become reports, not synthesis runs.
- Proposals: at most 2 returns, a 24 h deadline per hop, and 7-day expiry.
- Canvas: autonomous runs may use only doc.section; doc.append is refused ('scheduled work must replace a section').
- The Team-on project brake pauses until midnight with a notice and attention. It never auto-lifts silently, and only Tony can lift it early.

SAFETY
- **Org policy is enforced in the runtime, not only in lifeOrg/seed.mjs.** It covers the model/effort policy, forbidden folders and names (for createEmployee, updateEmployee, project folders, desks and admission), house rules composed into every hire, maxBots, spans and hire rates.
- **Forbidden-ancestor rule.** Any bot whose workspace contains a forbidden folder (Vera and Ward at the {root} folder) is refused autonomous work until its home moves.
- **dontAsk bots never run in autonomous lanes** unless listed in team.dontAskAllowed. This matters because Codex dontAsk adds network, and Antigravity and Cursor dontAsk skip permissions.
- **Outward MCP tools.** For Claude runs under an autonomous root, adapters.mjs invocation() appends `--disallowedTools` for each org.policy.outwardTools entry (exact tool names or whole servers).
  - The Settings → Team editor is seeded from the owner's configured MCP server names, which main reads from ~/.claude.json and project .mcp.json. Names matching mail, slack, calendar, vercel, shopify, stripe, social, youtube, tiktok or drive are blocked by default; Tony can unblock.
  - This is verified by the live smoke tests/live-claude-disallow.mjs in M1.
  - These runs don't rely only on house-rule prose or the auto-mode classifier.
- **Tracker files.** Employee-level Claude bots get `--disallowedTools Edit(**/CLAUDE.md) Write(**/CLAUDE.md)` and the same for TODO.md and bugs.md (pattern support is verified by live smoke). Codex writes are detected after the run by an mtime check and flagged.
- **Bots cannot touch their own controls:** no bot can change its own level, objectives, standing budget, hold, policy or permission mode, answer a proposal it doesn't hold, or finalize an owner-final kind. Checks repeat at apply time.
- **Slack:** buttons and DM commands are accepted only from owner.userId. Anyone else gets an ephemeral refusal. This also applies to the existing per-bot anybot.approve|deny, which today accepts any paired user (slack-bridge.mjs:311-351).
- **Prompt injection** can at most produce a proposal that Tony must approve. Hires are forced to auto mode, the manager's home and policy models.
- **No conversation text** in wakes, perf_daily, proposal_steps or diagnostics. Transcripts never go into diagnostics.
- **New diagnostic codes**, each with a describeIssue entry in src/lib/diagnostics.js:
  - runtime.tick_failed, runtime.uncaught
  - budget.cap_reached, breaker.opened, breaker.closed
  - run.dontask_refused, policy.forbidden_path
  - autopilot.bounce_capped
  - supervisor.idle_suppressed, supervisor.loop_detected
  - desk.home_missing, desk.create_failed, desk.exclude_failed, desk.tracker_write
  - org.level_refused
  - hiring.rejected, hiring.apply_failed
  - proposals.escalated, proposals.expired
  - people.apply_failed
  - power.wake_register_failed, power.blocker_failed
  - slack.owner_push_failed
  - voice.stt_failed, voice.provider_missing
- **Scale gate:** the snapshot diet (M4) ships before any autonomy. Always-on for the full org waits for the pilot soak report and Tony's go.

## Per-bot folders (desks)

PER-BOT PRIVATE FOLDERS ('desks', M2, schema v19)

**Path.** `<home>\.anybot\<slug>-<id8>\`, for example `{root}\content\.anybot\nova-1f3a9c2e\`.
- The slug is the bot's name in lowercase a–z, 0–9 and '-', at most 24 characters. The id suffix covers archived bots with the same name and Windows reserved names.
- The path is stored once in employees.desk, so renaming a bot doesn't move it.
- New hires inherit their manager's home, so their desk sits under the team's real folder.

**The working directory stays the shared home.** This preserves:
- Claude's `Edit(./**)` auto permission (adapters.mjs:459);
- artifact confinement (artifacts.mjs:202);
- direct chats, Slack and Buzz, which carry no Allowed folders (coordinator.mjs:1553-1577);
- `--add-dir` for other roots;
- Codex writable roots;
- the files.context 16-base cap;
- discovery of CLAUDE.md, .claude/skills (the content project's 9 skills) and .mcp.json;
- lifeOrg org.json semantics.

**Parallelism.**
- The dispatch lock key changes from `employee.workspace` (coordinator.mjs:1839/1856) to `(employee.desk || employee.workspace).toLowerCase()` on win32, and one run per bot stays.
- The 9 content-project bots and the 5 finance bots can finally run at the same time.

**Inbox moves into the desk.**
- `<desk>\inbox\` replaces `<home>\.anybot-inbox`.
- attachments.mjs `materialize()` (line 91) and artifacts.mjs `stage()` (line 347) take the inbox directory and its cwd-relative prefix as parameters.
- One bot's stage rename/restore can then never move another bot's live edit aside. No .anybot-inbox exists in any of the 21 homes today, so no data moves.

**Lazy, safe creation.**
- At run start (execute(), before stageArtifacts), `ensureDesk` stats the home first. A missing home is never recreated: the run fails with desk.home_missing.
- The desk is created as `<home>\.anybot` and then the desk folder, with no mkdir -p through the home.

**Git.** On first creation inside a work tree, `.anybot/` is appended once to `<common git dir>\info\exclude`. A worktree's `.git` file is resolved to its gitdir, then its `commondir`. Nothing is committed, and no self-ignoring .gitignore is written. 9 of the 21 homes are git repos.

**Prompt.** context.mjs platform layer:
- 'Your private folder: .anybot/nova-1f3a9c2e (drafts, scratch and outputs go here). Shared files in this workspace are also edited by teammates; change them only when your task says so.'
- The artifacts layer's inbox wording (context.mjs:144) is updated.
- files.context adds the author's desk as a link base.

**UI.** EmployeeForm.jsx shows 'Private folder' with Open, which calls main-only `employees.openDesk` → `shell.openPath` after validating the path is that bot's desk.

**Migrating the existing 45 bots.**
- The v19 migration computes the desk path string for every bot whose workspace is outside `<userData>\workspaces`. That is all 45 Life Org bots across the 21 homes. It does no file I/O.
- Archived Alex, Dario and Altman live in `<userData>\workspaces\<id>`, so they keep desk '' (private by construction).
- Folders appear on each bot's first run.
- The migration is covered by a fixture test: 45 desks, zero files written.

**Shared-file safety once parallel.**
- House rule TRACKING changes in lifeOrg/org.json (M9): only directors and managers write a project's CLAUDE.md 'Last turn / Pending', TODO.md and bugs.md. Employees draft in their desk and report up.
- Enforced for employee-level Claude bots with `--disallowedTools` Edit/Write patterns on those files.
- For Codex, an after-run mtime check (desk.tracker_write) feeds the people review.
- Later phase, not in scope: git-worktree desks as cwd for repos with 2 or more coding bots (autoEditor: Reel and Forge; design.md:236).

**Fire.** The desk is kept on archive. Archived desks are listed with their size in the People tab, and 'Move folder to Recycle Bin' (shell.trashItem) runs only on Tony's click.

## Wake and keep-awake

Everything here is opt-in in Settings → Power (src/components/PowerPanel.jsx) and in the tray. The prefs live in `<userData>/startup.json`: keepAwake and wakeForWork, both false by default.

KEEP AWAKE (desktop/power.cjs AwakeKeeper, glue in main.cjs)
- The pure `shouldHold({keepAwake, teamEnabled, running, queuedAutonomous, nextDueMs, now, lastBusyAt, inWorkHours})` is true when:
  - keepAwake is on, and
  - either runs are running or queued, or Team is on, it is work hours, and a wake is due within 10 minutes;
  - with a 2-minute grace after the last busy moment.
- When it holds, main uses `powerSaveBlocker.start('prevent-app-suspension')`; otherwise it calls stop.
- It re-checks on every worker 'changed' message, the same way checkIdleInstall does (main.cjs:596-624), using runtime.activity (coordinator.mjs:636).
- Tray: the tooltip reads 'Keeping this PC awake: 3 bots working', and a menu checkbox 'Keep this PC awake while the team works' toggles the pref.

WAKE FOR WORK
- **Next due time.** The coordinator's main-only command `runtime.nextDue` returns the soonest of:
  - enabled clock routines' and schedules' nextRun;
  - the people-review time;
  - the next work-hours start, when Team is on and ready work exists.
- **Registration.** Main writes the XML from the pure `buildWakeTaskXml({exe: process.execPath of the installed anyBot.exe, startBoundary: nextDue − 3 min, local ISO})` to a temp file and runs `schtasks /Create /TN "\Any Bot\wake" /XML <file> /F` through execFile. The XML sets:
  - WakeToRun true, StartWhenAvailable true;
  - DisallowStartIfOnBatteries false, StopIfGoingOnBatteries false;
  - MultipleInstancesPolicy IgnoreNew;
  - Principal LogonType InteractiveToken (per-user, no admin);
  - action `anyBot.exe --background --wake`.
- **Refresh and removal.** It re-registers only when nextDue moves by more than 1 minute, debounced to 60 s. When wakeForWork is off, `schtasks /Delete /TN "\Any Bot\wake" /F` removes it.
- **Failure.** A registration failure produces the diagnostic power.wake_register_failed plus a Settings notice.

BACKGROUND START
- `--background` and `--wake` are read at first start (main.cjs:1116 skips showWindow) and in the second-instance handler (main.cjs:759, which now reads argv and shows the window only when neither flag is present).
- Launch at login passes `args:['--background']` (main.cjs:216 setLoginItemSettings). When Team is on, Settings nudges Tony to enable launch at login.
- A wake start holds the blocker immediately, before Windows' unattended-idle timer can put the PC back to sleep.

SLEEP-SAFE RUNS
- **powerMonitor.** On 'suspend' and 'resume', main sends `runtime.slept {ms}`. The coordinator adds the slept milliseconds to each active run's waited clock, which the existing waitedMs hook subtracts in runHarness (adapters.mjs:845, 928-942). Sleep never counts toward a run's time limit.
- **Fallback.** A clock-jump check in the coordinator timer (a gap of more than 30 s) is the fallback.
- **Resume.** Resume marks the supervisor and triggers routine catch-up within grace: 'caught-up' instead of today's 'missed' (routines.mjs:230).

KNOWN LIMITS (documented in docs/operations.md)
- Wake needs Tony signed in; a sleeping session is fine.
- After a reboot, nothing runs until he logs in. Launch at login with `--background` then brings the team back quietly.
- The relay, Slack and the phone cannot wake a sleeping PC.
- Tony's PC already allows wake timers and never sleeps on AC, so wake mostly covers sleep he triggers by hand.

VERIFICATION
- **Unit tests** (tests/power.test.mjs): the shouldHold truth table with grace; the XML content (WakeToRun, StartBoundary, exe and args); the re-register debounce; the nextDue calculation.
- **Electron (tests/electron-runtime.cjs):** a `--background` launch shows no window.
- **Coordinator test:** a run with a 10-minute limit spanning an injected 30-minute sleep is not killed.
- **Manual on Tony's PC:**
  - `schtasks /Query /TN "\Any Bot\wake" /XML` shows WakeToRun;
  - `powercfg /requests` lists Any Bot under SYSTEM while a run is active and clears about 2 minutes after idle;
  - sleeping at 08:20 with an 08:30 schedule wakes the PC, the schedule runs, and the PC stays up until it ends.

## Owner Slack push

ONE OWNER CHANNEL (M8; runtime/slack-bridge.mjs, slack-format.mjs; Settings → Owner notifications in src/components/OwnerNotificationsPanel.jsx)

**Setup.** Tony picks one of two options.
- **(A) Dedicated 'Any Bot HQ' app (recommended):**
  - created from `ownerManifest()` in slack-format.mjs, with the same Socket Mode plumbing and scopes (chat:write, im:write, im:history, im:read, users:read);
  - tokens are stored with safeStorage in slack.json `owner`;
  - pairing uses the existing 6-digit DM code, which locks `owner.userId`.
- **(B) Reuse an already-connected bot's app (Atlas's, zero setup):** Tony picks the bot, then picks himself from that app's paired users.

In both cases, 'Send test' posts a card. Per-bot Slack apps are unchanged, and DMs Tony sends to Atlas's app still go to Atlas.

**What gets pushed.** main.cjs:1296 forwards every worker 'attention' message to `slackBridge.notifyOwner(notice)` as well as the Windows toast. runtime/attention.mjs adds these kinds:
- **Urgent (immediate, even in quiet hours):**
  - every tool approval, not only Slack-started work;
  - a proposal reaching Tony;
  - a breaker opening;
  - a budget exhausted;
  - team stop and resume confirmations.
- **Normal:**
  - a failure in work Tony started;
  - a bot asking Tony a question (asksQuestion moved into the runtime);
  - a budget at 80%;
  - a project brake reached;
  - a pilot report.
- **Batched:**
  - hourly, during work hours and only when non-empty: failures digest, tasks done per team, decided proposals;
  - daily: the 07:05 people-review summary and the 08:45 brief. The brief is followed via bridgeUpdates on its schedule message, and Slack posts the final reply summary with an Open link.

**Cards.**
- Block Kit, titles and summaries only (at most 300 characters), never full outputs.
- Action ids:
  - `anybot.approval.allow|deny` (value = approval id);
  - `anybot.proposal.approve|reject|open` (M10);
  - `anybot.team.pause|resume|stop`;
  - `anybot.run.retry`.
- **Owner only.** onAction accepts a click only when `payload.user.id === owner.userId`; anyone else gets chat.postEphemeral 'Only the owner can do this'. The same rule applies to the existing per-bot `anybot.approve|deny` buttons. Until an owner is configured, approval buttons are not posted to Slack (the desktop ApprovalBar and the toast still work).
- **Settled anywhere, updated in Slack.** The coordinator's onSettled hooks (approvals and proposals) emit a 'settled' event {kind, id, status, by}. worker.mjs forwards it, and main calls `slackBridge.settle(key)`, which runs chat.update on the stored announced message: '✓ Approved by Tony on desktop' or 'Expired'.

**Volume control.**
- Quiet hours (22:00–07:00) batch non-urgent items into the 07:00 digest.
- Rate limit of 20 pushes an hour; overflow folds into the next digest.
- When more than 10 owner decision cards are open, one digest card replaces individual cards, to avoid rubber-stamping.
- Per-kind toggles in the panel.

**DM commands** (deterministic, no LLM): `status`, `pause [1h]`, `resume`, `stop team`, `brief`.

**Thread replies.** A reply in a notice's thread goes to the main-only `bridge.reply {conversation, thread, body, requestId}` and lands in the originating project thread as Tony's message. Today bridgeSend can only reach a bot's direct chat.

**Approval timeout live test (M8).** scripts/live-approval-timeout.mjs, run on Tony's PC, holds an mcp__anybot__approve call for 20 and then 35 minutes. Only if Claude Code keeps it alive does team.approvalTimeoutMinutes become configurable up to the verified value, default 30. Otherwise it stays 15.

**Tests.** tests/slack-owner.test.mjs, using the fake Slack harness from tests/slack.test.mjs:
- one attention event produces one owner DM;
- an approval from a desktop-started run DMs Allow and Deny;
- a click from a paired user who isn't the owner is refused and changes nothing;
- a desktop decision edits the Slack message;
- 'stop team' calls team.stop;
- a thread reply lands as an owner message in the right thread;
- quiet hours defer a failure notice but post an approval immediately;
- the 21st push in an hour folds into the digest.

Manual: Tony receives a real DM and approves a test approval from his phone.

## Voice

DESKTOP (V1, 0.3.39, parallel track, no schema)

**Speech-to-text runs in main.** It moves from Electron's Google-backed webkitSpeechRecognition to desktop/voice.cjs. That recognizer fails with 'network', consistent with docs/voice.md; the root cause is unverified. The renderer calls `voice.transcribe {wav: Uint8Array ≤ 2 MB, ≤ 60 s}`, and main routes 'voice.*' methods like slack.* at main.cjs:887.

Providers:
- `whisper-local` (default when installed; offline and private):
  - an opt-in download from Settings → Voice of the whisper.cpp Windows release plus ggml-base.en.bin (small.en optional), into `<userData>/voice/`;
  - SHA-256 hashes pinned as constants in desktop/voice.cjs;
  - run as `whisper-cli -m <model> -f <in.wav> -otxt -nt` through execFile, with a 60 s timeout.
- `openai`: POST https://api.openai.com/v1/audio/transcriptions.
- `groq`: POST https://api.groq.com/openai/v1/audio/transcriptions.
- For both API providers, the key is stored with protectSecret (safeStorage) in `<userData>/voice.json` and the fetch happens in main, because the renderer CSP is connect-src 'self'.
- `webspeech`: offered only if a renderer probe succeeds.

**Capture.** The renderer records 16 kHz mono PCM with an AudioWorklet (src/voice/pcm-worklet.js) and encodes WAV in JS (src/lib/voice.js `encodeWav`), so ffmpeg isn't needed. Main sets `session.defaultSession.setPermissionRequestHandler` and `setPermissionCheckHandler` to allow 'media' with mediaTypes ['audio'] for the app origin only.

**Turn-taking.** src/lib/voice.js `Segmenter`:
- energy-based voice-activity detection with a 1.3 s silence hangover and 300 ms minimum speech;
- speech that resumes within the hangover merges into the same turn;
- a 60 s cap;
- one message per turn, not one per pause. Push-to-talk (hold Space or the mic button) is an alternative.
- The mic is half-duplex: closed while the bot works and while it speaks, reopening on the last utterance's onend. Esc stops.

**Following the reply.** A new allowlisted `messages.follow {requestIds}` maps requestId to messageId through the requests table (coordinator.mjs:1394) and returns bridgeUpdates items: status, reply, approvals and handoffs, following the whole root through delegation.
- useVoice re-queries on every anybot:changed push (preload.cjs:22-25) plus a 5 s fallback, for up to 30 minutes.
- This replaces the 30 × 800 ms full-snapshot poll (App.jsx:622-646).
- Hand-offs and approvals are spoken once each, then the final reply or error.
- The screen shows 'Atlas is working · 2m'.

**Speaking.** runtime/speakable.mjs (pure, shared with src and mobile):
- strips anybot, anybot-actions and anybot-artifacts blocks, code fences, URLs and Windows/posix paths;
- speaks up to about 600 characters cut at a sentence end, then 'The rest is in the chat.';
- one SpeechSynthesisUtterance per sentence.
- The chosen voice is saved in voice.json.

**Dictation.** The Composer mic (Composer.jsx:283-291) uses the same provider and appends one turn to the draft.

**UI and docs.**
- UI: src/components/VoicePanel.jsx (provider, download or key, voice, push-to-talk); 'Talk to Atlas' entry point in the HQ chat header.
- Diagnostics: voice.stt_failed and voice.provider_missing, with no transcripts.
- Docs: docs/voice.md and README.md:87 are rewritten.

PHONE (V2, 0.3.43, APK rebuild)
- android/app/src/main/AndroidManifest.xml adds `<uses-permission android:name="android.permission.RECORD_AUDIO"/>` and `MODIFY_AUDIO_SETTINGS`. Today only INTERNET and CAMERA are declared (lines 41-44), so Capacitor's BridgeWebChromeClient can never be granted the microphone.
- Native Capacitor plugins for speech recognition and text-to-speech (the @capacitor-community packages, pinned to versions verified against Capacitor 8.5.2 at build time) replace Web Speech. Android System WebView has no SpeechRecognition.
- ios/App/App/Info.plist gains NSMicrophoneUsageDescription and NSSpeechRecognitionUsageDescription.
- Only text crosses the relay (64 KB frames).
- runtime/mobile-gateway.mjs adds `GET /v1/requests/:requestId`: owner-authenticated, returning bridgeUpdates-shaped {status, reply ≤24 KB, handoffs, approvals}. It replaces the phone's 30-poll loop (mobile/main.jsx:268-329), which also wrongly spoke the first notice.
- mobile/main.jsx reuses the Segmenter, speakable and follow reducer.
- docs/mobile.md:50-51 is corrected.

TESTS
- **tests/voice.test.mjs:**
  - speakable strips every block type, URLs and paths and clips at a sentence end;
  - the Segmenter on synthetic PCM (1 s speech, 0.8 s pause, 1 s speech, 1.5 s silence) yields exactly one turn, and 70 s of continuous speech is cut at 60 s;
  - the follow reducer emits a hand-off once, an approval once, and the reply once across repeated identical updates;
  - encodeWav produces a valid RIFF header;
  - messages.follow through a Coordinator with a fake runner returns the reply of a run that finishes after a fake 5 minutes.
- **tests/desktop-ipc.test.mjs:** includes messages.follow, and the coordinator rejects voice.transcribe as unknown.
- **tests/electron-threads.cjs:** with ANYBOT_FAKE_STT set, one spoken turn produces one message, the reply is spoken after a 3-minute fake run, and nothing is re-sent while speaking.
- **Phone:** tests/android-manifest.test.mjs asserts RECORD_AUDIO; mobile-gateway tests cover the follow route (auth, 404, reply, frame size).
- **Manual:** 5 voice turns with Atlas on Tony's PC; a dictation and a voice round trip on his phone.

## UI

All UI uses the Studio paper OKLCH tokens in src/style.css: no hex values, and vermilion only for live, unread or urgent items. Menus inside scrolling lists use FloatingMenu. Every new renderer-callable method is added to the main.cjs `methods` Set, which tests/desktop-ipc.test.mjs enforces.

SETTINGS (App.jsx settings area, around lines 2360–2460)
- **Team** (src/components/TeamPanel.jsx):
  - Team switch, timed pause, 'Stop the team';
  - concurrency (1–12) and owner reserve;
  - work hours;
  - budgets per level, project, org, night and tokens;
  - per-room Team and night-shift toggles;
  - review rule (all or medium+);
  - dontAsk opt-ins;
  - an outward-tools editor, seeded from MCP server names;
  - breaker status with Reset;
  - 'Turn on always-on team' wizard (TeamWizard.jsx). It runs checks, lets Tony choose rooms, budgets and night shift, offers keep-awake, wake and launch at login in one step, and shows the estimate from runtime/estimate.mjs before enabling.
- **Power** (PowerPanel.jsx): keep-awake, wake for work, next wake time, launch-at-login nudge.
- **Owner notifications** (OwnerNotificationsPanel.jsx): app choice (dedicated HQ app or a bot's app), pairing, per-kind toggles, quiet hours, Send test.
- **Voice** (VoicePanel.jsx): provider, whisper download, key, voice, push-to-talk.
- **Org policy** (inside the Team panel): models per harness, forbidden folders and names, house rules, span, maxBots, hire rates, directorsHireEmployees, hiringEnabled.

SIDEBAR
- **TeamPulse strip** (src/components/TeamPulse.jsx), mirrored in the tray tooltip: working and queued counts, runs today against budget, breaker state, next wake with its reason, and a Pause button.
- A **'Decisions'** entry with a count of items waiting on Tony. The existing 'Needs your approval' also lists owner-held proposals.

DECISIONS (src/components/decisions/DecisionsPage.jsx, DecisionCard.jsx, decisions.css)
- Grouped: Waiting on you / In the chain (Tony can act early) / Recently decided.
- Each card shows the title, the requester and its chain, the trail with each hop's comment, the payload preview, and the evidence numbers.
- Hire cards preview the exact bot and its room, with the 'Turn Team on for the new room' checkbox.
- Buttons: Approve / Approve with edits (hire only; opens EmployeeForm prefilled) / Reject / Send back with a comment.
- Navigation target key `proposal`.

ORG PAGE (src/components/org/OrgPage.jsx and friends)
- Level badges and span counters ('5/8').
- The level select is owner-only.
- An 'Assign levels' banner and LevelsSetup.jsx (the infer preview, then Apply).
- Drag and drop refuses illegal moves and shows the 4-level rule.
- Per-bot Hold toggle.
- FireDialog.jsx: successor select plus a preview of which reports, tasks, reviewers and rooms move. 'Let go' replaces Archive for leveled bots.
- 'Repair org' preview (org.repair).
- ObjectivesEditor.jsx: Tony edits Atlas's objectives (and any other bot's, which locks them); leaders' objectives show as read-only with their setter.
- **People tab** (PeopleTab.jsx): the full verdict table, a 14-day trend, filters, revision history, and archived desks with a Recycle Bin action.

ACTIVITY
- A wake-reason chip on each run.
- WakeLog.jsx: recent wakes and 'Held wakes' with their reasons (supervisor.wakes).
- 'Why isn't X working?' (supervisor.explain).
- The run terminal loads full output with runs.get (snapshot diet).

CHAT AND BOARD
- Breaker banner 'Claude usage limit: waiting until 14:20 · Try now'.
- Board cards show an 'obj' chip; the project settings form gets Team and night-shift toggles and an objectives list.
- RoutineForm.jsx supports 'Every weekday at 08:30' and shows caught-up / skipped-quiet / missed.
- Chat loads older messages on scroll-up (messages.older).
- EmployeeForm.jsx shows 'Private folder · Open'. Its manager list is filtered by level, and permission mode is hidden for bot-proposed edits.

TRAY (main.cjs:1131-1149)
- Team on/off checkbox, 'Pause team 1 hour', 'Stop the team'.
- 'Keep this PC awake while the team works' checkbox.
- Tooltip with working count and next wake.

PHONE (mobile/main.jsx)
- Decisions tab: proposals plus tool approvals, with approve and reject.
- Stop team and resume.
- Native voice.

## Milestones

### M0: M0 (0.3.37): Safety floor and loop fixes (no schema change)

**Why now:** Every later milestone touches Tony's 45-bot database and the dispatch loop.
- Today one throw in the 500 ms timer kills the worker.
- Migrations take no backup.
- Archived bots can still be dispatched.
- Mention runs escape the root and depth caps.
- The Backlog bounce loop is uncapped.

These are fixed before anything becomes more autonomous.

**Depends on:** none

**Scope:**

- **runtime/store.mjs.** Add a pre-migration `VACUUM INTO '<dir>/anybot.backup-v<from>-to-v<to>-<ts>.sqlite'` when `storedVersion < SCHEMA_VERSION` and an employees table exists, and keep the newest 3 plus the first backup of the upgrade in progress (amended by M0). It runs after the version check, before the CREATE/ALTER exec. Add plain indexes runs(employee,created), runs(created), task_activity(kind,created) and messages(author,created) next to runs_root.
- **runtime/coordinator.mjs:**
  - Timer at line 218: wrap it in try/catch, with a diagnostic runtime.tick_failed throttled to one per minute per message.
  - dispatch() at 1836: cancel queued runs whose employee is archived, with one notice per conversation.
  - applyReview at 1236: the 'changes' path checks activeEmployee(lead); if the lead is archived, post a notice and queue no run.
  - onTaskMoved at 1251: an archived reviewer falls back to that reviewer's manager if active, with a notice; otherwise the owner decides.
  - reviewTask at 1058: the owner's 'changes' queues exactly one lead run with the handoff 'Changes requested by the owner: <comment>', skipped if the lead already has an active run on the task.
  - activateMentions at 2258: when the work wasn't started by people, the mention run inherits `run.root` and `run.depth+1`. As built, that is `!startedByPeople(run)`, which follows mention roots back (see "Amended by M0"), not the root message's author. It is refused with a notice when the root already has 8 runs or the depth is 3 or more.
  - autopilot() at 1100: bounce cap. A task started by 'system' 3 times in 24 h without a review or done move since is skipped, with one notice and the diagnostic autopilot.bounce_capped.
- **runtime/worker.mjs.** process.on('uncaughtException' and 'unhandledRejection') posts a runtime.uncaught diagnostic before exiting. (Amended by M0: only an uncaught throw exits; a rejection is logged as runtime.unhandled_rejection and the process keeps running.)
- **src/lib/diagnostics.js.** describeIssue entries for runtime.tick_failed, runtime.uncaught and autopilot.bounce_capped.
- **tests/fixtures/schema-v18.sql.** A 0.3.36 workspace shaped like the Life Org: 45 active bots and 3 archived (Alex, Dario, Altman) with the 'Snake game test' orphans.
- **Release.** package.json and package-lock.json at 0.3.37, plus a CHANGELOG entry.

**Tests (fail first):**

New file tests/safety.test.mjs. Each case fails on 0.3.36:
1. Opening tests/fixtures/schema-v14.sql writes exactly one anybot.backup-v14-to-v18-*.sqlite, and that backup still reports schema 14. A 4th migration backup prunes the oldest backup of an earlier upgrade; the first backup of the current upgrade stays, even when a later migration step keeps failing (amended by M0, test 1c).
2. A routines.tick that throws, injected by stubbing, records runtime.tick_failed, and a queued run still dispatches on the next tick.
3. A queued run for an archived bot ends 'cancelled', and the fake runner is never called.
4. A reviewer's 'changes' on a task whose lead is archived queues 0 runs and posts a notice.
5. A task entering Review with an archived reviewer queues a review run for that reviewer's manager.
6. The owner's tasks.review 'changes' queues exactly 1 lead run.
7. A routine-rooted delegation into a project thread whose reply @mentions a teammate creates a mention run with root equal to the routine root. The 9th run in that root is refused with a notice.
8. A task moved from In progress back to Backlog is auto-started at most 3 times in 24 h (fake clock), with exactly one notice.
9. EXPLAIN QUERY PLAN for the per-bot window query uses runs_employee_created.

Also:
- tests/migrations.test.mjs gains a v18-fixture open test.
- The existing autopilot, review, routines and delegation tests pass unchanged.
- Electron: `npm run test:runtime` is green.

**Acceptance:**

- `npm test`, `npm run test:runtime`, `npm run test:e2e` and `npm run doctor` are all green.
- The CHANGELOG lists each fix.
- Tony's installed app updates to 0.3.37 and opens his DB with no backup written, since there is no schema change.

### M1: M1 (0.3.38): Team switch, kill switch, budgets, breaker, lanes, concurrency (metadata only)

**Why now:** Brakes must exist before anything wakes on its own. This adds:
- budgets
- a provider circuit breaker (today queued runs keep failing on usage limits)
- an owner lane with reserved slots
- a reversible kill switch
- refusal of dontAsk bots
- blocking of outward MCP tools in unattended runs

**Depends on:** M0

**Scope:**

- **runtime/budget.mjs** (new).
  - `isAutonomous(run)` = `!coordinator.startedByPeople(run)` (amended by M0; never the root message's author). Pure: `priorityOf(...)` using the table in architecture, `dayStart(clock)` at local midnight, `parseResetTime(text)`.
  - `class Budget`: counts autonomous runs today per bot, project and org; tokens from runs.usage; caps from metadata 'team'.levelRuns. A flat 12 applies until levels exist in M3.
  - `class Breaker`: metadata breaker:<harness>. It opens after 2 usage_limit/auth failures in 10 minutes, for 15, 30, 60, then 120 minutes, or until a parsed reset time. Half-open allows one probe.
- **coordinator.mjs:**
  - dispatch(): with Team on, orders runs by priorityOf desc then rowid, applies the owner reserve, and skips autonomous runs that are over budget. The breaker applies to autonomous runs whether Team is on or off. dontAsk bots are refused autonomous runs unless listed in team.dontAskAllowed, with a notice and run.dontask_refused.
  - execute() failure path: breaker.record(classifyRunError(...)).
  - new commands: team.get, team.set, team.pause, team.stop, team.resume and breaker.reset. team.stop saves savedAutopilot, sets autopilot=0 everywhere, sets enabled=false and cancels queued autonomous runs; team.resume restores exactly those rooms. team.set also changes concurrency live, within 1–12.
  - the constructor reads metadata team.concurrency.
  - attention events at 80% and 100% of budget and when a breaker opens.
- **runtime/adapters.mjs invocation():** for Claude runs flagged `unattended` by the coordinator, append `--disallowedTools` entries from org.policy.outwardTools. The list stays empty until M3 policy, but the plumbing ships here.
- **desktop/main.cjs:**
  - methods allowlist adds team.get, team.set, team.pause, team.stop, team.resume and breaker.reset;
  - tray items: Team on/off, 'Pause team 1 hour' and 'Stop the team'.
- **UI:**
  - src/components/TeamPanel.jsx in Settings: switch, pause, stop, concurrency, budgets, breaker status and reset, dontAsk opt-ins.
  - src/components/TeamPulse.jsx in the sidebar.
  - Breaker banner in the chat.
- **Diagnostics:** budget.cap_reached, breaker.opened, breaker.closed and run.dontask_refused, each with describeIssue.
- **Live smoke:** tests/live-claude-disallow.mjs, run manually and not part of npm test, confirms Claude Code refuses a disallowed MCP tool and supports an exact-name disallow.

**Tests (fail first):**

New tests/budget.test.mjs (pure):
- the priorityOf table
- dayStart across DST
- the breaker state machine: open, backoff, half-open, a single probe, close
- parseResetTime on sample strings, with the fallback

New tests/team.test.mjs (Coordinator with a fake runner and clock):
1. A bot at its cap: its autopilot run stays queued, while an owner message to the same bot runs.
2. 8 queued autonomous runs, concurrency 8, reserve 2: at most 6 running, and an owner message starts on the next tick.
3. Two usage_limit failures within 10 minutes:
   - that harness's queued autonomous runs stay queued
   - exactly 1 attention event is emitted
   - a Codex bot's runs still dispatch
   - after openUntil exactly one probe dispatches, and its success closes the breaker
4. team.stop leaves autopilot=0 everywhere and no queued autonomous runs, and an owner message still runs. team.resume restores exactly the rooms that were on.
5. Team off: dispatch order stays FIFO. The existing coordinator and board tests pass unchanged.
6. A dontAsk bot's routine run is refused with a notice until it is opted in.

tests/desktop-ipc.test.mjs is updated. Electron: tests/electron-runtime.cjs calls team.get through the utility process.

**Acceptance:**

- All suites are green.
- On Tony's PC, Team is off by default.
- Toggling Team on and off from the tray round-trips his room autopilot flags.

### V1: V1 (0.3.39): Desktop voice that works (parallel track, no schema)

**Why now:** Tony listed voice second. It touches no team code, so it ships early rather than at the end.

**Depends on:** M0 (none functionally; can merge any time after M0)

**Scope:**

- **desktop/voice.cjs** (new): providers whisper-local (opt-in download with pinned SHA-256), openai and groq (keys via protectSecret in voice.json), and a webspeech probe flag. Handles voice.transcribe, voice.status, voice.setProvider, voice.download and voice.setKey.
- **desktop/main.cjs:**
  - routes 'voice.*' before the allowlist check, as slack.* is at line 887;
  - adds a media permission handler (audio only, app origin);
  - allowlist adds messages.follow.
- **runtime/coordinator.mjs:** the messages.follow {requestIds} command maps request ids through the requests table to message ids and returns bridgeUpdates.
- **runtime/speakable.mjs** (new, pure).
- **Renderer:**
  - src/lib/voice.js (encodeWav, Segmenter, the follow reducer) and src/lib/useVoice.js.
  - src/voice/pcm-worklet.js.
  - App.jsx lines 586-646: startDictation and startVoiceChat are replaced by useVoice, and the Composer mic uses the same provider.
  - src/components/VoicePanel.jsx in Settings.
  - A 'Talk to Atlas' button in HQ.
- **Diagnostics:** voice.stt_failed and voice.provider_missing.
- **Docs:** docs/voice.md and README.md:87.

**Tests (fail first):**

tests/voice.test.mjs (new, fails first):
- speakable strips anybot, anybot-actions and anybot-artifacts blocks, code fences, URLs and paths, and clips at about 600 characters on a sentence boundary with 'The rest is in the chat.'
- Segmenter: 1 s speech, 0.8 s pause, 1 s speech, 1.5 s silence produces exactly 1 turn; 70 s of continuous speech is cut at 60 s.
- The follow reducer speaks a hand-off once and an approval once over repeated identical updates, then the reply.
- encodeWav writes a RIFF header, sample rate 16000.
- messages.follow against a Coordinator whose fake runner finishes after a fake 5 minutes returns the reply.

Other tests:
- tests/desktop-ipc.test.mjs includes messages.follow, and the Coordinator rejects 'voice.transcribe' as an unknown operation.
- Electron: tests/electron-threads.cjs with env ANYBOT_FAKE_STT: one spoken turn gives one message, the reply is spoken after a 3-minute fake run, and nothing is re-sent while speaking.

**Acceptance:**

- Suites are green.
- Manual: 5 voice turns with Atlas on Tony's PC with a real microphone, using local whisper or a key. Pauses inside a sentence don't split messages, and the bot's speech isn't re-captured.

### M2: M2 (0.3.40): Per-bot private folders (desks), schema v19

**Why now:** Nine content-project bots and five finance bots share an exact workspace path, so the dispatch lock runs them one at a time. Parallel work needs private folders before any always-on engine can produce throughput.

**Depends on:** M0

**Scope:**

- **runtime/desks.mjs** (new): deskPath, slug, ensureDesk (stat the home first; never create through a missing home) and gitExclude (worktree aware).
- **runtime/store.mjs** v19: `ALTER TABLE employees ADD COLUMN desk TEXT NOT NULL DEFAULT ''`. Compute path strings for bots outside `<userData>\workspaces`, with no file I/O. SCHEMA_VERSION becomes 19.
- **runtime/coordinator.mjs:**
  - createEmployee and updateEmployee compute the desk (a workspace change sets a new desk and leaves the old folder in place);
  - dispatch lock key `(desk||workspace).toLowerCase()`;
  - execute() calls ensureDesk before stageArtifacts, and a failure becomes desk.home_missing;
  - after-run tracker-file mtime check produces desk.tracker_write;
  - files.context adds the author's desk.
- **runtime/attachments.mjs:91 and runtime/artifacts.mjs:347** take `(inboxDir, relPrefix)` so the inbox becomes `<desk>\inbox`.
- **runtime/context.mjs:** add the private-folder line and change the inbox wording at line 144.
- **runtime/adapters.mjs:** employee-level Claude bots get `--disallowedTools` Edit and Write patterns for org.policy.trackerFiles. Active after M3, when levels exist; before that it is inert.
- **desktop/main.cjs:** main-only employees.openDesk (shell.openPath after validating the path).
- **src/components/EmployeeForm.jsx:** 'Private folder · Open'.
- **Diagnostics:** desk.home_missing, desk.create_failed, desk.exclude_failed and desk.tracker_write.
- **tests/fixtures/schema-v19.sql.**

**Tests (fail first):**

tests/desks.test.mjs (new, fails first):
1. The v18 fixture migrates to 45 desk paths of the form `<home>\.anybot\<slug>-<id8>`, archived bots in userData keep '', and no directory is created.
2. Two bots with the same home both reach 'running' at the same time (the fake runner holds both), and the same bot never runs twice.
3. Each bot's attachments land in its own `<desk>\inbox`, and an edited reference copy in one desk is untouched when another bot stages.
4. An anybot-artifacts manifest naming `.anybot/<desk>/draft.md` is captured.
5. A missing home fails the run with desk.home_missing and is not recreated.
6. In a temp git repo and in a git worktree (a .git file), `.anybot/` is appended to the common info/exclude exactly once, and `git status --porcelain` is clean after a run. A non-git home is untouched.

Also:
- tests/artifacts.test.mjs:243 and the attachments tests are updated to the desk inbox path.
- migrations.test.mjs expects 19.
- Electron test:e2e is green.

**Acceptance:**

- Suites are green.
- Live on Tony's PC: Nova and Scout (both in the content project) run at the same time.
- A Claude bot in the content project still lists that project's .claude/skills, because its cwd is unchanged.
- `git status` in the content project stays clean.

### M3: M3 (0.3.41): Levels, the 4-level cap, org policy, hold, safe fire, org repair (schema v20)

**Why now:** The hierarchy and runtime policy must exist before the pilot, so that per-level budgets and the chain are real. Firing today leaves orphans: reports pointing at archived managers, dead reviewers, and empty rooms.

**Depends on:** M0, M1

**Scope:**

- **runtime/levels.mjs and runtime/policy.mjs** (new).
- **store.mjs v20:** employees.level, hold and dailyRuns, plus the employee_revisions table. No level backfill.
- **org.mjs setManager** calls validatePlacement plus the span caps and refuses with the 4-level message.
- **coordinator.mjs:**
  - createEmployee returns {id} (the command returns `{...snapshot, created: id}`), takes level, and enforces policy models, forbidden paths and maxBots;
  - updateEmployee enforces policy and writes employee_revisions for level, manager, instructions, model, effort, harness, timeout, permissionMode and archived;
  - validateProjectFolders enforces forbidden paths;
  - dispatch and admission skip hold 1/2/3 as specified, and refuse autonomous runs for bots whose workspace contains a forbidden folder (policy.forbidden_path);
  - drainTick applies safeFire when a draining bot is idle.
- **hiring.mjs** (new, first part): safeFire, firePreview, repair, repairPreview and exportOrg.
- **New commands** (all allowlisted): org.levels.infer, org.levels.apply, org.setLevel, org.policy.get, org.policy.set, employees.hold, employees.firePreview, employees.fire {id, successor, stopNow}, org.repairPreview, org.repair and org.export.
- **UI:**
  - OrgPage.jsx level badges, level select and span counters;
  - LevelsSetup.jsx banner;
  - FireDialog.jsx;
  - Hold toggle;
  - EmployeeForm manager list filtered by level;
  - policy editor in the Team panel.
- **context.mjs:** the org layer's chain line states the level and hire authority, e.g. 'You are a director (level 2 of 4). You report to Atlas. You may propose: managers (from 0.3.50)'.
- **Diagnostics:** org.level_refused and policy.forbidden_path.
- **tests/fixtures/schema-v20.sql.**

**Tests (fail first):**

tests/levels.test.mjs (pure, new):
- inferLevels on a Life-Org-shaped fixture gives Atlas cos, 7 directors, Nico manager, 35 employees and Jim advisor
- two root bots with reports gives ambiguous

tests/org.test.mjs additions (fail first). setManager refuses:
- any bot under Pax
- a director under a director
- a manager under a manager
- a second cos
- demoting a manager with reports
- a 9th report under a manager

The employees.setManager command (org-chart drag) returns the same text.

tests/fire.test.mjs (new). Firing Nico with successor Dex:
- Pax, Brick and Tess move under Dex
- Nico's open tasks are reassigned to Dex where Dex is a member, otherwise unassigned with a notice
- the reviewer is replaced
- Nico is removed from Game Studio and archived only after his fake active run ends
- queued runs made during the drain never start
- a revision row is written

org.repair on the v18 fixture moves Dario and Altman off archived Alex, fixes the open task and review, and archives 'Snake game test'.

Policy refusals:
- Opus at low effort
- a non-policy model
- a workspace inside a forbidden folder
- a Vera-style root workspace: its autonomous run is refused while an owner message runs

Other: tests/desktop-ipc.test.mjs; migrations.test.mjs expects 20.

**Acceptance:**

- Suites are green.
- On Tony's PC: org.levels.infer shows the expected preview, Apply sets the levels, and dragging a bot under Pax is refused with the 4-level message.
- The repair preview lists the Alex, Dario and Altman leftovers.

### M4: M4 (0.3.42): Supervisor core (T1, T7, T8, admission, wakes log, explain) and snapshot diet (schema v21)

**Why now:** This is the central wake and admission pipeline, and every later autonomous path goes through it.

The snapshot diet must come before any always-on work: today snapshot() returns every message and every run, which takes about 1.7 s on a workspace with 121k runs.

**Depends on:** M1, M2, M3

**Scope:**

- **runtime/supervisor.mjs** (new): mark, tick, planWakes, admit, onRunEnded, allowChild, explain.
  - T1 task.ready replaces autopilot when Team is on.
    - Team hours apply, plus night shift for tasks labelled `overnight`.
    - The Team-on project brake pauses until midnight: metadata brake:<conv>, notice plus attention, and team.liftBrake.
    - The open-backlog cap is 5 per bot.
  - T8: allowChild is called from delegate() and activateMentions() under autonomous roots.
  - Outcome and actionHash rules, idle suppression, and loop detection.
- **store.mjs v21:** the wakes table, runs.wake and reports.kind.
- **coordinator.mjs:**
  - The timer calls supervisor.tick when Team is on, otherwise the legacy autopilot.
  - dispatch priority takes wakes.priority through a join.
  - execute() finally calls supervisor.onRunEnded.
  - The applyAction pipeline counts applied actions per run.
  - `snapshot()` is windowed:
    - messages: the newest 300 per conversation (ROW_NUMBER over conversation), plus olderCount per conversation;
    - runs: every queued, running or cancelling run, plus the newest 2,000 others, with output cut to 4 KB and outputTruncated set.
  - New commands: runs.get {id} (full output), messages.older {conversation, before, limit ≤200}, supervisor.wakes {status, since, employee}, supervisor.explain {employee}, team.liftBrake {conversation}.
- **Renderer:**
  - App.jsx (443-468): snapshot requests are throttled to at most 2 per second while Team is on.
  - Chat loads older messages on scroll-up.
  - RunTerminal and Activity use runs.get.
  - WakeLog.jsx and the 'Why isn't X working?' view.
  - TeamPulse shows the next wake.
- **Diagnostics:** supervisor.idle_suppressed, supervisor.loop_detected.
- **tests/perf/bench.mjs:** the synthetic 45-bot, 121k-run generator, moved from the scratchpad. Run it with `npm run bench:snapshot`.
- **tests/fixtures/schema-v21.sql.**

**Tests (fail first):**

tests/supervisor.test.mjs (new, fails first).

Pure, table-driven checks: planWakes and admit, covering each gate and its reason.

End to end: 7 simulated days on the 45-bot fixture, with a fake clock and a fake runner.
- (a) With no ready tasks, there are 0 autonomous runs.
- (b) With 30 ready tasks, active autonomous runs never exceed concurrency minus the reserve, and an owner message starts within one tick while every autonomous slot is busy.
- (c) No bot, project or org daily budget is exceeded.
- (d) Outside work hours nothing autonomous starts, except `overnight` tasks in rooms that have night shift on.
- (e) Every autonomous run has a wakes row with a reason and packet ids.
- (f) With Team off, no new autonomous run starts after the next tick, and the legacy autopilot tests pass unchanged.
- (g) A run with 2,000 characters of output and no applied actions counts as idle; two idle runs in a row suppress the trigger for 12 h.
- (h) Three identical action hashes in a row give a loop flag and suppression.
- (i) A mention or delegation child under an autonomous root with no budget left posts a notice and does not queue.
- (j) A Team-on project brake pauses the room until midnight and resumes it the next day without owner action.

tests/snapshot-window.test.mjs (new):
- messages are capped at 300 per conversation;
- runs.get returns the full output;
- messages.older pages backwards.

`npm run bench:snapshot` must show a snapshot in 150 ms or less at 30k runs and 60k messages.

Electron (tests/electron-threads.cjs): scrolling up loads older messages, and Activity opens the full output of a run older than the window.

migrations.test.mjs expects schema 21.

**Acceptance:**

- All suites are green.
- On the 121k-run benchmark DB, snapshot() takes less than 200 ms (about 1.7 s today).
- With Team off, Tony's app behaves as 0.3.41.

### V2: V2 (0.3.43): Phone mic, native speech, and follow route (APK rebuild, no schema)

**Why now:** The phone mic cannot work because the manifest lacks RECORD_AUDIO. The fix is independent of the team work and reuses V1's shared voice logic.

**Depends on:** V1

**Scope:**

- **android/app/src/main/AndroidManifest.xml:** add RECORD_AUDIO and MODIFY_AUDIO_SETTINGS.
- **package.json:** add the Capacitor community speech-recognition and text-to-speech plugins, with versions pinned after checking them against Capacitor 8.5.2; then `npm run mobile:sync`.
- **ios/App/App/Info.plist:** add NSMicrophoneUsageDescription and NSSpeechRecognitionUsageDescription.
- **runtime/mobile-gateway.mjs:** add `GET /v1/requests/:requestId`. It is owner-authenticated and returns bridgeUpdates-shaped data that fits the relay reply budget.
- **mobile/client.mjs:** add follow().
- **mobile/main.jsx:** rewrite the voice loop (lines 224-329) to use the native plugins plus the V1 Segmenter, speakable and follow reducer.
- **docs/mobile.md:** correct lines 50-51.

**Tests (fail first):**

- tests/android-manifest.test.mjs (new): asserts RECORD_AUDIO and MODIFY_AUDIO_SETTINGS are declared. It fails first.
- tests/mobile-gateway.test.mjs additions for the follow route:
  - a missing token gets 401;
  - an unknown id gets 404;
  - the reply is returned after a fake run;
  - the response fits the 64 KB frame via fitReply.
- tests/mobile-pwa.test.mjs stays green.

**Acceptance:**

On Tony's phone, with the new APK:
- dictation works;
- a spoken question gets a spoken reply after a long run;
- a notice is never read out as the reply.

### M5: M5 (0.3.44): Desk time, batched reviews, stalled work, returns as reports (no schema change)

**Why now:** Managers have to act on their team's output without a separate review run per task. Several states still wait on Tony forever: a failed task, a review that hits its limit, a synthesis chain that dies. This milestone makes the team self-sustaining.

**Depends on:** M4

**Scope:**

- **supervisor.mjs, T2 inbox wakes:**
  - Trigger conditions, debounce, cooldown and key are as in always_on_engine.
  - The packet comes from `digest.mjs` desk-time packet, SQL only, at most 6 KB, labelled as data.
  - Reports are marked read only when the run succeeds.
- **coordinator.mjs onTaskMoved:** with Team on, a reviewer is not queued immediately. Instead it calls supervisor.mark('review'). The review rule (team.reviews 'medium+' by default) leaves low or no-priority tasks created by bots without a reviewer. With Team off, today's behaviour is unchanged.
- **supervisor.mjs, T3 stalled:**
  - An environment-class failure restarts once the breaker is closed, at most 2 times per day.
  - A bot-class failure, or hitting the review limit, makes code file report {kind:'blocked'} to the manager.
- **coordinator.mjs returnToParent:** with Team on and an autonomous root, it inserts a report with kind 'return' and to = parent.employee, then marks T2. Owner-rooted chains are unchanged.
- **org.mjs report():** takes {kind, to}.
- **board.mjs:**
  - New task.assign action. The caller must be a member, the assignees must be below the caller and must be members, and the reviewer must be the caller or in the caller's chain.
  - task.create gains `project`.
  - Open-backlog cap of 5.
- **actions.mjs:** add task.assign to ACTION_TYPES; actionGuide({board, level, hasReports, autonomous}) gives leaders batched-review and assign guidance and gives employees none.
- **supervisor.mjs:** failure cooldowns of 30 min and 2 h.

**Tests (fail first):**

tests/desk-time.test.mjs (new, fails first):
1. 5 reports to Nova trigger exactly 1 Nova wake that lists all 5. The reports are unread after a failed run and read after a successful one.
2. 3 tasks entering Review for Nova within 20 minutes trigger 1 wake that applies 3 review actions. With Team off, the same moves create 3 immediate review runs, as today.
3. An autonomous CoS→director→manager→employee chain creates 0 synthesis runs and 3 return reports. An owner-started chain still creates its synthesis runs.
4. A timeout failure files a blocked report and wakes the manager within 10 minutes of fake time.
5. A usage_limit failure restarts after the breaker closes, at most 2 times per day.
6. task.assign is refused for a non-report.
7. A 6th open Backlog task for one bot is refused with "your report's queue is full".
8. Blocked reports that arrive 1 minute apart produce 1 wake.

The existing board and review tests pass unchanged.

**Acceptance:**

- All suites are green.
- In a fake-harness scenario on the Life Org fixture, Nova's team completes a 5-task objective loop with no owner input.

### M6: M6 (0.3.45): Clock schedules, objective cascade, standups, brief, weekly planning, gated refill (schema v22)

**Why now:** Routines are interval-only today: they drift, and anything missed while asleep is lost. The org also needs direction: Tony sets Atlas's objectives, and the chain sets everyone else's. This is the 'forever' part, with standups and the daily brief.

**Depends on:** M5

**Scope:**

- **runtime/schedule.mjs** (new, pure; injectable zone).
- **store.mjs v22:** routines gain at, days, kind, grace and skipIfQuiet, and a new objectives table.
- **routines.mjs:**
  - Clock schedules use nextOccurrence.
  - recover() and tick() catch up once inside grace and record 'caught-up'. Anything later is recorded 'missed'.
  - skipIfQuiet records 'skipped-quiet'.
  - tick() respects this.c.holding, fixing today's gap at line 219.
  - Interval routines are unchanged.
- **runtime/digest.mjs:** deterministic standup lines and the packets for the standup, brief, planning and weekly review.
- **Supervisor T4 ceremonies:** the standup cascade (managers 08:00, directors 08:20, CoS 08:45 brief), Monday planning (09:00, 09:30, 10:00) and the Friday 16:00 review. They are stored as routines rows with kind != 'prompt', created disabled.
- **Supervisor T5 refill:** gated plan wakes, the plan.hold action, and the churn limiter.
- **runtime/objectives.mjs:**
  - CRUD. Tony can edit any objective, and his edits lock it.
  - New action `objectives.set {employee, objectives:[{title, success, priority, parent}]}`. Only a leader can use it, only for a direct report, with at most 5 active objectives per bot, and the parent must be one of the setter's own objectives. A bot can never set its own.
  - task.create gains `objective`, stored as the label 'obj:<id8>'. It is required for tasks created in autonomous runs.
- **actions.mjs:** in autonomous runs doc.append is refused ('scheduled work must replace a section').
- **context.mjs:** new 'rhythm' layer with level, authority, objectives and budget left.
- **New commands:** objectives.list, objectives.create, objectives.update and objectives.archive. routines.create and routines.update accept the schedule fields.
- **UI:** RoutineForm.jsx time of day, ObjectivesEditor.jsx, and objective chips on the board.
- **Fixture:** tests/fixtures/schema-v22.sql.

**Tests (fail first):**

tests/schedule.test.mjs (new):
- An 07:30 Mon–Fri schedule fires every weekday for 30 simulated days with no drift.
- On the spring-forward and fall-back days it fires exactly once (America/New_York zone table).
- Saturday is skipped.

tests/routines.test.mjs, new cases (the existing ones stay unchanged):
- The app closed 06:00–08:00 with a 07:30 slot catches up once at 08:00 and records 'caught-up'.
- Starting 5 h late records 'missed'.
- skipIfQuiet with no change records 'skipped-quiet' and starts no run.
- Holding blocks enqueueing.

tests/ceremonies.test.mjs (new), a simulated day on the Life Org fixture:
- At most 9 standup LLM runs, in bottom-up order, and 0 employee standup runs.
- A quiet leader is skipped-quiet, and its lines roll up.
- The CoS brief packet contains every director's standup report.
- The HQ canvas block count is the same after 7 briefs.
- Monday planning creates no more tasks than the budget allows, and every one carries an 'obj:' label.
- task.create without an objective from an autonomous run is rejected.
- objectives.set on self or on a non-report is rejected.
- A refill fires only when every gate holds, and never twice within 6 h.
- A plan with 10 task.create actions keeps 8.
- plan.hold suppresses planning.

migrations.test.mjs expects 22.

**Acceptance:**

- All suites are green.
- A fake-harness simulated week on the fixture stays within budget with no owner input, and the brief appears in HQ every day.

### M7: M7 (0.3.46): Keep awake, wake timer, background start, sleep-safe runs (no schema change)

**Why now:** Tony said yes to waking the PC and keeping it up for work. Clock schedules (M6) now give predictable wake times.

**Depends on:** M6

**Scope:**

- **desktop/power.cjs** (new): shouldHold, buildWakeTaskXml, nextWakeAt, and the AwakeKeeper glue.
- **desktop/main.cjs:**
  - powerSaveBlocker ('prevent-app-suspension'), re-checked on each worker 'changed' message.
  - Wake task registration and removal through schtasks /Create /XML and /Delete, debounced 60 s.
  - `--background` and `--wake` handling at line 1116 and in second-instance at line 759.
  - setLoginItemSettings args ['--background'] at line 216.
  - powerMonitor suspend and resume send runtime.slept.
  - Tray checkbox and tooltip.
  - startup.json gains keepAwake and wakeForWork.
- **coordinator.mjs:**
  - Main-only commands runtime.nextDue and runtime.slept {ms}.
  - Slept time is added to active runs' waited clock, which adapters.mjs waitedMs reads.
  - Clock-jump fallback in the timer.
  - Resume triggers routine catch-up and supervisor.mark('resume').
- **UI:** src/components/PowerPanel.jsx.
- **Diagnostics:** power.wake_register_failed and power.blocker_failed.
- **Docs:** docs/operations.md, including the limits.

**Tests (fail first):**

tests/power.test.mjs (new, fails first):
- shouldHold truth table, including the 2-minute grace.
- The XML contains `<WakeToRun>true</WakeToRun>`, the correct local StartBoundary (nextDue minus 3 min) and the exe with `--background --wake`.
- The task is re-registered only when nextDue moves by more than 1 minute.
- nextDue is the minimum of the clock routines, the people review and the work-hours start.

tests/coordinator.test.mjs addition: a run with a 10-minute limit that spans an injected 30-minute sleep (runtime.slept) is not killed.

Electron (tests/electron-runtime.cjs): a Playwright _electron launch with `--background` shows no visible window.

**Acceptance:**

Manual on Tony's PC:
- `schtasks /Query /TN "\Any Bot\wake" /XML` shows WakeToRun.
- `powercfg /requests` lists Any Bot while a run is active and nothing about 2 minutes after it goes idle.
- Sleeping at 08:20 with an 08:30 schedule wakes the PC, the schedule runs, and the PC stays up until it ends.
- A login start doesn't show the window.

### M8: M8 (0.3.47): Owner Slack channel (no schema change)

**Why now:** Owner Slack is Tony's push channel, and it must work before the pilot. Today only approvals from work started in Slack reach Slack, and any paired user can click Approve.

**Depends on:** M1, M6

**Scope:**

- **runtime/slack-bridge.mjs:**
  - slack.json gains owner {mode, via, tokens, userId, dm, announced, digestQueue}.
  - New: ownerConnect, ownerPair, ownerSelectVia, ownerTest, notifyOwner(notice), settle(key), onOwnerCommand.
  - onAction accepts clicks only from the owner, including the existing anybot.approve and anybot.deny, and answers anyone else with an ephemeral refusal.
  - Button action ids: anybot.approval.*, anybot.team.*, anybot.run.retry.
  - chat.update when an item settles.
  - Quiet-hours batching, 20 pushes per hour, the hourly digest, and DM commands.
  - bridge.reply for thread replies.
- **runtime/slack-format.mjs:** ownerManifest and card builders (titles and summaries only).
- **runtime/attention.mjs** (new): asksQuestion moves here from src/lib/attention.js, which re-exports it. New attention kinds with urgency. New emitters in coordinator.mjs for failures in owner-started work, questions, 80% and 100% budget, the brake, team stop and resume, and a breaker opening.
- **worker.mjs:** forwards 'settled'.
- **main.cjs:**
  - Forwards attention (line 1296) to notifyOwner.
  - Forwards settled to slackBridge.settle.
  - slackRequest (line 1633) gains slack.owner.*.
  - Main-only bridge.reply → coordinator send into the thread.
- **src/components/OwnerNotificationsPanel.jsx.**
- **Diagnostic:** slack.owner_push_failed.
- **scripts/live-approval-timeout.mjs:** manual live test of the MCP approve timeout. If it passes, team.approvalTimeoutMinutes becomes configurable up to the verified value.

**Tests (fail first):**

tests/slack-owner.test.mjs (new, fake Slack from tests/slack.test.mjs, fails first):
1. One attention event produces exactly one owner DM.
2. An approval from a run started on the desktop DMs Allow and Deny.
3. A click from a paired user who is not the owner, including on a per-bot anybot.approve, is refused with an ephemeral message and changes nothing.
4. Approving on the desktop edits the Slack message.
5. The 'stop team' DM command calls team.stop, and the Pause button pauses the team.
6. A reply in a notice's thread lands as an owner message in the originating project thread.
7. During quiet hours a failure notice goes into the 07:00 digest, while a tool approval posts immediately.
8. The 21st push in an hour folds into the digest.

Also: tests/attention.test.mjs still passes against the re-export, and tests/desktop-ipc.test.mjs.

**Acceptance:**

- Suites are green.
- Manual: Tony connects the owner channel (a dedicated app, or Atlas's app), receives a real test card on his phone, and approves a real tool approval from Slack.
- The live approval-timeout result is recorded in docs/slack.md.

### M9: M9 (0.3.48): Turn-on wizard and the Life Org pilot (app wizard plus lifeOrg config; no schema change)

**Why now:** Before hiring or proposals are enabled, the budgets, the notification volume and the engine have to be proven on a small live slice: 2 rooms at 40 runs a day for 72 h.

**Depends on:** M3, M4, M5, M6, M7, M8

**Scope:**

App:
- src/components/TeamWizard.jsx. Its checks:
  - levels are assigned;
  - policy is set;
  - no chosen room has a forbidden-ancestor bot;
  - the snapshot diet is present;
  - owner Slack is connected (optional).
- Room and budget selection. Pilot defaults: YouTube Studio plus Game Studio, 40 runs a day, until +72 h, night shift off. Also optional keep-awake, wake and launch at login.
- The estimate from runtime/estimate.mjs.
- Enabling calls team.set and conversations.setAutopilot for the chosen rooms, with the flags saved.
- runtime/soak.mjs: a deterministic pilot report posted to HQ and Slack when the pilot ends. It covers runs per day by trigger, idle-wake share, budget hits, failures by class, notifications per day, bots over budget, and a forbidden-path grep of `<userData>/terminal` logs. The team keeps pilot budgets and does not expand without Tony.

lifeOrg ({root}/lifeOrg):
- org.json gains:
  - a `level` per bot;
  - `policy`: models machine-readable; forbiddenFolders as absolute {root} folders; forbiddenNames from the forbidden-name list in seed.mjs; houseRules from `shared` with an updated TRACKING rule (leads-only CLAUDE.md, TODO.md and bugs.md; employees draft in their private folder) and a new PROPOSALS rule; outwardTools; bashAllowlist;
  - `objectives`: Atlas's company objectives plus one per director, drafted from the missions for Tony to edit;
  - `schedules`: the Daily brief becomes the standup cascade and the Weekly review becomes weekly-review. Coach check-in Mon 08:00, AI news scan 06:30, Daily ideas 07:30, Evening recap 21:30, weekly routines Mon 08:00;
  - a `team` block with the pilot budgets;
  - Vera and Ward's workspace moved (owner decision).
- seed.mjs:
  - new flags --apply-levels, --apply-policy, --apply-objectives, --apply-schedules and --refresh-instructions. The last one composes instructions without the static 'Your direct reports' line and applies them through employees.update, which writes revisions;
  - every write path copies anybot.sqlite to anybot.backup-seed-<ts>.sqlite first, and refuses to run while Any Bot is running;
  - validate() checks the 4-level shape;
  - --dry-run prints levels, schedules and the maximum autonomous runs per day.
- lifeOrg/tests/seed.test.mjs (new).

**Tests (fail first):**

lifeOrg/tests/seed.test.mjs (new):
- validate() accepts the org at 4 levels and rejects a 5th level.
- --dry-run output is stable.
- A second apply is a no-op against a temp data dir using the worktree runtime via --app.
- --refresh-instructions removes the 'Your direct reports' line.

anyBot tests:
- tests/estimate.test.mjs (pure).
- tests/soak.test.mjs: a deterministic report from a fixture DB, including a forbidden-path hit.
- tests/electron-threads.cjs: the wizard enables two rooms and team.stop restores them.

**Acceptance:**

The pilot runs on Tony's PC for 72 h. The soak report must show:
- at most 40 runs a day;
- no bot over budget;
- no breaker failure storm;
- at most 15 notifications a day;
- 0 forbidden paths in the terminal logs;
- 0 beat or refill tasks without an objective label.

Tony reviews TeamPulse and the report, and signs off in chat. M10 merges only after that sign-off.

### M10: M10 (0.3.49): Decisions up the chain of command and the Decisions inbox (schema v23)

**Why now:** Tony asked for approvals to reach him through the chain of command. Publish, spend, escalation and budget decisions are the lowest-risk kinds, so they come first. Hires follow in M11.

**Depends on:** M9 (Tony's pilot sign-off), M5, M8

**Scope:**

- **runtime/proposals.mjs** (new):
  - OWNER_FINAL, frozen, and ROUTES as constants.
  - create, route, decide, escalate (T6), expire, apply and list.
  - Payload validation for publish, spend, escalation and budget.
  - Hops debounce the holder's wake to 5 min.
  - Deadline: 24 h or 3 fired wakes per hop, then 7-day owner expiry.
  - At most 2 returns per proposal.
- **store.mjs v23:** the proposals and proposal_steps tables, plus approvals.decidedBy and approvals.chain.
- **Actions:** proposal.create and proposal.decide, guide text by level.
- **Commands:** proposals.list, proposals.decide {id, decision approve|reject|changes, comment}, proposals.withdraw. Snapshot gains the owner-held proposals (up to 50) and counts.
- **coordinator.mjs:**
  - Reaching the review limit creates an escalation proposal when Team is on.
  - Approvals onRequest records chain names. Decide records decidedBy.
  - After each approval decision, an FYI report {kind:'decision'} goes to the requester's manager.
- **digest.mjs:** proposals are included in desk-time packets, and the CoS brief carries FYI lines.
- **desktop/window-shell.cjs:47-53** and **src/lib/navigation.js:** add the `proposal` key.
- **UI:** DecisionsPage.jsx, DecisionCard.jsx and a sidebar badge.
- **Slack:** anybot.proposal.approve|reject|open buttons, a thread reply becomes a comment, and more than 10 open cards collapse into a digest.
- **runtime/mobile-gateway.mjs:** GET /v1/proposals, POST /v1/proposals/:id, GET /v1/approvals, POST /v1/approvals/:id, owner only, with overview counts. mobile/main.jsx gets a Decisions tab.
- **Diagnostics:** proposals.escalated and proposals.expired.
- **Fixture:** tests/fixtures/schema-v23.sql.

**Tests (fail first):**

tests/proposals.test.mjs (new, fails first):
1. Tess files a publish proposal. Nico's desk-time wake (the fake runner emits an endorse) endorses it, then Dex endorses it. The owner card appears with the Atlas FYI line and exactly one attention event. The owner approves, and Tess gets exactly one priority-20 'Approved' run.
2. A proposal.decide from a bot that is not the holder is rejected with a notice.
3. A bot's 'approve' on an owner-final kind is rejected.
4. A reject at Dex ends the proposal with a report to Tess, and it never reaches the owner.
5. A 3rd return is refused.
6. 24 h of silence (fake clock) escalates with a 'timeout' step and no run.
7. Two proposals to Nico 1 minute apart produce one wake.
8. The owner can approve while the proposal is still at Nico's hop.
9. Open proposals survive a Coordinator restart.
10. org.policy.set cannot change OWNER_FINAL or ROUTES.

Also:
- tests/mobile-gateway.test.mjs: auth, and owner-only decide for proposals and approvals.
- tests/slack-owner.test.mjs: proposal buttons, and the digest when more than 10 cards are open.
- tests/desktop-ipc.test.mjs.
- Electron: an approve from DecisionsPage in the Playwright pass against the mocked bridge.
- migrations.test.mjs expects 23.

**Acceptance:**

- Suites are green.
- Live: a real employee's publish proposal in YouTube Studio reaches Tony through Nova, and Tony approves it from Slack.

### M11: M11 (0.3.50): Hiring, firing and adjusting through the chain (no schema change)

**Why now:** Hiring is the core of 'CoS hires directors, directors hire managers, managers hire employees'. It is gated by the proposals pipeline (M10), the levels work (M3) and the pilot's proof of budgets (M9).

**Depends on:** M10, M3

**Scope:**

- **runtime/hiring.mjs** adds mayPropose, validateHire, applyHire, applyAdjust and composeInstructions:
  - Authority is proposer level + 1.
  - Evidence is attached.
  - Limits: spans, newManagerSpan, maxBots, hire rates, spare capacity, subtree flags (active from M12) and room capacity.
  - Hires go into the room or a new team room with autopilot per Tony's checkbox.
  - Each hire gets an onboarding task.
  - Every change writes a revision.
- **proposals.mjs** enables the hire, fire and adjust kinds. Fire and adjust route along the target's chain, skipping the proposer. permissionMode and level are never accepted in adjust. A coaching note is written as a private, unpinned memory with source 'coaching'.
- **Supervisor drainTick** handles hold=3 (adjust) as well as hold=2 (fire).
- **Policy:** team.hiringEnabled gate (off) and directorsHireEmployees (off).
- **Owner card:** hire preview, 'Turn Team on for the new room' checkbox, Approve with edits (EmployeeForm prefilled).
- **Slack card** update: 'Hired <name> (<level>, <room>)'.
- **lifeOrg/export.mjs** (new) merges org.export into org.json.
- **context.mjs** drops the static reports line from composed instructions.
- **Diagnostics:** hiring.rejected and hiring.apply_failed.

**Tests (fail first):**

tests/hiring.test.mjs (new, fails first). Hire from a director, end to end:
- Nova proposes the manager 'Kai', Atlas endorses in a desk-time wake, and the owner approves.
- Kai exists at level manager under Nova, with its home in the content project and a desk path.
- A new room 'YouTube Studio: Kai's team' holds Nova and Kai, with autopilot off because the box was unchecked.
- Kai has an onboarding task, and Nova gets a report.

Routing: Kai's employee proposal routes Kai → Nova → Atlas → owner.

Each of these is refused:
- Scout, an employee, proposing a hire
- Dex proposing an employee while the toggle is off
- any placement under Pax
- a hire at maxBots
- a model outside policy
- a second open hire from the same proposer
- any hire while hiringEnabled is false

Other outcomes:
- A rejected hire creates nothing.
- A name taken between approval and apply sets status 'failed' and posts a notice.
- Adjust:
  - A permissionMode change is rejected.
  - An effort change waits until the target's fake run ends, then applies with a revision row.
  - A coaching note memory is not pinned.
- A fire runs through the chain, then drains and applies.

export.mjs round-trips a hire into org.json (lifeOrg/tests).

**Acceptance:**

- Suites are green.
- Live, with hiringEnabled on for a test: Nico proposes a QA employee for Game Studio, it is endorsed by Dex and Atlas, and Tony approves it in Slack.
- The new bot runs its onboarding task in its own desk.

### M12: M12 (0.3.51): Daily people review, the adjust-or-fire breakdown (schema v24)

**Why now:** Tony asked for a daily breakdown of which employees to adjust or fire. It needs the supervisor outcomes (M4), the schedules (M6), and the adjust/fire apply path (M11) to act on its findings.

**Depends on:** M6, M10, M11

**Scope:**

- **runtime/performance.mjs** (new): metrics with minimum samples, a split between bot failures and environment failures, leader metrics, verdicts, fixes, cooldown rules and fire-candidate preconditions.
- **store.mjs v24:** the perf_daily table.
- **Supervisor system job** at team.peopleReviewAt (06:45) with 180 minutes of catch-up. It:
  - writes perf_daily;
  - replaces the HQ canvas 'People review' section with doc.section;
  - sends a Slack summary;
  - puts flags into the manager's next standup or desk-time packet;
  - escalates an unanswered flag after 2 days.
- **Actions:** new `people.keep {employee, reason}`. Proposal caps: 3 per proposer per day, 6 per org per day. Atlas and Jim go straight to Tony.
- **Hiring:** the subtree-flag check is now active.
- **Commands:** people.day, people.bot, people.runNow.
- **UI:** src/components/org/PeopleTab.jsx (table, 14-day trend, history, archived desks with Recycle Bin).
- **Diagnostic:** people.apply_failed.
- **Fixture:** tests/fixtures/schema-v24.sql.

**Tests (fail first):**

tests/performance.test.mjs (new, fails first):
- A golden synthetic 45-bot workspace with known failure, rejection, redo, denial and stuck rates yields the expected verdicts and fixes.
- Low samples give 'insufficient'.
- usage_limit and auth failures are excluded.
- A bot adjusted 3 days ago isn't re-flagged Adjust.
- Fire-candidate requires a prior failed adjustment or 14 idle days plus role overlap.
- perf_daily rows contain none of the fixture's message text.
- A clean day spends 0 LLM runs.
- A flagged bot appears in its manager's next standup packet.
- people.keep is recorded.
- An unanswered flag escalates after 2 days.
- Nova's adjust for Scout (timeout 20 to 45) goes through Atlas to the owner and is applied once Scout is idle, with a revision row.

bench:snapshot also times the pack at under 1 s on the 121k DB.

migrations.test.mjs expects 24.

**Acceptance:**

- Suites are green.
- On Tony's PC the 06:45 review writes the HQ table and a Slack summary every day for 3 days. Early 'insufficient data' verdicts are expected.

### M13: M13 (0.3.52): Standing tool-approval rules through the chain (schema v25)

**Why now:** With the whole team running, tool prompts would flood Tony. Managers can propose narrow, expiring rules for Tony to approve, which cuts the prompts while keeping hard limits.

**Depends on:** M10

**Scope:**

- **runtime/rules.mjs** (new):
  - validate: edit-under or bash-prefix only; a strict tokenizer; the never-list (network, publish/send, delete, git push, credentials, mcp__*); expiry of at most 30 days and required.
  - match(approval, run), with scopes employee, subtree and root.
- **store.mjs v25:** the approval_rules table.
- **proposals.mjs:** enables the 'rule' kind (owner-final). An approved publish creates a single-use, root-scoped, 60-minute 'grant' for the named tool.
- **coordinator.mjs, Approvals onRequest:** checks rules synchronously before notifying and settles with decidedBy rule:<id> or grant:<proposal>. A non-matching prompt from a root with a publish grant is labelled 'pre-approved in P'.
- **Commands:** rules.list and rules.revoke.
- **UI:** a rules manager in the Team panel.
- **Fixture:** tests/fixtures/schema-v25.sql.

**Tests (fail first):**

tests/approval-rules.test.mjs (new, fails first):
- An Edit under {root}/content/drafts that matches a rule is allowed immediately with decidedBy rule:<id> and no attention.
- The same edit outside that path goes to the owner.
- Creating rules for rm, git push, curl, mcp__gmail__send_message and 'npm test && rm -rf x' is refused.
- An expired rule is ignored.
- An approved publish auto-allows the first matching tool call in that root once, and a second one goes to the owner.
- A subtree:Nova rule applies to Scout but not to Nico's team.

tests/approvals.test.mjs is extended. migrations.test.mjs expects 25.

**Acceptance:**

- Suites are green.
- Live: Nova proposes an `npm run build` rule for her team, Tony approves it, and a matching prompt no longer reaches him.

### M14: M14 (0.3.53): Full Life Org rollout and docs

**Why now:** This turns the whole org on, with hiring enabled, after the pilot data and Tony's go.

**Depends on:** M9 through M13, plus Tony's go

**Scope:**

- Team is on for all 9 Life Org rooms. Budgets:
  - org 150 runs a day;
  - per level: employee 12, manager 24, director 20, CoS 16;
  - per project 40 a day;
  - a token ceiling set from pilot usage.
- hiringEnabled is on. Night shift stays off unless Tony opts rooms in.
- Docs: docs/team.md (new), design.md, README.md, docs/voice.md, docs/mobile.md, docs/slack.md, docs/operations.md.
- Update the 'Last turn / Pending' sections in anyBot/CLAUDE.md and lifeOrg/CLAUDE.md, and close the matching bugs.md and TODO.md entries.

**Tests (fail first):**

- No new unit tests.
- tests/electron-threads.cjs runs a full-org smoke with a fake harness for one simulated day.
- All suites and `npm run doctor` are green.

**Acceptance:**

A 7-day live run shows:
- no budget exceeded;
- an idle-wake share under 20%;
- at least one hire proposal processed all the way from a bot to Tony;
- one people review delivered every day;
- the PC woke for the 06:45 and 08:00 schedules;
- 20 or fewer Slack notifications a day.

Tony confirms that the team kept working without prompting and that he stopped and resumed it from Slack.

## Critic corrections (apply while building)

- **[high] The outward-tool block can't stop what bots actually load. The editor is seeded from MCP server names in ~/.claude.json and project .mcp.json, then matched on words like mail, slack or vercel. On Tony's PC, ~/.claude.json has no user-level mcpServers. The outward tools that do reach Claude Code runs on this account are claude.ai connectors with UUID names (for example mcp__<uuid>__send_message for mail, mcp__<uuid>__slack_send_message, and mcp__<uuid>__buy_domain/buy_credits for a hosting provider), global plugin servers (mcp__plugin_vercel_vercel__*, mcp__plugin_small-business_shopify__*, playwright), plus claude-in-chrome and computer-use, which drive Tony's logged-in browser and desktop. A name blocklist matches none of these, so unattended runs keep send, buy and publish tools.**
  Fix: For unattended (non-owner-origin) Claude runs, switch from a blocklist to default-deny:
- Pass --strict-mcp-config with a generated config that holds only the anybot approve server plus an owner-approved allowlist.
- Turn off claude.ai connectors for those runs; verify the env switch in the M1 live smoke.
- Enforce it at run start: parse the stream-json system/init event (its tools and mcp_servers lists) and abort the run with policy.outward_tool if any tool outside the allowlist appears.
- Add a unit test with a fake init event, and a live smoke that prints the init tool list for an unattended run.
- Keep --disallowedTools only as a second layer. This also means the CLAUDE.md rule 'never add --strict-mcp-config' needs an explicit exception, but only for unattended runs.
- **[high] The Codex sandbox isn't a boundary for autonomous runs, and the harness counts are wrong. ~/.codex/config.toml enables the MCP servers node_repl and fusion. MCP servers run outside Codex's workspace-write/no-network sandbox, so a Codex bot can reach the network or write outside its home, including forbidden folders, through node_repl. The spec (and the task) say 40 Claude and 5 Codex bots; org.json has 36 Claude and 9 Codex (Scout, Reel, Bolt, Forge, Weaver, Pax, Ledger, Vance, Ward). Three of the 13 pilot bots are Codex (Scout, Reel, Pax). Risk 5 lists this gap but ships nothing for it.**
  Fix: In M1, for autonomous Codex runs, disable every configured MCP server: `-c mcp_servers.<name>.enabled=false` for each name read from config.toml, or a verified equivalent.
- Add tests/live-codex-mcp-off.mjs to prove node_repl is absent.
- Until that live check passes, admission refuses autonomous Codex runs (code run.codex_mcp_unverified).
- Correct the counts everywhere to 36 Claude and 9 Codex. Note that tracker-file enforcement is detection-only for 9 bots, not 5.
- **[high] Anyone who can reach a bridge gets the owner lane. coordinator.bridgeSend (coordinator.mjs:1572) calls send(), which writes the message with author 'human'. That covers every Buzz @mention (buzz-bridge.mjs says 'Buzz … decides who may mention it') and every paired Slack user. isAutonomous() keys on author==='human', so those messages get priority 30 and budget exemption, and they are not 'unattended', so the outward-tool block doesn't apply. The spec makes this explicit: 'Buzz messages automatically get your owner lane'. The same inference also misclassifies owner retries of system-rooted runs as autonomous.**
  Fix (as built in M0, which replaces the column this fix first proposed): record the origin explicitly instead of inferring it from messages.author.
- Labels live in metadata `origin:<message id>` (runtime/origin.mjs), read by `Coordinator.messageOrigin`/`runOrigin`. There is no runs.origin column and no v19 bump for it. A retry keeps its message, so it keeps the origin; supervisor wakes post system messages.
- `ownerAuthority` is desktop-only for now. Whether the owner-authenticated phone and the Slack owner.userId are 'owner' is an open M1 decision. Buzz and other paired users are 'guest': budgeted, unattended tool policy, priority 20.
- 'Buzz gets your owner lane' is removed from the spec.
- Test: a Buzz ask counts against the budget and gets unattended flags; an owner retry of a routine run is priority 30.
- **[high] Publish grants are both unsafe and unusable.
- Unsafe: a grant matches on tool name within a root for 60 minutes. Tony approves one email, and the bot, or injected content it read afterwards, can send a different one.
- Unusable: the approved hand-off run is still system-rooted, so invocation() adds the outward tool to --disallowedTools. Claude Code then refuses the call before the approval bridge ever sees it, and the grant can never match. The grant scope ('that requester run's root') also doesn't match the new priority-20 hand-off run, which has its own root.**
  Fix: Bind each grant to {tool, sha256 of the canonical JSON input}, and show that exact input on the Decision card (it becomes a required publish payload field).
- Scope the grant to the hand-off run that the approval queues, and have invocation() remove exactly that one tool from the disallowed list (and add it to the strict MCP config) for that run only.
- The bridge allows only an exact input-hash match; anything else goes to a live prompt or is denied.
- Test: a changed recipient or body after approval is not auto-allowed.
- **[high] Several proposed bash-prefix rules run arbitrary code. `npm test`, `npm run build`, `node scripts/` and `npx remotion render` all run code the bot itself can edit under Edit(./**) (package.json scripts, scripts/*.js), and npx can download packages. One approved 'npm test' rule lets any bot in that subtree run anything, with no prompt. The tokenizer that bans &&, | and so on doesn't help, because the payload lives in the edited file.**
  Fix: Limit bash-prefix rules to commands that nothing in the workspace can redefine (git status, git diff --stat, git log, ls/dir).
- For script runners, a rule must pin the sha256 of the resolved target: the package.json scripts entry, or the script file. It auto-disables, and says so on the next prompt, when the hash changes.
- Drop `node scripts/` and `npx …` from the default list.
- Add tests: an edited package.json test script no longer matches, and npx never matches.
- **[high] Live tool approvals from autonomous runs defeat the design and don't follow Tony's words:
- Each one blocks a bot and a concurrency slot for 15 minutes (30 after M8).
- The spec makes 'every tool approval' urgent even in quiet hours, so night-shift bots ping his phone at 2 am.
- Tony is away from the app most of the day (Atlas's mission says his own work happens evenings and weekends), so most of these approvals will expire.
- They skip the chain he asked for ('send approvals to me for review via the chain of command'), and this deviation isn't listed as an owner decision.**
  Fix: Add team.unattendedPrompts, default 'defer'. When a run is not owner-origin, Approvals.onRequest settles it at once as a deny with guidance: file a proposal.create {kind:'publish'|'escalation', tool, input} and stop.
- That proposal climbs manager, then director, then Atlas, then Tony, like the durable decisions, and approval yields the exact-input grant.
- Owner-origin runs keep live prompts, and only those push in quiet hours.
- This removes the slot deadlock, and autonomy no longer depends on the M8 approval-timeout live test.
- Add it to owner_decisions_needed ('defer' versus 'live' for unattended runs).
- Test: an autonomous approval request settles in under 1 s, a proposal exists, and nothing is pushed.
- **[high] M2 turns on parallel work for everyone at merge, which breaks the spec's own 'default OFF at merge' principle. The lock key moves from workspace (coordinator.mjs:1839/1856) to desk with no Team gate. So as soon as 0.3.40 is installed, Tony's owner-driven delegations run up to 8 bots at once in one working tree: 9 in the content project (a git repo) and 5 in lifeOrg/finance. That happens before levels (M3), the disallowed tracker files and the M9 TRACKING house rule exist.**
  Fix: Put the desk lock behind a per-room flag, conversations.parallel or metadata parallel:<conv>, default off. The TeamWizard turns it on for pilot rooms once M3 and the house rule are in.
- Keep the lock key workspace.toLowerCase() everywhere else.
- M2 test: with the flag off, two bots in one home still serialize. With it on, they run together.
- Tell Tony plainly in owner decisions: the private folder holds drafts and scratch, but the cwd stays shared, so parallel bots still edit the same project files.
- **[high] The kill switch leaks.
- team.stop sets enabled=false, which puts the app back in legacy mode. routines.tick (routines.mjs:219) ignores team state, so enabled prompt routines keep queueing autonomous runs.
- Autonomous runs that are still finishing apply their delegations and @mentions, and under legacy rules those children queue and run with no gate.
- Turning Team off in Settings, as opposed to 'Stop the team', leaves rooms with autopilot=1 running the legacy autopilot, which has no budgets.**
  Fix: Make every off path the same state machine: off, running, paused or stopped.
- In the stopped and paused states, routines are held (a new occurrence status 'skipped-stopped').
- Chain children, mentions and returns from non-owner-origin runs are refused with one notice.
- Legacy autopilot doesn't run in rooms that Team manages.
- Stop 'Team' reusing conversations.autopilot: add a separate per-room team flag, so Team off never revives legacy autopilot.
- Tests: after team.stop, a due routine and a finishing run's delegation create 0 runs, and team.set enabled=false gives the same result as team.stop.
- **[high] Tony asked for a daily adjust-or-fire breakdown now. The spec delivers it at 0.3.51, the 15th PR, behind M6, M10 and M11. Yet the breakdown itself is deterministic, costs zero tokens and is read-only; only acting on it needs proposals. Shipping it late also wastes weeks of history, even though the live DB has only 39 runs.**
  Fix: Split M12:
- **M12a**, right after M1, or M3 if levels are wanted for grouping (fall back to grouping by manager). It adds the perf_daily table, performance.mjs, a 'People review' routine that shows in the Routines list and is toggleable (kind 'people-review', catch-up inside grace), the HQ canvas section, the People tab and people.runNow. Verdicts only; nothing is routed.
- **M12b**, after M11. It feeds flags into standups, adds people.keep and escalation, and turns on the subtree-flag hiring refusal.
- **[high] The people-review rules would steer Tony toward adjusting or firing the wrong bots:
- (a) The fire-candidate path for 14 idle days counts bots in rooms where Team is off. That is 32 of the 45 bots throughout a pilot limited to 2 rooms.
- (b) The redo regex matches bare 'no' and 'wrong' ('no rush', 'no idea'), and it can't tell which bot a correction meant in multi-bot threads.
- (c) Cost is compared with peers on the same harness across different effort levels and roles, for example Opus high Quill against Opus medium Pixel.
- (d) n≥5 with 15% and 25% thresholds flags a bot at 2 failures out of 5.
- (e) The spec counts 'exit' as bot-caused, but in classifyRunError it is the catch-all fallback, which includes environment crashes.
- (f) The tracker-write metric flags Ward, whose mission is to maintain TODO.md, bugs.md and CLAUDE.md, and the coding bots (Bolt, Forge, Weaver, Pax), whose project conventions require CLAUDE.md updates.**
  Fix: - Count idle days only when the bot was eligible: its room had Team on, or it had an enabled schedule. Otherwise mark it 'not scheduled'.
- Replace the regex with explicit owner signals: runs.retry, owner Stop, review 'changes', and a new thumbs-down on a reply or a done task.
- Compare cost only with peers on the same harness, model and effort, with at least 3 peers; otherwise 'insufficient'.
- Require n≥10 and use a Wilson lower bound against the thresholds.
- Treat 'exit' as ambiguous and leave it out of bot failure unless the harness reported an error from the model's own turn.
- Add policy.trackerWriters exemptions.
- Add a golden test for each false-positive case.
- **[high] Firing lacks guards against the wrong target:
- A bot-filed fire proposal only needs to come from someone above the target. The target doesn't have to be flagged, so a report that injected content shaped (up to 2000 characters of bot-written text feeding a manager's packet) can turn into a fire card.
- Fire, hire, adjust and rule cards are approvable with one tap in Slack or on the phone. A hire's mission and an adjust's instructionsAppend become durable instructions, which is an injection path.
- There is no undo: safeFire archives the bot and scatters its reports, tasks and rooms.**
  Fix: - Accept a bot-filed fire only when the target's latest perf_daily verdict is 'fire-candidate', or Tony flagged it. Resolve the target to an id inside the proposer's subtree, never by name.
- For hire, fire, adjust and rule cards, Slack and phone show only 'Open'. Approval happens on the desktop Decision card, which shows the full mission or instruction text, escaped. A fire needs the bot's name typed to confirm.
- Add employees.restore {id}, available for 30 days. It reverses safeFire from its employee_revisions row: re-parent reports if still valid, re-add rooms, re-enable routines.
- Tests: fire proposals for an 'ok' bot and for a name-only target are refused, and a restore round-trips.
- **[medium] The breaker can trip on false signals and halt every Claude bot. classifyRunError runs a loose regex (diagnostics.mjs:10-19: billing, quota, credentials, 'log in', \b429\b, api key) over free-text error messages. A Finance, Sentry or Sales run whose failure text quotes task content can classify as usage_limit or auth. Two such runs in 10 minutes would open the breaker for all 36 Claude bots.**
  Fix: Open the breaker only on structured signals:
- the Claude stream-json result/error event with api_error_status 429, 401 or 403, or the harness's own rate-limit event;
- exact known CLI error strings from the harness process, not model output.

Keep the regex for diagnostics only. Add a test where a failed run's output mentions 'billing quota 429' and the breaker stays closed.
- **[medium] The real ceiling is Tony's own plan, and the spec treats token caps as optional. Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set, so bots run on Tony's Claude and ChatGPT subscriptions. An always-on team that uses up the 5-hour or weekly limits also blocks his own Claude Code and Codex sessions, the tools he builds anyBot with. orgTokensPerDay defaults to 0 (off), and bot timeouts reach 90 minutes (Bolt) or 60 (Nico, Vera, Rowan-class bots).**
  Fix: - Add an owner decision: the share of each plan the team may use.
- The pilot report measures tokens per day per harness.
- orgTokensPerDay becomes required (not 0) before M14, set from pilot data.
- Autonomous runs clamp timeoutMinutes to the level default (employee 30, manager 45, director 60, with desk time and standups at 20), whatever the bot's own setting.
- Owner-origin runs keep the bot's timeout.
- **[medium] Tony can't get through to a busy bot. Dispatch allows one run per bot, and the owner reserve only frees slots, not the bot itself. If Tony messages Atlas during the 08:45 brief run, or Nova during a 45-minute desk-time run, he waits behind autonomous work. Test (b) in M4 only covers the case where the target bot is free.**
  Fix: When an owner-origin run is queued for a bot that is busy with a non-owner run, show 'Nova is on autonomous work (desk time, 12m) · Interrupt'. Interrupt cancels and requeues the autonomous run, with the wake marked 'preempted'. Optionally auto-preempt when the autonomous run started less than 2 minutes ago.

Add M4 test: an owner message to a bot busy with autonomous work starts within one tick after Interrupt.
- **[medium] Desk-time batches can exceed the action cap and waste the whole run. ACTION_LIMIT is 20 (actions.mjs:4), and actionsFrom throws for the whole block when a reply has more than 20 actions, so nothing is applied. The T2 packet allows 20 review actions plus 5 proposal decisions, plus report, task.assign and objectives actions.**
  Fix: Cap desk-time packets at 12 reviews plus 3 proposals, which leaves headroom under 20. Or give desk-time wakes a higher per-run limit, and apply the first N actions with a notice rather than rejecting the block.

Test: a desk-time reply with 21 actions still applies the reviews.
- **[medium] Board rules let employees push work upward and dodge review:
- The task.create assignees field is checked only for room membership (board.mjs applyAgentAction). An employee can assign work to its manager or a peer, and T1 then auto-starts it against their budget.
- The 'medium+' reviewer rule keys on the priority the bot sets itself.
- Low-priority tasks a bot creates and closes itself, with no reviewer, count as 'acted' and as throughput, which rewards busywork.**
  Fix: With Team on, in non-owner-origin runs:
- task.create assignees must be the caller or someone in its subtree.
- Every task created there gets a reviewer: the creator's manager, or the creator when it is the lead assigning its own reports. Priority doesn't matter.
- Tasks created and completed by the same bot with no review don't count as 'acted' or toward throughput.

Tests: an upward assignment is refused; a self-created low task has a reviewer.
- **[medium] Hiring limits leave gaps:
- A newly hired manager can propose employees on day one.
- The spare-capacity check can be gamed by busywork that keeps members looking busy.
- When the org or project run budget is the binding limit, more bots add leader overhead (standups, desk time) without adding throughput. Nothing refuses a hire in that case.
- Atlas already has 7 directors and the CoS span cap is 8, so 'Atlas can hire directors' really means one more. The owner decisions don't say so.**
  Fix: - Add a 14-day probation: no hire proposals from a bot until it is 14 days old and its latest verdict is not adjust or fire-candidate.
- Refuse a hire when the proposer's subtree has a busywork or loop flag, or when the org or project cap was hit on 3 or more of the last 7 days.
- Show 'budget-bound: yes/no' and the projected leader-overhead runs on the card.
- Add the CoS span (8, so 1 more director) and HQ seats (3 left) to owner_decisions_needed.
- **[medium] Owner fatigue: proposals that reach Tony are marked urgent and pushed at once, even in quiet hours. That contradicts Atlas's own mission ('batch approvals into one list') and Tony's working hours. Up to 6 people proposals a day plus publishes, hires and budgets can all arrive while he is at work.**
  Fix: - Owner-held proposals go into a digest at times Tony picks (default 12:30 and 19:00, weekdays), and are always visible on the Decisions page.
- A daily cap of new owner-final cards (default 10), with overflow queued by priority.
- Urgent is reserved for owner-origin tool prompts, breaker trips and kill-switch confirmations.
- Add test: a proposal arriving at 10:00 posts in the 12:30 digest, not at once.
- **[medium] The snapshot diet silently truncates several renderer features, and it is bundled into the supervisor milestone:
- Canvas links come from data.messages (ProjectDoc.jsx:173).
- OrgPage looks up report.run in data.runs (OrgPage.jsx:353, 362).
- UsageToday totals and src/lib/attention.js also read the full lists.
- With 300 messages per conversation and 2,000 runs, older links and report links disappear.

Bundling this renderer rewrite into M4 makes two high-risk changes one PR.**
  Fix: Make the snapshot diet its own milestone after M1 and before M4:
- List every renderer consumer of data.messages and data.runs.
- Move derived views (Canvas links, report-to-run links, usage totals) to runtime queries (docs.links, runs.get, usage.today).
- Add a test per consumer against a DB beyond the window.

M4 then depends on it.
- **[medium] The tracker-file rule conflicts with existing missions and conventions, and doesn't cover everything:
- Ward (employee, Codex) exists to keep TODO.md, bugs.md and CLAUDE.md current.
- Bolt must update anyBot/CLAUDE.md for each PR under that repo's conventions.
- The workspace CLAUDE.md, loaded as an ancestor into every Claude bot, tells every project change to update CLAUDE.md.
- --disallowedTools Edit/Write does nothing against Bash or PowerShell writes.**
  Fix: - Restrict the rule to the workspace-level {root}/TODO.md and bugs.md.
- A project's CLAUDE.md 'Last turn / Pending' may be written by the bot that changed that project, or goes through its lead's review.
- Add a policy.trackerWriters exemption list (directors, managers, Ward).
- Run the mtime/sha check after every run for every harness, not just Codex.
- Update the TRACKING house rule wording to match.
- **[medium] Some homes shouldn't host autonomous work at all.
- Ward's mission (the whole workspace, git repos, retirements) can't be done from lifeOrg/ops, and it overlaps the existing deterministic routines/ workspace-freshness routine.
- Bolt works in {root}/anyBot, the checkout that Tony's own Claude and Codex sessions edit, and that feeds releases to every install. An always-on Bolt there would collide with those sessions.
- Worktree desks for coding bots are deferred to 'later'.**
  Fix: - Add policy.ownerOnlyFolders (default: the anyBot source checkout and the {root} folder). Admission refuses non-owner-origin runs there, with the code policy.owner_only.
- Coding bots in git repos (Bolt, Forge, Weaver, Pax, Reel) join Team only after worktree desks exist, or stay owner-driven.
- Change the Vera/Ward decision options to: Vera → lifeOrg/dev (using the Dev room folders); Ward either owner-only or archived in favour of the workspace-freshness routine.
- **[medium] Applying changes through seed.mjs is hazardous for an always-on app:
- seed opens the live DB through the Coordinator constructor, which runs reconcileInterrupted and marks running runs interrupted.
- An always-on app is effectively never closed.
- A runtime passed with --app whose SCHEMA_VERSION is newer migrates Tony's DB past what the installed app can open.
- 'Copies anybot.sqlite' misses pages still in the -wal file.
- --refresh-instructions overwrites instructions Tony edited in the app.**
  Fix: - Build the in-app, main-only org.import {preview, apply} command. It is already pending in lifeOrg/CLAUDE.md as 'Import org template'. It applies levels, policy, objectives and schedules to a running app, with a diff preview.
- If seed.mjs keeps write paths:
  - refuse when the runtime's SCHEMA_VERSION differs from the stored schema, or when the app holds its single-instance lock;
  - back up with VACUUM INTO;
  - refresh a bot's instructions only when their sha256 equals the hash last written by the seed (stored in metadata seed.hash:<id>).
- Add a lifeOrg test for the edited-instructions skip.
- **[medium] The tests assume a fake clock, but the runtime reads the wall clock. store.mjs:9 now() uses new Date(). autopilot (coordinator.mjs:1101-1179), Org.stats, Approvals.list and board timestamps call Date.now() or now() directly. Only Routines takes a clock. The M0 bounce-cap, M4 7-day, M6 schedule and M10 24-hour escalation tests can't run as written.**
  Fix: Add to M0 scope:
- Thread the Coordinator clock into Store (a now() method), Board, Org, Approvals and autopilot. Alternatively, standardise on node:test mock.timers with the Date API, since Node 24 supports it.
- Add a lint test that fails on new Date.now() or new Date() in runtime/ outside the clock default.
- **[medium] routines.tick enqueues every due routine inside one transaction (routines.mjs:224-238). If one enqueue throws, for example validateTarget on an archived bot or a bot removed from the room, the whole batch rolls back. nextRun doesn't advance, and the same throw repeats every 500 ms. An outer try/catch around the timer (M0) stops the crash but not this starvation.**
  Fix: In M0, wrap each routine in its own try/catch. On a throw, record the occurrence as 'failed' with the reason, advance nextRun, and emit one diagnostic routine.enqueue_failed.

Test: one invalid routine plus one valid routine due together, and the valid one still queues.
- **[medium] The pilot proves volume but not value, and rollout jumps straight to everything. The soak report counts runs, budget hits and notifications, with no signal that the work was useful. Leader overhead (standups, desk time, refill) could reach about 40–50% of 40 runs a day. Hiring, proposals and standing rules (M10–M13) never run in a pilot, and M14 turns on all 9 rooms at once.**
  Fix: Add to M9 acceptance:
- Tony rates 10 random tasks finished autonomously, and at least 60% are useful;
- overhead share (standup, desk and plan runs over all runs) is 35% or less;
- tokens per day against his plan;
- peak RAM, CPU and process count with 8 concurrent runs.

Also:
- Add M13.5: proposals, hiring and rules on the 2 pilot rooms for 7 days.
- Stage M14 at 2 more rooms every 3 days, each step gated by that step's soak report.
- **[medium] Milestones bundle parts that could ship alone, which delays things Tony asked for:
- M6 bundles clock schedules, catch-up and the holding fix (value for today's 17 routines, no team dependency) with objectives, ceremonies and refill.
- M7 (wake) depends on all of M6 but needs only clock schedules.
- M8 (owner Slack) depends on M6 only for the brief digest.**
  Fix: Split the milestones:
- **M6a** (after M0): clock schedules, catch-up and the holding fix.
- **M6b**: objectives, ceremonies and refill.
- **M8a** (after M1): owner channel, owner-only clicks, approval, failure and breaker pushes, DM commands.
- **M8b** (after M6b): the brief and digests.

M7 then depends on M6a.
- **[medium] The schema-v18 fixture is described as 'a dump of a 0.3.36 workspace shaped like the Life Org'. A dump of Tony's real DB would put conversations, health, family and finance details into the anyBot repo, against the SENSITIVE house rule.**
  Fix: Generate every tests/fixtures/schema-vN.sql synthetically, from org.json names, roles and structure plus generated runs, tasks and messages with lorem text. Add a check that fixtures contain none of Tony's real conversation text or paths outside {root}.
- **[low] Several statements in the spec are wrong or stale:
- 'With Team off … byte-for-byte as in 0.3.36' is false. M0, the breaker, the M2 desk lock, the dontAsk refusal and the snapshot diet all change Team-off behaviour.
- 40/5 Claude/Codex should be 36/9.
- M5's acceptance cites an 'objective loop' before objectives exist (M6).
- The weekly review is scheduled Friday 16:00, but Atlas's mission says Sunday.
- The CI-billing blocker may be stale, since releases have shipped through 0.3.36.
- Version numbers are hard-coded while other sessions ship in parallel (0.3.35 came from another session).**
  Fix: - List the Team-off exceptions explicitly, each with its own CHANGELOG line.
- Fix the counts.
- Move the objective loop to M6's acceptance.
- Make the weekly-review day and the brief time owner decisions, defaulting to Atlas's Sunday.
- Recheck CI status.
- Write 'next patch at merge' instead of fixed versions.
- **[low] dontAsk refusal and M0's root inheritance change existing Team-off behaviour without saying so:
- If the dontAsk refusal applies with Team off, routines of any non-Life-Org dontAsk bot start failing after the update.
- Mention runs now inheriting routine roots means routine threads hit the 8-run root cap earlier.**
  Fix: - Apply the dontAsk refusal only with Team on, or seed team.dontAskAllowed at upgrade with every dontAsk bot that has an enabled routine.
- Record the root-cap change for routine threads in the CHANGELOG, with a test showing an owner-rooted thread is unaffected.
- **[low] Power defaults and update edge cases:
- DisallowStartIfOnBatteries=false wakes a laptop in a bag.
- The wake task is registered even from dev builds (process.execPath is node_modules electron).
- Nothing removes the task on uninstall.
- schtasks /XML expects UTF-16.
- After an update, quitAndInstall(true, true) (main.cjs:563) relaunches without --background, and 'Install when idle' holds all team work with no time cap.
- The night budget resets at midnight inside the 22:00–07:00 window, which effectively doubles it.**
  Fix: - Default to DisallowStartIfOnBatteries=true and StopIfGoingOnBatteries=true, with an explicit opt-in to change them.
- Register only when app.isPackaged, and delete the task in build/installer.nsh customUnInstall.
- Write the XML as UTF-16LE with a BOM, and test it.
- Keep background mode across update relaunches.
- With Team on, cap the install hold at 30 minutes, then requeue autonomous work and install.
- Count the night budget per night window, not per calendar day.
- **[low] Slack cards can carry sensitive details. Titles and summaries from rooms that hold personal matters (for example health or money items) go to Slack's servers, and the SENSITIVE house rule asks for minimal exposure.**
  Fix: Add a policy.redactRooms setting, defaulting to the rooms Tony marks personal. Owner cards from those rooms show only '<Director>'s team: decision needed' with an Open link, and no titles or summaries.

Test: a Life proposal card body contains no proposal title.
- **[low] Bot-answered escalations and bot-set objectives carry authority they shouldn't have:
- An escalation 'resolved' by a bot holder reaches the requester as a priority-20 hand-off that reads like a decision, and can be taken as permission for owner-final actions.
- Objectives written by bots flow into every report's prompt and drive refill, with no length bounds and no visibility to Tony.**
  Fix: - Hand-offs from bot-answered escalations say 'guidance from <bot>, not owner approval' and never create grants.
- objectives.set limits title to 120 characters and success to 300; the text is labelled as data in the rhythm layer.
- Every bot-written objective change appears as an FYI line in Atlas's brief packet.

## Owner decisions still needed

- The share of each plan the team may use (added by M1). Bots run on your Claude and ChatGPT plans, the same ones your own Claude Code and Codex use, so the team can use up the 5-hour or weekly limits you work with. Pick a share (for example "at most half a day's usage"); the pilot report measures tokens per day per harness, and orgTokensPerDay is set from it before M14.
- Owner authority for your phone and Slack (M1; still open after M1, so only the desktop is the owner). Since M0 only messages typed in the desktop app carry owner authority. Should your paired phone (member `owner`) and your own Slack user count as you (owner lane, budget exemption, live tool prompts), or stay guests like Buzz? The same answer decides whether @mention chains in threads started from those bridges keep the owner's exemption from the 8-run / 3-deep limits.
- Slack owner channel. Pick one:
- a dedicated 'Any Bot HQ' Slack app (recommended; your cards stay separate from Atlas's chat), or
- reuse Atlas's already-connected app (no setup).
- Directors hiring employees directly. The default is off, matching your words: directors hire managers and managers hire employees. The 32 employees who already report straight to a director stay valid either way. Turn it on only if you want directors to add people without a manager in between.
- Vera and Ward sit at the {root} folder, which contains forbidden folders. They are blocked from unattended work until they move. Proposed new homes: Vera → lifeOrg/dev, Ward → lifeOrg/ops. Confirm, or pick other folders.
- Atlas's company objectives. I'll draft 3–5 from the director missions in org.json, plus one objective per director. You edit and approve them before the pilot, and they drive all planning.
- Pilot scope:
- rooms: YouTube Studio + Game Studio;
- budget: 40 runs a day for 72 hours;
- after your sign-off, rollout at 150 a day for the org, with per-level caps of employee 12, manager 24, director 20, CoS 16.

Confirm or change the numbers. Your Claude and OpenAI plan limits are the real ceiling.
- Night shift is off by default. Choose which rooms, if any, may run tasks labelled `overnight` between 22:00 and 07:00, and the night budget (20 runs is proposed).
- Team hours (07:00–22:00) and Slack quiet hours (22:00–07:00).
- Opt in to 'Keep this PC awake while the team works', 'Wake this PC for scheduled work' and 'Launch at login (in the background)' under Settings → Power.
- Speech-to-text provider:
- local whisper.cpp: a one-time download of about 150 MB; offline and private; CPU speed on your PC not yet measured;
- or a Groq or OpenAI API key.
- Snapshot diet (M4). The chat keeps the newest 300 messages per conversation and loads older ones as you scroll. Old run output loads on demand. This is the minimum of the lean-runtime work you had put on hold, and the always-on team needs it. OK to ship?
- Outward tools blocked in unattended runs. Review the default list: MCP servers for mail, Slack, calendar, Vercel, Shopify, payments, social, YouTube, TikTok and Drive are blocked when no one is watching. Unblock any your bots must use on their own.
- Run org.repair on your database, to clean up archived Alex, Dario and Altman and the empty 'Snake game test' room. Yes or no.
- Coaching notes need your approval like any other adjustment; they are never pinned and never written by a manager bot alone. Confirm that's acceptable.
- The bash commands managers may propose as standing rules. Proposed list: `npm test`, `npm run build`, `npm run lint`, `npx remotion render`, `git status`, `git diff`, `node scripts/`. Add or remove entries.
- Tool-approval timeout: it stays at 15 minutes until the live test in M8. After a pass, may it go to 30 minutes?
- When to switch on hiring (hiringEnabled). Proposed: at M14 after the pilot. You could instead turn it on right after M11 for YouTube Studio only.

## Risks

1. **Provider usage limits are the real ceiling.** Each Claude Code run carries about 31k tokens of context on its own. At full scale, 45 bots will hit plan limits before they hit the budget caps.
   - Mitigations: the breaker, run-first budgets, the 40-runs-a-day pilot, the wizard estimate, and token ceilings set from measured data.
   - Two things are unverified: parsing the reset time out of the limit message, and whether per-day run caps line up with how the providers meter.

2. **Busywork from LLM leaders.**
   - Mitigations: tasks must link to an objective, a gated refill, weekly task budgets, the 5-open-task cap, churn limits, idle and loop suppression, and a people-review busywork metric.
   - Quality still depends on how concrete the objectives are, which is Tony's and Atlas's job. The pilot is the evidence.

3. **Action-format compliance.** Malformed or rejected anybot-actions blocks waste runs.
   - Mitigations: rejection notices, a level-specific guide, and idle suppression.
   - Each stage needs live checks with real Claude Code and Codex output, not only the fake harness.

4. **Shared-file conflicts after desks unlock parallelism.** With 9 bots in the content project: last writer wins on whole files, git index.lock collides, and one bot's checkout moves files under everyone.
   - The leads-only tracker rule is enforced only for Claude, through --disallowedTools (pattern support unverified). Codex writes are detected, not prevented.
   - Git-worktree desks for coding bots are a later phase.

5. **Unverified harness behaviour, each with a live check in its milestone:**
   - whether Claude Code keeps a long-blocking mcp__anybot__approve alive (M8);
   - --disallowedTools support for exact MCP names and Edit(**/CLAUDE.md) patterns (M1, M2);
   - Codex MCP servers during autonomous runs, which have no equivalent block yet;
   - skills and CLAUDE.md discovery, unchanged because cwd stays the home.

6. **Windows power behaviour (unverified):**
   - a timer-woken PC can fall back to sleep unless the blocker is taken quickly;
   - WakeToRun for a per-user, non-elevated task;
   - both need Tony signed in, and after a reboot nothing runs until login.

7. **Schema churn.** Seven bumps (v19 to v25) mean no downgrade.
   - The parked lean-runtime M2 branch and the avatar/Codex sessions that edit coordinator.mjs and App.jsx will conflict.
   - Mitigations: automatic pre-migration backups, fixtures, one PR per milestone in worktrees off origin/main, and explicit-path commits.

8. **Every merge publishes to every install** (release.yml runs on push to main), and GitHub Actions billing currently blocks CI.
   - Everything defaults off, and verification runs locally.
   - Mistakes in shared paths still ship: dispatch ordering, the desk lock, the snapshot window, M0 fixes.

9. **Slack end-to-end is not fully proven.** The 0.3.34 pairing fix has not been round-tripped on real Slack. Owner-only clicks change today's behaviour: approval buttons disappear from Slack until an owner is configured.

10. **Owner fatigue and rubber-stamping.** Hires, adjustments, publishes and budget raises all end with Tony.
    - Mitigations: bot holders reject early, and Slack sends one digest instead of cards when more than 10 are open.
    - Hard-coded owner-final means volume can't be tuned away, only filtered by the chain.

11. **Prompt injection.** Drafts or web content can make a leader propose hires, fires or publishes.
    - All are owner-final, and hires are forced to auto mode, the manager's home and policy models.
    - A tired approval is still a risk.

12. **Thin data for the people review.** The live DB has 39 runs, 6 with usage and 0 approvals, so verdicts will mostly be 'insufficient' for weeks. The redo regex and Stop attribution are heuristics.

13. **Level and room edge cases.**
    - The literal rule means directors must hire a manager before adding people.
    - The 12-member room cap forces new team rooms, and delegationRoom may pick unexpected rooms; HQ has only 3 seats left.
    - Unleveled non-Life-Org bots keep legacy rules.

14. **Drift between the app and lifeOrg/org.json.** In-app hires and adjustments won't appear in org.json unless export.mjs runs.

15. **Voice.**
    - The whisper download (about 150 MB and up) and its CPU latency on Tony's PC are unmeasured.
    - The quality of the Capacitor community speech plugins on Capacitor 8.5.2 is unverified.
    - The phone needs a rebuilt APK.

16. **Length.** Value arrives in steps: M0, M1, V1 and M2 help today's org immediately, while always-on arrives at M4 to M6 and the pilot at M9. Seventeen PRs is a long road, and later milestones may need re-planning from pilot data.
