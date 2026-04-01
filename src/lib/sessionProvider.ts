import { staticContestants as defaultContestants } from '../data/staticContestants'
import { sampleSessionDraft } from '../data/sampleSessionDraft'
import { CANVAS_SIZE, buildSession } from './art'
import { enrichStaticContestants } from './contestantEnrichment'
import {
  LOCAL_OPENCLAW_PROVIDER_ID,
  createLocalOpenClawRunId,
  buildLocalOpenClawRequest,
  fetchLocalOpenClawContestants,
} from './localOpenClaw'
import type {
  ArtSessionDraft,
  ArtSessionProvider,
  CollaborationRole,
  CoCreationSession,
  OpenClawContestant,
  PaintingTurn,
  PixelOp,
  SessionMode,
  SessionOrigin,
  StaticContestantRoster,
  StaticContestantSeed,
} from '../types'

export const STATIC_INGEST_PROVIDER_ID = 'static-ingest'
export const DEFAULT_STATIC_ROSTER_URL = '/contestant-rosters/sample-roster.json'

export const localDeterministicSessionProvider: ArtSessionProvider = {
  id: 'local-deterministic',
  label: 'Local Deterministic Provider',
  mode: 'local-deterministic',
  async generateSession(contestants = defaultContestants) {
    return buildSession(enrichStaticContestants(contestants), {
      providerId: 'local-deterministic',
      providerLabel: 'Local Deterministic Provider',
      mode: 'local-deterministic',
      sourceLabel: 'built-in static roster',
    })
  },
}

export const staticIngestSessionProvider: ArtSessionProvider = {
  id: STATIC_INGEST_PROVIDER_ID,
  label: 'Static Ingest Provider',
  mode: 'static-ingest',
  async generateSession(contestants = defaultContestants) {
    return buildSession(enrichStaticContestants(contestants), {
      providerId: STATIC_INGEST_PROVIDER_ID,
      providerLabel: 'Static Ingest Provider',
      mode: 'static-ingest',
      sourceLabel: 'built-in sample roster',
    })
  },
}

export const draftSessionProvider: ArtSessionProvider = {
  id: 'draft',
  label: 'Sample Draft Provider',
  mode: 'draft',
  async generateSession() {
    return cloneDraftSession(sampleSessionDraft)
  },
}

export const localOpenClawSessionProvider: ArtSessionProvider = {
  id: LOCAL_OPENCLAW_PROVIDER_ID,
  label: 'Local OpenClaw Provider',
  mode: 'local-openclaw',
  async generateSession(contestants = defaultContestants) {
    const runId = createLocalOpenClawRunId()
    const { contestants: resolvedContestants, meta } = await fetchLocalOpenClawContestants(
      buildLocalOpenClawRequest(contestants, CANVAS_SIZE, ['foundation', 'detail'], runId),
    )

    return buildSession(resolvedContestants, meta)
  },
}

export const sessionProviders: Record<string, ArtSessionProvider> = {
  [localDeterministicSessionProvider.id]: localDeterministicSessionProvider,
  [staticIngestSessionProvider.id]: staticIngestSessionProvider,
  [draftSessionProvider.id]: draftSessionProvider,
  [localOpenClawSessionProvider.id]: localOpenClawSessionProvider,
}

export function resolveSessionProvider(providerId: string | null | undefined) {
  const normalizedProviderId = providerId?.trim() || staticIngestSessionProvider.id
  return sessionProviders[normalizedProviderId] ?? null
}

export function getProviderIdFromSearch(search: string) {
  const params = new URLSearchParams(search)
  return params.get('provider')
}

export function getDraftUrlFromSearch(search: string) {
  const params = new URLSearchParams(search)
  return params.get('draftUrl')
}

export function getRosterUrlFromSearch(search: string) {
  const params = new URLSearchParams(search)
  return params.get('rosterUrl')
}

