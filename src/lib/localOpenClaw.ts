import type {
  LocalOpenClawBridgeRequest,
  LocalOpenClawBridgeResponse,
  LocalOpenClawBridgeSuccess,
  LocalOpenClawHealthResponse,
  LocalOpenClawHealthSuccess,
  OpenClawContestant,
  SessionMeta,
  StaticContestantSeed,
  TurnPhase,
} from '../types'

export const LOCAL_OPENCLAW_PROVIDER_ID = 'local-openclaw'
export const LOCAL_OPENCLAW_TEXTS_ENDPOINT = '/__openclaw/contestant-texts'
export const LOCAL_OPENCLAW_HEALTH_ENDPOINT = '/__openclaw/health'
export const LOCAL_OPENCLAW_AGENT_MAP = {
  jade: 'contestant-01',
  ember: 'contestant-02',
  mist: 'contestant-03',
  nova: 'contestant-04',
} as const

type OpenClawCliPayload = {
  text?: string
  mediaUrl?: string | null
}

type OpenClawCliEnvelope = {
  payloads?: OpenClawCliPayload[]
  result?: {
    payloads?: OpenClawCliPayload[]
    meta?: {
      agentMeta?: {
        provider?: string
        model?: string
      }
    }
    stopReason?: string
  }
  meta?: {
    agentMeta?: {
      provider?: string
      model?: string
    }
  }
  stopReason?: string
}

type ParsedOpenClawCliSuccess = {
  ok: true
  payload: { poem: string; drawingPrompt: string; strategyHint: string }
  providerSummary?: string
}

type ParsedOpenClawCliError = {
  ok: false
  code: string
  message: string
}

export type ParsedOpenClawCliResult = ParsedOpenClawCliSuccess | ParsedOpenClawCliError

