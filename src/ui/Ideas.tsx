"use client";

import { useEffect, useMemo, useState } from "react";
import type { ideasView } from "@/factory/campaign";
import { Button, cx } from "./primitives";

/**
 * Every content idea written for the campaign. Nothing is used until it is
 * approved: an approved idea becomes a post the next time a day is planned.
 * A to approve, X to reject, J and K to move.
 */
type View = Awaited<ReturnType<typeof ideasView>>;
type IdeaRow = View["ideas"][number];
const SHOW = ["draft", "approved", "used", "rejected"] as const;

export function Ideas({ product }: { product: string }) {
  const [view, setView] = useState<View | null>(null);
  const [persona, setPersona] = useState<string>("all");
  const [show, setShow] = useState<(typeof SHOW)[number]>("draft");
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/ideas?product=${product}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setView(d)), () => setError("The ideas could not be read."));
  }, [product]);

  const list = useMemo(() => (view?.ideas ?? []).filter((i) => i.state === show && (persona === "all" || i.persona === persona)), [view, show, persona]);
  const count = (state: string) => (view?.ideas ?? []).filter((i) => i.state === state && (persona === "all" || i.persona === persona)).length;

  const set = async (body: { ids?: string[]; persona?: string; state: string }) => {
    // The row leaves the list at once; the answer then confirms it.
    if (body.ids) setView((v) => v && { ...v, ideas: v.ideas.map((i) => (body.ids!.includes(i.id) ? { ...i, state: body.state } : i)) });
    const res = await fetch(`/api/ideas?product=${product}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (res.ok) setView(data);
    else setError(data?.error ?? "That didn't work.");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const idea: IdeaRow | undefined = list[Math.min(at, list.length - 1)];
      if (e.key === "j" || e.key === "ArrowDown") setAt((n) => Math.min(list.length - 1, n + 1));
      else if (e.key === "k" || e.key === "ArrowUp") setAt((n) => Math.max(0, n - 1));
      else if (e.key === "a" && idea && show !== "used") set({ ids: [idea.id], state: "approved" });
      else if (e.key === "x" && idea && show !== "used") set({ ids: [idea.id], state: "rejected" });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    document.querySelector(`[data-idea="${list[Math.min(at, list.length - 1)]?.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at, list]);

  const cursor = Math.min(at, Math.max(0, list.length - 1));
  return (
    <div className="px-4 pt-7 pb-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="flex flex-wrap gap-0.5" role="tablist" aria-label="Persona">
          {[{ id: "all", name: "Everyone" }, ...(view?.personas ?? [])].map((p) => (
            <button key={p.id} role="tab" aria-selected={persona === p.id} onClick={() => { setPersona(p.id); setAt(0); }} className={cx("rounded-md px-2 py-1 text-xs transition-colors duration-150 ease-out", persona === p.id ? "bg-wash text-ink" : "text-ink-3 hover:text-ink")}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5" role="tablist" aria-label="Show">
            {SHOW.map((s) => (
              <button key={s} role="tab" aria-selected={show === s} onClick={() => { setShow(s); setAt(0); }} className={cx("rounded-md px-2 py-1 text-xs capitalize transition-colors duration-150 ease-out", show === s ? "bg-wash text-ink" : "text-ink-3 hover:text-ink")}>
                {s === "draft" ? "To read" : s} <span className="font-mono tabular-nums">{view ? count(s) : ""}</span>
              </button>
            ))}
          </div>
          {show === "draft" && persona !== "all" && list.length > 0 && <Button onClick={() => set({ persona, state: "approved" })}>Approve all {list.length}</Button>}
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-accent">{error}</p>}
      {view && list.length === 0 && <p className="mt-12 text-ink-2">{show === "draft" ? "Nothing left to read here." : "Nothing here yet."}</p>}

      <ol className="mt-5 border-t border-line">
        {list.map((i, n) => (
          <li key={i.id} data-idea={i.id}>
            <div
              onClick={() => setAt(n)}
              className={cx("grid cursor-default gap-x-6 gap-y-1 border-b border-line py-3 pr-2 pl-3 transition-colors duration-150 ease-out md:grid-cols-[minmax(0,1fr)_200px_auto]", n === cursor ? "bg-surface shadow-[inset_2px_0_0_var(--color-ink)]" : "hover:bg-wash")}
            >
              <div className="min-w-0">
                <p className="text-base">{i.hook}</p>
                {i.text && <p className="mt-0.5 text-ink">“{i.text}”</p>}
                <p className="mt-0.5 text-ink-2">{i.caption}</p>
                {i.why && <p className="mt-1 text-xs text-ink-3">{i.why}</p>}
              </div>
              <div className="min-w-0 text-xs text-ink-3">
                <p className="text-ink-2">{i.formatName}</p>
                <p>{view?.personas.find((p) => p.id === i.persona)?.name} · {i.pillar}</p>
                {i.filter && <p className={i.waits ? "text-accent" : undefined}>{i.filter}{i.waits ? ", not generated yet" : ""}</p>}
              </div>
              {show !== "used" && (
                <div className={cx("flex items-start gap-2", n !== cursor && "md:invisible")}>
                  {show !== "approved" && <Button tone="primary" hint="A" onClick={() => set({ ids: [i.id], state: "approved" })}>Approve</Button>}
                  {show !== "rejected" && <Button hint="X" onClick={() => set({ ids: [i.id], state: "rejected" })}>Reject</Button>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
