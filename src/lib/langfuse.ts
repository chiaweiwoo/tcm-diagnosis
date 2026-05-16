/**
 * Langfuse client — lazy singleton.
 * Returns null when LANGFUSE_SECRET_KEY is absent (CI, local dev without keys).
 * Never logs clinical text — only tokens, model, latency, and call metadata.
 */
import { Langfuse } from "langfuse";

let _client: Langfuse | null = null;

export function getLangfuse(): Langfuse | null {
  if (!process.env.LANGFUSE_SECRET_KEY || !process.env.LANGFUSE_PUBLIC_KEY) return null;
  if (!_client) {
    _client = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      baseUrl: process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com",
    });
  }
  return _client;
}
