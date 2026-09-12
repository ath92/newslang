import { describe, expect, it } from "vitest";
import type { DailyProgress } from "../shared/contracts";
import {
  clampDailyTarget,
  clampReadingMinutes,
  clampTimezoneOffset,
  computeStreak,
  DEFAULT_DAILY_TARGET_MINUTES,
  isTargetMet,
  localDayKey,
  progressRatio,
  shiftDay,
} from "../shared/progress";

const day = (value: string, minutes: number): DailyProgress => ({
  day: value,
  minutes,
  articles: minutes > 0 ? 1 : 0,
});

describe("localDayKey", () => {
  // 2026-09-12T01:30:00Z
  const utcMs = Date.UTC(2026, 8, 12, 1, 30);

  it("keeps the UTC day for a zero offset", () => {
    expect(localDayKey(utcMs, 0)).toBe("2026-09-12");
  });

  it("shifts forward for an east-of-UTC reader", () => {
    // UTC+2 => getTimezoneOffset() === -120
    expect(localDayKey(utcMs, -120)).toBe("2026-09-12");
  });

  it("rolls back a day for a west-of-UTC reader", () => {
    // UTC-5 => getTimezoneOffset() === 300; 01:30Z is 20:30 the previous day
    expect(localDayKey(utcMs, 300)).toBe("2026-09-11");
  });
});

describe("shiftDay", () => {
  it("moves across month boundaries", () => {
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("clamps", () => {
  it("clamps timezone offsets", () => {
    expect(clampTimezoneOffset(Number.NaN)).toBe(0);
    expect(clampTimezoneOffset(9999)).toBe(840);
    expect(clampTimezoneOffset(-9999)).toBe(-840);
  });

  it("clamps credited minutes", () => {
    expect(clampReadingMinutes(0)).toBe(1);
    expect(clampReadingMinutes(999)).toBe(120);
    expect(clampReadingMinutes(4.4)).toBe(4);
  });

  it("clamps the daily target, treating <= 0 as off", () => {
    expect(clampDailyTarget(0)).toBe(0);
    expect(clampDailyTarget(-3)).toBe(0);
    expect(clampDailyTarget(1)).toBe(5);
    expect(clampDailyTarget(999)).toBe(240);
    expect(clampDailyTarget(Number.NaN)).toBe(DEFAULT_DAILY_TARGET_MINUTES);
  });
});

describe("isTargetMet / progressRatio", () => {
  it("needs an active target", () => {
    expect(isTargetMet(10, 0)).toBe(false);
    expect(isTargetMet(9, 10)).toBe(false);
    expect(isTargetMet(10, 10)).toBe(true);
  });

  it("caps the ratio at 1", () => {
    expect(progressRatio(5, 10)).toBe(0.5);
    expect(progressRatio(30, 10)).toBe(1);
    expect(progressRatio(5, 0)).toBe(0);
  });
});

describe("computeStreak", () => {
  const history = [
    day("2026-09-09", 20),
    day("2026-09-10", 2),
    day("2026-09-11", 12),
    day("2026-09-12", 10),
  ];

  it("counts consecutive met days ending today", () => {
    expect(computeStreak(history, 10, "2026-09-12")).toBe(2);
  });

  it("keeps the streak alive while today is not met yet", () => {
    const withoutToday = [day("2026-09-10", 12), day("2026-09-11", 11), day("2026-09-12", 3)];
    expect(computeStreak(withoutToday, 10, "2026-09-12")).toBe(2);
  });

  it("breaks on the first missed day", () => {
    expect(computeStreak(history, 10, "2026-09-12")).toBe(2);
    expect(computeStreak(history, 11, "2026-09-12")).toBe(1);
  });

  it("is zero when the goal is off or no day met it", () => {
    expect(computeStreak(history, 0, "2026-09-12")).toBe(0);
    expect(computeStreak(history, 100, "2026-09-12")).toBe(0);
  });
});
