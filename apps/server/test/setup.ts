import { loopbackOnlyFetch } from "./network-guard.js";

// Tests may replace fetch with their fixtures. Restoring globals restores this
// guard, so background cleanup cannot leak requests to placeholder hosts.
globalThis.fetch = loopbackOnlyFetch(globalThis.fetch);
