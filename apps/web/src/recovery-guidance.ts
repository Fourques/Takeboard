export type RecoveryAction =
  | "connections"
  | "workflows"
  | "assets"
  | "prompt"
  | "parameters"
  | "tasks"
  | "review"
  | "storage"
  | "diagnostics";
export type RecoveryGuidance = {
  title: string;
  next: string;
  action: RecoveryAction;
  label: string;
};

// Presentation only: never infer permission to resubmit or change an execution state.
export function recoveryGuidance(message: string, code = ""): RecoveryGuidance {
  const text = `${code} ${message}`;
  if (/REVISION_CONFLICT|其他设备发生变化|版本冲突/i.test(text))
    return { title: "项目有新的修改", next: message, action: "review", label: "返回画布核对" };
  if (/ENOSPC|磁盘空间不足|存储空间不足/i.test(text))
    return {
      title: "保存空间不足",
      next: "查看项目所在设备的存储空间，腾出空间后再保存。",
      action: "storage",
      label: "查看存储",
    };
  if (
    /OUTCOME_UNKNOWN|UNCONFIRMED|INTERRUPTED|WORKER_TASK_MISSING|未确认|状态未确认|待核对|请求超时|REQUEST_TIMEOUT/i.test(
      text,
    )
  )
    return {
      title: "任务状态尚未确认",
      next: "先检查任务是否仍在运行，避免重复生成。",
      action: "tasks",
      label: "查看任务",
    };
  if (/OUTPUT_TRANSFER_FAILED|回收.*失败|传输.*失败/i.test(text))
    return {
      title: "生成结果尚未取回",
      next: "检查设备连接，再到任务中心恢复结果；不必重新生成。",
      action: "tasks",
      label: "查看任务",
    };
  if (/out of memory|显存不足|内存不足|CUDA.*memory/i.test(text))
    return {
      title: "生成设备的可用内存不足",
      next: "降低分辨率或参考素材数量，等待其他任务结束后再生成。",
      action: "parameters",
      label: "调整参数",
    };
  if (/SERVICE_UNREACHABLE|ECONNREFUSED|Failed to fetch|无法连接|连接.*失败|离线/i.test(text))
    return {
      title: "暂时无法连接服务",
      next: "检查设备是否在线、服务是否启动。已提交的任务请先核对状态。",
      action: "connections",
      label: "检查连接",
    };
  if (
    /缺少.*模型|模型.*缺失|model.*not found|缺少.*节点|参数绑定|可用 Workflow|选择.*模型|选择.*工作流|工作流(?:不可用|需要更新)|NO_.*OUTPUT/i.test(
      text,
    )
  )
    return {
      title: "工作流尚未准备好",
      next: "打开工作流检查缺失项，补齐依赖或选择可用的工作流。",
      action: "workflows",
      label: "检查工作流",
    };
  if (/提示词|没有对应.*素材/i.test(text))
    return { title: "需要调整提示词", next: message, action: "prompt", label: "编辑提示词" };
  if (/起始帧|结束帧|参考图|参考视频|连线|可用素材/i.test(text))
    return { title: "检查镜头输入", next: message, action: "assets", label: "查看素材" };
  if (/分辨率|帧率|时长|Seed|Steps|重绘强度/i.test(text))
    return { title: "检查生成参数", next: message, action: "parameters", label: "调整参数" };
  return {
    title: "这次操作未完成",
    next: "请保留当前编辑，运行诊断查看原因。若刚提交生成，先核对任务状态。",
    action: "diagnostics",
    label: "运行诊断",
  };
}
