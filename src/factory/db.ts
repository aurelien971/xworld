import fs from "node:fs";
import path from "node:path";
import { DATA } from "./paths";

/**
 * One SQL dialect in two places: Postgres on Neon when DATABASE_URL is set,
 * and an embedded Postgres (PGlite) in /data/pg otherwise. PGlite is one
 * process at a time, so a lock file names the process that holds it.
 */
type Row = Record<string, unknown>;
type Runner = { query: (text: string, params?: unknown[]) => Promise<Row[]>; close: () => Promise<void> };

const SCHEMA = `
create table if not exists assets (
  id text primary key, product text not null, kind text not null, media_key text not null,
  width int, height int, tags jsonb not null default '[]', meta jsonb not null default '{}',
  approved boolean not null default false, created_at timestamptz not null default now());
create table if not exists generations (
  key text primary key, asset_id text not null, filter_id text not null, variation_id text not null,
  prompt_hash text not null, media_key text not null, width int, height int,
  cost_usd numeric, source text not null, created_at timestamptz not null default now());
create index if not exists generations_asset on generations (asset_id);
create table if not exists briefs (
  id text primary key, day date not null, seq int not null,
  product text not null, persona text not null, account text not null, format text not null,
  inputs jsonb not null, state text not null, error text, caption text,
  slides jsonb not null default '[]', review jsonb, publish jsonb, metrics jsonb,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists briefs_day on briefs (day, seq);
alter table briefs add column if not exists video jsonb;
alter table briefs add column if not exists align jsonb;
create table if not exists alignments (key text primary key, result jsonb not null);
create table if not exists persona_links (persona text primary key, model text not null, name text, linked_at timestamptz not null default now());
create table if not exists idea_state (id text primary key, state text not null, at timestamptz not null default now());
create table if not exists filter_state (id text primary key, approved boolean not null, at timestamptz not null default now());
create table if not exists connections (
  account text primary key, provider text not null, username text not null, name text, avatar text,
  sealed text not null, posting boolean not null default false, needs_reconnect boolean not null default false,
  at timestamptz not null default now());
create table if not exists settings (scope text not null, key text not null, value jsonb not null, at timestamptz not null default now(), primary key (scope, key));
create table if not exists events (
  id bigserial primary key, brief_id text not null, at timestamptz not null default now(),
  state text not null, note text);
create index if not exists events_brief on events (brief_id, id);
create table if not exists judgements (
  key text primary key, result jsonb not null, cost_usd numeric, created_at timestamptz not null default now());
create table if not exists costs (
  id bigserial primary key, at timestamptz not null default now(), kind text not null,
  usd numeric not null, ref text);
`;

/** The deployed factory was opened before a database was connected to it. */
export class NoDatabase extends Error {
  constructor() {
    super("No database is connected yet.");
  }
}

const g = globalThis as unknown as { __factoryDb?: Promise<Runner> };

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function open(): Promise<Runner> {
  const url = process.env.DATABASE_URL;
  let runner: Runner;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    runner = { query: async (text, params = []) => (await sql.query(text, params)) as Row[], close: async () => {} };
  } else if (process.env.VERCEL) {
    // A deployment has no disk to keep a database on.
    throw new NoDatabase();
  } else {
    const dir = path.join(DATA, "pg");
    const lock = path.join(DATA, "pg.lock");
    fs.mkdirSync(DATA, { recursive: true });
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, "utf8"));
      if (pid && pid !== process.pid && alive(pid)) {
        throw new Error(`The local database is in use by process ${pid} (the dev server?). Stop it, or set DATABASE_URL.`);
      }
    }
    fs.writeFileSync(lock, String(process.pid));
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(dir);
    const release = () => {
      try {
        if (Number(fs.readFileSync(lock, "utf8")) === process.pid) fs.unlinkSync(lock);
      } catch {}
    };
    process.once("exit", release);
    runner = {
      query: async (text, params = []) => (await db.query(text, params)).rows as Row[],
      close: async () => {
        await db.close();
        release();
      },
    };
  }
  for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await runner.query(statement);
  return runner;
}

const runner = () => (g.__factoryDb ??= open().catch((e) => {
  g.__factoryDb = undefined;
  throw e;
}));

export async function sql<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await (await runner()).query(text, params)) as T[];
}

export async function closeDb() {
  if (!g.__factoryDb) return;
  await (await g.__factoryDb).close();
  g.__factoryDb = undefined;
}
