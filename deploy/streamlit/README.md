# Managed PostgreSQL bootstrap

## Live activation for the deployed CCS app

The app is at https://evidence-ai-ccs-iimb.streamlit.app/. The checked-in [live configuration template](live-secrets.example.toml) supplies its exact Google sign-in callback and explicitly selects Groq with `qwen/qwen3.8-27b`. Every `REPLACE_ME` value is a placeholder. Do not save this example unchanged to the hosted app.

Complete these steps in order:

1. Select Neon **Free** and prepare a dedicated PostgreSQL database and apply the bootstrap below. Keep its connection URL private and retain the provider's required TLS parameters.
2. In Google Auth Platform, create a Web application OAuth client with `https://evidence-ai-ccs-iimb.streamlit.app/oauth2callback` as an authorized redirect URI. Configure the consent screen and permitted test users if the client remains in testing. Community Cloud dashboard sign-in does not configure this app's sign-in.
3. Create a Groq **Free** account and a Tavily **Researcher Free** account, then obtain their API keys. Keep Tavily pay-as-you-go disabled and do not upgrade either account. Verify the plan and quotas in each dashboard; a key alone does not identify its billing tier. Generate the cookie secret privately using `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
4. Fill the example locally in an ignored file or directly in Community Cloud **App settings → Secrets**. Save only completed values. Start with empty membership lists, sign in, and copy the application's displayed **Your account ID**. Add the intended reviewer ID to `REVIEWER_IDS`; reviewer membership includes workspace access. Add ordinary researchers to `ALLOWED_USER_IDS`.
5. Verify that the sidebar reports persistent storage and Method reports available live investigation. Create a low-stakes live case, inspect the returned source quotations and URLs, and download its report. Reopen the case after a new authenticated session. A configured key or green presence check alone does not verify provider access or persistence.

This repository does not contain the provider keys, OAuth client credentials, database password, or a populated reviewer identity. Installing a database plugin alone does not configure these settings. Until all connections and the live smoke test succeed, report the deployment as a temporary/manual demonstration.

The selected open model is published on [Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B), while inference runs on [Groq](https://console.groq.com/docs/model/qwen/qwen3.8-27b). A Hugging Face token is not needed for this path. Groq currently labels it Preview. The adapter uses structured JSON and explicit excerpt limits to keep requests small, and never calls another model service on quota exhaustion. Read the [free-mode scope and limits](../../docs/STREAMLIT.md#enable-live-investigation) before presenting a result.

Account setup requires the account owner's sign-in and acceptance of each provider's terms. No API keys, OAuth credentials or billing settings are created by committing this template. Google application sign-in remains required even though Google Gemini is not used for model inference.

## Apply the database schema

[`schema.sql`](schema.sql) initializes the native Streamlit application's five tables, three regular indexes, full-text GIN index and schema revision 1. It contains no credentials and makes no network calls. It is generated from the same SQLAlchemy metadata used by `python -m evidence_streamlit.storage init`.

1. Select the intended managed PostgreSQL database and branch, preferably a dedicated application database. In Neon, use that database's SQL Editor or the connected Neon SQL tool. Use an administrator role permitted to create these tables and indexes.
2. Run the complete contents of `schema.sql` as one script. It wraps the bootstrap in a transaction. Running it again is safe for the same compatible schema; it does not upgrade or repair incompatible existing tables. An existing revision other than 1 causes the transaction to fail.
3. Confirm `SELECT version FROM ccs_schema_revision;` returns only `1`. Keep the connection URL private and enter it directly in the deployed application's secret settings as `DATABASE_URL`, with the provider's required TLS options. The application's runtime role needs schema access; SELECT/INSERT/UPDATE on `ccs_cases` and `ccs_corpus`; SELECT/INSERT on `ccs_audit`; SELECT/INSERT/UPDATE/DELETE on `ccs_rate_limits`; and SELECT on `ccs_schema_revision`. Runtime schema-creation privileges are unnecessary.
4. Complete OIDC, account membership and provider configuration using the [Streamlit deployment guide](../../docs/STREAMLIT.md). Verify persistence before the first live investigation. Applying SQL alone does not enable sign-in or paid providers.

Tables are deliberately unqualified, just like the Python initializer. The SQL editor and the application's connection must resolve the same schema through `search_path`. A custom private schema therefore requires matching connection/role configuration. The script creates no users, grants no public or API access, and does not import application data. Existing grants on a shared schema remain the database operator's responsibility.

Do not paste database passwords, provider API keys or OAuth client secrets into chat, GitHub or this file. No secret is needed to regenerate or inspect the script.

```bash
python scripts/generate_streamlit_schema.py
python scripts/generate_streamlit_schema.py --check
```

Use the project's pinned Python dependencies. Native tests check that the committed artifact matches current metadata. When `TEST_DATABASE_URL` identifies the disposable PostgreSQL service, integration tests apply the script twice in an isolated test schema, verify its indexes/revision, and exercise the normal runtime without automatic initialization.
