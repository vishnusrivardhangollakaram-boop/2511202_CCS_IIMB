import { ApiError, assertSameOrigin } from "./http";

export interface WorkspaceUser {
  id: string;
  displayName: string;
  email: string;
  canReview: boolean;
  local: boolean;
}
export interface AuthEnvironment {
  REVIEWER_IDS?: string;
}

/** Trust these headers only behind Sites dispatch. Direct public Worker exposure is unsupported. */
export function resolveUser(
  request: Request,
  environment: AuthEnvironment = {},
  development = false,
): WorkspaceUser {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) {
    if (development)
      return {
        id: "local-ccs-researcher",
        displayName: "Local researcher",
        email: "researcher@localhost",
        canReview: true,
        local: true,
      };
    throw new ApiError(
      401,
      "authentication_required",
      "Sign in to open your private research workspace.",
    );
  }
  let displayName = email;
  const name = request.headers.get("oai-authenticated-user-full-name");
  if (name) {
    try {
      displayName =
        request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
          ? decodeURIComponent(name)
          : name;
    } catch {
      displayName = email;
    }
  }
  const reviewerIds = new Set(
    (environment.REVIEWER_IDS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return {
    id,
    displayName: displayName.slice(0, 200),
    email: email.slice(0, 320),
    canReview: reviewerIds.has(id),
    local: false,
  };
}

export function requireUser(request: Request, environment: AuthEnvironment = {}): WorkspaceUser {
  // Vite replaces this compile-time flag; there is no environment switch enabling production bypass.
  return resolveUser(request, environment, import.meta.env.DEV);
}

export function requireMutation(
  request: Request,
  environment: AuthEnvironment = {},
): WorkspaceUser {
  assertSameOrigin(request);
  return requireUser(request, environment);
}

export function assertReviewer(user: WorkspaceUser, mode: string): void {
  if (mode !== "demo" && !user.canReview)
    throw new ApiError(
      403,
      "reviewer_required",
      "A configured reviewer must approve real investigations. Synthetic examples can be reviewed in your own workspace.",
    );
}
