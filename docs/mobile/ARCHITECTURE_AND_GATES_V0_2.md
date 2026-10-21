# CCHH Mobile 0.2｜接口契约、架构、任务拆解及测试门禁

状态：设计与技术实施清单，**未证明目标手机真机通过**。配套文档：[PRODUCT_BLUEPRINT_V0_2.md](./PRODUCT_BLUEPRINT_V0_2.md)。  
源码观察基线：`liaoyouyue/cc-haha` / `dae2852b`，实际用户安装的 CCHH 0.7.4 需运行时兼容性验证。

## 1. 现有资产：保留，不要重写

| 资产 | 文件及协议 | 已有证据 / 待办 |
|---|---|---|
| QR 与私网配对 | `privatePairing.mjs`, `connectionUtils.mjs` | 继续防同源错配、明文公网 HTTP、恶意参数；使用 SecureStore |
| 公网经用户授权配对 | `remotePairing.mjs` | 独立 HTTPS QR、电脑批准、Cookie 会话；不能与 LAN bearer 混用 |
| 实时会话 | `App.js` → `/ws/:sessionId` | `sync_state`、`content_delta`、`session_state`、`permission_request/resolved`、`user_message`、`stop_generation` |
| 会话历史 | `GET /api/sessions/:id/messages` | cursor 分页、历史合并；仍需统一标准事件 |
| 安卓恢复 | `mobileRecovery.mjs`，旧连接测试 | 清理旧 Socket、前台重新同步、不擅自重发 |
| 简单 UI 五栏 | `App.js`（当前单文件 800+ 行） | 仅是工程参考，不作为设计完成；拆分且功能守卫 |

## 2. 接口能力矩阵：已见源码 ≠ 真机已验收

| 功能 | 源码可见接口 | 权限 / 缺口 | 实施策略 |
|---|---|---|---|
| 会话列表 | `GET /api/sessions` | 各主机身份与分页 | 客户端 API adapter + 同主机隔离缓存 |
| 会话消息 | `GET /api/sessions/:id/messages` | 部分消息类型是结构化块 | 独立 `normalizeMessage`，保持原始 block 及 id |
| 发送消息 | WS `user_message` | 断网时服务端是否已收到不确定 | ACK/历史对账先行，**不要使用无幂等保证的自动重发** |
| 同步 / 执行状态 | WS `sync_state`, `session_state`, `status` | 事件顺序/幂等需 mock 与双端 E2E 验证 | 明确状态机，事件版本与 session ID 校验 |
| 工具审批 | WS `permission_request`, `permission_response`, `permission_resolved` | 必须确认 requestId、会话、主机、工具参数 | 弹窗 + 单次决策锁 + 服务端状态同步 |
| 模型查询与设置 | `GET /api/models`, `GET/PUT /api/models/current` | 写入 **桌面默认模型**；未证实会话级修改 | 有能力才显示可修改按钮，变更前确认 |
| Effort 查询与设置 | `GET/PUT /api/effort` | 当前表现为桌面设置，不是每个任务独立值 | 显示来源、权限不足说明 |
| 任务清单 | `GET /api/tasks/lists/:taskListId` | 列表 ID 与当前 session 的关联逻辑仍待核对 | 验证映射后展示；不得跨会话串出任务 |
| 工作区目录树 | `GET /api/sessions/:id/workspace/tree?path=` | 有服务端 workspace 授权检查 | **优先使用 session/workspace 受限 API**，不依赖全局 filesystem |
| 工作区文件内容 | `GET /api/sessions/:id/workspace/file?path=` | 文件大小/格式/会话工作区边界 | P1 文件正文、图片预览；禁止无界读取 |
| 原始媒体 | `GET /api/sessions/:id/workspace/raw?path=` | 服务端格式白名单与大小上限 | 身份验证后的受控 blob 加载，无 token URL 泄露 |
| 文件差异 | `GET /api/sessions/:id/workspace/diff?path=` / `GET /api/sessions/:id/review/diff?path=` | Git 来源、快照语义不同 | 明确 diff 基线/来源，避免“改动”误判 |
| 工作区状态 | `GET /api/sessions/:id/workspace/status` | 依赖会话工作目录 | 文件页真实“改动清单” |
| 电脑状态 | `GET /api/status` | 只是服务状态，不是画面 | 放“主机详情”，不要冒充远程桌面 |
| 交互式终端 | **当前移动客户端无已验证 PTY 端点** | 涉及命令执行与网络安全 | P2 单独协议、安全审计后才启用 |
| 桌面画面控制 | **当前客户端无已验证采集/画面/输入链路** | 屏幕权限、认证、延迟、编码 | P3 单独项目验收，不做演示假数据 |
| 附件/语音 | 需要额外核对 CCHH v0.7.4 上传及消息协议 | 当前原生客户端尚无可靠上传链 | 能上传真实附件才开放 UI，麦克风不可假装已启用 |
| 后台通知 | 现有客户端没有已验收的跨机通知基础设施 | Android 后台、权限、网络、推送费用 | 先做应用内可靠事件，真正推送列独立切片 |

