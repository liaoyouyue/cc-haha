# Token Intelligence — Phase A 交付报告

Phase A 已完成。本文是交付清单，含口径说明、验证结果、已知限制与回滚方案。

## 1. 分支与提交

| 项 | 值 |
|---|---|
| 工作区 | `C:\Users\Administrator\cc-haha-ti`（独立 git worktree） |
| 分支 | `feat/token-intelligence` |
| 基线 | tag `patched-v0.7.1` = `55ecdc25`（含 4 个私有补丁） |
| 提交 | `5115afa6` Token Intelligence Phase A；`f2d9d7e0` 会话归集修正 |
| 规模 | 13 文件，+2278 / −153 |

**隔离情况**

- 生产版 `C:\Users\Administrator\AppData\Local\Programs\Claude Code Haha`（v0.7.1）**未改动**，未部署、未覆盖。
- Visual Guard 分支 `vg-visual-guard-dev`（worktree `D:\cchh-vg-dev`）**未触碰**；本分支从 `patched-v0.7.1` 切出，与之无共同提交。
- 4 个私有补丁全部保留（基线即含）。

**修改文件清单**

| 文件 | 改动 |
|---|---|
| `src/server/services/localIndex/activityIndex.ts` | 新增 3 个只读聚合：`aggregateDailyModelUsage` / `aggregateProjectUsage` / `aggregateSessionUsage` + 对应类型 |
| `src/server/services/localIndex/coordinator.ts` | 暴露 `getProjectUsage` / `getSessionUsage` / `getDailyModelUsage`，并补 `projectNameFor` 显示名 |
| `src/server/services/localIndex/sessionIndex.ts` | `LocalIndexGateway` 增加 3 个可选方法（返回 null 表示"答不了"） |
| `src/server/api/activityStats.ts` | 响应追加 `dailyModelUsage` / `projectUsage` / `sessionUsage` 三个同级字段 |
| `src/server/services/localIndex/activityIndex.test.ts` | 新增，7 条断言 |
| `desktop/src/api/activityStats.ts` | 对应类型 + 归一化（旧 sidecar 缺字段等同于 null） |
| `desktop/src/pages/ActivitySettings.tsx` | 五视图重写（+972 行） |
| `desktop/src/pages/ActivitySettings.test.tsx` | 测试对齐新页面（16 条） |
| `desktop/src/i18n/locales/{en,zh,zh-TW,jp,kr}.ts` | 各 +68 词条 |

**未改**：SQLite 表结构、migration、JSONL 原始会话、`stats-cache.json` v7 格式、sidecar、模型通信、MCP、历史会话存储。

## 2. 运行截图

`C:\Users\Administrator\ti-shot\`

| 文件 | 视图 |
|---|---|
| `view-1-overview.png` | 总览中心 |
| `view-2-models.png` | 模型成本 |
| `view-3-projects.png` | 项目会话 |
| `view-4-tools.png` | Agent 工具 |
| `view-5-diagnostics.png` | 诊断中心 |

**截图方式（如实说明）**：真实组件 + 真实 API 模块，数据来自本机索引的只读快照，跑在 Vite dev 入口里。**不是**运行在完整 Electron 外壳内 —— 完整外壳启动需要整套真实 sidecar（健康检查、workspace 引导等），在浏览器里无法满足，用 mock 补齐是不划算的。取图用的一次性脚手架（预览入口 + 快照脚本 + mock）已全部删除，未进入提交。

## 3. 统计口径

### Token 四维
沿用上游既有定义（红线：不改现有口径）。四维**互不重叠**，直接相加即为总量：

```
totalTokens = input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

`cache_creation` 优先取 5m/1h 拆分之和，缺失时回落到 `cache_creation_input_tokens`。

### 缓存命中率
```
cacheHitRate = cache_read / (input + cache_read + cache_write)
```
分母是"提示侧全部 token"，与本仓库 `sessionUsageMetrics.ts` 的口径一致。0% 显示为 "0%"，绝不上取整成 100%。

### 估算成本
`cost_usd` 由上游按模型费率表前缀最长匹配得出。无公开费率的模型 `cost_usd = 0` 且进 `unpricedModels`。UI 规则：**这类模型成本列显示 `—`，绝不显示 `$0.00`**；成本卡另附"不含 N 个未计价模型"。本机实测 18 个模型中 15 个未计价（全部来自第三方免费 provider），成本卡因此显示 `US$0.00` 并明确标注。

### 有效使用时长
按会话累加 `active_duration_ms`。该字段以 30 分钟间隔截断，夜间空档不计入 —— 所以它是"工作时长"，不是日历跨度。缺主会话记录的会话**不参与**该合计，并标注"未采集"。

