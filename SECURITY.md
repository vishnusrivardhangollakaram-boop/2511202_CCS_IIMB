# Security policy and threat model

## Deployment assumptions

This application uses trusted Sites dispatch identity and private hosting access. Its API must not be exposed directly to the public with caller-controlled identity headers. Production identity is mandatory; the local researcher fallback is compiled for development and is not a production environment toggle.

Cases and corpus entries are scoped to their owner. Real-case review additionally requires `REVIEWER_IDS`. An owner can explicitly hand a case to the configured reviewer pool; separate review routes enforce that consent and withdrawal. Handoff shares with all configured reviewers, not an individually assigned person. The application does not implement a cross-institution membership directory or mandatory independent second approval.

## Protected assets

- User claims, submitted URLs, extracted screenshot text and evidence excerpts.
- Case versions, human decisions and audit snapshots.
- Historical corpus content and source licences.
- Provider credentials, account quotas and model configuration.
- The integrity of the distinction between synthetic, manual and live investigations.

## Main threats and controls

| Threat | Implemented boundary | Residual risk / operator responsibility |
| --- | --- | --- |
| Forged identity | Production routes require gateway-supplied identity | A directly exposed origin or proxy that trusts caller headers defeats this assumption |
| Cross-user case access | Owner predicate on general case/corpus reads and writes; explicit handoff consent plus reviewer checks on separate review routes | Review schema/query changes and test every new route; prior authorised exports cannot be revoked |
| Unauthorised review | Server-side reviewer allowlist; own demo review only by default | Reviewers can still make wrong judgments; stronger separation of duties is a future institutional design |
| CSRF | Exact same-origin mutation checks plus fetch-site checks | An XSS vulnerability in the same origin would bypass this layer |
| Stored XSS | React text rendering and escaped report output | Do not introduce raw user HTML, unsafe Markdown or script interpolation |
| SQL/FTS injection | Parameterised SQL; quoted FTS tokens | New hand-built queries need review |
| SSRF through URL intake | Public HTTPS validation; fixed provider domains; no arbitrary Worker-side URL fetch | The extraction provider's network isolation and terms remain relevant |
| Prompt injection in sources | Sources treated as untrusted data; structured output validation; deterministic gate | Model stance/quality/context judgments can still be manipulated or wrong |
| Fabricated model citations | Source-index and quote checks against returned material | A matching quote does not establish source authenticity or factual truth |
| Provider outage or malformed output | Time/size limits, schema validation, explicit failed state | Configured credentials are not proof of service availability |
| Resource/cost exhaustion | Body limits, source/run budgets and durable rate limits | Provider-side spending caps and workload capacity validation remain required |
| Concurrent conflicting decisions | Case version compare-and-swap and atomic audit write | Reviewers must reconcile stale drafts after a conflict |
| Demo results mistaken for research | Explicit scenario selection and synthetic origin labels | Presenters and exported reports must preserve those labels |
| Audit tampering | No update/delete audit route; transactional application writes | Database administrators still control storage; this is not a cryptographic ledger |
| Corpus leakage | Owner namespace and no corpus bundled in Git | Operators must control licences, exports, backups and retention |

## Live data processing

Live-mode submitted text/images and selected source material are processed by the configured Google/Tavily services. The application avoids retaining raw screenshot bytes in the case database, but extracted text, source excerpts and reviewer comments can persist. Review provider account data-processing and retention settings before submitting sensitive material.

Do not submit credentials, private tokens, intimate material or unnecessary personal data as a claim. Provider responses and source pages are untrusted even when they arrive over TLS.

## Secrets

`TAVILY_API_KEY` and `GEMINI_API_KEY` belong only in server-side secret configuration. `REVIEWER_IDS` is authorisation configuration and should also be managed deliberately. Never include secret values in browser responses, query strings, exported case reports, screenshots or repository files.

Ignored `.dev.vars*` and `.env*` files must stay untracked. The public repository's licence does not authorise publishing a private corpus or user submissions.

## Safe reporting

For a security concern, use the repository owner's private reporting route where available. Do not open a public issue containing credentials, private case contents or a working exploit against real user data. A useful report includes the affected commit, relevant endpoint, minimal reproduction using synthetic data, expected/observed behaviour and impact.

If no private channel is available, open a minimal issue requesting a private contact without sensitive reproduction details. There is no stated bounty or response-time guarantee.

## Security validation scope

Automated tests cover selected authorisation, origin, concurrency, validation, policy and provider-failure scenarios. They do not constitute a penetration test, formal verification, supply-chain audit or certification of production readiness. Re-run checks on the release commit and review the dependency lockfile before institutional deployment.

Reference guidance:

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

These references explain threat classes. They do not attest to this implementation's compliance or audit status.
