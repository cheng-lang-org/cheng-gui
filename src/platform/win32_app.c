#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <imm.h>

typedef struct ChengGuiWinWindow ChengGuiWinWindow;
typedef struct ChengGuiWinSurface ChengGuiWinSurface;

typedef struct {
  int kind;
  void *window;
  double x;
  double y;
  double width;
  double height;
  double deltaX;
  double deltaY;
  unsigned int modifiers;
  int button;
  unsigned int keyCode;
  bool repeatFlag;
  char text[64];
} ChengGuiWinEvent;

typedef struct {
  double logicalWidth;
  double logicalHeight;
  double pixelWidth;
  double pixelHeight;
  double scale;
  const char *colorSpace;
} ChengGuiWinSurfaceInfo;

enum {
  ChengGuiWinEventNone = 0,
  ChengGuiWinEventClose = 1,
  ChengGuiWinEventResized = 2,
  ChengGuiWinEventMoved = 3,
  ChengGuiWinEventKeyDown = 4,
  ChengGuiWinEventKeyUp = 5,
  ChengGuiWinEventTextInput = 6,
  ChengGuiWinEventPointerDown = 7,
  ChengGuiWinEventPointerUp = 8,
  ChengGuiWinEventPointerMove = 9,
  ChengGuiWinEventPointerScroll = 10
};

#define CHENG_GUI_WIN_MOD_SHIFT 0x1u
#define CHENG_GUI_WIN_MOD_CTRL  0x2u
#define CHENG_GUI_WIN_MOD_ALT   0x4u
#define CHENG_GUI_WIN_MOD_META  0x8u

struct ChengGuiWinWindow {
  HWND hwnd;
  double dpi;
  double logicalWidth;
  double logicalHeight;
  double pixelWidth;
  double pixelHeight;
  double lastPointerX;
  double lastPointerY;
  bool hasPointer;
  bool hasPendingSurrogate;
  WCHAR pendingHighSurrogate;
  bool highDpi;
  bool resizable;
  bool destroyed;
};

struct ChengGuiWinSurface {
  ChengGuiWinWindow *window;
  HDC hdc;
};

static const char *kChengGuiWinColorSpace = "sRGB";
static const wchar_t *kChengGuiWinClassName = L"ChengGuiWindow";
static HINSTANCE gChengGuiWinInstance = NULL;
static ATOM gChengGuiWinClassAtom = 0;
static bool gChengGuiWinClassRegistered = false;
static bool gChengGuiWinDpiInitialized = false;

typedef BOOL (WINAPI *SetProcessDpiAwarenessContextFn)(HANDLE);
typedef UINT (WINAPI *GetDpiForWindowFn)(HWND);
typedef UINT (WINAPI *GetDpiForSystemFn)(void);

static SetProcessDpiAwarenessContextFn gSetProcessDpiAwarenessContext = NULL;
static GetDpiForWindowFn gGetDpiForWindow = NULL;
static GetDpiForSystemFn gGetDpiForSystem = NULL;

#ifndef DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
#define DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 ((HANDLE)-4)
#endif

#ifndef WM_MOUSEHWHEEL
#define WM_MOUSEHWHEEL 0x020E
#endif

static ChengGuiWinEvent gChengGuiWinEventQueue[256];
static int gChengGuiWinEventCount = 0;

static double chengGuiWinClampScale(double scale) {
  if (scale < 0.25) {
    return 0.25;
  }
  return scale;
}

static double chengGuiWinWindowScale(const ChengGuiWinWindow *window) {
  double dpi = 96.0;
  if (window != NULL && window->dpi > 0.0) {
    dpi = window->dpi;
  }
  return chengGuiWinClampScale(dpi / 96.0);
}

static void chengGuiWinPushEvent(const ChengGuiWinEvent *event) {
  if (gChengGuiWinEventCount >= (int)(sizeof(gChengGuiWinEventQueue) / sizeof(gChengGuiWinEventQueue[0]))) {
    return;
  }
  gChengGuiWinEventQueue[gChengGuiWinEventCount++] = *event;
}

static ChengGuiWinEvent chengGuiWinMakeEvent(ChengGuiWinWindow *window, int kind) {
  ChengGuiWinEvent ev;
  memset(&ev, 0, sizeof(ev));
  ev.kind = kind;
  ev.window = (void *)window;
  ev.button = -1;
  ev.modifiers = 0;
  return ev;
}

static unsigned int chengGuiWinCurrentModifiers(void) {
  unsigned int mods = 0;
  if ((GetKeyState(VK_SHIFT) & 0x8000) != 0) {
    mods |= CHENG_GUI_WIN_MOD_SHIFT;
  }
  if ((GetKeyState(VK_CONTROL) & 0x8000) != 0) {
    mods |= CHENG_GUI_WIN_MOD_CTRL;
  }
  if ((GetKeyState(VK_MENU) & 0x8000) != 0) {
    mods |= CHENG_GUI_WIN_MOD_ALT;
  }
  if ((GetKeyState(VK_LWIN) & 0x8000) != 0 || (GetKeyState(VK_RWIN) & 0x8000) != 0) {
    mods |= CHENG_GUI_WIN_MOD_META;
  }
  return mods;
}

