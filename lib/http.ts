/** Public API failures deliberately contain no upstream response bodies or credentials. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || !origin || origin !== new URL(request.url).origin) {
    throw new ApiError(
      403,
      "origin_rejected",
      "This action must be submitted from this application's own page.",
    );
  }
}

/** Bound bytes while streaming, including requests without Content-Length. */
export async function readJson(request: Request, maxBytes = 128_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "json_required", "Send a JSON request body.");
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes)
    throw new ApiError(413, "payload_too_large", "The submitted content exceeds the size limit.");
  if (!request.body) throw new ApiError(400, "body_required", "A request body is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let value = "";
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ApiError(
          413,
          "payload_too_large",
          "The submitted content exceeds the size limit.",
        );
      }
      value += decoder.decode(chunk, { stream: true });
    }
    value += decoder.decode();
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "The request contains invalid JSON.");
  } finally {
    reader.releaseLock();
  }
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "invalid_input", "Expected a JSON object.");
  return value as Record<string, unknown>;
}

export function boundedString(value: unknown, field: string, min = 1, max = 1000): string {
  if (typeof value !== "string") throw new ApiError(400, "invalid_input", `${field} must be text.`);
  const text = value.trim();
  if (text.length < min || text.length > max)
    throw new ApiError(400, "invalid_input", `${field} must contain ${min}–${max} characters.`);
  return text;
}

export function optionalString(value: unknown, field: string, max = 1000): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedString(value, field, 1, max);
}

export function requiredVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1)
    throw new ApiError(400, "version_required", "Refresh this case and send its current version.");
  return Number(value);
}

/** Metadata URLs are never fetched here; reject unsafe schemes and private host names. */
export function publicHttpsUrl(value: unknown, field = "Source URL"): string {
  const text = boundedString(value, field, 1, 2048);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ApiError(400, "invalid_url", `${field} must be a valid HTTPS URL.`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host
      .split(".")
      .some(
        (label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"),
      ) ||
    /(^|\.)(test|invalid|example|onion|lan|home|arpa)$/.test(host) ||
    /(^|\.)(nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host)
  ) {
    throw new ApiError(
      400,
      "invalid_url",
      `${field} must use a public HTTPS domain without credentials.`,
    );
  }
  url.hash = "";
  return url.toString();
}

export function jsonResponse(
  data: unknown,
  status = 200,
  requestId = crypto.randomUUID(),
): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

/** Route boundary: log only a classification and correlation ID, never request data. */
export async function apiBoundary(operation: () => Promise<Response>): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError)
      return jsonResponse(
        { error: { code: error.code, message: error.message, requestId } },
        error.status,
        requestId,
      );
    console.error(
      JSON.stringify({
        event: "api_failure",
        requestId,
        kind: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return jsonResponse(
      {
        error: {
          code: "service_unavailable",
          message: "The workspace could not complete this action. Please retry shortly.",
          requestId,
        },
      },
      503,
      requestId,
    );
  }
}
