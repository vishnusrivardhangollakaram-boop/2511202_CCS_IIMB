/**
 * Source-scoped wording cues, independent of factual assessment and sufficiency.
 * These conservative English rules identify text patterns, not deception or intent.
 */
export const MESSAGE_SIGNAL_RULES_VERSION = "ccs-message-signals-1.0.0";
export const MAX_SIGNAL_TEXT_LENGTH = 8_000;

export type MessageSignalId =
  | "urgency"
  | "forwarding_pressure"
  | "authority_assertion"
  | "credentials_request"
  | "payment_request"
  | "absolute_certainty";

export interface MessageSignal {
  id: MessageSignalId;
  label: string;
  rationale: string;
  /** Plain source text for display; never render it as HTML. */
  excerpt: string;
  matchedText: string;
  /** JavaScript string offsets within the scanned source. */
  start: number;
  end: number;
}

export interface MessageSignalsAnalysis {
  rulesVersion: string;
  scope: "message_wording";
  signals: MessageSignal[];
  limitations: string[];
  scannedCharacters: number;
  truncated: boolean;
}

interface SignalRule {
  id: MessageSignalId;
  label: string;
  rationale: string;
  patterns: RegExp[];
}

const rules: SignalRule[] = [
  {
    id: "urgency",
    label: "Urgent action language",
    rationale:
      "The wording presses for immediate action. Check the evidence before acting; urgency alone does not establish that the claim is false.",
    patterns: [
      /\b(?:act\s+now|do\s+it\s+now|take\s+action\s+now|last\s+chance|before\s+it['’]s\s+too\s+late|limited\s+time\s+only|immediate\s+action\s+required)\b/giu,
      /\burgent(?:ly)?\s*[:!]/giu,
    ],
  },
  {
    id: "forwarding_pressure",
    label: "Pressure to forward",
    rationale:
      "The message asks for broad redistribution. Forwarding instructions are a wording cue, not evidence that the underlying claim is wrong.",
    patterns: [
      /\b(?:forward|share|send)\s+(?:this\s+message|this|it)\s+(?:(?:to|with)\s+)?(?:everyone|all\s+(?:your\s+)?(?:contacts|friends|groups)|at\s+least\s+\d+\s+(?:people|contacts|friends)|\d+\s+(?:people|contacts|friends)|as\s+many\s+(?:people|groups)\s+as\s+possible)\b/giu,
    ],
  },
  {
    id: "authority_assertion",
    label: "Absolute authority wording",
    rationale:
      "The wording asserts universal expert agreement or an official guarantee. This rule does not authenticate that authority or determine whether supporting evidence exists.",
    patterns: [
      /\b(?:all|every)\s+(?:doctors?|scientists?|experts?|officials?|authorities)\s+(?:agree|confirm|approve|recommend|know|say|endorse)s?\b/giu,
      /\b(?:officially\s+guaranteed|government[-\s]+guaranteed|endorsed\s+by\s+all\s+(?:doctors|experts|scientists))\b/giu,
    ],
  },
  {
    id: "credentials_request",
    label: "Sensitive details requested",
    rationale:
      "The message explicitly asks for credentials or sensitive account details. Verify the recipient and purpose independently; this cue does not by itself establish fraud.",
    patterns: [
      /\b(?:send|share|provide|enter|submit|give)\s+(?:(?:your|the|my|our|a|an|personal|banking|login|account|secret|verification|current|full|complete|unique|me|us|with|to|six[-\s]digit|6[-\s]digit)\s+){0,6}(?:OTP|one[-\s]?time\s+(?:password|code)|password|PIN|CVV|card\s+(?:number|details)|bank\s+(?:details|password)|account\s+credentials|Aadhaar\s+(?:number|details))\b/giu,
    ],
  },
  {
    id: "payment_request",
    label: "Payment requested",
    rationale:
      "The wording asks for money or a payment. Legitimate messages can also request payment; verify the destination and supporting documentation before acting.",
    patterns: [
      /\b(?:send|pay|transfer|deposit)\s+(?:(?:me|us|the|a|an|your|this|only|just|refundable|security)\s+){0,5}(?:[₹$€£]\s?\d[\d,.]*|\d[\d,.]*\s*(?:rupees?|dollars?|INR|USD)|(?:processing|registration|verification|advance)\s+(?:fee|payment)|money|funds|payment|fee)\b/giu,
    ],
  },
  {
    id: "absolute_certainty",
    label: "Absolute certainty wording",
    rationale:
      "The message uses an absolute guarantee or certainty claim. This is a wording observation, not a measured probability or a factual verdict.",
    patterns: [
      /\b(?:100\s*%\s*(?:true|proven|certain|accurate|guaranteed|safe)|guaranteed\s+(?:results|success|cure|returns)|cannot\s+(?:possibly\s+)?be\s+(?:wrong|false)|no\s+(?:chance|possibility)\s+of\s+(?:failure|error)|absolutely\s+(?:certain|guaranteed|proven))\b/giu,
    ],
  },
];

/** Avoid labelling direct safety advice such as "never share your OTP" as a request. */
function directlyNegated(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 80), start);
  const negation =
    /\b(?:do\s+not|don['’]t|never|must\s+not|should\s+not|avoid|not\s+to|not)\b[^.!?;:\n]{0,40}$/iu.exec(
      before,
    );
  return !!negation && !/\b(?:but|however|instead)\b/iu.test(negation[0]);
}

/** Suppress explicit discussion of a quoted phrase, without suppressing quoted forwards. */
function quotedLinguisticDiscussion(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 110), start);
  const after = text.slice(end, end + 3);
  return (
    /\b(?:phrases?|wording|expressions?|terms?|slogans?|examples?)\b[^.!?\n]{0,75}["'“‘`]\s*$/iu.test(
      before,
    ) && /^\s*["'”’`]/u.test(after)
  );
}

