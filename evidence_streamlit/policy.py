"""Deterministic Python port of the versioned CCS evidence-sufficiency policy.

Inputs and outputs intentionally retain the TypeScript application's camelCase
JSON contract. This policy evaluates supplied provenance/stance assertions; it
does not independently authenticate sources or measure a probability of truth.
The module uses only Python's standard library and performs no network calls.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qsl, quote, quote_plus, urlsplit, urlunsplit

POLICY_VERSION = "ccs-sufficiency-1.0.1"
MIN_RELEVANCE = 0.65
MIN_QUALITY = 0.65
CLOCK_SKEW_MS = 5 * 60 * 1000
DAY_MS = 24 * 60 * 60 * 1000


def list_scenarios() -> list[dict]:
    """Load isolated synthetic fixtures; never select one from free-text keywords."""
    with Path(__file__).with_name("fixtures.json").open(encoding="utf-8") as source:
        return json.load(source)


def get_scenario(scenario_id: str) -> dict | None:
    """Return a fresh fixture by explicit ID, or None for an unknown ID."""
    return next((item for item in list_scenarios() if item["id"] == scenario_id), None)


def normalise_text(value: str) -> str:
    """Match the NFKC/lowercase/whitespace normalization of the TS policy."""
    if not isinstance(value, str):
        return ""
    return re.sub(r"[\s\ufeff]+", " ", unicodedata.normalize("NFKC", value).lower()).strip()


def claim_parts(claim: dict) -> list[str]:
    """Return unique nonempty atomic propositions, falling back to claim text."""
    seen: set[str] = set()
    result: list[str] = []
    for part in claim.get("parts") or [claim.get("text", "")]:
        key = normalise_text(part)
        if key and key not in seen:
            seen.add(key)
            result.append(part)
    return result


def _finite_number(value: object) -> bool:
    """JavaScript Number.isFinite rejects booleans and numeric strings."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        # Python accepts arbitrarily large JSON integers; JavaScript cannot
        # represent these as finite Numbers. Reject them instead of crashing.
        return False


def _score_in_range(value: object) -> bool:
    return _finite_number(value) and 0 <= value <= 1


def _url_query_component(value: str) -> str:
    """Use URLSearchParams-compatible form encoding for canonical comparisons."""
    return quote_plus(value, safe="*").replace("~", "%7E")


def _source_url(value: str) -> str | None:
    """Validate/canonicalize source metadata; never fetch the supplied URL."""
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        scheme = url.scheme.lower()
        host = (url.hostname or "").encode("idna").decode("ascii").lower()
        port = url.port  # Access validates a malformed/out-of-range port.
        if scheme not in {"http", "https"} or url.username or url.password:
            return None
        if (
            "." not in host
            or host == "localhost"
            or re.fullmatch(r"[\d.]+", host)
            or ":" in host
            or re.search(r"\.(localhost|local|internal|test)$", host)
        ):
            return None
        netloc = host
        if port is not None and (scheme, port) not in {("http", 80), ("https", 443)}:
            netloc += f":{port}"
        # WHATWG URLs remove ordinary dot path segments and preserve slashes.
        segments: list[str] = []
        raw_path = url.path or "/"
        raw_segments = raw_path.split("/")
        for index, segment in enumerate(raw_segments):
            lowered = segment.lower()
            if lowered in {".", "%2e"}:
                if index == len(raw_segments) - 1:
                    segments.append("")
                continue
            if lowered in {"..", ".%2e", "%2e.", "%2e%2e"}:
                if len(segments) > 1:
                    segments.pop()
                if index == len(raw_segments) - 1:
                    segments.append("")
                continue
            segments.append(segment)
        path = quote("/".join(segments) or "/", safe="/%:@!$&'()*+,;=-._~")
        query_items = [
            (key, item)
            for key, item in parse_qsl(url.query, keep_blank_values=True)
            if not re.match(r"^(utm_|fbclid$|gclid$)", key, re.I)
        ]
        query_items.sort(key=lambda pair: pair[0])
        query = "&".join(
            f"{_url_query_component(key)}={_url_query_component(item)}" for key, item in query_items
        )
        return re.sub(r"/$", "", urlunsplit((scheme, netloc, path, query, "")))
    except (TypeError, ValueError, UnicodeError):
        return None


