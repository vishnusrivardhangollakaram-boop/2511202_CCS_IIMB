"""Exercise the actual Streamlit entry point without providers or a database.

These tests drive native widgets through AppTest, including form submissions and
reruns. They deliberately use an anonymous, isolated session so the runnable
example cannot quietly depend on production credentials.
"""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parents[1]
ENTRY_POINT = ROOT / "streamlit_app.py"
EMPTY_SETTINGS = {
    key: ""
    for key in (
        "DATABASE_URL",
        "MODEL_PROVIDER",
        "GROQ_API_KEY",
        "GROQ_MODEL",
        "GEMINI_API_KEY",
        "TAVILY_API_KEY",
        "GEMINI_MODEL",
        "REVIEWER_IDS",
        "ALLOWED_USER_IDS",
        "REQUIRE_LOGIN",
    )
}


class WorkspaceUITests(unittest.TestCase):
    """User-facing workflows must work when the app starts with no secrets."""

    def setUp(self):
        self.environment = patch.dict(os.environ, EMPTY_SETTINGS, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def start_app(self) -> AppTest:
        app = AppTest.from_file(str(ENTRY_POINT), default_timeout=20)
        app.secrets.update(EMPTY_SETTINGS)
        app.secrets["auth"] = {}
        app.run()
        self.assert_healthy(app)
        return app

    def assert_healthy(self, app: AppTest):
        self.assertEqual(
            len(app.exception),
            0,
            "\n".join(str(item.value) for item in app.exception),
        )

    @staticmethod
    def button(app: AppTest, label: str):
        matches = [item for item in app.button if item.label == label]
        if len(matches) != 1:
            raise AssertionError(
                f"Expected one {label!r} button; found {[item.label for item in app.button]}"
            )
        return matches[0]

    @staticmethod
    def cases(app: AppTest) -> list[dict]:
        return list(app.session_state["ccs_session_repository_v1"]["cases"].values())

    def create_manual(self, app: AppTest, text: str) -> dict:
        app.text_area(key="claim_text").set_value(text)
        self.button(app, "Create case").click().run()
        self.assert_healthy(app)
        self.assertEqual(len(self.cases(app)), 1)
        return self.cases(app)[0]

    def create_synthetic(self, app: AppTest, scenario_id="verified-transit") -> dict:
        app.selectbox(key="synthetic_scenario").set_value(scenario_id)
        app.button(key="create_synthetic").click().run()
        self.assert_healthy(app)
        self.assertEqual(len(self.cases(app)), 1)
        return self.cases(app)[0]

    def test_no_secrets_landing_is_usable_and_empty(self):
        app = self.start_app()
        self.assertEqual(self.cases(app), [])
        self.assertEqual(app.radio(key="workspace_page").value, "Investigate")
        self.assertFalse(app.button(key="create_synthetic").disabled)
        self.assertFalse(self.button(app, "Create case").disabled)
        self.assertEqual(len(app.error), 0)

    def test_empty_claim_reports_validation_and_can_be_corrected(self):
        app = self.start_app()
        self.button(app, "Create case").click().run()
        self.assert_healthy(app)
        self.assertTrue(len(app.error), "An empty claim should produce a useful error")
        self.assertEqual(self.cases(app), [])
        case = self.create_manual(
            app, "The town library is extending its opening hours this month."
        )
        self.assertEqual(case["mode"], "manual")
        self.assertEqual(case["evidence"], [])
        self.assertIsNone(case["finalVerdict"])

    def test_synthetic_creation_is_explicit_and_preliminary(self):
        app = self.start_app()
        case = self.create_synthetic(app)
        self.assertEqual(case["mode"], "demo")
        self.assertEqual(case["verdict"], "True")
        self.assertTrue(case["preliminary"])
        self.assertIsNone(case["finalVerdict"])
        self.assertGreaterEqual(len(case["evidence"]), 2)
        self.assertEqual(case["reviews"], [])

    def test_manual_text_never_selects_a_synthetic_fixture(self):
        app = self.start_app()
        case = self.create_manual(
            app,
            "Riverton municipal buses will be free on 15 November 2026, from 06:00 to 22:00.",
        )
        self.assertEqual(case["mode"], "manual")
        self.assertEqual(case["evidence"], [])
        self.assertFalse(
            any(item.key == "review_verdict" for item in app.selectbox),
            "Anonymous manual cases must not expose a human approval form",
        )
        self.assertEqual(case["verdict"], "Unverifiable")

    def test_anonymous_sessions_do_not_share_cases(self):
        first = self.start_app()
        self.create_synthetic(first)
        second = self.start_app()
        self.assertEqual(self.cases(second), [])
        self.assertNotEqual(
            first.session_state["ccs_anonymous_owner_id"],
            second.session_state["ccs_anonymous_owner_id"],
        )

    def test_unattested_manual_source_can_be_saved_without_inventing_provenance(self):
        app = self.start_app()
        case = self.create_manual(app, "The town library will close at 10 PM next week.")
        app.text_input(key="source_title").set_value("Library opening-hours notice")
        app.text_input(key="source_url").set_value("https://example.org/library-hours")
        app.text_input(key="source_publisher").set_value("Town Library")
        app.text_area(key="source_excerpt").set_value(
            "The opening hours listed in this notice apply to the town library. "
            "On weekdays next week, the building will remain open until 10 PM."
        )
        app.selectbox(key="source_stance").set_value("supports")
        app.multiselect(key="source_parts").set_value(case["claim"]["parts"])
        self.assertFalse(app.checkbox(key="source_attested").value)
        self.button(app, "Add evidence").click().run()
        self.assert_healthy(app)
        updated = self.cases(app)[0]
        self.assertEqual(len(updated["evidence"]), 1)
        self.assertFalse(updated["evidence"][0]["verified"])
        self.assertEqual(updated["evidence"][0]["independenceKey"], "")
        self.assertIsNone(updated["finalVerdict"])

    def test_synthetic_review_requires_source_attestation_then_records_decision(self):
        app = self.start_app()
        case = self.create_synthetic(app)
        app.selectbox(key="review_verdict").set_value("True")
        app.multiselect(key="review_sources").set_value([item["id"] for item in case["evidence"]])
        rationale = (
            "I inspected the fictional dated notice and independent report; "
            "both address the free-service date and operating hours."
        )
        app.text_area(key="review_reason").set_value(rationale)
        self.button(app, "Record decision").click().run()
        self.assert_healthy(app)
        self.assertTrue(len(app.error))
        self.assertEqual(self.cases(app)[0]["reviews"], [])

        app.checkbox(key="review_attested").check()
        self.button(app, "Record decision").click().run()
        self.assert_healthy(app)
        updated = self.cases(app)[0]
        self.assertEqual(updated["finalVerdict"], "True")
        self.assertFalse(updated["preliminary"])
        self.assertEqual(len(updated["reviews"]), 1)
        self.assertEqual(updated["reviews"][0]["reason"], rationale)
        self.assertEqual(len(updated["reviews"][0]["evidenceIds"]), len(case["evidence"]))
        self.assertGreater(len(updated["events"]), len(case["events"]))

    def test_contrary_review_requires_explicit_override(self):
        app = self.start_app()
        case = self.create_synthetic(app)
        app.selectbox(key="review_verdict").set_value("False")
        app.multiselect(key="review_sources").set_value([item["id"] for item in case["evidence"]])
        app.text_area(key="review_reason").set_value(
            "This fictional exercise intentionally demonstrates a contrary human "
            "decision, with source inspection and an explicit recorded override."
        )
        app.checkbox(key="review_attested").check()
        self.button(app, "Record decision").click().run()
        self.assert_healthy(app)
        self.assertTrue(len(app.error))
        self.assertEqual(self.cases(app)[0]["reviews"], [])

        app.checkbox(key="review_override").check()
        self.button(app, "Record decision").click().run()
        self.assert_healthy(app)
        updated = self.cases(app)[0]
        self.assertEqual(updated["finalVerdict"], "False")
        self.assertTrue(updated["reviews"][0]["override"])

    def test_library_navigation_reopens_the_existing_case(self):
        app = self.start_app()
        case = self.create_synthetic(app)
        app.radio(key="workspace_page").set_value("Case library").run()
        self.assert_healthy(app)
        self.button(app, "Open case").click().run()
        self.assert_healthy(app)
        self.assertEqual(app.radio(key="workspace_page").value, "Investigate")
        self.assertEqual(app.session_state["active_case_id"], case["id"])
        self.assertEqual(len(self.cases(app)), 1)

    def test_every_sidebar_page_renders_without_external_services(self):
        app = self.start_app()
        for page in ("Case library", "Human review", "Corpus", "Method", "Investigate"):
            with self.subTest(page=page):
                app.radio(key="workspace_page").set_value(page).run()
                self.assert_healthy(app)
        self.assertEqual(self.cases(app), [])

    def test_claim_html_is_escaped_in_custom_markup_and_export(self):
        from evidence_streamlit.ui import report_html

        app = self.start_app()
        text = '<img src=x onerror="alert(1)"> The library claim needs evidence.'
        case = self.create_manual(app, text)
        html_elements = [item.value for item in app.markdown if item.proto.allow_html]
        self.assertTrue(any("&lt;img" in item for item in html_elements))
        self.assertFalse(any(text in item for item in html_elements))
        report = report_html(case)
        self.assertIn("&lt;img", report)
        self.assertNotIn(text, report)


if __name__ == "__main__":
    unittest.main()
