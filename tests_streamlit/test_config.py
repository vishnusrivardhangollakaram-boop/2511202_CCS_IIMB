import unittest

from evidence_streamlit.config import identity_from_claims


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.claims = {
            "iss": "https://identity.example",
            "sub": "researcher-1",
            "iat": 900,
            "exp": 2000,
            "is_logged_in": True,
            "email": "a@example.org",
        }
        self.settings = {"AUTH_CONFIGURED": True}

    def identity(self, settings=None, claims=None):
        return identity_from_claims(
            claims or self.claims, settings or self.settings, "session-one", now=1000
        )

    def test_anonymous_is_isolated_and_not_privileged(self):
        a = identity_from_claims({}, {}, "a", now=1000)
        b = identity_from_claims({}, {}, "b", now=1000)
        self.assertNotEqual(a["id"], b["id"])
        self.assertFalse(a["can_review"])
        self.assertFalse(a["can_investigate"])

    def test_unlisted_oidc_user_gets_no_access_or_paid_calls(self):
        user = self.identity()
        self.assertTrue(user["authenticated"])
        self.assertFalse(user["authorized"])
        self.assertFalse(user["can_investigate"])

    def test_reviewer_id_is_explicit_and_not_email(self):
        identifier = self.identity()["id"]
        reviewer = self.identity({"AUTH_CONFIGURED": True, "REVIEWER_IDS": identifier})
        self.assertTrue(reviewer["can_review"])
        self.assertTrue(reviewer["can_investigate"])
        wrong = self.identity({"AUTH_CONFIGURED": True, "REVIEWER_IDS": "a@example.org"})
        self.assertFalse(wrong["can_review"])

    def test_researcher_allowlist_does_not_grant_review(self):
        user = self.identity({"AUTH_CONFIGURED": True, "ALLOWED_USER_IDS": [self.identity()["id"]]})
        self.assertTrue(user["authorized"])
        self.assertFalse(user["can_review"])

    def test_subject_namespace_includes_issuer(self):
        other = self.identity(claims={**self.claims, "iss": "https://other.example"})
        self.assertNotEqual(other["id"], self.identity()["id"])

    def test_expired_future_and_nonfinite_tokens_are_rejected(self):
        for patch in (
            {"exp": 999},
            {"iat": 1301},
            {"exp": float("nan")},
            {"exp": True},
            {"sub": ""},
            {"exp": 800},
        ):
            with self.subTest(patch=patch):
                user = self.identity(claims={**self.claims, **patch})
                self.assertFalse(user["authenticated"])
                self.assertTrue(user["expired"])

    def test_claims_are_ignored_without_configured_auth(self):
        user = identity_from_claims(self.claims, {}, "test", now=1000)
        self.assertFalse(user["authenticated"])


if __name__ == "__main__":
    unittest.main()
