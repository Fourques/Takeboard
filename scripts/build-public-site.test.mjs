import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSite, escapeHtml } from "./build-public-site.mjs";

test("public site is static, bilingual, evidence-linked and limited to public assets", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "takeboard-public-site-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const { product, urls } = await buildSite(output);
  assert.equal(urls.length, 2);
  const allowed = [
    ".nojekyll",
    "490fbc8f5dd846d3b1e7c9a067c0efae.txt",
    "index.html",
    "media",
    "product.json",
    "sitemap.xml",
    "style.css",
    "zh",
  ];
  assert.deepEqual((await readdir(output)).sort(), allowed.sort());
  for (const [file, lang, url] of [
    ["index.html", "en", urls[0]],
    ["zh/index.html", "zh-CN", urls[1]],
  ]) {
    const html = await readFile(join(output, file), "utf8");
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
    const head = html.match(/<head>(.*?)<\/head>/s)[1];
    assert.equal((html.match(/name="google-site-verification"/g) ?? []).length, 1);
    assert.ok(head.includes('<meta name="google-site-verification" content="p9K6gs2ufn_xckxL_UKIuCShYn1gYmtibd3vjU6xJNM">'));
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.equal((html.match(/<details>/g) ?? []).length, 6);
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    assert.ok(!html.includes("noindex"));
    assert.ok(!html.includes("autoplay"));
    const schema = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
    );
    assert.equal(schema.name, "TakeBoard");
    assert.equal(schema.softwareVersion, product.publicVersion);
    assert.equal(schema.aggregateRating, undefined);
    assert.ok(html.includes(product.evidence.compatibility));
    assert.ok(html.includes("takeboard-media-kit.zip"));
    for (const match of html.matchAll(
      /(?:href|src)="(https:\/\/fourques\.github\.io\/Takeboard\/[^"#]*)"/g,
    )) {
      const relative = match[1].slice(product.website.length);
      if (relative.endsWith(".zip")) continue; // Assembled and tested separately with zip in the publishing workflow.
      await readFile(
        join(output, relative.endsWith("/") || !relative ? `${relative}index.html` : relative),
      );
    }
  }
  const kit = await readFile(join(output, "media/README.md"), "utf8");
  assert.ok(kit.includes("https://github.com/Fourques/Takeboard/blob/main/docs/downloads.md"));
  assert.ok(kit.includes("https://github.com/Fourques/Takeboard/blob/main/LICENSE"));
  assert.ok(kit.includes("SIMULATED OUTPUTS"));
  assert.equal(product.demo.realGpu, false);
  assert.equal(product.arbitraryWorkflowCompatibilityGuaranteed, false);
  assert.ok((await readFile(join(output, "sitemap.xml"), "utf8")).includes(urls[1]));
});

test("text and attributes are escaped, not interpreted as HTML", () => {
  assert.equal(
    escapeHtml('<a href="x">&\'</a>'),
    "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
  );
});
