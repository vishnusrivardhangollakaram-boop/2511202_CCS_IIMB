#!/usr/bin/env python3
"""Convert an authorised fact-check corpus into bounded API import batches.

CSV and JSONL use the Python standard library. Parquet additionally needs
``pyarrow``. This tool never uploads data, selects verdict mappings, generates
evidence, or changes the source file. See docs/DATA.md before importing.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import ipaddress
import json
import math
import sys
import tempfile
from collections.abc import Iterator, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit


MAX_BATCH_RECORDS = 100
MAX_BATCH_BYTES = 900_000
MAX_CONTENT_CHARACTERS = 30_000


def read_records(source: Path) -> Iterator[Mapping[str, Any]]:
    """Read CSV, JSONL, JSON arrays, or batched Parquet without modifying input."""
    suffix = source.suffix.lower()
    if suffix == ".csv":
        with source.open("r", encoding="utf-8-sig", newline="") as stream:
            yield from csv.DictReader(stream)
    elif suffix in {".jsonl", ".ndjson"}:
        with source.open("r", encoding="utf-8-sig") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Malformed JSON on line {line_number}") from error
                if not isinstance(record, dict):
                    raise ValueError(f"JSON line {line_number} is not an object")
                yield record
    elif suffix == ".json":
        with source.open("r", encoding="utf-8-sig") as stream:
            document = json.load(stream)
        rows = document.get("articles") if isinstance(document, dict) else document
        if not isinstance(rows, list):
            raise ValueError("JSON must be an array or an object with an articles array")
        for row_number, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                raise ValueError(f"JSON record {row_number} is not an object")
            yield row
    elif suffix in {".parquet", ".pq"}:
        try:
            import pyarrow.parquet as parquet
        except ImportError as error:
            raise ValueError("Parquet needs pyarrow: python -m pip install pyarrow") from error
        for batch in parquet.ParquetFile(source).iter_batches(batch_size=500):
            yield from batch.to_pylist()
    else:
        raise ValueError("Supported input extensions: .csv, .jsonl, .ndjson, .json, .parquet, .pq")


def text_value(value: Any, field: str, maximum: int, required: bool = False) -> str:
    """Read scalar text without inventing values or converting lists to strings."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        result = ""
    elif isinstance(value, (str, int, float)) and not isinstance(value, bool):
        result = str(value).strip()
    elif isinstance(value, datetime):
        result = value.isoformat()
    else:
        raise ValueError(f"{field}: expected scalar text")
    if required and not result:
        raise ValueError(f"{field}: required")
    if len(result) > maximum:
        raise ValueError(f"{field}: exceeds {maximum} characters")
    return result


def public_https_url(value: Any) -> str:
    """Validate public HTTPS URLs without performing a network request."""
    url = text_value(value, "url", 2_000, required=True)
    try:
        parts = urlsplit(url)
        hostname = parts.hostname or ""
        port = parts.port
    except ValueError as error:
        raise ValueError("url: invalid URL") from error
    if parts.scheme != "https" or not hostname or parts.username or parts.password:
        raise ValueError("url: expected HTTPS without credentials")
    if any(character.isspace() or ord(character) < 32 for character in url):
        raise ValueError("url: whitespace/control characters are not allowed")
    lowered = hostname.lower().rstrip(".")
    if lowered in {"localhost", "localhost.localdomain"} or lowered.endswith((".local", ".internal", ".localhost")):
        raise ValueError("url: local host is not allowed")
    if port not in {None, 443}:
        raise ValueError("url: only the default HTTPS port is supported")
    try:
        ipaddress.ip_address(lowered)
    except ValueError:
        if "." not in lowered:
            raise ValueError("url: expected a public hostname")
    else:
        raise ValueError("url: use a public domain name, not an IP address")
    return url