**重要：** `POST /api/sessions/:id/chat` 在现有源码中只返回 `queued` 占位状态，并不等于执行一个真实 AI 回合。实际消息发送使用 WebSocket 事件协议。  
另：`/api/filesystem/browse` 虽存在，但跨主机/跨会话操作风险更高。工作区内容优先使用服务端 session-scoped API，并验证返回路径与权限。  
权限分支由 `src/server/index.ts` H5 认证和 `src/server/router.ts` 负责；必须在隔离服务端分别测试 LAN bearer 与公网 Cookie，不可仅凭函数名假定路由可用。

## 3. 模块划分（React Native/Expo 现有栈，避免推倒配对层）

```text
cchh-mobile-android/
  App.js                         # Provider + navigation shell，目标 < 120 行
  src/
    navigation/
      AppNavigator.jsx           # 未配对、会话、工作台路由
      tabPolicy.mjs              # 后端能力门禁，空壳不可上架
    screens/
      PairingScreen.jsx          # 原有扫码配对迁移
      SessionScreen.jsx
      ChatScreen.jsx
      TasksScreen.jsx
      ExecutionLogScreen.jsx     # 未验证 PTY 前，不叫“终端”
      FilesScreen.jsx
      HostDetailsScreen.jsx      # 未验证 capture 前，不叫“桌面”
    components/
      MessageTimeline.jsx
      MessageRenderer.jsx        # 安全 Markdown，代码块复制，敏感数据折叠
      ToolEventCard.jsx
      PermissionCard.jsx
      QueueDrawer.jsx
      ModelEffortPicker.jsx
      Composer.jsx
      ConnectionBanner.jsx
      FilePreview.jsx
    services/
      CchhRestClient.mjs         # 统一超时、授权、错误分类
      CchhSocketClient.mjs       # socket 状态、超时、退避及取消
      CchhPairingService.mjs     # 保留并封装现有实现
      CchhCapabilities.mjs       # 实测能力而非仅按版本宣称
      SessionWorkspace.mjs
    state/
      sessionReducer.mjs         # 主机/会话严格分区
      messageReconciler.mjs      # 已确认/未知/本地草稿
      queueStore.mjs             # 本机持久但绝不自动重放
      permissionReducer.mjs
    theme/
      tokens.mjs                 # 唯一的视觉变量
  tests/                          # 现有测试保留并扩展
```

初期**不更换 RN/Expo、WebSocket、二维码解析或 Cookie 依赖**，先模块化并保回归；只有证实存在安全/性能问题才更换架构组件。  
引用开源库前先核验发布、许可证、原生兼容和是否需要商业授权。

## 4. 消息一致性与恢复状态机（P0 红线）

```text
HOST_DISCONNECTED
  └─ explicit/recovered pairing → CONNECTING
CONNECTING → SYNCING → READY
READY + user tap send → LOCAL_SENT_UNKNOWN
LOCAL_SENT_UNKNOWN + server evidence → CONFIRMED
LOCAL_SENT_UNKNOWN + loss → NEEDS_RECONCILIATION
NEEDS_RECONCILIATION + history match → CONFIRMED
NEEDS_RECONCILIATION + no evidence → USER_DECIDES (never silent resend)
READY + tool permission → WAITING_APPROVAL → RESOLVED
READY + turn running → RUNNING → READY
```

