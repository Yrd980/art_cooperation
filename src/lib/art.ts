import type {
  ArtProfile,
  CoCreationSession,
  CollaborationRole,
  OpenClawContestant,
  PaintingTurn,
  PixelOp,
  SessionMeta,
  TurnIntent,
  TurnPhase,
} from '../types'

export const CANVAS_SIZE = 32

export const PALETTE = [
  '#201a1c',
  '#45353c',
  '#5b7e8a',
  '#7bb3c4',
  '#8da190',
  '#b9c9b0',
  '#5f8e68',
  '#9ad9d0',
  '#c9603f',
  '#f0d9a2',
  '#df874d',
  '#f3a26f',
  '#ffd86a',
  '#8f6f63',
  '#eff5fa',
  '#fff9ef',
] as const

const phases: TurnPhase[] = ['foundation', 'detail']

const defaultSessionMeta: SessionMeta = {
  providerId: 'local-deterministic',
  providerLabel: 'Local Deterministic Provider',
  mode: 'local-deterministic',
}

type GridSummary = {
  occupiedCount: number
  warmCount: number
  brightCount: number
  dominantBand: 'upper' | 'middle' | 'lower' | 'empty'
  dominantColumn: 'left' | 'center' | 'right' | 'empty'
  centerX: number
  centerY: number
}

type TurnContext = {
  phaseIndex: number
  contestantIndex: number
  collaborationRole: CollaborationRole
  focusArea: string
  responseSummary: string
  grid: readonly number[]
  summary: GridSummary
  previousTurn: PaintingTurn | null
}

export function buildSession(
  contestants: readonly OpenClawContestant[],
  meta: SessionMeta = defaultSessionMeta,
  phasePlan: readonly TurnPhase[] = phases,
): CoCreationSession {
  const turns: PaintingTurn[] = []
  const grid = Array.from({ length: CANVAS_SIZE * CANVAS_SIZE }, () => 0)

  contestants.forEach((contestant, contestantIndex) => {
    phasePlan.forEach((phase, phaseIndex) => {
      const turnIndex = contestantIndex * phasePlan.length + phaseIndex
      const previousTurn = turns.at(-1) ?? null
      const context = buildTurnContext(grid, contestant, phase, contestantIndex, phaseIndex, previousTurn)
      const turn = buildTurn(contestant, turnIndex, phase, context)
      turns.push(turn)

      for (const op of turn.ops) {
        const index = op.y * CANVAS_SIZE + op.x
        grid[index] = op.color
      }
    })
  })

  return {
    contestants: [...contestants],
    turns,
    meta,
  }
}

function buildTurn(
  contestant: OpenClawContestant,
  turnIndex: number,
  phase: TurnPhase,
  context: TurnContext,
): PaintingTurn {
  const profile = deriveArtProfile(contestant)
  const intent = buildTurnIntent(profile, phase, turnIndex)
  const gridBefore = [...context.grid]
  const ops = buildTurnOps(contestant, turnIndex, phase, context)
  const gridAfter = [...gridBefore]

  for (const op of ops) {
    gridAfter[op.y * CANVAS_SIZE + op.x] = op.color
  }

  return {
    id: `${contestant.id}-${phase}-${turnIndex}`,
    turnIndex,
    contestantId: contestant.id,
    phase,
    collaborationRole: context.collaborationRole,
    promptSummary: buildPromptSummary(contestant, profile, context, phase),
    strategySummary: profile.strategySummary,
    responseSummary: context.responseSummary,
    sourceFragments: profile.sourceFragments,
    shapeLanguage: profile.shapeLanguage,
    focusArea: context.focusArea,
    coverage: intent.density,
    changedPixelCount: countChangedPixels(gridBefore, gridAfter),
    ops,
  }
}

function buildPromptSummary(
  contestant: OpenClawContestant,
  profile: ArtProfile,
  context: TurnContext,
  phase: TurnPhase,
) {
  if (context.collaborationRole === 'introduce') {
    return phase === 'foundation'
      ? `${contestant.name} 先把「${profile.atmosphere}」铺进底色`
      : `${contestant.name} 把第一层意图收束成可读轮廓`
  }

  if (context.collaborationRole === 'echo') {
    return `${contestant.name} 顺着前一回合在${context.focusArea}继续扩写`
  }

  if (context.collaborationRole === 'counterbalance') {
    return `${contestant.name} 在${context.focusArea}用反向节奏拉开层次`
  }

  return `${contestant.name} 在${context.focusArea}补上提亮收束`
}

