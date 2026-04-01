export type ContestantId = string

export type TurnPhase = 'foundation' | 'detail'

export type PixelOp = {
  x: number
  y: number
  color: number
}

export type CollaborationRole = 'introduce' | 'echo' | 'counterbalance' | 'highlight'

export type SessionMode =
  | 'local-deterministic'
  | 'static-ingest'
  | 'draft'
  | 'local-openclaw'
  | 'remote-openclaw'
  | 'deepseek'

export type SessionOrigin = {
  providerId: string
  providerLabel: string
  mode: SessionMode
  sourceLabel?: string
  runId?: string
}

export type SessionMeta = {
  providerId: string
  providerLabel: string
  mode: SessionMode
  sourceLabel?: string
  runId?: string
  origin?: SessionOrigin
}

export type ArtProfile = {
  seed: number
  structure: 'current' | 'ridge' | 'bloom' | 'constellation'
  motion: 'drift' | 'stack' | 'pulse' | 'glimmer'
  atmosphere: string
  strategySummary: string
  shapeLanguage: string
  sourceFragments: string[]
  baseColors: readonly number[]
  detailColors: readonly number[]
  accentColor: number
  coverage: number
}

export type TurnIntent = {
  focus: string
  density: number
  energy: number
}

export type StaticContestantSeed = {
  id: ContestantId
  name: string
  personaPrompt: string
  poem: string
  motif?: string
  paletteBias?: readonly number[]
}

export type SessionContestant = {
  id: ContestantId
  name: string
  personaPrompt: string
  poem: string
  drawingPrompt: string
  strategyHint?: string
  paletteBias: readonly number[]
  motif: string
}

export type OpenClawContestant = SessionContestant

export type PaintingTurn = {
  id: string
  turnIndex: number
  contestantId: ContestantId
  phase: TurnPhase
  collaborationRole: CollaborationRole
  promptSummary: string
  strategySummary: string
  responseSummary: string
  sourceFragments: string[]
  shapeLanguage: string
  focusArea: string
  coverage: number
  changedPixelCount: number
  ops: PixelOp[]
}

export type CoCreationSession = {
  contestants: SessionContestant[]
  turns: PaintingTurn[]
  meta: SessionMeta
}

export type ArtSessionDraft = CoCreationSession

export type ArtSessionProvider = {
  id: string
  label: string
  mode: SessionMode
  generateSession(contestants?: readonly StaticContestantSeed[]): Promise<CoCreationSession>
}

export type LocalOpenClawBridgeRequest = {
  contestants: StaticContestantSeed[]
  canvasSize: number
  phases: TurnPhase[]
  runId?: string
}

export type LocalOpenClawBridgeSuccess = {
  ok: true
  contestants: SessionContestant[]
  meta: SessionMeta
}

export type LocalOpenClawHealthSuccess = {
  ok: true
  sourceLabel: string
  health: string
  model: string
}

export type LocalOpenClawBridgeError = {
  ok: false
  code: string
  message: string
  sourceLabel: string
}

export type LocalOpenClawBridgeResponse = LocalOpenClawBridgeSuccess | LocalOpenClawBridgeError

export type LocalOpenClawHealthResponse = LocalOpenClawHealthSuccess | LocalOpenClawBridgeError

export type SessionDraftSaveRequest = {
  filename?: string
  session: CoCreationSession
}

export type SessionDraftSaveSuccess = {
  ok: true
  draftUrl: string
  filePath: string
}

export type SessionDraftSaveError = {
  ok: false
  code: string
  message: string
}

export type SessionDraftSaveResponse = SessionDraftSaveSuccess | SessionDraftSaveError

export type StaticContestantRoster = {
  contestants: StaticContestantSeed[]
}

export type DeepSeekTurnResponse = {
  ops: PixelOp[]
  promptSummary: string
  strategySummary: string
  responseSummary: string
  shapeLanguage: string
  focusArea: string
  collaborationRole: CollaborationRole
}

export type DeepSeekSessionRequest = {
  contestants: StaticContestantSeed[]
}

export type DeepSeekSessionSuccess = {
  ok: true
  session: CoCreationSession
}

export type DeepSeekSessionError = {
  ok: false
  code: string
  message: string
}

export type DeepSeekSessionResponse = DeepSeekSessionSuccess | DeepSeekSessionError
