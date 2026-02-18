#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/Xatom.h>
#include <X11/keysym.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#if defined(__GNUC__)
#define CHENG_X11_EXPORT __attribute__((visibility("default")))
#else
#define CHENG_X11_EXPORT
#endif

enum {
  ChengGuiX11EventNone = 0,
  ChengGuiX11EventClose = 1,
  ChengGuiX11EventResized = 2,
  ChengGuiX11EventMoved = 3,
  ChengGuiX11EventKeyDown = 4,
  ChengGuiX11EventKeyUp = 5,
  ChengGuiX11EventTextInput = 6,
  ChengGuiX11EventPointerDown = 7,
  ChengGuiX11EventPointerUp = 8,
  ChengGuiX11EventPointerMove = 9,
  ChengGuiX11EventPointerScroll = 10
};

typedef struct ChengGuiX11Window ChengGuiX11Window;
typedef struct ChengGuiX11Surface ChengGuiX11Surface;

struct ChengGuiX11Window {
  Display *display;
  Window window;
  Atom wmDelete;
  double dpi;
  double logicalWidth;
  double logicalHeight;
  double pixelWidth;
  double pixelHeight;
  double lastPointerX;
  double lastPointerY;
  bool hasPointer;
  bool highDpi;
  bool resizable;
  bool destroyed;
  ChengGuiX11Window *next;
};

struct ChengGuiX11Surface {
  ChengGuiX11Window *window;
  GC gc;
};

typedef struct {
  int kind;
  void *window;
  double x;
  double y;
  double width;
  double height;
  double deltaX;
  double deltaY;
  double pixelWidth;
  double pixelHeight;
  double scale;
  unsigned int modifiers;
  int button;
  unsigned int keyCode;
  char text[64];
} ChengGuiX11Event;

typedef struct {
  double logicalWidth;
  double logicalHeight;
  double pixelWidth;
  double pixelHeight;
  double scale;
  const char *colorSpace;
} ChengGuiX11SurfaceInfo;

static Display *gChengGuiX11Display = NULL;
static int gChengGuiX11Screen = 0;
static ChengGuiX11Window *gChengGuiX11Windows = NULL;
static const char *kChengGuiX11ColorSpace = "sRGB";

static double chengGuiX11ClampScale(double scale) {
  if (scale < 0.25) {
    return 0.25;
  }
  return scale;
}

static double chengGuiX11WindowScale(const ChengGuiX11Window *window) {
  double dpi = 96.0;
  if (window != NULL && window->dpi > 0.0) {
    dpi = window->dpi;
  }
  return chengGuiX11ClampScale(dpi / 96.0);
}

static double chengGuiX11ComputeDpi(Display *display, int screen) {
  if (display == NULL) {
    return 96.0;
  }
  int widthPx = DisplayWidth(display, screen);
  int heightPx = DisplayHeight(display, screen);
  int widthMm = DisplayWidthMM(display, screen);
  int heightMm = DisplayHeightMM(display, screen);
  double dpiX = (widthMm > 0) ? ((double)widthPx * 25.4) / (double)widthMm : 0.0;
  double dpiY = (heightMm > 0) ? ((double)heightPx * 25.4) / (double)heightMm : 0.0;
  double dpi = 0.0;
  if (dpiX > 0.0 && dpiY > 0.0) {
    dpi = (dpiX + dpiY) / 2.0;
  } else if (dpiX > 0.0) {
    dpi = dpiX;
  } else if (dpiY > 0.0) {
    dpi = dpiY;
  }
  if (dpi <= 0.0) {
    dpi = 96.0;
  }
  if (dpi < 48.0) {
    dpi = 48.0;
  }
  return dpi;
}

