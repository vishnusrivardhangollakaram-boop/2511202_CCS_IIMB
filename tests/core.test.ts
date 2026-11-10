import assert from "node:assert/strict";
import test from "node:test";
import type { Claim, CorpusArticle, Evidence } from "../lib/domain";
import { FIXTURE_CLOCK, getScenario, scenarios } from "../lib/fixtures";
import {
  assessVerdict,
  evaluateSufficiency,
  independentSourceCount,
  POLICY_VERSION,
} from "../lib/sufficiency";
import { cosineSimilarity, searchCorpus, tokenise } from "../lib/retrieval";

const claim: Claim = {
  text: "Riverton buses are free on Sunday.",
  parts: ["Riverton buses are free on Sunday."],
  timeSensitive: true,
  domain: "Society & other",
};

function evidence(patch: Partial<Evidence> = {}): Evidence {
  return {
    id: "record-a",
    title: "Official transit notice",
    url: "https://example.org/transit-notice",
    publisher: "Transit office",
    publishedAt: "2026-11-08T09:00:00Z",
    retrievedAt: FIXTURE_CLOCK,
    excerpt:
      "The fictional transit office's dated primary notice explicitly makes Riverton municipal buses free on Sunday.",
    stance: "supports",
    relevance: 0.95,
    quality: 0.95,
    independenceKey: "transit-office-original",
    claimParts: claim.parts,
    contextMatch: true,
    temporalMatch: true,
    isPrimary: true,
    origin: "manual",
    verified: true,
    ...patch,
  };
}

const evaluate = (
  items: Evidence[],
  patch: Partial<Claim> = {},
  options: { attempt?: number; maxAttempts?: number } = {},
) => evaluateSufficiency({ ...claim, ...patch }, items, { now: FIXTURE_CLOCK, ...options });

for (const scenario of scenarios) {
  test(`synthetic fixture: ${scenario.id} has expected gate and preliminary verdict`, () => {
    const gate = evaluateSufficiency(scenario.claim, scenario.evidence, {
      now: scenario.evaluationDate,
    });
    assert.equal(gate.decision, scenario.expectedDecision);
    assert.equal(
      assessVerdict(scenario.claim, scenario.evidence, gate).verdict,
      scenario.expectedVerdict,
    );
    assert.equal(gate.policyVersion, POLICY_VERSION);
    assert.ok(gate.score >= 0 && gate.score <= 100);
    assert.ok(scenario.evidence.every((item) => item.origin === "demo"));
  });
}

test("fixture selection is explicit and fixture copies cannot mutate defaults", () => {
  assert.equal(getScenario("this unrelated claim includes a transit keyword"), undefined);
  const first = getScenario("verified-transit")!;
  first.evidence[0].verified = false;
  assert.equal(getScenario("verified-transit")!.evidence[0].verified, true);
});

test("one checked high-quality primary source can suffice with a recorded exception", () => {
  const gate = evaluate([evidence()]);
  assert.equal(gate.decision, "proceed");
  assert.equal(gate.score, 100);
  assert.match(
    gate.checks.find((item) => item.id === "independence")!.detail,
    /single-primary exception/,
  );
});

test("strong refuting evidence is sufficient and yields False", () => {
  const items = [evidence({ stance: "refutes" })];
  const gate = evaluate(items);
  assert.equal(gate.decision, "proceed");
  assert.equal(assessVerdict(claim, items, gate).verdict, "False");
});

test("a high model estimate cannot turn an unchecked snippet into checked evidence", () => {
  const items = [evidence({ verified: false, relevance: 1, quality: 1 })];
  const gate = evaluate(items);
  assert.equal(gate.decision, "retrieve_more");
  assert.equal(gate.eligibleEvidenceIds.length, 0);
  assert.equal(gate.score, 0);
  assert.equal(assessVerdict(claim, items, gate).verdict, "Unverifiable");
});

test("an empty evidence package has zero adequacy and cannot claim checked consistency", () => {
  const gate = evaluate([]);
  assert.equal(gate.score, 0);
  assert.equal(gate.decision, "retrieve_more");
  const consistency = gate.checks.find((check) => check.id === "consistency")!;
  assert.equal(consistency.passed, false);
  assert.match(consistency.detail, /No qualifying direct evidence/);
});