- 不以收到 WS `send()` 成功当成服务端执行确认。
- 不把过去的同文案用户消息误作本次 ACK；使用任务/消息 ID、历史分页的观察边界和会话状态联合判断。
- 当前服务端若无幂等 `clientMessageId` 支持，**即使用户选择重发也应提示可能造成重复执行**。
- `sessionId + hostId` 必须匹配后才处理增量、审批和 ACK；过期 Socket 的 `onclose` 不能污染新连接。
- 断线前已批准的工具状态必须服务端恢复核对，不补发批准包。
- 从后台回来先做 `sync_state` + transcript/history fetch，UI 保留上一次有效内容。

## 5. 每个功能的 UI/协议边界

### 模型切换

客户端发起 `GET models` + `GET current`，以服务器为权威。修改只允许在非运行中、用户确认修改电脑默认设置之后，用 `PUT current`；成功后重新 GET 验证。服务端拒绝时不更新本地显示。若之后找到真会话级协议，再单独提供“本次会话”。

### 消息队列

持久化设备**私有草稿**（敏感文本不能进日志），以 `host fingerprint + sessionId` 隔离，按创建时间排序；“手动发送”与“存草稿”语义分开。若真实服务端缺乏 ACK/幂等接口，则禁止默认自动重试和跨连接自动排队出站，避免重复操作。云同步不是本期目标。

### 任务

既有 `taskService` 的 taskListId 有可能独立于当前聊天 session，不允许仅凭同名目录就关联任务。先做 `session ↔ tasklist` 真实映射测试；没有映射就显示未绑定说明，不能引用其他人的任务数据。

### 文件

路径唯一由 `session/workspace` API 操作，文件内容按需获取；支持 403/404/413 友好错误。文件预览只读，不允许移动端自由拼接任意绝对路径作为授权依据。Diff 与工作树真实状态加清晰标题“与 HEAD 比较 / 指定 Git 审查来源”。

### 终端/桌面

工作台导航以**可交付能力**为准：只有执行日志时显示“执行记录”；只有健康状态时显示“主机详情”。进入独立的 PTY / 屏幕串流与输入控制协议阶段之前，不显示“终端可执行”“桌面可控制”按钮。产品的五栏视觉目标保留，但不能以此强迫发布假页面。

## 6. 可执行任务切片（按依赖，不得并发修改 App.js）

| ID | 依赖 | 切片、成果 | 验收 |
|---|---|---|---|
| M0-1 | 无 | UI token、导航状态图、Android 360/393/430dp 布局验收稿 | 截图比对 Loopii 参考结构；页面空/加载/报错可见 |
| M0-2 | 无 | 实机/隔离服务端只读 API 能力矩阵，包含 LAN/public 权限 | 每个标记“已支持”的接口具 HTTP/WS 证据 |
| M1-1 | M0 | 拆 Pairing、Session、Chat，保持现有连接服务 | 旧连接 37+ 回归与安卓 emulator chat/approval PASS |
| M1-2 | M1-1 | 统一 REST + WS typed adapter、主机/会话作用域 | 错令牌/错主机/旧 socket 不能污染当前状态 |
| M2-1 | M1 | Markdown + 代码块 + 思考/工具时间线 | 真 transcript + 长消息，视图正确、虚拟列表不跳动 |
| M2-2 | M1 | 持久草稿队列、手动发送、状态对账 | 断网、杀进程、双主机切换、不重复执行 |
| M2-3 | M1 | 审批卡、模型/思考设置、键盘响应 | 重复点击被锁、全局设置确认、拒绝/批准各一次 |
| M3-1 | M1 | 任务状态与待审批合并展示 | 只有真实任务，状态不伪造百分比 |
| M3-2 | M1 | 工作区文件树、文本/媒体预览、Diff | 受限路径 / 大文件 / 二进制 / symlink / 权限测试 |
| M3-3 | M1 | 执行记录查看、长输出分页/复制 | 无日志则清晰空状态，无虚假 PTY |
| M4-1 | M2/M3 | 免费 LAN、Tailscale、实验公网真实设备 | 连接/配对/断网重连/网络切换真实记录 |
| M4-2 | M4-1 | Beta 签名、升级、许可证与两名用户隔离 | 同签名覆盖升级、独立电脑与手机，不再只测 mock |
| M5-1 | 协议设计/授权 | 真 PTY 安全实现 | 命令级授权、终止、日志、路径隔离 |
| M5-2 | 协议设计/授权 | 真桌面画面与远程输入 | 授权/端到端数据通道/可见权限提示/撤销 |

