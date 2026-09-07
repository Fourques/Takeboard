/** Submit in order so each request sees the revision returned by its predecessor.
 * Never retry an ambiguous submission automatically: it may already consume GPU time.
 */
export async function submitCandidates<T, R>(
  candidates: readonly T[],
  submit: (candidate: T, index: number) => Promise<R>,
  isCurrent: () => boolean = () => true,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!isCurrent()) break;
    try {
      results.push({ status: "fulfilled", value: await submit(candidate, index) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
      // Refresh/review the project before submitting any remaining candidates.
      break;
    }
  }
  return results;
}
