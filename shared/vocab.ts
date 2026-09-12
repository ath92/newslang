/**
 * Vocabulary helpers shared by the Worker (storage, scheduling) and the React
 * app (selection, review UI). Keep this file dependency-free so it can be
 * bundled into both projects.
 */

import type { ReviewResult } from "./contracts";

/** Longest phrase (in characters) we are willing to translate/store. */
export const MAX_PHRASE_LENGTH = 300;
/** Longest surrounding context (in characters) we keep per saved phrase. */
export const MAX_CONTEXT_LENGTH = 1200;

const WHITESPACE_RE = /\s+/g;

/** Collapse whitespace runs and trim. */
export function normalizeWhitespace(value: string): string {
  return value.replace(WHITESPACE_RE, " ").trim();
}

/** Normalize a selected phrase for display and storage. */
export function normalizePhrase(value: string, maxLength = MAX_PHRASE_LENGTH): string {
  return normalizeWhitespace(value).slice(0, maxLength);
}

/**
 * Stable identity for a saved phrase. Case- and accent-insensitive enough that
 * "Città" and "città " map to the same vocabulary entry.
 */
export function phraseKey(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase("it-IT").normalize("NFC");
}

/** Collapse and cap a context snippet, appending an ellipsis when truncated. */
export function truncateContext(value: string, maxLength = MAX_CONTEXT_LENGTH): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Locate a saved phrase inside a context sentence, case-insensitively.
 *
 * When the stored `before` snippet is available (and was not truncated), its
 * length approximates the phrase's position, so we pick the occurrence closest
 * to it — useful when a short phrase such as "il" appears several times.
 * Returns the character index, or -1 when the phrase is not present.
 */
export function findPhraseIndex(text: string, phrase: string, before?: string): number {
  const needle = phrase.toLocaleLowerCase("it-IT");
  if (!needle) return -1;

  const haystack = text.toLocaleLowerCase("it-IT");
  const first = haystack.indexOf(needle);
  if (first === -1) return -1;

  const expected = before && !before.endsWith("…") ? before.length : undefined;
  if (expected === undefined) return first;

  let best = first;
  let bestDistance = Math.abs(first - expected);
  let at = haystack.indexOf(needle, first + 1);
  while (at !== -1) {
    const distance = Math.abs(at - expected);
    if (distance < bestDistance) {
      best = at;
      bestDistance = distance;
    }
    at = haystack.indexOf(needle, at + 1);
  }
  return best;
}

/** Days to wait before the next review, indexed by the entry's new box. */
export const REVIEW_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35] as const;
/** Highest Leitner box an entry can reach. */
export const MAX_BOX = REVIEW_INTERVALS_DAYS.length - 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_DELAY_MS = 10 * 60 * 1000;

export interface ReviewSchedule {
  box: number;
  dueAt: number;
}

/**
 * Tiny Leitner-style scheduler. "known" promotes the entry one box (spacing the
 * next review further out); "again" resets it and brings it back in ten minutes.
 */
export function scheduleReview(box: number, result: ReviewResult, now: number): ReviewSchedule {
  if (result === "again") {
    return { box: 0, dueAt: now + AGAIN_DELAY_MS };
  }
  const nextBox = Math.min(Math.max(box, 0) + 1, MAX_BOX);
  return { box: nextBox, dueAt: now + REVIEW_INTERVALS_DAYS[nextBox] * DAY_MS };
}

/** True when an entry is due for review. */
export function isDue(entry: { dueAt: number }, now: number): boolean {
  return entry.dueAt <= now;
}
