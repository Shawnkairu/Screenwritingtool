/**
 * Plain-text screenplay normalization for the writing editor.
 * The goal is not to be perfect Final Draft parsing, but to make pasted screenplay
 * text land in believable screenplay element positions automatically.
 */

export type ScreenplayElement =
  | 'blank'
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'centered';

const PAGE_WIDTH = 58;
const CHARACTER_INDENT = 24;
const DIALOGUE_INDENT = 12;
const PAREN_INDENT = 18;

const SCENE_PREFIX =
  /^(INT\.?|EXT\.?|EST\.?|INT\/EXT\.?|EXT\/INT\.?|INT\.\/EXT\.?|I\/E\.?|INT\/EST\.?|EXT\/EST\.?)(?=\s|$)/i;
const PAREN = /^\([^)]*\)$/;
const FORCED_CENTER = /^(>.*<|OVER BLACK\.?|FADE IN:?|FADE OUT\.?|SUPER:.*|TITLE:.*)$/i;

const TRANSITIONS = [
  'FADE IN',
  'FADE OUT',
  'FADE TO',
  'CUT TO',
  'DISSOLVE TO',
  'SMASH CUT TO',
  'MATCH CUT TO',
  'JUMP CUT TO',
  'BACK TO',
  'INTERCUT',
  'THE END',
];

function repeatSpace(count: number): string {
  return count > 0 ? ' '.repeat(count) : '';
}

function collapseInnerWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripExistingIndent(value: string): string {
  return value.replace(/^\s+/, '').replace(/\s+$/, '');
}

function isMostlyUppercase(value: string): boolean {
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  const uppercaseLetters = letters.replace(/[^A-Z]/g, '').length;
  return uppercaseLetters / letters.length >= 0.8;
}

function normalizeScenePrefix(prefix: string): string {
  const compact = prefix.toUpperCase().replace(/\./g, '');
  if (compact === 'INTEXT' || compact === 'INT/EXT') return 'INT./EXT.';
  if (compact === 'EXTINT' || compact === 'EXT/INT') return 'EXT./INT.';
  if (compact === 'IE' || compact === 'I/E') return 'I/E.';
  if (compact === 'INTEST' || compact === 'INT/EST') return 'INT./EST.';
  if (compact === 'EXTEST' || compact === 'EXT/EST') return 'EXT./EST.';
  return `${compact}.`;
}

function normalizeSceneHeading(line: string): string {
  const cleaned = collapseInnerWhitespace(stripExistingIndent(line));
  const match = cleaned.match(SCENE_PREFIX);
  if (!match) return cleaned.toUpperCase();
  const prefix = normalizeScenePrefix(match[1]);
  const rest = cleaned.slice(match[0].length).trim().replace(/\s*-\s*/g, ' - ');
  return `${prefix}${rest ? ` ${rest.toUpperCase()}` : ''}`;
}

function isTransition(line: string): boolean {
  const normalized = collapseInnerWhitespace(stripExistingIndent(line)).toUpperCase();
  if (TRANSITIONS.some((transition) => normalized === transition || normalized.startsWith(`${transition}:`))) {
    return true;
  }
  return / TO:$/.test(normalized);
}

function normalizeTransition(line: string): string {
  const normalized = collapseInnerWhitespace(stripExistingIndent(line)).toUpperCase();
  const withSuffix =
    normalized.endsWith(':') || normalized.endsWith('.') || normalized === 'THE END'
      ? normalized
      : `${normalized}:`;
  return repeatSpace(Math.max(0, PAGE_WIDTH - withSuffix.length)) + withSuffix;
}

function isLikelyCharacterCue(
  line: string,
  previousType: ScreenplayElement,
  nextNonBlank: string | null,
): boolean {
  const cleaned = collapseInnerWhitespace(stripExistingIndent(line));
  if (!cleaned) return false;
  if (!isMostlyUppercase(cleaned)) return false;
  if (cleaned.length > 38) return false;
  if (isTransition(cleaned) || SCENE_PREFIX.test(cleaned) || FORCED_CENTER.test(cleaned)) return false;
  if (/[.:]$/.test(cleaned) && !/\(.*\)$/.test(cleaned)) return false;
  if (
    previousType !== 'blank' &&
    previousType !== 'action' &&
    previousType !== 'scene-heading' &&
    previousType !== 'transition' &&
    previousType !== 'centered'
  ) {
    return false;
  }
  if (!nextNonBlank) return true;
  return !SCENE_PREFIX.test(nextNonBlank) && !isTransition(nextNonBlank);
}

