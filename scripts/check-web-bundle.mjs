import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const indexHtml = await readFile(resolve(dist, "index.html"), "utf8");
const initialResources = new Set(
  [...indexHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) =>
    match[1].replace(/^\//, ""),
  ),
);
const assets = await readdir(resolve(dist, "assets"));
const measurements = await Promise.all(
  assets
    .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
    .map(async (name) => ({ name, size: (await stat(resolve(dist, "assets", name))).size })),
);
const initialBytes = measurements
  .filter((item) => initialResources.has(`assets/${item.name}`))
  .reduce((total, item) => total + item.size, 0);
const largest = measurements.reduce(
  (current, item) => (item.size > current.size ? item : current),
  {
    name: "none",
    size: 0,
  },
);

const initialBudget = 900 * 1024;
const lazyChunkBudget = 950 * 1024;
const cssBudget = 260 * 1024;
const cssBytes = measurements
  .filter((item) => item.name.endsWith(".css"))
  .reduce((total, item) => total + item.size, 0);
const problems = [];
if (initialBytes > initialBudget) {
  problems.push(`initial JS/CSS is ${(initialBytes / 1024).toFixed(1)} KiB (budget 900 KiB)`);
}
if (largest.size > lazyChunkBudget) {
  problems.push(`largest chunk ${largest.name} is ${(largest.size / 1024).toFixed(1)} KiB`);
}
if (cssBytes > cssBudget) {
  problems.push(`total CSS is ${(cssBytes / 1024).toFixed(1)} KiB (budget 260 KiB)`);
}
if (problems.length)
  throw new Error(`TakeBoard web performance budget failed: ${problems.join("; ")}`);

console.log(
  `TakeBoard web budget: initial ${(initialBytes / 1024).toFixed(1)} KiB, largest ${largest.name} ${(largest.size / 1024).toFixed(1)} KiB, CSS ${(cssBytes / 1024).toFixed(1)} KiB`,
);
