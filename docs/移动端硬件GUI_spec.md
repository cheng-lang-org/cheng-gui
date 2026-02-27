# 移动端硬件 GUI 规范（SPEC）

更新时间：2026-02-26  
适用仓库：`/Users/lbcheng/.cheng-packages/cheng-gui`

本文件是移动端实现约束的 SPEC 文档。若与  
`/Users/lbcheng/.cheng-packages/cheng-gui/docs/ClaudeDesign1v1_spec.md` 冲突，以更严格约束为准。

## 1. 三端与渲染路径

1. 目标端固定：Android+iOS+Harmony。
2. 渲染路径固定：原生 surface + GPU。
3. 禁止：Capacitor/WebView/JS bundle 运行时。

## 2. ABI v2 约束

文件：`/Users/lbcheng/cheng-lang/src/runtime/mobile/cheng_mobile_exports.h`

必须保持：

- `CHENG_MOBILE_ABI_VERSION=2`
- `cheng_app_on_key`
- `cheng_app_on_text_input`
- `cheng_app_on_ime`
- `cheng_app_on_resize`
- `cheng_app_on_focus`
- `cheng_app_pull_side_effect`
- `cheng_app_push_side_effect_result`
- `cheng_app_capture_frame_hash`
- `cheng_app_capture_frame_rgba`
- `cheng_app_capabilities`

## 3. C 层职责边界

1. C 仅做系统桥：输入、窗口、side-effect、frame capture、生命周期。
2. 业务语义与 React runtime 不得驻留 C fallback。

## 4. 宿主通道约束

1. Android：`SurfaceView + ANativeWindow + Choreographer + InputConnection + JNI`。
2. iOS：`UIKit + CAMetalLayer + CADisplayLink + UITextInput`。
3. Harmony：`XComponent + Native Surface + GPU`，发布禁用 `pollFrame`。

## 5. 真机就绪门禁

三端 runtime state 必须满足：

- `render_ready=true`
- `semantic_nodes_loaded=true`
- `semantic_nodes_applied_count>0`
- `semantic_nodes_applied_hash!=0`
- `last_frame_hash!=0`
- `build_hash!=0`
- `semantic_hash!=0`

未满足时禁止执行 fullroute。

## 6. 零脚本要求

1. 发布/验证链路仅允许 native/Cheng 命令。
2. 禁止 dispatcher 脚本回退路径。
3. `.sh/.py` 不得进入发布依赖。

检查命令：

```bash
find /Users/lbcheng/.cheng-packages/cheng-gui -type f \( -name "*.sh" -o -name "*.py" \) | wc -l
```

验收值：`0`。

## 7. 验收命令

```bash
R2C_REAL_PROJECT=/Users/lbcheng/UniMaker/ClaudeDesign \
R2C_REAL_ENTRY=/app/main.tsx \
/Users/lbcheng/.cheng-packages/cheng-gui/src/bin/verify_r2c_equivalence_all_native
```

```bash
/Users/lbcheng/.cheng-packages/cheng-gui/src/bin/verify_production_closed_loop
```
