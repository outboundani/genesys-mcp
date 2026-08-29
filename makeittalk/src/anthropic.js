// Claude API client over raw fetch (this repo is zero-dependency by design,
// so no SDK bundle). Defaults: claude-opus-5, adaptive thinking (the model
// default - no `thinking` param sent), server-side refusal fallbacks enabled.

const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-opus-5';
export const ALLOWED_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

export class ClaudeError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function claude(env, { model, system, messages, tools, tool_choice, max_tokens = 16000 }) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ClaudeError('ANTHROPIC_API_KEY is not configured on this Worker - set it with `npx wrangler secret put ANTHROPIC_API_KEY`.', 500);
  }
  const body = {
    model: ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL,
    max_tokens,
    messages,
    fallbacks: 'default',
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
  };

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'server-side-fallback-2026-07-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = new ClaudeError(`Network error reaching the Claude API: ${e.message}`, 0);
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const retryAfter = Math.min(Number(res.headers.get('retry-after') || 0) || 2 * (attempt + 1), 30);
      lastErr = new ClaudeError(`Claude API busy (HTTP ${res.status}), retrying...`, res.status);
      await res.body?.cancel?.();
      await sleep(retryAfter * 1000);
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new ClaudeError(`Claude API error: ${msg}`, res.status);
    }
    if (data.stop_reason === 'refusal') {
      const why = data.stop_details?.explanation || data.stop_details?.category || 'safety refusal';
      throw new ClaudeError(`Claude declined this request (${why}). Try a different docs source or rephrase the project goal.`, 422);
    }
    return data;
  }
  throw lastErr || new ClaudeError('Claude API unreachable after retries.', 0);
}

// Structured JSON extraction: offer Claude one emit tool describing the target
// shape, prefer the tool_use payload, fall back to parsing JSON from text, and
// retry once with a corrective nudge if neither yields an object.
export async function claudeJson(env, { model, system, prompt, toolName, toolDescription, schema, max_tokens = 16000 }) {
  const tools = [{ name: toolName, description: toolDescription, input_schema: schema }];
  const messages = [{ role: 'user', content: prompt }];
  const instruction = `\n\nCall the ${toolName} tool exactly once with the complete result. Do not answer in plain text.`;

  for (let round = 0; round < 2; round++) {
    const res = await claude(env, {
      model,
      system,
      messages: round === 0
        ? [{ role: 'user', content: prompt + instruction }]
        : messages,
      tools,
      max_tokens,
    });
    const toolUse = (res.content || []).find((b) => b.type === 'tool_use' && b.name === toolName);
    if (toolUse && toolUse.input && typeof toolUse.input === 'object') {
      return { data: toolUse.input, usage: res.usage };
    }
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    if (parsed) return { data: parsed, usage: res.usage };

    messages.length = 0;
    messages.push(
      { role: 'user', content: prompt + instruction },
      { role: 'assistant', content: res.content?.length ? res.content : [{ type: 'text', text: text || '(empty)' }] },
      { role: 'user', content: `That response did not include a ${toolName} tool call. Call the ${toolName} tool now with the full result and nothing else.` },
    );
  }
  throw new ClaudeError('Claude did not return structured output after a retry.', 502);
}

// Pulls the largest parseable JSON object out of free text (handles ```json fences).
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [fenced?.[1], text]) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    if (start === -1) continue;
    for (let end = candidate.length; end > start; end--) {
      if (candidate[end - 1] !== '}') continue;
      try {
        const obj = JSON.parse(candidate.slice(start, end));
        if (obj && typeof obj === 'object') return obj;
      } catch { /* keep shrinking */ }
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
