"""Bounded, source-scoped English wording cues, separate from truth assessment.

This is a native Python port of ``lib/message-signals.ts``. The rules identify
phrases, never deception, intent, credibility or factual truth. No network,
model, evidence or policy dependency is involved. Source offsets use Python
string indices, so ``text[start:end]`` always gives the matched wording.
"""

from __future__ import annotations

import re
from typing import Any

MESSAGE_SIGNAL_RULES_VERSION = "ccs-message-signals-1.0.0"
MAX_SIGNAL_TEXT_LENGTH = 8_000

_RULES = (
    (
        "urgency",
        "Urgent action language",
        "The wording presses for immediate action. Check the evidence before acting; urgency alone does not establish that the claim is false.",
        (
            r"\b(?:act\s+now|do\s+it\s+now|take\s+action\s+now|last\s+chance|before\s+it['’]s\s+too\s+late|limited\s+time\s+only|immediate\s+action\s+required)\b",
            r"\burgent(?:ly)?\s*[:!]",
        ),
    ),
    (
        "forwarding_pressure",
        "Pressure to forward",
        "The message asks for broad redistribution. Forwarding instructions are a wording cue, not evidence that the underlying claim is wrong.",
        (
            r"\b(?:forward|share|send)\s+(?:this\s+message|this|it)\s+(?:(?:to|with)\s+)?(?:everyone|all\s+(?:your\s+)?(?:contacts|friends|groups)|at\s+least\s+\d+\s+(?:people|contacts|friends)|\d+\s+(?:people|contacts|friends)|as\s+many\s+(?:people|groups)\s+as\s+possible)\b",
        ),
    ),
    (
        "authority_assertion",
        "Absolute authority wording",
        "The wording asserts universal expert agreement or an official guarantee. This rule does not authenticate that authority or determine whether supporting evidence exists.",
        (
            r"\b(?:all|every)\s+(?:doctors?|scientists?|experts?|officials?|authorities)\s+(?:agree|confirm|approve|recommend|know|say|endorse)s?\b",
            r"\b(?:officially\s+guaranteed|government[-\s]+guaranteed|endorsed\s+by\s+all\s+(?:doctors|experts|scientists))\b",
        ),
    ),
    (
        "credentials_request",
        "Sensitive details requested",
        "The message explicitly asks for credentials or sensitive account details. Verify the recipient and purpose independently; this cue does not by itself establish fraud.",
        (
            r"\b(?:send|share|provide|enter|submit|give)\s+(?:(?:your|the|my|our|a|an|personal|banking|login|account|secret|verification|current|full|complete|unique|me|us|with|to|six[-\s]digit|6[-\s]digit)\s+){0,6}(?:OTP|one[-\s]?time\s+(?:password|code)|password|PIN|CVV|card\s+(?:number|details)|bank\s+(?:details|password)|account\s+credentials|Aadhaar\s+(?:number|details))\b",
        ),
    ),
    (
        "payment_request",
        "Payment requested",
        "The wording asks for money or a payment. Legitimate messages can also request payment; verify the destination and supporting documentation before acting.",
        (
            r"\b(?:send|pay|transfer|deposit)\s+(?:(?:me|us|the|a|an|your|this|only|just|refundable|security)\s+){0,5}(?:[₹$€£]\s?\d[\d,.]*|\d[\d,.]*\s*(?:rupees?|dollars?|INR|USD)|(?:processing|registration|verification|advance)\s+(?:fee|payment)|money|funds|payment|fee)\b",
        ),
    ),
    (
        "absolute_certainty",
        "Absolute certainty wording",
        "The message uses an absolute guarantee or certainty claim. This is a wording observation, not a measured probability or a factual verdict.",
        (
            r"\b(?:100\s*%\s*(?:true|proven|certain|accurate|guaranteed|safe)|guaranteed\s+(?:results|success|cure|returns)|cannot\s+(?:possibly\s+)?be\s+(?:wrong|false)|no\s+(?:chance|possibility)\s+of\s+(?:failure|error)|absolutely\s+(?:certain|guaranteed|proven))\b",
        ),
    ),
)

_COMPILED_RULES = tuple(
    (
        identifier,
        label,
        rationale,
        tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns),
    )
    for identifier, label, rationale, patterns in _RULES
)
_NEGATION = re.compile(
    r"\b(?:do\s+not|don['’]t|never|must\s+not|should\s+not|avoid|not\s+to|not)\b[^.!?;:\n]{0,40}$",
    re.IGNORECASE,
)
_CONTRAST = re.compile(r"\b(?:but|however|instead)\b", re.IGNORECASE)
_QUOTED_DISCUSSION = re.compile(
    r"\b(?:phrases?|wording|expressions?|terms?|slogans?|examples?)\b[^.!?\n]{0,75}[\"'“‘`]\s*$",
    re.IGNORECASE,
)
_CLOSING_QUOTE = re.compile(r"^\s*[\"'”’`]")


def _directly_negated(text: str, start: int) -> bool:
    """Suppress direct safety advice without hiding a later contrasting request."""
    match = _NEGATION.search(text[max(0, start - 80) : start])
    return bool(match and not _CONTRAST.search(match.group(0)))


def _quoted_discussion(text: str, start: int, end: int) -> bool:
    """Suppress explicit linguistic discussion, but preserve cues in forwards."""
    return bool(
        _QUOTED_DISCUSSION.search(text[max(0, start - 110) : start])
        and _CLOSING_QUOTE.search(text[end : end + 3])
    )


def _source_excerpt(text: str, start: int, end: int) -> str:
    left, right = max(0, start - 65), min(len(text), end + 65)
    excerpt = re.sub(r"\s+", " ", text[left:right]).strip()
    return ("…" if left else "") + excerpt + ("…" if right < len(text) else "")


def analyze_message_signals(text: Any) -> dict[str, Any]:
    """Return at most one advisory cue per rule from at most 8,000 characters.

    ``excerpt`` and ``matchedText`` are untrusted plain source text and must not
    be rendered as HTML. These cues never modify evidence, adequacy or verdict.
    Python Unicode word boundaries and string offsets apply in this native port.
    """
    source = text[:MAX_SIGNAL_TEXT_LENGTH] if isinstance(text, str) else ""
    signals = []
    for identifier, label, rationale, patterns in _COMPILED_RULES:
        candidates = sorted(
            (match for pattern in patterns for match in pattern.finditer(source)),
            key=lambda match: match.start(),
        )
        for match in candidates:
            start, end = match.span()
            if _directly_negated(source, start) or _quoted_discussion(source, start, end):
                continue
            signals.append(
                {
                    "id": identifier,
                    "label": label,
                    "rationale": rationale,
                    "excerpt": _source_excerpt(source, start, end),
                    "matchedText": match.group(0),
                    "start": start,
                    "end": end,
                }
            )
            break
    return {
        "rulesVersion": MESSAGE_SIGNAL_RULES_VERSION,
        "scope": "message_wording",
        "signals": sorted(signals, key=lambda signal: (signal["start"], signal["id"])),
        "limitations": [
            "Advisory English wording rules only. A cue does not establish intent, fraud, source credibility or factual truth.",
            "Quoted, legitimate or educational material may contain the same wording. Negation and discussion handling are limited heuristics.",
            "No matched cues does not mean the content is safe or true. These cues never change the evidence gate, adequacy index or verdict.",
        ],
        "scannedCharacters": len(source),
        "truncated": isinstance(text, str) and len(text) > MAX_SIGNAL_TEXT_LENGTH,
    }


analyse_message_signals = analyze_message_signals
