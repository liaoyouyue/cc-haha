# CCHH Mobile Android v0.1.5 · 验收清单

## 构建身份

| 项目 | 值 |
|---|---|
| 应用代码提交 | `d677a088` |
| APK 构建提交 | `3a5dc490`（在 `d677a088` 基础上新增内联 v0.7.4 许可证） |
| APK Build Run | `39454046592` |
| Emulator Smoke Run | `39456152390` |
| APK | `acceptance/apk/3a5dc490/CCHH-Mobile-v0.1.5.apk` |
| APK SHA-256 | `5ed9df4e51d0394c8db7a296edfbe9faf49ca70e9efa2ec453fdc93ecc997559` |
| APK 大小 | `94771312` bytes |
| 文档提交 | 本文件所在的后续文档提交；不改变上述 APK |

状态含义：`PASS` 只用于已有可复现证据；`BLOCKED` 表示仍需真实设备、网络、账号或固定签名；`BASELINE FAIL` 表示仓库既有质量门失败，不能写成通过。

## A. 已完成的自动化证据

| # | 检查项 | 状态 | 证据 |
|---|---|---|---|
| A1 | Mobile 单元/协议测试 | PASS | 本地及 APK CI：33/33 |
| A2 | 前台恢复状态矩阵 | PASS | 覆盖 background/inactive/active/unknown 异常组合 |
| A3 | 重连退避 | PASS | 1/2/4/8/16/30 秒、30 秒上限、负数/NaN/Infinity |
| A4 | About/法律链接常量 | PASS | HTTPS、GitHub host、v0.7.4 LICENSE、源码和第三方声明路径测试 |
| A5 | App JSX/Bundle 解析 | PASS | `bun build App.js --external "*"` |
| A6 | 两个隔离 CCHH Server | PASS | 独立 HOME/配置/令牌/会话；双向错令牌 401；历史不串；停 A 后 B 继续工作 |
| A7 | APK 构建 | PASS | Run `39454046592`，HEAD `3a5dc490` |
| A8 | APK 单包签名有效 | PASS | CI `apksigner verify` 通过；仅代表该包签名有效 |
| A9 | Android 模拟器 LAN/恢复/审批流 | PASS | Run `39456152390`，HEAD `3a5dc490` |
| A10 | 许可证随构建物交付 | PASS | Artifact 含 v0.7.4 标签 LICENSE、`THIRD_PARTY_NOTICES.md`、`COMMUNITY_BETA.md` |
| A11 | PR server-checks | BASELINE FAIL | 9 文件、19 测试失败；同一集合跨运行复现，失败代码未被本 PR 修改 |
| A12 | PR desktop-native-checks | BASELINE FAIL | `dataMigration.test.ts` 权限恢复/清理 `EACCES`；相关代码未改 |
| A13 | PR coverage-checks | BASELINE FAIL | 清理 `/tmp/cc-haha-coverage-test-*` 时 `EACCES`；两次运行同因失败 |

## B. 首次单真机 LAN 验收

以下项目尚未执行，不能预填 PASS。

| # | 手机/电脑操作 | 预期结果 | 状态 |
|---|---|---|---|
| B1 | 一台 Android 手机开启开发者选项和 USB 调试，执行 `adb devices -l` | 恰好一台状态为 `device` | BLOCKED |
| B2 | 测试电脑运行 CCHH 0.7.4，手机与电脑接入同一可信 Wi-Fi | 电脑保持开机；不连接生产环境 | BLOCKED |
| B3 | 用完整 SHA 验证并运行 `acceptance/run_device_smoke.py` | 安装、启动、首次连接页和证据采集通过 | BLOCKED |
| B4 | 从连接页打开“关于 / 法律” | 可看到许可证、源码、第三方声明入口 | BLOCKED |
| B5 | 电脑开启“设置 → H5 访问”；手机选择“同一 Wi-Fi”并扫本机 QR | 地址/令牌填入，未自动发送任务 | BLOCKED |
| B6 | 点“连接到 CCHH” | 只显示该测试电脑的会话 | BLOCKED |
| B7 | 发送唯一测试文本 | 只发送一次并收到流式回复 | BLOCKED |
| B8 | 发起无害工具调用并在手机核对后批准 | 仅批准的调用执行 | BLOCKED |
| B9 | HOME 后恢复、锁屏 30 秒后恢复 | 历史保留，自动重连，不重发任务 | BLOCKED |
| B10 | 人工断网再恢复 | 先同步历史；无重复任务 | BLOCKED |
| B11 | APP 解除配对；电脑关闭 H5 或轮换令牌 | 手机失去访问；电脑会话/数据库不删除 | BLOCKED |

## C. 其他真实网络

| 项目 | 状态 | 说明 |
|---|---|---|
| 真实 Tailscale | BLOCKED | 尚无授权网络/设备；首次 LAN 测试不依赖它 |
| 真实 ngrok | BLOCKED | 尚无授权账号/公网；首次 LAN 测试不依赖它 |
| Wi-Fi 与蜂窝网络真实切换 | BLOCKED | 需用户在真机上人工执行 |
| 电脑休眠/重启恢复 | BLOCKED | 需测试电脑与真机共同执行 |

## D. 两名不同用户独立使用

| 项目 | 状态 | 说明 |
|---|---|---|
| 两个隔离服务端与令牌 | PASS | 自动化真实启动两个本地 Server；不是两名真人验收 |
| 两部手机 + 两台电脑 | BLOCKED | 尚未提供两套授权硬件 |
| 两名用户分别扫码自己的电脑 | BLOCKED | 尚未执行真实 QR/设备流程 |
| A/B 会话、审批、网络恢复不串线 | BLOCKED | 服务端隔离已验证，端到端真人设备仍缺 |

## E. 签名与升级

| 项目 | 状态 | 说明 |
|---|---|---|
| 当前 APK 可验证签名 | PASS | CI 临时签名；仅适合本次首次安装测试 |
| 显式 `versionCode=1` | PASS | `app.json` 已配置 |
| 固定 Beta Keystore | BLOCKED | 未授权生成；不需要 HSM，本地加密 Keystore 即可 |
| 覆盖升级 | BLOCKED | 每次 CI 临时密钥不同；尚无两份同签名、递增 versionCode APK |
| 升级检查脚本 | PASS | `acceptance/verify_android_upgrade.py` 会先比证书和 versionCode，不自动卸载 |

## 判定

- **本人授权的一台手机 + 一台测试电脑 + 同一 Wi-Fi 首次 LAN 测试：READY，等待 B1–B11 实操。**
- **两名不同用户独立真机使用：BLOCKED。**
- **公开/群发 Beta、稳定升级、真实公网声明：BLOCKED。**
