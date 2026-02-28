# ClaudeDesign React 全语义图驱动 1:1 一次生成闭环计划（无补丁，Android 全路由一次门禁）

## Summary
1. 可以实现，而且必须改成“图驱动编译”才能根治你现在的发布/节点偏差。当前链路的根因是：`compiler.cheng` 仍在做字符串扫描，`native_r2c_compile_react_project.c` 仍有编译后补洞，`capture_route_layer_android.c` 仍有硬编码点击脚本，`cheng_mobile_exports.c` 仍在做 route-text 语义渲染。
2. 目标改为：`React AST + 运行时计算样式/布局/事件轨迹` 生成单一语义图，再由 R2C 一次 codegen 出组件级执行单元，禁止后补注入与模板回放。
3. 你已确认的执行策略已锁定：
1. 门禁范围：直接全路由一次。
2. 样式真值源：运行时计算样式图（computed style + layout box + target map）。
4. 交付顺序：先 Android 完整全绿（编译、渲染、交互、framehash），再同构复制到 iOS/Harmony。

## Public APIs / Interfaces / Types
1. 编译报告强制新增并设为必填：
`semantic_graph_path`、`component_graph_path`、`style_graph_path`、`event_graph_path`、`route_tree_path`、`route_actions_android_path`、`runtime_trace_path`、`template_runtime_used=false`、`compiler_report_origin=cheng-compiler`、`semantic_compile_mode=react-semantic-ir-node-compile`。
2. 新增统一图 schema：
`src/tools/r2c_aot/schema/r2c_semantic_graph_v1.json`  
`src/tools/r2c_aot/schema/r2c_component_graph_v1.json`  
`src/tools/r2c_aot/schema/r2c_style_graph_v1.json`  
`src/tools/r2c_aot/schema/r2c_event_graph_v1.json`  
`src/tools/r2c_aot/schema/r2c_route_actions_v1.json`
3. 运行时状态 schema 强制字段：
`render_ready`、`semantic_nodes_loaded`、`semantic_nodes_applied_count`、`semantic_nodes_applied_hash`、`last_frame_hash`、`route_state`、`build_hash`、`semantic_hash`、`surface_width`、`surface_height`。
4. 一键命令保持 native 入口：
`src/bin/r2c_compile_react_project`  
`src/bin/verify_r2c_equivalence_android_native --android-fullroute 1`  
`src/bin/verify_r2c_equivalence_all_native --android-fullroute 1`