function normalizeCharacterCue(line: string): string {
  return repeatSpace(CHARACTER_INDENT) + collapseInnerWhitespace(stripExistingIndent(line)).toUpperCase();
}

function normalizeParenthetical(line: string): string {
  return repeatSpace(PAREN_INDENT) + collapseInnerWhitespace(stripExistingIndent(line));
}

function normalizeDialogue(line: string): string {
  return repeatSpace(DIALOGUE_INDENT) + collapseInnerWhitespace(stripExistingIndent(line));
}

function normalizeCentered(line: string): string {
  const cleaned = collapseInnerWhitespace(stripExistingIndent(line)).replace(/^>\s*/, '').replace(/\s*<$/, '');
  const leftPad = Math.max(0, Math.floor((PAGE_WIDTH - cleaned.length) / 2));
  return repeatSpace(leftPad) + cleaned;
}

function formatAction(line: string): string {
  return stripExistingIndent(line).replace(/\s+$/, '');
}

function classifyLine(
  line: string,
  previousType: ScreenplayElement,
  nextNonBlank: string | null,
): ScreenplayElement {
  const cleaned = collapseInnerWhitespace(stripExistingIndent(line));
  if (!cleaned) return 'blank';
  if (SCENE_PREFIX.test(cleaned)) return 'scene-heading';
  if (PAREN.test(cleaned)) return 'parenthetical';
  if (isTransition(cleaned)) return 'transition';
  if (FORCED_CENTER.test(cleaned)) return 'centered';
  if (isLikelyCharacterCue(cleaned, previousType, nextNonBlank)) return 'character';
  if (
    previousType === 'character' ||
    previousType === 'dialogue' ||
    previousType === 'parenthetical'
  ) {
    return 'dialogue';
  }
  return 'action';
}

function formatByType(line: string, type: ScreenplayElement): string {
  switch (type) {
    case 'scene-heading':
      return normalizeSceneHeading(line);
    case 'character':
      return normalizeCharacterCue(line);
    case 'dialogue':
      return normalizeDialogue(line);
    case 'parenthetical':
      return normalizeParenthetical(line);
    case 'transition':
      return normalizeTransition(line);
    case 'centered':
      return normalizeCentered(line);
    case 'blank':
      return '';
    case 'action':
    default:
      return formatAction(line);
  }
}

function getNextNonBlank(lines: string[], index: number): string | null {
  for (let i = index + 1; i < lines.length; i += 1) {
    const cleaned = collapseInnerWhitespace(stripExistingIndent(lines[i]));
    if (cleaned) return cleaned;
  }
  return null;
}

export function getScreenplayElement(line: string): ScreenplayElement {
  const leadingSpaces = (line.match(/^\s*/) ?? [''])[0].length;
  const trimmed = collapseInnerWhitespace(stripExistingIndent(line));
  if (!trimmed) return 'blank';
  if (SCENE_PREFIX.test(trimmed)) return 'scene-heading';
  if (PAREN.test(trimmed)) return 'parenthetical';
  if (isTransition(trimmed)) return 'transition';
  if (FORCED_CENTER.test(trimmed)) return 'centered';
  if (leadingSpaces >= CHARACTER_INDENT && isMostlyUppercase(trimmed) && trimmed.length <= 38) return 'character';
  if (leadingSpaces >= PAREN_INDENT && PAREN.test(trimmed)) return 'parenthetical';
  if (leadingSpaces >= DIALOGUE_INDENT) return 'dialogue';
  if (isLikelyCharacterCue(trimmed, 'blank', null)) return 'character';
  return 'action';
}

export function formatScreenplayLine(line: string): string {
  const type = getScreenplayElement(line);
  return formatByType(line, type);
}

/**
 * Full-document pass: normalize line endings, classify lines with light context,
 * and collapse excessive blank runs.
 */
export function formatScreenplayText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '    ');
  const rawLines = normalized.split('\n');
  const out: string[] = [];
  let previousType: ScreenplayElement = 'blank';
  let blankRun = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    const nextNonBlank = getNextNonBlank(rawLines, index);
    const type = classifyLine(line, previousType, nextNonBlank);
    const formatted = formatByType(line, type);

    if (formatted === '') {
      blankRun += 1;
      if (blankRun <= 2) out.push('');
      previousType = 'blank';
      continue;
    }

    blankRun = 0;
    out.push(formatted);
    previousType = type;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
