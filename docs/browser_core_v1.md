# Cheng GUI Browser Core（Chromium 演进版，纯 Cheng）

> Chromium 级生产闭环落地方案（纯 Cheng、自研内核、六端同日 GA）

## 摘要

- 目标定义固定为：纯 Cheng 自研浏览器引擎；六端（Android、iOS、macOS、Windows、Linux、Web）单版本同日 GA；硬门禁 CI；ES2020 + DOM/Fetch；强制多进程隔离；开源编解码无 DRM；WPT 核心子集通过率 >= 90%。
- 落地方式：在现有 `cheng-gui` 仓库内从 Browser Core V1 演进到 Chromium 架构等价实现，并把所有门禁收敛到一个总入口脚本。
- 交付标准：`代码 + 脚本 + CI + 性能 + 安全 + 兼容性` 同时闭环，任何一项失败即阻断发布。

## 概览

在 `cheng-gui` 中将 Browser Core V1 演进为 Chromium 架构等价主链：

- 新增 Browser Engine（Browser/Renderer/GPU/Utility）多进程模型。
- 新增统一 IPC schema：`src/platform/ipc/messages_v2.cheng`。
- 新增六端宿主抽象目录：`src/platform/chromium/{macos,windows,linux,android,ios,web}`。
- 保持旧 API 两个小版本兼容，内部转发到新引擎 API。

## 重要 API / 类型变更（对外稳定面）

### `src/browser/types.cheng`

- `BrowserEngineConfig`
- `BrowserContextOptions`
- `PageOptions`
- `ProcessRole`
- `SandboxProfile`
- `WebCompatProfile`
- `BrowserMetricsSnapshot`
- `CrashReport`

### `src/browser/web.cheng`

- `createBrowserEngine`
- `shutdownBrowserEngine`
- `createContext`
- `destroyContext`
- `createPage`
- `destroyPage`
- `navigate`
- `setPageMarkup`
- `reload`
- `goBack`
- `goForward`
- `evaluateJs`
- `dispatchDomEvent`
- `captureSnapshot`

### `src/browser/pdf.cheng`

- `openPdfInPage`
- `renderPdfPage`
- `searchPdfText`
- `extractPdfMetadata`
- `printPdf`

### `src/browser/media.cheng`

- `attachMediaElement`
- `setMediaSourceBuffer`
- `play`
- `pause`
- `seek`
- `setTrack`
- `getPlaybackMetrics`

## 兼容策略（保留两个小版本）

- 保留现有 `createWebSession` / `openPdfDocument` / `createMediaPlayer` 两个小版本。
- 兼容层内部转发到新引擎 API；迁移映射见下文表格。

## 架构与目录落地（实现路径固定）

新增/固定目录（路径相对于仓库根目录）：

- 引擎核心：`src/browser/engine/{dom,html,css,layout,paint,js,net,storage,security,ipc,scheduler}/`
- 多进程运行时：`src/runtime/process/{browser,renderer,gpu,utility}/`
- 跨进程协议：`src/platform/ipc/{messages_v2.cheng,shared_ring.cheng,serializer.cheng}/`
- 六端宿主适配（仅 Cheng + 工具链内建接口）：`src/platform/chromium/{macos,windows,linux,android,ios,web}/`

说明：

- `src/platform/native_sys_impl.cheng` 保留为 fallback，不承担 Chromium 级能力；Chromium 主链统一走 `src/platform/chromium/*`。

## 数据流与进程模型（固定）

进程职责：

- Browser 进程：导航、权限、存储、网络会话、站点隔离策略。
- Renderer 进程：HTML/CSS 解析、DOM/CSSOM、样式计算、布局、事件分发、JS 执行。
- GPU 进程：合成、栅格、提交，输出统一 Surface。
- Utility 进程：PDF、媒体编解码、下载、压缩/解压等隔离任务。

IPC 分层（固定）：

- Control、Navigation、DOM、JS、Compositor、Media、PDF、Crash
- 全部走 `src/platform/ipc/messages_v2.cheng` 单一 schema。

## 实施里程碑（决策完成、无二义性）

