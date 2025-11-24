const GEMINI_KEY_ENV_VARS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter((key): key is string => Boolean(key));

let currentKeyIndex = 0;

export function getNextGeminiApiKey(): string {
  if (GEMINI_KEY_ENV_VARS.length === 0) {
    throw new Error('Gemini API keys are not configured');
  }

  const apiKey = GEMINI_KEY_ENV_VARS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_KEY_ENV_VARS.length;
  return apiKey;
}

