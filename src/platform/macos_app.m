#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include <CoreFoundation/CoreFoundation.h>

#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

@class ChengGuiWindowDelegate;
@class ChengGuiInputView;

typedef struct {
  int kind;
  double x;
  double y;
  double width;
  double height;
  double deltaX;
  double deltaY;
  void *window;
  int button;
  unsigned int modifiers;
  unsigned int keyCode;
  bool repeatFlag;
  char text[256];
} ChengGuiMacEvent;

enum {
  ChengGuiMacEventNone = 0,
  ChengGuiMacEventClose = 1,
  ChengGuiMacEventResized = 2,
  ChengGuiMacEventMoved = 3,
  ChengGuiMacEventKeyDown = 4,
  ChengGuiMacEventKeyUp = 5,
  ChengGuiMacEventTextInput = 6,
  ChengGuiMacEventPointerDown = 7,
  ChengGuiMacEventPointerUp = 8,
  ChengGuiMacEventPointerMove = 9,
  ChengGuiMacEventPointerScroll = 10,
  ChengGuiMacEventPointerLeave = 11,
  ChengGuiMacEventImeStart = 12,
  ChengGuiMacEventImeUpdate = 13,
  ChengGuiMacEventImeEnd = 14
};

typedef struct ChengGuiMacWindow {
  NSWindow *window;
  ChengGuiInputView *contentView;
  ChengGuiWindowDelegate *delegate;
  CFTypeRef windowStrong;
  CFTypeRef contentViewStrong;
  CFTypeRef delegateStrong;
  NSEventModifierFlags modifierFlags;
  BOOL pointerInside;
} ChengGuiMacWindow;

typedef struct ChengGuiMacSurface {
  ChengGuiMacWindow *wrapper;
  double logicalWidth;
  double logicalHeight;
  double pixelWidth;
  double pixelHeight;
  double scale;
  const char *colorSpace;
  const uint32_t *imagePixels;
  int imageWidth;
  int imageHeight;
  size_t imageRowBytes;
  CGDataProviderRef imageProvider;
  CGImageRef image;
  CGColorSpaceRef imageColorSpace;
  uint32_t *frameBuffer;
  size_t frameBufferBytes;
} ChengGuiMacSurface;

typedef struct {
  double logicalWidth;
  double logicalHeight;
  double pixelWidth;
  double pixelHeight;
  double scale;
  const char *colorSpace;
} ChengGuiMacSurfaceInfo;

typedef struct {
  const uint32_t *pixels;
  int width;
  int height;
  int strideBytes;
} ChengGuiMacPresentPayload;

static BOOL gChengAppInitialized = NO;
static NSMutableArray<NSValue *> *gChengEventQueue = nil;
static NSMutableDictionary<NSValue *, NSValue *> *gChengWindowMap = nil;
static ChengGuiMacWindow *gChengPrimaryWindow = NULL;
static bool gChengUseViewPointerEvents = false;

static bool chengGuiMacEnvFlag(const char *name, bool defaultValue) {
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') {
    return defaultValue;
  }
  if (raw[0] == '1' || raw[0] == 't' || raw[0] == 'T' || raw[0] == 'y' || raw[0] == 'Y') {
    return true;
  }
  if (raw[0] == '0' || raw[0] == 'f' || raw[0] == 'F' || raw[0] == 'n' || raw[0] == 'N') {
    return false;
  }
  return defaultValue;
}
static const char *kChengColorSpaceSRGB = "sRGB";
static const char *kChengColorSpaceDisplayP3 = "display-p3";
static const char *kChengColorSpaceGenericRGB = "generic-rgb";
static const void *kChengGuiDelegateKey = &kChengGuiDelegateKey;
static int gChengPresentFrames = 0;
static int gChengBeginFrames = 0;

static bool chengGuiMacDebugEnabled(void) {
  const char *flag = getenv("GUI_DEBUG");
  if (flag == NULL || flag[0] == '\0') {
    return false;
  }
  if (flag[0] == '1' || flag[0] == 't' || flag[0] == 'T' || flag[0] == 'y' || flag[0] == 'Y') {
    return true;
  }
  return false;
}

static void chengGuiMacDebugLog(const char *tag, const char *message) {
  if (!chengGuiMacDebugEnabled()) {
    return;
  }
  fprintf(stderr, "[gui-macos] %s %s\n", tag != NULL ? tag : "log", message != NULL ? message : "");
}

static void chengGuiMacPromoteProcessToForeground(void) {
  ProcessSerialNumber psn = {0, kCurrentProcess};
  OSErr transformErr = TransformProcessType(&psn, kProcessTransformToForegroundApplication);
  BOOL activated = NO;
  NSRunningApplication *currentApp = [NSRunningApplication currentApplication];
  if (currentApp != nil) {
    activated = [currentApp activateWithOptions:NSApplicationActivateAllWindows];
  }
  if (chengGuiMacDebugEnabled()) {
    fprintf(stderr, "[gui-macos] promote foreground transform=%d activated=%d\n", (int)transformErr, activated ? 1 : 0);
  }
}

static void chengGuiMacEnsureInitialized(void);
static void chengGuiMacEnsureWindowMap(void);
static void chengGuiMacRegisterWindow(ChengGuiMacWindow *wrapper);
static void chengGuiMacUnregisterWindow(ChengGuiMacWindow *wrapper);
static ChengGuiMacWindow *chengGuiMacLookupWindow(NSWindow *window);
static inline NSEventModifierFlags chengGuiMacNormalizeFlags(NSEventModifierFlags flags);
static NSEventModifierFlags chengGuiMacModifierMaskForKeyCode(unsigned short keyCode);
static inline ChengGuiMacEvent chengGuiMacMakeEvent(ChengGuiMacWindow *wrapper, int kind);
static void chengGuiMacFillLocation(ChengGuiMacEvent *ev, NSEvent *event, ChengGuiMacWindow *wrapper);
static void chengGuiMacPushPointerEvent(ChengGuiMacWindow *wrapper, NSEvent *event, int kind, bool includeDelta);
static void chengGuiMacPushScrollEvent(ChengGuiMacWindow *wrapper, NSEvent *event);
static bool chengGuiMacIsPointerEventType(NSEventType type);
static void chengGuiMacPushTextString(
  ChengGuiMacWindow *wrapper,
  NSString *text,
  NSEventModifierFlags flags
);
static void chengGuiMacPushCompositionEvent(
  ChengGuiMacWindow *wrapper,
  int kind,
  NSString *text,
  NSEventModifierFlags flags
);
static bool chengGuiMacTranslateNSEvent(NSEvent *event, ChengGuiMacEvent *outEvent);
static int chengGuiMacDrainQueueInto(ChengGuiMacEvent *events, int maxEvents);
static void chengGuiMacPushEvent(ChengGuiMacEvent ev);

@interface ChengGuiInputView : NSView<NSTextInputClient>
@property(nonatomic, assign) ChengGuiMacWindow *wrapper;
@end

@implementation ChengGuiInputView {
  NSMutableAttributedString *_markedText;
  NSTrackingArea *_trackingArea;
}

- (BOOL)isFlipped {
  return YES;
}

- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (self) {
    _markedText = [[NSMutableAttributedString alloc] init];
    [self updateTrackingAreas];
  }
  return self;
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  (void)event;
  return YES;
}

- (BOOL)canBecomeKeyView {
  return YES;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (self.window != nil) {
    [self.window setAcceptsMouseMovedEvents:YES];
    if (!self.window.isKeyWindow) {
      [self.window makeKeyAndOrderFront:nil];
      [NSApp activateIgnoringOtherApps:YES];
    }
    if (self.window.firstResponder != self) {
      [self.window makeFirstResponder:self];
    }
  }
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_trackingArea != nil) {
    [self removeTrackingArea:_trackingArea];
  }
  NSTrackingAreaOptions options = NSTrackingMouseEnteredAndExited |
                                  NSTrackingMouseMoved |
                                  NSTrackingActiveInKeyWindow |
                                  NSTrackingInVisibleRect;
  _trackingArea = [[NSTrackingArea alloc] initWithRect:self.bounds
                                               options:options
                                                 owner:self
                                              userInfo:nil];
  [self addTrackingArea:_trackingArea];
}

- (void)mouseEntered:(NSEvent *)event {
  (void)event;
  if (self.wrapper != NULL) {
    self.wrapper->pointerInside = YES;
  }
}

