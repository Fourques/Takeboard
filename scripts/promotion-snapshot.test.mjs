import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDownloads, summarizeReleases } from "./promotion-snapshot.mjs";

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
  assert.equal(summarizeDownloads([]), null);
  assert.equal(summarizeDownloads([{ name: "demo.webm", download_count: 3 }]), null);
  assert.equal(summarizeDownloads([{ name: "app.deb" }]), null);
  assert.equal(summarizeDownloads([{ name: "app.deb", download_count: -1 }]), null);
  assert.equal(summarizeDownloads([{ name: "app.deb", download_count: "2" }]), null);
});

test("release tracking includes published betas, sorts by publication and excludes drafts and media-only releases", () => {
  const release = (tag, date, assets, draft = false) => ({
    tag_name: tag,
    published_at: date,
    draft,
    assets,
    html_url: `https://github.com/Fourques/Takeboard/releases/tag/${tag}`,
  });
  const result = summarizeReleases([
    release("v0.2.0-beta.17", "2026-09-16T06:00:00Z", [{ name: "app.dmg", download_count: 2 }]),
    release(
      "v0.2.0-beta.99",
      "2026-10-03T06:00:00Z",
      [{ name: "app.exe", download_count: 10 }],
      true,
    ),
    release("media", "2026-10-02T06:00:00Z", [{ name: "demo.webm", download_count: 20 }]),
    release("v0.2.0-beta.18", "2026-09-30T06:00:00Z", [{ name: "app.exe", download_count: 0 }]),
  ]);
  assert.deepEqual(
    result.map((item) => item.tag),
    ["v0.2.0-beta.18", "v0.2.0-beta.17"],
  );
  assert.equal(result[0].downloads.total, 0);
  assert.equal(result[1].downloads.total, 2);
  assert.equal(summarizeReleases(null), null);
  assert.deepEqual(summarizeReleases([]), []);
});

test("a published release with unavailable download counts stays unknown", () => {
  const [release] = summarizeReleases([
    { tag_name: "v1", published_at: "2026-09-30T06:00:00Z", assets: [{ name: "app.dmg" }] },
  ]);
  assert.equal(release.downloads, null);
});
