// The benchmark corpus (docs/plans/lean-runtime.md, M0): three synthetic
// workspaces generated from a fixed seed, so every milestone's gates are
// measured on the same data. No real user content: bodies are drawn from a
// fixed word list with a fixed size distribution.
import { createHash } from "node:crypto";

export const SEED = 20260924;
// Message sizes follow a log-normal distribution: median 400 chars, p95 4 KB,
// clamped to the 24,000-char send limit.
export const SIZES = { median: 400, p95: 4096, min: 20, max: 24000 };
export const WORKSPACES = ["direct", "project2", "project5k"];

const BASE = Date.parse("2026-09-01T09:00:00.000Z");
const WORDS = (
  "the build test run fix page layout api route schema query cache token prompt thread board task canvas " +
  "review merge branch release update deploy check config file folder module function value error warning " +
  "result report summary plan next step owner team bot delta sync window snapshot budget measure baseline " +
  "input output stream event session resume fresh history context layer section size chars limit window " +
  "because after before while when then also still only never always each every some many few more less"
).split(" ");

export const EMPLOYEES = [
  { id: "bot-ada", name: "Ada", role: "Engineer", harness: "claude" },
  { id: "bot-lin", name: "Lin", role: "Reviewer", harness: "codex" },
  { id: "bot-kay", name: "Kay", role: "Designer", harness: "claude" },
].map((e) => ({
  ...e,
  instructions: `You are ${e.name}, the team's ${e.role.toLowerCase()}. Work carefully, explain what you changed, keep replies short unless asked for detail, and say plainly when something is blocked or needs the owner's decision. Prefer small, verifiable steps and name the files you touched.`,
  workspace: `/corpus/workspaces/${e.name.toLowerCase()}`,
}));

// mulberry32: small, fast, and the same everywhere.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawSize(r) {
  const sigma = Math.log(SIZES.p95 / SIZES.median) / 1.6448536;
  const normal = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  return Math.max(SIZES.min, Math.min(SIZES.max, Math.round(SIZES.median * Math.exp(sigma * normal))));
}

