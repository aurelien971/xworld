import { notFound } from "next/navigation";
import { NoDatabase } from "@/factory/db";
import * as registry from "@/factory/registry";
import { dayOf, isDay } from "@/factory/time";
import { dayView } from "@/factory/view";
import { Floor } from "@/ui/Floor";
import { Setup } from "@/ui/Setup";

export const dynamic = "force-dynamic";
const VIEWS = ["campaign", "day", "wall", "ideas", "formats", "filters", "library", "accounts"] as const;

export default async function Page({ params, searchParams }: PageProps<"/[product]">) {
  const { product } = await params;
  if (!registry.products().some((p) => p.id === product)) notFound();
  const q = await searchParams;
  let initial: Awaited<ReturnType<typeof dayView>> | null = null;
  try {
    initial = await dayView(product, isDay(q.day) ? q.day : dayOf());
  } catch (e) {
    if (!(e instanceof NoDatabase)) throw e;
  }
  return initial ? <Floor initial={initial} view={VIEWS.find((v) => v === q.view) ?? (q.day ? "day" : "campaign")} /> : <Setup />;
}
