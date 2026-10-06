import type { AiProtocol } from '@da/contracts';

/**
 * A minimal client for OpenCode Zen (https://opencode.ai/zen/v1).
 *
 * Zen is one key in front of many providers, and each model family keeps its
 * own wire protocol. What the official SDKs send, this sends:
 *
 *   messages   Anthropic Messages  POST /messages            x-api-key
 *   responses  OpenAI Responses    POST /responses           Bearer
 *   gemini     Google              POST /models/{id}:generateContent  x-goog-api-key
 *   chat       OpenAI-compatible   POST /chat/completions    Bearer
 *
 * The request and response shapes are pure functions below, so tests pin
 * them without a network.
 */

export const DEFAULT_OPENCODE_BASE = 'https://opencode.ai/zen/v1';

export type ResolvedProtocol = Exclude<AiProtocol, 'auto'>;

/** The protocol a model id speaks, from its family prefix. */
export function protocolFor(model: string): ResolvedProtocol {
  const id = model.toLowerCase();
  if (id.startsWith('claude')) return 'messages';
  if (id.startsWith('gpt') || id.startsWith('grok') || id.startsWith('muse')) return 'responses';
  if (id.startsWith('gemini')) return 'gemini';
  return 'chat';
}

export function familyOf(model: string): string {
  return /^[a-z]+/i.exec(model)?.[0]?.toLowerCase() ?? 'other';
}

export interface CompletionInput {
  model: string;
  protocol: ResolvedProtocol;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Left out of the request when undefined: some models refuse the parameter. */
  temperature?: number | undefined;
}

export interface WireRequest {
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export function buildRequest(input: CompletionInput, apiKey: string): WireRequest {
  const temperature = input.temperature === undefined ? {} : { temperature: input.temperature };
  const bearer = { authorization: `Bearer ${apiKey}` };
  switch (input.protocol) {
    case 'messages':
      return {
        path: '/messages',
        headers: { ...bearer, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: {
          model: input.model,
          max_tokens: input.maxTokens,
          ...temperature,
          system: input.system,
          messages: [{ role: 'user', content: input.prompt }],
        },
      };
    case 'responses':
      return {
        path: '/responses',
        headers: bearer,
        body: {
          model: input.model,
          instructions: input.system,
          input: input.prompt,
          max_output_tokens: input.maxTokens,
        },
      };
    case 'gemini':
      return {
        path: `/models/${encodeURIComponent(input.model)}:generateContent`,
        headers: { ...bearer, 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          generationConfig: { maxOutputTokens: input.maxTokens, ...temperature },
        },
      };
    default:
      return {
        path: '/chat/completions',
        headers: bearer,
        body: {
          model: input.model,
          max_tokens: input.maxTokens,
          ...temperature,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.prompt },
          ],
        },
      };
  }
}

/** The model's text out of whichever response shape came back. */
export function readText(protocol: ResolvedProtocol, body: unknown): string {
  const record = (body ?? {}) as Record<string, unknown>;
  switch (protocol) {
    case 'messages': {
      const content = (record.content ?? []) as { type?: string; text?: string }[];
      return content
        .filter((part) => part.type === 'text' || typeof part.text === 'string')
        .map((part) => part.text ?? '')
        .join('');
    }
    case 'responses': {
      if (typeof record.output_text === 'string') return record.output_text;
      const output = (record.output ?? []) as { content?: { type?: string; text?: string }[] }[];
      return output
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text' || typeof part.text === 'string')
        .map((part) => part.text ?? '')
        .join('');
    }
    case 'gemini': {
      const candidates = (record.candidates ?? []) as {
        content?: { parts?: { text?: string }[] };
      }[];
      return (candidates[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    }
    default: {
      const choices = (record.choices ?? []) as { message?: { content?: unknown } }[];
      const content = choices[0]?.message?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return (content as { text?: string }[]).map((part) => part.text ?? '').join('');
      }
      return '';
    }
  }
}

export class OpenCodeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** The error text a provider put in its body, without echoing anything we sent. */
function providerError(body: unknown): string {
  const record = (body ?? {}) as { error?: unknown; message?: unknown };
  if (typeof record.error === 'string') return record.error;
  if (record.error && typeof record.error === 'object') {
    const inner = record.error as { message?: unknown; type?: unknown };
    if (typeof inner.message === 'string') return inner.message;
  }
  if (typeof record.message === 'string') return record.message;
  return '';
}

/** Models that refused `temperature` in this process. */
const NO_TEMPERATURE = new Set<string>();

export class OpenCodeClient {
  constructor(
    private readonly apiKey: string,
    private readonly base: string = DEFAULT_OPENCODE_BASE,
  ) {}

  async models(): Promise<string[]> {
    const response = await fetch(`${this.base}/models`, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new OpenCodeError(`OpenCode model list: ${String(response.status)}`, response.status);
    }
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string');
  }

  async complete(input: CompletionInput): Promise<string> {
    // A model that has refused `temperature` before is asked without it.
    const request = NO_TEMPERATURE.has(input.model) ? { ...input, temperature: undefined } : input;
    try {
      return await this.send(request);
    } catch (error) {
      // Newer models (claude-sonnet-5-5 among them) reject the parameter
      // outright with a 400. Retry once without it and remember the model
      // for the life of the process, rather than failing every generation.
      if (
        error instanceof OpenCodeError &&
        error.status === 400 &&
        request.temperature !== undefined &&
        /temperature/i.test(error.message)
      ) {
        NO_TEMPERATURE.add(input.model);
        return this.send({ ...request, temperature: undefined });
      }
      throw error;
    }
  }

  private async send(input: CompletionInput): Promise<string> {
    const wire = buildRequest(input, this.apiKey);
    let response: Response;
    try {
      response = await fetch(`${this.base}${wire.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...wire.headers,
        },
        body: JSON.stringify(wire.body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      throw new OpenCodeError(
        `OpenCode did not answer: ${error instanceof Error ? error.message : 'unknown'}`,
        null,
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // Some providers echo the credential they rejected; never pass it on.
      const reason = providerError(body).split(this.apiKey).join('[redacted]');
      throw new OpenCodeError(
        `OpenCode ${String(response.status)} for ${input.model} (${input.protocol})${reason ? `: ${reason.slice(0, 300)}` : ''}`,
        response.status,
      );
    }
    const text = readText(input.protocol, body);
    if (!text.trim()) {
      throw new OpenCodeError(
        `OpenCode returned no text for ${input.model}. If this model speaks another protocol, choose it in the AI settings.`,
        response.status,
      );
    }
    return text;
  }
}

/**
 * The JSON object in a model's answer. Models wrap JSON in prose or a code
 * fence however firmly they are asked not to; this takes the outermost
 * object and leaves validation to the caller.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return a JSON object.');
  return JSON.parse(candidate.slice(start, end + 1));
}
