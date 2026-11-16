import fs from "node:fs";
import path from "node:path";
import { parse, type Font } from "opentype.js";
import sharp from "sharp";
import { ROOT } from "../paths";

const FONTS = path.join(ROOT, "assets/fonts");

/**
 * The few drawing moves every scene shares: a photo cropped to a box, a line
 * of type in the bundled face, and a pill behind it. Scenes compose these;
 * nothing here knows about a product. Type is drawn as outlines from the
 * font file itself, so a slide is the same on every machine.
 */
export type Layer = { input: Buffer; left: number; top: number };
type Weight = "Medium" | "SemiBold" | "Bold";

const faces = new Map<Weight, Font>();
const face = (w: Weight) => {
  let f = faces.get(w);
  if (!f) {
    const file = fs.readFileSync(path.join(FONTS, `Geist-${w}.ttf`));
    f = parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    faces.set(w, f);
  }
  return f;
};

export async function cover(image: Buffer, width: number, height: number) {
  return sharp(image).rotate().resize(width, height, { fit: "cover", position: "centre" }).toBuffer();
}

/** One block of type as a transparent image, wrapped to maxWidth and centred, with its real size. */
export async function type(text: string, o: { size: number; weight?: Weight; color?: string; opacity?: number; maxWidth: number; spacing?: number }) {
  const font = face(o.weight ?? "SemiBold");
  const tracking = o.spacing ?? 0;
  const measure = (s: string) => font.getAdvanceWidth(s, o.size) + tracking * Math.max(0, s.length - 1);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > o.maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  const lineHeight = Math.round(o.size * 1.22);
  const ascent = (font.ascender / font.unitsPerEm) * o.size;
  const pad = Math.ceil(o.size * 0.08);
  const width = Math.ceil(Math.max(...lines.map(measure))) + pad * 2;
  const height = lineHeight * lines.length + pad * 2;
  // One outline per glyph: the SVG renderer cuts a single very long outline short, so a long hook lost its end.
  const fill = `fill="${o.color ?? "#FFFFFF"}" fill-opacity="${o.opacity ?? 1}"`;
  const glyphs = lines.flatMap((l, i) => {
    const x = pad + (width - pad * 2 - measure(l)) / 2;
    const y = pad + i * lineHeight + (lineHeight - o.size * 1.0) / 2 + ascent * 0.92;
    return font.getPaths(l, x, y, o.size, { letterSpacing: tracking / o.size }).map((g) => g.toPathData(2)).filter(Boolean).map((d) => `<path d="${d}" ${fill}/>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${glyphs.join("")}</svg>`;
  return { input: await sharp(Buffer.from(svg)).png().toBuffer(), width, height };
}

/** Type on a solid pill, centred on (cx, cy). Returns the layers in paint order. */
export async function pill(text: string, o: { cx: number; cy: number; size: number; maxWidth: number; fill?: string; color?: string; weight?: Weight }): Promise<Layer[]> {
  const t = await type(text, { size: o.size, weight: o.weight ?? "Bold", color: o.color ?? "#FFFFFF", maxWidth: o.maxWidth });
  const padX = Math.round(o.size * 0.62), padY = Math.round(o.size * 0.42);
  const w = t.width + padX * 2, h = t.height + padY * 2;
  const radius = Math.min(Math.round(o.size * 0.5), h / 2);
  const box = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="${o.fill ?? "#000000"}"/></svg>`);
  const left = Math.round(o.cx - w / 2), top = Math.round(o.cy - h / 2);
  return [{ input: box, left, top }, { input: t.input, left: left + padX, top: top + padY }];
}

/** A quiet corner label: small, tracked, part-transparent, with a soft shade under it so it reads on any photo. */
export async function label(text: string, o: { x: number; y: number; size: number; anchor: "left" | "right" }): Promise<Layer[]> {
  const t = await type(text, { size: o.size, weight: "SemiBold", opacity: 0.92, maxWidth: 600, spacing: o.size * 0.04 });
  const shade = await type(text, { size: o.size, weight: "SemiBold", color: "#000000", opacity: 0.45, maxWidth: 600, spacing: o.size * 0.04 });
  const blurred = await sharp(shade.input).extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(5).toBuffer();
  const left = o.anchor === "left" ? o.x : o.x - t.width;
  const top = o.y - t.height;
  return [{ input: blurred, left: left - 12, top: top - 12 }, { input: t.input, left, top }];
}

export async function canvas(width: number, height: number, layers: Layer[]) {
  return sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .composite(layers.map((l) => ({ input: l.input, left: l.left, top: l.top })))
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

export const thumb = (jpeg: Buffer, width = 360) => sharp(jpeg).resize({ width }).webp({ quality: 78 }).toBuffer();
export { sharp };
