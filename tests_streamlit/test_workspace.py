"""Workflow boundaries and actual SQL transactions without paid provider calls.

SQLite executes repository transactions locally. PostgreSQL tests below run only
against an explicitly supplied TEST_DATABASE_URL (the CI disposable service).
"""

from __future__ import annotations

import base64
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from evidence_streamlit.policy import get_scenario
from evidence_streamlit.providers import ProviderError
from evidence_streamlit.storage import SqlRepository, WorkspaceError, checked_case, encode
from evidence_streamlit.workspace import Workspace, merge_evidence

CLAIM = "The town library will remain open until 10 PM next week."
LIVE_SETTINGS = {
    "DATABASE_URL": "postgresql://test-only/workspace",
    "GEMINI_API_KEY": "test-key",
    "TAVILY_API_KEY": "test-key",
    "GEMINI_MODEL": "test-model",
}
REASON = "I checked the original source and its context. This records the available evidence and the limits of the conclusion."


def identity(user_id=None, reviewer=False):
    return {
        "id": user_id or "test:" + str(uuid4()),
        "name": "Test researcher",
        "authenticated": True,
        "authorized": True,
        "can_investigate": True,
        "can_review": reviewer,
    }


def source(claim=CLAIM, **changes):
    return {
        "title": "Library opening hours notice",
        "url": "https://example.org/library-hours",
        "publisher": "Town Library",
        "publishedAt": "2026-01-05T00:00:00Z",
        "excerpt": "The original town library notice says its opening hours extend to 10 PM next week.",
        "stance": "supports",
        "claimParts": [claim],
        "quality": 0.95,
        "relevance": 0.95,
        "isPrimary": True,
        "contextMatch": True,
        "temporalMatch": True,
        **changes,
    }


def article(article_id="a", **changes):
    return {
        "articleId": article_id,
        "title": "Library hours fact check",
        "site": "Test publisher",
        "primaryClaim": CLAIM,
        "content": "The town library has announced extended opening hours.",
        "verdict": "",
        "url": "https://example.org/fact-check",
        "date": None,
        **changes,
    }


class WorkspaceAssertions(unittest.TestCase):
    def assert_error(self, code, function, *args, **kwargs):
        with self.assertRaises(WorkspaceError) as context:
            function(*args, **kwargs)
        self.assertEqual(context.exception.code, code)
        return context.exception


