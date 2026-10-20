# CCHH Mobile Android v0.1.5 · 首次真机 LAN 验收准备报告

**报告日期：2026-10-20**

**PR：liaoyouyue/cc-haha#2，Draft**

**结论：可进入“一台授权 Android 手机 + 一台 CCHH 0.7.4 测试电脑 + 同一可信 Wi-Fi”的首次 LAN 实操；不得据此公开或群发 Beta。**

## 1. 构建与文档身份

| 项目 | 值 |
|---|---|
| 最后应用代码提交 | `d677a088` |
| APK Build HEAD | `3a5dc490`（在 `d677a088` 基础上新增内联 v0.7.4 许可证） |
| 最终 APK Build Run | `39454046592` |
| 最终 Emulator Smoke Run | `39456152390` |
| APK 文件 | `acceptance/apk/3a5dc490/CCHH-Mobile-v0.1.5.apk` |
| APK SHA-256 | `5ed9df4e51d0394c8db7a296edfbe9faf49ca70e9efa2ec453fdc93ecc997559` |
| APK 大小 | `94771312` bytes |
| 包名配置 | `com.cchh.mobile.client` |
| 版本配置 | `versionName=0.1.5`, `versionCode=1` |
| 报告 HEAD | 本报告所在的后续文档提交；它不改变 APK |

此前要求核对的 Build Run `39415730800` 已确认 `SUCCESS`，HEAD 为 `0f679442`。它已被上述最终构建替代，不能再作为最终真机包来源。

## 2. 当前 APK 能做什么

可以：

- 在本人明确授权的一台 Android 手机上做首次安装。
- 连接本人控制的一台 CCHH 0.7.4 测试电脑。
- 仅先做同一 Wi-Fi LAN 流程：扫码、会话、消息、审批、后台/锁屏恢复、人工断网恢复。
- 失败时解除配对、关闭 H5 或轮换令牌，不删除电脑会话与数据库。

不可以据此宣称：

- 已完成真实 Android 真机验收。
- 已完成真实 Tailscale/ngrok 验收。
- 已完成两名真实用户、两部手机、两台电脑的隔离验收。
- 当前 CI 包支持后续覆盖升级。
- 已满足公开或群发社区 Beta 的全部签名、许可证和兼容性门槛。

## 3. 已验证证据

### 3.1 Mobile 代码

| 项目 | 结果 | 证据 |
|---|---|---|
| 单元/协议测试 | PASS | 33/33 |
| App JSX/Bundle 解析 | PASS | Bun bundle parse |
| 恢复状态判断 | PASS | 正常与异常 AppState 组合 |
| 重连退避 | PASS | 完整 1–30 秒序列、上限、负数/NaN/Infinity |
| About/法律入口 | PASS（代码/链接） | 连接页、会话页、聊天页都有入口；三个 HTTPS GitHub 链接有测试 |
| `versionCode` | PASS（配置） | `app.json` 显式为 1 |

About 页的真实触摸、外部浏览器打开和返回体验仍应在 B 阶段真机操作中确认。

### 3.2 两服务端隔离

`acceptance/multi_user_isolation_test.py` 已真实启动两个独立 CCHH Server 进程，并验证：

- 独立 HOME、`CLAUDE_CONFIG_DIR`、H5 token 和 session。
- A/B 各自只能读取自己的 session。
- A token 请求 B、B token 请求 A 均返回 401。
- A/B 分别发送唯一消息，REST history 不串线。
- 停止 A 后，B 仍可读取并继续发送。

结果：`PASS`。这是服务端/协议隔离证据，不是“两名真人 + 两部手机”的替代品。

### 3.3 CI 与模拟器

| Run | HEAD | 结果 | 作用 |
|---|---|---|---|
| `39454046592` | `3a5dc490` | PASS | 构建、33 项测试、Expo 校验、prebuild、release APK、`apksigner verify`、Artifact |
| `39456152390` | `3a5dc490` | PASS | 隔离 Server + Android 模拟器的安装、LAN 会话、审批、恢复、不重发 |

APK Artifact 同时包含：

- `UPSTREAM_LICENSE.txt`：从 `v0.7.4:LICENSE` 内容内联于仓库，避免 CI 环境缺标签。
- `THIRD_PARTY_NOTICES.md`。
- `COMMUNITY_BETA.md`。
- `SHA256SUMS.txt`。

本地再次计算 APK SHA-256 与 Artifact 记录一致。高风险明文模式扫描：PASS（未发现 sk-ant-/ghp_/ngrok token/私钥头）。

## 4. PR Quality 审计

已逐项读取 PR Quality Run `39415739322` 的失败 job 日志，没有把红灯直接写成“全部通过”。

### server-checks