def canonical_url(url: str) -> str:
    """Use a fragment-free URL for deduplication while retaining source URLs."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", parts.query, ""))


def pick(row: Mapping[str, Any], *names: str) -> Any:
    """Select the first present named source column, including an empty value."""
    for name in names:
        if name in row:
            return row[name]
    return None


def normalise_record(row: Mapping[str, Any], truncate_content: bool = False) -> tuple[dict[str, Any], bool]:
    """Map source columns explicitly; preserve distinct verdict provenance."""
    raw_content = pick(row, "content", "full_text")
    content = text_value(raw_content, "content", 10_000_000)
    truncated = len(content) > MAX_CONTENT_CHARACTERS
    if truncated and not truncate_content:
        raise ValueError("content: exceeds 30000 characters; use --truncate-content explicitly")
    if truncated:
        content = content[:MAX_CONTENT_CHARACTERS]
    raw_date = pick(row, "date", "published_at")
    if hasattr(raw_date, "isoformat"):
        raw_date = raw_date.isoformat()
    date = text_value(raw_date, "date", 40) or None
    if date:
        try:
            datetime.fromisoformat(date.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("date: expected an ISO date or timestamp") from error
    result: dict[str, Any] = {
        "articleId": text_value(pick(row, "articleId", "article_id"), "articleId", 200, required=True),
        "title": text_value(pick(row, "title"), "title", 500, required=True),
        "url": public_https_url(pick(row, "url")),
        "site": text_value(pick(row, "site", "publisher"), "site", 200, required=True),
        "date": date,
        "primaryClaim": text_value(pick(row, "primaryClaim", "primary_claim", "claim_reviewed"), "primaryClaim", 2_000),
        "content": content,
        # The existing LLM verdict stays literal; no source-label fallback.
        "verdict": text_value(pick(row, "verdict", "llmVerdict"), "verdict", 100),
    }
    aliases = {
        "sourceVerdict": ("sourceVerdict", "site_verdict"),
        "normalizedVerdict": ("normalizedVerdict", "verdict_norm"),
        "llmVerdict": ("llmVerdict", "verdict"),
        "trueVersion": ("trueVersion", "true_version"),
        "domain": ("domain",),
    }
    for field, names in aliases.items():
        value = pick(row, *names)
        if value is not None:
            result[field] = text_value(value, field, 5_000 if field == "trueVersion" else 200)
    embedding = row.get("embedding")
    if embedding not in (None, ""):
        if isinstance(embedding, str):
            try:
                embedding = json.loads(embedding)
            except json.JSONDecodeError as error:
                raise ValueError("embedding: expected a numeric JSON array") from error
        if not isinstance(embedding, list) or not embedding or len(embedding) > 4_096:
            raise ValueError("embedding: expected 1..4096 finite numbers")
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in embedding):
            raise ValueError("embedding: expected finite numbers")
        if not any(value != 0 for value in embedding):
            raise ValueError("embedding: zero vector is not meaningful")
        result["embedding"] = embedding
        result["embeddingModel"] = text_value(pick(row, "embeddingModel", "embedding_model"), "embeddingModel", 200, required=True)
    return result, truncated


def encode_batch(records: list[dict[str, Any]]) -> bytes:
    """Serialize compact UTF-8 JSON and reject non-standard NaN values."""
    return (json.dumps({"articles": records}, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def new_audit() -> dict[str, Any]:
    """Create a bounded audit accumulator that does not retain article text."""
    return {
        "inputRecords": 0, "acceptedRecords": 0, "duplicateRecords": 0,
        "invalidRecords": 0, "emptyContentRecords": 0, "truncatedContentRecords": 0,
        "errors": [], "maxBatchRecords": MAX_BATCH_RECORDS,
        "maxBatchBytes": MAX_BATCH_BYTES, "batchCount": 0,
    }


def iter_prepared_batches(records: Iterator[Mapping[str, Any]], audit: dict[str, Any], *, truncate_content: bool = False) -> Iterator[list[dict[str, Any]]]:
    """Stream validated batches, keeping only IDs, URL keys and one batch in memory."""
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    current: list[dict[str, Any]] = []
    envelope_bytes = len(encode_batch([]))
    current_bytes = envelope_bytes
    for index, row in enumerate(records, 1):
        audit["inputRecords"] += 1
        try:
            article, truncated = normalise_record(row, truncate_content)
            url_key = canonical_url(article["url"])
            if article["articleId"] in seen_ids or url_key in seen_urls:
                audit["duplicateRecords"] += 1
                continue
            article_bytes = len(json.dumps(article, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
            if envelope_bytes + article_bytes > MAX_BATCH_BYTES:
                raise ValueError("record: cannot fit within one import batch")
        except (ValueError, TypeError) as error:
            audit["invalidRecords"] += 1
            if len(audit["errors"]) < 100:
                audit["errors"].append({"record": index, "reason": str(error)})
            continue
        separator_bytes = 1 if current else 0
        if current and (len(current) >= MAX_BATCH_RECORDS or current_bytes + separator_bytes + article_bytes > MAX_BATCH_BYTES):
            audit["batchCount"] += 1
            yield current
            current = []
            current_bytes = envelope_bytes
            separator_bytes = 0
        current.append(article)
        current_bytes += separator_bytes + article_bytes
        seen_ids.add(article["articleId"])
        seen_urls.add(url_key)
        audit["acceptedRecords"] += 1
        audit["emptyContentRecords"] += not bool(article["content"])
        audit["truncatedContentRecords"] += truncated
    if current:
        audit["batchCount"] += 1
        yield current


def prepare_records(records: Iterator[Mapping[str, Any]], *, truncate_content: bool = False) -> tuple[list[list[dict[str, Any]]], dict[str, Any]]:
    """Convenient in-memory wrapper for small integrations and unit tests."""
    audit = new_audit()
    batches = list(iter_prepared_batches(records, audit, truncate_content=truncate_content))
    return batches, audit


def sha256_file(path: Path) -> str:
    """Hash the immutable source bytes for the import audit manifest."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    """Validate input and write import batches only after validation succeeds."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Authorised CSV, JSONL, JSON or Parquet corpus")
    parser.add_argument("--output", type=Path, required=True, help="New or empty output directory")
    parser.add_argument("--skip-invalid", action="store_true", help="Explicitly permit invalid rows to be omitted; audit records omissions")
    parser.add_argument("--truncate-content", action="store_true", help="Explicitly permit content to be cut to the API limit of 30000 characters")
    arguments = parser.parse_args()
    try:
        if not arguments.source.is_file():
            raise ValueError("Source file does not exist")
        if arguments.output.exists() and any(arguments.output.iterdir()):
            raise ValueError("Output directory must be empty; previous batches are never overwritten")
        initial_hash = sha256_file(arguments.source)
        audit = new_audit()
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        # Stage on the same filesystem, then rename only after all validation.
        # Full-text corpora are streamed; they are not held in a giant list.
        with tempfile.TemporaryDirectory(prefix="ccs-corpus-", dir=arguments.output.parent) as staged_name:
            staged = Path(staged_name)
            files = []
            for index, batch in enumerate(iter_prepared_batches(read_records(arguments.source), audit, truncate_content=arguments.truncate_content), 1):
                filename = f"batch-{index:05d}.json"
                payload = encode_batch(batch)
                (staged / filename).write_bytes(payload)
                files.append({"file": filename, "records": len(batch), "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
            if not audit["inputRecords"]:
                raise ValueError("Source contains no records")
            if audit["invalidRecords"] and not arguments.skip_invalid:
                print(json.dumps(audit, indent=2), file=sys.stderr)
                raise ValueError("Invalid records found; nothing written. Correct input or explicitly use --skip-invalid")
            if not files:
                raise ValueError("No valid records remain; nothing written")
            if sha256_file(arguments.source) != initial_hash:
                raise ValueError("Source changed during preparation; nothing published")
            manifest = {
                "schemaVersion": "ccs-corpus-import-v1", "sourceName": arguments.source.name,
                "sourceSha256": initial_hash, "preparedAt": datetime.now(timezone.utc).isoformat(),
                "skipInvalid": arguments.skip_invalid, "truncateContent": arguments.truncate_content,
                **audit, "files": files,
            }
            (staged / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            if arguments.output.exists():
                arguments.output.rmdir()  # Fails safely if another process added a file.
            staged.rename(arguments.output)
        print(json.dumps({key: value for key, value in manifest.items() if key not in {"files", "errors"}}, indent=2))
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(f"Corpus preparation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