export function getTurnLabel(turn: PaintingTurn) {
  return turn.phase === 'foundation' ? '铺底' : '细化'
}

export function applyTurnsToGrid(
  turns: readonly PaintingTurn[],
  turnCount: number,
  size: number,
): number[] {
  const grid = Array.from({ length: size * size }, () => 0)

  for (const turn of turns.slice(0, turnCount)) {
    for (const op of turn.ops) {
      const index = op.y * size + op.x
      grid[index] = op.color
    }
  }

  return grid
}

export function buildTurnInspection(
  turns: readonly PaintingTurn[],
  turnIndex: number,
  size: number,
) {
  const beforeGrid = applyTurnsToGrid(turns, turnIndex, size)
  const afterGrid = applyTurnsToGrid(turns, turnIndex + 1, size)
  const diffGrid = afterGrid.map((color, index) => (beforeGrid[index] === color ? null : color))

  return {
    beforeGrid,
    afterGrid,
    diffGrid,
  }
}

export function describeCompletion(
  session: CoCreationSession,
  completedTurns: readonly PaintingTurn[],
): string {
  if (completedTurns.length === 0) {
    return '共享画布还没有被任何一位选手真正点亮，作品仍停留在未命名的白纸上。'
  }

  if (completedTurns.length < session.turns.length) {
    const latest = completedTurns.at(-1)
    return `当前完成到第 ${completedTurns.length} / ${session.turns.length} 回合，${latest?.promptSummary}，这一笔主要在${latest?.focusArea}回应前序画面，实际改动了 ${latest?.changedPixelCount} 个像素。`
  }

  return `最终画面汇集了 ${session.contestants.length} 位选手的诗句与笔触，像多段语言在同一张像素画上完成了一次接力呼吸。`
}

export function deriveArtProfile(contestant: OpenClawContestant): ArtProfile {
  const text = [
    contestant.name,
    contestant.motif,
    contestant.personaPrompt,
    contestant.poem,
    contestant.drawingPrompt,
    contestant.strategyHint ?? '',
  ].join('\n')
  const normalized = text.toLowerCase()
  const seed = hashText(text)
  const scene = inferSceneStructure(normalized)
  const motion = inferMotion(normalized)
  const baseColors = buildColorBand(contestant.paletteBias, seed, 3)
  const detailColors = buildColorBand(contestant.paletteBias, seed >> 1, 4)
  const sourceFragments = [
    ...contestant.poem
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2),
    contestant.drawingPrompt.trim(),
    contestant.strategyHint?.trim() ?? '',
  ]
    .filter(Boolean)
  const anchorFragment = sourceFragments[0] ?? contestant.motif
  const hintFragment = contestant.strategyHint?.trim()

  const atmosphereByScene = {
    current: '流动河光',
    ridge: '山体静压',
    bloom: '果园暖雾',
    constellation: '星夜回响',
  } as const

  const shapeByScene = {
    current: '带状水纹与回流亮面',
    ridge: '层叠山脊与切线轮廓',
    bloom: '团簇暖块与中心辉光',
    constellation: '散点星群与交叉光痕',
  } as const

  const motionByType = {
    drift: '让笔触沿着诗句缓慢漂移',
    stack: '让形体按层次逐段压稳',
    pulse: '让亮部像呼吸一样向外脉动',
    glimmer: '让高光以离散方式闪现',
  } as const

  return {
    seed,
    structure: scene,
    motion,
    atmosphere: atmosphereByScene[scene],
    strategySummary: `从「${anchorFragment}」提取${shapeByScene[scene]}，${motionByType[motion]}。${hintFragment ? ` 策略提示：${hintFragment}` : ''}`,
    shapeLanguage: shapeByScene[scene],
    sourceFragments,
    baseColors,
    detailColors,
    accentColor: detailColors[(seed + contestant.poem.length) % detailColors.length] ?? contestant.paletteBias[0] ?? 0,
    coverage: 34 + (seed % 28),
  }
}

