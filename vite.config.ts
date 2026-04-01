import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { enrichStaticContestant } from './src/lib/contestantEnrichment'
import {
  LOCAL_OPENCLAW_AGENT_MAP,
  LOCAL_OPENCLAW_HEALTH_ENDPOINT,
  LOCAL_OPENCLAW_TEXTS_ENDPOINT,
  buildLocalOpenClawPrompt,
  buildLocalOpenClawSessionId,
  createBridgeError,
  createHealthSuccess,
  createBridgeSuccess,
  parseOpenClawCliResult,
  resolveLocalOpenClawRunId,
} from './src/lib/localOpenClaw'
import {
  DEEPSEEK_SESSION_ENDPOINT,
  buildDeepSeekSystemPrompt,
  buildDeepSeekTurnPrompt,
  buildDeepSeekSession,
  gridToHex,
  parseDeepSeekTurnResponse,
} from './src/lib/deepseek'
import {
  buildDraftExportSession,
  buildGeneratedDraftFilename,
  buildGeneratedDraftUrl,
  SESSION_DRAFT_SAVE_ENDPOINT,
  validateGeneratedDraftFilename,
} from './src/lib/sessionDraftExport'
import { CANVAS_SIZE } from './src/lib/art'
import type {
  DeepSeekSessionResponse,
  DeepSeekTurnResponse,
  LocalOpenClawBridgeRequest,
  LocalOpenClawBridgeResponse,
  LocalOpenClawHealthResponse,
  OpenClawContestant,
  StaticContestantSeed,
  SessionDraftSaveError,
  SessionDraftSaveRequest,
  SessionDraftSaveResponse,
  TurnPhase,
} from './src/types'

const execFileAsync = promisify(execFile)
const OPENCLAW_HEALTH_TIMEOUT_MS = 5_000
const OPENCLAW_CONFIG_TIMEOUT_MS = 5_000
const OPENCLAW_AGENT_TIMEOUT_MS = 65_000
const DEEPSEEK_API_BASE = 'https://api.deepseek.com'
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? 'sk-99c36f63d4f14aca996f890a81424d84'
const DEEPSEEK_MODEL = 'deepseek-chat'
const DEEPSEEK_TURN_TIMEOUT_MS = 60_000
const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const generatedDraftDirectoryPath = path.join(projectRoot, 'public', 'session-drafts', 'generated')

export default defineConfig({
  plugins: [react(), localOpenClawBridgePlugin(), deepseekBridgePlugin()],
})

function localOpenClawBridgePlugin(): Plugin {
  return {
    name: 'local-openclaw-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleLocalOpenClawBridgeRequest(req, res, next)
      })
    },
  }
}

function deepseekBridgePlugin(): Plugin {
  return {
    name: 'deepseek-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleDeepSeekBridgeRequest(req, res, next)
      })
    },
  }
}

async function handleDeepSeekBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  if (!req.url) {
    next()
    return
  }

  try {
    const url = new URL(req.url, 'http://127.0.0.1')

    if (req.method === 'POST' && url.pathname === DEEPSEEK_SESSION_ENDPOINT) {
      const body = await readJsonBody(req)
      if (!body.ok) {
        sendJson(res, 400, { ok: false, code: 'bad_request', message: body.message } satisfies DeepSeekSessionResponse)
        return
      }

      const response = await buildDeepSeekSessionResponse(body.value)
      sendJson(res, response.ok ? 200 : 500, response)
      return
    }

    next()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unhandled DeepSeek bridge error'
    sendJson(res, 500, { ok: false, code: 'deepseek_unhandled', message } satisfies DeepSeekSessionResponse)
  }
}