- (void)mouseExited:(NSEvent *)event {
  if (self.wrapper == NULL) {
    return;
  }
  self.wrapper->pointerInside = NO;
  if (gChengUseViewPointerEvents) {
    ChengGuiMacEvent ev = chengGuiMacMakeEvent(self.wrapper, ChengGuiMacEventPointerLeave);
    chengGuiMacFillLocation(&ev, event, self.wrapper);
    chengGuiMacPushEvent(ev);
  }
}

- (void)mouseMoved:(NSEvent *)event {
  [super mouseMoved:event];
  if (self.wrapper != NULL) {
    self.wrapper->pointerInside = YES;
    if (gChengUseViewPointerEvents) {
      chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerMove, true);
    }
  }
}

- (void)mouseDown:(NSEvent *)event {
  if (self.wrapper != NULL) {
    if (self.window != nil) {
      if (!self.window.isKeyWindow) {
        [self.window makeKeyAndOrderFront:nil];
      }
      if (self.window.firstResponder != self) {
        [self.window makeFirstResponder:self];
      }
    }
    self.wrapper->pointerInside = YES;
    if (gChengUseViewPointerEvents) {
      chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerDown, false);
    }
  }
}

- (void)mouseUp:(NSEvent *)event {
  if (self.wrapper != NULL) {
    self.wrapper->pointerInside = YES;
    if (gChengUseViewPointerEvents) {
      chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerUp, false);
    }
  }
}

- (void)rightMouseDown:(NSEvent *)event {
  if (self.wrapper != NULL && gChengUseViewPointerEvents) {
    self.wrapper->pointerInside = YES;
    chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerDown, false);
  }
}

- (void)rightMouseUp:(NSEvent *)event {
  if (self.wrapper != NULL && gChengUseViewPointerEvents) {
    self.wrapper->pointerInside = YES;
    chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerUp, false);
  }
}

- (void)otherMouseDown:(NSEvent *)event {
  if (self.wrapper != NULL && gChengUseViewPointerEvents) {
    self.wrapper->pointerInside = YES;
    chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerDown, false);
  }
}

- (void)otherMouseUp:(NSEvent *)event {
  if (self.wrapper != NULL && gChengUseViewPointerEvents) {
    self.wrapper->pointerInside = YES;
    chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerUp, false);
  }
}

- (void)mouseDragged:(NSEvent *)event {
  if (self.wrapper != NULL) {
    self.wrapper->pointerInside = YES;
    if (gChengUseViewPointerEvents) {
      chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerMove, true);
    }
  }
}

- (void)rightMouseDragged:(NSEvent *)event {
  if (self.wrapper != NULL && gChengUseViewPointerEvents) {
    self.wrapper->pointerInside = YES;
    chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerMove, true);
  }
}

- (void)otherMouseDragged:(NSEvent *)event {
  if (self.wrapper != NULL && gChengUseViewPointerEvents) {
    self.wrapper->pointerInside = YES;
    chengGuiMacPushPointerEvent(self.wrapper, event, ChengGuiMacEventPointerMove, true);
  }
}

- (void)scrollWheel:(NSEvent *)event {
  if (self.wrapper != NULL && gChengUseViewPointerEvents) {
    self.wrapper->pointerInside = YES;
    chengGuiMacPushScrollEvent(self.wrapper, event);
  }
}

- (void)keyDown:(NSEvent *)event {
  if (event == nil) {
    return;
  }
  NSTextInputContext *context = self.inputContext;
  if (context != nil && [context handleEvent:event]) {
    return;
  }
  [self interpretKeyEvents:@[event]];
}

- (void)insertText:(id)string replacementRange:(NSRange)replacementRange {
  (void)replacementRange;
  if (self.wrapper == NULL) {
    return;
  }
  NSString *plain = nil;
  if ([string isKindOfClass:[NSAttributedString class]]) {
    plain = [(NSAttributedString *)string string];
  } else if ([string isKindOfClass:[NSString class]]) {
    plain = (NSString *)string;
  } else {
    plain = @"";
  }
  NSEvent *currentEvent = [NSApp currentEvent];
  NSEventModifierFlags flags = currentEvent != nil ? currentEvent.modifierFlags : 0;
  if (_markedText.length > 0) {
    chengGuiMacPushCompositionEvent(
      self.wrapper,
      ChengGuiMacEventImeEnd,
      [_markedText string],
      flags
    );
    [_markedText.mutableString setString:@""];
  }
  chengGuiMacPushTextString(
    self.wrapper,
    plain ?: @"",
    flags
  );
}

- (void)setMarkedText:(id)string
        selectedRange:(NSRange)selectedRange
     replacementRange:(NSRange)replacementRange {
  (void)selectedRange;
  (void)replacementRange;
  if (self.wrapper == NULL) {
    return;
  }
  BOOL hadMarked = (_markedText.length > 0);
  NSString *plain = @"";
  if ([string isKindOfClass:[NSAttributedString class]]) {
    NSAttributedString *attr = (NSAttributedString *)string;
    [_markedText setAttributedString:attr];
    plain = attr.string ?: @"";
  } else if ([string isKindOfClass:[NSString class]]) {
    plain = (NSString *)string;
    [_markedText setAttributedString:[[NSAttributedString alloc] initWithString:plain]];
  } else {
    [_markedText.mutableString setString:@""];
  }
  NSEvent *currentEvent = [NSApp currentEvent];
  NSEventModifierFlags flags = currentEvent != nil ? currentEvent.modifierFlags : 0;
  if (_markedText.length == 0) {
    if (hadMarked) {
      chengGuiMacPushCompositionEvent(self.wrapper, ChengGuiMacEventImeEnd, @"", flags);
    }
    return;
  }
  if (!hadMarked) {
    chengGuiMacPushCompositionEvent(self.wrapper, ChengGuiMacEventImeStart, plain, flags);
  }
  chengGuiMacPushCompositionEvent(self.wrapper, ChengGuiMacEventImeUpdate, plain, flags);
}

- (void)unmarkText {
  if (self.wrapper == NULL) {
    [_markedText.mutableString setString:@""];
    return;
  }
  NSEvent *currentEvent = [NSApp currentEvent];
  NSEventModifierFlags flags = currentEvent != nil ? currentEvent.modifierFlags : 0;
  if (_markedText.length > 0) {
    chengGuiMacPushCompositionEvent(
      self.wrapper,
      ChengGuiMacEventImeEnd,
      [_markedText string],
      flags
    );
    [_markedText.mutableString setString:@""];
  }
}

- (NSRange)selectedRange {
  return NSMakeRange(NSNotFound, 0);
}

- (NSRange)markedRange {
  if (_markedText.length == 0) {
    return NSMakeRange(NSNotFound, 0);
  }
  return NSMakeRange(0, _markedText.length);
}

- (BOOL)hasMarkedText {
  return _markedText.length > 0;
}

- (NSArray<NSAttributedStringKey> *)validAttributesForMarkedText {
  return @[];
}

- (NSAttributedString *)attributedSubstringForProposedRange:(NSRange)range
                                                 actualRange:(NSRangePointer)actualRange {
  if (_markedText.length == 0 || range.length == 0) {
    if (actualRange != NULL) {
      *actualRange = NSMakeRange(NSNotFound, 0);
    }
    return nil;
  }
  NSRange markRange = NSMakeRange(0, _markedText.length);
  NSRange intersection = NSIntersectionRange(range, markRange);
  if (intersection.length == 0) {
    if (actualRange != NULL) {
      *actualRange = NSMakeRange(NSNotFound, 0);
    }
    return nil;
  }
  if (actualRange != NULL) {
    *actualRange = intersection;
  }
  return [_markedText attributedSubstringFromRange:intersection];
}

- (NSUInteger)characterIndexForPoint:(NSPoint)point {
  (void)point;
  return 0;
}

- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actualRange {
  (void)range;
  if (actualRange != NULL) {
    *actualRange = NSMakeRange(NSNotFound, 0);
  }
  NSRect bounds = self.bounds;
  NSRect caret = NSMakeRect(bounds.origin.x, bounds.origin.y + bounds.size.height, 0.0, 0.0);
  if (self.window != nil) {
    return [self.window convertRectToScreen:caret];
  }
  return caret;
}

- (void)doCommandBySelector:(SEL)selector {
  (void)selector;
}

@end

@interface ChengGuiWindowDelegate : NSObject<NSWindowDelegate>
@property(nonatomic, assign) ChengGuiMacWindow *wrapper;
@end