### 活跃率
沿用上游 `activeDays / totalDays`，分母是首末会话的 UTC 日历日跨度。**本机真实数据暴露该口径异常：activeDays = 21，totalDays = 1，页面显示 2,100%。** 我按红线没有改这个统计，而是：① 详情行同时显示 `1 天中活跃 21 天` 让分子分母都可见；② 诊断中心把 `活跃天数大于总天数` 列为"需检查"。这是诊断功能抓到的真实问题，不是页面 bug。

### 三个口径必须互相印证
模型、项目、会话三个维度的 token 合计**必须完全相等**。这是"四维不重复计算"的可执行判据，已写成测试断言，并在本机真实索引上复核：

```
all  daily=2448242698 project=2448242698 session=2448242698 equal=true  sessions=65 subagentOnly=45
30d  daily=2448242698 project=2448242698 session=2448242698 equal=true  sessions=65 subagentOnly=45
7d   daily=1652069300 project=1652069300 session=1652069300 equal=true  sessions=29 subagentOnly=9
```

诊断中心的"每日汇总与总计不一致"检查在真实数据上**没有触发**，同样是这个结论的证据。

### 会话归集口径
按 `parent_session_id` 归集，子代理转录并入父会话。**修正前**按主转录分组，导致只存在于子代理转录的会话被整体丢弃 —— 本机 65 个父会话中有 45 个如此，持有 94% 的 token（22.52 亿 / 23.96 亿），会话榜看着完整实则漏掉绝大部分花销，三个口径相差 16 倍。修正后三口径一致。

无主转录的会话 `hasMainSession = false`：token 计入，但时长/消息数从未记录，UI 显示"未采集"而**不是** `0m`。会话榜顶部同时声明 `区间内共 N 个会话`，并说明其中 M 个仅有子代理记录 —— 总览的"会话总数"只统计主转录，两个数字口径不同，必须讲清楚而不是让它们看起来自相矛盾。

### 时间区间
区间筛选（全部 / 近 30 天 / 近 7 天）在**浏览器内**对一次拉取的每日明细做裁剪，切换区间**不发请求**。实测：连点 5 次区间切换，服务端请求数 8 → 8 未变。拉取仍是挂载时一次 `range=all`，因为热力图需要 52 周数据。

### 未采集项（明确标注，不做估算）
| 项 | 状态 | 原因 |
|---|---|---|
| 工具调用耗时 | 未采集 | 索引未存每次调用的起止时间 |
| 工具失败率 | 未采集 | 索引未存每次调用的结果状态 |
| 无主转录会话的时长/消息数 | 未采集 | 上游从未写入 |

### 降级规则
`projectUsage` / `sessionUsage` 为 `null` 表示本地索引答不了（关闭、仍在建、或回退到 JSONL 扫描路径 —— 该路径没有项目/会话粒度）。此时页面显示明确的不可用说明，**不显示空表，也不显示 0**。

## 4. 构建、测试与回归

**构建**：`desktop: bun run build` 通过（tsc -b + vite build）；`bun run lint`（eslint + tsc --noEmit）通过。

**测试**：

| 套件 | 结果 |
|---|---|
| `ActivitySettings.test.tsx` | 16 / 16 |
| `src/i18n` + `Settings` 设置区 + `src/__tests__/pages` | 108 / 108 |
| `activityIndex.test.ts`（新增） | 7 / 7 |
| `coordinator.test.ts` + `local-index-activity-parity.test.ts` + `activityIndex.test.ts` | 75 通过 / 2 失败 |

**2 个失败与基线完全一致**（`converges external append…`、`finds workflow agent transcripts…`），在纯基线上同样失败，属既有问题。

**基线对照中发现的两处既有失败**（非本次引入，两边数字相同）：
- `src/pages/ActivitySettings.test.tsx` 基线即 6 失败 / 5 通过 —— 私有补丁把 `formatTokens` 改成万/亿，上游测试仍断言 `2.9M`。本次已把断言对齐实际行为，现为 16/16。
- `componentReachability.test.ts` + `diagnosticsSettings.test.tsx` 基线 4 失败 / 25 通过（Windows 路径分隔符），本分支同样 4 / 25。

**未作为信号的一次尝试**：广域扫描 `src/server/services/localIndex` + `src/server/__tests__` 在本机不稳定 —— bun 会 segfault、缺 adapter 依赖（`@whiskeysockets/baileys`）、临时目录争用，两次运行的失败集合互不相同（97 vs 11）。这不是有效回归信号，故未采纳，改用上表的定向套件。