async function buildDeepSeekSessionResponse(body: unknown): Promise<DeepSeekSessionResponse> {
  if (!isDeepSeekSessionRequest(body)) {
    return { ok: false, code: 'bad_request', message: 'Invalid DeepSeek session request body' }
  }

  const phases: TurnPhase[] = ['foundation', 'detail']
  const systemPrompt = buildDeepSeekSystemPrompt()
  const grid = Array.from({ length: CANVAS_SIZE * CANVAS_SIZE }, () => 0)
  const turnResults: DeepSeekTurnResponse[] = []

  for (const [contestantIndex, contestant] of body.contestants.entries()) {
    for (const [phaseIndex, phase] of phases.entries()) {
      const turnIndex = contestantIndex * phases.length + phaseIndex
      const canvasHex = gridToHex(grid)
      const userPrompt = buildDeepSeekTurnPrompt(
        contestant,
        phase,
        turnIndex,
        body.contestants.length,
        canvasHex,
      )

      try {
        const turnResponse = await callDeepSeekChat(systemPrompt, userPrompt)
        const parsed = parseDeepSeekTurnResponse(turnResponse)
        turnResults.push(parsed)

        for (const op of parsed.ops) {
          grid[op.y * CANVAS_SIZE + op.x] = op.color
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown'
        return {
          ok: false,
          code: 'deepseek_turn_failed',
          message: `Turn ${turnIndex} (${contestant.name} / ${phase}) failed: ${detail}`,
        }
      }
    }
  }

  const session = buildDeepSeekSession(body.contestants, turnResults)
  return { ok: true, session }
}

async function callDeepSeekChat(systemPrompt: string, userPrompt: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TURN_TIMEOUT_MS)

  try {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`DeepSeek API returned ${response.status}: ${errorText.slice(0, 300)}`)
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const content = payload.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('DeepSeek API returned no content')
    }

    return content
  } finally {
    clearTimeout(timeout)
  }
}

function isDeepSeekSessionRequest(value: unknown): value is { contestants: StaticContestantSeed[] } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return Array.isArray((value as Record<string, unknown>).contestants)
}

async function handleLocalOpenClawBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  if (!req.url) {
    next()
    return
  }

  try {
    const url = new URL(req.url, 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === LOCAL_OPENCLAW_HEALTH_ENDPOINT) {
      const response = await buildHealthResponse()
      sendJson(res, getBridgeStatusCode(response), response)
      return
    }

    if (req.method === 'POST' && url.pathname === LOCAL_OPENCLAW_TEXTS_ENDPOINT) {
      const body = await readJsonBody(req)
      if (!body.ok) {
        sendJson(res, 400, createBridgeError('bad_request', body.message, 'local-openclaw-bridge'))
        return
      }

      const response = await buildContestantTextsResponse(body.value)
      sendJson(res, getBridgeStatusCode(response), response)
      return
    }

    if (req.method === 'POST' && url.pathname === SESSION_DRAFT_SAVE_ENDPOINT) {
      const body = await readJsonBody(req)
      if (!body.ok) {
        sendJson(res, 400, createDraftSaveError('bad_request', body.message))
        return
      }

      const response = await saveDraftSession(body.value)
      sendJson(res, response.ok ? 200 : 400, response)
      return
    }

    next()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unhandled local dev bridge error'
    if (req.url?.includes(SESSION_DRAFT_SAVE_ENDPOINT)) {
      sendJson(res, 500, createDraftSaveError('draft_save_unhandled', message))
      return
    }

    sendJson(res, 500, createBridgeError('bridge_unhandled', message, 'local-openclaw-bridge'))
  }
}

async function saveDraftSession(body: unknown): Promise<SessionDraftSaveResponse> {
  if (!isDraftSaveRequest(body)) {
    return createDraftSaveError('bad_request', 'Invalid draft save request body')
  }

  try {
    const filename = body.filename
      ? validateGeneratedDraftFilename(body.filename)
      : buildGeneratedDraftFilename(body.session)
    const draftUrl = buildGeneratedDraftUrl(filename)
    const exportSession = buildDraftExportSession(body.session, draftUrl)

    await mkdir(generatedDraftDirectoryPath, { recursive: true })
    await writeFile(
      path.join(generatedDraftDirectoryPath, filename),
      `${JSON.stringify(exportSession, null, 2)}\n`,
      'utf8',
    )

    return {
      ok: true,
      draftUrl,
      filePath: path.join(generatedDraftDirectoryPath, filename),
    }
  } catch (error) {
    return createDraftSaveError(
      'draft_save_failed',
      error instanceof Error ? error.message : 'Failed to save generated draft',
    )
  }
}

