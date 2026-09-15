import type { Asset, Run } from "@takeboard/contracts";
import { lazy, Suspense } from "react";
import type { WorkflowSummary } from "./api";
import { projectApi } from "./api";
import { assetDisplayNames } from "./asset-navigation";
import { recordedInputAsset, recordedPromptParts } from "./recorded-prompt";

const ExecutionProvenance = lazy(() =>
  import("./execution-provenance").then((m) => ({ default: m.ExecutionProvenance })),
);
export function GenerationRecord({
  run,
  assets,
  workflows,
  outputType,
  onLocateAsset,
  projectKey,
}: {
  run: Run;
  assets: Asset[];
  workflows: WorkflowSummary[];
  outputType: Asset["mediaType"] | undefined;
  onLocateAsset: (assetId: string) => void;
  projectKey: string | null;
}) {
  const p = run.parameters;
  const names = assetDisplayNames(assets);
  const path = typeof p.recipePath === "string" ? p.recipePath : "";
  const modelFile = Array.isArray(p.models)
    ? p.models.find((value) => typeof value === "string")
    : null;
  const recordedName = path || (typeof modelFile === "string" ? modelFile : "");
  const model =
    workflows.find((workflow) => workflow.path === path)?.name ??
    (recordedName
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(json|safetensors|gguf|ckpt)$/i, "") ||
      "未记录工作流");
  const facts = [
    ["种子", p.seed],
    ["尺寸", p.width && p.height ? `${p.width} × ${p.height}` : null],
    ["时长", outputType !== "image" && p.durationSeconds ? `${p.durationSeconds} 秒` : null],
    ["帧率", outputType !== "image" && p.fps ? `${p.fps} fps` : null],
    ["步数", p.steps],
    ["引导系数", p.cfg ?? p.guidance],
  ].filter(([, value]) => value !== null && value !== undefined);
  return (
    <section className="inspector-section run-record" aria-label="生成记录">
      <header className="run-identity">
        <span>生成记录</span>
        <h3>{model}</h3>
        <small>{new Date(run.createdAt).toLocaleString()}</small>
      </header>
      <div className="run-prompt">
        <h4>提示词</h4>
        <pre>
          {recordedPromptParts(run, assets).map((part) =>
            part.assetId ? (
              <button
                className="record-mention"
                type="button"
                key={`${part.offset}-${part.assetId}`}
                onClick={() => part.assetId && onLocateAsset(part.assetId)}
                title={`查看 ${names.get(part.assetId)}`}
              >
                {part.text}
              </button>
            ) : (
              part.text
            ),
          )}
        </pre>
      </div>
      {run.inputs.length > 0 ? (
        <div className="run-inputs">
          <h4>输入素材</h4>
          <ul>
            {run.inputs.map((input) => {
              const asset = recordedInputAsset(input, assets);
              return (
                <li key={`${input.slot}-${input.refId}`}>
                  {asset ? (
                    <button
                      className="record-input-link"
                      type="button"
                      onClick={() => onLocateAsset(asset.id)}
                    >
                      {projectKey && asset.mediaType === "image" ? (
                        <img src={projectApi.assetUrl(projectKey, asset.id, true)} alt="" />
                      ) : (
                        <span aria-hidden="true">{asset.mediaType === "video" ? "▷" : "♪"}</span>
                      )}
                      <strong>{names.get(asset.id)}</strong>
                    </button>
                  ) : (
                    <strong>
                      {input.refType === "asset"
                        ? "原始素材已不可用"
                        : {
                            text: "文本输入",
                            entity: "角色或场景",
                            shot: "镜头输入",
                            take: "生成结果",
                          }[input.refType]}
                    </strong>
                  )}
                  <span>
                    {input.slot
                      .replace(/first_frame/, "首帧")
                      .replace(/last_frame/, "尾帧")
                      .replace(/reference_image/, "参考图")
                      .replace(/reference_video/, "参考视频")
                      .replace(/reference_audio/, "参考音频")
                      .replace(/^reference$/, "参考图")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="run-settings">
        <h4>生成参数</h4>
        <dl>
          {facts.map(([label, value]) => (
            <div key={String(label)}>
              <dt>{String(label)}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
      {p.negativePrompt || p.negative_prompt ? (
        <div className="run-prompt">
          <h4>负向提示词</h4>
          <pre>{String(p.negativePrompt ?? p.negative_prompt)}</pre>
        </div>
      ) : null}
      <details className="run-raw">
        <summary>完整参数与输入</summary>
        <dl className="run-model-files">
          <dt>工作流版本</dt>
          <dd>{run.recipeVersion}</dd>
          <dt>模型文件</dt>
          <dd>{Array.isArray(p.models) ? p.models.join("\n") : "未记录"}</dd>
        </dl>
        <pre>
          {JSON.stringify(
            {
              parameters: p,
              recipeId: run.recipeId,
              inputs: run.inputs,
              workflowSha256: run.workflowSha256,
              promptId: run.promptId,
            },
            null,
            2,
          )}
        </pre>
        {run.execution ? (
          <Suspense fallback={null}>
            <ExecutionProvenance run={run} />
          </Suspense>
        ) : null}
      </details>
    </section>
  );
}