## Implementation Plan
1. 移除“编译后补洞”主路径：删除 `src/tools/native_r2c_compile_react_project.c` 中 `materialize_semantic_artifacts_from_react_ir()` 及其调用，严格要求编译器直接产出 `generated_runtime_path`、`semantic_render_nodes_path`、`semantic_*_map`。
2. 移除“路由树回填”主路径：删除 `backfill_route_tree_layers_meta()` 和 `route_parent_for/route_depth_for/route_action_script_for` 这类硬编码路由映射逻辑，改为只消费编译器输出文件；缺失即 hard-fail。
3. 移除采集器硬编码点击脚本：删除 `src/tools/native_capture_route_layer_android.c` 里的 `route_action_script_for()`，改为解析 `r2c_route_actions_android.json` 的 `actions[]` 回放。
4. 重建编译前端：在 `src/tools/r2c_aot/compiler.cheng` 下线 `cpCollect*`、`detectTextContains`、`fillFullRouteStates` 路径，新增 TS/TSX AST 前端与 IR lowering（模块图、组件边界、hook 槽位、effect 依赖、context 订阅、事件绑定、lazy/Suspense/import）。
5. 构建单一语义总图：编译阶段输出 `semantic_graph`，节点包含 `component_id/node_id/props/style_ref/event_ref/hook_ref/route_ref`，边包含 `render_edge/state_edge/effect_edge/event_edge/route_transition_edge`。
6. 引入运行时样式轨迹采集：新增 `src/tools/native_extract_react_runtime_graph.c`（或 Cheng 等价命令），在 React 真运行过程中按路由采集 `computed style + layout box + event target map`，输出 `style_graph` 与 `runtime_trace`。
7. 合并 AST 图与运行时图：新增合并器（放 `compiler.cheng` 或 `src/tools/native_merge_semantic_graph.c`），规则固定为 “AST 决定结构与事件语义，runtime trace 决定最终样式与布局数值”；冲突直接编译失败。
8. 重写代码生成：改造 `src/tools/r2c_aot/codegen_cheng.cheng` 与 `src/tools/r2c_aot/runtime_generated_template.cheng`，产出组件级 `mount/update/unmount` 执行单元，禁止文本语义节点回放路径。
9. React runtime 最终语义：完善 `src/browser/r2capp/react_compat.cheng`，固定 `render -> commit -> layout -> passive`，依赖变化 `cleanup -> rerun`，unmount cleanup，hook 槽位错位 hard-fail。
10. 副作用桥收口：完善 `src/browser/r2capp/webapi.cheng` 为 `opcode/request-id/timeout/cancel/idempotency/result push-back` 协议，render 阶段禁副作用。
11. 缩减 C 到最小 ABI：在 `/Users/lbcheng/cheng-lang/src/runtime/mobile/cheng_mobile_exports.c` 删除 route-text 绘制、手写路由切换和 semantic TSV 文本渲染主路径；仅保留输入、窗口生命周期、side-effect 桥、frame capture。
12. 首页硬门禁保持：`route_state` 默认强制 `home_default`（无参数），且 runtime 回传不一致直接失败；禁止“首页跳错到应用市场”这类漂移静默通过。
13. 发布/节点专项收口：在路由动作图中对 `publish_selector`、`tab_nodes`、`home_channel_manager_open` 的入边与返回边做一致性校验（动作可回放、返回路径唯一、framehash 对齐）。
14. Android 全路由一次门禁：`verify_r2c_equivalence_android_native --android-fullroute 1` 直接跑全路由，但内部按路由逐个输出失败点（route、action step、runtime_state、truth diff）。
15. 三端收敛：Android 全绿后，将同一 `semantic_graph` 与 `route_actions` 下发到 iOS/Harmony runner，门禁标准与 Android 一致，不降级。

## Test Cases And Scenarios
1. 编译真实性：
`template_runtime_used=false`、`compiler_report_origin=cheng-compiler`、`semantic_compile_mode=react-semantic-ir-node-compile`、`unsupported_syntax=0`、`unsupported_imports=0`、`degraded_features=0`。
2. 图完整性：
`semantic_graph/component_graph/style_graph/event_graph/route_actions` 全部存在、可解析、节点 ID 稳定、边无悬挂引用。
3. 路由正确性：
`publish_selector` 与 `tab_nodes` 的 `path_from_root` 和 `actions[]` 可重放且到达目标 `route_state`。
4. 渲染正确性：
每路由 `framehash + RGBA` 与 truth 四件套一致；白板判定直接失败（`render_ready=false` 或 `semantic_nodes_applied_count==0`）。
5. 交互正确性：
发布取消点击、底部导航、侧边栏入口、返回链路逐事件一致，偏差不超过 1 帧。
6. 运行时真实性：
`semantic_nodes_loaded=true`、`semantic_nodes_applied_count>0`、`semantic_nodes_applied_hash!=0`、`last_frame_hash!=0`。
7. 退化防护：
任何编译后补写、注释 `appendSemanticNode(`、硬编码路由脚本残留均 hard-fail。

## Assumptions And Defaults
1. 你选择了“全路由一次门禁”，不采用分层放行。
2. 样式真值源固定“运行时计算样式图”，不接受仅静态 className 解析作为最终真值。
3. 第三方未映射能力继续“未映射即失败”，不允许静默 stub。
4. 仓库外导入保持 `import cheng/gui/...` 可用；仓库内继续 `import gui/...`；`PKG_ROOTS` 默认 `/Users/lbcheng/.cheng-packages`。
5. C 层仅系统 ABI 桥；业务语义、路由、组件渲染全部由 Cheng 产物执行。
6. Android 先全绿，再复制到 iOS/Harmony，最终由 `verify_r2c_equivalence_all_native` 与 `verify_production_closed_loop` 收口。
