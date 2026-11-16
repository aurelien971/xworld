"use client";

import { useEffect, useState } from "react";
import type { AccountsView } from "@/app/api/accounts/route";
import { cx } from "./primitives";

/**
 * Who posts, and where. Each persona has a slot on each platform, empty
 * until a real account is connected to it: Connect goes to the platform's
 * own sign-in and comes back here. A connected account is planned for in
 * full; the factory posts to it only once Posting is switched on.
 */
export function Accounts({ product }: { product: string }) {
  const [view, setView] = useState<AccountsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Coming back from a platform's sign-in: say how it went, then tidy the address.
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected"), failed = q.get("connect-error");
    if (connected || failed) window.history.replaceState(null, "", `/${product}?view=accounts`);
    Promise.resolve().then(() => {
      if (connected) setNotice(`Connected @${connected.split(":").slice(1).join(":")}. Posting is off until you switch it on.`);
      if (failed) setError(failed);
    });
    fetch(`/api/accounts?product=${product}`, { cache: "no-store" }).then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setView(d)), () => setError("The accounts could not be read."));
  }, [product]);

  const act = async (body: { action: string; account: string; on?: boolean }) => {
    setError(null);
    if (body.action === "posting") setView((v) => v && { personas: v.personas.map((p) => ({ ...p, slots: p.slots.map((s) => (s.id === body.account ? { ...s, posting: !!body.on } : s)) })) });
    const res = await fetch(`/api/accounts?product=${product}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (res.ok) setView(data);
    else setError(data?.error ?? "That didn't work.");
  };

  const slots = view?.personas.flatMap((p) => p.slots) ?? [];
  return (
    <div className="px-4 pt-7 pb-10 sm:px-6">
      <dl className="flex gap-10">
        {([["Connected", view ? slots.filter((s) => s.connected).length : null], ["Posting", view ? slots.filter((s) => s.posting).length : null], ["Slots", view ? slots.length : null]] as const).map(([label, n], i) => (
          <div key={label}>
            <dd className={cx("font-mono text-xl tabular-nums", i > 0 && "text-ink-3")}>{n ?? " "}</dd>
            <dt className="mt-0.5 text-xs text-ink-3">{label}</dt>
          </div>
        ))}
      </dl>

      {notice && <p className="mt-6">{notice}</p>}
      {error && (
        <p role="alert" className="mt-6 text-accent">
          {error}
        </p>
      )}

      <ul className="mt-6 border-t border-line">
        {view?.personas.map((p) => (
          <li key={p.id} className="grid gap-x-10 gap-y-4 border-b border-line py-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-base">
                {p.name} <span className="ml-1 text-xs text-ink-3 capitalize">{p.stance.replace("-", " ")}</span>
              </p>
              <p className="mt-0.5 text-ink-2">{p.kit?.idea ?? p.voice}</p>
              {p.kit && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">How to set it up</summary>
                  <dl className="mt-2 grid gap-y-2 text-xs">
                    {([["Handles to try", p.kit.handles.map((h) => `@${h}`).join("  ")], ["Bio", p.kit.bio], ["Picture", p.kit.picture], ["Posts about", p.kit.pillars.join(", ")], ["First posts", p.kit.first.join(". ") + "."], ["Voice", p.voice]] as const).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-ink-3">{k}</dt>
                        <dd className="whitespace-pre-line text-ink-2">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {p.slots.map((s) => (
                <div key={s.id} className="min-w-0">
                  <p className="text-xs text-ink-3">
                    {s.platformName} <span className="font-mono">· {s.perDay}/day</span>
                  </p>
                  {s.connected ? (
                    <>
                      <p className="mt-1 truncate">@{s.handle}</p>
                      {s.needsReconnect ? (
                        <a href={`/api/connect/${s.platform}/start?account=${s.id}`} className="mt-1 block text-xs text-accent underline underline-offset-2">
                          Connect again
                        </a>
                      ) : (
                        <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
                          <input type="checkbox" checked={s.posting} onChange={(e) => act({ action: "posting", account: s.id, on: e.target.checked })} className="accent-ink" />
                          Posting
                        </label>
                      )}
                      <button onClick={() => act({ action: "disconnect", account: s.id })} className="mt-1 text-xs text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
                        Disconnect
                      </button>
                    </>
                  ) : s.offered ? (
                    <a href={`/api/connect/${s.platform}/start?account=${s.id}`} className="mt-1 inline-block underline decoration-line-2 underline-offset-2 transition-colors duration-150 hover:decoration-ink">
                      Connect
                    </a>
                  ) : (
                    <p className="mt-1 text-ink-3">No keys yet</p>
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