test("inapplicable or context-only evidence has zero adequacy despite relevant metadata", () => {
  for (const patch of [
    { stance: "context" as const },
    { temporalMatch: false },
    { contextMatch: false },
    { publishedAt: "2020-11-08T09:00:00Z" },
  ]) {
    const gate = evaluate([evidence(patch)]);
    assert.equal(gate.checks.find((check) => check.id === "relevance")!.passed, true);
    assert.equal(gate.score, 0);
    assert.equal(gate.decision, "retrieve_more");
  }
});

test("one ordinary secondary source requires corroboration", () => {
  assert.equal(evaluate([evidence({ isPrimary: false })]).decision, "retrieve_more");
});

test("a lower-quality primary source does not receive the primary exception", () => {
  assert.equal(evaluate([evidence({ quality: 0.8 })]).decision, "retrieve_more");
});

test("every atomic part needs corroboration or its own strong primary source", () => {
  const secondPart = "Riverton buses will run until midnight.";
  const items = [
    evidence(),
    evidence({
      id: "b",
      url: "https://another.example.org/second",
      publisher: "Other source",
      independenceKey: "other-report",
      isPrimary: false,
      claimParts: [secondPart],
      excerpt:
        "Separate reporting claims an operating window through midnight, but supplies only this single secondary source.",
    }),
  ];
  const gate = evaluate(items, { parts: [...claim.parts, secondPart] });
  assert.equal(gate.coveredParts, 2);
  assert.equal(gate.independentSources, 2);
  assert.equal(gate.decision, "retrieve_more");
  assert.equal(gate.checks.find((item) => item.id === "independence")!.passed, false);
});

test("partial claim coverage does not permit a verdict", () => {
  const gate = evaluate([evidence()], {
    parts: [...claim.parts, "The offer includes private buses."],
  });
  assert.equal(gate.coveredParts, 1);
  assert.equal(gate.totalParts, 2);
  assert.equal(gate.decision, "retrieve_more");
  assert.ok(gate.gaps.some((gap) => gap.includes("private buses")));
});

test("explicit unknown source independence cannot manufacture corroboration", () => {
  const items = [
    evidence({ independenceKey: "", isPrimary: false }),
    evidence({
      id: "b",
      independenceKey: "",
      publisher: "Different publisher",
      url: "https://different.example.org/report",
      isPrimary: false,
      excerpt:
        "A separate-looking website repeats the free fare allegation, but the original reporting relationship has not been checked or established.",
    }),
  ];
  assert.equal(independentSourceCount(items), 0);
  assert.equal(evaluate(items).decision, "retrieve_more");
});

test("syndicated copies share one original source family", () => {
  const a = evidence({ isPrimary: false });
  const b = evidence({
    id: "b",
    isPrimary: false,
    url: "https://second.example.org/report",
    publisher: "Second paper",
  });
  assert.equal(independentSourceCount([a, b]), 1);
  assert.equal(evaluate([a, b]).decision, "retrieve_more");
});

test("changing a source key cannot make a duplicate URL independent", () => {
  const a = evidence({ isPrimary: false });
  const b = evidence({
    id: "b",
    isPrimary: false,
    url: `${a.url}?utm_source=forward#caption`,
    publisher: "Other label",
    independenceKey: "invented-new-key",
  });
  assert.equal(independentSourceCount([a, b]), 1);
});

test("near-identical long excerpts collapse even with different URLs and origin labels", () => {
  const excerpt =
    "This extended fictional report says that municipal bus fares are waived for all passengers on the specified Sunday and that the original announcement was confirmed by the transport office on Saturday morning.";
  const a = evidence({ excerpt, isPrimary: false });
  const b = evidence({
    id: "b",
    excerpt: `${excerpt} Updated.`,
    isPrimary: false,
    url: "https://second.example.org/report",
    publisher: "Second paper",
    independenceKey: "other-key",
  });
  assert.equal(independentSourceCount([a, b]), 1);
});

