import { describeRange } from "./caret";
import type { SelectionInfo } from "./types";

/**
 * Inspect the browser's native selection and describe it, or return null when
 * there is nothing meaningful selected. Used on desktop and as a fallback when
 * the custom touch engine is unavailable.
 */
export function getSelectionInfo(scope?: ParentNode | null): SelectionInfo | null {
  const root = scope ?? document.body;
  if (!root) return null;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  return describeRange(selection.getRangeAt(0), root);
}