static void chengGuiWinEnsureDpiContext(void) {
  if (gChengGuiWinDpiInitialized) {
    return;
  }
  gChengGuiWinDpiInitialized = true;
  HMODULE user32 = LoadLibraryA("user32.dll");
  if (user32 != NULL) {
    gSetProcessDpiAwarenessContext = (SetProcessDpiAwarenessContextFn)GetProcAddress(
      user32,
      "SetProcessDpiAwarenessContext"
    );
    gGetDpiForWindow = (GetDpiForWindowFn)GetProcAddress(user32, "GetDpiForWindow");
    gGetDpiForSystem = (GetDpiForSystemFn)GetProcAddress(user32, "GetDpiForSystem");
  }
  if (gSetProcessDpiAwarenessContext != NULL) {
    gSetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  }
}

static double chengGuiWinQueryDpi(HWND hwnd) {
  if (gGetDpiForWindow != NULL && hwnd != NULL) {
    UINT dpiValue = gGetDpiForWindow(hwnd);
    if (dpiValue != 0) {
      return (double)dpiValue;
    }
  }
  if (gGetDpiForSystem != NULL) {
    UINT dpiValue = gGetDpiForSystem();
    if (dpiValue != 0) {
      return (double)dpiValue;
    }
  }
  HDC screen = GetDC(NULL);
  double dpi = 96.0;
  if (screen != NULL) {
    dpi = (double)GetDeviceCaps(screen, LOGPIXELSX);
    ReleaseDC(NULL, screen);
  }
  if (dpi <= 0.0) {
    dpi = 96.0;
  }
  return dpi;
}

static void chengGuiWinUpdateLogicalSize(ChengGuiWinWindow *window, double pixelWidth, double pixelHeight) {
  if (window == NULL) {
    return;
  }
  window->pixelWidth = pixelWidth;
  window->pixelHeight = pixelHeight;
  const double scale = chengGuiWinWindowScale(window);
  window->logicalWidth = pixelWidth / scale;
  window->logicalHeight = pixelHeight / scale;
}

static void chengGuiWinPushResizeEvent(ChengGuiWinWindow *window) {
  if (window == NULL) {
    return;
  }
  ChengGuiWinEvent ev = chengGuiWinMakeEvent(window, ChengGuiWinEventResized);
  ev.width = window->logicalWidth;
  ev.height = window->logicalHeight;
  chengGuiWinPushEvent(&ev);
}

static void chengGuiWinPushMoveEvent(ChengGuiWinWindow *window, double x, double y) {
  ChengGuiWinEvent ev = chengGuiWinMakeEvent(window, ChengGuiWinEventMoved);
  ev.x = x;
  ev.y = y;
  chengGuiWinPushEvent(&ev);
}

static void chengGuiWinPushPointerEvent(
    ChengGuiWinWindow *window,
    int kind,
    int button,
    double logicalX,
    double logicalY,
    double deltaX,
    double deltaY
) {
  ChengGuiWinEvent ev = chengGuiWinMakeEvent(window, kind);
  ev.x = logicalX;
  ev.y = logicalY;
  ev.deltaX = deltaX;
  ev.deltaY = deltaY;
  ev.button = button;
  ev.modifiers = chengGuiWinCurrentModifiers();
  chengGuiWinPushEvent(&ev);
}

static void chengGuiWinPushScrollEvent(
    ChengGuiWinWindow *window,
    double logicalX,
    double logicalY,
    double deltaX,
    double deltaY
) {
  ChengGuiWinEvent ev = chengGuiWinMakeEvent(window, ChengGuiWinEventPointerScroll);
  ev.x = logicalX;
  ev.y = logicalY;
  ev.deltaX = deltaX;
  ev.deltaY = deltaY;
  ev.modifiers = chengGuiWinCurrentModifiers();
  chengGuiWinPushEvent(&ev);
}

static void chengGuiWinPushKeyEvent(ChengGuiWinWindow *window, int kind, unsigned int keyCode, bool repeatFlag) {
  ChengGuiWinEvent ev = chengGuiWinMakeEvent(window, kind);
  ev.keyCode = keyCode;
  ev.repeatFlag = repeatFlag;
  ev.modifiers = chengGuiWinCurrentModifiers();
  chengGuiWinPushEvent(&ev);
}

static bool chengGuiWinIsHighSurrogate(uint32_t value) {
  return value >= 0xD800u && value <= 0xDBFFu;
}

static bool chengGuiWinIsLowSurrogate(uint32_t value) {
  return value >= 0xDC00u && value <= 0xDFFFu;
}

static uint32_t chengGuiWinDecodeSurrogates(uint32_t high, uint32_t low) {
  uint32_t hi = high - 0xD800u;
  uint32_t lo = low - 0xDC00u;
  return (hi << 10) + lo + 0x10000u;
}