test("material support/refutation conflict routes directly to human review", () => {
  const items = [
    evidence(),
    evidence({
      id: "b",
      stance: "refutes",
      publisher: "Operator",
      url: "https://operator.example.org/notices",
      independenceKey: "operator",
      excerpt:
        "The operator's primary record states that ordinary fares remain in effect on the Sunday addressed by the claim.",
    }),
  ];
  const gate = evaluate(items, {}, { attempt: 0, maxAttempts: 4 });
  assert.equal(gate.decision, "human_review");
  assert.match(gate.reasons[0], /conflict/);
  assert.equal(assessVerdict(claim, items, gate).verdict, "Unverifiable");
});

test("context-only evidence cannot establish a factual verdict", () => {
  assert.equal(evaluate([evidence({ stance: "context" })]).decision, "retrieve_more");
});

test("wrong context is excluded even with otherwise strong evidence", () => {
  assert.equal(evaluate([evidence({ contextMatch: false })]).eligibleEvidenceIds.length, 0);
});

test("wrong temporal applicability is excluded", () => {
  assert.equal(evaluate([evidence({ temporalMatch: false })]).decision, "retrieve_more");
});

test("stale supporting news does not establish a current claim", () => {
  assert.equal(
    evaluate([evidence({ publishedAt: "2020-11-08T09:00:00Z" })]).decision,
    "retrieve_more",
  );
});

test("an authenticated historical original can explicitly refute a recycled current claim", () => {
  const items = [
    evidence({
      publishedAt: "2020-11-08T09:00:00Z",
      historicalRefutation: true,
      stance: "refutes",
    }),
  ];
  assert.equal(evaluate(items).decision, "proceed");
});

test("historical refutation flag cannot exempt stale supporting content", () => {
  assert.equal(
    evaluate([evidence({ publishedAt: "2020-11-08T09:00:00Z", historicalRefutation: true })])
      .decision,
    "retrieve_more",
  );
});

test("time-insensitive claims may use correctly contextualised historical evidence", () => {
  assert.equal(
    evaluate([evidence({ publishedAt: "2020-11-08T09:00:00Z" })], { timeSensitive: false })
      .decision,
    "proceed",
  );
});

test("a time-sensitive claim requires a known publication date", () => {
  assert.equal(evaluate([evidence({ publishedAt: null })]).decision, "retrieve_more");
});

test("future publication and retrieval timestamps are excluded", () => {
  assert.equal(
    evaluate([evidence({ publishedAt: "2027-01-01T00:00:00Z" })]).eligibleEvidenceIds.length,
    0,
  );
  assert.equal(
    evaluate([evidence({ retrievedAt: "2027-01-01T00:00:00Z" })]).eligibleEvidenceIds.length,
    0,
  );
});

test("invalid evidence dates fail closed", () => {
  assert.equal(evaluate([evidence({ retrievedAt: "not-a-date" })]).eligibleEvidenceIds.length, 0);
  assert.equal(evaluate([evidence({ publishedAt: "not-a-date" })]).eligibleEvidenceIds.length, 0);
});

test("invalid evaluation clock is rejected", () => {
  assert.throws(() => evaluateSufficiency(claim, [evidence()], { now: "not-a-date" }), /timestamp/);
});

test("NaN, infinite and out-of-range policy estimates do not qualify", () => {
  for (const relevance of [NaN, Infinity, -1, 2])
    assert.equal(evaluate([evidence({ relevance })]).decision, "retrieve_more");
  for (const quality of [NaN, Infinity, -1, 2])
    assert.equal(evaluate([evidence({ quality })]).decision, "retrieve_more");
});

test("unsafe or nonpublic source URL shapes do not qualify", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://localhost/a",
    "http://127.0.0.1/a",
    "https://user:pass@example.org/a",
    "https://host.internal/a",
  ]) {
    assert.equal(evaluate([evidence({ url })]).eligibleEvidenceIds.length, 0);
  }
});

test("duplicate evidence IDs cannot increase corroboration", () => {
  const a = evidence({ isPrimary: false });
  const gate = evaluate([a, { ...a }]);
  assert.equal(gate.independentSources, 1);
  assert.equal(gate.eligibleEvidenceIds.length, 1);
  assert.equal(gate.decision, "retrieve_more");
});

