const HIGHLIGHT_NAME = "newslang-selection";

type HighlightCtor = new (...ranges: Range[]) => object;

interface HighlightRegistry {
  set(name: string, value: object): void;
  delete(name: string): void;
}

interface HighlightCSS {
  highlights?: HighlightRegistry;
}

/**
 * The CSS Custom Highlight API paints a Range without mutating the DOM or
 * involving the native selection (which would summon the OS edit toolbar).
 * Supported in Safari 17.2+, Chrome 105+, Firefox 140+. It doubles as the gate
 * for the custom touch engine.
 */
export function supportsCustomHighlight(): boolean {
  if (typeof CSS === "undefined") return false;
  const registry = (CSS as unknown as HighlightCSS).highlights;
  const ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return Boolean(registry && typeof ctor === "function");
}

/** Paint (or clear) the shared selection highlight. */
export function paintHighlight(range: Range | null): void {
  if (!supportsCustomHighlight()) return;
  const registry = (CSS as unknown as HighlightCSS).highlights;
  const ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  if (!registry || !ctor) return;
  if (range && range.toString().trim()) {
    registry.set(HIGHLIGHT_NAME, new ctor(range));
  } else {
    registry.delete(HIGHLIGHT_NAME);
  }
}
