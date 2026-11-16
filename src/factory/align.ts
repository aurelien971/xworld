import sharp from "sharp";

/**
 * Registering the after onto the before. The image model returns the same
 * photo slightly zoomed or shifted, which is invisible in a still and ruins
 * a wipe: the face jumps as the line crosses it. This finds the scale and
 * shift that put the after's edges back on the before's (edges, not colour,
 * so a regrade or a restyle does not confuse it), then cuts both to the
 * area they share. What comes back is two pictures of identical size in
 * which every feature, the eyes first of all, sits on the same pixel.
 */
export type Alignment = { scale: number; dx: number; dy: number; score: number; kept: number; applied: boolean };

type Map = { data: Float32Array; w: number; h: number };

/** Edge strength of a picture at a small working size, with the mean taken out. */
async function edges(image: Buffer, w: number, h: number): Promise<Map> {
  const { data } = await sharp(image).rotate().resize(w, h, { fit: "fill" }).greyscale().blur(1).raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = data[i + 1] - data[i - 1] + 0.5 * (data[i - w + 1] - data[i - w - 1] + data[i + w + 1] - data[i + w - 1]);
    const gy = data[i + w] - data[i - w] + 0.5 * (data[i + w - 1] - data[i - w - 1] + data[i + w + 1] - data[i - w + 1]);
    sum += out[i] = Math.sqrt(gx * gx + gy * gy);
  }
  const mean = sum / (w * h);
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return { data: out, w, h };
}

/** The map scaled about its centre by s (bilinear); NaN where it has nothing to show. */
function scaled(m: Map, s: number): Float32Array {
  const { w, h, data } = m;
  const out = new Float32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    const sy = (y - cy) / s + cy;
    const y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = (x - cx) / s + cx;
      const x0 = Math.floor(sx), fx = sx - x0;
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out[y * w + x] = NaN;
        continue;
      }
      const i = y0 * w + x0;
      out[y * w + x] = data[i] * (1 - fx) * (1 - fy) + data[i + 1] * fx * (1 - fy) + data[i + w] * (1 - fx) * fy + data[i + w + 1] * fx * fy;
    }
  }
  return out;
}

/** How well the before's edges and the shifted after's agree, over the area both cover. */
function agreement(b: Map, a: Float32Array, dx: number, dy: number) {
  const { w, h, data } = b;
  let ab = 0, aa = 0, bb = 0, n = 0;
  const y0 = Math.max(0, dy), y1 = Math.min(h, h + dy), x0 = Math.max(0, dx), x1 = Math.min(w, w + dx);
  for (let y = y0; y < y1; y++) {
    const row = y * w, arow = (y - dy) * w - dx;
    for (let x = x0; x < x1; x++) {
      const av = a[arow + x];
      if (av !== av) continue;
      const bv = data[row + x];
      ab += av * bv;
      aa += av * av;
      bb += bv * bv;
      n++;
    }
  }
  return n < w * h * 0.4 || !aa || !bb ? -1 : ab / Math.sqrt(aa * bb);
}

function search(b: Map, a: Map, scales: number[], range: number, around: { dx: number; dy: number } = { dx: 0, dy: 0 }) {
  let best = { scale: 1, dx: 0, dy: 0, score: -1 };
  for (const s of scales) {
    const as = scaled(a, s);
    for (let dy = around.dy - range; dy <= around.dy + range; dy++) for (let dx = around.dx - range; dx <= around.dx + range; dx++) {
      const score = agreement(b, as, dx, dy);
      if (score > best.score) best = { scale: s, dx, dy, score };
    }
  }
  return best;
}

const steps = (from: number, to: number, by: number) => Array.from({ length: Math.round((to - from) / by) + 1 }, (_, i) => +(from + i * by).toFixed(4));

