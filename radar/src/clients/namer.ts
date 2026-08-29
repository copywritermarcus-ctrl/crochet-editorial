import Anthropic from '@anthropic-ai/sdk';

/**
 * Deliberately dumb: takes a fully-built prompt, returns the model's raw text.
 * Parsing, validation and the single retry all live in the naming stage, so
 * tests can drive both by handing back a canned string.
 */
export interface Namer {
  complete(prompt: string): Promise<string>;
}

export function createAnthropicNamer(opts: { apiKey: string; model: string }): Namer {
  const client = new Anthropic({ apiKey: opts.apiKey });

  return {
    async complete(prompt: string): Promise<string> {
      const response = await client.messages.create({
        model: opts.model,
        // The reply is a short JSON object; a few hundred tokens is ample.
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
    },
  };
}
