从你的代码库目录（`ChengActivity.kt`, `cheng_mobile_android_jni.c`, `ios_a64.env`, `harmony_a64.env`）可以看出，你们已经着手在移动端进行硬核的跨平台布局。

要让 `cheng` 这样一门底层的系统级语言完美融入 Android、iOS 和纯血鸿蒙（HarmonyOS NEXT）三大封闭且霸道的操作系统，**千万不要去走 React Native 那种“包装系统原生 UI 控件”的弯路**。这会导致无尽的适配地狱和极差的跨端 FFI 性能。

正确的工业级终极架构，应当效仿 **Flutter（Impeller引擎）** 和 **Unity/虚幻引擎**：采用 **“全自绘管线 (Self-Drawn) + 极薄宿主空壳 (Thin Host Shell) + 控制权反转 (IoC)”**。

结合我们之前确定的 **C Backend** 和 **绝对零指针的 DOD FFI** 理念，以下是具体的集成实施蓝图：

---

### 第一层：定义“绝对纯净”的 C ABI 契约

在移动端，操作系统是掌控生命周期和主线程的绝对主宰。`cheng` 不能再有一直霸占线程的 `main()` 死循环，而是必须退化为一个**“按需响应的状态机与渲染引擎”**。

你需要让 `cheng` 暴露出一个极度精简的 C 函数表，**只传递纯数字句柄（Handle）和基本类型**：

```c
// cheng_mobile_exports.h (Cheng 自动生成，提供给三大平台的 C/C++ 桥接层)

// 1. 初始化，返回引擎实例 ID（纯数字，屏蔽内存指针）
uint64_t cheng_app_init();

// 2. 绑定画布 (将操作系统的原生窗口转为 ID 传给 Cheng)
void cheng_app_set_window(uint64_t app_id, uint64_t window_id, int physical_w, int physical_h, float scale);

// 3. 驱动主循环 (由系统的 VSync 驱动，Cheng 内部严禁写 while(true))
void cheng_app_tick(uint64_t app_id, float delta_time);

// 4. 输入事件下发
void cheng_app_on_touch(uint64_t app_id, int action, int pointer_id, float x, float y);

// 5. 生命周期压后台/唤醒
void cheng_app_pause(uint64_t app_id);
void cheng_app_resume(uint64_t app_id);

```

---

### 第二层：三大生态的“特洛伊木马”式植入

这三端的原生语言（Kotlin/Swift/ArkTS）只做一层极薄的“傀儡外壳”，它们唯一的使命就是：**向系统讨要一块屏幕画布，然后把画布的底层句柄和系统事件，原封不动地扔给上面的 C 接口。**

#### 1. Android (安卓) 阵营：Kotlin + JNI + SurfaceView

* **宿主壳 (Kotlin)**：就像你的 `ChengActivity.kt`。在布局中挂载 `SurfaceView`，在 `surfaceCreated` 回调中拿到 Kotlin 的 `Surface` 对象。
* **桥接层 (JNI)**：在 `cheng_mobile_android_jni.c` 中拦截 `Surface`。
* **核心动作**：引入 NDK 的 `<android/native_window_jni.h>`，调用 `ANativeWindow_fromSurface()` 将其转换为 C 层的物理窗口指针。
* **零指针处理**：将该指针存入 C 层的全局数组（DOD），生成一个纯数字的 `window_id`，传给 `cheng_app_set_window`。


* **驱动引擎**：使用 Android 的 `Choreographer.getInstance().postFrameCallback`，以 60/120Hz 循环调用 `cheng_app_tick()`。

#### 2. iOS (苹果) 阵营：Swift C-Interop + CAMetalLayer

* **宿主壳 (Swift)**：苹果天然支持 C 混编，连 JNI 都不需要。写一个极简的 `UIViewController`。
* **获取画布**：把 UIView 内部的图层替换为专为 GPU 硬件加速设计的 `CAMetalLayer`（或 `CAEAGLLayer`）。
* **桥接层**：直接在 Swift 中 `#include` 头文件。把 `CAMetalLayer` 的内存地址转换为 `UInt64`（充当 `window_id`），调用 `cheng_app_set_window`。
* **驱动引擎**：使用 iOS 的 `CADisplayLink` 监听屏幕刷新，在回调闭包中执行 `cheng_app_tick()`。

#### 3. 鸿蒙 (HarmonyOS NEXT) 阵营：ArkTS + N-API + XComponent