static int chengGuiWinEncodeUtf8(uint32_t codepoint, char *out) {
  if (codepoint <= 0x7Fu) {
    out[0] = (char)codepoint;
    out[1] = '\0';
    return 1;
  }
  if (codepoint <= 0x7FFu) {
    out[0] = (char)(0xC0u | ((codepoint >> 6) & 0x1Fu));
    out[1] = (char)(0x80u | (codepoint & 0x3Fu));
    out[2] = '\0';
    return 2;
  }
  if (codepoint <= 0xFFFFu) {
    out[0] = (char)(0xE0u | ((codepoint >> 12) & 0x0Fu));
    out[1] = (char)(0x80u | ((codepoint >> 6) & 0x3Fu));
    out[2] = (char)(0x80u | (codepoint & 0x3Fu));
    out[3] = '\0';
    return 3;
  }
  if (codepoint <= 0x10FFFFu) {
    out[0] = (char)(0xF0u | ((codepoint >> 18) & 0x07u));
    out[1] = (char)(0x80u | ((codepoint >> 12) & 0x3Fu));
    out[2] = (char)(0x80u | ((codepoint >> 6) & 0x3Fu));
    out[3] = (char)(0x80u | (codepoint & 0x3Fu));
    out[4] = '\0';
    return 4;
  }
  return 0;
}

static void chengGuiWinPushTextEvent(ChengGuiWinWindow *window, uint32_t codepoint) {
  if (codepoint < 32u && codepoint != 9u && codepoint != 10u && codepoint != 13u) {
    return;
  }
  ChengGuiWinEvent ev = chengGuiWinMakeEvent(window, ChengGuiWinEventTextInput);
  chengGuiWinEncodeUtf8(codepoint, ev.text);
  chengGuiWinPushEvent(&ev);
}

static void chengGuiWinPushUtf16Text(ChengGuiWinWindow *window, const WCHAR *text, int length) {
  if (window == NULL || text == NULL || length <= 0) {
    return;
  }
  int index = 0;
  while (index < length) {
    uint32_t value = (uint32_t)text[index];
    index += 1;
    if (chengGuiWinIsHighSurrogate(value)) {
      if (index < length) {
        uint32_t low = (uint32_t)text[index];
        if (chengGuiWinIsLowSurrogate(low)) {
          value = chengGuiWinDecodeSurrogates(value, low);
          index += 1;
        }
      }
    }
    chengGuiWinPushTextEvent(window, value);
  }
}

static void chengGuiWinHandleCharMessage(ChengGuiWinWindow *window, uint32_t value) {
  if (window == NULL) {
    return;
  }
  if (chengGuiWinIsHighSurrogate(value)) {
    window->pendingHighSurrogate = (WCHAR)value;
    window->hasPendingSurrogate = true;
    return;
  }
  if (chengGuiWinIsLowSurrogate(value) && window->hasPendingSurrogate) {
    uint32_t codepoint = chengGuiWinDecodeSurrogates(
      (uint32_t)window->pendingHighSurrogate,
      value
    );
    window->hasPendingSurrogate = false;
    chengGuiWinPushTextEvent(window, codepoint);
    return;
  }
  window->hasPendingSurrogate = false;
  chengGuiWinPushTextEvent(window, value);
}

static void chengGuiWinResetPointer(ChengGuiWinWindow *window) {
  if (window == NULL) {
    return;
  }
  window->hasPointer = false;
}

static void chengGuiWinUpdatePointerDelta(
    ChengGuiWinWindow *window,
    double logicalX,
    double logicalY,
    double *outDeltaX,
    double *outDeltaY
) {
  if (window == NULL || outDeltaX == NULL || outDeltaY == NULL) {
    return;
  }
  if (window->hasPointer) {
    *outDeltaX = logicalX - window->lastPointerX;
    *outDeltaY = logicalY - window->lastPointerY;
  } else {
    *outDeltaX = 0.0;
    *outDeltaY = 0.0;
  }
  window->lastPointerX = logicalX;
  window->lastPointerY = logicalY;
  window->hasPointer = true;
}

static void chengGuiWinTrackMouse(HWND hwnd) {
  TRACKMOUSEEVENT tme;
  memset(&tme, 0, sizeof(tme));
  tme.cbSize = sizeof(tme);
  tme.dwFlags = TME_LEAVE;
  tme.hwndTrack = hwnd;
  TrackMouseEvent(&tme);
}

