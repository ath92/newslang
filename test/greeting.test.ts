import { describe, expect, it } from "vitest";
import { greeting } from "../src/greeting";

describe("greeting", () => {
  it("says hello world", () => {
    expect(greeting).toBe("hello world");
  });
});