- 汇总：584 files，6841 passed-tests，19 failed-tests，9 failed-files。
- 失败文件：
  - `src/cli/print.sessionMessage.test.ts`
  - `src/server/__tests__/workspace-path-edge-cases.test.ts`
  - `src/server/services/connectorService.test.ts`
  - `src/server/services/cronScheduler.migration.test.ts`
  - `src/server/services/workspaceWatch.test.ts`
  - `src/server/__tests__/cron-scheduler-launcher.test.ts`
  - `src/services/api/claudeBetas.integration.test.ts`
  - `src/services/connectors/cliAdapter.test.ts`
  - `src/services/connectors/managedRuntime.test.ts`
- 同一 9 文件/19 测试集合在 Run `39313419115` 重复出现。
- 上述测试和对应实现相对 PR base 未修改；它们不引用本轮修改的 Mobile E2E mock fixture。
- 结论：`BASELINE/ENVIRONMENT FAIL`，不是本轮 Mobile 新回归；质量门仍是红色，不能标 PASS。

### desktop-native-checks

- 673 pass，3 skip，1 fail。
- 唯一失败：`desktop/electron/services/dataMigration.test.ts`，目录权限恢复后状态为 `failed`，清理 `/tmp/haha-migration-*` 又出现 `EACCES`。
- 相关文件未被本 PR 修改。
- 结论：`BASELINE/ENVIRONMENT FAIL`，不是 Mobile 新回归。

### coverage-checks

- 测试沙箱清理 `rm '/tmp/cc-haha-coverage-test-*'` 时 `EACCES`。
- Run `39313419115` 与 `39415739322` 原因一致。
- `scripts/quality-gate/coverage.ts` 未被本 PR 修改。
- 结论：`BASELINE/ENVIRONMENT FAIL`；没有产出可据以声明覆盖率达标的最终结果。

## 5. 仍需真实执行

### 手机

1. 开启开发者选项和 USB 调试；解锁后确认电脑的 USB 调试授权。
2. 用 `adb devices -l` 确认恰好一台设备状态为 `device`。
3. 运行：

```bash
python acceptance/run_device_smoke.py \
  acceptance/apk/3a5dc490/CCHH-Mobile-v0.1.5.apk \
  --sha256 __FINAL_SHA__ \
  --mode lan
```

4. 若安装报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，说明手机已有另一把临时签名的测试包；脚本不会自动卸载。确认不需要该 APP 的本地配对数据后，再由用户手动卸载旧包重试。
5. APP 选择“同一 Wi-Fi”，只扫描这台测试电脑生成的 H5 QR。
6. 从连接页检查 About/法律入口；连接后再从会话页检查一次。
7. 发送唯一测试文本；核对无重复后再做无害工具审批。
8. 执行 HOME、锁屏 30 秒、人工断网恢复；每次先查看历史，不重复提交任务。

### 电脑

1. 只使用测试 CCHH 0.7.4，不连接或修改生产实例。
2. 与手机连接同一个可信 Wi-Fi。
3. 在“设置 → H5 访问”启用访问并现场展示 QR；不要把 QR/令牌发到聊天或截图外传。
4. 观察会话、流式回复和工具审批是否只发生一次。
5. 验收结束后关闭 H5 或轮换 H5 token。

### 安全回退

- 手机 APP 点“解除配对”。
- 电脑关闭 H5 访问或轮换 H5 token；公网模式还需撤销设备。
- 仅需删除 APP 时，用户可明确执行 `adb uninstall com.cchh.mobile.client`。
- 不删除 CCHH 会话、数据库、配置目录或真实密钥。

## 6. 签名与升级

当前构建每次生成新的临时测试密钥：

- 当前单包签名验证通过，可做首次安装。
- 不同 CI Run 之间证书不同，不能当作升级链。
- 免费固定 Beta 不强制 HSM；授权后可用本地加密 RSA-3072 PKCS12/JKS，并做两份离线加密备份。
- 首个固定签名 Beta 建议从 `versionCode=2` 开始，后续严格递增。
- `acceptance/verify_android_upgrade.py` 会先比较证书 SHA-256 和 versionCode；不一致时停止，且不会自动卸载旧包。
- 本轮未生成任何真实长期/固定私钥。

## 7. 两名不同用户的硬阻塞

1. 缺两部授权 Android 真机。
2. 缺两台各自运行 CCHH 0.7.4 的授权测试电脑。
3. 缺两名用户各自现场扫码、发送、审批、断网/恢复的端到端记录。
4. Tailscale/ngrok 真实账号与网络仍未授权；它们不是首次 LAN 测试的前置条件。
5. 固定 Beta 签名和同签名升级链尚未建立。

## 8. 最终判定

- **单人、单手机、单测试电脑、同一 Wi-Fi：准备完成，等待真实操作。**
- **当前 APK 可用于本人授权的 LAN 首次安装测试。**
- **两名用户真实独立使用、公开分发、稳定升级：仍 BLOCKED。**
- PR #2 保持 Draft；PR #1 不关闭；本轮不合并、不部署、不公开发布。

本报告严格区分自动化、隔离 Server、Android 模拟器和真实设备证据；没有把未执行的真机或公网步骤写成 PASS。
