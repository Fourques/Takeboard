# Public website maintenance

The site deploys only public marketing content to https://fourques.github.io/Takeboard/ through `public-site.yml`. It does not run the application or copy project data.

Sources: `product.json` for public release facts, `content.mjs` for bilingual page text, `presentation.mjs` for shared markup and original line icons, `style.css` for presentation, `assets/` for original brand artwork, and `docs/media-kit.md` for reusable editorial materials. The builder checks the existing demo manifest and hashes before copying the explicitly listed images/video. Generated output is ignored under `dist/site`.

Run:

```sh
node --test scripts/build-public-site.test.mjs
node scripts/build-public-site.mjs
node scripts/check-public-site-browser.mjs --local
node scripts/check-public-site-browser.mjs
```

The workflow creates `takeboard-media-kit.zip` from an explicit file list. Do not zip the repository or a user's workspace. No application dependency installation is required for publishing.

The optional browser check needs the project's Playwright and axe dependencies and Chromium. `--local` routes public URLs to the local build without starting a server; without the flag it checks the deployed site. It covers both languages and guides at 320, 390, 768, 1280 and 1440px; also 200% text enlargement, internal anchors, download/guide/language navigation, keyboard FAQ operation, actual video playback and automated WCAG A/AA checks. Screenshots go to a temporary directory. It does not download installers, touch app data or run generation. It is not part of the lightweight Pages build. Automated checks supplement, not replace, visual review and assistive-technology testing.

## Design direction — creator's light table

Keep the category explicit: **an open-source AI creation canvas built on ComfyUI**. The editorial headline adds character; the surrounding copy must still explain image/video creation, connected media and workflows. Do not shift the product back to an asset manager or imply one-click execution of an entire graph.

The palette uses warm paper, ink and a brass accent drawn from the existing slate-shaped app mark. Connected frames are the visual motif. The original SVG illustration gives the site an identity without pretending to show generated work. Small, consistent line icons support navigation; they do not replace readable labels. The existing app icon is unchanged.

The page moves from idea → canvas → workflow choice → interaction demo → downloads → getting started. Supporting requirements belong near download and FAQ; diagnostics and architecture belong in documentation. The three platform groups expose actual installers rather than sending users to an undifferentiated release asset list.

Research references (design principles, not copy or product comparisons):

- [Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui): reduce chrome noise, align related controls, and stress-test density and viewport sizes.
- [Framer](https://www.framer.com/): lead with a clear visual proposition, then progress to practical entry points and resources.
- [Krea's realtime editing introduction](https://www.krea.ai/blog/realtime-edit): demonstrate a creative action and its result rather than lead with implementation terminology.

Our implementation stays static: no framework bundle, remote fonts, analytics, scroll hijacking or autoplay. Reduced-motion preferences, visible keyboard focus and text resizing are supported. Existing canonical URLs, language alternatives, Google verification and the sitemap stay intact; schema and sharing metadata are derived from the same public facts. This is an indexing foundation, not a promise of ranking or AI recommendations.

`node scripts/render-site-share-card.mjs` regenerates the 1200×630 social PNG from the original SVG and app mark using Chromium. The SVG and PNG are brand artwork, not a product screenshot or model output. Both ship in the explicit public media ZIP; do not remove the separate demo provenance labels.

On a public release, update the product version and release evidence, review both languages and the media kit, and check installer links. Do not automatically equate main's version with a published installer. On a new demo, review provenance, visual disclosures and the manifest before updating product facts. Never remove simulated-output warnings without genuine generation evidence.

`product.json` lists the six actual installer filenames for the public release; the homepage links directly to them, with installation guidance alongside. The builder rejects a filename from a different version. Validate each filename against GitHub Release assets before changing it.

The English and Chinese practical guide under `guides/organize-comfyui-results/` is authored in `content.mjs`, linked from each homepage and included in the sitemap. Keep it a useful first-session tutorial rather than keyword-only duplicate pages. Its development screenshots remain explicitly labeled as simulated.

The IndexNow key is a publicly served ownership-validation file, not an app credential. Its location limits submissions to `/Takeboard/`. A notification is not indexing or endorsement. Do not submit on every test or automate repetitive notifications. Domain-root robots rules cannot be configured from a project subdirectory.

No analytics scripts, hidden AI instructions, claimed ratings, invented testimonials, or crawler-only alternate content. The builder includes the owner's public Google Search Console verification tag in both language pages. Keep this tag across deployments: Google periodically rechecks ownership. Publishing the tag does not complete account verification or prove indexing; the owner must finish verification in Search Console. Bing account verification is not configured.
