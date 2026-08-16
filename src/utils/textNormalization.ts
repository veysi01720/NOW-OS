export function normalizeUserText(value: string): string {
  return value
    .replace(/[ÃÂ]/g, "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[ıİ]/gu, "i")
    .replace(/[şŞ]/gu, "s")
    .replace(/[ğĞ]/gu, "g")
    .replace(/[üÜ]/gu, "u")
    .replace(/[öÖ]/gu, "o")
    .replace(/[çÇ]/gu, "c")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshteinDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[right.length];
}

function toleranceFor(word: string): number {
  if (word.length <= 2) return 0;
  if (word.length <= 5) return 1;
  return 2;
}

export function matchesNormalizedHint(
  input: string,
  candidates: readonly string[],
  options: { strict?: boolean; forbidden?: readonly string[] } = {},
): boolean {
  const normalizedInput = normalizeUserText(input);
  const tokens = normalizedInput.split(" ").filter(Boolean);
  const forbidden = (options.forbidden ?? []).map(normalizeUserText);
  if (forbidden.some((word) => tokens.includes(word))) return false;
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeUserText(candidate);
    if (!normalizedCandidate) return false;
    const candidateTokens = normalizedCandidate.split(" ");
    if (candidateTokens.length > 1 && normalizedInput.includes(normalizedCandidate)) return true;
    if (candidateTokens.length > 1) return false;
    if (tokens.includes(normalizedCandidate)) return true;
    if (options.strict || normalizedCandidate.length <= 2) return false;
    const limit = toleranceFor(normalizedCandidate);
    return tokens.some((token) => token.length === normalizedCandidate.length
      && levenshteinDistance(token, normalizedCandidate) <= limit);
  });
}

export function findNormalizedHint<T>(
  input: string,
  candidates: readonly T[],
  valueOf: (candidate: T) => string,
  options: { strict?: boolean; forbidden?: readonly string[] } = {},
): T | null {
  return candidates.find((candidate) => matchesNormalizedHint(input, [valueOf(candidate)], options)) ?? null;
}
