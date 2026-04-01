import { CANVAS_SIZE, PALETTE } from './art'
import type {
  CoCreationSession,
  CollaborationRole,
  DeepSeekSessionResponse,
  DeepSeekTurnResponse,
  PaintingTurn,
  PixelOp,
  SessionContestant,
  StaticContestantSeed,
  TurnPhase,
} from '../types'
import { enrichStaticContestant } from './contestantEnrichment'

export const DEEPSEEK_SESSION_ENDPOINT = '/__deepseek/session'
export const DEEPSEEK_PROVIDER_ID = 'deepseek'

const paletteDescription = PALETTE.map(
  (hex, index) => `${index}: ${hex}`,
).join(', ')

export function buildDeepSeekSystemPrompt(): string {
  return [
    '你是一位像素艺术家，正在和其他选手合作完成一幅 32×32 的共享像素画。',
    `画布大小: ${CANVAS_SIZE}×${CANVAS_SIZE}，坐标 x 范围 [0,31]，y 范围 [0,31]。`,
    `调色板共 16 色: ${paletteDescription}`,
    '你必须返回且仅返回一个 JSON 对象，不要用 markdown 包裹。',
    'JSON schema:',
    '{',
    '  "ops": [{"x": number, "y": number, "color": number}, ...],',
    '  "promptSummary": "一句话描述你画了什么",',
    '  "strategySummary": "你的绘画策略",',
    '  "responseSummary": "你如何回应画布上已有的内容",',
    '  "shapeLanguage": "你使用的形态语言，如带状水纹/山脊轮廓/团簇暖块/离散星点",',
    '  "focusArea": "你主要落笔的区域，如上缘/中区/下部/左侧/右侧",',
    '  "collaborationRole": "introduce|echo|counterbalance|highlight"',
    '}',
    '规则:',
    '- x 和 y 必须是 0-31 的整数，color 必须是 0-15 的整数',
    '- foundation 阶段: 铺设大面积底色和基本结构，生成 80-200 个 ops',
    '- detail 阶段: 在已有结构上补充细节和高光，生成 30-80 个 ops',
    '- 第一位选手 foundation 阶段 collaborationRole 为 "introduce"',
    '- 后续选手根据画布状态选择 echo(呼应)/counterbalance(对冲)/highlight(提亮)',
    '- 不要把所有像素都堆在同一个小区域',
  ].join('\n')
}

export function buildDeepSeekTurnPrompt(
  contestant: StaticContestantSeed,
  phase: TurnPhase,
  turnIndex: number,
  totalContestants: number,
  canvasHex: string,
): string {
  const phaseLabel = phase === 'foundation' ? '铺底（大结构）' : '细化（细节和高光）'
  const isFirst = turnIndex === 0
  const lines = [
    `选手: ${contestant.name}`,
    `性格: ${contestant.personaPrompt}`,
    `诗歌:\n${contestant.poem}`,
    `当前阶段: ${phaseLabel}`,
    `回合编号: ${turnIndex + 1} / ${totalContestants * 2}`,
  ]

  if (isFirst) {
    lines.push('画布状态: 空白（这是第一回合，你负责 introduce 引入）')
  } else {
    lines.push(`当前画布状态（每行32个十六进制字符，0=空，1-f=颜色索引）:\n${canvasHex}`)
  }

  lines.push(
    '请根据你的性格和诗歌，在画布上创作属于你的一笔。',
    '返回严格 JSON，不要任何额外文字。',
  )

  return lines.join('\n')
}

export function gridToHex(grid: number[]): string {
  const rows: string[] = []
  for (let y = 0; y < CANVAS_SIZE; y += 1) {
    let row = ''
    for (let x = 0; x < CANVAS_SIZE; x += 1) {
      row += grid[y * CANVAS_SIZE + x]!.toString(16)
    }
    rows.push(row)
  }
  return rows.join('\n')
}

