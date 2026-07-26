import { normalizeForFuzzyMatch } from "./arabicNormalize";

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/** 0..1, 1 = identical after Arabic/whitespace normalization. */
export function similarityRatio(a, b) {
  const na = normalizeForFuzzyMatch(a);
  const nb = normalizeForFuzzyMatch(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Partial credit for containment, e.g. "رقم الهاتف للتواصل" vs "رقم الهاتف".
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

/** Best candidate scoring >= threshold, or null. `candidates` is [{..., text}]. */
export function bestFuzzyMatch(input, candidates, threshold = 0.72) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = similarityRatio(input, c.text);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best ? { ...best, score: bestScore, matched: bestScore >= threshold } : null;
}
