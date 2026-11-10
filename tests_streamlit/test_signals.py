"""Behavioral tests for advisory wording cues; independent of truth assessment."""

import copy
import unittest

from evidence_streamlit.policy import derive_verdict, evaluate_sufficiency, get_scenario
from evidence_streamlit.signals import (
    MAX_SIGNAL_TEXT_LENGTH,
    MESSAGE_SIGNAL_RULES_VERSION,
    analyse_message_signals,
    analyze_message_signals,
)


def ids(text):
    return [signal["id"] for signal in analyze_message_signals(text)["signals"]]


class MessageSignalTests(unittest.TestCase):
    def test_pressure_retains_source_excerpt_and_offsets(self):
        text = "URGENT! Act now. Forward this message to everyone before tonight."
        analysis = analyze_message_signals(text)
        self.assertEqual(ids(text), ["urgency", "forwarding_pressure"])
        for signal in analysis["signals"]:
            self.assertEqual(text[signal["start"] : signal["end"]], signal["matchedText"])
            self.assertIn(signal["matchedText"], signal["excerpt"])
        self.assertEqual(analysis["rulesVersion"], MESSAGE_SIGNAL_RULES_VERSION)
        self.assertEqual(analysis["scope"], "message_wording")

    def test_credentials_are_wording_not_intent(self):
        for text in [
            "Please share your OTP with me.",
            "Enter your banking password here.",
            "Send me your card details.",
            "Provide your Aadhaar number.",
        ]:
            with self.subTest(text=text):
                result = analyze_message_signals(text)
                self.assertIn("credentials_request", ids(text))
                self.assertTrue(
                    any("does not establish intent" in note for note in result["limitations"])
                )

    def test_payments_include_legitimate_requests(self):
        for text in [
            "Send ₹500 to reserve your place.",
            "Please pay the registration fee.",
            "Transfer 2000 INR today.",
            "Pay $25 for the documented subscription renewal.",
        ]:
            with self.subTest(text=text):
                signal = next(
                    s
                    for s in analyze_message_signals(text)["signals"]
                    if s["id"] == "payment_request"
                )
                self.assertIn("Legitimate messages", signal["rationale"])

    def test_authority_and_certainty_are_not_ordinary_citations(self):
        self.assertEqual(
            ids("All doctors agree this is 100% proven."),
            ["authority_assertion", "absolute_certainty"],
        )
        self.assertIn("absolute_certainty", ids("This has guaranteed returns."))
        self.assertEqual(
            ids(
                "Three researchers report a preliminary result, with limitations described in their paper."
            ),
            [],
        )

    def test_directly_negated_safety_advice(self):
        for text in [
            "Never share your OTP.",
            "Do not send your card details.",
            "You should not under any circumstances share your password.",
            "Don't pay the registration fee.",
            "Avoid forwarding pressure; do not forward this to everyone.",
        ]:
            with self.subTest(text=text):
                self.assertEqual(ids(text), [])

    def test_contrast_after_negation_retains_request(self):
        self.assertIn("credentials_request", ids("Do not worry, but send me your OTP."))

    def test_quoted_journal_discussion(self):
        for text in [
            "The journal analyses the phrase 'act now' in advertisements.",
            'Researchers discuss the expression "forward this to everyone" as a linguistic example.',
            "The report discusses urgency, claims of certainty, and payment-request language.",
        ]:
            with self.subTest(text=text):
                self.assertEqual(ids(text), [])

    def test_quoted_forward_still_retains_cues(self):
        text = 'The forwarded message reads: "Act now. Share this with everyone."'
        self.assertEqual(ids(text), ["urgency", "forwarding_pressure"])

    def test_keyword_only_false_positives_are_avoided(self):
        for text in [
            "Pay attention to the source date.",
            "Please share this article about OTP scams.",
            "The article describes password security.",
            "100% of participants completed the questionnaire.",
            "All doctors in this sample were interviewed.",
            "The library closes at 8 pm.",
        ]:
            with self.subTest(text=text):
                self.assertEqual(ids(text), [])

    def test_repetition_is_bounded_and_deterministic(self):
        text = "Act now! Last chance. Act now! Send your OTP. Send your OTP."
        first = analyze_message_signals(text)
        self.assertEqual(ids(text), ["urgency", "credentials_request"])
        self.assertEqual(first, analyze_message_signals(text))
        self.assertEqual(first, analyse_message_signals(text))

    def test_input_is_bounded_and_truncation_is_explicit(self):
        text = "x" * MAX_SIGNAL_TEXT_LENGTH + " Act now!"
        result = analyze_message_signals(text)
        self.assertEqual(result["scannedCharacters"], MAX_SIGNAL_TEXT_LENGTH)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["signals"], [])
        for empty in (None, 9, {}, [], ""):
            self.assertEqual(analyze_message_signals(empty)["signals"], [])
            self.assertFalse(analyze_message_signals(empty)["truncated"])

    def test_native_offsets_and_plain_untrusted_excerpts(self):
        text = "🔎 <script>alert(1)</script> Act now!"
        result = analyze_message_signals(text)
        signal = result["signals"][0]
        self.assertEqual(text[signal["start"] : signal["end"]], "Act now")
        self.assertIn("<script>", signal["excerpt"])
        self.assertEqual(result["scannedCharacters"], len(text))

    def test_advisory_analysis_cannot_change_policy_outputs(self):
        scenario = get_scenario("verified-transit")
        before = copy.deepcopy(scenario)
        options = {"now": scenario["evaluationDate"]}
        gate = evaluate_sufficiency(scenario["claim"], scenario["evidence"], options)
        verdict = derive_verdict(scenario["claim"], scenario["evidence"], gate)
        analyze_message_signals("Act now! Forward this to everyone. This is 100% true!")
        self.assertEqual(scenario, before)
        self.assertEqual(
            evaluate_sufficiency(scenario["claim"], scenario["evidence"], options), gate
        )
        self.assertEqual(derive_verdict(scenario["claim"], scenario["evidence"], gate), verdict)


if __name__ == "__main__":
    unittest.main()
