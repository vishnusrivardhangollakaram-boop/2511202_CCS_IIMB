"""Pure BM25 retrieval with optional compatible, precomputed dense vectors.

No provider is called here. A lexical result is never labelled semantic.
Supply a bounded candidate set from the owner's persistent search index before
ranking; BM25 statistics are relative to this candidate set, not the full corpus.
"""

from __future__ import annotations

import math
import unicodedata
from collections import Counter
from typing import Any

_STOP_WORDS = frozenset(
    {
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
    }
)


def _finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except (ValueError, OverflowError):
        return False


def tokenise(text: str) -> list[str]:
    """NFKC Unicode letter/number tokens, preserving negation and dates.

    Unicode categories L and N match the original TypeScript tokenizer. Marks
    and punctuation delimit tokens; this is not language-specific segmentation.
    """
    text = unicodedata.normalize("NFKC", text).lower()
    tokens, current = [], []
    for character in text:
        if unicodedata.category(character)[0] in {"L", "N"}:
            current.append(character)
        elif current:
            token = "".join(current)
            if token not in _STOP_WORDS:
                tokens.append(token)
            current = []
    if current:
        token = "".join(current)
        if token not in _STOP_WORDS:
            tokens.append(token)
    return tokens


def cosine_similarity(left: list[float], right: list[float]) -> float | None:
    """Reject incompatible, nonfinite and zero vectors; scale to avoid overflow."""
    if (
        not isinstance(left, (list, tuple))
        or not isinstance(right, (list, tuple))
        or not left
        or len(left) != len(right)
        or any(not _finite_number(value) for value in (*left, *right))
    ):
        return None
    left_scale, right_scale = max(abs(value) for value in left), max(abs(value) for value in right)
    if not left_scale or not right_scale:
        return None
    a = [value / left_scale for value in left]
    b = [value / right_scale for value in right]
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))
    if not norm:
        return None
    return max(-1.0, min(1.0, dot / norm))


def search_corpus(query: str, articles: list[dict], options: dict | None = None) -> list[dict]:
    """Rank historical articles with BM25 and optional supplied embeddings.

    The wire format intentionally retains camelCase names from the TypeScript
    implementation. ``queryEmbedding`` is used only when ``embeddingModel``
    exactly matches the article's model and the vector dimensions are compatible.
    Scores describe retrieval relevance, never truth, evidence sufficiency or
    a calibrated probability. The function does not mutate the supplied articles.
    """
    options = options or {}
    terms = list(dict.fromkeys(tokenise(query)))
    if not terms:
        return []
    unique = {article["articleId"]: article for article in articles}
    documents = []
    for article in unique.values():
        claim = article.get("primaryClaim", "")
        title = article.get("title", "")
        tokens = tokenise(f"{claim} {claim} {claim} {title} {title} {article.get('content', '')}")
        documents.append((article, Counter(tokens), len(tokens)))
    if not documents:
        return []
    average_length = sum(length for _, _, length in documents) / len(documents) or 1
    document_frequency = {
        term: sum(term in frequencies for _, frequencies, _ in documents) for term in terms
    }
    k1, b = 1.2, 0.75
    query_embedding = options.get("queryEmbedding")
    model_value = options.get("embeddingModel")
    embedding_model = model_value.strip() if isinstance(model_value, str) else ""
    can_use_embeddings = bool(
        embedding_model and cosine_similarity(query_embedding, query_embedding) is not None
    )
    weight_option, minimum_option = (
        options.get("semanticWeight"),
        options.get("minimumSemanticSimilarity"),
    )
    semantic_weight = max(0, min(1, weight_option)) if _finite_number(weight_option) else 0.65
    minimum_semantic = max(-1, min(1, minimum_option)) if _finite_number(minimum_option) else 0.45
    rows = []
    for article, frequencies, length in documents:
        lexical_score = 0.0
        for term in terms:
            tf = frequencies[term]
            if not tf:
                continue
            df = document_frequency[term]
            idf = math.log(1 + (len(documents) - df + 0.5) / (df + 0.5))
            lexical_score += idf * (
                (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * length / average_length))
            )
        semantic_score = (
            cosine_similarity(query_embedding, article.get("embedding"))
            if can_use_embeddings and article.get("embeddingModel") == embedding_model
            else None
        )
        rows.append(
            {"article": article, "lexicalScore": lexical_score, "semanticScore": semantic_score}
        )
    lexical_maximum = max(1, *(row["lexicalScore"] for row in rows))
    ranked = []
    for row in rows:
        lexical, semantic = row["lexicalScore"], row["semanticScore"]
        if lexical <= 0 and (semantic is None or semantic < minimum_semantic):
            continue
        score = (
            lexical / lexical_maximum
            if semantic is None
            else (
                (1 - semantic_weight) * lexical / lexical_maximum
                + semantic_weight * max(0, semantic)
            )
        )
        ranked.append(
            {**row, "score": score, "method": "lexical" if semantic is None else "hybrid"}
        )
    limit_option = options.get("limit")
    limit = max(1, min(50, math.floor(limit_option))) if _finite_number(limit_option) else 8
    # Stable article IDs are ASCII in shipped fixtures/import conventions. For
    # non-ASCII IDs Python codepoint tie order can differ from JS localeCompare.
    return sorted(
        ranked, key=lambda row: (-row["score"], -row["lexicalScore"], row["article"]["articleId"])
    )[:limit]


retrieve_historical_matches = search_corpus