@implementation ChengGuiWindowDelegate
- (BOOL)windowShouldClose:(NSWindow *)sender {
  if (self.wrapper) {
    ChengGuiMacEvent ev = chengGuiMacMakeEvent(self.wrapper, ChengGuiMacEventClose);
    chengGuiMacPushEvent(ev);
  }
  return YES;
}

- (void)windowDidResize:(NSNotification *)notification {
  if (!self.wrapper) {
    return;
  }
  NSWindow *window = notification.object;
  if (!window) {
    return;
  }
  NSRect content = [window contentRectForFrameRect:window.frame];
  ChengGuiMacEvent ev = chengGuiMacMakeEvent(self.wrapper, ChengGuiMacEventResized);
  ev.width = content.size.width;
  ev.height = content.size.height;
  chengGuiMacPushEvent(ev);
}

- (void)windowDidMove:(NSNotification *)notification {
  if (!self.wrapper) {
    return;
  }
  NSWindow *window = notification.object;
  if (!window) {
    return;
  }
  NSRect frame = window.frame;
  ChengGuiMacEvent ev = chengGuiMacMakeEvent(self.wrapper, ChengGuiMacEventMoved);
  ev.x = frame.origin.x;
  ev.y = frame.origin.y;
  chengGuiMacPushEvent(ev);
}
@end

void chengGuiMacPushEvent(ChengGuiMacEvent ev) {
  @autoreleasepool {
    if (gChengEventQueue == nil) {
      gChengEventQueue = [[NSMutableArray alloc] init];
    }
    [gChengEventQueue addObject:[NSValue valueWithBytes:&ev objCType:@encode(ChengGuiMacEvent)]];
  }
}

static void chengGuiMacEnsureInitialized(void) {
  if (gChengAppInitialized) {
    return;
  }
  @autoreleasepool {
    if (chengGuiMacDebugEnabled()) {
      fprintf(stderr, "[gui-macos] init main_thread=%d\n", [NSThread isMainThread] ? 1 : 0);
    }
    gChengUseViewPointerEvents = chengGuiMacEnvFlag("GUI_VIEW_EVENTS", true);
    chengGuiMacPromoteProcessToForeground();
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp unhide:nil];
    [NSApp finishLaunching];
    gChengAppInitialized = YES;
    if (chengGuiMacDebugEnabled()) {
      fprintf(stderr, "[gui-macos] init done app=%p policy=%ld\n", NSApp, (long)[NSApp activationPolicy]);
    }
  }
}

static inline NSValue *chengGuiMacWindowKey(NSWindow *window) {
  return [NSValue valueWithPointer:(void *)window];
}

static inline NSValue *chengGuiMacWrapperValue(ChengGuiMacWindow *wrapper) {
  return [NSValue valueWithPointer:(void *)wrapper];
}

static void chengGuiMacEnsureWindowMap(void) {
  if (gChengWindowMap == nil) {
    gChengWindowMap = [[NSMutableDictionary alloc] init];
  }
}

static void chengGuiMacRegisterWindow(ChengGuiMacWindow *wrapper) {
  if (!wrapper || !wrapper->window) {
    return;
  }
  chengGuiMacEnsureWindowMap();
  NSValue *key = chengGuiMacWindowKey(wrapper->window);
  NSValue *value = chengGuiMacWrapperValue(wrapper);
  gChengWindowMap[key] = value;
  if (gChengPrimaryWindow == NULL) {
    gChengPrimaryWindow = wrapper;
  }
}

static void chengGuiMacUnregisterWindow(ChengGuiMacWindow *wrapper) {
  if (!wrapper || !wrapper->window || gChengWindowMap == nil) {
    return;
  }
  NSValue *key = chengGuiMacWindowKey(wrapper->window);
  [gChengWindowMap removeObjectForKey:key];
  if (gChengPrimaryWindow == wrapper) {
    gChengPrimaryWindow = NULL;
  }
}

static ChengGuiMacWindow *chengGuiMacLookupWindow(NSWindow *window) {
  if (window == nil || gChengWindowMap == nil) {
    return NULL;
  }
  NSValue *key = chengGuiMacWindowKey(window);
  NSValue *value = [gChengWindowMap objectForKey:key];
  if (value == nil) {
    return NULL;
  }
  return (ChengGuiMacWindow *)[value pointerValue];
}

static inline NSEventModifierFlags chengGuiMacNormalizeFlags(NSEventModifierFlags flags) {
  return flags & NSEventModifierFlagDeviceIndependentFlagsMask;
}

static inline ChengGuiMacEvent chengGuiMacMakeEvent(ChengGuiMacWindow *wrapper, int kind) {
  ChengGuiMacEvent ev;
  memset(&ev, 0, sizeof(ev));
  ev.kind = kind;
  ev.window = (void *)wrapper;
  ev.button = -1;
  return ev;
}

static void chengGuiMacFillLocation(ChengGuiMacEvent *ev, NSEvent *event, ChengGuiMacWindow *wrapper) {
  if (!ev || !event || !wrapper || !wrapper->contentView) {
    return;
  }
  NSPoint location = [event locationInWindow];
  if (wrapper->window != nil && event.window != wrapper->window) {
    NSRect screenRect = NSMakeRect(location.x, location.y, 0.0, 0.0);
    NSRect windowRect = [wrapper->window convertRectFromScreen:screenRect];
    location = windowRect.origin;
  }
  NSPoint converted = [wrapper->contentView convertPoint:location fromView:nil];
  ev->x = converted.x;
  ev->y = converted.y;
}

static bool chengGuiMacIsPointerEventType(NSEventType type) {
  switch (type) {
  case NSEventTypeLeftMouseDown:
  case NSEventTypeRightMouseDown:
  case NSEventTypeOtherMouseDown:
  case NSEventTypeLeftMouseUp:
  case NSEventTypeRightMouseUp:
  case NSEventTypeOtherMouseUp:
  case NSEventTypeMouseMoved:
  case NSEventTypeLeftMouseDragged:
  case NSEventTypeRightMouseDragged:
  case NSEventTypeOtherMouseDragged:
  case NSEventTypeScrollWheel:
  case NSEventTypeMouseExited:
  case NSEventTypeMouseEntered:
    return true;
  default:
    return false;
  }
}

static void chengGuiMacPushPointerEvent(ChengGuiMacWindow *wrapper, NSEvent *event, int kind, bool includeDelta) {
  if (!wrapper || !event) {
    return;
  }
  ChengGuiMacEvent ev = chengGuiMacMakeEvent(wrapper, kind);
  ev.button = (int)event.buttonNumber;
  ev.modifiers = (unsigned int)chengGuiMacNormalizeFlags(event.modifierFlags);
  wrapper->modifierFlags = (NSEventModifierFlags)ev.modifiers;
  chengGuiMacFillLocation(&ev, event, wrapper);
  if (includeDelta) {
    ev.deltaX = event.deltaX;
    ev.deltaY = event.deltaY;
  }
  chengGuiMacPushEvent(ev);
}

static void chengGuiMacPushScrollEvent(ChengGuiMacWindow *wrapper, NSEvent *event) {
  if (!wrapper || !event) {
    return;
  }
  ChengGuiMacEvent ev = chengGuiMacMakeEvent(wrapper, ChengGuiMacEventPointerScroll);
  ev.modifiers = (unsigned int)chengGuiMacNormalizeFlags(event.modifierFlags);
  wrapper->modifierFlags = (NSEventModifierFlags)ev.modifiers;
  chengGuiMacFillLocation(&ev, event, wrapper);
  ev.deltaX = event.scrollingDeltaX;
  ev.deltaY = event.scrollingDeltaY;
  if (event.hasPreciseScrollingDeltas) {
    ev.deltaX /= 120.0;
    ev.deltaY /= 120.0;
  }
  chengGuiMacPushEvent(ev);
}

static NSEventModifierFlags chengGuiMacModifierMaskForKeyCode(unsigned short keyCode) {
  switch (keyCode) {
  case 56:  // left shift
  case 60:  // right shift
    return NSEventModifierFlagShift;
  case 59:  // left control
  case 62:  // right control
    return NSEventModifierFlagControl;
  case 58:  // left option
  case 61:  // right option
    return NSEventModifierFlagOption;
  case 55:  // left command
  case 54:  // right command
    return NSEventModifierFlagCommand;
  case 57:  // caps lock
    return NSEventModifierFlagCapsLock;
  default:
    return 0;
  }
}

