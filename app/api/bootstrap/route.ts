import { requireUser } from "@/lib/auth";
import { apiBoundary, jsonResponse } from "@/lib/http";
import { scenarios } from "@/lib/fixtures";
import { POLICY_VERSION } from "@/lib/sufficiency";
import { providerCapabilities } from "@/lib/providers";
import { database, corpusCount } from "@/lib/store";
import { environment, MAX_ATTEMPTS } from "../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiBoundary(async () => {
    const user = requireUser(request, environment);
    const capabilities = providerCapabilities(environment);
    const totalArticles = await corpusCount(database(environment), user.id);
    return jsonResponse({
      user,
      capabilities: {
        ...capabilities,
        image: capabilities.ocr,
        review: user.canReview,
        canReview: user.canReview,
        corpus: true,
        corpusImport: true,
      },
      scenarios: scenarios.map(({ id, title, description, claim, category, label }) => ({
        id,
        title,
        description,
        claim,
        category,
        label,
      })),
      policy: {
        version: POLICY_VERSION,
        maxAttempts: MAX_ATTEMPTS,
        scoreLabel: "Evidence adequacy index — not a probability",
        totalArticles,
      },
    });
  });
}
