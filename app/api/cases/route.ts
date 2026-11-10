import { requireMutation, requireUser } from "@/lib/auth";
import type { Claim } from "@/lib/domain";
import { getScenario } from "@/lib/fixtures";
import {
  ApiError,
  apiBoundary,
  boundedString,
  jsonResponse,
  objectBody,
  optionalString,
  publicHttpsUrl,
  readJson,
} from "@/lib/http";
import {
  createCase,
  database,
  findRequest,
  hashInput,
  listCases,
  newEvent,
  publicCase,
  rateLimit,
  type InvestigationCase,
  type CaseMode,
} from "@/lib/store";
import { evaluateSufficiency } from "@/lib/sufficiency";
import { providerCapabilities } from "@/lib/providers";
import { caseState, environment, MAX_ATTEMPTS, runInvestigation } from "../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiBoundary(async () => {
    const user = requireUser(request, environment);
    return jsonResponse({
      cases: (await listCases(database(environment), user.id)).map((record) =>
        publicCase(record, user),
      ),
      limit: 100,
    });
  });
}
export async function POST(request: Request) {
  return apiBoundary(async () => {
    const user = requireMutation(request, environment);
    const body = objectBody(await readJson(request, 2_900_000));
    const requestId = boundedString(body.requestId, "Request ID", 8, 100);
    const mode = String(body.mode || "manual") as CaseMode;
    if (!["demo", "manual", "live"].includes(mode))
      throw new ApiError(400, "invalid_mode", "Choose a valid investigation mode.");
    const inputType = String(body.inputType || "text") as InvestigationCase["inputType"];
    if (!["text", "url", "image"].includes(inputType))
      throw new ApiError(400, "invalid_input_type", "Choose text, article URL or screenshot.");
    const text = optionalString(body.text, "Claim", 8000) || "";
    const scenarioId = optionalString(body.scenarioId, "Scenario ID", 100);
    const scenario = mode === "demo" && scenarioId ? getScenario(scenarioId) : undefined;
    if (mode === "demo" && !scenario)
      throw new ApiError(400, "scenario_required", "Choose an explicit synthetic example.");
    if (mode !== "demo" && scenarioId)
      throw new ApiError(
        400,
        "invalid_scenario",
        "Synthetic examples cannot be used as live investigations.",
      );
    const url = inputType === "url" ? publicHttpsUrl(body.url, "Article URL") : undefined;
    const imageData =
      inputType === "image"
        ? boundedString(body.imageData, "Screenshot", 10, 2_800_000)
        : undefined;
    if (
      imageData &&
      (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(imageData) ||
        (imageData.split(",")[1].length * 3) / 4 > 2_000_000)
    )
      throw new ApiError(
        400,
        "invalid_image",
        "Choose a JPEG, PNG or WebP image smaller than 2 MB.",
      );
    if (inputType !== "text" && mode !== "live")
      throw new ApiError(
        400,
        "live_required",
        "Article extraction and screenshot reading require live mode. Paste text for a manual investigation.",
      );
    if (!scenario && inputType === "text" && text.length < 10)
      throw new ApiError(400, "claim_required", "Enter a factual claim of at least 10 characters.");
    if (scenario && text && text !== scenario.claim.text)
      throw new ApiError(
        400,
        "scenario_changed",
        "The example text was edited. Start a manual or live investigation for the new claim.",
      );
    const inputHash = await hashInput({ mode, inputType, text, url, imageData, scenarioId });
    const db = database(environment);
    const existing = await findRequest(db, user.id, requestId);
    if (existing) {
      if (existing.requestHash !== inputHash)
        throw new ApiError(
          409,
          "idempotency_conflict",
          "This request key belongs to different content. Start a new request.",
        );
      return jsonResponse({ case: publicCase(existing, user), idempotent: true });
    }
    if (mode === "live" && !providerCapabilities(environment).live)
      throw new ApiError(
        503,
        "providers_not_configured",
        "Live investigation requires configured search and model services. Choose manual evidence or a synthetic example.",
      );
    await rateLimit(db, user.id, "create", 30);
    const claim: Claim = scenario
      ? structuredClone(scenario.claim)
      : {
          text:
            text ||
            (inputType === "url"
              ? "Extract the verifiable claim from the supplied article."
              : "Extract the verifiable claim from the supplied screenshot."),
          parts: [text || "The submitted content's factual claim"],
          timeSensitive: body.timeSensitive === true,
          domain: "General",
        };
    const now = new Date().toISOString();
    const record: InvestigationCase = {
      id: crypto.randomUUID(),
      ownerId: user.id,
      requestId,
      requestHash: inputHash,
      version: 1,
      claim,
      mode,
      inputType,
      originalInput: { text, ...(url ? { url } : {}) },
      ...(scenario ? { scenarioId: scenario.id, evaluationDate: scenario.evaluationDate } : {}),
      status: "draft",
      gate: evaluateSufficiency(claim, [], { maxAttempts: MAX_ATTEMPTS }),
      verdict: "Unverifiable",
      explanation: "Evidence has not yet been assessed.",
      preliminary: true,
      finalVerdict: null,
      evidence: scenario ? structuredClone(scenario.evidence) : [],
      events: [
        newEvent(
          user,
          "case_created",
          scenario ? "Synthetic investigation opened" : "Investigation opened",
          scenario
            ? "This is an explicitly labelled fictional teaching example, evaluated against a fixed reference date."
            : "Your claim was saved in your private workspace.",
        ),
      ],
      reviews: [],
      createdAt: now,
      updatedAt: now,
      attempt: scenario ? 1 : 0,
      warnings: scenario
        ? [
            "Synthetic teaching example. These sources and events are fictional; this is not a live fact-check.",
          ]
        : [],
    };
    const created = await createCase(db, caseState(record), user);
    let saved = created.record;
    if (created.created && mode === "live") {
      await rateLimit(db, user.id, "investigate", 15);
      saved = await runInvestigation(db, saved, user, imageData);
    }
    return jsonResponse(
      { case: publicCase(saved, user), idempotent: !created.created },
      created.created ? 201 : 200,
    );
  });
}
