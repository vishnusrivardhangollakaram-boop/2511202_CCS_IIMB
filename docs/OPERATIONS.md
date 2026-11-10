# Operations runbook

## Ownership and release record

Name an application owner, a deployment operator, a data owner and a reviewer-policy owner before an institutional pilot. One person can cover several roles for a research demo, but record who is responsible for credentials, restoration, retention and disputed conclusions.

For every release record the commit SHA, migration set, environment revision, Site audience, check results, synthetic regression report and whether a real provider smoke test was performed. Keep “adapter test passed” distinct from “live provider exercised.”

## Startup checks

1. Confirm the private hosting boundary is active and unauthenticated case/corpus API calls are rejected. The application-level health endpoint intentionally exposes only readiness and policy metadata.
2. Confirm D1 is bound as `DB` and pending migrations completed.
3. Open bootstrap and verify actual configuration flags and imported corpus count.
4. Create a synthetic case, reload it and confirm persistence.
5. Verify that an unlisted hosted reviewer cannot approve a real case.
6. If live mode is configured, run a low-stakes smoke test and inspect returned evidence manually.

The bootstrap readiness flag checks configuration presence. It is not a provider health probe. A paid-provider account can be configured and still have an invalid key, no quota, an unavailable model or an outage.

## Useful signals

| Signal | Interpretation and response |
| --- | --- |
| Rising API 503 responses | Check D1 binding, migration state, deployment health and provider configuration; use correlation IDs |
| Live cases marked failed | Inspect provider status/account quota outside the app; do not log or expose raw upstream bodies |
| Sustained 429 responses | Check actual user activity and provider budgets before changing limits |
| Cases stuck investigating | Check whether the run interrupted; allow the stale lock window to expire and inspect the saved case before retrying |
| Increased human-review rate | Could indicate a new domain, missing source coverage, stricter policy or real uncertainty; do not lower thresholds automatically |
| Increased unsafe passes in reviewed cases | Stop automatic use for the affected domain, preserve examples and investigate the policy/adapter |
| Corpus count differs from source rows | Inspect import audit counts, duplicate IDs, upserts and omissions |
| Search misses imported records | Check owner namespace, FTS migration/triggers, query tokens and index consistency |

Current application logs intentionally contain failure class and correlation ID, not claim bodies, keys, screenshots or raw model responses. Add monitoring only with a clear data-minimisation policy. Avoid high-cardinality labels containing user IDs or claim text in public metrics.

## Bounds and cost control

Live runs are bounded by a total provider deadline, per-call timeouts, maximum source counts, maximum content lengths, request body limits and per-user rate windows. The application permits at most three completed live retrieval attempts per case. Failed requests can still consume provider credits and rate-limit capacity.

The provider adapter currently performs two bounded search requests, handles at most ten distinct candidate sources and limits evidence extraction/model input. It warns when content is partial or truncated. Subsequent retrieval attempts retain the existing claim and atomic parts instead of silently changing the question. Do not increase these limits without measuring runtime, cost and worker-resource effects.

Set provider-side budget alerts and quotas in the provider accounts. Application rate limits are one control; they are not a hard currency spending cap. The current case-list view is limited to the latest 100 cases; the store retains older cases until an operator applies the chosen retention policy.

## Provider failure

1. Keep the case's failed/interrupted status and original evidence visible.
2. Check provider status, account quota, model access and environment revision.
3. Correct configuration without placing a key in a ticket, screenshot or repository.
4. Retry a low-stakes case once after the dependency recovers.
5. If it fails again, retain the failure and use manual evidence or a clearly selected synthetic demonstration. Do not present the latter as a successful live run.

An extraction HTTP 200 can still contain only failed URLs. The adapter checks usable results, not just status. A redirect/canonical-URL mismatch can be rejected; paste the article's relevant text or use the final original URL after checking it rather than weakening URL validation blindly.

## Database backup

The base application tables are `cases`, `audit_events`, `corpus_articles` and `rate_limits`. `corpus_search` is a derived FTS5 virtual table with triggers. Database access credentials and provider secrets should not be copied into data exports.

**Do not assume a whole-database SQL export will handle virtual tables.** Cloudflare documents limitations for export of databases containing virtual tables. Use an operator-supported backup/restore method for the base tables, preserve the deployed schema/migration history, and reconstruct the derived search index. See [D1 import/export guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

A backup plan should:

- Define the permitted backup destination, encryption, access controls, frequency and expiry.
- Quiesce writes or use a supported consistent snapshot so cases and audit events correspond.
- Export base-table data with original IDs and versions.
- Retain the exact migration/commit version separately.
- Record table counts, export hashes and timestamps.
- Verify that the export excludes provider credentials and local configuration.
- Restore periodically into a separate private environment and record the result.

The UI's case report export is useful for a case review. It is not a complete database backup and does not replace base-table/audit restoration testing.

## Restore exercise

1. Provision a separate private recovery database/application; do not test restoration over the live database.
2. Apply the exact compatible schema, including FTS structures and triggers, using tracked migrations.
3. Import the authorised base-table snapshot. Preserve primary keys, owner IDs, case versions and audit associations.
4. Rebuild the derived FTS index under maintenance control after base corpus data has been restored:

```sql
INSERT INTO corpus_search(corpus_search) VALUES('rebuild');
```

5. Compare base-table counts and a sample of case/evidence/review snapshots against the backup manifest.
6. Test an authorised user, an unauthorised user, a stale mutation, a reviewed case and a corpus search.
7. Record the time and result. Establish an RPO/RTO based on the measured exercise; this repository does not claim an untested recovery SLA.

The SQL shown is a derived-index repair operation, not a complete restore script. Run it only with appropriate operator access against the intended database. Do not replay initial migrations on a database where they have already been applied.

## Retention and deletion

There is no automatic case-retention policy or user-facing case deletion route in this version. Decide the retention period and permitted data categories before importing real submissions. The policy should cover cases, original URLs/text, evidence excerpts, reviews, audit snapshots, backups and provider-side processing.

For a permitted deletion, use a reviewed operator procedure that identifies the exact owner and case IDs, removes associated application records consistently, accounts for backups and logs, and preserves only the legally/ethically required audit metadata. A case's current payload and its audit snapshots can both contain the original claim. Deleting only the visible case row is not complete erasure.

The database audit is append-only through the application API, but database administrators can modify storage. It is not immutable external evidence or a tamper-proof ledger. Export/sign records separately if an institutional policy requires that property.

## Rollback

Before rollback, inspect whether the failed deployment applied migrations. Rolling back application code does not undo schema changes. Prefer backward-compatible schema migrations and a forward fix for data-shape changes. Never edit an applied migration to make its file look like the old state.

Select the previously verified source/deployment version, confirm compatibility with the current schema, preserve access policy and secret revision deliberately, then repeat startup checks. If data restoration is needed, follow the separate recovery procedure with a documented maintenance window and loss assessment.

## Incident triage

For suspected credential exposure, revoke/rotate the affected provider secret through the provider's official controls, update the hosted secret, redeploy and verify. Do not put the old or new key in Git history. Review provider usage and access logs available to the account owner.

For suspected cross-user access or forged identity, restrict access immediately and inspect the gateway/origin boundary. Preserve relevant correlation IDs and snapshots without broadening exposure. Treat a failed authorisation test as a release blocker.

For a harmful or incorrect conclusion, retain the evidence package, policy/model version and reviewer history, mark the finding disputed in the operating process, and investigate the specific extraction, source, sufficiency or human-review failure. Do not silently overwrite the record to hide the mistake.
