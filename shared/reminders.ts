/**
 * Daily reading-reminder helpers, shared by the Worker (which schedules the
 * Durable Object alarm and composes the notification) and the React app (which
 * exposes the settings). Dependency-free so both bundles can use it.
 *
 * A reminder is stored as an IANA timezone plus "minutes after local midnight"
 * rather than a raw UTC offset, so it keeps its wall-clock time across
 * daylight-saving changes. `Date` is always UTC inside Workers, so all local
 * math goes through `Intl.DateTimeFormat`.
 */

import { localDayKey, shiftDay } from "./progress";

/** 20:00 — the default reminder time. */
export const DEFAULT_REMINDER_MINUTES = 20 * 60;
export const MIN_REMINDER_MINUTES = 0;
export const MAX_REMINDER_MINUTES = 23 * 60 + 59;

/** Used when a client sends no timezone (or an unusable one). */
export const FALLBACK_TIMEZONE = "UTC";

const MINUTE_MS = 60_000;

/** Clamp a reminder time to a real minute of the day. */
export function clampReminderMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REMINDER_MINUTES;
  return Math.min(Math.max(Math.round(value), MIN_REMINDER_MINUTES), MAX_REMINDER_MINUTES);
}

/** True when `value` is an IANA timezone this runtime understands. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Offset (local wall clock − UTC) in milliseconds at a given instant. */
function zoneOffsetMs(timeZone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - atMs;
}

/**
 * A local calendar day + minute-of-day in a timezone → the UTC instant.
 * Two passes detect the offset on either side of a DST transition.
 */
function zonedTimeToUtc(timeZone: string, day: string, minutes: number): number {
  const [year, month, date] = day.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, date, Math.floor(minutes / 60), minutes % 60);
  const firstOffset = zoneOffsetMs(timeZone, guess);
  const adjusted = guess - firstOffset;
  const secondOffset = zoneOffsetMs(timeZone, adjusted);
  return secondOffset === firstOffset ? adjusted : guess - secondOffset;
}

/** Local calendar day (`YYYY-MM-DD`) for an instant in an IANA timezone. */
export function localDayKeyInZone(utcMs: number, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIMEZONE;
  // `localDayKey` expects the JS `getTimezoneOffset()` convention (UTC − local).
  return localDayKey(utcMs, -zoneOffsetMs(zone, utcMs) / MINUTE_MS);
}

/** Today's reminder instant in the reader's timezone (may already have passed). */
export function todaysReminderAt(utcMs: number, reminderMinutes: number, timeZone: string): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIMEZONE;
  return zonedTimeToUtc(
    zone,
    localDayKeyInZone(utcMs, zone),
    clampReminderMinutes(reminderMinutes),
  );
}

/** The next reminder instant strictly after `utcMs` (today or tomorrow). */
export function nextReminderAt(utcMs: number, reminderMinutes: number, timeZone: string): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIMEZONE;
  const today = todaysReminderAt(utcMs, reminderMinutes, zone);
  if (today > utcMs) return today;
  const tomorrow = shiftDay(localDayKeyInZone(utcMs, zone), 1);
  return zonedTimeToUtc(zone, tomorrow, clampReminderMinutes(reminderMinutes));
}

/** True when a reminder should fire: the goal is active and not met yet. */
export function shouldRemind(input: {
  enabled: boolean;
  targetMinutes: number;
  minutesToday: number;
}): boolean {
  return input.enabled && input.targetMinutes > 0 && input.minutesToday < input.targetMinutes;
}

/** Notification copy for a missed daily goal. */
export interface ReminderCopy {
  title: string;
  body: string;
}

export function reminderCopy(input: {
  targetMinutes: number;
  minutesToday: number;
  streak: number;
}): ReminderCopy {
  const remaining = Math.max(input.targetMinutes - input.minutesToday, 0);
  const streak = input.streak > 1 ? ` Serie: ${input.streak} giorni 🔥` : "";
  return {
    title: "Non hai ancora letto oggi 📚",
    body: `Ti mancano ${remaining} min per l'obiettivo di oggi.${streak}`,
  };
}
