import { env } from "cloudflare:workers";
import type { Claim, Evidence, Verdict } from "@/lib/domain";
import type { WorkspaceUser } from "@/lib/auth";
import { ApiError, boundedString, objectBody, optionalString, publicHttpsUrl } from "@/lib/http";
import { assessVerdict, evaluateSufficiency } from "@/lib/sufficiency";
import { investigateClaim, providerCapabilities } from "@/lib/providers";
import type { ProviderEnv } from "@/lib/providers";
import {
  assertFrozenClaim,
  mergeEvidence,
  newEvent,
  saveCase,
  type InvestigationCase,
} from "@/lib/store";

export const MAX_ATTEMPTS = 3;
export const environment = env as typeof env & ProviderEnv & { REVIEWER_IDS?: string };
export type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export function caseState(
  record: InvestigationCase,
  evidence = record.evidence,
): InvestigationCase {
  const gate = evaluateSufficiency(record.claim, evidence, {
    attempt: record.attempt,
    maxAttempts: MAX_ATTEMPTS,
    now: record.evaluationDate || new Date(),
  });
  const result = assessVerdict(record.claim, evidence, gate);
  return {
    ...record,
    evidence,
    gate,
    verdict: result.verdict,
    explanation: result.explanation,
    status: record.reviewRequested
      ? "human_review"
      : gate.decision === "proceed"
        ? "ready"
        : gate.decision === "human_review"
          ? "human_review"
          : "needs_evidence",
    reviewStatus: record.reviewRequested ? "pending" : "none",
    preliminary: true,
    finalVerdict: null,
  };
}

export function verdictInput(value: unknown): Verdict {
  if (!["True", "False", "Misleading", "Unverifiable"].includes(String(value)))
    throw new ApiError(400, "invalid_verdict", "Choose True, False, Misleading or Unverifiable.");
  return value as Verdict;
}

function score(value: unknown, field: string): number {
  if (value === undefined) return 0.3;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new ApiError(400, "invalid_score", `${field} must be between 0 and 1.`);
  return value;
}

/** Human assertions are visible as manual provenance; they are never promoted silently. */
export function manualEvidence(value: unknown, claim: Claim, verified: boolean): Evidence {
  const item = objectBody(value);
  const url = publicHttpsUrl(item.url);
  const stance = optionalString(item.stance, "Stance", 20) || "unclear";
  if (!["supports", "refutes", "context", "unclear"].includes(stance))
    throw new ApiError(400, "invalid_stance", "Choose a valid evidence stance.");
  const publishedAt = optionalString(item.publishedAt, "Publication date", 40) || null;
  if (
    publishedAt &&
    (!Number.isFinite(Date.parse(publishedAt)) || Date.parse(publishedAt) > Date.now() + 300_000)
  )
    throw new ApiError(
      400,
      "invalid_date",
      "Publication date must be valid and cannot be in the future.",
    );
  let parts: string[] = [];
  if (item.claimParts !== undefined) {
    if (!Array.isArray(item.claimParts) || item.claimParts.length > 20)
      throw new ApiError(
        400,
        "invalid_claim_parts",
        "Choose the claim parts addressed by this source.",
      );
    parts = item.claimParts.map((part) => boundedString(part, "Claim part", 1, 2000));
    if (parts.some((part) => !claim.parts.includes(part)))
      throw new ApiError(
        400,
        "invalid_claim_parts",
        "Evidence must refer to a claim part in this investigation.",
      );
  }
  return {
    id: crypto.randomUUID(),
    title: boundedString(item.title, "Source title", 3, 500),
    url,
    publisher: optionalString(item.publisher, "Publisher", 200) || new URL(url).hostname,
    publishedAt,
    retrievedAt: new Date().toISOString(),
    excerpt: boundedString(item.excerpt, "Evidence excerpt", 20, 12_000),
    stance: stance as Evidence["stance"],
    relevance: score(item.relevance, "Relevance"),
    quality: score(item.quality, "Quality"),
    independenceKey: optionalString(item.independenceKey, "Original source family", 200) || "",
    claimParts: parts,
    contextMatch: item.contextMatch === true,
    temporalMatch: item.temporalMatch === true,
    isPrimary: item.isPrimary === true,
    historicalRefutation: verified && item.historicalRefutation === true,
    origin: "manual",
    verified,
  };
}

/** One persisted lock surrounds an external call. Provider failures never create a verdict. */
export async function runInvestigation(
  db: D1Database,
  record: InvestigationCase,
  user: WorkspaceUser,
  imageData?: string,
): Promise<InvestigationCase> {
  if (!providerCapabilities(environment).live)
    throw new ApiError(
      503,
      "providers_not_configured",
      "Live investigation requires configured search and model services. You can add evidence manually or run a synthetic example.",
    );
  if (record.attempt >= MAX_ATTEMPTS)
    throw new ApiError(
      409,
      "search_budget_exhausted",
      "This case has reached its search limit. Add evidence or request human review.",
    );
  const running = await saveCase(
    db,
    record,
    { ...record, status: "investigating", finalVerdict: null, preliminary: true },
    user,
    newEvent(
      user,
      "investigation_started",
      "Live investigation started",
      "Searching current sources and checking the evidence package.",
    ),
  );
  try {
    const output = await investigateClaim(
      {
        claim: running.claim,
        inputType: imageData ? "image" : running.inputType === "image" ? "text" : running.inputType,
        url: running.originalInput.url,
        imageData,
        attempt: running.attempt + 1,
      },
      environment,
    );
    if (running.attempt > 0) assertFrozenClaim(running.claim, output.claim);
    const merged = mergeEvidence(running.evidence, output.evidence);
    const warnings = [...new Set([...running.warnings, ...output.warnings])];
    if (merged.omitted)
      warnings.push(
        `${merged.omitted} additional source records were not added because this case reached its 50-source limit. Existing evidence and attestations were preserved.`,
      );
    const next = caseState(
      {
        ...running,
        claim: running.attempt > 0 ? running.claim : output.claim,
        attempt: running.attempt + 1,
        warnings: warnings.slice(-20),
      },
      merged.evidence,
    );
    return await saveCase(
      db,
      running,
      next,
      user,
      newEvent(
        user,
        "investigation_completed",
        "Live evidence assessed",
        `${merged.added} new source records added; ${merged.duplicates} exact duplicates skipped; ${merged.omitted} records excluded by the source limit. ${output.trace
          .map((entry) => `${entry.stage}: ${entry.detail}`)
          .join(" · ")
          .slice(0, 1500)}`,
      ),
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "version_conflict") throw error;
    // Do not persist or return the provider error body: it can contain input or credentials.
    return saveCase(
      db,
      running,
      {
        ...running,
        status: "failed",
        warnings: [
          "The live provider did not complete. No new factual conclusion was made. Retry later or add evidence for review.",
        ],
      },
      user,
      newEvent(
        user,
        "investigation_failed",
        "Investigation interrupted",
        "A provider failed or returned unusable evidence. The attempt did not count as a successful evidence search.",
      ),
    );
  }
}
