import { sql } from "./db";
import * as mitsushiro from "./mitsushiro";
import * as registry from "./registry";
import type { Account } from "./types";

/**
 * An account as it stands now. The registry says which slots exist (a
 * persona on a platform, how many posts a day, at what times). Whether a
 * slot is real comes from Mitsushiro: the persona is linked to a creator
 * there, and the slot is live once that creator has the platform connected.
 */
export type LiveAccount = Account & { model: string | null; connected: boolean; needsReconnect: boolean };

export const links = async () => new Map((await sql<{ persona: string; model: string }>("select persona, model from persona_links")).map((l) => [l.persona, l.model]));
export const link = (persona: string, model: string, name: string) =>
  sql("insert into persona_links (persona, model, name) values ($1,$2,$3) on conflict (persona) do update set model = excluded.model, name = excluded.name, linked_at = now()", [persona, model, name]);
export const unlink = (persona: string) => sql("delete from persona_links where persona = $1", [persona]);

export async function liveAccounts(): Promise<LiveAccount[]> {
  const byPersona = await links();
  const creators = mitsushiro.configured() ? await mitsushiro.creators().catch(() => []) : [];
  return registry.accounts().map((a) => {
    const model = a.target?.model ?? byPersona.get(a.persona) ?? null;
    const conn = model ? creators.find((c) => c.id === model)?.connections.find((c) => c.provider === a.platform) : undefined;
    if (!conn) return { ...a, model, connected: false, needsReconnect: false };
    // Connected: it has a real handle, and it takes posts unless the file pauses it.
    return { ...a, model, handle: conn.username || a.handle, status: a.status === "paused" ? "paused" : "active", connected: true, needsReconnect: !!conn.needsReconnect };
  });
}

export const liveAccount = async (id: string) => (await liveAccounts()).find((a) => a.id === id) ?? null;
