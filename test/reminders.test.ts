import { describe, expect, it } from "vitest";
import {
  clampReminderMinutes,
  DEFAULT_REMINDER_MINUTES,
  isValidTimeZone,
  localDayKeyInZone,
  nextReminderAt,
  reminderCopy,
  shouldRemind,
  todaysReminderAt,
} from "../shared/reminders";

describe("clampReminderMinutes", () => {
  it("falls back to the default for non-numbers", () => {
    expect(clampReminderMinutes(Number.NaN)).toBe(DEFAULT_REMINDER_MINUTES);
    expect(clampReminderMinutes(Number.POSITIVE_INFINITY)).toBe(DEFAULT_REMINDER_MINUTES);
  });

  it("clamps to a real minute of the day", () => {
    expect(clampReminderMinutes(-5)).toBe(0);
    expect(clampReminderMinutes(9999)).toBe(1439);
    expect(clampReminderMinutes(20.6)).toBe(21);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects everything else", () => {
    expect(isValidTimeZone("Europe/Rome")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(123)).toBe(false);
  });
});

describe("localDayKeyInZone", () => {
  // 2026-09-12T01:30:00Z
  const utcMs = Date.UTC(2026, 8, 12, 1, 30);

  it("resolves the local calendar day per timezone", () => {
    expect(localDayKeyInZone(utcMs, "UTC")).toBe("2026-09-12");
    expect(localDayKeyInZone(utcMs, "Asia/Tokyo")).toBe("2026-09-12");
    expect(localDayKeyInZone(utcMs, "America/New_York")).toBe("2026-09-11");
  });

  it("falls back to UTC for an unusable timezone", () => {
    expect(localDayKeyInZone(utcMs, "Not/AZone")).toBe("2026-09-12");
  });
});

describe("todaysReminderAt / nextReminderAt", () => {
  it("returns today's 20:00 when it is still ahead", () => {
    // 10:00 UTC = 12:00 CEST in Rome.
    const now = Date.UTC(2026, 8, 12, 10, 0);
    expect(todaysReminderAt(now, 1200, "Europe/Rome")).toBe(Date.UTC(2026, 8, 12, 18, 0));
    expect(nextReminderAt(now, 1200, "Europe/Rome")).toBe(Date.UTC(2026, 8, 12, 18, 0));
  });

  it("rolls to tomorrow once today's time has passed", () => {
    // 19:00 UTC = 21:00 CEST in Rome.
    const now = Date.UTC(2026, 8, 12, 19, 0);
    expect(todaysReminderAt(now, 1200, "Europe/Rome")).toBe(Date.UTC(2026, 8, 12, 18, 0));
    expect(nextReminderAt(now, 1200, "Europe/Rome")).toBe(Date.UTC(2026, 8, 13, 18, 0));
  });

  it("keeps the wall-clock time across a DST transition", () => {
    // Italy springs forward on 2026-03-29 and falls back on 2026-10-25.
    expect(nextReminderAt(Date.UTC(2026, 2, 28, 10, 0), 1200, "Europe/Rome")).toBe(
      Date.UTC(2026, 2, 28, 19, 0),
    );
    expect(nextReminderAt(Date.UTC(2026, 2, 29, 10, 0), 1200, "Europe/Rome")).toBe(
      Date.UTC(2026, 2, 29, 18, 0),
    );
    expect(nextReminderAt(Date.UTC(2026, 9, 25, 10, 0), 1200, "Europe/Rome")).toBe(
      Date.UTC(2026, 9, 25, 19, 0),
    );
  });

  it("handles zones ahead of UTC whose local day has already turned", () => {
    // Pacific/Kiritimati is UTC+14: 10:00Z is already the next local day.
    expect(nextReminderAt(Date.UTC(2026, 8, 12, 10, 0), 1200, "Pacific/Kiritimati")).toBe(
      Date.UTC(2026, 8, 13, 6, 0),
    );
  });

  it("always returns an instant strictly in the future", () => {
    const now = Date.UTC(2026, 8, 12, 18, 0);
    expect(nextReminderAt(now, 1200, "Europe/Rome")).toBeGreaterThan(now);
  });
});

describe("shouldRemind", () => {
  it("requires an active, unmet goal", () => {
    expect(shouldRemind({ enabled: true, targetMinutes: 10, minutesToday: 3 })).toBe(true);
    expect(shouldRemind({ enabled: false, targetMinutes: 10, minutesToday: 3 })).toBe(false);
    expect(shouldRemind({ enabled: true, targetMinutes: 0, minutesToday: 0 })).toBe(false);
    expect(shouldRemind({ enabled: true, targetMinutes: 10, minutesToday: 10 })).toBe(false);
  });
});

describe("reminderCopy", () => {
  it("reports the remaining minutes and the streak", () => {
    const copy = reminderCopy({ targetMinutes: 10, minutesToday: 3, streak: 5 });
    expect(copy.title).toContain("Non hai ancora letto");
    expect(copy.body).toContain("7 min");
    expect(copy.body).toContain("5 giorni");
  });

  it("omits the streak when there is nothing to celebrate", () => {
    const copy = reminderCopy({ targetMinutes: 10, minutesToday: 3, streak: 1 });
    expect(copy.body).not.toContain("Serie");
  });
});
