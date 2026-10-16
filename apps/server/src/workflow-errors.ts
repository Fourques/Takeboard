/** Stable execution failures: user-facing text is separate from node diagnostics. */
export class WorkflowExecutionError extends Error {
  constructor(
    readonly code:
      | "WORKFLOW_BINDING_REQUIRED"
      | "WORKFLOW_BINDING_STALE"
      | "WORKFLOW_BINDING_INVALID"
      | "WORKFLOW_INPUTS_INCOMPATIBLE"
      | "WORKFLOW_TEMPLATE_CHANGED",
    message: string,
    readonly workflowPath: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
  }

  response() {
    return {
      error: this.message,
      code: this.code,
      workflowPath: this.workflowPath,
      issues: this.issues.slice(0, 8),
      retryable: false,
    };
  }
}
