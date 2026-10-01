"use client";
import { useEffect, useId, useRef, useState, type ComponentProps, type InputHTMLAttributes, type ReactNode } from "react";
import { shortAddress } from "./format";
import type { Presented, Tone } from "./status";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-0)]";

/* ---------- Panels ---------- */

export function Panel({ children, className, id, tabIndex }: { children: ReactNode; className?: string; id?: string; tabIndex?: number }) {
  return (
    <section id={id} tabIndex={tabIndex} className={cx("rounded-lg border border-[var(--line)] bg-[var(--bg-1)]/90 p-4 sm:p-5", "focus:outline-none", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, hint, action, titleId }: { title: string; hint?: ReactNode; action?: ReactNode; titleId?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text)]">{title}</h2>
        {hint && <p className="mt-1 text-sm text-[var(--muted)]">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Well({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-md border border-[var(--line)] bg-[var(--bg-0)] p-3", className)}>{children}</div>;
}

/* ---------- Status ---------- */

const toneStyle: Record<Tone, { box: string; glyph: string }> = {
  ok: { box: "border-[var(--good)]/50 bg-[var(--good)]/12 text-[#8fe0b0]", glyph: "✓" },
  warn: { box: "border-[var(--warn)]/55 bg-[var(--warn)]/12 text-[#f0cb6a]", glyph: "!" },
  bad: { box: "border-[var(--bad)]/60 bg-[var(--bad)]/14 text-[#ff9f9f]", glyph: "✕" },
  neutral: { box: "border-[var(--line)] bg-[var(--bg-2)] text-[var(--muted)]", glyph: "○" },
  pending: { box: "border-[var(--accent)]/45 bg-[var(--accent)]/10 text-[#8cc6f7]", glyph: "…" },
};

export function StatusPill({ presented, label, tone, title }: { presented?: Presented; label?: string; tone?: Tone; title?: string }) {
  const resolvedTone = presented?.tone ?? tone ?? "neutral";
  const style = toneStyle[resolvedTone];
  return (
    <span title={title ?? presented?.detail} className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", style.box)}>
      <span aria-hidden="true" className="w-3 text-center font-bold leading-none">{style.glyph}</span>
      <span className="min-w-0 truncate">{presented?.label ?? label}</span>
    </span>
  );
}

export function Notice({ tone, children, onDismiss, className }: { tone: "success" | "error" | "warn" | "info"; children: ReactNode; onDismiss?: () => void; className?: string }) {
  const styles = {
    success: "border-[var(--good)]/50 bg-[var(--good)]/10 text-[#b5ecca]",
    error: "border-[var(--bad)]/60 bg-[var(--bad)]/12 text-[#ffc2c2]",
    warn: "border-[var(--warn)]/55 bg-[var(--warn)]/10 text-[#f5dc99]",
    info: "border-[var(--line)] bg-[var(--bg-2)] text-[var(--text)]",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : tone === "success" ? "status" : undefined} className={cx("flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm", styles, className)}>
      <div className="min-w-0 break-words">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss message" className={cx("-my-1 shrink-0 rounded px-2 py-1 text-base leading-none opacity-80 hover:opacity-100", focusRing)}>
          ×
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--line)] px-4 py-6 text-center">
      <p className="text-sm font-medium text-[var(--text)]">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted)]">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("rounded bg-[var(--bg-2)] motion-safe:animate-pulse", className)} />;
}

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-[#0c1117] hover:brightness-110 border border-transparent",
  secondary: "border border-[var(--line)] bg-transparent text-[var(--text)] hover:bg-[var(--bg-2)]",
  danger: "border border-[var(--bad)]/70 bg-transparent text-[#ff9f9f] hover:bg-[var(--bad)]/12",
  ghost: "border border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--bg-2)] hover:text-[var(--text)]",
};

export function Button({ variant = "secondary", busy, busyText, className, children, disabled, ...rest }: ComponentProps<"button"> & { variant?: Variant; busy?: boolean; busyText?: string }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-semibold transition-colors sm:min-h-9", "disabled:cursor-not-allowed disabled:opacity-50", variants[variant], focusRing, className)}
    >
      {busy && <span aria-hidden="true" className="size-3 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />}
      {busy && busyText ? busyText : children}
    </button>
  );
}

/* ---------- Fields ---------- */

type FieldAria = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

export function Field({ label, hint, error, optional, children }: { label: string; hint?: ReactNode; error?: string | null; optional?: boolean; children: (aria: FieldAria) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="block min-w-0">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-[var(--text)]">
        {label}
        {optional && <span className="ml-1 font-normal text-[var(--muted)]">(optional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && <p id={hintId} className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
      {error && <p id={errorId} className="mt-1 text-xs font-medium text-[#ff9f9f]">{error}</p>}
    </div>
  );
}

export const inputClass = cx(
  "block min-h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-sm text-[var(--text)] sm:min-h-9",
  "placeholder:text-[var(--muted)]/70 aria-[invalid=true]:border-[var(--bad)] disabled:opacity-60",
  focusRing,
);

export function TextInput({ label, hint, error, optional, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; optional?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {(aria) => <input {...rest} {...aria} className={cx(inputClass, className)} />}
    </Field>
  );
}

/* ---------- Addresses & confirmation ---------- */

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => undefined);
      }}
      className={cx("shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--bg-2)] hover:text-[var(--text)]", focusRing)}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Address({ value, full, copy = true, label = "Copy address" }: { value: string; full?: boolean; copy?: boolean; label?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 align-middle">
      <span title={value} className={cx("mono text-sm", full && "break-all")}>{full ? value : shortAddress(value)}</span>
      {copy && <CopyButton value={value} label={label} />}
    </span>
  );
}

/** Two-step confirmation shown in place of the trigger. Focus moves to Cancel so Escape/Enter stay safe. */
export function ConfirmInline({ trigger, message, confirmLabel = "Confirm", tone = "danger", busy, onConfirm }: { trigger: string; message: ReactNode; confirmLabel?: string; tone?: "danger" | "warn"; busy?: boolean; onConfirm: () => void | Promise<unknown> }) {
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
    return (
      <Button ref={triggerRef} variant={tone === "danger" ? "danger" : "secondary"} onClick={() => setOpen(true)} disabled={busy}>
        {trigger}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Confirm: ${trigger}`} onKeyDown={(event) => event.key === "Escape" && setOpen(false)} className={cx("w-full rounded-md border p-3", tone === "danger" ? "border-[var(--bad)]/60 bg-[var(--bad)]/8" : "border-[var(--warn)]/55 bg-[var(--warn)]/8")}>
      <p className="mb-2 text-sm">{message}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant={tone === "danger" ? "danger" : "secondary"} busy={busy} busyText="Working…" onClick={async () => { await onConfirm(); setOpen(false); }}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
