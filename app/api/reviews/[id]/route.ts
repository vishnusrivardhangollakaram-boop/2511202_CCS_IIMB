import { requireUser } from "@/lib/auth";
import { ApiError, apiBoundary, jsonResponse } from "@/lib/http";
import { database, loadReviewCase, publicCase } from "@/lib/store";
import { environment, type RouteContext } from "../../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: RouteContext) {
  return apiBoundary(async () => {
    const user = requireUser(request, environment);
    if (!user.canReview)
      throw new ApiError(
        403,
        "reviewer_required",
        "This view is available to configured reviewers.",
      );
    const { id } = await context.params;
    const record = await loadReviewCase(database(environment), user, id);
    if (!record.reviewRequested)
      throw new ApiError(404, "case_not_found", "This case is not shared for review.");
    return jsonResponse({ case: publicCase(record, user) });
  });
}
