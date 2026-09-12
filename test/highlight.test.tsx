import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HighlightedText } from "../src/HighlightedText";

describe("HighlightedText", () => {
  it("wraps the saved phrase in a mark element", () => {
    const html = renderToStaticMarkup(
      <HighlightedText
        text="Ieri sera 44 feriti nel nord"
        phrase="nord"
        before="Ieri sera 44 feriti nel"
      />,
    );
    expect(html).toBe('Ieri sera 44 feriti nel <mark class="context-highlight">nord</mark>');
  });

  it("renders the sentence unchanged when the phrase is absent", () => {
    const html = renderToStaticMarkup(<HighlightedText text="Ciao" phrase="arrivederci" />);
    expect(html).toBe("Ciao");
  });
});
