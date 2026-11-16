"use client";

import { useEffect, useState } from "react";
import type { CampaignView } from "@/factory/campaign";
import { cx, money } from "./primitives";

/**
 * The campaign at a glance: each thing it needs, how far along it is, and
 * what to do next, most useful first. Every number is counted.
 */
export function Campaign({ product, onOpen }: { product: string; onOpen: (view: string) => void }) {
  const [view, setView] = useState<CampaignView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/campaign?product=${product}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setView(d)), () => setError("The campaign could not be read."));
    load();
    const timer = window.setInterval(load, 20_000);
    return () => window.clearInterval(timer);
  }, [product]);

  if (error) return <p role="alert" className="px-4 pt-7 text-accent sm:px-6">{error}</p>;
  return (
    <div className="grid gap-x-16 gap-y-10 px-4 pt-7 pb-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <section aria-label="Progress">
        <ul className="grid gap-y-6">
          {(view?.measures ?? []).map((m) => {
            const share = m.target ? Math.min(1, m.value / m.target) : 0;
            return (
              <li key={m.id}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-base">{m.label}</span>
                  <span className="font-mono tabular-nums">
                    {m.value.toLocaleString("en-GB")}
                    <span className="text-ink-3"> / {m.target.toLocaleString("en-GB")}</span>
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={m.value} aria-valuemin={0} aria-valuemax={m.target} aria-label={m.label}>
                  <div className="h-full rounded-full bg-ink transition-[width] duration-200 ease-out" style={{ width: `${share * 100}%`, minWidth: m.value > 0 ? 4 : 0 }} />
                </div>
                <p className="mt-1.5 text-xs text-ink-3">{m.note}</p>
              </li>
            );
          })}
        </ul>
        {view && (
          <p className="mt-8 font-mono text-2xs text-ink-3">
            {view.totals.views == null ? "no views yet" : `${view.totals.views.toLocaleString("en-GB")} views`} · {money(view.totals.spent)} spent · {view.totals.ads} finished ads brought in from Opaque Ads
          </p>
        )}
      </section>

      <section aria-label="Next">
        <h2 className="text-xs text-ink-3">Next</h2>
        <ol className="mt-3 border-t border-line">
          {(view?.next ?? []).map((s, i) => (
            <li key={s.title} className="border-b border-line">
              <button
                onClick={() => s.view && onOpen(s.view)}
                disabled={!s.view}
                className={cx("grid w-full grid-cols-[20px_1fr] gap-x-3 py-3.5 text-left transition-colors duration-150 ease-out", s.view && "hover:bg-wash")}
              >
                <span className="font-mono text-2xs leading-5 text-ink-3 tabular-nums">{i + 1}</span>
                <span>
                  <span className={cx("block", i === 0 && "text-accent")}>{s.title}</span>
                  <span className="mt-0.5 block text-ink-2">{s.detail}</span>
                </span>
              </button>
            </li>
          ))}
          {view && view.next.length === 0 && <li className="py-3.5 text-ink-2">Nothing is waiting on you.</li>}
        </ol>
      </section>
    </div>
  );
}
