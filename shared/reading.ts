/**
 * Reading-time estimate for an article.
 *
 * Kept deliberately low (100 wpm): the audience is reading Italian as a second
 * language, so time is spent decoding vocabulary and grammar, not just skimming.
 * Under-promising the time is friendlier than over-promising it.
 */

/** Average words a learner reads per minute. */
export const WORDS_PER_MINUTE = 100;

/** Estimate reading time in whole minutes; `undefined` when there is no text. */
export function estimateReadMinutes(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return undefined;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
