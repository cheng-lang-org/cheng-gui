# 原生跨平台 GUI 生产闭环（cheng-gui）

目标：在本机完成 **桌面原生** 与 **移动端后端目标编译** 的最小闭环，
确保 GUI 主链路能从 Cheng 源码稳定产出原生制品与跨目标对象文件。

## 闭环范围

- 桌面：`gui_smoke_main.cheng` → 原生二进制（macOS/Linux/Windows）。
- 移动：`gui_smoke_mobile.cheng` → Android/iOS 后端对象文件。

## 产出物

- 桌面二进制：`src/build/gui_smoke_<platform>`
- Android 对象文件：`src/build/mobile/gui_smoke_android_obj/<name>_android.o`
- iOS 对象文件：`src/build/mobile/gui_smoke_ios_obj/<name>_ios.o`

## 验证脚本

入口：`src/scripts/verify_native_gui.sh`

该脚本包含：
- Cheng → obj（backend）→ 原生链接（桌面）
- 移动端 backend obj 编译（Android / iOS）

生产一键闭环：`src/scripts/verify_production_closed_loop.sh`
- `verify_native_gui.sh`
- `verify_gui_v1_foundation.sh`
- `verify_gui_kit_obj.sh`
- `verify_gui_kit_runtime.sh`（macOS 主机执行 kit 运行态 smoke）
- `verify_browser_core.sh`
- `verify_browser_runtime.sh`（macOS 主机执行浏览器核心运行态 smoke）
- `verify_chromium_production_closed_loop.sh`
  - `verify_chromium_engine_obj.sh`
  - `verify_chromium_runtime_matrix.sh`
  - `verify_chromium_wpt_core.sh`
  - `verify_chromium_security.sh`
  - `verify_chromium_perf.sh`
- 桌面 smoke 二进制运行（若可执行存在）

说明：
- `verify_gui_kit_obj.sh` / `verify_browser_core.sh` 现为严格模式：编译必须返回 0 且产物存在，不再接受“有产物但编译返回非 0”。

## 使用方式（本机）

```sh
CHENG_ROOT=/Users/lbcheng/cheng-lang src/scripts/verify_native_gui.sh
```

可选参数：
- `--desktop-out:<path>` 自定义桌面产物路径
- `--android-out:<path>` / `--ios-out:<path>` 自定义移动对象文件目录
- `--desktop-target:<triple>` / `--android-target:<triple>` / `--ios-target:<triple>` 指定目标平台
- `--jobs:<N>` 指定并行度（透传 `chengc.sh`）
- `--mm:<orc|off>` 指定内存模式

## 依赖与约束

- `src/tooling/chengc.sh` 可用
- 可选：`CHENG_BACKEND_DRIVER` 指向可运行 backend driver（未设置时脚本会自动探测）
- `runtime/include` 可用（可用 `CHENG_C_INC` 覆盖）
- macOS 需 `clang` 与系统框架（Cocoa/CoreGraphics/CoreText）
- Android/iOS 仅验证 backend obj 产物，实际 App 打包需对应平台工程链路

## 平台桥接（cheng-mobile）

- `cheng-mobile` 负责移动端平台桥接（JNI/NDK/iOS glue + Host 队列）。
- `cheng-gui` 只保留 Cheng 侧 UI/渲染逻辑与 FFI 声明，不内置平台 C 代码。
- UniMaker/Android 构建通过 `CHENG_MOBILE_ROOT` 引入独立包，未设置时回退本地副本。

## 依赖关系与职责分层

- `cheng-lang`：提供 backend obj/exe 编译链路与运行时头文件。
- `cheng-gui`：Cheng 侧 UI/渲染/事件处理逻辑与 FFI 声明。
- `cheng-mobile`：移动端平台 glue（Android/iOS 原生桥接与渲染通道）。
- UniMaker：组合 `cheng-gui` + `cheng-mobile` 生成移动端产物。

## 失败排查

- backend 编译失败：检查 `CHENG_ROOT` / `src/tooling/chengc.sh` / `CHENG_PKG_ROOTS`
- 链接失败：检查平台编译器/系统库是否可用
- 移动 obj 失败：检查目标 triple 与平台定义（android/ios）是否正确

---

## UniMaker 生产闭环（桌面 + Android）

目标：在 UniMaker 仓库内完成 **桌面混合后端** 与 **移动端 Cheng 导出** 的一键闭环。

### 入口脚本

`UniMaker/scripts/run_cheng_closed_loop.sh`

### 默认行为

- 构建 Unimaker Desktop（C+ASM 混合后端）
- 生成 Android 端 `cheng_mobile_app.c`（纯 Cheng UI 入口）

### 可选项

- `--mobile-clients`：触发 Android/Harmony 客户端构建（依赖 Gradle / hvigor）
- `--jni`：刷新 JNI 依赖（libp2p 等）
- `--skip-desktop` / `--skip-mobile`：只跑部分环节

### 使用示例

```sh
cd /Users/lbcheng/UniMaker
scripts/run_cheng_closed_loop.sh
```
