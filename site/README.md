# Public website maintenance

The site deploys only public marketing content to https://fourques.github.io/Takeboard/ through `public-site.yml`. It does not run the application or copy project data.

Sources: `product.json` for public release facts, `content.mjs` for bilingual page text, `presentation.mjs` for shared markup and line icons, `director-board.mjs` for the shared product object, `director-view.mjs` for optional rotation, `style.css` for presentation, and `docs/media-kit.md` for reusable editorial materials. The builder checks the existing demo manifest and hashes before copying the explicitly listed images/video. Generated output is ignored under `dist/site`.

Run:

```sh
node --test scripts/build-public-site.test.mjs
node scripts/build-public-site.mjs
node scripts/check-public-site-browser.mjs --local
node scripts/check-public-site-browser.mjs
```

The workflow creates `takeboard-media-kit.zip` from an explicit file list. Do not zip the repository or a user's workspace. No application dependency installation is required for publishing.

The optional browser check needs the project's Playwright and axe dependencies and Chromium. `--local` routes public URLs to the local build without starting a server; without the flag it checks the deployed site. It covers both languages and guides at 320, 390, 768, 1280 and 1440px; also 200% text enlargement, internal anchors, download/guide/language navigation, keyboard FAQ operation, actual video playback and automated WCAG A/AA checks. Screenshots go to a temporary directory. It does not download installers, touch app data or run generation. It is not part of the lightweight Pages build. Automated checks supplement, not replace, visual review and assistive-technology testing.

## Design direction

Keep the category explicit: **an open-source AI creation canvas built on ComfyUI**. The editorial headline adds character; the surrounding copy must still explain image/video creation, connected media and workflows. Do not shift the product back to an asset manager or imply one-click execution of an entire graph.

The website follows the app's default Chroma theme in `apps/web/src/styles.css`: cool near-white surfaces, graphite text, restrained violet accents. Gold remains only in the existing app mark. Do not introduce a separate warm-paper/brass brand or multicolor wash around the product screenshots. Small line icons use the same stroke weight and only support useful actions.

The hero adopts the director-board motif from `apps/web/src/studio-universe.tsx`, with actual disclosed demo captures on both faces. CSS 3D transforms keep the UI images crisp without loading WebGL or a second application. Drag horizontally to rotate through 360°, or use the discreet flip button; keyboard arrows, Enter and Escape work too. Vertical touch scrolling and pinch zoom stay native. No automatic rotation, scroll capture, reset buttons or decorative numbering. Purely decorative study captions and repeated section labels are removed; the product category and simulated-demo disclosure remain.

The page moves from idea → canvas → workflow choice → interaction demo → downloads → getting started. Supporting requirements belong near download and FAQ; diagnostics and architecture belong in documentation. The three platform groups expose actual installers rather than sending users to an undifferentiated release asset list.

Research references (design principles, not copy or product comparisons):

- [Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui): reduce chrome noise, align related controls, and stress-test density and viewport sizes.
- [Framer](https://www.framer.com/): lead with a clear visual proposition, then progress to practical entry points and resources.
- [Krea's realtime editing introduction](https://www.krea.ai/blog/realtime-edit): demonstrate a creative action and its result rather than lead with implementation terminology.

All content remains server-rendered HTML. One small, dependency-free module enhances only the director board, with no timers, network requests, persistence or wheel listeners. Without JavaScript the front image, all text, navigation and downloads remain available. There is no framework bundle, remote font, analytics, scroll hijacking or autoplay. Button/keyboard flips use a brief transition; direct dragging and reduced-motion mode do not. Existing canonical URLs, language alternatives, Google verification and the sitemap stay intact. This is an indexing foundation, not a promise of ranking or AI recommendations.

`node scripts/render-site-share-card.mjs` regenerates the 1200×630 social PNG from the same director-board component, website CSS and existing demo screenshots using Chromium. The obsolete ring illustration is removed from source and the media ZIP. The share image is a composed product preview with simulated results, not evidence of model quality. Keep its demo disclosure and the original screenshots' provenance labels.

The browser acceptance script also checks a complete drag rotation, front/back switching, keyboard handling, real touch pointer capture, native vertical touch scrolling, wheel scrolling over the board and no-JavaScript fallback. It does not substitute for a physical iPhone/Safari or Mac hardware test.

On a public release, update the product version and release evidence, review both languages and the media kit, and check installer links. Do not automatically equate main's version with a published installer. On a new demo, review provenance, visual disclosures and the manifest before updating product facts. Never remove simulated-output warnings without genuine generation evidence.

The site test also checks that both READMEs, the media kit and both download guides advertise this same release. Confirm the release is published and all six installer assets are uploaded before editing `product.json`; the test checks consistency, not GitHub availability. Keep historical release notes, promotion baselines and the recorded demo's application version unchanged.

`node scripts/promotion-snapshot.mjs` reads the advertised release from `product.json`, reports downloads per published installer release (up to the 100 most recent GitHub releases), and flags a newer installer release missing from the public entrypoint. Traffic includes the returned date range and referrers. Directory inclusion is checked against the actual README; a closed issue is not enough. Unavailable data stays null. This is a read-only snapshot, not a user-tracking service or proof that downloads came from a particular channel.

`product.json` lists the six actual installer filenames for the public release; the homepage links directly to them, with installation guidance alongside. The builder rejects a filename from a different version. Validate each filename against GitHub Release assets before changing it.

The English and Chinese practical guide under `guides/organize-comfyui-results/` is authored in `content.mjs`, linked from each homepage and included in the sitemap. Keep it a useful first-session tutorial rather than keyword-only duplicate pages. Its development screenshots remain explicitly labeled as simulated.

The IndexNow key is a publicly served ownership-validation file, not an app credential. Its location limits submissions to `/Takeboard/`. A notification is not indexing or endorsement. Do not submit on every test or automate repetitive notifications. Domain-root robots rules cannot be configured from a project subdirectory.

No analytics scripts, hidden AI instructions, claimed ratings, invented testimonials, or crawler-only alternate content. The builder includes the owner's public Google Search Console verification tag in both language pages. Keep this tag across deployments: Google periodically rechecks ownership. Publishing the tag does not complete account verification or prove indexing; the owner must finish verification in Search Console. Bing account verification is not configured.