static void chengGuiWinHandlePointerMessage(
    ChengGuiWinWindow *window,
    HWND hwnd,
    UINT message,
    WPARAM wParam,
    LPARAM lParam
) {
  if (window == NULL) {
    return;
  }
  const double scale = chengGuiWinWindowScale(window);
  double deltaX = 0.0;
  double deltaY = 0.0;
  double logicalX = (double)GET_X_LPARAM(lParam) / scale;
  double logicalY = (double)GET_Y_LPARAM(lParam) / scale;
  chengGuiWinUpdatePointerDelta(window, logicalX, logicalY, &deltaX, &deltaY);
  int button = -1;
  int kind = ChengGuiWinEventPointerMove;
  switch (message) {
    case WM_LBUTTONDOWN:
      button = 0;
      kind = ChengGuiWinEventPointerDown;
      SetCapture(hwnd);
      break;
    case WM_LBUTTONUP:
      button = 0;
      kind = ChengGuiWinEventPointerUp;
      ReleaseCapture();
      break;
    case WM_RBUTTONDOWN:
      button = 1;
      kind = ChengGuiWinEventPointerDown;
      SetCapture(hwnd);
      break;
    case WM_RBUTTONUP:
      button = 1;
      kind = ChengGuiWinEventPointerUp;
      ReleaseCapture();
      break;
    case WM_MBUTTONDOWN:
      button = 2;
      kind = ChengGuiWinEventPointerDown;
      SetCapture(hwnd);
      break;
    case WM_MBUTTONUP:
      button = 2;
      kind = ChengGuiWinEventPointerUp;
      ReleaseCapture();
      break;
    case WM_XBUTTONDOWN:
      button = (HIWORD(wParam) == XBUTTON1) ? 3 : 4;
      kind = ChengGuiWinEventPointerDown;
      SetCapture(hwnd);
      break;
    case WM_XBUTTONUP:
      button = (HIWORD(wParam) == XBUTTON1) ? 3 : 4;
      kind = ChengGuiWinEventPointerUp;
      ReleaseCapture();
      break;
    case WM_MOUSEMOVE:
      kind = ChengGuiWinEventPointerMove;
      break;
    default:
      break;
  }
  chengGuiWinPushPointerEvent(window, kind, button, logicalX, logicalY, deltaX, deltaY);
  chengGuiWinTrackMouse(hwnd);
}

static void chengGuiWinHandleScrollMessage(
    ChengGuiWinWindow *window,
    HWND hwnd,
    UINT message,
    WPARAM wParam,
    LPARAM lParam
) {
  if (window == NULL) {
    return;
  }
  POINT pt;
  pt.x = GET_X_LPARAM(lParam);
  pt.y = GET_Y_LPARAM(lParam);
  ScreenToClient(hwnd, &pt);
  const double scale = chengGuiWinWindowScale(window);
  double logicalX = (double)pt.x / scale;
  double logicalY = (double)pt.y / scale;
  double deltaX = 0.0;
  double deltaY = 0.0;
  const double wheelDelta = (double)GET_WHEEL_DELTA_WPARAM(wParam) / 120.0;
  if (message == WM_MOUSEHWHEEL) {
    deltaX = wheelDelta;
  } else {
    deltaY = wheelDelta;
  }
  chengGuiWinPushScrollEvent(window, logicalX, logicalY, deltaX, deltaY);
}

static void chengGuiWinEnsureWindowClass(void);

