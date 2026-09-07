import type { Run } from "@takeboard/contracts";

const executionProvenanceCss = `.execution-provenance {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: color-mix(in srgb, var(--surface-2) 66%, transparent);
}

.execution-provenance summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-2);
  cursor: pointer;
  gap: 12px;
  font-size: calc(9px * var(--ui-scale));
}

.execution-provenance summary strong {
  overflow: hidden;
  color: var(--text-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.execution-provenance > p {
  margin: 10px 0;
  color: var(--text-2);
  font-size: calc(9px * var(--ui-scale));
  line-height: 1.55;
}

.execution-provenance dl {
  display: grid;
  margin: 0;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.execution-provenance dl > div,
.execution-provenance li {
  padding: 7px;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.execution-provenance dt,
.execution-provenance dd {
  margin: 0;
  font-size: calc(8px * var(--ui-scale));
}

.execution-provenance dt {
  color: var(--faint);
}

.execution-provenance dd {
  margin-top: 2px;
  color: var(--text-1);
}

.execution-provenance ul {
  display: grid;
  margin: 7px 0 0;
  padding: 0;
  list-style: none;
  gap: 4px;
}

.execution-provenance li {
  display: grid;
  gap: 2px;
}

.execution-provenance li strong,
.execution-provenance li span {
  font-size: calc(8px * var(--ui-scale));
}

.execution-provenance li span {
  color: var(--faint);
}`;

export function ExecutionProvenance({ run }: { run: Run }) {
  if (!run.execution) return null;
  return (
    <>
      <style>{executionProvenanceCss}</style>
      <details className="execution-provenance">
        <summary>
          <span>执行与成本依据</span>
          <strong>{run.execution.workerName}</strong>
        </summary>
        <p>{run.execution.selectionReason}</p>
        <dl>
          <div>
            <dt>策略</dt>
            <dd>{run.execution.policy}</dd>
          </div>
          <div>
            <dt>成本</dt>
            <dd>
              {run.actualCost.amount ?? run.estimatedCost.amount ?? "未知"}
              {run.actualCost.amount !== null || run.estimatedCost.amount !== null
                ? ` ${run.actualCost.currency}`
                : ""}
            </dd>
          </div>
        </dl>
        <ul>
          {run.execution.candidates.map((candidate) => (
            <li key={candidate.workerId}>
              <strong>{candidate.workerName}</strong>
              <span>{candidate.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
