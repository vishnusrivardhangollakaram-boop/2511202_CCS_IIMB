declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TAVILY_API_KEY?: string;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    REVIEWER_IDS?: string;
  }
}
