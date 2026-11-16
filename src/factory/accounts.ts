import { connections } from "./connections";
import { available, type Provider } from "./platforms";
import * as registry from "./registry";
import type { Account } from "./types";

/**
 * An account as it stands now. The registry says which slots exist (a
 * persona on a platform, how many posts a day, at what times). A slot is
 * real once an account has been connected to it here; it takes posts once
 * posting is switched on for it.
 */
export type LiveAccount = Account & { connected: boolean; needsReconnect: boolean; posting: boolean; offered: boolean };

export async function liveAccounts(): Promise<LiveAccount[]> {
  const byAccount = new Map((await connections()).map((c) => [c.account, c]));
  return registry.accounts().map((a) => {
    const c = byAccount.get(a.id);
    const offered = available(a.platform as Provider);
    if (!c) return { ...a, connected: false, needsReconnect: false, posting: false, offered };
    // Connected: it has a real handle, and it is planned in full unless the file pauses it.
    return { ...a, handle: c.username, status: a.status === "paused" ? "paused" : "active", connected: true, needsReconnect: c.needsReconnect, posting: c.posting, offered };
  });
}

export const liveAccount = async (id: string) => (await liveAccounts()).find((a) => a.id === id) ?? null;
