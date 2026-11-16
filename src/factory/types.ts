import { z } from "zod";

/**
 * The six registries and the brief. Everything the factory makes is one brief:
 * a product, a persona, an account, a format and an angle, plus the inputs the
 * planner picked. Registries are files under /registry; briefs live in the database.
 */

export const STATES = ["planned", "generating", "reviewing", "ready", "published", "failed"] as const;
export type State = (typeof STATES)[number];

export const Variation = z.object({ id: z.string(), label: z.string(), prompt: z.string(), replaces: z.string().optional(), why: z.string().optional() });
export const Filter = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  benefit: z.string().default(""),
  quality: z.string().default("medium"),
  approved: z.boolean().default(false),
  /** Where it came from: the Opaque app's catalog, or the filter lab. And why it was written. */
  origin: z.enum(["opaque", "lab"]).default("opaque"),
  why: z.string().optional(),
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
  /** What every post asks for at its end, and the app's icon (a file beside product.json). */
  cta: z.string().default(""),
  icon: z.string().optional(),
  /** Pairs the planner may ask the image model for each day, beyond what is already generated. */
  freshPerDay: z.number().int().min(0).default(0),
  /** What the campaign is aiming for, and how many posts a day to stockpile for a slot that has no account yet. */
  campaign: z.object({ posts: z.number(), ideas: z.number(), photos: z.number(), filters: z.number(), accounts: z.number(), stockpilePerDay: z.number().default(1) }).optional(),
});
export type Product = z.infer<typeof Product>;

export const Persona = z.object({
  id: z.string(),
  name: z.string(),
  product: z.string(),
  stance: z.string(),
  /** What the persona can do. A format lists what it requires; the grid is computed from the two. */
  can: z.array(z.string()),
  voice: z.string(),
  /** Everything needed to open the account: the idea behind it, handles to try, the bio, the picture, what it posts about, what to post first. */
  kit: z.object({ idea: z.string(), handles: z.array(z.string()), bio: z.string(), picture: z.string(), pillars: z.array(z.string()), first: z.array(z.string()) }).optional(),
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
  /** placeholder: a slot that has no real account behind it yet. Nothing is planned for it. */
  status: z.enum(["placeholder", "warming", "active", "paused"]),
  /** Where its posts are handed over: the Mitsushiro creator that holds this account's sign-in. Absent until it is connected. */
  target: z.object({ kind: z.literal("mitsushiro"), model: z.string() }).optional(),
});
export type Account = z.infer<typeof Account>;

export const Format = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["carousel", "video"]),
  platforms: z.array(z.string()),
  requires: z.array(z.string()),
  /** The recipe: scenes in order. Each scene is a composer the code knows by name. */
  scenes: z.array(z.object({ scene: z.string(), options: z.record(z.string(), z.unknown()).default({}) })).default([]),
  /** A format that needs more than one pair: several filters on one photo, or one filter on several photos. */
  needs: z.object({ count: z.number().int().min(2), mode: z.enum(["same-asset", "same-filter"]) }).optional(),
  /** A video format names how its frames are ordered (plan) and its timings instead of scenes. */
  video: z.object({ renderer: z.string(), plan: z.enum(["single", "flash", "run", "photos"]).default("single"), options: z.record(z.string(), z.number()).default({}) }).optional(),
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

export const Idea = z.object({
  id: z.string(), persona: z.string(), format: z.string(), pillar: z.string().default(""), hook: z.string(), caption: z.string(),
  filter: z.string().default(""), text: z.string().default(""), why: z.string().default(""),
});
export type Idea = z.infer<typeof Idea>;

export type PairRef = { asset: string; filter: string; variation: string };

export type Inputs = {
  /** Further pairs for a format that needs several; the first pair is asset/filter/variation below. */
  more?: PairRef[];
  /** The idea this brief came from, with its words. Without one, hook and captionHook name validated hooks. */
  idea?: string;
  hookText?: string;
  captionText?: string;
  text?: string;
  asset: string;
  filter: string;
  variation: string;
  hook: string;
  captionHook: string;
  seed: number;
  /** Local time the post is due, HH:MM. */
  time: string;
};

export type Video = { key: string; seconds: number; width: number; height: number };
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
  /** A video post's file. Its slides are then three stills of it, for the queue. */
  video: Video | null;
  /** How the after was laid over the before. */
  align: { scale: number; dx: number; dy: number; score: number; kept: number; applied: boolean } | null;
  review: Review | null;
  publish: Publish | null;
  metrics: Metrics | null;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
};

export type BriefEvent = { at: string; state: State; note: string | null };
