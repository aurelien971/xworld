"use client";

import { useMemo, useState } from "react";
import type { Origin, Scope, SettingView } from "@/factory/tuning";
import { Button, cx } from "./primitives";

/**
 * A format's dials. Change one or several, then say how far the change
 * reaches: this post, every post of the format, or every format that has
 * the dial. A dial that was set somewhere says where, and can be put back.
 */
type Props = {
  formatName: string;
  settings: SettingView[];
  /** How far a change may reach from here, narrowest first. */
  scopes: Scope[];
  /** Posts not out yet, by format, and which formats have each dial: what a change would make again. */
  posts: Record<string, number>;
  uses: Record<string, string[]>;
  formatId: string;
  busy: boolean;
  onApply: (changes: Record<string, number | string | null>, scope: Scope) => void;
};

const FROM: Record<Origin, string> = { default: "", all: "set for everything", format: "set for this format", post: "set for this post" };
const field = "h-7 rounded-md border border-line-2 bg-transparent px-2 font-mono text-xs text-ink outline-none transition-colors duration-150 focus:border-ink";

export function Tuning({ formatName, settings, scopes, posts, uses, formatId, busy, onApply }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const changes = useMemo(() => {
    const out: Record<string, number | string> = {};
    for (const s of settings) {
      const raw = draft[s.id];
      if (raw == null || raw === "" || raw === String(s.value)) continue;
      out[s.id] = s.kind === "number" ? Number(raw) : raw;
    }
    return out;
  }, [draft, settings]);
  const keys = Object.keys(changes);
  const reach = (scope: Scope) => (scope === "post" ? 1 : scope === "format" ? (posts[formatId] ?? 0) : [...new Set(keys.flatMap((k) => uses[k] ?? []))].reduce((n, f) => n + (posts[f] ?? 0), 0));
  const apply = (scope: Scope) => {
    onApply(changes, scope);
    setDraft({});
  };

  return (
    <div>
      <ul className="grid gap-y-1.5">
        {settings.map((s) => (
          <li key={s.id} className="grid grid-cols-[112px_auto_minmax(0,1fr)] items-center gap-x-3">
            <label htmlFor={`${formatId}-${s.id}`} title={s.help} className="truncate text-ink-2">
              {s.label}
            </label>
            {s.kind === "number" ? (
              <span className="flex items-center gap-1.5">
                <input
                  id={`${formatId}-${s.id}`}
                  type="number"
                  inputMode="decimal"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={draft[s.id] ?? String(s.value)}
                  onChange={(e) => setDraft((d) => ({ ...d, [s.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && keys.length > 0 && !busy && apply(scopes[0])}
                  className={cx(field, "w-[68px] tabular-nums", s.id in changes && "border-ink")}
                />
                <span className="w-3 font-mono text-2xs text-ink-3">{s.unit}</span>
              </span>
            ) : (
              <select id={`${formatId}-${s.id}`} value={draft[s.id] ?? String(s.value)} onChange={(e) => setDraft((d) => ({ ...d, [s.id]: e.target.value }))} className={cx(field, "w-[124px] font-sans", s.id in changes && "border-ink")}>
                {s.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <span className="truncate text-2xs text-ink-3">
              {FROM[s.from]}
              {s.from !== "default" && scopes.includes(s.from as Scope) && (
                <button disabled={busy} onClick={() => onApply({ [s.id]: null }, s.from as Scope)} className="ml-2 underline decoration-line-2 underline-offset-2 transition-colors duration-150 hover:text-ink">
                  put back
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {(keys.length > 0 || busy) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {busy ? (
            <span className="text-xs text-ink-2">Making it again…</span>
          ) : (
            <>
              <span className="text-xs text-ink-3">Apply to</span>
              {scopes.map((scope, i) => (
                <Button key={scope} tone={i === 0 ? "primary" : "quiet"} onClick={() => apply(scope)}>
                  {scope === "post" ? "This post" : scope === "format" ? formatName : "Every format"}
                  {scope !== "post" && <span className="ml-1.5 font-mono text-2xs tabular-nums opacity-60">{reach(scope)}</span>}
                </Button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
