"""Native Streamlit entry point for the Evidence AI research workspace."""

import streamlit as st

st.set_page_config(
    page_title="Evidence AI · CCS Research Workspace",
    page_icon="◈",
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={
        "About": "Evidence AI — an evidence-first CCS misinformation research workspace. Automated assessments are preliminary."
    },
)

from evidence_streamlit.config import get_settings, resolve_user
from evidence_streamlit.ui import run_app

settings = get_settings()
run_app(settings, resolve_user(settings))
