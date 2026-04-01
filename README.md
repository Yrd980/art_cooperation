# Art Cooperation

一个前端 Web MVP：任意数量的静态接入选手以人格提示和诗句作为输入，由仓库内部的 deterministic pipeline 推导出绘画提示、策略说明和逐回合像素操作，并按顺序把这些文本折叠成同一张共享像素画。

## MVP 内容

- 任意数量的静态选手输入，最小字段为 `id / name / personaPrompt / poem`
- 会话通过 provider 生成，当前主路径支持 `static-ingest`，并保留 `local-deterministic`、`draft` 和 legacy `local-openclaw`
- `static-ingest` 支持通过 `rosterUrl` 载入同源 JSON roster
- `draft` provider 支持内置 sample fallback，也支持通过 `draftUrl` 载入同源 JSON draft
- 开发模式下可把当前生成出的 session 保存到 `public/session-drafts/generated/`，再通过 `draftUrl` 直接重开
- `local-openclaw` provider 作为 legacy dev path 保留，通过本机开发桥接层调用你电脑上的 OpenClaw
- 32 x 32 像素画布，16 色调色板
- 默认每位 2 回合，分为铺底和细化；总回合数随接入人数变化
- 每回合包含策略说明、来源文本片段和像素操作，支持回放解释
- 自动播放、暂停/恢复、单步推进、重播
- 右侧日志显示当前回合和像素动作数
- 可通过查询参数切换 provider，例如 `/?provider=static-ingest`
- 静态 roster 示例：`/?provider=static-ingest&rosterUrl=/contestant-rosters/sample-roster.json`
- 外部 draft 示例：`/?provider=draft&draftUrl=/session-drafts/sample-draft.json`
- 保存后的 generated draft 示例：`/?provider=draft&draftUrl=/session-drafts/generated/<filename>.json`
- 本机 OpenClaw 示例：`/?provider=local-openclaw`

## 技术栈

- Vite
- React 19
- TypeScript
- Vitest

## 开发

```bash
pnpm install
pnpm dev
```

开发模式下，页面会额外出现“保存为 draft”按钮：

- 当前 session 会写成同源 JSON 到 `public/session-drafts/generated/`
- draft 顶层 `meta` 会改写为 `draft` provider
- 原始 provider 信息会保留在 `meta.origin`
- 保存后可以直接用返回的 `/?provider=draft&draftUrl=...` 链接重开回放

静态 ingest 的 roster JSON 建议格式：

```json
{
  "contestants": [
    {
      "id": "jade",
      "name": "Jade Current",
      "personaPrompt": "沉静、铺陈、像在为画面留出呼吸的古典叙事者",
      "poem": "苔色沿着河岸慢慢亮起\n一只纸舟把黄昏推得更远\n水面替所有迟到的词留了空位"
    }
  ]
}
```

## 验证

```bash
pnpm test
pnpm build
pnpm lint
```

## 后续扩展

- 继续增强静态 ingest 后的多人协作式绘制规则
- 让共享画布状态对后续选手的构图决策产生更强影响
- 保存作品和回合日志，支持多次共创回放