static void chengGuiMacCopyStringToEvent(ChengGuiMacEvent *ev, NSString *text) {
  if (ev == NULL || text == nil) {
    return;
  }
  NSData *utf8 = [text dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES];
  if (utf8.length == 0) {
    ev->text[0] = '\0';
    return;
  }
  size_t copyLen = (size_t)utf8.length;
  if (copyLen >= sizeof(ev->text)) {
    copyLen = sizeof(ev->text) - 1;
  }
  memcpy(ev->text, utf8.bytes, copyLen);
  ev->text[copyLen] = '\0';
}

static void chengGuiMacPushTextString(
  ChengGuiMacWindow *wrapper,
  NSString *text,
  NSEventModifierFlags flags
) {
  if (wrapper == NULL || text == nil) {
    return;
  }
  ChengGuiMacEvent ev = chengGuiMacMakeEvent(wrapper, ChengGuiMacEventTextInput);
  chengGuiMacCopyStringToEvent(&ev, text);
  ev.modifiers = (unsigned int)chengGuiMacNormalizeFlags(flags);
  chengGuiMacPushEvent(ev);
}

static void chengGuiMacPushCompositionEvent(
  ChengGuiMacWindow *wrapper,
  int kind,
  NSString *text,
  NSEventModifierFlags flags
) {
  if (wrapper == NULL) {
    return;
  }
  ChengGuiMacEvent ev = chengGuiMacMakeEvent(wrapper, kind);
  chengGuiMacCopyStringToEvent(&ev, text ?: @"");
  ev.modifiers = (unsigned int)chengGuiMacNormalizeFlags(flags);
  chengGuiMacPushEvent(ev);
}

#if 0
static bool chengGuiMacShouldEmitCharacters(NSString *characters) {
  if (characters == nil || characters.length == 0) {
    return false;
  }
  unichar ch = [characters characterAtIndex:0];
  if ([[NSCharacterSet controlCharacterSet] characterIsMember:ch]) {
    return ch == '\t' || ch == '\n' || ch == '\r';
  }
  return true;
}


static void chengGuiMacEmitTextEvent(ChengGuiMacWindow *wrapper, NSEvent *event) {
  if (!wrapper) {
    return;
  }
  NSString *characters = [event characters];
  if (!chengGuiMacShouldEmitCharacters(characters)) {
    return;
  }
  NSData *utf8 = [characters dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES];
  if (utf8.length == 0) {
    return;
  }
  ChengGuiMacEvent textEv = chengGuiMacMakeEvent(wrapper, ChengGuiMacEventTextInput);
  size_t copyLen = (size_t)utf8.length;
  if (copyLen >= sizeof(textEv.text)) {
    copyLen = sizeof(textEv.text) - 1;
  }
  memcpy(textEv.text, utf8.bytes, copyLen);
  textEv.text[copyLen] = '\\0';
  textEv.modifiers = (unsigned int)chengGuiMacNormalizeFlags(event.modifierFlags);
  chengGuiMacPushEvent(textEv);
}
#endif

static bool chengGuiMacTranslateNSEvent(NSEvent *event, ChengGuiMacEvent *outEvent) {
  if (!event || !outEvent) {
    return false;
  }
  switch (event.type) {
  case NSEventTypeFlagsChanged:
  case NSEventTypeKeyDown:
  case NSEventTypeKeyUp:
  case NSEventTypeLeftMouseDown:
  case NSEventTypeRightMouseDown:
  case NSEventTypeOtherMouseDown:
  case NSEventTypeLeftMouseUp:
  case NSEventTypeRightMouseUp:
  case NSEventTypeOtherMouseUp:
  case NSEventTypeMouseMoved:
  case NSEventTypeLeftMouseDragged:
  case NSEventTypeRightMouseDragged:
  case NSEventTypeOtherMouseDragged:
  case NSEventTypeScrollWheel:
  case NSEventTypeMouseExited:
  case NSEventTypeMouseEntered:
    break;
  default:
    return false;
  }

  NSWindow *targetWindow = event.window ?: [NSApp keyWindow];
  ChengGuiMacWindow *wrapper = chengGuiMacLookupWindow(targetWindow);
  if (!wrapper && gChengPrimaryWindow != NULL) {
    wrapper = gChengPrimaryWindow;
  }
  if (!wrapper) {
    return false;
  }
  ChengGuiMacEvent ev = chengGuiMacMakeEvent(wrapper, ChengGuiMacEventNone);
  NSEventModifierFlags normalized = chengGuiMacNormalizeFlags(event.modifierFlags);
  bool pointerEvent = chengGuiMacIsPointerEventType(event.type);
  if (pointerEvent) {
    if (normalized == 0 && wrapper->modifierFlags != 0) {
      normalized = wrapper->modifierFlags;
    } else if (normalized != 0 && wrapper->modifierFlags != normalized) {
      wrapper->modifierFlags = normalized;
    }
  }
  ev.modifiers = (unsigned int)normalized;
  switch (event.type) {
  case NSEventTypeFlagsChanged: {
    NSEventModifierFlags normalized = chengGuiMacNormalizeFlags(event.modifierFlags);
    NSEventModifierFlags mask = chengGuiMacModifierMaskForKeyCode(event.keyCode);
    bool wasPressed = (wrapper->modifierFlags & mask) != 0;
    bool isPressed = (normalized & mask) != 0;
    wrapper->modifierFlags = normalized;
    if (mask == 0 && !isPressed && !wasPressed) {
      return false;
    }
    if (mask == NSEventModifierFlagCapsLock) {
      ev.kind = isPressed ? ChengGuiMacEventKeyDown : ChengGuiMacEventKeyUp;
      ev.keyCode = (unsigned int)event.keyCode;
      ev.modifiers = (unsigned int)normalized;
      break;
    }
    if (mask == 0 || wasPressed == isPressed) {
      return false;
    }
    ev.kind = isPressed ? ChengGuiMacEventKeyDown : ChengGuiMacEventKeyUp;
    ev.keyCode = (unsigned int)event.keyCode;
    ev.modifiers = (unsigned int)normalized;
    break;
  }
  case NSEventTypeKeyDown:
    ev.kind = ChengGuiMacEventKeyDown;
    ev.keyCode = (unsigned int)event.keyCode;
    ev.repeatFlag = event.isARepeat;
    chengGuiMacCopyStringToEvent(&ev, event.charactersIgnoringModifiers);
    wrapper->modifierFlags = chengGuiMacNormalizeFlags(event.modifierFlags);
    break;
  case NSEventTypeKeyUp:
    ev.kind = ChengGuiMacEventKeyUp;
    ev.keyCode = (unsigned int)event.keyCode;
    wrapper->modifierFlags = chengGuiMacNormalizeFlags(event.modifierFlags);
    break;
  case NSEventTypeLeftMouseDown:
  case NSEventTypeRightMouseDown:
  case NSEventTypeOtherMouseDown:
    ev.kind = ChengGuiMacEventPointerDown;
    ev.button = (int)event.buttonNumber;
    chengGuiMacFillLocation(&ev, event, wrapper);
    wrapper->pointerInside = YES;
    break;
  case NSEventTypeLeftMouseUp:
  case NSEventTypeRightMouseUp:
  case NSEventTypeOtherMouseUp:
    ev.kind = ChengGuiMacEventPointerUp;
    ev.button = (int)event.buttonNumber;
    chengGuiMacFillLocation(&ev, event, wrapper);
    wrapper->pointerInside = YES;
    break;
  case NSEventTypeMouseMoved:
  case NSEventTypeLeftMouseDragged:
  case NSEventTypeRightMouseDragged:
  case NSEventTypeOtherMouseDragged:
    ev.kind = ChengGuiMacEventPointerMove;
    ev.button = -1;
    chengGuiMacFillLocation(&ev, event, wrapper);
    ev.deltaX = event.deltaX;
    ev.deltaY = event.deltaY;
    wrapper->pointerInside = YES;
    break;
  case NSEventTypeScrollWheel:
    ev.kind = ChengGuiMacEventPointerScroll;
    chengGuiMacFillLocation(&ev, event, wrapper);
    ev.deltaX = event.scrollingDeltaX;
    ev.deltaY = event.scrollingDeltaY;
    if (event.hasPreciseScrollingDeltas) {
      ev.deltaX /= 120.0;
      ev.deltaY /= 120.0;
    }
    wrapper->pointerInside = YES;
    break;
  case NSEventTypeMouseExited:
    if (!wrapper->pointerInside) {
      return false;
    }
    wrapper->pointerInside = NO;
    ev.kind = ChengGuiMacEventPointerLeave;
    chengGuiMacFillLocation(&ev, event, wrapper);
    break;
  case NSEventTypeMouseEntered:
    wrapper->pointerInside = YES;
    return false;
  default:
    return false;
  }
  *outEvent = ev;
  return true;
}

