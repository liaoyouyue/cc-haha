# CCHH 用量统计去重修复 · 部署检查点

日期：2026-10-29
目标：把「全部时间」总用量从重复计算改为正确口径，并装进 CCHH。

## 决策（用户拍板）
- 历史数字不回溯，保持 109/112 亿。
- 只修「全部时间」路径；7 天 / 30 天 / 项目榜 / 会话榜（SQLite 索引路径）不修。
- 用户原话：「你全部弄好了再重启」——构建、打包、备份、替换全部完成后才能重启。

## 代码状态
- 提交 `135ab3ef`（分支 private-patches，工作树 `C:\Users\Administrator\cc-haha-pr`）
- 改动：`src/utils/stats.ts` 把用量去重账本从「每个转录文件一份」提到「一次 processSessionFiles 调用一份」
- 测试：`src/utils/__tests__/stats.test.ts` 新增「bills a reply replayed into a subagent transcript only once」，12 项全过
- 对照实验：旧逻辑 873、新逻辑 453，差 420（正好是重放的 420 token）
- 真实数据：430 个转录 / 916MB，修复后每天虚高归零，累计少算 1,007,246,096

## 构建/部署事实
- 装机路径：`C:\Users\Administrator\AppData\Local\Programs\Claude Code Haha\resources`
- 已装 sidecar 时间戳：2026-10-29 09:15，含 P1/P2/P3 原生桥接（win-cu-worker.exe）
- 上次构建工作树 `cc-haha-sidecar-backup\desktop-replay-0.7.5` 是 detached HEAD `c301637b`，**不含**本次修复、也**不含** P1P2P3 —— 不能拿它构建
- 构建必须用主工作树 `cc-haha-pr`（HEAD 135ab3ef，P1P2P3 齐全）
- 打包脚本：`cc-haha-sidecar-backup\repack-0.7.5\repack.cjs`，参数 `node repack.cjs 0.7.5 <worktree>`
- repack.cjs 里的 win-cu-worker 来源已硬编码指向 `cc-haha-pr/desktop/src-tauri/binaries/win-cu-worker.exe`

## 待办
1. 在 cc-haha-pr 构建 dist / electron-dist / sidecar
2. 打包
3. 备份装机版
4. 替换
5. 重启
6. 验证总数字

## 回滚
备份目录在 `cc-haha-sidecar-backup\repack-0.7.5\before-deploy-*`，拷回 app.asar / app.asar.unpacked 即可。
