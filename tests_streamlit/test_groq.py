"""Groq contracts use fake credentials and mocked HTTP; never call a live model."""

import base64
import copy
import json
import unittest
from unittest.mock import patch

import httpx
import test_providers as fixtures
from test_providers import CLAIM, FINDING, QUOTE, SETTINGS, SOURCE

from evidence_streamlit import providers as p

GROQ = {
    "MODEL_PROVIDER": "groq",
    "GROQ_API_KEY": "fake-groq-secret",
    "GROQ_MODEL": p.GROQ_MODEL,
    "TAVILY_API_KEY": "fake-search-secret",
}


class GroqTests(unittest.TestCase):
    def run_case(self, **kwargs):
        return fixtures.ProviderTests.run_investigation(self, settings=GROQ, **kwargs)

    def test_text_request_and_exact_quote_grounding(self):
        result, calls = self.run_case()
        self.assertEqual(len(calls), 4)
        request, body = calls[0]
        self.assertEqual(str(request.url), p.GROQ_URL)
        self.assertEqual(request.headers["authorization"], "Bearer fake-groq-secret")
        self.assertNotIn("x-goog-api-key", request.headers)
        self.assertEqual(body["model"], p.GROQ_MODEL)
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertEqual(body["reasoning_effort"], "none")
        self.assertLessEqual(body["max_completion_tokens"], 1536)
        self.assertEqual(result["evidence"][0]["excerpt"], QUOTE)
        self.assertTrue(result["evidence"][0]["verified"])
        self.assertTrue(any("free-tier" in note for note in result["notes"]))
        self.assertFalse(
            any(req.url.host == "generativelanguage.googleapis.com" for req, _ in calls)
        )

    def test_screenshot_wire_format_and_no_bytes_in_output(self):
        image = {
            "mimeType": "image/png",
            "data": base64.b64encode(b"\x89PNG\r\n\x1a\nmock").decode(),
        }
        result, calls = self.run_case(image=image, text="")
        part = calls[0][1]["messages"][1]["content"][0]
        self.assertEqual(
            part,
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + image["data"]}},
        )
        self.assertNotIn(image["data"], json.dumps(result))

    def test_long_user_claim_is_rejected_before_http_without_truncation(self):
        with patch.object(p, "_request") as request:
            with self.assertRaises(p.ProviderError) as caught:
                p.investigate("A" * 7900, GROQ)
            self.assertEqual(caught.exception.code, "model_input_limit")
            request.assert_not_called()

    def test_invalid_configuration_never_falls_back_to_gemini(self):
        for change in (
            {"GROQ_MODEL": "unknown/model"},
            {"GROQ_API_KEY": ""},
            {"MODEL_PROVIDER": "other"},
        ):
            with self.subTest(change=change), patch.object(p, "_make_client") as client:
                config = {**SETTINGS, **GROQ, **change}
                self.assertFalse(p.provider_capabilities(config)["live"])
                with self.assertRaises(p.ProviderError):
                    p.investigate(CLAIM["text"], config)
                client.assert_not_called()

    def test_refusals_truncation_tools_and_malformed_json_fail_closed(self):
        valid = {"finish_reason": "stop", "message": {"content": json.dumps(CLAIM)}}
        responses = [
            {"choices": [{**valid, "finish_reason": "length"}]},
            {
                "choices": [
                    {**valid, "message": {"content": json.dumps(CLAIM), "refusal": "blocked"}}
                ]
            },
            {
                "choices": [
                    {
                        **valid,
                        "message": {"content": json.dumps(CLAIM), "tool_calls": [{"name": "x"}]},
                    }
                ]
            },
            {"choices": [{**valid, "message": {"content": "not JSON"}}]},
            {"choices": [valid, valid]},
            {"choices": [{**valid, "message": {"content": {"text": "wrong type"}}}]},
        ]
        for response in responses:
            with self.subTest(response=response):

                def handler(req, body, calls):
                    return httpx.Response(200, json=response)

                with self.assertRaises(p.ProviderError):
                    self.run_case(handler=handler)

    def test_error_body_is_not_exposed_or_retried_on_another_provider(self):
        seen = []

        def handler(req, body, calls):
            seen.append(req.url.host)
            return httpx.Response(429, text="fake-groq-secret upstream diagnostic")

        with self.assertRaises(p.ProviderError) as caught:
            self.run_case(handler=handler)
        self.assertEqual(caught.exception.code, "provider_rate_limit")
        self.assertNotIn("fake-groq-secret", str(caught.exception))
        self.assertEqual(seen, ["api.groq.com"])

    def test_only_seen_bounded_passages_can_ground_quotes(self):
        sources = [
            {**SOURCE, "url": f"https://museum.gov/hours/{i}", "raw_content": "x" * 1000 + QUOTE}
            for i in range(5)
        ]
        result, calls = self.run_case(sources=sources)
        self.assertEqual(result["evidence"], [])
        submitted = json.loads(calls[-1][1]["messages"][1]["content"][0]["text"])
        self.assertLessEqual(len(submitted["sources"]), 3)
        self.assertTrue(
            all(len(s["rawContent"].encode()) <= p.GROQ_SOURCE_BYTES for s in submitted["sources"])
        )
        self.assertTrue(any("was not assessed" in note for note in result["notes"]))
        self.assertTrue(any("quotation was rejected" in note for note in result["notes"]))

    def test_multibyte_budget_and_existing_claim_are_preserved(self):
        claim = {**CLAIM, "text": "మ్యూజియం ఆదివారం తెరిచి ఉంటుంది.", "parts": ["మ్యూజియం ఆదివారం తెరిచి ఉంటుంది."]}
        before = copy.deepcopy(claim)
        result, calls = self.run_case(
            existing_claim=claim, sources=[{**SOURCE, "raw_content": "తెలుగు " * 1000 + QUOTE}]
        )
        self.assertEqual(claim, before)
        self.assertEqual(result["claim"], before)
        model = [body for req, body in calls if req.url.host == "api.groq.com"][0]
        content = model["messages"][1]["content"][0]["text"]
        self.assertEqual(json.loads(content)["claim"], before)
        self.assertLessEqual(
            p._groq_input_size(p.FINDINGS_INSTRUCTION, [{"text": content}], p.FINDINGS_SCHEMA),
            p.GROQ_INPUT_BUDGET,
        )

    def test_article_excerpt_is_explicit_and_claim_retained(self):
        submitted_claim = "Check the museum's stated opening hours."

        def handler(req, body, calls):
            if req.url.path == "/extract":
                return httpx.Response(
                    200,
                    json={
                        "results": [
                            {"url": body["urls"][0], "raw_content": "Visitor information " * 1000}
                        ]
                    },
                )

        result, calls = self.run_case(
            text=submitted_claim, source_url=SOURCE["url"], handler=handler
        )
        model = [body for req, body in calls if req.url.host == "api.groq.com"][0]
        content = model["messages"][1]["content"][0]["text"]
        self.assertEqual(json.loads(content)["submittedClaim"], submitted_claim)
        self.assertLessEqual(
            p._groq_input_size(p.CLAIM_INSTRUCTION, [{"text": content}], p.CLAIM_SCHEMA),
            p.GROQ_INPUT_BUDGET,
        )
        self.assertTrue(any("initial excerpt" in note for note in result["notes"]))

    def test_snippets_remain_unverified_and_unknown_origins_stay_unknown(self):
        result, _ = self.run_case(
            sources=[{**SOURCE, "raw_content": ""}], findings=[{**FINDING, "sharedOrigin": ""}]
        )
        self.assertFalse(result["evidence"][0]["verified"])
        self.assertEqual(result["evidence"][0]["independenceKey"], "")

    def test_capability_configuration_does_not_make_network_calls(self):
        with patch.object(p, "_make_client") as client:
            self.assertTrue(p.provider_capabilities(GROQ)["live"])
            self.assertTrue(p.provider_capabilities(GROQ)["ocr"])
            self.assertFalse(p.provider_capabilities({**GROQ, "GROQ_MODEL": 1})["live"])
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
