import { describe, expect, it } from "vitest";
import { DEFAULT_QUIZ_PREFERENCES, parseQuizPreferences } from "../src/settings";
import { QUIZ_MAX_QUESTIONS, QUIZ_MIN_QUESTIONS } from "../shared/quiz";

describe("parseQuizPreferences", () => {
  it("returns the defaults for missing or malformed input", () => {
    expect(parseQuizPreferences(null)).toEqual(DEFAULT_QUIZ_PREFERENCES);
    expect(parseQuizPreferences("nope")).toEqual(DEFAULT_QUIZ_PREFERENCES);
    expect(parseQuizPreferences({ mode: "bogus", questionCount: "x" })).toEqual(
      DEFAULT_QUIZ_PREFERENCES,
    );
  });

  it("defaults the mode to open answer", () => {
    expect(DEFAULT_QUIZ_PREFERENCES.mode).toBe("open");
  });

  it("keeps valid preferences", () => {
    expect(parseQuizPreferences({ mode: "mixed", questionCount: 5 })).toEqual({
      mode: "mixed",
      questionCount: 5,
    });
  });

  it("clamps the question count into range", () => {
    expect(parseQuizPreferences({ mode: "open", questionCount: 1 }).questionCount).toBe(
      QUIZ_MIN_QUESTIONS,
    );
    expect(parseQuizPreferences({ mode: "open", questionCount: 99 }).questionCount).toBe(
      QUIZ_MAX_QUESTIONS,
    );
  });
});
