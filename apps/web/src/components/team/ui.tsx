"use client";
import { useEffect, useId, useRef, useState, type ComponentProps, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import { formatAge } from "./format";
import { Icon } from "./icons";
import type { Presented, Tone } from "./status";
import s from "./team.module.css";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Status colors. Used for dots and icons; pills carry their own fills. */
export const TONE_COLOR: Record<Tone, string> = {
  ok: "#00C805",
  warn: "#FFB01F",
  bad: "#FF5000",
  neutral: "#8F897D",
  pending: "#8F897D",
};

/* ---------- Status ---------- */

const PILL: Record<Tone, string> = { ok: s.pOk!, warn: s.pWarn!, bad: s.pBad!, neutral: s.pNeutral!, pending: s.pNeutral! };

/** Filled pill: state is always a word on a color. */
export function StatusPill({ presented, label, tone, title, className }: { presented?: Presented; label?: string; tone?: Tone; title?: string; className?: string }) {
  const resolved = presented?.tone ?? tone ?? "neutral";
  return (
    <span title={title ?? presented?.detail} className={cx(s.pill, PILL[resolved], resolved === "pending" && s.pulse, className)}>
      <span className={s.pillText}>{presented?.label ?? label}</span>
    </span>
  );
}

export function TagPill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.pill, s.pLine, className)}>{children}</span>;
}

export function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden="true" className={s.dot} style={{ background: TONE_COLOR[tone] }} />;
}

export function Notice({ tone, children, onDismiss, className, action }: { tone: "success" | "error" | "warn" | "info"; children: ReactNode; onDismiss?: () => void; className?: string; action?: ReactNode }) {
  const style = { success: s.noticeOk, error: s.noticeBad, warn: s.noticeWarn, info: "" }[tone];
  return (
    <div role={tone === "error" ? "alert" : tone === "success" || tone === "warn" ? "status" : undefined} className={cx(s.notice, style, "flex items-start justify-between gap-3", className)}>
      <div className="min-w-0 break-words">{children}</div>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="-my-1 inline-flex size-9 items-center justify-center rounded-full border-0 bg-transparent text-current opacity-80 hover:opacity-100">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx(s.hair, "py-8")}>
      <p className="text-[15px] font-semibold">{title}</p>
      {children && <p className={cx(s.muted, "mt-1 max-w-lg text-sm")}>{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cx(s.skeleton, "motion-safe:animate-pulse", className)} style={style} />;
}

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "danger" | "warn" | "text";

export function Button({ variant = "secondary", small, busy, busyText, className, children, disabled, ...rest }: ComponentProps<"button"> & { variant?: Variant; small?: boolean; busy?: boolean; busyText?: string }) {
  const base = variant === "primary" ? cx(s.cta, small && s.ctaSm) : variant === "text" ? s.txtbtn : cx(s.btn2, small && s.btnSm, variant === "danger" && s.btnDanger, variant === "warn" && s.btnWarn);
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined} className={cx(base, className)}>
      {busy && <span aria-hidden="true" className={s.spin} />}
      {busy && busyText ? busyText : children}
    </button>
  );
}

/** A row of toggle chips (aria-pressed), used for chart and list filters. */
export function SegGroup<T extends string>({ label, options, value, onChange, className }: { label: string; options: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (value: T) => void; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx("flex flex-wrap gap-1", className)}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={cx(s.seg, value === option.value && s.segOn)}>
          {option.label}
          {option.count !== undefined && <span className="tabular-nums opacity-80">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-busy={busy || undefined} disabled={disabled || busy} onClick={() => onChange(!checked)} className={cx(s.switch, checked ? s.switchOn : s.switchOff)} />
  );
}

/* ---------- Fields ---------- */

type FieldAria = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

export function Field({ label, hint, error, optional, children, srLabel }: { label: string; hint?: ReactNode; error?: string | null; optional?: boolean; srLabel?: boolean; children: (aria: FieldAria) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="block min-w-0">
      <label htmlFor={id} className={srLabel ? s.sr : s.label}>
        {label}
        {optional && <span className={cx(s.muted, "ml-1 font-normal")}>(optional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && <p id={hintId} className={s.hint}>{hint}</p>}
      {error && <p id={errorId} className={s.fieldError}>{error}</p>}
    </div>
  );
}

export function TextInput({ label, hint, error, optional, srLabel, className, ground, small, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; optional?: boolean; srLabel?: boolean; ground?: boolean; small?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} srLabel={srLabel}>
      {(aria) => <input {...rest} {...aria} className={cx(s.field, ground && s.fieldGround, small && s.fieldSm, className)} />}
    </Field>
  );
}

/* ---------- Addresses, copy, confirm ---------- */

export function CopyButton({ value, label, children, className, small = true }: { value: string; label: string; children?: ReactNode; className?: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={children ? undefined : copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => undefined);
      }}
      className={cx(s.btn2, small && s.btnSm, className)}
    >
      <Icon name={copied ? "check" : "copy"} size={16} />
      {children ? (copied ? "Copied" : children) : <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>}
    </button>
  );
}

/** Two-step confirmation shown in place of the trigger. Focus moves to Cancel so Escape/Enter stay safe. */
export function ConfirmInline({ trigger, message, confirmLabel = "Confirm", tone = "danger", busy, triggerClassName, triggerVariant, onConfirm }: { trigger: string; message: ReactNode; confirmLabel?: string; tone?: "danger" | "warn"; busy?: boolean; triggerClassName?: string; triggerVariant?: Variant | "link"; onConfirm: () => void | Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  if (!open) {
    const variant = triggerVariant === "link" ? "text" : triggerVariant ?? (tone === "danger" ? "danger" : "warn");
    return (
      <Button ref={triggerRef} variant={variant} small={variant !== "text"} className={cx(triggerVariant === "link" && s.txtDanger, triggerClassName)} onClick={() => setOpen(true)} disabled={busy}>
        {trigger}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Confirm: ${trigger}`} onKeyDown={(event) => event.key === "Escape" && setOpen(false)} className={cx(s.confirm, tone === "warn" && s.confirmWarn)}>
      <p className="mb-3 text-sm text-[#e9e4da]">{message}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant={tone === "danger" ? "danger" : "warn"} small busy={busy} busyText="Working…" onClick={async () => { await onConfirm(); setOpen(false); }}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} small onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

/* ---------- Time ---------- */

/** Ticking clock for age labels. Only the component that calls it re-renders. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function Updated({ at, prefix = "Updated" }: { at: number | null; prefix?: string }) {
  const now = useNow(1000);
  if (at === null) return <span>Not updated yet</span>;
  return <span>{prefix} {formatAge(Math.max(0, now - at))} ago</span>;
}

/** True once the last successful refresh is older than `afterMs`, or a refresh error is showing. Re-renders only on change. */
export function useStale(lastSuccessAt: number | null, refreshError: string | null, afterMs = 45_000): boolean {
  const compute = () => lastSuccessAt !== null && (Boolean(refreshError) || Date.now() - lastSuccessAt > afterMs);
  const [stale, setStale] = useState(compute);
  useEffect(() => {
    const check = () => setStale(lastSuccessAt !== null && (Boolean(refreshError) || Date.now() - lastSuccessAt > afterMs));
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [lastSuccessAt, refreshError, afterMs]);
  return stale;
}
