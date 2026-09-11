import { describe, expect, it } from "vitest";
import { canvasPlacement } from "./canvas-placement";

describe("visible canvas placement", () => {
  it("uses flow coordinates after panning and avoids existing components", () => {
    const view = { x: -2000, y: 700, width: 1200, height: 800 };
    const occupied = [{ x: -1700, y: 900, width: 470, height: 300 }];
    const point = canvasPlacement(view, occupied, 300, 250);
    expect(point.x).toBeGreaterThanOrEqual(view.x);
    expect(point.y).toBeGreaterThanOrEqual(view.y);
    expect(point.x + 300).toBeLessThanOrEqual(view.x + view.width);
    expect(point.y + 250).toBeLessThanOrEqual(view.y + view.height);
    const r = occupied[0];
    if (!r) throw new Error("Missing fixture");
    expect(
      point.x + 300 <= r.x ||
        point.x >= r.x + r.width ||
        point.y + 250 <= r.y ||
        point.y >= r.y + r.height,
    ).toBe(true);
  });
  it("keeps the start visible when the view is smaller than a component", () => {
    expect(canvasPlacement({ x: 10, y: 20, width: 100, height: 80 }, [], 470, 300)).toEqual({
      x: 10,
      y: 20,
    });
  });
});
