import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REGISTRY } from "./paths";
import { Account, Angles, Filter, Format, Idea, Persona, Product, Variation } from "./types";

/** The registries, read from /registry and checked on the way in. Small files, read on every call so an edit shows at once. */
const read = <T>(file: string, schema: z.ZodType<T>): T => {
  const parsed = schema.safeParse(JSON.parse(fs.readFileSync(path.join(REGISTRY, file), "utf8")));
  if (!parsed.success) throw new Error(`registry/${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return parsed.data;
};
const all = <T>(dir: string, schema: z.ZodType<T>): T[] => {
  const full = path.join(REGISTRY, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith(".json")).sort().map((f) => read(path.join(dir, f), schema));
};

export const products = () => fs.readdirSync(path.join(REGISTRY, "products")).filter((d) => fs.existsSync(path.join(REGISTRY, "products", d, "product.json"))).map((d) => read(`products/${d}/product.json`, Product));
export const product = (id: string) => read(`products/${id}/product.json`, Product);
const Lab = z.object({
  audits: z.record(z.string(), z.object({ verdict: z.enum(["strong", "usable", "mixed", "weak"]), note: z.string(), weak: z.array(z.string()).default([]) })).default({}),
  rewrites: z.array(Variation.extend({ filter: z.string(), variation: z.string() }).omit({ id: true })).default([]),
  filters: z.array(Filter).default([]),
});
export type Lab = z.infer<typeof Lab>;
/** The filter lab: what was seen in each tested filter's results, rewrites of weak ones, and new filters. */
export const lab = (productId: string): Lab => (fs.existsSync(path.join(REGISTRY, `products/${productId}/filter-lab.json`)) ? read(`products/${productId}/filter-lab.json`, Lab) : { audits: {}, rewrites: [], filters: [] });

/** Every filter: the app's catalog, with the lab's rewrites added as further variations and its new filters after them. */
export function filters(productId: string): Filter[] {
  const l = lab(productId);
  const base = read(`products/${productId}/filters.json`, z.array(Filter)).map((f) => ({
    ...f,
    variations: [...f.variations, ...l.rewrites.filter((r) => r.filter === f.id).map((r) => ({ id: r.variation, label: r.label, prompt: r.prompt, replaces: r.replaces, why: r.why }))],
  }));
  return [...base, ...l.filters.filter((n) => !base.some((f) => f.id === n.id)).map((n) => ({ ...n, origin: "lab" as const }))];
}

/** Whether a filter's variation was seen to give a result nobody would post. Such pairs are never planned. */
export function weak(productId: string) {
  const audits = lab(productId).audits;
  return (filterId: string, variationId: string) => audits[filterId]?.verdict === "weak" || !!audits[filterId]?.weak.includes(variationId);
}

/** Every content idea written for a product, across its personas. */
export function ideas(productId: string): Idea[] {
  const dir = path.join(REGISTRY, "ideas", productId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((f) => read(path.join("ideas", productId, f), z.array(Idea)));
}
export const personas = () => all("personas", Persona);
export const accounts = () => all("accounts", Account);
export const formats = () => all("formats", Format);
export const angles = (productId: string) => read(`angles/${productId}.json`, Angles);

const need = <T extends { id: string }>(list: T[], id: string, what: string) => {
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(`No ${what} "${id}" in the registry`);
  return found;
};
export const persona = (id: string) => need(personas(), id, "persona");
export const account = (id: string) => need(accounts(), id, "account");
export const format = (id: string) => need(formats(), id, "format");
export const filter = (productId: string, id: string) => need(filters(productId), id, "filter");

/** The formats a persona qualifies for: everything the format requires, the persona can do. */
export const formatsFor = (p: Persona) => formats().filter((f) => f.requires.every((r) => p.can.includes(r)));