static void chengGuiX11UpdateLogicalSize(ChengGuiX11Window *window, unsigned int pixelWidth, unsigned int pixelHeight) {
  if (window == NULL) {
    return;
  }
  window->pixelWidth = (double)pixelWidth;
  window->pixelHeight = (double)pixelHeight;
  double scale = chengGuiX11WindowScale(window);
  if (scale <= 0.0) {
    scale = 1.0;
  }
  window->logicalWidth = window->pixelWidth / scale;
  window->logicalHeight = window->pixelHeight / scale;
}

static void chengGuiX11ResetPointer(ChengGuiX11Window *window) {
  if (window == NULL) {
    return;
  }
  window->hasPointer = false;
  window->lastPointerX = 0.0;
  window->lastPointerY = 0.0;
}

static void chengGuiX11PointerDelta(ChengGuiX11Window *window, double logicalX, double logicalY, double *deltaX, double *deltaY) {
  if (deltaX != NULL) {
    *deltaX = 0.0;
  }
  if (deltaY != NULL) {
    *deltaY = 0.0;
  }
  if (window == NULL) {
    return;
  }
  if (window->hasPointer) {
    if (deltaX != NULL) {
      *deltaX = logicalX - window->lastPointerX;
    }
    if (deltaY != NULL) {
      *deltaY = logicalY - window->lastPointerY;
    }
  } else {
    window->hasPointer = true;
  }
  window->lastPointerX = logicalX;
  window->lastPointerY = logicalY;
}

static void chengGuiX11LogicalPointer(const ChengGuiX11Window *window, double pixelX, double pixelY, double *logicalX, double *logicalY) {
  double scale = chengGuiX11WindowScale(window);
  if (scale <= 0.0) {
    scale = 1.0;
  }
  if (logicalX != NULL) {
    *logicalX = pixelX / scale;
  }
  if (logicalY != NULL) {
    *logicalY = pixelY / scale;
  }
}

static void chengGuiX11LinkWindow(ChengGuiX11Window *window) {
  if (window == NULL) {
    return;
  }
  window->next = gChengGuiX11Windows;
  gChengGuiX11Windows = window;
}

static void chengGuiX11UnlinkWindow(ChengGuiX11Window *window) {
  if (window == NULL) {
    return;
  }
  ChengGuiX11Window **cursor = &gChengGuiX11Windows;
  while (*cursor != NULL) {
    if (*cursor == window) {
      *cursor = window->next;
      break;
    }
    cursor = &((*cursor)->next);
  }
  window->next = NULL;
}

static ChengGuiX11Window *chengGuiX11FindWindow(Window window) {
  ChengGuiX11Window *cursor = gChengGuiX11Windows;
  while (cursor != NULL) {
    if (cursor->window == window) {
      return cursor;
    }
    cursor = cursor->next;
  }
  return NULL;
}

static void chengGuiX11PushEvent(ChengGuiX11Event *events, int maxEvents, int *count, const ChengGuiX11Event *event) {
  if (events == NULL || event == NULL || count == NULL) {
    return;
  }
  if (*count >= maxEvents) {
    return;
  }
  events[*count] = *event;
  (*count)++;
}

static ChengGuiX11Event chengGuiX11MakeEvent(ChengGuiX11Window *window, int kind) {
  ChengGuiX11Event ev;
  memset(&ev, 0, sizeof(ev));
  ev.kind = kind;
  ev.window = (void *)window;
  ev.button = -1;
  return ev;
}

static void chengGuiX11PopulateResizeEvent(ChengGuiX11Window *window, ChengGuiX11Event *event) {
  if (window == NULL || event == NULL) {
    return;
  }
  event->width = window->logicalWidth;
  event->height = window->logicalHeight;
  event->pixelWidth = window->pixelWidth;
  event->pixelHeight = window->pixelHeight;
  event->scale = chengGuiX11WindowScale(window);
}

