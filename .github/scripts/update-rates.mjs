#!/usr/bin/env node
/**
 * Fetches DeepSeek and Anthropic pricing pages, uses Claude to extract
 * current rates, and updates config/rates.json if anything changed.
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

const PRICING_URLS = {
  deepseek: "https://api-docs.deepseek.com/quick_start/pricing",
  anthropic: "https://www.anthropic.com/pricing",
};

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; price-checker/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function extractRatesWithClaude(deepseekHtml, anthropicHtml) {
  const prompt = `Extract current AI API pricing from these two pricing pages and return ONLY a JSON object — no explanation, no markdown.

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
- DeepSeek "flash" = deepseek-chat or their fastest/cheapest model tier
- DeepSeek "pro" = deepseek-reasoner or their most capable model tier
- Anthropic "haiku" = Claude Haiku (latest), "sonnet" = Claude Sonnet (latest), "opus" = Claude Opus (latest)
- inputCacheHitPer1M = cache read / cache hit input price
- inputCacheMissPer1M = regular input / cache miss input price
- outputPer1M = output price
- If a value is not found, keep the existing value (do not guess)

--- DEEPSEEK PRICING PAGE ---
${deepseekHtml.slice(0, 8000)}

--- ANTHROPIC PRICING PAGE ---
${anthropicHtml.slice(0, 8000)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API error: ${res.status} ${detail.slice(0, 200)}`);
  }

  const payload = await res.json();
  const text = payload.content?.[0]?.text ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude did not return JSON. Got: ${text.slice(0, 300)}`);

  return JSON.parse(jsonMatch[0]);
}

function ratesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  console.log("Fetching pricing pages...");
  const [deepseekHtml, anthropicHtml] = await Promise.all([
    fetchPage(PRICING_URLS.deepseek),
    fetchPage(PRICING_URLS.anthropic),
  ]);

  console.log("Extracting rates with Claude...");
  const extracted = await extractRatesWithClaude(deepseekHtml, anthropicHtml);

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
