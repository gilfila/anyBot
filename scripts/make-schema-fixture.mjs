// Writes tests/fixtures/schema-v<N>.sql: a workspace shaped like a large
// real team, as the current Store lays it out (N = SCHEMA_VERSION).
//   node scripts/make-schema-fixture.mjs           write it (refuses to replace one)
//   node scripts/make-schema-fixture.mjs --force   replace it
//
// Everything in it is synthetic: the team's shape (45 active bots under a
// chief of staff and 7 directors, 36 Claude and 9 Codex, 21 shared homes,
// 9 project rooms, 17 routines, 22 tasks) plus 3 archived bots and the room
// they left behind. Names are the bots' own; roles are generic, homes and
// folders are placeholders under {root} (the team's projects folder) and
// {userData} (Any Bot's data folder), and every message is lorem ipsum.
// Never build a fixture from a real database: tests/fixtures.test.mjs checks
// that none carries machine paths or owner details.
//
// A fixture records what one version writes: write schema-vN.sql in the
// change that bumps the schema to N, and never regenerate it afterwards
// (later versions must open it as it was).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, Store, promptHash } from "../runtime/store.mjs";

const target = fileURLToPath(new URL(`../tests/fixtures/schema-v${SCHEMA_VERSION}.sql`, import.meta.url));
if (existsSync(target) && !process.argv.includes("--force")) {
  console.error(`${target} exists. Fixtures describe what an older version wrote; pass --force to replace it.`);
  process.exit(1);
}

