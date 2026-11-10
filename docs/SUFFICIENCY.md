# Evidence sufficiency policy

The policy version is exported as `POLICY_VERSION` in `lib/sufficiency.ts`. This document describes baseline `ccs-sufficiency-1.0.1`. Update the version and document any behavioural policy change. Version 1.0.1 gives packages without eligible direct evidence an index of zero and requires eligible evidence before the consistency check can pass; it does not change the routing rules.

## Decision being made

The gate answers: **Does this evidence package meet the configured conditions for a preliminary factual assessment of all stated claim parts?**

It does not decide whether a search result is authentic, independently certify a publisher, or establish that an upstream model assigned the correct stance. Those assertions are inputs that must be validated and evaluated. A high score cannot repair a fabricated excerpt or a wrong source-family assignment.

## Required inputs

`Claim` contains the original text, atomic `parts`, a `timeSensitive` flag, a domain, and an optional `timeWindowDays`. Each `Evidence` item retains an ID, title, URL, publisher, publication/retrieval timestamps, excerpt, stance, relevance, quality, source-family key, claim-part coverage, context/time applicability, primary-source flag, origin and verification assertion.

The four stances are `supports`, `refutes`, `context` and `unclear`. Context-only and unclear items can be useful to the investigator but cannot by themselves establish direct coverage.

## Eligibility

For an item to count as direct eligible evidence:

1. Relevance is finite, in `[0,1]`, and at least **0.65**.
2. It refers to at least one exact normalised atomic claim part.
3. Provenance is marked checked (`verified`), source quality is finite and at least **0.65**, the URL is usable, the publisher is nonempty, and the excerpt has at least 20 characters.
4. Context and temporal applicability are true.
5. Retrieval and publication timestamps are valid and not materially in the future. The policy permits a five-minute clock skew. Publication cannot be later than retrieval beyond that tolerance.
6. For a time-sensitive claim, publication date must be known, and publication/retrieval must ordinarily be within the permitted age window. The default is **30 days**; an explicit window is bounded to 1–3650 days. There is an explicit `historicalRefutation` exception: a checked primary record with refuting stance and quality/relevance both at least 0.90 can establish that a newly circulated image or assertion originated earlier. This does not let stale supporting material validate a current event. A reviewer must check the original-record identity and date.
7. Stance is either supports or refutes.

“Verified” here is a recorded provenance assertion, not a guarantee of truth. The live adapter and manual-review policy determine who can make that assertion. A search snippet alone must not qualify. Inspect the adapter and API code whenever changing this boundary.

## Coverage and independence

Every atomic claim part needs at least one applicable direct item. In addition, each part needs either:

- at least **two independent source families**, or
- one checked **primary record** with quality and relevance both at least **0.90**.

The second condition is an explicit single-primary exception, not a general “one source is enough” rule. A signed original record may be more decisive than many derivative news pages. Source counts are a policy choice requiring expert validation.

Families are merged when they share an explicit independence key, a publisher, a canonical URL, or sufficiently similar longer excerpts. Unknown original provenance does not become an independent family merely because a new URL exists. URL tracking parameters and fragments are ignored for duplicate comparison. Long excerpts use a token-set similarity heuristic; short shared factual phrases alone do not trigger that heuristic.

The independence heuristic is imperfect. Multiple publishers may depend on the same unreported original source; the same publisher may publish independently reported evidence. These are reviewer/evaluation issues, not reasons to claim perfect independence detection.

## Conflicts and search limits

If eligible evidence both supports and refutes the **same atomic part**, the gate routes to `human_review`. A majority vote does not resolve that conflict.

If required evidence is missing and the retrieval budget remains, the gate returns `retrieve_more`, explicit gaps and suggested search queries. Once the budget is exhausted, the gate returns `human_review`. The pure function's default is two attempts when no budget is supplied; the application explicitly supplies **three completed live retrieval attempts** through `MAX_ATTEMPTS` in `app/api/_shared.ts`. Provider failures do not count as successful retrieval, although they consume request-rate and potentially provider-cost budget.

An unresolved case remains `Unverifiable` at automatic assessment. Failure to find support is not proof of falsehood.

## Index calculation

| Check | Weight | Pass condition |
| --- | ---: | --- |
| Relevant evidence | 15 | At least one relevant item addresses a claim part |
| Checked sources | 15 | At least one item meets provenance/excerpt/quality criteria |
| Context and freshness | 15 | At least one direct item meets context/time criteria |
| Claim coverage | 25 | Every nonempty atomic part is covered |
| Source independence | 20 | Every part meets corroboration or the primary-source exception |
| No unresolved contradictions | 10 | At least one eligible direct item exists and no atomic part has conflicting eligible stances |
| **Total** | **100** | Index of passed checks only |

**Zero-evidence floor:** a package with no eligible direct evidence has an index of **0**, even if an intermediate relevance or source check passed. This includes an empty case, unchecked snippets, context-only material and wholly stale/inapplicable evidence. Absence of evidence is not credited as consistency. For packages with eligible direct evidence, the index is the weighted sum of passed checks. The `proceed` route requires all checks; it is not triggered by crossing a scalar score threshold.

## Preliminary verdict derivation

| Evidence after a passing gate | Preliminary label |
| --- | --- |
| Every atomic part supported | True |
| Every atomic part refuted | False |
| Some parts supported and other parts refuted | Misleading |
| Gate did not pass or at least one part is unresolved | Unverifiable |

This is a transparent baseline, not a complete taxonomy of misinformation. The final label can depend on how the claim was decomposed. For example, an old photograph with a false caption should separate image authenticity from the asserted place/date if the desired label is Misleading. A reviewer must inspect the decomposition rather than accept the label mechanically.

## Policy changes

Before changing a threshold or rule, record the motivating failure cases, compare the old and new policies on held-out expert-labelled evidence packages, report both unsafe passes and unnecessary escalations, version the change, and retain the previous configuration for replay. Do not optimise thresholds on the final test set.

The synthetic fixture tests are regression tests. They are not sufficient evidence to tune or validate these thresholds for health, financial, electoral, communal or breaking-news claims.
