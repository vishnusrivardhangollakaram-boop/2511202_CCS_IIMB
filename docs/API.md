# API contract

All routes are same-origin application endpoints. They return JSON and `Cache-Control: no-store`. See `lib/domain.ts` and `lib/store.ts` for the complete TypeScript contracts. This document describes the implemented routes rather than a proposed public service API.

## Authentication and ownership

Production application requests require the trusted hosting identity headers injected by Sites dispatch. The non-sensitive `/api/health` readiness route is the sole application-level anonymous exception; a private hosting gateway may still require access before forwarding it. General case and corpus operations are scoped to the authenticated owner. Another user's case ID returns 404 on those routes. Separate review routes permit configured reviewers to access cases only when the owner has explicitly handed them off. Handoff is revocable and shares with all configured reviewer IDs.

POST routes require `Content-Type: application/json`, an exact matching `Origin`, and a non-cross-site fetch context. Do not send a user's self-declared identity in the JSON body. A generic external script cannot authenticate by inventing the hosting headers.

## Endpoint map

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap` | Authenticated user, configured capabilities, synthetic scenario metadata and policy metadata |
| GET | `/api/health` | Non-sensitive storage/schema/policy health; no user records or secrets |
| GET | `/api/cases` | Latest 100 own-workspace case summaries |
| POST | `/api/cases` | Create a manual, synthetic or live case with idempotency |
| GET | `/api/cases/:id` | Read one owned case |
| POST | `/api/cases/:id/evidence` | Add a manual evidence record and recompute the gate |
| POST | `/api/cases/:id/investigate` | Reassess manual/demo evidence or run a bounded live investigation |
| POST | `/api/cases/:id/review` | Record an authorised human decision |
| POST | `/api/cases/:id/handoff` | Owner requests or withdraws sharing with the configured reviewer pool |
| GET | `/api/reviews` | Configured reviewer's pending shared case summaries |
| GET | `/api/reviews/:id` | Read a currently shared case as a configured reviewer |
| GET | `/api/corpus/search?q=...` | Search the owner's imported corpus |
| POST | `/api/corpus/import` | Upsert a bounded batch of corpus articles |

## Bootstrap

The response contains:

- `user`: stable ID, display name, email, `canReview` and `local` flags.
- `capabilities`: configured live/search/image capability and explanation; configuration is not a successful provider health check.
- `scenarios`: IDs, titles, descriptions, claim text and explicit synthetic labels.
- `policy`: version, maximum attempts, score label and the actual imported article count.

No provider key is returned.

## Create a case

```json
{
  "requestId": "a-new-client-generated-uuid",
  "mode": "manual",
  "inputType": "text",
  "text": "A factual claim to investigate, with its date and location.",
  "timeSensitive": true
}
```

| Field | Rules |
| --- | --- |
| `requestId` | Required, 8–100 characters; unique per intended new submission |
| `mode` | `manual`, `demo` or `live`; default manual |
| `inputType` | `text`, `url` or `image`; default text |
| `text` | Up to 12,000 characters; non-demo text claims need at least 10 |
| `scenarioId` | Required for demo; forbidden for non-demo modes |
| `url` | Required for URL input; public HTTPS domain |
| `imageData` | Required for image input; PNG/JPEG/WebP base64 data URL, subject to the screenshot limit |
| `timeSensitive` | Boolean for a manual text claim |

URL/image intake requires live mode. An edited scenario claim is rejected as an unchanged demo; create a manual/live case instead. A synthetic example is never selected based on free-text matching.

Response: `{ "case": { ... }, "idempotent": false }`, status 201 when newly created. Repeating the same key and same content returns the same case with status 200. Reusing the key with different content returns 409 `idempotency_conflict`.

Raw screenshot bytes contribute to the request hash but are not retained in `originalInput` or the case payload. The extracted claim may be retained. The create operation can return a persisted failed live case if the provider run fails after creation; inspect `case.status` and warnings, not just HTTP status.

## Case response

Useful fields include `id`, `version`, `claim`, `mode`, `inputType`, `status`, `gate`, `verdict`, `explanation`, `preliminary`, `finalVerdict`, `evidence`, `events`, `reviews`, `attempt`, `warnings`, `createdAt`, `updatedAt` and `canReview`.

Internal owner/request hashes are removed from the public case representation. `isOwner` indicates whether the current actor owns the case. A case's automatic `verdict` and human `finalVerdict` are distinct. A policy score is not a confidence probability.

The interface's message cues are advisory wording analysis from the versioned local module. They are not additional factual evidence, an API truth-confidence field, or inputs to the sufficiency gate. The display identifies whether the analysed wording came from the original text input or the extracted claim.

List responses contain bounded summaries with `summary: true`, counts and empty evidence/event/review arrays. Fetch the detail endpoint before presenting an evidence-free summary as the full case. The owner uses `/api/cases/:id`; a shared reviewer uses `/api/reviews/:id`.

Statuses: `draft`, `ready`, `needs_evidence`, `human_review`, `reviewed`, `investigating`, `failed`. Gate routes: `proceed`, `retrieve_more`, `human_review`. The stored `attempt` counts completed live retrieval attempts; provider failures still consume rate-limit capacity but do not count as successful evidence retrieval.

## Add evidence

```json
{
  "version": 2,
  "attested": false,
  "evidence": {
    "title": "Original source title",
    "url": "https://example.org/original-record",
    "publisher": "Source organisation",
    "publishedAt": "2026-11-01",
    "excerpt": "An exact source excerpt long enough to inspect in context.",
    "stance": "supports",
    "relevance": 0.7,
    "quality": 0.7,
    "independenceKey": "original-source-family",
    "claimParts": ["An exact existing atomic claim part"],
    "contextMatch": true,
    "temporalMatch": true,
    "isPrimary": false,
    "historicalRefutation": false
  }
}
```

This is a shape example, not real evidence or recommended scores. Claim-part entries must belong to the case. Stance defaults to `unclear`; omitted quality/relevance default to 0.3; omitted context/time flags are false. The server generates the evidence ID, retrieval time and `origin: manual`.

`attested: true` produces verified manual provenance only for an authorised reviewer or an owner acting on a synthetic case. It does not elevate a normal user's evidence silently. Source excerpts are 20–12,000 characters. New evidence recomputes the preliminary assessment and clears a previously final current verdict; earlier review history remains.

## Investigate or reassess

```json
{ "version": 3 }
```

For manual/demo cases, this recomputes the current package and records that no web search occurred. For live cases it invokes the actual provider adapter if configured and if the search budget remains. The application currently permits at most three completed live retrieval attempts per case.

A running investigation holds a persisted case status. Concurrent mutations are rejected while the lock is fresh. A provider failure records an interrupted run; it never creates a successful evidence conclusion.

## Human review

```json
{
  "version": 4,
  "decision": "revise",
  "verdict": "Unverifiable",
  "reason": "The available excerpts do not establish the claimed date; additional original evidence is needed.",
  "evidenceIds": [],
  "overrideConfirmed": true
}
```

- `decision`: `approve`, `revise` or `request_evidence`.
- `verdict`: True/False/Misleading/Unverifiable; ignored for `request_evidence`, which stores null.
- `reason`: 20–5,000 characters.
- `evidenceIds`: unique IDs belonging to the case, at most 50; selected items are explicitly attested by the reviewer.
- Definitive True/False/Misleading decisions require at least one selected evidence item.
- An override of the gate or preliminary label requires `overrideConfirmed: true` and at least 40 rationale characters.

The response contains the saved case. The review includes actor identity, reviewed case version, selected evidence, evidence/gate snapshots and override status. The actor identity is server-derived. A configured reviewer may submit this route for a currently shared case; general evidence/investigation/handoff mutations remain owner-only.

## Review handoff

```json
{
  "version": 4,
  "action": "request",
  "reason": "Please examine the conflicting publication dates and original source material before a final decision."
}
```

The owner can select `request` (the default) or `withdraw`; the reason requires 20–3,000 characters. Requesting handoff permits all configured reviewers to inspect the case through the review endpoints. Withdrawing increments the version and revokes those reads and future reviewer submissions. A stale reviewer save fails the version comparison even if the reviewer opened the case before withdrawal.

Completed reviews leave the pending queue. Their detail remains accessible to the configured reviewer pool while the owner retains the handoff; withdrawal removes that access. Prior exports cannot be recalled. The current API has no individual reviewer assignment or institutional membership model.

## Concurrency

Every evidence, investigation and review mutation requires the current integer `version`. The database compares that version when saving. A stale request returns 409 `version_conflict`; reload and reconcile before resubmitting. Retrying a stale decision unchanged is not a safe conflict-resolution strategy.

The current bounded case aggregate supports at most 50 evidence records, 20 reviews, 200 activity events and a 1 MB serialized case payload. Export and create a new case when a limit is reached. The case-list route returns the newest 100 summaries; it is not an administrative complete-database export.

## Corpus

Search query length: 3–500 characters. FTS5 selects up to 500 candidates in the owner's namespace; lexical reranking returns at most 10. The response includes matches, actual article count, candidate limit and `method: lexical`. Pure-module optional vector support is not exposed as a claim of semantic HTTP retrieval.

Import body: `{ "articles": [ ... ] }`, 1–100 records, at most 1,000,000 bytes. See [data contract](DATA.md) for fields. Duplicate IDs within a batch are rejected. Existing IDs are upserted within the same owner. The response `{ "imported": N, "namespace": "your workspace", "upsert": true }` counts accepted records, including updates.

The Method & evaluation import panel accepts prepared batch JSON files and sends this unchanged API shape. Its permission acknowledgement is a client-side confirmation, not an authentication or server-permission field. The API continues to enforce identity, owner scope, body/record validation and rate limits independently. A browser timeout does not prove that a batch was rolled back; clients must represent that outcome as unconfirmed and must not retry silently.

## Rate and payload limits

Limits are durable fixed hourly windows per authenticated user and action:

| Action | Requests per hour |
| --- | ---: |
| Create case | 30 |
| Investigate/reassess | 15 |
| Add evidence | 60 |
| Review | 30 |
| Request/withdraw handoff | 30 |
| Corpus import | 1,000 |
| Corpus search | 120 |

Case create body: 2,900,000 bytes. Evidence/default JSON body: 128,000 bytes. Review: 30,000 bytes. Handoff: 20,000 bytes. Investigate: 10,000 bytes. Corpus import: 1,000,000 bytes. The stream is bounded even without `Content-Length`.

Screenshot files are limited to 2,000,000 decoded bytes by the live adapter and must match their claimed PNG/JPEG/WebP signature. Do not rely on a filename extension alone.

## Errors

```json
{
  "error": {
    "code": "version_conflict",
    "message": "This case changed in another session. Refresh before submitting your decision.",
    "requestId": "server-generated-correlation-id"
  }
}
```

Common statuses: 400 validation, 401 sign-in required, 403 origin/reviewer denied, 404 unavailable owned case, 409 version/idempotency/budget conflict, 413 body too large, 415 unsupported content type, 429 rate limit, and 503 unavailable storage/provider configuration. Error responses omit credentials and raw upstream bodies. Correlation IDs assist diagnosis without logging the claim text.
