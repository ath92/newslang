import { describe, expect, it } from "vitest";
import { estimateReadMinutes, WORDS_PER_MINUTE } from "../shared/reading";

function words(count: number): string {
  return Array.from({ length: count }, () => "ciao").join(" ");
}

describe("estimateReadMinutes", () => {
  it("returns undefined for empty or missing text", () => {
    expect(estimateReadMinutes("")).toBeUndefined();
    expect(estimateReadMinutes("   ")).toBeUndefined();
    expect(estimateReadMinutes(null)).toBeUndefined();
    expect(estimateReadMinutes(undefined)).toBeUndefined();
  });

  it("never estimates less than one minute", () => {
    expect(estimateReadMinutes("ciao")).toBe(1);
  });

  it("uses the words-per-minute rate", () => {
    expect(estimateReadMinutes(words(WORDS_PER_MINUTE * 3))).toBe(3);
  });

  it("rounds to the nearest minute", () => {
    expect(estimateReadMinutes(words(Math.round(WORDS_PER_MINUTE * 2.4)))).toBe(2);
    expect(estimateReadMinutes(words(Math.round(WORDS_PER_MINUTE * 2.6)))).toBe(3);
  });
});
