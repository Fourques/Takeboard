import type { WorkflowDiagnostic, WorkflowDiagnosticCheck } from "@takeboard/contracts";
import type { ComfyObjectInfo, ComfyPrompt } from "@takeboard/executor-comfy";
import type {
  WorkflowBinding,
  WorkflowCapability,
  WorkflowOutputMediaType,
} from "./workflow-bindings.js";
import { preflightPromptAgainstObjectInfo, validateWorkflowBinding } from "./workflow-bindings.js";

type BuildWorkflowDiagnosticInput = {
  path: string;
  workflowHash: string;
  prompt: ComfyPrompt;
  objectInfo: ComfyObjectInfo;
  capability: WorkflowCapability;
  outputMediaType: WorkflowOutputMediaType;
  bindingStatus: "built_in" | "ready" | "stale" | "needs_binding";
  binding: WorkflowBinding | null;
  models: string[];
  inventory: Set<string> | null;
};

function check(
  id: string,
  category: WorkflowDiagnosticCheck["category"],
  status: WorkflowDiagnosticCheck["status"],
  code: string,
  title: string,
  detail: string,
  remediation: string | null = null,
  nodeIds: string[] = [],
): WorkflowDiagnosticCheck {
  return { id, category, status, code, title, detail, remediation, nodeIds };
}

function modelMissing(models: string[], inventory: Set<string> | null) {
  if (!inventory) return [];
  return models.filter((model) => {
    const normalized = model.replaceAll("\\", "/").toLowerCase();
    const filename = normalized.split("/").at(-1) ?? normalized;
    return !inventory.has(normalized) && !inventory.has(filename);
  });
}

