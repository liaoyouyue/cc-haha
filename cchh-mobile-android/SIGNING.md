# CCHH Mobile Android · 签名与发布方案

## 概述

本文档描述 CCHH Mobile Android v0.1.5 的签名方案、密钥管理策略及发布流程。

---

## 当前状态

- **版本**：v0.1.5 (versionCode: 1, versionName: "0.1.5")
- **包名**：com.cchh.mobile.client
- **最低 SDK**：30 (Android 11)
- **目标 SDK**：35 (Android 15)
- **架构**：arm64-v8a, armeabi-v7a
- **当前签名**：CI 临时生成测试密钥（每次构建重新生成）
- **APK SHA256 (v0.1.5)**：`db1f8e893ad4a0f1de28dd1e191810bd5aa9264b5c1ceca8441d84aee43cf063`

---

## 签名方案设计

### 长期签名密钥要求

| 项目 | 要求 |
|------|------|
| 算法 | RSA 3072-bit 或 EC P-256 |
| 有效期 | ≥ 25 年（覆盖应用生命周期） |
| 存储 | 硬件安全模块 (HSM) 或加密密钥库 |
| 备份 | 离线冷存储，多地点冗余 |
| 访问控制 | 多因子认证，最少 2 人授权 |

### 密钥生成流程（待授权执行）

```bash
# 示例：生成长期签名密钥（需在安全环境执行）
keytool -genkeypair \
  -keystore cchh-mobile-release.jks \
  -alias cchh-mobile-release \
  -keyalg RSA \
  -keysize 3072 \
  -validity 9125 \
  -storepass <强密码> \
  -keypass <强密码> \
  -dname "CN=CCHH Mobile Release, O=CCHH, C=CN"
```

### 密钥存储与备份策略

| 层级 | 存储方式 | 访问权限 | 更新频率 |
|------|----------|----------|----------|
| 主密钥 | HSM / 加密 USB Token | 核心维护组（≥2人） | 仅轮换时 |
| 离线备份 | 加密纸质/硬盘 | 核心维护组 + 存档 | 每次轮换后 |
| CI 临时密钥 | 内存中生成 | CI 系统自动 | 每次构建 |

---

## 当前 CI 临时签名行为

**`.github/workflows/cchh-mobile-apk.yml`** 中的签名逻辑：

```bash
# 当前行为：每次构建生成临时密钥
keytool -genkeypair -keystore /tmp/cchh-test.jks \
  -alias cchh -storepass changeit -keypass changeit \
  -dname "CN=CCHH Mobile Test" -keyalg RSA -keysize 3072 -validity 3650
apksigner sign --ks /tmp/cchh-test.jks ...
```

**问题**：
- 每次构建密钥不同 → 用户无法直接升级安装（签名不一致）
- 临时密钥无长期有效性保证

---

## 正式签名接入计划

### 阶段 1：密钥生成与验证（需授权）
- [ ] 在安全环境生成长期发布密钥
- [ ] 验证 `apksigner verify` 通过
- [ ] 导出公钥证书指纹（SHA256）用于透明度验证

### 阶段 2：CI 集成（密钥不入仓库）
- [ ] 配置 GitHub Actions Secrets / OIDC 信任 HSM
- [ ] 修改 `cchh-mobile-apk.yml` 使用长期密钥签名
- [ ] 验证同一密钥连续构建可直接升级安装

### 阶段 3：密钥轮换预案
- [ ] 文档化轮换流程（保留旧密钥支持现有用户升级）
- [ ] 定期演练（每 12-24 个月）

---

## 当前验证状态

| 检查项 | 状态 | 备注 |
|--------|------|------|
| APK 可安装 | ✅ | 模拟器/真机验证通过 |
| SHA256 固定 | ✅ | `db1f8e893ad4a0f1de28dd1e191810bd5aa9264b5c1ceca8441d84aee43cf063` |
| 临时签名可验证 | ✅ | `apksigner verify` 通过 |
| 升级兼容性 | ❌ | 每次构建密钥不同，无法直接升级 |
| 长期密钥 | ⏳ | 等待授权生成 |

---

## 密钥泄露应急预案

1. **立即撤销**：在 Google Play / 分发渠道撤销旧证书（如已上架）
2. **生成新密钥**：按上述流程生成新长期密钥
3. **强制重装**：用户需卸载旧版安装新版（签名不一致无法直接升级）
4. **通知用户**：通过官方渠道告知重装步骤

---

## 禁止事项

- ❌ 将私钥、Keystore 文件、密码提交至 Git 仓库
- ❌ 在 CI 日志、聊天记录、文档中泄露私钥/口令
- ❌ 将临时测试签名包作为正式升级包分发
- ❌ 在未授权环境生成或使用长期发布密钥
- ❌ 共享签名密钥给非核心维护人员

---

## 下一步行动

**等待授权**：长期发布密钥生成需明确授权，且需在安全环境执行。

当前可执行：
- [x] 验证当前 APK 签名有效性
- [x] 记录当前 APK SHA256 供后续对比
- [ ] 设计 CI 集成方案（待密钥就绪）
- [ ] 编写密钥轮换 SOP

---

*文档版本：2026-10-20 | CCHH Mobile Android v0.1.5*