"""Native BM25 behavior and parity against stored TypeScript reference outputs."""

import copy
import json
import math
import unittest
from pathlib import Path

from evidence_streamlit.retrieval import cosine_similarity, search_corpus, tokenise

_VECTORS = json.loads(Path(__file__).with_name("retrieval_vectors.json").read_text())["vectors"]
_ARTICLES = _VECTORS[0]["articles"]


class RetrievalTests(unittest.TestCase):
    def assert_reference(self, actual, expected):
        if isinstance(expected, float):
            self.assertAlmostEqual(actual, expected, places=12)
        elif isinstance(expected, dict):
            self.assertEqual(set(actual), set(expected))
            for key in expected:
                self.assert_reference(actual[key], expected[key])
        elif isinstance(expected, list):
            self.assertEqual(len(actual), len(expected))
            for found, wanted in zip(actual, expected):
                self.assert_reference(found, wanted)
        else:
            self.assertEqual(actual, expected)

    def test_tokens_preserve_negations_dates_and_unicode_categories(self):
        self.assertEqual(tokenise("This is NOT free in 2026"), ["not", "free", "2026"])
        self.assertEqual(tokenise("ＣＡＦÉ_2026 buses—नहीं"), ["café", "2026", "buses", "नह"])

    def test_invalid_vectors_fall_back_to_lexical(self):
        articles = [{**_ARTICLES[0], "embedding": [1, 0], "embeddingModel": "test"}]
        for vector in ([], [0, 0], [math.nan, 1], [math.inf, 0], [True, 0], ["1", 0], [1, 2, 3]):
            with self.subTest(vector=vector):
                result = search_corpus(
                    "Riverton", articles, {"queryEmbedding": vector, "embeddingModel": "test"}
                )
                self.assertEqual(result[0]["method"], "lexical")
                self.assertIsNone(result[0]["semanticScore"])

    def test_cosine_rejects_incompatible_or_degenerate_vectors(self):
        for left, right in (
            ([], []),
            ([0, 0], [1, 0]),
            ([1], [1, 2]),
            ([True], [1]),
            ([10**10000], [1]),
        ):
            with self.subTest(left_type=type(left[0]).__name__ if left else "empty"):
                self.assertIsNone(cosine_similarity(left, right))
        self.assertEqual(cosine_similarity([1, 0], [0, 1]), 0)
        self.assertEqual(cosine_similarity([1, 0], [-1, 0]), -1)

    def test_large_finite_vectors_do_not_produce_nan(self):
        self.assertEqual(cosine_similarity([1e308, 1e308], [1e308, 1e308]), 1)
        self.assertEqual(cosine_similarity([1e-308, 0], [1e-308, 0]), 1)

    def test_limit_clamps_and_rejects_boolean_as_numeric_option(self):
        many = [{**_ARTICLES[0], "articleId": f"a-{index:03}"} for index in range(75)]
        self.assertEqual(len(search_corpus("bus", many, {"limit": 1000})), 50)
        self.assertEqual(len(search_corpus("bus", many, {"limit": -3})), 1)
        self.assertEqual(len(search_corpus("bus", many, {"limit": True})), 8)

    def test_dedupe_keeps_latest_article_payload(self):
        changed = {
            **_ARTICLES[0],
            "title": "Updated bus notice",
            "content": "Updated source material",
        }
        results = search_corpus("bus", [_ARTICLES[0], changed])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["article"]["title"], "Updated bus notice")

    def test_search_is_nonmutating_and_keeps_labels_as_provenance(self):
        articles = copy.deepcopy(_ARTICLES)
        articles[0].update(
            sourceVerdict="Source says true", normalizedVerdict="True", llmVerdict="Other"
        )
        before = copy.deepcopy(articles)
        results = search_corpus("bus", articles)
        self.assertEqual(articles, before)
        preserved = next(row["article"] for row in results if row["article"]["articleId"] == "a")
        self.assertEqual(preserved["sourceVerdict"], "Source says true")
        self.assertNotIn("verdict", {key for key in results[0] if key != "article"})
        self.assertEqual(results[0]["method"], "lexical")


def _parity_test(vector):
    def run(self):
        self.assert_reference(
            search_corpus(vector["query"], vector["articles"], vector["options"]),
            vector["expected"],
        )

    return run


for _vector in _VECTORS:
    setattr(
        RetrievalTests,
        "test_typescript_parity_" + _vector["name"].replace("-", "_"),
        _parity_test(_vector),
    )


if __name__ == "__main__":
    unittest.main()