- M0 基线冻结（1 周）：冻结现有闭环脚本与产物格式，新增 `docs/chromium_closure_spec.md` 作为唯一验收规范源。
- M1 引擎骨架与多进程（3 周）：完成 Browser/Renderer/GPU/Utility 四进程启动、握手、崩溃重启、最小页面导航。
- M2 HTML/CSS/DOM/Layout（6 周）：完成 HTML5 核心解析、CSS 选择器/盒模型/流式布局、事件冒泡/捕获。
- M3 JS 引擎 ES2020 核心（8 周）：完成词法/语法/字节码或解释执行、Promise/微任务队列、模块加载、DOM 绑定桥。
- M4 合成与渲染（4 周）：完成 display list、分层合成、离屏栅格、GPU 提交路径；六端像素一致性基线建立。
- M5 PDF 与媒体（6 周）：完成 PDF 解析/渲染/检索/打印；媒体管线（WebM/AV1/VP9/Opus）与 MSE 风格缓冲。
- M6 安全与隔离（4 周）：完成站点隔离、权限模型、CSP 子集、进程沙箱策略、崩溃转储与审计日志。
- M7 全六端收口与 GA（4 周）：六端同版本 gate 全绿，打包发布，生成发布说明与回滚包。

## 测试与验收场景（硬门禁）

- 语义与引擎单测：DOM 树一致性、CSS 级联、布局回归、JS 语义、GC/资源释放。
- 兼容性测试：WPT 核心子集清单固定在 `tests/wpt/core_manifest.txt`，通过率 >= 90%。
- 多进程稳定性：Renderer/GPU/Utility 单独崩溃注入后自动恢复，页面会话不丢失。
- 安全测试：跨站数据隔离、权限越权、消息伪造、URL scheme 注入、下载沙箱逃逸。
- 媒体与 PDF：WebM 播放、AV1/VP9 切码率、音画同步、PDF 搜索/缩放/分页一致性。
- 六端 E2E：Android/iOS/macOS/Windows/Linux/Web 各自启动 -> 导航 -> 交互 -> 媒体 -> PDF -> 关闭全链路通过。
- 性能门槛：桌面/Web 1080p p95 <= 16.7ms；移动 p95 <= 24ms；首屏桌面/Web <= 500ms；移动 <= 800ms。
- 长稳门槛：连续 10k 帧内存漂移 < 3%，无崩溃、无句柄泄漏。

## CI 与生产闭环脚本（固定入口）

Chromium 闭环 gate（见 `docs/chromium_closure_spec.md`）：

- `src/scripts/verify_chromium_engine_obj.sh`
- `src/scripts/verify_chromium_runtime_matrix.sh`
- `src/scripts/verify_chromium_wpt_core.sh`
- `src/scripts/verify_chromium_network_features.sh`
- `src/scripts/verify_chromium_security.sh`
- `src/scripts/verify_chromium_perf.sh`

总入口：

- `src/scripts/verify_chromium_production_closed_loop.sh`：按固定顺序串联全部 gate，任何失败立即退出非 0。
- `src/scripts/verify_production_closed_loop.sh`：在完成现有 GUI gate 后，强制调用 `src/scripts/verify_chromium_production_closed_loop.sh`。

CI 接入：

- `.github/workflows/chromium-closure.yml`：触发条件为 push/PR 到主干相关路径，必须全绿才可合并与发布。

## 发布与回滚（固定）

- 发布包包含：六端二进制、符号、崩溃符号映射、WPT 报告、性能报告、安全报告。
- 版本策略固定：单版本号同日 GA，平台不得分批放行。
- 回滚策略固定：保留前一 GA 版本完整包；任一平台出现 P0 故障即六端整体回滚。

## 假设与默认值（已锁定）

- 纯 Cheng 自研引擎，工具链内建层也不引入第三方依赖。
- 六端同日 GA，不采用分批发布。
- 硬门禁 CI，失败即阻断。
- JS 目标 ES2020 + DOM/Fetch。
- 必须多进程隔离（Browser/Renderer/GPU/Utility）。
- 媒体仅开源编解码，无 DRM。
- Chromium 级定义为“Chromium 架构与核心能力等价 + 核心 WPT >= 90%”，不是复用上游 Chromium 二进制。

## 兼容映射（保留两个小版本）

| 旧 API | 新 API 路径 |
|---|---|
| `createWebSession(request)` | `createBrowserEngine` + `createContext` + `createPage` + `navigate/setPageMarkup` |
| `openPdfDocument(request)` | `openPdfInPage(page, request)` |
| `createMediaPlayer(kind, source, options)` | `attachMediaElement(page, kind, source, options)` |

> 兼容层说明：旧 API 仍可用，但内部已由新引擎能力驱动。

## 关键门禁（现有入口）

- `src/scripts/verify_browser_core.sh`
- `src/scripts/verify_browser_runtime.sh`
- `src/scripts/verify_chromium_production_closed_loop.sh`

## 相关规范

- `docs/chromium_closure_spec.md`
