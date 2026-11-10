# Verification record and interpretation

The repository includes automated regression tests, a synthetic policy evaluation and build/type checks. Release-specific outputs belong in `docs/validation/` where available. The commit and command output are the evidence for what was actually run; a checklist in documentation is not itself a completed test.

See the [recorded release checks](validation/release-validation.json) and [synthetic policy results](validation/synthetic-evaluation.json) for the checks actually performed in this implementation.

The [10 November hosted readiness record](validation/2026-11-10-hosted-readiness.json) identifies the exact source, deployed version, environment revision and migration set checked. It adds deployed storage readiness and denial of identity-free application access. It does not redate the earlier automated checks or establish a signed-in production walkthrough.

## Checks

| Check | Command | What it establishes |
| --- | --- | --- |
| Static typing | `pnpm run typecheck` | Type consistency within the compiled TypeScript surface |
| Formatting | `pnpm run format:check` | Consistent formatting on the repository's configured authored-source paths |
| Application regressions | `pnpm test` | Behaviour asserted by the Node test suites, including the local SQLite/D1 test adapter where used |
| Corpus CLI | `python3 -m unittest discover -s tests -p 'test_prepare_corpus.py' -v` | Validation, provenance mapping, deduplication, bounded batching and explicit omission/truncation behaviour |
| Synthetic policy evaluation | `pnpm run evaluate` | Agreement with authored fictional scenario expectations |
| Production build | `pnpm run build` | The configured application can produce a deployable bundle |
| Dependency advisory audit | `pnpm audit` | Known advisories available to the audit service for the installed/locked dependency graph at that time |
| Browser walkthrough | Manual/automated browser QA | Observed UI behaviour on the tested pages and viewport sizes |
| Live provider smoke test | Explicit credentialed investigation | Only the tested account/model/request at that time |

## Evidence that is not supplied by those checks

- Real-world factual accuracy on unseen claims.
- Calibration of a truth/confidence probability.
- Accuracy across languages, domains or manipulated-media formats.
- Load capacity, uptime SLA or a measured restoration RPO/RTO.
- External penetration testing or independent security certification.
- Successful paid-provider calls unless a dated live-test record explicitly says so.
- Import of the entire corpus unless its manifest, server import record and actual count establish that.

## Release notes template

```text
Commit:
Deployment/version:
Migration set:
Environment revision (no secret values):
Typecheck result:
Test suites and totals:
Python importer tests:
Synthetic evaluation report:
Build result:
Dependency advisory audit result and date:
Browser pages/viewports and observed results:
Live provider test performed? If yes, date/model/result:
Corpus imported? If yes, authorised dataset hash/count:
Known limitations/blockers:
```

Do not mark a task complete from intention alone. Attach or reference the actual result, and keep a failed or skipped check visible with its reason.
