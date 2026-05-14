#!/usr/bin/env node
/**
 * Uses Claude with web search to look up current DeepSeek and Anthropic
 * pricing and updates config/rates.json if anything changed.
 * Runs daily via GitHub Actions — only commits when prices actually change.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const RATES_PATH = join(__dir, "../../config/rates.json");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

async function fetchRatesWithClaude() {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [
        {
          role: "user",
          content: `Search for the current API pricing for DeepSeek and Anthropic Claude models, then return ONLY a JSON object — no explanation, no markdown.

The JSON must match this exact shape:
{
  "deepseek": {
    "flash": { "inputCacheHitPer1M": <number>, "inputCacheMissPer1M": <number>, "outputPer1M": <number> },
    "pro":   { "inputCacheHitPer1M": <number>, "inputCacheMissPer1M": <number>, "outputPer1M": <number> }
  },
  "anthropic": {
    "haiku":  { "inputCacheHitPer1M": <number>, "inputCacheMissPer1M": <number>, "outputPer1M": <number> },
    "sonnet": { "inputCacheHitPer1M": <number>, "inputCacheMissPer1M": <number>, "outputPer1M": <number> },
    "opus":   { "inputCacheHitPer1M": <number>, "inputCacheMissPer1M": <number>, "outputPer1M": <number> }
  }
}

Rules:
- All prices are USD per 1 million tokens
- DeepSeek "flash" = deepseek-chat (their fastest/cheapest tier)
- DeepSeek "pro" = deepseek-reasoner (their most capable tier)
- Anthropic "haiku" = Claude Haiku (latest), "sonnet" = Claude Sonnet (latest), "opus" = Claude Opus (latest)
- inputCacheHitPer1M = cache read / cache hit input price
- inputCacheMissPer1M = regular input / cache miss input price
- outputPer1M = output token price
- Only return numbers you found from the search — do not guess`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API error: ${res.status} ${detail.slice(0, 200)}`);
  }

  const payload = await res.json();
  const text = payload.content?.findLast((b) => b.type === "text")?.text ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude did not return JSON. Got: ${text.slice(0, 300)}`);

  return JSON.parse(jsonMatch[0]);
}

function ratesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  console.log("Searching for current AI provider pricing...");
  const extracted = await fetchRatesWithClaude();

  const current = JSON.parse(readFileSync(RATES_PATH, "utf8"));

  const deepseekChanged = !ratesEqual(current.deepseek, extracted.deepseek);
  const anthropicChanged = !ratesEqual(current.anthropic, extracted.anthropic);

  if (!deepseekChanged && !anthropicChanged) {
    console.log("Rates unchanged — no update needed.");
    return;
  }

  if (deepseekChanged) console.log("DeepSeek rates changed:", JSON.stringify(extracted.deepseek, null, 2));
  if (anthropicChanged) console.log("Anthropic rates changed:", JSON.stringify(extracted.anthropic, null, 2));

  const today = new Date().toISOString().slice(0, 7); // YYYY-MM
  const updated = {
    _comment: `AI provider pricing — USD per 1M tokens. Update when provider announces price changes. Last verified: ${today}.`,
    deepseek: extracted.deepseek,
    anthropic: extracted.anthropic,
  };

  writeFileSync(RATES_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");
  console.log("config/rates.json updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
