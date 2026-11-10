import { requireMutation } from "@/lib/auth";
import {
  ApiError,
  apiBoundary,
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
} from "@/lib/store";
import {
  caseState,
  environment,
  MAX_ATTEMPTS,
  runInvestigation,
  type RouteContext,
} from "../../../_shared";
export async function POST(request: Request, context: RouteContext) {
  return apiBoundary(async () => {
    const user = requireMutation(request, environment);
    const body = objectBody(await readJson(request, 10_000));
    const db = database(environment);
    const { id } = await context.params;
    const record = await loadCase(db, user.id, id);
    assertVersion(record, requiredVersion(body.version));
    await rateLimit(db, user.id, "investigate", 15);
    if (record.mode !== "live") {
      const next = caseState(record);
      const saved = await saveCase(
        db,
        record,
        next,
        user,
        newEvent(
          user,
          "evidence_reassessed",
          "Evidence reassessed",
          "The current evidence package was re-evaluated. No web search was performed.",
        ),
      );
      return jsonResponse({ case: publicCase(saved, user) });
    }
    if (record.attempt >= MAX_ATTEMPTS)
      throw new ApiError(
        409,
        "search_budget_exhausted",
        "The bounded search budget is exhausted. Add evidence or use human review.",
      );
    const saved = await runInvestigation(db, record, user);
    return jsonResponse({ case: publicCase(saved, user) });
  });
}