static int chengGuiMacDrainQueueInto(ChengGuiMacEvent *events, int maxEvents) {
  if (gChengEventQueue == nil || maxEvents <= 0) {
    return 0;
  }
  int emitted = 0;
  while (emitted < maxEvents && gChengEventQueue.count > 0) {
    NSValue *value = gChengEventQueue.firstObject;
    [gChengEventQueue removeObjectAtIndex:0];
    if (value != nil) {
      [value getValue:&events[emitted]];
      emitted += 1;
    }
  }
  return emitted;
}

void chengGuiMacInitialize(void) {
  chengGuiMacEnsureInitialized();
}

void chengGuiMacShutdown(void) {
  @autoreleasepool {
    if (gChengEventQueue != nil) {
      [gChengEventQueue removeAllObjects];
      gChengEventQueue = nil;
    }
    if (gChengWindowMap != nil) {
      [gChengWindowMap removeAllObjects];
      gChengWindowMap = nil;
    }
    gChengPrimaryWindow = NULL;
  }
  gChengAppInitialized = NO;
}

void *chengGuiMacCreateWindow(
  const char *title,
  double x,
  double y,
  double width,
  double height,
  bool resizable,
  bool highDpi
) {
  chengGuiMacEnsureInitialized();
  @autoreleasepool {
    if (chengGuiMacDebugEnabled()) {
      fprintf(stderr,
              "[gui-macos] create-window main_thread=%d app=%p req=%.1fx%.1f at %.1f,%.1f\n",
              [NSThread isMainThread] ? 1 : 0,
              NSApp,
              width,
              height,
              x,
              y);
    }
    chengGuiMacPromoteProcessToForeground();
    NSRect rect = NSMakeRect(x, y, width, height);
    NSUInteger style = NSWindowStyleMaskTitled |
                       NSWindowStyleMaskClosable |
                       NSWindowStyleMaskMiniaturizable;
    if (resizable) {
      style |= NSWindowStyleMaskResizable;
    }
    NSWindow *window = [[NSWindow alloc] initWithContentRect:rect
                                                   styleMask:style
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    if (window == nil) {
      chengGuiMacDebugLog("create-window", "NSWindow init failed");
      return NULL;
    }
    [window setReleasedWhenClosed:NO];
    NSString *nsTitle = title != NULL ? [NSString stringWithUTF8String:title] : @"Cheng IDE";
    [window setTitle:nsTitle];
    [window center];
    [NSApp activateIgnoringOtherApps:YES];
    [window setLevel:NSNormalWindowLevel];
    [window setCollectionBehavior:NSWindowCollectionBehaviorMoveToActiveSpace];
    if (width < 320.0) {
      width = 1080.0;
    }
    if (height < 240.0) {
      height = 760.0;
    }
    [window setContentSize:NSMakeSize(width, height)];
    [window setContentMinSize:NSMakeSize(640.0, 420.0)];

    ChengGuiInputView *inputView = [[ChengGuiInputView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
    inputView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    inputView.wantsLayer = YES;
    if (inputView.layer == nil) {
      inputView.layer = [CALayer layer];
    }
    if (highDpi) {
      NSScreen *screen = window.screen ?: [NSScreen mainScreen];
      CGFloat scale = screen ? screen.backingScaleFactor : 1.0;
      inputView.layer.contentsScale = scale;
    }
    inputView.layer.backgroundColor = [[NSColor colorWithCalibratedRed:0xFF/255.0
                                                                 green:0xFF/255.0
                                                                  blue:0xFF/255.0
                                                                 alpha:1.0] CGColor];
    inputView.layer.opaque = YES;
    [window setContentView:inputView];
    window.ignoresMouseEvents = NO;
    [window setAcceptsMouseMovedEvents:YES];
    [window setInitialFirstResponder:inputView];
    [window makeFirstResponder:inputView];
    [window makeKeyAndOrderFront:nil];
    if (!window.isKeyWindow) {
      [window makeKeyWindow];
    }
    [window orderFrontRegardless];
    [window displayIfNeeded];
    [NSApp activateIgnoringOtherApps:YES];
    if (chengGuiMacDebugEnabled()) {
      NSRect frameRect = window.frame;
      NSRect contentRect = [window contentRectForFrameRect:window.frame];
      fprintf(stderr,
              "[gui-macos] window visible=%d key=%d level=%ld frame=%.1fx%.1f content=%.1fx%.1f\n",
              window.isVisible ? 1 : 0,
              window.isKeyWindow ? 1 : 0,
              (long)window.level,
              frameRect.size.width,
              frameRect.size.height,
              contentRect.size.width,
              contentRect.size.height);
    }

    ChengGuiMacWindow *wrapper = calloc(1, sizeof(ChengGuiMacWindow));
    if (wrapper == NULL) {
      chengGuiMacDebugLog("create-window", "wrapper alloc failed");
      [window close];
      return NULL;
    }
    wrapper->window = window;
    wrapper->contentView = inputView;
    wrapper->modifierFlags = 0;
    wrapper->pointerInside = NO;
    wrapper->windowStrong = CFBridgingRetain(window);
    wrapper->contentViewStrong = CFBridgingRetain(inputView);

    ChengGuiWindowDelegate *delegate = [[ChengGuiWindowDelegate alloc] init];
    delegate.wrapper = wrapper;
    window.delegate = delegate;
    wrapper->delegate = delegate;
    wrapper->delegateStrong = CFBridgingRetain(delegate);
    // NSWindow.delegate is not retained; keep a strong ref to avoid a dangling pointer under ARC.
    objc_setAssociatedObject(window, kChengGuiDelegateKey, delegate, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    inputView.wrapper = wrapper;
    chengGuiMacRegisterWindow(wrapper);
    chengGuiMacDebugLog("create-window", "window created");
    return (void *)wrapper;
  }
}

void *chengGuiMacCreateDefaultWindow(const char *title) {
  chengGuiMacDebugLog("native", "create-default-window");
  return chengGuiMacCreateWindow(title, 100.0, 100.0, 1280.0, 800.0, true, true);
}

void chengGuiMacDestroyWindow(void *handle) {
  if (handle == NULL) {
    return;
  }
  @autoreleasepool {
    ChengGuiMacWindow *wrapper = (ChengGuiMacWindow *)handle;
    NSWindow *window = wrapper->window;
    ChengGuiInputView *contentView = wrapper->contentView;
    ChengGuiWindowDelegate *delegate = wrapper->delegate;
    if (contentView != nil) {
      contentView.wrapper = NULL;
    }
    if (delegate != nil) {
      delegate.wrapper = NULL;
    }
    chengGuiMacUnregisterWindow(wrapper);
    if (window != nil) {
      window.delegate = nil;
      objc_setAssociatedObject(window, kChengGuiDelegateKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      [window setContentView:nil];
      [window orderOut:nil];
      [window close];
    }
    wrapper->delegate = nil;
    wrapper->window = nil;
    wrapper->contentView = nil;
    if (wrapper->delegateStrong != NULL) {
      CFRelease(wrapper->delegateStrong);
      wrapper->delegateStrong = NULL;
    }
    if (wrapper->contentViewStrong != NULL) {
      CFRelease(wrapper->contentViewStrong);
      wrapper->contentViewStrong = NULL;
    }
    if (wrapper->windowStrong != NULL) {
      CFRelease(wrapper->windowStrong);
      wrapper->windowStrong = NULL;
    }
    free(wrapper);
  }
}

int chengGuiMacPollEvents(ChengGuiMacEvent *events, int maxEvents, int timeoutMs) {
  chengGuiMacEnsureInitialized();
  @autoreleasepool {
    int emitted = chengGuiMacDrainQueueInto(events, maxEvents);
    if (emitted >= maxEvents) {
      return emitted;
    }
    double timeoutSeconds = timeoutMs > 0 ? ((double)timeoutMs) / 1000.0 : 0.0;
    NSDate *limit = timeoutMs > 0 ? [NSDate dateWithTimeIntervalSinceNow:timeoutSeconds] : [NSDate distantPast];
    while (emitted < maxEvents) {
      // Pull tracking-mode events first so long idle waits don't mask clicks/drags.
      NSEvent *event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                          untilDate:[NSDate distantPast]
                                             inMode:NSEventTrackingRunLoopMode
                                            dequeue:YES];
      if (event == nil) {
        event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                   untilDate:limit
                                      inMode:NSDefaultRunLoopMode
                                     dequeue:YES];
      }
      if (event == nil) {
        break;
      }
      ChengGuiMacEvent translated;
      bool translatedOk = chengGuiMacTranslateNSEvent(event, &translated);
      bool pointerEvent = chengGuiMacIsPointerEventType(event.type);
      bool useViewEvents = pointerEvent && gChengUseViewPointerEvents;
      NSUInteger queueBefore = gChengEventQueue != nil ? gChengEventQueue.count : 0;
      if (!useViewEvents && translatedOk) {
        events[emitted++] = translated;
        if (emitted >= maxEvents) {
          [NSApp sendEvent:event];
          [NSApp updateWindows];
          break;
        }
      }
      [NSApp sendEvent:event];
      [NSApp updateWindows];
      NSUInteger queueAfter = gChengEventQueue != nil ? gChengEventQueue.count : 0;
      if (useViewEvents && queueAfter <= queueBefore && translatedOk) {
        events[emitted++] = translated;
        if (emitted >= maxEvents) {
          break;
        }
      }
      emitted += chengGuiMacDrainQueueInto(events + emitted, maxEvents - emitted);
      limit = timeoutMs > 0 ? [NSDate dateWithTimeIntervalSinceNow:0.0] : [NSDate distantPast];
    }
    if (emitted == 0) {
      NSDate *runUntil = timeoutMs > 0 ? [NSDate dateWithTimeIntervalSinceNow:timeoutSeconds] : [NSDate distantPast];
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                               beforeDate:runUntil];
      [[NSRunLoop currentRunLoop] runMode:NSEventTrackingRunLoopMode
                               beforeDate:[NSDate distantPast]];
      emitted += chengGuiMacDrainQueueInto(events, maxEvents);
    }
    return emitted;
  }
}

void *chengGuiMacCreateSurface(void *windowHandle) {
  if (windowHandle == NULL) {
    return NULL;
  }
  ChengGuiMacWindow *wrapper = (ChengGuiMacWindow *)windowHandle;
  ChengGuiMacSurface *surface = calloc(1, sizeof(ChengGuiMacSurface));
  if (surface == NULL) {
    return NULL;
  }
  surface->wrapper = wrapper;
  surface->logicalWidth = 0.0;
  surface->logicalHeight = 0.0;
  surface->pixelWidth = 0.0;
  surface->pixelHeight = 0.0;
  surface->scale = 1.0;
  surface->colorSpace = kChengColorSpaceSRGB;
  @autoreleasepool {
    NSView *view = wrapper->contentView;
    NSWindow *window = wrapper->window;
    if (window != nil) {
      [window layoutIfNeeded];
    }
    if (view != nil) {
      NSRect bounds = view.bounds;
      if ((bounds.size.width <= 1.0 || bounds.size.height <= 1.0) && window != nil) {
        NSRect contentRect = [window contentRectForFrameRect:window.frame];
        if (contentRect.size.width > 1.0 && contentRect.size.height > 1.0) {
          [view setFrame:NSMakeRect(0.0, 0.0, contentRect.size.width, contentRect.size.height)];
          bounds = view.bounds;
        }
      }
      NSScreen *screen = window.screen ?: [NSScreen mainScreen];
      CGFloat scale = screen ? screen.backingScaleFactor : 1.0;
      if (scale <= 0.0) {
        scale = 1.0;
      }
      NSRect backing = [view convertRectToBacking:bounds];
      surface->logicalWidth = bounds.size.width;
      surface->logicalHeight = bounds.size.height;
      surface->pixelWidth = backing.size.width;
      surface->pixelHeight = backing.size.height;
      surface->scale = scale;
    }
  }
  return surface;
}

void chengGuiMacDestroySurface(void *surfaceHandle) {
  if (surfaceHandle == NULL) {
    return;
  }
  ChengGuiMacSurface *surface = (ChengGuiMacSurface *)surfaceHandle;
  if (surface->image != NULL) {
    CGImageRelease(surface->image);
    surface->image = NULL;
  }
  if (surface->imageProvider != NULL) {
    CGDataProviderRelease(surface->imageProvider);
    surface->imageProvider = NULL;
  }
  if (surface->imageColorSpace != NULL) {
    CGColorSpaceRelease(surface->imageColorSpace);
    surface->imageColorSpace = NULL;
  }
  if (surface->frameBuffer != NULL) {
    free(surface->frameBuffer);
    surface->frameBuffer = NULL;
    surface->frameBufferBytes = 0;
  }
  free(surface);
}

int chengGuiMacBeginFrame(void *surfaceHandle) {
  if (surfaceHandle == NULL) {
    return -1;
  }
  ChengGuiMacSurface *surface = (ChengGuiMacSurface *)surfaceHandle;
  if (surface->wrapper == NULL || surface->wrapper->contentView == nil) {
    if (chengGuiMacDebugEnabled()) {
      fprintf(stderr, "[gui-macos] begin missing wrapper=%p view=%p\n",
              surface->wrapper,
              surface->wrapper != NULL ? surface->wrapper->contentView : nil);
    }
    return -2;
  }
  @autoreleasepool {
    NSView *view = surface->wrapper->contentView;
    NSWindow *window = surface->wrapper->window;
    if (window != nil) {
      [window layoutIfNeeded];
    }
    [view layoutSubtreeIfNeeded];
    if (view.layer == nil) {
      view.wantsLayer = YES;
      view.layer = [CALayer layer];
    }
    view.layer.geometryFlipped = NO;
    view.layer.backgroundColor = [[NSColor colorWithCalibratedRed:0xFF/255.0
                                                           green:0xFF/255.0
                                                            blue:0xFF/255.0
                                                           alpha:1.0] CGColor];
    view.layer.opaque = YES;
    NSScreen *screen = view.window.screen ?: [NSScreen mainScreen];
    CGFloat scale = screen ? screen.backingScaleFactor : 1.0;
    if (scale <= 0.0) {
      scale = view.layer.contentsScale > 0.0 ? view.layer.contentsScale : 1.0;
    }
    NSRect bounds = view.bounds;
    if ((bounds.size.width < 8.0 || bounds.size.height < 8.0) && window != nil) {
      NSView *contentView = window.contentView;
      if (contentView != nil) {
        [contentView layoutSubtreeIfNeeded];
        NSRect contentBounds = contentView.bounds;
        if (contentBounds.size.width > bounds.size.width) {
          bounds.size.width = contentBounds.size.width;
        }
        if (contentBounds.size.height > bounds.size.height) {
          bounds.size.height = contentBounds.size.height;
        }
      }
      NSRect layoutRect = window.contentLayoutRect;
      if (layoutRect.size.width > bounds.size.width) {
        bounds.size.width = layoutRect.size.width;
      }
      if (layoutRect.size.height > bounds.size.height) {
        bounds.size.height = layoutRect.size.height;
      }
    }
    if (bounds.size.width < 8.0 || bounds.size.height < 8.0) {
      if (surface->logicalWidth > 8.0 && surface->logicalHeight > 8.0) {
        bounds.size.width = surface->logicalWidth;
        bounds.size.height = surface->logicalHeight;
      } else {
        bounds.size.width = 1080.0;
        bounds.size.height = 760.0;
      }
    }
    NSRect backing = [view convertRectToBacking:NSMakeRect(0.0, 0.0, bounds.size.width, bounds.size.height)];
    if (backing.size.width < 8.0 || backing.size.height < 8.0) {
      backing.size.width = bounds.size.width * scale;
      backing.size.height = bounds.size.height * scale;
    }
    double ratio = 0.0;
    if (bounds.size.width > 0.0) {
      ratio = backing.size.width / bounds.size.width;
    }
    if ((ratio <= 0.0 || ratio > 8.0) && bounds.size.height > 0.0) {
      ratio = backing.size.height / bounds.size.height;
    }
    if (ratio > 0.25 && ratio < 8.0) {
      double diff = ratio - (double)scale;
      if (diff < 0.0) {
        diff = -diff;
      }
      if (diff > 0.01) {
        scale = (CGFloat)ratio;
      }
    }
    view.layer.contentsScale = scale;
    view.layer.backgroundColor = [[NSColor colorWithCalibratedRed:0x1E/255.0
                                                           green:0x1E/255.0
                                                            blue:0x22/255.0
                                                           alpha:1.0] CGColor];
    surface->logicalWidth = bounds.size.width;
    surface->logicalHeight = bounds.size.height;
    surface->pixelWidth = backing.size.width;
    surface->pixelHeight = backing.size.height;
    surface->scale = scale;
    surface->colorSpace = kChengColorSpaceSRGB;
    if (chengGuiMacDebugEnabled() && gChengBeginFrames < 10) {
      NSRect winFrame = window != nil ? window.frame : NSZeroRect;
      fprintf(stderr,
              "[gui-macos] begin frame=%d logical=%.1fx%.1f pixel=%.1fx%.1f scale=%.2f win=%.1fx%.1f\n",
              gChengBeginFrames,
              surface->logicalWidth,
              surface->logicalHeight,
              surface->pixelWidth,
              surface->pixelHeight,
              surface->scale,
              winFrame.size.width,
              winFrame.size.height);
    }
    gChengBeginFrames += 1;
    NSColorSpace *cspace = view.window.colorSpace ?: [NSColorSpace sRGBColorSpace];
    if (cspace != nil) {
      NSString *identifier = cspace.localizedName;
      if (identifier != nil) {
        NSRange rangeP3 = [identifier rangeOfString:@"P3" options:NSCaseInsensitiveSearch];
        NSRange rangeGeneric = [identifier rangeOfString:@"Generic" options:NSCaseInsensitiveSearch];
        if (rangeP3.location != NSNotFound) {
          surface->colorSpace = kChengColorSpaceDisplayP3;
        } else if (rangeGeneric.location != NSNotFound) {
          surface->colorSpace = kChengColorSpaceGenericRGB;
        }
      }
    }
  }
  return 0;
}

static void chengGuiMacReleasePixelBuffer(void *info, const void *data, size_t size) {
  (void)info;
  (void)size;
  free((void *)data);
}

int chengGuiMacPresentPixels(void *surfaceHandle,
                             const uint32_t *pixels,
                             int width,
                             int height,
                             int strideBytes) {
  if (surfaceHandle == NULL || pixels == NULL) {
    if (chengGuiMacDebugEnabled()) {
      fprintf(stderr, "[gui-macos] present skipped surface=%p pixels=%p\n", surfaceHandle, pixels);
    }
    return -1;
  }
  ChengGuiMacSurface *surface = (ChengGuiMacSurface *)surfaceHandle;
  if (surface->wrapper == NULL || surface->wrapper->contentView == nil) {
    if (chengGuiMacDebugEnabled()) {
      fprintf(stderr, "[gui-macos] present missing view\n");
    }
    return -2;
  }
  if (width <= 0 || height <= 0) {
    if (chengGuiMacDebugEnabled()) {
      fprintf(stderr, "[gui-macos] present invalid size %dx%d\n", width, height);
    }
    return -3;
  }
  size_t rowBytes = strideBytes > 0 ? (size_t)strideBytes : (size_t)width * 4u;
  size_t totalBytes = rowBytes * (size_t)height;
  if (totalBytes == 0) {
    return -4;
  }
  if (chengGuiMacDebugEnabled() && gChengPresentFrames < 5) {
    fprintf(stderr, "[gui-macos] present frame=%d size=%dx%d bytes=%zu\n",
            gChengPresentFrames, width, height, totalBytes);
    const uint8_t *sampleRow0 = (const uint8_t *)pixels;
    const uint8_t *sampleRowMid = (const uint8_t *)pixels + ((size_t)(height / 2) * rowBytes);
    uint32_t px0 = 0;
    uint32_t pxMid = 0;
    uint32_t px1 = 0;
    uint32_t px2 = 0;
    uint32_t px3 = 0;
    uint32_t px4 = 0;
    size_t sx1 = (size_t)(width > 120 ? 40 : width / 3);
    size_t sy1 = (size_t)(height > 120 ? 40 : height / 3);
    size_t sx2 = (size_t)(width > 220 ? 120 : width / 2);
    size_t sy2 = (size_t)(height > 220 ? 120 : height / 2);
    size_t sx3 = (size_t)(width > 280 ? 220 : width / 2);
    size_t sy3 = (size_t)(height > 340 ? 260 : height / 2);
    size_t sx4 = (size_t)(width > 900 ? 860 : (width * 3 / 4));
    size_t sy4 = (size_t)(height > 460 ? 420 : (height * 2 / 3));
    memcpy(&px0, sampleRow0, sizeof(uint32_t));
    memcpy(&pxMid, sampleRowMid + ((size_t)(width / 2) * 4u), sizeof(uint32_t));
    memcpy(&px1, (const uint8_t *)pixels + sy1 * rowBytes + sx1 * 4u, sizeof(uint32_t));
    memcpy(&px2, (const uint8_t *)pixels + sy2 * rowBytes + sx2 * 4u, sizeof(uint32_t));
    memcpy(&px3, (const uint8_t *)pixels + sy3 * rowBytes + sx3 * 4u, sizeof(uint32_t));
    memcpy(&px4, (const uint8_t *)pixels + sy4 * rowBytes + sx4 * 4u, sizeof(uint32_t));
    fprintf(stderr,
            "[gui-macos] present sample px0=0x%08X pxMid=0x%08X p1=0x%08X p2=0x%08X p3=0x%08X p4=0x%08X\n",
            (unsigned)px0, (unsigned)pxMid, (unsigned)px1, (unsigned)px2, (unsigned)px3, (unsigned)px4);
  }
  gChengPresentFrames += 1;
  bool sizeChanged = surface->imageWidth != width || surface->imageHeight != height || surface->imageRowBytes != rowBytes;
  if (surface->frameBuffer == NULL || surface->frameBufferBytes != totalBytes) {
    if (surface->frameBuffer != NULL) {
      free(surface->frameBuffer);
      surface->frameBuffer = NULL;
      surface->frameBufferBytes = 0;
    }
    surface->frameBuffer = (uint32_t *)malloc(totalBytes);
    if (surface->frameBuffer == NULL) {
      return -5;
    }
    surface->frameBufferBytes = totalBytes;
    sizeChanged = true;
  }
  memcpy(surface->frameBuffer, pixels, totalBytes);
  bool forceProvider = chengGuiMacEnvFlag("GUI_FORCE_IMAGE_RECREATE", false);
  if (surface->image != NULL) {
    CGImageRelease(surface->image);
    surface->image = NULL;
  }
  if (sizeChanged || surface->imageProvider == NULL || forceProvider) {
    if (surface->imageProvider != NULL) {
      CGDataProviderRelease(surface->imageProvider);
      surface->imageProvider = NULL;
    }
    CGDataProviderRef provider = CGDataProviderCreateWithData(
      NULL,
      surface->frameBuffer,
      totalBytes,
      NULL
    );
    if (provider == NULL) {
      return -6;
    }
    surface->imageProvider = provider;
  }
  if (surface->imageColorSpace == NULL) {
    surface->imageColorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    if (surface->imageColorSpace == NULL) {
      return -7;
    }
  }
  CGBitmapInfo bitmapInfo = (CGBitmapInfo)(kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
  CGImageRef image = CGImageCreate(
    (size_t)width,
    (size_t)height,
    8,
    32,
    rowBytes,
    surface->imageColorSpace,
    bitmapInfo,
    surface->imageProvider,
    NULL,
    false,
    kCGRenderingIntentDefault
  );
  if (image == NULL) {
    return -8;
  }
  surface->image = image;
  surface->imagePixels = surface->frameBuffer;
  surface->imageWidth = width;
  surface->imageHeight = height;
  surface->imageRowBytes = rowBytes;
  @autoreleasepool {
    NSView *view = surface->wrapper->contentView;
    if (view.layer == nil) {
      view.wantsLayer = YES;
      view.layer = [CALayer layer];
    }
    NSRect bounds = view.bounds;
    if (bounds.size.width < 8.0 || bounds.size.height < 8.0) {
      NSWindow *window = view.window;
      if (window != nil) {
        bounds = window.contentView.bounds;
      }
    }
    if (bounds.size.width < 8.0 || bounds.size.height < 8.0) {
      bounds = NSMakeRect(0.0, 0.0, (CGFloat)width, (CGFloat)height);
    }
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    view.layer.geometryFlipped = NO;
    view.layer.frame = bounds;
    view.layer.bounds = bounds;
    view.layer.contents = (__bridge id)surface->image;
    view.layer.contentsGravity = kCAGravityResize;
    view.layer.contentsScale = surface->scale > 0.0 ? surface->scale : 1.0;
    [CATransaction commit];
  }
  return 0;
}

int chengGuiMacPresentPixelsPayload(void *surfaceHandle, const ChengGuiMacPresentPayload *payload) {
  if (payload == NULL) {
    return -1;
  }
  return chengGuiMacPresentPixels(surfaceHandle, payload->pixels, payload->width, payload->height, payload->strideBytes);
}

int chengGuiMacEndFrame(void *surfaceHandle) {
  if (surfaceHandle == NULL) {
    return -1;
  }
  ChengGuiMacSurface *surface = (ChengGuiMacSurface *)surfaceHandle;
  if (surface->wrapper == NULL || surface->wrapper->contentView == nil) {
    return -2;
  }
  @autoreleasepool {
    NSView *view = surface->wrapper->contentView;
    [view setNeedsDisplay:YES];
    [view displayIfNeeded];
    if (surface->wrapper->window != nil) {
      [surface->wrapper->window displayIfNeeded];
    }
    [CATransaction flush];
  }
  return 0;
}

int chengGuiMacGetSurfaceInfo(void *surfaceHandle, ChengGuiMacSurfaceInfo *outInfo) {
  if (surfaceHandle == NULL || outInfo == NULL) {
    return -1;
  }
  ChengGuiMacSurface *surface = (ChengGuiMacSurface *)surfaceHandle;
  if (surface->wrapper == NULL || surface->wrapper->contentView == nil) {
    return -2;
  }
  @autoreleasepool {
    if (surface->logicalWidth <= 0.0 || surface->logicalHeight <= 0.0) {
      (void)chengGuiMacBeginFrame(surfaceHandle);
    }
    outInfo->logicalWidth = surface->logicalWidth;
    outInfo->logicalHeight = surface->logicalHeight;
    outInfo->pixelWidth = surface->pixelWidth;
    outInfo->pixelHeight = surface->pixelHeight;
    outInfo->scale = surface->scale;
    outInfo->colorSpace = surface->colorSpace;
  }
  return 0;
}

size_t chengGuiMacEventStructSize(void) {
  return sizeof(ChengGuiMacEvent);
}

size_t chengGuiMacSurfaceInfoStructSize(void) {
  return sizeof(ChengGuiMacSurfaceInfo);
}

static uint64_t chengGuiFnv1a64(const uint8_t *data, size_t len) {
  uint64_t hash = 1469598103934665603ULL;
  if (data == NULL || len == 0) {
    return hash;
  }
  for (size_t idx = 0; idx < len; idx++) {
    hash ^= (uint64_t)data[idx];
    hash *= 1099511628211ULL;
  }
  return hash;
}

uint64_t chengGuiMacSurfaceFrameHash(void *surfaceHandle) {
  if (surfaceHandle == NULL) {
    return 0ULL;
  }
  ChengGuiMacSurface *surface = (ChengGuiMacSurface *)surfaceHandle;
  if (surface->frameBuffer == NULL || surface->frameBufferBytes == 0) {
    return 0ULL;
  }
  uint64_t hash = chengGuiFnv1a64((const uint8_t *)surface->frameBuffer, surface->frameBufferBytes);
  hash ^= (uint64_t)(uint32_t)surface->imageWidth;
  hash *= 1099511628211ULL;
  hash ^= (uint64_t)(uint32_t)surface->imageHeight;
  hash *= 1099511628211ULL;
  return hash;
}

int chengGuiMacSurfaceReadbackRgba(void *surfaceHandle, const char *outPath) {
  if (surfaceHandle == NULL || outPath == NULL) {
    return -1;
  }
  ChengGuiMacSurface *surface = (ChengGuiMacSurface *)surfaceHandle;
  if (surface->frameBuffer == NULL || surface->frameBufferBytes == 0) {
    return -2;
  }
  FILE *fp = fopen(outPath, "wb");
  if (fp == NULL) {
    return -3;
  }
  size_t wrote = fwrite((const void *)surface->frameBuffer, 1, surface->frameBufferBytes, fp);
  int rc = fclose(fp);
  if (wrote != surface->frameBufferBytes) {
    return -4;
  }
  if (rc != 0) {
    return -5;
  }
  return 0;
}

int chengGuiMacDrawTextBgra(
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
);
int chengGuiMacDrawTextBgraLen(
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
);
int chengGuiMacDrawTextBgraLenI(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  int x,
  int y,
  int w,
  int h,
  uint32_t color,
  int fontSizeX100,
  const char *text,
  int textLen
);
int chengGuiMacDrawTextBgraCode(
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
);
int chengGuiMacDrawTextBgraIcon(
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
);
int chengGuiMacDrawTextBgraFileIcon(
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
);

void chengGuiNativeInitialize(void) {
  chengGuiMacInitialize();
}

void chengGuiNativeShutdown(void) {
  chengGuiMacShutdown();
}

void *chengGuiNativeCreateDefaultWindow(const char *title) {
  chengGuiMacDebugLog("native", "create-default-window entry");
  return chengGuiMacCreateDefaultWindow(title);
}

void chengGuiNativeDestroyWindow(void *handle) {
  chengGuiMacDestroyWindow(handle);
}

int chengGuiNativePollEvents(void *events, int maxEvents, int timeoutMs) {
  return chengGuiMacPollEvents((ChengGuiMacEvent *)events, maxEvents, timeoutMs);
}

void *chengGuiNativeCreateSurface(void *windowHandle) {
  return chengGuiMacCreateSurface(windowHandle);
}

void chengGuiNativeDestroySurface(void *surfaceHandle) {
  chengGuiMacDestroySurface(surfaceHandle);
}

int chengGuiNativeBeginFrame(void *surfaceHandle) {
  return chengGuiMacBeginFrame(surfaceHandle);
}

int chengGuiNativeEndFrame(void *surfaceHandle) {
  return chengGuiMacEndFrame(surfaceHandle);
}

int chengGuiNativeGetSurfaceInfo(void *surfaceHandle, void *outInfo) {
  return chengGuiMacGetSurfaceInfo(surfaceHandle, (ChengGuiMacSurfaceInfo *)outInfo);
}

int chengGuiNativePresentPixels(
  void *surfaceHandle,
  void *pixels,
  int width,
  int height,
  int strideBytes
) {
  return chengGuiMacPresentPixels(surfaceHandle, pixels, width, height, strideBytes);
}

int chengGuiNativePresentPixelsPayload(void *surfaceHandle, const ChengGuiMacPresentPayload *payload) {
  return chengGuiMacPresentPixelsPayload(surfaceHandle, payload);
}

int chengGuiNativeDrawTextBgra(
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
  if (text == NULL) {
    return -1;
  }
  if ((uintptr_t)text < (uintptr_t)4096u) {
    return -2;
  }
  return chengGuiMacDrawTextBgra(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text);
}

int chengGuiNativeDrawTextBgraLen(
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
  if (text == NULL) {
    return -1;
  }
  if ((uintptr_t)text < (uintptr_t)4096u) {
    return -2;
  }
  if (textLen < 0 || textLen > (1 << 20)) {
    return -3;
  }
  return chengGuiMacDrawTextBgraLen(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text, textLen);
}

int chengGuiNativeDrawTextBgraLenI(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  int x,
  int y,
  int w,
  int h,
  uint32_t color,
  int fontSizeX100,
  const char *text,
  int textLen
) {
  if (text == NULL) {
    return -1;
  }
  if ((uintptr_t)text < (uintptr_t)4096u) {
    return -2;
  }
  if (textLen < 0 || textLen > (1 << 20)) {
    return -3;
  }
  return chengGuiMacDrawTextBgraLenI(
    pixels,
    width,
    height,
    strideBytes,
    x,
    y,
    w,
    h,
    color,
    fontSizeX100,
    text,
    textLen
  );
}

int chengGuiNativeDrawTextBgraCode(
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
  return chengGuiMacDrawTextBgraCode(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text);
}

int chengGuiNativeDrawTextBgraIcon(
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
  return chengGuiMacDrawTextBgraIcon(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text);
}

int chengGuiNativeDrawTextBgraFileIcon(
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
  return chengGuiMacDrawTextBgraFileIcon(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text);
}

size_t chengGuiNativeEventStructSize(void) {
  return chengGuiMacEventStructSize();
}
