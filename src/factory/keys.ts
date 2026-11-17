/**
 * The image model's key. The factory's own (FACTORY_OPENAI_KEY) comes first, so a key
 * that happens to be set in the shell for other work never stands in for it.
 */
export const openaiKey = () => (process.env.FACTORY_OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();