**每一切片的交付：** SHA、独立 Draft PR、变更文件、现有与新增测试数、Android 构建/模拟器截图（如适用）、真实接口证据与剩余 BLOCKED。现有 PR #3 不合并、不强推。

## 7. 测试矩阵（最低集合）

| 编号 | 方式 | 验证场景 | 发布判断 |
|---|---|---|---|
| T01 | 单测 | 官方 H5 QR 的合法/恶意 URL 与错同源 | PASS |
| T02 | 单测 | hostId/sessionId 切换清理缓存、队列与审批 | PASS |
| T03 | 单测 + WS mock | 发送中断后未知状态不自动重发 | PASS |
| T04 | 单测 | 相同文本、历史分页和消息 ID 对账不误认 | PASS |
| T05 | 单测 | 过期 socket 回调不覆盖新连接 | PASS |
| T06 | 单测 + mock | permission response 单次提交/拒绝/取消 | PASS |
| T07 | 隔离 Server | 模型 GET、默认 PUT 与重新 GET 对账 | PASS 或显式 UNSUPPORTED |
| T08 | 隔离 Server | session workspace tree/file/diff 权限与路径 | PASS 或显式 UNSUPPORTED |
| T09 | Android emulator | 连接/会话/聊天/工具审批/恢复 | PASS |
| T10 | Android emulator | 聊天、任务、文件、执行记录真实切换与按钮 | PASS |
| T11 | Android emulator | 360dp 宽/输入法/屏幕旋转/超长 Markdown | PASS |
| T12 | 双 Server | A/B 令牌、会话、任务和文件完全隔离 | PASS |
| T13 | 真机 | LAN、HOME、锁屏、断网、重连不重发 | BLOCKED 到实测 |
| T14 | 真机 | 至少两部 Android 与两台独立 CCHH 电脑 | BLOCKED 到实测 |
| T15 | 真机 | 固定签名递增 versionCode 的覆盖升级 | BLOCKED 到实测 |
| T16 | 人工审核 | 非商业分发许可、第三方声明、来源署名 | BLOCKED 到审核 |

不得把 T01–T12 的 PASS 算成 T13–T16 PASS。开发阶段的 CI PASS 也不能替代“你拿到手机感觉好用”的 UI 验收。

## 8. 发布安全门

- 首发为免费非商业 Beta；仅用户控制的 CCHH，账户/凭据/会话绝不汇总到开发者服务。
- 不收费、不绑卡、不接付费线路，不触碰用户生产 CCHH、FreeLLMAPI 3001 或私有补丁。
- LAN bearer 仅用户自己的可信私网，公网只 HTTPS + 桌面端批准；不上传二维码截图、H5 Token、Cookie 或真实密钥。
- 测试签名包不能承诺原地升级。生成长期密钥需要单独授权，禁止提交证书私钥。
- 上游 cc-haha 自定义许可与第三方依赖需合法署名并附完整条款。
- 封版前必须提供**真实手机截图及交互录屏/等价可复现证据**，验收每个按钮的行为；页面贴图不是功能证据。

## 9. 隔离工作流

唯一实施主线：PR #3（仍 Draft）的最新 HEAD 为设计源基线；本方案在新 docs-only Draft 中交付。设计通过后另开 `feat/cchh-mobile-v02-m1-...` 工作分支。禁止旧 CCHH Agent 团队干预或因团队退出受阻暂停 APP。原则是先公开成熟实现与许可证调查，再以 CCHH 协议适配；不直接引入不兼容平台的 Bridge/Hub。