import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node resolves module URLs through symlinks, while argv keeps the caller's path.
// macOS /tmp -> /private/tmp and directory junctions must still run the CLI.
export function isMainModule(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