export async function loadSessionFromSearch(search: string): Promise<CoCreationSession> {
  const providerId = getProviderIdFromSearch(search)
  const provider = resolveSessionProvider(providerId)

  if (!provider) {
    throw new Error(`Unknown session provider: ${providerId}`)
  }

  if (provider.id === draftSessionProvider.id) {
    const draftUrl = getDraftUrlFromSearch(search)

    if (!draftUrl) {
      return draftSessionProvider.generateSession(sampleSessionDraft.contestants)
    }

    return loadExternalDraftSession(draftUrl)
  }

  if (provider.id === staticIngestSessionProvider.id) {
    const rosterUrl = getRosterUrlFromSearch(search)

    if (!rosterUrl) {
      return staticIngestSessionProvider.generateSession(defaultContestants)
    }

    const contestants = await loadExternalRosterContestants(rosterUrl)
    return buildSession(enrichStaticContestants(contestants), {
      providerId: STATIC_INGEST_PROVIDER_ID,
      providerLabel: 'Static Ingest Provider',
      mode: 'static-ingest',
      sourceLabel: validateRosterUrl(rosterUrl),
    })
  }

  if (provider.id === localOpenClawSessionProvider.id) {
    return provider.generateSession(defaultContestants)
  }

  return provider.generateSession(defaultContestants)
}

export async function loadExternalRosterContestants(
  rosterUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StaticContestantSeed[]> {
  const normalizedRosterUrl = validateRosterUrl(rosterUrl)
  const response = await fetchImpl(normalizedRosterUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch contestant roster: ${normalizedRosterUrl} (${response.status})`)
  }

  const payload = await response.json()
  return parseStaticContestantRoster(payload, normalizedRosterUrl)
}

export function validateRosterUrl(rosterUrl: string) {
  const normalizedRosterUrl = rosterUrl.trim()

  if (!normalizedRosterUrl) {
    throw new Error('Contestant roster URL is empty')
  }

  if (!normalizedRosterUrl.startsWith('/')) {
    throw new Error(`Contestant roster URL must be same-origin: ${rosterUrl}`)
  }

  if (!normalizedRosterUrl.endsWith('.json')) {
    throw new Error(`Contestant roster URL must point to a JSON file: ${rosterUrl}`)
  }

  return normalizedRosterUrl
}

export function parseStaticContestantRoster(value: unknown, sourceLabel: string): StaticContestantSeed[] {
  const contestants = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.contestants)
      ? (value as StaticContestantRoster).contestants
      : null

  if (!contestants) {
    throw new Error(`Invalid contestant roster JSON: contestants must be an array (${sourceLabel})`)
  }

  return contestants.map((contestant, index) => parseStaticContestantSeed(contestant, index, sourceLabel))
}

export async function loadExternalDraftSession(
  draftUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CoCreationSession> {
  const normalizedDraftUrl = validateDraftUrl(draftUrl)
  const response = await fetchImpl(normalizedDraftUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch draft session: ${normalizedDraftUrl} (${response.status})`)
  }

  const payload = await response.json()
  return parseDraftSession(payload, normalizedDraftUrl)
}

export function validateDraftUrl(draftUrl: string) {
  const normalizedDraftUrl = draftUrl.trim()

  if (!normalizedDraftUrl) {
    throw new Error('Draft session URL is empty')
  }

  if (!normalizedDraftUrl.startsWith('/')) {
    throw new Error(`Draft session URL must be same-origin: ${draftUrl}`)
  }

  if (!normalizedDraftUrl.endsWith('.json')) {
    throw new Error(`Draft session URL must point to a JSON file: ${draftUrl}`)
  }

  return normalizedDraftUrl
}

export function parseDraftSession(value: unknown, sourceLabel: string): CoCreationSession {
  if (!isRecord(value)) {
    throw new Error(`Invalid draft session JSON: root must be an object (${sourceLabel})`)
  }

  if (!Array.isArray(value.contestants)) {
    throw new Error(`Invalid draft session JSON: contestants must be an array (${sourceLabel})`)
  }

  if (!Array.isArray(value.turns)) {
    throw new Error(`Invalid draft session JSON: turns must be an array (${sourceLabel})`)
  }

  if (!isRecord(value.meta)) {
    throw new Error(`Invalid draft session JSON: meta must be an object (${sourceLabel})`)
  }

  const { providerId, providerLabel, mode } = value.meta
  if (typeof providerId !== 'string' || typeof providerLabel !== 'string' || typeof mode !== 'string') {
    throw new Error(`Invalid draft session JSON: meta fields are missing (${sourceLabel})`)
  }
  if (!isSessionMode(mode)) {
    throw new Error(`Invalid draft session JSON: unsupported mode (${sourceLabel})`)
  }

  const contestants = value.contestants.map((contestant, index) =>
    parseContestant(contestant, index, sourceLabel),
  )
  const turns = value.turns.map((turn, index) => parseTurn(turn, index, sourceLabel))

  return {
    contestants,
    turns,
    meta: {
      providerId,
      providerLabel,
      mode,
      sourceLabel,
      origin: parseSessionOrigin(value.meta.origin, sourceLabel),
    },
  }
}

