import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  caretRangeFromPoint,
  describeRange,
  expandRange,
  orderedRange,
  unionRanges,
} from "./caret";
import {
  DEFAULT_GESTURE_CONFIG,
  initialGestureState,
  reduceGesture,
  type GestureEvent,
  type GestureIntent,
  type GestureState,
} from "./gesture";
import { paintHighlight, supportsCustomHighlight } from "./highlight";
import type { SelectionInfo, SelectionRect } from "./types";

export interface SelectionHandlePoint {
  x: number;
  y: number;
}

export interface SelectionHandles {
  start: SelectionHandlePoint;
  end: SelectionHandlePoint;
}

export interface TextSelection {
  /** True when the custom touch engine owns selection on this device. */
  active: boolean;
  /** The current custom selection, or null. */
  selection: SelectionInfo | null;
  /** Drag handles for extending the selection, or null. */
  handles: SelectionHandles | null;
  /** True while the user is actively extending a selection. */
  dragging: boolean;
  clear: () => void;
  onHandlePointerDown: (edge: "start" | "end", event: ReactPointerEvent) => void;
}

/**
 * Interactive elements are excluded on touch: a tap there should activate the
 * element, not silently start a translation selection. Form controls and the
 * translator's own UI are excluded too.
 */
const IGNORE_TARGET =
  "[data-translate-ignore], [data-translate-handle], input, textarea, select, a, button, [role='button']";

/** localStorage key (or `?selection=custom|native`) to force the engine on/off. */
const OVERRIDE_KEY = "newslang.selection";

function readOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const param = new URLSearchParams(window.location.search).get("selection");
    if (param === "custom") return true;
    if (param === "native") return false;
    const stored = window.localStorage.getItem(OVERRIDE_KEY);
    if (stored === "custom") return true;
    if (stored === "native") return false;
  } catch {
    // Private mode / blocked storage: fall through to feature detection.
  }
  return null;
}

/**
 * Decide whether the custom engine should own selection.
 *
 * True on real touch devices and in Chrome DevTools device mode (which reports
 * `maxTouchPoints` and a mobile user agent, and usually emulates
 * `pointer: coarse`). Desktop keeps native selection. `?selection=custom` or
 * `localStorage.setItem("newslang.selection", "custom")` forces it for testing;
 * `native` forces it off.
 */
function detectCustomSelection(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!supportsCustomHighlight()) return false;

  const override = readOverride();
  if (override !== null) return override;

  if (window.matchMedia("(pointer: coarse)").matches) return true;

  const touchCapable = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  const mobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (touchCapable && mobileUA) return true;
  if (window.matchMedia("(any-pointer: coarse)").matches && mobileUA) return true;

  return false;
}

function isIgnoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(IGNORE_TARGET));
}

function computeHandles(rects: SelectionRect[]): SelectionHandles | null {
  if (rects.length === 0) return null;
  const first = rects[0];
  const last = rects[rects.length - 1];
  return {
    start: { x: first.left, y: first.bottom },
    end: { x: last.right, y: last.bottom },
  };
}

interface HandleDrag {
  fixedNode: Node;
  fixedOffset: number;
}

/**
 * Custom touch selection engine: tap for a word, double-tap for a sentence,
 * press-and-hold then drag to extend. It never touches `window.getSelection()`,
 * so the OS edit toolbar stays away; the selection is painted with the CSS
 * Custom Highlight API.
 *
 * Scroll arbitration: the first `touchmove` after the hold fires is
 * `preventDefault`ed (the listener is non-passive), which keeps iOS from
 * scrolling. Movement before the hold aborts to a normal scroll.
 */
