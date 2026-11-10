# Data provenance and corpus preparation

## What the project brief reports

The supplied brief reports 52,678 English fact-check articles from 15 Indian fact-checkers, covering archives through 11 October 2026. It describes a frozen `master_v2` with a recorded SHA-256 and a `classified_v2` with LLM-derived annotations. These are claims about the team's dataset in the brief; the corpus itself was not supplied to this repository.

The main text and architecture diagram differ: the diagram still reports 46,131 articles from 14 sites with Factly pending. Use the actual received dataset and its manifest to establish the import count. Do not populate the application's “loaded articles” count with either number before importing.

The 52,678 items are fact-check articles, not necessarily 52,678 independent claims. Several sites may cover the same underlying rumour, and one article may discuss multiple propositions.

## Three different verdicts

| Source field | Meaning | Application import field |
| --- | --- | --- |
| `site_verdict` | Original publisher wording | `sourceVerdict` |
| `verdict_norm` | Team's normalised original site label | `normalizedVerdict` |
| `verdict` | LLM reading under the classification codebook | `llmVerdict`; also retained literally in display field `verdict` |
| Current automatic result | Present evidence package's preliminary assessment | Case `verdict` |
| Human decision | Explicit review of a particular case version | Case `finalVerdict` and review record |

The brief's normalised source counts are False 37,155; Misleading 10,745; True 181; Other 147; Blank 4,450. They are not the class distribution of the LLM labels. Blank means a publisher rating was absent. `Other` is not automatically `Unverifiable`. No import mapping changes those meanings.

“Zero failures” in the labelling run means all rows were processed. It does not mean the labels are error-free or have been expert-validated.

## Corpus record contract

| Field | Type / limit | Notes |
| --- | --- | --- |
| `articleId` | String, 1–200 characters | Original stable `article_id`; never generate a new ID silently |
| `title` | String, 1–500 | Publisher title, retained as content |
| `url` | Public HTTPS domain URL | No credentials, local/private hosts or non-default ports |
| `site` | String, 1–200 | Publisher/source name |
| `date` | ISO date/timestamp or null | Publication date; do not substitute today's date |
| `primaryClaim` | String, up to 2,000 | `primary_claim`, or explicitly available `claim_reviewed` |
| `content` | String, up to 30,000 | Full article text when supplied, subject to explicit import limit |
| `verdict` | Literal string, up to 100 | Display label from the existing LLM verdict; not a live conclusion |
| `sourceVerdict` | Optional string, up to 200 | Original site label |
| `normalizedVerdict` | Optional string, up to 200 | Existing normalised source label |
| `llmVerdict` | Optional string, up to 200 | Existing LLM label |
| `trueVersion` | Optional string, up to 5,000 | Existing corrected version; not independently authenticated by import |
| `domain` | Optional string, up to 200 | Existing topic taxonomy |
| `embedding` | Optional finite numeric vector, at most 4,096 dimensions | Must have a declared matching model; import does not generate vectors |
| `embeddingModel` | String when vector supplied | Exact model/version identity to prevent incompatible comparisons |

Import retains these supported fields. Keep the original Parquet/CSV and its manifest in an access-controlled dataset archive if other annotations need preservation; the application is not a lossless archive of every column in `classified_v2`.

The brief says Parquet contains full text and list fields; CSV omits full text. A CSV-only import cannot recreate missing article text. Metadata-only retrieval must be described as such. The application does not fetch all missing article content automatically.

## Prepare batches

The utility runs locally and never uploads data or reads provider keys. CSV, JSON and JSONL use only the Python standard library. Install `pyarrow` in a separate virtual environment only when reading Parquet.

```bash
python3 scripts/prepare_corpus.py /path/to/classified_v2.parquet --output /path/to/private-import-batches
```

For Parquet when the optional dependency is missing:

```bash
python3 -m venv .venv-corpus
source .venv-corpus/bin/activate
python -m pip install pyarrow
python scripts/prepare_corpus.py /path/to/classified_v2.parquet --output /path/to/private-import-batches
```

The output directory must be empty. Each `batch-NNNNN.json` contains `{ "articles": [...] }`, at most 100 records and at most 900,000 UTF-8 bytes. This stays below the API's 1,000,000-byte body limit. `manifest.json` records source SHA-256, output hashes, accepted/duplicate/invalid rows, empty-content counts, truncation counts and limited error details.

