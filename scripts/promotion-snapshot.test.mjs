import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDownloads } from "./promotion-snapshot.mjs";

test("installer downloads exclude demo and source assets", () => {
  const result = summarizeDownloads([
    { name: "app.dmg", download_count: 2 },
    { name: "app.exe", download_count: 0 },
    { name: "demo.mp4", download_count: 99 },
    { name: "source.zip", download_count: 8 },
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.installers.length, 2);
});

test("unavailable or invalid counts never become zero", () => {
  assert.equal(summarizeDownloads(undefined), null);
  assert.equal(summarizeDownloads([{ name: "app.deb" }]), null);
  assert.equal(summarizeDownloads([{ name: "app.deb", download_count: -1 }]), null);
  assert.equal(summarizeDownloads([{ name: "app.deb", download_count: "2" }]), null);
});
