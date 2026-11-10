"""Native, accessible Streamlit presentation for the evidence workflow.

All dynamic HTML is escaped. Decision and authorization rules remain in Workspace.
"""

from __future__ import annotations

import base64
import html
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Callable
from urllib.parse import urlparse

import streamlit as st

from evidence_streamlit.workspace import Workspace, WorkspaceError

PAGES = ("Investigate", "Case library", "Human review", "Corpus", "Method")
VERDICTS = ("True", "False", "Misleading", "Unverifiable")
STYLE = """
<style>
:root{--ink:#17313e;--muted:#60737b;--teal:#087f75;--line:#d9e3de;--paper:#f8f9f6}
.stApp{font-family:Inter,'Segoe UI',sans-serif}
.stMain .block-container{max-width:1380px;padding-top:2.1rem;padding-bottom:4rem}
[data-testid="stHeader"]{background:rgba(248,249,246,.93)}
section[data-testid="stSidebar"]{border-right:0}
section[data-testid="stSidebar"] .block-container{padding-top:2rem}
[data-testid="stSidebar"] [data-testid="stRadio"]>label{color:#9ab4bd;font-size:.72rem;letter-spacing:.13em;text-transform:uppercase}
[data-testid="stSidebar"] [role="radiogroup"]{gap:.3rem}
[data-testid="stSidebar"] [role="radiogroup"] label{padding:.65rem .5rem;border-radius:.5rem;font-size:.97rem}
[data-testid="stSidebar"] [role="radiogroup"] label:hover{background:#1b3e4b}
[data-testid="stSidebar"] hr{border-color:#35535e}
h1,h2,h3{color:var(--ink);letter-spacing:-.035em}
h1{font-weight:650!important;line-height:1.12!important}
h2{font-size:1.55rem!important;font-weight:650!important}
h3{font-size:1.13rem!important;font-weight:650!important;letter-spacing:-.02em}
p,li{line-height:1.65}
[data-testid="stCaptionContainer"] p{font-size:.83rem;line-height:1.6;color:#60737b}
.stMain [data-testid="stCaptionContainer"],section[data-testid="stSidebar"] [data-testid="stCaptionContainer"]{opacity:1}
section[data-testid="stSidebar"] [data-testid="stCaptionContainer"],section[data-testid="stSidebar"] [data-testid="stCaptionContainer"] p{color:#b9cbcf}
[data-testid="stForm"]{background:white;border:1px solid var(--line);padding:1.45rem}
[data-testid="stVerticalBlockBorderWrapper"]>div{border-radius:.8rem}
[data-testid="stButton"] button,[data-testid="stDownloadButton"] button,[data-testid="stFormSubmitButton"] button{min-height:2.65rem;font-weight:600;letter-spacing:-.01em}
[data-testid="stTextArea"] textarea{line-height:1.65;font-size:1rem}
[data-testid="stMetricValue"]{font-size:1.8rem;color:var(--ink)}
[data-testid="stMetricLabel"] p{font-size:.81rem;color:var(--muted)}
[data-testid="stTabs"] [role="tablist"]{gap:1.4rem}
[data-testid="stTabs"] [role="tab"]{font-size:.9rem;padding-bottom:.75rem}
.brand{display:flex;align-items:center;gap:.7rem;color:#eff8f4;font-size:1.4rem;font-weight:700;letter-spacing:-.04em;margin:0 0 .4rem}
.brand-mark{display:inline-grid;place-items:center;background:#d5eee3;color:#123f46;width:35px;height:35px;border-radius:10px;font-size:1.6rem}
.brand-sub{color:#acc6ca;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;margin-bottom:2.4rem}
.topline{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding-bottom:1rem;margin-bottom:2rem}
.topline-label{color:#5a6f78;font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;font-weight:650}
.status-badge{display:inline-flex;align-items:center;gap:.4rem;background:#e6f1eb;color:#286552;border:1px solid #cee3d9;padding:.3rem .65rem;border-radius:99px;font-size:.72rem;font-weight:600;white-space:nowrap}
.status-badge:before{content:'';height:6px;width:6px;border-radius:50%;background:#4e987c}
.eyebrow{color:var(--teal);font-size:.73rem;letter-spacing:.16em;text-transform:uppercase;font-weight:700;margin-bottom:.85rem}
.hero{margin:0 0 1.9rem;max-width:780px}
.hero h1{font-size:clamp(2rem,3.6vw,3.25rem);margin:0 0 .9rem;padding:0;line-height:1.12;letter-spacing:-.055em}
.hero h1 em{font-family:Georgia,serif;font-weight:400;color:#087f75}
.hero p{font-size:1rem;color:#60737b;max-width:640px;margin:0}
.section-label{font-size:.72rem;letter-spacing:.15em;color:#526c75;text-transform:uppercase;font-weight:700;margin:1.8rem 0 .9rem}
.workflow{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:1.1rem 0;margin:0 0 1.7rem}
.workflow-item{display:flex;gap:.8rem;align-items:flex-start}
.step-number{font-size:.72rem;color:#087f75;background:#e6efe9;border:1px solid #d5e4db;width:27px;height:27px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;font-weight:700}
.workflow-item strong{font-size:.82rem;color:#203c48;display:block}
.workflow-item span:last-child{font-size:.76rem;color:#697d84;line-height:1.5}
.aside-note{padding:1.5rem 1.5rem 1.2rem;background:#edf3ed;border:1px solid #dbe5dc;border-radius:.85rem;margin:.15rem 0 1rem}
.aside-note h3{font-size:1.17rem!important;margin:0 0 .65rem;line-height:1.4}
.aside-note p{font-size:.86rem;color:#5b7475;margin:.5rem 0;line-height:1.7}
.aside-note .rule{height:1px;background:#d1dfd4;margin:1.15rem 0}
.small-label{font-size:.67rem;text-transform:uppercase;font-weight:700;letter-spacing:.14em;color:#597875}
.case-header{padding:1.6rem 1.7rem;border:1px solid #d4e0d7;border-left:4px solid #087f75;background:white;border-radius:.75rem;margin:1.2rem 0}
.case-header h2{font-size:1.38rem!important;line-height:1.5;margin:.65rem 0 .8rem;letter-spacing:-.025em}
.case-meta{color:#61747c;font-size:.75rem}
.tag{display:inline-block;border:1px solid #d6e4dc;background:#eff5f1;color:#456658;padding:.2rem .5rem;border-radius:.3rem;font-size:.68rem;font-weight:650;letter-spacing:.03em;margin-right:.35rem}
.tag.synthetic{background:#f3eee3;color:#866b38;border-color:#e8dcc5}
.verdict-panel{padding:1.4rem 1.6rem;background:#153b48;color:#eff6f3;border-radius:.8rem;margin-bottom:1rem}
.verdict-panel .small-label{color:#9ec9c2}
.verdict-panel h2{color:#f1f7f4;font-size:2rem!important;margin:.35rem 0 .5rem}
.verdict-panel p{color:#c2d5d6;font-size:.88rem;line-height:1.7;margin:0}
.gate-check{display:flex;gap:.65rem;border-bottom:1px solid #e6ece7;padding:.75rem 0}
.gate-icon{flex:0 0 22px;height:22px;border-radius:50%;background:#f1e8d6;color:#927127;font-size:.75rem;display:grid;place-items:center}
.gate-icon.pass{background:#e2f1e8;color:#28735d}
.gate-check strong{display:block;font-size:.85rem;color:#304d58;line-height:1.4}
.gate-check p{font-size:.77rem;color:#6a7e85;line-height:1.6;margin:.2rem 0 0}
.empty-state{padding:2.3rem 1.6rem;border:1px dashed #cddcd3;border-radius:.8rem;text-align:center;margin:1.3rem 0;background:#f4f7f3}
.empty-state h3{margin:.5rem 0;color:#294953}
.empty-state p{max-width:500px;margin:.4rem auto;font-size:.88rem;color:#73858b}
.empty-symbol{font-family:Georgia,serif;font-size:2.2rem;color:#82a89c}
.source-excerpt{border-left:3px solid #cbded2;padding:.3rem 1rem;margin:.8rem 0;background:#f7faf7;color:#425c65;font-size:.9rem;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
.timeline-event{display:grid;grid-template-columns:12px 1fr;gap:.7rem;padding:.7rem 0}
.timeline-dot{width:8px;height:8px;border:2px solid #93b5a5;background:white;border-radius:50%;margin-top:.5rem}
.timeline-event strong{font-size:.85rem;color:#2a4955}
.timeline-event p{color:#647b83;font-size:.81rem;line-height:1.6;margin:.2rem 0}
.timeline-event small{color:#8a999d;font-size:.7rem}
.page-footer{border-top:1px solid var(--line);margin-top:3rem;padding-top:1rem;color:#7d8c90;font-size:.72rem;display:flex;justify-content:space-between;gap:1rem}
@media(max-width:768px){.stMain .block-container{padding:1.2rem 1rem 3rem}.hero h1{font-size:2.1rem}.workflow{gap:.8rem}.workflow-item{gap:.4rem}.workflow-item strong{font-size:.74rem}.workflow-item span:last-child{font-size:.69rem}.step-number{width:22px;height:22px}.topline{align-items:flex-start}.topline-label{font-size:.62rem}.status-badge{font-size:.65rem}.case-header{padding:1.2rem}.page-footer{flex-direction:column}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media print{section[data-testid="stSidebar"],[data-testid="stHeader"],[data-testid="stButton"],[data-testid="stForm"],[data-testid="stDownloadButton"]{display:none!important}.stMain .block-container{padding:0;max-width:none}.stApp{background:white}.case-header,.verdict-panel{break-inside:avoid}}
</style>
"""


def esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def markup(value: str) -> None:
    """Only static templates and esc()-protected values belong here."""
    st.markdown(value, unsafe_allow_html=True)


def safe_url(value: Any) -> str | None:
    try:
        parsed = urlparse(str(value or ""))
        return str(value) if parsed.scheme in {"https", "http"} and parsed.hostname else None
    except ValueError:
        return None


def pretty_date(value: Any) -> str:
    if not value:
        return "Date unknown"
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime(
            "%d %b %Y · %H:%M UTC"
        )
    except ValueError:
        return str(value)


def run_action(action: Callable[[], Any], message: str, *, select: bool = False) -> None:
    try:
        result = action()
    except WorkspaceError as error:
        st.error(getattr(error, "message", str(error)))
    except Exception as error:
        logging.error("Workspace UI action failed (%s)", type(error).__name__)
        st.error(
            "This action could not be confirmed. Check the case history before retrying; the operation may have partially completed."
        )
    else:
        if select and result:
            st.session_state.active_case_id = result["id"]
        st.session_state.workspace_notice = message
        st.rerun()


def empty_state(title: str, description: str, symbol: str = "◈") -> None:
    markup(
        f'<div class="empty-state"><div class="empty-symbol">{esc(symbol)}</div><h3>{esc(title)}</h3><p>{esc(description)}</p></div>'
    )


def page_intro(eyebrow: str, title: str, description: str) -> None:
    markup(
        f'<div class="hero"><div class="eyebrow">{esc(eyebrow)}</div><h1>{esc(title)}</h1><p>{esc(description)}</p></div>'
    )


def capabilities(workspace: Workspace) -> dict[str, Any]:
    value = getattr(workspace, "capabilities", {})
    return value() if callable(value) else value


def render_sidebar(workspace: Workspace, user: dict[str, Any], settings: dict[str, Any]) -> str:
    with st.sidebar:
        page = st.radio("Workspace", PAGES, key="workspace_page", label_visibility="visible")
        st.divider()
        markup('<div class="small-label" style="color:#8fb8b3">RESEARCH WORKSPACE</div>')
        st.caption("Trace the claim. Inspect the evidence. Keep a human accountable.")
        st.divider()
        if workspace.storage_mode == "postgres":
            st.caption("Cases saved to the configured database for your signed-in account.")
        else:
            st.caption(
                "Session-only storage. Reloading or disconnecting may lose your work. Download a report to keep it."
            )
        st.caption("CCS · IIM Bangalore\nEvidence-first misinformation research")
    return page