function buildTurnIntent(profile: ArtProfile, phase: TurnPhase, turnIndex: number): TurnIntent {
  if (phase === 'foundation') {
    return {
      focus: `先建立${profile.atmosphere}`,
      density: profile.coverage,
      energy: 2 + ((profile.seed + turnIndex) % 3),
    }
  }

  return {
    focus: `再点亮${profile.shapeLanguage}`,
    density: Math.max(18, Math.round(profile.coverage * 0.55)),
    energy: 4 + ((profile.seed + turnIndex) % 4),
  }
}

export function buildTurnOps(
  contestant: OpenClawContestant,
  turnIndex: number,
  phase: TurnPhase,
  context?: Partial<TurnContext>,
): PixelOp[] {
  const profile = deriveArtProfile(contestant)
  const intent = buildTurnIntent(profile, phase, turnIndex)
  const summary = context?.summary ?? summarizeGrid(context?.grid ?? [])
  const collaborationRole = context?.collaborationRole ?? 'introduce'
  const focusArea = context?.focusArea ?? defaultFocusArea(profile)
  const ops = new Map<string, PixelOp>()
  const anchor = resolveAnchor(summary, focusArea, collaborationRole, phase)
  const offset = (profile.seed + anchor.x * 7 + anchor.y * 11 + turnIndex * 13) % CANVAS_SIZE
  const horizon = 9 + ((profile.seed + anchor.y) % 8)
  const spread = collaborationRole === 'counterbalance' ? 2 : 1

  const put = (x: number, y: number, color: number) => {
    if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) {
      return
    }
    ops.set(`${x},${y}`, { x, y, color })
  }

  const pick = (colors: readonly number[], variant: number) =>
    colors[Math.abs(variant) % colors.length] ?? contestant.paletteBias[0] ?? 0

  const paintRect = (x0: number, y0: number, width: number, height: number, colors: readonly number[]) => {
    for (let y = y0; y < y0 + height; y += 1) {
      for (let x = x0; x < x0 + width; x += 1) {
        put(x, y, pick(colors, x * 3 + y * 5 + offset + turnIndex))
      }
    }
  }

  const paintHorizontal = (y: number, x0: number, x1: number, color: number) => {
    for (let x = x0; x <= x1; x += 1) {
      put(x, y, color)
    }
  }

  const paintVertical = (x: number, y0: number, y1: number, color: number) => {
    for (let y = y0; y <= y1; y += 1) {
      put(x, y, color)
    }
  }

  const paintDiamond = (cx: number, cy: number, radius: number, color: number) => {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.abs(x) + Math.abs(y) <= radius) {
          put(cx + x, cy + y, color)
        }
      }
    }
  }

  const paintDiagonal = (x0: number, y0: number, length: number, color: number, slope: 1 | -1 = 1) => {
    for (let step = 0; step < length; step += 1) {
      put(x0 + step, y0 + step * slope, color)
    }
  }

  if (phase === 'foundation' && collaborationRole === 'introduce') {
    paintRect(0, 0, CANVAS_SIZE, horizon, profile.baseColors)
    paintRect(0, horizon, CANVAS_SIZE, CANVAS_SIZE - horizon, [...profile.baseColors].reverse())
  }

  switch (profile.structure) {
    case 'current': {
      const bandCount = phase === 'foundation' ? 4 + spread : 3
      for (let band = 0; band < bandCount; band += 1) {
        const yBase = anchor.y - 4 + band * 2 + ((offset + band) % 2)
        for (let x = 0; x < CANVAS_SIZE; x += 1) {
          const wave = Math.round(Math.sin((x + offset + band * 2) / 3) * (1.4 + spread * 0.3))
          put(
            x,
            yBase + wave,
            phase === 'foundation'
              ? pick(profile.baseColors, x + band + anchor.x)
              : pick(profile.detailColors, x + band + turnIndex + anchor.y),
          )
        }
      }
      if (phase === 'detail') {
        for (let x = Math.max(1, anchor.x - 8); x < Math.min(CANVAS_SIZE - 1, anchor.x + 9); x += 3) {
          put(x, anchor.y + ((x + offset) % 5) - 2, profile.accentColor)
        }
      }
      break
    }
    case 'ridge': {
      const ridgeTop = Math.max(4, Math.min(CANVAS_SIZE - 8, anchor.y - 2))
      const layers = phase === 'foundation' ? 6 : 4
      for (let row = 0; row < layers; row += 1) {
        const start = Math.max(0, anchor.x - 10 + row * 2 - (offset % 3))
        const end = Math.min(CANVAS_SIZE - 1, anchor.x + 10 - row * 2 + (offset % 4))
        paintHorizontal(
          ridgeTop + row,
          start,
          end,
          phase === 'foundation'
            ? pick(profile.baseColors, row + turnIndex + anchor.x)
            : pick(profile.detailColors, row * 2 + turnIndex + anchor.y),
        )
      }
      if (phase === 'detail') {
        paintDiagonal(Math.max(1, anchor.x - 6), ridgeTop - 1, 10, profile.accentColor)
        paintDiagonal(Math.max(2, anchor.x - 1), ridgeTop + 1, 8, 15, -1)
      }
      break
    }
    case 'bloom': {
      const cx = anchor.x
      const cy = anchor.y
      const radius = phase === 'foundation' ? 5 + spread : 4
      for (let ring = radius; ring >= 2; ring -= 2) {
        paintDiamond(
          cx,
          cy,
          ring,
          phase === 'foundation'
            ? pick(profile.baseColors, ring + turnIndex + anchor.x)
            : pick(profile.detailColors, ring + turnIndex + 2 + anchor.y),
        )
      }
      if (phase === 'foundation') {
        paintRect(Math.max(0, cx - 7), Math.min(CANVAS_SIZE - 6, cy + 3), 14, 5, profile.baseColors)
      } else {
        paintHorizontal(Math.min(CANVAS_SIZE - 1, cy + 4), Math.max(0, cx - 8), Math.min(31, cx + 8), profile.accentColor)
        paintVertical(cx, Math.max(0, cy - 4), Math.min(CANVAS_SIZE - 1, cy + 6), 15)
      }
      break
    }
    case 'constellation': {
      const starCount = phase === 'foundation' ? 18 + spread * 3 : 16
      for (let index = 0; index < starCount; index += 1) {
        const x = (anchor.x - 10 + index * 5 + offset + turnIndex * 3 + CANVAS_SIZE * 4) % CANVAS_SIZE
        const y = Math.max(1, Math.min(26, anchor.y - 6 + ((index * 7 + offset + turnIndex) % 12)))
        put(
          x,
          y,
          phase === 'foundation'
            ? pick(profile.baseColors, index + turnIndex + anchor.x)
            : pick(profile.detailColors, index + turnIndex + anchor.y),
        )
        if (phase === 'detail' && index % 3 === 0) {
          paintHorizontal(y, Math.max(0, x - 1), Math.min(CANVAS_SIZE - 1, x + 1), 15)
          paintVertical(x, Math.max(0, y - 1), Math.min(CANVAS_SIZE - 1, y + 1), 15)
        }
      }
      if (phase === 'foundation') {
        paintDiagonal(Math.max(1, anchor.x - 6), Math.min(24, anchor.y + 4), 12, pick(profile.baseColors, offset))
      }
      break
    }
  }

  if (phase === 'detail') {
    const pulseCount = 6 + intent.energy
    for (let index = 0; index < pulseCount; index += 1) {
      const x = Math.max(1, Math.min(30, anchor.x - 10 + ((index * 4 + offset) % 21)))
      const y = Math.max(2, Math.min(29, anchor.y - 8 + ((index * 5 + profile.seed) % 17)))

      if (profile.motion === 'glimmer' || collaborationRole === 'highlight') {
        put(x, y, 15)
      } else if (profile.motion === 'pulse') {
        paintDiamond(x, y, 1, profile.accentColor)
      } else if (profile.motion === 'stack') {
        paintVertical(x, y, Math.min(CANVAS_SIZE - 1, y + 2), profile.accentColor)
      } else {
        paintHorizontal(y, Math.max(0, x - 1), Math.min(CANVAS_SIZE - 1, x + 2), profile.accentColor)
      }
    }
  }

  return [...ops.values()]
}