static LRESULT CALLBACK ChengGuiWinWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  ChengGuiWinWindow *window = (ChengGuiWinWindow *)GetWindowLongPtrW(hwnd, GWLP_USERDATA);
  switch (message) {
    case WM_NCCREATE: {
      CREATESTRUCTW *create = (CREATESTRUCTW *)lParam;
      ChengGuiWinWindow *wrapper = (ChengGuiWinWindow *)create->lpCreateParams;
      if (wrapper != NULL) {
        wrapper->hwnd = hwnd;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, (LONG_PTR)wrapper);
        wrapper->dpi = chengGuiWinQueryDpi(hwnd);
        RECT rc;
        GetClientRect(hwnd, &rc);
        chengGuiWinUpdateLogicalSize(
          wrapper,
          (double)(rc.right - rc.left),
          (double)(rc.bottom - rc.top)
        );
      }
      return TRUE;
    }
    case WM_NCDESTROY:
      if (window != NULL) {
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        free(window);
      }
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_DESTROY:
      if (window != NULL) {
        window->destroyed = true;
      }
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_CLOSE:
      if (window != NULL) {
        ChengGuiWinEvent ev = chengGuiWinMakeEvent(window, ChengGuiWinEventClose);
        chengGuiWinPushEvent(&ev);
      }
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_MOVE:
      if (window != NULL) {
        const double x = (double)GET_X_LPARAM(lParam);
        const double y = (double)GET_Y_LPARAM(lParam);
        chengGuiWinPushMoveEvent(window, x, y);
      }
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_SIZE:
      if (window != NULL) {
        const double widthPx = (double)LOWORD(lParam);
        const double heightPx = (double)HIWORD(lParam);
        chengGuiWinUpdateLogicalSize(window, widthPx, heightPx);
        chengGuiWinPushResizeEvent(window);
      }
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_DPICHANGED:
      if (window != NULL) {
        UINT dpiX = LOWORD(wParam);
        if (dpiX == 0) {
          dpiX = HIWORD(wParam);
        }
        if (dpiX != 0) {
          window->dpi = (double)dpiX;
        } else {
          window->dpi = chengGuiWinQueryDpi(hwnd);
        }
        RECT *suggested = (RECT *)lParam;
        if (suggested != NULL) {
          SetWindowPos(
            hwnd,
            NULL,
            suggested->left,
            suggested->top,
            suggested->right - suggested->left,
            suggested->bottom - suggested->top,
            SWP_NOZORDER | SWP_NOACTIVATE
          );
        }
        RECT rc;
        GetClientRect(hwnd, &rc);
        chengGuiWinUpdateLogicalSize(
          window,
          (double)(rc.right - rc.left),
          (double)(rc.bottom - rc.top)
        );
        chengGuiWinPushResizeEvent(window);
      }
      return 0;
    case WM_MOUSELEAVE:
      chengGuiWinResetPointer(window);
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_MOUSEMOVE:
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_RBUTTONDOWN:
    case WM_RBUTTONUP:
    case WM_MBUTTONDOWN:
    case WM_MBUTTONUP:
    case WM_XBUTTONDOWN:
    case WM_XBUTTONUP:
      chengGuiWinHandlePointerMessage(window, hwnd, message, wParam, lParam);
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
      chengGuiWinHandleScrollMessage(window, hwnd, message, wParam, lParam);
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
      chengGuiWinPushKeyEvent(window, ChengGuiWinEventKeyDown, (unsigned int)wParam, (HIWORD(lParam) & KF_REPEAT) != 0);
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_KEYUP:
    case WM_SYSKEYUP:
      if (window != NULL) {
        window->hasPendingSurrogate = false;
      }
      chengGuiWinPushKeyEvent(window, ChengGuiWinEventKeyUp, (unsigned int)wParam, false);
      return DefWindowProcW(hwnd, message, wParam, lParam);
    case WM_IME_COMPOSITION:
      if (window != NULL && (lParam & GCS_RESULTSTR) != 0) {
        HIMC imc = ImmGetContext(hwnd);
        if (imc != NULL) {
          LONG bytes = ImmGetCompositionStringW(imc, GCS_RESULTSTR, NULL, 0);
          if (bytes > 0) {
            int chars = (int)((bytes + sizeof(WCHAR) - 1) / (int)sizeof(WCHAR));
            WCHAR *buffer = (WCHAR *)malloc((size_t)(chars + 1) * sizeof(WCHAR));
            if (buffer != NULL) {
              memset(buffer, 0, (size_t)(chars + 1) * sizeof(WCHAR));
              LONG written = ImmGetCompositionStringW(imc, GCS_RESULTSTR, buffer, bytes);
              if (written > 0) {
                int length = (int)(written / (LONG)sizeof(WCHAR));
                chengGuiWinPushUtf16Text(window, buffer, length);
              }
              free(buffer);
            }
          }
          ImmReleaseContext(hwnd, imc);
        }
      }
      return 0;
    case WM_CHAR:
    case WM_SYSCHAR:
      chengGuiWinHandleCharMessage(window, (uint32_t)(wParam & 0xFFFFu));
      return 0;
    default:
      return DefWindowProcW(hwnd, message, wParam, lParam);
  }
}

