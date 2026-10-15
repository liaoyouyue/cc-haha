import { useEffect, useState } from 'react'
import {
  visualGuardApi,
  type VisualGuardConfig,
  type VisualGuardLine,
  type VisualGuardStatus,
  type VisualGuardWindow,
} from '../api/visualGuard'

const button = 'rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'

export function VisualGuard() {
  const [status, setStatus] = useState<VisualGuardStatus | null>(null)
  const [config, setConfig] = useState<VisualGuardConfig | null>(null)
  const [windows, setWindows] = useState<VisualGuardWindow[]>([])
  const [lines, setLines] = useState<VisualGuardLine[]>([])
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<VisualGuardLine[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
      setStatus(await visualGuardApi.status())
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    }
  }

  const updateConfig = (patch: VisualGuardConfig) => {
    setConfig(current => (current ? { ...current, ...patch } : current))
    void visualGuardApi.saveConfig(patch).catch(value =>
      setError(value instanceof Error ? value.message : String(value)),
    )
  }

  useEffect(() => {
    void Promise.all([visualGuardApi.status(), visualGuardApi.config()])
      .then(([nextStatus, nextConfig]) => {
        setStatus(nextStatus)
        setConfig(nextConfig)
      })
      .catch(value => setError(value instanceof Error ? value.message : String(value)))
  }, [])

  if (!config || !status) return <div className="p-6 text-sm text-muted-foreground">正在加载…</div>

  const capture = (action: () => Promise<unknown>) => run(async () => {
    // Clicking here put CCHH in front, so the worker waits for the target to
    // come back rather than the guard being relaxed for the interactive case.
    setNotice('正在读取目标窗口；若非前台请切过去（最多 15 秒）…')
    try {
      await action()
    } finally {
      setNotice('')
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">真实之眼</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把窗口读成带坐标的文字：没有视觉能力的模型也能"看见"，按文字定位不用猜像素。只读，不会点击、输入或抢焦点。
        </p>
      </header>

      {error && <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {notice && <div className="mx-6 mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">{notice}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-4 overflow-auto p-6">
        <div className="space-y-4">
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">目标窗口</h2>
              <button className={button} onClick={() => run(async () => setWindows((await visualGuardApi.windows()).windows))}>刷新</button>
            </div>
            <select className={field} value={config.hwnd ?? ''} onChange={event => {
              const target = windows.find(item => item.hwnd === Number(event.target.value))
              updateConfig({ hwnd: Number(event.target.value), region: target ? [0, 0, target.rect[2], target.rect[3]] : config.region })
            }}>
              <option value="">请选择窗口</option>
              {windows.map(item => <option key={item.hwnd} value={item.hwnd}>{item.title}</option>)}
            </select>
            <div className="text-xs text-muted-foreground">读取区域：{config.region?.join(', ') ?? '尚未设置'}</div>
            <div className="flex flex-wrap gap-2">
              <button className={button} disabled={!config.hwnd} onClick={() => run(async () => {
                const result = await visualGuardApi.selectRegion()
                setConfig(current => (current ? { ...current, region: result.region } : current))
              })}>框选区域</button>
              <button className={button} disabled={!config.hwnd} onClick={() => capture(async () => {
                const sight = await visualGuardApi.see()
                setLines(sight.lines)
                setText(sight.text)
                setMatches([])
              })}>看一次</button>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <h2 className="font-medium">找文字</h2>
            <input className={field} value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：发送" />
            <button className={button} disabled={!config.hwnd || !query.trim()} onClick={() => capture(async () => {
              const result = await visualGuardApi.find(query.trim())
              setLines(result.matches)
              setMatches(result.matches)
            })}>定位</button>
            <p className="text-xs text-muted-foreground">返回匹配文字的屏幕坐标，可直接用于点击。</p>
          </section>

          <section className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">状态</span>
              <span className="text-muted-foreground">{status.workerPid ? `worker PID ${status.workerPid}` : 'worker 未启动'}</span>
            </div>
          </section>
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(200px,1fr)_minmax(180px,1fr)] gap-4">
          <section className="flex min-h-0 flex-col rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">读到的文字{matches.length ? `（匹配 ${matches.length} 处）` : ''}</h2>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{text || '尚未读取'}</pre>
          </section>

          <section className="flex min-h-0 flex-col rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">文字与坐标</h2>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="py-1">文字</th><th>屏幕坐标</th><th>置信度</th></tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.text}-${index}`} className="border-t border-border">
                      <td className="py-1 pr-3">{line.text}</td>
                      <td className="pr-3 font-mono">{line.center[0]}, {line.center[1]}</td>
                      <td>{line.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!lines.length && <p className="text-sm text-muted-foreground">尚无结果</p>}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">运行日志</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{status.logs.join('\n') || '暂无日志'}</pre>
            </details>
          </section>
        </div>
      </div>
    </div>
  )
}
