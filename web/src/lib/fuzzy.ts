// Subsequence fuzzy matching for the command palette.
//
// Scoring favours matches that a human would call "the obvious one":
// consecutive characters beat scattered ones, a hit at the start of a word
// ("rnc_|m|odifications") beats a hit in the middle, and a shorter haystack
// wins ties — so typing "rna" ranks the table `rna` above `rna_precomputed`.

export interface FuzzyMatch {
  score: number;
  /** Indices in the haystack that matched, for highlighting. */
  positions: number[];
}

const SCORE_MATCH = 16;
const BONUS_CONSECUTIVE = 12;
const BONUS_WORD_START = 10;
const BONUS_FIRST_CHAR = 8;
const PENALTY_SKIP = 1;

function isBoundary(
  prev: string | undefined,
  cur: string | undefined,
): boolean {
  if (prev === undefined) return true;
  if (prev === "_" || prev === "." || prev === "-" || prev === " ") return true;
  if (cur === undefined) return false; // past the end: no hump to find
  // camelCase hump
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}

/**
 * Score `needle` against `haystack`, or null when the characters of `needle`
 * do not appear in order. An empty needle matches everything at score 0.
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  if (needle === "") return { score: 0, positions: [] };
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (n.length > h.length) return null;

  const positions: number[] = [];
  let score = 0;
  let hi = 0;
  let lastHit = -2;

  for (let ni = 0; ni < n.length; ni++) {
    const c = n[ni];
    // Prefer a boundary hit over the first hit of any kind: scanning ahead for
    // one keeps "rm" on `rnc_|m|odifications` rather than `|r|nc_|m|od…`.
    let found = -1;
    let fallback = -1;
    for (let i = hi; i < h.length; i++) {
      if (h[i] !== c) continue;
      if (fallback === -1) fallback = i;
      if (isBoundary(h[i - 1], haystack[i])) {
        found = i;
        break;
      }
      // A boundary further away than the next word is not worth the skip.
      if (i - fallback > 24) break;
    }
    if (found === -1) found = fallback;
    if (found === -1) return null;

    score += SCORE_MATCH;
    if (found === lastHit + 1) score += BONUS_CONSECUTIVE;
    if (isBoundary(h[found - 1], haystack[found])) score += BONUS_WORD_START;
    if (found === 0) score += BONUS_FIRST_CHAR;
    score -= Math.min(found - hi, 12) * PENALTY_SKIP;

    positions.push(found);
    lastHit = found;
    hi = found + 1;
  }

  // Shorter haystacks are the more specific answer at equal evidence.
  score -= Math.min(haystack.length, 60) / 8;
  return { score, positions };
}

/** Split `text` into alternating plain/matched runs for rendering. */
export function splitMatch(
  text: string,
  positions: number[],
): { text: string; hit: boolean }[] {
  if (positions.length === 0) return [{ text, hit: false }];
  const hit = new Set(positions);
  const out: { text: string; hit: boolean }[] = [];
  let buf = "";
  let bufHit = hit.has(0);
  for (let i = 0; i < text.length; i++) {
    const h = hit.has(i);
    if (h !== bufHit) {
      if (buf) out.push({ text: buf, hit: bufHit });
      buf = "";
      bufHit = h;
    }
    buf += text[i];
  }
  if (buf) out.push({ text: buf, hit: bufHit });
  return out;
}
