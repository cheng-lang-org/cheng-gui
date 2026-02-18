# Cheng GUI V1 Foundation（Pure Cheng）

> 纯 Cheng GUI 评审与重构方案（UniMaker）+ 本仓库 Foundation 落地说明

## 摘要

- 使用依据：cheng语言 skill（`SKILL.md`）+ 正式规范（`cheng-formal-spec.md`）。
- 结论：`cheng-mobile/cheng/mobile/ui` 这条线可继续作为主线；`cheng-gui` 当前存在明显规范偏差与代码健康度问题，不适合直接作为移动端生产基座。
- 目标：建立“纯 Cheng 组件树 + Flex 布局 + DisplayList 指令流 + Host ServiceBus”的统一架构，并给出可迁移的分阶段落地路径。

## 现状问题与改进点

### P0（必须先处理）

#### 导入语法与规范冲突

证据：`app_render_ui.cheng` (line 1)、`bridge.cheng` (line 1) 仍使用 `import std / os` 形式；规范要求归一化路径且路径不得含空格（`cheng-formal-spec.md` (line 684)），skill 也明确禁止旧导入写法（`SKILL.md` (line 35)）。

改进：统一替换为 `std/os`、`cheng/...`，并加 CI 语法门禁。

#### cheng-gui 内存在疑似损坏/不可维护模块

证据：`Backend.cheng` (line 9)（for m）、多处类型声明串接异常（如 (line 123)、(line 143)、(line 208)）。

改进：将该模块标记为“冻结旧线”，不再增量修补；新渲染主线迁到 `cheng-mobile` 统一实现。

### P1（架构层问题）

#### 设计系统重复定义且语义漂移

证据：`tokens_business_cn.cheng` 与 `business_tokens.cheng` 同时定义 `MobileUiTheme`，颜色与 `uiPx` 行为不同（一个有 scale clamp，一个无）。

改进：收敛到单一 token 包，`cheng-gui/mobile` 只保留兼容层。

#### 当前移动 UI 仍偏“手绘 immediate mode”，声明式能力不足

证据：`pixel_app.cheng` 为事件轮询+像素渲染循环；`17_01_main_loop_and_entry.cheng` 仍大量 screen-specific 直接渲染函数调用。

改进：引入稳定的 `Build -> Diff -> Layout -> Paint -> Submit` 管线，业务仅写组件和状态。

### P2（体验与性能问题）

#### 局部 DPI/缩放处理不一致

证据：`components_form.cheng` (line 75)、(line 82) 直接 `uiPx(..., 1.0)`；`pixel_app.cheng` (line 63) 固定 `scale = 1.0`。

改进：所有尺寸统一从 `HostMetrics.scale` 获取，禁止硬编码 `1.0`。

#### 文本测量与真实渲染模型不一致

证据：`components_surface.cheng` (line 188) 用“码点数 * 固定步进”估宽，但实际绘制走 `chengGuiNativeDrawTextBgraI32`。

改进：增加 host 侧 `measureText` FFI，UI 布局与 hit test 全部使用同一测量源。

## 我的纯 Cheng GUI 设计方案

### 1) 分层架构（单一主线）

- `cheng/mobile/gui/core`：UiNode、状态、调度、diff。
- `cheng/mobile/gui/layout`：Flex 布局（先实现 row/column/flex-grow/align/padding/margin）。
- `cheng/mobile/gui/render`：DisplayList 生成与裁剪。
- `cheng/mobile/gui/host`：窗口/输入/IME/文本测量/资源/服务总线抽象。
- `cheng/mobile/gui/design`：唯一 token + 文案 + 主题。
- `cheng/mobile/gui/dapp`：Dapp trait 与服务注入上下文。

### 2) 关键运行管线

- HandleEvents：把 host 事件转为 UiEvent。
- Update：状态机消费消息，最小化脏区。
- Build：生成新 UiNode 树（纯函数视图优先）。
- Diff：对比旧树/新树，得到变更集。
- Layout：按约束计算几何盒。
- Paint：输出 DisplayList（非直接写像素）。
- Submit：Host 后端执行 DisplayList；软渲染作为 fallback。

