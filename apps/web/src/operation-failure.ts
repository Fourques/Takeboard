export type OperationFailure = { message: string; code: string | null };

/** Keep the server's error identity when presenting a failure; never retain a stale code. */
export function operationFailure(value: string | Error | null): OperationFailure | null {
  if (value === null) return null;
  if (typeof value === "string") return { message: value, code: null };
  const code = "code" in value && typeof value.code === "string" ? value.code : null;
  return { message: value.message, code };
}
