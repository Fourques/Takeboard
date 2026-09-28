# Dependency patches

## better-sqlite3 13.0.3

pnpm 10.15.1 synthesizes `node-gyp rebuild` for packages containing binding.gyp,
even though this package declares `gypfile: false` and ships N-API prebuilds.
On Windows this requires Visual Studio before the prebuild check can run.

The explicit install hook loads the upstream host prebuild to validate it. If no
prebuild exists, it retains the upstream node-gyp fallback. It does not ignore
load failures or disable native dependency checks. Database operations are still
covered by the full tests and installed-runtime checks on each platform.

Remove this patch when the pinned package manager or upstream install hook handles
this case correctly. Do not replace it with a blanket ignore-scripts option.
