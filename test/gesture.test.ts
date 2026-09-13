import { describe, expect, it } from "vitest";
import { initialGestureState, reduceGesture, type GestureState } from "../src/selection/gesture";

/** Feed a list of events through the reducer and collect the intents. */
function run(events: Parameters<typeof reduceGesture>[1][]): ReturnType<typeof reduceGesture>[] {
  let state: GestureState = initialGestureState();
  return events.map((event) => {
    const result = reduceGesture(state, event);
    state = result.state;
    return result;
  });
}

describe("reduceGesture", () => {
  it("resolves a quick press as a tap", () => {
    const [down, up] = run([
      { type: "down", x: 100, y: 100, t: 0 },
      { type: "up", t: 120 },
    ]);
    expect(down.intent).toEqual({ type: "none" });
    expect(up.intent).toEqual({ type: "tap", x: 100, y: 100 });
    expect(up.state.mode).toBe("idle");
  });

  it("upgrades a second quick tap to a double tap", () => {
    const [, , , up] = run([
      { type: "down", x: 100, y: 100, t: 0 },
      { type: "up", t: 100 },
      { type: "down", x: 104, y: 103, t: 250 },
      { type: "up", t: 340 },
    ]);
    expect(up.intent).toEqual({ type: "doubleTap", x: 104, y: 103 });
  });

  it("does not treat a slow second press as a double tap", () => {
    const [, , , up] = run([
      { type: "down", x: 100, y: 100, t: 0 },
      { type: "up", t: 100 },
      { type: "down", x: 100, y: 100, t: 900 },
      { type: "up", t: 980 },
    ]);
    expect(up.intent).toEqual({ type: "tap", x: 100, y: 100 });
  });

  it("enters drag mode when the finger dwells", () => {
    const [down, dwell, move, up] = run([
      { type: "down", x: 50, y: 60, t: 0 },
      { type: "dwell" },
      { type: "move", x: 140, y: 70 },
      { type: "up", t: 700 },
    ]);
    expect(down.intent).toEqual({ type: "none" });
    expect(dwell.intent).toEqual({ type: "enterDrag", x: 50, y: 60 });
    expect(dwell.state.mode).toBe("dragging");
    expect(move.intent).toEqual({ type: "updateDrag", x: 140, y: 70 });
    expect(up.intent).toEqual({ type: "finalizeDrag" });
    expect(up.state.mode).toBe("idle");
  });

  it("aborts to a scroll when the finger moves before the dwell", () => {
    const move = run([
      { type: "down", x: 50, y: 60, t: 0 },
      { type: "move", x: 50, y: 140 },
    ])[1];
    expect(move.intent).toEqual({ type: "abort" });
    expect(move.state.mode).toBe("idle");
  });

  it("ignores small jitter while pending", () => {
    const move = run([
      { type: "down", x: 50, y: 60, t: 0 },
      { type: "move", x: 54, y: 63 },
    ])[1];
    expect(move.intent).toEqual({ type: "none" });
    expect(move.state.mode).toBe("pending");
  });
});