class SessionWorkflowTests(WorkspaceAssertions):
    def setUp(self):
        self.state = {}
        self.workspace = Workspace(
            self.state, {}, {"authenticated": False, "id": "not-trusted", "can_review": True}
        )

    def test_session_owner_cannot_be_spoofed_and_other_session_cannot_read(self):
        case = self.workspace.create_case(CLAIM)
        other = Workspace({}, {}, {"id": self.workspace.owner_id, "authenticated": False})
        self.assertNotEqual(self.workspace.owner_id, "not-trusted")
        self.assertNotEqual(self.workspace.owner_id, other.owner_id)
        self.assertFalse(self.workspace.user["can_review"])
        self.assert_error("case_not_found", other.get_case, case["id"], review=True)

    def test_unknown_authenticated_identity_fails_closed(self):
        self.assert_error(
            "access_denied",
            Workspace,
            {},
            {},
            {"id": "attacker", "authenticated": True, "authorized": False, "can_review": True},
        )

    def test_idempotent_create_does_not_duplicate_case_or_audit(self):
        first = self.workspace.create_case(CLAIM, request_id="request-1234")
        second = self.workspace.create_case(CLAIM, request_id="request-1234")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.workspace.export_case(first["id"])["audit"]), 1)
        self.assert_error(
            "idempotency_conflict",
            self.workspace.create_case,
            CLAIM + " Changed.",
            request_id="request-1234",
        )

    def test_fixtures_require_explicit_selection_and_reject_edited_text(self):
        fixture = get_scenario("verified-transit")
        manual = self.workspace.create_case(fixture["claim"]["text"])
        self.assertEqual(manual["evidence"], [])
        self.assertEqual(manual["mode"], "manual")
        self.assert_error(
            "scenario_changed", self.workspace.create_case, CLAIM, scenario_id="verified-transit"
        )
        self.assert_error("scenario_required", self.workspace.create_case, mode="demo")

    def test_fixture_uses_fixed_clock_and_demo_owner_can_review(self):
        case = self.workspace.create_case(scenario_id="verified-transit")
        self.assertEqual((case["gate"]["decision"], case["verdict"]), ("proceed", "True"))
        reviewed = self.workspace.review_case(
            case["id"], "True", REASON, [case["evidence"][0]["id"]], True, case["version"]
        )
        self.assertEqual(reviewed["finalVerdict"], "True")
        self.assertFalse(reviewed["preliminary"])
        self.assertEqual(reviewed["reviews"][0]["actorId"], self.workspace.owner_id)

    def test_manual_analyst_cannot_attest_or_approve_real_case(self):
        case = self.workspace.create_case(CLAIM)
        updated = self.workspace.add_evidence(
            case["id"], source(historicalRefutation=True), case["version"], attested=True
        )
        self.assertFalse(updated["evidence"][0]["verified"])
        self.assertFalse(updated["evidence"][0]["historicalRefutation"])
        self.assertEqual(updated["evidence"][0]["independenceKey"], "")
        self.assertEqual(updated["gate"]["eligibleEvidenceIds"], [])
        self.assert_error(
            "reviewer_required",
            self.workspace.review_case,
            updated["id"],
            "True",
            REASON,
            [updated["evidence"][0]["id"]],
            True,
            updated["version"],
        )

    def test_stale_evidence_write_cannot_overwrite_newer_work(self):
        case = self.workspace.create_case(CLAIM)
        self.workspace.add_evidence(case["id"], source(), case["version"])
        self.assert_error(
            "version_conflict", self.workspace.add_evidence, case["id"], source(), case["version"]
        )
        current = self.workspace.get_case(case["id"])
        self.assertEqual(len(current["evidence"]), 1)
        self.assertEqual(len(self.workspace.export_case(case["id"])["audit"]), 2)

    def test_source_validation_rejects_internal_urls_and_invalid_numbers(self):
        case = self.workspace.create_case(CLAIM)
        for bad in (
            source(url="https://127.0.0.1/private"),
            source(quality=float("nan")),
            source(relevance=True),
            source(claimParts=["Other claim"]),
            source(publishedAt="2099-01-01"),
        ):
            with self.subTest(source=bad):
                with self.assertRaises(WorkspaceError):
                    self.workspace.add_evidence(case["id"], bad, case["version"])
        self.assertEqual(self.workspace.get_case(case["id"])["evidence"], [])

    def test_summary_and_export_are_isolated_snapshots(self):
        case = self.workspace.create_case(scenario_id="verified-transit")
        listing = self.workspace.list_cases()[0]
        self.assertTrue(listing["summary"])
        self.assertGreater(listing["evidenceCount"], 0)
        self.assertEqual(listing["evidence"], [])
        self.assertNotIn("ownerId", listing)
        exported = self.workspace.export_case(case["id"])
        exported["audit"][0]["snapshot"]["claim"]["text"] = "Tampered"
        self.assertNotEqual(
            self.workspace.export_case(case["id"])["audit"][0]["snapshot"]["claim"]["text"],
            "Tampered",
        )

    def test_no_paid_calls_without_durable_authorized_storage(self):
        for user in ({"authenticated": False}, identity()):
            workspace = Workspace(
                {},
                {key: value for key, value in LIVE_SETTINGS.items() if key != "DATABASE_URL"},
                user,
            )
            self.assertFalse(workspace.capabilities["live"])
            with patch("evidence_streamlit.workspace.investigate_provider") as provider:
                self.assert_error("live_unavailable", workspace.create_case, CLAIM, mode="live")
                provider.assert_not_called()
            self.assertEqual(workspace.list_cases(), [])

    def test_session_handoff_is_explicitly_unavailable(self):
        case = self.workspace.create_case(CLAIM)
        self.assert_error(
            "durable_storage_required",
            self.workspace.handoff,
            case["id"],
            True,
            case["version"],
            REASON,
        )

    def test_corpus_upsert_owner_scope_and_metadata_only_records(self):
        result = self.workspace.import_corpus([article(content="", primaryClaim="")])
        self.assertEqual(result, {"imported": 1, "total": 1, "upsert": True})
        self.workspace.import_corpus(
            [article(title="Updated library hours", sourceVerdict="False", llmVerdict="True")]
        )
        self.assertEqual(self.workspace.corpus_count(), 1)
        found = self.workspace.search_corpus("library hours")
        self.assertEqual(found[0]["article"]["sourceVerdict"], "False")
        self.assertEqual(found[0]["article"]["llmVerdict"], "True")
        other = Workspace(self.state, {}, identity())
        self.assertEqual(other.corpus_count(), 0)
        self.assertEqual(other.search_corpus("library hours"), [])

    def test_invalid_corpus_batch_is_atomic_and_size_bounded(self):
        self.assert_error(
            "invalid_url",
            self.workspace.import_corpus,
            [article("good"), article("bad", url="http://localhost/x")],
        )
        self.assert_error("duplicate_article", self.workspace.import_corpus, [article(), article()])
        self.assert_error(
            "invalid_batch", self.workspace.import_corpus, [article(str(i)) for i in range(101)]
        )
        self.assert_error(
            "batch_limit",
            self.workspace.import_corpus,
            [article(str(i), content="x" * 30000) for i in range(40)],
        )
        self.assertEqual(self.workspace.corpus_count(), 0)

    def test_case_size_and_history_limits_fail_without_truncation(self):
        case = self.workspace.create_case(CLAIM)
        raw = self.workspace.repository.get(self.workspace.owner_id, case["id"])
        for changes in (
            {"evidence": [{}] * 51},
            {"reviews": [{}] * 21},
            {"events": [{}] * 201},
            {"warnings": ["é" * 600000]},
        ):
            self.assert_error("case_limit", checked_case, {**raw, **changes})
        self.assertEqual(self.workspace.get_case(case["id"])["version"], 1)

    def test_evidence_merge_preserves_conflicts_attestations_and_old_sources_at_cap(self):
        existing = [
            {**source(), "id": str(i), "url": f"https://example.org/{i}", "verified": True}
            for i in range(49)
        ]
        duplicate = {**existing[0], "id": "replacement", "verified": False}
        conflict = {**existing[0], "id": "conflict", "stance": "refutes"}
        additional = {**existing[0], "id": "new", "url": "https://example.org/new"}
        merged, omitted, duplicates = merge_evidence(existing, [duplicate, conflict, additional])
        self.assertEqual(merged[:49], existing)
        self.assertEqual(merged[-1]["stance"], "refutes")
        self.assertEqual((len(merged), omitted, duplicates), (50, 1, 1))


