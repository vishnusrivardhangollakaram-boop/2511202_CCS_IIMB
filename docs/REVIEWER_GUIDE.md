# Human review guide

## Who may review

The server permits a user to review their own synthetic examples for demonstration. Real cases require the user's stable authenticated ID in `REVIEWER_IDS`. Setting a display name or switching to the Review desk does not grant permission.

Cases are private to their owner until the owner explicitly requests a handoff. A requested handoff makes that case accessible to **all configured reviewer IDs** through the shared review queue/detail routes. It is not a one-person assignment. Reviewers can record a decision on the shared case but cannot use owner-only evidence, investigation or handoff routes. Institutional membership, individual assignment and mandatory independent second approval remain future extensions.

The owner can withdraw access. Withdrawal removes the case from reviewer access and increments its version, preventing a previously loaded reviewer draft from being saved afterward. A completed review leaves the pending queue; direct reviewer access remains while the owner keeps the handoff active. Withdrawal cannot erase a copy that an authorised reviewer previously exported.

## Before deciding

Read the original claim and its atomic parts. Check that the wording preserves its qualifications: who, what, when, where and how much. If extraction omitted a material proposition, do not approve the case just because the visible parts are covered.

Open the relevant source material and inspect the exact excerpt, publication date, retrieval date and context. A familiar logo, publisher name or model-generated quality score is not proof of authenticity. Check whether the URL is the expected original site and whether the content actually says what the evidence card claims.

Distinguish a source's statement from the underlying fact. Two articles quoting the same spokesperson may be one evidence family. A source that reports “a claim is circulating” does not necessarily support that claim.

## Review sequence

1. **Identify the disputed propositions.** Ensure every material part has been considered.
2. **Check provenance.** Use the original source where possible; assess whether the excerpt is actually present and faithfully represented.
3. **Check time and place.** A genuine old image can be misleading in a new caption. A current article may quote an old event.
4. **Inspect supporting and refuting evidence.** Resolve contradictions rather than count votes.
5. **Inspect independence.** Record a shared original source or syndication where apparent.
6. **Check what remains unknown.** Missing evidence is a valid outcome. Do not turn it into False merely to close the queue.
7. **Select the next action and write the rationale.** Refer to evidence IDs and explain limitations in plain language.

## Actions

| Action | Use when | Result |
| --- | --- | --- |
| Approve | The proposed conclusion is justified after your review | Record a human verdict and rationale |
| Revise | The conclusion or its interpretation needs changing | Record the revised human verdict and the reason |
| Request evidence | A specific unresolved gap prevents a responsible conclusion | Keep the case unresolved and identify the needed evidence |

The final labels are True, False, Misleading and Unverifiable. Select Unverifiable when reliable evidence remains inadequate. Do not use it as a synonym for an unfamiliar source, an unpopular view or a claim you personally disagree with.

Review requests require a rationale of at least 20 characters. A verdict that overrides the gate or disagrees with the automatic assessment requires explicit override confirmation, at least 40 characters and is marked as an override. True/False/Misleading decisions require selecting and attesting at least one evidence record. These are input minimums, not measures of reasoning quality.

Example of a useful rationale:

> Evidence e2 is the original dated record and directly contradicts the claimed location. Evidence e3 repeats e2, so I treated them as one family. The photograph's authenticity is supported, but its caption is incorrect; I selected Misleading.

This example is illustrative, not an actual decision about a real event.

## Attesting evidence

Selecting an evidence item for provenance attestation is an explicit action. Do so only after checking the source and passage. The review record retains the evidence snapshot and gate result used for the decision. An attestation is not permission to invent source quality, omit conflicts or mark every item verified automatically.

Manual evidence entered by a user without reviewer privileges remains unverified. It may help the investigator, but it should not satisfy the gate's provenance check until an authorised reviewer has checked it.

## Concurrent edits

Every decision is tied to a case version. If another tab changed the case, the server rejects the stale decision. Reload, compare the new evidence and submit a fresh decision. Do not repeatedly click approval or reuse a stale request until it appears to succeed.

Adding new evidence can change the automatic assessment. Inspect whether the previous human conclusion still applies. Retain the earlier review history; do not rewrite it as if the new evidence had been available at the time.

## Limits of the review record

The audit trail records application actions and authenticated actors. It is not an external digital signature, a notarised record, or proof that the reviewer actually opened every source. Institutional use may require stronger identity checks, separation of duties, independent peer review and retention controls.

Keep sensitive personal information out of the rationale unless essential and permitted. Case reports and exports can contain user submissions and excerpts; share them only with the intended audience.
