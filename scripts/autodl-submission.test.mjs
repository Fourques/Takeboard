import assert from "node:assert/strict";
import test from "node:test";
import { submitOnce } from "../deploy/autodl/submission-recovery.mjs";

const expected = { shotId: "shot", recipePath: "custom/video.json", seed: 42 };
const run = {
  id: "run",
  shotId: "shot",
  parameters: { recipePath: expected.recipePath, seed: 42 },
};
test("lost acknowledgements recover the persisted run without a second submission", async () => {
  const record = {};
  let submits = 0;
  const runs = [];
  const persist = async () => {};
  const submit = async () => {
    submits++;
    runs.push(run);
    throw new Error("response lost");
  };
  await assert.rejects(submitOnce(record, runs, expected, persist, submit), /response lost/);
  assert.ok(record.submissionIntent);
  assert.equal(await submitOnce(record, runs, expected, persist, submit), "run");
  assert.equal(await submitOnce(record, runs, expected, persist, submit), "run");
  assert.equal(submits, 1);
});
test("unconfirmed or ambiguous requests fail closed rather than silently spending GPU time", async () => {
  const submit = async () => {
    throw new Error("must not submit");
  };
  for (const runs of [
    [],
    [{ ...run, shotId: "other" }],
    [{ ...run, parameters: { ...run.parameters, seed: 43 } }],
  ])
    await assert.rejects(
      submitOnce({ submissionIntent: expected }, runs, expected, async () => {}, submit),
      /未重新生成/,
    );
  await assert.rejects(
    submitOnce(
      { submissionIntent: expected },
      [run, { ...run, id: "other-run" }],
      expected,
      async () => {},
      submit,
    ),
    /多条/,
  );
});
test("intent must persist before submission; baseline tasks cannot be mistaken for its acknowledgement", async () => {
  let submits = 0;
  const submit = async () => {
    submits++;
    return { runId: "new-run" };
  };
  await assert.rejects(
    submitOnce(
      {},
      [],
      expected,
      async () => {
        throw new Error("disk full");
      },
      submit,
    ),
    /disk full/,
  );
  assert.equal(submits, 0);
  await assert.rejects(
    submitOnce(
      { submissionIntent: { ...expected, baselineRunIds: ["run"] } },
      [run],
      expected,
      async () => {},
      submit,
    ),
    /未重新生成/,
  );
  const record = {};
  assert.equal(await submitOnce(record, [], expected, async () => {}, submit), "new-run");
  assert.equal(submits, 1);
});
