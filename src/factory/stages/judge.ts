import { openaiKey } from "../keys";
import { sql } from "../db";
import { sharp } from "../scenes/draw";
import type { Review } from "../types";

/**
 * The review: one small vision call per pair, kept by pair so a pair is only
 * ever judged once. It answers three things a person would check before
 * posting: does it look real, did the subject stay put, is the after worth
 * showing. Without a key the brief waits for a person instead.
 */
export const PASS = 75;
export const HOLD = 55;

type Scores = { realism: number; alignment: number; appeal: number; note: string };

export function outcome(s: Scores): Review["outcome"] {
  const score = overall(s);
  const floor = Math.min(s.realism, s.alignment, s.appeal);
  if (score < HOLD || floor < 40) return "reject";
  return score >= PASS && floor >= 60 ? "pass" : "hold";
}
export const overall = (s: Scores) => Math.round(s.appeal * 0.4 + s.realism * 0.3 + s.alignment * 0.3);

const small = async (image: Buffer) => (await sharp(image).rotate().resize({ width: 768, height: 768, fit: "inside" }).jpeg({ quality: 85 }).toBuffer()).toString("base64");

export const judgeAvailable = () => !!openaiKey();

export async function judge(o: { key: string; before: Buffer; after: Buffer; filterName: string; benefit: string }): Promise<Review & { costUsd: number; cached: boolean }> {
  const model = process.env.JUDGE_MODEL || "gpt-4o";
  const [kept] = await sql<{ result: Scores }>("select result from judgements where key = $1", [o.key]);
  let scores = kept?.result;
  let costUsd = 0;
  if (!scores) {
    const text =
      `Image 1 is a phone photo. Image 2 is the same photo after the "${o.filterName}" filter (${o.benefit || "a photo filter"}) in a photo editing app. ` +
      "The pair will be posted as a before/after to sell the app to young women who edit their photos. Be a hard marker and use the whole scale: 50 is an ordinary, forgettable result, 70 is good, above 85 is rare. Score each 0-100:\n" +
      "realism: image 2 is free of generation faults (warped hands or teeth, melted detail, plastic skin, garbled text, a changed face). For a deliberately stylised filter, judge whether it is a convincing example of that style instead.\n" +
      "alignment: the subject is the same person at the same position, size and crop as in image 1, so the two line up when shown side by side. Take points off when the place, the time of day or the colour of her clothes changed and the filter was not about that.\n" +
      "appeal: at a glance, image 2 is clearly different from image 1 and is the one she would rather post. Below 40 when the two are hard to tell apart, or when image 2 looks worse: too dark to see her face, muddy or dull colour, a flat colour haze over the whole picture, greasy or wet-looking skin.\n" +
      'Respond with JSON exactly: {"realism": <int>, "alignment": <int>, "appeal": <int>, "note": "<one plain sentence naming the weakest point>"}';
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [
          { type: "text", text },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${await small(o.before)}`, detail: "high" } },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${await small(o.after)}`, detail: "high" } },
        ] }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } } | null;
    if (!res.ok) throw new Error(body?.error?.message || `The review model answered ${res.status}.`);
    const parsed = JSON.parse(body?.choices?.[0]?.message?.content || "{}") as Partial<Scores>;
    const n = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v))));
    if (![parsed.realism, parsed.alignment, parsed.appeal].every((v) => Number.isFinite(Number(v)))) throw new Error("The review model returned no scores.");
    scores = { realism: n(parsed.realism), alignment: n(parsed.alignment), appeal: n(parsed.appeal), note: String(parsed.note ?? "").slice(0, 300) };
    // gpt-4o, per million tokens: in $2.50, out $10.
    costUsd = ((body?.usage?.prompt_tokens ?? 0) * 2.5 + (body?.usage?.completion_tokens ?? 0) * 10) / 1e6;
    await sql("insert into judgements (key, result, cost_usd) values ($1,$2,$3) on conflict (key) do nothing", [o.key, JSON.stringify(scores), costUsd]);
    if (costUsd) await sql("insert into costs (kind, usd, ref) values ('review', $1, $2)", [costUsd, o.key]);
  }
  return { by: "judge", outcome: outcome(scores), score: overall(scores), realism: scores.realism, alignment: scores.alignment, appeal: scores.appeal, note: scores.note, model, at: new Date().toISOString(), costUsd, cached: !!kept };
}