def _timestamp_ms(value: object) -> float:
    """Parse ISO/RFC date strings; interpret timezone-free ISO values as UTC."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        text = value.strip()
        try:
            parsed = datetime.fromisoformat(
                text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
            )
        except ValueError:
            try:
                parsed = parsedate_to_datetime(text)
            except (TypeError, ValueError, OverflowError):
                return math.nan
    else:
        return math.nan
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    try:
        return parsed.timestamp() * 1000
    except (ValueError, OverflowError, OSError):
        return math.nan


def _current_evidence(item: dict, claim: dict, now: float) -> bool:
    retrieved = _timestamp_ms(item.get("retrievedAt"))
    published = _timestamp_ms(item.get("publishedAt")) if item.get("publishedAt") else None
    if not math.isfinite(retrieved) or retrieved > now + CLOCK_SKEW_MS:
        return False
    if published is not None and (not math.isfinite(published) or published > now + CLOCK_SKEW_MS):
        return False
    if published is not None and published > retrieved + CLOCK_SKEW_MS:
        return False
    if not item.get("temporalMatch"):
        return False
    if not claim.get("timeSensitive"):
        return True
    if published is None:
        return False
    # An authenticated old original can refute a new recycled caption. Stale
    # supporting reports never receive this explicit historical exception.
    if (
        item.get("historicalRefutation")
        and item.get("stance") == "refutes"
        and item.get("isPrimary")
        and item.get("quality", 0) >= 0.9
        and item.get("relevance", 0) >= 0.9
    ):
        return True
    configured_window = claim.get("timeWindowDays")
    window = max(1, min(3650, configured_window)) if _finite_number(configured_window) else 30
    return now - published <= window * DAY_MS and now - retrieved <= window * DAY_MS


def _applicable_parts(item: dict, parts: list[str]) -> set[str]:
    declared = {normalise_text(part) for part in item.get("claimParts", [])}
    return {normalise_text(part) for part in parts if normalise_text(part) in declared}


def _excerpt_tokens(item: dict) -> set[str]:
    """Match Unicode letter/number runs without treating '_' as a token letter."""
    result: set[str] = set()
    current: list[str] = []
    for char in normalise_text(item.get("excerpt", "")):
        if unicodedata.category(char)[0] in {"L", "N"}:
            current.append(char)
        elif current:
            result.add("".join(current))
            current = []
    if current:
        result.add("".join(current))
    return result


def _copied_excerpt(left: dict, right: dict) -> bool:
    a, b = _excerpt_tokens(left), _excerpt_tokens(right)
    if min(len(a), len(b)) < 15:
        return False
    return len(a & b) / len(a | b) >= 0.85


def independent_source_count(evidence: list[dict]) -> int:
    """Count source families after URL/publisher/origin/near-copy merging."""
    parents = list(range(len(evidence)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for i, a in enumerate(evidence):
        for j in range(i + 1, len(evidence)):
            b = evidence[j]
            origin_a = normalise_text(a.get("independenceKey", ""))
            publisher_a = normalise_text(a.get("publisher", ""))
            same_origin = bool(origin_a) and origin_a == normalise_text(
                b.get("independenceKey", "")
            )
            same_publisher = bool(publisher_a) and publisher_a == normalise_text(
                b.get("publisher", "")
            )
            url_a = _source_url(a.get("url", ""))
            same_url = url_a is not None and url_a == _source_url(b.get("url", ""))
            if same_origin or same_publisher or same_url or _copied_excerpt(a, b):
                parents[find(j)] = find(i)
    # Unknown provenance never creates a new independent source family.
    return len(
        {
            find(index)
            for index, item in enumerate(evidence)
            if normalise_text(item.get("independenceKey", ""))
        }
    )


def evaluate_sufficiency(claim: dict, evidence: list[dict], options: dict | None = None) -> dict:
    """Assess a claim/evidence package with the exact versioned JSON contract.

    ``options`` accepts ``attempt``, ``maxAttempts`` and an ISO/datetime ``now``.
    The index is a deterministic policy index, never calibrated confidence.
    All input objects remain unchanged; every automatic verdict is preliminary.
    """
    options = options or {}
    supplied_clock = options.get("now")
    clock = (
        _timestamp_ms(supplied_clock)
        if supplied_clock
        else datetime.now(timezone.utc).timestamp() * 1000
    )
    if not math.isfinite(clock):
        raise ValueError("A valid evaluation timestamp is required.")
    parts = claim_parts(claim)
    unique = list({item.get("id"): item for item in evidence}.values())
    relevant = [
        item
        for item in unique
        if _score_in_range(item.get("relevance"))
        and item["relevance"] >= MIN_RELEVANCE
        and _applicable_parts(item, parts)
    ]
    verified = [
        item
        for item in relevant
        if item.get("verified")
        and _score_in_range(item.get("quality"))
        and item["quality"] >= MIN_QUALITY
        and _source_url(item.get("url", ""))
        and len(item.get("excerpt", "").strip()) >= 20
        and item.get("publisher", "").strip()
    ]
    eligible = [
        item
        for item in verified
        if item.get("contextMatch")
        and _current_evidence(item, claim, clock)
        and item.get("stance") in {"supports", "refutes"}
    ]
    covered = (
        set().union(*(_applicable_parts(item, parts) for item in eligible)) if eligible else set()
    )
    independent_sources = independent_source_count(eligible)
    decisive_primary = any(
        item.get("isPrimary")
        and item["quality"] >= 0.9
        and item["relevance"] >= 0.9
        and len(_applicable_parts(item, parts)) == len(parts)
        for item in eligible
    )
    conflicting_parts: list[str] = []
    for part in parts:
        direct = [
            item for item in eligible if normalise_text(part) in _applicable_parts(item, parts)
        ]
        if any(item["stance"] == "supports" for item in direct) and any(
            item["stance"] == "refutes" for item in direct
        ):
            conflicting_parts.append(part)
    missing_parts = [part for part in parts if normalise_text(part) not in covered]
    complete = bool(parts) and bool(claim.get("text", "").strip()) and not missing_parts
    sufficiently_independent = bool(parts)
    for part in parts:
        matching = [
            item for item in eligible if normalise_text(part) in _applicable_parts(item, parts)
        ]
        if not (
            independent_source_count(matching) >= 2
            or any(
                item.get("isPrimary") and item["quality"] >= 0.9 and item["relevance"] >= 0.9
                for item in matching
            )
        ):
            sufficiently_independent = False
    checks = [
        {
            "id": "relevance",
            "label": "Relevant evidence",
            "passed": bool(relevant),
            "detail": f"{len(relevant)} item(s) address at least one stated claim part at relevance ≥ {MIN_RELEVANCE}.",
        },
        {
            "id": "provenance",
            "label": "Checked sources",
            "passed": bool(verified),
            "detail": f"{len(verified)} item(s) have checked provenance, a usable excerpt and quality ≥ {MIN_QUALITY}; search snippets alone do not qualify.",
        },
        {
            "id": "context",
            "label": "Context and freshness",
            "passed": bool(eligible),
            "detail": f"{len(eligible)} direct item(s) match context and time. {len(verified) - len(eligible)} checked item(s) are contextual, stale, mistimed or inapplicable.",
        },
        {
            "id": "coverage",
            "label": "Claim coverage",
            "passed": complete,
            "detail": f"{len(covered)} of {len(parts)} atomic claim part(s) have applicable direct evidence.",
        },
        {
            "id": "independence",
            "label": "Source independence",
            "passed": sufficiently_independent,
            "detail": "One checked, high-quality primary record directly covers the full claim; the single-primary exception is recorded."
            if decisive_primary and independent_sources < 2
            else f"{independent_sources} independent source family/families after duplicate and syndication checks. Each claim part needs two families or a checked high-quality primary record.",
        },
        {
            "id": "consistency",
            "label": "Unresolved contradictions",
            "passed": bool(eligible) and not conflicting_parts,
            "detail": "No qualifying direct evidence is available to check for contradictions."
            if not eligible
            else f"{len(conflicting_parts)} claim part(s) have conflicting eligible evidence and require review."
            if conflicting_parts
            else "No conflicting eligible stances were found for the same atomic claim part.",
        },
    ]
    weights = [15, 15, 15, 25, 20, 10]
    score = (
        sum(weight for check, weight in zip(checks, weights) if check["passed"]) if eligible else 0
    )
    gaps: list[str] = []
    if not parts or not claim.get("text", "").strip():
        gaps.append("Identify at least one nonempty factual claim.")
    if not relevant:
        gaps.append("Find evidence that directly addresses the stated claim.")
    if not verified:
        gaps.append(
            "Check original source material and provenance; snippets or unverified assertions are insufficient."
        )
    if verified and not eligible:
        gaps.append(
            "Obtain direct evidence with matching context and valid dates; time-sensitive claims require a dated source."
        )
    gaps.extend(f"Missing applicable evidence: {part}" for part in missing_parts)
    if not sufficiently_independent:
        gaps.append(
            "Find independent corroboration or a checked high-quality primary record covering the full claim."
        )
    gaps.extend(f"Resolve conflicting evidence: {part}" for part in conflicting_parts)
    configured_attempt = options.get("attempt")
    attempt = max(0, math.floor(configured_attempt)) if _finite_number(configured_attempt) else 1
    configured_max = options.get("maxAttempts")
    max_attempts = (
        max(1, min(10, math.floor(configured_max))) if _finite_number(configured_max) else 2
    )
    passed = all(check["passed"] for check in checks)
    exhausted = attempt >= max_attempts
    decision = (
        "proceed"
        if passed
        else "human_review"
        if conflicting_parts or exhausted or not parts
        else "retrieve_more"
    )
    if passed:
        reasons = [
            "The supplied evidence meets this versioned sufficiency policy. Proceed to a preliminary factual assessment."
        ]
    elif decision == "human_review":
        reasons = [
            "Material evidence conflicts on the same claim; a reviewer must resolve the conflict."
            if conflicting_parts
            else "The bounded retrieval budget is exhausted. Do not turn missing evidence into a false verdict."
            if exhausted
            else "The input does not identify a verifiable factual claim."
        ]
    else:
        reasons = [
            "The evidence package is incomplete. Perform a targeted additional search before assessing the claim."
        ]
    if len(unique) != len(evidence):
        reasons.append("Duplicate evidence IDs were collapsed before assessment.")
    if len(unique) > len(eligible):
        reasons.append(
            f"{len(unique) - len(eligible)} supplied item(s) did not qualify as direct evidence under this policy."
        )
    query_suffix = "date official statement" if claim.get("timeSensitive") else "primary evidence"
    return {
        "decision": decision,
        "score": score,
        "checks": checks,
        "reasons": reasons,
        "gaps": gaps,
        "suggestedQueries": []
        if decision == "proceed"
        else [f"{part} original source {query_suffix}" for part in (missing_parts or parts)[:4]],
        "independentSources": independent_sources,
        "coveredParts": len(covered),
        "totalParts": len(parts),
        "eligibleEvidenceIds": [item["id"] for item in eligible],
        "policyVersion": POLICY_VERSION,
    }


def derive_verdict(claim: dict, evidence: list[dict], gate: dict) -> dict:
    """Derive only a preliminary factual label after a passing evidence gate."""
    eligible_ids = set(gate.get("eligibleEvidenceIds", []))
    direct = [item for item in evidence if item.get("id") in eligible_ids]
    evidence_ids = [item["id"] for item in direct]

    def result(verdict: str, explanation: str) -> dict:
        return {
            "verdict": verdict,
            "explanation": explanation,
            "evidenceIds": evidence_ids,
            "preliminary": True,
        }

    if gate.get("decision") != "proceed":
        return result(
            "Unverifiable",
            "The available evidence does not yet justify a factual verdict. " + gate["reasons"][0],
        )
    statuses: list[str] = []
    for part in claim_parts(claim):
        matching = [
            item
            for item in direct
            if normalise_text(part)
            in {normalise_text(value) for value in item.get("claimParts", [])}
        ]
        supports = any(item.get("stance") == "supports" for item in matching)
        refutes = any(item.get("stance") == "refutes" for item in matching)
        statuses.append(
            "supported"
            if supports and not refutes
            else "refuted"
            if refutes and not supports
            else "unresolved"
        )
    if not statuses or "unresolved" in statuses:
        return result(
            "Unverifiable",
            "At least one claim part remains unresolved; no automatic factual conclusion is justified.",
        )
    if all(status == "supported" for status in statuses):
        return result(
            "True",
            "The checked evidence supports every stated claim part in the supplied context. This is a preliminary assessment based on the cited evidence package.",
        )
    if all(status == "refuted" for status in statuses):
        return result(
            "False",
            "The checked evidence contradicts every stated claim part. The conclusion follows from refuting evidence, not from a failure to find support.",
        )
    return result(
        "Misleading",
        "The evidence supports some parts of the claim and contradicts others. Presenting these parts together creates an inaccurate impression; the cited evidence identifies the distinction.",
    )
