# Chromium 级生产闭环验收规范（纯 Cheng）

## 固定目标
- 纯 Cheng 自研浏览器主链。
- 六端统一版本：Android、iOS、macOS、Windows、Linux、Web。
- 硬门禁 CI：任一 gate 失败即阻断。
- JS/Compat 目标：ES2020 + DOM/Fetch。
- 多进程隔离：Browser、Renderer、GPU、Utility。
- 媒体策略：开源编解码路径，无 DRM。
- 兼容性门槛：WPT 核心子集通过率 >= 90%。

## 目录与模块
- 引擎核心：`/Users/lbcheng/.cheng-packages/cheng-gui/src/browser/engine/*`
- 多进程：`/Users/lbcheng/.cheng-packages/cheng-gui/src/runtime/process/*`
- IPC 协议：`/Users/lbcheng/.cheng-packages/cheng-gui/src/platform/ipc/*`
- 六端宿主：`/Users/lbcheng/.cheng-packages/cheng-gui/src/platform/chromium/*`

## 验收脚本（固定顺序）
1. `src/scripts/verify_chromium_engine_obj.sh`
2. `src/scripts/verify_chromium_runtime_matrix.sh`
3. `src/scripts/verify_chromium_wpt_core.sh`
4. `src/scripts/verify_chromium_network_features.sh`（HTTP/HTTP3 网页、网络媒体、网络 PDF）
5. `src/scripts/verify_chromium_security.sh`
6. `src/scripts/verify_chromium_perf.sh`
7. `src/scripts/verify_chromium_production_closed_loop.sh`

## 发布阻断条件
- 对象编译、运行矩阵、WPT、安全、性能任一失败，直接非 0 退出。
- 仅在 `verify_chromium_production_closed_loop.sh` 全绿时允许进入发布流程。

## 回滚准则
- 任一平台出现 P0，执行六端整体回滚。
- 回滚包必须包含上一 GA 版本完整产物与符号映射。
