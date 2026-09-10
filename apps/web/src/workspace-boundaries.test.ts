import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// A source-boundary regression tripwire, not a substitute for behavioral tests.
it("App cannot own selection/generation state or directly call generation services", () => {
  const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const ownedState = [
    ...source.matchAll(
      /const\s+(\[[^\]]+\]|\w+)\s*=\s*(?:useState|useReducer|useRef)(?:<[^;]+?>)?\s*\(/g,
    ),
  ]
    .map((match) => match[1])
    .filter((name) =>
      /selected(Shot|CanvasItem|Edge)|inspectorOpen|canvasContextMenu|generation|candidateCount|worker|workflow/i.test(
        name ?? "",
      ),
    );
  expect(ownedState).toEqual([]);
  expect(source).not.toMatch(
    /\bprojectApi\.(?:generate|run|transfer|cancelRun|worker|startWorker)\s*\(/,
  );
  expect(source).not.toMatch(/\bworkflowApi\.|\bdemoApi\.generate\s*\(/);
  expect(source).not.toMatch(
    /from ["']\.\/(?:use-run-recovery|generation-session|model-profiles)["']/,
  );
});
