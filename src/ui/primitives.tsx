"use client";

import { Check, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { State } from "@/factory/types";

/** The primitives. Five of them; every part of the screen is made of these and plain elements. */

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const money = (usd: number) => (usd === 0 ? "$0.00" : usd < 0.1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ml-2 font-mono text-2xs opacity-50">{children}</kbd>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "quiet"; hint?: string };
export function Button({ tone = "quiet", hint, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex h-7 items-center rounded-md px-2.5 text-sm font-medium transition-[background-color,border-color,opacity] duration-150 ease-out disabled:opacity-40",
        tone === "primary" ? "bg-ink text-paper hover:bg-ink/85 active:bg-ink/75" : "border border-line-2 text-ink hover:bg-wash active:bg-line",
        className,
      )}
    >
      {children}
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...rest} aria-label={label} title={label} className={cx("inline-flex size-7 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 ease-out hover:bg-wash hover:text-ink disabled:opacity-30", className)}>
      {children}
    </button>
  );
}

const LABEL: Record<State, string> = { planned: "Planned", generating: "Generating", reviewing: "Reviewing", ready: "Ready", published: "Published", failed: "Failed" };

/** A brief's state: a mark and a word. The accent appears only when the brief is waiting on a person. */
export function StateMark({ state, needsPerson, rejected, className }: { state: State; needsPerson?: boolean; rejected?: boolean; className?: string }) {
  const attention = (state === "failed" && !rejected) || needsPerson;
  const working = state === "generating" || (state === "reviewing" && !needsPerson);
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs whitespace-nowrap", attention ? "text-accent" : state === "planned" || rejected ? "text-ink-3" : "text-ink", className)}>
      <span className="flex size-3 items-center justify-center" aria-hidden>
        {state === "published" ? (
          <Check size={12} strokeWidth={2.25} />
        ) : state === "failed" ? (
          <X size={12} strokeWidth={2.25} />
        ) : (
          <span className={cx("size-1.5 rounded-full", state === "planned" ? "border border-ink-3" : attention ? "bg-accent" : "bg-ink", working && "working")} />
        )}
      </span>
      {needsPerson ? "Needs review" : rejected ? "Rejected" : LABEL[state]}
    </span>
  );
}

/** A labelled row in the detail pane: the label in a fixed gutter, the content beside it. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-x-4 border-t border-line py-3.5">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
