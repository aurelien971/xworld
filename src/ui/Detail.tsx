"use client";

import { ArrowUpRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Scope } from "@/factory/tuning";
import type { BriefDetail, BriefView } from "@/factory/view";
import { Button, cx, IconButton, money, Row, StateMark } from "./primitives";
import { Tuning } from "./Tuning";

/**
 * One brief in full: the post as it will go out, then where it came from,
 * what was done to it, how it was reviewed, where it is going and how it
 * did. Drawn from what the queue already knows; the rest fills in when it
 * arrives, in place, so nothing moves.
 */
type Props = {
  brief: BriefView;
  detail: BriefDetail | null;
  slide: number;
  onSlide: (i: number) => void;
  onAct: (action: "approve" | "reject" | "retry") => void;
  /** Set the format's dials from this post: for it alone, for its format, or for everything. */
  onTune: (changes: Record<string, number | string | null>, scope: Scope) => void;
  tuning: boolean;
  open: boolean;
  onClose: () => void;
};

const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
const dateOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Detail({ brief: b, detail, slide, onSlide, onAct, onTune, tuning, open, onClose }: Props) {
  const shown = b.slides[slide];
  return (
    <aside
      className={cx(
        "scroll-quiet min-h-0 overflow-y-auto border-l border-line bg-surface",
        "max-[1099px]:fixed max-[1099px]:inset-0 max-[1099px]:z-10 max-[1099px]:border-l-0",
        !open && "max-[1099px]:hidden",
      )}
    >
      <div className="px-6 pt-5 pb-10">
        <div className="mb-4 flex h-7 items-center justify-between">
          <StateMark state={b.state} needsPerson={b.needsPerson} rejected={b.rejected} />
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs text-ink-3">{b.id}</span>
            <IconButton label="Close  Esc" onClick={onClose} className="min-[1100px]:hidden">
              <X size={15} strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>

        <div className="grid grid-cols-[232px_minmax(0,1fr)] gap-5">
          <div>
            <div className={cx("overflow-hidden rounded-md bg-wash", b.video || (shown && shown.height / shown.width > 1.5) ? "aspect-[9/16]" : "aspect-[4/5]")}>
              {b.video ? (
                <video key={b.video.url + b.updatedAt} src={b.video.url} poster={b.slides[0]?.url} controls loop muted autoPlay playsInline className="size-full object-cover" />
              ) : (
                (shown || b.before) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={shown?.url ?? "before"} src={shown?.url ?? b.before!} alt="" className="size-full object-cover" />
                )
              )}
            </div>
            {b.slides.length > 1 && !b.video && (
              <div className="mt-2 flex gap-1" role="tablist" aria-label="Slides">
                {b.slides.map((s, i) => (
                  <button
                    key={s.url}
                    role="tab"
                    aria-selected={i === slide}
                    aria-label={`Slide ${i + 1}`}
                    onClick={() => onSlide(i)}
                    className={cx("aspect-[4/5] w-10 overflow-hidden rounded-sm transition-opacity duration-150 ease-out", i === slide ? "opacity-100 ring-1 ring-ink ring-offset-1 ring-offset-surface" : "opacity-55 hover:opacity-100")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.thumb} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            <h2 className="text-lg font-medium text-balance">{b.hook}</h2>
            {b.caption ? (
              <p className="mt-3 whitespace-pre-line text-ink-2">{b.caption}</p>
            ) : (
              <p className="mt-3 text-ink-3">The caption is written when the slides are made.</p>
            )}
            {b.state === "failed" && !b.rejected && b.error && <p className="mt-3 text-accent">{b.error}</p>}

            <div className="mt-auto flex gap-2 pt-5">
              {b.needsPerson && (
                <>
                  <Button tone="primary" hint="A" onClick={() => onAct("approve")}>
                    Approve
                  </Button>
                  <Button hint="X" onClick={() => onAct("reject")}>
                    Reject
                  </Button>
                </>
              )}
              {b.state === "failed" && !b.rejected && (
                <Button hint="R" onClick={() => onAct("retry")}>
                  Run again
                </Button>
              )}
              {b.rejected && b.slides.length > 0 && <Button onClick={() => onAct("approve")}>Approve after all</Button>}
            </div>
          </div>
        </div>

        <div className="mt-7">
          <Row label="Source">
            <div className="flex items-center gap-3">
              <div className="aspect-[4/5] w-9 shrink-0 overflow-hidden rounded-sm bg-wash">
                {b.before && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.before} alt="" loading="lazy" className="size-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p>{detail ? [...detail.source.tags.map((t) => cap(t.replace(/_/g, " "))), detail.source.gender].filter(Boolean).join(", ") || "Photo" : " "}</p>
                <p className="font-mono text-2xs text-ink-3">{b.inputs.asset.slice(0, 8).toLowerCase()}</p>
              </div>
            </div>
          </Row>

          <Row label="Transformation">
            <p>
              {b.filterName}
              <span className="text-ink-2"> · {b.variationLabel}</span>
            </p>
            <p className="text-ink-2">
              {!detail
                ? " "
                : !detail.source.generation
                  ? "Not generated yet"
                  : detail.source.generation.source === "factory"
                    ? `Generated ${dateOf(detail.source.generation.createdAt)}${detail.source.generation.costUsd ? ` for ${money(detail.source.generation.costUsd)}` : ""}`
                    : `Kept from Opaque Ads, made ${dateOf(detail.source.generation.createdAt)}`}
            </p>
            <p className="text-ink-2">
              {b.formatName}
              {b.video ? `, ${b.video.seconds}s at ${b.video.width}×${b.video.height}` : b.slides.length > 0 ? `, ${b.slides.length} ${b.slides.length === 1 ? "picture" : "slides"} at ${b.slides[0].width}×${b.slides[0].height}` : ""}
            </p>
            {b.align && (
              <p className="font-mono text-2xs text-ink-3">
                {b.align.applied ? `after laid over before: scale ${b.align.scale.toFixed(3)}, shift ${(b.align.dx * 100).toFixed(1)}% ${(b.align.dy * 100).toFixed(1)}%` : "after already sits on the before"} · match {b.align.score.toFixed(2)}
              </p>
            )}
            {detail?.source.prompt && (
              <Disclosure label="Prompt">
                <p className="font-mono text-2xs leading-[18px] text-ink-2">{detail.source.prompt}</p>
              </Disclosure>
            )}
          </Row>

          {detail?.tuning && (
            <Row label="Tuning">
              <Tuning key={b.id} formatId={b.format} formatName={`Every ${b.formatName}`} settings={detail.tuning.settings} scopes={["post", "format", "all"]} posts={detail.tuning.posts} uses={detail.tuning.uses} busy={tuning} onApply={onTune} />
            </Row>
          )}

          <Row label="Review">
            <ReviewLine b={b} />
          </Row>

          <Row label="Publishing">
            <p>
              @{b.handle}
              <span className="text-ink-2">
                {" "}
                · {cap(b.platform)} · {b.inputs.time}
              </span>
            </p>
            <PublishLine b={b} />
          </Row>

          <Row label="Results">
            {b.metrics ? (
              <dl className="flex gap-6">
                {(["views", "likes", "comments", "shares"] as const).map((k) => (
                  <div key={k}>
                    <dd className="font-mono tabular-nums">{b.metrics![k]?.toLocaleString("en-GB") ?? "–"}</dd>
                    <dt className="text-xs text-ink-3">{k}</dt>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-ink-3">{b.state === "published" ? "No numbers yet." : "After it is published."}</p>
            )}
          </Row>

          <Row label="History">
            <ol className="space-y-1">
              {(detail?.events ?? []).map((e, i) => (
                <li key={i} className="grid grid-cols-[60px_1fr] gap-3">
                  <time className="font-mono text-2xs leading-5 text-ink-3 tabular-nums">{clock(e.at)}</time>
                  <span className="text-ink-2">{e.note ?? cap(e.state)}</span>
                </li>
              ))}
            </ol>
            {b.costUsd > 0 && <p className="mt-2 font-mono text-2xs text-ink-3">{money(b.costUsd)} spent on this brief</p>}
          </Row>
        </div>
      </div>
    </aside>
  );
}

function ReviewLine({ b }: { b: BriefView }) {
  const r = b.review;
  if (!r) return <p className="text-ink-3">{b.state === "reviewing" ? "Being reviewed." : "After the slides are made."}</p>;
  if (r.by === "none") {
    return (
      <>
        <p className={b.needsPerson ? "text-accent" : undefined}>Waiting for you</p>
        {r.note && <p className="text-ink-2">{r.note}</p>}
      </>
    );
  }
  const verdict = r.outcome === "pass" ? "Passed" : r.outcome === "reject" ? "Rejected" : "Held for you";
  return (
    <>
      <p className={b.needsPerson ? "text-accent" : undefined}>
        {r.by === "person" ? (r.outcome === "pass" ? "Approved by you" : "Rejected by you") : verdict}
        {r.score != null && <span className="ml-2 font-mono text-ink tabular-nums">{r.score}</span>}
      </p>
      {r.realism != null && (
        <p className="font-mono text-2xs text-ink-3 tabular-nums">
          realism {r.realism} · alignment {r.alignment} · appeal {r.appeal}
        </p>
      )}
      {r.note && <p className="mt-1 text-ink-2">{r.note}</p>}
    </>
  );
}

function PublishLine({ b }: { b: BriefView }) {
  const p = b.publish;
  if (p?.status === "live") {
    return p.url ? (
      <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline decoration-line-2 underline-offset-2 hover:decoration-ink">
        Live <ArrowUpRight size={13} strokeWidth={1.75} />
      </a>
    ) : (
      <p>Live</p>
    );
  }
  if (p?.status === "failed") return <p className="text-accent">Not sent. {p.error}</p>;
  if (p) return <p className="text-ink-2">{p.status === "queued" ? "With the publisher, waiting for its time" : "Sent, being processed"}</p>;
  if (b.blocker) return <p className="text-ink-2">Not sent. {b.blocker}.</p>;
  return <p className="text-ink-3">After it passes review.</p>;
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <div className="mt-1.5">
      <button onClick={() => setOn((v) => !v)} aria-expanded={on} className="text-xs text-ink-3 underline decoration-line-2 underline-offset-2 transition-colors duration-150 hover:text-ink">
        {on ? `Hide ${label.toLowerCase()}` : label}
      </button>
      {on && <div className="mt-2">{children}</div>}
    </div>
  );
}
