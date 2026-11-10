# Advisory message cues

The project brief requests warning signs alongside a verdict. The implementation provides a deliberately separate wording analysis through `analyzeMessageSignals` in `lib/message-signals.ts`. Its initial rules version is **`ccs-message-signals-1.0.0`**.

## What the rules detect

| Rule ID | Wording being highlighted | What it does not establish |
| --- | --- | --- |
| `urgency` | Language pressing for immediate action | That a real emergency is false |
| `forwarding_pressure` | Requests to pass a message on or spread it | That sharing is malicious |
| `authority_assertion` | Wording claiming authority or official status | That the named authority is genuine or fabricated |
| `credentials_request` | A request for credentials or sensitive access information | That a fraud has been proven |
| `payment_request` | Language requesting a payment or transfer | That the transaction is illegitimate |
| `absolute_certainty` | Strong absolute or guaranteed assertions | That a claim is factually wrong |

The interface displays a rationale and matched excerpt so a researcher can inspect the actual trigger. These are **advisory cues**, not accusations, risk probabilities, source-credibility scores or factual evidence.

## Scope

- Conservative, deterministic English regular-expression rules.
- At most the first **8,000 characters** are scanned; truncation is disclosed.
- At most one signal is returned per rule.
- Directly negated safety advice and explicitly quoted discussion of a phrase are suppressed where the implemented patterns recognise them.
- The interface distinguishes **original submitted text** from an **extracted claim**. When only an extracted claim is analysed, cues omitted during extraction cannot be recovered by this module.

The UI uses the saved original text when it is nonempty, otherwise the extracted claim. For an image with a user-provided caption/context, it labels that scope explicitly; it does not imply that every word in the image was scanned. Case JSON exports add an `advisorySignals` object with source/scope and the analysis; printable reports retain the same distinction. This is an export/display addition, not a stored API evidence or verdict field.

Negation, sarcasm, indirect speech, code-switching and mixed-language messages can still confuse wording rules. The module does not inspect image pixels, audio, external links, sender identity or a source organisation's authenticity.

## Output contract

```text
rulesVersion
scope: message_wording
signals[]:
  id, label, rationale, excerpt, matchedText, start, end
limitations[]
scannedCharacters
truncated
```

Character offsets are JavaScript string offsets within the scanned text. They and the matched text support inspection and regression testing; they are not a rationale for the factual verdict. The function performs no network requests and uses no provider key.

## Separation from assessment

The cue output does not alter evidence quality, source independence, the sufficiency score, the next-action route or the verdict. An urgent claim still needs evidence. A message with no matched rules is not certified safe, trustworthy or true.

If future work proposes using wording as a predictive feature, treat that as a separate model/policy change: justify it, obtain appropriate data, test for domain/language bias, version the change and report its effect on held-out claims. Do not quietly turn these display cues into a hidden classification rule.

## Validation

Regression tests should include direct matches, empty text, boundary/truncation behaviour, negated advice, quoted linguistic discussion, punctuation and case variants. Test descriptions establish these bounded behaviours only; they do not establish multilingual red-flag detection or real-world misinformation accuracy.