function buildTurnContext(
  grid: readonly number[],
  contestant: OpenClawContestant,
  phase: TurnPhase,
  contestantIndex: number,
  phaseIndex: number,
  previousTurn: PaintingTurn | null,
): TurnContext {
  const profile = deriveArtProfile(contestant)
  const summary = summarizeGrid(grid)
  const collaborationRole = pickCollaborationRole(summary, profile, phase, contestantIndex, phaseIndex)
  const focusArea = pickFocusArea(summary, profile, collaborationRole)
  const responseSummary = buildResponseSummary(summary, previousTurn, profile, collaborationRole, focusArea)

  return {
    phaseIndex,
    contestantIndex,
    collaborationRole,
    focusArea,
    responseSummary,
    grid: [...grid],
    summary,
    previousTurn,
  }
}

function pickCollaborationRole(
  summary: GridSummary,
  profile: ArtProfile,
  phase: TurnPhase,
  contestantIndex: number,
  phaseIndex: number,
): CollaborationRole {
  if (contestantIndex === 0 && phaseIndex === 0) {
    return 'introduce'
  }

  if (phase === 'detail') {
    return profile.motion === 'glimmer' || summary.brightCount > summary.occupiedCount * 0.16
      ? 'highlight'
      : 'echo'
  }

  const warmScene = profile.structure === 'bloom' || profile.motion === 'pulse'
  const coolGrid = summary.warmCount < Math.max(1, summary.occupiedCount * 0.35)
  return warmScene === coolGrid ? 'counterbalance' : 'echo'
}