static void chengGuiWinEnsureWindowClass(void) {
  if (gChengGuiWinClassRegistered) {
    return;
  }
  chengGuiWinEnsureDpiContext();
  gChengGuiWinInstance = GetModuleHandleW(NULL);
  WNDCLASSEXW wc;
  memset(&wc, 0, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.style = CS_HREDRAW | CS_VREDRAW;
  wc.lpfnWndProc = ChengGuiWinWndProc;
  wc.cbClsExtra = 0;
  wc.cbWndExtra = 0;
  wc.hInstance = gChengGuiWinInstance;
  wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
  wc.hbrBackground = NULL;
  wc.lpszClassName = kChengGuiWinClassName;
  gChengGuiWinClassAtom = RegisterClassExW(&wc);
  if (gChengGuiWinClassAtom != 0) {
    gChengGuiWinClassRegistered = true;
  }
}

static WCHAR *chengGuiWinUtf8ToWide(const char *utf8) {
  if (utf8 == NULL) {
    return NULL;
  }
  int required = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
  if (required <= 0) {
    return NULL;
  }
  WCHAR *buffer = (WCHAR *)calloc((size_t)required, sizeof(WCHAR));
  if (buffer == NULL) {
    return NULL;
  }
  if (MultiByteToWideChar(CP_UTF8, 0, utf8, -1, buffer, required) <= 0) {
    free(buffer);
    return NULL;
  }
  return buffer;
}

static int chengGuiWinDrainEvents(ChengGuiWinEvent *events, int maxEvents) {
  if (maxEvents <= 0 || gChengGuiWinEventCount == 0) {
    return 0;
  }
  int count = gChengGuiWinEventCount;
  if (count > maxEvents) {
    count = maxEvents;
  }
  memcpy(events, gChengGuiWinEventQueue, sizeof(ChengGuiWinEvent) * (size_t)count);
  if (count < gChengGuiWinEventCount) {
    const int remaining = gChengGuiWinEventCount - count;
    memmove(
      gChengGuiWinEventQueue,
      gChengGuiWinEventQueue + count,
      sizeof(ChengGuiWinEvent) * (size_t)remaining
    );
    gChengGuiWinEventCount = remaining;
  } else {
    gChengGuiWinEventCount = 0;
  }
  return count;
}

__declspec(dllexport) void chengGuiWinInitialize(void) {
  chengGuiWinEnsureWindowClass();
}

__declspec(dllexport) void chengGuiWinShutdown(void) {
  if (gChengGuiWinClassRegistered) {
    UnregisterClassW(kChengGuiWinClassName, gChengGuiWinInstance);
    gChengGuiWinClassRegistered = false;
    gChengGuiWinClassAtom = 0;
  }
  gChengGuiWinEventCount = 0;
}

__declspec(dllexport) void *chengGuiWinCreateWindow(
    const char *title,
    double x,
    double y,
    double width,
    double height,
    bool resizable,
    bool highDpi
) {
  chengGuiWinEnsureWindowClass();
  if (!gChengGuiWinClassRegistered) {
    return NULL;
  }
  ChengGuiWinWindow *window = (ChengGuiWinWindow *)calloc(1, sizeof(ChengGuiWinWindow));
  if (window == NULL) {
    return NULL;
  }
  window->highDpi = highDpi;
  window->resizable = resizable;
  DWORD style = WS_OVERLAPPEDWINDOW;
  DWORD exStyle = 0;
  if (!resizable) {
    style &= ~WS_THICKFRAME;
    style &= ~WS_MAXIMIZEBOX;
  }

  WCHAR *wideTitle = chengGuiWinUtf8ToWide(title != NULL && title[0] != '\0' ? title : "Cheng IDE");
  if (wideTitle == NULL) {
    wideTitle = chengGuiWinUtf8ToWide("Cheng IDE");
  }

  HWND hwnd = CreateWindowExW(
    exStyle,
    kChengGuiWinClassName,
    wideTitle,
    style,
    (int)x,
    (int)y,
    (int)width,
    (int)height,
    NULL,
    NULL,
    gChengGuiWinInstance,
    window
  );

  if (wideTitle != NULL) {
    free(wideTitle);
  }

  if (hwnd == NULL) {
    free(window);
    return NULL;
  }

  window->hwnd = hwnd;
  window->dpi = chengGuiWinQueryDpi(hwnd);
  chengGuiWinUpdateLogicalSize(window, width, height);
  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);
  return (void *)window;
}

__declspec(dllexport) void *chengGuiWinCreateDefaultWindow(const char *title) {
  return chengGuiWinCreateWindow(title, 100.0, 100.0, 1280.0, 800.0, true, true);
}

__declspec(dllexport) void chengGuiWinDestroyWindow(void *handle) {
  if (handle == NULL) {
    return;
  }
  ChengGuiWinWindow *window = (ChengGuiWinWindow *)handle;
  HWND hwnd = window->hwnd;
  if (hwnd != NULL) {
    DestroyWindow(hwnd);
  } else {
    free(window);
  }
}

__declspec(dllexport) int chengGuiWinPollEvents(ChengGuiWinEvent *events, int maxEvents, int timeoutMs) {
  MSG msg;
  while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
    if (msg.message == WM_QUIT) {
      break;
    }
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  int drained = chengGuiWinDrainEvents(events, maxEvents);
  if (drained == 0 && timeoutMs > 0) {
    Sleep((DWORD)timeoutMs);
  }
  return drained;
}

__declspec(dllexport) void *chengGuiWinCreateSurface(void *handle) {
  if (handle == NULL) {
    return NULL;
  }
  ChengGuiWinWindow *window = (ChengGuiWinWindow *)handle;
  if (window->hwnd == NULL) {
    return NULL;
  }
  HDC hdc = GetDC(window->hwnd);
  if (hdc == NULL) {
    return NULL;
  }
  ChengGuiWinSurface *surface = (ChengGuiWinSurface *)calloc(1, sizeof(ChengGuiWinSurface));
  if (surface == NULL) {
    ReleaseDC(window->hwnd, hdc);
    return NULL;
  }
  surface->window = window;
  surface->hdc = hdc;
  return (void *)surface;
}

__declspec(dllexport) void chengGuiWinDestroySurface(void *handle) {
  if (handle == NULL) {
    return;
  }
  ChengGuiWinSurface *surface = (ChengGuiWinSurface *)handle;
  if (surface->window != NULL && surface->window->hwnd != NULL && surface->hdc != NULL) {
    ReleaseDC(surface->window->hwnd, surface->hdc);
  }
  free(surface);
}

__declspec(dllexport) int chengGuiWinBeginFrame(void *handle) {
  if (handle == NULL) {
    return -1;
  }
  ChengGuiWinSurface *surface = (ChengGuiWinSurface *)handle;
  ChengGuiWinWindow *window = surface->window;
  if (window == NULL || window->hwnd == NULL || surface->hdc == NULL) {
    return -2;
  }
  RECT rc;
  if (!GetClientRect(window->hwnd, &rc)) {
    return -3;
  }
  chengGuiWinUpdateLogicalSize(
    window,
    (double)(rc.right - rc.left),
    (double)(rc.bottom - rc.top)
  );
  const COLORREF color = RGB(0x1E, 0x1E, 0x22);
  HBRUSH brush = CreateSolidBrush(color);
  if (brush == NULL) {
    return -4;
  }
  FillRect(surface->hdc, &rc, brush);
  DeleteObject(brush);
  return 0;
}

