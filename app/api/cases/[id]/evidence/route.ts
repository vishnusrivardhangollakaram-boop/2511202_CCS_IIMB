import { requireMutation } from "@/lib/auth";
import { apiBoundary, jsonResponse, objectBody, readJson, requiredVersion } from "@/lib/http";
import {
  assertVersion,
  database,
  loadCase,
  newEvent,
  publicCase,
  rateLimit,
  saveCase,
} from "@/lib/store";
import { caseState, environment, manualEvidence, type RouteContext } from "../../../_shared";
export async function POST(request: Request, context: RouteContext) {
  return apiBoundary(async () => {
    const user = requireMutation(request, environment);
    const body = objectBody(await readJson(request));
    const db = database(environment);
    const { id } = await context.params;
    const record = await loadCase(db, user.id, id);
    assertVersion(record, requiredVersion(body.version));
    await rateLimit(db, user.id, "evidence", 60);
    const verified = body.attested === true && (user.canReview || record.mode === "demo");
    const evidence = manualEvidence(body.evidence, record.claim, verified);
    if (record.evaluationDate) evidence.retrievedAt = record.evaluationDate;
    const next = caseState(record, [...record.evidence, evidence]);
    const saved = await saveCase(
      db,
      record,
      next,
      user,
      newEvent(
        user,
        "evidence_added",
        "Evidence added",
        verified
          ? "A reviewer explicitly attested this manually supplied source. The evidence gate was recomputed."
          : "A manually supplied source was recorded as unverified. A configured reviewer must attest its provenance.",
      ),
    );
    return jsonResponse({ case: publicCase(saved, user) });
  });
}
