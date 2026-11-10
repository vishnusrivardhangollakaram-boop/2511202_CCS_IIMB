/** A real SQLite engine behind the small D1 surface used by this application. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

let sqlite: DatabaseSync;

function statement(query: string, parameters: unknown[] = []): D1PreparedStatement {
  return {
    bind(...values: unknown[]) {
      return statement(query, values);
    },
    async first(column?: string) {
      const row = sqlite.prepare(query).get(...(parameters as never[])) as
        | Record<string, unknown>
        | undefined;
      return row ? (column ? row[column] : row) : null;
    },
    async all() {
      const rows = sqlite.prepare(query).all(...(parameters as never[]));
      return { results: rows, success: true, meta: { changes: 0, duration: 0 } };
    },
    async run() {
      const result = sqlite.prepare(query).run(...(parameters as never[]));
      return {
        results: [],
        success: true,
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
          duration: 0,
        },
      };
    },
    async raw() {
      return sqlite
        .prepare(query)
        .all(...(parameters as never[]))
        .map((row) => Object.values(row));
    },
  } as unknown as D1PreparedStatement;
}

export const fakeD1 = {
  prepare: statement,
  async batch(statements: D1PreparedStatement[]) {
    sqlite.exec("BEGIN");
    try {
      const result = [];
      for (const item of statements) result.push(await item.run());
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
  async exec(sql: string) {
    sqlite.exec(sql);
    return { count: 1, duration: 0 };
  },
} as unknown as D1Database;

export const env: Cloudflare.Env = { DB: fakeD1, REVIEWER_IDS: "researcher-a" };

export function resetDatabase() {
  sqlite?.close();
  sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(path.join("drizzle", file), "utf8"));
  }
  env.TAVILY_API_KEY = undefined;
  env.GEMINI_API_KEY = undefined;
  env.GEMINI_MODEL = undefined;
}

export function queryDatabase(query: string) {
  return sqlite.prepare(query).all();
}