class SqlWorkflowTests(WorkspaceAssertions):
    def setUp(self):
        self.repository = SqlRepository(
            "sqlite+pysqlite:///:memory:", allow_sqlite=True, initialise=True
        )
        self.addCleanup(self.repository.engine.dispose)
        self.owner = self.make_workspace(identity())
        self.reviewer = self.make_workspace(identity(reviewer=True))
        self.other = self.make_workspace(identity())

    def make_workspace(self, user):
        with patch("evidence_streamlit.workspace.SqlRepository", return_value=self.repository):
            return Workspace({}, LIVE_SETTINGS, user)

    def test_runtime_does_not_initialize_schema_or_allow_sqlite_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite+pysqlite:///" + str(Path(directory) / "empty.db")
            self.assert_error("storage_unavailable", SqlRepository, url, allow_sqlite=True)
            self.assert_error("storage_configuration", SqlRepository, url)
        self.assert_error(
            "storage_configuration", SqlRepository, "postgresql://user:secret@host:notaport/db"
        )

    def test_database_failure_never_falls_back_to_session(self):
        state = {}
        with patch(
            "evidence_streamlit.workspace.SqlRepository",
            side_effect=WorkspaceError("storage_unavailable", "Unavailable"),
        ):
            self.assert_error("storage_unavailable", Workspace, state, LIVE_SETTINGS, identity())
        self.assertNotIn("ccs_session_repository_v1", state)

    def test_private_cases_are_invisible_until_explicit_handoff_and_revocation_is_immediate(self):
        case = self.owner.create_case(CLAIM)
        self.assertEqual(self.reviewer.list_reviews(), [])
        self.assert_error("case_not_found", self.reviewer.get_case, case["id"], review=True)
        shared = self.owner.handoff(case["id"], True, case["version"], REASON)
        viewed = self.reviewer.get_case(case["id"], review=True)
        self.assertFalse(viewed["isOwner"])
        self.assertTrue(viewed["canReview"])
        self.assertEqual(self.reviewer.list_reviews()[0]["id"], case["id"])
        self.assert_error("case_not_found", self.reviewer.get_case, case["id"])
        self.assert_error("case_not_found", self.other.get_case, case["id"], review=True)
        self.assert_error(
            "case_not_found", self.reviewer.add_evidence, case["id"], source(), shared["version"]
        )
        self.assertTrue(self.reviewer.export_case(case["id"])["audit"])
        self.owner.handoff(case["id"], False, shared["version"])
        self.assert_error("case_not_found", self.reviewer.export_case, case["id"])
        self.assert_error(
            "case_not_found",
            self.reviewer.review_case,
            case["id"],
            "Unverifiable",
            REASON,
            [],
            False,
            shared["version"],
            override_confirmed=True,
        )

    def test_reviewer_attests_sources_and_records_immutable_actor_and_snapshot(self):
        case = self.owner.create_case(CLAIM)
        case = self.owner.add_evidence(case["id"], source(), case["version"])
        case = self.owner.handoff(case["id"], True, case["version"], REASON)
        source_id = case["evidence"][0]["id"]
        reviewed = self.reviewer.review_case(
            case["id"], "True", REASON, [source_id], True, case["version"]
        )
        self.assertEqual(reviewed["finalVerdict"], "True")
        self.assertTrue(reviewed["evidence"][0]["verified"])
        self.assertEqual(reviewed["reviews"][0]["actorId"], self.reviewer.owner_id)
        self.assertEqual(self.reviewer.list_reviews(), [])
        export = self.owner.export_case(case["id"])
        self.assertFalse(export["audit"][1]["snapshot"]["evidence"][0]["verified"])
        self.assertEqual(export["audit"][-1]["actor_id"], self.reviewer.owner_id)
        self.assertEqual(export["audit"][-1]["owner_id"], self.owner.owner_id)

    def test_definitive_review_requires_attestation_and_explicit_override(self):
        case = self.reviewer.create_case(CLAIM)
        self.assert_error(
            "review_evidence_required",
            self.reviewer.review_case,
            case["id"],
            "True",
            REASON,
            [],
            True,
            case["version"],
            override_confirmed=True,
        )
        case = self.reviewer.add_evidence(case["id"], source(quality=0.3), case["version"])
        ids = [case["evidence"][0]["id"]]
        self.assert_error(
            "attestation_required",
            self.reviewer.review_case,
            case["id"],
            "True",
            REASON,
            ids,
            False,
            case["version"],
        )
        self.assert_error(
            "invalid_evidence",
            self.reviewer.review_case,
            case["id"],
            "True",
            REASON,
            ids + ids,
            True,
            case["version"],
        )
        self.assert_error(
            "override_confirmation_required",
            self.reviewer.review_case,
            case["id"],
            "True",
            REASON,
            ids,
            True,
            case["version"],
        )
        result = self.reviewer.review_case(
            case["id"], "True", REASON, ids, True, case["version"], override_confirmed=True
        )
        self.assertTrue(result["reviews"][0]["override"])

    def test_requested_more_evidence_records_no_final_verdict(self):
        case = self.owner.create_case(CLAIM)
        case = self.owner.handoff(case["id"], True, case["version"], REASON)
        reviewed = self.reviewer.review_case(
            case["id"], None, REASON, [], False, case["version"], decision="request_evidence"
        )
        self.assertIsNone(reviewed["finalVerdict"])
        self.assertTrue(reviewed["preliminary"])
        self.assertEqual(reviewed["reviewStatus"], "pending")

    def test_sql_stale_version_rolls_back_and_preserves_audit(self):
        case = self.owner.create_case(CLAIM)
        old = self.repository.get(self.owner.owner_id, case["id"])
        self.owner.add_evidence(case["id"], source(), case["version"])
        self.assert_error(
            "version_conflict",
            self.repository.save,
            old,
            {**old, "version": 2},
            self.owner.owner_id,
            old["events"][0],
        )
        self.assertEqual(len(self.owner.export_case(case["id"])["audit"]), 2)
        self.assertEqual(len(self.owner.get_case(case["id"])["evidence"]), 1)

    def test_sql_audit_failure_rolls_back_entire_case_update(self):
        case = self.owner.create_case(CLAIM)
        with patch.object(
            self.repository, "_audit_insert", side_effect=RuntimeError("secret database diagnostic")
        ):
            error = self.assert_error(
                "storage_unavailable",
                self.owner.add_evidence,
                case["id"],
                source(),
                case["version"],
            )
        self.assertNotIn("secret", str(error))
        self.assertEqual(self.owner.get_case(case["id"])["version"], 1)
        self.assertEqual(len(self.owner.export_case(case["id"])["audit"]), 1)

    def test_sql_idempotent_create_and_quota_survive_new_workspace(self):
        case = self.owner.create_case(CLAIM, request_id="stable-request")
        second = self.make_workspace(self.owner.user)
        self.assertEqual(second.create_case(CLAIM, request_id="stable-request")["id"], case["id"])
        self.repository.rate_limit(self.owner.owner_id, "test_limit", 1)
        self.assert_error(
            "rate_limit", second.repository.rate_limit, self.owner.owner_id, "test_limit", 1
        )
        self.assertEqual(len(second.list_cases()), 1)

    def test_sql_conflicting_insert_returns_existing_case_without_duplicate_audit(self):
        case = self.owner.create_case(CLAIM, request_id="concurrent-request")
        original = self.repository.get(self.owner.owner_id, case["id"])
        competing = {**deepcopy(original), "id": str(uuid4())}
        retained, created = self.repository.create(competing, self.owner.owner_id)
        self.assertFalse(created)
        self.assertEqual(retained["id"], original["id"])
        self.assertEqual(len(self.owner.export_case(case["id"])["audit"]), 1)
        conflicting = {**competing, "requestHash": "different-payload"}
        self.assert_error(
            "idempotency_conflict", self.repository.create, conflicting, self.owner.owner_id
        )
        self.assertEqual(len(self.owner.list_cases()), 1)

    def test_indeterminate_insert_rowcount_preserves_initial_audit_and_live_run(self):
        # Some real DBAPI/SQLAlchemy INSERT results expose rowcount=-1. Keep
        # actual SQLite transactions and returned rows, changing only that
        # optional driver diagnostic to reproduce the PostgreSQL failure.
        connection_class = self.repository.sa.engine.Connection
        execute = connection_class.execute

        class IndeterminateInsertResult:
            rowcount = -1

            def __init__(self, result):
                self.result = result

            def __getattr__(self, name):
                return getattr(self.result, name)

        def execute_with_unknown_count(connection, statement, *args, **kwargs):
            result = execute(connection, statement, *args, **kwargs)
            return (
                IndeterminateInsertResult(result)
                if getattr(statement, "is_insert", False)
                else result
            )

        output = {
            "claim": {"text": CLAIM, "parts": [CLAIM], "timeSensitive": False, "domain": "General"},
            "evidence": [],
            "notes": [],
        }
        with (
            patch.object(connection_class, "execute", execute_with_unknown_count),
            patch(
                "evidence_streamlit.workspace.investigate_provider", return_value=output
            ) as provider,
        ):
            case = self.owner.create_case(CLAIM, mode="live", request_id="unknown-rowcount")
            self.assertEqual(case["attempt"], 1)
            provider.assert_called_once()
            audit = self.owner.export_case(case["id"])["audit"]
            self.assertEqual([entry["version"] for entry in audit], [1, 2, 3])
            self.assertEqual(audit[0]["event"]["type"], "case_created")
            replay = self.owner.create_case(CLAIM, mode="live", request_id="unknown-rowcount")
            self.assertEqual(replay["id"], case["id"])
            provider.assert_called_once()

    def test_sql_corpus_batch_rolls_back_and_does_not_cross_owners(self):
        self.assert_error(
            "storage_unavailable",
            self.repository.import_articles,
            self.owner.owner_id,
            [article(), {}],
        )
        self.assertEqual(self.owner.corpus_count(), 0)
        self.owner.import_corpus([article()])
        self.other.import_corpus([article(title="Other owner's article")])
        self.assertEqual(
            self.owner.search_corpus("library")[0]["article"]["title"], "Library hours fact check"
        )
        self.assertEqual(self.owner.corpus_count(), 1)

    def test_live_failure_records_no_success_and_redacts_provider_error(self):
        with patch(
            "evidence_streamlit.workspace.investigate_provider",
            side_effect=RuntimeError("API_KEY=secret"),
        ):
            case = self.owner.create_case(CLAIM, mode="live")
        self.assertEqual(case["status"], "failed")
        self.assertEqual(case["attempt"], 0)
        self.assertEqual(case["evidence"], [])
        self.assertNotIn("API_KEY", encode(case))
        self.assertEqual(case["events"][-1]["type"], "investigation_failed")

    def test_failed_screenshot_requires_reupload_before_retry_and_raw_bytes_are_not_stored(self):
        image = {
            "mimeType": "image/png",
            "data": base64.b64encode(b"\x89PNG\r\n\x1a\nprivate-image-bytes").decode(),
        }
        with patch(
            "evidence_streamlit.workspace.investigate_provider",
            side_effect=ProviderError("unavailable", "Unavailable"),
        ):
            case = self.owner.create_case(mode="live", image=image)
        self.assertNotIn(image["data"], encode(self.owner.export_case(case["id"])))
        with patch("evidence_streamlit.workspace.investigate_provider") as provider:
            self.assert_error("image_required", self.owner.investigate, case["id"], case["version"])
            provider.assert_not_called()

    def test_live_retry_freezes_claim_after_manual_evidence_even_without_success(self):
        with patch(
            "evidence_streamlit.workspace.investigate_provider",
            side_effect=RuntimeError("Unavailable"),
        ):
            case = self.owner.create_case(CLAIM, mode="live")
        case = self.owner.add_evidence(case["id"], source(), case["version"])
        with patch(
            "evidence_streamlit.workspace.investigate_provider",
            return_value={
                "claim": {**case["claim"], "text": "Changed claim"},
                "evidence": [],
                "notes": [],
            },
        ) as provider:
            failed = self.owner.investigate(case["id"], case["version"])
        self.assertEqual(provider.call_args.kwargs["existing_claim"], case["claim"])
        self.assertEqual(failed["claim"], case["claim"])
        self.assertEqual(failed["evidence"], case["evidence"])
        self.assertEqual(failed["attempt"], 0)
        self.assertEqual(failed["status"], "failed")

    def test_live_success_is_bounded_and_followups_keep_frozen_claim(self):
        def response(text, settings, **kwargs):
            claim = kwargs.get("existing_claim") or {
                "text": CLAIM,
                "parts": [CLAIM],
                "domain": "General",
                "timeSensitive": False,
            }
            return {"claim": deepcopy(claim), "evidence": [], "notes": []}

        with patch(
            "evidence_streamlit.workspace.investigate_provider", side_effect=response
        ) as provider:
            case = self.owner.create_case(CLAIM, mode="live")
            case = self.owner.investigate(case["id"], case["version"])
            self.assertEqual(provider.call_args.kwargs["existing_claim"], case["claim"])
            case = self.owner.investigate(case["id"], case["version"])
            self.assert_error(
                "search_budget_exhausted", self.owner.investigate, case["id"], case["version"]
            )
            self.assertEqual(provider.call_count, 3)
        self.assertEqual(case["attempt"], 3)
        self.assertIsNone(case["finalVerdict"])

    def test_concurrent_investigation_guard_prevents_duplicate_paid_work(self):
        case = self.owner.create_case(CLAIM)
        raw = self.repository.get(self.owner.owner_id, case["id"])
        raw["status"] = "investigating"
        self.repository.save(
            {**raw, "version": raw["version"]},
            {**raw, "version": raw["version"] + 1},
            self.owner.owner_id,
            raw["events"][0],
        )
        with patch("evidence_streamlit.workspace.investigate_provider") as provider:
            self.assert_error("investigation_running", self.owner.investigate, case["id"], 2)
            provider.assert_not_called()


