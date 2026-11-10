"""Behavioural tests for corpus validation, provenance and bounded imports."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "prepare_corpus.py"
SPEC = importlib.util.spec_from_file_location("prepare_corpus", MODULE_PATH)
corpus = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(corpus)


def record(identifier="a1", **updates):
    """Create a fictional corpus row without external requests."""
    result = {"article_id": identifier, "title": "Fictional archive example", "url": f"https://example.org/{identifier}", "site": "Example archive", "date": "2026-10-01", "primary_claim": "A fictional claim.", "content": "Example content.", "site_verdict": "Not true", "verdict_norm": "False", "verdict": "Misleading"}
    result.update(updates)
    return result


class CorpusPreparationTests(unittest.TestCase):
    def test_distinct_verdicts_preserved(self):
        article, truncated = corpus.normalise_record(record())
        self.assertEqual(article["articleId"], "a1")
        self.assertEqual(article["sourceVerdict"], "Not true")
        self.assertEqual(article["normalizedVerdict"], "False")
        self.assertEqual(article["llmVerdict"], "Misleading")
        self.assertEqual(article["verdict"], "Misleading")
        self.assertFalse(truncated)

    def test_missing_id_is_invalid_not_invented(self):
        batches, audit = corpus.prepare_records(iter([record(article_id="")]))
        self.assertEqual(batches, [])
        self.assertEqual(audit["invalidRecords"], 1)

    def test_id_and_fragment_url_duplicates_removed(self):
        batches, audit = corpus.prepare_records(iter([record(), record(url="https://example.org/different"), record("a2", url="https://example.org/a1#section")]))
        self.assertEqual(audit["acceptedRecords"], 1)
        self.assertEqual(audit["duplicateRecords"], 2)
        self.assertEqual(len(batches[0]), 1)

    def test_http_and_private_hosts_rejected(self):
        for url in ["http://example.org/a", "https://127.0.0.1/a", "https://8.8.8.8/a", "https://[::1]/a", "https://localhost/a", "https://foo.internal/a", "https://x:y@example.org/a", "https://example.org:8080/a"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                corpus.public_https_url(url)

    def test_csv_without_content_remains_empty(self):
        article, _ = corpus.normalise_record(record(content=None))
        self.assertEqual(article["content"], "")

    def test_no_automatic_other_label_mapping(self):
        article, _ = corpus.normalise_record(record(verdict="Other"))
        self.assertEqual(article["verdict"], "Other")

    def test_no_source_label_substitution(self):
        value = record()
        del value["verdict"]
        article, _ = corpus.normalise_record(value)
        self.assertEqual(article["verdict"], "")
        self.assertNotIn("llmVerdict", article)

    def test_truncation_requires_explicit_opt_in(self):
        value = record(content="x" * 30_001)
        with self.assertRaises(ValueError):
            corpus.normalise_record(value)
        article, truncated = corpus.normalise_record(value, truncate_content=True)
        self.assertEqual(len(article["content"]), 30_000)
        self.assertTrue(truncated)

    def test_batches_enforce_count_and_utf8_byte_limit(self):
        rows = [record(str(index), content="水" * 10_000) for index in range(101)]
        batches, audit = corpus.prepare_records(iter(rows))
        self.assertEqual(audit["acceptedRecords"], 101)
        self.assertGreater(len(batches), 1)
        self.assertTrue(all(len(batch) <= 100 and len(corpus.encode_batch(batch)) <= 900_000 for batch in batches))

    def test_invalid_embedding_rejected(self):
        for embedding in [[0, 0], [1, float("nan")], [True, 2], "not-json"]:
            with self.subTest(embedding=embedding), self.assertRaises(ValueError):
                corpus.normalise_record(record(embedding=embedding, embedding_model="test-model"))

    def test_invalid_date_rejected(self):
        with self.assertRaisesRegex(ValueError, "ISO"):
            corpus.normalise_record(record(date="sometime last year"))

    def test_stream_yields_before_reading_full_corpus(self):
        read_count = 0

        def source_rows():
            nonlocal read_count
            for index in range(1000):
                read_count += 1
                yield record(str(index))

        stream = corpus.iter_prepared_batches(source_rows(), corpus.new_audit())
        first = next(stream)
        self.assertEqual(len(first), 100)
        self.assertLess(read_count, 1000)

    def test_cli_refuses_to_overwrite_previous_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.json"
            source.write_text(json.dumps([record()]))
            output = Path(directory) / "batches"
            output.mkdir()
            previous = output / "batch-00001.json"
            previous.write_text("keep this previous result")
            process = subprocess.run([sys.executable, str(MODULE_PATH), str(source), "--output", str(output)], capture_output=True, text=True)
            self.assertEqual(process.returncode, 2)
            self.assertEqual(previous.read_text(), "keep this previous result")

    def test_cli_does_not_write_partial_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.json"
            output = Path(directory) / "batches"
            source.write_text(json.dumps([record(), record("a2", url="http://example.org/a2")]))
            process = subprocess.run([sys.executable, str(MODULE_PATH), str(source), "--output", str(output)], capture_output=True, text=True)
            self.assertEqual(process.returncode, 2)
            self.assertFalse(output.exists())

    def test_cli_skip_invalid_audited(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.json"
            output = Path(directory) / "batches"
            source.write_text(json.dumps([record(), record("a2", article_id="")]))
            process = subprocess.run([sys.executable, str(MODULE_PATH), str(source), "--output", str(output), "--skip-invalid"], capture_output=True, text=True)
            self.assertEqual(process.returncode, 0, process.stderr)
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertEqual(manifest["invalidRecords"], 1)
            self.assertEqual(manifest["acceptedRecords"], 1)
            self.assertTrue(manifest["skipInvalid"])
            self.assertEqual(len(manifest["sourceSha256"]), 64)

    def test_empty_input_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "empty.jsonl"
            source.write_text("")
            output = Path(directory) / "batches"
            process = subprocess.run([sys.executable, str(MODULE_PATH), str(source), "--output", str(output)], capture_output=True, text=True)
            self.assertEqual(process.returncode, 2)
            self.assertFalse(output.exists())

    def test_malformed_jsonl_reports_line(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "bad.jsonl"
            source.write_text("{bad json}\n")
            with self.assertRaisesRegex(ValueError, "line 1"):
                list(corpus.read_records(source))


if __name__ == "__main__":
    unittest.main()
