#!/usr/bin/env node
/**
 * build-prompt-history.mjs
 *
 * Generates src/lib/prompts/_history.generated.json from git log.
 * Run via: node scripts/build-prompt-history.mjs
 * Hooked into: npm run build  (prebuild) and npm run dev (predev)
 *
 * Why build-time, not runtime: Vercel serverless functions don't have a
 * .git directory, so git log is unavailable at runtime. We generate the
 * manifest here and commit it so fresh clones work without a build step.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

const REGISTRY_DIR = "src/lib/prompts/registry";
const OUT_PATH = "src/lib/prompts/_history.generated.json";

function git(args, { silent = false } = {}) {
  return execSync(`git ${args}`, {
    encoding: "utf8",
    stdio: silent ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
  }).trim();
}

// All paths ever added under the registry dir (including later-deleted files)
const rawPaths = git(
  `log --diff-filter=A --name-only --pretty=format: -- ${REGISTRY_DIR}`
)
  .split("\n")
  .filter(Boolean)
  .filter((p) => p.startsWith(REGISTRY_DIR) && p.endsWith(".ts"));

const everPaths = [...new Set(rawPaths)];

const entries = [];

for (const path of everPaths) {
  const raw = git(
    `log --follow --pretty=format:%H%x09%aI%x09%an%x09%s -- "${path}"`
  );
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) continue;

  const parse = (line) => {
    const parts = line.split("\t");
    const sha = parts[0];
    const isoDate = parts[1];
    const author = parts[2];
    const message = parts.slice(3).join("\t");
    return { sha, isoDate, author, message };
  };

  const lastCommit = parse(lines[0]);
  const firstCommit = parse(lines[lines.length - 1]);

  const currentlyInTree = existsSync(path);
  let contents;
  try {
    if (currentlyInTree) {
      contents = readFileSync(path, "utf8");
    } else {
      // lastCommit may be the deletion commit; fall back through commit list
      // until we find one where the file still existed (firstCommit = ADD commit)
      try {
        contents = git(`show ${lastCommit.sha}:${path}`, { silent: true });
      } catch {
        contents = git(`show ${firstCommit.sha}:${path}`, { silent: true });
      }
    }
  } catch {
    contents = "// (could not retrieve contents)";
  }

  // Derive family and version from path: registry/<family>/<version>.ts
  const rel = path.slice(REGISTRY_DIR.length + 1);
  const slashIdx = rel.indexOf("/");
  const family = rel.slice(0, slashIdx);
  const version = rel.slice(slashIdx + 1).replace(/\.ts$/, "");

  entries.push({
    path,
    family,
    version,
    contents,
    currentlyInTree,
    firstCommit,
    lastCommit,
    commitCount: lines.length,
  });
}

// Sort: family asc, then version desc (semver-aware, newest first within a family)
function semverDesc(a, b) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [aMaj, aMin = 0, aPat = 0] = parse(a);
  const [bMaj, bMin = 0, bPat = 0] = parse(b);
  return bMaj - aMaj || bMin - aMin || bPat - aPat;
}
entries.sort(
  (a, b) =>
    a.family.localeCompare(b.family) || semverDesc(a.version, b.version)
);

// Only rewrite if entries changed — prevents noisy timestamp churn on every build
const entriesHash = createHash("sha1")
  .update(JSON.stringify(entries))
  .digest("hex");

let existingHash = null;
if (existsSync(OUT_PATH)) {
  try {
    const existing = JSON.parse(readFileSync(OUT_PATH, "utf8"));
    existingHash = createHash("sha1")
      .update(JSON.stringify(existing.entries))
      .digest("hex");
  } catch {
    // corrupted file — rewrite
  }
}

if (entriesHash === existingHash) {
  console.log(
    `✓ Prompt history unchanged (${entries.length} entries) — skipping write`
  );
} else {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2),
    "utf8"
  );
  console.log(
    `✓ Wrote ${entries.length} prompt history entries to ${OUT_PATH}`
  );
}
