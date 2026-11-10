import type { CorpusArticle, RetrievalMatch } from "./domain";

export interface RetrievalOptions {
  limit?: number;
  queryEmbedding?: number[];
  embeddingModel?: string;
  semanticWeight?: number;
  minimumSemanticSimilarity?: number;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "with",
  "this",
  "that",
  "it",
  "its",
  "as",
  "by",
  "from",
]);

/** Unicode-aware tokens; negations and numerical/date tokens are retained. */
export function tokenise(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((word) => !STOP_WORDS.has(word));
}

/** Return null for incompatible, nonfinite or zero-magnitude vectors. */
export function cosineSimilarity(left: number[], right: number[]): number | null {
  if (
    !left.length ||
    left.length !== right.length ||
    left.some((value) => !Number.isFinite(value)) ||
    right.some((value) => !Number.isFinite(value))
  )
    return null;
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    a += left[i] * left[i];
    b += right[i] * right[i];
  }
  if (!a || !b) return null;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(a * b)));
}

/**
 * BM25 baseline with optional compatible precomputed embeddings.
 * No embedding API is called here, and lexical search is never labelled semantic.
 * For the full 52,678-article corpus, use a persistent search index to preselect
 * candidates rather than scanning the complete archive inside every request.
 */
export function searchCorpus(
  query: string,
  articles: CorpusArticle[],
  options: RetrievalOptions = {},
): RetrievalMatch[] {
  const terms = [...new Set(tokenise(query))];
  if (!terms.length) return [];
  const documents = [
    ...new Map(articles.map((article) => [article.articleId, article])).values(),
  ].map((article) => {
    // Weight claim/title tokens, while retaining body information for retrieval.
    const tokens = tokenise(
      `${article.primaryClaim} ${article.primaryClaim} ${article.primaryClaim} ${article.title} ${article.title} ${article.content}`,
    );
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { article, frequencies, length: tokens.length };
  });
  if (!documents.length) return [];
  const averageLength =
    documents.reduce((sum, item) => sum + item.length, 0) / documents.length || 1;
  const documentFrequency = new Map(
    terms.map((term) => [term, documents.filter((item) => item.frequencies.has(term)).length]),
  );
  const k1 = 1.2;
  const b = 0.75;
  const queryEmbedding = options.queryEmbedding;
  const embeddingModel = options.embeddingModel?.trim();
  const canUseEmbeddings =
    !!queryEmbedding?.length &&
    !!embeddingModel &&
    cosineSimilarity(queryEmbedding, queryEmbedding) !== null;
  const semanticWeight = Number.isFinite(options.semanticWeight)
    ? Math.max(0, Math.min(1, options.semanticWeight!))
    : 0.65;
  const minSemantic = Number.isFinite(options.minimumSemanticSimilarity)
    ? Math.max(-1, Math.min(1, options.minimumSemanticSimilarity!))
    : 0.45;
  const rows = documents.map(({ article, frequencies, length }) => {
    let lexicalScore = 0;
    for (const term of terms) {
      const tf = frequencies.get(term) ?? 0;
      if (!tf) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      lexicalScore += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * length) / averageLength)));
    }
    const semanticScore =
      canUseEmbeddings && article.embeddingModel === embeddingModel && article.embedding
        ? cosineSimilarity(queryEmbedding!, article.embedding)
        : null;
    return { article, lexicalScore, semanticScore };
  });
  const lexicalMax = Math.max(...rows.map((row) => row.lexicalScore), 1);
  const ranked: RetrievalMatch[] = rows
    .filter(
      (row) =>
        row.lexicalScore > 0 || (row.semanticScore !== null && row.semanticScore >= minSemantic),
    )
    .map((row) => ({
      ...row,
      // A monotonic normalization keeps lexical and cosine ranges comparable.
      score:
        row.semanticScore === null
          ? row.lexicalScore / lexicalMax
          : ((1 - semanticWeight) * row.lexicalScore) / lexicalMax +
            semanticWeight * Math.max(0, row.semanticScore),
      method: row.semanticScore === null ? "lexical" : "hybrid",
    }));
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(50, Math.floor(options.limit!)))
    : 8;
  return ranked
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.lexicalScore - left.lexicalScore ||
        left.article.articleId.localeCompare(right.article.articleId),
    )
    .slice(0, limit);
}

/** Descriptive alias for integration adapters. */
export const retrieveHistoricalMatches = searchCorpus;
