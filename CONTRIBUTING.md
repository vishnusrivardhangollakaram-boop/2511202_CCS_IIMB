# Contributing

## Working agreement

Use a feature branch and a focused pull request. Preserve the repository's AGPL-3.0 licence. Keep application behaviour, documentation and tests consistent; do not silently broaden the research claim when adding a feature.

The project follows the useful standards of Student360 and TaleTwinkle: clear responsibilities, small named functions, explicit inputs, readable interfaces, genuine workflow states and detailed setup/behaviour documentation. Python utilities use docstrings, `main()` and an explicit entry point. TypeScript modules share domain types rather than passing opaque loosely shaped objects.

## Local checks

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run format:check
pnpm test
python3 -m unittest discover -s tests -p 'test_prepare_corpus.py' -v
pnpm run evaluate
pnpm run build
```

Use the exact package-manager version recorded in `package.json`. Do not update dependencies or regenerate the lockfile as an unrelated side effect. If a dependency changes, state why and test the resulting build.

## Code standards

- Keep the sufficiency policy pure and deterministic for a supplied clock and evidence package.
- Put provider calls behind bounded adapters. Validate model output and never trust its URLs, quotes or scores implicitly.
- Preserve the distinction between site verdict, normalised site verdict, LLM label, preliminary case verdict and human verdict.
- Enforce authentication, owner scope and reviewer permission on the server.
- Apply optimistic version checks to every mutation of an existing case.
- Keep database mutations and associated audit events consistent.
- Preserve the original claim and source excerpts as data. Never execute source content or embed user text into JavaScript/HTML unsafely.
- Keep credentials and private data out of logs, tests, fixtures and screenshots.
- Label synthetic fixtures and never route arbitrary live input to them by keyword.
- Keep advisory wording cues separate from evidence quality, the gate and factual verdicts; preserve the original/extracted text scope in exports.
- Include an explicit unknown/unverifiable path; failures must not become passes.

## Tests worth adding

Test behaviour at a meaningful boundary: a copied-source cluster, a partially covered compound claim, a quote absent from its source, a stale review, a forbidden cross-user request, a provider failure or an import batch exceeding byte limits. Avoid tests that merely duplicate implementation constants without exercising behaviour.

Use mocked providers for deterministic regression tests. Mark any credentialed live test separately with date, model, provider configuration and outcome. Never commit keys or claim that mocks establish service availability.

## Policy changes

Changes to thresholds, eligibility, independence, freshness, verdict derivation or search budgets require an explanation, a policy version update and regression examples. For research claims, compare on held-out expert-labelled data, not just the examples used to design the rule.

## Database changes

Update the Drizzle schema, generate and inspect migration SQL, and test against a disposable realistic database. Applied migration files and metadata are immutable. FTS changes require explicit index/rebuild consideration. Plan backward compatibility before deployment; a code rollback does not undo a migration.

## UI changes

Every visible control should perform a real supported action. Keep state descriptions truthful. Preserve keyboard access, focus visibility, sufficient contrast, mobile layouts, readable source excerpts and reduced-motion behaviour. Distinguish an automatic proposal from an authorised human decision. Do not rename the adequacy index “confidence.”

## Pull request description

Describe the user-visible problem and resulting behaviour, then list the meaningful validation performed. Include any schema, permission, provider, data-retention or policy impact. Explicitly state remaining untested external dependencies. Do not report a real-world accuracy result without the evaluation artefact and method.
