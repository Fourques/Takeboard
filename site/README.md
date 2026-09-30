# Public website maintenance

The site deploys only public marketing content to https://fourques.github.io/Takeboard/ through `public-site.yml`. It does not run the application or copy project data.

Sources: `product.json` for public release facts, `content.mjs` for bilingual page text, `style.css` for presentation, and `docs/media-kit.md` for reusable editorial materials. The builder checks the existing demo manifest and hashes before copying the explicitly listed images/video. Generated output is ignored under `dist/site`.

Run:

```sh
node --test scripts/build-public-site.test.mjs
node scripts/build-public-site.mjs
```

The workflow creates `takeboard-media-kit.zip` from an explicit file list. Do not zip the repository or a user's workspace. No application dependency installation is required for publishing.

On a public release, update the product version and release evidence, review both languages and the media kit, and check installer links. Do not automatically equate main's version with a published installer. On a new demo, review provenance, visual disclosures and the manifest before updating product facts. Never remove simulated-output warnings without genuine generation evidence.

The IndexNow key is a publicly served ownership-validation file, not an app credential. Its location limits submissions to `/Takeboard/`. A notification is not indexing or endorsement. Do not submit on every test or automate repetitive notifications. Domain-root robots rules cannot be configured from a project subdirectory.

No analytics scripts, hidden AI instructions, claimed ratings, invented testimonials, or crawler-only alternate content. The builder includes the owner's public Google Search Console verification tag in both language pages. Keep this tag across deployments: Google periodically rechecks ownership. Publishing the tag does not complete account verification or prove indexing; the owner must finish verification in Search Console. Bing account verification is not configured.
