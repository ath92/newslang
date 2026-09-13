import { describe, expect, it } from "vitest";
import { sentenceBoundsAt, wordBoundsAt } from "../src/selection/segment";

describe("wordBoundsAt", () => {
  const text = "Il gatto dorme sul divano";

  it("returns the word containing the offset", () => {
    expect(wordBoundsAt(text, 4)).toEqual({ start: 3, end: 8 });
  });

  it("treats an apostrophised word as one token", () => {
    const value = "l'articolo è lungo";
    expect(wordBoundsAt(value, 3)).toEqual({ start: 0, end: 10 });
  });

  it("selects the preceding word when tapped at its end", () => {
    // A caret right after "gatto" (offset 8) still resolves to that word.
    expect(wordBoundsAt(text, 8)).toEqual({ start: 3, end: 8 });
  });

  it("returns null between words", () => {
    expect(wordBoundsAt("Il gatto  dorme", 9)).toBeNull();
    expect(wordBoundsAt("", 0)).toBeNull();
  });
});

describe("sentenceBoundsAt", () => {
  const text = "Ciao mondo. Come stai? Bene, grazie.";

  it("returns the first sentence, trimmed", () => {
    expect(sentenceBoundsAt(text, 2)).toEqual({ start: 0, end: 11 });
  });

  it("returns the sentence around a later offset", () => {
    const bounds = sentenceBoundsAt(text, 15);
    expect(text.slice(bounds!.start, bounds!.end)).toBe("Come stai?");
  });

  it("returns null for empty text", () => {
    expect(sentenceBoundsAt("", 0)).toBeNull();
  });
});