export function useTextSelection(): TextSelection {
  const [active, setActive] = useState(false);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [handles, setHandles] = useState<SelectionHandles | null>(null);
  const [dragging, setDragging] = useState(false);

  const stateRef = useRef<GestureState>(initialGestureState());
  const rangeRef = useRef<Range | null>(null);
  const anchorRangeRef = useRef<Range | null>(null);
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDragRef = useRef<HandleDrag | null>(null);

  useEffect(() => {
    const update = () => setActive(detectCustomSelection());
    update();

    const coarse = window.matchMedia("(pointer: coarse)");
    coarse.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    return () => {
      coarse.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    document.body.classList.add("custom-selection");
    return () => document.body.classList.remove("custom-selection");
  }, [active]);

  const commitRange = useCallback((range: Range | null) => {
    rangeRef.current = range;
    paintHighlight(range);
    if (!range || range.collapsed) {
      setSelection(null);
      setHandles(null);
      return;
    }
    const info = describeRange(range, document.body);
    if (!info) {
      rangeRef.current = null;
      paintHighlight(null);
      setSelection(null);
      setHandles(null);
      return;
    }
    setSelection(info);
    setHandles(computeHandles(info.rects));
  }, []);

  const clear = useCallback(() => {
    anchorRangeRef.current = null;
    commitRange(null);
  }, [commitRange]);

  // Leaving custom mode (e.g. device emulation toggled off) drops the highlight.
  useEffect(() => {
    if (active) return;
    clear();
  }, [active, clear]);

  const applyIntent = useCallback(
    (intent: GestureIntent) => {
      switch (intent.type) {
        case "enterDrag": {
          const caret = caretRangeFromPoint(intent.x, intent.y);
          const word = caret ? expandRange(caret, document.body, "word") : null;
          anchorRangeRef.current = word;
          commitRange(word);
          setDragging(true);
          return;
        }
        case "updateDrag": {
          const anchor = anchorRangeRef.current;
          if (!anchor) return;
          const caret = caretRangeFromPoint(intent.x, intent.y);
          const focus = caret ? expandRange(caret, document.body, "word") : null;
          if (!focus) return;
          const union = unionRanges(anchor, focus);
          if (union) commitRange(union);
          return;
        }
        case "finalizeDrag":
          anchorRangeRef.current = null;
          setDragging(false);
          return;
        case "tap": {
          const caret = caretRangeFromPoint(intent.x, intent.y);
          const word = caret ? expandRange(caret, document.body, "word") : null;
          if (word) commitRange(word);
          else clear();
          return;
        }
        case "doubleTap": {
          const caret = caretRangeFromPoint(intent.x, intent.y);
          const sentence = caret ? expandRange(caret, document.body, "sentence") : null;
          if (sentence) commitRange(sentence);
          else clear();
          return;
        }
        case "abort":
          setDragging(false);
          return;
        case "none":
          return;
      }
    },
    [clear, commitRange],
  );

  useEffect(() => {
    if (!active) return;

    const disarmDwell = () => {
      if (dwellRef.current !== null) {
        clearTimeout(dwellRef.current);
        dwellRef.current = null;
      }
    };

    const dispatch = (event: GestureEvent) => {
      const result = reduceGesture(stateRef.current, event, DEFAULT_GESTURE_CONFIG);
      stateRef.current = result.state;
      applyIntent(result.intent);
      return result;
    };

    const armDwell = () => {
      disarmDwell();
      dwellRef.current = setTimeout(() => {
        dwellRef.current = null;
        dispatch({ type: "dwell" });
      }, DEFAULT_GESTURE_CONFIG.holdDelay);
    };

    const onStart = (event: TouchEvent) => {
      if (handleDragRef.current || event.touches.length !== 1) return;
      if (isIgnoredTarget(event.target)) return;
      const touch = event.touches[0];
      const result = dispatch({
        type: "down",
        x: touch.clientX,
        y: touch.clientY,
        t: event.timeStamp || Date.now(),
      });
      if (result.state.mode === "pending") armDwell();
    };

    const onMove = (event: TouchEvent) => {
      if (handleDragRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const result = dispatch({ type: "move", x: touch.clientX, y: touch.clientY });
      if (result.intent.type === "abort") disarmDwell();
      if (result.state.mode === "dragging") event.preventDefault();
    };

    const onEnd = (event: TouchEvent) => {
      if (handleDragRef.current) return;
      disarmDwell();
      dispatch({ type: "up", t: event.timeStamp || Date.now() });
    };

    const onCancel = () => {
      if (handleDragRef.current) return;
      disarmDwell();
      dispatch({ type: "cancel" });
    };

    document.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: false });
    document.addEventListener("touchcancel", onCancel);
    return () => {
      disarmDwell();
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [active, applyIntent]);

  // Keep the trigger and handles aligned with the content while scrolling.
  const hasSelection = selection !== null;
  useEffect(() => {
    if (!active || !hasSelection) return;
    let frame = 0;
    const reposition = () => {
      frame = 0;
      const range = rangeRef.current;
      if (!range) return;
      const info = describeRange(range, document.body);
      if (!info) return;
      setSelection(info);
      setHandles(computeHandles(info.rects));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(reposition);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [active, hasSelection]);

  const onHandlePointerDown = useCallback(
    (edge: "start" | "end", event: ReactPointerEvent) => {
      if (!active || event.button !== 0 || !event.isPrimary) return;
      const range = rangeRef.current;
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();

      const handle = event.currentTarget as Element;
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture is best-effort.
      }

      handleDragRef.current =
        edge === "start"
          ? { fixedNode: range.endContainer, fixedOffset: range.endOffset }
          : { fixedNode: range.startContainer, fixedOffset: range.startOffset };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const drag = handleDragRef.current;
        if (!drag) return;
        moveEvent.preventDefault();
        const caret = caretRangeFromPoint(moveEvent.clientX, moveEvent.clientY);
        if (!caret) return;
        const next = orderedRange(
          { node: drag.fixedNode, offset: drag.fixedOffset },
          { node: caret.startContainer, offset: caret.startOffset },
        );
        if (next) commitRange(next);
      };

      const onPointerUp = () => {
        handleDragRef.current = null;
        setDragging(false);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [active, commitRange],
  );

  return { active, selection, handles, dragging, clear, onHandlePointerDown };
}
