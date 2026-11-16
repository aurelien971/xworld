import path from "node:path";

/** Where the factory keeps things on disk. FACTORY_ROOT lets a script run from anywhere. */
export const ROOT = process.env.FACTORY_ROOT || process.cwd();
export const REGISTRY = path.join(ROOT, "registry");
export const DATA = path.join(ROOT, "data");
export const MEDIA = path.join(DATA, "media");
