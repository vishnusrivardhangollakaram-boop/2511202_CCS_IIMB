import { requireUser } from "@/lib/auth";
import { apiBoundary, boundedString, jsonResponse } from "@/lib/http";
import { corpusCandidates, corpusCount, database, rateLimit } from "@/lib/store";
import { searchCorpus } from "@/lib/retrieval";
import { environment } from "../../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiBoundary(async () => {
    const user = requireUser(request, environment);
    const query = boundedString(new URL(request.url).searchParams.get("q"), "Search query", 3, 500);
    const db = database(environment);
    await rateLimit(db, user.id, "corpus_search", 120);
    const candidates = await corpusCandidates(db, user.id, query);
    const matches = searchCorpus(query, candidates, { limit: 10 });
    return jsonResponse({
      matches,
      totalArticles: await corpusCount(db, user.id),
      candidateLimit: 500,
      method: "lexical",
    });
  });
}
