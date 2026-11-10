"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileImage,
  FileText,
  FolderOpen,
  GitBranch,
  ImagePlus,
  Info,
  Link2,
  ListFilter,
  LockKeyhole,
  LogIn,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { api, requestUuid } from "./api";
import { handleTabKey } from "./accessibility";
import type {
  Bootstrap,
  CaseRecord,
  Evidence,
  Mode,
  Scenario,
  Verdict,
  View,
} from "./client-types";
import {
  CaseResult,
  EmptyState,
  EvidenceForm,
  formatDate,
  GateInspector,
  HandoffForm,
  MethodView,
  ReviewForm,
  STATUS_LABELS,
  Tag,
  verdictTone,
} from "./presentation";

const NAV: { view: View; label: string; icon: typeof Search; number: string }[] = [
  { view: "investigate", label: "Investigate", icon: Search, number: "01" },
  { view: "library", label: "Case library", icon: FolderOpen, number: "02" },
  { view: "review", label: "Review desk", icon: UsersRound, number: "03" },
  { view: "method", label: "Method & evaluation", icon: BookOpen, number: "04" },
];

function scenarioText(scenario: Scenario): string {
  return typeof scenario.claim === "string"
    ? scenario.claim
    : scenario.claim?.text || scenario.description;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/** Owns real request state; displayed assessments always come from the server. */
export default function EvidenceWorkspace() {
  const [view, setView] = useState<View>("investigate");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [sharedReviews, setSharedReviews] = useState<CaseRecord[]>([]);
  const [active, setActive] = useState<CaseRecord | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [modal, setModal] = useState<"evidence" | "review" | "handoff" | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [inputType, setInputType] = useState<"text" | "url" | "image">("text");
  const [mode, setMode] = useState<Mode>("manual");
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [imageData, setImageData] = useState("");
  const [imageName, setImageName] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const claimInput = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const pendingRequest = useRef<{ signature: string; id: string } | null>(null);
  const activeId = useRef<string | null>(null);
  const openSequence = useRef(0);
  useEffect(() => {
    activeId.current = active?.id || null;
  }, [active?.id]);

  const updateCase = useCallback((record: CaseRecord) => {
    setActive(record);
    if (record.isOwner !== false)
      setCases((previous) =>
        [record, ...previous.filter((item) => item.id !== record.id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      );
    else
      setSharedReviews((previous) =>
        [record, ...previous.filter((item) => item.id !== record.id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      );
  }, []);

  const initialise = useCallback(async () => {
    const results = await Promise.allSettled([
      api<Bootstrap>("/api/bootstrap"),
      api<{ cases: CaseRecord[] }>("/api/cases"),
    ]);
    if (results[0].status === "fulfilled") {
      setBootstrap(results[0].value);
      setAuthRequired(false);
      if (results[0].value.user?.canReview) {
        try {
          const queue = await api<{ cases: CaseRecord[] }>("/api/reviews");
          setSharedReviews(queue.cases);
        } catch (e) {
          setError(errorMessage(e));
        }
      }
    } else {
      setError(errorMessage(results[0].reason));
      setAuthRequired((results[0].reason as { status?: number }).status === 401);
    }
    if (results[1].status === "fulfilled") setCases(results[1].value.cases || []);
    else if (results[0].status === "fulfilled") setError(errorMessage(results[1].reason));
    setInitialising(false);
  }, []);
  useEffect(() => {
    const startup = window.setTimeout(() => {
      void initialise();
    }, 0);
    return () => window.clearTimeout(startup);
  }, [initialise]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 699px)");
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileNav(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileNav || !isMobile) return;
    const previousOverflow = document.body.style.overflow;
    const opener = menuRef.current;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [mobileNav, isMobile]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (active?.status !== "investigating") return;
    const id = active.id;
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const data = await api<{ case: CaseRecord }>(`/api/cases/${id}`);
        if (activeId.current === id) updateCase(data.case);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        running = false;
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [active?.id, active?.status, updateCase]);

  function navigationKey(event: KeyboardEvent<HTMLElement>) {
    if (!mobileNav || !isMobile) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setMobileNav(false);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      sidebarRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]),a[href]") || [],
    ).filter((element) => element.offsetParent !== null);
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
    setError("");
    setQuery("");
    setFilter("all");
  }
  function newCase() {
    openSequence.current += 1;
    activeId.current = null;
    setActive(null);
    setScenario(null);
    setText("");
    setUrl("");
    setImageData("");
    setImageName("");
    setMode("manual");
    setInputType("text");
    setError("");
    setNotice("");
    navigate("investigate");
    setTimeout(() => claimInput.current?.focus(), 50);
  }
  function selectScenario(item: Scenario) {
    setScenario(item);
    setText(scenarioText(item));
    setMode("demo");
    setInputType("text");
    setActive(null);
    setError("");
    claimInput.current?.focus();
  }
  function editText(value: string) {
    setText(value);
    if (scenario) {
      setScenario(null);
      setMode("manual");
    }
  }

  async function openCase(id: string, nextView?: View, shared = false) {
    const sequence = ++openSequence.current;
    setLibraryLoading(true);
    setError("");
    try {
      const data = await api<{ case: CaseRecord }>(`/api/${shared ? "reviews" : "cases"}/${id}`);
      if (sequence === openSequence.current) {
        updateCase(data.case);
        if (nextView) setView(nextView);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLibraryLoading(false);
    }
  }
  async function refreshCases() {
    setLibraryLoading(true);
    setError("");
    try {
      const data = await api<{ cases: CaseRecord[] }>("/api/cases");
      setCases(data.cases);
      if (bootstrap?.user?.canReview) {
        const queue = await api<{ cases: CaseRecord[] }>("/api/reviews");
        setSharedReviews(queue.cases);
      }
      if (active) {
        const detail = await api<{ case: CaseRecord }>(
          `/api/${active.isOwner === false ? "reviews" : "cases"}/${active.id}`,
        );
        setActive(detail.case);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLibraryLoading(false);
    }
  }

  async function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setBusyLabel(scenario ? "Evaluating the synthetic evidence" : "Creating your investigation");
    setError("");
    const payload = {
      text: text.trim(),
      inputType,
      url: url.trim() || undefined,
      imageData: imageData || undefined,
      mode,
      scenarioId: scenario?.id,
    };
    const signature = JSON.stringify(payload);
    try {
      if (pendingRequest.current?.signature !== signature)
        pendingRequest.current = { signature, id: requestUuid() };
      const data = await api<{ case: CaseRecord }>("/api/cases", {
        method: "POST",
        body: JSON.stringify({ ...payload, requestId: pendingRequest.current.id }),
      });
      updateCase(data.case);
      pendingRequest.current = null;
      if (mode === "live" && data.case.status === "draft") {
        setBusyLabel("Investigating available sources");
        const investigated = await api<{ case: CaseRecord }>(
          `/api/cases/${data.case.id}/investigate`,
          { method: "POST", body: JSON.stringify({ version: data.case.version }) },
        );
        updateCase(investigated.case);
      }
      setNotice(
        scenario
          ? "Synthetic investigation evaluated and saved."
          : "Your investigation has been saved.",
      );
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          }),
        100,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function investigate() {
    if (!active || busy) return;
    setBusy(true);
    setBusyLabel(
      active.mode === "live" ? "Investigating available sources" : "Reassessing the evidence",
    );
    setError("");
    try {
      const data = await api<{ case: CaseRecord }>(`/api/cases/${active.id}/investigate`, {
        method: "POST",
        body: JSON.stringify({ version: active.version }),
      });
      updateCase(data.case);
      setNotice("Evidence assessment updated.");
    } catch (e) {
      setError(errorMessage(e));
      if ((e as { status?: number }).status === 409) await openCase(active.id);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function addEvidence(
    evidence: Omit<Evidence, "id" | "retrievedAt" | "origin" | "verified">,
    attested: boolean,
  ) {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ case: CaseRecord }>(`/api/cases/${active.id}/evidence`, {
        method: "POST",
        body: JSON.stringify({ version: active.version, evidence, attested }),
      });
      updateCase(data.case);
      setModal(null);
      setNotice("Source evidence saved and assessed.");
    } catch (e) {
      setError(errorMessage(e));
      if ((e as { status?: number }).status === 409) {
        await openCase(active.id, undefined, active.isOwner === false);
        setModal(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function review(payload: {
    decision: string;
    verdict: Verdict;
    reason: string;
    evidenceIds: string[];
    overrideConfirmed: boolean;
  }) {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ case: CaseRecord }>(`/api/cases/${active.id}/review`, {
        method: "POST",
        body: JSON.stringify({ version: active.version, ...payload }),
      });
      updateCase(data.case);
      setModal(null);
      setNotice("Your review has been recorded in the audit history.");
    } catch (e) {
      setError(errorMessage(e));
      if ((e as { status?: number }).status === 409) {
        await openCase(active.id, undefined, active.isOwner === false);
        setModal(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handoff(reason: string) {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ case: CaseRecord }>(`/api/cases/${active.id}/handoff`, {
        method: "POST",
        body: JSON.stringify({
          version: active.version,
          reason,
          action: active.reviewRequested ? "withdraw" : "request",
        }),
      });
      updateCase(data.case);
      setModal(null);
      setNotice(
        active.reviewRequested
          ? "Reviewer access withdrawn."
          : "Case submitted to authorised reviewers.",
      );
      if (bootstrap?.user?.canReview) {
        const queue = await api<{ cases: CaseRecord[] }>("/api/reviews");
        setSharedReviews(queue.cases);
      }
    } catch (e) {
      setError(errorMessage(e));
      if ((e as { status?: number }).status === 409) {
        await openCase(active.id, undefined, active.isOwner === false);
        setModal(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("Choose a PNG, JPEG or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 2_000_000) {
      setError("Choose an image smaller than 2 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageData(String(reader.result));
      setImageName(file.name);
      setError("");
      setScenario(null);
      setMode("live");
    };
    reader.onerror = () => setError("This image could not be read. Please choose another file.");
    reader.readAsDataURL(file);
  }

  const reviewCases = Array.from(
    new Map(
      [
        ...cases.filter(
          (record) =>
            (record.mode === "demo" || record.reviewRequested) &&
            ["human_review", "ready", "needs_evidence"].includes(record.status),
        ),
        ...sharedReviews.filter(
          (record) => record.status !== "reviewed" && record.reviewStatus !== "completed",
        ),
      ].map((record) => [record.id, record]),
    ).values(),
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const collection = view === "review" ? reviewCases : cases;
  const visibleCases = collection.filter(
    (record) =>
      (!query ||
        record.claim.text.toLowerCase().includes(query.toLowerCase()) ||
        record.id.includes(query)) &&
      (filter === "all" || record.status === filter),
  );
  const userName =
    bootstrap?.user?.displayName || bootstrap?.user?.email?.split("@")[0] || "Researcher";
  const currentNav = NAV.find((item) => item.view === view)!;
  const canSubmit =
    !busy &&
    !initialising &&
    Boolean(bootstrap) &&
    (mode !== "live" || Boolean(bootstrap?.capabilities.live)) &&
    (inputType === "image"
      ? Boolean(imageData) && bootstrap?.capabilities.ocr
      : inputType === "url"
        ? Boolean(url.trim()) && bootstrap?.capabilities.live
        : text.trim().length >= 10);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {mobileNav && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}
        ref={sidebarRef}
        inert={isMobile && !mobileNav}
        aria-hidden={isMobile && !mobileNav ? true : undefined}
        role={isMobile && mobileNav ? "dialog" : undefined}
        aria-modal={isMobile && mobileNav ? true : undefined}
        aria-label="Workspace navigation"
        onKeyDown={navigationKey}
      >
        <button
          className="sidebar-mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        >
          <X size={20} />
        </button>
        <button className="brand" onClick={newCase} aria-label="Evidence AI home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <b />
          </span>
          <span>
            evidence<span className="brand-ai">ai</span>
            <small>CLARITY, WITH CONTEXT.</small>
          </span>
        </button>
        <div className="workspace-label">
          <span className="workspace-icon">CCS</span>
          <div>
            <strong>Research workspace</strong>
            <span>IIM Bangalore project</span>
          </div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {NAV.map((item) => (
            <button
              key={item.view}
              className={`nav-item ${view === item.view ? "active" : ""}`}
              aria-current={view === item.view ? "page" : undefined}
              onClick={() => navigate(item.view)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.view === "review" && reviewCases.length > 0 ? (
                <small>{reviewCases.length}</small>
              ) : (
                <ChevronRight size={14} className="nav-chevron" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="small-spark">
            <GitBranch size={18} />
          </div>
          <strong>
            Evidence first.
            <br />
            Human judgment, always.
          </strong>
          <p>Every conclusion should have a source. Every uncertainty, a next step.</p>
          <button onClick={() => navigate("method")}>
            Explore the method
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="sidebar-footer">
          <span className="user-avatar">{userName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{userName}</strong>
            <span>{bootstrap?.user?.local ? "Local development" : "Private workspace"}</span>
          </div>
          <LockKeyhole size={15} />
        </div>
      </aside>
      <div className="app-body" inert={isMobile && mobileNav}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-button"
              ref={menuRef}
              aria-label="Open navigation"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{currentNav.label}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection-badge ${bootstrap?.capabilities.live ? "connected" : ""}`}>
              <span className="status-dot" />
              {initialising
                ? "Connecting"
                : bootstrap?.capabilities.live
                  ? "Live providers connected"
                  : bootstrap
                    ? "Research mode"
                    : authRequired
                      ? "Sign-in required"
                      : "Connection unavailable"}
            </span>
            <button
              className="icon-button help-button"
              aria-label="View method and help"
              onClick={() => navigate("method")}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className={`main-content ${view === "method" ? "main-method" : ""}`}
        >
          {error && (
            <div
              className={`alert ${authRequired ? "auth-notice" : "error-alert"}`}
              role={authRequired ? "status" : "alert"}
            >
              <Info size={19} />
              <div>
                <strong>
                  {authRequired ? "Your research stays private" : "Something needs attention"}
                </strong>
                <p>{error}</p>
                {authRequired && (
                  <a
                    className="text-button"
                    href="/signin-with-chatgpt?return_to=%2F"
                    target="_top"
                  >
                    <LogIn size={15} />
                    Sign in with ChatGPT
                  </a>
                )}
              </div>
              {!authRequired && (
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
              <button aria-label="Dismiss notification" onClick={() => setNotice("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {!bootstrap && !initialising && !authRequired && (
            <div className="reconnect">
              <button
                className="button secondary"
                onClick={() => {
                  setInitialising(true);
                  setError("");
                  void initialise();
                }}
              >
                <RefreshCw size={16} />
                Reconnect to workspace
              </button>
            </div>
          )}
          {view === "investigate" && (
            <>
              <div className="page-intro investigate-intro">
                <div>
                  <span className="eyebrow">
                    <span />
                    THE INVESTIGATION WORKSPACE
                  </span>
                  <h1>
                    Clarity starts
                    <br className="mobile-break" /> with <em>evidence.</em>
                  </h1>
                  <p>Bring a claim. Trace its sources. Make a judgment you can explain.</p>
                </div>
                <div className="intro-signature">
                  <ShieldCheck size={24} />
                  <span>
                    Source-grounded.
                    <br />
                    Human accountable.
                  </span>
                </div>
              </div>
              {active ? (
                <>
                  <div className="back-row">
                    <button className="text-button" onClick={newCase}>
                      <ArrowLeft size={15} />
                      New investigation
                    </button>
                    <span>{STATUS_LABELS[active.status] || active.status}</span>
                  </div>
                  <div className="investigation-grid result-grid" ref={resultRef}>
                    <CaseResult
                      record={active}
                      onAddEvidence={() => {
                        setError("");
                        setModal("evidence");
                      }}
                      onInvestigate={investigate}
                      onReview={() => {
                        setError("");
                        setModal("review");
                      }}
                      onHandoff={() => {
                        setError("");
                        setModal("handoff");
                      }}
                      busy={busy}
                      onError={setError}
                    />
                    <GateInspector
                      gate={active.gate}
                      evidenceCount={active.evidence.length}
                      busy={busy}
                    />
                  </div>
                </>
              ) : (
                <div className="investigation-grid">
                  <div className="investigation-main">
                    <form className="claim-composer" onSubmit={submitCase}>
                      <div className="composer-heading">
                        <div>
                          <span className="section-number">01 / START HERE</span>
                          <h2>What would you like to verify?</h2>
                        </div>
                        <span className="composer-icon">
                          <FileText size={23} />
                        </span>
                      </div>
                      <div
                        className="input-tabs"
                        role="tablist"
                        aria-label="Input format"
                        onKeyDown={handleTabKey}
                      >
                        <button
                          type="button"
                          role="tab"
                          id="input-text-tab"
                          aria-controls="input-text-panel"
                          tabIndex={inputType === "text" ? 0 : -1}
                          aria-selected={inputType === "text"}
                          className={inputType === "text" ? "selected" : ""}
                          onClick={() => {
                            setInputType("text");
                            if (!bootstrap?.capabilities.live && !scenario) setMode("manual");
                          }}
                        >
                          <FileText size={16} />
                          Text or forward
                        </button>
                        <button
                          type="button"
                          role="tab"
                          id="input-url-tab"
                          aria-controls="input-url-panel"
                          tabIndex={inputType === "url" ? 0 : -1}
                          aria-selected={inputType === "url"}
                          className={inputType === "url" ? "selected" : ""}
                          onClick={() => {
                            setInputType("url");
                            setScenario(null);
                            setMode("live");
                          }}
                        >
                          <Link2 size={16} />
                          Article URL
                        </button>
                        <button
                          type="button"
                          role="tab"
                          id="input-image-tab"
                          aria-controls="input-image-panel"
                          tabIndex={inputType === "image" ? 0 : -1}
                          aria-selected={inputType === "image"}
                          className={inputType === "image" ? "selected" : ""}
                          onClick={() => {
                            setInputType("image");
                            setScenario(null);
                            setMode("live");
                          }}
                        >
                          <FileImage size={16} />
                          Screenshot
                        </button>
                      </div>
                      {inputType === "text" && (
                        <div
                          className="claim-text-wrap"
                          role="tabpanel"
                          id="input-text-panel"
                          aria-labelledby="input-text-tab"
                        >
                          <label className="sr-only" htmlFor="claim-text">
                            Claim to investigate
                          </label>
                          <textarea
                            id="claim-text"
                            ref={claimInput}
                            value={text}
                            onChange={(e) => editText(e.target.value)}
                            placeholder="Paste the claim, headline or WhatsApp forward here…"
                            maxLength={8000}
                            minLength={10}
                            rows={5}
                            required
                          />
                          <div className="composer-context">
                            <span>
                              {scenario ? (
                                <>
                                  <Sparkles size={13} />
                                  Synthetic scenario selected
                                </>
                              ) : (
                                <>
                                  <Info size={13} />
                                  Include names, dates and context where possible.
                                </>
                              )}
                            </span>
                            <span>{text.length.toLocaleString()} / 8,000</span>
                          </div>
                        </div>
                      )}
                      {inputType === "url" && (
                        <div
                          className="url-input"
                          role="tabpanel"
                          id="input-url-panel"
                          aria-labelledby="input-url-tab"
                        >
                          <label htmlFor="article-url">Article URL</label>
                          <input
                            id="article-url"
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://example.com/news/article"
                            required
                            maxLength={2000}
                          />
                          <label htmlFor="article-claim">
                            Specific claim to check <span>(optional)</span>
                          </label>
                          <textarea
                            id="article-claim"
                            value={text}
                            onChange={(e) => editText(e.target.value)}
                            placeholder="Point the investigation at a particular statement…"
                            maxLength={8000}
                            rows={2}
                          />
                          {!bootstrap?.capabilities.live && (
                            <p className="capability-note">
                              <LockKeyhole size={14} />
                              Article extraction requires live search and model providers. You can
                              paste the article’s claim in the text tab now.
                            </p>
                          )}
                        </div>
                      )}
                      {inputType === "image" && (
                        <div
                          className="image-input"
                          role="tabpanel"
                          id="input-image-panel"
                          aria-labelledby="input-image-tab"
                        >
                          {imageData ? (
                            <div className="image-preview">
                              {/* eslint-disable-next-line @next/next/no-img-element -- Local data URL stays in the browser until submission; an image optimiser must not fetch it. */}
                              <img src={imageData} alt="Screenshot selected for verification" />
                              <div>
                                <strong>{imageName}</strong>
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => {
                                    setImageData("");
                                    setImageName("");
                                  }}
                                >
                                  Remove image
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <label className="upload-zone">
                              <ImagePlus size={30} strokeWidth={1.4} />
                              <strong>Choose a screenshot</strong>
                              <span>PNG, JPEG or WebP · up to 2 MB</span>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={chooseImage}
                                disabled={!bootstrap?.capabilities.ocr}
                              />
                            </label>
                          )}
                          <label className="sr-only" htmlFor="image-context">
                            Context for image
                          </label>
                          <textarea
                            id="image-context"
                            value={text}
                            onChange={(e) => editText(e.target.value)}
                            placeholder="Add the caption or context shared with this image…"
                            rows={2}
                            maxLength={8000}
                          />
                          {!bootstrap?.capabilities.ocr && (
                            <p className="capability-note">
                              <LockKeyhole size={14} />
                              Screenshot extraction becomes available when a vision-capable model is
                              connected.
                            </p>
                          )}
                        </div>
                      )}
                      <div className="composer-footer">
                        <div className="mode-selector">
                          <label htmlFor="investigation-mode">INVESTIGATION MODE</label>
                          <select
                            id="investigation-mode"
                            value={mode}
                            onChange={(e) => {
                              setMode(e.target.value as Mode);
                              setScenario(null);
                            }}
                            disabled={Boolean(scenario) || inputType !== "text"}
                          >
                            {scenario && <option value="demo">Synthetic demonstration</option>}
                            <option value="manual">Add evidence manually</option>
                            <option value="live" disabled={!bootstrap?.capabilities.live}>
                              Live web investigation
                              {!bootstrap?.capabilities.live ? " · not connected" : ""}
                            </option>
                          </select>
                        </div>
                        <button className="button primary submit-button" disabled={!canSubmit}>
                          {busy || initialising ? (
                            <span className="spinner" />
                          ) : (
                            <Search size={17} />
                          )}
                          <span>
                            {scenario
                              ? "Explore this example"
                              : mode === "live"
                                ? "Investigate claim"
                                : "Create investigation"}
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      </div>
                      {busy && (
                        <p className="working-state" role="status">
                          <span className="status-dot pulsing" />
                          {busyLabel}
                        </p>
                      )}
                    </form>
                    <div className="examples-section">
                      <div className="section-toolbar">
                        <div>
                          <span className="eyebrow">LEARN BY INVESTIGATING</span>
                          <h3>Try a case. Follow the evidence.</h3>
                        </div>
                        <Tag tone="purple">Synthetic examples</Tag>
                      </div>
                      <div className="example-grid">
                        {initialising
                          ? [1, 2, 3, 4].map((i) => <div className="example-skeleton" key={i} />)
                          : (bootstrap?.scenarios || []).slice(0, 4).map((item, i) => (
                              <button
                                className={`example-card ${scenario?.id === item.id ? "chosen" : ""}`}
                                key={item.id}
                                onClick={() => selectScenario(item)}
                              >
                                <span className="example-index">0{i + 1}</span>
                                <div>
                                  <strong>{item.title}</strong>
                                  <p>{item.description}</p>
                                </div>
                                <ArrowRight size={17} />
                              </button>
                            ))}
                      </div>
                      <p className="examples-caption">
                        Fictional claims and sources, designed to make the decision process visible.
                      </p>
                    </div>
                  </div>
                  <GateInspector gate={null} busy={busy} />
                </div>
              )}
              {cases.length > 0 && !active && (
                <section className="recent-section">
                  <div className="section-toolbar">
                    <h3>Recent investigations</h3>
                    <button className="text-button" onClick={() => navigate("library")}>
                      View case library
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="recent-list">
                    {cases.slice(0, 3).map((record) => (
                      <button
                        key={record.id}
                        className="recent-row"
                        onClick={() => openCase(record.id, "investigate")}
                      >
                        <span className="recent-icon">
                          <FileText size={19} />
                        </span>
                        <div>
                          <strong>{record.claim.text}</strong>
                          <span>
                            {formatDate(record.updatedAt, true)}
                            {record.mode === "demo" ? " · Synthetic example" : ""}
                          </span>
                        </div>
                        <Tag tone={verdictTone(record.finalVerdict || record.verdict)}>
                          {record.finalVerdict || record.verdict || STATUS_LABELS[record.status]}
                        </Tag>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          {(view === "library" || view === "review") && (
            <>
              <div className="collection-header">
                <div className="page-intro">
                  <span className="eyebrow">
                    {view === "review" ? "HUMAN JUDGMENT, RECORDED" : "YOUR RESEARCH, IN CONTEXT"}
                  </span>
                  <h1>{view === "review" ? "The review desk." : "Every claim has a history."}</h1>
                  <p>
                    {view === "review"
                      ? "Resolve uncertainty with a clear decision and an evidence-backed reason."
                      : "Return to your investigations, evidence and decisions."}
                  </p>
                </div>
                <button className="button primary" onClick={newCase}>
                  <Plus size={17} />
                  New investigation
                </button>
              </div>
              {view === "review" && !bootstrap?.user?.canReview && (
                <div className="inline-notice review-permission">
                  <LockKeyhole size={17} />
                  <span>
                    Live case reviews require an authorised reviewer. You can practise the full
                    review workflow on your synthetic examples.
                  </span>
                </div>
              )}
              <div className="collection-tools">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search claims or case IDs…"
                    aria-label="Search cases"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} aria-label="Clear search">
                      <X size={15} />
                    </button>
                  )}
                </label>
                <label className="filter-select">
                  <ListFilter size={16} />
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    aria-label="Filter case status"
                  >
                    <option value="all">All statuses</option>
                    <option value="ready">Assessment ready</option>
                    <option value="needs_evidence">More evidence needed</option>
                    <option value="human_review">Human review</option>
                    {view === "library" && <option value="reviewed">Reviewed</option>}
                  </select>
                </label>
                <button
                  className="icon-button refresh-button"
                  aria-label="Refresh cases"
                  onClick={refreshCases}
                  disabled={libraryLoading}
                >
                  <RefreshCw size={18} className={libraryLoading ? "spin" : ""} />
                </button>
              </div>
              <div className={`collection-layout ${active ? "with-selection" : ""}`}>
                <section className="case-collection">
                  <div className="collection-summary">
                    <span>
                      {visibleCases.length}{" "}
                      {visibleCases.length === 1 ? "investigation" : "investigations"}
                    </span>
                    <span>Most recently updated</span>
                  </div>
                  {visibleCases.length ? (
                    visibleCases.map((record) => (
                      <button
                        key={record.id}
                        className={`collection-case ${active?.id === record.id ? "selected" : ""}`}
                        onClick={() => openCase(record.id, undefined, record.isOwner === false)}
                      >
                        <div className="collection-case-top">
                          <span className="case-short-id">
                            {record.id.slice(0, 8).toUpperCase()}
                          </span>
                          <span>{formatDate(record.updatedAt)}</span>
                        </div>
                        <h3>{record.claim.text}</h3>
                        <div className="collection-case-bottom">
                          <Tag tone={verdictTone(record.finalVerdict || record.verdict)}>
                            {record.finalVerdict || record.verdict || "Unverifiable"}
                          </Tag>
                          <span>
                            {record.mode === "demo" ? "Synthetic" : STATUS_LABELS[record.status]}
                          </span>
                          <ChevronRight size={17} />
                        </div>
                      </button>
                    ))
                  ) : (
                    <EmptyState
                      icon={view === "review" ? "review" : "files"}
                      title={
                        query || filter !== "all"
                          ? "No matching investigations"
                          : view === "review"
                            ? "A clear review desk"
                            : "Your first investigation starts here"
                      }
                      action={
                        <button className="button secondary" onClick={newCase}>
                          <Plus size={16} />
                          Start an investigation
                        </button>
                      }
                    >
                      {query || filter !== "all"
                        ? "Try a broader search or a different status."
                        : view === "review"
                          ? "Cases requiring a decision will appear here. Try a synthetic example to explore the review workflow."
                          : "Create a case to keep claims, evidence and decisions together."}
                    </EmptyState>
                  )}
                </section>
                {active ? (
                  <div className="collection-detail">
                    <div className="detail-top">
                      <button
                        className="text-button"
                        onClick={() => {
                          setView("investigate");
                        }}
                      >
                        <Search size={15} />
                        Open full investigation
                        <ArrowRight size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Close selected case"
                        onClick={() => setActive(null)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <CaseResult
                      record={active}
                      onAddEvidence={() => {
                        setError("");
                        setModal("evidence");
                      }}
                      onInvestigate={investigate}
                      onReview={() => {
                        setError("");
                        setModal("review");
                      }}
                      onHandoff={() => {
                        setError("");
                        setModal("handoff");
                      }}
                      busy={busy || libraryLoading}
                      onError={setError}
                    />
                  </div>
                ) : visibleCases.length > 0 ? (
                  <div className="collection-placeholder">
                    <FingerprintArtwork />
                    <h3>Select a case to see the full picture.</h3>
                    <p>The claim, evidence trail and review history stay together.</p>
                  </div>
                ) : null}
              </div>
            </>
          )}
          {view === "method" && (
            <MethodView
              version={bootstrap?.policy.version || "Loading…"}
              canImportCorpus={Boolean(bootstrap?.capabilities.corpusImport)}
              totalArticles={bootstrap?.policy.totalArticles || 0}
              onCorpusImported={async () => {
                const next = await api<Bootstrap>("/api/bootstrap");
                setBootstrap(next);
                setNotice("Corpus status refreshed.");
              }}
            />
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-dot" />
              Evidence AI · CCS research project
            </span>
            <span>Evidence informs. People decide.</span>
          </footer>
        </main>
      </div>
      {modal === "evidence" && active && (
        <EvidenceForm
          record={active}
          busy={busy}
          error={error}
          onSubmit={addEvidence}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        />
      )}
      {modal === "handoff" && active && (
        <HandoffForm
          record={active}
          busy={busy}
          error={error}
          onSubmit={handoff}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        />
      )}
      {modal === "review" && active && (
        <ReviewForm
          record={active}
          busy={busy}
          error={error}
          onSubmit={review}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        />
      )}
    </div>
  );
}

function FingerprintArtwork() {
  return (
    <div className="document-art" aria-hidden="true">
      <div className="art-sheet back" />
      <div className="art-sheet">
        <ShieldCheck size={31} />
        <i />
        <i />
        <i />
        <div>
          <span />
          <span />
          <span />
        </div>
      </div>
      <span className="art-check">
        <CheckCircle2 size={24} />
      </span>
    </div>
  );
}