export function parseDeepSeekTurnResponse(raw: string): DeepSeekTurnResponse {
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('DeepSeek response contains no JSON object')
  }

  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>

  if (!Array.isArray(parsed.ops)) {
    throw new Error('DeepSeek response missing ops array')
  }

  const ops: PixelOp[] = []
  for (const op of parsed.ops) {
    if (
      typeof op !== 'object' || op === null ||
      typeof (op as Record<string, unknown>).x !== 'number' ||
      typeof (op as Record<string, unknown>).y !== 'number' ||
      typeof (op as Record<string, unknown>).color !== 'number'
    ) {
      continue
    }
    const { x, y, color } = op as { x: number; y: number; color: number }
    if (x >= 0 && x < CANVAS_SIZE && y >= 0 && y < CANVAS_SIZE && color >= 0 && color < PALETTE.length) {
      ops.push({ x, y, color })
    }
  }

  const collaborationRole = isCollaborationRole(parsed.collaborationRole)
    ? parsed.collaborationRole
    : 'echo'

  return {
    ops,
    promptSummary: typeof parsed.promptSummary === 'string' ? parsed.promptSummary : '(AI 生成)',
    strategySummary: typeof parsed.strategySummary === 'string' ? parsed.strategySummary : '(AI 策略)',
    responseSummary: typeof parsed.responseSummary === 'string' ? parsed.responseSummary : '(AI 回应)',
    shapeLanguage: typeof parsed.shapeLanguage === 'string' ? parsed.shapeLanguage : '(AI 形态)',
    focusArea: typeof parsed.focusArea === 'string' ? parsed.focusArea : '中区',
    collaborationRole,
  }
}

function isCollaborationRole(value: unknown): value is CollaborationRole {
  return value === 'introduce' || value === 'echo' || value === 'counterbalance' || value === 'highlight'
}

export function buildDeepSeekTurn(
  contestant: SessionContestant,
  turnIndex: number,
  phase: TurnPhase,
  response: DeepSeekTurnResponse,
  gridBefore: number[],
): PaintingTurn {
  const gridAfter = [...gridBefore]
  for (const op of response.ops) {
    gridAfter[op.y * CANVAS_SIZE + op.x] = op.color
  }
  let changedPixelCount = 0
  for (let i = 0; i < gridAfter.length; i += 1) {
    if (gridBefore[i] !== gridAfter[i]) {
      changedPixelCount += 1
    }
  }

  const sourceFragments = contestant.poem
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)

  return {
    id: `${contestant.id}-${phase}-${turnIndex}`,
    turnIndex,
    contestantId: contestant.id,
    phase,
    collaborationRole: response.collaborationRole,
    promptSummary: response.promptSummary,
    strategySummary: response.strategySummary,
    responseSummary: response.responseSummary,
    sourceFragments,
    shapeLanguage: response.shapeLanguage,
    focusArea: response.focusArea,
    coverage: response.ops.length > 0 ? Math.round((response.ops.length / (CANVAS_SIZE * CANVAS_SIZE)) * 100) : 0,
    changedPixelCount,
    ops: response.ops,
  }
}

export function buildDeepSeekSession(
  seeds: readonly StaticContestantSeed[],
  turnResults: DeepSeekTurnResponse[],
): CoCreationSession {
  const phases: TurnPhase[] = ['foundation', 'detail']
  const contestants: SessionContestant[] = seeds.map((seed) => enrichStaticContestant(seed))
  const turns: PaintingTurn[] = []
  const grid = Array.from({ length: CANVAS_SIZE * CANVAS_SIZE }, () => 0)

  contestants.forEach((contestant, contestantIndex) => {
    phases.forEach((phase, phaseIndex) => {
      const turnIndex = contestantIndex * phases.length + phaseIndex
      const response = turnResults[turnIndex]
      if (!response) {
        return
      }
      const gridBefore = [...grid]
      const turn = buildDeepSeekTurn(contestant, turnIndex, phase, response, gridBefore)
      turns.push(turn)

      for (const op of turn.ops) {
        grid[op.y * CANVAS_SIZE + op.x] = op.color
      }
    })
  })

  return {
    contestants,
    turns,
    meta: {
      providerId: DEEPSEEK_PROVIDER_ID,
      providerLabel: 'DeepSeek Pixel Provider',
      mode: 'deepseek',
      sourceLabel: 'DeepSeek API (deepseek-chat)',
    },
  }
}

export async function fetchDeepSeekSession(
  contestants: readonly StaticContestantSeed[],
  fetchImpl: typeof fetch = fetch,
): Promise<CoCreationSession> {
  const response = await fetchImpl(DEEPSEEK_SESSION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contestants }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek bridge HTTP error: ${response.status}`)
  }

  const payload = (await response.json()) as DeepSeekSessionResponse
  if (!payload.ok) {
    throw new Error(`DeepSeek bridge error: ${payload.code} - ${payload.message}`)
  }

  return payload.session
}
