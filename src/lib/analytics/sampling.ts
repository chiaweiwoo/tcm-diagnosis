import { inferCaseCategory } from "./doctorReviewDraft";

export interface SamplingRow {
  form_data: Record<string, unknown> | null;
  analysis_result: Record<string, unknown> | null;
  analyzed_at: string | null;
}

/**
 * Stratified sampling based on inferred case category.
 * Groups rows by category, sorts each bucket newest-first, and picks via round-robin.
 * Returns the final sampled array sorted chronologically (ascending by analyzed_at) for
 * time-series and profile evaluations.
 */
export function stratifyAndSample<T extends SamplingRow>(rows: T[], cap = 100): T[] {
  if (rows.length <= cap) {
    // If N <= cap, just return them in newest-first order initially (caller can sort or preserve)
    // For consistency with chronological processing, let's sort them ascending by analyzed_at
    return [...rows].sort((a, b) => {
      const ta = a.analyzed_at ? new Date(a.analyzed_at).getTime() : 0;
      const tb = b.analyzed_at ? new Date(b.analyzed_at).getTime() : 0;
      return ta - tb; // chronological ascending
    });
  }

  // 1. Group rows by case category
  const buckets: Record<string, T[]> = {};
  for (const row of rows) {
    const category = inferCaseCategory(row.form_data);
    if (!buckets[category]) {
      buckets[category] = [];
    }
    buckets[category].push(row);
  }

  // 2. Sort each bucket newest-first based on analyzed_at
  const categories = Object.keys(buckets);
  for (const cat of categories) {
    buckets[cat].sort((a, b) => {
      const ta = a.analyzed_at ? new Date(a.analyzed_at).getTime() : 0;
      const tb = b.analyzed_at ? new Date(b.analyzed_at).getTime() : 0;
      return tb - ta; // newest-first
    });
  }

  // 3. Round-robin pick from buckets until cap is hit
  const sampled: T[] = [];
  const indices: Record<string, number> = {};
  for (const cat of categories) {
    indices[cat] = 0;
  }

  // Sort categories deterministically to ensure stable round-robin order
  categories.sort();

  while (sampled.length < cap) {
    let advancedAny = false;
    for (const cat of categories) {
      const idx = indices[cat];
      const bucket = buckets[cat];
      if (idx < bucket.length) {
        sampled.push(bucket[idx]);
        indices[cat] = idx + 1;
        advancedAny = true;
        if (sampled.length === cap) {
          break;
        }
      }
    }
    if (!advancedAny) {
      break; // No more rows in any bucket
    }
  }

  // 4. Return the selected sample sorted chronologically (ascending by analyzed_at)
  return sampled.sort((a, b) => {
    const ta = a.analyzed_at ? new Date(a.analyzed_at).getTime() : 0;
    const tb = b.analyzed_at ? new Date(b.analyzed_at).getTime() : 0;
    return ta - tb; // chronological ascending
  });
}
