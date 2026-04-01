import type { SessionContestant, StaticContestantSeed } from '../types'

type SceneStructure = 'current' | 'ridge' | 'bloom' | 'constellation'
type MotionType = 'drift' | 'stack' | 'pulse' | 'glimmer'

export function enrichStaticContestants(
  contestants: readonly StaticContestantSeed[],
): SessionContestant[] {
  return contestants.map((contestant) => enrichStaticContestant(contestant))
}

export function enrichStaticContestant(contestant: StaticContestantSeed): SessionContestant {
  const poem = contestant.poem.trim()
  const personaPrompt = contestant.personaPrompt.trim()
  const normalizedPoem = poem.toLowerCase()
  const normalizedPersona = personaPrompt.toLowerCase()
  const scene = inferSceneStructure(normalizedPoem)
  const motion = inferMotion(`${normalizedPoem}\n${normalizedPersona}`)
  const motif = contestant.motif?.trim() || deriveMotifFromSeed(contestant, scene)
  const paletteBias = contestant.paletteBias ?? derivePaletteBiasFromSeed(contestant, scene, motion)
  const drawingPrompt = deriveDrawingPromptFromSeed(contestant, scene, motion, motif)
  const strategyHint = deriveStrategyHintFromDrawingPrompt(drawingPrompt, poem, scene, motion)

  return {
    id: contestant.id,
    name: contestant.name.trim(),
    personaPrompt,
    poem,
    motif,
    paletteBias,
    drawingPrompt,
    strategyHint,
  }
}

export function deriveMotifFromSeed(contestant: StaticContestantSeed, scene: SceneStructure) {
  const motifByScene = {
    current: 'River Memory',
    ridge: 'Measured Ridge',
    bloom: 'Warm Orchard',
    constellation: 'Echo Ceiling',
  } as const

  const firstMeaningfulLine = contestant.poem
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstMeaningfulLine) {
    return motifByScene[scene]
  }

  return firstMeaningfulLine.length <= 20
    ? firstMeaningfulLine
    : `${contestant.name} · ${motifByScene[scene]}`
}

export function derivePaletteBiasFromSeed(
  contestant: StaticContestantSeed,
  scene: SceneStructure,
  motion: MotionType,
) {
  const baseByScene = {
    current: [2, 3, 6, 9],
    ridge: [1, 4, 5, 13],
    bloom: [8, 10, 11, 12],
    constellation: [0, 7, 14, 15],
  } as const
  const seed = hashText(`${contestant.id}\n${contestant.name}\n${contestant.poem}\n${contestant.personaPrompt}`)
  const extrasByMotion = {
    drift: [3, 7],
    stack: [4, 13],
    pulse: [10, 12],
    glimmer: [14, 15],
  } as const

  const base = [...baseByScene[scene]]
  const extras = extrasByMotion[motion]
  const combined = [base[0], base[1], extras[seed % extras.length] ?? base[2], base[3]]

  return combined.map((entry) => Math.max(0, Math.min(15, entry)))
}

export function deriveDrawingPromptFromSeed(
  contestant: StaticContestantSeed,
  scene: SceneStructure,
  motion: MotionType,
  motif: string,
) {
  const focusByScene = {
    current: '河道、水纹和回流反光',
    ridge: '山脊、轮廓线和分层结构',
    bloom: '暖色团簇、中心热核和外扩光晕',
    constellation: '离散星点、余像和高光交叉',
  } as const
  const motionByType = {
    drift: '让笔触像慢慢漂移的气流一样展开',
    stack: '让形体按层次稳定堆叠',
    pulse: '让亮部向外脉冲扩散',
    glimmer: '让高光以离散闪现的方式出现',
  } as const
  const poemAnchor = contestant.poem
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean) ?? contestant.poem.trim()

  return `围绕「${poemAnchor}」把${focusByScene[scene]}压进共享画布，参考人格提示「${contestant.personaPrompt.trim()}」控制语气，并以「${motif}」作为视觉记忆点，${motionByType[motion]}。`
}

export function deriveStrategyHintFromDrawingPrompt(
  drawingPrompt: string,
  poem: string,
  scene: SceneStructure,
  motion: MotionType,
) {
  const sceneHint = {
    current: '优先让画面先呼吸，再把水样节奏往外带。',
    ridge: '优先建立能被后手接住的边界和重心。',
    bloom: '优先形成中心聚焦，再决定哪些区域继续升温。',
    constellation: '优先留下可被后手呼应的亮点网络。',
  } as const
  const motionHint = {
    drift: '避免把所有变化挤在同一块区域里。',
    stack: '让后续细化有明确层级可依附。',
    pulse: '让高能区域和留白之间保持呼吸感。',
    glimmer: '把提亮留给最能解释诗句的节点。',
  } as const
  const poemEcho = poem
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 1)
    .join(' ')

  return `从诗句「${poemEcho}」继续推导，${sceneHint[scene]} ${motionHint[motion]} 当前绘画提示：${drawingPrompt}`
}

function inferSceneStructure(normalizedPoem: string): SceneStructure {
  if (/(山|岩|石|岭|峰|雾|阶)/.test(normalizedPoem)) {
    return 'ridge'
  }

  if (/(星|夜空|宇宙|灯|光|闪|月)/.test(normalizedPoem)) {
    return 'constellation'
  }

  if (/(果|橙|金|热|火|暖|园)/.test(normalizedPoem)) {
    return 'bloom'
  }

  return 'current'
}

function inferMotion(normalizedText: string): MotionType {
  if (/(闪|亮|跳|意外|惊喜|回声|高光)/.test(normalizedText)) {
    return 'glimmer'
  }

  if (/(热|火|脉冲|发热|热烈|外放)/.test(normalizedText)) {
    return 'pulse'
  }

  if (/(理性|边界|轮廓|整理|层次|校准)/.test(normalizedText)) {
    return 'stack'
  }

  return 'drift'
}

function hashText(text: string) {
  let hash = 0

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }

  return hash
}
