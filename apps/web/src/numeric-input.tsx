import {
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type NumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "max" | "min" | "onChange" | "step" | "type" | "value"
> & {
  value: number;
  draftKey?: string;
  min?: number;
  max?: number;
  step?: number;
  preserveEmptyOnBlur?: boolean;
  onDraftValidityChange?: (valid: boolean) => void;
  onValueChange: (value: number) => void;
};

const pendingDrafts = new Map<string, string>();

function formatNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

export function isNumberDraftValid(draft: string, min?: number, max?: number) {
  if (draft.trim() === "") return false;
  const parsed = Number(draft);
  return (
    Number.isFinite(parsed) &&
    (min === undefined || parsed >= min) &&
    (max === undefined || parsed <= max)
  );
}

function decimalPlaces(value: number) {
  const text = String(value);
  return text.includes(".") ? (text.split(".")[1]?.length ?? 0) : 0;
}

export function normalizeNumber(value: number, min?: number, max?: number, step?: number) {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  if (step && step > 0) {
    const origin = min ?? 0;
    next = origin + Math.round((next - origin) / step) * step;
    next = Number(next.toFixed(Math.min(10, decimalPlaces(step) + 2)));
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
  }
  return next;
}

/**
 * Keeps the user's partial text (including an empty field) separate from the
 * committed numeric value. The value is parsed, clamped and snapped on blur or Enter.
 */
export function NumericInput({
  value,
  draftKey,
  min,
  max,
  step,
  preserveEmptyOnBlur = false,
  onDraftValidityChange,
  onValueChange,
  onBlur,
  onFocus,
  onKeyDown,
  ...inputProps
}: NumericInputProps) {
  const focused = useRef(false);
  const restoreOnBlur = useRef(false);
  const validityCallbackRef = useRef(onDraftValidityChange);
  validityCallbackRef.current = onDraftValidityChange;
  const [draft, setDraft] = useState(() =>
    draftKey && pendingDrafts.has(draftKey)
      ? (pendingDrafts.get(draftKey) ?? "")
      : formatNumber(value),
  );
  const draftRef = useRef(draft);

  const updateDraft = (next: string) => {
    if (draftKey) {
      pendingDrafts.delete(draftKey);
      pendingDrafts.set(draftKey, next);
      const oldestDraft = pendingDrafts.keys().next().value as string | undefined;
      if (pendingDrafts.size > 500 && oldestDraft) pendingDrafts.delete(oldestDraft);
    }
    draftRef.current = next;
    setDraft(next);
  };

  const clearPendingDraft = () => {
    if (draftKey) pendingDrafts.delete(draftKey);
  };

  useEffect(() => {
    if (focused.current) return;
    if (draftKey && pendingDrafts.has(draftKey)) {
      const pending = pendingDrafts.get(draftKey) ?? "";
      draftRef.current = pending;
      setDraft(pending);
      return;
    }
    const formatted = formatNumber(value);
    draftRef.current = formatted;
    setDraft(formatted);
  }, [draftKey, value]);

  const draftIsValid = isNumberDraftValid(draft, min, max);
  const invalid =
    (preserveEmptyOnBlur && draft.trim() === "") || (draft.trim() !== "" && !draftIsValid);

  useEffect(() => {
    validityCallbackRef.current?.(draftIsValid);
  }, [draftIsValid]);

  const commit = () => {
    // Read the ref written synchronously by onChange. Under a concurrent parent
    // render, blur can arrive before React commits the latest draft state.
    const latestDraft = draftRef.current;
    const latestParsed = latestDraft.trim() === "" ? Number.NaN : Number(latestDraft);
    if (!Number.isFinite(latestParsed)) {
      if (preserveEmptyOnBlur) {
        updateDraft(latestDraft);
        return;
      }
      clearPendingDraft();
      const formatted = formatNumber(value);
      draftRef.current = formatted;
      setDraft(formatted);
      return;
    }
    const next = normalizeNumber(latestParsed, min, max, step);
    clearPendingDraft();
    const formatted = formatNumber(next);
    draftRef.current = formatted;
    setDraft(formatted);
    if (next !== value) onValueChange(next);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    focused.current = false;
    if (restoreOnBlur.current) {
      restoreOnBlur.current = false;
      clearPendingDraft();
      const formatted = formatNumber(value);
      draftRef.current = formatted;
      setDraft(formatted);
    } else {
      commit();
    }
    onBlur?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      restoreOnBlur.current = true;
      clearPendingDraft();
      const formatted = formatNumber(value);
      draftRef.current = formatted;
      setDraft(formatted);
      event.currentTarget.blur();
    }
    onKeyDown?.(event);
  };

  return (
    <input
      {...inputProps}
      type="number"
      inputMode={step !== undefined && step < 1 ? "decimal" : "numeric"}
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-invalid={invalid || undefined}
      data-empty={draft === "" ? "true" : undefined}
      onChange={(event) => updateDraft(event.target.value)}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
}
