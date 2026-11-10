"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, CheckCircle2, FileJson, LoaderCircle, Upload, XCircle } from "lucide-react";
import { api } from "./api";

type BatchStatus = "ready" | "invalid" | "importing" | "done" | "failed" | "unconfirmed";
interface Batch {
  id: string;
  file: File;
  count: number;
  status: BatchStatus;
  message?: string;
  processed?: number;
}
interface BatchPayload {
  articles: unknown[];
}
interface ImportResult {
  imported: number;
  upsert: boolean;
}
export interface CorpusImportProps {
  onImported: () => void | Promise<void>;
  totalArticles?: number;
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 600;
const labels: Record<BatchStatus, string> = {
  ready: "Ready",
  invalid: "Invalid",
  importing: "Importing",
  done: "Complete",
  failed: "Failed",
  unconfirmed: "Outcome unconfirmed",
};

/** Parse one bounded file at a time; never hold the complete article corpus in browser memory. */
export async function readPreparedCorpusBatch(file: File): Promise<BatchPayload> {
  if (!file.name.toLowerCase().endsWith(".json"))
    throw new Error("Choose a prepared batch JSON file, not a CSV, Parquet file or archive.");
  if (file.size > MAX_FILE_BYTES)
    throw new Error(
      "This file is larger than the 1,000,000-byte batch limit. Split it with the preparation script.",
    );
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("This file does not contain valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("articles" in value) ||
    !Array.isArray(value.articles)
  ) {
    throw new Error(
      "Expected a prepared batch with an articles array. The import manifest is not a batch.",
    );
  }
  if (value.articles.length < 1 || value.articles.length > 100)
    throw new Error("Each batch must contain 1–100 article records.");
  if (
    value.articles.some(
      (article) => !article || typeof article !== "object" || Array.isArray(article),
    )
  )
    throw new Error(
      "Each article must be a JSON object. The server checks its fields before saving the batch.",
    );
  return { articles: value.articles };
}

/** Deliberate, sequential imports with visible partial outcomes and no automatic replay. */
export function CorpusImport({ onImported, totalArticles }: CorpusImportProps) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [consent, setConsent] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(0);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [attempted, setAttempted] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retryId, setRetryId] = useState<string | null>(null);
  const stop = useRef(false);
  const runInFlight = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const ready = batches.filter((batch) => batch.status === "ready");
  const complete = batches.filter((batch) => batch.status === "done");
  const failures = batches.filter((batch) => batch.status === "failed");
  const unconfirmed = batches.filter((batch) => batch.status === "unconfirmed");
  const rowsProcessed = complete.reduce((sum, batch) => sum + (batch.processed || 0), 0);

  function updateBatch(id: string, patch: Partial<Batch>) {
    setBatches((previous) =>
      previous.map((batch) => (batch.id === id ? { ...batch, ...patch } : batch)),
    );
  }

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || []);
    if (!files.length) return;
    setError("");
    setMessage("");
    setRetryId(null);
    setConsent(false);
    if (files.length > MAX_FILES) {
      setError(
        `Select at most ${MAX_FILES} prepared batch files at a time. No files were uploaded.`,
      );
      event.currentTarget.value = "";
      return;
    }
    setValidating(true);
    setValidated(0);
    setBatches([]);
    setAttempted(0);
    setRunTotal(0);
    const next: Batch[] = [];
    for (const file of files) {
      const id = `batch-${++sequence.current}`;
      try {
        const payload = await readPreparedCorpusBatch(file);
        next.push({ id, file, count: payload.articles.length, status: "ready" });
      } catch (issue) {
        next.push({
          id,
          file,
          count: 0,
          status: "invalid",
          message: issue instanceof Error ? issue.message : "The file could not be read.",
        });
      }
      setValidated(next.length);
    }
    setBatches(next);
    setValidating(false);
  }

  async function importReady() {
    if (runInFlight.current || running || validating || !consent || ready.length === 0) return;
    runInFlight.current = true;
    const selected = [...ready];
    stop.current = false;
    setStopping(false);
    setRunning(true);
    setAttempted(0);
    setRunTotal(selected.length);
    setError("");
    setMessage("");
    let completedRequests = 0;
    try {
      for (const batch of selected) {
        if (stop.current) break;
        updateBatch(batch.id, { status: "importing", message: undefined });
        try {
          const payload = await readPreparedCorpusBatch(batch.file);
          const response = await api<ImportResult>("/api/corpus/import", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          if (
            !Number.isInteger(response.imported) ||
            response.imported < 0 ||
            response.imported > payload.articles.length
          )
            throw new Error("The server response could not confirm this batch's outcome.");
          updateBatch(batch.id, {
            status: "done",
            processed: response.imported,
            message: `${response.imported} rows processed by upsert.`,
          });
        } catch (issue) {
          const status = (issue as { status?: number })?.status;
          const confirmedFailure = typeof status === "number";
          updateBatch(batch.id, {
            status: confirmedFailure ? "failed" : "unconfirmed",
            message: confirmedFailure
              ? issue instanceof Error
                ? issue.message
                : "The server rejected this batch."
              : "The response was interrupted or could not be confirmed. This batch may already have been saved. Check the actual corpus count before an explicit retry.",
          });
          // A lost connection, quota, authentication or provider/storage error should not cascade through hundreds of batches.
          if (
            !confirmedFailure ||
            status === 401 ||
            status === 403 ||
            status === 429 ||
            (status !== undefined && status >= 500)
          ) {
            stop.current = true;
            setMessage(
              "Import paused after an access, connection or service error. Remaining ready batches were not sent.",
            );
          }
        }
        completedRequests += 1;
        setAttempted(completedRequests);
      }
      if (!stop.current)
        setMessage(
          "Import run finished. Review each batch outcome below; processed rows may update existing article IDs.",
        );
      else
        setMessage(
          (current) =>
            current ||
            "Import stopped after the current batch. Remaining ready batches were not sent.",
        );
    } finally {
      runInFlight.current = false;
      setRunning(false);
      setStopping(false);
      if (completedRequests > 0) {
        try {
          await onImported();
        } catch {
          setError(
            "The batches finished, but the actual corpus total could not be refreshed. Refresh the workspace before checking the total.",
          );
        }
      }
    }
  }

  function clearSelection() {
    if (running || validating) return;
    setBatches([]);
    setConsent(false);
    setMessage("");
    setError("");
    setRetryId(null);
    setAttempted(0);
    setRunTotal(0);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <section className="evaluation-section corpus-import" aria-labelledby="corpus-import-title">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">YOUR RESEARCH COLLECTION</span>
          <h2 id="corpus-import-title">Bring your fact-check archive.</h2>
        </div>
        {typeof totalArticles === "number" && (
          <span className="tag tag-neutral">{totalArticles.toLocaleString()} stored articles</span>
        )}
      </div>
      <p>
        Prepare CSV or Parquet data with <code>scripts/prepare_corpus.py</code>, then select the
        generated batch JSON files. Imports stay in your private corpus. No model or search-service
        key is needed.
      </p>
      <div className="method-callout" style={{ marginTop: 20, padding: 22 }}>
        <label
          htmlFor="corpus-batch-files"
          style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 10 }}
        >
          Prepared article batches
        </label>
        <input
          ref={fileInput}
          id="corpus-batch-files"
          type="file"
          accept=".json,application/json"
          multiple
          disabled={running || validating}
          onChange={(event) => {
            void chooseFiles(event);
          }}
          aria-describedby="corpus-import-help"
          style={{ display: "block", maxWidth: "100%", fontSize: 14 }}
        />
        <p id="corpus-import-help" style={{ marginBottom: 0, fontSize: 13 }}>
          Select up to 600 files, each with 1–100 articles and no larger than 1 MB. Choose batch
          files only; exclude the manifest. Files are checked locally before you choose Import.
        </p>
      </div>
      {validating && (
        <p role="status" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LoaderCircle size={16} aria-hidden="true" />
          Checking files locally: {validated} checked. Nothing has been uploaded.
        </p>
      )}
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 16 }}>
          <AlertCircle size={17} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {batches.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 20px",
              margin: "20px 0 12px",
              fontSize: 13,
            }}
            aria-live="polite"
          >
            <span>
              <strong>{batches.length}</strong> files selected
            </span>
            <span>
              <strong>{ready.reduce((sum, batch) => sum + batch.count, 0).toLocaleString()}</strong>{" "}
              rows ready
            </span>
            <span>
              <strong>{complete.length}</strong> batches complete
            </span>
            <span>
              <strong>{failures.length}</strong> failed
            </span>
            {unconfirmed.length > 0 && (
              <span>
                <strong>{unconfirmed.length}</strong> unconfirmed
              </span>
            )}
          </div>
          <ul
            aria-label="Selected corpus batches"
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              maxHeight: 300,
              overflowY: "auto",
              border: "1px solid #dce6df",
              borderRadius: 10,
            }}
          >
            {batches.map((batch) => (
              <li
                key={batch.id}
                style={{
                  padding: "12px 15px",
                  borderBottom: "1px solid #e6ece7",
                  display: "grid",
                  gridTemplateColumns: "20px minmax(0, 1fr)",
                  gap: 10,
                }}
              >
                {batch.status === "done" ? (
                  <CheckCircle2 size={17} color="#36744e" aria-hidden="true" />
                ) : batch.status === "failed" ||
                  batch.status === "invalid" ||
                  batch.status === "unconfirmed" ? (
                  <XCircle size={17} color="#a45d49" aria-hidden="true" />
                ) : batch.status === "importing" ? (
                  <LoaderCircle size={17} aria-hidden="true" />
                ) : (
                  <FileJson size={17} color="#667d70" aria-hidden="true" />
                )}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: "5px 12px",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      fontSize: 13,
                    }}
                  >
                    <strong style={{ overflowWrap: "anywhere" }}>{batch.file.name}</strong>
                    <span>
                      {labels[batch.status]}
                      {batch.count > 0 ? ` · ${batch.count} rows` : ""}
                    </span>
                  </div>
                  {batch.message && (
                    <p style={{ fontSize: 12, margin: "5px 0 0", lineHeight: 1.7 }}>
                      {batch.message}
                    </p>
                  )}
                  {!running && (batch.status === "failed" || batch.status === "unconfirmed") && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setRetryId(batch.id)}
                      style={{ marginTop: 6, fontSize: 12 }}
                    >
                      Prepare an explicit retry
                    </button>
                  )}
                  {retryId === batch.id && !running && (
                    <div className="inline-notice" style={{ display: "block", marginTop: 10 }}>
                      <p style={{ fontSize: 12, margin: "0 0 10px" }}>
                        This batch may already have been saved. Existing article IDs will be
                        updated, not added twice. Confirm to put only this batch back in the ready
                        list; then choose Import again.
                      </p>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => {
                            updateBatch(batch.id, {
                              status: "ready",
                              message: undefined,
                              processed: undefined,
                            });
                            setRetryId(null);
                          }}
                        >
                          Prepare this batch
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setRetryId(null)}
                        >
                          Keep current outcome
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <label className="checkbox-label" style={{ marginTop: 18, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={consent}
              disabled={running}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>I have permission to import these articles into this private workspace.</span>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
            <button
              className="button primary"
              type="button"
              disabled={!consent || !ready.length || running || validating}
              onClick={() => {
                void importReady();
              }}
            >
              <Upload size={16} aria-hidden="true" />
              Import {ready.length} ready {ready.length === 1 ? "batch" : "batches"}
            </button>
            {running ? (
              <button
                className="button secondary"
                type="button"
                disabled={stopping}
                onClick={() => {
                  stop.current = true;
                  setStopping(true);
                }}
              >
                {" "}
                {stopping ? "Stopping after current batch…" : "Stop after current batch"}
              </button>
            ) : (
              <button className="button secondary" type="button" onClick={clearSelection}>
                Clear selection
              </button>
            )}
          </div>
          {runTotal > 0 && (
            <div style={{ marginTop: 18 }}>
              <label
                htmlFor="corpus-import-progress"
                style={{ display: "block", fontSize: 13, marginBottom: 7 }}
              >
                {attempted} of {runTotal} batch requests finished in this run
              </label>
              <progress
                id="corpus-import-progress"
                max={runTotal}
                value={attempted}
                style={{ width: "100%", height: 9, accentColor: "#36744e" }}
              />
            </div>
          )}
          {(message || complete.length > 0) && (
            <div
              role="status"
              aria-live="polite"
              style={{ marginTop: 14, fontSize: 13, lineHeight: 1.8 }}
            >
              {message && <p style={{ margin: 0 }}>{message}</p>}
              {complete.length > 0 && (
                <p style={{ margin: "4px 0 0" }}>
                  <strong>{rowsProcessed.toLocaleString()} rows processed</strong> across confirmed
                  batches. This includes updates; use the stored-article count for the actual corpus
                  size.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default CorpusImport;
