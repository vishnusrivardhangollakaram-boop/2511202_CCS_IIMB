import { requireMutation } from "@/lib/auth";
import type { CorpusArticle } from "@/lib/domain";
import {
  ApiError,
  apiBoundary,
  boundedString,
  jsonResponse,
  objectBody,
  optionalString,
  publicHttpsUrl,
  readJson,
} from "@/lib/http";
import { database, importArticles, rateLimit } from "@/lib/store";
import { environment } from "../../_shared";

export async function POST(request: Request) {
  return apiBoundary(async () => {
    const user = requireMutation(request, environment);
    const body = objectBody(await readJson(request, 1_000_000));
    if (!Array.isArray(body.articles) || body.articles.length < 1 || body.articles.length > 100)
      throw new ApiError(400, "invalid_batch", "Import 1–100 articles per batch.");
    const seen = new Set<string>();
    const articles: CorpusArticle[] = body.articles.map((value) => {
      const item = objectBody(value);
      const articleId = boundedString(item.articleId, "Article ID", 1, 200);
      if (seen.has(articleId))
        throw new ApiError(
          400,
          "duplicate_article",
          "An article ID occurs more than once in this batch.",
        );
      seen.add(articleId);
      const date = optionalString(item.date, "Publication date", 40) || null;
      if (date && !Number.isFinite(Date.parse(date)))
        throw new ApiError(400, "invalid_date", "An article has an invalid publication date.");
      const article: CorpusArticle = {
        articleId,
        title: boundedString(item.title, "Title", 1, 500),
        url: publicHttpsUrl(item.url),
        site: boundedString(item.site, "Site", 1, 200),
        date,
        primaryClaim: boundedString(item.primaryClaim, "Primary claim", 0, 2000),
        content: boundedString(item.content, "Article content", 0, 30_000),
        verdict: boundedString(item.verdict, "Verdict label", 0, 100),
        domain: optionalString(item.domain, "Domain", 200),
      };
      for (const key of [
        "sourceVerdict",
        "normalizedVerdict",
        "llmVerdict",
        "trueVersion",
      ] as const) {
        const field =
          item[key] === undefined || item[key] === null
            ? undefined
            : boundedString(item[key], key, 0, key === "trueVersion" ? 5000 : 200);
        if (field !== undefined) article[key] = field;
      }
      // Optional embeddings are preserved for future validated hybrid retrieval; HTTP search remains labelled lexical.
      if (item.embedding !== undefined) {
        if (
          !Array.isArray(item.embedding) ||
          item.embedding.length < 1 ||
          item.embedding.length > 4096 ||
          item.embedding.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
        )
          throw new ApiError(
            400,
            "invalid_embedding",
            "Embedding values must be a finite numeric vector of at most 4096 dimensions.",
          );
        article.embedding = item.embedding as number[];
        article.embeddingModel = boundedString(item.embeddingModel, "Embedding model", 1, 200);
      }
      return article;
    });
    const db = database(environment);
    await rateLimit(db, user.id, "corpus_import", 1000);
    return jsonResponse({
      imported: await importArticles(db, user.id, articles),
      namespace: "your workspace",
      upsert: true,
    });
  });
}
