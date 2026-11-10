# Evaluation and research claims

## What has and has not been established

Automated tests and synthetic examples check implementation behaviour. They can establish that the gate rejects a duplicate-source package, that another user's case is inaccessible, or that a stale review is not saved. They cannot establish real-world misinformation accuracy, calibrated confidence, fairness, or reliability across languages and domains.

The repository's synthetic evaluation is produced by `scripts/evaluate.mjs`. Run the package's `evaluate` command to inspect it; pass its documented save option to persist a fresh report under `docs/validation/`. Its expected labels are authored fixture expectations, not independent expert ground truth. Never present its agreement rate as accuracy on the 52,678-article corpus.

The report should retain the case ID, expected and observed gate decision/verdict, policy version and evaluation timestamp. A failed scenario is a regression to investigate, not an invitation to change the expected result until it passes.

## Separate the research questions

| Component | Research question | Ground truth needed |
| --- | --- | --- |
| Claim extraction | Were all material propositions, dates and entities extracted faithfully? | Expert annotated atomic claims |
| Historical retrieval | Are the correct relevant fact-checks near the top? | Claim-to-article relevance judgments |
| Evidence assessment | Are excerpts, stances, coverage and context correctly represented? | Source-level expert annotations |
| Sufficiency gate | Is it safe to assess now, search further or escalate? | Expert labels for complete and deliberately incomplete evidence packages |
| Preliminary verdict | Does the conclusion follow from the accessible evidence? | Adjudicated case verdict with cited evidence and decision time |
| Human review | Are reviewers resolving the right cases accurately and efficiently? | Independent review outcomes, disagreements and timed workflow observations |
| Advisory message cues | Did a wording rule identify the intended phrase without mislabelling negation or quoted discussion? | Annotated English wording examples, separately from factual verdict labels |

An article's True/False/Misleading label does not label the sufficiency of every subset of its evidence. Training or evaluating the gate requires claim–evidence-package examples, including insufficient and conflicting packages.

Message cues are deterministic English wording rules, not a trained misinformation classifier. Evaluate their phrase-level false positives/negatives separately. They intentionally do not affect the gate or verdict, so a cue-detection result is not evidence of improved factual accuracy.

## Construct an evaluation set

1. Obtain the authorised corpus and document its exact hash, schema, date range and exclusions.
2. Group records by underlying claim, including cross-publisher duplicates, close paraphrases, reused media and translations.
3. Select examples across domains, verdict categories, dates, platforms and manipulation types. Preserve hard negatives that share entities or images but differ in time/place.
4. Ask at least two competent annotators to label atomic claims, evidence applicability and the safe next action. Adjudicate disagreements and retain them for analysis.
5. Build several evidence packages per claim: decisive primary evidence; independent corroboration; copied sources; missing atomic parts; stale dates; missing publication dates; credible conflict; irrelevant high-quality evidence; and provider failure/no evidence.
6. Freeze a development set and a held-out test set before choosing thresholds. Keep every package derived from the same claim in the same partition.
7. Define the evidence cutoff for each case. An investigation at time T cannot use a fact-check first published after T.

The True class is sparse in the source-normalised counts described in the brief. Report per-class results and class support; an overall score dominated by False examples is not enough. Add independently verified true examples only with a documented acquisition and annotation process.

## Baselines and ablations

Compare the versioned gate to defensible baselines on identical held-out evidence packages:

- A simple “at least two sources” rule.
- A single structured model judgment without the deterministic gate.
- The full gate.
- The gate without source-family deduplication.
- The gate without date/context checks.
- The gate without atomic coverage checks.

The comparisons measure the value and cost of each check. Do not assume that more agents or a more complex workflow improves accuracy. If provider models differ, record model identifiers, prompts, decoding settings and available evidence for each run.

## Metrics

| Area | Report |
| --- | --- |
| Retrieval | Recall@k, precision@k, MRR/nDCG with relevance labels, and latency |
| Gate routing | Confusion matrix across proceed/retrieve_more/human_review, macro-F1, per-class precision/recall |
| Unsafe passes | Fraction of human-labelled insufficient/conflicting packages incorrectly allowed to proceed |
| Over-escalation | Fraction of sufficient packages unnecessarily sent to search/review |
| Verdicts | Per-class precision/recall/F1, macro-F1 and confusion matrix, including Unverifiable |
| Abstention | Coverage versus error among non-abstained cases; reasons for abstention |
| Citation fidelity | Excerpt present in source, claim supported by cited passage, correct date/entity/context |
| Operations | Median/p95 latency, requests and cost per case, provider failure rate, retries and review time |
| Human review | Reviewer agreement, adjudication rate, override frequency and override correctness |
| Subgroups | Results and sample sizes by domain, time period, format, language and source familiarity |

Use bootstrap confidence intervals at the **claim-family level**, rather than treating multiple packages from the same claim as independent samples. Report the exact denominator for every rate. Small slices should be described as inconclusive where appropriate.

## Calibration

The current adequacy index is not calibrated. If a future model emits an empirical probability, evaluate it separately using held-out reliability diagrams, expected calibration error and Brier score, with a clear definition of the predicted event. Fit any calibrator on development data only. A well-calibrated correctness probability still does not replace citation validation or policy constraints.

Do not rename the current policy index “confidence” to satisfy a dashboard design. Keep the UI label consistent with what has actually been measured.

## Temporal and source generalisation

Use a forward time split as a separate experiment. Test on source sites or claim families excluded during development. Deduplicate syndicated articles before partitioning. An “unseen website” whose text reproduces a training article is not an unseen claim.

Record whether the evaluation measures historical retrieval, open-web verification or a mixture. Giving the model the complete fact-check article, including its verdict and true version, measures interpretation of a supplied fact-check, not independent misinformation detection.

## Reproducibility record

For every publishable run retain:

- Commit SHA and policy version.
- Dataset hashes and split membership IDs.
- Annotation guide, annotators' independent labels and adjudication log.
- Provider/model identifiers and prompt version.
- Retrieval parameters, budgets, time cutoffs and allowed sources.
- Per-case inputs, permitted evidence snapshots, outputs, latency, failure category and cost estimate.
- Analysis script and generated result tables.

Never commit secret keys, identifying user submissions or unauthorised full-text corpora with the results. A public release may need redacted IDs and licensed excerpts instead.

## Release gates proposed for an institutional pilot

Agree numerical acceptance criteria with the project supervisor before reviewing final results. At minimum, require no unresolved access-control failures, a tested restoration procedure, documented provider behaviour, acceptable unsafe-pass performance on the held-out set, and an explicit human-oversight policy for sensitive claims. No universal accuracy threshold is claimed here.
