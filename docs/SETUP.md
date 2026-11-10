# Setup and deployment

## Supported shape

The application is a React/TypeScript App Router application built with Vinext and deployed as a Cloudflare Worker. D1 is required for durable cases, audit records, rate limits and the historical corpus. The supplied hosting manifest binds D1 as `DB` and does not require an R2 bucket.

The intended hosted environment is a private ChatGPT Site with dispatch-owned authentication. A private publication does not make the public source repository private. Keep runtime secrets and user data out of Git.

## Prerequisites

- Node.js 22.13 or newer; CI and the lockfile are the source of truth for the tested toolchain.
- The pnpm version in `package.json` (`packageManager`).
- A writable local directory for `.wrangler/state` and build output.
- Python 3.10+ for optional corpus preparation; `pyarrow` only for Parquet input.
- Provider accounts and credentials only when enabling live investigation.

## Fresh local checkout

You can also extract the supplied complete source ZIP or clone its Git bundle as described in [delivery](DELIVERY.md), then run the install/build commands below.

```bash
git clone https://github.com/vishnusrivardhangollakaram-boop/2511202_CCS_IIMB.git
cd 2511202_CCS_IIMB
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

If Corepack is not installed with your Node distribution, install/activate the exact declared pnpm version through the supported package-manager installation process. Do not discard the lockfile to bypass an installation error.

Apply the committed initial migrations once, in order:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_public_chameleon.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_corpus_fts.sql
pnpm run dev
```

Check for later committed migrations and apply only those not already applied. Local D1 and hosted D1 are different databases. Local imports do not appear in production automatically.

The portable development server prints its URL. The local auth fallback is development-only and identifies a local researcher with review privileges. Bind development to loopback and do not expose that server to an untrusted network. A production build must not acquire a “dev bypass” from an environment variable.

## Runtime configuration

Use an ignored `.dev.vars` file for local Worker bindings. Configure hosted values through the hosting platform's server-side environment/secret settings. Restart/redeploy as required to apply a changed environment revision.

```dotenv
TAVILY_API_KEY="replace-with-your-server-secret"
GEMINI_API_KEY="replace-with-your-server-secret"
GEMINI_MODEL="your-compatible-enabled-model-id"
REVIEWER_IDS="stable-site-user-id-1,stable-site-user-id-2"
```

These strings are placeholders. No credentials are provided. `GEMINI_MODEL` is an explicit deployment choice; the repository does not claim that an untested model is “best.” Use a model available to your account that supports the requested generateContent and structured-output contract; image intake additionally needs image support.

| Setting | Missing or invalid behaviour |
| --- | --- |
| `DB` | API returns storage unavailable; no in-memory fallback pretends to persist cases |
| `TAVILY_API_KEY` | Live mode unavailable |
| `GEMINI_API_KEY` | Live mode unavailable |
| `GEMINI_MODEL` | Live mode unavailable when absent; incompatible model errors are recorded as failed investigations |
| `REVIEWER_IDS` | Hosted users can review their own synthetic cases but cannot approve real cases |

Capabilities indicate configuration presence. They do not prove that credentials are valid, the provider has remaining quota, or the selected model accepts a request. Complete a real smoke test before claiming live readiness.

## Reviewer identity

Sign in to the intended Site and inspect the authenticated user ID from the application's bootstrap response. Add that stable ID to `REVIEWER_IDS`. The Site-scoped ID is the authorisation key; the email and display name are not substitutes. Do not copy identity values from an unrelated Site.

This allowlist grants review capability on the reviewer's own real cases and on cases explicitly handed off by another owner. A handoff shares a case with the whole configured reviewer pool, not one named assignee. General case reads and other mutations remain owner-scoped. The owner can withdraw shared review access; institutional membership and fine-grained assignment are not implemented.

## Hosted identity boundary

Hosted requests use `oai-authenticated-user-id` and `oai-authenticated-user-email` supplied by Sites dispatch. The server rejects missing identity in a production build. The hosting gateway must strip external caller-supplied identity headers and prevent bypassing that gateway.

Do not deploy the Worker to a directly accessible public origin and assume those headers are authenticated. A standalone deployment requires a trusted identity proxy or a reviewed replacement authentication integration. Merely setting a reverse-proxy header from untrusted input is not authentication.

Mutation requests require an exact matching `Origin` and must not be marked cross-site. This is not a public bearer-token API. A future service importer needs an explicit service identity and narrowly scoped authorisation contract.

## Build, migrate, publish

1. Review the diff and ensure no `.env*`, `.dev.vars*`, corpus files or user data are tracked.
2. Run `pnpm run typecheck`, `pnpm test`, Python importer tests and `pnpm run build`.
3. Generate a migration with `pnpm run db:generate` only when the Drizzle schema changes. Inspect its SQL. FTS migration changes must be reviewed explicitly.
4. Test pending migrations on a disposable copy of realistic data. Applied production migrations are immutable.
5. Build and publish the exact reviewed commit through the Site's source/deployment workflow, preserving the Site ID and access policy.
6. Apply production migrations through that supported workflow. A failed release can still have applied a migration; inspect actual state before retrying or rolling back.
7. Verify authenticated bootstrap, a synthetic case, case persistence after reload, review permissions and expected provider readiness.
8. Record commit, migration set, environment revision, deployment result and checks performed.

Do not change a private Site to public to work around an authentication or deployment failure. Do not include build caches, local databases, local environment files or credentials in the source/deployment package.

## Live smoke test

Use a low-stakes, verifiable claim and the intended account. Check returned source URLs, excerpts and timestamps manually. Confirm that provider errors produce a failed/unresolved case rather than a synthetic result. Verify one screenshot and one article URL if those paths will be demonstrated.

The application forwards live-mode text, screenshot content, search queries and selected evidence to the configured Google/Tavily services. Confirm that this processing is permitted for your data and account. Raw screenshot bytes are not retained in the case database, but extracted text and evidence can be stored and provider-side retention follows the provider account's terms/settings.

## Provider references

- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Tavily Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
- [Gemini generateContent API](https://ai.google.dev/api/generate-content)
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)

These links explain provider contracts. They are not evidence that this deployment's keys, billing or selected model were exercised.