function prose(r, n) {
  let text = "";
  while (text.length < n) {
    const sentence = Array.from({ length: 6 + Math.floor(r() * 10) }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ");
    text += `${sentence[0].toUpperCase()}${sentence.slice(1)}. `;
  }
  return text;
}

// A body of exactly `n` chars. Bot bodies sometimes carry a code fence or a
// machine block, the parts M1's history hygiene trims.
function body(r, n, { prefix = "", bot = false } = {}) {
  let text = prefix;
  if (bot && n > 1200 && r() < 0.25) {
    const lines = Array.from({ length: 20 + Math.floor(r() * 50) }, (_, i) => `  step${i}(${WORDS[Math.floor(r() * WORDS.length)]});`);
    text += `${prose(r, 200).trim()}\n\n\`\`\`js\n${lines.join("\n")}\n\`\`\`\n\n`;
  }
  if (bot && r() < 0.08)
    text += `\`\`\`anybot-actions\n{"actions":[{"type":"memory.save","scope":"project","body":"${WORDS[Math.floor(r() * WORDS.length)]}"}]}\n\`\`\`\n\n`;
  if (text.length < n) text += prose(r, n - text.length);
  return text.slice(0, n).trimEnd().padEnd(n, ".");
}

class Builder {
  constructor(name, members) {
    this.r = random(SEED + WORKSPACES.indexOf(name));
    this.conversation = { id: name, title: name, members };
    this.messages = [];
    this.runs = [];
  }
  add(author, text, thread = null, kind = author === "human" ? "user" : "assistant") {
    const message = {
      id: `${this.conversation.id}-m${this.messages.length + 1}`,
      conversation: this.conversation.id,
      author,
      kind,
      body: text,
      thread,
      created: new Date(BASE + this.messages.length * 60_000).toISOString(),
    };
    this.messages.push(message);
    return message;
  }
  // A bot reply is a finished run answering `assignment`.
  reply(employee, assignment, text, thread = null) {
    const response = this.add(employee, text, thread);
    const id = `${this.conversation.id}-r${this.runs.length + 1}`;
    this.runs.push({
      id,
      conversation: this.conversation.id,
      employee,
      message: assignment.id,
      response: response.id,
      thread,
      created: assignment.created,
      started: assignment.created,
      ended: response.created,
    });
    return response;
  }
  human(size = drawSize(this.r), thread = null, prefix = "") {
    return this.add("human", body(this.r, Math.max(size, prefix.length + 20), { prefix }), thread);
  }
  bot(employee, assignment, size = drawSize(this.r), thread = null, prefix = "") {
    return this.reply(employee, assignment, body(this.r, Math.max(size, prefix.length + 20), { prefix, bot: true }), thread);
  }
  done() {
    return {
      name: this.conversation.id,
      employees: EMPLOYEES.filter((e) => this.conversation.members.includes(e.id)),
      conversation: this.conversation,
      messages: this.messages,
      runs: this.runs,
    };
  }
}

const nameOf = (id) => EMPLOYEES.find((e) => e.id === id).name;

// One bot, 60 turns of a direct chat.
function direct() {
  const b = new Builder("direct", ["bot-ada"]);
  for (let i = 0; i < 30; i++) b.bot("bot-ada", b.human());
  return b.done();
}

// Two bots: some channel history, then one 40-message thread in which they
// hand work back and forth with @mentions and post long reports.
function project2() {
  const b = new Builder("project2", ["bot-ada", "bot-lin"]);
  for (let i = 0; i < 6; i++) {
    const note = b.human(undefined, null, "@Ada ");
    b.bot("bot-ada", note, undefined, note.id);
  }
  const root = b.human(900, null, "@Ada @Lin ");
  let last = root;
  let turn = 0;
  while (b.messages.filter((m) => m.thread === root.id).length < 39) {
    const count = b.messages.filter((m) => m.thread === root.id).length;
    if (count && count % 10 === 9) {
      last = b.human(undefined, root.id, `@${turn % 2 ? "Lin" : "Ada"} `);
      continue;
    }
    const employee = turn % 2 ? "bot-lin" : "bot-ada";
    const other = nameOf(turn % 2 ? "bot-ada" : "bot-lin");
    // Every fourth bot turn is a long report (6–12 KB).
    const size = turn % 4 === 3 ? 6000 + Math.floor(b.r() * 6000) : undefined;
    last = b.bot(employee, last, size, root.id, `@${other} `);
    turn++;
  }
  return b.done();
}

// Three bots, 250 threads of 20 messages: 5,000 messages.
function project5k() {
  const bots = ["bot-ada", "bot-lin", "bot-kay"];
  const b = new Builder("project5k", bots);
  for (let t = 0; t < 250; t++) {
    const root = b.human(undefined, null, `@${nameOf(bots[t % 3])} `);
    let last = root;
    for (let i = 1; i < 20; i++) {
      if (i % 6 === 0) last = b.human(undefined, root.id);
      else last = b.bot(bots[(t + i) % 3], last, undefined, root.id);
    }
  }
  return b.done();
}

export function makeCorpus() {
  return { direct: direct(), project2: project2(), project5k: project5k() };
}

export function digest(workspace) {
  return createHash("sha256").update(JSON.stringify(workspace)).digest("hex");
}

// Writes a workspace into a coordinator's store. Runs are finished, so
// nothing dispatches.
export function loadCorpus(store, workspace) {
  store.transaction(() => {
    for (const e of workspace.employees)
      store.run(
        "INSERT OR IGNORE INTO employees(id,name,role,harness,instructions,workspace,trusted,created,permissionMode) VALUES (?,?,?,?,?,?,1,?,'auto')",
        e.id, e.name, e.role, e.harness, e.instructions, e.workspace, new Date(BASE).toISOString(),
      );
    const c = workspace.conversation;
    store.run(
      "INSERT INTO conversations(id,title,members,delegation,created) VALUES (?,?,?,?,?)",
      c.id, c.title, JSON.stringify(c.members), c.members.length > 1 ? 1 : 0, new Date(BASE).toISOString(),
    );
    const message = store.db.prepare("INSERT INTO messages(id,conversation,author,kind,body,created,thread) VALUES (?,?,?,?,?,?,?)");
    for (const m of workspace.messages) message.run(m.id, m.conversation, m.author, m.kind, m.body, m.created, m.thread);
    const run = store.db.prepare(
      "INSERT INTO runs(id,conversation,employee,message,root,depth,status,output,created,started,ended,thread) VALUES (?,?,?,?,?,0,'succeeded',?,?,?,?,?)",
    );
    const response = store.db.prepare("INSERT INTO run_responses(run,message) VALUES (?,?)");
    const bodies = new Map(workspace.messages.map((m) => [m.id, m.body]));
    for (const r of workspace.runs) {
      run.run(r.id, r.conversation, r.employee, r.message, r.id, bodies.get(r.response), r.created, r.started, r.ended, r.thread);
      response.run(r.id, r.response);
    }
  });
}
