import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

await mkdir(".test-build", { recursive: true });
await build({
  stdin: {
    contents:
      'export { scenarios } from "./lib/fixtures"; export { evaluateSufficiency, assessVerdict } from "./lib/sufficiency";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: ".test-build/evaluation-engine.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});
const { scenarios, evaluateSufficiency, assessVerdict } = await import(
  path.resolve(".test-build/evaluation-engine.mjs")
);
const rows = scenarios.map((scenario) => {
  const gate = evaluateSufficiency(scenario.claim, scenario.evidence, {
    attempt: 1,
    maxAttempts: 3,
    now: scenario.evaluationDate,
  });
  const assessment = assessVerdict(scenario.claim, scenario.evidence, gate);
  return {
    scenario: scenario.id,
    expectedDecision: scenario.expectedDecision,
    decision: gate.decision,
    expectedVerdict: scenario.expectedVerdict,
    verdict: assessment.verdict,
    pass:
      gate.decision === scenario.expectedDecision &&
      assessment.verdict === scenario.expectedVerdict,
  };
});
const report = {
  type: "synthetic_policy_regression",
  policyVersion: evaluateSufficiency(scenarios[0].claim, []).policyVersion,
  disclaimer:
    "These fictional fixtures check routing behavior. They do not measure real-world misinformation accuracy or calibrated confidence.",
  scenarios: rows.length,
  passed: rows.filter((row) => row.pass).length,
  rows,
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--save")) {
  await mkdir("docs/validation", { recursive: true });
  await writeFile(
    "docs/validation/synthetic-evaluation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
process.exitCode = report.passed === rows.length ? 0 : 1;
