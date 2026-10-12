## 问题描述

Token 用量的数字格式化目前有两套独立实现，导致同一个数字在不同页面显示不一致；同时单位没有跟随语言设置。

### 问题 1：同一个 token 数在两个页面显示不一样

`desktop/src/lib/formatTokenCount.ts`（聊天页头、流式指示器、压缩摘要、后台任务、轨迹视图共用）：

```ts
export function formatTokenCount(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '--'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
```

`desktop/src/pages/ActivitySettings.tsx:130`（设置 → Token 用量页）另有一份：

```ts
function formatTokens(tokens: number) {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(tokens >= 10_000_000_000 ? 0 : 1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}
```

两者对同一输入的输出：

| tokens | `formatTokenCount`（聊天/轨迹） | `formatTokens`（设置页） |
|---|---|---|
| 847 | `847` | `847` |
| 1_200 | `1.2k` | `1K` |
| 1_500 | `1.5k` | `2K` |
| 1_200_000 | `1.2M` | `1.2M` |
| 2_000_000 | `2M` | `2.0M` |
| 1_500_000_000 | `1500M` | `1.5B` |
| 20_000_000_000 | `20000M` | `20B` |

差异来源：

1. **`formatTokenCount` 没有 B（十亿）分支**，超过 10 亿直接显示 `1500M` / `20000M`。
2. **千位取整方式不同**：`formatTokenCount` 用 `toFixed(1)`（1_500 → `1.5k`），`formatTokens` 用 `Math.round`（1_500 → `2K`）。
3. **`.0` 处理不同**：`formatTokenCount` 会 `replace(/\.0$/, '')`，设置页不会（2_000_000 → `2.0M` vs `2M`）。

`formatTokenCount.ts` 的文件头注释写着这个函数是 "shared by ... so every surface renders token usage with one notation"，但设置页另起了一份，所以「一套记号」的目标在设置页这边没达成。

看起来把设置页也切到 `formatTokenCount` 就能统一，顺便把 B 的缺口一起补上。具体怎么改听作者的。

### 问题 2：Token 数字格式不跟随语言设置

`desktop/src/i18n/locale.ts` 里 `Locale = 'en' | 'zh' | 'zh-TW' | 'jp' | 'kr'`，而且同一个 `ActivitySettings.tsx` 里的 `formatInteger`、`formatPercent` 都接收 `locale` 参数并用 `DATE_LOCALES[locale]` 走 `Intl.NumberFormat`，唯独 `formatTokens` 不接 locale，硬编码 K/M/B。

对中文用户来说 `3.70B` 不如 `3.70亿` 直观。想问一下：

- 有没有可能做成**跟随 locale 自动切换**（zh / zh-TW 用万、亿，其余保持 K/M/B）？
- 或者在设置里加一个「数字单位」选项（`K/M/B` ↔ `万/亿`）？

我们本地是自己改了打包产物才实现的，升级就会被覆盖。如果能加进设置，就不用每次升级都重打补丁了。

## 使用环境

- 使用方式: 桌面端
- 操作系统: Windows
- 系统版本: Windows 11
- 桌面端版本: v0.6.8

代码是在 `main`（`1c781545`）上确认的，两处都还在。

## 补充说明

我们本地目前是自己改打包产物把 Token 单位改成「万/亿」的，升级后需要重新打补丁。如果问题 2 能做成设置项，我们就把本地补丁撤掉；如果作者觉得没必要，我们继续自己打也无所谓。

问题 1 如果确认是笔误，我们也可以帮忙补个对照测试（比如把 `formatTokenCount` 的用例扩到十亿量级，顺便覆盖设置页那条路径）。