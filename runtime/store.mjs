import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const id = () => randomUUID();
// Bump with each migration below. Newer workspaces are refused by older apps.
export const SCHEMA_VERSION = 13;
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
      storedVersion > SCHEMA_VERSION ||
      storedVersion < 1
    ) {
      this.db.close();
      throw new Error(
        "Unsupported workspace schema. Use the matching Any Bot version.",
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
    const projectVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (projectVersion < 6) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "ALTER TABLE conversations ADD COLUMN allowedFolders TEXT NOT NULL DEFAULT '[]';",
        );
        this.db.exec(
          "ALTER TABLE conversations ADD COLUMN artifactsFolder TEXT NOT NULL DEFAULT '';",
        );
        this.db
          .prepare("UPDATE metadata SET value='6' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const dismissedVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (dismissedVersion < 7) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "ALTER TABLE runs ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0;",
        );
        this.db
          .prepare("UPDATE metadata SET value='7' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const boardVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (boardVersion < 8) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE tasks (id TEXT PRIMARY KEY,
            conversation TEXT NOT NULL REFERENCES conversations(id),
            title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK (status IN ('backlog','in_progress','review','done')),
            priority TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none','low','medium','high','urgent')),
            due TEXT NOT NULL DEFAULT '', labels TEXT NOT NULL DEFAULT '[]',
            assignees TEXT NOT NULL DEFAULT '[]', reviewer TEXT NOT NULL DEFAULT '',
            checklist TEXT NOT NULL DEFAULT '[]', parent TEXT REFERENCES tasks(id),
            sortKey REAL NOT NULL, createdBy TEXT NOT NULL,
            created TEXT NOT NULL, updated TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
          CREATE INDEX task_board ON tasks(conversation, status, sortKey);
          CREATE TABLE task_activity (id TEXT PRIMARY KEY,
            task TEXT NOT NULL REFERENCES tasks(id), author TEXT NOT NULL,
            kind TEXT NOT NULL, body TEXT NOT NULL, run TEXT REFERENCES runs(id),
            created TEXT NOT NULL);
          CREATE INDEX task_activity_task ON task_activity(task, created);
          ALTER TABLE runs ADD COLUMN task TEXT REFERENCES tasks(id);
          ALTER TABLE conversations ADD COLUMN autopilot INTEGER NOT NULL DEFAULT 0;
        `);
        this.db
          .prepare("UPDATE metadata SET value='8' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const docsVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (docsVersion < 9) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE docs (conversation TEXT PRIMARY KEY REFERENCES conversations(id),
            blocks TEXT NOT NULL, revision INTEGER NOT NULL, updatedBy TEXT NOT NULL, updated TEXT NOT NULL);
          CREATE TABLE doc_history (id TEXT PRIMARY KEY,
            conversation TEXT NOT NULL REFERENCES conversations(id), blocks TEXT NOT NULL,
            revision INTEGER NOT NULL, author TEXT NOT NULL, run TEXT, created TEXT NOT NULL);
          CREATE INDEX doc_history_conversation ON doc_history(conversation, created);
        `);
        this.db
          .prepare("UPDATE metadata SET value='9' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const orgVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (orgVersion < 10) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          ALTER TABLE employees ADD COLUMN manager TEXT NOT NULL DEFAULT '';
          CREATE TABLE memories (id TEXT PRIMARY KEY,
            employee TEXT NOT NULL REFERENCES employees(id),
            scope TEXT NOT NULL CHECK (scope IN ('private','team','project')),
            conversation TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL, run TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
          CREATE INDEX memory_employee ON memories(employee, updated);
          CREATE VIRTUAL TABLE memories_fts USING fts5(body, tags, memory UNINDEXED);
          CREATE TABLE reports (id TEXT PRIMARY KEY,
            fromEmployee TEXT NOT NULL REFERENCES employees(id), toEmployee TEXT NOT NULL,
            task TEXT, run TEXT, summary TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0,
            created TEXT NOT NULL);
          CREATE INDEX report_inbox ON reports(toEmployee, read, created);
        `);
        this.db
          .prepare("UPDATE metadata SET value='10' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const knowledgeVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (knowledgeVersion < 11) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE kg_entities (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL,
            labelKey TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
            createdBy TEXT NOT NULL, run TEXT, pinned INTEGER NOT NULL DEFAULT 0,
            created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(type, labelKey));
          CREATE TABLE kg_edges (id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL,
            relation TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
            createdBy TEXT NOT NULL, run TEXT, pinned INTEGER NOT NULL DEFAULT 0,
            created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(src, dst, relation));
          CREATE INDEX kg_edge_src ON kg_edges(src);
          CREATE INDEX kg_edge_dst ON kg_edges(dst);
          CREATE VIRTUAL TABLE kg_fts USING fts5(text, ref UNINDEXED);
        `);
        this.db
          .prepare("UPDATE metadata SET value='11' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const approvalsVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (approvalsVersion < 12) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE approvals (id TEXT PRIMARY KEY, run TEXT NOT NULL, conversation TEXT NOT NULL,
            employee TEXT NOT NULL, tool TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired','cancelled')),
            created TEXT NOT NULL, decided TEXT);
          CREATE INDEX approvals_status ON approvals(status, created);
        `);
        // Headless runs can't show a permission prompt, so "ask" silently
        // denied everything gated. Auto mode runs safe actions and routes
        // risky ones to the owner.
        this.db.exec("UPDATE employees SET permissionMode='auto' WHERE permissionMode='ask' OR permissionMode=''");
        this.db
          .prepare("UPDATE metadata SET value='12' WHERE key='schema'")
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      }
    }
    const threadsVersion = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
    );
    if (threadsVersion < 13) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        // Threads: a reply names its thread's first message. Runs record the
        // thread they answer in, so their replies land there.
        for (const table of ["messages", "runs"]) {
          const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
          if (!columns.includes("thread")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN thread TEXT`);
          this.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_thread ON ${table}(thread)`);
        }
        this.db
          .prepare("UPDATE metadata SET value='13' WHERE key='schema'")
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
