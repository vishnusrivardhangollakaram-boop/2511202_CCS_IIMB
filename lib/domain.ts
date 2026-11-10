/** Shared, serialisable contracts for the CCS evidence workflow. */
export type Verdict = "True" | "False" | "Misleading" | "Unverifiable";
export type GateDecision = "proceed" | "retrieve_more" | "human_review";
export type EvidenceStance = "supports" | "refutes" | "context" | "unclear";
export type EvidenceOrigin = "demo" | "manual" | "web" | "corpus";

export interface Claim {
  text: string;
  /** Atomic propositions. Evidence coverage refers to these exact strings. */
  parts: string[];
  timeSensitive: boolean;
  domain: string;
  /** Maximum source age for a current-events claim; defaults to 30 days. */
  timeWindowDays?: number;
}

export interface Evidence {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  retrievedAt: string;
  excerpt: string;
  stance: EvidenceStance;
  /** Upstream relevance and source-quality estimates in [0, 1]. */
  relevance: number;
  quality: number;
  /** Common original-source / syndication identifier, where known. */
  independenceKey: string;
  claimParts: string[];
  /** Applicability, not agreement: correctly dated refutations may pass. */
  contextMatch: boolean;
  temporalMatch: boolean;
  /** An authenticated old original directly disproves a newer date/context. */
  historicalRefutation?: boolean;
  isPrimary: boolean;
  origin: EvidenceOrigin;
  /** The excerpt/provenance was checked; a search snippet is not verified. */
  verified: boolean;
}

export interface GateCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface GateResult {
  decision: GateDecision;
  /** Transparent policy index [0, 100]. NOT a calibrated probability. */
  score: number;
  checks: GateCheck[];
  reasons: string[];
  gaps: string[];
  suggestedQueries: string[];
  independentSources: number;
  coveredParts: number;
  totalParts: number;
  eligibleEvidenceIds: string[];
  policyVersion: string;
}

export interface GateOptions {
  /** Number of completed retrieval attempts, including the initial one. */
  attempt?: number;
  maxAttempts?: number;
  now?: Date | string;
}

export interface VerdictAssessment {
  verdict: Verdict;
  explanation: string;
  evidenceIds: string[];
  /** All automatic outcomes remain preliminary until explicitly reviewed. */
  preliminary: true;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  label: "Synthetic example";
  category: string;
  claim: Claim;
  evidence: Evidence[];
  expectedDecision: GateDecision;
  expectedVerdict: Verdict;
  /** A fixed evaluation clock keeps these fictional fixtures reproducible. */
  evaluationDate: string;
}

export interface CorpusArticle {
  articleId: string;
  title: string;
  url: string;
  site: string;
  date: string | null;
  primaryClaim: string;
  content: string;
  /** Display label retained from ingestion; never assume it is a live verdict. */
  verdict: string;
  sourceVerdict?: string;
  normalizedVerdict?: string;
  llmVerdict?: string;
  trueVersion?: string;
  domain?: string;
  /** Optional embedding produced by the same model as the query vector. */
  embedding?: number[];
  embeddingModel?: string;
}

export interface RetrievalMatch {
  article: CorpusArticle;
  /** Search ranking score, not a truth or confidence score. */
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  method: "lexical" | "hybrid";
}

/** Trim whitespace and make comparison independent of case and Unicode width. */
export function normaliseText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
