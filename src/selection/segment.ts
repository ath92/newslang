/**
 * Word- and sentence-boundary helpers, independent of the DOM so they can be
 * unit-tested under Node. Uses `Intl.Segmenter` when available, with a compact
 * regex fallback for older runtimes.
 */

export interface TextBounds {
  start: number;
  end: number;
}

let wordSegmenter: Intl.Segmenter | null | undefined;
let sentenceSegmenter: Intl.Segmenter | null | undefined;

function createSegmenter(granularity: "word" | "sentence"): Intl.Segmenter | null {
  if (typeof Intl.Segmenter !== "function") return null;
  try {
    return new Intl.Segmenter("it", { granularity });
  } catch {
    return null;
  }
}

function getWordSegmenter(): Intl.Segmenter | null {
  if (wordSegmenter === undefined) wordSegmenter = createSegmenter("word");
  return wordSegmenter;
}

function getSentenceSegmenter(): Intl.Segmenter | null {
  if (sentenceSegmenter === undefined) sentenceSegmenter = createSegmenter("sentence");
  return sentenceSegmenter;
}

function trimBounds(text: string, start: number, end: number): TextBounds {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  return { start: from, end: to };
}

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const SENTENCE_RE = /[^.!?…]*[.!?…]+[\s]*|[^.!?…]+$/g;

function regexWordBoundsAt(text: string, offset: number): TextBounds | null {
  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) return { start, end };
  }
  return null;
}

function regexSentenceBoundsAt(text: string, offset: number): TextBounds | null {
  for (const match of text.matchAll(SENTENCE_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (offset >= start && offset < end) return trimBounds(text, start, end);
  }
  return null;
}

/** The word surrounding `offset`, or null when the caret is between words. */
export function wordBoundsAt(text: string, offset: number): TextBounds | null {
  if (!text) return null;
  const segmenter = getWordSegmenter();
  if (!segmenter) return regexWordBoundsAt(text, offset);
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue;
    const start = part.index;
    const end = start + part.segment.length;
    if (offset >= start && offset <= end) return { start, end };
  }
  return null;
}

/** The sentence surrounding `offset`, trimmed of surrounding whitespace. */
export function sentenceBoundsAt(text: string, offset: number): TextBounds | null {
  if (!text) return null;
  const segmenter = getSentenceSegmenter();
  if (!segmenter) return regexSentenceBoundsAt(text, offset);
  for (const part of segmenter.segment(text)) {
    const start = part.index;
    const end = start + part.segment.length;
    if (offset >= start && offset < end) return trimBounds(text, start, end);
  }
  return null;
}
