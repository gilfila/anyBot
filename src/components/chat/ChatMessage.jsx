import React, { useContext, useState } from "react";
import { ArrowRight, Check, Copy, MessageSquare, Reply, Square, SquareTerminal, Workflow } from "lucide-react";
import { Avatar } from "../Avatar.jsx";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { MessageContent } from "../MessageContent.jsx";
import { MessageAttachments } from "./Attachments.jsx";
import { Status } from "../Status.jsx";
import { RunTerminal } from "../RunTerminal.jsx";
import { useCopy, useNow } from "../hooks.js";
import { ChatContext } from "./ChatContext.js";
import { closeOpenFence, copyText, elapsed, handedTo, replyRun, stamp } from "../../lib/chat.js";
import { waitText } from "../../lib/team.js";

const NO_ARTIFACTS = [];

// When a message was sent: the time (with the day when it isn't today), and
// the full date and time on hover.
export function Stamp({ at, prefix = "" }) {
  const { label, title } = stamp(at);
  return (
    <time dateTime={at} title={prefix ? `${prefix} ${title}` : title}>
      {label}
    </time>
  );
}

// Copy, Reply in thread, and the producing run's terminal. They show on
// hover or focus; they're buttons, so Tab reaches them either way.
function MessageActions({ text, onReply, run, terminalOpen, onTerminal }) {
  const [copied, copy] = useCopy();
  return (
    <div className="message-actions" role="group" aria-label="Message actions">
      {text && (
        <button type="button" className="message-action" aria-label={copied ? "Copied" : "Copy message"} title="Copy message" onClick={() => copy(text)}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
      {onReply && (
        <button type="button" className="message-action" aria-label="Reply in thread" title="Reply in thread" onClick={onReply}>
          <Reply size={14} />
        </button>
      )}
      {run && (
        <button
          type="button"
          className="message-action"
          aria-expanded={terminalOpen}
          aria-label={terminalOpen ? "Hide the terminal" : "Show the terminal this reply came from"}
          title={terminalOpen ? "Hide the terminal" : "Terminal"}
          onClick={onTerminal}
        >
          <SquareTerminal size={14} />
        </button>
      )}
    </div>
  );
}

// Who a handoff went to and how that's going. The chip opens the delegate's
// terminal; the speech bubble opens a direct chat with it.
function HandedTo({ runs, employees, open, onToggle, onOpenBot }) {
  return (
    <div className="handed-to" aria-label="Handed to">
      {runs.map((run) => {
        const bot = employees.find((e) => e.id === run.employee);
        const name = bot?.name || "A bot";
        return (
          <span key={run.id} className="handed-to-run">
            <button
              type="button"
              className="chip-button"
              aria-expanded={open === run.id}
              title={open === run.id ? "Hide the terminal" : `Watch ${name}'s terminal`}
              onClick={() => onToggle(run.id)}
            >
              <ArrowRight size={13} aria-hidden="true" />
              {name}
              <Status status={run.status} />
            </button>
            {bot && !bot.archived && onOpenBot && (
              <button type="button" className="message-action" aria-label={`Message ${name} directly`} title={`Message ${name} directly`} onClick={() => onOpenBot(bot)}>
                <MessageSquare size={14} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

// One message in the channel or a thread. `children` renders under the
// bubble (the thread summary, in the channel). `onReplyInThread` offers
// Reply in thread (project channel messages).
export function ChatMessage({ message: m, employees, bubbles, onOpenPreview, onOpenBrowser, onReplyInThread, children, compact = false }) {
  const chat = useContext(ChatContext);
  const [terminal, setTerminal] = useState(null);
  const author = employees.find((e) => e.id === m.author);
  const fromBot = m.author !== "human" && m.author !== "system";
  const runs = chat?.runs || [];
  const run = fromBot ? replyRun(m, runs) : null;
  const delegated = m.kind === "handoff" ? handedTo(m, runs) : [];
  const artifacts = run && chat ? chat.artifacts.filter((a) => a.run === run.id) : NO_ARTIFACTS;
  const shown = terminal && runs.find((r) => r.id === terminal);
  const toggle = (id) => setTerminal(terminal === id ? null : id);
  return (
    <div
      className={`message ${m.kind}${m.author === "human" ? " from-you" : m.author === "system" ? " from-system" : " from-bot"}`}
      style={bubbles.get(m.author)}
      data-message={m.id}
    >
      {m.author === "human" ? (
        <Avatar small employee={{ name: "Y" }} />
      ) : m.author === "system" ? null : (
        <RobotAvatar size={compact ? 44 : 64} employee={author} />
      )}
      <div className="message-content">
        <div className="message-meta">
          <strong>{m.author === "human" ? "You" : author?.name || "Coordinator"}</strong>
          <span>
            <Stamp at={m.created} />
          </span>
          {m.kind === "handoff" && (
            <span className="handoff-label">
              <Workflow size={12} />
              Handoff
            </span>
          )}
          {/* Coordinator notices keep a plain centred line. */}
          {chat && m.author !== "system" && (
            <MessageActions
              text={copyText(m.body)}
              onReply={onReplyInThread}
              run={run}
              terminalOpen={Boolean(run) && terminal === run.id}
              onTerminal={() => toggle(run.id)}
            />
          )}
        </div>
        {m.body ? (
          <div className="message-body">
            <MessageContent
              body={m.body}
              messageId={m.id}
              onOpenPreview={onOpenPreview}
              onOpenBrowser={onOpenBrowser}
              people={employees.map((e) => e.name)}
              artifacts={chat ? artifacts : undefined}
            />
          </div>
        ) : null}
        <MessageAttachments message={m} />
        {delegated.length > 0 && (
          <HandedTo runs={delegated} employees={employees} open={terminal} onToggle={toggle} onOpenBot={chat?.onOpenBot} />
        )}
        {shown && (
          <RunTerminal run={shown} paused={chat?.paused} name={employees.find((e) => e.id === shown.employee)?.name || "Bot"} />
        )}
        {children}
      </div>
    </div>
  );
}

// A run in progress, streaming its output (rendered like a reply; file
// links wait for the finished message). Terminal opens its CLI underneath.
export function LiveRun({ run, employees, bubbles, onStop, compact = false }) {
  const chat = useContext(ChatContext);
  const [terminal, setTerminal] = useState(false);
  const employee = employees.find((e) => e.id === run.employee);
  const since = run.started || run.created;
  const now = useNow(true);
  // Why a queued run hasn't started (runtime dispatch), and, when it's your
  // message waiting on work nobody at the desk started, Interrupt.
  const wait =
    run.status === "queued"
      ? waitText(chat?.waits?.[run.id], {
          name: (id) => employees.find((e) => e.id === id)?.name || "A bot",
          harnessName: chat?.harnessName,
          now,
        })
      : null;
  return (
    <div className="message live-run from-bot" style={bubbles.get(run.employee)}>
      <RobotAvatar size={compact ? 44 : 64} employee={employee} working />
      <div className="message-content">
        <div className="message-meta">
          <strong>{employee?.name}</strong>
          <Status status={run.status} />
          <span>
            <time dateTime={since} title={`${run.started ? "Started" : "Queued"} ${stamp(since).title}`}>
              {elapsed(since, now)}
            </time>
          </span>
          <button type="button" className="chip-button" aria-expanded={terminal} onClick={() => setTerminal(!terminal)}>
            <SquareTerminal size={12} aria-hidden="true" />
            {terminal ? "Hide terminal" : "Terminal"}
          </button>
          <button className="mini" onClick={() => onStop(run.id)}>
            <Square size={12} />
            Stop
          </button>
        </div>
        <div className="message-body">
          {run.output ? (
            <MessageContent body={closeOpenFence(run.output)} people={employees.map((e) => e.name)} />
          ) : run.status === "queued" && wait ? (
            <span className="run-wait">
              {wait.text}
              {wait.interrupt && chat?.onInterrupt && (
                <button
                  type="button"
                  className="mini"
                  title="Stop that work so your message goes first; it's queued again after yours"
                  onClick={() => chat.onInterrupt(wait.interrupt, run.id)}
                >
                  Interrupt
                </button>
              )}
            </span>
          ) : run.status === "queued" ? (
            "Waiting for its turn…"
          ) : (
            "Working…"
          )}
        </div>
        {terminal && <RunTerminal run={run} paused={chat?.paused} name={employee?.name || "Bot"} />}
      </div>
    </div>
  );
}