static void chengGuiX11HandleConfigureEvent(XConfigureEvent *configureEvent, ChengGuiX11Event *events, int maxEvents, int *count) {
  if (configureEvent == NULL) {
    return;
  }
  ChengGuiX11Window *window = chengGuiX11FindWindow(configureEvent->window);
  if (window == NULL) {
    return;
  }
  window->dpi = chengGuiX11ComputeDpi(gChengGuiX11Display, gChengGuiX11Screen);
  chengGuiX11UpdateLogicalSize(window, (unsigned int)configureEvent->width, (unsigned int)configureEvent->height);
  ChengGuiX11Event event = chengGuiX11MakeEvent(window, ChengGuiX11EventResized);
  chengGuiX11PopulateResizeEvent(window, &event);
  chengGuiX11PushEvent(events, maxEvents, count, &event);
}

static void chengGuiX11HandleClientMessage(XClientMessageEvent *clientEvent, ChengGuiX11Event *events, int maxEvents, int *count) {
  if (clientEvent == NULL) {
    return;
  }
  ChengGuiX11Window *window = chengGuiX11FindWindow(clientEvent->window);
  if (window == NULL) {
    return;
  }
  if ((Atom)clientEvent->data.l[0] == window->wmDelete) {
    ChengGuiX11Event event = chengGuiX11MakeEvent(window, ChengGuiX11EventClose);
    chengGuiX11PushEvent(events, maxEvents, count, &event);
  }
}

static void chengGuiX11HandleKeyEvent(XKeyEvent *keyEvent, bool isPress, ChengGuiX11Event *events, int maxEvents, int *count) {
  if (keyEvent == NULL) {
    return;
  }
  ChengGuiX11Window *window = chengGuiX11FindWindow(keyEvent->window);
  if (window == NULL) {
    return;
  }
  KeySym keysym = 0;
  char buffer[64];
  memset(buffer, 0, sizeof(buffer));
  int length = XLookupString(keyEvent, buffer, (int)sizeof(buffer) - 1, &keysym, NULL);
  ChengGuiX11Event event = chengGuiX11MakeEvent(window, isPress ? ChengGuiX11EventKeyDown : ChengGuiX11EventKeyUp);
  event.keyCode = (unsigned int)keysym;
  event.modifiers = (unsigned int)keyEvent->state;
  chengGuiX11PushEvent(events, maxEvents, count, &event);
  if (isPress && length > 0) {
    buffer[length] = '\0';
    ChengGuiX11Event textEvent = chengGuiX11MakeEvent(window, ChengGuiX11EventTextInput);
    strncpy(textEvent.text, buffer, sizeof(textEvent.text) - 1);
    chengGuiX11PushEvent(events, maxEvents, count, &textEvent);
  }
}

static int chengGuiX11ButtonToIndex(unsigned int button) {
  switch (button) {
    case Button1: return 0;
    case Button2: return 2;
    case Button3: return 1;
    default: return (int)button - 1;
  }
}

static void chengGuiX11EmitPointerEvent(ChengGuiX11Window *window, int kind, double logicalX, double logicalY, double deltaX, double deltaY, unsigned int modifiers, int button, ChengGuiX11Event *events, int maxEvents, int *count) {
  if (window == NULL) {
    return;
  }
  ChengGuiX11Event event = chengGuiX11MakeEvent(window, kind);
  event.x = logicalX;
  event.y = logicalY;
  event.deltaX = deltaX;
  event.deltaY = deltaY;
  event.modifiers = modifiers;
  event.button = button;
  chengGuiX11PushEvent(events, maxEvents, count, &event);
}

