import { requireMutation } from "@/lib/auth";
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
  loadCase,
  newEvent,
  publicCase,
  rateLimit,
  saveCase,
  type InvestigationCase,
} from "@/lib/store";
import { environment, type RouteContext } from "../../../_shared";

/** Explicit owner consent shares this case only with configured reviewers; withdrawal revokes it. */
export async function POST(request: Request, context: RouteContext) {
  return apiBoundary(async () => {
    const user = requireMutation(request, environment);
    const body = objectBody(await readJson(request, 20_000));
    const db = database(environment);
    const { id } = await context.params;
    const record = await loadCase(db, user.id, id);
    assertVersion(record, requiredVersion(body.version));
    const action = body.action || "request";
    if (action !== "request" && action !== "withdraw")
      throw new ApiError(400, "invalid_handoff", "Choose request or withdraw.");
    const reason = boundedString(body.reason, "Handoff rationale", 20, 3000);
    await rateLimit(db, user.id, "handoff", 30);
    const next: InvestigationCase =
      action === "request"
        ? {
            ...record,
            reviewRequested: true,
            reviewStatus: "pending",
            handoffReason: reason,
            status: "human_review",
            finalVerdict: null,
            preliminary: true,
          }
        : {
            ...record,
            reviewRequested: false,
            reviewStatus: "none",
            handoffReason: reason,
            status: record.finalVerdict
              ? "reviewed"
              : record.gate.decision === "proceed"
                ? "ready"
                : record.gate.decision === "human_review"
                  ? "human_review"
                  : "needs_evidence",
          };
    const saved = await saveCase(
      db,
      record,
      next,
      user,
      newEvent(
        user,
        action === "request" ? "review_requested" : "review_withdrawn",
        action === "request" ? "Human review requested" : "Reviewer access withdrawn",
        `${action === "request" ? "The owner explicitly shared this case with configured reviewers." : "The owner revoked access for separate reviewers."} ${reason}`,
      ),
    );
    return jsonResponse({ case: publicCase(saved, user) });
  });
}
