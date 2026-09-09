import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapCommand, manageRemoteService } from "./remote-bootstrap.mjs";

test("remote management accepts only supported fixed actions and quotes identity arguments", () => {
  assert.throws(() => bootstrapCommand("posix", "rm -rf"));
  assert.throws(() => bootstrapCommand("posix", "start", "x\n"));
  const posix = bootstrapCommand("posix", "start", "a'$(touch /tmp/no)");
  assert.ok(posix.includes("'a'\\''$(touch /tmp/no)'"));
  const windows = bootstrapCommand("windows", "inspect");
  assert.match(windows, /^powershell.exe .* -EncodedCommand [A-Za-z0-9+/=]+$/);
});
test("SSH alias remains a separate argument and discovery never starts the service", async () => {
  const calls = [];
  const result = await manageRemoteService(
    { host: "studio", platform: "posix" },
    async (file, args) => {
      calls.push({ file, args });
      return {
        stdout: JSON.stringify({
          protocol: 1,
          installed: true,
          state: "stopped",
          version: "1.0.0",
          dataRoot: "/data",
          platform: "linux",
          instanceId: null,
          port: null,
        }),
      };
    },
  );
  assert.equal(result.state, "stopped");
  assert.equal(calls[0].args.at(-2), "studio");
  assert.ok(calls[0].args.at(-1).includes("'inspect'"));
  assert.ok(!calls[0].args.at(-1).includes("'start'"));
});
test("a failed or timed-out start is not retried on another platform", async () => {
  let attempts = 0;
  await assert.rejects(
    manageRemoteService({ host: "studio", action: "start" }, async () => {
      attempts++;
      throw new Error("timeout");
    }),
    /timeout/,
  );
  assert.equal(attempts, 1);
});

test("an installed helper's identity error is not replaced with another platform or instance", async () => {
  let attempts = 0;
  await assert.rejects(
    manageRemoteService({ host: "studio" }, async () => {
      attempts++;
      throw Object.assign(new Error("exit code 1"), {
        stdout: JSON.stringify({ protocol: 1, state: "failed", message: "实例标识无效" }),
      });
    }),
    { code: "REMOTE_SERVICE_ERROR", message: "实例标识无效" },
  );
  assert.equal(attempts, 1);
});