static void chengGuiX11HandleButtonEvent(XButtonEvent *buttonEvent, bool isPress, ChengGuiX11Event *events, int maxEvents, int *count) {
  if (buttonEvent == NULL) {
    return;
  }
  ChengGuiX11Window *window = chengGuiX11FindWindow(buttonEvent->window);
  if (window == NULL) {
    return;
  }
  double logicalX = 0.0;
  double logicalY = 0.0;
  chengGuiX11LogicalPointer(window, (double)buttonEvent->x, (double)buttonEvent->y, &logicalX, &logicalY);
  if (buttonEvent->button == Button4 || buttonEvent->button == Button5 || buttonEvent->button == Button6 || buttonEvent->button == Button7) {
    double deltaX = 0.0;
    double deltaY = 0.0;
    switch (buttonEvent->button) {
      case Button4: deltaY = 1.0; break;
      case Button5: deltaY = -1.0; break;
      case Button6: deltaX = -1.0; break;
      case Button7: deltaX = 1.0; break;
    }
    chengGuiX11EmitPointerEvent(window, ChengGuiX11EventPointerScroll, logicalX, logicalY, deltaX, deltaY, buttonEvent->state, -1, events, maxEvents, count);
    return;
  }
  double deltaX = 0.0;
  double deltaY = 0.0;
  chengGuiX11PointerDelta(window, logicalX, logicalY, &deltaX, &deltaY);
  int kind = isPress ? ChengGuiX11EventPointerDown : ChengGuiX11EventPointerUp;
  int buttonIndex = chengGuiX11ButtonToIndex(buttonEvent->button);
  chengGuiX11EmitPointerEvent(window, kind, logicalX, logicalY, deltaX, deltaY, buttonEvent->state, buttonIndex, events, maxEvents, count);
}

static void chengGuiX11HandleMotionEvent(XMotionEvent *motionEvent, ChengGuiX11Event *events, int maxEvents, int *count) {
  if (motionEvent == NULL) {
    return;
  }
  ChengGuiX11Window *window = chengGuiX11FindWindow(motionEvent->window);
  if (window == NULL) {
    return;
  }
  double logicalX = 0.0;
  double logicalY = 0.0;
  chengGuiX11LogicalPointer(window, (double)motionEvent->x, (double)motionEvent->y, &logicalX, &logicalY);
  double deltaX = 0.0;
  double deltaY = 0.0;
  chengGuiX11PointerDelta(window, logicalX, logicalY, &deltaX, &deltaY);
  chengGuiX11EmitPointerEvent(window, ChengGuiX11EventPointerMove, logicalX, logicalY, deltaX, deltaY, motionEvent->state, -1, events, maxEvents, count);
}

static void chengGuiX11HandleLeaveEvent(XCrossingEvent *crossingEvent) {
  if (crossingEvent == NULL) {
    return;
  }
  ChengGuiX11Window *window = chengGuiX11FindWindow(crossingEvent->window);
  if (window == NULL) {
    return;
  }
  chengGuiX11ResetPointer(window);
}

static int chengGuiX11PollEventLoop(ChengGuiX11Event *events, int maxEvents, int timeoutMs) {
  if (gChengGuiX11Display == NULL || events == NULL || maxEvents <= 0) {
    if (timeoutMs > 0) {
      usleep((useconds_t)timeoutMs * 1000U);
    }
    return 0;
  }
  int produced = 0;
  int pending = XPending(gChengGuiX11Display);
  if (pending == 0) {
    if (timeoutMs > 0) {
      usleep((useconds_t)timeoutMs * 1000U);
    }
    return 0;
  }
  while (pending-- > 0 && produced < maxEvents) {
    XEvent event;
    memset(&event, 0, sizeof(event));
    XNextEvent(gChengGuiX11Display, &event);
    switch (event.type) {
      case ClientMessage:
        chengGuiX11HandleClientMessage(&event.xclient, events, maxEvents, &produced);
        break;
      case ConfigureNotify:
        chengGuiX11HandleConfigureEvent(&event.xconfigure, events, maxEvents, &produced);
        break;
      case KeyPress:
        chengGuiX11HandleKeyEvent(&event.xkey, true, events, maxEvents, &produced);
        break;
      case KeyRelease:
        chengGuiX11HandleKeyEvent(&event.xkey, false, events, maxEvents, &produced);
        break;
      case ButtonPress:
        chengGuiX11HandleButtonEvent(&event.xbutton, true, events, maxEvents, &produced);
        break;
      case ButtonRelease:
        chengGuiX11HandleButtonEvent(&event.xbutton, false, events, maxEvents, &produced);
        break;
      case MotionNotify:
        chengGuiX11HandleMotionEvent(&event.xmotion, events, maxEvents, &produced);
        break;
      case LeaveNotify:
        chengGuiX11HandleLeaveEvent(&event.xcrossing);
        break;
      default:
        break;
    }
    if (produced >= maxEvents) {
      break;
    }
  }
  return produced;
}

