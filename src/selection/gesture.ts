/**
 * Pure gesture recognizer for the custom touch selection engine.
 *
 * It resolves a single touch stream into exactly one of four outcomes:
 *   - tap        (quick down/up)          -> select the word under the finger
 *   - double-tap (two quick taps)         -> select the sentence
 *   - hold       (still down at holdDelay) -> seed a word and start drag-select
 *   - scroll     (moved past slop before hold) -> abandon, let the page scroll
 *
 * Keeping it free of DOM and timers makes the tricky disambiguation testable.
 * The engine owns the actual dwell timer and dispatches a `dwell` event.
 */

export interface GestureConfig {
  /** How long a finger must stay still before drag-select begins. */
  holdDelay: number;
  /** Maximum gap between two taps that counts as a double-tap. */
  doubleTapGap: number;
  /** Movement (px) before a pending press is treated as a scroll. */
  moveSlop: number;
  /** Maximum distance (px) between two taps that counts as a double-tap. */
  doubleTapSlop: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  holdDelay: 250,
  doubleTapGap: 300,
  moveSlop: 12,
  doubleTapSlop: 30,
};

export type GestureMode = "idle" | "pending" | "dragging";

export interface GestureState {
  mode: GestureMode;
  startX: number;
  startY: number;
  startT: number;
  lastTapX: number | null;
  lastTapY: number | null;
  lastTapT: number | null;
  doubleCandidate: boolean;
}

export function initialGestureState(): GestureState {
  return {
    mode: "idle",
    startX: 0,
    startY: 0,
    startT: 0,
    lastTapX: null,
    lastTapY: null,
    lastTapT: null,
    doubleCandidate: false,
  };
}

export type GestureEvent =
  | { type: "down"; x: number; y: number; t: number }
  | { type: "move"; x: number; y: number }
  | { type: "dwell" }
  | { type: "up"; t: number }
  | { type: "cancel" };

export type GestureIntent =
  | { type: "none" }
  | { type: "enterDrag"; x: number; y: number }
  | { type: "updateDrag"; x: number; y: number }
  | { type: "tap"; x: number; y: number }
  | { type: "doubleTap"; x: number; y: number }
  | { type: "finalizeDrag" }
  | { type: "abort" };

export interface GestureResult {
  state: GestureState;
  intent: GestureIntent;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function reduceGesture(
  state: GestureState,
  event: GestureEvent,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): GestureResult {
  switch (event.type) {
    case "down": {
      if (state.mode === "dragging") return { state, intent: { type: "none" } };
      const doubleCandidate =
        state.lastTapX !== null &&
        state.lastTapY !== null &&
        state.lastTapT !== null &&
        event.t - state.lastTapT <= config.doubleTapGap &&
        distance(event.x, event.y, state.lastTapX, state.lastTapY) <= config.doubleTapSlop;
      return {
        state: {
          ...state,
          mode: "pending",
          startX: event.x,
          startY: event.y,
          startT: event.t,
          doubleCandidate,
        },
        intent: { type: "none" },
      };
    }

    case "move": {
      if (state.mode === "pending") {
        if (distance(event.x, event.y, state.startX, state.startY) > config.moveSlop) {
          return {
            state: { ...state, mode: "idle", doubleCandidate: false, lastTapT: null },
            intent: { type: "abort" },
          };
        }
        return { state, intent: { type: "none" } };
      }
      if (state.mode === "dragging") {
        return { state, intent: { type: "updateDrag", x: event.x, y: event.y } };
      }
      return { state, intent: { type: "none" } };
    }

    case "dwell": {
      if (state.mode === "pending") {
        return {
          state: { ...state, mode: "dragging", doubleCandidate: false, lastTapT: null },
          intent: { type: "enterDrag", x: state.startX, y: state.startY },
        };
      }
      return { state, intent: { type: "none" } };
    }

    case "up": {
      if (state.mode === "pending") {
        if (state.doubleCandidate) {
          return {
            state: {
              ...state,
              mode: "idle",
              doubleCandidate: false,
              lastTapX: null,
              lastTapY: null,
              lastTapT: null,
            },
            intent: { type: "doubleTap", x: state.startX, y: state.startY },
          };
        }
        return {
          state: {
            ...state,
            mode: "idle",
            doubleCandidate: false,
            lastTapX: state.startX,
            lastTapY: state.startY,
            lastTapT: event.t,
          },
          intent: { type: "tap", x: state.startX, y: state.startY },
        };
      }
      if (state.mode === "dragging") {
        return { state: { ...state, mode: "idle" }, intent: { type: "finalizeDrag" } };
      }
      return { state, intent: { type: "none" } };
    }

    case "cancel": {
      if (state.mode === "dragging") {
        return { state: { ...state, mode: "idle" }, intent: { type: "finalizeDrag" } };
      }
      if (state.mode === "pending") {
        return {
          state: { ...state, mode: "idle", doubleCandidate: false },
          intent: { type: "abort" },
        };
      }
      return { state, intent: { type: "none" } };
    }
  }
}
