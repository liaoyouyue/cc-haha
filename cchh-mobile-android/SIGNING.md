# CCHH Mobile Android · Beta 签名与升级方案

## 当前状态

- 版本：v0.1.5
- 包名：`com.cchh.mobile.client`
- 当前 `versionCode`：1
- 当前 CI：每次构建临时生成测试密钥，并在 CI 内执行 `apksigner verify`
- 结果：单个 APK 可安装；不同 CI 构建签名不同，不能互相覆盖升级
- 长期/固定 Beta 私钥：尚未生成，也未授权生成

当前 APK 只能用于本人授权的首次安装测试，不能当作可持续升级的正式 Beta 包。

## 免费固定 Beta 方案

HSM 不是社区 Beta 的前置条件。授权后可在离线或受控本地电脑生成一把固定 RSA-3072 Keystore：

```bash
keytool -genkeypair \
  -keystore cchh-mobile-beta.p12 \
  -storetype PKCS12 \
  -alias cchh-mobile-beta \
  -keyalg RSA \
  -keysize 3072 \
  -validity 9125 \
  -storepass '<强随机口令>' \
  -keypass '<强随机口令>' \
  -dname 'CN=CCHH Mobile Beta, O=CCHH, C=CN'
```

本仓库不会执行上面的命令，也不会生成真实私钥。

### 保存规则

1. Keystore 只放在加密磁盘或加密密钥库中。
2. 口令放密码管理器，不写入脚本、文档、聊天或 CI 日志。
3. 至少保留两份离线加密备份，分别保存。
4. Git 只记录公钥证书 SHA-256 指纹；Keystore 和口令永不入库。
5. 只有明确授权的维护者可使用该密钥签名。

本地固定签名即可满足免费 Beta；接入 GitHub Actions Secrets 是后续可选项，不是前置条件。

## versionCode 规则

- `versionName` 面向用户，例如 `0.1.5`、`0.1.6`。
- `versionCode` 每个可分发 APK 必须严格递增，不能复用或回退。
- 当前临时签名包使用 1。
- 首个固定 Beta 签名包建议从 2 开始；之后使用 3、4、5……
- 临时签名包切换到固定签名包时签名不同，需卸载旧包；固定签名启用后才开始验证连续覆盖升级。

## 固定签名验收

1. 使用同一固定 Keystore 构建旧版 APK（例如 `versionCode=2`）。
2. 只增加 `versionCode` 后构建新版 APK（例如 `versionCode=3`）。
3. 先做离线检查：

```bash
python acceptance/verify_android_upgrade.py old.apk new.apk
```

4. 在明确授权的一台测试手机上执行覆盖升级：

```bash
python acceptance/verify_android_upgrade.py old.apk new.apk --install
```

脚本会先验证两个 APK 的证书 SHA-256 完全一致，且新版 `versionCode` 更大；任一条件不满足时不会自动卸载旧包。

## CI 接入（可选）

如后续确需 CI 自动签名：

1. 将加密后的 Keystore 与口令放入受限 Secrets；不要放进仓库。
2. 构建时写入临时目录，签名后立即删除。
3. 日志不得打印 Keystore、口令或私钥内容。
4. 发布物同时记录 APK SHA-256、证书 SHA-256、源码提交和 `versionCode`。
5. 用 `acceptance/verify_android_upgrade.py` 做同签名升级门禁。

## 当前验证状态

| 检查项 | 状态 | 证据/限制 |
|---|---|---|
| CI 临时签名有效 | PASS | APK Build `39415730800` 的签名验证步骤成功 |
| 固定 Beta 签名 | BLOCKED | 尚未授权生成固定 Keystore |
| 跨构建覆盖升级 | BLOCKED | 当前每次 CI 使用不同临时密钥 |
| `versionCode` 显式配置 | PASS | `app.json` 已设为 1 |
| 真机升级 | BLOCKED | 尚无授权真机和两份同签名递增 APK |

## 泄露或丢失

- 立即停止使用受影响密钥，并记录受影响 APK 的证书指纹。
- 未接入 Play App Signing 时，新密钥无法覆盖安装旧签名包；用户必须卸载后重装。
- 不自动删除用户电脑上的 CCHH 会话或数据库。
- 通过已确认的官方渠道说明受影响版本、指纹和重装步骤。

## 禁止事项

- 不把私钥、Keystore 或口令提交到 Git。
- 不把临时测试签名包描述为可持续升级的正式包。
- 不在未授权环境生成或使用固定 Beta 密钥。
- 不为通过测试而关闭 Android 签名校验或跳过证书比对。

*文档版本：2026-10-20 | CCHH Mobile Android v0.1.5*
