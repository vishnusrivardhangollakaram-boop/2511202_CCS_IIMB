import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getScenario } from "../lib/fixtures";
import {
  assertFrozenClaim,
  mergeEvidence,
  serialiseCase,
  type InvestigationCase,
} from "../lib/store";
import { manualEvidence } from "../app/api/_shared";
import { GET as health } from "../app/api/health/route";
import { POST as create } from "../app/api/cases/route";
import { queryDatabase, resetDatabase } from "./support/cloudflare";
import { ApiError } from "../lib/http";
const failure = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;
beforeEach(resetDatabase);

test("repeated searches preserve attested originals and conflicting quotes from the same URL", () => {
  const scenario = getScenario("verified-transit")!;
  const original = { ...scenario.evidence[0], origin: "manual" as const, verified: true };
  const duplicate = { ...original, id: "new-id", origin: "web" as const, verified: false };
  const conflicting = { ...duplicate, id: "conflicting-id", stance: "refutes" as const };
  const anotherQuote = {
    ...duplicate,
    id: "another-id",
    excerpt:
      "A separate quotation from the same published source remains independently inspectable.",
  };
  const result = mergeEvidence([original], [duplicate, conflicting, anotherQuote]);
  assert.equal(result.evidence.length, 3);
  assert.equal(result.evidence[0], original);
  assert.equal(result.evidence[0].verified, true);
  assert.equal(result.duplicates, 1);
  assert.equal(result.added, 2);
  assert.equal(result.omitted, 0);
});

test("source cap omits new material explicitly without discarding earlier evidence", () => {
  const original = getScenario("verified-transit")!.evidence[0];
  const existing = Array.from({ length: 50 }, (_, i) => ({
    ...original,
    id: `old-${i}`,
    excerpt: `Original quotation number ${i} that was already stored.`,
  }));
  const incoming = [
    { ...original, id: "incoming", excerpt: "A newly discovered source quotation." },
  ];
  const result = mergeEvidence(existing, incoming);
  assert.deepEqual(result.evidence, existing);
  assert.equal(result.omitted, 1);
  assert.equal(result.added, 0);
});

test("new evidence ID collision cannot hide a distinct quotation", () => {
  const original = getScenario("verified-transit")!.evidence[0];
  const result = mergeEvidence(
    [original],
    [{ ...original, excerpt: "A new quotation with an accidentally reused identifier." }],
  );
  assert.equal(result.evidence.length, 2);
  assert.notEqual(result.evidence[0].id, result.evidence[1].id);
});

test("follow-up extraction cannot silently change any frozen claim attribute", () => {
  const claim = getScenario("verified-transit")!.claim;
  assert.doesNotThrow(() => assertFrozenClaim(claim, structuredClone(claim)));
  for (const changed of [
    { ...claim, text: claim.text + " changed" },
    { ...claim, parts: [...claim.parts, "An additional proposition"] },
    { ...claim, timeSensitive: !claim.timeSensitive },
  ]) {
    assert.throws(() => assertFrozenClaim(claim, changed), failure("claim_changed"));
  }
});

test("aggregate byte and review budgets fail before database mutation", () => {
  const record = { reviews: [], text: "small" } as unknown as InvestigationCase;
  assert.ok(serialiseCase(record).includes("small"));
  assert.throws(
    () =>
      serialiseCase({ ...record, text: "తెలుగు".repeat(100_000) } as unknown as InvestigationCase),
    failure("case_limit"),
  );
  assert.throws(
    () => serialiseCase({ ...record, reviews: Array(21).fill({}) }),
    failure("case_limit"),
  );
});

test("manual ingestion preserves unknown independence and restricts historical exemptions", () => {
  const claim = getScenario("verified-transit")!.claim;
  const item = {
    title: "A source document",
    url: "https://council.example.org/document",
    excerpt: "A source excerpt which was manually supplied for review.",
    stance: "refutes",
    claimParts: claim.parts,
    historicalRefutation: true,
  };
  const unverified = manualEvidence(item, claim, false);
  assert.equal(unverified.independenceKey, "");
  assert.equal(unverified.historicalRefutation, false);
  assert.equal(manualEvidence(item, claim, true).historicalRefutation, true);
});

test("readiness reports storage and policy without identity or secrets", async () => {
  const response = await health();
  assert.equal(response.status, 200);
  const result = (await response.json()) as Record<string, unknown>;
  assert.equal(result.status, "ok");
  assert.equal(result.storage, "ready");
  assert.deepEqual(Object.keys(result).sort(), ["policyVersion", "status", "storage"]);
});

test("missing live configuration fails before persisting any orphan case", async () => {
  const request = new Request("https://ccs.test/api/cases", {
    method: "POST",
    headers: {
      origin: "https://ccs.test",
      "content-type": "application/json",
      "oai-authenticated-user-id": "researcher-a",
      "oai-authenticated-user-email": "a@example.org",
    },
    body: JSON.stringify({
      mode: "live",
      text: "A factual claim requiring current evidence.",
      requestId: "no-provider-request",
    }),
  });
  const response = await create(request);
  assert.equal(response.status, 503);
  assert.equal(queryDatabase("SELECT * FROM cases").length, 0);
  assert.equal(queryDatabase("SELECT * FROM audit_events").length, 0);
});
