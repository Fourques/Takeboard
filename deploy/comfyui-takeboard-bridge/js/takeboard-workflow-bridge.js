import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

const parameterName = "takeboard_workflow";

function validWorkflowPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 500 &&
    path.endsWith(".json") &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}

app.registerExtension({
  name: "TakeBoard.WorkflowBridge",
  async setup() {
    const url = new URL(window.location.href);
    const workflowPath = url.searchParams.get(parameterName);
    if (!workflowPath) return;
    url.searchParams.delete(parameterName);
    window.history.replaceState(null, "", url);
    if (!validWorkflowPath(workflowPath)) {
      console.error("[TakeBoard] Refused invalid workflow path", workflowPath);
      return;
    }
    try {
      const response = await api.fetchApi(
        `/userdata/${encodeURIComponent(`workflows/${workflowPath}`)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const workflow = await response.json();
      if (Array.isArray(workflow.nodes)) await app.loadGraphData(workflow);
      else if (typeof app.loadApiJson === "function") await app.loadApiJson(workflow);
      else throw new Error("当前 ComfyUI 前端不支持打开 API 模板，请更新 ComfyUI 后重试");
      console.info(`[TakeBoard] Loaded workflow ${workflowPath}`);
    } catch (error) {
      console.error(`[TakeBoard] Unable to load workflow ${workflowPath}`, error);
      window.alert(`TakeBoard 无法载入 Workflow：${workflowPath}`);
    }
  },
});
