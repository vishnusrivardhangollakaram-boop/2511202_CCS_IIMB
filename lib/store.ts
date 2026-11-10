import type { Claim, CorpusArticle, Evidence, GateResult, Verdict } from "./domain";
import { normaliseText } from "./domain";
import type { WorkspaceUser } from "./auth";
import { ApiError } from "./http";

export type CaseMode = "demo" | "manual" | "live";
export type CaseStatus =
  | "draft"
  | "ready"
  | "needs_evidence"
  | "human_review"
  | "reviewed"
  | "investigating"
  | "failed";
export interface CaseEvent {
  id: string;
  type: string;
  title: string;
  detail: string;
  createdAt: string;
  actor: string;
}
export interface HumanReview {
  id: string;
  decision: "approve" | "revise" | "request_evidence";
  verdict: Verdict | null;
  reason: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  caseVersion: number;
  evidenceIds: string[];
  evidenceSnapshot: Evidence[];
  gateSnapshot: GateResult;
  override: boolean;
}
export interface InvestigationCase {
  id: string;
  ownerId: string;
  requestId: string;
  requestHash: string;
  version: number;
  claim: Claim;
  mode: CaseMode;
  inputType: "text" | "url" | "image";
  originalInput: { text: string; url?: string };
  scenarioId?: string;
  evaluationDate?: string;
  status: CaseStatus;
  gate: GateResult;
  verdict: Verdict;
  explanation: string;
  preliminary: boolean;
  finalVerdict: Verdict | null;
  evidence: Evidence[];
  events: CaseEvent[];
  reviews: HumanReview[];
  createdAt: string;
  updatedAt: string;
  attempt: number;
  warnings: string[];
  reviewRequested?: boolean;
  reviewStatus?: "none" | "pending" | "completed";
  handoffReason?: string | null;
  summary?: boolean;
  evidenceCount?: number;
  reviewCount?: number;
}

/** Bound the entire aggregate, including immutable review snapshots, below D1's row limit. */
export function serialiseCase(record: InvestigationCase): string {
  if (record.reviews.length > 20)
    throw new ApiError(
      409,
      "case_limit",
      "This case has reached its review-history limit. Export it and open a new investigation.",
    );
  const payload = JSON.stringify(record);
  if (new TextEncoder().encode(payload).byteLength > 1_000_000)
    throw new ApiError(
      409,
      "case_limit",
      "This case has reached its storage limit. Export it and open a new investigation.",
    );
  return payload;
}

/** Preserve original attestations and conflicting quotations across repeated searches. */
export function mergeEvidence(
  existing: Evidence[],
  incoming: Evidence[],
  limit = 50,
): { evidence: Evidence[]; added: number; duplicates: number; omitted: number } {
  const key = (item: Evidence) => {
    let url = item.url;
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      parsed.searchParams.sort();
      url = parsed.href.replace(/\/$/, "");
    } catch {
      /* Validation occurs at the ingestion boundary. */
    }
    return `${url}\u001f${normaliseText(item.excerpt)}\u001f${item.stance}`;
  };
  const result = [...existing];
  const keys = new Set(existing.map(key));
  const ids = new Set(existing.map((entry) => entry.id));
  let duplicates = 0;
  let omitted = 0;
  for (const item of incoming) {
    const fingerprint = key(item);
    if (keys.has(fingerprint)) {
      duplicates += 1;
      continue;
    }
    if (result.length >= limit) {
      omitted += 1;
      continue;
    }
    const entry = ids.has(item.id) ? { ...item, id: crypto.randomUUID() } : item;
    result.push(entry);
    ids.add(entry.id);
    keys.add(fingerprint);
  }
  return { evidence: result, added: result.length - existing.length, duplicates, omitted };
}

/** Extraction may establish the first claim; later searches must not move its goalposts. */
export function assertFrozenClaim(before: Claim, after: Claim): void {
  if (
    before.text !== after.text ||
    before.timeSensitive !== after.timeSensitive ||
    before.domain !== after.domain ||
    before.timeWindowDays !== after.timeWindowDays ||
    JSON.stringify(before.parts) !== JSON.stringify(after.parts)
  ) {
    throw new ApiError(
      502,
      "claim_changed",
      "The provider changed the existing claim during a follow-up search. Its result was not applied.",
    );
  }
}

export function database(environment: { DB?: D1Database }): D1Database {
  if (!environment.DB)
    throw new ApiError(503, "storage_unavailable", "Workspace storage is not configured.");
  return environment.DB;
}

export function publicCase(record: InvestigationCase, user: WorkspaceUser) {
  const { ownerId: _owner, requestId: _request, requestHash: _hash, ...rest } = record;
  void _owner;
  void _request;
  void _hash; // These internal identity/idempotency fields never leave the server.
  return {
    ...rest,
    isOwner: record.ownerId === user.id,
    reviewRequested: record.reviewRequested || false,
    reviewStatus: record.reviewStatus || "none",
    handoffReason: record.handoffReason || null,
    canReview: (record.ownerId === user.id && record.mode === "demo") || user.canReview,
  };
}

