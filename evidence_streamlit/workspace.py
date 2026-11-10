"""Authenticated workflow orchestration for the native Streamlit application.

The policy evaluates evidence; this module owns case transitions, bounded live
retrieval, explicit human decisions and private/session storage boundaries.
"""

from __future__ import annotations

import hashlib
import math
from copy import deepcopy
from datetime import datetime, timezone
from typing import MutableMapping
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from .policy import derive_verdict, evaluate_sufficiency, get_scenario, normalise_text
from .providers import (
    ProviderError,
    provider_capabilities,
    validate_screenshot,
    validate_source_url,
)
from .providers import investigate as investigate_provider
from .retrieval import search_corpus as rank_corpus
from .storage import SessionRepository, SqlRepository, WorkspaceError, encode, now_iso

VERDICTS = {"True", "False", "Misleading", "Unverifiable"}
MAX_ATTEMPTS = 3


def text_value(value, label: str, minimum: int = 1, maximum: int = 1000) -> str:
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise WorkspaceError(
            "invalid_input", f"{label} must contain {minimum}–{maximum} characters."
        )
    return value.strip()


def public_url(value) -> str:
    try:
        return validate_source_url(text_value(value, "Source URL", 1, 2048))
    except ProviderError as exc:
        raise WorkspaceError("invalid_url", str(exc)) from None


def _date(value) -> str | None:
    if value in (None, ""):
        return None
    value = text_value(value, "Publication date", 1, 40)
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        moment = moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
        if moment.timestamp() > datetime.now(timezone.utc).timestamp() + 300:
            raise ValueError()
    except ValueError:
        raise WorkspaceError(
            "invalid_date", "Publication date must be valid and cannot be in the future."
        ) from None
    return moment.isoformat().replace("+00:00", "Z")


def merge_evidence(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], int, int]:
    """Keep original attestations and conflicting quotes; report rather than hide caps."""

    def fingerprint(item):
        url = urlsplit(item.get("url", ""))
        canonical = urlunsplit((url.scheme, url.netloc, url.path.rstrip("/"), url.query, ""))
        return canonical, normalise_text(item.get("excerpt", "")), item.get("stance")

    output = deepcopy(existing)
    seen = {fingerprint(item) for item in existing}
    ids = {item["id"] for item in output}
    omitted = duplicates = 0
    for item in incoming:
        key = fingerprint(item)
        if key in seen:
            duplicates += 1
            continue
        if len(output) >= 50:
            omitted += 1
            continue
        entry = deepcopy(item)
        if entry.get("id") in ids or not entry.get("id"):
            entry["id"] = str(uuid4())
        output.append(entry)
        ids.add(entry["id"])
        seen.add(key)
    return output, omitted, duplicates


