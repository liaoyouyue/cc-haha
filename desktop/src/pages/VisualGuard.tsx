import { useEffect, useMemo, useState } from 'react'
import {
  visualGuardApi,
  type VisualGuardConfig,
  type VisualGuardProvider,
  type VisualGuardStatus,
  type VisualGuardWindow,
} from '../api/visualGuard'

const button = 'rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'

export function VisualGuard() {
  const [status, setStatus] = useState<VisualGuardStatus | null>(null)
  const [config, setConfig] = useState<VisualGuardConfig | null>(null)
  const [windows, setWindows] = useState<VisualGuardWindow[]>([])
  const [providers, setProviders] = useState<VisualGuardProvider[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === config?.providerId),
    [config?.providerId, providers],
  )

  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
      const next = await visualGuardApi.status()
      setStatus(next)
      if (next.draft) setDraft(next.draft)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    }
  }

  // Selections here are the service's own config, so they persist on change.
  // Saving only on 开始 left a picked provider vulnerable to the next status
  // refresh, which echoes the server's (still empty) config back.
  const updateConfig = (patch: Partial<VisualGuardConfig>) => {
    setConfig(current => (current ? { ...current, ...patch } : current))
    void visualGuardApi.saveConfig(patch).catch(value =>
      setError(value instanceof Error ? value.message : String(value)),
    )
  }

  useEffect(() => {
    void Promise.all([visualGuardApi.status(), visualGuardApi.providers()])
      .then(([next, providerResult]) => {
        setStatus(next)
        setConfig(next.config)
        setDraft(next.draft)
        setProviders(providerResult.providers)
        if (!next.config.providerId && providerResult.activeId) {
          const active = providerResult.providers.find(provider => provider.id === providerResult.activeId)
          if (active) setConfig({ ...next.config, providerId: active.id, model: active.models[0] ?? '' })
        }
      })
      .catch(value => setError(value instanceof Error ? value.message : String(value)))
  }, [])

  useEffect(() => {
    if (!status || status.state === 'stopped') return
    const timer = window.setInterval(() => {
      void visualGuardApi.status().then(next => {
        setStatus(next)
        if (next.draft && next.draft !== status.draft) setDraft(next.draft)
      }).catch(() => {})
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [status?.state, status?.draft])

  if (!config || !status) return <div className="p-6 text-sm text-muted-foreground">正在加载 AI 视觉值守…</div>

  const save = () => visualGuardApi.saveConfig(config)
  const refreshWindows = () => run(async () => setWindows((await visualGuardApi.windows()).windows))
  const selectWindow = (hwnd: number) => {
    const target = windows.find(item => item.hwnd === hwnd)
    updateConfig({ hwnd, region: target ? [0, 0, target.rect[2], target.rect[3]] : config.region })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">AI 视觉值守</h1>
        <p className="mt-1 text-sm text-muted-foreground">截图只在本机 OCR；仅对话文字经所选 CCHH 模型供应商生成草稿。不会自动发送。</p>
      </header>

      {error && <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-4 overflow-auto p-6">
        <div className="space-y-4">
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between"><h2 className="font-medium">目标窗口</h2><button className={button} onClick={refreshWindows}>刷新</button></div>
            <select className={field} value={config.hwnd ?? ''} onChange={event => selectWindow(Number(event.target.value))}>
              <option value="">请选择窗口</option>
              {windows.map(item => <option key={item.hwnd} value={item.hwnd}>{item.title}</option>)}
            </select>
            <div className="text-xs text-muted-foreground">消息区：{config.region?.join(', ') ?? '尚未设置'}</div>
            <button className={button} disabled={!config.hwnd} onClick={() => run(async () => {
              const result = await visualGuardApi.selectRegion()
              setConfig(current => (current ? { ...current, region: result.region } : current))
            })}>框选消息区</button>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <h2 className="font-medium">模型与轮询</h2>
            <select className={field} value={config.providerId} onChange={event => {
              const provider = providers.find(item => item.id === event.target.value)
              updateConfig({ providerId: event.target.value, model: provider?.models[0] ?? '' })
            }}>
              <option value="">请选择供应商</option>
              {providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select className={field} value={config.model} onChange={event => updateConfig({ model: event.target.value })}>
              <option value="">请选择模型</option>
              {(selectedProvider?.models ?? []).map(model => <option key={model} value={model}>{model}</option>)}
            </select>
            <input className={field} type="number" min={1} max={3600} value={config.interval} onChange={event => updateConfig({ interval: Number(event.target.value) })} aria-label="轮询秒数" />
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between"><h2 className="font-medium">状态</h2><span className="text-sm">{status.state} {status.workerPid ? `(PID ${status.workerPid})` : ''}</span></div>
            <div className="flex flex-wrap gap-2">
              <button className={button} disabled={status.state === 'running' || status.state === 'paused'} onClick={() => run(async () => { await save(); await visualGuardApi.start() })}>开始</button>
              <button className={button} disabled={status.state !== 'running'} onClick={() => run(visualGuardApi.pause)}>暂停</button>
              <button className={button} disabled={status.state !== 'paused'} onClick={() => run(visualGuardApi.resume)}>恢复</button>
              <button className={button} disabled={status.state === 'stopped'} onClick={() => run(visualGuardApi.stop)}>停止</button>
              <button className={button} disabled={!config.hwnd} onClick={() => run(visualGuardApi.recognize)}>识别一次</button>
            </div>
          </section>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(180px,1fr)] gap-4">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">识别预览</h2>
            <pre className="min-h-24 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{status.transcript || '等待识别…'}</pre>
          </section>

          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="font-medium">AI 回复草稿（人工审核）</h2>
            <textarea className={`${field} min-h-28 resize-y`} value={draft} onChange={event => setDraft(event.target.value)} placeholder="等待模型生成草稿…" />
            <div className="flex gap-2">
              <button className={button} disabled={!draft.trim()} onClick={() => run(() => visualGuardApi.review(draft))}>保存审核</button>
              <button className={button} disabled={!draft.trim()} onClick={() => navigator.clipboard.writeText(draft)}>复制草稿</button>
            </div>
          </section>

          <section className="grid min-h-0 grid-cols-2 gap-4 rounded-lg border border-border p-4">
            <div className="space-y-2 overflow-auto">
              <h2 className="font-medium">知识库 / SOP</h2>
              <textarea className={`${field} min-h-20`} value={config.company} onChange={event => setConfig({ ...config, company: event.target.value })} placeholder="公司介绍、服务范围、报价规则" />
              <input className={field} value={config.style} onChange={event => setConfig({ ...config, style: event.target.value })} placeholder="回复风格" />
              <input className={field} value={config.banned} onChange={event => setConfig({ ...config, banned: event.target.value })} placeholder="禁用词，逗号分隔" />
              <textarea className={`${field} min-h-20`} value={config.sop} onChange={event => setConfig({ ...config, sop: event.target.value })} placeholder="SOP 规则" />
              <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={event => {
                const file = event.target.files?.[0]
                if (file) void file.text().then(text => setConfig({ ...config, knowledge: text.slice(0, 200_000) }))
              }} />
              <textarea className={`${field} min-h-28`} value={config.knowledge} onChange={event => setConfig({ ...config, knowledge: event.target.value })} placeholder="导入或粘贴知识资料" />
              <button className={button} onClick={() => run(save)}>保存知识设置</button>
            </div>
            <div className="min-h-0 overflow-auto">
              <h2 className="mb-2 font-medium">运行日志</h2>
              <pre className="h-full min-h-56 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{status.logs.join('\n') || '暂无日志'}</pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
