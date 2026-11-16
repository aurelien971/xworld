import Link from "next/link";
import { NoDatabase } from "@/factory/db";
import * as registry from "@/factory/registry";
import { wallView, type WallView } from "@/factory/view";
import { Setup } from "@/ui/Setup";

export const dynamic = "force-dynamic";

/** The products. Each is its own factory floor; this page is the way in. */
export default async function Index() {
  let walls: WallView[] | null = null;
  try {
    walls = await Promise.all(registry.products().map((p) => wallView(p.id, 8)));
  } catch (e) {
    if (!(e instanceof NoDatabase)) throw e;
  }
  if (!walls) return <Setup />;
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-13 shrink-0 items-center border-b border-line px-4 sm:px-6">
        <span className="font-medium">Factory</span>
      </header>
      <main className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <ul>
          {walls.map((w) => (
            <li key={w.product.id}>
              <Link href={`/${w.product.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 gap-y-4 border-b border-line px-4 py-5 transition-colors duration-150 ease-out hover:bg-wash sm:px-6 md:grid-cols-[minmax(0,360px)_auto_minmax(0,1fr)]">
                <div className="min-w-0">
                  <h2 className="text-lg font-medium">{w.product.name}</h2>
                  <p className="mt-0.5 truncate text-ink-2">{registry.product(w.product.id).promise}</p>
                </div>
                <dl className="flex gap-8">
                  {([["Ready", w.counts.ready], ["Posted", w.counts.posted], ["Made", w.counts.made]] as const).map(([label, n]) => (
                    <div key={label}>
                      <dd className="font-mono text-base tabular-nums">{n.toLocaleString("en-GB")}</dd>
                      <dt className="text-xs text-ink-3">{label}</dt>
                    </div>
                  ))}
                </dl>
                <div className="col-span-2 flex justify-start gap-1 overflow-hidden md:col-span-1 md:justify-end">
                  {w.briefs.filter((b) => b.slides.length).slice(0, 8).map((b) => (
                    <div key={b.id} className="aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-sm bg-wash">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.slides[0].thumb} alt="" className="size-full object-cover" />
                    </div>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