export function buildWorkflowDiagnostic(input: BuildWorkflowDiagnosticInput): WorkflowDiagnostic {
  const usesNativeAdapter = input.bindingStatus === "built_in";
  const checks: WorkflowDiagnosticCheck[] = [
    check(
      "document.valid",
      "document",
      "pass",
      "WORKFLOW_DOCUMENT_VALID",
      "工作流文档可读取",
      `已解析 ${Object.keys(input.prompt).length} 个可执行节点。`,
    ),
    check(
      "conversion.prompt",
      "conversion",
      "pass",
      usesNativeAdapter ? "TAKEBOARD_NATIVE_PROMPT_READY" : "WORKFLOW_PROMPT_CONVERTED",
      usesNativeAdapter ? "原生执行协议就绪" : "已转换为 API Prompt",
      usesNativeAdapter
        ? "生成时由 TakeBoard 的版本化原生适配器构建 API Prompt；源工作流用于依赖发现与在 ComfyUI 中编辑。"
        : "画布节点、子图和连线已转换为 ComfyUI 后端可接收的结构。",
    ),
  ];

  const missingNodeEntries = Object.entries(input.prompt).filter(
    ([, node]) => !input.objectInfo[node.class_type],
  );
  const missingNodeTypes = [...new Set(missingNodeEntries.map(([, node]) => node.class_type))];
  const preflightIssues = preflightPromptAgainstObjectInfo(input.prompt, input.objectInfo);
  const missingInputIssues = preflightIssues.filter(
    (issue) => !missingNodeEntries.some(([nodeId]) => issue.startsWith(`${nodeId}：当前`)),
  );
  checks.push(
    missingNodeTypes.length > 0
      ? check(
          "nodes.available",
          "nodes",
          "blocked",
          "COMFY_NODE_TYPES_MISSING",
          `缺少 ${missingNodeTypes.length} 类节点`,
          missingNodeTypes.join("、"),
          "在当前 ComfyUI 安装对应的自定义节点，并重新检测。",
          missingNodeEntries.map(([nodeId]) => nodeId),
        )
      : check(
          "nodes.available",
          "nodes",
          "pass",
          "COMFY_NODE_TYPES_AVAILABLE",
          "节点依赖完整",
          "当前 ComfyUI 已注册工作流使用的全部节点类型。",
        ),
  );
  checks.push(
    missingInputIssues.length > 0
      ? check(
          "nodes.required_inputs",
          "nodes",
          usesNativeAdapter ? "warning" : "blocked",
          usesNativeAdapter ? "SOURCE_WORKFLOW_INPUTS_DIFFER" : "COMFY_REQUIRED_INPUTS_MISSING",
          usesNativeAdapter ? "源工作流与当前节点定义存在差异" : "节点必需输入不完整",
          usesNativeAdapter
            ? `${missingInputIssues.slice(0, 8).join("；")}。原生生成不会直接提交这份源画布，但建议在 ComfyUI 中同步模板。`
            : missingInputIssues.slice(0, 8).join("；"),
          usesNativeAdapter
            ? "需要编辑模板时，在 ComfyUI 中打开并保存一次；生成仍由 TakeBoard 原生适配器负责。"
            : "返回 ComfyUI 检查断开的连线或节点版本差异。",
          missingInputIssues.map((issue) => issue.split("：")[0] ?? "").filter(Boolean),
        )
      : check(
          "nodes.required_inputs",
          "nodes",
          "pass",
          "COMFY_REQUIRED_INPUTS_READY",
          "必需输入完整",
          "所有已注册节点均具有当前版本要求的必需输入。",
        ),
  );

  const missingModels = modelMissing(input.models, input.inventory);
  const modelStatus =
    input.inventory === null || input.models.length === 0
      ? ("unknown" as const)
      : missingModels.length > 0
        ? ("missing" as const)
        : ("ready" as const);
  checks.push(
    modelStatus === "missing"
      ? check(
          "models.available",
          "models",
          "blocked",
          "COMFY_MODELS_MISSING",
          `缺少 ${missingModels.length} 个模型文件`,
          missingModels.join("、"),
          "将模型放入对应的 ComfyUI models 目录，刷新模型列表后重新检测。",
        )
      : modelStatus === "ready"
        ? check(
            "models.available",
            "models",
            "pass",
            "COMFY_MODELS_AVAILABLE",
            "模型依赖完整",
            `已核对 ${input.models.length} 个工作流引用的模型文件。`,
          )
        : check(
            "models.available",
            "models",
            "unknown",
            "COMFY_MODELS_NOT_DISCOVERABLE",
            "无法完整核对模型",
            input.models.length === 0
              ? "工作流文档没有暴露可识别的模型文件名。"
              : "当前 ComfyUI 没有返回可用的模型清单。",
            "可在 ComfyUI 中确认模型选择，或重新连接后再次检测。",
          ),
  );

  const bindingIssues = input.binding ? validateWorkflowBinding(input.prompt, input.binding) : [];
  if (input.bindingStatus === "built_in") {
    checks.push(
      check(
        "binding.execution",
        "binding",
        "pass",
        "TAKEBOARD_NATIVE_ADAPTER",
        "TakeBoard 原生适配",
        "输入与输出由经过版本控制的内置执行器映射。",
      ),
    );
  } else if (input.bindingStatus === "ready" && bindingIssues.length === 0) {
    checks.push(
      check(
        "binding.execution",
        "binding",
        "pass",
        "TAKEBOARD_BINDING_READY",
        "参数绑定有效",
        "工作流内容哈希与已确认的参数绑定一致。",
      ),
    );
  } else if (input.bindingStatus === "stale") {
    checks.push(
      check(
        "binding.execution",
        "binding",
        "blocked",
        "TAKEBOARD_BINDING_STALE",
        "参数绑定已过期",
        "工作流内容在上次确认后发生了变化。",
        "重新检查参数目标并再次确认信任。",
      ),
    );
  } else {
    checks.push(
      check(
        "binding.execution",
        "binding",
        "blocked",
        bindingIssues.length > 0 ? "TAKEBOARD_BINDING_INVALID" : "TAKEBOARD_BINDING_REQUIRED",
        bindingIssues.length > 0 ? "参数绑定无效" : "尚未建立参数绑定",
        bindingIssues.length > 0
          ? bindingIssues.slice(0, 8).join("；")
          : "工作流可以管理和检查，但 TakeBoard 尚不知道应替换哪些输入。",
        "检查提示词、素材、时长、Seed 与输出节点后，明确确认并保存绑定。",
      ),
    );
  }

  const outputPattern =
    input.outputMediaType === "image"
      ? /save.*image|previewimage/i
      : /save.*video|videocombine|createvideo|saveanimated/i;
  const outputNodeIds = Object.entries(input.prompt)
    .filter(([, node]) => outputPattern.test(node.class_type))
    .map(([nodeId]) => nodeId);
  checks.push(
    usesNativeAdapter
      ? check(
          "output.detected",
          "output",
          "pass",
          "TAKEBOARD_NATIVE_OUTPUT",
          `原生${input.outputMediaType === "image" ? "图片" : "视频"}输出已配置`,
          "输出收集由 TakeBoard 原生适配器负责，不依赖源画布中的保存节点名称。",
          null,
          outputNodeIds,
        )
      : outputNodeIds.length > 0
        ? check(
            "output.detected",
            "output",
            "pass",
            "WORKFLOW_OUTPUT_DETECTED",
            `已识别${input.outputMediaType === "image" ? "图片" : "视频"}输出`,
            `输出节点：${outputNodeIds.join("、")}`,
            null,
            outputNodeIds,
          )
        : check(
            "output.detected",
            "output",
            "blocked",
            "WORKFLOW_OUTPUT_MISSING",
            "没有识别到可收集的输出",
            `当前绑定声明输出为${input.outputMediaType === "image" ? "图片" : "视频"}，但 Prompt 中没有对应保存节点。`,
            "在 ComfyUI 中添加保存输出节点，或修正绑定的输出类型。",
          ),
  );

  const health = checks.some((item) => item.status === "blocked")
    ? ("blocked" as const)
    : checks.some((item) => item.status === "warning" || item.status === "unknown")
      ? ("attention" as const)
      : ("ready" as const);
  return {
    path: input.path,
    workflowHash: input.workflowHash,
    health,
    executable: health !== "blocked",
    nodeCount: Object.keys(input.prompt).length,
    capability: input.capability,
    outputMediaType: input.outputMediaType,
    bindingStatus: input.bindingStatus,
    modelStatus,
    models: input.models,
    missingModels,
    missingNodeTypes,
    checks,
  };
}