// Deterministic ids (UUID-shaped, like the app's) and text.
const uuid = (key) => {
  const hex = createHash("sha256").update(`anybot-fixture:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
let seed = 20260929;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(
    " ",
  );
const lorem = (count) => {
  const words = Array.from({ length: count }, () => WORDS[Math.floor(random() * WORDS.length)]);
  const text = words.join(" ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
};
const paragraph = (sentences = 3) => Array.from({ length: sentences }, () => lorem(8 + Math.floor(random() * 10))).join(" ");
const BASE = Date.parse("2026-09-28T12:00:00.000Z");
const OLD = Date.parse("2026-09-20T15:00:00.000Z");
const at = (start, seconds) => new Date(start + seconds * 1000).toISOString();

// key, name, role, harness, effort, timeout, manager, home ('' = {root} itself)
const TEAM = [
  ["atlas", "Atlas", "Chief of Staff", "claude", "high", 30, "", "org"],
  ["jim", "Jim", "Executive coach", "claude", "high", 20, "", "org"],
  ["nova", "Nova", "Director of Content", "claude", "high", 30, "atlas", "content"],
  ["scout", "Scout", "Research analyst", "codex", "low", 20, "nova", "content"],
  ["ivy", "Ivy", "Ideas writer", "claude", "medium", 20, "nova", "content"],
  ["quill", "Quill", "Scriptwriter", "claude", "high", 45, "nova", "content"],
  ["pixel", "Pixel", "Packaging designer", "claude", "medium", 30, "nova", "content"],
  ["reel", "Reel", "Video editor", "codex", "medium", 60, "nova", "editor"],
  ["echo", "Echo", "Audio producer", "claude", "medium", 30, "nova", "podcasts"],
  ["tally", "Tally", "Content analyst", "claude", "medium", 20, "nova", "content"],
  ["rowan", "Rowan", "Course producer", "claude", "medium", 45, "nova", "courses/output"],
  ["mara", "Mara", "Director of Marketing", "claude", "high", 30, "atlas", "content"],
  ["kit", "Kit", "Social manager", "claude", "medium", 20, "mara", "content"],
  ["juniper", "Juniper", "Community manager", "claude", "medium", 20, "mara", "community"],
  ["flux", "Flux", "Email marketer", "claude", "medium", 30, "mara", "content"],
  ["wren", "Wren", "Blog writer", "claude", "medium", 30, "mara", "blog"],
  ["sam", "Sam", "Director of Sales", "claude", "high", 30, "atlas", "sales"],
  ["hunter", "Hunter", "Lead researcher", "claude", "medium", 30, "sam", "sales"],
  ["piper", "Piper", "Proposal writer", "claude", "medium", 30, "sam", "sales"],
  ["casey", "Casey", "Client success manager", "claude", "medium", 30, "sam", "clients"],
  ["dex", "Dex", "Director of Development", "claude", "high", 60, "atlas", "org/dev"],
  ["bolt", "Bolt", "App engineer", "codex", "medium", 90, "dex", "app"],
  ["forge", "Forge", "Product engineer", "codex", "medium", 90, "dex", "editor"],
  ["weaver", "Weaver", "Web engineer", "codex", "medium", 60, "dex", "site"],
  ["vera", "Vera", "QA and release engineer", "claude", "medium", 60, "dex", ""],
  ["sentry", "Sentry", "DevOps and security", "claude", "medium", 45, "dex", "org/dev"],
  ["nico", "Nico", "Game studio lead", "claude", "high", 60, "dex", "org/games"],
  ["pax", "Pax", "Game developer", "codex", "medium", 90, "nico", "farm"],
  ["brick", "Brick", "Game developer", "claude", "medium", 90, "nico", "blocks"],
  ["tess", "Tess", "Game designer and QA", "claude", "medium", 45, "nico", "org/games"],
  ["penny", "Penny", "Director of Finance", "claude", "high", 30, "atlas", "org/finance"],
  ["ledger", "Ledger", "Bookkeeper", "codex", "low", 20, "penny", "org/finance"],
  ["margo", "Margo", "Revenue analyst", "claude", "medium", 30, "penny", "org/finance"],
  ["audra", "Audra", "Tax and compliance", "claude", "medium", 30, "penny", "org/finance"],
  ["finn", "Finn", "Finance planner", "claude", "medium", 30, "penny", "org/finance"],
  ["otto", "Otto", "Director of Operations", "claude", "high", 30, "atlas", "org/ops"],
  ["lex", "Lex", "Contracts", "claude", "high", 30, "otto", "org/ops"],
  ["vance", "Vance", "Tools and renewals admin", "codex", "low", 20, "otto", "org/ops"],
  ["ward", "Ward", "Workspace steward", "codex", "low", 20, "otto", ""],
  ["hazel", "Hazel", "Director of Life", "claude", "high", 30, "atlas", "org/life"],
  ["vita", "Vita", "Fitness coach", "claude", "medium", 30, "hazel", "fitness"],
  ["basil", "Basil", "Meal planner", "claude", "medium", 20, "hazel", "fitness"],
  ["harbor", "Harbor", "Home manager", "claude", "medium", 30, "hazel", "org/life"],
  ["cal", "Cal", "Calendar assistant", "claude", "medium", 20, "hazel", "org/life"],
  ["archie", "Archie", "Knowledge librarian", "claude", "medium", 30, "hazel", "notes"],
];
// The team that came before: archived, living in Any Bot's own data folder,
// two of them still reporting to the third.
const FORMER = [
  ["alex", "Alex", "Chief of staff", "claude", "medium", 30, ""],
  ["dario", "Dario", "Engineer", "claude", "high", 30, "alex"],
  ["altman", "Altman", "Engineer", "codex", "medium", 30, "alex"],
];
const ROOMS = [
  ["hq", "HQ: Chief of Staff", ["atlas", "jim", "nova", "mara", "sam", "dex", "penny", "otto", "hazel"], ["org", "routines", "content/docs/strategy"]],
  ["yt", "YouTube Studio", ["nova", "scout", "ivy", "quill", "pixel", "reel", "echo", "tally", "rowan"], ["content", "editor", "podcasts", "courses"]],
  ["mkt", "Marketing & Community", ["mara", "kit", "juniper", "flux", "wren", "nova"], ["content", "blog", "site", "community"]],
  ["sales", "Sales & Clients", ["sam", "hunter", "piper", "casey"], ["sales", "clients"]],
  ["dev", "Development", ["dex", "bolt", "forge", "weaver", "vera", "sentry", "nico"], ["org/dev", "app", "editor", "site"]],
  ["games", "Game Studio", ["nico", "pax", "brick", "tess"], ["farm", "blocks", "org/games"]],
  ["fin", "Finance", ["penny", "ledger", "margo", "audra", "finn"], ["org/finance"]],
  ["ops", "Operations & Legal", ["otto", "lex", "vance", "ward"], ["org/ops"]],
  ["life", "Life: Health, Home & Family", ["hazel", "vita", "basil", "harbor", "cal", "archie"], ["org/life", "fitness", "notes"]],
];
// [bot, room, minutes, name]; all turned off, as a new team's are.
const ROUTINES = [
  ["atlas", "hq", 1440, "Daily brief"],
  ["atlas", "hq", 10080, "Weekly review"],
  ["jim", "hq", 10080, "Coach check-in"],
  ["scout", "yt", 1440, "News scan"],
  ["ivy", "yt", 1440, "Daily ideas"],
  ["nova", "yt", 10080, "Content calendar"],
  ["tally", "yt", 10080, "Weekly analytics"],
  ["mara", "mkt", 10080, "Funnel report"],
  ["sam", "sales", 10080, "Pipeline review"],
  ["dex", "dev", 10080, "Engineering report"],
  ["penny", "fin", 10080, "Money review"],
  ["audra", "fin", 10080, "Compliance calendar"],
  ["ward", "ops", 10080, "Workspace hygiene"],
  ["vance", "ops", 10080, "Renewals check"],
  ["vita", "life", 1440, "Nightly recap"],
  ["basil", "life", 10080, "Weekly meal plan"],
  ["hazel", "life", 10080, "Life check-in"],
];
// [room, assignee, priority]; all in Backlog.
const TASKS = [
  ["hq", "atlas", "high"],
  ["yt", "nova", "high"],
  ["yt", "rowan", "medium"],
  ["yt", "quill", "medium"],
  ["mkt", "flux", "high"],
  ["mkt", "juniper", "medium"],
  ["sales", "hunter", "high"],
  ["sales", "piper", "medium"],
  ["sales", "casey", "medium"],
  ["dev", "weaver", "high"],
  ["dev", "weaver", "medium"],
  ["dev", "sentry", "urgent"],
  ["dev", "bolt", "medium"],
  ["dev", "sentry", "high"],
  ["games", "nico", "medium"],
  ["fin", "margo", "high"],
  ["fin", "audra", "high"],
  ["fin", "ledger", "medium"],
  ["ops", "vance", "medium"],
  ["ops", "lex", "medium"],
  ["life", "vita", "high"],
  ["life", "harbor", "low"],
];

const directory = mkdtempSync(join(tmpdir(), "anybot-fixture-"));
const store = new Store(directory);
const db = store.db;
const insert = (table, row) =>
  db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));

const bot = Object.fromEntries([...TEAM, ...FORMER].map(([key]) => [key, uuid(`employee:${key}`)]));
const MODELS = { claude: "claude-opus-5-5", codex: "gpt-6-astra" };
FORMER.forEach(([key, name, role, harness, effort, timeout, manager], index) =>
  insert("employees", {
    id: bot[key],
    name,
    role,
    harness,
    instructions: `You are ${name}, ${role.toLowerCase()}. ${paragraph(1)}`,
    workspace: `{userData}/workspaces/${bot[key]}`,
    trusted: 1,
    created: at(OLD, index * 60),
    archived: 1,
    revision: 4,
    model: MODELS[harness],
    timeoutMinutes: timeout,
    permissionMode: "auto",
    avatar: "",
    manager: manager ? bot[manager] : "",
    effort,
  }),
);
TEAM.forEach(([key, name, role, harness, effort, timeout, manager, home], index) =>
  insert("employees", {
    id: bot[key],
    name,
    role,
    harness,
    instructions: `You are ${name}, ${role.toLowerCase()}. ${paragraph(1)}`,
    workspace: home ? `{root}/${home}` : "{root}",
    trusted: 1,
    created: at(BASE, index),
    archived: 0,
    revision: 2,
    model: MODELS[harness],
    timeoutMinutes: timeout,
    permissionMode: "auto",
    avatar: "",
    manager: manager ? bot[manager] : "",
    effort,
  }),
);

const room = {};
const conversation = (key, title, members, folders, created) => {
  room[key] = uuid(`conversation:${key}`);
  insert("conversations", {
    id: room[key],
    title,
    members: JSON.stringify(members.map((m) => bot[m])),
    delegation: members.length > 1 ? 1 : 0,
    created,
    allowedFolders: JSON.stringify(folders.map((f) => `{root}/${f}`)),
    artifactsFolder: "",
    autopilot: 0,
    archived: 0,
  });
};
for (const [key] of FORMER) conversation(`direct:${key}`, FORMER.find((f) => f[0] === key)[1], [key], [], at(OLD, 300));
conversation("snake", "Snake game test", FORMER.map((f) => f[0]), [], at(OLD, 600));
ROOMS.forEach(([key, title, members, folders], index) => conversation(key, title, members, folders, at(BASE, 100 + index)));
for (const key of ["atlas", "jim", "nova", "penny", "hazel", "dex"])
  conversation(`direct:${key}`, TEAM.find((t) => t[0] === key)[1], [key], [], at(BASE, 200));

let messageCount = 0;
let runCount = 0;
const message = (roomKey, author, kind, body, created, thread = null) => {
  const id = uuid(`message:${++messageCount}`);
  insert("messages", {
    id,
    conversation: room[roomKey],
    author: author === "human" || author === "system" ? author : bot[author],
    kind,
    body,
    created,
    thread,
    attachments: "[]",
  });
  return id;
};
const usage = (harness) =>
  JSON.stringify({
    "gen_ai.usage.input_tokens": 20000 + Math.floor(random() * 30000),
    "gen_ai.usage.cached_input_tokens": 15000,
    "gen_ai.usage.output_tokens": 300 + Math.floor(random() * 2000),
    "gen_ai.system": harness === "codex" ? "openai" : "anthropic",
    turns: 1 + Math.floor(random() * 6),
    duration_ms: 20000 + Math.floor(random() * 90000),
    "gen_ai.request.model": MODELS[harness],
  });
const harnessOf = (key) => [...TEAM, ...FORMER].find((t) => t[0] === key)[3];
// A run and, when it succeeded, its reply. Returns the run's id.
const run = (roomKey, who, messageId, created, { parent = null, root = null, depth = 0, task = null, thread = null, status = "succeeded", reply = paragraph(1), error = "" } = {}) => {
  const id = uuid(`run:${++runCount}`);
  const ended = at(Date.parse(created), 90);
  insert("runs", {
    id,
    conversation: room[roomKey],
    employee: bot[who],
    message: messageId,
    parent,
    root: root || id,
    depth,
    status,
    output: status === "succeeded" ? reply : "",
    error,
    created,
    started: at(Date.parse(created), 1),
    ended,
    dismissed: 0,
    task,
    thread,
    usage: status === "succeeded" ? usage(harnessOf(who)) : null,
  });
  if (status === "succeeded") {
    const response = message(roomKey, who, "assistant", reply, ended, thread);
    insert("run_responses", { run: id, message: response });
  }
  return id;
};
const activity = (task, author, kind, body, created, runId = null) =>
  insert("task_activity", {
    id: uuid(`activity:${task}:${kind}:${created}:${body.length}`),
    task,
    author: author === "human" || author === "system" ? author : bot[author],
    kind,
    body,
    run: runId,
    created,
  });
const task = (key, roomKey, title, status, priority, assignees, reviewer, created) => {
  const id = uuid(`task:${key}`);
  insert("tasks", {
    id,
    conversation: room[roomKey],
    title,
    description: lorem(12),
    status,
    priority,
    due: "",
    labels: "[]",
    assignees: JSON.stringify(assignees.map((a) => bot[a])),
    reviewer: reviewer ? bot[reviewer] : "",
    checklist: JSON.stringify([{ text: lorem(4), done: false }]),
    parent: null,
    sortKey: 1024,
    createdBy: "human",
    created,
    updated: created,
    revision: 1,
  });
  activity(id, "human", "created", "Created this task", created);
  return id;
};

// The old team, a week earlier: direct chats, a Snake game room where the
// chief handed work to an engineer, and the tasks they left open.
for (const [key] of FORMER) run(`direct:${key}`, key, message(`direct:${key}`, "human", "user", lorem(10), at(OLD, 900)), at(OLD, 900));
const failed = message("direct:altman", "human", "user", lorem(9), at(OLD, 1200));
run("direct:altman", "altman", failed, at(OLD, 1200), { status: "failed", error: "Harness exited 1" });
const snakeAsk = message("snake", "human", "user", `@Alex ${lorem(12)}`, at(OLD, 1500));
const alexRun = run("snake", "alex", snakeAsk, at(OLD, 1500), { thread: snakeAsk });
const snakeHandoff = message("snake", "alex", "handoff", lorem(14), at(OLD, 1700), snakeAsk);
run("snake", "dario", snakeHandoff, at(OLD, 1700), { parent: alexRun, root: alexRun, depth: 1, thread: snakeAsk });
const snakeBack = message("snake", "system", "handoff", `Delegated work returned. Synthesize the result for the human.\n\n${paragraph(2)}`, at(OLD, 1900), snakeAsk);
run("snake", "alex", snakeBack, at(OLD, 1900), { root: alexRun, thread: snakeAsk });
const openTask = task("snake-open", "snake", lorem(5), "in_progress", "high", ["dario"], "alex", at(OLD, 2100));
activity(openTask, "human", "status", "backlog → in_progress", at(OLD, 2200));
activity(openTask, "human", "started", "Started with 1 assignee", at(OLD, 2200));
const openBrief = message("snake", "human", "task", `Task ${openTask.slice(0, 8)}: ${lorem(5)}`, at(OLD, 2200));
run("snake", "dario", openBrief, at(OLD, 2200), { task: openTask, status: "interrupted", error: "Any Bot stopped during this run (it quit, updated, or crashed). It may be partly done: review possible side effects before sending it again." });
const reviewTask = task("snake-review", "snake", lorem(5), "review", "medium", ["dario"], "altman", at(OLD, 2400));
activity(reviewTask, "human", "started", "Started with 1 assignee", at(OLD, 2450));
const reviewBrief = message("snake", "human", "task", `Task ${reviewTask.slice(0, 8)}: ${lorem(5)}`, at(OLD, 2450));
const reviewed = run("snake", "dario", reviewBrief, at(OLD, 2450), { task: reviewTask });
activity(reviewTask, "system", "status", "in_progress → review", at(OLD, 2600), reviewed);
activity(reviewTask, "system", "review-requested", `Review requested from ${bot.altman}`, at(OLD, 2600));
const reviewAsk = message("snake", "system", "handoff", `Review task ${reviewTask.slice(0, 8)}. ${lorem(8)}`, at(OLD, 2600));
run("snake", "altman", reviewAsk, at(OLD, 2600), { task: reviewTask, status: "cancelled" });
insert("routines", {
  id: uuid("routine:alex"),
  name: "Morning check",
  conversation: room["direct:alex"],
  employee: bot.alex,
  prompt: paragraph(2),
  minutes: 1440,
  nextRun: Date.parse("2026-09-21T08:00:00.000Z"),
  enabled: 0,
  created: at(OLD, 3000),
});

// The new team: its board, its routines (off), a canvas, memories, facts.
TASKS.forEach(([roomKey, who, priority], index) => {
  const manager = TEAM.find((t) => t[0] === who)[6];
  task(`board:${index}`, roomKey, lorem(4 + (index % 4)), "backlog", priority, [who], manager, at(BASE, 400 + index));
});
ROUTINES.forEach(([who, roomKey, minutes, name], index) =>
  insert("routines", {
    id: uuid(`routine:${index}`),
    name,
    conversation: room[roomKey],
    employee: bot[who],
    prompt: paragraph(2),
    minutes,
    nextRun: Date.parse("2026-09-29T08:45:00.000Z") + index * 60_000,
    enabled: 0,
    created: at(BASE, 500 + index),
  }),
);
const heading = { id: uuid("block:1"), type: "h2", text: "Lorem ipsum" };
insert("docs", {
  conversation: room.hq,
  blocks: JSON.stringify([heading, { id: uuid("block:2"), type: "p", text: paragraph(2) }, { id: uuid("block:3"), type: "bullet", text: lorem(6) }]),
  revision: 2,
  updatedBy: bot.atlas,
  updated: at(BASE, 7000),
});
insert("doc_history", {
  id: uuid("doc-history:1"),
  conversation: room.hq,
  blocks: JSON.stringify([heading]),
  revision: 1,
  author: "human",
  run: null,
  created: at(BASE, 600),
});
for (let index = 0; index < 7; index++) {
  const memory = uuid(`memory:${index}`);
  const project = index === 6;
  const body = paragraph(1);
  const tags = ["lorem", index % 2 ? "ipsum" : "dolor"];
  insert("memories", {
    id: memory,
    employee: bot[project ? "hazel" : "atlas"],
    scope: project ? "project" : "team",
    conversation: project ? room.life : "",
    body,
    tags: JSON.stringify(tags),
    pinned: 1,
    source: "owner",
    run: null,
    created: at(BASE, 700 + index),
    updated: at(BASE, 700 + index),
  });
  insert("memories_fts", { body, tags: tags.join(" "), memory });
}
for (let index = 0; index < 8; index++) {
  const entity = uuid(`entity:${index}`);
  const label = lorem(2).slice(0, -1);
  insert("kg_entities", {
    id: entity,
    type: "concept",
    label,
    labelKey: label.toLowerCase(),
    note: "",
    source: "owner",
    createdBy: "human",
    run: null,
    pinned: 1,
    created: at(BASE, 800 + index),
    updated: at(BASE, 800 + index),
  });
  insert("kg_fts", { text: label, ref: entity });
  const edge = uuid(`edge:${index}`);
  const note = lorem(6);
  insert("kg_edges", {
    id: edge,
    src: `agent:${bot[TEAM[index * 5][0]]}`,
    dst: entity,
    relation: "owns",
    note,
    source: "owner",
    createdBy: "human",
    run: null,
    pinned: 1,
    created: at(BASE, 800 + index),
    updated: at(BASE, 800 + index),
  });
  insert("kg_fts", { text: `${TEAM[index * 5][1]} owns ${label} ${note}`, ref: edge });
}

// A day of work: chats with the chief of staff and directors, a routine run
// by hand, a hand-off into a project room with a teammate @mentioned, and a
// task that went through review.
let clock = BASE + 20 * 3600_000;
const later = (minutes = 7) => new Date((clock += minutes * 60_000)).toISOString();
for (const key of ["atlas", "jim", "nova", "penny", "hazel", "dex"])
  for (let turn = 0; turn < 3; turn++) {
    const created = later();
    run(`direct:${key}`, key, message(`direct:${key}`, "human", "user", lorem(8 + turn * 3), created), created);
  }
const limited = later();
run("direct:atlas", "atlas", message("direct:atlas", "human", "user", lorem(10), limited), limited, { status: "failed", error: "Harness exited 1" });
const routineAt = later();
const routineMessage = message("hq", "system", "routine", `Routine: Daily brief\n\n${paragraph(2)}`, routineAt);
const routineRun = run("hq", "atlas", routineMessage, routineAt);
insert("routine_occurrences", {
  id: uuid("occurrence:1"),
  routine: uuid("routine:0"),
  scheduled: Date.parse(routineAt),
  status: "queued",
  root: routineRun,
  created: routineAt,
});
const askAt = later();
const ask = message("direct:atlas", "human", "user", lorem(12), askAt);
const atlasRun = run("direct:atlas", "atlas", ask, askAt, { reply: `${lorem(8)}\n\nHanding this to Nova.` });
const handAt = later(2);
const handoff = message("yt", "atlas", "handoff", paragraph(2), handAt);
message("direct:atlas", "system", "notice", "Atlas handed this to Nova in YouTube Studio. The work happens there, and the result comes back here.", handAt);
const novaRun = run("yt", "nova", handoff, handAt, { parent: atlasRun, root: atlasRun, depth: 1, thread: handoff, reply: `${lorem(10)} @Quill ${lorem(6)}` });
const quillAt = later();
const novaReply = db.prepare("SELECT message FROM run_responses WHERE run=?").get(novaRun).message;
run("yt", "quill", novaReply, quillAt, { thread: handoff });
const backAt = later();
const back = message("direct:atlas", "system", "handoff", `Delegated work returned. Synthesize the result for the human.\n\n${paragraph(2)}`, backAt);
run("direct:atlas", "atlas", back, backAt, { root: atlasRun });
insert("reports", {
  id: uuid("report:1"),
  fromEmployee: bot.nova,
  toEmployee: bot.atlas,
  task: null,
  run: novaRun,
  summary: paragraph(1),
  read: 1,
  created: backAt,
});
const gameTask = uuid("task:board:14");
const startAt = later();
db.prepare("UPDATE tasks SET status='done', updated=?, revision=4 WHERE id=?").run(startAt, gameTask);
activity(gameTask, "human", "status", "backlog → in_progress", startAt);
activity(gameTask, "human", "started", "Started with 1 assignee", startAt);
const brief = message("games", "human", "task", `Task ${gameTask.slice(0, 8)}: ${lorem(5)}`, startAt);
const nicoRun = run("games", "nico", brief, startAt, { task: gameTask });
const reviewAt = later();
activity(gameTask, "system", "status", "in_progress → review", reviewAt, nicoRun);
activity(gameTask, "system", "review-requested", `Review requested from ${bot.dex}`, reviewAt);
const reviewMessage = message("games", "system", "handoff", `Review task ${gameTask.slice(0, 8)}. ${lorem(8)}`, reviewAt);
const dexRun = run("games", "dex", reviewMessage, reviewAt, { task: gameTask });
activity(gameTask, "dex", "status", "review → done", later(), dexRun);
insert("reports", {
  id: uuid("report:2"),
  fromEmployee: bot.nico,
  toEmployee: bot.dex,
  task: gameTask,
  run: nicoRun,
  summary: paragraph(1),
  read: 0,
  created: reviewAt,
});
message("hq", "human", "user", lorem(15), later());
const approvalRun = db.prepare("SELECT id,conversation,employee FROM runs WHERE employee=? ORDER BY rowid LIMIT 1").get(bot.hazel);
insert("approvals", {
  id: uuid("approval:1"),
  run: approvalRun.id,
  conversation: approvalRun.conversation,
  employee: approvalRun.employee,
  tool: "Bash",
  summary: lorem(5),
  detail: "",
  status: "denied",
  created: later(1),
  decided: later(1),
});
// The prompts of the newest runs (an app keeps the newest 50 whole).
for (const { id } of db.prepare("SELECT id FROM runs ORDER BY rowid DESC LIMIT 12").all()) {
  const prompt = paragraph(4);
  insert("run_inputs", {
    run: id,
    prompt,
    created: at(BASE, 9000),
    sections: JSON.stringify({ identity: 200, history: prompt.length - 200 }),
    hash: promptHash(prompt),
    chars: prompt.length,
  });
}
insert("events", { type: "message.accepted", payload: "{}", created: at(OLD, 900) });
insert("events", { type: "run.completed", payload: "{}", created: later(1) });
db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES ('pauseReset','1')").run();

// Dump: the schema in creation order (FTS shadow tables are rebuilt by
// their virtual tables), then rows table by table, parents first.
const shadow = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE VIRTUAL TABLE%'")
    .all()
    .flatMap(({ name }) => ["data", "idx", "content", "docsize", "config"].map((suffix) => `${name}_${suffix}`)),
);
const schema = db
  .prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
  .all()
  .filter(({ name }) => !shadow.has(name));
const quote = (value) =>
  value === null ? "NULL" : typeof value === "number" || typeof value === "bigint" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const order = [
  "metadata",
  "employees",
  "conversations",
  "messages",
  "tasks",
  "runs",
  "run_responses",
  "run_inputs",
  "routines",
  "routine_occurrences",
  "task_activity",
  "docs",
  "doc_history",
  "memories",
  "memories_fts",
  "reports",
  "kg_entities",
  "kg_edges",
  "kg_fts",
  "approvals",
  "events",
];
const tables = schema.filter((s) => s.type === "table").map((s) => s.name);
const lines = [
  `-- Any Bot workspace at schema ${SCHEMA_VERSION}, laid out by that version's Store and filled by`,
  "-- scripts/make-schema-fixture.mjs: a team shaped like a 45-bot life org, plus 3",
  "-- archived bots and their leftover room. Synthetic data only: lorem text, and",
  "-- {root} / {userData} stand for the team's folder and Any Bot's data folder.",
  ...schema.map((s) => `${s.sql};`),
];
for (const table of [...order.filter((t) => tables.includes(t)), ...tables.filter((t) => !order.includes(t))]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const virtual = schema.find((s) => s.name === table).sql.startsWith("CREATE VIRTUAL TABLE");
  const rows = db.prepare(`SELECT ${columns.join(",")} FROM ${table}${virtual ? "" : " ORDER BY rowid"}`).all();
  for (const row of rows) lines.push(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map((c) => quote(row[c])).join(",")});`);
}
store.close();
rmSync(directory, { recursive: true, force: true });
writeFileSync(target, `${lines.join("\n")}\n`);
// Loads back cleanly, foreign keys on.
const check = new DatabaseSync(":memory:");
check.exec("PRAGMA foreign_keys=ON");
check.exec(lines.join("\n").replaceAll("{root}", "/r").replaceAll("{userData}", "/u"));
const count = (sql) => check.prepare(sql).get().n;
console.log(
  `Wrote ${target}: ${count("SELECT count(*) AS n FROM employees WHERE archived=0")} active and ${count(
    "SELECT count(*) AS n FROM employees WHERE archived=1",
  )} archived bots, ${count("SELECT count(*) AS n FROM runs")} runs, ${count("SELECT count(*) AS n FROM messages")} messages.`,
);
check.close();
