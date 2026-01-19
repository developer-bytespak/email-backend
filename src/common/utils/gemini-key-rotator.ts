const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export function getNextOpenAiApiKey(): string {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }
  return OPENAI_API_KEY;
}