def render_create(workspace: Workspace) -> None:
    markup(
        '<div class="hero"><div class="eyebrow">Evidence-first investigation</div><h1>Clarity starts<br>with <em>evidence.</em></h1><p>A message can sound convincing and still be wrong. Trace its sources, test what they support, and make the reasoning visible.</p></div>'
    )
    markup(
        '<div class="workflow" aria-label="Investigation workflow"><div class="workflow-item"><span class="step-number">01</span><div><strong>Start with a claim</strong><span>Text, article or screenshot</span></div></div><div class="workflow-item"><span class="step-number">02</span><div><strong>Build the evidence</strong><span>Sources, context and coverage</span></div></div><div class="workflow-item"><span class="step-number">03</span><div><strong>Review the conclusion</strong><span>A traceable human decision</span></div></div></div>'
    )
    left, right = st.columns([2.1, 1], gap="large")
    caps = capabilities(workspace)
    with left:
        st.subheader("What would you like to verify?")
        input_format = st.radio(
            "Input format",
            ("Text", "Article URL", "Screenshot"),
            horizontal=True,
            key="input_format",
        )
        modes = ("Manual", "Live") if caps.get("live") else ("Manual",)
        mode = st.radio(
            "Workflow",
            modes,
            horizontal=True,
            key="workflow_mode",
            help="Manual cases use sources you add. Live mode uses configured retrieval and model providers.",
        )
        if not caps.get("live"):
            st.caption(
                "Manual workspace available. Live retrieval requires provider configuration, PostgreSQL storage and an authorized sign-in."
            )
        unavailable = input_format != "Text" and (
            mode != "Live" or (input_format == "Screenshot" and not caps.get("ocr"))
        )
        if unavailable:
            st.info(
                "This input needs live providers. Paste the claim as text to work manually, or configure live access to use this format."
            )
        with st.form("create_case_form", enter_to_submit=False):
            text = st.text_area(
                "Claim or message",
                height=165,
                max_chars=8000,
                placeholder="Paste the exact claim, including relevant dates, places and context…",
                key="claim_text",
                help="Keep one main claim per case. An automatic assessment does not establish that a claim is true or false.",
            )
            time_sensitive = st.checkbox(
                "This claim depends on a specific or current date",
                key="claim_time_sensitive",
                help="For manual cases, this enables the policy’s source-age check. Live extraction also assesses the claim’s time context.",
            )
            source_url = (
                st.text_input("Article URL", placeholder="https://…", key="claim_url")
                if input_format == "Article URL"
                else ""
            )
            upload = (
                st.file_uploader(
                    "Screenshot",
                    type=("png", "jpg", "jpeg", "webp"),
                    key="claim_image",
                    help="PNG, JPEG or WebP; maximum 2 MB. Upload only content you have permission to process.",
                )
                if input_format == "Screenshot"
                else None
            )
            st.caption(
                "Each case retains its submitted wording and a traceable record of the assessment."
            )
            submitted = st.form_submit_button(
                "Create case", type="primary", width="stretch", disabled=unavailable
            )
        if submitted:
            image = None
            if upload:
                data = upload.getvalue()
                if len(data) > 2_000_000:
                    st.error("Please choose an image smaller than 2 MB.")
                    return
                image = {"data": base64.b64encode(data).decode("ascii"), "mimeType": upload.type}
            if input_format == "Screenshot" and image is None:
                st.error("Choose a screenshot before creating this case.")
            elif input_format == "Article URL" and not safe_url(source_url):
                st.error("Enter a valid http or https article URL.")
            elif not text.strip() and input_format == "Text":
                st.error("Add a claim before creating a case.")
            else:
                with st.spinner("Creating your evidence workspace…"):
                    run_action(
                        lambda: workspace.create_case(
                            text,
                            mode=mode.lower(),
                            source_url=source_url,
                            image=image,
                            request_id=str(uuid.uuid4()),
                            time_sensitive=time_sensitive,
                        ),
                        "Case created. Review the evidence and remaining gaps below.",
                        select=True,
                    )
    with right:
        markup(
            '<div class="aside-note"><div class="small-label">A considered approach</div><h3>Evidence before answers.</h3><p>A strong conclusion needs relevant, independent sources that cover the whole claim.</p><div class="rule"></div><p><strong>Missing evidence is a finding.</strong><br>The workspace can ask for more sources or human review instead of forcing a verdict.</p><p>All automated assessments remain preliminary until an authorized person records a decision.</p></div>'
        )
        render_examples(workspace)


def render_examples(workspace: Workspace) -> None:
    from evidence_streamlit.policy import list_scenarios

    scenarios = list_scenarios()
    if isinstance(scenarios, dict):
        scenarios = list(scenarios.values())
    by_id = {item["id"]: item for item in scenarios}
    with st.container(border=True):
        st.markdown("**Try a synthetic example**")
        st.caption("Fictional claims and sources, made for exploring the workflow.")
        selection = st.selectbox(
            "Example scenario",
            list(by_id),
            format_func=lambda key: by_id[key]["title"],
            key="synthetic_scenario",
            label_visibility="collapsed",
        )
        if selection:
            st.caption(by_id[selection]["description"])
        if st.button("Open example", key="create_synthetic", width="stretch"):
            run_action(
                lambda: workspace.create_case(
                    "", scenario_id=selection, mode="demo", request_id=str(uuid.uuid4())
                ),
                "Synthetic example opened. Its claim and sources are fictional.",
                select=True,
            )


