import type { ComfyObjectInfo, ComfyPrompt } from "./index.js";

export type PromptIssue = {
  nodeId: string;
  field?: string;
  kind: "missing_node" | "missing_input" | "missing_origin";
  detail: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredInputNames(field: string, definition: unknown, inputs: Record<string, unknown>) {
  if (!Array.isArray(definition) || definition[0] !== "COMFY_AUTOGROW_V3") return [field];
  const template = record(record(definition[1]).template);
  const minimum = template.min;
  const group = Object.entries(record(template.input)).find(
    ([, value]) => Object.keys(record(value)).length > 0,
  );
  if (group && typeof minimum === "number" && Number.isInteger(minimum) && minimum >= 0) {
    if (group[0] !== "required" || minimum === 0) return [];
    const names = Array.isArray(template.names)
      ? template.names.filter((name): name is string => typeof name === "string")
      : typeof template.prefix === "string" &&
          typeof template.max === "number" &&
          template.max >= minimum &&
          template.max <= 100
        ? Array.from({ length: template.max }, (_, index) => `${template.prefix}${index}`)
        : [];
    if (names.length >= minimum) return names.slice(0, minimum).map((name) => `${field}.${name}`);
  }
  // Older schemas may expose the dynamic type without its template metadata.
  // Restrict this compatibility fallback to Autogrow, never ordinary required fields.
  return Object.keys(inputs).some(
    (key) => key.startsWith(`${field}.`) && key.length > field.length + 1,
  )
    ? []
    : [field];
}

/** Shared by template inspection and the final, materialized execution prompt. */
export function inspectPromptInputs(
  prompt: ComfyPrompt,
  objectInfo: ComfyObjectInfo,
): PromptIssue[] {
  const issues: PromptIssue[] = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    const definition = objectInfo[node.class_type];
    if (!definition) {
      issues.push({ nodeId, kind: "missing_node", detail: node.class_type });
      continue;
    }
    for (const [field, spec] of Object.entries(definition.input?.required ?? {})) {
      for (const required of requiredInputNames(field, spec, node.inputs)) {
        if (!(required in node.inputs)) {
          issues.push({ nodeId, field: required, kind: "missing_input", detail: required });
        }
      }
    }
    for (const [field, value] of Object.entries(node.inputs)) {
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "string" &&
        Number.isInteger(value[1]) &&
        !prompt[value[0]]
      ) {
        issues.push({ nodeId, field, kind: "missing_origin", detail: value[0] });
      }
    }
  }
  return issues;
}
