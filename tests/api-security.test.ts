import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApiError,
  apiBoundary,
  assertSameOrigin,
  boundedString,
  publicHttpsUrl,
  readJson,
  requiredVersion,
} from "../lib/http";
import { assertReviewer, requireUser, resolveUser } from "../lib/auth";

function errorCode(code: string) {
  return (error: unknown) => error instanceof ApiError && error.code === code;
}

test("mutations require exact origin and reject missing or cross-site origins", () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(
      new Request("https://evidence.example.org/api/cases", {
        headers: { origin: "https://evidence.example.org", "sec-fetch-site": "same-origin" },
      }),
    ),
  );
  for (const headers of [
    {},
    { origin: "https://attacker.example.org" },
    { origin: "https://evidence.example.org", "sec-fetch-site": "cross-site" },
  ] as Record<string, string>[]) {
    assert.throws(
      () => assertSameOrigin(new Request("https://evidence.example.org/api/cases", { headers })),
      errorCode("origin_rejected"),
    );
  }
});

test("production auth does not fall back to local identity", () => {
  assert.throws(
    () => requireUser(new Request("https://evidence.example.org/api/cases")),
    errorCode("authentication_required"),
  );
  assert.throws(
    () =>
      resolveUser(
        new Request("https://evidence.example.org/api/cases", {
          headers: { "oai-authenticated-user-id": "partial" },
        }),
      ),
    errorCode("authentication_required"),
  );
});

test("reviewer membership uses exact stable IDs, not email or substring", () => {
  const request = new Request("https://evidence.example.org", {
    headers: {
      "oai-authenticated-user-id": "user-1",
      "oai-authenticated-user-email": "reviewer@example.org",
      "oai-authenticated-user-full-name": "%E0%A4",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });
  const analyst = resolveUser(request, { REVIEWER_IDS: "user-10, reviewer@example.org" });
  assert.equal(analyst.canReview, false);
  assert.equal(analyst.displayName, "reviewer@example.org");
  assert.throws(() => assertReviewer(analyst, "manual"), errorCode("reviewer_required"));
  assert.doesNotThrow(() => assertReviewer(analyst, "demo"));
  assert.equal(resolveUser(request, { REVIEWER_IDS: " user-1, user-2 " }).canReview, true);
});

test("JSON parser enforces content type, UTF-8, syntax and streaming byte limit", async () => {
  const request = (body: string, type = "application/json") =>
    new Request("https://evidence.example.org/api/cases", {
      method: "POST",
      headers: { "content-type": type },
      body,
    });
  await assert.rejects(() => readJson(request("{}", "text/plain")), errorCode("json_required"));
  await assert.rejects(() => readJson(request("{")), errorCode("invalid_json"));
  await assert.rejects(
    () => readJson(request(JSON.stringify({ text: "x".repeat(200) })), 100),
    errorCode("payload_too_large"),
  );
  assert.deepEqual(await readJson(request('{"text":"తెలుగు"}')), { text: "తెలుగు" });
});

test("URL metadata rejects executable schemes, credentials and private endpoints", () => {
  for (const value of [
    "javascript:alert(1)",
    "http://example.org/a",
    "https://user:password@example.org/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://localhost/a",
    "https://host.local/a",
    "https://127.0.0.1.nip.io/a",
    "https://example.org:444/a",
  ]) {
    assert.throws(() => publicHttpsUrl(value), errorCode("invalid_url"));
  }
  assert.equal(
    publicHttpsUrl("https://news.example.org/report#part"),
    "https://news.example.org/report",
  );
});

test("optimistic versions reject non-integers and string coercion", () => {
  for (const value of [undefined, 0, -1, 1.5, "1", NaN])
    assert.throws(() => requiredVersion(value), errorCode("version_required"));
  assert.equal(requiredVersion(2), 2);
  assert.throws(() => boundedString(" ", "Claim", 1, 10), errorCode("invalid_input"));
});

test("unexpected errors return safe correlated output without leaking private payloads", async () => {
  const response = await apiBoundary(async () => {
    throw new Error("API_KEY=private-secret-123 and claim private");
  });
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes("private-secret"), false);
  assert.equal(text.includes("claim private"), false);
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("cache-control"), "no-store");
});