static void chengGuiX11FreeAllWindows(void) {
  ChengGuiX11Window *cursor = gChengGuiX11Windows;
  while (cursor != NULL) {
    ChengGuiX11Window *next = cursor->next;
    if (!cursor->destroyed && cursor->display != NULL && cursor->window != 0) {
      XDestroyWindow(cursor->display, cursor->window);
    }
    free(cursor);
    cursor = next;
  }
  gChengGuiX11Windows = NULL;
}

CHENG_X11_EXPORT void chengGuiX11Initialize(void) {
  if (gChengGuiX11Display != NULL) {
    return;
  }
  XInitThreads();
  gChengGuiX11Display = XOpenDisplay(NULL);
  if (gChengGuiX11Display == NULL) {
    return;
  }
  gChengGuiX11Screen = DefaultScreen(gChengGuiX11Display);
}

CHENG_X11_EXPORT int chengGuiX11IsInitialized(void) {
  return gChengGuiX11Display != NULL ? 1 : 0;
}

CHENG_X11_EXPORT void chengGuiX11Shutdown(void) {
  if (gChengGuiX11Display != NULL) {
    chengGuiX11FreeAllWindows();
    XCloseDisplay(gChengGuiX11Display);
    gChengGuiX11Display = NULL;
  } else {
    chengGuiX11FreeAllWindows();
  }
}

CHENG_X11_EXPORT void *chengGuiX11CreateWindow(
    const char *title,
    double x,
    double y,
    double width,
    double height,
    bool resizable,
    bool highDpi
) {
  (void)highDpi;
  if (gChengGuiX11Display == NULL) {
    chengGuiX11Initialize();
  }
  if (gChengGuiX11Display == NULL) {
    return NULL;
  }
  ChengGuiX11Window *window = (ChengGuiX11Window *)calloc(1, sizeof(ChengGuiX11Window));
  if (window == NULL) {
    return NULL;
  }
  window->display = gChengGuiX11Display;
  window->resizable = resizable;
  window->highDpi = highDpi;
  window->dpi = chengGuiX11ComputeDpi(gChengGuiX11Display, gChengGuiX11Screen);
  unsigned long black = BlackPixel(gChengGuiX11Display, gChengGuiX11Screen);
  unsigned long white = WhitePixel(gChengGuiX11Display, gChengGuiX11Screen);
  unsigned long borderColor = black;
  unsigned long bgColor = white;
  int winX = (int)x;
  int winY = (int)y;
  unsigned int winWidth = (width > 0) ? (unsigned int)width : 800U;
  unsigned int winHeight = (height > 0) ? (unsigned int)height : 600U;

  window->window = XCreateSimpleWindow(
    gChengGuiX11Display,
    RootWindow(gChengGuiX11Display, gChengGuiX11Screen),
    winX,
    winY,
    winWidth,
    winHeight,
    (unsigned int) (resizable ? 1 : 0),
    borderColor,
    bgColor
  );

  if (window->window == 0) {
    free(window);
    return NULL;
  }

  long eventMask = ExposureMask |
                   StructureNotifyMask |
                   KeyPressMask |
                   KeyReleaseMask |
                   ButtonPressMask |
                   ButtonReleaseMask |
                   PointerMotionMask |
                   LeaveWindowMask;

  XSelectInput(gChengGuiX11Display, window->window, eventMask);

  const char *windowTitle = (title != NULL && title[0] != '\0') ? title : "Cheng IDE";
  XStoreName(gChengGuiX11Display, window->window, windowTitle);

  window->wmDelete = XInternAtom(gChengGuiX11Display, "WM_DELETE_WINDOW", False);
  if (window->wmDelete != None) {
    XSetWMProtocols(gChengGuiX11Display, window->window, &window->wmDelete, 1);
  }

  chengGuiX11UpdateLogicalSize(window, winWidth, winHeight);
  chengGuiX11ResetPointer(window);
  chengGuiX11LinkWindow(window);

  XMapWindow(gChengGuiX11Display, window->window);
  XFlush(gChengGuiX11Display);

  return (void *)window;
}

