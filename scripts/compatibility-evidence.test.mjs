import assert from "node:assert/strict";
import test from "node:test";
import { validateCompatibilityEvidence } from "./compatibility-evidence.mjs";

function validEvidence() {
  return {
    format: "takeboard.gpu-release-gate",
    version: 2,
    evidenceId: "123e4567-e89b-42d3-a456-426614174000",
    evidenceKind: "real_gpu_end_to_end",
    passed: true,
    startedAt: "2026-08-30T00:00:00.000Z",
    completedAt: "2026-08-30T00:01:40.000Z",
    elapsedSeconds: 100,
    takeboardVersion: "0.2.0-beta.1",
    source: { commit: "a".repeat(40), dirty: false },
    environment: { platform: "linux", architecture: "x64", nodeVersion: "v24.0.0" },
    worker: {
      engine: "ComfyUI",
      version: "0.31.0",
      device: "cuda:0 NVIDIA RTX 4090",
      vramTotal: 25_000_000_000,
      vramFreeAtStart: 20_000_000_000,
    },
    workflow: {
      path: "Kino/Kino_MinimaxH3_T2V.json",
      execution: "native",
      workflowHash: "b".repeat(64),
      executionPromptSha256: "c".repeat(64),
      models: ["minimax_h3.safetensors"],
    },
    generation: {
      width: 480,
      height: 848,
      durationSeconds: 5,
      fps: 24,
      steps: 20,
      seed: 20260830,
    },
    output: {
      mediaType: "video",
      contentType: "video/mp4",
      byteSize: 1_000_000,
      sha256: "d".repeat(64),
      width: 480,
      height: 848,
      durationSeconds: 5,
      frameRate: 24,
      probeBytes: 64,
    },
    review: { automatedIntegrity: "passed", visualQuality: "not_reviewed" },
    privacy: "不包含账号、凭据、提示词、素材或运行标识。",
  };
}

test("accepts complete clean-tree real GPU evidence", () => {
  const evidence = validEvidence();
  assert.equal(validateCompatibilityEvidence(evidence), evidence);
});

test("rejects evidence from a dirty source tree", () => {
  const evidence = validEvidence();
  evidence.source.dirty = true;
  assert.throws(() => validateCompatibilityEvidence(evidence), /干净工作树/);
});

test("rejects prompt material and absolute paths", () => {
  const promptEvidence = { ...validEvidence(), prompt: "private scene description" };
  assert.throws(() => validateCompatibilityEvidence(promptEvidence), /禁止发布的字段 prompt/);

  const pathEvidence = validEvidence();
  pathEvidence.workflow.path = "/home/creator/workflow.json";
  assert.throws(() => validateCompatibilityEvidence(pathEvidence), /仓库相对路径/);

  const credentialEvidence = { ...validEvidence(), api_key: "private" };
  assert.throws(() => validateCompatibilityEvidence(credentialEvidence), /api_key/);
});

test("rejects missing output provenance", () => {
  const evidence = validEvidence();
  delete evidence.output.sha256;
  assert.throws(() => validateCompatibilityEvidence(evidence), /output.sha256/);
});

test("rejects control characters in publishable labels", () => {
  const evidence = validEvidence();
  evidence.worker.device = "NVIDIA RTX 4090\nprivate-note";
  assert.throws(() => validateCompatibilityEvidence(evidence), /worker.device/);
});