async function buildHealthResponse() {
  try {
    const [{ stdout: healthStdout }, { stdout: modelStdout }] = await Promise.all([
      runOpenClawCommand('gateway health', ['gateway', 'health'], OPENCLAW_HEALTH_TIMEOUT_MS),
      runOpenClawCommand(
        'config get agents.defaults.model.primary',
        ['config', 'get', 'agents.defaults.model.primary'],
        OPENCLAW_CONFIG_TIMEOUT_MS,
      ),
    ])

    const sourceLabel = `openclaw CLI -> gateway@127.0.0.1:18789 -> ${modelStdout.trim() || 'unknown-model'}`
    return {
      ...createHealthSuccess(sourceLabel, healthStdout.trim(), modelStdout.trim()),
    } satisfies LocalOpenClawHealthResponse
  } catch (error) {
    return toBridgeCommandError(error, 'health_unavailable', 'local-openclaw-bridge')
  }
}

async function buildContestantTextsResponse(body: unknown) {
  if (!isBridgeRequest(body)) {
    return createBridgeError('bad_request', 'Invalid Local OpenClaw bridge request body', 'local-openclaw-bridge')
  }

  try {
    const { stdout: modelStdout } = await runOpenClawCommand(
      'config get agents.defaults.model.primary',
      ['config', 'get', 'agents.defaults.model.primary'],
      OPENCLAW_CONFIG_TIMEOUT_MS,
    )
    const resolvedContestants: OpenClawContestant[] = []
    const runId = resolveLocalOpenClawRunId(body.runId)
    const sourceLabel = `openclaw CLI -> gateway@127.0.0.1:18789 -> ${modelStdout.trim() || 'unknown-model'}`

    if (body.contestants.length > 0) {
      const probeResult = await runContestantPrompt(body.contestants[0], body.canvasSize, body.phases, runId, 0)
      if (!probeResult.ok) {
        return createBridgeError(
          probeResult.code,
          `${probeResult.message} (transport=openclaw-agent, source=${sourceLabel})`,
          `openclaw CLI -> ${resolveLegacyAgentId(body.contestants[0].id, 0)}`,
        )
      }

      const enrichedContestant = enrichStaticContestant(body.contestants[0])
      resolvedContestants.push({
        ...enrichedContestant,
        poem: probeResult.payload.poem,
        drawingPrompt: probeResult.payload.drawingPrompt,
        strategyHint: probeResult.payload.strategyHint,
      })
    }

    for (const [index, contestant] of body.contestants.slice(1).entries()) {
      const parsed = await runContestantPrompt(contestant, body.canvasSize, body.phases, runId, index + 1)
      if (!parsed.ok) {
        return createBridgeError(parsed.code, parsed.message, `openclaw CLI -> ${resolveLegacyAgentId(contestant.id, index + 1)}`)
      }
      const enrichedContestant = enrichStaticContestant(contestant)
      resolvedContestants.push({
        ...enrichedContestant,
        poem: parsed.payload.poem,
        drawingPrompt: parsed.payload.drawingPrompt,
        strategyHint: parsed.payload.strategyHint,
      })
    }

    return createBridgeSuccess(resolvedContestants, sourceLabel, runId)
  } catch (error) {
    return toBridgeCommandError(error, 'cli_failed', 'local-openclaw-bridge')
  }
}

