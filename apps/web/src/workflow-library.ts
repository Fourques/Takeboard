import type { WorkflowDiagnosticCheck } from "@takeboard/contracts";
import type { WorkflowSummary } from "./api";

export function workflowCheckGuidance(check: Pick<WorkflowDiagnosticCheck, "code">) {
  switch (check.code) {
    case "TAKEBOARD_NATIVE_TEMPLATE_INCOMPATIBLE":
      return "推荐模板与当前生成设备不兼容。请检查 TakeBoard 与 ComfyUI 更新后重试，或选择其他模板。";
    case "COMFY_NODE_TYPES_MISSING":
      return "当前生成设备缺少模板所需的组件。请在 ComfyUI 中安装缺失节点，再重新检查。";
    case "COMFY_MODELS_MISSING":
      return "当前生成设备缺少模型文件。请在 ComfyUI 中补齐模型，再重新检查。";
    case "COMFY_REQUIRED_INPUTS_MISSING":
      return "模板与当前节点版本不兼容，部分输入无法读取。请在 ComfyUI 中打开模板、检查连线并保存，再重新检查。";
    case "TAKEBOARD_BINDING_STALE":
      return "模板内容已更新。请核对下方输入设置并重新启用。";
    case "TAKEBOARD_BINDING_REQUIRED":
      return "还未设置提示词和素材的对应位置。请核对下方输入设置，确认后启用。";
    case "TAKEBOARD_BINDING_INVALID":
      return "模板中的输入位置已变化。请修正下方输入设置，再重新启用。";
    case "WORKFLOW_OUTPUT_MISSING":
      return "模板没有可保存的生成结果。请在 ComfyUI 中添加图片或视频保存节点。";
    case "WORKFLOW_CONVERSION_FAILED":
      return "暂时无法读取这份模板。请在 ComfyUI 中打开，导出 API 格式的工作流后重新导入。";
    default:
      return "暂时无法确认此模板能否使用。请检查生成设备的连接，再重新检查。";
  }
}

export function isLibraryWorkflow(workflow: WorkflowSummary) {
  return workflow.library?.included ?? workflow.origin !== "built_in";
}

/** Readiness describes checked dependencies, not a promise about model quality. */
export function workflowAvailability(workflow: WorkflowSummary): {
  label: "可用" | "需要更新" | "不可用";
  ready: boolean;
  reason: string;
} {
  const blocked = workflow.diagnostic?.checks?.find((check) => check.status === "blocked");
  if (workflow.libraryError)
    return { label: "不可用", ready: false, reason: "工作流列表读取失败，请重新检查。" };
  if (workflow.modelStatus === "missing")
    return {
      label: "不可用",
      ready: false,
      reason: workflowCheckGuidance({ code: "COMFY_MODELS_MISSING" }),
    };
  if (workflow.bindingStatus === "stale")
    return {
      label: "需要更新",
      ready: false,
      reason: workflowCheckGuidance({ code: "TAKEBOARD_BINDING_STALE" }),
    };
  if (blocked || workflow.diagnostic?.health === "blocked")
    return {
      label:
        blocked &&
        [
          "COMFY_REQUIRED_INPUTS_MISSING",
          "TAKEBOARD_NATIVE_TEMPLATE_INCOMPATIBLE",
          "TAKEBOARD_BINDING_INVALID",
          "TAKEBOARD_BINDING_REQUIRED",
        ].includes(blocked.code)
          ? "需要更新"
          : "不可用",
      ready: false,
      reason: workflowCheckGuidance(blocked ?? { code: "" }),
    };
  if (workflow.execution === "comfy_only")
    return {
      label: "需要更新",
      ready: false,
      reason: workflowCheckGuidance({ code: "TAKEBOARD_BINDING_REQUIRED" }),
    };
  if (
    workflow.diagnostic?.executable &&
    ["ready", "attention"].includes(workflow.diagnostic.health)
  )
    return { label: "可用", ready: true, reason: "" };
  return { label: "不可用", ready: false, reason: "尚未完成检查。请连接生成设备后重新检查。" };
}

export function compareWorkflows(a: WorkflowSummary, b: WorkflowSummary) {
  return (
    Number(workflowAvailability(b).ready) - Number(workflowAvailability(a).ready) ||
    Number(Boolean(b.library?.favorite)) - Number(Boolean(a.library?.favorite)) ||
    a.name.localeCompare(b.name, "zh-CN")
  );
}