@unittest.skipUnless(
    os.environ.get("TEST_DATABASE_URL"),
    "Set TEST_DATABASE_URL to an isolated PostgreSQL test service.",
)
class PostgreSQLIntegrationTests(WorkspaceAssertions):
    """Explicit test DSN only; random ownership; never drop/truncate shared tables."""

    def setUp(self):
        self.repository = SqlRepository(os.environ["TEST_DATABASE_URL"], initialise=True)
        self.addCleanup(self.repository.engine.dispose)
        self.user = identity("pgtest:" + str(uuid4()))
        self.review_user = identity("pgtest:" + str(uuid4()), reviewer=True)
        with patch("evidence_streamlit.workspace.SqlRepository", return_value=self.repository):
            self.owner = Workspace({}, LIVE_SETTINGS, self.user)
            self.reviewer = Workspace({}, LIVE_SETTINGS, self.review_user)

    def test_postgres_crud_cas_audit_handoff_and_committed_limits(self):
        case = self.owner.create_case(CLAIM, request_id="pg-idempotency")
        initial_audit = self.owner.export_case(case["id"])["audit"]
        self.assertEqual([entry["version"] for entry in initial_audit], [1])
        self.assertEqual(initial_audit[0]["event"]["type"], "case_created")
        self.assertEqual(
            self.owner.create_case(CLAIM, request_id="pg-idempotency")["id"], case["id"]
        )
        # Exercise the database conflict branch too, bypassing Workspace's
        # ordinary replay lookup as two concurrent requests would do.
        original = self.repository.get(self.user["id"], case["id"])
        retained, created = self.repository.create(
            {**original, "id": str(uuid4())}, self.user["id"]
        )
        self.assertFalse(created)
        self.assertEqual(retained["id"], case["id"])
        self.assertEqual(len(self.owner.export_case(case["id"])["audit"]), 1)
        case = self.owner.add_evidence(case["id"], source(), case["version"])
        self.assert_error("version_conflict", self.owner.add_evidence, case["id"], source(), 1)
        self.assert_error("case_not_found", self.reviewer.get_case, case["id"], review=True)
        case = self.owner.handoff(case["id"], True, case["version"], REASON)
        reviewed = self.reviewer.review_case(
            case["id"], "True", REASON, [case["evidence"][0]["id"]], True, case["version"]
        )
        self.assertEqual(reviewed["finalVerdict"], "True")
        audit = self.owner.export_case(case["id"])["audit"]
        self.assertEqual(len(audit), 4)
        self.assertEqual([entry["version"] for entry in audit], [1, 2, 3, 4])
        self.assertEqual(
            [entry["event"]["type"] for entry in audit],
            ["case_created", "evidence_added", "review_requested", "human_review"],
        )
        self.assertEqual(audit[-1]["actor_id"], self.review_user["id"])
        self.assertEqual(audit[-1]["snapshot"]["finalVerdict"], "True")
        self.repository.rate_limit(self.user["id"], "pg-limit", 1)
        self.assert_error("rate_limit", self.repository.rate_limit, self.user["id"], "pg-limit", 1)
        self.owner.handoff(case["id"], False, reviewed["version"])
        self.assert_error("case_not_found", self.reviewer.get_case, case["id"], review=True)

    def test_postgres_full_text_index_search_and_owner_isolation(self):
        self.owner.import_corpus(
            [
                article("archive", title="Zephyr library opening hours"),
                article(
                    "other",
                    title="Unrelated weather",
                    primaryClaim="Weather forecast",
                    content="Rain forecast",
                ),
            ]
        )
        self.reviewer.import_corpus([article("private", title="Private Zephyr library document")])
        self.assertEqual(
            [row["article"]["articleId"] for row in self.owner.search_corpus("Zephyr")], ["archive"]
        )
        self.assertEqual(self.owner.search_corpus("nonexistentterm"), [])
        self.assert_error(
            "storage_unavailable",
            self.repository.import_articles,
            self.user["id"],
            [article("rollback"), {}],
        )
        self.assertEqual(self.owner.corpus_count(), 2)


if __name__ == "__main__":
    unittest.main()
