import { randomUUID } from 'node:crypto';

import type { AiProtocol } from '@da/contracts';

import { say } from '../../common/panel-locale.js';

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
  /**
   * How long to wait for the whole answer. Short work keeps the default; a
   * long article from a thinking model can take several minutes (BUG-0028).
   */
  timeoutMs?: number | undefined;
}

/** The wait for one answer when the caller does not say otherwise. */
export const DEFAULT_TIMEOUT_MS = 180_000;

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

/** The most a retry for an exhausted budget asks for. */
export const MAX_TOKENS_CEILING = 32_000;

/**
 * Why an answer came back without text, from each protocol's own stop field:
 * whether the model hit its token limit, and a short description for the
 * error (the stop reason, and whether there was reasoning but no answer).
 */
export function whyEmpty(
  protocol: ResolvedProtocol,
  body: unknown,
): { stoppedForLength: boolean; detail: string } {
  const record = (body ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  let stop: string;
  let reasoning = false;
  switch (protocol) {
    case 'messages':
      stop = str(record.stop_reason);
      reasoning = ((record.content ?? []) as { type?: string }[]).some(
        (part) => part.type === 'thinking',
      );
      break;
    case 'responses': {
      const details = record.incomplete_details as { reason?: unknown } | undefined;
      stop = str(details?.reason) || str(record.status);
      reasoning = ((record.output ?? []) as { type?: string }[]).some(
        (item) => item.type === 'reasoning',
      );
      break;
    }
    case 'gemini': {
      const candidates = (record.candidates ?? []) as { finishReason?: unknown }[];
      stop = str(candidates[0]?.finishReason);
      break;
    }
    default: {
      const choices = (record.choices ?? []) as {
        finish_reason?: unknown;
        message?: { reasoning_content?: unknown; reasoning?: unknown };
      }[];
      stop = str(choices[0]?.finish_reason);
      const message = choices[0]?.message;
      reasoning = Boolean(message?.reasoning_content ?? message?.reasoning);
    }
  }
  const stoppedForLength = /length|max_tokens|max_output_tokens|MAX_TOKENS/i.test(stop);
  return {
    stoppedForLength,
    detail: [stop ? `stop: ${stop}` : 'no stop reason', reasoning ? 'reasoning only' : '']
      .filter(Boolean)
      .join(', '),
  };
}

/** Models that refused `temperature` in this process. */
const NO_TEMPERATURE = new Set<string>();

/**
 * How this app names itself to OpenCode. OpenCode Go refuses traffic from a
 * generic HTTP library name and asks each client to identify itself.
 */
export const OPENCODE_USER_AGENT = 'digital-activation-store/1.0';

/**
 * One client is one conversation: OpenCode Go routes and caches by the
 * `x-opencode-session` header and refuses requests without it (BUG-0025).
 * Every request this instance makes — both languages of one product's copy,
 * and the corrective retry — carries the same session id. The services create
 * a client per task, so tasks never share one.
 */
export class OpenCodeClient {
  readonly sessionId: string;

  constructor(
    private readonly apiKey: string,
    private readonly base: string = DEFAULT_OPENCODE_BASE,
    sessionId?: string,
  ) {
    this.sessionId = sessionId ?? `da-${randomUUID()}`;
  }

  /** Headers every request carries, whatever the protocol. */
  private get identity(): Record<string, string> {
    return { 'user-agent': OPENCODE_USER_AGENT, 'x-opencode-session': this.sessionId };
  }

  async models(): Promise<string[]> {
    const response = await fetch(`${this.base}/models`, {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        accept: 'application/json',
        ...this.identity,
      },
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
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response: Response;
    try {
      response = await fetch(`${this.base}${wire.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...this.identity,
          ...wire.headers,
        },
        body: JSON.stringify(wire.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        const minutes = Math.round(timeoutMs / 60_000);
        throw new OpenCodeError(
          say(
            `لم يُكمل النموذج ${input.model} الجواب خلال ${String(minutes)} دقائق. أعد المحاولة أو اختر نموذجاً أسرع.`,
            `${input.model} did not finish its answer within ${String(minutes)} minutes. Try again or pick a faster model.`,
          ),
          null,
        );
      }
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
    if (text.trim()) return text;

    // An empty answer (BUG-0027). Thinking models (GLM, Kimi, DeepSeek, Qwen)
    // spend part of max_tokens reasoning; when that runs out before the
    // answer starts, the answer field is empty. Once, with a larger budget.
    const why = whyEmpty(input.protocol, body);
    if (why.stoppedForLength && input.maxTokens < MAX_TOKENS_CEILING) {
      return this.send({ ...input, maxTokens: Math.min(input.maxTokens * 2, MAX_TOKENS_CEILING) });
    }
    throw new OpenCodeError(
      why.stoppedForLength
        ? say(
            `النموذج ${input.model} استهلك كل الرموز المتاحة في التفكير قبل أن يكتب الجواب. اختر نموذجاً آخر أو أعد المحاولة.`,
            `${input.model} spent its whole token budget thinking before it wrote an answer. Pick another model or try again.`,
          )
        : say(
            `لم يُرجع النموذج ${input.model} أي نص (${why.detail}). إن كان يستخدم طريقة اتصال أخرى فاخترها في إعدادات الذكاء الاصطناعي.`,
            `${input.model} returned no text (${why.detail}). If this model speaks another protocol, choose it in the AI settings.`,
          ),
      response.status,
    );
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
