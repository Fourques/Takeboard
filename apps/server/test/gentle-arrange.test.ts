import { describe, expect, it } from "vitest";
import { gentlyArrange } from "../src/gentle-arrange.js";

describe("gentle canvas arrangement", () => {
  it("keeps spaced nodes in their existing regions and aligns only nearby axes", () => {
    const items = [
      { id: "a", x: 100, y: 100, width: 470, height: 264 },
      { id: "b", x: 900, y: 112, width: 470, height: 264 },
      { id: "c", x: -500, y: 800, width: 200, height: 300 },
    ];
    expect([...gentlyArrange(items)]).toEqual([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 900, y: 100 }],
      ["c", { x: -500, y: 800 }],
    ]);
    expect(items[1]?.y).toBe(112);
  });
  it("separates overlapping actual media bounds and is idempotent", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      x: 100 + index * 10,
      y: 100 + index * 10,
      width: index % 2 ? 470 : 280,
      height: index % 2 ? 650 : 220,
    }));
    const result = gentlyArrange(items);
    const placed = items.map((item) => ({ ...item, ...result.get(item.id) }));
    for (const a of placed)
      for (const b of placed) {
        if (a.id === b.id) continue;
        expect(
          a.x + a.width + 32 <= b.x ||
            b.x + b.width + 32 <= a.x ||
            a.y + a.height + 32 <= b.y ||
            b.y + b.height + 32 <= a.y,
        ).toBe(true);
      }
    expect(gentlyArrange(placed)).toEqual(result);
  });
});