function parseSessionOrigin(value: unknown, sourceLabel: string): SessionOrigin | undefined {
  if (typeof value === 'undefined') {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid draft session JSON: meta.origin must be an object (${sourceLabel})`)
  }

  const { providerId, providerLabel, mode, sourceLabel: originSourceLabel, runId } = value
  if (
    typeof providerId !== 'string' ||
    typeof providerLabel !== 'string' ||
    typeof mode !== 'string'
  ) {
    throw new Error(`Invalid draft session JSON: meta.origin fields are missing (${sourceLabel})`)
  }

  if (!isSessionMode(mode)) {
    throw new Error(`Invalid draft session JSON: meta.origin mode is unsupported (${sourceLabel})`)
  }

  if (typeof originSourceLabel !== 'undefined' && typeof originSourceLabel !== 'string') {
    throw new Error(`Invalid draft session JSON: meta.origin.sourceLabel must be a string (${sourceLabel})`)
  }

  if (typeof runId !== 'undefined' && typeof runId !== 'string') {
    throw new Error(`Invalid draft session JSON: meta.origin.runId must be a string (${sourceLabel})`)
  }

  return {
    providerId,
    providerLabel,
    mode,
    sourceLabel: originSourceLabel,
    runId,
  }
}

function parseContestant(value: unknown, index: number, sourceLabel: string): OpenClawContestant {
  if (!isRecord(value)) {
    throw new Error(`Invalid draft contestant at index ${index} (${sourceLabel})`)
  }

  const { id, name, personaPrompt, poem, drawingPrompt, paletteBias, motif } = value
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof personaPrompt !== 'string' ||
    typeof poem !== 'string' ||
    typeof drawingPrompt !== 'string' ||
    !Array.isArray(paletteBias) ||
    typeof motif !== 'string'
  ) {
    throw new Error(`Invalid draft contestant fields at index ${index} (${sourceLabel})`)
  }

  if (!paletteBias.every((entry) => typeof entry === 'number')) {
    throw new Error(`Invalid draft contestant palette at index ${index} (${sourceLabel})`)
  }

  return {
    id,
    name,
    personaPrompt,
    poem,
    drawingPrompt,
    paletteBias,
    motif,
  } as OpenClawContestant
}

function parseStaticContestantSeed(value: unknown, index: number, sourceLabel: string): StaticContestantSeed {
  if (!isRecord(value)) {
    throw new Error(`Invalid contestant roster entry at index ${index} (${sourceLabel})`)
  }

  const { id, name, personaPrompt, poem, motif, paletteBias } = value
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof personaPrompt !== 'string' ||
    typeof poem !== 'string'
  ) {
    throw new Error(`Invalid contestant roster fields at index ${index} (${sourceLabel})`)
  }

  if (typeof motif !== 'undefined' && typeof motif !== 'string') {
    throw new Error(`Invalid contestant roster motif at index ${index} (${sourceLabel})`)
  }

  if (typeof paletteBias !== 'undefined' && (!Array.isArray(paletteBias) || !paletteBias.every((entry) => typeof entry === 'number'))) {
    throw new Error(`Invalid contestant roster palette at index ${index} (${sourceLabel})`)
  }

  return {
    id,
    name,
    personaPrompt,
    poem,
    motif,
    paletteBias,
  }
}

function parseTurn(value: unknown, index: number, sourceLabel: string): PaintingTurn {
  if (!isRecord(value)) {
    throw new Error(`Invalid draft turn at index ${index} (${sourceLabel})`)
  }

  const {
    id,
    turnIndex,
    contestantId,
    phase,
    collaborationRole,
    promptSummary,
    strategySummary,
    responseSummary,
    sourceFragments,
    shapeLanguage,
    focusArea,
    coverage,
    changedPixelCount,
    ops,
  } = value

  if (
    typeof id !== 'string' ||
    typeof turnIndex !== 'number' ||
    typeof contestantId !== 'string' ||
    typeof phase !== 'string' ||
    typeof promptSummary !== 'string' ||
    typeof strategySummary !== 'string' ||
    !Array.isArray(sourceFragments) ||
    typeof shapeLanguage !== 'string' ||
    typeof coverage !== 'number' ||
    !Array.isArray(ops)
  ) {
    throw new Error(`Invalid draft turn fields at index ${index} (${sourceLabel})`)
  }

  if (!sourceFragments.every((fragment) => typeof fragment === 'string')) {
    throw new Error(`Invalid draft sourceFragments at index ${index} (${sourceLabel})`)
  }

  return {
    id,
    turnIndex,
    contestantId,
    phase,
    collaborationRole: isCollaborationRole(collaborationRole) ? collaborationRole : inferCollaborationRole(phase, turnIndex),
    promptSummary,
    strategySummary,
    responseSummary: typeof responseSummary === 'string' ? responseSummary : inferResponseSummary(promptSummary, phase),
    sourceFragments: [...sourceFragments],
    shapeLanguage,
    focusArea: typeof focusArea === 'string' && focusArea.trim() ? focusArea : inferFocusArea(shapeLanguage),
    coverage,
    changedPixelCount: typeof changedPixelCount === 'number' ? changedPixelCount : ops.length,
    ops: ops.map((op, opIndex) => parsePixelOp(op, index, opIndex, sourceLabel)),
  } as PaintingTurn
}

function parsePixelOp(value: unknown, turnIndex: number, opIndex: number, sourceLabel: string): PixelOp {
  if (!isRecord(value)) {
    throw new Error(`Invalid draft pixel op at turn ${turnIndex}, op ${opIndex} (${sourceLabel})`)
  }

  const { x, y, color } = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof color !== 'number') {
    throw new Error(`Invalid draft pixel op fields at turn ${turnIndex}, op ${opIndex} (${sourceLabel})`)
  }

  return { x, y, color }
}

function cloneDraftSession(draft: ArtSessionDraft): CoCreationSession {
  return {
    contestants: [...draft.contestants],
    turns: draft.turns.map((turn) => ({
      ...turn,
      sourceFragments: [...turn.sourceFragments],
      ops: turn.ops.map((op) => ({ ...op })),
    })),
    meta: {
      ...draft.meta,
      origin: draft.meta.origin ? { ...draft.meta.origin } : undefined,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSessionMode(value: string): value is SessionMode {
  return (
    value === 'local-deterministic' ||
    value === 'static-ingest' ||
    value === 'draft' ||
    value === 'local-openclaw' ||
    value === 'remote-openclaw'
  )
}

function isCollaborationRole(value: unknown): value is CollaborationRole {
  return value === 'introduce' || value === 'echo' || value === 'counterbalance' || value === 'highlight'
}

function inferCollaborationRole(phase: string, turnIndex: number): CollaborationRole {
  if (turnIndex === 0) {
    return 'introduce'
  }

  return phase === 'detail' ? 'highlight' : 'echo'
}

function inferResponseSummary(promptSummary: string, phase: string) {
  return phase === 'detail'
    ? `${promptSummary}，这一回合主要负责补充可读细节。`
    : `${promptSummary}，这一回合主要负责建立下一位可接续的底层结构。`
}

function inferFocusArea(shapeLanguage: string) {
  if (shapeLanguage.includes('星') || shapeLanguage.includes('高光')) {
    return '上缘全幅'
  }

  if (shapeLanguage.includes('山') || shapeLanguage.includes('横带') || shapeLanguage.includes('轮廓')) {
    return '下部中区'
  }

  return '中区核心'
}
