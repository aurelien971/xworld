/**
 * The clock. While the factory is running on a machine (not on a serverless
 * deployment, which has no process to keep a clock in), once a minute it
 * posts what is ready and due today, and every half hour it reads the
 * numbers of what is out.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  const g = globalThis as unknown as { __factoryClock?: NodeJS.Timeout };
  if (g.__factoryClock) return;
  let ticks = 0, busy = false;
  g.__factoryClock = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { publishDue, measure } = await import("./factory/pipeline");
      const registry = await import("./factory/registry");
      for (const p of registry.products()) {
        await publishDue(p.id);
        if (ticks % 30 === 0) await measure(p.id);
      }
    } catch (e) {
      console.error("[clock]", (e as Error).message);
    } finally {
      ticks++;
      busy = false;
    }
  }, 60_000);
}
