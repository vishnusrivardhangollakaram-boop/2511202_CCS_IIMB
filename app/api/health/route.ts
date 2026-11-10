import { POLICY_VERSION } from "@/lib/sufficiency";
import { database } from "@/lib/store";
import { jsonResponse } from "@/lib/http";
import { environment } from "../_shared";
export const dynamic = "force-dynamic";
/** Anonymous readiness probe returns no identity, corpus counts or provider configuration. */
export async function GET() {
  try {
    const db = database(environment);
    await db.prepare("SELECT 1 AS ready").first();
    const schema = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('cases', 'audit_events', 'rate_limits', 'corpus_articles', 'corpus_search')",
      )
      .first<{ count: number }>();
    if (schema?.count !== 5)
      return jsonResponse(
        { status: "not_ready", storage: "unavailable", policyVersion: POLICY_VERSION },
        503,
      );
    return jsonResponse({ status: "ok", storage: "ready", policyVersion: POLICY_VERSION });
  } catch {
    return jsonResponse(
      { status: "not_ready", storage: "unavailable", policyVersion: POLICY_VERSION },
      503,
    );
  }
}