test("bounded search exhaustion escalates rather than claiming falsity", () => {
  const gate = evaluate([], {}, { attempt: 2, maxAttempts: 2 });
  assert.equal(gate.decision, "human_review");
  assert.equal(assessVerdict(claim, [], gate).verdict, "Unverifiable");
  assert.match(gate.reasons[0], /budget/);
});

test("empty claim cannot proceed", () => {
  const gate = evaluateSufficiency({ ...claim, text: "", parts: [] }, [], { now: FIXTURE_CLOCK });
  assert.equal(gate.decision, "human_review");
});

test("fallback claim part and duplicate atomic parts are handled consistently", () => {
  assert.equal(evaluate([evidence()], { parts: [] }).decision, "proceed");
  assert.equal(
    evaluate([evidence()], { parts: [claim.text, claim.text.toUpperCase()] }).totalParts,
    1,
  );
});

const articles: CorpusArticle[] = [
  {
    articleId: "a",
    title: "Riverton bus fare announcement",
    url: "https://example.org/a",
    site: "Archive A",
    date: "2026-11-08",
    primaryClaim: "Municipal buses are free on Sunday",
    content: "The city publishes a free bus transit fare notice for Sunday.",
    verdict: "True",
  },
  {
    articleId: "b",
    title: "Library schedule",
    url: "https://example.org/b",
    site: "Archive B",
    date: null,
    primaryClaim: "The library opens at nine",
    content: "Reading room opening hours and the catalogue.",
    verdict: "Other",
  },
];

test("lexical retrieval ranks relevant historical claims and discloses its method", () => {
  const matches = searchCorpus("Riverton free bus Sunday", articles);
  assert.equal(matches[0].article.articleId, "a");
  assert.equal(matches[0].method, "lexical");
  assert.equal(matches[0].semanticScore, null);
  assert.ok(matches[0].lexicalScore > 0);
});

test("empty or unrelated queries do not fabricate historical matches", () => {
  assert.deepEqual(searchCorpus("", articles), []);
  assert.deepEqual(searchCorpus("volcano dragons", articles), []);
});

test("tokenisation retains negation and numerical context", () => {
  assert.deepEqual(tokenise("This is NOT free in 2026"), ["not", "free", "2026"]);
});

test("hybrid retrieval only runs with embeddings from the declared matching model", () => {
  const embedded = articles.map((article, index) => ({
    ...article,
    embedding: index ? [0, 1] : [1, 0],
    embeddingModel: "test-model",
  }));
  const hybrid = searchCorpus("Riverton", embedded, {
    queryEmbedding: [1, 0],
    embeddingModel: "test-model",
  });
  assert.equal(hybrid[0].method, "hybrid");
  assert.equal(hybrid[0].semanticScore, 1);
  const mismatch = searchCorpus("Riverton", embedded, {
    queryEmbedding: [1, 0],
    embeddingModel: "different-model",
  });
  assert.equal(mismatch[0].method, "lexical");
  assert.equal(mismatch[0].semanticScore, null);
});

test("invalid embedding vectors fall back to lexical retrieval", () => {
  const rows = [{ ...articles[0], embedding: [1, 0], embeddingModel: "test-model" }];
  for (const vector of [
    [0, 0],
    [NaN, 1],
    [1, 2, 3],
  ]) {
    assert.equal(
      searchCorpus("Riverton", rows, { queryEmbedding: vector, embeddingModel: "test-model" })[0]
        .method,
      "lexical",
    );
  }
});

test("cosine similarity handles incompatible and degenerate vectors", () => {
  assert.equal(cosineSimilarity([], []), null);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), null);
  assert.equal(cosineSimilarity([1], [1, 2]), null);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("retrieval deduplicates article IDs and honours its result limit", () => {
  assert.equal(searchCorpus("Riverton", [articles[0], articles[0]]).length, 1);
  assert.equal(searchCorpus("bus library", articles, { limit: 1 }).length, 1);
});