CSV, JSONL and Parquet are processed as streams/batches; only one output batch plus deduplication keys is retained in memory. Plain JSON arrays are read as a complete document, so use JSONL or Parquet for a large corpus. Output is staged in a temporary directory and published only after validation succeeds. The source hash is checked again before publication to detect a source file changed during preparation.

By default, invalid rows cause a nonzero exit and no batches are written. Correct the source or explicitly use `--skip-invalid` to permit audited omission. Content longer than 30,000 characters is rejected unless `--truncate-content` is supplied. The latter cuts the imported copy and records the count; it does not change the source dataset. Never describe a truncated import as a complete full-text archive.

Deduplication keeps the first accepted record when a stable ID or canonical URL repeats. The canonical comparison drops fragments and normalises the hostname. It does not deduplicate distinct publishers covering the same rumour; claim-family grouping is a separate evaluation task.

## Import into a workspace

Open **Method & evaluation** and use the prepared-batch import panel:

1. Select the generated `batch-*.json` files, up to 600 files in one selection. Do not select `manifest.json`, the raw CSV/Parquet, or an arbitrary array file.
2. Review the filenames and record counts. The browser checks each JSON object's `articles` array, 1–100 records, and the 1,000,000-byte limit before a request is sent. Full field validation still happens on the server.
3. Confirm that you have permission to import the selected source material into this workspace. This acknowledgement does not grant redistribution rights or substitute for the project's dataset permissions.
4. Start the import. Batches are sent sequentially, and the panel displays actual completed/failed/unconfirmed outcomes.
5. Cancel to stop sending subsequent batches. A request already in flight may finish and be committed; cancellation is not a rollback.
6. Inspect failures and refresh the actual corpus count. A timeout is reported as **unconfirmed**, because the server may have committed before the response was lost. There is no silent automatic retry. Reset a failed/unconfirmed batch only after reviewing its outcome; upserts protect the same owner/article ID from duplicate records but the source copy should remain unchanged.

For a large full-text corpus producing more than 600 prepared batches, import successive selections and retain the source manifest plus completed-batch log. The rate limit and file-selection limit are separate; pause rather than raising limits blindly.

The panel uses `POST /api/corpus/import` with one batch per request from the authenticated application origin. The API is intentionally a same-origin, session-authenticated route; copying an identity header into a generic `curl` command is not a supported production login method. A future unattended importer needs a separately designed service identity and authorisation contract.

Imports are scoped to the signed-in user's namespace. The same `articleId` is upserted within that namespace; it does not overwrite another user's data. Keep an import log containing the prepared batch hash, server response and timestamp. The current API response counts accepted upserts, not newly added unique articles. Compare the actual corpus count before and after import to measure growth.

The HTTP search route uses the D1 FTS5 index to choose up to 500 candidates and then applies the repository's lexical ranking. It returns at most 10 matches and labels the method **lexical**. The pure retrieval module supports optional compatible embeddings, but the deployed HTTP path does not claim semantic search without a query-embedding integration.

Retrieval rank is not truth confidence. An old article that matches a claim may be inapplicable to today's location, date or entities. Retrieved source verdicts are historical annotations and must not automatically become the current case's final verdict.

## Permission, privacy and retention

Confirm permission to store and use the corpus and observe each source's licence and service terms. Public availability is not blanket permission to republish full articles. Import only the amount of text needed for the authorised research purpose. Avoid putting the corpus, user claims, images or provider responses into the public Git repository.

Source pages can change or disappear. Record retrieval times and permitted excerpts; preserve a lawful evidence snapshot if the study needs reproducibility. Never fabricate an archived page or source quote when a URL fails.

## Evaluation isolation

Split by underlying claim family before model development. Keep translations, paraphrases, reposts, multiple publisher checks and near-duplicate screenshots of the same claim in one partition. Freeze temporal cutoffs and use only evidence that was available at the simulated decision time. The `true_version` and article verdict are privileged labels for many tasks: do not accidentally include them in the input when measuring independent claim verification.

See [evaluation](EVALUATION.md) for separate retrieval, sufficiency and verdict benchmarks.
