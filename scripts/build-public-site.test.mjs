import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSite, escapeHtml, installerUrl } from "./build-public-site.mjs";

test("public site is static, bilingual, evidence-linked and limited to public assets", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "takeboard-public-site-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const { product, urls } = await buildSite(output);
  assert.equal(urls.length, 4);
  const socialCard = await readFile(join(output, "media/takeboard-social.png"));
  assert.equal(socialCard.subarray(1, 4).toString(), "PNG");
  assert.equal(socialCard.readUInt32BE(16), 1200);
  assert.equal(socialCard.readUInt32BE(20), 630);
  const allowed = [
    ".nojekyll",
    "490fbc8f5dd846d3b1e7c9a067c0efae.txt",
    "index.html",
    "guides",
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
    assert.ok(
      head.includes(
        '<meta name="google-site-verification" content="p9K6gs2ufn_xckxL_UKIuCShYn1gYmtibd3vjU6xJNM">',
      ),
    );
    assert.equal((html.match(/<h1(?:\s[^>]*)?>/g) ?? []).length, 1);
    assert.equal((html.match(/<details>/g) ?? []).length, 6);
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    assert.ok(!html.includes("noindex"));
    assert.ok(!html.includes("autoplay"));
    const schema = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
    );
    assert.equal(schema.name, "TakeBoard");
    assert.equal(schema.url, url);
    assert.equal(schema.inLanguage, lang);
    assert.ok(!html.includes("undefined"));
    for (const section of ["canvas", "workflows", "demo", "download", "media-kit"]) {
      assert.equal((html.match(new RegExp(`id="${section}"`, "g")) ?? []).length, 1);
    }
    assert.ok(html.includes('class="site-header"'));
    assert.ok(html.includes('class="site-footer"'));
    assert.equal(schema.softwareVersion, product.publicVersion);
    assert.equal(schema.aggregateRating, undefined);
    assert.ok(head.includes('property="og:image:width" content="1200"'));
    assert.ok(head.includes(`${product.website}media/takeboard-social.png`));
    assert.ok(html.includes(product.evidence.compatibility));
    assert.ok(html.includes("takeboard-media-kit.zip"));
    assert.ok(html.includes('href="#download"'));
    assert.ok(html.includes('id="download"'));
    assert.equal((html.match(/class="download-card"/g) ?? []).length, 6);
    for (const installer of product.installers) {
      assert.ok(html.includes(`href="${installerUrl(product, installer.file)}"`));
    }
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

test("practical guides are bilingual, linked, indexed and preserve their evidence boundaries", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "takeboard-guide-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const { product, urls } = await buildSite(output);
  const sitemap = await readFile(join(output, "sitemap.xml"), "utf8");
  for (const [url, lang, home] of [
    [urls[2], "en", urls[0]],
    [urls[3], "zh-CN", urls[1]],
  ]) {
    const html = await readFile(
      join(output, url.slice(product.website.length), "index.html"),
      "utf8",
    );
    const homepage = await readFile(
      join(output, home.slice(product.website.length), "index.html"),
      "utf8",
    );
    assert.ok(homepage.includes(`href="${url}"`));
    assert.ok(sitemap.includes(`<loc>${url}</loc>`));
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
    for (const alternate of urls.slice(2)) assert.ok(html.includes(`href="${alternate}"`));
    assert.ok(html.match(/<head>(.*?)<\/head>/s)[1].includes('name="google-site-verification"'));
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.equal((html.match(/class="guide-step"/g) ?? []).length, 4);
    assert.ok(html.includes(`href="${home}#download"`));
    assert.ok(html.includes("template=first_try.yml"));
    assert.ok(html.includes("beta.17"));
    assert.ok(html.includes(lang === "en" ? "simulated" : "模拟"));
    assert.ok(html.includes(lang === "en" ? "not execution support" : "不等于执行支持"));
    assert.ok(!html.includes("noindex"));
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    const schema = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
    );
    assert.equal(schema["@type"], "TechArticle");
    assert.equal(schema.url, url);
    assert.equal(schema.author.url, product.repository);
    for (const link of html.matchAll(
      /(?:href|src)="(https:\/\/fourques\.github\.io\/Takeboard\/[^"#]*)"/g,
    )) {
      const relative = link[1].slice(product.website.length);
      await readFile(
        join(output, relative.endsWith("/") || !relative ? `${relative}index.html` : relative),
      );
    }
  }
});

test("installer links cannot silently point to main, another version or an injected path", () => {
  const product = {
    publicVersion: "0.2.0-beta.17",
    repository: "https://github.com/Fourques/Takeboard",
  };
  assert.equal(
    installerUrl(product, "TakeBoard_0.2.0-beta.17_x64-setup.exe"),
    "https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.17/TakeBoard_0.2.0-beta.17_x64-setup.exe",
  );
  for (const file of [
    "TakeBoard_0.2.0-beta.18_x64-setup.exe",
    "../private.exe",
    'TakeBoard_0.2.0-beta.17_x64.dmg" onclick="x',
    "https://example.com/app.dmg",
  ]) {
    assert.throws(() => installerUrl(product, file), /public release/);
  }
});

test("text and attributes are escaped, not interpreted as HTML", () => {
  assert.equal(
    escapeHtml('<a href="x">&\'</a>'),
    "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
  );
});
