import test from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "../src/lib/single-flight.js";
import { loadDrafts, saveDrafts, withDraft } from "../src/lib/drafts.js";
import { primaryChats, sidebarProjects } from "../src/lib/projects.js";
import { resolveCd } from "../src/lib/terminal-path.js";
import { workingBots } from "../src/lib/ui.js";

test("snapshot refreshes never pile up: one in flight, one more after it", async () => {
  let calls = 0;
  let release = [];
  const refresh = singleFlight(() => {
    calls += 1;
    return new Promise((resolve) => release.push(resolve));
  });
  const first = refresh();
  refresh();
  refresh();
  refresh();
  assert.equal(calls, 1, "pushes while a snapshot is loading wait for it");
  release.shift()();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 2, "then exactly one more, for everything that changed meanwhile");
  release.shift()();
  await first;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 2);
  refresh();
  assert.equal(calls, 3, "idle again: the next push loads at once");
  release.shift()();
});

test("a failed refresh doesn't stop later ones", async () => {
  let calls = 0;
  const refresh = singleFlight(async () => {
    calls += 1;
    throw new Error("runtime unavailable");
  });
  await refresh().catch(() => {});
  await refresh().catch(() => {});
  assert.equal(calls, 2);
});

test("unsent text is kept per conversation", () => {
  let drafts = {};
  drafts = withDraft(drafts, "atlas", "Long brief for Atlas");
  drafts = withDraft(drafts, "nova", "Note for Nova");
  assert.equal(drafts.atlas, "Long brief for Atlas");
  assert.equal(drafts.nova, "Note for Nova");
  drafts = withDraft(drafts, "nova", "");
  assert.equal("nova" in drafts, false, "a sent or cleared draft is dropped");
  assert.equal(withDraft(drafts, "atlas", "Long brief for Atlas"), drafts, "no change, same object");
  const storage = new Map();
  const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  saveDrafts(drafts, store);
  assert.deepEqual(loadDrafts(store), { atlas: "Long brief for Atlas" });
  // Storage that fails or holds junk never breaks the composer.
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(loadDrafts(broken), {});
  saveDrafts(drafts, broken);
  assert.deepEqual(loadDrafts({ getItem: () => "[1,2]" }), {});
  assert.deepEqual(loadDrafts({ getItem: () => '{"a":"ok","b":7}' }), { a: "ok" });
});

test("a one-bot conversation that isn't the bot's chat stays reachable as a project", () => {
  const conversations = [
    { id: "atlas-chat", members: ["atlas"], created: "1" },
    { id: "launch", title: "Product launch", members: ["atlas"], created: "2" },
    { id: "team", title: "Team", members: ["atlas", "nova"], created: "3" },
    { id: "nova-only", title: "Nova's first", members: ["nova"], created: "4" },
    { id: "old", title: "Old", members: ["atlas"], archived: 1, created: "5" },
  ];
  assert.deepEqual([...primaryChats(conversations)], ["atlas-chat", "nova-only"]);
  assert.deepEqual(sidebarProjects(conversations).map((c) => c.id), ["launch", "team", "old"]);
});

test("cd in the Terminal moves its folder", () => {
  assert.equal(resolveCd("C:\\work\\site", "src"), "C:\\work\\site\\src");
  assert.equal(resolveCd("C:\\work\\site", ".."), "C:\\work");
  assert.equal(resolveCd("C:\\work\\site", "..\\..\\..\\.."), "C:\\");
  assert.equal(resolveCd("C:\\work\\site", "/d D:\\music"), "D:\\music");
  assert.equal(resolveCd("C:\\work\\site", "\"C:\\Program Files\""), "C:\\Program Files");
  assert.equal(resolveCd("/home/tony/site", "../notes"), "/home/tony/notes");
  assert.equal(resolveCd("/home/tony", "/tmp/x/"), "/tmp/x");
  assert.equal(resolveCd("", "src"), null, "a relative cd needs a folder to start from");
});

test("the working bots an update or quit would stop", () => {
  const data = {
    employees: [
      { id: "a", name: "Atlas" },
      { id: "n", name: "Nova" },
    ],
    runs: [
      { employee: "a", status: "running" },
      { employee: "n", status: "queued" },
      { employee: "a", status: "succeeded" },
      { employee: "n", status: "cancelling" },
    ],
  };
  assert.deepEqual(workingBots(data), ["Atlas", "Nova"]);
  assert.deepEqual(workingBots({ employees: [], runs: [] }), []);
});