### 3) ServiceBus 设计（纯 Cheng 侧调用）

```text
UiServiceRequest { id, service, method, payloadCbor }
UiServiceResponse { id, ok, payloadCbor, error }
```

- 默认协议：CBOR（包体小、实现轻），必要时扩展 ProtoBuf。
- 所有服务异步回调到 `UiEventKind.ServiceResult`，不在 UI 线程阻塞。

### 4) 资源包设计

- 包格式：`.capp`（zip + manifest + hash）。
- 逻辑路径：`@app/...`、`@cache/...`、`@user/...`。
- Host 负责解包与沙盒映射，Cheng 侧只通过 `AssetResolver` 访问。

## 公共 API / 接口变更（决策完成）

新增 Dapp 入口接口（`api.cheng`）：

```cheng
type
    Dapp = ref of RootObj
        Init: fn(self: Dapp, ctx: var DappContext)
        Build: fn(self: Dapp, ctx: UiBuildContext): UiNode
        Update: fn(self: Dapp, msg: UiMsg, ctx: var DappContext): bool
```

新增统一 Host 抽象（`api.cheng`）：

```cheng
type
    HostMetrics = object
        width: int32
        height: int32
        scale: float64
        imeInsetBottom: int32

    HostAdapter = ref of RootObj
        PollEvent: fn(self: HostAdapter, ev: var UiEvent): bool
        SubmitDisplayList: fn(self: HostAdapter, list: UiDisplayList): int32
        MeasureText: fn(self: HostAdapter, text: str, fontPx: int32): int32
        ServiceRequest: fn(self: HostAdapter, req: UiServiceRequest): bool
```

新增渲染指令模型（`display_list.cheng`）：

```cheng
type
    UiCommandKind = enum
        uckRect
        uckRRect
        uckText
        uckImage
        uckClipPush
        uckClipPop

    UiCommand = object
        kind: UiCommandKind
        ...
```

## 兼容层策略

- 旧 `cheng/mobile/ui/components_*` 保留 1 个小版本，内部桥接到新 API。
- `cheng-gui/mobile/*` 标记 deprecated，只做转发，不再定义新 token/type。

## 落地步骤（执行顺序）

- 阶段 A（规范收敛，1 周）：统一 import 与旧语法清理；新增 lint 规则阻止 `import std /`、`div/mod`、`concat`、`method/proc/converter`。
- 阶段 B（设计系统收敛，1 周）：将 `tokens_business_cn` 作为唯一来源，删除重复主题定义；补齐多语言 copy 表。
- 阶段 C（GUI Core + Flex，2 周）：完成 UiNode、diff、layout v1；先覆盖现有 NavBar/List/Card/Input/Button。
- 阶段 D（DisplayList + HostAdapter，2 周）：接通 MeasureText、SubmitDisplayList、ServiceRequest，保留像素 fallback。
- 阶段 E（UniMaker 接入，2 周）：用新 Dapp 接口替换 `/Users/lbcheng/UniMaker/app/src/main/cheng/framework/*` 现有 stub，迁移一个真实页面（建议社交流）做闭环。
- 阶段 F（冻结旧路径，1 周）：旧 hand-written screen renderer 仅留维护窗口；新功能只进新架构。

## 测试用例与验收场景

- 语法合规测试：扫描全仓 `.cheng`，禁止旧 import/旧关键字/旧调用格式。
- 布局正确性测试：给定固定约束，断言 Flex 结果（位置、尺寸、溢出裁剪）。
- 渲染一致性测试：同一 UiNode 输出 DisplayList 快照稳定（可文本化比较）。
- 输入事件测试：tap/drag/scroll/IME 文本输入路径全覆盖，特别是 pointerId 切换与取消。
- 服务总线测试：request-response、超时、失败重试、乱序返回去重。
- 资源包测试：`.capp` 完整性校验、`@app` 路径解析、缺失资源容错。
- 性能门禁：中端 Android 目标：普通页面 55-60fps；首帧 < 400ms；滚动无明显抖动。
- 回归验收：UniMaker 现有首页/消息/发布至少迁移 1 页并对比旧实现行为一致。

