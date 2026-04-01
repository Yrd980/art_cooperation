import type {
  CoCreationSession,
  SessionDraftSaveRequest,
  SessionDraftSaveResponse,
  SessionMeta,
  SessionOrigin,
} from '../types'

export const SESSION_DRAFT_SAVE_ENDPOINT = '/__drafts/save'
export const GENERATED_DRAFT_DIRECTORY = '/session-drafts/generated'
export const GENERATED_DRAFT_PROVIDER_LABEL = 'Generated Draft Export'

export function buildDraftOrigin(meta: SessionMeta): SessionOrigin {
  return meta.origin ?? {
    providerId: meta.providerId,
    providerLabel: meta.providerLabel,
    mode: meta.mode,
    sourceLabel: meta.sourceLabel,
    runId: meta.runId,
  }
}

export function buildGeneratedDraftFilename(session: CoCreationSession) {
  const baseToken = sanitizeDraftFilenameToken(
    session.meta.runId ??
      session.meta.origin?.runId ??
      session.meta.providerId ??
      'session',
  )
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-')
  return `${timestamp}-${baseToken}.json`
}

export function validateGeneratedDraftFilename(filename: string) {
  const normalized = filename.trim()

  if (!normalized) {
    throw new Error('Draft filename is empty')
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`Draft filename must not contain path separators: ${filename}`)
  }

  if (!normalized.endsWith('.json')) {
    throw new Error(`Draft filename must end with .json: ${filename}`)
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    throw new Error(`Draft filename contains unsupported characters: ${filename}`)
  }

  return normalized
}

export function buildGeneratedDraftUrl(filename: string) {
  return `${GENERATED_DRAFT_DIRECTORY}/${validateGeneratedDraftFilename(filename)}`
}

export function buildDraftExportSession(
  session: CoCreationSession,
  draftUrl: string,
): CoCreationSession {
  const origin = buildDraftOrigin(session.meta)

  return {
    contestants: session.contestants.map((contestant) => ({ ...contestant })),
    turns: session.turns.map((turn) => ({
      ...turn,
      sourceFragments: [...turn.sourceFragments],
      ops: turn.ops.map((op) => ({ ...op })),
    })),
    meta: {
      providerId: 'draft',
      providerLabel: GENERATED_DRAFT_PROVIDER_LABEL,
      mode: 'draft',
      sourceLabel: draftUrl,
      origin,
    },
  }
}

export async function saveGeneratedDraft(
  session: CoCreationSession,
  fetchImpl: typeof fetch = fetch,
  filename?: string,
): Promise<string> {
  const payload: SessionDraftSaveRequest = {
    filename,
    session,
  }
  const response = await fetchImpl(SESSION_DRAFT_SAVE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const result = (await response.json()) as SessionDraftSaveResponse

  if (!response.ok || !result.ok) {
    const message = result && !result.ok ? result.message : `HTTP ${response.status}`
    throw new Error(`Draft save failed: ${message}`)
  }

  return result.draftUrl
}

function sanitizeDraftFilenameToken(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'session'
}
