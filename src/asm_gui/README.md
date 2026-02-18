# Cheng ASM GUI

Minimal cross-platform GUI ABI implemented in pure assembly.

## API
- `int32_t cheng_gui_init(void)`
- `void *cheng_gui_window_create(const char *title, int32_t width, int32_t height)`
- `int32_t cheng_gui_window_show(void *window)`
- `int32_t cheng_gui_label_add(void *window, const char *text, int32_t x, int32_t y, int32_t w, int32_t h)`
- `int32_t cheng_gui_run(void)`
- `void cheng_gui_shutdown(void)`

## Platforms
- macOS arm64: Objective-C runtime + AppKit (`gui_macos_arm64.s`)
- iOS arm64: UIKit runtime bridge, host must run UIApplicationMain (`gui_ios_arm64.s`)
- Windows x64: Win32 API window + STATIC label (`gui_windows_x64.s`)
- Linux x64: GTK3 window + fixed layout + label (`gui_linux_x64.s`)
- Android/Harmony: mobile host bridge + text renderer (`chengGuiNativeDrawTextBgra`)

## Build
```
CHENG_GUI_PLATFORM=macos CHENG_GUI_ARCH=arm64 ./build_asm_gui.sh
```
Outputs `build/libcheng_asm_gui_<platform>_<arch>.a`.

Android/Harmony builds should set `CC` and `CHENG_GUI_TARGET`/`CHENG_GUI_SYSROOT`
(or `CHENG_GUI_CCFLAGS`) to the target toolchain (e.g. NDK clang
`--target=aarch64-linux-android`), and link against the mobile host bridge +
text renderer.

Android closed-loop build (mobile host + asm gui):
```
./build_android_host.sh
```
This enables `cheng_mobile_app_main` from `asm_gui_mobile_entry.c`.

Harmony closed-loop build (mobile host + asm gui):
```
./build_harmony_host.sh
```
Set `OHOS_TOOLCHAIN_FILE` to your Harmony toolchain for cross builds.
Harmony apps should call:
- `cheng_harmony_start` to launch the asm_gui entry thread.
- `cheng_harmony_set_presenter` to provide a pixel-present callback.
- `cheng_harmony_set_surface_size` to update size.
- `cheng_harmony_emit_*` to forward input/frame events.
