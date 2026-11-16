import { dayOf, isDay } from "@/factory/time";
import { dayView } from "@/factory/view";
import { Floor } from "@/ui/Floor";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: PageProps<"/">) {
  const q = await searchParams;
  const day = isDay(q.day) ? q.day : dayOf();
  return <Floor initial={await dayView("opaque", day)} />;
}
