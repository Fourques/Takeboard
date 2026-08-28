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
  min?: number;
  max?: number;
  step?: number;
  onValueChange: (value: number) => void;
};

function formatNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function decimalPlaces(value: number) {
  const text = String(value);
  return text.includes(".") ? (text.split(".")[1]?.length ?? 0) : 0;
}

function normalizeNumber(value: number, min?: number, max?: number, step?: number) {
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
  min,
  max,
  step,
  onValueChange,
  onBlur,
  onFocus,
  onKeyDown,
  ...inputProps
}: NumericInputProps) {
  const focused = useRef(false);
  const restoreOnBlur = useRef(false);
  const [draft, setDraft] = useState(() => formatNumber(value));

  useEffect(() => {
    if (!focused.current) setDraft(formatNumber(value));
  }, [value]);

  const parsed = draft.trim() === "" ? Number.NaN : Number(draft);
  const invalid =
    draft.trim() !== "" &&
    (!Number.isFinite(parsed) ||
      (min !== undefined && parsed < min) ||
      (max !== undefined && parsed > max));

  const commit = () => {
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumber(value));
      return;
    }
    const next = normalizeNumber(parsed, min, max, step);
    setDraft(formatNumber(next));
    if (next !== value) onValueChange(next);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    focused.current = false;
    if (restoreOnBlur.current) {
      restoreOnBlur.current = false;
      setDraft(formatNumber(value));
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
      setDraft(formatNumber(value));
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
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
}
