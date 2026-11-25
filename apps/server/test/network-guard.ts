/** Fail closed if a fixture loses its fetch mock, including during teardown. */
export function loopbackOnlyFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new TypeError(`Server tests block unmocked external fetch to ${url.hostname}`);
    }
    return fetcher(input, init);
  };
}