__declspec(dllexport) int chengGuiWinEndFrame(void *handle) {
  if (handle == NULL) {
    return -1;
  }
  ChengGuiWinSurface *surface = (ChengGuiWinSurface *)handle;
  ChengGuiWinWindow *window = surface->window;
  if (window == NULL || window->hwnd == NULL) {
    return -2;
  }
  RECT rc;
  if (GetClientRect(window->hwnd, &rc)) {
    ValidateRect(window->hwnd, &rc);
  }
  return 0;
}

__declspec(dllexport) int chengGuiWinGetSurfaceInfo(void *handle, ChengGuiWinSurfaceInfo *info) {
  if (handle == NULL || info == NULL) {
    return -1;
  }
  ChengGuiWinSurface *surface = (ChengGuiWinSurface *)handle;
  ChengGuiWinWindow *window = surface->window;
  if (window == NULL || window->hwnd == NULL) {
    return -2;
  }
  RECT rc;
  if (!GetClientRect(window->hwnd, &rc)) {
    return -3;
  }
  chengGuiWinUpdateLogicalSize(
    window,
    (double)(rc.right - rc.left),
    (double)(rc.bottom - rc.top)
  );
  info->pixelWidth = window->pixelWidth;
  info->pixelHeight = window->pixelHeight;
  info->logicalWidth = window->logicalWidth;
  info->logicalHeight = window->logicalHeight;
  info->scale = chengGuiWinWindowScale(window);
  info->colorSpace = kChengGuiWinColorSpace;
  return 0;
}

__declspec(dllexport) int chengGuiWinPresentPixels(void *handle,
                                                   const uint32_t *pixels,
                                                   int width,
                                                   int height,
                                                   int strideBytes) {
  if (handle == NULL || pixels == NULL) {
    return -1;
  }
  if (width <= 0 || height <= 0) {
    return -2;
  }
  ChengGuiWinSurface *surface = (ChengGuiWinSurface *)handle;
  ChengGuiWinWindow *window = surface->window;
  if (window == NULL || window->hwnd == NULL || surface->hdc == NULL) {
    return -3;
  }
  const int expectedStride = width * 4;
  if (strideBytes <= 0) {
    strideBytes = expectedStride;
  }

  const uint8_t *srcBytes = (const uint8_t *)pixels;
  const void *data = pixels;
  void *packed = NULL;
  if (strideBytes != expectedStride) {
    size_t total = (size_t)expectedStride * (size_t)height;
    packed = malloc(total);
    if (packed == NULL) {
      return -4;
    }
    uint8_t *dst = (uint8_t *)packed;
    for (int y = 0; y < height; y++) {
      memcpy(dst + (size_t)y * (size_t)expectedStride,
             srcBytes + (size_t)y * (size_t)strideBytes,
             (size_t)expectedStride);
    }
    data = packed;
  }

  BITMAPINFO bmi;
  memset(&bmi, 0, sizeof(bmi));
  bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bmi.bmiHeader.biWidth = width;
  bmi.bmiHeader.biHeight = -height; // top-down
  bmi.bmiHeader.biPlanes = 1;
  bmi.bmiHeader.biBitCount = 32;
  bmi.bmiHeader.biCompression = BI_RGB;

  int destW = width;
  int destH = height;
  if (destW <= 0) destW = (int)(window->pixelWidth + 0.5);
  if (destH <= 0) destH = (int)(window->pixelHeight + 0.5);

  int rc = StretchDIBits(surface->hdc,
                         0,
                         0,
                         destW,
                         destH,
                         0,
                         0,
                         width,
                         height,
                         data,
                         &bmi,
                         DIB_RGB_COLORS,
                         SRCCOPY);

  if (packed != NULL) {
    free(packed);
  }
  if (rc == GDI_ERROR) {
    return -5;
  }
  return 0;
}

__declspec(dllexport) size_t chengGuiWinEventStructSize(void) {
  return sizeof(ChengGuiWinEvent);
}

__declspec(dllexport) size_t chengGuiWinSurfaceInfoStructSize(void) {
  return sizeof(ChengGuiWinSurfaceInfo);
}

__declspec(dllexport) int chengGuiNativeTextAvailable(void) {
  return 0;
}

__declspec(dllexport) const char *chengGuiNativeTextBackend(void) {
  return "unavailable";
}

__declspec(dllexport) int chengGuiIconFontAvailable(void) {
  return 0;
}

__declspec(dllexport) int chengGuiFileIconFontAvailable(void) {
  return 0;
}

