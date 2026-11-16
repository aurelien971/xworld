"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountsView } from "@/app/api/accounts/route";
import { Button, cx } from "./primitives";

/**
 * Who posts, and where. Each persona is one creator in Mitsushiro, which
 * holds the sign-ins; each of its four platforms is a slot that is empty
 * until an account is connected to it. Connecting goes through Mitsushiro's
 * own sign-in with each platform, and comes back here.
 */
const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X" };

export function Accounts({ product }: { product: string }) {
  const [view, setView] = useState<AccountsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const post = useCallback(
    async (body: Record<string, string>) => {
      const res = await fetch(`/api/accounts?product=${product}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "That didn't work.");
      return data;
    },
    [product],
  );

  useEffect(() => {
    fetch(`/api/accounts?product=${product}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d.error && !d.personas ? setError(d.error) : setView(d)), () => setError("The accounts could not be read."));
  }, [product]);

  const act = async (key: string, body: Record<string, string>) => {
    setBusy(key);
    setError(null);
    try {
      const data = await post(body);
      if (body.action === "connect") window.location.assign(data.url);
      else setView(data);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };

  const connected = view?.personas.reduce((n, p) => n + p.slots.filter((s) => s.connected).length, 0) ?? 0;
  const slots = view?.personas.reduce((n, p) => n + p.slots.length, 0) ?? 0;

  return (
    <div className="px-4 pt-7 pb-10 sm:px-6">
      <dl className="flex gap-10">
        {([["Connected", view ? connected : null], ["Slots", view ? slots : null], ["Personas", view?.personas.length ?? null]] as const).map(([label, n], i) => (
          <div key={label}>
            <dd className={cx("font-mono text-xl tabular-nums", i > 0 && "text-ink-3")}>{n ?? " "}</dd>
            <dt className="mt-0.5 text-xs text-ink-3">{label}</dt>
          </div>
        ))}
      </dl>

      {view && !view.configured && <p className="mt-6 text-ink-2">Mitsushiro is not linked yet, so nothing can be connected. Set its address and the shared secret, then come back.</p>}
      {(error || view?.error) && (
        <p role="alert" className="mt-6 text-accent">
          {error || view?.error}
        </p>
      )}

      <ul className="mt-6 border-t border-line">
        {view?.personas.map((p) => (
          <li key={p.id} className="grid gap-x-8 gap-y-3 border-b border-line py-4 lg:grid-cols-[minmax(0,260px)_minmax(0,220px)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-base">
                {p.name} <span className="ml-1 text-xs text-ink-3 capitalize">{p.stance}</span>
              </p>
              <p className="mt-0.5 line-clamp-2 text-ink-2">{p.voice}</p>
              <p className="mt-1.5 truncate font-mono text-2xs text-ink-3">{p.formats.length} formats</p>
            </div>

            <div className="min-w-0">
              <p className="text-xs text-ink-3">Creator in Mitsushiro</p>
              {p.model ? (
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="truncate">{p.creatorName ?? p.model}</span>
                  <button onClick={() => act(`${p.id}:unlink`, { action: "unlink", persona: p.id })} className="shrink-0 text-xs text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
                    Unlink
                  </button>
                </p>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <select
                    aria-label={`Creator for ${p.name}`}
                    disabled={!view.configured || !view.creators.length}
                    value=""
                    onChange={(e) => e.target.value && act(`${p.id}:link`, { action: "link", persona: p.id, model: e.target.value })}
                    className="h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-surface px-1.5 text-sm text-ink-2 disabled:opacity-40"
                  >
                    <option value="">Choose one</option>
                    {view.creators.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button disabled={!view.configured || busy === `${p.id}:create`} onClick={() => act(`${p.id}:create`, { action: "create", persona: p.id })}>
                    New
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {p.slots.map((s) => (
                <div key={s.id} className="min-w-0">
                  <p className="text-xs text-ink-3">
                    {PLATFORM[s.platform] ?? s.platform} <span className="font-mono">· {s.perDay}/day</span>
                  </p>
                  {s.connected ? (
                    <p className="mt-1 truncate">
                      @{s.handle}
                      {s.needsReconnect && (
                        <button onClick={() => act(s.id, { action: "connect", persona: p.id, platform: s.platform })} className="ml-2 text-xs text-accent underline underline-offset-2">
                          Reconnect
                        </button>
                      )}
                    </p>
                  ) : (
                    <button
                      disabled={!p.model || busy === s.id}
                      onClick={() => act(s.id, { action: "connect", persona: p.id, platform: s.platform })}
                      className="mt-1 text-sm underline decoration-line-2 underline-offset-2 transition-colors duration-150 hover:decoration-ink disabled:text-ink-3 disabled:no-underline"
                    >
                      {p.model ? "Connect" : s.status === "warming" ? `@${s.handle}, not connected` : "Empty"}
                    </button>
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
