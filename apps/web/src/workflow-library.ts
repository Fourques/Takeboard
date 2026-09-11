import type { WorkflowSummary } from "./api";

export function isLibraryWorkflow(workflow: WorkflowSummary) {
  return workflow.library?.included ?? workflow.origin !== "built_in";
}

/** Readiness describes checked dependencies, not a promise about model quality. */
export function workflowAvailability(workflow: WorkflowSummary) {
  if (workflow.libraryError) return { label: "列表读取失败", ready: false };
  if (workflow.modelStatus === "missing") return { label: "缺少模型", ready: false };
  if (workflow.bindingStatus === "stale") return { label: "需要重新配置", ready: false };
  if (workflow.diagnostic?.health === "blocked") return { label: "需要处理", ready: false };
  if (workflow.execution === "comfy_only") return { label: "需要配置", ready: false };
  if (workflow.diagnostic?.executable && workflow.diagnostic.health === "ready")
    return { label: "可使用", ready: true };
  if (workflow.diagnostic?.executable && workflow.diagnostic.health === "attention")
    return { label: "可使用 · 有提醒", ready: true };
  return { label: "待检查", ready: false };
}

export function compareWorkflows(a: WorkflowSummary, b: WorkflowSummary) {
  return (
    Number(workflowAvailability(b).ready) - Number(workflowAvailability(a).ready) ||
    Number(Boolean(b.library?.favorite)) - Number(Boolean(a.library?.favorite)) ||
    a.name.localeCompare(b.name, "zh-CN")
  );
}
