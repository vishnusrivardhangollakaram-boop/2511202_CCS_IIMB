# Demonstration guide

The brief sets the project demo for **26 November 2026**. This guide demonstrates the implemented contribution without representing synthetic examples as live factual research.

## Prepare

1. Confirm the application and D1 migrations are running.
2. Sign in to the intended private workspace.
3. Check the connection/capability indicator. If provider credentials are absent, explain that synthetic and manual modes remain available while live investigation is disabled.
4. Start with an empty or understood case library. Do not report the brief's corpus total as a loaded count unless those records were actually imported.
5. Open the Method & evaluation view so the difference between adequacy index and confidence is ready to explain.

## Suggested story

“My contribution is the point where an agent must decide whether it knows enough to continue. The system checks evidence coverage, provenance, context, time and independence, then either allows a preliminary assessment, requests more evidence or brings in a human.”

## Synthetic examples

Choose a scenario from the visible examples. The fixture list in `lib/fixtures.ts` is the source of truth for names and IDs; all events and source materials in those examples are fictional.

| Scenario ID | Visible title | Expected route / preliminary label |
| --- | --- | --- |
| `recycled-photo` | A real photo. The wrong story. | Proceed / Misleading |
| `verified-transit` | A transit notice with a paper trail. | Proceed / True |
| `conflicting-closure` | Two credible sources disagree. | Human review / Unverifiable |
| `missing-evidence` | A forward without a source. | Retrieve more / Unverifiable |
| `syndicated-rumour` | Three links. One original rumour. | Retrieve more / Unverifiable |

Demonstrate these behaviours where represented by the available fixtures:

| Example behaviour | What to show |
| --- | --- |
| Adequate corroboration | Evidence covers all claim parts and the gate permits assessment |
| Misleading context | Some propositions are supported while others are refuted |
| Incomplete evidence | The gate identifies specific missing propositions |
| Credible conflict | Supporting and refuting evidence on the same part triggers review |
| Repeated sources | Several copies do not become several independent sources |

Inspect the evidence cards and explain one check that passed and one that failed. Show the citation/provenance detail, not just the large verdict badge. Make clear that the fixed example clock keeps fixture behaviour reproducible.

## Human handoff

1. Open an unresolved synthetic case in the Review desk.
2. Inspect its original claim, evidence and missing information.
3. Select a decision and write a substantive rationale.
4. Submit once. Show the resulting human decision separately from the automatic preliminary assessment.
5. Open the activity history to show the recorded action.
6. If demonstrating conflict protection, open the same case in two tabs, update one, then show that a stale decision from the other is rejected rather than silently replacing the new version.

Synthetic examples allow the owner to demonstrate review. Real cases require a configured reviewer identity. For a separate-person demonstration, the owner explicitly requests a handoff; a configured reviewer opens the shared review queue in their own signed-in account. Explain that the handoff shares the case with the configured reviewer pool. Show that withdrawal removes access. These permissions are enforced by the API.

## Manual investigation

Paste a new factual claim using manual mode. Show that the application does not invent sources or select a sample answer because of similar words. With no qualifying evidence, the case remains unresolved. Add a source excerpt, its metadata and its relationship to a claim part. Explain whether the submitter is authorised to attest its provenance.

The manual path is useful for showing the contract with the team's other agents: they supply a structured evidence package; the gate returns a decision, reasons and missing information.

## Credentialed live investigation

Use only after `TAVILY_API_KEY`, `GEMINI_API_KEY` and a compatible `GEMINI_MODEL` are configured and a real smoke test has passed. Pick a low-stakes claim with accessible primary evidence. State the actual date of the test and distinguish current sources from historical corpus matches.

Show:

- The original submitted content.
- The extracted claim and atomic parts.
- Actual returned sources and evidence excerpts.
- The gate's decision and remaining gaps.
- A provider error or insufficient result handled honestly if it occurs.

Do not replace a failed live response with a synthetic result without explicitly switching modes. No external call should be described as tested merely because its adapter has unit tests.

Screenshot reading extracts information with the configured model; it is not deepfake detection or image authenticity certification. Article input uses the configured extraction service; the app does not grant an arbitrary direct-fetch capability.

## Closing evidence

Export a case report. Point to the policy document, API contract, security controls and test/evaluation records. Report the precise checks run on the delivered commit, and keep “synthetic regression passed” separate from any future real-world evaluation results.

If demonstrating corpus import, prepare a small authorised batch in advance, open Method & evaluation, review the selected file and record count, confirm permission and start the import. Show the actual completion state and refreshed corpus count. Explain that processed rows include upserts and therefore are not necessarily newly added unique articles. Do not upload the real corpus's full text to a public repository for the demonstration.
