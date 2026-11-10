"""Server configuration and verified OIDC identity for the Streamlit app.

Anonymous work is isolated to the browser session. Persistent work, paid live
calls and real-case review require verified OIDC identity and explicit access.
"""

from __future__ import annotations

import hashlib
import math
import os
import time
import uuid
from collections.abc import Mapping
from typing import Any


def _members(value: Any) -> set[str]:
    if isinstance(value, (list, tuple)):
        return {str(item).strip() for item in value if str(item).strip()}
    return {item.strip() for item in str(value or "").split(",") if item.strip()}


def _boolean(value: Any) -> bool:
    return value is True or str(value).lower() in {"true", "1", "yes"}


def get_settings() -> dict[str, Any]:
    import streamlit as st

    names = (
        "DATABASE_URL",
        "GEMINI_API_KEY",
        "TAVILY_API_KEY",
        "GEMINI_MODEL",
        "REVIEWER_IDS",
        "ALLOWED_USER_IDS",
        "REQUIRE_LOGIN",
    )
    result: dict[str, Any] = {key: os.environ.get(key, "") for key in names}
    try:
        for key in names:
            if key in st.secrets:
                result[key] = st.secrets[key]
        auth = st.secrets.get("auth", {})
        result["AUTH_CONFIGURED"] = bool(
            auth.get("client_id")
            and auth.get("client_secret")
            and auth.get("server_metadata_url")
            and auth.get("cookie_secret")
            and auth.get("redirect_uri")
        )
    except (FileNotFoundError, st.errors.StreamlitSecretNotFoundError):
        result["AUTH_CONFIGURED"] = False
    except Exception:
        # A malformed deployment configuration must not silently open a demo or
        # expose secret-bearing exception details in the browser.
        result["AUTH_CONFIGURED"] = False
        result["CONFIG_ERROR"] = True
    result["REQUIRE_LOGIN"] = _boolean(result["REQUIRE_LOGIN"])
    return result


def identity_from_claims(
    claims: Mapping[str, Any],
    settings: Mapping[str, Any],
    session_id: str,
    *,
    now: float | None = None,
) -> dict[str, Any]:
    """Consume claims only from Streamlit's verified st.user, never a form/header."""
    clock = time.time() if now is None else now
    anonymous = {
        "id": f"session:{session_id}",
        "email": "",
        "name": "Session researcher",
        "authenticated": False,
        "authorized": True,
        "can_review": False,
        "can_investigate": False,
        "expired": False,
    }
    if not settings.get("AUTH_CONFIGURED") or claims.get("is_logged_in") is not True:
        return anonymous
    issuer, subject = claims.get("iss"), claims.get("sub")
    if not isinstance(issuer, str) or not issuer or not isinstance(subject, str) or not subject:
        return {**anonymous, "expired": True}
    expiry, issued = claims.get("exp"), claims.get("iat")
    if (
        isinstance(expiry, bool)
        or not isinstance(expiry, (int, float))
        or not math.isfinite(expiry)
        or expiry <= clock
        or isinstance(issued, bool)
        or not isinstance(issued, (int, float))
        or not math.isfinite(issued)
        or issued > clock + 300
        or expiry <= issued
    ):
        return {**anonymous, "expired": True}
    identifier = "oidc:" + hashlib.sha256(f"{issuer}\0{subject}".encode()).hexdigest()
    reviewers = _members(settings.get("REVIEWER_IDS"))
    allowed = _members(settings.get("ALLOWED_USER_IDS")) | reviewers
    authorized = identifier in allowed
    email = claims.get("email", "")
    email = email[:320] if isinstance(email, str) else ""
    name = claims.get("name")
    name = name[:120] if isinstance(name, str) and name else (email or "Researcher")
    return {
        "id": identifier,
        "email": email,
        "name": name,
        "authenticated": True,
        "authorized": authorized,
        "can_review": authorized and identifier in reviewers,
        "can_investigate": authorized,
        "expired": False,
    }


def resolve_user(settings: Mapping[str, Any]) -> dict[str, Any]:
    import streamlit as st

    session_id = st.session_state.setdefault("evidence_session_identity", str(uuid.uuid4()))
    claims: dict[str, Any] = {}
    if settings.get("AUTH_CONFIGURED"):
        claims = dict(st.user.to_dict())
        claims["is_logged_in"] = bool(st.user.is_logged_in)
    return identity_from_claims(claims, settings, session_id)


def render_auth(settings: Mapping[str, Any], user: Mapping[str, Any]) -> None:
    import streamlit as st

    configured = bool(settings.get("AUTH_CONFIGURED"))
    if settings.get("CONFIG_ERROR"):
        st.error(
            "The server configuration could not be read. Ask the deployment operator to check its secrets format."
        )
        st.stop()
    with st.sidebar:
        if user.get("authenticated"):
            st.caption("SIGNED IN")
            st.text(user["name"])
            with st.expander("Your account ID"):
                st.code(user["id"], language=None)
                st.caption("The deployment operator uses this stable ID to grant access.")
            if st.button("Sign out", key="evidence_sign_out"):
                st.logout()
        elif configured:
            if st.button("Sign in", key="evidence_sign_in", type="primary"):
                st.login()
        else:
            st.caption("SESSION WORKSPACE")
    if settings.get("DATABASE_URL") and not configured:
        st.error(
            "Persistent storage requires OIDC sign-in. Configure [auth] and the user allowlist before enabling DATABASE_URL."
        )
        st.stop()
    if user.get("expired"):
        st.warning("Your sign-in has expired or is incomplete. Sign out and sign in again.")
        if st.button("Refresh sign-in", key="evidence_refresh_sign_in"):
            st.logout()
        st.stop()
    if user.get("authenticated") and not user.get("authorized"):
        st.info(
            "Your identity is verified. The deployment operator must add your account ID to ALLOWED_USER_IDS or REVIEWER_IDS to open this workspace."
        )
        st.code(user["id"], language=None)
        st.stop()
    if settings.get("REQUIRE_LOGIN") and not user.get("authenticated"):
        if configured:
            st.info("Sign in to open this research workspace.")
        else:
            st.error("This deployment requires sign-in, but OIDC settings are missing.")
        st.stop()
