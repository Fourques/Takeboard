/** Persist intent before sending. Lost acknowledgements never authorize another paid run. */
export async function submitOnce(record, runs, expected, persist, submit) {
  if (record.runId) return record.runId;
  const baseline = record.submissionIntent?.baselineRunIds;
  const candidates = runs.filter(
    (run) =>
      run.shotId === expected.shotId &&
      run.parameters.recipePath === expected.recipePath &&
      run.parameters.seed === expected.seed &&
      (!Array.isArray(baseline) || !baseline.includes(run.id)),
  );
  if (candidates.length > 1) throw new Error("找到多条可能的验收任务，请人工核对；未重新生成");
  if (candidates.length === 1) {
    record.runId = candidates[0].id;
    await persist();
    return record.runId;
  }
  if (record.submissionIntent)
    throw new Error("上次提交结果尚未确认，请检查任务与日志后再恢复；未重新生成");
  record.submissionIntent = {
    ...expected,
    baselineRunIds: runs.map((run) => run.id),
    recordedAt: new Date().toISOString(),
  };
  await persist();
  const result = await submit();
  if (typeof result.runId !== "string" || !result.runId)
    throw new Error("提交回执缺少任务标识；未重新生成");
  record.runId = result.runId;
  await persist();
  return record.runId;
}