async function runContestantPrompt(
  contestant: StaticContestantSeed,
  canvasSize: number,
  phases: Readonly<LocalOpenClawBridgeRequest['phases']>,
  runId: string,
  contestantIndex: number,
) {
  const agentId = resolveLegacyAgentId(contestant.id, contestantIndex)
  const prompt = buildLocalOpenClawPrompt(contestant, canvasSize, phases)
  const sessionId = buildLocalOpenClawSessionId(runId, agentId)
  const { stdout, stderr } = await runOpenClawCommand(
    `agent ${agentId}`,
    [
      'agent',
      '--agent',
      agentId,
      '--session-id',
      sessionId,
      '--message',
      prompt,
      '--json',
      '--thinking',
      'minimal',
      '--timeout',
      '60',
    ],
    OPENCLAW_AGENT_TIMEOUT_MS,
  )

  return parseOpenClawCliResult([stdout, stderr].filter(Boolean).join('\n'), agentId)
}

function resolveLegacyAgentId(contestantId: string, contestantIndex: number) {
  return (LOCAL_OPENCLAW_AGENT_MAP as Record<string, string>)[contestantId] ?? `contestant-${String(contestantIndex + 1).padStart(2, '0')}`
}

async function runOpenClawCommand(label: string, args: string[], timeout: number) {
  return execFileAsync('openclaw', args, {
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      OPENCLAW_BRIDGE_COMMAND_LABEL: label,
    },
    timeout,
  })
}

async function readJsonBody(req: IncomingMessage) {
  try {
    const chunks: Buffer[] = []

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const raw = Buffer.concat(chunks).toString('utf8')
    const value = raw ? JSON.parse(raw) : null
    return { ok: true as const, value }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Failed to parse JSON body',
    }
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function createDraftSaveError(code: string, message: string): SessionDraftSaveError {
  return {
    ok: false,
    code,
    message,
  }
}

function getBridgeStatusCode(payload: LocalOpenClawBridgeResponse | LocalOpenClawHealthResponse) {
  if (payload.ok) {
    return 200
  }

  if (payload.code.includes('timeout')) {
    return 504
  }

  if (payload.code === 'agent_contract_mismatch') {
    return 502
  }

  return 500
}

function toBridgeCommandError(error: unknown, fallbackCode: string, sourceLabel: string) {
  const details = readExecErrorDetails(error)

  if (details?.timedOut) {
    return createBridgeError(
      `${fallbackCode}_timeout`,
      `OpenClaw command timed out after ${details.timeoutMs ?? 'unknown'}ms: ${details.command ?? 'unknown-command'}`,
      sourceLabel,
    )
  }

  if (details?.snippet) {
    return createBridgeError(
      fallbackCode,
      `OpenClaw command failed: ${details.command ?? 'unknown-command'}: ${details.snippet}`,
      sourceLabel,
    )
  }

  return createBridgeError(
    fallbackCode,
    error instanceof Error ? error.message : 'OpenClaw CLI invocation failed',
    sourceLabel,
  )
}

function readExecErrorDetails(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const candidate = error as {
    killed?: boolean
    signal?: string | null
    message?: string
    stdout?: string
    stderr?: string
    cmd?: string
  }

  const message = candidate.message ?? ''
  const timeoutMatch = message.match(/timed out after (\d+) milliseconds/)
  const timedOut =
    Boolean(timeoutMatch) ||
    (candidate.killed === true && message.toLowerCase().includes('timed out'))
  const snippet = [candidate.stderr, candidate.stdout]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n')
    .trim()
    .slice(0, 280)

  return {
    command: candidate.cmd?.replace(/^openclaw\s+/, ''),
    timedOut,
    timeoutMs: timeoutMatch ? Number(timeoutMatch[1]) : undefined,
    snippet,
  }
}

function isBridgeRequest(value: unknown): value is LocalOpenClawBridgeRequest {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.contestants) &&
    typeof candidate.canvasSize === 'number' &&
      Array.isArray(candidate.phases)
  )
}

function isDraftSaveRequest(value: unknown): value is SessionDraftSaveRequest {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.session === 'object' &&
    candidate.session !== null &&
    (typeof candidate.filename === 'undefined' || typeof candidate.filename === 'string')
  )
}
