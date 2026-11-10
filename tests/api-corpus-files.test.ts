import assert from "node:assert/strict";
import { test } from "node:test";
import { readPreparedCorpusBatch } from "../components/corpus-import";

function file(value: unknown, name = "batch-0001.json") {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}

test("corpus browser preflight accepts bounded prepared batches without changing article content", async () => {
  const articles = [
    { articleId: "source-1", content: "తెలుగు quoted text remains unchanged", verdict: "" },
  ];
  assert.deepEqual(await readPreparedCorpusBatch(file({ articles })), { articles });
});

test("corpus browser preflight rejects manifests, raw formats and malformed records", async () => {
  for (const input of [
    file({ files: ["batch.json"] }, "manifest.json"),
    file({ articles: [] }),
    file({ articles: Array(101).fill({}) }),
    file({ articles: [null] }),
    file({ articles: [{}] }, "corpus.csv"),
    new File(["{"], "bad.json"),
  ]) {
    await assert.rejects(() => readPreparedCorpusBatch(input));
  }
});

test("corpus browser preflight bounds actual bytes before reading a file", async () => {
  const oversized = new File(["x".repeat(1_000_001)], "large.json");
  await assert.rejects(() => readPreparedCorpusBatch(oversized), /1,000,000-byte/);
});
