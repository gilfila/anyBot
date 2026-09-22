import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const id = () => randomUUID();
export const now = () => new Date().toISOString();

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, "anybot.sqlite"));
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const storedVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        ?.value || 1,
    );
    if (
      !Number.isInteger(storedVersion) ||
      storedVersion > 5 ||
      storedVersion < 1
    ) {
      this.db.close();
      throw new Error(
        "Unsupported workspace schema. Use the matching anyBot version.",
      );
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
        harness TEXT NOT NULL, instructions TEXT NOT NULL, workspace TEXT NOT NULL, trusted INTEGER NOT NULL DEFAULT 0,
        created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL,
        members TEXT NOT NULL, delegation INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id),
        author TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id),
        employee TEXT NOT NULL REFERENCES employees(id), message TEXT NOT NULL REFERENCES messages(id),
        parent TEXT REFERENCES runs(id), root TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
        created TEXT NOT NULL, started TEXT, ended TEXT);
      CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_responses (run TEXT PRIMARY KEY REFERENCES runs(id),
        message TEXT NOT NULL UNIQUE REFERENCES messages(id));
      CREATE TABLE IF NOT EXISTS run_inputs (run TEXT PRIMARY KEY REFERENCES runs(id),
        prompt TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id),
        run TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, blob TEXT NOT NULL,
        digest TEXT NOT NULL, bytes INTEGER NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, name TEXT NOT NULL,
        conversation TEXT NOT NULL REFERENCES conversations(id), employee TEXT NOT NULL REFERENCES employees(id),
        prompt TEXT NOT NULL, minutes INTEGER NOT NULL, nextRun INTEGER NOT NULL,
        enabled INTEGER NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS routine_occurrences (id TEXT PRIMARY KEY,
        routine TEXT NOT NULL REFERENCES routines(id), scheduled INTEGER NOT NULL,
        status TEXT NOT NULL, root TEXT REFERENCES runs(id), created TEXT NOT NULL,
        UNIQUE(routine,scheduled));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
        payload TEXT NOT NULL, created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS run_status ON runs(status, created);
      CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation, created);
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO metadata VALUES ('schema', '1')")
      .run();
    const version = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (version < 2) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "ALTER TABLE employees ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;",
        );
        this.db.exec(
          "ALTER TABLE employees ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;",
        );
        this.db.exec(
          "ALTER TABLE employees ADD COLUMN model TEXT NOT NULL DEFAULT '';",
        );
        this.db
          .prepare("UPDATE metadata SET value='2' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const migratedVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (migratedVersion < 3) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "ALTER TABLE employees ADD COLUMN timeoutMinutes INTEGER NOT NULL DEFAULT 10;",
        );
        this.db
          .prepare("UPDATE metadata SET value='3' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const permissionVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (permissionVersion < 4) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "ALTER TABLE employees ADD COLUMN permissionMode TEXT NOT NULL DEFAULT 'dontAsk';",
        );
        this.db
          .prepare("UPDATE metadata SET value='4' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const avatarVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (avatarVersion < 5) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "ALTER TABLE employees ADD COLUMN avatar TEXT NOT NULL DEFAULT '';",
        );
        this.db
          .prepare("UPDATE metadata SET value='5' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    this.db
      .prepare("INSERT OR IGNORE INTO metadata VALUES ('paused', 'false')")
      .run();
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  one(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  event(type, payload) {
    this.run(
      "INSERT INTO events(type,payload,created) VALUES (?,?,?)",
      type,
      JSON.stringify(payload),
      now(),
    );
  }
  close() {
    this.db.close();
  }
}