CHENG_X11_EXPORT void *chengGuiX11CreateDefaultWindow(const char *title) {
  return chengGuiX11CreateWindow(title, 100.0, 100.0, 1280.0, 800.0, true, true);
}

CHENG_X11_EXPORT void chengGuiX11DestroyWindow(void *handle) {
  ChengGuiX11Window *window = (ChengGuiX11Window *)handle;
  if (window == NULL) {
    return;
  }
  window->destroyed = true;
  if (window->display != NULL && window->window != 0) {
    XDestroyWindow(window->display, window->window);
  }
  chengGuiX11UnlinkWindow(window);
  free(window);
}

CHENG_X11_EXPORT int chengGuiX11PollEvents(ChengGuiX11Event *events, int maxEvents, int timeoutMs) {
  return chengGuiX11PollEventLoop(events, maxEvents, timeoutMs);
}

CHENG_X11_EXPORT void *chengGuiX11CreateSurface(void *handle) {
  ChengGuiX11Window *window = (ChengGuiX11Window *)handle;
  if (window == NULL || window->display == NULL) {
    return NULL;
  }
  ChengGuiX11Surface *surface = (ChengGuiX11Surface *)calloc(1, sizeof(ChengGuiX11Surface));
  if (surface == NULL) {
    return NULL;
  }
  surface->window = window;
  surface->gc = XCreateGC(window->display, window->window, 0, NULL);
  if (surface->gc == NULL) {
    free(surface);
    return NULL;
  }
  return (void *)surface;
}

CHENG_X11_EXPORT void chengGuiX11DestroySurface(void *handle) {
  ChengGuiX11Surface *surface = (ChengGuiX11Surface *)handle;
  if (surface == NULL) {
    return;
  }
  if (surface->window != NULL && surface->window->display != NULL && surface->gc != NULL) {
    XFreeGC(surface->window->display, surface->gc);
  }
  free(surface);
}

CHENG_X11_EXPORT int chengGuiX11GetSurfaceInfo(void *handle, ChengGuiX11SurfaceInfo *info) {
  ChengGuiX11Surface *surface = (ChengGuiX11Surface *)handle;
  if (surface == NULL || surface->window == NULL || info == NULL) {
    return -1;
  }
  ChengGuiX11Window *window = surface->window;
  if (window->display == NULL) {
    return -1;
  }
  XWindowAttributes attributes;
  if (XGetWindowAttributes(window->display, window->window, &attributes) == 0) {
    return -1;
  }
  window->dpi = chengGuiX11ComputeDpi(window->display, gChengGuiX11Screen);
  chengGuiX11UpdateLogicalSize(window, (unsigned int)attributes.width, (unsigned int)attributes.height);
  info->logicalWidth = window->logicalWidth;
  info->logicalHeight = window->logicalHeight;
  info->pixelWidth = window->pixelWidth;
  info->pixelHeight = window->pixelHeight;
  info->scale = chengGuiX11WindowScale(window);
  info->colorSpace = kChengGuiX11ColorSpace;
  return 0;
}