**与生产版一致性**：新页面读取的是同一份索引、同一套聚合函数，总览与模型数字与原页一致（`modelUsage` 未改）；仅**新增**项目/会话维度与四维明细表。

## 5. 已知限制与 Phase B 待办

**Phase A 限制**

1. 项目/会话/区间筛选依赖本地索引。`CC_HAHA_LOCAL_INDEX=off` 或索引仍在构建时，这三个视图显示不可用说明（不伪造数据）。
2. 会话榜上限 500 条（服务端），展示前 20 条（客户端），榜单顶部声明了总数。
3. 工具调用排行是**全时段**聚合 —— 上游 `toolUsage` 没有日期粒度，所以该视图**故意不提供**区间控件，避免给出一个不生效的开关。
4. 项目列的"会话日"是按天去重的累加，跨零点的会话会落在两天；与"会话总数"不是一个东西，列名已按此命名。
5. `activeDays / totalDays` 的口径异常（本机 21 / 1）只做**标注**，未修正 —— 属既有统计口径，改动需单独评审。
6. 截图不在完整 Electron 外壳内（见 §2 说明）。

**Phase B 待办**（本次一律未做）

1. 每次工具调用的耗时与结果 → 新增索引字段 + migration + 一次性重建，之后"工具耗时/失败率"两个格子才能填上。
2. 修正 `totalDays` 计算（活跃率异常根因）。
3. 会话跨零点归因：把会话归到单一日期，让"会话日"能被"会话数"替代。
4. 项目表加入每项目未计价占比（当前成本列留空，无法区分"无花销"与"无费率"）。
5. 增量刷新：页面目前挂载时全量拉取一次，数据量大时考虑 SSE 或轮询。

## 6. 回滚方案

改动全部在 `feat/token-intelligence` 分支，未合并、未推送、未部署。回滚任选其一：

```bash
# A. 丢弃整条分支（推荐）
cd C:/Users/Administrator/cc-haha-pr
git worktree remove C:/Users/Administrator/cc-haha-ti --force
git branch -D feat/token-intelligence

# B. 只回退到基线，保留分支供检查
cd C:/Users/Administrator/cc-haha-ti
git reset --hard 55ecdc25        # 丢弃全部 Phase A 改动
git reset --hard f2d9d7e0~1      # 或只丢弃会话归集修正，保留其余
```

生产版从未被本次改动触及，因此**无需任何生产侧回滚动作**。

若要单独摘掉某个视图，`ActivitySettings.tsx` 中五个视图互相独立，删除对应的 `{activeView === '...' && (...)}` 块并把该选项从 `viewOptions` 移除即可；服务端三个新聚合是纯新增方法，不删也不影响原有路径。

---

## 附：字段映射（CCHH ↔ WorkDaddy）

WorkDaddy 是 **AGPL-3.0-or-later**，CCHH 是 **MIT**。AGPL 有传染性，**WorkDaddy 源码一行都不能复制**。本实现只借了信息架构与视觉语言（思路不受版权保护），代码全部独立编写。

两套数据模型本就不同 —— WorkDaddy 通过 CDP 注入 WorkBuddy 桌面端、读的是它的积分/账号接口；CCHH 读 Claude Code transcript。所谓"映射"只是视图层面的对应：

| WorkDaddy 视图 | CCHH Phase A 对应 | CCHH 数据来源 |
|---|---|---|
| 时间筛选药丸（今天/7天/30天/90天） | 区间切换（全部/近30天/近7天） | 客户端裁剪 `dailyModelUsage` |
| 数字卡（积分消耗 / 调用次数） | 总览 KPI 卡（累计/峰值/最长任务/连续天数） | `dailyModelTokens`、`longestSession`、`streaks` |
| 每日趋势折线（带渐变） | 按天 Token 柱状 + 52 周热力图 | `dailyModelTokens`、`dailyActivity` |
| 账号用量榜单 | 模型榜 / 项目榜 / 会话榜 | `modelUsage`、`projectUsage`、`sessionUsage` |
| 积分（credits） | 估算成本（USD） | `cost_usd` + `unpricedModels` |
| —（无对应） | 四维 Token 明细表 | `activity_daily_models` 四列 |
| —（无对应） | Agent 工具 / 诊断中心 | `toolUsage`、`skillUsage`、交叉校验 |

**视觉**：CCHH 原有暖色系与字体体系保留（`--color-*` 变量、`SettingsSection` / `Card` 组件），只借用 WorkDaddy 的克制感 —— 分段药丸控件、圆角细边卡片、单一强调色、右对齐数值列。