class Workspace:
    """A per-user workspace; caller must pass identity obtained from verified st.user."""

    def __init__(self, session_state: MutableMapping, settings: dict, user: dict):
        self.state, self.settings = session_state, dict(settings)
        authenticated = user.get("authenticated") is True
        authorized = user.get("authorized") is True
        if authenticated and not authorized:
            raise WorkspaceError(
                "access_denied",
                "This signed-in identity has not been granted access to the research workspace.",
            )
        if authenticated and authorized:
            self.owner_id = text_value(user.get("id"), "Verified identity", 1, 320)
        else:
            if "ccs_anonymous_owner_id" not in session_state:
                session_state["ccs_anonymous_owner_id"] = "session:" + str(uuid4())
            self.owner_id = session_state["ccs_anonymous_owner_id"]
        self.user = {
            **user,
            "id": self.owner_id,
            "authenticated": authenticated,
            "authorized": authorized,
            "can_review": authenticated and authorized and user.get("can_review") is True,
            "can_investigate": authenticated and authorized and user.get("can_investigate") is True,
        }
        database_url = settings.get("DATABASE_URL", "")
        if database_url and authenticated and authorized:
            if not isinstance(database_url, str):
                raise WorkspaceError(
                    "storage_configuration", "DATABASE_URL must be a connection string."
                )
            fingerprint = hashlib.sha256(database_url.encode()).hexdigest()
            cached = session_state.get("ccs_sql_repository")
            if not cached or cached[0] != fingerprint:
                cached = (fingerprint, SqlRepository(database_url))
                session_state["ccs_sql_repository"] = cached
            self.repository = cached[1]
        else:
            self.repository = SessionRepository(session_state)
        self.storage_mode = "postgres" if self.repository.durable else "session"
        self.can_handoff = self.repository.durable and authenticated and authorized
        provider = provider_capabilities(settings)
        self.capabilities = {
            **provider,
            "live": bool(
                provider["live"] and self.user["can_investigate"] and self.repository.durable
            ),
            "ocr": bool(
                provider.get("ocr") and self.user["can_investigate"] and self.repository.durable
            ),
            "review": self.user["can_review"],
            "handoff": self.can_handoff,
            "durable": self.repository.durable,
        }
        if provider["live"] and self.user["can_investigate"] and not self.repository.durable:
            self.capabilities["reason"] = (
                "Live investigation requires authenticated PostgreSQL storage so per-user usage limits persist. Configure DATABASE_URL and initialize its schema."
            )
        if provider["live"] and not self.user["can_investigate"]:
            self.capabilities["reason"] = (
                "Live investigation requires a verified, explicitly authorized sign-in. Synthetic examples and manual evidence are available in this private temporary session."
            )

    def _public(self, record: dict) -> dict:
        result = deepcopy(record)
        for field in ("ownerId", "requestId", "requestHash"):
            result.pop(field, None)
        result["isOwner"] = record["ownerId"] == self.owner_id
        result["canReview"] = bool(
            result["isOwner"] and record["mode"] == "demo" or self.user["can_review"]
        )
        return result

    def _event(self, kind: str, title: str, detail: str) -> dict:
        name = self.user.get("name") or self.user.get("email") or "Session researcher"
        return {
            "id": str(uuid4()),
            "type": kind,
            "title": title,
            "detail": detail,
            "createdAt": now_iso(),
            "actor": str(name)[:200],
        }

    def _load(self, case_id: str, review: bool = False) -> dict:
        return self.repository.get(
            self.owner_id,
            text_value(case_id, "Case ID", 1, 100),
            shared=bool(review and self.user["can_review"] and self.repository.durable),
        )

    def _version(self, record: dict, expected_version) -> None:
        if (
            not isinstance(expected_version, int)
            or isinstance(expected_version, bool)
            or expected_version != record["version"]
        ):
            raise WorkspaceError(
                "version_conflict", "This case changed. Refresh it before submitting your decision."
            )
        if record["status"] == "investigating":
            started = datetime.fromisoformat(record["updatedAt"].replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - started).total_seconds() < 180:
                raise WorkspaceError(
                    "investigation_running", "An investigation is already running for this case."
                )

    def _save(self, previous: dict, next_record: dict, event: dict) -> dict:
        if previous["ownerId"] != self.owner_id and not (
            self.user["can_review"]
            and previous.get("reviewRequested")
            and event["type"] == "human_review"
        ):
            raise WorkspaceError("access_denied", "You cannot change this case.")
        next_record = {
            **next_record,
            "id": previous["id"],
            "ownerId": previous["ownerId"],
            "requestId": previous["requestId"],
            "requestHash": previous["requestHash"],
            "version": previous["version"] + 1,
            "updatedAt": now_iso(),
            "events": [*previous["events"], event],
        }
        return self.repository.save(previous, next_record, self.owner_id, event)

    def _assess(self, record: dict) -> dict:
        gate = evaluate_sufficiency(
            record["claim"],
            record["evidence"],
            {
                "attempt": record["attempt"],
                "maxAttempts": MAX_ATTEMPTS,
                "now": record.get("evaluationDate") or now_iso(),
            },
        )
        assessment = derive_verdict(record["claim"], record["evidence"], gate)
        return {
            **record,
            "gate": gate,
            "verdict": assessment["verdict"],
            "explanation": assessment["explanation"],
            "preliminary": True,
            "finalVerdict": None,
            "status": "human_review"
            if record.get("reviewRequested") or gate["decision"] == "human_review"
            else "ready"
            if gate["decision"] == "proceed"
            else "needs_evidence",
            "reviewStatus": "pending" if record.get("reviewRequested") else "none",
        }

    def list_cases(self) -> list[dict]:
        return [self._public(record) for record in self.repository.list_cases(self.owner_id)]

    def get_case(self, case_id: str, review: bool = False) -> dict:
        return self._public(self._load(case_id, review))

    def create_case(
        self,
        text: str = "",
        scenario_id: str | None = None,
        mode: str = "manual",
        source_url: str = "",
        image: dict | None = None,
        request_id: str | None = None,
        time_sensitive: bool = False,
    ) -> dict:
        if mode not in {"demo", "manual", "live"}:
            raise WorkspaceError(
                "invalid_mode", "Choose manual evidence, live investigation or a synthetic example."
            )
        if scenario_id:
            if mode == "live":
                raise WorkspaceError(
                    "invalid_scenario", "A synthetic example cannot be a live investigation."
                )
            mode = "demo"
        scenario = get_scenario(scenario_id) if scenario_id else None
        if mode == "demo" and not scenario:
            raise WorkspaceError("scenario_required", "Choose an explicit synthetic example.")
        text = text_value(text, "Claim", 0, 8000)
        if source_url and image:
            raise WorkspaceError("invalid_input", "Choose either an article URL or a screenshot.")
        if (source_url or image) and mode != "live":
            raise WorkspaceError(
                "live_required",
                "Article and screenshot extraction require live investigation. Paste text for manual evidence.",
            )
        if mode == "live" and not self.capabilities["live"]:
            raise WorkspaceError("live_unavailable", self.capabilities["reason"])
        if scenario and text and text != scenario["claim"]["text"]:
            raise WorkspaceError(
                "scenario_changed",
                "The example text changed. Open a manual or live investigation for the new claim.",
            )
        if not scenario and not source_url and not image and len(text) < 10:
            raise WorkspaceError(
                "claim_required", "Enter a factual claim of at least 10 characters."
            )
        if source_url:
            source_url = public_url(source_url)
        if image:
            try:
                validate_screenshot(image)
            except ProviderError as error:
                raise WorkspaceError(error.code, str(error)) from None
        request_id = text_value(request_id or str(uuid4()), "Request ID", 8, 100)
        input_hash = hashlib.sha256(
            encode(
                {
                    "text": text,
                    "scenario": scenario_id,
                    "mode": mode,
                    "sourceUrl": source_url,
                    "image": image,
                    "timeSensitive": time_sensitive,
                }
            ).encode()
        ).hexdigest()
        existing = self.repository.find_request(self.owner_id, request_id)
        if existing:
            if existing["requestHash"] != input_hash:
                raise WorkspaceError(
                    "idempotency_conflict", "This request identifier belongs to different content."
                )
            return self._public(existing)
        self.repository.rate_limit(self.owner_id, "create", 30)
        claim = (
            deepcopy(scenario["claim"])
            if scenario
            else {
                "text": text or "Extract the factual claim from the submitted content.",
                "parts": [text or "The submitted content's factual claim"],
                "timeSensitive": bool(time_sensitive),
                "domain": "General",
            }
        )
        now = now_iso()
        record = {
            "id": str(uuid4()),
            "ownerId": self.owner_id,
            "requestId": request_id,
            "requestHash": input_hash,
            "version": 1,
            "claim": claim,
            "mode": mode,
            "inputType": "image" if image else "url" if source_url else "text",
            "originalInput": {"text": text, "url": source_url},
            "scenarioId": scenario_id,
            "evaluationDate": scenario["evaluationDate"] if scenario else None,
            "evidence": deepcopy(scenario["evidence"]) if scenario else [],
            "events": [
                self._event(
                    "case_created",
                    "Synthetic investigation opened" if scenario else "Investigation opened",
                    "Explicit fictional teaching example; fixed evaluation date."
                    if scenario
                    else "Your claim was saved in your private workspace.",
                )
            ],
            "reviews": [],
            "attempt": 1 if scenario else 0,
            "createdAt": now,
            "updatedAt": now,
            "reviewRequested": False,
            "reviewStatus": "none",
            "handoffReason": None,
            "warnings": [
                "Synthetic teaching example. The events and sources are fictional; this is not a live fact-check."
            ]
            if scenario
            else [],
        }
        saved, created = self.repository.create(self._assess(record), self.owner_id)
        if mode == "live" and created:
            saved = self._investigate(saved, image=image)
        return self._public(saved)

    def add_evidence(
        self, case_id: str, evidence: dict, expected_version: int, attested: bool = False
    ) -> dict:
        record = self._load(case_id)
        self._version(record, expected_version)
        if not isinstance(evidence, dict):
            raise WorkspaceError("invalid_input", "Evidence must be a source record.")
        url = public_url(evidence.get("url"))
        stance = evidence.get("stance", "unclear")
        if stance not in {"supports", "refutes", "context", "unclear"}:
            raise WorkspaceError("invalid_stance", "Choose a valid evidence stance.")
        parts = evidence.get("claimParts", [])
        if (
            not isinstance(parts, list)
            or len(parts) > 20
            or any(
                not isinstance(part, str) or part not in record["claim"]["parts"] for part in parts
            )
        ):
            raise WorkspaceError(
                "invalid_claim_parts", "Choose only the claim parts addressed by this source."
            )
        scores = {}
        for name in ("relevance", "quality"):
            value = evidence.get(name, 0.3)
            if (
                not isinstance(value, (float, int))
                or isinstance(value, bool)
                or not math.isfinite(value)
                or not 0 <= value <= 1
            ):
                raise WorkspaceError("invalid_score", "Evidence estimates must be between 0 and 1.")
            scores[name] = value
        verified = attested is True and (record["mode"] == "demo" or self.user["can_review"])
        source = {
            "id": str(uuid4()),
            "title": text_value(evidence.get("title"), "Source title", 3, 500),
            "url": url,
            "publisher": text_value(
                evidence.get("publisher") or urlsplit(url).hostname, "Publisher", 1, 200
            ),
            "publishedAt": _date(evidence.get("publishedAt")),
            "retrievedAt": record.get("evaluationDate") or now_iso(),
            "excerpt": text_value(evidence.get("excerpt"), "Evidence excerpt", 20, 12000),
            "stance": stance,
            "independenceKey": text_value(
                evidence.get("independenceKey") or "", "Original source family", 0, 200
            ),
            "claimParts": parts,
            "contextMatch": evidence.get("contextMatch") is True,
            "temporalMatch": evidence.get("temporalMatch") is True,
            "isPrimary": evidence.get("isPrimary") is True,
            "historicalRefutation": verified and evidence.get("historicalRefutation") is True,
            "origin": "manual",
            "verified": verified,
            **scores,
        }
        self.repository.rate_limit(self.owner_id, "evidence", 60)
        next_record = self._assess({**record, "evidence": [*record["evidence"], source]})
        return self._public(
            self._save(
                record,
                next_record,
                self._event(
                    "evidence_added",
                    "Evidence added",
                    "A reviewer explicitly attested the supplied source."
                    if verified
                    else "Manual source retained as unverified; a reviewer must attest its provenance.",
                ),
            )
        )

    def _investigate(self, record: dict, image: dict | None = None) -> dict:
        if not self.capabilities["live"]:
            raise WorkspaceError("live_unavailable", self.capabilities["reason"])
        if record["attempt"] >= MAX_ATTEMPTS:
            raise WorkspaceError(
                "search_budget_exhausted",
                "Three successful searches have been completed. Add evidence or request human review.",
            )
        if record["inputType"] == "image" and record["attempt"] == 0 and image is None:
            raise WorkspaceError(
                "image_required",
                "The screenshot was not retained. Submit it again in a new investigation, or paste its readable claim as text.",
            )
        self.repository.rate_limit(self.owner_id, "investigate", 15)
        running = self._save(
            record,
            {**record, "status": "investigating", "preliminary": True, "finalVerdict": None},
            self._event(
                "investigation_started",
                "Live investigation started",
                "Retrieving current evidence and checking original excerpts.",
            ),
        )
        try:
            output = investigate_provider(
                running["claim"]["text"],
                self.settings,
                existing_claim=running["claim"]
                if running["attempt"] > 0 or running["evidence"]
                else None,
                source_url=running["originalInput"].get("url", ""),
                image=image,
            )
            if (running["attempt"] > 0 or running["evidence"]) and output["claim"] != running[
                "claim"
            ]:
                raise WorkspaceError(
                    "claim_changed",
                    "Follow-up search changed the frozen claim; its result was not used.",
                )
            evidence, omitted, duplicates = merge_evidence(running["evidence"], output["evidence"])
            warnings = list(dict.fromkeys([*running["warnings"], *output.get("notes", [])]))
            if omitted:
                warnings.append(
                    f"{omitted} new sources omitted at the 50-source limit. Existing evidence and attestations were preserved."
                )
            next_record = self._assess(
                {
                    **running,
                    "claim": running["claim"]
                    if running["attempt"] or running["evidence"]
                    else output["claim"],
                    "evidence": evidence,
                    "attempt": running["attempt"] + 1,
                    "warnings": warnings[-20:],
                }
            )
            return self._save(
                running,
                next_record,
                self._event(
                    "investigation_completed",
                    "Live evidence assessed",
                    f"{len(evidence) - len(running['evidence'])} new source records; {duplicates} exact duplicates skipped; {omitted} source-limit omissions.",
                ),
            )
        except WorkspaceError as error:
            if error.code in {"version_conflict", "case_limit"}:
                raise
            message = (
                "The live provider did not produce a usable result. No new conclusion was made."
            )
        except Exception:
            message = "The live provider did not complete. No new conclusion was made. Retry later or add evidence manually."
        return self._save(
            running,
            {**running, "status": "failed", "warnings": [message]},
            self._event(
                "investigation_failed",
                "Investigation interrupted",
                "No successful retrieval attempt or new verdict was recorded.",
            ),
        )

    def investigate(self, case_id: str, expected_version: int) -> dict:
        record = self._load(case_id)
        self._version(record, expected_version)
        if record["mode"] == "live":
            return self._public(self._investigate(record))
        return self._public(
            self._save(
                record,
                self._assess(record),
                self._event(
                    "evidence_reassessed",
                    "Evidence reassessed",
                    "The saved evidence was checked again. No live search was performed.",
                ),
            )
        )

    def review_case(
        self,
        case_id: str,
        verdict: str | None,
        rationale: str,
        evidence_ids: list[str],
        attested: bool,
        expected_version: int,
        override_confirmed: bool = False,
        decision: str = "approve",
    ) -> dict:
        record = self._load(case_id, review=True)
        self._version(record, expected_version)
        if (
            not (record["mode"] == "demo" and record["ownerId"] == self.owner_id)
            and not self.user["can_review"]
        ):
            raise WorkspaceError(
                "reviewer_required", "Real-case decisions require an authorized reviewer."
            )
        if decision not in {"approve", "revise", "request_evidence"}:
            raise WorkspaceError("invalid_decision", "Choose approve, revise or request evidence.")
        if decision == "request_evidence":
            verdict = None
        elif verdict not in VERDICTS:
            raise WorkspaceError(
                "invalid_verdict", "Choose True, False, Misleading or Unverifiable."
            )
        rationale = text_value(rationale, "Review rationale", 20, 5000)
        if (
            not isinstance(evidence_ids, list)
            or any(not isinstance(item, str) for item in evidence_ids)
            or len(set(evidence_ids)) != len(evidence_ids)
            or any(
                item not in {source["id"] for source in record["evidence"]} for item in evidence_ids
            )
        ):
            raise WorkspaceError(
                "invalid_evidence", "Choose unique evidence sources from this case."
            )
        if evidence_ids and attested is not True:
            raise WorkspaceError(
                "attestation_required",
                "Confirm that you reviewed and attested the selected evidence.",
            )
        if verdict not in {None, "Unverifiable"} and not evidence_ids:
            raise WorkspaceError(
                "review_evidence_required",
                "Select and attest evidence before recording a definitive verdict.",
            )
        evidence = [
            {**source, "verified": True} if source["id"] in evidence_ids else source
            for source in record["evidence"]
        ]
        assessed = self._assess({**record, "evidence": evidence})
        override = verdict is not None and (
            assessed["gate"]["decision"] != "proceed" or verdict != assessed["verdict"]
        )
        if override and (override_confirmed is not True or len(rationale) < 40):
            raise WorkspaceError(
                "override_confirmation_required",
                "Explicitly confirm the override and give at least 40 characters explaining its basis.",
            )
        self.repository.rate_limit(self.owner_id, "review", 30)
        review = {
            "id": str(uuid4()),
            "decision": decision,
            "verdict": verdict,
            "reason": rationale,
            "actorId": self.owner_id,
            "actorName": self.user.get("name") or self.user.get("email") or "Session researcher",
            "createdAt": now_iso(),
            "caseVersion": record["version"],
            "evidenceIds": evidence_ids,
            "evidenceSnapshot": deepcopy(evidence),
            "gateSnapshot": deepcopy(assessed["gate"]),
            "override": override,
        }
        next_record = {
            **assessed,
            "reviews": [*record["reviews"], review],
            "finalVerdict": verdict,
            "preliminary": verdict is None,
            "status": "needs_evidence" if verdict is None else "reviewed",
            "reviewStatus": "pending"
            if verdict is None and record.get("reviewRequested")
            else "completed"
            if record.get("reviewRequested")
            else "none",
        }
        return self._public(
            self._save(
                record,
                next_record,
                self._event(
                    "human_review",
                    "Reviewer requested evidence" if verdict is None else "Human review recorded",
                    rationale,
                ),
            )
        )

    def handoff(
        self, case_id: str, shared: bool, expected_version: int, rationale: str = ""
    ) -> dict:
        if not self.can_handoff:
            raise WorkspaceError(
                "durable_storage_required",
                "Separate-reviewer handoff requires authenticated PostgreSQL storage. A temporary session cannot share cases across users.",
            )
        record = self._load(case_id)
        self._version(record, expected_version)
        if not shared and not rationale:
            rationale = "The owner explicitly withdrew reviewer access. Views and pending reviewer decisions are no longer authorized."
        rationale = text_value(rationale, "Handoff rationale", 20, 3000)
        self.repository.rate_limit(self.owner_id, "handoff", 30)
        next_record = {
            **record,
            "reviewRequested": bool(shared),
            "reviewStatus": "pending" if shared else "none",
            "handoffReason": rationale,
        }
        if shared:
            next_record.update(status="human_review", finalVerdict=None, preliminary=True)
        else:
            next_record["status"] = (
                "reviewed"
                if record["finalVerdict"]
                else "ready"
                if record["gate"]["decision"] == "proceed"
                else "human_review"
                if record["gate"]["decision"] == "human_review"
                else "needs_evidence"
            )
        return self._public(
            self._save(
                record,
                next_record,
                self._event(
                    "review_requested" if shared else "review_withdrawn",
                    "Human review requested" if shared else "Reviewer access withdrawn",
                    rationale,
                ),
            )
        )

    def list_reviews(self) -> list[dict]:
        if not self.user["can_review"]:
            return []
        if not self.repository.durable:
            return []
        return [self._public(record) for record in self.repository.list_reviews()]

    def import_corpus(self, articles: list[dict]) -> dict:
        if not isinstance(articles, list) or not 1 <= len(articles) <= 100:
            raise WorkspaceError("invalid_batch", "Import 1–100 article records per batch.")
        if len(encode({"articles": articles}).encode("utf-8")) > 1_000_000:
            raise WorkspaceError("batch_limit", "Each prepared batch must be no larger than 1 MB.")
        validated = []
        seen = set()
        for article in articles:
            if not isinstance(article, dict):
                raise WorkspaceError("invalid_article", "Each article must be an object.")
            row = {}
            for key, minimum, maximum in (
                ("articleId", 1, 200),
                ("title", 1, 500),
                ("site", 1, 200),
                ("primaryClaim", 0, 2000),
                ("content", 0, 30000),
                ("verdict", 0, 100),
            ):
                row[key] = text_value(article.get(key), key, minimum, maximum)
            if row["articleId"] in seen:
                raise WorkspaceError(
                    "duplicate_article", "An article ID occurs twice in this batch."
                )
            seen.add(row["articleId"])
            row["url"] = public_url(article.get("url"))
            row["date"] = _date(article.get("date"))
            for key, maximum in (
                ("domain", 200),
                ("sourceVerdict", 200),
                ("normalizedVerdict", 200),
                ("llmVerdict", 200),
                ("trueVersion", 5000),
            ):
                if article.get(key) is not None:
                    row[key] = text_value(article[key], key, 0, maximum)
            if "embedding" in article:
                vector = article["embedding"]
                if (
                    not isinstance(vector, list)
                    or not 1 <= len(vector) <= 4096
                    or any(
                        not isinstance(value, (int, float))
                        or isinstance(value, bool)
                        or not math.isfinite(value)
                        for value in vector
                    )
                ):
                    raise WorkspaceError(
                        "invalid_embedding",
                        "Embeddings must be finite numeric vectors with at most 4096 dimensions.",
                    )
                row["embedding"] = vector
                row["embeddingModel"] = text_value(
                    article.get("embeddingModel"), "Embedding model", 1, 200
                )
            validated.append(row)
        self.repository.rate_limit(self.owner_id, "corpus_import", 1000)
        imported = self.repository.import_articles(self.owner_id, validated)
        return {"imported": imported, "total": self.corpus_count(), "upsert": True}

    def corpus_count(self) -> int:
        return self.repository.corpus_count(self.owner_id)

    def search_corpus(self, query: str) -> list[dict]:
        query = text_value(query, "Search query", 3, 500)
        self.repository.rate_limit(self.owner_id, "corpus_search", 120)
        candidates = self.repository.corpus_candidates(self.owner_id, query)
        return rank_corpus(query, candidates, {"limit": 10})

    def export_case(self, case_id: str) -> dict:
        record = self._load(case_id, review=True)
        return {
            "format": "evidence-ai-case-v1",
            "exportedAt": now_iso(),
            "storageMode": self.storage_mode,
            "case": self._public(record),
            "audit": self.repository.audit_for(record["ownerId"], case_id),
        }
