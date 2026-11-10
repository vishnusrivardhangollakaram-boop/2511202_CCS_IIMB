import type { Evidence, Scenario } from "./domain";

/**
 * Fictional, hand-authored fixtures for policy demonstration and regression tests.
 * They are NOT real fact-checks and MUST NOT be mixed into a production corpus.
 */
export const FIXTURE_CLOCK = "2026-11-09T12:00:00Z";

function exampleEvidence(
  id: string,
  patch: Partial<Evidence> & Pick<Evidence, "title" | "excerpt" | "claimParts">,
): Evidence {
  return {
    id,
    url: `https://example.org/ccs-fixtures/${id}`,
    publisher: "Fictional source",
    publishedAt: "2026-11-08T10:00:00Z",
    retrievedAt: FIXTURE_CLOCK,
    stance: "supports",
    relevance: 0.96,
    quality: 0.92,
    independenceKey: id,
    contextMatch: true,
    temporalMatch: true,
    isPrimary: false,
    origin: "demo",
    verified: true,
    ...patch,
  };
}

const photoParts = [
  "The shared photograph genuinely depicts a flood.",
  "The shared photograph was taken in Riverton on 9 November 2026.",
];
const transitParts = [
  "Riverton municipal buses will be free on 15 November 2026.",
  "The free service will run from 06:00 to 22:00.",
];
const closurePart = "Rivergate Bridge is closed to all road traffic on 9 November 2026.";
const libraryPart =
  "Riverton Central Library is open until midnight every day starting 9 November 2026.";
const festivalPart = "Riverton's lantern festival has been cancelled for 2026.";

