"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Fingerprint,
  GitBranch,
  Info,
  ListChecks,
  LockKeyhole,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import type { CaseRecord, Evidence, Gate, Verdict } from "./client-types";
import { api, downloadJson, escapeHtml } from "./api";
import { handleTabKey } from "./accessibility";
import { analyzeMessageSignals } from "@/lib/message-signals";
import { CorpusImport } from "./corpus-import";

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  ready: "Assessment ready",
  needs_evidence: "More evidence needed",
  human_review: "Human review",
  reviewed: "Reviewed",
  investigating: "Investigating",
  failed: "Needs attention",
};
export const DECISION_LABELS = {
  proceed: "Ready for assessment",
  retrieve_more: "More evidence needed",
  human_review: "Human judgment needed",
};

export function formatDate(value?: string | null, time = false): string {
  if (!value) return "Date not supplied";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit" } : { year: "numeric" }),
  }).format(date);
}
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
export function verdictTone(verdict: Verdict | null) {
  return verdict === "True"
    ? "green"
    : verdict === "False"
      ? "red"
      : verdict === "Misleading"
        ? "amber"
        : "neutral";
}
export function EmptyState({
  icon = "search",
  title,
  children,
  action,
}: {
  icon?: "search" | "review" | "files";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const Icon = icon === "review" ? UsersRound : icon === "files" ? BookOpen : Search;
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function GateInspector({
  gate,
  evidenceCount = 0,
  busy = false,
}: {
  gate: Gate | null;
  evidenceCount?: number;
  busy?: boolean;
}) {
  return (
    <aside className="gate-panel" aria-label="Evidence sufficiency assessment">
      <div className="panel-eyebrow">
        <ShieldCheck size={15} />
        <span>THE EVIDENCE GATE</span>
        <span className="step-label">09</span>
      </div>
      <h3>{gate ? DECISION_LABELS[gate.decision] : "A verdict needs a foundation."}</h3>
      <p className="gate-intro">
        {gate
          ? "What the available evidence can—and cannot—support."
          : "Every claim passes a transparent evidence check before an assessment."}
      </p>
      {gate ? (
        <>
          <div className="adequacy">
            <div>
              <span className="score">
                {Math.round(gate.score)}
                <small>/100</small>
              </span>
              <span className="score-caption">Evidence adequacy</span>
            </div>
            <div
              className="score-ring"
              style={{ "--score": `${gate.score}%` } as React.CSSProperties}
            >
              <ShieldCheck size={26} />
            </div>
          </div>
          <p className="micro">Policy index, not a probability of truth.</p>
          <div className="gate-stats">
            <div>
              <strong>{gate.independentSources}</strong>
              <span>independent sources</span>
            </div>
            <div>
              <strong>
                {gate.coveredParts}/{gate.totalParts}
              </strong>
              <span>claim parts covered</span>
            </div>
          </div>
          <ul className="check-list">
            {gate.checks.map((check) => (
              <li key={check.id}>
                <span className={check.passed ? "check-pass" : "check-gap"}>
                  {check.passed ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          {gate.gaps.length > 0 && (
            <div className="gate-gap">
              <strong>What would help next</strong>
              <ul>
                {gate.gaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="gate-footer">
            <GitBranch size={13} />
            <span>Policy {gate.policyVersion}</span>
          </div>
        </>
      ) : (
        <>
          <ol className="principle-list">
            <li>
              <span>01</span>
              <div>
                <strong>Relevant to the claim</strong>
                <p>Right event, place, time and context.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Independent & traceable</strong>
                <p>Original sources, not repeated stories.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Honest about uncertainty</strong>
                <p>Search again or ask a human when needed.</p>
              </div>
            </li>
          </ol>
          <div className="gate-bottom">
            <span className={busy ? "status-dot pulsing" : "status-dot muted"} />
            {busy
              ? "Waiting for the investigation result"
              : `${evidenceCount} sources in this investigation`}
          </div>
        </>
      )}
    </aside>
  );
}

export function SourceCard({ evidence, index }: { evidence: Evidence; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const safeUrl = /^https?:\/\//i.test(evidence.url);
  const title = evidence.title || "Untitled source";
  return (
    <article className={`source-card source-${evidence.stance}`}>
      <div className="source-number">{String(index + 1).padStart(2, "0")}</div>
      <div className="source-body">
        <div className="source-meta">
          <span>{evidence.publisher || "Publisher not supplied"}</span>
          <span className="meta-dot">·</span>
          <span>{formatDate(evidence.publishedAt)}</span>
          <Tag
            tone={
              evidence.stance === "supports"
                ? "green"
                : evidence.stance === "refutes"
                  ? "red"
                  : "neutral"
            }
          >
            {evidence.stance}
          </Tag>
        </div>
        <h4>
          {safeUrl && evidence.origin !== "demo" ? (
            <a href={evidence.url} target="_blank" rel="noopener noreferrer">
              {title}
              <ExternalLink size={14} />
            </a>
          ) : (
            title
          )}
        </h4>
        <p className="source-excerpt">“{evidence.excerpt}”</p>
        <div className="source-footer">
          <span>
            {evidence.origin === "demo" ? (
              <>
                <Sparkles size={13} /> Synthetic source
              </>
            ) : evidence.verified ? (
              <>
                <CheckCheck size={14} /> Provenance checked
              </>
            ) : (
              <>
                <Info size={14} /> Requires source verification
              </>
            )}
          </span>
          <button
            type="button"
            className="text-button muted-button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? "Hide details" : "Source details"}
            <ChevronDown size={14} className={expanded ? "rotate" : ""} />
          </button>
        </div>
        {expanded && (
          <div className="source-details">
            <dl>
              <div>
                <dt>Source type</dt>
                <dd>{evidence.isPrimary ? "Primary source" : "Secondary source"}</dd>
              </div>
              <div>
                <dt>Origin group</dt>
                <dd>{evidence.independenceKey || "Not supplied"}</dd>
              </div>
              <div>
                <dt>Context match</dt>
                <dd>{evidence.contextMatch ? "Yes" : "Not established"}</dd>
              </div>
              <div>
                <dt>Time match</dt>
                <dd>{evidence.temporalMatch ? "Yes" : "Not established"}</dd>
              </div>
              <div>
                <dt>Retrieved</dt>
                <dd>{formatDate(evidence.retrievedAt, true)}</dd>
              </div>
              <div>
                <dt>Covered claim parts</dt>
                <dd>{evidence.claimParts.length || "None"}</dd>
              </div>
            </dl>
            {evidence.origin !== "demo" && <p className="source-url">{evidence.url}</p>}
          </div>
        )}
      </div>
    </article>
  );
}

/** Advisory wording cues are separate from the factual evidence policy. */
function getCaseSignals(record: CaseRecord) {
  const original = record.originalInput?.text?.trim();
  const sourceLabel = original
    ? record.inputType === "image"
      ? "Submitted caption or context"
      : "Submitted text"
    : "Extracted claim text";
  return {
    ...analyzeMessageSignals(original || record.claim.text),
    source: original ? "submitted_text" : "claim_text",
    sourceLabel,
  };
}

function printReport(record: CaseRecord) {
  const report = window.open("", "_blank");
  if (!report) return false;
  report.opener = null;
  const esc = escapeHtml;
  const advisory = getCaseSignals(record);
  report.document.write(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Evidence AI — ${esc(record.id)}</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#17313c;max-width:850px;margin:50px auto;padding:0 30px}h1{font-size:36px;line-height:1.15}h2{margin-top:35px}small{color:#60737b}article{padding:20px 0;border-bottom:1px solid #d9e1e1}blockquote{border-left:3px solid #168271;margin-left:0;padding-left:20px}a{color:#167665;overflow-wrap:anywhere}.label{letter-spacing:2px;font-size:12px}button{padding:12px 20px;background:#17313c;color:white;border:0;border-radius:8px;cursor:pointer}@media print{button{display:none}body{margin:0;max-width:none}article{break-inside:avoid}}</style></head><body><div class="label">EVIDENCE AI · CCS RESEARCH WORKSPACE</div><h1>Investigation report</h1><small>${esc(record.id)} · ${esc(formatDate(record.updatedAt, true))} · ${esc(record.mode)} mode</small>${record.mode === "demo" ? "<p><strong>Synthetic demonstration. These claims and sources are fictional.</strong></p>" : ""}<h2>Claim</h2><blockquote>${esc(record.claim.text)}</blockquote><h2>${esc(record.finalVerdict || record.verdict || "Unverifiable")}</h2><p>${esc(record.finalVerdict ? "Human-reviewed assessment" : "Preliminary assessment — not human approved")}</p><p>${esc(record.explanation)}</p>${record.gate ? `<h2>Evidence sufficiency</h2><p>${esc(DECISION_LABELS[record.gate.decision])} · Policy index ${record.gate.score}/100. This is not a probability of truth.</p><ul>${record.gate.checks.map((c) => `<li>${esc(c.label)}: ${esc(c.passed ? "Pass" : "Gap")} — ${esc(c.detail)}</li>`).join("")}</ul>` : ""}<h2>Sources</h2>${record.evidence.map((e, i) => `<article><small>${i + 1} · ${esc(e.publisher)} · ${esc(e.stance)} · ${esc(formatDate(e.publishedAt))}</small><h3>${esc(e.title)}</h3><p>${esc(e.excerpt)}</p>${e.origin !== "demo" && /^https?:\/\//i.test(e.url) ? `<a href="${esc(e.url)}" rel="noopener noreferrer">${esc(e.url)}</a>` : "<small>Synthetic source</small>"}</article>`).join("")}<h2>Advisory message cues</h2><p>Scanned: ${esc(advisory.sourceLabel)}. These wording cues are not evidence of falsity and do not affect the verdict or evidence gate.</p>${advisory.signals.length ? `<ul>${advisory.signals.map((signal) => `<li><strong>${esc(signal.label)}</strong> — ${esc(signal.rationale)}<br><small>Excerpt: ${esc(signal.excerpt)}</small></li>`).join("")}</ul>` : "<p>No configured wording cues were detected. This does not establish that the claim is true.</p>"}<h2>Review record</h2>${record.reviews.length ? record.reviews.map((r) => `<article><p><strong>${esc(r.verdict)}</strong> · ${esc(formatDate(r.createdAt, true))}</p><p>${esc(r.reason || r.rationale)}</p></article>`).join("") : "<p>No human review has been recorded.</p>"}<p><small>Keep source dates and context with this report. New evidence may change the assessment.</small></p><button id="print">Print / save PDF</button></body></html>`,
  );
  report.document.close();
  report.document.getElementById("print")?.addEventListener("click", () => report.print());
  return true;
}

export function CaseResult({
  record,
  onAddEvidence,
  onInvestigate,
  onReview,
  onHandoff,
  busy,
  onError,
}: {
  record: CaseRecord;
  onAddEvidence: () => void;
  onInvestigate: () => void;
  onReview: () => void;
  onHandoff: () => void;
  busy: boolean;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<"evidence" | "reasoning" | "activity">("evidence");
  const tabId = useId();
  const advisory = getCaseSignals(record);
  const finalVerdict = record.finalVerdict || record.verdict;
  const pending = record.status === "investigating";
  return (
    <section className="case-result">
      <div className="case-toolbar">
        <div className="case-reference">
          <Fingerprint size={15} />
          <span>CASE {record.id.slice(0, 8).toUpperCase()}</span>
          {record.mode === "demo" && <Tag tone="purple">Synthetic example</Tag>}
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            title="Download case as JSON"
            aria-label="Download case as JSON"
            onClick={() =>
              downloadJson(
                { ...record, advisorySignals: advisory },
                `evidence-ai-${record.id}.json`,
              )
            }
          >
            <ArrowDownToLine size={17} />
          </button>
          <button
            className="icon-button"
            title="Open printable report"
            aria-label="Open printable report"
            onClick={() => {
              if (!printReport(record)) onError("Allow pop-ups to open the printable report.");
            }}
          >
            <Printer size={17} />
          </button>
        </div>
      </div>
      <div className="claim-display">
        <span className="eyebrow">THE CLAIM</span>
        <h2>{record.claim.text}</h2>
        <div className="claim-meta">
          <span>{record.claim.domain}</span>
          <span>·</span>
          <span>{formatDate(record.createdAt, true)}</span>
          <span>·</span>
          <span>
            {record.claim.parts.length} claim {record.claim.parts.length === 1 ? "part" : "parts"}
          </span>
        </div>
      </div>
      <div className={`verdict-banner verdict-${verdictTone(finalVerdict)}`}>
        <div className="verdict-icon">
          {record.finalVerdict ? (
            <BadgeCheck size={27} />
          ) : finalVerdict === "True" ? (
            <CheckCircle2 size={27} />
          ) : finalVerdict === "False" ? (
            <XCircle size={27} />
          ) : (
            <Info size={27} />
          )}
        </div>
        <div>
          <div className="verdict-eyebrow">
            {record.finalVerdict ? "HUMAN-REVIEWED ASSESSMENT" : "PRELIMINARY ASSESSMENT"}
          </div>
          <h3>{pending ? "Investigation in progress" : finalVerdict || "Awaiting evidence"}</h3>
          <p>{record.explanation || "Add source material to assess what the evidence supports."}</p>
        </div>
        {record.finalVerdict && (
          <span className="reviewed-stamp">
            <CheckCheck size={16} />
            Reviewed
          </span>
        )}
      </div>
      {record.mode === "demo" && (
        <p className="demo-note">
          <Sparkles size={14} />
          This is a fictional scenario for evaluating the workflow. It is not a real-world
          fact-check.
        </p>
      )}
      <div
        className="result-navigation"
        role="tablist"
        aria-label="Investigation detail"
        onKeyDown={handleTabKey}
      >
        <button
          role="tab"
          id={`${tabId}-evidence`}
          aria-controls={`${tabId}-panel`}
          tabIndex={tab === "evidence" ? 0 : -1}
          aria-selected={tab === "evidence"}
          className={tab === "evidence" ? "selected" : ""}
          onClick={() => setTab("evidence")}
        >
          Evidence <span>{record.evidence.length}</span>
        </button>
        <button
          role="tab"
          id={`${tabId}-reasoning`}
          aria-controls={`${tabId}-panel`}
          tabIndex={tab === "reasoning" ? 0 : -1}
          aria-selected={tab === "reasoning"}
          className={tab === "reasoning" ? "selected" : ""}
          onClick={() => setTab("reasoning")}
        >
          Assessment notes
        </button>
        <button
          role="tab"
          id={`${tabId}-activity`}
          aria-controls={`${tabId}-panel`}
          tabIndex={tab === "activity" ? 0 : -1}
          aria-selected={tab === "activity"}
          className={tab === "activity" ? "selected" : ""}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
      </div>
      <div
        className="result-panel"
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${tab}`}
        tabIndex={0}
      >
        {tab === "evidence" && (
          <>
            <div className="section-toolbar">
              <p>Follow every assessment back to its source.</p>
              <button
                className="text-button"
                onClick={onAddEvidence}
                disabled={busy || record.mode === "demo" || record.isOwner === false}
              >
                <Plus size={15} /> Add evidence
              </button>
            </div>
            {record.evidence.length ? (
              record.evidence.map((e, i) => <SourceCard key={e.id} evidence={e} index={i} />)
            ) : (
              <EmptyState title="The evidence file is open">
                Add an original source, or run a live investigation when the providers are
                connected.
              </EmptyState>
            )}
          </>
        )}
        {tab === "reasoning" && (
          <div className="reasoning">
            <section className="advisory-signals">
              <div className="advisory-heading">
                <Info size={18} />
                <h3>Message cues to notice</h3>
                <Tag tone="amber">Advisory only</Tag>
              </div>
              <p>
                Scanned: <strong>{advisory.sourceLabel}</strong>. These wording cues are not proof
                of falsity. They do not affect the evidence gate or verdict.
              </p>
              {advisory.signals.length ? (
                <div className="advisory-list">
                  {advisory.signals.map((signal) => (
                    <article key={signal.id}>
                      <strong>{signal.label}</strong>
                      <p>{signal.rationale}</p>
                      <blockquote>“{signal.excerpt}”</blockquote>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="advisory-empty">
                  No configured wording cues were detected. Absence of these cues does not establish
                  that the claim is true.
                </p>
              )}
              <details>
                <summary>Scan scope and limitations</summary>
                <p>
                  {advisory.scannedCharacters.toLocaleString()} characters scanned · Rules{" "}
                  {advisory.rulesVersion}
                  {advisory.truncated ? " · Input truncated to the scan limit" : ""}
                </p>
                <ul>
                  {advisory.limitations.map((limitation, index) => (
                    <li key={index}>{limitation}</li>
                  ))}
                </ul>
              </details>
            </section>
            <h3>Why this route?</h3>
            {record.gate?.reasons.length ? (
              <ul>
                {record.gate.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p>No evidence-sufficiency decision has been recorded yet.</p>
            )}
            <h3>What needs checking</h3>
            {record.gate?.gaps.length ? (
              <ul>
                {record.gate.gaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            ) : (
              <p>
                {record.gate
                  ? "The current policy found no missing checks. The automated assessment remains preliminary."
                  : "Evidence collection has not yet established coverage."}
              </p>
            )}
            {Boolean(record.gate?.suggestedQueries.length) && (
              <>
                <h3>Suggested follow-up searches</h3>
                <div className="query-list">
                  {record.gate!.suggestedQueries.map((query, i) => (
                    <div key={i}>
                      <Search size={14} />
                      <span>{query}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="method-note">
              <Info size={18} />
              <p>
                Source relevance and quality are inputs to a transparent policy. The adequacy index
                is not calibrated confidence, and a search ranking is not proof of truth.
              </p>
            </div>
          </div>
        )}
        {tab === "activity" && (
          <div className="timeline">
            {record.events.length ? (
              record.events.map((event, i) => (
                <div className="timeline-event" key={event.id || i}>
                  <span className="timeline-marker" />
                  <div>
                    <strong>
                      {event.title ||
                        event.message ||
                        event.detail ||
                        (event.type || event.action || "Case updated").replaceAll("_", " ")}
                    </strong>
                    <span>{formatDate(event.createdAt, true)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p>No activity has been recorded yet.</p>
            )}
            {record.reviews.map((review, i) => (
              <div className="timeline-event review-event" key={review.id || `review-${i}`}>
                <span className="timeline-marker">
                  <Check size={11} />
                </span>
                <div>
                  <strong>Human review: {review.verdict}</strong>
                  <p>{review.reason || review.rationale}</p>
                  <span>{formatDate(review.createdAt, true)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="result-actions">
        <span>
          <LockKeyhole size={14} />
          {record.isOwner === false
            ? "Shared for your review"
            : record.reviewRequested
              ? "Submitted to authorised reviewers"
              : "Saved to your workspace"}
        </span>
        <div>
          {record.mode !== "demo" && record.isOwner !== false && (
            <button className="button secondary" onClick={onHandoff} disabled={busy}>
              <UsersRound size={16} />
              {record.reviewRequested ? "Review access" : "Send for review"}
            </button>
          )}
          {record.canReview && (
            <button className="button secondary" onClick={onReview} disabled={busy}>
              <UsersRound size={16} />
              Review assessment
            </button>
          )}
          {record.isOwner !== false && (
            <button
              className="button primary"
              onClick={onInvestigate}
              disabled={busy || record.mode === "demo" || pending}
            >
              {busy ? <span className="spinner" /> : <Search size={16} />}Reassess evidence
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  error,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onClose: () => void;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-shell">
        <div className="modal-header">
          <div>
            <h2 id={headingId}>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <Info size={17} />
            <span>{error}</span>
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}

export function EvidenceForm({
  record,
  busy,
  onSubmit,
  onClose,
  error,
}: {
  record: CaseRecord;
  busy: boolean;
  error?: string;
  onSubmit: (
    evidence: Omit<Evidence, "id" | "retrievedAt" | "origin" | "verified">,
    attested: boolean,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<string[]>([]);
  const [attested, setAttested] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [corpusQuery, setCorpusQuery] = useState(record.claim.text.slice(0, 300));
  const [corpusBusy, setCorpusBusy] = useState(false);
  const [corpusError, setCorpusError] = useState("");
  const [corpusResults, setCorpusResults] = useState<{
    matches: import("@/lib/domain").RetrievalMatch[];
    totalArticles: number;
    method: string;
  } | null>(null);
  async function searchCorpus() {
    if (!corpusQuery.trim()) return;
    setCorpusBusy(true);
    setCorpusError("");
    try {
      setCorpusResults(
        await api(`/api/corpus/search?q=${encodeURIComponent(corpusQuery.trim().slice(0, 300))}`),
      );
    } catch (error) {
      setCorpusError(error instanceof Error ? error.message : "Corpus search failed.");
    } finally {
      setCorpusBusy(false);
    }
  }
  function chooseCorpusArticle(article: import("@/lib/domain").CorpusArticle) {
    const form = formRef.current;
    if (!form) return;
    const values: Record<string, string> = {
      title: article.title,
      url: article.url,
      publisher: article.site,
      date: article.date?.slice(0, 10) || "",
      excerpt: `${article.primaryClaim}\n\n${article.content.slice(0, 6000)}`,
      independenceKey: "",
      stance: "unclear",
      relevance: "0.8",
      quality: "0.6",
    };
    for (const [name, value] of Object.entries(values)) {
      const input = form.elements.namedItem(name) as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null;
      if (input) input.value = value;
    }
    for (const name of ["context", "temporal", "primary"]) {
      const input = form.elements.namedItem(name) as HTMLInputElement | null;
      if (input) input.checked = false;
    }
    setParts([]);
    setAttested(false);
    (form.elements.namedItem("excerpt") as HTMLTextAreaElement | null)?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSubmit(
      {
        title: String(form.get("title")),
        url: String(form.get("url")),
        publisher: String(form.get("publisher")),
        publishedAt: String(form.get("date")) || null,
        excerpt: String(form.get("excerpt")),
        stance: String(form.get("stance")) as Evidence["stance"],
        relevance: Number(form.get("relevance")),
        quality: Number(form.get("quality")),
        independenceKey: String(form.get("independenceKey") || "").trim(),
        claimParts: parts,
        contextMatch: form.has("context"),
        temporalMatch: form.has("temporal"),
        isPrimary: form.has("primary"),
      },
      attested,
    );
  }
  return (
    <Modal
      title="Add source evidence"
      subtitle="Keep the original wording and explain how it relates to the claim."
      onClose={onClose}
      error={error}
    >
      <form className="evidence-form" ref={formRef} onSubmit={submit}>
        <details className="corpus-lookup">
          <summary>
            <Search size={16} />
            Find a previous fact-check
            <ChevronDown size={15} />
          </summary>
          <div className="corpus-search-row">
            <input
              aria-label="Search historical fact-check corpus"
              value={corpusQuery}
              onChange={(e) => setCorpusQuery(e.target.value)}
              maxLength={300}
            />
            <button
              type="button"
              className="button secondary"
              onClick={searchCorpus}
              disabled={corpusBusy || !corpusQuery.trim()}
            >
              {corpusBusy ? <span className="spinner" /> : <Search size={15} />}Search
            </button>
          </div>
          <p>
            Search the imported archive. A historical match still needs its date, context and source
            checked.
          </p>
          {corpusError && (
            <p className="corpus-error" role="alert">
              {corpusError}
            </p>
          )}
          {corpusResults && (
            <div className="corpus-results">
              <span>
                {corpusResults.totalArticles.toLocaleString()} articles available ·{" "}
                {corpusResults.method} retrieval
              </span>
              {corpusResults.matches.length ? (
                corpusResults.matches.slice(0, 5).map((match) => (
                  <article key={match.article.articleId}>
                    <small>
                      {match.article.site} · {formatDate(match.article.date)}
                    </small>
                    <strong>{match.article.title}</strong>
                    <p>{match.article.primaryClaim}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => chooseCorpusArticle(match.article)}
                    >
                      Use as source
                      <ArrowRight size={14} />
                    </button>
                  </article>
                ))
              ) : (
                <p>
                  {corpusResults.totalArticles === 0
                    ? "No archive has been imported yet. Add a source manually below, or use the documented corpus-import workflow."
                    : "No relevant past fact-check was found. Try different keywords or add a source manually."}
                </p>
              )}
            </div>
          )}
        </details>
        <label>
          Source title
          <input
            name="title"
            required
            maxLength={300}
            placeholder="Title of the article or original document"
            autoFocus
          />
        </label>
        <label>
          Source URL
          <input
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://…"
            pattern="https?://.+"
          />
        </label>
        <div className="form-grid">
          <label>
            Publisher
            <input name="publisher" required maxLength={200} placeholder="Organisation or author" />
          </label>
          <label>
            Publication date
            <input name="date" type="date" max={new Date().toISOString().slice(0, 10)} />
          </label>
        </div>
        <label>
          Relevant excerpt
          <textarea
            name="excerpt"
            required
            minLength={20}
            maxLength={10000}
            rows={4}
            placeholder="Paste the passage that directly addresses the claim."
          />
        </label>
        <div className="form-grid">
          <label>
            Relationship to claim
            <select name="stance">
              <option value="supports">Supports the claim</option>
              <option value="refutes">Refutes the claim</option>
              <option value="context">Adds context</option>
              <option value="unclear">Unclear</option>
            </select>
          </label>
          <label>
            Original source group
            <input
              name="independenceKey"
              maxLength={300}
              placeholder="Known original publisher or wire story"
            />
            <small>Leave blank if origin is unknown; copying sites are not independent.</small>
          </label>
        </div>
        <fieldset>
          <legend>Which parts does this source address?</legend>
          {record.claim.parts.map((part, i) => (
            <label className="checkbox-label" key={i}>
              <input
                type="checkbox"
                checked={parts.includes(part)}
                onChange={(e) =>
                  setParts(e.target.checked ? [...parts, part] : parts.filter((p) => p !== part))
                }
              />
              <span>{part}</span>
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <label>
            Relevance assessment
            <select name="relevance" defaultValue="0.8">
              <option value="0.4">Indirect (0.4)</option>
              <option value="0.8">Directly relevant (0.8)</option>
              <option value="1">Exact claim coverage (1.0)</option>
            </select>
          </label>
          <label>
            Source quality assessment
            <select name="quality" defaultValue="0.6">
              <option value="0.3">Not established (0.3)</option>
              <option value="0.6">Traceable, needs corroboration (0.6)</option>
              <option value="0.9">Strong original evidence (0.9)</option>
            </select>
          </label>
        </div>
        <fieldset className="check-options">
          <legend>Context checks</legend>
          <label className="checkbox-label">
            <input name="context" type="checkbox" />
            <span>The source applies to the correct people, place and event.</span>
          </label>
          <label className="checkbox-label">
            <input name="temporal" type="checkbox" />
            <span>The source is applicable to the claim’s time period.</span>
          </label>
          <label className="checkbox-label">
            <input name="primary" type="checkbox" />
            <span>This is a primary source or original record.</span>
          </label>
        </fieldset>
        <label className="checkbox-label attestation">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
          />
          <span>
            Optional: I inspected the original source and preserved its meaning. Only an authorised
            reviewer’s attestation marks it verified; leaving this unchecked saves the source as
            unverified.
          </span>
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Plus size={16} />}Save evidence
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ReviewForm({
  record,
  busy,
  onSubmit,
  onClose,
  error,
}: {
  record: CaseRecord;
  busy: boolean;
  error?: string;
  onSubmit: (payload: {
    decision: string;
    verdict: Verdict;
    reason: string;
    evidenceIds: string[];
    overrideConfirmed: boolean;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [decision, setDecision] = useState("approve");
  const [verdict, setVerdict] = useState<Verdict>(record.verdict || "Unverifiable");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const needsOverride =
    decision !== "request_evidence" &&
    (record.gate?.decision !== "proceed" || verdict !== record.verdict);
  const minimumReason = needsOverride ? 40 : 20;
  return (
    <Modal
      title="Record your judgment"
      subtitle="Your decision and explanation become part of this case’s audit history."
      onClose={onClose}
      error={error}
    >
      <form
        className="evidence-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit({
            decision,
            verdict,
            reason: reason.trim(),
            evidenceIds: selectedEvidence,
            overrideConfirmed,
          });
        }}
      >
        {record.mode === "demo" && (
          <div className="inline-notice">
            <Sparkles size={17} />
            <span>You are reviewing a synthetic training example.</span>
          </div>
        )}
        <div className="review-claim">{record.claim.text}</div>
        <label>
          Review decision
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="approve">Approve the assessment</option>
            <option value="revise">Revise the assessment</option>
            <option value="request_evidence">Request further evidence</option>
          </select>
        </label>
        <label>
          Verdict
          <select
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as Verdict)}
            disabled={decision === "request_evidence"}
          >
            {["True", "False", "Misleading", "Unverifiable"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Reason for your decision
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={minimumReason}
            maxLength={5000}
            required
            rows={5}
            placeholder="Explain which evidence supports your decision and any uncertainty that remains."
          />
        </label>
        {decision !== "request_evidence" && (
          <fieldset>
            <legend>Sources inspected for this decision</legend>
            {record.evidence.length ? (
              record.evidence.map((source) => (
                <label className="checkbox-label" key={source.id}>
                  <input
                    type="checkbox"
                    checked={selectedEvidence.includes(source.id)}
                    onChange={(e) =>
                      setSelectedEvidence(
                        e.target.checked
                          ? [...selectedEvidence, source.id]
                          : selectedEvidence.filter((id) => id !== source.id),
                      )
                    }
                  />
                  <span>
                    {source.title}
                    <small className="review-source-origin">
                      {source.publisher} · {source.stance}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p className="review-empty-note">
                No evidence is attached. The only available final verdict is Unverifiable.
              </p>
            )}
          </fieldset>
        )}
        {needsOverride && (
          <label className="checkbox-label attestation override-attestation">
            <input
              type="checkbox"
              checked={overrideConfirmed}
              onChange={(e) => setOverrideConfirmed(e.target.checked)}
              required
            />
            <span>
              I understand this decision overrides the automated route or verdict. My reason
              explains why this judgment is justified (at least 40 characters).
            </span>
          </label>
        )}
        <label className="checkbox-label attestation">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
          />
          <span>
            I reviewed the claim, relevant evidence and limitations. This decision should be
            attributed to my signed-in identity.
          </span>
        </label>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              !confirmed ||
              reason.trim().length < minimumReason ||
              (needsOverride && !overrideConfirmed) ||
              (decision !== "request_evidence" &&
                verdict !== "Unverifiable" &&
                selectedEvidence.length === 0)
            }
          >
            {busy ? <span className="spinner" /> : <BadgeCheck size={17} />}Record decision
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MethodView({
  version,
  canImportCorpus = false,
  totalArticles = 0,
  onCorpusImported,
}: {
  version: string;
  canImportCorpus?: boolean;
  totalArticles?: number;
  onCorpusImported: () => void | Promise<void>;
}) {
  return (
    <div className="method-view">
      <div className="page-intro">
        <span className="eyebrow">A TRANSPARENT METHOD</span>
        <h1>
          Show the evidence.
          <br />
          <span>Keep the uncertainty.</span>
        </h1>
        <p>
          The workflow separates retrieval, evidence sufficiency, assessment and accountable human
          judgment.
        </p>
      </div>
      <div className="method-flow">
        <div>
          <Search />
          <span>01</span>
          <h3>Find</h3>
          <p>Extract the claim and retrieve relevant original sources.</p>
        </div>
        <ArrowRight className="flow-arrow" />
        <div>
          <ListChecks />
          <span>02</span>
          <h3>Weigh</h3>
          <p>Check coverage, context, provenance and independence.</p>
        </div>
        <ArrowRight className="flow-arrow" />
        <div>
          <GitBranch />
          <span>03</span>
          <h3>Route</h3>
          <p>Proceed, request more evidence, or ask a human reviewer.</p>
        </div>
        <ArrowRight className="flow-arrow" />
        <div>
          <BadgeCheck />
          <span>04</span>
          <h3>Explain</h3>
          <p>Keep the assessment, sources and review history together.</p>
        </div>
      </div>
      <div className="method-columns">
        <section>
          <div className="section-kicker">
            <ShieldCheck size={19} />
            Evidence sufficiency · Step 9
          </div>
          <h2>Enough evidence to make a judgment.</h2>
          <p>
            Strong evidence against a claim can be sufficient. Several sites repeating one report
            are not several independent sources. A correct fact about a different date or place may
            still fail the context check.
          </p>
          <ul className="method-bullets">
            <li>
              <CheckCircle2 />
              Coverage of every atomic claim
            </li>
            <li>
              <CheckCircle2 />
              Traceable and applicable source excerpts
            </li>
            <li>
              <CheckCircle2 />
              Independent corroboration
            </li>
            <li>
              <CheckCircle2 />
              Time relevance and unresolved conflicts
            </li>
          </ul>
          <p className="method-version">
            Current policy: <strong>{version}</strong>. The adequacy index is a transparent
            heuristic, not a calibrated probability.
          </p>
        </section>
        <section>
          <div className="section-kicker">
            <UsersRound size={19} />
            Human review · Step 13
          </div>
          <h2>Clear ownership of the final call.</h2>
          <p>
            Automated results remain preliminary. Authorised reviewers can approve, revise or
            request evidence. Each decision retains the reviewer identity, time, rationale and case
            version.
          </p>
          <div className="method-callout">
            <Fingerprint size={22} />
            <p>
              Uncertainty is a valid outcome. “Unverifiable” is never silently converted to “False.”
            </p>
          </div>
          <a
            className="text-button"
            href="https://github.com/vishnusrivardhangollakaram-boop/2511202_CCS_IIMB"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the project documentation
            <ExternalLink size={15} />
          </a>
        </section>
      </div>
      <section className="evaluation-section">
        <div>
          <span className="eyebrow">EVALUATION, WITHOUT SHORTCUTS</span>
          <h2>Test the decision, not just the verdict.</h2>
          <p>
            The project includes synthetic policy scenarios and automated tests. These check
            workflow behaviour; they do not establish real-world fact-checking accuracy.
          </p>
        </div>
        <div className="evaluation-table">
          <div>
            <strong>Policy correctness</strong>
            <span>Missing coverage, duplicate sources, temporal mismatch and conflicts.</span>
          </div>
          <div>
            <strong>Decision safety</strong>
            <span>Insufficient evidence routes to further investigation or review.</span>
          </div>
          <div>
            <strong>Operational integrity</strong>
            <span>Access checks, version conflicts, errors and durable audit records.</span>
          </div>
          <div>
            <strong>Research validation</strong>
            <span>Expert-labelled evaluation and confidence calibration remain separate work.</span>
          </div>
        </div>
      </section>
      {canImportCorpus && (
        <CorpusImport totalArticles={totalArticles} onImported={onCorpusImported} />
      )}
    </div>
  );
}

export function HandoffForm({
  record,
  busy,
  onSubmit,
  onClose,
  error,
}: {
  record: CaseRecord;
  busy: boolean;
  error?: string;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Modal
      title={record.reviewRequested ? "Withdraw reviewer access" : "Send this case for review"}
      subtitle={
        record.reviewRequested
          ? "This removes the shared case from reviewer access. Existing review records remain in your audit history."
          : "Give an authorised reviewer the context needed to make a judgment."
      }
      onClose={onClose}
      error={error}
    >
      <form
        className="evidence-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit(reason.trim());
        }}
      >
        <div className="review-claim">{record.claim.text}</div>
        <label>
          What needs a reviewer’s attention?
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={20}
            maxLength={5000}
            required
            rows={5}
            autoFocus
            placeholder="Describe the uncertainty, conflicting evidence or decision you need reviewed."
          />
        </label>
        <label className="checkbox-label attestation">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            {record.reviewRequested
              ? "Withdraw access to this claim, evidence and history from the shared review workspace."
              : "Share this claim, its evidence and case history with authorised reviewers. This makes the case available in their review queue."}
          </span>
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !confirmed || reason.trim().length < 20}
          >
            {busy ? <span className="spinner" /> : <UsersRound size={17} />}{" "}
            {record.reviewRequested ? "Withdraw access" : "Send for review"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
