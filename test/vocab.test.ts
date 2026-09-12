import { describe, expect, it } from "vitest";
import {
  MAX_BOX,
  normalizePhrase,
  normalizeWhitespace,
  phraseKey,
  REVIEW_INTERVALS_DAYS,
  scheduleReview,
  truncateContext,
} from "../shared/vocab";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("normalizeWhitespace", () => {
  it("collapses runs and trims", () => {
    expect(normalizeWhitespace("  ciao \n  mondo\t! ")).toBe("ciao mondo !");
  });
});

describe("normalizePhrase", () => {
  it("caps the phrase length", () => {
    expect(normalizePhrase("a".repeat(400)).length).toBe(300);
  });
});

describe("phraseKey", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(phraseKey("  Città  ")).toBe(phraseKey("città"));
  });

  it("normalizes unicode", () => {
    expect(phraseKey("perché")).toBe(phraseKey("perche\u0301"));
  });
});

describe("truncateContext", () => {
  it("keeps short text untouched", () => {
    expect(truncateContext("breve")).toBe("breve");
  });

  it("appends an ellipsis when cutting", () => {
    const result = truncateContext("a".repeat(50), 10);
    expect(result).toBe(`${"a".repeat(9)}…`);
  });
});

describe("scheduleReview", () => {
  const now = 1_700_000_000_000;

  it("promotes a known phrase and spaces the next review out", () => {
    expect(scheduleReview(0, "known", now)).toEqual({
      box: 1,
      dueAt: now + REVIEW_INTERVALS_DAYS[1] * DAY_MS,
    });
    expect(scheduleReview(2, "known", now)).toEqual({
      box: 3,
      dueAt: now + REVIEW_INTERVALS_DAYS[3] * DAY_MS,
    });
  });

  it("never promotes past the highest box", () => {
    expect(scheduleReview(MAX_BOX, "known", now).box).toBe(MAX_BOX);
  });

  it("resets and reschedules quickly after a miss", () => {
    const result = scheduleReview(4, "again", now);
    expect(result.box).toBe(0);
    expect(result.dueAt).toBeGreaterThan(now);
    expect(result.dueAt).toBeLessThan(now + DAY_MS);
  });
});