/** The scale and shift (as fractions of the frame) that lay the after over the before. */
export async function register(before: Buffer, after: Buffer): Promise<Omit<Alignment, "kept" | "applied">> {
  const meta = await sharp(before).rotate().metadata();
  const ratio = (meta.height ?? 4) / (meta.width ?? 3);
  // Coarse: every scale from 0.8 to 1.25, shifts up to an eighth of the frame.
  const cw = 80, ch = Math.round(cw * ratio);
  const [cb, ca] = await Promise.all([edges(before, cw, ch), edges(after, cw, ch)]);
  const coarse = search(cb, ca, steps(0.8, 1.25, 0.01), 10);
  // Fine: three times the size, close around the coarse answer.
  const fw = 240, fh = Math.round(fw * ratio);
  const [fb, fa] = await Promise.all([edges(before, fw, fh), edges(after, fw, fh)]);
  const fine = search(fb, fa, steps(coarse.scale - 0.012, coarse.scale + 0.012, 0.003), 4, { dx: coarse.dx * 3, dy: coarse.dy * 3 });
  return { scale: fine.scale, dx: fine.dx / fw, dy: fine.dy / fh, score: +fine.score.toFixed(3) };
}

/**
 * Both pictures cut to what they share, the after laid over the before.
 * When the edges do not agree well enough to trust (a filter that redraws
 * everything) or too little would be left, the pair comes back as it was,
 * sized alike, and says so.
 */
export async function aligned(before: Buffer, after: Buffer): Promise<{ before: Buffer; after: Buffer; alignment: Alignment }> {
  const base = await sharp(before).rotate().toBuffer({ resolveWithObject: true });
  const W = base.info.width, H = base.info.height;
  const r = await register(before, after);
  const sw = Math.round(W * r.scale), sh = Math.round(H * r.scale);
  const ox = Math.round((W - sw) / 2 + r.dx * W), oy = Math.round((H - sh) / 2 + r.dy * H);
  const x0 = Math.max(0, ox), y0 = Math.max(0, oy), x1 = Math.min(W, ox + sw), y1 = Math.min(H, oy + sh);
  const kept = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (W * H);
  const trivial = Math.abs(r.scale - 1) < 0.004 && Math.abs(r.dx) < 0.003 && Math.abs(r.dy) < 0.003;
  if (r.score < 0.2 || kept < 0.6 || trivial) {
    return { before: base.data, after: await sharp(after).rotate().resize(W, H, { fit: "fill" }).toBuffer(), alignment: { ...r, kept: 1, applied: false } };
  }
  const w = x1 - x0, h = y1 - y0;
  const [b, a] = await Promise.all([
    sharp(base.data).extract({ left: x0, top: y0, width: w, height: h }).toBuffer(),
    sharp(after).rotate().resize(sw, sh, { fit: "fill" }).extract({ left: x0 - ox, top: y0 - oy, width: w, height: h }).toBuffer(),
  ]);
  return { before: b, after: a, alignment: { ...r, kept: +kept.toFixed(3), applied: true } };
}

/**
 * The same window cut from both pictures, chosen once on the before (where
 * the eye is drawn: faces and skin) so the two crops can never drift apart.
 */
export async function coverPair(before: Buffer, after: Buffer, width: number, height: number): Promise<[Buffer, Buffer]> {
  const meta = await sharp(before).metadata();
  const W = meta.width!, H = meta.height!;
  const scale = Math.max(width / W, height / H);
  const rw = Math.max(width, Math.round(W * scale)), rh = Math.max(height, Math.round(H * scale));
  const picked = await sharp(before).resize(width, height, { fit: "cover", position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
  const info = picked.info as typeof picked.info & { cropOffsetLeft?: number; cropOffsetTop?: number };
  const left = Math.min(rw - width, Math.max(0, Math.abs(info.cropOffsetLeft ?? Math.round((rw - width) / 2))));
  const top = Math.min(rh - height, Math.max(0, Math.abs(info.cropOffsetTop ?? Math.round((rh - height) / 2))));
  const cut = (img: Buffer) => sharp(img).resize(rw, rh, { fit: "fill" }).extract({ left, top, width, height }).toBuffer();
  return Promise.all([cut(before), cut(after)]);
}