def render_case(
    workspace: Workspace, case: dict[str, Any], *, review_context: bool = False
) -> None:
    if st.session_state.get("form_case_id") != case["id"]:
        for key in list(st.session_state):
            if key.startswith(("source_", "review_", "handoff_")) and key != "review_queue":
                del st.session_state[key]
        st.session_state.form_case_id = case["id"]
    claim = case.get("claim", {})
    gate = case.get("gate") or {}
    evidence = case.get("evidence", [])
    demo = case.get("mode") == "demo"
    approved = case.get("finalVerdict") is not None and not case.get("preliminary", True)
    title = "Human-reviewed decision" if approved else "Preliminary assessment"
    verdict = case.get("finalVerdict") if approved else case.get("verdict", "Unverifiable")
    if isinstance(verdict, dict):
        verdict = verdict.get("verdict", "Unverifiable")
    tag = (
        '<span class="tag synthetic">SYNTHETIC EXAMPLE</span>'
        if demo
        else '<span class="tag">REAL CASE</span>'
    )
    markup(
        f'<div class="case-header">{tag}<span class="tag">{esc(case.get("status", "draft").replace("_", " ").upper())}</span><h2>{esc(claim.get("text", "Untitled case"))}</h2><div class="case-meta">Case {esc(str(case["id"])[:8])} · {esc(pretty_date(case.get("createdAt")))} · Version {esc(case.get("version", 1))}</div></div>'
    )
    if demo:
        st.caption(
            "This is an explicitly selected demonstration. Every event, organization and evidence source in this case is fictional."
        )
    else:
        for warning in case.get("warnings", []):
            st.warning(str(warning))
    overview, sources_tab, notes_tab, review_tab, history_tab = st.tabs(
        [
            "Assessment",
            f"Evidence · {len(evidence)}",
            "Assessment notes",
            "Human review",
            "Activity & export",
        ]
    )
    with overview:
        left, right = st.columns([1.08, 1], gap="large")
        with left:
            explanation = case.get("explanation", "No assessment explanation is available yet.")
            if approved and case.get("reviews"):
                last_review = case["reviews"][-1]
                explanation = last_review.get(
                    "reason", last_review.get("rationale", "Human decision recorded.")
                )
            markup(
                f'<div class="verdict-panel"><div class="small-label">{esc(title)}</div><h2>{esc(verdict)}</h2><p>{esc(explanation)}</p></div>'
            )
            if approved:
                st.caption(
                    "The human decision is recorded separately from the automatic assessment. Its rationale and cited evidence appear in Human review."
                )
                st.caption(
                    f"Automatic assessment retained: {case.get('verdict', 'Unverifiable')}. {case.get('explanation', '')}"
                )
            else:
                st.caption(
                    "Preliminary means the system proposed an assessment. It is not a human approval or a verified fact-check."
                )
            counts = st.columns(3)
            counts[0].metric("Sources collected", len(evidence))
            counts[1].metric("Independent origins", gate.get("independentSources", 0))
            counts[2].metric(
                "Claim coverage",
                f"{gate.get('coveredParts', 0)}/{gate.get('totalParts', len(claim.get('parts', [])))}",
            )
            if gate.get("gaps"):
                st.markdown("**What is still needed**")
                for gap in gate["gaps"]:
                    st.markdown(f"- {escape_markdown(str(gap))}")
            if gate.get("suggestedQueries"):
                with st.expander("Suggested searches"):
                    for query in gate["suggestedQueries"]:
                        st.code(str(query), language=None)
            if case.get("isOwner", True):
                if st.button(
                    "Reassess evidence",
                    key=f"reassess_{case['id']}",
                    help="Re-run the evidence policy. Live cases may make another configured retrieval attempt.",
                ):
                    run_action(
                        lambda: workspace.investigate(case["id"], case["version"]),
                        "Evidence reassessed.",
                    )
        with right:
            st.subheader("Is the evidence sufficient?")
            decision = {
                "proceed": "Ready for a reasoned assessment",
                "retrieve_more": "More evidence is needed",
                "human_review": "Human judgment is needed",
            }.get(gate.get("decision"), "Awaiting assessment")
            st.markdown(f"**{decision}**")
            score = int(gate.get("score", 0))
            st.progress(max(0, min(score, 100)), text=f"Evidence adequacy · {score}/100")
            st.caption(
                "A transparent policy index, not a probability that the claim is true or false."
            )
            for check in gate.get("checks", []):
                passed = check.get("passed", False)
                markup(
                    f'<div class="gate-check"><div class="gate-icon {"pass" if passed else ""}">{"✓" if passed else "!"}</div><div><strong>{esc(check.get("label"))}</strong><p>{esc(check.get("detail"))}</p></div></div>'
                )
    with sources_tab:
        render_sources(case)
        if case.get("isOwner", True):
            render_evidence_form(workspace, case)
    with notes_tab:
        render_notes(case)
    with review_tab:
        render_review(workspace, case)
    with history_tab:
        render_activity(workspace, case)


def escape_markdown(value: str) -> str:
    for character in ("\\", "`", "*", "_", "{", "}", "[", "]", "<", ">", "#", "|", "!"):
        value = value.replace(character, "\\" + character)
    return value


def render_sources(case: dict[str, Any]) -> None:
    evidence = case.get("evidence", [])
    st.subheader("A conclusion is only as good as its sources.")
    st.caption(
        "Inspect what each source actually says, where it came from, and which part of the claim it addresses."
    )
    if not evidence:
        empty_state(
            "The evidence file is open.",
            "Add an original document, credible report or other relevant source to begin testing this claim.",
        )
    for index, source in enumerate(evidence, 1):
        label = f"{index:02d} · {source.get('title', 'Untitled source')}"
        with st.expander(label, expanded=len(evidence) <= 2):
            cols = st.columns([3, 1])
            cols[0].caption(
                f"{source.get('publisher', 'Unknown publisher')} · {pretty_date(source.get('publishedAt'))}"
            )
            cols[1].caption(str(source.get("stance", "unclear")).upper())
            markup(
                f'<div class="source-excerpt">{esc(source.get("excerpt", "No excerpt supplied."))}</div>'
            )
            url = safe_url(source.get("url"))
            if url:
                st.link_button(
                    "Open source ↗", url, key=f"source_link_{case['id']}_{source.get('id', index)}"
                )
            attestation = (
                "Source passage checked" if source.get("verified") else "Not independently checked"
            )
            origin = source.get("independenceKey") or "Unknown origin — not counted as independent"
            st.caption(
                f"{attestation} · {'Primary source' if source.get('isPrimary') else 'Secondary or unspecified source'} · Origin: {origin}"
            )
            parts = source.get("claimParts", [])
            if parts:
                st.markdown("**Addresses these parts of the claim**")
                for part in parts:
                    st.write(str(part))


def render_evidence_form(workspace: Workspace, case: dict[str, Any]) -> None:
    with st.expander("Add evidence to this case", expanded=not case.get("evidence")):
        st.caption(
            "Adding a source does not make it verified. Record uncertainty honestly; an unknown source origin should remain blank."
        )
        suffix = case["id"]
        with st.form(f"evidence_form_{suffix}", enter_to_submit=False):
            title = st.text_input("Source title", key="source_title", max_chars=300)
            row = st.columns(2)
            url = row[0].text_input("Source URL", key="source_url", placeholder="https://…")
            publisher = row[1].text_input(
                "Publisher or issuing organization", key="source_publisher", max_chars=200
            )
            excerpt = st.text_area(
                "Relevant excerpt",
                height=130,
                key="source_excerpt",
                max_chars=12000,
                help="Paste the relevant source passage. Do not summarize beyond what the source supports.",
            )
            row = st.columns(2)
            stance = row[0].selectbox(
                "How does it relate to the claim?",
                ("unclear", "supports", "refutes", "context"),
                key="source_stance",
            )
            published = row[1].date_input(
                "Publication date, if known", value=None, key="source_date"
            )
            origin = st.text_input(
                "Original-source group, if known",
                key="source_origin",
                help="Leave blank if origin is unknown. Copying sites are not independent; give syndicated copies the same original-source group.",
            )
            parts = st.multiselect(
                "Which exact claim parts does this source address?",
                case.get("claim", {}).get("parts", []),
                key="source_parts",
            )
            flags = st.columns(2)
            context = flags[0].checkbox("Context and location match", key="source_context")
            temporal = flags[1].checkbox("Date or time period matches", key="source_temporal")
            primary = flags[0].checkbox("This is a primary source", key="source_primary")
            attested = flags[1].checkbox(
                "I inspected the source and its provenance",
                key="source_attested",
                help="Verification is recorded only when the workspace authorizes your account. This checkbox is optional; unverified evidence can be saved.",
            )
            historical = st.checkbox(
                "An authenticated historical original refutes the claim’s date or context",
                key="source_historical",
                help="Applies only with an authorized source attestation. An old source is not automatically irrelevant when it directly disproves a new caption.",
            )
            row = st.columns(2)
            relevance = row[0].slider(
                "Relevance to this claim",
                0.0,
                1.0,
                0.5,
                0.05,
                key="source_relevance",
                help="A working assessment, not a learned confidence score.",
            )
            quality = row[1].slider(
                "Source-quality assessment",
                0.0,
                1.0,
                0.5,
                0.05,
                key="source_quality",
                help="Assess provenance and reliability. Higher scores do not independently verify a source.",
            )
            submitted = st.form_submit_button("Add evidence", type="primary")
        if submitted:
            if not title.strip() or not excerpt.strip() or not safe_url(url):
                st.error("Enter a source title, a valid http or https URL, and a relevant excerpt.")
            else:
                evidence = {
                    "title": title,
                    "url": url,
                    "publisher": publisher,
                    "excerpt": excerpt,
                    "stance": stance,
                    "publishedAt": published.isoformat() if published else None,
                    "independenceKey": origin.strip(),
                    "claimParts": parts,
                    "contextMatch": context,
                    "temporalMatch": temporal,
                    "isPrimary": primary,
                    "historicalRefutation": historical,
                    "quality": quality,
                    "relevance": relevance,
                }
                run_action(
                    lambda: workspace.add_evidence(
                        case["id"], evidence, case["version"], attested=attested
                    ),
                    "Evidence saved and the assessment updated.",
                )