CHENG_X11_EXPORT int chengGuiX11BeginFrame(void *handle) {
  ChengGuiX11Surface *surface = (ChengGuiX11Surface *)handle;
  if (surface == NULL || surface->window == NULL || surface->window->display == NULL || surface->gc == NULL) {
    return -1;
  }
  ChengGuiX11Window *window = surface->window;
  XWindowAttributes attributes;
  if (XGetWindowAttributes(window->display, window->window, &attributes) != 0) {
    window->dpi = chengGuiX11ComputeDpi(window->display, gChengGuiX11Screen);
    chengGuiX11UpdateLogicalSize(window, (unsigned int)attributes.width, (unsigned int)attributes.height);
  }
  XSetForeground(window->display, surface->gc, 0x1E1E22);
  XFillRectangle(
    window->display,
    window->window,
    surface->gc,
    0,
    0,
    (unsigned int)window->pixelWidth,
    (unsigned int)window->pixelHeight
  );
  return 0;
}

CHENG_X11_EXPORT int chengGuiX11EndFrame(void *handle) {
  ChengGuiX11Surface *surface = (ChengGuiX11Surface *)handle;
  if (surface == NULL || surface->window == NULL || surface->window->display == NULL) {
    return -1;
  }
  XFlush(surface->window->display);
  return 0;
}

CHENG_X11_EXPORT int chengGuiX11PresentPixels(void *handle,
                                              const uint32_t *pixels,
                                              int width,
                                              int height,
                                              int strideBytes) {
  ChengGuiX11Surface *surface = (ChengGuiX11Surface *)handle;
  if (surface == NULL || pixels == NULL) {
    return -1;
  }
  if (width <= 0 || height <= 0) {
    return -2;
  }
  ChengGuiX11Window *window = surface->window;
  if (window == NULL || window->display == NULL || surface->gc == NULL) {
    return -3;
  }
  if (strideBytes <= 0) {
    strideBytes = width * 4;
  }
  size_t totalBytes = (size_t)strideBytes * (size_t)height;
  if (totalBytes == 0) {
    return -4;
  }
  char *copy = (char *)malloc(totalBytes);
  if (copy == NULL) {
    return -5;
  }
  memcpy(copy, pixels, totalBytes);

  XWindowAttributes attributes;
  if (XGetWindowAttributes(window->display, window->window, &attributes) == 0) {
    free(copy);
    return -6;
  }

  XImage *image = XCreateImage(window->display,
                               attributes.visual,
                               (unsigned int)attributes.depth,
                               ZPixmap,
                               0,
                               copy,
                               (unsigned int)width,
                               (unsigned int)height,
                               32,
                               strideBytes);
  if (image == NULL) {
    free(copy);
    return -7;
  }

  int copyW = width;
  int copyH = height;
  if (attributes.width < copyW) copyW = attributes.width;
  if (attributes.height < copyH) copyH = attributes.height;
  if (copyW <= 0 || copyH <= 0) {
    XDestroyImage(image);
    return -8;
  }

  XPutImage(window->display,
            window->window,
            surface->gc,
            image,
            0,
            0,
            0,
            0,
            (unsigned int)copyW,
            (unsigned int)copyH);
  XFlush(window->display);
  XDestroyImage(image);
  return 0;
}

CHENG_X11_EXPORT size_t chengGuiX11EventStructSize(void) {
  return sizeof(ChengGuiX11Event);
}

CHENG_X11_EXPORT size_t chengGuiX11SurfaceInfoStructSize(void) {
  return sizeof(ChengGuiX11SurfaceInfo);
}

CHENG_X11_EXPORT int chengGuiNativeTextAvailable(void) {
  return 0;
}

CHENG_X11_EXPORT const char *chengGuiNativeTextBackend(void) {
  return "unavailable";
}

CHENG_X11_EXPORT int chengGuiIconFontAvailable(void) {
  return 0;
}

CHENG_X11_EXPORT int chengGuiFileIconFontAvailable(void) {
  return 0;
}