/** The UI should offer explicit scenario selection; free text never selects a fixture. */
export const scenarios: Scenario[] = [
  {
    id: "recycled-photo",
    title: "A real photo. The wrong story.",
    description:
      "Trace an authentic flood photograph whose new caption changes its location and date.",
    label: "Synthetic example",
    category: "Misleading context",
    evaluationDate: FIXTURE_CLOCK,
    claim: {
      text: "This genuine flood photograph was taken in Riverton today, 9 November 2026.",
      parts: photoParts,
      timeSensitive: true,
      domain: "Disasters & accidents",
    },
    evidence: [
      exampleEvidence("photo-authentication", {
        title: "Photographer's authentication note · fictional",
        publisher: "Riverton Image Archive (fictional)",
        excerpt:
          "In this fictional exercise, the photographer confirms that the supplied picture is an authentic photograph showing flood water. The archive identifies the image and retains its original publication record.",
        claimParts: [photoParts[0]],
        isPrimary: true,
        independenceKey: "fictional-photographer-record",
      }),
      exampleEvidence("photo-original", {
        title: "Original Eastmere flood photograph, 2021 · fictional",
        publisher: "Eastmere Municipal Archive (fictional)",
        publishedAt: "2021-05-04T08:00:00Z",
        excerpt:
          "Synthetic original archive record: this exact photograph was published on 4 May 2021 and shows Eastmere Quay. Its original date and location contradict the caption claiming Riverton on 9 November 2026.",
        stance: "refutes",
        claimParts: [photoParts[1]],
        isPrimary: true,
        historicalRefutation: true,
        independenceKey: "fictional-eastmere-original",
      }),
    ],
    expectedDecision: "proceed",
    expectedVerdict: "Misleading",
  },
  {
    id: "verified-transit",
    title: "A transit notice with a paper trail.",
    description:
      "Compare a dated primary announcement with independent reporting on a fictional free-bus day.",
    label: "Synthetic example",
    category: "Supported claim",
    evaluationDate: FIXTURE_CLOCK,
    claim: {
      text: "Riverton municipal buses will be free on 15 November 2026, from 06:00 to 22:00.",
      parts: transitParts,
      timeSensitive: true,
      domain: "Society & other",
    },
    evidence: [
      exampleEvidence("transit-order", {
        title: "Municipal transport order 2026/41 · fictional",
        publisher: "Riverton Transport Office (fictional)",
        excerpt:
          "Fictional municipal order: passenger fares on Riverton municipal bus routes are waived on Sunday, 15 November 2026, between 06:00 and 22:00. The order specifies both the date and operating hours.",
        claimParts: transitParts,
        isPrimary: true,
        independenceKey: "fictional-transit-office",
      }),
      exampleEvidence("transit-report", {
        title: "Reporter confirms free-bus operating window · fictional",
        publisher: "Riverton Daily (fictional)",
        excerpt:
          "For this synthetic example, an independently reported interview with depot managers confirms the no-fare day on 15 November. Supervisors separately confirm the six-in-the-morning start and ten-at-night finish for municipal routes.",
        claimParts: transitParts,
        quality: 0.84,
        independenceKey: "fictional-daily-original-reporting",
      }),
    ],
    expectedDecision: "proceed",
    expectedVerdict: "True",
  },
  {
    id: "conflicting-closure",
    title: "Two credible sources disagree.",
    description:
      "Route contradictory bridge-status notices to a human reviewer without guessing a verdict.",
    label: "Synthetic example",
    category: "Human review",
    evaluationDate: FIXTURE_CLOCK,
    claim: {
      text: closurePart,
      parts: [closurePart],
      timeSensitive: true,
      domain: "Disasters & accidents",
    },
    evidence: [
      exampleEvidence("bridge-emergency", {
        title: "Emergency closure bulletin · fictional",
        publisher: "Riverton Emergency Office (fictional)",
        publishedAt: "2026-11-09T09:00:00Z",
        excerpt:
          "Synthetic emergency bulletin issued at 09:00: Rivergate Bridge is closed to all road traffic on 9 November 2026 until further notice. This fictional source does not record any later reopening.",
        claimParts: [closurePart],
        isPrimary: true,
        independenceKey: "fictional-emergency-office",
      }),
      exampleEvidence("bridge-operator", {
        title: "Bridge operator status at 09:15 · fictional",
        publisher: "Rivergate Bridge Operator (fictional)",
        publishedAt: "2026-11-09T09:15:00Z",
        excerpt:
          "Fictional operator status panel: Rivergate Bridge is open to normal road traffic as of 09:15 on 9 November 2026. No explanation reconciles this statement with the emergency office closure bulletin.",
        stance: "refutes",
        claimParts: [closurePart],
        isPrimary: true,
        independenceKey: "fictional-bridge-operator",
      }),
    ],
    expectedDecision: "human_review",
    expectedVerdict: "Unverifiable",
  },
  {
    id: "missing-evidence",
    title: "A forward without a source.",
    description:
      "Identify what is missing when a library-hours claim has only an unchecked search snippet.",
    label: "Synthetic example",
    category: "Evidence gap",
    evaluationDate: FIXTURE_CLOCK,
    claim: {
      text: libraryPart,
      parts: [libraryPart],
      timeSensitive: true,
      domain: "Society & other",
    },
    evidence: [
      exampleEvidence("library-snippet", {
        title: "Community post search snippet · fictional",
        publisher: "Unidentified community account (fictional)",
        publishedAt: null,
        excerpt:
          "Synthetic search snippet: someone says the central library now stays open until midnight every day. The post supplies no official timetable, publication date or independently checked source document.",
        claimParts: [libraryPart],
        quality: 0.35,
        independenceKey: "",
        verified: false,
      }),
    ],
    expectedDecision: "retrieve_more",
    expectedVerdict: "Unverifiable",
  },
  {
    id: "syndicated-rumour",
    title: "Three links. One original rumour.",
    description: "See why copied reports do not count as independent corroboration.",
    label: "Synthetic example",
    category: "Source independence",
    evaluationDate: FIXTURE_CLOCK,
    claim: {
      text: festivalPart,
      parts: [festivalPart],
      timeSensitive: true,
      domain: "Society & other",
    },
    evidence: ["A", "B", "C"].map((edition) =>
      exampleEvidence(`festival-copy-${edition.toLowerCase()}`, {
        title: `Festival cancellation story, edition ${edition} · fictional`,
        publisher: `Fictional community publication ${edition}`,
        excerpt:
          "Synthetic syndicated report: Riverton's lantern festival has been cancelled for 2026 according to a single anonymous organiser. Each edition copies this same statement without obtaining independent confirmation or an official cancellation notice.",
        claimParts: [festivalPart],
        quality: 0.72,
        relevance: 0.88,
        independenceKey: "fictional-one-anonymous-original",
      }),
    ),
    expectedDecision: "retrieve_more",
    expectedVerdict: "Unverifiable",
  },
];

/** Return an isolated fixture copy so investigating a case cannot mutate defaults. */
export function getScenario(id: string): Scenario | undefined {
  const scenario = scenarios.find((item) => item.id === id);
  return scenario ? structuredClone(scenario) : undefined;
}
