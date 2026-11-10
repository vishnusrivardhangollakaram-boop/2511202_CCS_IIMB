import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { POST as create, GET as list } from "../app/api/cases/route";
import { GET as detail } from "../app/api/cases/[id]/route";
import { POST as addEvidence } from "../app/api/cases/[id]/evidence/route";
import { POST as review } from "../app/api/cases/[id]/review/route";
import { GET as bootstrap } from "../app/api/bootstrap/route";
import { POST as importCorpus } from "../app/api/corpus/import/route";
import { GET as searchCorpus } from "../app/api/corpus/search/route";
import { POST as handoff } from "../app/api/cases/[id]/handoff/route";
import { GET as reviewerQueue } from "../app/api/reviews/route";
import { GET as reviewerDetail } from "../app/api/reviews/[id]/route";
import { resetDatabase, queryDatabase } from "./support/cloudflare";
import { scenarios } from "../lib/fixtures";
import type { InvestigationCase } from "../lib/store";
import type { WorkspaceUser } from "../lib/auth";

interface Payload {
  case: InvestigationCase;
  cases: InvestigationCase[];
  user: WorkspaceUser;
  capabilities: { live: boolean };
  scenarios: unknown[];
}
async function payload(response: Response): Promise<Payload> {
  return (await response.json()) as Payload;
}