纯血鸿蒙抛弃了 Java，采用了类似 Node.js 的 **N-API (Node-API)** 作为 C++ 交互标准。

* **宿主壳 (ArkTS)**：鸿蒙专门为 C++ 游戏和跨端自绘引擎提供了一个 UI 组件叫 **`XComponent`**。在页面中只放这一个组件。
* **桥接层 (N-API)**：用 C++ 编写一层 N-API 接口。在鸿蒙触发 `OnSurfaceCreated` 回调时，拿到 `OH_NativeXComponent*` 实例句柄。
* **获取画布**：调用系统 API `OH_NativeXComponent_GetWindowHandle` 获取底层的 `OHNativeWindow*`，将其映射为 ID 传给 Cheng。
* **驱动引擎**：鸿蒙 NDK 提供了 `OH_NativeVSync`，注册一个监听器来高频驱动 `cheng_app_tick()`。

---

### 第三层：跨越移动端架构的两大“深水区”

如果你只做了上面的画布绑定，应用跑起来后很快就会遇到两个致命问题：

#### 深水区一：依赖注入（解决文件读取与系统 API 差异）

**痛点**：`cheng` 的核心代码是跨平台的纯 C/UIR，那它怎么读取打包在 App 里的图片和字体？Android 必须用 `AAssetManager`，iOS 用 `NSBundle`，鸿蒙用 `RawFile`。Cheng 绝对不能去 `include` 这些系统的头文件。
**解法：控制反转（IoC）与依赖注入。**
在 `cheng_app_init` 之前，由各端的 C 桥接层向 Cheng 注册“能力回调”：

```c
// 操作系统能力的抽象接口
typedef struct {
    // 宿主去读文件，返回内存在共享数组中的 ID 和 长度
    uint64_t (*read_asset)(int asset_id, int* out_len); 
    void (*log_print)(int level, const char* msg);      
} HostPlatformAPI;

// 宿主启动时第一件事，把操作系统的能力“喂”给 Cheng
cheng_app_inject_host_api(my_android_api_struct);

```

#### 深水区二：高频输入事件的“GC 风暴”

**痛点**：在 120Hz 刷新率下，用户滑动屏幕会产生海量的 `Touch` 事件。如果每次触摸都通过 JNI/N-API 去包装对象并调用 `cheng_app_on_touch`，会产生巨大的 FFI 开销和内存垃圾，导致画面卡顿。
**DOD 极客解法（共享环形缓冲区）**：

1. Cheng 在启动时，分配一块静态的 1MB 字节数组（`uint8_t*`）作为**环形事件队列 (Ring Buffer)**。
2. 通过 JNI 的 `GetDirectBufferAddress`（Android）或 ArrayBuffer 映射（鸿蒙），把这块内存直接暴露给 Kotlin/ArkTS。
3. 宿主收到触摸事件时，**绝对不调用 FFI 函数**。而是直接把 `[x, y, action, time]` 的二进制数据写入这块共享内存，并原级递增一个 `AtomicInt` 游标。
4. Cheng 的 `cheng_app_tick()` 每一帧执行时，直接去内存里消费这段队列。**实现绝对的零拷贝、零 FFI 开销的输入处理！**

---

### 第四层：隐藏在 CLI 后的终极开发体验

开发者极其痛恨配置 Android NDK 和 Xcode 签名。要让 Cheng 流行，必须在 `src/tooling/build_mobile_export.sh` 中实现**黑盒化构建**。

当用户执行 `chengc run android` 或 `chengc run ios` 时，CLI 工具应该：

1. **静默拉取壳工程**：在 `.cheng_build/` 目录下释放预先写好的 Android/iOS/Harmony 标准宿主工程模板（壳子）。
2. **C Backend 生成**：将用户的 Cheng 代码编译为纯 C 源码，拷贝到壳工程的 `src/main/cpp` 目录下。
3. **后台驱动官方链**：
* 调起 `gradlew assembleDebug` (Android)
* 调起 `xcodebuild` (iOS)
* 调起 `hvigorw assembleHap` (鸿蒙)


4. **一键上机**：自动调用 `adb install` / `xcrun simctl`，直接在真机或模拟器上启动，并将日志重定向回开发者的终端。

用户仿佛只是在编译一个普通的脚本，但实际上已经完成了一个高性能、自绘图形栈的跨端移动应用部署。