# Streamlit deployment and operations

The repository contains a native Python entry point, `streamlit_app.py`, for Streamlit Community Cloud. The React/Vinext application remains in the repository and has a separate deployment path. Streamlit runs the Python application directly; it does not build, embed or proxy the React application.

The deployed Streamlit application is available at **[evidence-ai-ccs-iimb.streamlit.app](https://evidence-ai-ccs-iimb.streamlit.app/)**. It currently uses temporary session storage with no OIDC, PostgreSQL or live-provider configuration. Synthetic examples, manual investigations, synthetic human review and report exports are available. Live investigation, real-case approval and persistent shared work require the configuration below. Download reports before leaving the session.

The React/Vinext deployment remains separate. Its authentication, database and provider settings are not inherited by Streamlit.

## Choose the operating mode

| Mode | Configuration | Behaviour |
| --- | --- | --- |
| Temporary demonstration | No secrets required | Synthetic cases, manual text cases and evidence work within the current session. Own synthetic cases can be reviewed. No paid provider calls or shared persistent records. |
| Authenticated temporary workspace | OIDC configuration and explicit user membership | Authorised users can work in a session. Paid live calls remain unavailable until PostgreSQL is configured. Closing/resetting the session still loses temporary records. |
| Persistent research workspace | OIDC, membership, external PostgreSQL and initialised schema | Cases, audit snapshots, corpus and rate limits use PostgreSQL. Shared reviewer handoff becomes possible. Live investigation still requires separate provider configuration. |

`REQUIRE_LOGIN` defaults to `false`. Set it to `true` for a deployment intended only for signed-in members. App visibility in Community Cloud, application sign-in and application membership are separate controls. Adding API keys does not enable anonymous paid calls.

Temporary records are scoped to Streamlit Session State. They survive ordinary widget reruns, but are not a durable archive: a disconnected/replaced browser session, refresh, sign-in transition, server restart or redeployment can lose them. Download reports before leaving. The application does not use a Community Cloud local SQLite file as persistent production storage.

## Deploy on Community Cloud

1. Confirm that `main` on [the project repository](https://github.com/vishnusrivardhangollakaram-boop/2511202_CCS_IIMB) contains `streamlit_app.py`, `evidence_streamlit/`, `requirements.txt` and `requirements-streamlit.lock.txt`. Review the checks for that commit.
2. Sign in at [Streamlit Community Cloud](https://share.streamlit.io/) with the account permitted to deploy the GitHub repository. Grant the repository access required by the dashboard if it is not already connected.
3. Choose **Create app**, then **Yup, I have an app**. Enter these values, even if autocomplete does not suggest them:

   | Field | Value |
   | --- | --- |
   | Repository | `vishnusrivardhangollakaram-boop/2511202_CCS_IIMB` |
   | Branch | `main` |
   | Main file path | `streamlit_app.py` |
   | Python version, under Advanced settings | `3.12` |
   | App URL | Choose an available subdomain, or accept the assigned one |

4. For a temporary synthetic demonstration, leave secrets empty. For a configured workspace, enter the TOML secrets described below in **Advanced settings**. Keep credentials out of GitHub and screenshots.
5. Save the settings and deploy. Watch the dependency-install and app logs. `requirements.txt` includes the pinned Python dependencies in `requirements-streamlit.lock.txt`; both files must be available on the selected branch. No Node build command or Cloudflare D1 binding is required for this entry point.
6. Open the actual assigned URL, check the intended visibility, and complete the readiness checks below. Save that URL and the deployed commit in the release record.

The dashboard's selected branch determines what source is deployed. A later change to that branch can update the app. Keep intentional code releases separate from secret/account changes, and verify the resulting app after either operation. See Streamlit's [deployment instructions](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy), [dependency handling](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/app-dependencies) and [secrets management](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/secrets-management).

## Run locally

Use Python 3.12 in a dedicated virtual environment, from the repository root:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m streamlit run streamlit_app.py
```

On Windows, activate the environment with `.venv\Scripts\Activate.ps1` in PowerShell. Open the local URL printed by Streamlit, normally `http://localhost:8501`.

Start with the commented [secrets template](../.streamlit/secrets.example.toml). For local configuration, copy it to the ignored `.streamlit/secrets.toml` and uncomment only the settings being used. For hosted configuration, put the completed TOML structure in the app's Community Cloud secrets settings. Do not commit the real file. The native app reads top-level settings from environment variables or Streamlit secrets; a value in Streamlit secrets takes precedence. Its OIDC configuration is read from `[auth]` in Streamlit secrets.

## Configuration reference

| Setting | Purpose and missing behaviour |
| --- | --- |
| `REQUIRE_LOGIN` | Boolean; `false` permits a temporary anonymous demonstration. `true` requires configured sign-in. |
| `ALLOWED_USER_IDS` | Explicit members of the authenticated workspace. Accepts a comma-separated string or TOML string array of the derived `oidc:…` IDs. |
| `REVIEWER_IDS` | IDs permitted to review real cases; also grants workspace membership. An ordinary member cannot acquire this role from a form field. |
| `DATABASE_URL` | Optional external PostgreSQL connection URL. Missing means temporary session storage. Setting it requires OIDC configuration and an initialised database; storage failures do not silently fall back to an apparently persistent session. |
| `TAVILY_API_KEY` | Server-side search/extraction credential. Required for live investigation. |
| `MODEL_PROVIDER` | `groq` for the free-tier setup, or `gemini`. Omitted/empty retains legacy Gemini configuration compatibility. Providers never fall back to each other. |
| `GROQ_API_KEY` | Server-side Groq credential; required when selecting `groq`. |
| `GROQ_MODEL` | Explicit `qwen/qwen3.8-27b`; the Groq adapter supports this text/image model and its structured-output contract. |
| `GEMINI_API_KEY` | Server-side Gemini credential; required only when selecting `gemini`. |
| `GEMINI_MODEL` | Explicit compatible Gemini model identifier; required only when selecting `gemini`. |
| `[auth]` | Single-provider Streamlit OIDC configuration: `redirect_uri`, `cookie_secret`, `client_id`, `client_secret`, `server_metadata_url`. |

Presence checks indicate configured values, not successful authentication, valid provider billing, available quota or a healthy database. Test those connections before describing the deployment as live-ready.

All top-level application values must appear **before** `[auth]` in TOML. Values written below a table header belong to that table until another header is declared. A provider key accidentally nested inside `[auth]` will not configure the provider.

## Set up sign-in and membership

The app uses Streamlit's native `st.login()`, `st.user` and `st.logout()` with one OIDC provider. It consumes the verified identity's issuer and subject, not an email supplied through a text box. See the official [Streamlit authentication guide](https://docs.streamlit.io/develop/concepts/connections/authentication).

1. Register a web application with the identity provider you control. Configure the callback to exactly `https://YOUR-ASSIGNED-APP.streamlit.app/oauth2callback`. Use `http://localhost:8501/oauth2callback` for a separately permitted local callback. A different hostname or port requires its corresponding registered callback.
2. Obtain that application's client ID, client secret and OIDC discovery/metadata URL. Generate a strong random cookie secret, for example with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Store the generated value privately.
3. Configure the five `[auth]` values in Streamlit secrets. Start with empty membership lists and `REQUIRE_LOGIN = true` while setting up private access.
4. Sign in. An authenticated account without membership is shown its account ID but cannot open the workspace. Copy that ID from **Your account ID** in the sidebar or the access message.
5. Add the intended researcher ID to `ALLOWED_USER_IDS`, or the intended reviewer ID to `REVIEWER_IDS`. Save secrets and reload/restart as needed. Check both an allowed and an unlisted account.

The application ID is `oidc:` followed by the SHA-256 hash of `issuer + "\0" + subject`. The issuer and subject are the verified OIDC claims. Use the ID displayed by this app; an email address, a ChatGPT Site ID and an OIDC subject alone are not interchangeable. Changing identity provider or issuer can change ownership IDs and needs an explicit migration decision.

The app requires usable `iss`, `sub`, `exp` and `iat` claims and checks expiry. An expired or incomplete identity is stopped with a sign-in refresh prompt. Membership and review privileges are evaluated separately from successful sign-in. The native app is configured for the single provider in `[auth]`; adding named provider subsections alone does not add provider selection to its UI.

## Enable PostgreSQL persistence

Use an external PostgreSQL service reachable from the deployed app. Obtain its approved connection URL, TLS settings, connection limits and backup policy. The accepted URL schemes are `postgres://`, `postgresql://` and `postgresql+psycopg://`; the adapter uses Psycopg. Follow the database provider's TLS requirements, including certificate verification where available.

The app does not create or change database tables when a visitor opens it. Initialise the schema once from a trusted local/administrative environment using the same checked-out source and installed requirements:

```bash
python -m evidence_streamlit.storage init
```

Supply `DATABASE_URL` privately through the administrator's environment or local `.streamlit/secrets.toml`. Do not paste credentials into the command line, source code or a support ticket. Use a role with schema creation privileges for this step; the running app can use a separate role with the table/index access required by its operations.

Alternatively, apply the generated [PostgreSQL bootstrap SQL](../deploy/streamlit/schema.sql) in the managed provider's SQL editor. The [activation guide](../deploy/streamlit/README.md) includes execution checks and an app-specific configuration template. The SQL is generated from the same runtime metadata and is checked for drift and exercised against PostgreSQL in CI.

The native schema stores `ccs_cases`, `ccs_audit`, `ccs_corpus`, `ccs_rate_limits` and `ccs_schema_revision`. Initialisation also creates the PostgreSQL GIN index `ccs_corpus_fts` for lexical full-text candidates. Startup checks schema revision 1. The init command bootstraps the schema; it is not a generic migration runner for future versions. Review later schema changes and take a backup before applying them.

Then configure the hosted `DATABASE_URL`, OIDC settings and membership. Confirm a case survives a new authenticated browser session and an app restart. Temporary anonymous records are not copied into PostgreSQL automatically when persistence is enabled.

Configure database backup/restore and retention outside the app. JSON and printable HTML case exports are useful review artifacts, not a complete database backup. Audit snapshots can contain original claims and evidence as well as current case rows; account for both when defining retention or an authorised deletion procedure.

## Enable live investigation

For the free-tier setup, set `MODEL_PROVIDER = "groq"`, `GROQ_API_KEY`, `GROQ_MODEL = "qwen/qwen3.8-27b"` and `TAVILY_API_KEY` as top-level server secrets. Select Free in Groq, Researcher Free in Tavily (pay-as-you-go disabled), and Free in Neon. The app cannot determine an account's billing tier from a key, so verify these settings in each dashboard. Do not enable a paid plan or automatic top-ups to bypass quotas.

The existing Gemini adapter remains available only through its own selection and credentials. Groq errors, exhausted quotas and invalid responses never trigger a Gemini call. The native Groq adapter does not change the separate React application's Gemini integration.

Every live request, including a free-tier request, requires verified OIDC identity, explicit membership and working PostgreSQL persistence. Durable storage keeps the per-user request limits across browser sessions. A signed-in reviewer is a member as well; an anonymous or session-only workspace cannot use live providers even when keys exist.

Live submission sends text, screenshots where selected, search queries and relevant source content to the selected Groq or Google model service and Tavily. Confirm that this processing is permitted for the material and accounts used. The app does not save raw screenshot bytes as part of its stored case, but extracted text, source excerpts and case history can be retained. Provider-side processing and retention follow the provider accounts' terms and settings.

Use a low-stakes claim for the first smoke test. Inspect source URLs, quotation provenance, dates, policy checks and any warning about missing or truncated sources. A configured key is not evidence of a successful live run. Provider failures remain visible; the app does not replace them with a synthetic result.

Groq's Qwen model is currently a preview service. The adapter uses strict structured JSON, instruct mode, at most 1,536 output tokens and a conservative 6,000-unit input allowance (UTF-8 bytes for text/schema plus overhead; 2,048 units per image). This is not exact tokenizer accounting or a guarantee against account-wide quotas. Oversized submitted claims are rejected, never silently shortened. Article intake may use an initial excerpt, with an explicit note. Evidence analysis selects at most three candidate sources and at most the first 720 UTF-8 bytes of each passage; fewer sources may fit when claims or URLs are long. Only passages actually provided to the model can ground its quotations. The interface and report identify this limited scope. Full-document investigation requires opening the original records and adding manual evidence; do not describe the free workflow as exhaustive.

Rate limits and exhausted credits produce a visible error. No hidden retries, paid fallbacks or synthetic replacements occur. Text and image contract tests use mocked responses; a real authenticated live smoke test is still required before activation can be reported complete.

## Corpus and existing data

The project's real 52,678-article corpus is not bundled or automatically loaded. Prepare authorised source data with [the existing corpus preparation CLI](DATA.md), for example:

```bash
python scripts/prepare_corpus.py data/authorised-corpus.jsonl --output data/prepared-corpus
```

The CLI accepts CSV, JSONL, JSON or Parquet; Parquet requires `pyarrow`. Inspect its manifest before uploading `batch-*.json` files in **Corpus → Import prepared corpus batches**. Do not upload the manifest itself. Preserve source labels and provenance; a previous publisher/LLM label is not the current app's verdict.

The Streamlit workspace accepts prepared batch JSON, rather than treating an arbitrary CSV or Parquet upload as evidence. Each batch contains an `articles` array; importing the same owner/article ID updates that article. Imported-row counts therefore include updates. Check actual corpus counts and import results before retrying a batch with an uncertain outcome.

The UI accepts at most 100 files at a time, each at most 10 MB, and a combined selection of at most 20 MB in session mode or 60 MB with PostgreSQL. It writes sequential chunks of at most 100 articles, each subject to the backend's 1 MB bound. The preparation CLI emits smaller compatible batches. An import is not one transaction across all selected files: earlier successful batches remain if a later batch fails. The permission checkbox confirms the operator's authorisation to process the material; it does not grant an application role.

Temporary corpus storage is limited to 5,000 articles and 20 MB per session, with a further aggregate session memory bound. Use authenticated PostgreSQL for a full authorised archive. Both stores select at most 500 candidates within the current owner's corpus: session storage uses a keyword prefilter, while PostgreSQL uses its full-text index. The workspace then applies BM25 lexical ranking and returns at most 10 matches. The ranker gives the primary claim three occurrences and the title two occurrences alongside the article content. BM25 statistics are calculated over the candidate set, not the entire archive.

The pure retrieval module can combine compatible precomputed vectors when explicitly supplied by a caller, but the shipped workspace supplies no query embedding and returns lexical results. It does not generate embeddings or demonstrate semantic-retrieval accuracy. Retrieval scores measure relative relevance, not truth or evidence sufficiency.

The retained React app's D1 database and this app's PostgreSQL/session stores are separate. Streamlit does not run the D1 SQL migrations and does not read the existing ChatGPT Site's database. There is no automatic migration of cases, ownership, reviews, audit history or corpus data. Existing case report exports are not a general database-import format. Plan and test an explicit transfer if historical D1 records must be preserved.

## Native scope and differences

| Area | Streamlit implementation |
| --- | --- |
| Evidence policy | Native Python port of `ccs-sufficiency-1.0.1`; checked-in reference scenarios and policy vectors support parity testing. The score is a policy index, never a truth probability. |
| Investigation | Synthetic, manual and configured live workflows, evidence inspection, reassessment and bounded retrieval. |
| Review | Own synthetic review works in a temporary session. Real-case review requires a configured reviewer. Cross-user handoff needs authenticated PostgreSQL storage. |
| Persistence | Explicit session-only or external PostgreSQL mode; no durable local filesystem assumption. |
| Authentication | Native single-provider OIDC plus explicit membership; does not trust Sites identity headers. |
| Historical retrieval | BM25 ranking of owner-scoped candidates with visible source records; no deployed semantic vector index. |
| Message wording cues | Native `ccs-message-signals-1.0.0` rules inspect English phrases only; advisory results do not alter evidence, the gate, scores or verdicts. |
| Reports | Downloadable JSON and printable HTML case reports; exports do not back up all storage or revoke previously shared copies. |
| Interface/API | Native Streamlit forms and reruns. The React `/api/*` HTTP endpoints and React UI are not hosted by this Python entry point. |

Policy parity tests concern the supplied evidence package and authored fixtures. They do not establish real-world factual accuracy, source authenticity, multilingual reliability or a trained misinformation model. Screenshot understanding is not reverse-image investigation or audio/video forensic authentication. Live credentials, a full corpus import, institutional review and production load/restore exercises require their own recorded validation.

Wording cues scan at most 8,000 characters of submitted text, or the extracted claim when no submitted text is available. The UI identifies that scope. JSON exports include optional `advisorySignals` metadata and printable HTML includes the cues. A match is not proof of falsehood, intent or fraud; no match does not mean that a message is safe or true.

## Limits and verification

Native cases are bounded to 50 evidence records, 20 reviews, 200 activity events and a 1 MB serialized case. Lists show the latest 100 cases. Temporary storage also has a 48 MB aggregate state bound, including audit snapshots; it permits at most 100 cases. Export and resolve the storage limit before continuing instead of treating an interrupted save as successful.

The per-user fixed hourly request limits are 30 case creations, 15 live investigations, 60 evidence additions, 30 reviews, 30 handoff changes, 1,000 corpus batch writes and 120 corpus searches. The application allows at most three completed live retrieval attempts per case. Failed provider calls can still consume quota and money. Configure provider-side budgets; request counts are not a currency spending cap.

The native provider adapter bounds an investigation to 85 seconds, with individual requests limited to 25 seconds and at most five provider HTTP calls. PNG/JPEG/WebP screenshot content is limited to 2,000,000 decoded bytes and checked against its declared file signature. These controls do not establish capacity under concurrent production load.

From the activated Python environment, run:

```bash
python -m unittest discover -s tests_streamlit -p 'test_*.py' -v
python -m unittest discover -s tests -p 'test_prepare_corpus.py' -v
```

The native suite includes policy/reference parity, retrieval, wording cues, provider mocks, identity rules, workspace/storage transitions and Streamlit widget tests. Without `TEST_DATABASE_URL`, its PostgreSQL integration tests are explicitly skipped; local SQLite/session checks still run. To include those integration tests locally, set `TEST_DATABASE_URL` in the test process to a disposable PostgreSQL database, then run the same command. These tests initialise schema and write test records, so never point this variable at the application database or use production credentials.

The [GitHub Actions workflow](../.github/workflows/ci.yml) provisions a disposable PostgreSQL 16 service, waits for its health check and supplies `TEST_DATABASE_URL` to the Python 3.12 job. Its native checks include dependency consistency, Ruff lint/format, compilation, the full native test discovery and dependency advisory audit. PostgreSQL tests exercise actual transactions, version conflicts, audit snapshots, handoff/withdrawal, committed rate limits, full-text search and owner isolation. The separate React job preserves the existing JavaScript checks and corpus-preparation tests.

Keep the actual test output and source revision; a workflow definition is not evidence that its latest run passed. The React tests and the Python tests cover different runtime surfaces, and a successful React build does not validate native Streamlit widgets. Even a successful disposable PostgreSQL test run does not establish that the hosted database URL, TLS policy or credentials work. Provider mocks do not exercise paid live credentials.

## Readiness checks after deployment

1. Record the real app URL, deployed Git commit, Python version, dependency lockfile revision and operating mode. Record whether login, persistence and providers are configured without recording secret values.
2. Open a synthetic example. Inspect its sources and sufficiency checks, submit a synthetic review and download a report.
3. Open a manual text case with no evidence. Confirm that it remains unresolved and does not claim a successful web investigation.
4. In temporary mode, confirm the warning about session-only work. Do not claim persistence from an ordinary Streamlit rerun.
5. For authenticated mode, verify the intended account ID, an unlisted account's denial and absence of anonymous paid calls. For real review, test both member and reviewer permissions.
6. For PostgreSQL mode, verify a record after a new session, confirm owner isolation and test a handoff/withdrawal with a separate reviewer account. Complete a backup restoration exercise before relying on recovery.
7. For live mode, perform and record a credentialed smoke test. Inspect the actual evidence; provider mocks and synthetic fixtures are not a substitute.
8. Confirm app visibility and permitted data categories. A private GitHub repository does not itself establish the app's viewer policy.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Entrypoint not found | Correct repository, `main` branch and exact root path `streamlit_app.py`; confirm the file is on that branch. |
| Dependency install fails | Python 3.12 and both requirements files are present; inspect Cloud logs. Do not delete pins to conceal the failure. |
| Login callback fails | App URL, callback path, provider registration and `[auth].redirect_uri` match exactly. |
| Verified identity cannot enter | Copy the displayed `oidc:…` ID into the correct membership list, before `[auth]` in TOML; reviewer status requires `REVIEWER_IDS`. |
| Sign-in repeatedly expires | Check the provider's returned issuer, subject, issue time and expiry claims, then establish a new session. Do not bypass expiry checks. |
| PostgreSQL unavailable/schema required | Database URL/TLS/network access, credentials and schema-init result. The app does not perform DDL during requests. |
| Case disappeared | Determine whether it was created in a temporary session or a different identity; session mode does not promise durable recovery. |
| Live mode unavailable | Verified membership, initialised PostgreSQL, all three provider settings and compatible model access. Check provider quotas separately. |
| First screenshot investigation failed | Raw image bytes are not retained. Open a new case and upload the screenshot again; retry cannot reconstruct the original image. |
| Corpus count smaller than imported rows | Duplicate IDs update existing rows; also inspect failed batches and session limits. |
| Shared review queue empty | Requires persistent storage, a configured reviewer, an owner's active handoff and a pending review. |

For application policy, evaluation and review guidance, use [sufficiency](SUFFICIENCY.md), [evaluation](EVALUATION.md) and [reviewer guidance](REVIEWER_GUIDE.md). Their D1/HTTP-specific operational instructions apply to the React deployment; use this guide for native Streamlit storage and hosting.

## Official references

- [Deploy a Community Cloud app](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy)
- [Community Cloud dependency files](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/app-dependencies)
- [Community Cloud secrets settings](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/secrets-management)
- [Streamlit OIDC authentication](https://docs.streamlit.io/develop/concepts/connections/authentication)
- [Streamlit Session State](https://docs.streamlit.io/develop/concepts/architecture/session-state)

These references describe platform behaviour. They do not demonstrate that this deployment has completed, that its credentials work, or that a factual-accuracy benchmark has been measured.
