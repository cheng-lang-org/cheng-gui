# ClaudeDesign 全路由全像素（Chromium 级）一次性 1:1 门禁闭环计划（macOS 优先）

## 摘要
- 目标是一次性把 `ClaudeDesign` 做到“全路由 + 全像素 + Chromium 级门禁”并接入总闭环，不再按小步推进。
- 构建与运行继续锁定：`零 Node`、`零 JS Runtime`、`硬失败`。
- 你已锁定的策略全部固化到计划中：`外部依赖可重复回放`、`像素阈值 0 容差`、`一次性通过总门禁`。

## 目标口径（锁定）
- 1:1 定义：`全路由业务E2E` + `全像素（0容差）` + `Chromium 核心门禁` 联合通过。
- 平台：`macOS` 做可视化 1:1 硬门禁；其他平台继续保留构建/对象门禁。
- 失败策略：`unsupported_syntax`、`unsupported_imports`、`degraded_features` 任一非空即失败。
- 外部依赖策略：全部走确定性回放，不允许真实外部随机性影响门禁结果。

## 重要接口与类型变更（对外稳定面）
- 保持不变：`/Users/lbcheng/.cheng-packages/cheng-gui/src/browser/web.cheng` 导出签名不变（`navigate`/`dispatchDomEvent`/`captureSnapshot` 等）。
- 扩展内部稳定接口：
  - `/Users/lbcheng/.cheng-packages/cheng-gui/src/platform/native_sys_impl.cheng` 新增 `surfaceReadbackRgba(surface: SurfaceHandle, outPath: str): bool`。
  - `/Users/lbcheng/.cheng-packages/cheng-gui/src/r2c_app_desktop_main.cheng` 新增环境变量：
    - `CHENG_R2C_APP_FRAME_RGBA_OUT`
    - `CHENG_R2C_APP_ROUTE_STATE_OUT`
    - `CHENG_R2C_APP_EVENT_MATRIX`
- 扩展编译报告类型：
  - `/Users/lbcheng/.cheng-packages/cheng-gui/src/tools/r2c_aot/types.cheng` 的 `R2cCompileReport` 新增：
    - `fullRouteStatesPath`
    - `fullRouteStateCount`
    - `pixelGoldenDir`
    - `pixelTolerance`（固定为 `0`）
    - `replayProfile`
- 产物契约新增文件：
  - `r2c_fullroute_states.json`
  - `r2c_fullroute_event_matrix.json`
  - `r2c_fullroute_coverage_report.json`

## 一次性实施步骤（决策完成）

1. 全路由状态图编译期产出
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/tools/r2c_aot/compiler.cheng`。
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/tools/r2c_aot/codegen_cheng.cheng`。
- 编译阶段强制产出 `r2c_fullroute_states.json`，状态集合固定包含以下 30 个状态：
  - `lang_select`
  - `home_default`
  - `home_search_open`
  - `home_sort_open`
  - `home_channel_manager_open`
  - `home_content_detail_open`
  - `home_ecom_overlay_open`
  - `home_bazi_overlay_open`
  - `home_ziwei_overlay_open`
  - `tab_messages`
  - `tab_nodes`
  - `tab_profile`
  - `publish_selector`
  - `publish_content`
  - `publish_product`
  - `publish_live`
  - `publish_app`
  - `publish_food`
  - `publish_ride`
  - `publish_job`
  - `publish_hire`
  - `publish_rent`
  - `publish_sell`
  - `publish_secondhand`
  - `publish_crowdfunding`
  - `trading_main`
  - `trading_crosshair`
  - `ecom_main`
  - `marketplace_main`
  - `update_center_main`
- 编译器检测到模板化回退（非 IR 驱动）立即失败。

2. 全路由事件矩阵与可点击目标稳定化
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/tools/r2c_aot/codegen_cheng.cheng`。
- 生成 `r2c_fullroute_event_matrix.json`，每个状态必须有确定事件脚本。
- 对无显式 id 的关键交互节点，生成稳定 selector：`#r2c-auto-<module>-<ordinal>`，保证门禁脚本可重复命中。

