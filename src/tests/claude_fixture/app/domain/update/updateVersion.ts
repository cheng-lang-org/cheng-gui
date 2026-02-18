export interface UpdateVersionVector {
  version?: string;
  versionCode?: number;
  sequence?: number;
}

export function normalizeVersionCode(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function normalizeVersionText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return '';
  }
  return text.replace(/^[vV]/, '');
}

function parseVersionParts(value: string): number[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[^0-9]+/)
    .filter((item) => item.length > 0)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item));
}

export function compareVersionText(candidate: unknown, baseline: unknown): number {
  const candidateText = normalizeVersionText(candidate);
  const baselineText = normalizeVersionText(baseline);
  if (!candidateText && !baselineText) {
    return 0;
  }
  if (candidateText && !baselineText) {
    return 1;
  }
  if (!candidateText && baselineText) {
    return -1;
  }
  const candidateParts = parseVersionParts(candidateText);
  const baselineParts = parseVersionParts(baselineText);
  if (candidateParts.length > 0 || baselineParts.length > 0) {
    const length = Math.max(candidateParts.length, baselineParts.length);
    for (let index = 0; index < length; index += 1) {
      const c = candidateParts[index] ?? 0;
      const b = baselineParts[index] ?? 0;
      if (c !== b) {
        return c > b ? 1 : -1;
      }
    }
    return 0;
  }
  const lexical = candidateText.localeCompare(baselineText, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (lexical > 0) {
    return 1;
  }
  if (lexical < 0) {
    return -1;
  }
  return 0;
}

function normalizeSequence(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.trunc(parsed));
}

export function compareVersionVector(candidate: UpdateVersionVector, baseline: UpdateVersionVector): number {
  const candidateCode = normalizeVersionCode(candidate.versionCode);
  const baselineCode = normalizeVersionCode(baseline.versionCode);
  const textComparison = compareVersionText(candidate.version, baseline.version);

  if (candidateCode !== undefined && baselineCode !== undefined) {
    if (candidateCode !== baselineCode) {
      return candidateCode > baselineCode ? 1 : -1;
    }
    if (textComparison !== 0) {
      return textComparison;
    }
    return 0;
  }

  if (textComparison !== 0) {
    return textComparison;
  }

  if (candidateCode !== undefined && baselineCode === undefined) {
    return 1;
  }
  if (candidateCode === undefined && baselineCode !== undefined) {
    return -1;
  }

  const candidateSequence = normalizeSequence(candidate.sequence);
  const baselineSequence = normalizeSequence(baseline.sequence);
  if (candidateSequence !== undefined && baselineSequence !== undefined) {
    if (candidateSequence !== baselineSequence) {
      return candidateSequence > baselineSequence ? 1 : -1;
    }
  } else if (candidateSequence !== undefined && baselineSequence === undefined) {
    return 1;
  } else if (candidateSequence === undefined && baselineSequence !== undefined) {
    return -1;
  }

  return 0;
}