function sourceExcerpt(text: string, start: number, end: number): string {
  const left = Math.max(0, start - 65);
  const right = Math.min(text.length, end + 65);
  return `${left ? "…" : ""}${text.slice(left, right).replace(/\s+/gu, " ").trim()}${right < text.length ? "…" : ""}`;
}

/**
 * Return advisory cues from at most 8,000 source characters, one cue per rule.
 * This function makes no network/model calls and does not read or alter a gate,
 * evidence package, confidence value, review decision or verdict.
 */
export function analyzeMessageSignals(text: string): MessageSignalsAnalysis {
  const source = typeof text === "string" ? text.slice(0, MAX_SIGNAL_TEXT_LENGTH) : "";
  const signals: MessageSignal[] = [];
  for (const rule of rules) {
    const candidates = rule.patterns.flatMap((pattern) => [
      ...source.matchAll(new RegExp(pattern.source, pattern.flags)),
    ]);
    candidates.sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    for (const match of candidates) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (directlyNegated(source, start) || quotedLinguisticDiscussion(source, start, end))
        continue;
      signals.push({
        id: rule.id,
        label: rule.label,
        rationale: rule.rationale,
        excerpt: sourceExcerpt(source, start, end),
        matchedText: match[0],
        start,
        end,
      });
      break;
    }
  }
  return {
    rulesVersion: MESSAGE_SIGNAL_RULES_VERSION,
    scope: "message_wording",
    signals: signals.sort(
      (left, right) => left.start - right.start || left.id.localeCompare(right.id),
    ),
    limitations: [
      "Advisory English wording rules only. A cue does not establish intent, fraud, source credibility or factual truth.",
      "Quoted, legitimate or educational material may contain the same wording. Negation and discussion handling are limited heuristics.",
      "No matched cues does not mean the content is safe or true. These cues never change the evidence gate, adequacy index or verdict.",
    ],
    scannedCharacters: source.length,
    truncated: typeof text === "string" && text.length > MAX_SIGNAL_TEXT_LENGTH,
  };
}
