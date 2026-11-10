/** Browser presentation contracts extend the shared evidence policy types. */
export type { Claim, Evidence, Verdict, GateResult as Gate } from "@/lib/domain";
import type { Claim, Evidence, Verdict, GateResult } from "@/lib/domain";
export type View = "investigate" | "library" | "review" | "method";
export type Mode = "manual" | "live" | "demo";
export interface Review {
  id?: string;
  verdict: Verdict;
  decision?: string;
  reason?: string;
  rationale?: string;
  actor?: string;
  createdAt: string;
}
export interface CaseEvent {
  id?: string;
  type?: string;
  action?: string;
  message?: string;
  title?: string;
  detail?: string;
  createdAt: string;
}
export interface CaseRecord {
  id: string;
  claim: Claim;
  originalInput?: { text: string; url?: string };
  mode: Mode;
  inputType: string;
  status: string;
  gate: GateResult | null;
  verdict: Verdict | null;
  explanation: string;
  evidence: Evidence[];
  preliminary: boolean;
  events: CaseEvent[];
  reviews: Review[];
  createdAt: string;
  updatedAt: string;
  attempt: number;
  version: number;
  isOwner?: boolean;
  reviewRequested?: boolean;
  reviewStatus?: "none" | "pending" | "completed";
  handoffReason?: string | null;
  summary?: boolean;
  evidenceCount?: number;
  reviewCount?: number;
  finalVerdict: Verdict | null;
  canReview: boolean;
}
export interface Scenario {
  id: string;
  title: string;
  description: string;
  claim: Claim | string;
}
export interface Bootstrap {
  user: {
    id: string;
    displayName: string;
    email: string;
    canReview: boolean;
    local: boolean;
  } | null;
  capabilities: {
    live: boolean;
    image: boolean;
    ocr: boolean;
    search: boolean;
    corpus: boolean;
    canReview: boolean;
    review: boolean;
    reason?: string;
    corpusImport: boolean;
  };
  scenarios: Scenario[];
  policy: { version: string; maxAttempts: number; totalArticles: number };
}