function pickFocusArea(summary: GridSummary, profile: ArtProfile, role: CollaborationRole) {
  if (role === 'introduce') {
    return defaultFocusArea(profile)
  }

  const vertical =
    role === 'highlight'
      ? oppositeBand(summary.dominantBand)
      : summary.dominantBand === 'empty'
        ? bandForStructure(profile.structure)
        : bandLabel(summary.dominantBand)
  const horizontal =
    role === 'counterbalance'
      ? oppositeColumn(summary.dominantColumn)
      : summary.dominantColumn === 'empty'
        ? columnForStructure(profile.structure)
        : columnLabel(summary.dominantColumn)

  if (vertical === '全幅') {
    return horizontal
  }

  if (horizontal === '全幅') {
    return vertical
  }

  return `${vertical}${horizontal}`
}

function buildResponseSummary(
  summary: GridSummary,
  previousTurn: PaintingTurn | null,
  profile: ArtProfile,
  role: CollaborationRole,
  focusArea: string,
) {
  const previousShape = previousTurn?.shapeLanguage ?? '前一位留下的底稿'
  if (role === 'introduce') {
    return `先在${focusArea}引入${profile.shapeLanguage}，给后续选手留下第一层可接续结构。`
  }

  if (role === 'echo') {
    return `沿着上一回合的「${previousShape}」继续推进，在${focusArea}把节奏写得更完整。`
  }

  if (role === 'counterbalance') {
    return `针对当前画面偏${summary.dominantBand === 'lower' ? '下压' : '集中'}的重心，在${focusArea}补入反向层次，避免所有选手挤在同一种节奏里。`
  }

  return `围绕已有亮点分布，在${focusArea}补上更清晰的收束高光，让这一回合像是在替前面的笔触点题。`
}

function summarizeGrid(grid: readonly number[]): GridSummary {
  if (grid.length === 0) {
    return {
      occupiedCount: 0,
      warmCount: 0,
      brightCount: 0,
      dominantBand: 'empty',
      dominantColumn: 'empty',
      centerX: 15,
      centerY: 15,
    }
  }

  let occupiedCount = 0
  let warmCount = 0
  let brightCount = 0
  let sumX = 0
  let sumY = 0
  const bandCounts = [0, 0, 0]
  const columnCounts = [0, 0, 0]

  for (let index = 0; index < grid.length; index += 1) {
    const color = grid[index]
    if (color === 0) {
      continue
    }

    occupiedCount += 1
    const x = index % CANVAS_SIZE
    const y = Math.floor(index / CANVAS_SIZE)
    sumX += x
    sumY += y

    if (color >= 8 && color <= 12) {
      warmCount += 1
    }
    if (color >= 14) {
      brightCount += 1
    }

    bandCounts[Math.min(2, Math.floor(y / 11))] += 1
    columnCounts[Math.min(2, Math.floor(x / 11))] += 1
  }

  if (occupiedCount === 0) {
    return {
      occupiedCount: 0,
      warmCount: 0,
      brightCount: 0,
      dominantBand: 'empty',
      dominantColumn: 'empty',
      centerX: 15,
      centerY: 15,
    }
  }

  return {
    occupiedCount,
    warmCount,
    brightCount,
    dominantBand: ['upper', 'middle', 'lower'][bandCounts.indexOf(Math.max(...bandCounts))] as GridSummary['dominantBand'],
    dominantColumn: ['left', 'center', 'right'][columnCounts.indexOf(Math.max(...columnCounts))] as GridSummary['dominantColumn'],
    centerX: Math.round(sumX / occupiedCount),
    centerY: Math.round(sumY / occupiedCount),
  }
}