export function newEvent(
  user: WorkspaceUser,
  type: string,
  title: string,
  detail: string,
): CaseEvent {
  return {
    id: crypto.randomUUID(),
    type,
    title,
    detail,
    createdAt: new Date().toISOString(),
    actor: user.displayName,
  };
}

export async function hashInput(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Idempotency keys are scoped to the caller and cannot return another user's case. */
export async function findRequest(
  db: D1Database,
  ownerId: string,
  requestId: string,
): Promise<InvestigationCase | null> {
  const row = await db
    .prepare("SELECT payload FROM cases WHERE owner_id = ? AND request_id = ?")
    .bind(ownerId, requestId)
    .first<{ payload: string }>();
  return row ? (JSON.parse(row.payload) as InvestigationCase) : null;
}

export async function loadCase(
  db: D1Database,
  ownerId: string,
  id: string,
): Promise<InvestigationCase> {
  const row = await db
    .prepare("SELECT payload FROM cases WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<{ payload: string }>();
  if (!row) throw new ApiError(404, "case_not_found", "This case was not found in your workspace.");
  return JSON.parse(row.payload) as InvestigationCase;
}

const SUMMARY_SELECT =
  "SELECT json_remove(payload, '$.evidence', '$.events', '$.reviews') AS payload, json_array_length(payload, '$.evidence') AS evidence_count, json_array_length(payload, '$.reviews') AS review_count FROM cases";
function summaries(
  rows: { payload: string; evidence_count: number; review_count: number }[],
): InvestigationCase[] {
  return rows.map(
    (row) =>
      ({
        ...JSON.parse(row.payload),
        evidence: [],
        events: [],
        reviews: [],
        evidenceCount: row.evidence_count,
        reviewCount: row.review_count,
        summary: true,
      }) as InvestigationCase,
  );
}

/** Lists use bounded summaries; the selected case is loaded separately in full. */
export async function listCases(db: D1Database, ownerId: string): Promise<InvestigationCase[]> {
  const result = await db
    .prepare(`${SUMMARY_SELECT} WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100`)
    .bind(ownerId)
    .all<{ payload: string; evidence_count: number; review_count: number }>();
  return summaries(result.results);
}

/** Owner consent is explicit and persisted before any separate reviewer can access a case. */
export async function loadReviewCase(
  db: D1Database,
  user: WorkspaceUser,
  id: string,
): Promise<InvestigationCase> {
  const row = user.canReview
    ? await db
        .prepare(
          "SELECT payload FROM cases WHERE id = ? AND (owner_id = ? OR json_extract(payload, '$.reviewRequested') = 1)",
        )
        .bind(id, user.id)
        .first<{ payload: string }>()
    : await db
        .prepare("SELECT payload FROM cases WHERE id = ? AND owner_id = ?")
        .bind(id, user.id)
        .first<{ payload: string }>();
  if (!row)
    throw new ApiError(
      404,
      "case_not_found",
      "This case was not found or has not been shared with you.",
    );
  return JSON.parse(row.payload) as InvestigationCase;
}

export async function listReviewCases(
  db: D1Database,
  user: WorkspaceUser,
): Promise<InvestigationCase[]> {
  if (!user.canReview)
    throw new ApiError(
      403,
      "reviewer_required",
      "This queue is available to configured reviewers.",
    );
  const result = await db
    .prepare(
      `${SUMMARY_SELECT} WHERE json_extract(payload, '$.reviewRequested') = 1 AND json_extract(payload, '$.reviewStatus') = 'pending' ORDER BY updated_at DESC LIMIT 100`,
    )
    .all<{ payload: string; evidence_count: number; review_count: number }>();
  return summaries(result.results);
}

/** D1 batch is transactional; the INSERT SELECT only audits this exact operation. */
export async function createCase(
  db: D1Database,
  record: InvestigationCase,
  user: WorkspaceUser,
): Promise<{ record: InvestigationCase; created: boolean }> {
  const operationId = crypto.randomUUID();
  const payload = serialiseCase(record);
  const event = record.events[0];
  await db.batch([
    db
      .prepare(
        "INSERT INTO cases (id, owner_id, request_id, version, payload, last_operation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, request_id) DO NOTHING",
      )
      .bind(
        record.id,
        user.id,
        record.requestId,
        record.version,
        payload,
        operationId,
        record.createdAt,
        record.updatedAt,
      ),
    db
      .prepare(
        "INSERT INTO audit_events (id, case_id, owner_id, actor_id, version, event, snapshot, created_at) SELECT ?, id, owner_id, ?, version, ?, payload, updated_at FROM cases WHERE id = ? AND owner_id = ? AND last_operation_id = ?",
      )
      .bind(operationId, user.id, JSON.stringify(event), record.id, user.id, operationId),
  ]);
  const stored = await findRequest(db, user.id, record.requestId);
  if (!stored) throw new ApiError(503, "storage_unavailable", "The case could not be saved.");
  if (stored.requestHash !== record.requestHash)
    throw new ApiError(
      409,
      "idempotency_conflict",
      "This request key was already used for different content. Start a new request.",
    );
  return { record: stored, created: stored.id === record.id };
}

/** Compare-and-swap protects review/evidence decisions from stale browser tabs. */
export async function saveCase(
  db: D1Database,
  previous: InvestigationCase,
  next: InvestigationCase,
  user: WorkspaceUser,
  event: CaseEvent,
): Promise<InvestigationCase> {
  if (next.evidence.length > 50 || previous.events.length >= 200)
    throw new ApiError(
      409,
      "case_limit",
      "This case has reached its activity limit. Export it and open a new investigation.",
    );
  const operationId = crypto.randomUUID();
  const stored: InvestigationCase = {
    ...next,
    version: previous.version + 1,
    updatedAt: new Date().toISOString(),
    events: [...previous.events, event],
  };
  const payload = serialiseCase(stored);
  const result = await db.batch([
    db
      .prepare(
        "UPDATE cases SET version = ?, payload = ?, last_operation_id = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?",
      )
      .bind(
        stored.version,
        payload,
        operationId,
        stored.updatedAt,
        previous.id,
        previous.ownerId,
        previous.version,
      ),
    db
      .prepare(
        "INSERT INTO audit_events (id, case_id, owner_id, actor_id, version, event, snapshot, created_at) SELECT ?, id, owner_id, ?, version, ?, payload, updated_at FROM cases WHERE id = ? AND owner_id = ? AND last_operation_id = ?",
      )
      .bind(
        operationId,
        user.id,
        JSON.stringify(event),
        previous.id,
        previous.ownerId,
        operationId,
      ),
  ]);
  if (result[0].meta.changes !== 1)
    throw new ApiError(
      409,
      "version_conflict",
      "This case changed in another session. Refresh before submitting your decision.",
    );
  return stored;
}

export function assertVersion(record: InvestigationCase, version: number): void {
  if (record.version !== version)
    throw new ApiError(
      409,
      "version_conflict",
      "This case changed in another session. Refresh before submitting your decision.",
    );
  if (record.status === "investigating" && Date.now() - Date.parse(record.updatedAt) < 180_000)
    throw new ApiError(
      409,
      "investigation_running",
      "An investigation is already running for this case.",
    );
}

/** Durable fixed-window limits apply before upstream calls; failures consume a rate token. */
export async function rateLimit(
  db: D1Database,
  ownerId: string,
  action: string,
  limit = 20,
  windowSeconds = 3600,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(now / windowSeconds) * windowSeconds;
  const key = `${ownerId}:${action}:${start}`;
  const result = await db
    .prepare(
      "INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
    )
    .bind(key, start + windowSeconds)
    .first<{ count: number }>();
  if (!result || result.count > limit)
    throw new ApiError(
      429,
      "rate_limit",
      "The workspace's request limit has been reached. Try again after the current time window.",
    );
  // Bounded cleanup prevents expired windows accumulating indefinitely.
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 100)",
    )
    .bind(now - 86400)
    .run();
}

