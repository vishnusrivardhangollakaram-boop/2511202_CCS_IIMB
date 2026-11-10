import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMessageSignals,
  MAX_SIGNAL_TEXT_LENGTH,
  MESSAGE_SIGNAL_RULES_VERSION,
} from "../lib/message-signals";
import { getScenario } from "../lib/fixtures";
import { evaluateSufficiency, assessVerdict } from "../lib/sufficiency";

const ids = (text: string) => analyzeMessageSignals(text).signals.map((signal) => signal.id);

test("identifies explicit pressure to act and broadly forward, retaining source excerpts", () => {
  const text = "URGENT! Act now. Forward this message to everyone before tonight.";
  const result = analyzeMessageSignals(text);
  assert.deepEqual(
    result.signals.map((signal) => signal.id),
    ["urgency", "forwarding_pressure"],
  );
  for (const signal of result.signals) {
    assert.equal(text.slice(signal.start, signal.end), signal.matchedText);
    assert.ok(signal.excerpt.includes(signal.matchedText));
  }
  assert.equal(result.rulesVersion, MESSAGE_SIGNAL_RULES_VERSION);
  assert.equal(result.scope, "message_wording");
});

test("identifies sensitive credential requests without interpreting their intent", () => {
  for (const text of [
    "Please share your OTP with me.",
    "Enter your banking password here.",
    "Send me your card details.",
    "Provide your Aadhaar number.",
  ]) {
    const result = analyzeMessageSignals(text);
    assert.ok(
      result.signals.some((signal) => signal.id === "credentials_request"),
      text,
    );
    assert.ok(result.limitations.some((note) => note.includes("does not establish intent")));
  }
});

test("identifies explicit payment requests while acknowledging legitimate payments", () => {
  for (const text of [
    "Send ₹500 to reserve your place.",
    "Please pay the registration fee.",
    "Transfer 2000 INR today.",
    "Pay $25 for the documented subscription renewal.",
  ]) {
    const payment = analyzeMessageSignals(text).signals.find(
      (signal) => signal.id === "payment_request",
    );
    assert.ok(payment, text);
    assert.match(payment.rationale, /Legitimate messages/);
  }
});

test("identifies absolute authority and certainty wording, not ordinary citations", () => {
  assert.ok(ids("All doctors agree this is 100% proven.").includes("authority_assertion"));
  assert.ok(ids("All doctors agree this is 100% proven.").includes("absolute_certainty"));
  assert.ok(ids("This has guaranteed returns.").includes("absolute_certainty"));
  assert.deepEqual(
    ids(
      "Three researchers report a preliminary result, with limitations described in their paper.",
    ),
    [],
  );
});

test("does not classify directly negated safety advice as a credential or payment request", () => {
  for (const text of [
    "Never share your OTP.",
    "Do not send your card details.",
    "You should not under any circumstances share your password.",
    "Don't pay the registration fee.",
    "Avoid forwarding pressure; do not forward this to everyone.",
  ]) {
    assert.deepEqual(ids(text), [], text);
  }
});

test("a contrast after negation does not hide a later explicit request", () => {
  assert.ok(ids("Do not worry, but send me your OTP.").includes("credentials_request"));
});

test("quoted journal discussion of language is not treated as a direct message cue", () => {
  assert.deepEqual(ids("The journal analyses the phrase 'act now' in advertisements."), []);
  assert.deepEqual(
    ids('Researchers discuss the expression "forward this to everyone" as a linguistic example.'),
    [],
  );
  assert.deepEqual(
    ids("The report discusses urgency, claims of certainty, and payment-request language."),
    [],
  );
});

test("a quoted forward still exposes its wording cue without claiming intent", () => {
  const result = analyzeMessageSignals(
    'The forwarded message reads: "Act now. Share this with everyone."',
  );
  assert.deepEqual(
    result.signals.map((signal) => signal.id),
    ["urgency", "forwarding_pressure"],
  );
  assert.ok(result.limitations.some((note) => note.includes("Quoted, legitimate or educational")));
});

test("avoids keyword-only false positives in ordinary or technical text", () => {
  for (const text of [
    "Pay attention to the source date.",
    "Please share this article about OTP scams.",
    "The article describes password security.",
    "100% of participants completed the questionnaire.",
    "All doctors in this sample were interviewed.",
    "The library closes at 8 pm.",
  ]) {
    assert.deepEqual(ids(text), [], text);
  }
});

test("repeated wording produces one cue per rule and analysis is deterministic", () => {
  const text = "Act now! Last chance. Act now! Send your OTP. Send your OTP.";
  const first = analyzeMessageSignals(text);
  assert.deepEqual(
    first.signals.map((signal) => signal.id),
    ["urgency", "credentials_request"],
  );
  assert.deepEqual(analyzeMessageSignals(text), first);
});

test("bounds scanning and clearly reports truncated input", () => {
  const text = "x".repeat(MAX_SIGNAL_TEXT_LENGTH) + " Act now!";
  const result = analyzeMessageSignals(text);
  assert.equal(result.scannedCharacters, MAX_SIGNAL_TEXT_LENGTH);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.signals, []);
  assert.equal(analyzeMessageSignals("").truncated, false);
});

test("advisory analysis does not change the evidence gate or preliminary verdict", () => {
  const scenario = getScenario("verified-transit")!;
  const before = structuredClone(scenario);
  const gate = evaluateSufficiency(scenario.claim, scenario.evidence, {
    now: scenario.evaluationDate,
  });
  const verdict = assessVerdict(scenario.claim, scenario.evidence, gate);
  analyzeMessageSignals("Act now! Forward this to everyone. This is 100% true!");
  assert.deepEqual(scenario, before);
  assert.deepEqual(
    evaluateSufficiency(scenario.claim, scenario.evidence, { now: scenario.evaluationDate }),
    gate,
  );
  assert.deepEqual(assessVerdict(scenario.claim, scenario.evidence, gate), verdict);
});
