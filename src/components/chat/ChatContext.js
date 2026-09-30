import { createContext } from "react";

// What chat messages need from App to link out, shared by the channel and
// the thread panel: the snapshot's employees, runs and artifacts, whether
// work is paused, and the navigation below. Without a provider, messages
// render without their actions.
//   onOpenBot(employee)        the bot's direct chat
//   onOpenArtifact(artifact)   the returned-file modal (artifacts.preview)
//   onRevealArtifact(artifact) Show in folder (artifacts.reveal)
//   onRetry(runId)             runs.retry
//   onDetails(run)             the harness's problems, or Settings → Diagnostics
//   waits                      why each queued run waits (snapshot.team.waits)
//   harnessName(id)            a harness's display name
//   onInterrupt(runId)         runs.interrupt, so the owner's queued message goes first
export const ChatContext = createContext(null);
