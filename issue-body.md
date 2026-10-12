## 问题描述

插件市场相关的两个问题，一个确定是 bug，一个可能是设计取舍，想请教一下是否有意为之。

### 问题 1：插件市场列表恒为空，计数恒为 0（确定是 bug）

`GET /api/plugins` 返回的 `marketplaces` 永远是 `[]`，`summary.marketplaceCount` 永远是 `0`，即使 `known_marketplaces.json` 里配置了市场。

**根因定位**：`src/server/services/pluginService.ts` 的 `collectPluginState()` 里：

```ts
const marketplaces = Object.entries(marketplaceConfig.marketplaces ?? {})
```

但 `loadKnownMarketplacesConfig()`（`src/utils/plugins/marketplaceManager.ts`）返回的类型是 `KnownMarketplacesConfig = KnownMarketplacesFile`，而 `KnownMarketplacesFileSchema`（`src/utils/plugins/schemas.ts`）是：

```ts
export const KnownMarketplacesFileSchema = lazySchema(() =>
  z.record(
    z.string(),              // 市场名作为 key
    KnownMarketplaceSchema(),
  ),
)
```

即一个**扁平的 `Record<市场名, 配置>`**，没有嵌套的 `marketplaces` 这一层。磁盘上的文件形状也是这样：

```json
{
  "haha-connectors": { "source": { "source": "directory", "path": "..." }, "installLocation": "...", "lastUpdated": "..." },
  "claude-code-skills": { "source": { "source": "github", "repo": "..." }, "installLocation": "...", "lastUpdated": "..." }
}
```

所以 `marketplaceConfig.marketplaces` 恒为 `undefined`，`?? {}` 兜底成空对象，`marketplaces` 必然是 `[]`，`installedCount` 也必然全是 0。

看起来去掉 `.marketplaces` 这一层读取就对了（`Object.entries(marketplaceConfig ?? {})`），不过具体怎么改听作者的。

**实测**（v0.6.8，Windows 11）：

```
GET /api/plugins
→ { "marketplaces": [], "summary": { ..., "marketplaceCount": 0 } }
```

配置文件里明明有 3 个市场。

**顺带一提**：`src/server/__tests__/plugins.test.ts` 里已有的用例其实写了扁平的 `known_marketplaces.json`（`treats enabledPlugins version constraint arrays as enabled plugins`），但只断言了 `plugins` 和 `summary.enabled`，没有断言 `marketplaces`，所以这个问题一直没被测试覆盖到。

### 问题 2：市场页「已安装」筛选漏翻页（想请教是否有意为之）

`listMarketSkills` 的 `market` scope 分支（`listLiveMarketSkills`）是**先分页、再过滤**：

```ts
merged = dedupeSkills(merged)
merged.sort((a, b) => b.stats.downloads - a.stats.downloads)
merged = await annotateInstallStates(merged.map(markCurated))

if (params.security && params.security !== 'all') { ... }
if (params.installed && params.installed !== 'all') {
  merged = merged.filter((item) => params.installed === 'installed' ? ... )
}
```

筛选只作用于**当前这一页**。所以本机已安装的 skill 如果不在首页，就会被过滤掉，返回一个空页；如果用户点了「已安装」筛选就停在第一页，看到的就是「一个已安装的都没有」，翻页也翻不出来。

而 `catalog` scope 分支（`listCatalogSkills`）是相反的顺序，注释里明确写了这个理由：

```
 * Everything is local, so every filter — security and installed included —
 * runs before pagination: a page is always full until the list is exhausted,
 * which keeps infinite scroll from stalling on a filtered-out page.
```

两个 scope 行为不一致。想确认一下：live market 分支这样写是有意为之（比如为了不拉全量数据），还是漏了？如果是有意的，那前端在筛选生效时是不是应该自动把分页拉到底，或者 UI 上给个提示？

现有的 `filters by installed state` 用例只覆盖了 `items[0]` 恰好落在首页的情况，也没有覆盖翻页场景。

## 使用环境

- 使用方式: 桌面端
- 操作系统: Windows
- 系统版本: Windows 11
- 桌面端版本: v0.6.8

代码位置是在 `main`（`1c781545`）上确认的，两处都还在。

## 补充说明

我们本地目前是自己打了个临时补丁绕过去的（读的时候少一层），升级就会被覆盖。如果这两个问题确实是 bug，我们愿意配合提供复现步骤和测试用例；如果问题 2 是有意设计，也麻烦说明一下，我们就不折腾了。