def render_notes(case: dict[str, Any]) -> None:
    st.subheader("Keep the reasoning inspectable.")
    claim = case.get("claim", {})
    st.markdown("**Claim parts being checked**")
    for index, part in enumerate(claim.get("parts", []), 1):
        st.write(f"{index}. {part}")
    original = case.get("originalInput", {})
    if original.get("text") and original["text"] != claim.get("text"):
        with st.expander("Original submitted wording"):
            st.text(original["text"])
    st.divider()
    st.markdown("**Advisory wording cues**")
    st.caption(
        "Message wording can suggest questions to ask. It does not prove falsity, intent or manipulation, and does not change the evidence gate or verdict."
    )
    try:
        from evidence_streamlit.signals import analyze_message_signals

        text = original.get("text", "").strip() or claim.get("text", "")
        analysis = analyze_message_signals(text)
        st.caption(
            "Scanned material: original submitted text."
            if original.get("text", "").strip()
            else "Scanned material: extracted claim only."
        )
        signals = analysis.get("signals", [])
        if not signals:
            st.info(
                "No advisory wording cues matched. This is not an assessment of truth or safety."
            )
        for signal in signals:
            with st.container(border=True):
                st.markdown(f"**{escape_markdown(signal.get('label', 'Wording cue'))}**")
                st.write(signal.get("rationale", ""))
                st.text(signal.get("excerpt", signal.get("matchedText", "")))
        if analysis.get("truncated"):
            st.caption("Only the first 8,000 characters were scanned.")
    except ImportError:
        st.caption("Wording-cue analysis is unavailable in this installation.")
    with st.expander("Policy record"):
        st.json(
            {
                "policyVersion": case.get("gate", {}).get("policyVersion"),
                "attempt": case.get("attempt", 0),
                "mode": case.get("mode"),
                "eligibleEvidenceIds": case.get("gate", {}).get("eligibleEvidenceIds", []),
                "reasons": case.get("gate", {}).get("reasons", []),
            }
        )


def render_review(workspace: Workspace, case: dict[str, Any]) -> None:
    st.subheader("Human judgment, with a record.")
    st.caption(
        "A recorded decision retains its author, rationale, selected sources and the evidence state at review time."
    )
    for review in case.get("reviews", []):
        with st.container(border=True):
            st.markdown(
                f"**{escape_markdown(review.get('verdict', 'Review'))}** · {escape_markdown(review.get('actorName', 'Reviewer'))}"
            )
            st.write(review.get("reason", review.get("rationale", "")))
            st.caption(
                f"{pretty_date(review.get('createdAt'))} · {len(review.get('evidenceIds', []))} cited sources"
                + (" · Explicit policy override" if review.get("override") else "")
            )
            snapshot_sources = {
                item["id"]: item.get("title", item["id"])
                for item in review.get("evidenceSnapshot", [])
            }
            if review.get("evidenceIds"):
                st.caption(
                    "Cited sources: "
                    + "; ".join(
                        snapshot_sources.get(identifier, identifier)
                        for identifier in review["evidenceIds"]
                    )
                )
    if case.get("mode") == "demo":
        st.info(
            "Practice review is enabled for this synthetic example. It does not confer reviewer access to real cases."
        )
    if case.get("canReview", False):
        sources = {item["id"]: item for item in case.get("evidence", [])}
        with st.form(f"review_form_{case['id']}", enter_to_submit=False):
            decision = st.selectbox(
                "Review action",
                ("approve", "request_evidence", "revise"),
                format_func=lambda value: {
                    "approve": "Record a decision",
                    "request_evidence": "Request more evidence",
                    "revise": "Revise the previous decision",
                }[value],
                key="review_action",
            )
            verdict = st.selectbox("Human verdict", VERDICTS, index=3, key="review_verdict")
            selected = st.multiselect(
                "Sources you inspected and rely on",
                list(sources),
                format_func=lambda value: sources[value].get("title", value),
                key="review_sources",
            )
            reason = st.text_area(
                "Review rationale",
                height=120,
                max_chars=5000,
                key="review_reason",
                help="Explain the decision in at least 20 characters. A contrary decision or insufficient evidence requires an explicit override and at least 40 characters.",
            )
            attested = st.checkbox(
                "I inspected the selected sources and confirm this decision", key="review_attested"
            )
            override = st.checkbox(
                "I explicitly confirm a decision that differs from the automatic assessment or bypasses an insufficient-evidence gate",
                key="review_override",
                help="Use only with a specific rationale. An override is recorded in the audit trail.",
            )
            submitted = st.form_submit_button("Record decision", type="primary")
        if submitted:
            run_action(
                lambda: workspace.review_case(
                    case["id"],
                    verdict,
                    reason,
                    selected,
                    attested,
                    case["version"],
                    override_confirmed=override,
                    decision=decision,
                ),
                "Human review recorded.",
            )
    else:
        st.info(
            "Real-case decisions require a verified account with the reviewer role. You can still collect evidence and export the case."
        )
    if case.get("isOwner", True) and case.get("mode") != "demo":
        st.divider()
        if workspace.can_handoff:
            if case.get("reviewRequested"):
                st.caption(
                    "This case is shared with the configured reviewers. Withdrawing stops further reviewer access; existing audit records remain."
                )
                if st.button("Withdraw reviewer access", key=f"withdraw_{case['id']}"):
                    run_action(
                        lambda: workspace.handoff(
                            case["id"],
                            False,
                            case["version"],
                            rationale="The case owner withdrew shared reviewer access.",
                        ),
                        "Reviewer access withdrawn.",
                    )
            else:
                with st.form(f"handoff_form_{case['id']}"):
                    rationale = st.text_area(
                        "What should the reviewer look at?", key="handoff_reason", max_chars=3000
                    )
                    st.caption(
                        "Submitting explicitly shares this case, its claim and evidence with your installation’s configured reviewers."
                    )
                    if st.form_submit_button("Send for human review"):
                        run_action(
                            lambda: workspace.handoff(
                                case["id"], True, case["version"], rationale=rationale
                            ),
                            "Case shared with the reviewer desk.",
                        )
        else:
            st.caption(
                "Cross-user handoff is unavailable in session-only storage. A configured database and verified identities are needed to share a case with reviewers."
            )


