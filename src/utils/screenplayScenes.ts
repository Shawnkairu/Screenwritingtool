/** Slug lines: INT., EXT., INT./EXT., I/E. at start of line (common screenplay conventions). */
const SLUG_LINE =
  /^\s*(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.|INT\/EXT\.)\s+/im;

export function countSceneHeadings(text: string): number {
  if (!text.trim()) return 0;
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (SLUG_LINE.test(line)) n += 1;
  }
  return n;
}
