import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Portal boundary tests intentionally exercise the production-strength scrypt settings.
    // Shared Windows runners can take more than Vitest's generic five-second default while
    // competing for CPU, so give security integration tests a deliberate cross-platform budget.
    testTimeout: 20_000,
    hookTimeout: 10_000,
  },
});
