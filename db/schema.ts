import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Each case is a bounded, versioned aggregate; owner is always checked by the API. */
export const cases = sqliteTable(
  "cases",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    requestId: text("request_id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
    lastOperationId: text("last_operation_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("cases_owner_request").on(table.ownerId, table.requestId),
    index("cases_owner_updated").on(table.ownerId, table.updatedAt),
  ],
);

/** Append-only application audit trail, committed atomically with each case mutation. */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    ownerId: text("owner_id").notNull(),
    actorId: text("actor_id").notNull(),
    version: integer("version").notNull(),
    event: text("event").notNull(),
    snapshot: text("snapshot").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audit_case_version").on(table.caseId, table.version)],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("rate_limits_expiry").on(table.expiresAt)],
);

/** Imported records are private to their importing workspace owner. */
export const corpusArticles = sqliteTable(
  "corpus_articles",
  {
    key: text("key").primaryKey(),
    ownerId: text("owner_id").notNull(),
    articleId: text("article_id").notNull(),
    payload: text("payload").notNull(),
    searchText: text("search_text").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("corpus_owner_article").on(table.ownerId, table.articleId),
    index("corpus_owner").on(table.ownerId),
  ],
);
