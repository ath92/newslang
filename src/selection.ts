import {
  MAX_PHRASE_LENGTH,
  normalizePhrase,
  normalizeWhitespace,
  truncateContext,
} from "../shared/vocab";

/** Block-level elements good enough to serve as "the sentence" around a word. */
const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, dd, dt";

/**
 * Regions that should never trigger a translation: the translator's own UI
 * (so selecting a translation to copy does not re-translate it) and form
 * controls such as the review search box.
 */
const IGNORE_SELECTOR = "[data-translate-ignore], input, textarea, select";

export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface SelectionInfo {
  /** The selected words, whitespace-normalized. */
  phrase: string;
  /** The surrounding block of text (paragraph/sentence). */
  context: string;
  /** Text between the start of the block and the selection. */
  before?: string;
  /** Text between the selection and the end of the block. */
  after?: string;
  rect: SelectionRect;
}

function findBlock(node: Node, root: Node): Element | null {
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (element && element !== root) {
    if (element.matches(BLOCK_SELECTOR)) return element;
    element = element.parentElement;
  }
  return null;
}

/** True when a node lives inside a region we never translate. */
function isIgnored(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest(IGNORE_SELECTOR));
}

function textAround(range: Range, block: Element): { before: string; after: string } {
  const before = document.createRange();
  before.selectNodeContents(block);
  try {
    before.setEnd(range.startContainer, range.startOffset);
  } catch {
    return { before: "", after: "" };
  }

  const after = document.createRange();
  after.selectNodeContents(block);
  try {
    after.setStart(range.endContainer, range.endOffset);
  } catch {
    return { before: before.toString(), after: "" };
  }

  return { before: before.toString(), after: after.toString() };
}

/**
 * Inspect the current selection and describe it, or return null when there is
 * nothing meaningful selected. Defaults to the whole document so every
 * selectable bit of text — article body, headline, summary, UI chrome — can be
 * translated, while ignoring the translator's own UI and form controls.
 */
export function getSelectionInfo(scope?: ParentNode | null): SelectionInfo | null {
  const root = scope ?? document.body;
  if (!root) return null;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  if (isIgnored(range.startContainer) || isIgnored(range.endContainer)) return null;

  const raw = normalizeWhitespace(selection.toString());
  if (!raw || raw.length > MAX_PHRASE_LENGTH) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const block = findBlock(range.startContainer, root);
  let context = truncateContext(block?.textContent ?? "");
  let before: string | undefined;
  let after: string | undefined;

  if (block) {
    const around = textAround(range, block);
    before = truncateContext(around.before, 400) || undefined;
    after = truncateContext(around.after, 400) || undefined;
    if (!context) context = truncateContext(raw);
  }

  return {
    phrase: normalizePhrase(raw),
    context,
    before,
    after,
    rect: {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    },
  };
}
