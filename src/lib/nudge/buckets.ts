/**
 * Deterministic caution bucketing — the floor for the risk-nudge feature.
 * AI labelling is applied on top; if AI fails, these raw keys and examples are used.
 * Ported verbatim from scratch/dr_nudge_experiment.mjs (BUCKETS_DEEP).
 */

export const BOILERPLATE = "请结合面诊与必要检查复核后执行。";
export const RECURRENCE_FLOOR = 3;
export const WINDOW_DAYS = 14;

export type Bucket = { key: string; re: RegExp };

export const BUCKETS: Bucket[] = [
  { key: "转诊 / 排除器质病变",  re: /转诊|进一步检查|建议检查|影像|拍片|MRI|X线|就医|专科|排除|继发|器质/ },
  { key: "针刺安全（深度·解剖）", re: /针刺|进针|深度|气胸|解剖|伤及|晕针|滞针|血管神经/ },
  { key: "手法 / 推拿安全",       re: /推拿|手法|MFR|暴力|力度|旋转/ },
  { key: "出血 / 抗凝 / 活血药",  re: /出血|抗凝|活血|经期|凝血|DVT/ },
  { key: "感染防控 / 操作禁忌",   re: /感染|无菌|消毒|清洁|禁忌症|禁忌/ },
  { key: "剂量 / 药物体质",       re: /剂量|过量|超量|用量|毒|附子|细辛|麻黄|滋腻|体质/ },
  { key: "慢病监测",              re: /血压|高血压|血糖|监测|心率|甲功|甲状腺/ },
  { key: "复诊指征",              re: /复诊|无改善|麻木|无力|及时|持续.*检查/ },
];

export type SurfacedBucket = {
  key: string;
  count: number;
  examples: string[]; // up to 5 verbatim caution strings
};

export type BucketResult = {
  surfaced: SurfacedBucket[]; // buckets with count >= RECURRENCE_FLOOR, sorted desc
  total: number;              // total caution strings processed
  covered: number;            // cautions matched by at least one bucket
};

/**
 * Bucket caution strings using first-match-wins semantics.
 * Returns only buckets at or above RECURRENCE_FLOOR, sorted by count descending.
 */
export function bucketCautions(cautions: string[]): BucketResult {
  const counts: Record<string, number> = {};
  const examples: Record<string, string[]> = {};
  let otherCount = 0;

  for (const b of BUCKETS) {
    counts[b.key] = 0;
    examples[b.key] = [];
  }

  for (const c of cautions) {
    let hit = false;
    for (const b of BUCKETS) {
      if (b.re.test(c)) {
        counts[b.key]++;
        if (examples[b.key].length < 5) examples[b.key].push(c);
        hit = true;
        break; // first-match-wins
      }
    }
    if (!hit) otherCount++;
  }

  const surfaced: SurfacedBucket[] = BUCKETS
    .filter((b) => counts[b.key] >= RECURRENCE_FLOOR)
    .sort((a, b) => counts[b.key] - counts[a.key])
    .map((b) => ({
      key: b.key,
      count: counts[b.key],
      examples: examples[b.key],
    }));

  return {
    surfaced,
    total: cautions.length,
    covered: cautions.length - otherCount,
  };
}
