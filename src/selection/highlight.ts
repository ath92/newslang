const HIGHLIGHT_NAME = "newslang-selection";

type HighlightCtor = new (...ranges: Range[]) => HighlightInstance;

interface HighlightInstance {
  add(range: Range): void;
  clear(): void;
}

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

/**
 * One long-lived Highlight instance, mutated in place. Creating a new Highlight
 * and re-`set`ting it on every pointer move makes the browser remove the old
 * highlight before adding the new one, which shows up as a flicker while the
 * selection is expanding.
 */
let highlight: HighlightInstance | null = null;
let registered = false;

/** Paint (or clear) the shared selection highlight. */
export function paintHighlight(range: Range | null): void {
  if (!supportsCustomHighlight()) return;
  const registry = (CSS as unknown as HighlightCSS).highlights;
  const ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  if (!registry || !ctor) return;

  if (!highlight) highlight = new ctor();
  highlight.clear();
  if (range && range.toString().trim()) {
    highlight.add(range);
  }

  // Register once; subsequent updates are live because the registry holds the
  // same instance.
  if (!registered) {
    registry.set(HIGHLIGHT_NAME, highlight);
    registered = true;
  }
}