def advisory_signals(case: dict[str, Any]) -> dict[str, Any]:
    """Derived export metadata; never a source of a verdict or gate decision."""
    from evidence_streamlit.signals import analyze_message_signals

    original = str(case.get("originalInput", {}).get("text", "")).strip()
    scanned = original or case.get("claim", {}).get("text", "")
    return {
        **analyze_message_signals(scanned),
        "scannedMaterial": "original submitted text" if original else "extracted claim only",
    }


def report_html(case: dict[str, Any]) -> str:
    """Self-contained printable report; no scripts or remote dependencies."""
    sources = "".join(
        f"<article><h3>{index}. {esc(item.get('title'))}</h3>"
        f"<p>{esc(item.get('publisher'))} · {esc(item.get('stance'))} · "
        f"{'Source passage checked' if item.get('verified') else 'Unverified'}</p>"
        f"<p>{esc(item.get('url'))}</p><blockquote>{esc(item.get('excerpt'))}</blockquote></article>"
        for index, item in enumerate(case.get("evidence", []), 1)
    )
    checks = "".join(
        f"<li><strong>{'Pass' if item.get('passed') else 'Gap'} — "
        f"{esc(item.get('label'))}</strong>: {esc(item.get('detail'))}</li>"
        for item in case.get("gate", {}).get("checks", [])
    )
    reviews = "".join(
        f"<article><h3>{esc(item.get('verdict') or 'More evidence requested')} · "
        f"{esc(item.get('actorName'))}</h3><p>{esc(item.get('reason', item.get('rationale', '')))}</p>"
        f"<p>{esc(item.get('createdAt'))} · Sources: {esc(', '.join(item.get('evidenceIds', [])))}</p></article>"
        for item in case.get("reviews", [])
    )
    events = "".join(
        f"<li><strong>{esc(item.get('title', item.get('type')))}</strong> · "
        f"{esc(item.get('createdAt'))}<p>{esc(item.get('detail'))}</p></li>"
        for item in case.get("events", [])
    )
    analysis = advisory_signals(case)
    signals = (
        "".join(
            f"<li><strong>{esc(signal['label'])}</strong>: {esc(signal['rationale'])}"
            f"<blockquote>{esc(signal['excerpt'])}</blockquote></li>"
            for signal in analysis["signals"]
        )
        or "<li>No advisory wording cues matched. This does not establish truth or safety.</li>"
    )
    label = (
        "SYNTHETIC EXAMPLE — all sources and events are fictional."
        if case.get("mode") == "demo"
        else "Real case"
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence AI — case report</title>
<style>
body{{max-width:850px;margin:3rem auto;padding:0 1.5rem;font:16px/1.7 system-ui,sans-serif;color:#17313e}}
h1{{line-height:1.25}}h2{{border-bottom:1px solid #d9e3de;padding-top:1rem}}
.label{{color:#087f75;text-transform:uppercase;letter-spacing:.12em;font-size:12px}}
article{{break-inside:avoid}}blockquote{{margin:1rem 0;padding:1rem;background:#f2f6f2;border-left:3px solid #087f75;white-space:pre-wrap;overflow-wrap:anywhere}}
p{{overflow-wrap:anywhere}}@media print{{body{{margin:0;max-width:none}}}}
</style></head><body>
<p class="label">Evidence AI · CCS research workspace</p>
<h1>{esc(case.get("claim", {}).get("text"))}</h1>
<p>{label}</p><p>Case {esc(case.get("id"))} · Version {esc(case.get("version"))}</p>
<h2>Assessment</h2>
<p><strong>Preliminary system assessment: {esc(case.get("verdict"))}</strong></p>
<p>Human decision: {esc(case.get("finalVerdict") or "Not recorded")}</p>
<p>{esc(case.get("explanation"))}</p>
<p>Evidence adequacy: {esc(case.get("gate", {}).get("score", 0))}/100 — a policy index, not a probability of truth.</p>
<ul>{checks}</ul>
<h2>Evidence</h2>{sources or "<p>No sources collected.</p>"}
<h2>Human review</h2>{reviews or "<p>No human review recorded.</p>"}
<h2>Advisory wording cues</h2>
<p>Scanned material: {esc(analysis["scannedMaterial"])}. These cues do not establish falsity or deceptive intent and do not affect the evidence gate or verdict.</p>
<ul>{signals}</ul>
<p>{"Only the first 8,000 characters were scanned." if analysis["truncated"] else ""}</p>
<h2>Activity</h2><ul>{events}</ul>
<p>Generated {esc(datetime.now().astimezone().isoformat())}. This report describes a recorded assessment; it does not independently verify a claim.</p>
</body></html>"""


def render_activity(workspace: Workspace, case: dict[str, Any]) -> None:
    st.subheader("A decision you can trace.")
    for event in reversed(case.get("events", [])):
        markup(
            f'<div class="timeline-event"><span class="timeline-dot"></span><div><strong>{esc(event.get("title", event.get("type", "Activity")))}</strong><p>{esc(event.get("detail", ""))}</p><small>{esc(pretty_date(event.get("createdAt")))} · {esc(event.get("actor", "System"))}</small></div></div>'
        )
    st.divider()
    st.markdown("**Keep a copy of this investigation**")
    st.caption(
        "JSON includes the case, evidence and audit record. The HTML report can be opened in a browser and printed to PDF."
    )
    export = workspace.export_case(case["id"])
    export["advisorySignals"] = advisory_signals(case)
    columns = st.columns(2)
    columns[0].download_button(
        "Download case JSON",
        json.dumps(export, ensure_ascii=False, indent=2, default=str),
        file_name=f"evidence-ai-{case['id']}.json",
        mime="application/json",
        width="stretch",
        key=f"download_json_{case['id']}",
    )
    columns[1].download_button(
        "Download printable report",
        report_html(case),
        file_name=f"evidence-ai-{case['id']}.html",
        mime="text/html",
        width="stretch",
        key=f"download_html_{case['id']}",
    )


def render_library(workspace: Workspace) -> None:
    page_intro(
        "Your investigation record",
        "Every claim has a paper trail.",
        "Revisit the evidence, see what changed, and continue an investigation where you left it.",
    )
    cases = workspace.list_cases()
    row = st.columns([2, 1])
    query = row[0].text_input(
        "Search your cases", placeholder="Search claim text…", key="library_query"
    )
    mode = row[1].selectbox(
        "Case type", ("All cases", "Real cases", "Synthetic examples"), key="library_mode"
    )
    filtered = [
        case
        for case in cases
        if query.lower() in case.get("claim", {}).get("text", "").lower()
        and (mode == "All cases" or (case.get("mode") == "demo") == (mode == "Synthetic examples"))
    ]
    st.caption(f"{len(filtered)} of {len(cases)} cases in this workspace")
    if not filtered:
        empty_state(
            "Your next investigation starts with a claim.",
            "Create a case in Investigate or try a fictional example to explore the workflow.",
        )
    for case in filtered:
        with st.container(border=True):
            cols = st.columns([5, 1])
            with cols[0]:
                st.markdown(
                    f"**{escape_markdown(case.get('claim', {}).get('text', 'Untitled case'))}**"
                )
                st.caption(
                    f"{'Synthetic example' if case.get('mode') == 'demo' else 'Real case'} · {case.get('status', 'draft').replace('_', ' ')} · {case.get('evidenceCount', len(case.get('evidence', [])))} sources · {pretty_date(case.get('updatedAt'))}"
                )
            with cols[1]:
                if st.button("Open case", key=f"open_{case['id']}", width="stretch"):
                    st.session_state.active_case_id = case["id"]
                    st.session_state.pending_page = "Investigate"
                    st.rerun()


def render_review_desk(workspace: Workspace, user: dict[str, Any]) -> None:
    page_intro(
        "Human oversight",
        "A careful second look.",
        "Inspect the evidence, challenge incomplete reasoning, and record an accountable decision.",
    )
    if not (user.get("authenticated") and user.get("can_review")):
        st.info(
            "The shared reviewer desk requires a verified account with reviewer access. Synthetic examples include a practice review form within each case."
        )
        return
    cases = workspace.list_reviews()
    if not cases:
        empty_state(
            "No cases are waiting for review.",
            "Cases appear here only when an owner explicitly shares them with reviewers.",
        )
        return
    by_id = {case["id"]: case for case in cases}
    selected = st.selectbox(
        "Review queue",
        list(by_id),
        format_func=lambda key: by_id[key].get("claim", {}).get("text", key),
        key="review_queue",
    )
    if selected:
        render_case(workspace, workspace.get_case(selected, review=True), review_context=True)


def render_corpus(workspace: Workspace, user: dict[str, Any]) -> None:
    page_intro(
        "Historical reference corpus",
        "Find the earlier fact-check.",
        "Search prepared fact-check records for useful leads. A historical verdict is context, not proof about a new claim.",
    )
    st.metric("Articles available", workspace.corpus_count())
    st.caption(
        "Search ranks lexical relevance. A ranking score is not a truth or confidence score."
    )
    with st.form("corpus_search"):
        query = st.text_input(
            "Search the corpus", placeholder="Try an event, phrase or topic…", key="corpus_query"
        )
        searched = st.form_submit_button("Search articles", type="primary")
    if searched:
        if len(query.strip()) < 3:
            st.error("Enter at least three characters to search.")
        else:
            try:
                st.session_state.corpus_matches = workspace.search_corpus(query)
                st.session_state.corpus_searched = True
            except WorkspaceError as error:
                st.error(getattr(error, "message", str(error)))
    matches = st.session_state.get("corpus_matches", [])
    if st.session_state.get("corpus_searched") and not matches:
        empty_state(
            "No matching records.",
            "Try broader keywords, or import a prepared corpus if the workspace is empty.",
        )
    for index, match in enumerate(matches):
        article = match.get("article", match)
        with st.expander(article.get("title", "Untitled article"), expanded=index == 0):
            st.caption(
                f"{article.get('site', 'Unknown publisher')} · {article.get('date') or 'Date unknown'} · Source verdict: {article.get('sourceVerdict', article.get('verdict', 'Unspecified'))}"
            )
            st.write(article.get("primaryClaim", ""))
            st.text(str(article.get("content", ""))[:5000])
            if safe_url(article.get("url")):
                st.link_button("Read original fact-check ↗", article["url"])
            st.caption(
                "Inspect the original before using it as evidence. Matching words can refer to different dates, people or events."
            )
    st.divider()
    with st.expander("Import prepared corpus batches"):
        st.caption(
            "Use the repository’s prepare_corpus.py script to convert licensed data to batch JSON files. Upload batch files, not the manifest. Importing makes records available within this workspace’s configured storage scope."
        )
        limit = 60_000_000 if workspace.storage_mode == "postgres" else 20_000_000
        st.caption(
            f"Up to 100 files per import, 10 MB per file and {limit // 1_000_000} MB combined. Session storage is limited to 5,000 articles / 20 MB; use PostgreSQL for a full corpus."
        )
        files = st.file_uploader(
            "Prepared JSON batch files",
            type=("json",),
            accept_multiple_files=True,
            key="corpus_files",
        )
        if files:
            st.caption(
                f"Selected {len(files)} files · {sum(item.size for item in files) / 1_000_000:.2f} MB"
            )
        consent = st.checkbox(
            "I have permission to process these records and understand their storage scope",
            key="corpus_consent",
        )
        if st.button(
            "Import selected batches", disabled=not files or not consent, key="import_corpus"
        ):
            try:
                if len(files) > 100:
                    raise ValueError("Select at most 100 batch files per import.")
                if sum(uploaded.size for uploaded in files) > limit:
                    raise ValueError(
                        f"Choose files totaling at most {limit // 1_000_000} MB per import."
                    )
                total_records = 0
                for uploaded in files:
                    if uploaded.size > 10_000_000:
                        raise ValueError(f"{uploaded.name} exceeds the 10 MB per-file limit.")
                    value = json.loads(uploaded.getvalue())
                    articles = value.get("articles") if isinstance(value, dict) else value
                    if not isinstance(articles, list) or not all(
                        isinstance(item, dict) for item in articles
                    ):
                        raise ValueError(f"{uploaded.name} is not a batch with an articles array.")
                    total_records += len(articles)
                if not total_records:
                    raise ValueError("The selected files contain no articles.")
                progress = st.progress(0, text="Importing prepared batches…")
                imported = 0
                processed = 0
                for uploaded in files:
                    value = json.loads(uploaded.getvalue())
                    articles = value.get("articles") if isinstance(value, dict) else value
                    for offset in range(0, len(articles), 100):
                        batch = articles[offset : offset + 100]
                        result = workspace.import_corpus(batch)
                        imported += int(result.get("imported", 0))
                        processed += len(batch)
                        progress.progress(
                            processed / total_records,
                            text=f"Processed {processed:,} of {total_records:,} records",
                        )
                st.success(
                    f"Import completed. {imported:,} records accepted; {workspace.corpus_count():,} articles now available."
                )
                st.caption(
                    "Existing article IDs may be updated, so accepted records may exceed the change in corpus size."
                )
            except (ValueError, json.JSONDecodeError, WorkspaceError) as error:
                st.error(
                    f"Import stopped: {getattr(error, 'message', str(error))}. Earlier successful batches remain saved; inspect the count before retrying."
                )


def render_method(workspace: Workspace) -> None:
    page_intro(
        "Method & limitations",
        "Make the reasoning visible.",
        "The workspace brings claim decomposition, source assessment and human judgment into one inspectable process.",
    )
    st.markdown("### What the evidence gate checks")
    st.write(
        "The policy considers whether sources address the claim, cover its separate parts, have known independent origins, match the relevant time and context, and provide sufficiently checked provenance. Unresolved contradictions trigger human judgment."
    )
    st.info(
        "The adequacy index is a heuristic policy score. It is not calibrated confidence, model accuracy, or the probability that a claim is true."
    )
    steps = [
        (
            "1 · Preserve the claim",
            "Retain the submitted wording, identify the exact propositions and relevant context, and separate them from source passages.",
        ),
        (
            "2 · Collect and inspect",
            "Add original documents or retrieve evidence through explicitly configured providers. Search results and historical matches are leads until their provenance is checked.",
        ),
        (
            "3 · Check sufficiency",
            "Evaluate coverage, source independence, provenance, context, timing and contradictions. Collect more evidence or refer for human judgment when needed.",
        ),
        (
            "4 · Record an accountable decision",
            "An authorized reviewer explicitly selects inspected sources, explains the conclusion and confirms any policy override. Previous assessments remain in the audit trail.",
        ),
    ]
    for title, description in steps:
        with st.container(border=True):
            st.markdown(f"**{title}**")
            st.write(description)
    st.subheader("What is available in this installation")
    caps = capabilities(workspace)
    rows = [
        {"Capability": "Manual evidence workflow", "State": "Available"},
        {"Capability": "Synthetic teaching examples", "State": "Available — fictional"},
        {
            "Capability": "Live retrieval",
            "State": "Available"
            if caps.get("live")
            else "Requires providers, PostgreSQL and authorized sign-in",
        },
        {
            "Capability": "Screenshot extraction",
            "State": "Available"
            if caps.get("ocr")
            else "Requires vision provider, PostgreSQL and authorized sign-in",
        },
        {
            "Capability": "Cross-user review handoff",
            "State": "Available"
            if workspace.can_handoff
            else "Requires durable storage and verified identities",
        },
        {
            "Capability": "Case storage",
            "State": "Configured PostgreSQL database"
            if workspace.storage_mode == "postgres"
            else "This session only",
        },
    ]
    st.dataframe(rows, hide_index=True, width="stretch")
    st.subheader("What this system does not establish")
    st.markdown(
        "- A polished explanation does not verify a claim.\n- Several links may copy one original source. Their count does not establish independence.\n- An old fact-check may describe a different claim or context.\n- No matching evidence does not mean a claim is false.\n- Wording cues do not establish deceptive intent.\n- Passing synthetic examples demonstrates workflow behavior, not real-world model accuracy."
    )
    st.caption(
        "The repository documents the policy, deployment, tests, data ingestion and contribution boundaries. Provider calls and durable storage must be configured explicitly; this app never silently substitutes synthetic evidence for a real investigation."
    )


def run_app(settings: dict[str, Any], user: dict[str, Any]) -> None:
    markup(STYLE)
    with st.sidebar:
        markup(
            '<div class="brand"><span class="brand-mark">◈</span>Evidence AI<span style="font-size:.6rem;color:#9bbdb7;margin-left:.1rem">CCS</span></div><div class="brand-sub">A clearer view of the facts</div>'
        )
    from evidence_streamlit.config import render_auth

    render_auth(settings, user)
    try:
        workspace = Workspace(st.session_state, settings, user)
    except WorkspaceError as error:
        st.error(getattr(error, "message", str(error)))
        st.stop()
    if "pending_page" in st.session_state:
        st.session_state.workspace_page = st.session_state.pop("pending_page")
    page = render_sidebar(workspace, user, settings)
    storage = (
        "Account storage" if workspace.storage_mode == "postgres" else "Private session · unsaved"
    )
    markup(
        f'<div class="topline"><span class="topline-label">CCS Research / {esc(page)}</span><span class="status-badge">{esc(storage)}</span></div>'
    )
    if notice := st.session_state.pop("workspace_notice", None):
        st.success(notice)
    try:
        if page == "Investigate":
            active = st.session_state.get("active_case_id")
            if active:
                page_intro(
                    "Your active investigation",
                    "Follow the evidence.",
                    "Inspect the sources, understand the gaps, and keep every decision accountable.",
                )
                if st.button("New investigation", key="new_investigation"):
                    st.session_state.pop("active_case_id", None)
                    st.rerun()
                render_case(workspace, workspace.get_case(active))
            else:
                render_create(workspace)
                empty_state(
                    "An open mind. A clear evidence trail.",
                    "Start an investigation above. Your sources, assessment and review history will take shape here.",
                )
        elif page == "Case library":
            render_library(workspace)
        elif page == "Human review":
            render_review_desk(workspace, user)
        elif page == "Corpus":
            render_corpus(workspace, user)
        elif page == "Method":
            render_method(workspace)
    except WorkspaceError as error:
        st.error(getattr(error, "message", str(error)))
    markup(
        '<div class="page-footer"><span>Evidence AI · CCS Research Workspace</span><span>Evidence first. Human judgment always.</span></div>'
    )
