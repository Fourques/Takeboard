// Optional UI preferences must not make a project inaccessible. Do not use this
// fallback for project data, credentials, or anything that requires durable storage.
function optionalStorage(kind: "localStorage" | "sessionStorage") {
  const memory = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      try {
        return window[kind].getItem(key) ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      try {
        window[kind].setItem(key, value);
      } catch {
        /* Keep session behavior. */
      }
    },
    removeItem(key: string) {
      memory.delete(key);
      try {
        window[kind].removeItem(key);
      } catch {
        /* Optional preference. */
      }
    },
  };
}
export const optionalLocalStorage = optionalStorage("localStorage");
export const optionalSessionStorage = optionalStorage("sessionStorage");
