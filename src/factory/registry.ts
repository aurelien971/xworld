import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REGISTRY } from "./paths";
import { Account, Angles, Filter, Format, Persona, Product } from "./types";

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
export const filters = (productId: string) => read(`products/${productId}/filters.json`, z.array(Filter));
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
