/** Same-origin API requests with explicit errors and bounded network waits. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      credentials: "same-origin",
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (!response.ok) {
      const error = new Error(
        (typeof body.error === "object" ? body.error.message : body.error) ||
          body.message ||
          `Request failed (${response.status}).`,
      ) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(
        "This request took too long. Your saved case is still available; refresh its status before trying again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

/** Secure UUIDs also work in HTTP-only local previews where randomUUID is absent. */
export function requestUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto.getRandomValues !== "function")
    throw new Error(
      "This browser cannot create a secure request identifier. Open the HTTPS deployment or a supported browser.",
    );
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
