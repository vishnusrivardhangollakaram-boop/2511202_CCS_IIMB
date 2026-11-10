import { requireUser } from "@/lib/auth";
import { apiBoundary, jsonResponse } from "@/lib/http";
import { database, listReviewCases, publicCase } from "@/lib/store";
import { environment } from "../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiBoundary(async () => {
    const user = requireUser(request, environment);
    const records = await listReviewCases(database(environment), user);
    return jsonResponse({ cases: records.map((record) => publicCase(record, user)), limit: 100 });
  });
}