const origin = "https://ccs.test";
function request(route: string, body?: unknown, user = "researcher-a") {
  return new Request(origin + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: origin,
      "content-type": "application/json",
      "oai-authenticated-user-id": user,
      "oai-authenticated-user-email": `${user}@example.org`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function demo(id = "request-demo-001") {
  const response = await create(
    request("/api/cases", {
      mode: "demo",
      inputType: "text",
      scenarioId: scenarios[0].id,
      requestId: id,
    }),
  );
  assert.equal(response.status, 201);
  return (await payload(response)).case;
}
beforeEach(resetDatabase);

test("full demo persists its gate, evidence, audited creation and private ownership", async () => {
  const record = await demo();
  assert.ok(record.evidence.length);
  assert.equal(record.preliminary, true);
  const loaded = await detail(request(`/api/cases/${record.id}`), {
    params: Promise.resolve({ id: record.id }),
  });
  assert.equal(loaded.status, 200);
  assert.equal((await payload(loaded)).case.id, record.id);
  const other = await detail(request(`/api/cases/${record.id}`, undefined, "researcher-b"), {
    params: Promise.resolve({ id: record.id }),
  });
  assert.equal(other.status, 404);
  assert.equal(queryDatabase("SELECT * FROM audit_events").length, 1);
  const otherList = await list(request("/api/cases", undefined, "researcher-b"));
  assert.equal((await payload(otherList)).cases.length, 0);
});

test("repeating a create request is idempotent, changed content conflicts", async () => {
  const record = await demo();
  const repeat = await create(
    request("/api/cases", {
      mode: "demo",
      inputType: "text",
      scenarioId: scenarios[0].id,
      requestId: "request-demo-001",
    }),
  );
  assert.equal(repeat.status, 200);
  assert.equal((await payload(repeat)).case.id, record.id);
  const changed = await create(
    request("/api/cases", {
      mode: "manual",
      text: "A different claim needs investigation.",
      requestId: "request-demo-001",
    }),
  );
  assert.equal(changed.status, 409);
  assert.equal(queryDatabase("SELECT * FROM cases").length, 1);
  assert.equal(queryDatabase("SELECT * FROM audit_events").length, 1);
});

test("forged scenario text is rejected and free text does not select fixtures", async () => {
  const forged = await create(
    request("/api/cases", {
      mode: "demo",
      scenarioId: scenarios[0].id,
      text: "Changed claim",
      requestId: "request-demo-001",
    }),
  );
  assert.equal(forged.status, 400);
  const ordinary = await create(
    request("/api/cases", {
      mode: "manual",
      text: scenarios[0].claim.text,
      requestId: "request-manual-001",
    }),
  );
  const record = (await payload(ordinary)).case;
  assert.equal(record.evidence.length, 0);
  assert.equal(record.verdict, "Unverifiable");
});

test("mutation endpoints reject anonymous and cross-origin requests", async () => {
  const anonymous = new Request(origin + "/api/cases", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal((await create(anonymous)).status, 401);
  const cross = request("/api/cases", {});
  cross.headers.set("origin", "https://attacker.invalid");
  assert.equal((await create(cross)).status, 403);
});

test("bootstrap exposes real configuration and zero imported corpus, never credentials", async () => {
  const response = await bootstrap(request("/api/bootstrap"));
  assert.equal(response.status, 200);
  const result = await payload(response);
  assert.equal(result.capabilities.live, false);
  assert.equal(result.user.canReview, true);
  assert.ok(result.scenarios.length >= 4);
  assert.equal(JSON.stringify(result).includes('TAVILY_API_KEY":"'), false);
});

test("manual analyst submissions cannot self-promote evidence as verified", async () => {
  const created = await create(
    request(
      "/api/cases",
      {
        mode: "manual",
        text: "The Riverton council opened a new library.",
        requestId: "request-manual-002",
      },
      "researcher-b",
    ),
  );
  const record = (await payload(created)).case;
  const response = await addEvidence(
    request(
      `/api/cases/${record.id}/evidence`,
      {
        version: record.version,
        evidence: {
          title: "A local announcement",
          url: "https://council.example.org/announcement",
          excerpt: "The council announcement describes a new library opening.",
          stance: "supports",
          quality: 1,
          relevance: 1,
          claimParts: record.claim.parts,
          contextMatch: true,
          temporalMatch: true,
          isPrimary: true,
        },
        verified: true,
        attested: true,
      },
      "researcher-b",
    ),
    { params: Promise.resolve({ id: record.id }) },
  );
  // The endpoint may reject the privileged assertion or retain unverified evidence.
  if (response.status === 200)
    assert.equal((await payload(response)).case.evidence.at(-1)!.verified, false);
  else assert.equal(response.status, 403);
});

test("real-case human decisions require an authorized reviewer", async () => {
  const created = await create(
    request(
      "/api/cases",
      {
        mode: "manual",
        text: "A claim requiring independent investigation.",
        requestId: "request-manual-003",
      },
      "researcher-b",
    ),
  );
  const record = (await payload(created)).case;
  const response = await review(
    request(
      `/api/cases/${record.id}/review`,
      {
        version: record.version,
        decision: "revise",
        verdict: "True",
        reason: "I reviewed this claim and accept it.",
        override: true,
      },
      "researcher-b",
    ),
    { params: Promise.resolve({ id: record.id }) },
  );
  assert.equal(response.status, 403);
  assert.equal(queryDatabase("SELECT * FROM audit_events").length, 1);
});

test("a human decision snapshots evidence and stale tabs cannot overwrite it", async () => {
  const record = await demo();
  const body = {
    version: record.version,
    decision: "approve",
    verdict: record.verdict,
    reason: "I inspected the synthetic original publication and the caption context.",
    evidenceIds: record.evidence.map((e: { id: string }) => e.id),
    overrideConfirmed: true,
  };
  const decided = await review(request(`/api/cases/${record.id}/review`, body), {
    params: { id: record.id },
  });
  assert.equal(decided.status, 200);
  const approved = (await payload(decided)).case;
  assert.equal(approved.preliminary, false);
  assert.equal(approved.finalVerdict, record.verdict);
  assert.equal(approved.reviews[0].evidenceSnapshot.length, record.evidence.length);
  assert.equal(approved.reviews[0].actorId, "researcher-a");
  const stale = await review(request(`/api/cases/${record.id}/review`, body), {
    params: { id: record.id },
  });
  assert.equal(stale.status, 409);
  assert.equal(queryDatabase("SELECT * FROM audit_events").length, 2);
});

test("definitive human override requires selected evidence and explicit confirmation", async () => {
  const record = await demo();
  const noEvidence = await review(
    request(`/api/cases/${record.id}/review`, {
      version: record.version,
      decision: "revise",
      verdict: "True",
      reason: "A human has decided to assert this without any selected supporting record.",
      overrideConfirmed: true,
    }),
    { params: { id: record.id } },
  );
  assert.equal(noEvidence.status, 400);
  const noConfirmation = await review(
    request(`/api/cases/${record.id}/review`, {
      version: record.version,
      decision: "revise",
      verdict: "True",
      reason: "A human has decided to override this assessment after examining the evidence.",
      evidenceIds: record.evidence.map((e: { id: string }) => e.id),
    }),
    { params: { id: record.id } },
  );
  assert.equal(noConfirmation.status, 400);
  assert.equal(queryDatabase("SELECT * FROM audit_events").length, 1);
});

test("FTS import/search is owner-scoped, updates old terms, and rejects duplicate IDs", async () => {
  const article = {
    articleId: "archive-001",
    title: "Transit announcement",
    url: "https://archive.example.org/transit",
    site: "Research fixture",
    date: null,
    primaryClaim: "Riverton buses are free on Sundays",
    content: "The municipal transit announcement explains Sunday services.",
    verdict: "",
    sourceVerdict: "",
    normalizedVerdict: "Blank",
    llmVerdict: "Other",
  };
  const first = await importCorpus(request("/api/corpus/import", { articles: [article] }));
  assert.equal(first.status, 200);
  const own = await searchCorpus(request("/api/corpus/search?q=Riverton"));
  const ownResult = (await own.json()) as {
    matches: { article: { normalizedVerdict: string; verdict: string } }[];
    totalArticles: number;
  };
  assert.equal(ownResult.matches.length, 1);
  assert.equal(ownResult.matches[0].article.normalizedVerdict, "Blank");
  assert.equal(ownResult.matches[0].article.verdict, "");
  const other = await searchCorpus(
    request("/api/corpus/search?q=Riverton", undefined, "researcher-b"),
  );
  assert.equal(((await other.json()) as { matches: unknown[] }).matches.length, 0);
  const duplicate = await importCorpus(
    request("/api/corpus/import", { articles: [article, article] }),
  );
  assert.equal(duplicate.status, 400);
  assert.equal(queryDatabase("SELECT * FROM corpus_articles").length, 1);
  const updated = {
    ...article,
    title: "Library opening",
    primaryClaim: "Brookfield opened a library",
    content: "The local library began welcoming visitors.",
  };
  assert.equal(
    (await importCorpus(request("/api/corpus/import", { articles: [updated] }))).status,
    200,
  );
  const old = await searchCorpus(request("/api/corpus/search?q=Riverton"));
  assert.equal(((await old.json()) as { matches: unknown[] }).matches.length, 0);
  const current = await searchCorpus(request("/api/corpus/search?q=Brookfield"));
  assert.equal(((await current.json()) as { matches: unknown[] }).matches.length, 1);
});

test("durable create quota rejects excess requests without inserting another case", async () => {
  for (let i = 0; i < 30; i++) {
    const response = await create(
      request("/api/cases", {
        mode: "manual",
        text: "A factual claim for quota validation.",
        requestId: `quota-request-${i}`,
      }),
    );
    assert.equal(response.status, 201);
  }
  const extra = await create(
    request("/api/cases", {
      mode: "manual",
      text: "A factual claim for quota validation.",
      requestId: "quota-request-over",
    }),
  );
  assert.equal(extra.status, 429);
  assert.equal(queryDatabase("SELECT * FROM cases").length, 30);
});

test("separate reviewer sees only explicitly shared cases and withdrawal revokes access", async () => {
  const created = await create(
    request(
      "/api/cases",
      {
        mode: "manual",
        text: "The Riverton council announced a new public library.",
        requestId: "handoff-request-001",
      },
      "researcher-b",
    ),
  );
  const record = (await payload(created)).case;
  const context = { params: { id: record.id } };
  assert.equal((await reviewerDetail(request(`/api/reviews/${record.id}`), context)).status, 404);
  const shared = await handoff(
    request(
      `/api/cases/${record.id}/handoff`,
      {
        version: record.version,
        reason: "Please examine the missing official announcement and source context.",
      },
      "researcher-b",
    ),
    context,
  );
  assert.equal(shared.status, 200);
  const pending = (await payload(shared)).case;
  const queue = await reviewerQueue(request("/api/reviews"));
  assert.equal((await payload(queue)).cases.length, 1);
  assert.equal((await reviewerDetail(request(`/api/reviews/${record.id}`), context)).status, 200);
  assert.equal((await detail(request(`/api/cases/${record.id}`), context)).status, 404);
  assert.equal(
    (await reviewerDetail(request(`/api/reviews/${record.id}`, undefined, "researcher-c"), context))
      .status,
    403,
  );
  const decision = await review(
    request(`/api/cases/${record.id}/review`, {
      version: pending.version,
      decision: "revise",
      verdict: "Unverifiable",
      evidenceIds: [],
      reason: "The original source is missing, so no factual conclusion can be justified.",
      overrideConfirmed: true,
    }),
    context,
  );
  assert.equal(decision.status, 200);
  const reviewed = (await payload(decision)).case;
  const audit = queryDatabase("SELECT owner_id, actor_id FROM audit_events WHERE version = 3");
  assert.equal(audit[0].owner_id, "researcher-b");
  assert.equal(audit[0].actor_id, "researcher-a");
  assert.equal(
    (await detail(request(`/api/cases/${record.id}`, undefined, "researcher-b"), context)).status,
    200,
  );
  const withdrawn = await handoff(
    request(
      `/api/cases/${record.id}/handoff`,
      {
        version: reviewed.version,
        action: "withdraw",
        reason: "Review completed; withdraw this case from further shared access.",
      },
      "researcher-b",
    ),
    context,
  );
  assert.equal(withdrawn.status, 200);
  assert.equal((await reviewerDetail(request(`/api/reviews/${record.id}`), context)).status, 404);
  assert.equal((await payload(await reviewerQueue(request("/api/reviews")))).cases.length, 0);
});
