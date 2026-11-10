import { assertReviewer, requireMutation } from "@/lib/auth";
import {
  ApiError,
  apiBoundary,
  boundedString,
  jsonResponse,
  objectBody,
  readJson,
  requiredVersion,
} from "@/lib/http";
import {
  assertVersion,
  database,
  loadReviewCase,
  newEvent,
  publicCase,
  rateLimit,
  saveCase,
  type HumanReview,
} from "@/lib/store";
import { caseState, environment, verdictInput, type RouteContext } from "../../../_shared";
export async function POST(request: Request, context: RouteContext) {
  return apiBoundary(async () => {
    const user = requireMutation(request, environment);
    const body = objectBody(await readJson(request, 30_000));
    const db = database(environment);
    const { id } = await context.params;
    const record = await loadReviewCase(db, user, id);
    assertVersion(record, requiredVersion(body.version));
    assertReviewer(user, record.mode);
    const decision = String(body.decision || "approve");
    if (!["approve", "revise", "request_evidence"].includes(decision))
      throw new ApiError(400, "invalid_review", "Choose a valid review decision.");
    const reason = boundedString(body.reason, "Review rationale", 20, 5000);
    const verdict = decision === "request_evidence" ? null : verdictInput(body.verdict);
    if (
      body.evidenceIds !== undefined &&
      (!Array.isArray(body.evidenceIds) ||
        body.evidenceIds.length > 50 ||
        body.evidenceIds.some(
          (id) => typeof id !== "string" || !record.evidence.some((entry) => entry.id === id),
        ))
    )
      throw new ApiError(
        400,
        "invalid_evidence",
        "The selected evidence does not belong to this case.",
      );
    const evidenceIds = (body.evidenceIds || []) as string[];
    if (new Set(evidenceIds).size !== evidenceIds.length)
      throw new ApiError(400, "duplicate_evidence", "Select each evidence source only once.");
    if (verdict !== null && verdict !== "Unverifiable" && evidenceIds.length === 0)
      throw new ApiError(
        400,
        "review_evidence_required",
        "Select and attest at least one evidence source before recording a definitive verdict.",
      );
    const reviewedEvidence = record.evidence.map((entry) =>
      evidenceIds.includes(entry.id) ? { ...entry, verified: true } : entry,
    );
    const assessed = caseState(record, reviewedEvidence);
    const override =
      verdict !== null && (assessed.gate.decision !== "proceed" || verdict !== assessed.verdict);
    if (override && body.overrideConfirmed !== true)
      throw new ApiError(
        400,
        "override_confirmation_required",
        "Explicitly confirm that this human decision overrides the current evidence assessment.",
      );
    if (override && reason.length < 40)
      throw new ApiError(
        400,
        "override_rationale_required",
        "Explain this override in at least 40 characters, including the evidence or limitation behind it.",
      );
    await rateLimit(db, user.id, "review", 30);
    const review: HumanReview = {
      id: crypto.randomUUID(),
      decision: decision as HumanReview["decision"],
      verdict,
      reason,
      actorId: user.id,
      actorName: user.displayName,
      createdAt: new Date().toISOString(),
      caseVersion: record.version,
      evidenceIds,
      evidenceSnapshot: structuredClone(reviewedEvidence),
      gateSnapshot: structuredClone(assessed.gate),
      override,
    };
    const next = {
      ...assessed,
      reviews: [...record.reviews, review],
      finalVerdict: verdict,
      preliminary: verdict === null,
      reviewStatus: record.reviewRequested
        ? verdict === null
          ? ("pending" as const)
          : ("completed" as const)
        : ("none" as const),
      status: verdict === null ? ("needs_evidence" as const) : ("reviewed" as const),
    };
    const saved = await saveCase(
      db,
      record,
      next,
      user,
      newEvent(
        user,
        "human_review",
        verdict === null ? "Reviewer requested evidence" : "Human review recorded",
        `${override ? "Explicit override. " : ""}${reason}`,
      ),
    );
    return jsonResponse({ case: publicCase(saved, user) });
  });
}
