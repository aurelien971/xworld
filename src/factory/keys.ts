/**
 * The image model's key. The factory's own (FACTORY_OPENAI_KEY) comes first, so a key
 * that happens to be set in the shell for other work never stands in for it.
 */
export const openaiKey = () => (process.env.FACTORY_OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();

/**
 * The spending switch. With FACTORY_GENERATION=off nothing new is asked of the image
 * model: pairs that are already kept still work, anything else stops with a plain reason.
 */
export const generationPaused = () => (process.env.FACTORY_GENERATION || "").trim().toLowerCase() === "off";