3. 0 容差全像素采集与比对
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/platform/macos_app.m`（实现 RGBA readback）。
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/platform/native_sys_impl.cheng`（暴露 readback 到 Cheng）。
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/r2c_app_desktop_main.cheng`：
  - 每个状态点输出 `framehash` 与 `raw rgba`（或同尺寸无损 PNG）。
- 新增脚本 `/Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_claude_fullroute_visual_pixel.sh`：
  - 逐状态执行事件矩阵。
  - 与 `src/tests/claude_fixture/golden/fullroute/<state>.rgba` 做逐字节比较（0容差）。
  - 同时校验 `<state>.framehash` 作为快速诊断索引。

4. 外部依赖确定性回放（你已选定）
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/browser/r2capp/webapi.cheng`：
  - `localStorage/sessionStorage`、`timer`、`matchMedia`、`ResizeObserver`、`cookie`、`clipboard`、`geolocation`、`FileReader` 全部挂到回放层。
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/browser/r2capp/adapters/*`：
  - 对链上/网络相关适配器统一接入 `replayProfile=claude-fullroute`。
- 新增回放数据：
  - `/Users/lbcheng/.cheng-packages/cheng-gui/src/tests/claude_fixture/replay/replay_manifest.json`
  - `/Users/lbcheng/.cheng-packages/cheng-gui/src/tests/claude_fixture/replay/*.json`
- 默认禁用真实外部调用；若发生未回放调用，立即失败并输出调用路径。

5. Chromium 级门禁并行硬约束
- 保留并强制执行 `/Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_chromium_production_closed_loop.sh`。
- 新增 `/Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_r2c_chromium_equivalence_full.sh`：
  - 要求 `WPT core >= 90%`。
  - 要求 `HTTP/HTTPS` 拉取与渲染链路 gate 通过。
  - 要求 `PDF`、`media` 现有 gate 通过。
- 任一项失败即阻断全量门禁。

6. 总闭环一次性入口固定
- 修改 `/Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_production_closed_loop.sh`，固定顺序：
  - 现有 GUI/Browser/Chromium gate
  - `verify_r2c_real_project_closed_loop.sh`（严格模式）
  - `verify_claude_fullroute_visual_pixel.sh`
  - `verify_r2c_chromium_equivalence_full.sh`
- 统一成功标记：
  - `[verify-claude-fullroute-pixel] ok routes=30`
  - `[verify-r2c-chromium-equivalence-full] ok`
  - `[verify-production-closed-loop] ok`

## 测试用例与验收场景（硬门禁）

1. 编译器层
- 可达图覆盖 `ClaudeDesign` 入口可达模块。
- 报告断言：
  - `unsupported_syntax = 0`
  - `unsupported_imports = 0`
  - `degraded_features = 0`
  - `generated_ui_mode = ir-driven`
  - `fullRouteStateCount = 30`

2. 业务全路由层
- 30 个状态全部可达、可渲染、可输出状态文件。
- 关键业务断言：
  - 语言选择持久化
  - tabs 切换
  - publish 12 子页
  - trading crosshair
  - content detail/ecom overlay
  - marketplace/update center
  - timer/resize/matchMedia/cookie/clipboard/geolocation/FileReader 行为一致

3. 视觉层（0容差）
- 每个状态都进行逐像素比对（RGBA 字节级一致）。
- 任意 1 像素差异即失败。
- framehash 仅用于快速定位，不替代像素比对。

4. Chromium 级层
- `verify_chromium_production_closed_loop.sh` 全绿。
- `verify_r2c_chromium_equivalence_full.sh` 全绿。
- WPT core 报告满足阈值。

## 交付命令（单入口）
- 一次性总门禁：
  - `CHENG_R2C_REAL_PROJECT=/Users/lbcheng/UniMaker/ClaudeDesign CHENG_R2C_REAL_ENTRY=/app/main.tsx /Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_production_closed_loop.sh`
- 单独全路由全像素门禁：
  - `/Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_claude_fullroute_visual_pixel.sh`

## 明确假设与默认值
- 默认 `macOS` 作为可视化 1:1 硬门禁平台。
- 外部依赖固定使用 `claude-fullroute` 回放配置。
- 像素阈值固定为 `0`，不允许容差。
- 运行时严格零 JS VM，构建链严格零 Node。
- 白名单外依赖与未支持语法一律硬失败，不做静默降级。
