"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "@/factory/types";
import type { BriefDetail, BriefView, DayView, WallView } from "@/factory/view";
import { Detail } from "./Detail";
import { Button, cx, IconButton, money, StateMark } from "./primitives";
import { Wall } from "./Wall";

/**
 * The factory floor: one day of one product. A header that says which day
 * and how it is going, the day's briefs as a production queue, and the
 * selected brief in full beside it. Everything is reachable from the keyboard.
 */

const shift = (day: string, by: number) => new Date(Date.parse(`${day}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const longDate = (day: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const working = (b: BriefView) => b.state === "generating" || (b.state === "reviewing" && !b.needsPerson);
const firstOfInterest = (v: DayView) => (v.briefs.find((b) => b.needsPerson || b.state === "failed") ?? v.briefs[0])?.id ?? null;

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "That didn't work. Try again.");
  return data as T;
}

export function Floor({ initial }: { initial: DayView }) {
  const [view, setView] = useState(initial);
  const [selected, setSelected] = useState<string | null>(() => firstOfInterest(initial));
  const [detail, setDetail] = useState<BriefDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"plan" | "run" | "day" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const request = useRef(0);
  const list = useRef<HTMLOListElement>(null);

  const [mode, setMode] = useState<"day" | "wall">("day");
  const [wall, setWall] = useState<WallView | null>(null);

  // What is on screen: the day's briefs, or every brief on the wall.
  const source = useMemo(() => (mode === "wall" ? (wall?.briefs ?? []) : view.briefs), [mode, wall, view]);
  const current = useMemo(() => source.find((b) => b.id === selected) ?? null, [source, selected]);
  const active = source.some(working) || view.briefs.some(working) || busy === "run";

  const loadWall = useCallback(() => call<WallView>("/api/wall").then(setWall, (e) => setError((e as Error).message)), []);

  /** Read a day. Only the newest request may land, so a slow answer never overwrites a newer one. */
  const load = useCallback(async (day: string, opts: { select?: boolean } = {}) => {
    const mine = ++request.current;
    try {
      const next = await call<DayView>(`/api/day?day=${day}`);
      if (mine !== request.current) return;
      setView(next);
      setError(null);
      if (opts.select) setSelected(firstOfInterest(next));
    } catch (e) {
      if (mine === request.current) setError((e as Error).message);
    }
  }, []);

  const goTo = useCallback(
    async (day: string) => {
      setBusy("day");
      window.history.replaceState(null, "", day === view.today ? "/" : `/?day=${day}`);
      await load(day, { select: true });
      setSlide(0);
      setBusy(null);
    },
    [load, view.today],
  );

  // Keep the day fresh: often while something is being made, rarely otherwise, never in a hidden tab.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      load(view.day);
      if (mode === "wall") loadWall();
    };
    const timer = window.setInterval(tick, active ? 1200 : 20_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, load, loadWall, mode, view.day]);

  const toggleMode = useCallback(() => {
    setMode((m) => {
      if (m === "day") loadWall();
      return m === "day" ? "wall" : "day";
    });
    setOpen(false);
  }, [loadWall]);

  // The selected brief in full, read again whenever it changes.
  const stamp = current?.updatedAt;
  useEffect(() => {
    if (!selected) return;
    let live = true;
    call<BriefDetail>(`/api/briefs/${selected}`).then((d) => live && setDetail(d), () => {});
    return () => {
      live = false;
    };
  }, [selected, stamp]);

  const select = useCallback((id: string, show = false) => {
    setSelected(id);
    setSlide(0);
    if (show) setOpen(true);
  }, []);

  const dayAction = useCallback(
    async (action: "plan" | "run") => {
      setBusy(action);
      try {
        const next = await call<DayView>(`/api/day?day=${view.day}`, { action });
        setView(action === "run" ? { ...next, briefs: next.briefs.map((b) => (b.state === "planned" ? { ...b, state: "generating" as State } : b)) } : next);
        if (action === "plan") setSelected(firstOfInterest(next));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy(null);
    },
    [view.day],
  );

  /** A person's action on a brief. The row changes at once; the server's answer then confirms or corrects it. */
  const act = useCallback(
    async (id: string, action: "approve" | "reject" | "retry") => {
      const to: State = action === "approve" ? "ready" : action === "reject" ? "failed" : "generating";
      const apply = (list: BriefView[]) => list.map((b) => (b.id === id ? { ...b, state: to, needsPerson: false, rejected: action === "reject", error: null } : b));
      setView((v) => ({ ...v, briefs: apply(v.briefs) }));
      setWall((w) => (w ? { ...w, briefs: apply(w.briefs) } : w));
      if (action !== "retry" && mode === "day") {
        const rest = view.briefs.filter((b) => b.id !== id && b.needsPerson);
        const after = rest.find((b) => b.seq > (current?.seq ?? 0)) ?? rest[0];
        if (after) select(after.id);
      }
      try {
        const d = await call<BriefDetail>(`/api/briefs/${id}`, { action });
        setDetail((prev) => (prev?.id === id ? d : prev));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
      load(view.day);
      if (mode === "wall") loadWall();
    },
    [current?.seq, load, loadWall, mode, select, view.briefs, view.day],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      const i = source.findIndex((b) => b.id === selected);
      const move = (by: number) => {
        const next = source[Math.max(0, Math.min(source.length - 1, i + by))];
        if (!next) return;
        select(next.id);
        document.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const slides = current?.slides.length ?? 0;
      const k = e.key;
      if (k === "j" || k === "ArrowDown") move(1);
      else if (k === "k" || k === "ArrowUp") move(-1);
      else if (k === "ArrowRight" && slides) setSlide((s) => Math.min(slides - 1, s + 1));
      else if (k === "ArrowLeft" && slides) setSlide((s) => Math.max(0, s - 1));
      else if (k === "a" && current?.needsPerson) act(current.id, "approve");
      else if (k === "x" && current?.needsPerson) act(current.id, "reject");
      else if (k === "r" && current?.state === "failed" && !current.rejected) act(current.id, "retry");
      else if (k === "g") toggleMode();
      else if (k === "[" && mode === "day") goTo(shift(view.day, -1));
      else if (k === "]" && mode === "day") goTo(shift(view.day, 1));
      else if (k === "t" && mode === "day" && view.day !== view.today) goTo(view.today);
      else if (k === "Enter" && current) setOpen(true);
      else if (k === "Escape") setOpen(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, current, goTo, mode, select, selected, source, toggleMode, view]);

  const s = view.summary;
  const planned = s.byState.planned;
  const stats: [string, string][] = [
    [String(s.briefs), s.briefs === 1 ? "brief" : "briefs"],
    [String(s.byState.ready), "ready"],
    [String(s.byState.published), "published"],
    [s.views == null ? "–" : s.views.toLocaleString("en-GB"), "views"],
    [money(s.costUsd), "spent"],
  ];

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line px-4 sm:gap-4 sm:px-6">
        <span className="font-medium">{view.product.name}</span>
        <span className="h-3.5 w-px bg-line-2" aria-hidden />
        <div className="flex gap-0.5" role="tablist" aria-label="View">
          {(["day", "wall"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              title={mode === m ? undefined : "G"}
              onClick={() => mode !== m && toggleMode()}
              className={cx("rounded-md px-2 py-1 text-xs capitalize transition-colors duration-150 ease-out", mode === m ? "bg-wash text-ink" : "text-ink-3 hover:text-ink")}
            >
              {m}
            </button>
          ))}
        </div>
        <div className={cx("flex items-center gap-1", mode === "wall" && "hidden")}>
          <IconButton label="Previous day  [" onClick={() => goTo(shift(view.day, -1))}>
            <ChevronLeft size={15} strokeWidth={1.75} />
          </IconButton>
          <h1 className="px-1 text-center whitespace-nowrap tabular-nums sm:min-w-44">{longDate(view.day)}</h1>
          <IconButton label="Next day  ]" onClick={() => goTo(shift(view.day, 1))}>
            <ChevronRight size={15} strokeWidth={1.75} />
          </IconButton>
          {view.day !== view.today && (
            <button onClick={() => goTo(view.today)} className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-ink-2 transition-colors duration-150 hover:bg-wash hover:text-ink">
              Today
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-6">
          {mode === "day" && s.briefs > 0 && (
            <dl className="hidden items-baseline gap-5 text-xs sm:flex">
              {stats.map(([value, label]) => (
                <div key={label} className="flex items-baseline gap-1.5">
                  <dd className="font-mono text-ink tabular-nums">{value}</dd>
                  <dt className="text-ink-3">{label}</dt>
                </div>
              ))}
            </dl>
          )}
          {mode === "day" && planned > 0 && (
            <Button tone="primary" disabled={busy === "run"} onClick={() => dayAction("run")}>
              Run {planned}
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="border-b border-line bg-surface px-6 py-2 text-xs text-accent">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 min-[1100px]:grid-cols-[minmax(0,1fr)_560px]">
        <main className={cx("scroll-quiet min-h-0 overflow-y-auto transition-opacity duration-150 ease-out", busy === "day" && "opacity-50")}>
          {mode === "wall" ? (
            <Wall wall={wall} selected={selected} onSelect={(id) => select(id, true)} />
          ) : view.briefs.length === 0 ? (
            <Empty view={view} busy={busy === "plan"} onPlan={() => dayAction("plan")} />
          ) : (
            <ol ref={list}>
              {view.briefs.map((b) => (
                <QueueRow key={b.id} brief={b} selected={b.id === selected} onSelect={() => select(b.id, true)} />
              ))}
            </ol>
          )}
        </main>

        {current && (
          <Detail
            brief={current}
            detail={detail?.id === current.id ? detail : null}
            slide={Math.min(slide, Math.max(0, current.slides.length - 1))}
            onSlide={setSlide}
            onAct={(action) => act(current.id, action)}
            open={open}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function QueueRow({ brief: b, selected, onSelect }: { brief: BriefView; selected: boolean; onSelect: () => void }) {
  const slots = b.slides.length ? b.slides : [b.before ? { thumb: b.before, width: 4, height: 5 } : null, null, null];
  return (
    <li data-id={b.id}>
      <button
        onClick={onSelect}
        aria-current={selected}
        className={cx(
          "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-b border-line px-4 py-3 text-left transition-colors duration-150 ease-out sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-6 sm:px-6",
          selected ? "bg-surface shadow-[inset_2px_0_0_var(--color-ink)]" : "hover:bg-wash",
        )}
      >
        <div className="flex gap-1">
          {slots.map((s, i) => (
            <div key={i} className={cx("aspect-[4/5] w-14 overflow-hidden rounded-sm bg-wash sm:w-[84px]", i > 0 && "max-[420px]:hidden")}>
              {s && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumb} alt="" width={s.width} height={s.height} loading="lazy" decoding="async" className="size-full object-cover" />
              )}
            </div>
          ))}
        </div>

        <div className="min-w-0">
          <p className="line-clamp-2 text-base text-ink sm:line-clamp-1">{b.hook}</p>
          <p className="mt-0.5 truncate text-ink-2">
            {b.filterName}
            <span className="text-ink-3"> · {b.variationLabel}</span>
          </p>
          <p className="mt-2 hidden truncate font-mono text-2xs text-ink-3 sm:block">
            @{b.handle} · {b.platform} · {b.inputs.time}
          </p>
          <StateMark state={b.state} needsPerson={b.needsPerson} rejected={b.rejected} className="mt-1.5 sm:hidden" />
        </div>

        <div className="hidden flex-col items-end gap-1 sm:flex">
          <StateMark state={b.state} needsPerson={b.needsPerson} rejected={b.rejected} />
          {b.review?.score != null && <span className="font-mono text-2xs text-ink-3 tabular-nums">{b.review.score}</span>}
        </div>
      </button>
    </li>
  );
}

function Empty({ view, busy, onPlan }: { view: DayView; busy: boolean; onPlan: () => void }) {
  const past = view.day < view.today;
  return (
    <div className="px-6 pt-16">
      <p className="text-base text-ink">{past ? "Nothing was made on this day." : "Nothing is planned for this day."}</p>
      {!past && view.plannable > 0 && (
        <>
          <p className="mt-1 text-ink-2">
            The plan would be {view.plannable} {view.plannable === 1 ? "brief" : "briefs"}, from pairs that are already generated first.
          </p>
          <Button tone="primary" className="mt-5" disabled={busy} onClick={onPlan}>
            Plan day
          </Button>
        </>
      )}
    </div>
  );
}
