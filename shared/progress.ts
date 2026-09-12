/**
 * Daily reading-goal helpers, shared by the Worker (storage, streak) and the
 * React app (progress UI). Dependency-free so both bundles can use it.
 */

import type { DailyProgress } from "./contracts";

export const DEFAULT_DAILY_TARGET_MINUTES = 10;
export const MIN_DAILY_TARGET_MINUTES = 5;
export const MAX_DAILY_TARGET_MINUTES = 240;

export const MIN_READING_MINUTES = 1;
export const MAX_READING_MINUTES = 120;

/** Widest real-world UTC offset, in minutes. */
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

/** Days shown in the progress history strip. */
export const HISTORY_DAYS = 7;
/** Days scanned to compute the streak (a streak can exceed the strip). */
export const STREAK_WINDOW_DAYS = 30;

/**
 * Local calendar day (`YYYY-MM-DD`) for a UTC instant.
 *
 * `tzOffsetMinutes` uses the JS `Date#getTimezoneOffset()` convention: the
 * number of minutes UTC is ahead of local time (so UTC+2 is `-120`).
 */
export function localDayKey(utcMs: number, tzOffsetMinutes: number): string {
  const localMs = utcMs - tzOffsetMinutes * 60_000;
  return new Date(localMs).toISOString().slice(0, 10);
}

/** Move a `YYYY-MM-DD` day by a number of days. */
export function shiftDay(day: string, deltaDays: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** Clamp a client-supplied timezone offset to a real-world range. */
export function clampTimezoneOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(
    Math.max(Math.round(value), -MAX_TIMEZONE_OFFSET_MINUTES),
    MAX_TIMEZONE_OFFSET_MINUTES,
  );
}

/** Clamp a credited article's minutes to something plausible. */
export function clampReadingMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_READING_MINUTES;
  return Math.min(Math.max(Math.round(value), MIN_READING_MINUTES), MAX_READING_MINUTES);
}

/** Clamp a daily target; `0` (or less) means the goal is off. */
export function clampDailyTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_TARGET_MINUTES;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  return Math.min(Math.max(rounded, MIN_DAILY_TARGET_MINUTES), MAX_DAILY_TARGET_MINUTES);
}

/** True when the goal is active and the day's minutes reached it. */
export function isTargetMet(minutes: number, targetMinutes: number): boolean {
  return targetMinutes > 0 && minutes >= targetMinutes;
}

/** Fraction of the target reached, capped at 1. */
export function progressRatio(minutes: number, targetMinutes: number): number {
  if (targetMinutes <= 0) return 0;
  return Math.min(minutes / targetMinutes, 1);
}

/**
 * Consecutive days that met the target, ending today (or yesterday when today
 * isn't met yet — the current day only breaks a streak once it is over).
 */
export function computeStreak(
  history: DailyProgress[],
  targetMinutes: number,
  today: string,
): number {
  if (targetMinutes <= 0) return 0;

  const byDay = new Map(history.map((entry) => [entry.day, entry.minutes]));
  const met = (day: string) => (byDay.get(day) ?? 0) >= targetMinutes;

  let cursor = met(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (met(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}
