import type { Claim, Evidence, GateOptions, GateResult, VerdictAssessment } from "./domain";
import { normaliseText } from "./domain";

/** Versioned, inspectable baseline policy; validate it for each deployment domain. */
export const POLICY_VERSION = "ccs-sufficiency-1.0.1";
const MIN_RELEVANCE = 0.65;
const MIN_QUALITY = 0.65;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Use explicit atomic claims; a nonempty text is the fallback proposition. */
export function claimParts(claim: Claim): string[] {
  const seen = new Set<string>();
  return (claim.parts.length ? claim.parts : [claim.text]).filter((part) => {
    const key = normaliseText(part);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreInRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function sourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (
      !url.hostname.includes(".") ||
      url.hostname === "localhost" ||
      /^[\d.]+$/.test(url.hostname) ||
      url.hostname.includes(":") ||
      /\.(localhost|local|internal|test)$/.test(url.hostname)
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function currentEvidence(item: Evidence, claim: Claim, now: number): boolean {
  const retrieved = Date.parse(item.retrievedAt);
  const published = item.publishedAt ? Date.parse(item.publishedAt) : null;
  if (!Number.isFinite(retrieved) || retrieved > now + CLOCK_SKEW_MS) return false;
  if (published !== null && (!Number.isFinite(published) || published > now + CLOCK_SKEW_MS))
    return false;
  if (published !== null && published > retrieved + CLOCK_SKEW_MS) return false;
  if (!item.temporalMatch) return false;
  if (!claim.timeSensitive) return true;
  if (published === null) return false;
  // A correctly authenticated old original can refute a new recycled caption.
  // This explicit exception does not let stale supporting reports validate news.
  if (
    item.historicalRefutation &&
    item.stance === "refutes" &&
    item.isPrimary &&
    item.quality >= 0.9 &&
    item.relevance >= 0.9
  )
    return true;
  const window = Number.isFinite(claim.timeWindowDays)
    ? Math.max(1, Math.min(3650, claim.timeWindowDays!))
    : 30;
  return now - published <= window * DAY_MS && now - retrieved <= window * DAY_MS;
}

function applicableParts(item: Evidence, parts: string[]): Set<string> {
  const declared = new Set(item.claimParts.map(normaliseText));
  return new Set(parts.map(normaliseText).filter((part) => declared.has(part)));
}

function excerptTokens(item: Evidence): Set<string> {
  return new Set(normaliseText(item.excerpt).match(/[\p{L}\p{N}]+/gu) ?? []);
}

function copiedExcerpt(left: Evidence, right: Evidence): boolean {
  const a = excerptTokens(left);
  const b = excerptTokens(right);
  // Very short factual statements are often identical without being copied.
  if (Math.min(a.size, b.size) < 15) return false;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection) >= 0.85;
}

/** Count source families, collapsing URL duplicates, publishers and syndication. */
export function independentSourceCount(evidence: Evidence[]): number {
  const parents = evidence.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  for (let i = 0; i < evidence.length; i++) {
    for (let j = i + 1; j < evidence.length; j++) {
      const a = evidence[i];
      const b = evidence[j];
      const sameOrigin =
        !!normaliseText(a.independenceKey) &&
        normaliseText(a.independenceKey) === normaliseText(b.independenceKey);
      const samePublisher =
        !!normaliseText(a.publisher) && normaliseText(a.publisher) === normaliseText(b.publisher);
      const aUrl = sourceUrl(a.url);
      const sameUrl = aUrl !== null && aUrl === sourceUrl(b.url);
      if (sameOrigin || samePublisher || sameUrl || copiedExcerpt(a, b)) parents[find(j)] = find(i);
    }
  }
  // Unknown provenance cannot create an independent family merely by URL count.
  return new Set(
    parents
      .map((_, index) => index)
      .filter((index) => normaliseText(evidence[index].independenceKey))
      .map(find),
  ).size;
}

/**
 * Decide whether a supplied evidence package can support an assessment.
 * This deterministic gate does not authenticate sources or establish truth itself.
 * Upstream relevance, stance, quality and verification assertions must be audited.
 */
export function evaluateSufficiency(
  claim: Claim,
  evidence: Evidence[],
  options: GateOptions = {},
): GateResult {
  const clock =
    options.now instanceof Date
      ? options.now.getTime()
      : options.now
        ? Date.parse(options.now)
        : Date.now();
  if (!Number.isFinite(clock)) throw new Error("A valid evaluation timestamp is required.");
  const parts = claimParts(claim);
  const unique = [...new Map(evidence.map((item) => [item.id, item])).values()];
  const relevant = unique.filter(
    (item) =>
      scoreInRange(item.relevance) &&
      item.relevance >= MIN_RELEVANCE &&
      applicableParts(item, parts).size > 0,
  );
  const verified = relevant.filter(
    (item) =>
      item.verified &&
      scoreInRange(item.quality) &&
      item.quality >= MIN_QUALITY &&
      !!sourceUrl(item.url) &&
      item.excerpt.trim().length >= 20 &&
      item.publisher.trim().length > 0,
  );
  const eligible = verified.filter(
    (item) =>
      item.contextMatch &&
      currentEvidence(item, claim, clock) &&
      ["supports", "refutes"].includes(item.stance),
  );
  const covered = new Set(eligible.flatMap((item) => [...applicableParts(item, parts)]));
  const independentSources = independentSourceCount(eligible);
  const decisivePrimary = eligible.some(
    (item) =>
      item.isPrimary &&
      item.quality >= 0.9 &&
      item.relevance >= 0.9 &&
      applicableParts(item, parts).size === parts.length,
  );
  const conflictingParts = parts.filter((part) => {
    const key = normaliseText(part);
    const direct = eligible.filter((item) => applicableParts(item, parts).has(key));
    return (
      direct.some((item) => item.stance === "supports") &&
      direct.some((item) => item.stance === "refutes")
    );
  });
  const missingParts = parts.filter((part) => !covered.has(normaliseText(part)));
  const complete = parts.length > 0 && claim.text.trim().length > 0 && missingParts.length === 0;
  const sufficientlyIndependent =
    parts.length > 0 &&
    parts.every((part) => {
      const matching = eligible.filter((item) =>
        applicableParts(item, parts).has(normaliseText(part)),
      );
      return (
        independentSourceCount(matching) >= 2 ||
        matching.some((item) => item.isPrimary && item.quality >= 0.9 && item.relevance >= 0.9)
      );
    });
  const checks = [
    {
      id: "relevance",
      label: "Relevant evidence",
      passed: relevant.length > 0,
      detail: `${relevant.length} item(s) address at least one stated claim part at relevance ≥ ${MIN_RELEVANCE}.`,
    },
    {
      id: "provenance",
      label: "Checked sources",
      passed: verified.length > 0,
      detail: `${verified.length} item(s) have checked provenance, a usable excerpt and quality ≥ ${MIN_QUALITY}; search snippets alone do not qualify.`,
    },
    {
      id: "context",
      label: "Context and freshness",
      passed: eligible.length > 0,
      detail: `${eligible.length} direct item(s) match context and time. ${verified.length - eligible.length} checked item(s) are contextual, stale, mistimed or inapplicable.`,
    },
    {
      id: "coverage",
      label: "Claim coverage",
      passed: complete,
      detail: `${covered.size} of ${parts.length} atomic claim part(s) have applicable direct evidence.`,
    },
    {
      id: "independence",
      label: "Source independence",
      passed: sufficientlyIndependent,
      detail:
        decisivePrimary && independentSources < 2
          ? "One checked, high-quality primary record directly covers the full claim; the single-primary exception is recorded."
          : `${independentSources} independent source family/families after duplicate and syndication checks. Each claim part needs two families or a checked high-quality primary record.`,
    },
    {
      id: "consistency",
      label: "Unresolved contradictions",
      passed: eligible.length > 0 && conflictingParts.length === 0,
      detail: !eligible.length
        ? "No qualifying direct evidence is available to check for contradictions."
        : conflictingParts.length
          ? `${conflictingParts.length} claim part(s) have conflicting eligible evidence and require review.`
          : "No conflicting eligible stances were found for the same atomic claim part.",
    },
  ];
  const weights = [15, 15, 15, 25, 20, 10];
  // Metadata relevance alone is not evidence adequacy. Without any qualifying
  // direct evidence, neither an empty package nor snippets earn an index score.
  const score =
    eligible.length === 0
      ? 0
      : checks.reduce((sum, check, index) => sum + (check.passed ? weights[index] : 0), 0);
  const gaps: string[] = [];
  if (!parts.length || !claim.text.trim())
    gaps.push("Identify at least one nonempty factual claim.");
  if (!relevant.length) gaps.push("Find evidence that directly addresses the stated claim.");
  if (!verified.length)
    gaps.push(
      "Check original source material and provenance; snippets or unverified assertions are insufficient.",
    );
  if (verified.length && !eligible.length)
    gaps.push(
      "Obtain direct evidence with matching context and valid dates; time-sensitive claims require a dated source.",
    );
  for (const part of missingParts) gaps.push(`Missing applicable evidence: ${part}`);
  if (!sufficientlyIndependent)
    gaps.push(
      "Find independent corroboration or a checked high-quality primary record covering the full claim.",
    );
  for (const part of conflictingParts) gaps.push(`Resolve conflicting evidence: ${part}`);
  const attempt = Number.isFinite(options.attempt) ? Math.max(0, Math.floor(options.attempt!)) : 1;
  const maxAttempts = Number.isFinite(options.maxAttempts)
    ? Math.max(1, Math.min(10, Math.floor(options.maxAttempts!)))
    : 2;
  const passed = checks.every((check) => check.passed);
  const exhausted = attempt >= maxAttempts;
  const decision = passed
    ? "proceed"
    : conflictingParts.length || exhausted || !parts.length
      ? "human_review"
      : "retrieve_more";
  const reasons = passed
    ? [
        "The supplied evidence meets this versioned sufficiency policy. Proceed to a preliminary factual assessment.",
      ]
    : decision === "human_review"
      ? [
          conflictingParts.length
            ? "Material evidence conflicts on the same claim; a reviewer must resolve the conflict."
            : exhausted
              ? "The bounded retrieval budget is exhausted. Do not turn missing evidence into a false verdict."
              : "The input does not identify a verifiable factual claim.",
        ]
      : [
          "The evidence package is incomplete. Perform a targeted additional search before assessing the claim.",
        ];
  if (unique.length !== evidence.length)
    reasons.push("Duplicate evidence IDs were collapsed before assessment.");
  if (unique.length > eligible.length)
    reasons.push(
      `${unique.length - eligible.length} supplied item(s) did not qualify as direct evidence under this policy.`,
    );
  return {
    decision,
    score,
    checks,
    reasons,
    gaps,
    suggestedQueries:
      decision === "proceed"
        ? []
        : (missingParts.length ? missingParts : parts)
            .slice(0, 4)
            .map(
              (part) =>
                `${part} original source ${claim.timeSensitive ? "date official statement" : "primary evidence"}`,
            ),
    independentSources,
    coveredParts: covered.size,
    totalParts: parts.length,
    eligibleEvidenceIds: eligible.map((item) => item.id),
    policyVersion: POLICY_VERSION,
  };
}

/** Derive a preliminary label only after the sufficiency gate permits assessment. */
export function assessVerdict(
  claim: Claim,
  evidence: Evidence[],
  gate: GateResult,
): VerdictAssessment {
  const eligibleIds = new Set(gate.eligibleEvidenceIds);
  const direct = evidence.filter((item) => eligibleIds.has(item.id));
  const evidenceIds = direct.map((item) => item.id);
  if (gate.decision !== "proceed") {
    return {
      verdict: "Unverifiable",
      explanation:
        "The available evidence does not yet justify a factual verdict. " + gate.reasons[0],
      evidenceIds,
      preliminary: true,
    };
  }
  const parts = claimParts(claim);
  const statuses = parts.map((part) => {
    const matching = direct.filter((item) =>
      item.claimParts.map(normaliseText).includes(normaliseText(part)),
    );
    const supports = matching.some((item) => item.stance === "supports");
    const refutes = matching.some((item) => item.stance === "refutes");
    return supports && !refutes ? "supported" : refutes && !supports ? "refuted" : "unresolved";
  });
  if (!statuses.length || statuses.includes("unresolved")) {
    return {
      verdict: "Unverifiable",
      explanation:
        "At least one claim part remains unresolved; no automatic factual conclusion is justified.",
      evidenceIds,
      preliminary: true,
    };
  }
  if (statuses.every((status) => status === "supported")) {
    return {
      verdict: "True",
      explanation:
        "The checked evidence supports every stated claim part in the supplied context. This is a preliminary assessment based on the cited evidence package.",
      evidenceIds,
      preliminary: true,
    };
  }
  if (statuses.every((status) => status === "refuted")) {
    return {
      verdict: "False",
      explanation:
        "The checked evidence contradicts every stated claim part. The conclusion follows from refuting evidence, not from a failure to find support.",
      evidenceIds,
      preliminary: true,
    };
  }
  return {
    verdict: "Misleading",
    explanation:
      "The evidence supports some parts of the claim and contradicts others. Presenting these parts together creates an inaccurate impression; the cited evidence identifies the distinction.",
    evidenceIds,
    preliminary: true,
  };
}
