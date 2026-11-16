import { z } from "zod";

/**
 * The six registries and the brief. Everything the factory makes is one brief:
 * a product, a persona, an account, a format and an angle, plus the inputs the
 * planner picked. Registries are files under /registry; briefs live in the database.
 */

export const STATES = ["planned", "generating", "reviewing", "ready", "published", "failed"] as const;
export type State = (typeof STATES)[number];

export const Variation = z.object({ id: z.string(), label: z.string(), prompt: z.string() });
export const Filter = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  benefit: z.string().default(""),
  quality: z.string().default("medium"),
  approved: z.boolean().default(false),
  variations: z.array(Variation).min(1),
});
export type Filter = z.infer<typeof Filter>;

export const Product = z.object({
  id: z.string(),
  name: z.string(),
  promise: z.string(),
  audience: z.string(),
  link: z.string().optional(),
  hashtags: z.array(z.string()).default([]),
  /** Pairs the planner may ask the image model for each day, beyond what is already generated. */
  freshPerDay: z.number().int().min(0).default(0),
});
export type Product = z.infer<typeof Product>;

export const Persona = z.object({
  id: z.string(),
  name: z.string(),
  product: z.string(),
  stance: z.enum(["official", "creator", "reviewer", "tips"]),
  /** What the persona can do. A format lists what it requires; the grid is computed from the two. */
  can: z.array(z.string()),
  voice: z.string(),
});
export type Persona = z.infer<typeof Persona>;

export const Account = z.object({
  id: z.string(),
  persona: z.string(),
  platform: z.enum(["instagram", "tiktok", "youtube", "x"]),
  handle: z.string(),
  /** Posts a day the planner may give this account. */
  perDay: z.number().int().positive(),
  /** Local posting times, HH:MM, used in order through the day. */
  times: z.array(z.string()).min(1),
  status: z.enum(["warming", "active", "paused"]),
  /** Where its posts are handed over: the Mitsushiro creator that holds this account's sign-in. Absent until it is connected. */
  target: z.object({ kind: z.literal("mitsushiro"), uid: z.string(), model: z.string() }).optional(),
});
export type Account = z.infer<typeof Account>;

export const Format = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["carousel", "video"]),
  platforms: z.array(z.string()),
  requires: z.array(z.string()),
  /** The recipe: scenes in order. Each scene is a composer the code knows by name. */
  scenes: z.array(z.object({ scene: z.string(), options: z.record(z.string(), z.unknown()).default({}) })),
  size: z.object({ width: z.number(), height: z.number() }),
});
export type Format = z.infer<typeof Format>;

export const Angles = z.object({
  product: z.string(),
  hooks: z.array(z.object({ id: z.string(), text: z.string(), validated: z.boolean() })),
  /** How the post's caption is put together: a second hook, the filter line, the hashtags. */
  captionLine: z.string(),
});
export type Angles = z.infer<typeof Angles>;

export type Inputs = {
  asset: string;
  filter: string;
  variation: string;
  hook: string;
  captionHook: string;
  seed: number;
  /** Local time the post is due, HH:MM. */
  time: string;
};

export type Slide = { scene: string; key: string; thumb: string; width: number; height: number };

export type Review = {
  /** none: nobody has looked yet, and the brief is waiting for a person. */
  by: "judge" | "person" | "none";
  outcome: "pass" | "hold" | "reject";
  score?: number;
  realism?: number;
  alignment?: number;
  appeal?: number;
  note?: string;
  model?: string;
  at: string;
};

export type Publish = {
  target?: string;
  status: "queued" | "sent" | "live" | "failed";
  dueAt?: string;
  url?: string;
  ref?: string;
  error?: string;
  at: string;
};

export type Metrics = { views?: number; likes?: number; comments?: number; shares?: number; at: string };

export type Brief = {
  id: string;
  day: string;
  seq: number;
  product: string;
  persona: string;
  account: string;
  format: string;
  inputs: Inputs;
  state: State;
  error: string | null;
  caption: string | null;
  slides: Slide[];
  review: Review | null;
  publish: Publish | null;
  metrics: Metrics | null;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
};

export type BriefEvent = { at: string; state: State; note: string | null };
