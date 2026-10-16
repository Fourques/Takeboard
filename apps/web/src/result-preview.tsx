import type { Asset, Run, Take } from "@takeboard/contracts";
import { useState } from "react";
import { projectApi } from "./api";
import { DetailMedia } from "./detail-media";
import { comparableResults } from "./result-reuse";

export function ResultPreview({
  selected,
  takes,
  assets,
  runs,
  projectKey,
}: {
  selected: Take;
  takes: Take[];
  assets: Asset[];
  runs: Run[];
  projectKey: string;
}) {
  const [comparing, setComparing] = useState(false);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const alternatives = comparableResults(takes, assets, selected.id);
  const reference = alternatives.find((take) => take.id === referenceId) ?? alternatives[0];
  const shown = comparing && reference ? [selected, reference] : [selected];
  return (
    <section className="result-preview" aria-label="结果预览">
      {alternatives.length ? (
        <div className="candidate-title-row">
          <button
            className="inspector-model-manage"
            type="button"
            aria-pressed={comparing}
            onClick={() => setComparing(!comparing)}
          >
            {comparing ? "结束对比" : "对比结果"}
          </button>
          {comparing ? (
            <select
              aria-label="对比的结果"
              value={reference?.id ?? ""}
              onChange={(event) => setReferenceId(event.target.value)}
            >
              {alternatives.map((take) => (
                <option key={take.id} value={take.id}>
                  结果 {takes.indexOf(take) + 1}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <div className={`result-preview-media${shown.length > 1 ? " is-comparing" : ""}`}>
        {shown.map((take) => {
          const asset = assets.find((asset) => asset.id === take.assetId);
          const run = runs.find((run) => run.id === take.runId);
          return asset && take.status !== "media_missing" ? (
            <figure key={take.id}>
              {shown.length > 1 ? (
                <figcaption className="candidate-meta">
                  结果 {takes.indexOf(take) + 1}
                  <span>
                    {typeof run?.parameters.seed === "number" ? `Seed ${run.parameters.seed}` : ""}
                  </span>
                </figcaption>
              ) : null}
              <DetailMedia
                src={projectApi.assetUrl(projectKey, asset.id)}
                kind={asset.mediaType}
                label={shown.length > 1 ? `对比结果 ${takes.indexOf(take) + 1}` : "当前生成结果"}
              />
            </figure>
          ) : null;
        })}
      </div>
    </section>
  );
}