## 假设与默认决策

- 默认以 `cheng-mobile` 为移动端主实现容器，`cheng-gui` 不再承担移动端新能力开发。
- 默认优先 Android 闭环，iOS/Harmony 在 HostAdapter 协议稳定后跟进。
- 默认 ServiceBus 使用 CBOR；如链路要求再加 ProtoBuf 编解码插件。
- 默认渲染后端采用 “DisplayList + Host 执行”，软件像素渲染仅作降级兜底。
- 默认保留现有 UniMaker 页面行为，不在本轮引入视觉重设计。

---

## 本仓库（cheng-gui）已包含的 Foundation 落地

本仓库现在包含一套纯 Cheng 的 retained、typed DSL GUI runtime foundation（用于验证/承载上述架构）。

### 新入口（Entrypoint）

- `src/kit.cheng`
- Stable API：

```cheng
type
    AppConfig =
        appId: str
        title: str
        root: fn (ctx: UiContext): Node
        theme: ThemeSpec
        enableA11y: bool

fn createApp(config: AppConfig): GuiApp
fn runApp(app: GuiApp)
fn shutdownApp(app: GuiApp)
```

### 新分层（Layers）

- `src/core/component.cheng`：Node tree、typed node kinds、context、state/effect hooks。
- `src/runtime/scheduler.cheng`：主帧管线阶段 `Input -> Update -> Layout -> Diff -> Render -> Present`。
- `src/runtime/loop.cheng`：输入统计与帧耗时辅助。
- `src/layout/layout_tree.cheng`：确定性的 retained layout 遍历。
- `src/layout/flex_grid.cheng`：简单 flex-row 与 grid 计算器。
- `src/render/drawlist_ir.cheng`：CPU/GPU 共用的 draw list IR。
- `src/render/backend_compat.cheng`：从 draw list 到旧 `render/Backend.cheng` 后端的兼容桥。
- `src/a11y/semantic.cheng`：语义树生成与 focus 顺序快照。
- `src/widgets/v1.cheng`：V1 组件构造器（View/Text/Image/Icon/Spacer/Scroll/List/Grid/Button/TextField/Checkbox/Radio/Switch/Slider/Select/Dialog/Popover/Tooltip/Tabs/NavStack/DataTable/Chart/RichTextEditor/WebView/PdfView/AudioPlayer/VideoPlayer）。
- `src/browser/{types,web,pdf,media}.cheng`：纯 Cheng browser core primitives（用于 WebSession/PdfDocument/MediaPlayer 等），运行时集成保持在 `src/kit.cheng`。

### 平台事件扩展

`src/platform/types_v1.cheng` 定义 `src/kit.cheng` 使用的扁平化、后端兼容事件契约：

- 多点触控：`geTouchDown`、`geTouchUp`、`geTouchMove`
- 手势输入：`geGesturePinch`、`geGestureRotate`、`geGestureSwipe`
- 无障碍动作输入：`geA11yAction`

### 弃用与迁移

- `src/render/Backend.cheng` 的直接调用已标记 deprecated。
- 新代码统一使用 `src/kit.cheng`。
- 现有调用点可通过 `src/render/compat_kit_bridge.cheng` 渐进迁移。

### Smoke 与验证

- Smoke entry：`src/gui_kit_smoke_main.cheng`
- Browser smoke entry：`src/browser_core_smoke_main.cheng`
- 结构验证脚本：`src/scripts/verify_gui_v1_foundation.sh`
- Browser core 验证脚本：`src/scripts/verify_browser_core.sh`

### 工具链依赖

- 纯 Cheng library layer 假设 Host 能力由 Cheng toolchain builtins 提供：`std/sys/gui`、`std/sys/gpu`、`std/sys/text`、`std/sys/a11y`、`std/sys/web`。
- compatibility layer 会让当前仓库在这些 builtins 完全可用之前保持可运行。

### 运行时稳定性说明

当前兼容渲染器在 fallback 路径中用几何占位来表示文本，以规避 host runtime smoke builds 中不稳定的字符串封送（marshaling）。