function resolveAnchor(
  summary: GridSummary,
  focusArea: string,
  role: CollaborationRole,
  phase: TurnPhase,
) {
  const x =
    focusArea.includes('左') ? 9 :
    focusArea.includes('右') ? 23 :
    summary.centerX
  const y =
    focusArea.includes('上') ? 8 :
    focusArea.includes('下') ? 23 :
    focusArea.includes('中') ? 15 :
    summary.centerY

  const shift = role === 'counterbalance' ? 3 : role === 'highlight' ? -2 : phase === 'detail' ? 1 : 0

  return {
    x: Math.max(5, Math.min(26, x + shift)),
    y: Math.max(5, Math.min(26, y + (phase === 'detail' ? -shift : shift))),
  }
}

function countChangedPixels(before: readonly number[], after: readonly number[]) {
  let count = 0
  for (let index = 0; index < after.length; index += 1) {
    if (before[index] !== after[index]) {
      count += 1
    }
  }
  return count
}

function defaultFocusArea(profile: ArtProfile) {
  return {
    current: '中区横向',
    ridge: '下部中区',
    bloom: '中区核心',
    constellation: '上缘全幅',
  }[profile.structure]
}

function bandForStructure(structure: ArtProfile['structure']) {
  return {
    current: '中区',
    ridge: '下部',
    bloom: '中区',
    constellation: '上缘',
  }[structure]
}

function columnForStructure(structure: ArtProfile['structure']) {
  return {
    current: '横向',
    ridge: '中区',
    bloom: '中区',
    constellation: '全幅',
  }[structure]
}

function bandLabel(band: GridSummary['dominantBand']) {
  return {
    upper: '上缘',
    middle: '中区',
    lower: '下部',
    empty: '全幅',
  }[band]
}

function columnLabel(column: GridSummary['dominantColumn']) {
  return {
    left: '左侧',
    center: '中区',
    right: '右侧',
    empty: '全幅',
  }[column]
}

function oppositeBand(band: GridSummary['dominantBand']) {
  if (band === 'upper') return '下部'
  if (band === 'lower') return '上缘'
  if (band === 'middle') return '边缘'
  return '全幅'
}

function oppositeColumn(column: GridSummary['dominantColumn']) {
  if (column === 'left') return '右侧'
  if (column === 'right') return '左侧'
  if (column === 'center') return '两侧'
  return '全幅'
}

function buildColorBand(colors: readonly number[], seed: number, count: number) {
  const band = new Set<number>()

  for (let index = 0; index < count; index += 1) {
    band.add(colors[(seed + index * 3) % colors.length] ?? colors[0] ?? 0)
  }

  return [...band]
}

function inferSceneStructure(text: string): ArtProfile['structure'] {
  if (matchesAny(text, ['river', 'water', 'lake', 'stream', '河', '水', '舟', '波'])) {
    return 'current'
  }

  if (matchesAny(text, ['mountain', 'ridge', 'stone', '山', '雾', '石'])) {
    return 'ridge'
  }

  if (matchesAny(text, ['star', 'night', 'constellation', '宇宙', '星', '夜', '湖心'])) {
    return 'constellation'
  }

  return 'bloom'
}

function inferMotion(text: string): ArtProfile['motion'] {
  if (matchesAny(text, ['steady', 'layer', 'record', '理性', '克制', '边界', '轮廓'])) {
    return 'stack'
  }

  if (matchesAny(text, ['warm', 'heat', 'light', 'glow', '热', '亮', '光', '夕照'])) {
    return 'pulse'
  }

  if (matchesAny(text, ['spark', 'star', 'surprise', 'high', '梦', '星', '惊喜', '高光'])) {
    return 'glimmer'
  }

  return 'drift'
}

function matchesAny(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

function hashText(text: string) {
  let hash = 2166136261

  for (const char of text) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return Math.abs(hash >>> 0)
}
