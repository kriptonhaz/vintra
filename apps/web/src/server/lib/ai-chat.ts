/**
 * Provider-neutral chat-completion client with function calling, used by
 * Juragan AI. Mirrors the Go adapters (`apps/api/internal/ai/openai.go`,
 * `gemini.go`) — plain fetch, no SDK, no streaming — and adds the tool
 * protocol each vendor speaks:
 *   - openai   → tools / tool_calls on /chat/completions (also covers
 *                DeepSeek and any OpenAI-compatible baseUrl)
 *   - gemini   → functionDeclarations / functionCall / functionResponse
 *                on :generateContent
 *
 * Server-only (`server/lib`) — imported by business-ai.ts, never by client
 * code. See ai-image-provider.ts for the bundle-stripping rationale.
 */

import type { TextProvider } from './ai-text-provider'

// ─── Neutral types ───────────────────────────────────────────────────

export type ChatMessage =
  // 'system' and 'user' are separate members rather than a role union, so
  // `Extract<ChatMessage, { role: 'system' }>` actually narrows — collapsed
  // into one member it resolves to `never` and the narrowing silently fails.
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema object for the tool's parameters. */
  parameters: Record<string, unknown>
}

export interface ChatCompletion {
  text: string | null
  toolCalls: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
}

const TIMEOUT_MS = 60_000
const MAX_OUTPUT_TOKENS = 1024

export async function chatComplete(
  provider: TextProvider,
  messages: ChatMessage[],
  tools: ToolDef[],
): Promise<ChatCompletion> {
  if (provider.providerType === 'gemini') {
    return geminiComplete(provider, messages, tools)
  }
  // 'openai' + anything OpenAI-compatible (DeepSeek via custom baseUrl).
  return openaiComplete(provider, messages, tools)
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `AI provider error ${res.status}: ${text.slice(0, 300)}`,
      )
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ─── OpenAI-compatible ───────────────────────────────────────────────

function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      }
    }
    return { role: m.role, content: m.content }
  })
}

async function openaiComplete(
  provider: TextProvider,
  messages: ChatMessage[],
  tools: ToolDef[],
): Promise<ChatCompletion> {
  const base = provider.baseUrl || 'https://api.openai.com/v1'
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: toOpenAiMessages(messages),
    max_tokens: MAX_OUTPUT_TOKENS,
  }
  if (tools.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: t }))
    body.tool_choice = 'auto'
  }

  const json = await fetchJson(
    `${base.replace(/\/$/, '')}/chat/completions`,
    { Authorization: `Bearer ${provider.apiKey}` },
    body,
  )

  const msg = json.choices?.[0]?.message ?? {}
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).flatMap(
    (c: any, i: number) => {
      if (c?.type && c.type !== 'function') return []
      let args: Record<string, unknown> = {}
      try {
        args = c.function?.arguments ? JSON.parse(c.function.arguments) : {}
      } catch {
        // Malformed JSON args — pass empty and let the tool's zod
        // validation produce a readable error for the model.
      }
      return [{ id: c.id ?? `call_${i}`, name: c.function?.name ?? '', arguments: args }]
    },
  )

  return {
    text: msg.content ?? null,
    toolCalls,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  }
}

// ─── Gemini ──────────────────────────────────────────────────────────

function toGeminiContents(messages: ChatMessage[]) {
  const contents: Array<{ role: string; parts: any[] }> = []
  for (const m of messages) {
    if (m.role === 'system') continue // handled via systemInstruction
    if (m.role === 'tool') {
      let response: unknown
      try {
        response = JSON.parse(m.content)
      } catch {
        response = { result: m.content }
      }
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name, response } }],
      })
      continue
    }
    if (m.role === 'assistant') {
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      for (const c of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: c.name, args: c.arguments } })
      }
      if (parts.length) contents.push({ role: 'model', parts })
      continue
    }
    contents.push({ role: 'user', parts: [{ text: m.content }] })
  }
  return contents
}

async function geminiComplete(
  provider: TextProvider,
  messages: ChatMessage[],
  tools: ToolDef[],
): Promise<ChatCompletion> {
  const base =
    provider.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  const system = messages.find(
    (m): m is Extract<ChatMessage, { role: 'system' }> => m.role === 'system',
  )

  const body: Record<string, unknown> = {
    contents: toGeminiContents(messages),
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  }
  if (system) body.systemInstruction = { parts: [{ text: system.content }] }
  if (tools.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ]
  }

  const json = await fetchJson(
    `${base.replace(/\/$/, '')}/models/${provider.model}:generateContent`,
    { 'x-goog-api-key': provider.apiKey },
    body,
  )

  const parts: any[] = json.candidates?.[0]?.content?.parts ?? []
  let text: string | null = null
  const toolCalls: ToolCall[] = []
  for (const [i, part] of parts.entries()) {
    if (typeof part.text === 'string' && part.text) {
      text = (text ?? '') + part.text
    }
    if (part.functionCall?.name) {
      // Gemini has no call ids — synthesize one. Pairing back is by
      // functionResponse NAME (see toGeminiContents), so the id only
      // matters for the neutral shape.
      toolCalls.push({
        id: `${part.functionCall.name}_${i}`,
        name: part.functionCall.name,
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
      })
    }
  }

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  }
}
