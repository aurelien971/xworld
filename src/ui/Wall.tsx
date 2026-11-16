"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import type { BriefView, WallView } from "@/factory/view";
import { cx } from "./primitives";

/**
 * The wall: every post the product has, as one field of covers. What is
 * ready or out is at full strength; what is still being made or was turned
 * down sits back. The two numbers above it are the ones that matter: how
 * many are ready to go, and how many are out.
 */
type Show = "all" | "ready" | "posted" | "review";
const FILTERS: [Show, string][] = [["all", "All"], ["ready", "Ready"], ["posted", "Posted"], ["review", "To review"]];
const matches = (b: BriefView, show: Show) => show === "all" || (show === "ready" && b.state === "ready") || (show === "posted" && b.state === "published") || (show === "review" && b.needsPerson);
const cover = (b: BriefView) => b.slides[0]?.thumb ?? b.before;

export function Wall({ wall, selected, onSelect }: { wall: WallView | null; selected: string | null; onSelect: (id: string) => void }) {
  const [show, setShow] = useState<Show>("all");
  const tiles = useMemo(() => (wall?.briefs ?? []).filter((b) => matches(b, show)), [wall, show]);
  const c = wall?.counts;

  return (
    <div className="px-4 pt-7 pb-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <dl className="flex gap-10">
          {([["Ready", c?.ready], ["Posted", c?.posted], ["Made", c?.made]] as const).map(([label, n], i) => (
            <div key={label}>
              <dd className={cx("font-mono text-xl tabular-nums", i === 2 && "text-ink-3")}>{n == null ? " " : n.toLocaleString("en-GB")}</dd>
              <dt className="mt-0.5 text-xs text-ink-3">{label}</dt>
            </div>
          ))}
        </dl>
        <div className="flex gap-0.5" role="tablist" aria-label="Show">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={show === id}
              onClick={() => setShow(id)}
              className={cx("rounded-md px-2 py-1 text-xs transition-colors duration-150 ease-out", show === id ? "bg-wash text-ink" : "text-ink-3 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {wall && tiles.length === 0 ? (
        <p className="mt-12 text-ink-2">{show === "all" ? "Nothing has been made yet." : "Nothing here yet."}</p>
      ) : (
        <ol className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1">
          {tiles.map((b) => {
            const strong = b.state === "ready" || b.state === "published";
            const src = cover(b);
            return (
              <li key={b.id} data-id={b.id}>
                <button
                  onClick={() => onSelect(b.id)}
                  aria-current={b.id === selected}
                  aria-label={`${b.hook}, ${b.needsPerson ? "needs review" : b.rejected ? "rejected" : b.state}`}
                  className={cx(
                    "relative block aspect-[4/5] w-full overflow-hidden rounded-sm bg-wash transition-opacity duration-150 ease-out",
                    strong ? "opacity-100" : "opacity-35 hover:opacity-100",
                    b.id === selected && "opacity-100 ring-[1.5px] ring-ink ring-offset-2 ring-offset-paper",
                  )}
                >
                  {src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  )}
                  {b.state === "published" && (
                    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-surface text-ink">
                      <Check size={10} strokeWidth={2.75} />
                    </span>
                  )}
                  {b.needsPerson && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent ring-2 ring-surface" />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
