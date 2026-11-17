"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormatsView, Scope } from "@/factory/tuning";
import { Tuning } from "./Tuning";

/**
 * The formats, as what they are: each one a combination of six criteria,
 * read off its recipe. The grid shows which combinations are in play and
 * which are open; under it, every format with its dials. A dial can be set
 * for one format or for every format that has it.
 */
export function Formats({ product }: { product: string }) {
  const [view, setView] = useState<FormatsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(
    () => fetch(`/api/formats?product=${product}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setView(d)), () => setError("The formats could not be read.")),
    [product],
  );
  useEffect(() => {
    read();
  }, [read]);
  // While posts are being made again, keep counting them down.
  const remaking = view?.remaking ?? 0;
  useEffect(() => {
    if (!remaking) return;
    const timer = window.setInterval(read, 2500);
    return () => window.clearInterval(timer);
  }, [remaking, read]);

  const apply = async (format: string, changes: Record<string, number | string | null>, scope: Scope) => {
    setBusy(format);
    const res = await fetch(`/api/formats?product=${product}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format, scope, changes }) });
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      setView(data);
      setError(null);
    } else setError(data?.error || "That didn't work.");
    setBusy(null);
  };

  if (!view) return <div className="px-4 pt-7 sm:px-6">{error && <p role="alert" className="text-accent">{error}</p>}</div>;
  const axis = (id: string) => view.axes.find((a) => a.id === id)!;
  const reveal = axis("reveal"), subject = axis("subject");
  const others = view.axes.filter((a) => a.id !== "reveal" && a.id !== "subject");
  const cells = Object.keys(reveal.values).length * Object.keys(subject.values).length;
  const filled = new Set(view.formats.map((f) => `${f.criteria.reveal}|${f.criteria.subject}`)).size;

  return (
    <div className="px-4 pt-7 pb-10 sm:px-6">
      <p className="max-w-[640px] text-ink-2">
        A format is one combination of six criteria: the medium, what it compares, how the result arrives, how it opens, its pace and how it ends. The combination is read off the recipe, so it is always what is actually made.
      </p>
      <p className="mt-2 font-mono text-2xs text-ink-3 tabular-nums">
        {view.formats.length} formats · {filled} of {cells} reveal × comparison cells in play
        {remaking > 0 && <span className="text-ink"> · {remaking} {remaking === 1 ? "post is" : "posts are"} being made again</span>}
      </p>
      {error && <p role="alert" className="mt-4 text-accent">{error}</p>}

      <div className="scroll-quiet mt-6 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr>
              <th className="w-28 border-b border-line py-2 text-xs font-normal text-ink-3">Reveal</th>
              {Object.entries(subject.values).map(([id, label]) => (
                <th key={id} className="border-b border-line py-2 pr-4 text-xs font-normal text-ink-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(reveal.values).map(([r, label]) => (
              <tr key={r} className="align-top">
                <th className="border-b border-line py-3 text-sm font-normal">{label}</th>
                {Object.keys(subject.values).map((s) => {
                  const here = view.formats.filter((f) => f.criteria.reveal === r && f.criteria.subject === s);
                  return (
                    <td key={s} className="border-b border-line py-3 pr-4">
                      {here.length === 0 ? (
                        <span className="text-ink-3">Open</span>
                      ) : (
                        <ul className="grid gap-y-1.5">
                          {here.map((f) => (
                            <li key={f.id}>
                              <a href={`#${f.id}`} className="underline decoration-line-2 underline-offset-2 transition-colors duration-150 hover:decoration-ink">
                                {f.name}
                              </a>
                              <span className="block font-mono text-2xs text-ink-3">{others.map((a) => f.criteria[a.id]).filter((v) => v !== "none").join(" · ")}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-8 border-t border-line">
        {view.formats.map((f) => (
          <li key={f.id} id={f.id} className="grid scroll-mt-4 gap-x-10 gap-y-4 border-b border-line py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-base">{f.name}</p>
              <p className="mt-0.5 font-mono text-2xs text-ink-3">{f.code}</p>
              <dl className="mt-3 grid grid-cols-[88px_1fr] gap-y-0.5">
                {view.axes.filter((a) => f.criteria[a.id] !== "none").map((a) => (
                  <div key={a.id} className="contents">
                    <dt className="text-xs text-ink-3">{a.label}</dt>
                    <dd className="text-ink-2">{(a.values as Record<string, string>)[f.criteria[a.id]]}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 font-mono text-2xs text-ink-3 tabular-nums">
                {f.size} · {f.platforms.join(", ")} · {f.made} made, {f.waiting} not out
              </p>
              {f.twin && <p className="mt-2 text-accent">Now the same combination as {f.twin}.</p>}
            </div>
            <Tuning formatId={f.id} formatName="This format" settings={f.settings} scopes={["format", "all"]} posts={view.posts} uses={view.uses} busy={busy === f.id} onApply={(changes, scope) => apply(f.id, changes, scope)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