export async function importArticles(
  db: D1Database,
  ownerId: string,
  articles: CorpusArticle[],
): Promise<number> {
  const now = new Date().toISOString();
  await db.batch(
    articles.map((article) =>
      db
        .prepare(
          "INSERT INTO corpus_articles (key, owner_id, article_id, payload, search_text, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, article_id) DO UPDATE SET payload = excluded.payload, search_text = excluded.search_text, updated_at = excluded.updated_at",
        )
        .bind(
          `${ownerId}\u001f${article.articleId}`,
          ownerId,
          article.articleId,
          JSON.stringify(article),
          `${article.title} ${article.primaryClaim} ${article.content}`
            .normalize("NFKC")
            .toLowerCase(),
          now,
        ),
    ),
  );
  return articles.length;
}

export async function corpusCandidates(
  db: D1Database,
  ownerId: string,
  query: string,
): Promise<CorpusArticle[]> {
  const terms = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])).slice(
    0,
    8,
  );
  if (!terms.length) return [];
  // Token quoting prevents FTS operators from being interpreted as query syntax.
  const expression = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
  const result = await db
    .prepare(
      "SELECT corpus_articles.payload FROM corpus_search JOIN corpus_articles ON corpus_articles.rowid = corpus_search.rowid WHERE corpus_articles.owner_id = ? AND corpus_search MATCH ? ORDER BY bm25(corpus_search) LIMIT 500",
    )
    .bind(ownerId, expression)
    .all<{ payload: string }>();
  return result.results.map((row) => JSON.parse(row.payload) as CorpusArticle);
}

export async function corpusCount(db: D1Database, ownerId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM corpus_articles WHERE owner_id = ?")
    .bind(ownerId)
    .first<{ count: number }>();
  return row?.count || 0;
}