export function createLocalOpenClawRunId() {
  return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function buildLocalOpenClawRequest(
  contestants: readonly StaticContestantSeed[],
  canvasSize: number,
  phases: readonly TurnPhase[],
  runId?: string,
): LocalOpenClawBridgeRequest {
  return {
    contestants: contestants.map((contestant) => ({ ...contestant })),
    canvasSize,
    phases: [...phases],
    runId,
  }
}

export function resolveLocalOpenClawRunId(runId?: string) {
  const normalizedRunId = runId?.trim()
  return normalizedRunId || createLocalOpenClawRunId()
}

export function buildLocalOpenClawSessionId(runId: string, agentId: string) {
  return `art-cooperation-${runId}-${agentId}`
}

export function buildLocalOpenClawPrompt(
  contestant: StaticContestantSeed,
  canvasSize: number,
  phases: readonly TurnPhase[],
) {
  return [
    'You are generating structured co-creation text for a pixel-art relay.',
    'Return exactly one compact JSON object and nothing else.',
    'Required JSON keys: poem, drawingPrompt, strategyHint.',
    'Do not wrap the JSON in markdown fences.',
    `Canvas size: ${canvasSize}x${canvasSize}.`,
    `Phases: ${phases.join(', ')}.`,
    `Contestant id: ${contestant.id}.`,
    `Contestant name: ${contestant.name}.`,
    `Persona: ${contestant.personaPrompt}.`,
    `Current poem: ${contestant.poem}.`,
    'Write a fresh short poem, a concrete drawingPrompt, and a concise strategyHint that can guide deterministic local pixel generation.',
  ].join('\n')
}

export function parseOpenClawCliResult(
  stdout: string,
  agentId: string,
): ParsedOpenClawCliResult {
  const envelope = extractCliEnvelope(stdout)
  if (!envelope) {
    const snippet = stdout.trim().slice(0, 280)
    return {
      ok: false,
      code: 'cli_output_invalid',
      message: `OpenClaw CLI returned no parseable JSON envelope for ${agentId}${snippet ? `: ${snippet}` : ''}`,
    }
  }

  const normalizedEnvelope = normalizeCliEnvelope(envelope)
  const payloadText = normalizedEnvelope.payloads.map((payload) => payload.text ?? '').join('\n').trim()
  if (normalizedEnvelope.stopReason === 'error' || payloadText.includes('event:error')) {
    const contractMismatch = detectAgentContractMismatch(payloadText)
    return {
      ok: false,
      code: contractMismatch ? 'agent_contract_mismatch' : 'upstream_error',
      message: contractMismatch
        ? `OpenClaw agent ${agentId} requires an instructions-aware transport: ${contractMismatch}`
        : `OpenClaw agent ${agentId} failed: ${payloadText || normalizedEnvelope.stopReason || 'unknown error'}`,
    }
  }

  const structuredPayload = extractStructuredPayload(payloadText)
  if (!structuredPayload) {
    return {
      ok: false,
      code: 'payload_invalid',
      message: `OpenClaw agent ${agentId} did not return the expected JSON payload`,
    }
  }

  const provider = normalizedEnvelope.meta?.agentMeta?.provider
  const model = normalizedEnvelope.meta?.agentMeta?.model

  return {
    ok: true,
    payload: structuredPayload,
    providerSummary: provider && model ? `${provider}/${model}` : undefined,
  }
}

export function createBridgeError(code: string, message: string, sourceLabel: string): LocalOpenClawBridgeResponse {
  return { ok: false, code, message, sourceLabel }
}

export function createHealthSuccess(
  sourceLabel: string,
  health: string,
  model: string,
): LocalOpenClawHealthSuccess {
  return {
    ok: true,
    sourceLabel,
    health,
    model,
  }
}

export function createBridgeSuccess(
  contestants: OpenClawContestant[],
  sourceLabel: string,
  runId?: string,
): LocalOpenClawBridgeSuccess {
  const meta: SessionMeta = {
    providerId: LOCAL_OPENCLAW_PROVIDER_ID,
    providerLabel: 'Local OpenClaw Provider',
    mode: 'local-openclaw',
    sourceLabel,
    runId,
  }

  return {
    ok: true,
    contestants,
    meta,
  }
}

export async function fetchLocalOpenClawContestants(
  request: LocalOpenClawBridgeRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<{ contestants: OpenClawContestant[]; meta: SessionMeta }> {
  const response = await fetchImpl(LOCAL_OPENCLAW_TEXTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(`Local OpenClaw bridge HTTP error: ${response.status}`)
  }

  const payload = (await response.json()) as LocalOpenClawBridgeResponse
  if (!payload.ok) {
    throw new Error(`Local OpenClaw bridge error: ${payload.code} - ${payload.message}`)
  }

  return {
    contestants: payload.contestants,
    meta: payload.meta,
  }
}

export function isLocalOpenClawHealthResponse(value: unknown): value is LocalOpenClawHealthResponse {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (candidate.ok === false) {
    return (
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string' &&
      typeof candidate.sourceLabel === 'string'
    )
  }

  return (
    candidate.ok === true &&
    typeof candidate.sourceLabel === 'string' &&
    typeof candidate.health === 'string' &&
    typeof candidate.model === 'string'
  )
}

function extractCliEnvelope(stdout: string): OpenClawCliEnvelope | null {
  const positions = [...stdout.matchAll(/\{/g)].map((match) => match.index ?? -1).filter((index) => index >= 0)

  for (const index of positions) {
    const candidate = stdout.slice(index).trim()

    try {
      const parsed = JSON.parse(candidate) as OpenClawCliEnvelope
      if (
        Array.isArray(parsed.payloads) ||
        typeof parsed.stopReason === 'string' ||
        Array.isArray(parsed.result?.payloads) ||
        typeof parsed.result?.stopReason === 'string'
      ) {
        return parsed
      }
    } catch {
      continue
    }
  }

  return null
}

function normalizeCliEnvelope(envelope: OpenClawCliEnvelope) {
  return {
    payloads: envelope.payloads ?? envelope.result?.payloads ?? [],
    meta: envelope.meta ?? envelope.result?.meta,
    stopReason: envelope.stopReason ?? envelope.result?.stopReason,
  }
}

function extractStructuredPayload(text: string) {
  const positions = [...text.matchAll(/\{/g)].map((match) => match.index ?? -1).filter((index) => index >= 0)

  for (const index of positions) {
    try {
      const parsed = JSON.parse(text.slice(index)) as Record<string, unknown>
      if (
        typeof parsed.poem === 'string' &&
        typeof parsed.drawingPrompt === 'string' &&
        typeof parsed.strategyHint === 'string'
      ) {
        return {
          poem: parsed.poem,
          drawingPrompt: parsed.drawingPrompt,
          strategyHint: parsed.strategyHint,
        }
      }
    } catch {
      continue
    }
  }

  return null
}

function detectAgentContractMismatch(text: string) {
  const normalized = text.toLowerCase()
  if (!normalized.includes('instructions are required')) {
    return null
  }

  return text.trim().slice(0, 280)
}
