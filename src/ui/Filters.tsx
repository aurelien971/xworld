"use client";

import { useEffect, useMemo, useState } from "react";
import type { filtersView } from "@/factory/campaign";
import { cx } from "./primitives";

/**
 * The filters, with nothing hidden: every prompt in full, what was seen of
 * each one's real results, what was rewritten and why, and the new ones
 * written for this campaign. A filter is only planned once it is switched on.
 */
type View = Awaited<ReturnType<typeof filtersView>>;
const VERDICT: Record<string, string> = { strong: "Strong", usable: "Usable", mixed: "Mixed", weak: "Weak" };
const SHOW = ["new", "tested", "rewritten", "all"] as const;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

export function Filters({ product }: { product: string }) {
  const [view, setView] = useState<View | null>(null);
  const [show, setShow] = useState<(typeof SHOW)[number]>("new");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/filters?product=${product}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setView(d)), () => setError("The filters could not be read."));
  }, [product]);

  const list = useMemo(
    () => (view ?? []).filter((f) => (show === "new" ? f.origin === "lab" : show === "tested" ? f.results > 0 : show === "rewritten" ? f.variations.some((v) => v.replaces) : true)),
    [view, show],
  );
  const n = (s: (typeof SHOW)[number]) => (view ?? []).filter((f) => (s === "new" ? f.origin === "lab" : s === "tested" ? f.results > 0 : s === "rewritten" ? f.variations.some((v) => v.replaces) : true)).length;

  const toggle = async (id: string, approved: boolean) => {
    setView((v) => v && v.map((f) => (f.id === id ? { ...f, approved } : f)));
    const res = await fetch(`/api/filters?product=${product}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, approved }) });
    if (!res.ok) setError("That didn't work.");
  };

  return (
    <div className="px-4 pt-7 pb-10 sm:px-6">
      <div className="flex gap-0.5" role="tablist" aria-label="Show">
        {SHOW.map((s) => (
          <button key={s} role="tab" aria-selected={show === s} onClick={() => setShow(s)} className={cx("rounded-md px-2 py-1 text-xs capitalize transition-colors duration-150 ease-out", show === s ? "bg-wash text-ink" : "text-ink-3 hover:text-ink")}>
            {s} <span className="font-mono tabular-nums">{view ? n(s) : ""}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 text-accent">{error}</p>}

      <ul className="mt-5 border-t border-line">
        {list.map((f) => (
          <li key={f.id} className="grid gap-x-10 gap-y-3 border-b border-line py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-base">{f.name}</p>
              <p className="text-ink-2">{f.benefit}</p>
              <p className="mt-2 font-mono text-2xs text-ink-3">
                {f.id} · {f.origin === "lab" ? "new" : "from the app"} · {f.results} {f.results === 1 ? "result" : "results"}
              </p>
              <p className="mt-1 font-mono text-2xs tabular-nums">
                {f.tested ? (
                  <span className="text-ink">
                    tested {day(f.tested)}
                    {f.score != null && ` · reviewer ${f.score}`}
                  </span>
                ) : (
                  <span className="text-ink-3">not tested yet</span>
                )}
              </p>
              {f.audit && (
                <p className="mt-3">
                  <span className={cx("text-xs", f.audit.verdict === "weak" ? "text-accent" : "text-ink")}>{VERDICT[f.audit.verdict]}</span>
                  <span className="mt-0.5 block text-ink-2">{f.audit.note}</span>
                </p>
              )}
              {f.why && <p className="mt-3 text-ink-2">{f.why}</p>}
              <label className="mt-3 flex items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={f.approved} onChange={(e) => toggle(f.id, e.target.checked)} className="accent-ink" />
                Used in posts
              </label>
            </div>

            <div className="grid min-w-0 gap-y-5">
              {f.variations.map((v) => (
                <div key={v.id} className="grid gap-x-6 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="text-xs">
                      <span className={v.weak ? "text-ink-3 line-through" : "text-ink"}>{v.label}</span>
                      {v.weak && <span className="ml-2 text-accent">weak, not planned</span>}
                      {v.replaces && <span className="ml-2 text-ink-3">rewrite of {v.replaces}</span>}
                      {v.results === 0 && <span className="ml-2 text-ink-3">never generated</span>}
                      {v.results > 0 && (
                        <span className="ml-2 font-mono text-2xs text-ink-3 tabular-nums">
                          {v.results} {v.results === 1 ? "result" : "results"}
                          {v.score != null && ` · reviewer avg ${v.score}`}
                        </span>
                      )}
                    </p>
                    {v.why && <p className="mt-1 text-ink-2">{v.why}</p>}
                    <p className="mt-1.5 font-mono text-2xs leading-[18px] text-ink-2">{v.prompt}</p>
                  </div>
                  {v.examples.length > 0 && (
                    <div className="flex gap-2">
                      {v.examples.map((e) => (
                        <div key={e.after} title={e.note ?? undefined}>
                          <div className="flex gap-px overflow-hidden rounded-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={e.before} alt="Before" loading="lazy" className="aspect-[3/4] w-16 object-cover" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={e.after} alt="After" loading="lazy" className="aspect-[3/4] w-16 object-cover" />
                          </div>
                          {e.score != null && <p className="mt-1 font-mono text-2xs text-ink-3 tabular-nums">{e.score}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
