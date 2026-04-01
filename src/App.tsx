import { startTransition, useEffect, useEffectEvent, useState } from 'react'
import './App.css'
import {
  CANVAS_SIZE,
  PALETTE,
  applyTurnsToGrid,
  buildTurnInspection,
  describeCompletion,
  getTurnLabel,
} from './lib/art'
import { saveGeneratedDraft } from './lib/sessionDraftExport'
import { loadSessionFromSearch } from './lib/sessionProvider'
import type { CoCreationSession } from './types'

function App() {
  const [session, setSession] = useState<CoCreationSession | null>(null)
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [revealedTurnCount, setRevealedTurnCount] = useState(0)
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'finished'>('idle')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedDraftUrl, setSavedDraftUrl] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleReloadSession = () => {
    setLoadStatus('loading')
    setLoadError(null)
    setSaveStatus('idle')
    setSavedDraftUrl(null)
    setSaveError(null)
    setReloadToken((current) => current + 1)
  }

  useEffect(() => {
    let cancelled = false

    loadSessionFromSearch(window.location.search)
      .then((nextSession) => {
        if (cancelled) {
          return
        }

        setSession(nextSession)
        setRevealedTurnCount(0)
        setSelectedTurnIndex(null)
        setStatus('idle')
        setSaveStatus('idle')
        setSavedDraftUrl(null)
        setSaveError(null)
        setLoadStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : '未知加载错误'
        setSession(null)
        setLoadError(message)
        setSaveStatus('idle')
        setSavedDraftUrl(null)
        setSaveError(null)
        setLoadStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const contestants = session?.contestants ?? []
  const turns = session?.turns ?? []
  const originalMeta = session?.meta.origin ?? session?.meta ?? null
  const selectedTurn = selectedTurnIndex === null ? null : (turns[selectedTurnIndex] ?? null)
  const activeTurn = turns[revealedTurnCount] ?? null
  const completedTurns = turns.slice(0, revealedTurnCount)
  const latestCompletedTurn = completedTurns.at(-1) ?? null
  const inspectionTurn = selectedTurn ?? latestCompletedTurn
  const inspectionTurnIndex = inspectionTurn?.turnIndex ?? null
  const activeContestantId = selectedTurn?.contestantId ?? activeTurn?.contestantId ?? latestCompletedTurn?.contestantId ?? null
  const inspectionTurnCount = inspectionTurn ? inspectionTurn.turnIndex + 1 : revealedTurnCount
  const grid = applyTurnsToGrid(turns, inspectionTurnCount, CANVAS_SIZE)
  const inspection = inspectionTurnIndex === null ? null : buildTurnInspection(turns, inspectionTurnIndex, CANVAS_SIZE)
  const inspectedContestant = inspectionTurn
    ? contestants.find((contestant) => contestant.id === inspectionTurn.contestantId) ?? null
    : null
  const completionText = session
    ? describeCompletion(session, turns.slice(0, inspectionTurnCount))
    : '正在准备本次共创会话。'

  const advanceTurn = () => {
    startTransition(() => {
      setRevealedTurnCount((current) => {
        if (current >= turns.length) {
          setStatus('finished')
          return current
        }

        const next = current + 1
        if (next >= turns.length) {
          setStatus('finished')
        }

        return next
      })
    })
  }

  const playNextTurn = useEffectEvent(() => {
    advanceTurn()
  })

  useEffect(() => {
    if (status !== 'running') {
      return
    }

    const timer = window.setInterval(() => {
      playNextTurn()
    }, 780)

    return () => window.clearInterval(timer)
  }, [status, turns.length])

  const handleStart = () => {
    if (status === 'finished' && revealedTurnCount >= turns.length) {
      setRevealedTurnCount(0)
      setSelectedTurnIndex(null)
    } else if (selectedTurnIndex !== null) {
      setSelectedTurnIndex(null)
    }
    setStatus('running')
  }

  const handlePauseResume = () => {
    setStatus((current) => {
      if (current === 'running') {
        return 'paused'
      }

      if (selectedTurnIndex !== null) {
        setSelectedTurnIndex(null)
      }

      return 'running'
    })
  }

  const handleStep = () => {
    if (status === 'finished' && revealedTurnCount >= turns.length) {
      setRevealedTurnCount(0)
      setSelectedTurnIndex(null)
      setStatus('paused')
      return
    }

    if (selectedTurnIndex !== null) {
      setSelectedTurnIndex(null)
    }
    setStatus('paused')
    advanceTurn()
  }

  const handleReplay = () => {
    setRevealedTurnCount(0)
    setSelectedTurnIndex(null)
    setStatus('idle')
  }

  const handleSelectTurn = (turnIndex: number) => {
    setSelectedTurnIndex(turnIndex)
    setRevealedTurnCount(turnIndex + 1)
    setStatus('paused')
  }

  const handleSaveDraft = () => {
    if (!session || !import.meta.env.DEV) {
      return
    }

    setSaveStatus('saving')
    setSaveError(null)

    void saveGeneratedDraft(session)
      .then((draftUrl) => {
        setSavedDraftUrl(draftUrl)
        setSaveStatus('saved')
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : '未知保存错误')
        setSaveStatus('error')
      })
  }

  const reopenDraftUrl = savedDraftUrl ? `/?provider=draft&draftUrl=${encodeURIComponent(savedDraftUrl)}` : null

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">OpenClaw Poem-to-Pixel MVP</p>
          <h1>任意数量的诗人先写诗，再轮流把同一张像素画完成。</h1>
          <p className="hero-summary">
            当前版本支持 static ingest、deterministic generation、draft import 和 legacy 本机 OpenClaw bridge，验证一条可解释、可回放、可切换来源的 poem-to-pixel 共创闭环。
          </p>
        </div>
        <div className="hero-stats" aria-label="session summary">
          <div>
            <span>选手</span>
            <strong>{contestants.length}</strong>
          </div>
          <div>
            <span>回合</span>
            <strong>{turns.length}</strong>
          </div>
          <div>
            <span>{session?.meta ? '来源' : '画布'}</span>
            <strong>{session?.meta ? session.meta.providerLabel : `${CANVAS_SIZE} x ${CANVAS_SIZE}`}</strong>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="contestant-column" aria-label="contestants">
          {contestants.map((contestant) => {
            const isActive = contestant.id === activeContestantId
            const completed = completedTurns.filter((turn) => turn.contestantId === contestant.id).length
            const plannedTurns = turns.filter((turn) => turn.contestantId === contestant.id).length

            return (
              <article
                key={contestant.id}
                className={`contestant-card${isActive ? ' is-active' : ''}`}
              >
                <div className="contestant-header">
                  <div>
                    <p className="contestant-role">{contestant.motif}</p>
                    <h2>{contestant.name}</h2>
                  </div>
                  <span className="contestant-progress">{completed}/{plannedTurns}</span>
                </div>
                <p className="contestant-traits">{contestant.personaPrompt}</p>
                <blockquote>{contestant.poem}</blockquote>
                <p className="contestant-prompt">{contestant.drawingPrompt}</p>
              </article>
            )
          })}
        </aside>

        <section className="canvas-column">
          <div className="canvas-frame">
            <div className="canvas-header">
              <div>
                <p className="panel-kicker">Shared Pixel Canvas</p>
                <h2>{inspectionTurn ? inspectionTurn.promptSummary : '等待第一位选手落笔'}</h2>
              </div>
              <div className={`status-pill status-${loadStatus === 'ready' ? status : loadStatus}`}>
                {loadStatus === 'ready' ? status : loadStatus}
              </div>
            </div>

            {loadStatus === 'loading' ? (
              <section className="session-state-card" aria-live="polite">
                <p className="panel-kicker">Session Status</p>
                <h3>正在从 provider 加载会话。</h3>
                <p>页面会在会话准备好之后开放播放控制和完整回放。</p>
              </section>
            ) : null}

            {loadStatus === 'error' ? (
              <section className="session-state-card is-error" aria-live="assertive">
                <p className="panel-kicker">Session Status</p>
                <h3>会话加载失败。</h3>
                <p>{describeLoadError(loadError)}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleReloadSession}
                >
                  重新加载 session
                </button>
              </section>
            ) : null}

            {loadStatus === 'ready' && session ? (
              <>
                <div className="strategy-card" aria-live="polite">
                  <p className="panel-kicker">Turn Strategy</p>
                  <h3>{inspectionTurn ? inspectionTurn.strategySummary : '诗句和提示词还没有开始转成笔触。'}</h3>
                  <p>
                    Provider：{session.meta.providerLabel} · 模式：{session.meta.mode}
                  </p>
                  {session.meta.sourceLabel ? <p>来源：{session.meta.sourceLabel}</p> : null}
                  {session.meta.runId ? <p>Run ID：{session.meta.runId}</p> : null}
                  {session.meta.origin ? (
                    <>
                      <p>
                        原始来源：{originalMeta?.providerLabel} · 模式：{originalMeta?.mode}
                      </p>
                      {originalMeta?.sourceLabel ? <p>原始 source：{originalMeta.sourceLabel}</p> : null}
                      {originalMeta?.runId ? <p>原始 Run ID：{originalMeta.runId}</p> : null}
                    </>
                  ) : null}
                  {inspectionTurn ? (
                    <>
                      <p>
                        协作角色：{describeCollaborationRole(inspectionTurn.collaborationRole)} · 作用区域：{inspectionTurn.focusArea}
                      </p>
                      <p>
                        形态语言：{inspectionTurn.shapeLanguage} · 覆盖强度：{inspectionTurn.coverage} · 改动像素：{inspectionTurn.changedPixelCount}
                      </p>
                      <p>{inspectionTurn.responseSummary}</p>
                      <div className="strategy-fragments">
                        {inspectionTurn.sourceFragments.map((fragment) => (
                          <span key={fragment}>{fragment}</span>
                        ))}
                      </div>
                      {inspectedContestant ? (
                        <div className="lineage-card">
                          <p className="panel-kicker">Prompt Lineage</p>
                          <div className="lineage-row">
                            <strong>Poem</strong>
                            <p>{inspectedContestant.poem}</p>
                          </div>
                          <div className="lineage-row">
                            <strong>Drawing Prompt</strong>
                            <p>{inspectedContestant.drawingPrompt}</p>
                          </div>
                          <div className="lineage-row">
                            <strong>Strategy Hint</strong>
                            <p>{inspectedContestant.strategyHint ?? '未提供，由 deterministic engine 从 poem / drawingPrompt 推导。'}</p>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p>开始后会展示当前回合如何从诗句和绘画提示推导出像素策略。</p>
                  )}
                </div>

                <div
                  className="pixel-canvas"
                  role="img"
                  aria-label="Collaborative pixel artwork"
                  style={{
                    gridTemplateColumns: `repeat(${CANVAS_SIZE}, minmax(0, 1fr))`,
                  }}
                >
                  {grid.map((color, index) => (
                    <span
                      key={index}
                      className="pixel"
                      style={{ backgroundColor: PALETTE[color] }}
                    />
                  ))}
                </div>

                {inspection ? (
                  <section className="inspector-card" aria-label="turn inspector">
                    <div className="inspector-header">
                      <div>
                        <p className="panel-kicker">Replay Inspector</p>
                        <h3>
                          {getTurnLabel(inspectionTurn!)} · {inspectedContestant?.name ?? inspectionTurn?.contestantId}
                        </h3>
                      </div>
                      <span>{inspectionTurnIndex! + 1}/{turns.length}</span>
                    </div>
                    <div className="inspector-grids">
                      <div className="inspector-grid-card">
                        <p>Before This Turn</p>
                        <div
                          className="pixel-canvas mini-canvas"
                          role="img"
                          aria-label="Before this turn"
                          style={{
                            gridTemplateColumns: `repeat(${CANVAS_SIZE}, minmax(0, 1fr))`,
                          }}
                        >
                          {inspection.beforeGrid.map((color, index) => (
                            <span
                              key={`before-${index}`}
                              className="pixel"
                              style={{ backgroundColor: PALETTE[color] }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="inspector-grid-card">
                        <p>Changed In This Turn</p>
                        <div
                          className="pixel-canvas mini-canvas diff-canvas"
                          role="img"
                          aria-label="Changed in this turn"
                          style={{
                            gridTemplateColumns: `repeat(${CANVAS_SIZE}, minmax(0, 1fr))`,
                          }}
                        >
                          {inspection.diffGrid.map((color, index) => (
                            <span
                              key={`diff-${index}`}
                              className={`pixel${color === null ? ' pixel-empty' : ''}`}
                              style={{ backgroundColor: color === null ? undefined : PALETTE[color] }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                <div className="controls">
                  <button type="button" onClick={handleStart}>
                    {status === 'idle' ? '开始演示' : '继续自动播放'}
                  </button>
                  <button type="button" onClick={handlePauseResume}>
                    {status === 'running' ? '暂停' : '恢复'}
                  </button>
                  <button type="button" onClick={handleStep}>
                    单步推进
                  </button>
                  <button type="button" onClick={handleReplay}>
                    重播
                  </button>
                  {import.meta.env.DEV ? (
                    <button type="button" onClick={handleSaveDraft} disabled={!session || saveStatus === 'saving'}>
                      {saveStatus === 'saving' ? '正在保存 draft' : '保存为 draft'}
                    </button>
                  ) : null}
                </div>

                {import.meta.env.DEV ? (
                  <div className={`draft-save-card${saveStatus === 'error' ? ' is-error' : ''}`}>
                    <p className="panel-kicker">Replay Draft Export</p>
                    <h3>把当前 session 保存成同源 draft JSON。</h3>
                    <p>保存后可以直接用 draft provider 重开这一份回放，并保留原始 provider provenance。</p>
                    {saveStatus === 'saved' && savedDraftUrl ? (
                      <>
                        <p>保存成功：{savedDraftUrl}</p>
                        {reopenDraftUrl ? (
                          <p>
                            重开链接：
                            <a href={reopenDraftUrl}>{reopenDraftUrl}</a>
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {saveStatus === 'error' && saveError ? <p>{saveError}</p> : null}
                  </div>
                ) : null}

                <div className="palette-strip" aria-label="color palette">
                  {PALETTE.map((color) => (
                    <span key={color} style={{ backgroundColor: color }} />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>

        <aside className="log-column">
          <article className="summary-card">
            <p className="panel-kicker">共同画作说明</p>
            <h2>诗句被折叠成颜色和形状。</h2>
            <p>{completionText}</p>
          </article>

          <article className="log-card">
            <div className="log-card-header">
              <div>
                <p className="panel-kicker">Turn Log</p>
                <h2>逐回合作画记录</h2>
              </div>
              <span>{revealedTurnCount}/{turns.length}</span>
            </div>
            <ol>
              {turns.map((turn, index) => {
                const contestant = contestants.find((item) => item.id === turn.contestantId)
                const isDone = index < revealedTurnCount
                const isCurrent = selectedTurnIndex === null && index === revealedTurnCount && loadStatus === 'ready' && status !== 'finished'
                const isSelected = index === selectedTurnIndex

                return (
                  <li key={turn.id}>
                    <button
                      type="button"
                      className={`log-entry${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}`}
                      onClick={() => handleSelectTurn(index)}
                      aria-pressed={isSelected}
                    >
                      <p>
                        {getTurnLabel(turn)} · {contestant?.name}
                      </p>
                      <strong>{turn.promptSummary}</strong>
                      <em>{turn.strategySummary}</em>
                      <span>
                        {describeCollaborationRole(turn.collaborationRole)} · {turn.focusArea} · 实改 {turn.changedPixelCount} 像素
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </article>
        </aside>
      </section>
    </main>
  )
}

function describeLoadError(loadError: string | null) {
  if (!loadError) {
    return '未能生成本次会话。'
  }

  if (loadError.startsWith('Unknown session provider:')) {
    return `未知 provider：${loadError.replace('Unknown session provider:', '').trim()}`
  }

  if (loadError.startsWith('Draft session URL')) {
    return `draftUrl 非法：${loadError}`
  }

  if (loadError.startsWith('Contestant roster URL')) {
    return `rosterUrl 非法：${loadError}`
  }

  if (loadError.startsWith('Failed to fetch draft session:')) {
    return `外部 draft 加载失败：${loadError}`
  }

  if (loadError.startsWith('Failed to fetch contestant roster:')) {
    return `外部 roster 加载失败：${loadError}`
  }

  if (loadError.startsWith('Invalid draft session JSON:') || loadError.startsWith('Invalid draft ')) {
    return `外部 draft 结构不合法：${loadError}`
  }

  if (loadError.startsWith('Invalid contestant roster JSON:') || loadError.startsWith('Invalid contestant roster ')) {
    return `外部 roster 结构不合法：${loadError}`
  }

  if (loadError.startsWith('Local OpenClaw bridge error:')) {
    const detail = loadError.replace('Local OpenClaw bridge error:', '').trim()
    if (detail.startsWith('agent_contract_mismatch -')) {
      return `本机 OpenClaw bridge 触发 contract mismatch 保护：${detail.replace('agent_contract_mismatch -', '').trim()}`
    }

    return `本机 OpenClaw bridge 失败：${detail}`
  }

  if (loadError.startsWith('Local OpenClaw bridge HTTP error:')) {
    return `本机 OpenClaw bridge 不可用：${loadError}`
  }

  return loadError
}

function describeCollaborationRole(role: CoCreationSession['turns'][number]['collaborationRole']) {
  return {
    introduce: '引入',
    echo: '呼应',
    counterbalance: '对冲',
    highlight: '提亮',
  }[role]
}

export default App
