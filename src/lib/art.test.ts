import { describe, expect, test } from 'vitest'
import { contestants } from '../data/contestants'
import { staticContestants } from '../data/staticContestants'
import { sampleSessionDraft } from '../data/sampleSessionDraft'
import {
  LOCAL_OPENCLAW_TEXTS_ENDPOINT,
  buildLocalOpenClawRequest,
  buildLocalOpenClawSessionId,
  parseOpenClawCliResult,
  resolveLocalOpenClawRunId,
} from './localOpenClaw'
import {
  deriveDrawingPromptFromSeed,
  deriveStrategyHintFromDrawingPrompt,
  enrichStaticContestant,
  enrichStaticContestants,
} from './contestantEnrichment'
import {
  GENERATED_DRAFT_PROVIDER_LABEL,
  buildDraftExportSession,
  buildGeneratedDraftUrl,
  saveGeneratedDraft,
  validateGeneratedDraftFilename,
} from './sessionDraftExport'
import {
  DEFAULT_STATIC_ROSTER_URL,
  STATIC_INGEST_PROVIDER_ID,
  draftSessionProvider,
  getDraftUrlFromSearch,
  getProviderIdFromSearch,
  getRosterUrlFromSearch,
  loadExternalDraftSession,
  loadExternalRosterContestants,
  loadSessionFromSearch,
  localDeterministicSessionProvider,
  localOpenClawSessionProvider,
  parseDraftSession,
  parseStaticContestantRoster,
  resolveSessionProvider,
  staticIngestSessionProvider,
  validateDraftUrl,
  validateRosterUrl,
} from './sessionProvider'
import {
  CANVAS_SIZE,
  PALETTE,
  applyTurnsToGrid,
  buildTurnInspection,
  buildSession,
  buildTurnOps,
  deriveArtProfile,
} from './art'