__declspec(dllexport) int chengGuiDrawTextBgra(void *pixels,
                                              int width,
                                              int height,
                                              int strideBytes,
                                              double x,
                                              double y,
                                              double w,
                                              double h,
                                              uint32_t color,
                                              double fontSize,
                                              const char *text) {
  (void)pixels;
  (void)width;
  (void)height;
  (void)strideBytes;
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  (void)color;
  (void)fontSize;
  (void)text;
  return -1;
}

__declspec(dllexport) double chengGuiTextWidth(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

__declspec(dllexport) double chengGuiTextWidthCode(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

__declspec(dllexport) double chengGuiTextWidthIcon(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

__declspec(dllexport) double chengGuiTextWidthFileIcon(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

__declspec(dllexport) double chengGuiTextXAtIndex(const char *text, double fontSize, int32_t byteIndex) {
  (void)text;
  (void)fontSize;
  (void)byteIndex;
  return 0.0;
}

__declspec(dllexport) double chengGuiTextXAtIndexCode(const char *text, double fontSize, int32_t byteIndex) {
  (void)text;
  (void)fontSize;
  (void)byteIndex;
  return 0.0;
}

__declspec(dllexport) int32_t chengGuiTextIndexAtX(const char *text, double fontSize, double x) {
  (void)text;
  (void)fontSize;
  (void)x;
  return 0;
}

__declspec(dllexport) int32_t chengGuiTextIndexAtXCode(const char *text, double fontSize, double x) {
  (void)text;
  (void)fontSize;
  (void)x;
  return 0;
}

__declspec(dllexport) void chengGuiNativeInitialize(void) {
  chengGuiWinInitialize();
}

__declspec(dllexport) void chengGuiNativeShutdown(void) {
  chengGuiWinShutdown();
}

__declspec(dllexport) void *chengGuiNativeCreateDefaultWindow(const char *title) {
  return chengGuiWinCreateDefaultWindow(title);
}

__declspec(dllexport) void chengGuiNativeDestroyWindow(void *handle) {
  chengGuiWinDestroyWindow(handle);
}

__declspec(dllexport) int chengGuiNativePollEvents(void *events, int maxEvents, int timeoutMs) {
  return chengGuiWinPollEvents((ChengGuiWinEvent *)events, maxEvents, timeoutMs);
}

__declspec(dllexport) void *chengGuiNativeCreateSurface(void *windowHandle) {
  return chengGuiWinCreateSurface(windowHandle);
}

__declspec(dllexport) void chengGuiNativeDestroySurface(void *surfaceHandle) {
  chengGuiWinDestroySurface(surfaceHandle);
}

__declspec(dllexport) int chengGuiNativeBeginFrame(void *surfaceHandle) {
  return chengGuiWinBeginFrame(surfaceHandle);
}

__declspec(dllexport) int chengGuiNativeEndFrame(void *surfaceHandle) {
  return chengGuiWinEndFrame(surfaceHandle);
}

__declspec(dllexport) int chengGuiNativeGetSurfaceInfo(void *surfaceHandle, void *outInfo) {
  return chengGuiWinGetSurfaceInfo(surfaceHandle, (ChengGuiWinSurfaceInfo *)outInfo);
}

__declspec(dllexport) int chengGuiNativePresentPixels(
  void *surfaceHandle,
  void *pixels,
  int width,
  int height,
  int strideBytes
) {
  return chengGuiWinPresentPixels(surfaceHandle, pixels, width, height, strideBytes);
}

__declspec(dllexport) int chengGuiNativeDrawTextBgra(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  double x,
  double y,
  double w,
  double h,
  uint32_t color,
  double fontSize,
  const char *text
) {
  return chengGuiDrawTextBgra(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text);
}

__declspec(dllexport) int chengGuiNativeDrawTextBgraLen(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  double x,
  double y,
  double w,
  double h,
  uint32_t color,
  double fontSize,
  const char *text,
  int textLen
) {
  (void)textLen;
  return chengGuiDrawTextBgra(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text);
}

__declspec(dllexport) int chengGuiNativeDrawTextBgraCode(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  double x,
  double y,
  double w,
  double h,
  uint32_t color,
  double fontSize,
  const char *text
) {
  (void)pixels;
  (void)width;
  (void)height;
  (void)strideBytes;
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  (void)color;
  (void)fontSize;
  (void)text;
  return -1;
}

__declspec(dllexport) int chengGuiNativeDrawTextBgraIcon(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  double x,
  double y,
  double w,
  double h,
  uint32_t color,
  double fontSize,
  const char *text
) {
  (void)pixels;
  (void)width;
  (void)height;
  (void)strideBytes;
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  (void)color;
  (void)fontSize;
  (void)text;
  return -1;
}

__declspec(dllexport) int chengGuiNativeDrawTextBgraFileIcon(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  double x,
  double y,
  double w,
  double h,
  uint32_t color,
  double fontSize,
  const char *text
) {
  (void)pixels;
  (void)width;
  (void)height;
  (void)strideBytes;
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  (void)color;
  (void)fontSize;
  (void)text;
  return -1;
}

__declspec(dllexport) size_t chengGuiNativeEventStructSize(void) {
  return chengGuiWinEventStructSize();
}