CHENG_X11_EXPORT int chengGuiDrawTextBgra(void *pixels,
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

CHENG_X11_EXPORT double chengGuiTextWidth(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

CHENG_X11_EXPORT double chengGuiTextWidthCode(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

CHENG_X11_EXPORT double chengGuiTextWidthIcon(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

CHENG_X11_EXPORT double chengGuiTextWidthFileIcon(const char *text, double fontSize) {
  (void)text;
  (void)fontSize;
  return 0.0;
}

CHENG_X11_EXPORT double chengGuiTextXAtIndex(const char *text, double fontSize, int32_t byteIndex) {
  (void)text;
  (void)fontSize;
  (void)byteIndex;
  return 0.0;
}

CHENG_X11_EXPORT double chengGuiTextXAtIndexCode(const char *text, double fontSize, int32_t byteIndex) {
  (void)text;
  (void)fontSize;
  (void)byteIndex;
  return 0.0;
}

CHENG_X11_EXPORT int32_t chengGuiTextIndexAtX(const char *text, double fontSize, double x) {
  (void)text;
  (void)fontSize;
  (void)x;
  return 0;
}

CHENG_X11_EXPORT int32_t chengGuiTextIndexAtXCode(const char *text, double fontSize, double x) {
  (void)text;
  (void)fontSize;
  (void)x;
  return 0;
}

CHENG_X11_EXPORT void chengGuiNativeInitialize(void) {
  chengGuiX11Initialize();
}

CHENG_X11_EXPORT void chengGuiNativeShutdown(void) {
  chengGuiX11Shutdown();
}

CHENG_X11_EXPORT void *chengGuiNativeCreateDefaultWindow(const char *title) {
  return chengGuiX11CreateDefaultWindow(title);
}

CHENG_X11_EXPORT void chengGuiNativeDestroyWindow(void *handle) {
  chengGuiX11DestroyWindow(handle);
}

CHENG_X11_EXPORT int chengGuiNativePollEvents(void *events, int maxEvents, int timeoutMs) {
  return chengGuiX11PollEvents((ChengGuiX11Event *)events, maxEvents, timeoutMs);
}

CHENG_X11_EXPORT void *chengGuiNativeCreateSurface(void *windowHandle) {
  return chengGuiX11CreateSurface(windowHandle);
}

CHENG_X11_EXPORT void chengGuiNativeDestroySurface(void *surfaceHandle) {
  chengGuiX11DestroySurface(surfaceHandle);
}

CHENG_X11_EXPORT int chengGuiNativeBeginFrame(void *surfaceHandle) {
  return chengGuiX11BeginFrame(surfaceHandle);
}

CHENG_X11_EXPORT int chengGuiNativeEndFrame(void *surfaceHandle) {
  return chengGuiX11EndFrame(surfaceHandle);
}

CHENG_X11_EXPORT int chengGuiNativeGetSurfaceInfo(void *surfaceHandle, void *outInfo) {
  return chengGuiX11GetSurfaceInfo(surfaceHandle, (ChengGuiX11SurfaceInfo *)outInfo);
}

CHENG_X11_EXPORT int chengGuiNativePresentPixels(
  void *surfaceHandle,
  void *pixels,
  int width,
  int height,
  int strideBytes
) {
  return chengGuiX11PresentPixels(surfaceHandle, pixels, width, height, strideBytes);
}

CHENG_X11_EXPORT int chengGuiNativeDrawTextBgra(
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

CHENG_X11_EXPORT int chengGuiNativeDrawTextBgraLen(
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

CHENG_X11_EXPORT int chengGuiNativeDrawTextBgraCode(
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

CHENG_X11_EXPORT int chengGuiNativeDrawTextBgraIcon(
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

CHENG_X11_EXPORT int chengGuiNativeDrawTextBgraFileIcon(
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

CHENG_X11_EXPORT size_t chengGuiNativeEventStructSize(void) {
  return chengGuiX11EventStructSize();
}
