import {
  MAX_PHRASE_LENGTH,
  normalizePhrase,
  normalizeWhitespace,
  truncateContext,
} from "../../shared/vocab";
import { sentenceBoundsAt, wordBoundsAt } from "./segment";
import type { SelectionInfo, SelectionRect } from "./types";

/** Block-level elements good enough to serve as "the sentence" around a word. */
const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, dd, dt";

/**
 * Regions that should never trigger a translation: the translator's own UI
 * (so selecting a translation to copy does not re-translate it) and form
 * controls such as the review search box.
 */
const IGNORE_SELECTOR = "[data-translate-ignore], [data-translate-handle], input, textarea, select";

interface CaretPositionLike {
  offsetNode: Node;
  offset: number;
}

type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null;
};

/**
 * Cross-browser caret hit-testing. WebKit/Blink expose the non-standard
 * `caretRangeFromPoint`; Gecko (and very recent Safari) expose the standard
 * `caretPositionFromPoint`.
 */
export function caretRangeFromPoint(x: number, y: number): Range | null {
  if (typeof document === "undefined") return null;
  const doc = document as CaretDocument;
  try {
    if (typeof doc.caretRangeFromPoint === "function") {
      return doc.caretRangeFromPoint(x, y) ?? null;
    }
    if (typeof doc.caretPositionFromPoint === "function") {
      const position = doc.caretPositionFromPoint(x, y);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }
  } catch {
    return null;
  }
  return null;
}

/** True when a node lives inside a region we never translate. */
export function isIgnored(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest(IGNORE_SELECTOR));
}

function findBlock(node: Node, root: ParentNode): Element | null {
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const rootNode = root as unknown as Node;
  while (element && element !== rootNode) {
    if (element.matches(BLOCK_SELECTOR)) return element;
    element = element.parentElement;
  }
  return null;
}

function textNodesIn(block: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

/** Character offset of a caret position within the block's concatenated text. */
function absoluteOffset(block: Element, node: Node, offset: number): number | null {
  const nodes = textNodesIn(block);
  if (node.nodeType === Node.TEXT_NODE) {
    let total = 0;
    for (const text of nodes) {
      if (text === node) return total + Math.min(Math.max(offset, 0), text.data.length);
      total += text.data.length;
    }
    return null;
  }

  const child = node.childNodes[offset] ?? null;
  if (child) {
    let total = 0;
    for (const text of nodes) {
      if (child.contains(text)) return total;
      total += text.data.length;
    }
    return total;
  }
  return (block.textContent ?? "").length;
}

/** Build a Range covering `[start, end)` of the block's concatenated text. */
function textOffsetToRange(block: Element, start: number, end: number): Range | null {
  const nodes = textNodesIn(block);
  const range = document.createRange();
  let total = 0;
  let started = false;
  let finished = false;
  for (const text of nodes) {
    const length = text.data.length;
    if (!started && start <= total + length) {
      range.setStart(text, Math.max(start - total, 0));
      started = true;
    }
    if (started && !finished && end <= total + length) {
      range.setEnd(text, Math.max(end - total, 0));
      finished = true;
      break;
    }
    total += length;
  }
  if (!started || !finished) return null;
  return range;
}

/**
 * True when a viewport point falls inside any of the range's painted boxes.
 * Used to reject taps in a block's empty whitespace: the caret there collapses
 * to the end of the nearest word, but the point is not over its text.
 */
export function rangeContainsPoint(range: Range, x: number, y: number, slop = 2): boolean {
  for (const rect of range.getClientRects()) {
    if (
      x >= rect.left - slop &&
      x <= rect.right + slop &&
      y >= rect.top - slop &&
      y <= rect.bottom + slop
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Expand a caret Range to the word or sentence that contains it, using the
 * nearest block element as the coordinate space.
 */
export function expandRange(
  range: Range,
  root: ParentNode,
  kind: "word" | "sentence",
): Range | null {
  const container = range.startContainer;
  if (!root.contains(container) || isIgnored(container)) return null;
  const block = findBlock(container, root);
  if (!block) return null;
  const offset = absoluteOffset(block, container, range.startOffset);
  if (offset === null) return null;
  const text = block.textContent ?? "";
  const bounds = kind === "word" ? wordBoundsAt(text, offset) : sentenceBoundsAt(text, offset);
  if (!bounds || bounds.start === bounds.end) return null;
  return textOffsetToRange(block, bounds.start, bounds.end);
}

/** Smallest Range covering both inputs, in document order. */
export function unionRanges(a: Range, b: Range): Range | null {
  try {
    const aFirst = a.compareBoundaryPoints(Range.START_TO_START, b) <= 0;
    const start = aFirst ? a : b;
    const end = aFirst ? b : a;
    const range = document.createRange();
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(end.endContainer, end.endOffset);
    return range;
  } catch {
    return null;
  }
}

/** Range between two caret positions, ordered automatically. */
export function orderedRange(
  a: { node: Node; offset: number },
  b: { node: Node; offset: number },
): Range | null {
  try {
    const rangeA = document.createRange();
    rangeA.setStart(a.node, a.offset);
    rangeA.collapse(true);
    const rangeB = document.createRange();
    rangeB.setStart(b.node, b.offset);
    rangeB.collapse(true);
    const range = document.createRange();
    if (rangeA.compareBoundaryPoints(Range.START_TO_START, rangeB) <= 0) {
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
    } else {
      range.setStart(b.node, b.offset);
      range.setEnd(a.node, a.offset);
    }
    return range;
  } catch {
    return null;
  }
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

function toRect(rect: DOMRect | DOMRectReadOnly): SelectionRect {
  // The overlay is positioned in document space (absolute), so it scrolls with
  // the content instead of lagging behind like position: fixed does on iOS.
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  return {
    top: rect.top + scrollY,
    bottom: rect.bottom + scrollY,
    left: rect.left + scrollX,
    right: rect.right + scrollX,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Describe an existing Range as a translatable selection, or return null when
 * it is empty, too long, or lives in an ignored region.
 */
export function describeRange(range: Range, root: ParentNode): SelectionInfo | null {
  if (range.collapsed) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;
  if (isIgnored(range.startContainer) || isIgnored(range.endContainer)) return null;

  const raw = normalizeWhitespace(range.toString());
  if (!raw || raw.length > MAX_PHRASE_LENGTH) return null;

  const bounding = range.getBoundingClientRect();
  if (bounding.width === 0 && bounding.height === 0) return null;

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

  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(toRect);

  return {
    phrase: normalizePhrase(raw),
    context,
    before,
    after,
    rect: toRect(bounding),
    rects,
  };
}
