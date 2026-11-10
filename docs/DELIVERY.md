# Source delivery

## Project locations

- [Private research workspace](https://evidence-ai-ccs-vishnu.playfulmodel2.chatgpt.site/): the deployed application; sign in with its owner's ChatGPT account.
- [GitHub source](https://github.com/vishnusrivardhangollakaram-boop/2511202_CCS_IIMB): implementation, migrations, tests, documentation and CI.
- [Repository checks](https://github.com/vishnusrivardhangollakaram-boop/2511202_CCS_IIMB/actions): the actual result for each pushed commit.

The implementation contribution centres on evidence sufficiency, historical retrieval support and accountable human review. The [README](../README.md) explains the complete delivered scope. The default branch is the starting point for local setup; feature branches and pull requests preserve review history.

The GitHub access issue encountered during preparation was resolved by connecting the personal account on 10 November 2026. A branch write was verified after authorization. Earlier dated readiness records preserve observations as they stood at their recording time; they are not current repository access settings.

## Source packages

| File | Purpose |
| --- | --- |
| `2511202_CCS_IIMB_Complete_Source.zip` | Tracked source, migrations, lockfile, tests, CI configuration and documentation; convenient for local setup |
| `CCS_Evidence_AI.bundle` | Saved Git history with the `feat/evidence-ai-workspace` branch; usable without GitHub access |
| `CCS_Evidence_AI.patch` | Commit patches relative to original repository commit `9936e781ad2e767c2c2a9ef60b747a2d080a8bbe` |

These packages exclude runtime databases, provider secrets, dependencies and build caches. They do not include the project's real corpus. They are generated from the saved source, rather than tracked inside the application tree.

To open the bundle locally:

```bash
git clone --branch feat/evidence-ai-workspace CCS_Evidence_AI.bundle evidence-ai-local
cd evidence-ai-local
git bundle verify ../CCS_Evidence_AI.bundle
```

Then follow [setup](SETUP.md). The ZIP is simpler for running the app, while the bundle preserves saved source history. Site publication and GitHub publication may have different commit identities; compare their Git tree/content when checking source equivalence. Never overwrite a remote branch merely to make commit IDs match.

## Verification

The checked-in [verification records](VERIFICATION.md) describe automated tests, synthetic policy fixtures, preview observations, hosted readiness and their limits. GitHub Actions adds a fresh isolated install and repeats the configured checks for a pushed commit. A workflow definition alone is not proof of a successful run: inspect its actual conclusion and commit.

## Before a real-data pilot

Supply authorised corpus files, configure provider secrets and the model identifier, configure reviewer identities, and perform a signed-in hosted walkthrough and credentialed provider smoke test. Validate the policy on expert-labelled cases and complete the operational exercises in [operations](OPERATIONS.md). The research application and its regression results do not certify factual accuracy or institutional launch readiness.

The project retains its existing AGPL-3.0 licence. Corpus redistribution, model use and provider processing require their respective permissions; no credentials or real dataset are bundled.