describe('art session', () => {
  test('enriches static contestants into deterministic drawing prompts and strategy hints', () => {
    const enriched = enrichStaticContestant(staticContestants[0]!)

    expect(enriched.drawingPrompt).toContain(staticContestants[0]!.personaPrompt)
    expect(enriched.strategyHint).toContain('从诗句')
    expect(enriched.paletteBias).toHaveLength(4)
    expect(enriched.motif.length).toBeGreaterThan(0)
  })

  test('builds a deterministic session from enriched contestants using dynamic turn counts', () => {
    const session = buildSession(contestants)

    expect(session.contestants).toEqual(contestants)
    expect(session.turns).toHaveLength(contestants.length * 2)
    expect(session.turns[0]?.id).toBe('jade-foundation-0')
    expect(session.turns.at(-1)?.id).toBe('echo-detail-15')
    expect(session.turns[0]?.collaborationRole).toBe('introduce')
    expect(session.turns.every((turn) => turn.responseSummary.length > 0)).toBe(true)
    expect(session.turns.every((turn) => turn.focusArea.length > 0)).toBe(true)
    expect(session.turns.every((turn) => turn.changedPixelCount > 0)).toBe(true)
  })

  test('supports arbitrary contestant counts and custom phase plans', () => {
    const enriched = enrichStaticContestants([
      ...staticContestants,
      {
        id: 'lumen',
        name: 'Lumen Vale',
        personaPrompt: '擅长把秩序写成冷亮边界的补位者',
        poem: '白光沿着玻璃背面缓慢折返\n每一处留白都像在等待标记',
      },
    ])
    const session = buildSession(
      enriched,
      {
        providerId: STATIC_INGEST_PROVIDER_ID,
        providerLabel: 'Static Ingest Provider',
        mode: 'static-ingest',
      },
      ['foundation'],
    )

    expect(session.turns).toHaveLength(enriched.length)
    expect(new Set(session.turns.map((turn) => turn.id)).size).toBe(session.turns.length)
  })

  test('keeps all pixel operations inside the canvas and palette range', () => {
    for (const contestant of contestants) {
      for (const phase of ['foundation', 'detail'] as const) {
        const ops = buildTurnOps(contestant, 0, phase)
        expect(ops.length).toBeGreaterThan(0)

        for (const op of ops) {
          expect(op.x).toBeGreaterThanOrEqual(0)
          expect(op.x).toBeLessThan(CANVAS_SIZE)
          expect(op.y).toBeGreaterThanOrEqual(0)
          expect(op.y).toBeLessThan(CANVAS_SIZE)
          expect(PALETTE[op.color]).toBeDefined()
        }
      }
    }
  })

  test('replay builds the same composed image every time', () => {
    const session = buildSession(contestants)
    const first = applyTurnsToGrid(session.turns, session.turns.length, CANVAS_SIZE)
    const second = applyTurnsToGrid(session.turns, session.turns.length, CANVAS_SIZE)

    expect(first).toEqual(second)
    expect(first.some((color) => color !== 0)).toBe(true)
  })

  test('builds before and diff grids for inspected turns', () => {
    const session = buildSession(contestants)
    const inspection = buildTurnInspection(session.turns, 4, CANVAS_SIZE)

    expect(inspection.beforeGrid).toEqual(applyTurnsToGrid(session.turns, 4, CANVAS_SIZE))
    expect(inspection.afterGrid).toEqual(applyTurnsToGrid(session.turns, 5, CANVAS_SIZE))
    expect(inspection.diffGrid.filter((color) => color !== null)).toHaveLength(
      session.turns[4]?.changedPixelCount ?? 0,
    )
  })

  test('poem and drawing prompt influence the derived strategy and pixel output', () => {
    const original = contestants[0]!
    const remixed = {
      ...original,
      poem: '金属雨沿着屋脊翻涌\n信号塔把雾切成脉冲\n整座城市都在等待第二次闪烁',
      drawingPrompt: '改成高反差脉冲和离散光点，让上方天空更像通电后的夜。',
      motif: '金属脉冲',
      strategyHint: '用山脊轮廓和脉冲节奏取代原先的平铺叙事。',
    }

    const originalProfile = deriveArtProfile(original)
    const remixedProfile = deriveArtProfile(remixed)
    expect(remixedProfile.strategySummary).not.toBe(originalProfile.strategySummary)
    expect(remixedProfile.sourceFragments).not.toEqual(originalProfile.sourceFragments)
    expect(remixedProfile.shapeLanguage).not.toBe(originalProfile.shapeLanguage)
  })

  test('later turns respond to the existing shared canvas state', () => {
    const emptyContextOps = buildTurnOps(contestants[2]!, 4, 'foundation')
    const warmCenterGrid = Array.from({ length: CANVAS_SIZE * CANVAS_SIZE }, (_, index) => {
      const x = index % CANVAS_SIZE
      const y = Math.floor(index / CANVAS_SIZE)
      return x >= 11 && x <= 19 && y >= 10 && y <= 18 ? 10 : 0
    })
    const responsiveOps = buildTurnOps(contestants[2]!, 4, 'foundation', {
      collaborationRole: 'counterbalance',
      focusArea: '下部中区',
      grid: warmCenterGrid,
    })

    expect(responsiveOps).not.toEqual(emptyContextOps)
  })

  test('drawing prompt and strategy hint derivation stay poem-led', () => {
    const seed = staticContestants[1]!
    const prompt = deriveDrawingPromptFromSeed(seed, 'bloom', 'pulse', 'Warm Orchard')
    const hint = deriveStrategyHintFromDrawingPrompt(prompt, seed.poem, 'bloom', 'pulse')

    expect(prompt).toContain(seed.personaPrompt)
    expect(prompt).toContain('围绕')
    expect(hint).toContain('从诗句')
  })

  test('local deterministic provider uses the shared static enrichment pipeline', async () => {
    const first = await localDeterministicSessionProvider.generateSession(staticContestants)
    const second = await localDeterministicSessionProvider.generateSession(staticContestants)

    expect(first.meta).toEqual({
      providerId: 'local-deterministic',
      providerLabel: 'Local Deterministic Provider',
      mode: 'local-deterministic',
      sourceLabel: 'built-in static roster',
    })
    expect(first.contestants).toEqual(contestants)
    expect(first).toEqual(second)
  })

  test('static ingest provider and roster loading handle default and external sources', async () => {
    expect(getProviderIdFromSearch('')).toBeNull()
    expect(getProviderIdFromSearch('?provider=static-ingest')).toBe('static-ingest')
    expect(getRosterUrlFromSearch('?provider=static-ingest&rosterUrl=/contestant-rosters/sample-roster.json')).toBe(
      '/contestant-rosters/sample-roster.json',
    )
    expect(resolveSessionProvider('static-ingest')?.id).toBe('static-ingest')

    const builtIn = await staticIngestSessionProvider.generateSession(staticContestants)
    expect(builtIn.meta.providerId).toBe('static-ingest')
    expect(builtIn.meta.sourceLabel).toBe('built-in sample roster')

    const rosterFetch: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          contestants: staticContestants,
        }),
      }) as Response

    const externalContestants = await loadExternalRosterContestants(DEFAULT_STATIC_ROSTER_URL, rosterFetch)
    expect(externalContestants).toEqual(staticContestants)

    const originalFetch = globalThis.fetch
    globalThis.fetch = rosterFetch
    try {
      const externalSession = await loadSessionFromSearch(
        '?provider=static-ingest&rosterUrl=/contestant-rosters/sample-roster.json',
      )
      expect(externalSession.meta.providerId).toBe('static-ingest')
      expect(externalSession.meta.sourceLabel).toBe('/contestant-rosters/sample-roster.json')
      expect(externalSession.turns).toHaveLength(staticContestants.length * 2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('static roster parser validates same-origin urls and roster payloads', async () => {
    expect(() => validateRosterUrl('https://example.com/roster.json')).toThrow(
      'Contestant roster URL must be same-origin: https://example.com/roster.json',
    )
    expect(() => validateRosterUrl('/contestant-rosters/sample-roster.txt')).toThrow(
      'Contestant roster URL must point to a JSON file: /contestant-rosters/sample-roster.txt',
    )
    expect(parseStaticContestantRoster({ contestants: staticContestants }, '/contestant-rosters/sample-roster.json')).toEqual(
      staticContestants,
    )
    expect(() =>
      parseStaticContestantRoster({ contestants: [{ id: 'bad' }] }, '/contestant-rosters/bad.json'),
    ).toThrow('Invalid contestant roster fields at index 0 (/contestant-rosters/bad.json)')

    const badFetch: typeof fetch = async () =>
      ({
        ok: false,
        status: 404,
        json: async () => ({}),
      }) as Response

    await expect(loadExternalRosterContestants('/contestant-rosters/missing.json', badFetch)).rejects.toThrow(
      'Failed to fetch contestant roster: /contestant-rosters/missing.json (404)',
    )
  })

  test('draft provider returns the imported draft session without regeneration', async () => {
    const draftSession = await draftSessionProvider.generateSession(staticContestants)

    expect(draftSession).toEqual(sampleSessionDraft)
    expect(draftSession.meta.mode).toBe('draft')
  })

  test('draft loader and parser remain compatible', async () => {
    expect(getDraftUrlFromSearch('?provider=draft&draftUrl=/session-drafts/sample-draft.json')).toBe(
      '/session-drafts/sample-draft.json',
    )

    const fetchMock: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          ...sampleSessionDraft,
          meta: {
            providerId: 'draft',
            providerLabel: 'Fetched Draft',
            mode: 'draft',
          },
        }),
      }) as Response

    const session = await loadExternalDraftSession('/session-drafts/sample-draft.json', fetchMock)
    expect(session.meta.providerLabel).toBe('Fetched Draft')
    expect(session.meta.sourceLabel).toBe('/session-drafts/sample-draft.json')

    expect(() => validateDraftUrl('https://example.com/draft.json')).toThrow(
      'Draft session URL must be same-origin: https://example.com/draft.json',
    )
    expect(() => validateDraftUrl('/session-drafts/sample-draft.txt')).toThrow(
      'Draft session URL must point to a JSON file: /session-drafts/sample-draft.txt',
    )
  })

  test('draft parser backfills collaboration metadata for older turns and preserves origin', () => {
    const legacy = parseDraftSession(
      {
        contestants: sampleSessionDraft.contestants,
        turns: [
          {
            id: 'legacy-jade-foundation',
            turnIndex: 0,
            contestantId: 'jade',
            phase: 'foundation',
            promptSummary: 'legacy prompt',
            strategySummary: 'legacy strategy',
            sourceFragments: ['legacy fragment'],
            shapeLanguage: 'legacy shape',
            coverage: 12,
            ops: [{ x: 1, y: 2, color: 3 }],
          },
        ],
        meta: {
          providerId: 'draft',
          providerLabel: 'Legacy Draft',
          mode: 'draft',
          origin: {
            providerId: 'static-ingest',
            providerLabel: 'Static Ingest Provider',
            mode: 'static-ingest',
            sourceLabel: '/contestant-rosters/sample-roster.json',
          },
        },
      },
      '/session-drafts/legacy.json',
    )

    expect(legacy.turns[0]).toMatchObject({
      collaborationRole: 'introduce',
      focusArea: '中区核心',
      changedPixelCount: 1,
    })
    expect(legacy.meta.origin?.providerId).toBe('static-ingest')
  })

  test('generated draft exports preserve first origin provenance', () => {
    const session = buildSession(contestants, {
      providerId: 'static-ingest',
      providerLabel: 'Static Ingest Provider',
      mode: 'static-ingest',
      sourceLabel: '/contestant-rosters/sample-roster.json',
    })

    const exported = buildDraftExportSession(
      session,
      '/session-drafts/generated/2026-04-01-static.json',
    )

    expect(exported.meta).toEqual({
      providerId: 'draft',
      providerLabel: GENERATED_DRAFT_PROVIDER_LABEL,
      mode: 'draft',
      sourceLabel: '/session-drafts/generated/2026-04-01-static.json',
      origin: {
        providerId: 'static-ingest',
        providerLabel: 'Static Ingest Provider',
        mode: 'static-ingest',
        sourceLabel: '/contestant-rosters/sample-roster.json',
        runId: undefined,
      },
    })
  })

  test('generated draft save validates filenames and returns same-origin draft urls', async () => {
    expect(validateGeneratedDraftFilename('2026-04-01-static.json')).toBe('2026-04-01-static.json')
    expect(buildGeneratedDraftUrl('2026-04-01-static.json')).toBe(
      '/session-drafts/generated/2026-04-01-static.json',
    )
    expect(() => validateGeneratedDraftFilename('../escape.json')).toThrow(
      'Draft filename must not contain path separators: ../escape.json',
    )

    const session = buildSession(contestants)
    const fetchMock: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          draftUrl: '/session-drafts/generated/2026-04-01-static.json',
          filePath: '/tmp/generated/2026-04-01-static.json',
        }),
      }) as Response

    await expect(saveGeneratedDraft(session, fetchMock, '2026-04-01-static.json')).resolves.toBe(
      '/session-drafts/generated/2026-04-01-static.json',
    )
  })

  test('local openclaw provider still consumes bridge responses as a legacy path', async () => {
    const originalFetch = globalThis.fetch
    const bridgeContestants = contestants.map((contestant, index) => ({
      ...contestant,
      poem: `OpenClaw poem ${index}`,
      drawingPrompt: `OpenClaw drawing prompt ${index}`,
      strategyHint: `OpenClaw strategy hint ${index}`,
    }))
    const runIds: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(LOCAL_OPENCLAW_TEXTS_ENDPOINT)
      const body = JSON.parse(String(init?.body)) as { runId?: string }
      expect(body.runId).toBeTruthy()
      runIds.push(body.runId ?? '')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          contestants: bridgeContestants,
          meta: {
            providerId: 'local-openclaw',
            providerLabel: 'Local OpenClaw Provider',
            mode: 'local-openclaw',
            sourceLabel: 'openclaw CLI -> gateway@127.0.0.1:18789 -> deepseek/deepseek-chat',
            runId: body.runId,
          },
        }),
      } as Response
    }) as typeof fetch

    try {
      const first = await localOpenClawSessionProvider.generateSession(staticContestants)
      const second = await localOpenClawSessionProvider.generateSession(staticContestants)

      expect(first.meta.providerId).toBe('local-openclaw')
      expect(first.meta.runId).toBeTruthy()
      expect(second.meta.runId).toBeTruthy()
      expect(first.meta.runId).not.toBe(second.meta.runId)
      expect(first.turns).toHaveLength(staticContestants.length * 2)
      expect(runIds).toHaveLength(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('builds local openclaw bridge requests and parses cli envelopes', () => {
    const request = buildLocalOpenClawRequest(staticContestants, CANVAS_SIZE, ['foundation', 'detail'], 'run-123')
    expect(request.canvasSize).toBe(CANVAS_SIZE)
    expect(request.phases).toEqual(['foundation', 'detail'])
    expect(request.runId).toBe('run-123')

    const okResult = parseOpenClawCliResult(
      JSON.stringify({
        result: {
          payloads: [
            {
              text: JSON.stringify({
                poem: 'bridge poem',
                drawingPrompt: 'bridge prompt',
                strategyHint: 'bridge hint',
              }),
              mediaUrl: null,
            },
          ],
          meta: { agentMeta: { provider: 'deepseek', model: 'deepseek-chat' } },
        },
      }),
      'contestant-01',
    )
    expect(okResult.ok).toBe(true)
    if (okResult.ok) {
      expect(okResult.providerSummary).toBe('deepseek/deepseek-chat')
    }
  })

  test('normalizes local openclaw run ids and separates cli failure classes', () => {
    expect(resolveLocalOpenClawRunId('  run-fixed  ')).toBe('run-fixed')
    expect(resolveLocalOpenClawRunId('   ')).toMatch(/^run-|^[0-9a-f-]{36}$/)
    expect(buildLocalOpenClawSessionId('run-fixed', 'contestant-01')).toBe(
      'art-cooperation-run-fixed-contestant-01',
    )

    const failed = parseOpenClawCliResult(
      JSON.stringify({
        result: {
          payloads: [
            {
              text: '400 event:error\ndata:{"code":"400","message":"Transient upstream failure"}',
              mediaUrl: null,
            },
          ],
          stopReason: 'error',
        },
      }),
      'contestant-01',
    )
    expect(failed).toEqual({
      ok: false,
      code: 'upstream_error',
      message: 'OpenClaw agent contestant-01 failed: 400 event:error\ndata:{"code":"400","message":"Transient upstream failure"}',
    })
  })
})
