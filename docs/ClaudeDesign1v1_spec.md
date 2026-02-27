# ClaudeDesign 1:1 真语义闭环执行基线（SPEC）

更新时间：2026-02-26  
适用仓库：`/Users/lbcheng/.cheng-packages/cheng-gui`

## 1. 目标与边界

1. 输入固定：`/Users/lbcheng/UniMaker/ClaudeDesign`，入口固定：`/app/main.tsx`。
2. 链路固定：`React AST -> Cheng IR -> 组件执行单元 -> Android+iOS+Harmony 真机运行`。
3. 发布禁止：模板回放、默认 fallback、Capacitor/WebView/JS bundle 运行时。
4. C 层仅承担 ABI 桥，不承载业务语义。

## 2. 编译硬门禁

编译报告必须满足：

- `template_runtime_used=false`
- `compiler_report_origin=cheng-compiler`
- `semantic_compile_mode=react-semantic-ir-node-compile`
- `unsupported_syntax=0`
- `unsupported_imports=0`
- `degraded_features=0`

并且以下字段路径存在且可解析：

- `react_ir_path`
- `hook_graph_path`
- `effect_plan_path`
- `third_party_rewrite_report_path`
- `truth_trace_manifest_android_path`
- `truth_trace_manifest_ios_path`
- `truth_trace_manifest_harmony_path`
- `perf_summary_path`

## 3. 运行时硬门禁（三端都要）

runtime state 必须满足：

- `render_ready=true`
- `semantic_nodes_loaded=true`
- `semantic_nodes_applied_count>0`
- `semantic_nodes_applied_hash!=0`
- `last_frame_hash!=0`
- `build_hash!=0`
- `semantic_hash!=0`
- `route_state` 非空

## 4. 真实性防伪

1. 禁止自动补写 `semantic_render_nodes.tsv`，缺失即失败。
2. `appendSemanticNode(` 只统计可执行行。
3. 注释行 `# appendSemanticNode(` 一律 hard-fail。
4. 可执行 `appendSemanticNode(` 数必须等于 `semantic_node_count`。
5. strict/prod 强制：
   - `R2C_SKIP_COMPILER_EXEC=0`
   - `R2C_SKIP_COMPILER_RUN=0`
   - `R2C_REUSE_COMPILER_BIN=0`
   - `R2C_REUSE_RUNTIME_BINS=0`
6. strict 编译器来源仅允许“当前构建二进制”或显式 `CHENG_R2C_NATIVE_COMPILER_BIN`。

## 5. fullroute 执行条件

仅当 `semantic-ready` 通过后才允许执行 fullroute；否则直接失败并阻断。

## 6. 零脚本政策

1. 发布与验收链路全部走 native/Cheng 可执行入口。
2. dispatcher 禁止 `bash/python` 回退执行。
3. `.sh/.py` 不得作为发布依赖。

检查命令：

```bash
find /Users/lbcheng/.cheng-packages/cheng-gui -type f \( -name "*.sh" -o -name "*.py" \) | wc -l
```

验收值：`0`。

## 7. 强制验收命令

```bash
R2C_REAL_PROJECT=/Users/lbcheng/UniMaker/ClaudeDesign \
R2C_REAL_ENTRY=/app/main.tsx \
/Users/lbcheng/.cheng-packages/cheng-gui/src/bin/verify_r2c_equivalence_all_native
```

```bash
/Users/lbcheng/.cheng-packages/cheng-gui/src/bin/verify_production_closed_loop
```

## 8. 失败即阻断

以下任一成立即阻断发布：

- 出现模板回放、fallback、semantic shell generator。
- 白板：`semantic_nodes_applied_count==0` 或 `last_frame_hash==0`。
- 任一端仅 build 通过但无 runtime state 回传。
- 发布链路落到脚本解释器执行。
