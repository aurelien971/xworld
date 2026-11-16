"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { libraryView } from "@/factory/campaign";
import { cx } from "./primitives";

/**
 * Everything the posts are made from. Source photos are used only once
 * approved: click one to let it in or take it out. The finished ads brought
 * in from Opaque Ads are here to look at.
 */
type View = Awaited<ReturnType<typeof libraryView>>;
const SHOW = [["waiting", "To look at"], ["approved", "In use"], ["ads", "Opaque Ads"]] as const;
const SOURCE: Record<string, string> = { opaqueads: "Opaque Ads", "mitsushiro-models": "Mitsushiro models", "mitsushiro-catalog": "Mitsushiro catalog" };

export function Library({ product }: { product: string }) {
  const [view, setView] = useState<View | null>(null);
  const [show, setShow] = useState<(typeof SHOW)[number][0]>("waiting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/library?product=${product}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setView(d)), () => setError("The library could not be read."));
  }, [product]);

  const of = (s: string) => (view ?? []).filter((a) => (s === "ads" ? a.kind === "ad" : a.kind === "photo" && a.approved === (s === "approved")));
  const list = useMemo(() => of(show), [view, show]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (id: string, approved: boolean) => {
    setView((v) => v && v.map((a) => (a.id === id ? { ...a, approved } : a)));
    const res = await fetch(`/api/library?product=${product}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, approved }) });
    if (!res.ok) setError("That didn't work.");
  };

  return (
    <div className="px-4 pt-7 pb-10 sm:px-6">
      <div className="flex gap-0.5" role="tablist" aria-label="Show">
        {SHOW.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={show === id} onClick={() => setShow(id)} className={cx("rounded-md px-2 py-1 text-xs transition-colors duration-150 ease-out", show === id ? "bg-wash text-ink" : "text-ink-3 hover:text-ink")}>
            {label} <span className="font-mono tabular-nums">{view ? of(id).length : ""}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 text-accent">{error}</p>}
      {view && list.length === 0 && <p className="mt-12 text-ink-2">Nothing here.</p>}

      <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-x-1 gap-y-4">
        {list.map((a) => (
          <li key={a.id}>
            {a.kind === "ad" ? (
              <div className="aspect-[9/16] overflow-hidden rounded-sm bg-wash">
                {a.video ? <video src={a.url} preload="none" controls muted playsInline className="size-full object-cover" /> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.url} alt="" loading="lazy" className="size-full object-cover" />}
              </div>
            ) : (
              <button onClick={() => toggle(a.id, !a.approved)} aria-pressed={a.approved} aria-label={a.approved ? "Take out of use" : "Approve for use"} className="group relative block aspect-[3/4] w-full overflow-hidden rounded-sm bg-wash">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt="" loading="lazy" decoding="async" className={cx("size-full object-cover transition-opacity duration-150 ease-out", !a.approved && "opacity-60 group-hover:opacity-100")} />
                {a.approved && (
                  <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-surface text-ink">
                    <Check size={10} strokeWidth={2.75} />
                  </span>
                )}
              </button>
            )}
            <p className="mt-1 truncate text-xs text-ink-3">
              {a.kind === "ad" ? (a.template ?? a.tags[0]) : `${SOURCE[a.source] ?? a.source}${a.results ? ` · ${a.results} results` : ""}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
