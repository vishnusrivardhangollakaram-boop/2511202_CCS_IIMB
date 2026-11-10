import { requireUser } from "@/lib/auth";
import { apiBoundary, jsonResponse } from "@/lib/http";
import { database, loadCase, publicCase } from "@/lib/store";
import { environment, type RouteContext } from "../../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: RouteContext) {
  return apiBoundary(async () => {
    const user = requireUser(request, environment);
    const { id } = await context.params;
    return jsonResponse({
      case: publicCase(await loadCase(database(environment), user.id, id), user),
    });
  });
}
