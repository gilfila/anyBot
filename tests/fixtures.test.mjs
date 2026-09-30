// Workspace fixtures (tests/fixtures/schema-v*.sql) live in a public repo, so
// they must be synthetic: no paths from a real machine, no addresses, and no
// real conversation text. scripts/make-schema-fixture.mjs writes them from
// lorem ipsum, with {root} and {userData} standing in for folders.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const folder = new URL("./fixtures/", import.meta.url);
const fixtures = (await readdir(folder)).filter((name) => /^schema-v\d+\.sql$/.test(name));

// Words the generator and the app's own notices use, besides lorem ipsum.
const LOREM =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum";
const TEMPLATES =
  "synthetic assignment prompt one number two done routine daily brief delegated work returned synthesize the result for human task review handing this to handed in youtube studio happens there and comes back here slack dm";

test("schema fixtures carry no real paths, addresses or conversation text", async () => {
  assert.ok(fixtures.includes("schema-v18.sql"));
  for (const name of fixtures) {
    const sql = await readFile(new URL(name, folder), "utf8");
    assert.doesNotMatch(sql, /\b[A-Za-z]:[\\/]/, `${name}: a drive-letter path`);
    assert.doesNotMatch(sql, /\\\\[\w.-]+\\/, `${name}: a network path`);
    assert.doesNotMatch(sql, /\/(Users|home)\//i, `${name}: a home folder`);
    assert.doesNotMatch(sql, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, `${name}: an email address`);
    const db = new DatabaseSync(":memory:");
    db.exec(sql);
    // Every folder is a placeholder (or a scratch path).
    const folders = [
      ...db.prepare("SELECT workspace AS path FROM employees").all(),
      ...db
        .prepare("SELECT allowedFolders FROM conversations")
        .all()
        .flatMap((row) => JSON.parse(row.allowedFolders).map((path) => ({ path }))),
    ];
    for (const { path } of folders) assert.match(path, /^(\{root\}|\{userData\}|\/tmp\/)/, `${name}: ${path}`);
    // Every word people or bots wrote is lorem ipsum, a bot's name, or the
    // app's own wording.
    const names = db.prepare("SELECT name FROM employees").all().map((row) => row.name.toLowerCase());
    const rooms = db.prepare("SELECT title FROM conversations").all().map((row) => row.title.toLowerCase());
    const known = new Set([...LOREM.split(" "), ...TEMPLATES.split(" "), ...names, ...rooms.flatMap((t) => t.split(/[^a-z]+/))]);
    const texts = [
      ...db.prepare("SELECT body AS text FROM messages").all(),
      ...db.prepare("SELECT output AS text FROM runs").all(),
      ...db.prepare("SELECT prompt AS text FROM run_inputs").all(),
      ...db.prepare("SELECT title || ' ' || description AS text FROM tasks").all(),
      ...db.prepare("SELECT body AS text FROM memories").all(),
      ...db.prepare("SELECT summary AS text FROM reports").all(),
    ];
    for (const { text } of texts) {
      const words = String(text)
        .replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|\b[0-9a-f]{8}\b/g, " ")
        .toLowerCase()
        .match(/[a-z]+/g) || [];
      const unknown = words.filter((word) => !known.has(word));
      assert.deepEqual(unknown, [], `${name}: ${JSON.stringify(String(text).slice(0, 80))}`);
    }
    db.close();
  }
});
