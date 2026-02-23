#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <CoreText/CoreText.h>
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

static inline double clamp01(double v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

static void colorToRgba(uint32_t argb,
                        double *r,
                        double *g,
                        double *b,
                        double *a) {
  const double af = ((double)((argb >> 24) & 0xFFu)) / 255.0;
  const double rf = ((double)((argb >> 16) & 0xFFu)) / 255.0;
  const double gf = ((double)((argb >> 8) & 0xFFu)) / 255.0;
  const double bf = ((double)(argb & 0xFFu)) / 255.0;
  if (r) *r = clamp01(rf);
  if (g) *g = clamp01(gf);
  if (b) *b = clamp01(bf);
  if (a) *a = clamp01(af);
}

static int chengIconFontRegistered = 0;
static int chengFileIconFontRegistered = 0;
static int chengIconFontDebugged = 0;
static int chengFileIconFontDebugged = 0;

static CTFontDescriptorRef createIconFontDescriptor(double fontSize);
static CTFontDescriptorRef createFileIconFontDescriptor(double fontSize);
static CTFontRef createFontFromPath(const char *path, double fontSize);
static CTFontRef createChengIconFont(double fontSize);
static CTFontRef createChengFileIconFont(double fontSize);
static int chengFontHasGlyph(CTFontRef font, CFStringRef text);
static int chengFontHasCodepoint(CTFontRef font, uint32_t codepoint);
static int chengFontHasUtf8Glyph(CTFontRef font, const char *text);
static void chengDebugIconFontOnce(const char *kind,
                                   const char *path,
                                   CTFontRef font,
                                   uint32_t codepoint,
                                   int *printedFlag);

static size_t chengSafeTextLen(const char *text) {
  if (text == NULL) return 0;
  uintptr_t raw = (uintptr_t)text;
  if (raw < (uintptr_t)4096u) return 0;
  const size_t cap = 1u << 20;
  size_t n = strnlen(text, cap);
  if (n == cap) return 0;
  return n;
}

static CFStringRef chengCreateUtf8StringLen(const char *text, size_t byteLen) {
  if (text == NULL) return NULL;
  uintptr_t raw = (uintptr_t)text;
  if (raw < (uintptr_t)4096u) return NULL;
  if (byteLen > (size_t)(1u << 20)) return NULL;
  return CFStringCreateWithBytes(kCFAllocatorDefault,
                                 (const UInt8 *)text,
                                 (CFIndex)byteLen,
                                 kCFStringEncodingUTF8,
                                 false);
}

static CFStringRef chengCreateUtf8String(const char *text) {
  if (text == NULL) return NULL;
  size_t byteLen = chengSafeTextLen(text);
  if (byteLen == 0 && text[0] != '\0') {
    return NULL;
  }
  return chengCreateUtf8StringLen(text, byteLen);
}

static int chengCopyPathIfReadable(const char *path, char *buffer, size_t cap) {
  if (path == NULL || path[0] == '\0') return 0;
  int written = snprintf(buffer, cap, "%s", path);
  if (written <= 0 || (size_t)written >= cap) return 0;
  if (access(buffer, R_OK) == 0) return 1;
  return 0;
}

static int chengJoinPathIfReadable(const char *base, const char *suffix, char *buffer, size_t cap) {
  if (base == NULL || base[0] == '\0' || suffix == NULL || suffix[0] == '\0') return 0;
  int written = snprintf(buffer, cap, "%s/%s", base, suffix);
  if (written <= 0 || (size_t)written >= cap) return 0;
  if (access(buffer, R_OK) == 0) return 1;
  return 0;
}

static int chengExecutableDir(char *buffer, size_t cap) {
  if (buffer == NULL || cap == 0) return 0;
  uint32_t size = (uint32_t)cap;
  if (_NSGetExecutablePath(buffer, &size) != 0) return 0;
  buffer[cap - 1] = '\0';
  char resolved[PATH_MAX];
  const char *source = buffer;
  if (realpath(buffer, resolved) != NULL) {
    source = resolved;
  }
  const char *slash = strrchr(source, '/');
  if (slash == NULL) return 0;
  size_t dirLen = (size_t)(slash - source);
  if (dirLen == 0) dirLen = 1;
  if (dirLen >= cap) return 0;
  memcpy(buffer, source, dirLen);
  buffer[dirLen] = '\0';
  return 1;
}

static int chengEnvFlagEnabled(const char *name) {
  if (name == NULL || name[0] == '\0') return 0;
  const char *value = getenv(name);
  if (value == NULL || value[0] == '\0') return 0;
  return value[0] != '0';
}

static int chengResolveIconFontPath(char *buffer, size_t cap) {
  if (buffer == NULL || cap == 0) return 0;
  const char *env = getenv("IDE_ICON_FONT");
  if (chengCopyPathIfReadable(env, buffer, cap)) return 1;
  const char *resourceRoot = getenv("IDE_RESOURCE_ROOT");
  if (chengJoinPathIfReadable(resourceRoot, "fonts/codicon.ttf", buffer, cap)) return 1;
  if (chengJoinPathIfReadable(resourceRoot, "resources/fonts/codicon.ttf", buffer, cap)) return 1;
  const char *rootEnv = getenv("IDE_ROOT");
  if (chengJoinPathIfReadable(rootEnv, "resources/fonts/codicon.ttf", buffer, cap)) return 1;
  if (chengJoinPathIfReadable(rootEnv, "ide/resources/fonts/codicon.ttf", buffer, cap)) return 1;
  const char *vscodeRoot = getenv("IDE_VSCODE_ROOT");
  if (chengJoinPathIfReadable(vscodeRoot, "src/vs/base/browser/ui/codicons/codicon/codicon.ttf", buffer, cap)) return 1;
  if (chengJoinPathIfReadable("/Users/lbcheng/vscode", "src/vs/base/browser/ui/codicons/codicon/codicon.ttf", buffer, cap)) return 1;
  char exeDir[PATH_MAX];
  if (chengExecutableDir(exeDir, sizeof(exeDir))) {
    if (chengJoinPathIfReadable(exeDir, "resources/fonts/codicon.ttf", buffer, cap)) return 1;
    if (chengJoinPathIfReadable(exeDir, "../resources/fonts/codicon.ttf", buffer, cap)) return 1;
    if (chengJoinPathIfReadable(exeDir, "../ide/resources/fonts/codicon.ttf", buffer, cap)) return 1;
  }
  char cwd[PATH_MAX];
  if (getcwd(cwd, sizeof(cwd)) == NULL) return 0;
  const char *candidates[] = {
      "resources/fonts/codicon.ttf",
      "ide/resources/fonts/codicon.ttf",
      "resources/codicon.ttf",
      "codicon.ttf",
  };
  const size_t candidateCount = sizeof(candidates) / sizeof(candidates[0]);
  for (size_t i = 0; i < candidateCount; i++) {
    int written = snprintf(buffer, cap, "%s/%s", cwd, candidates[i]);
    if (written > 0 && (size_t)written < cap && access(buffer, R_OK) == 0) {
      return 1;
    }
  }
  return 0;
}

int chengGuiIconFontAvailable(void) {
  CTFontRef font = createChengIconFont(12.0);
  if (font == NULL) return 0;
  int ok = chengFontHasCodepoint(font, 0xEAF0u);
  CFRelease(font);
  return ok;
}

int chengGuiIconGlyphAvailable(const char *text) {
  CTFontRef font = createChengIconFont(12.0);
  if (font == NULL) return 0;
  int ok = chengFontHasUtf8Glyph(font, text);
  CFRelease(font);
  return ok;
}

static int chengResolveFileIconFontPath(char *buffer, size_t cap) {
  if (buffer == NULL || cap == 0) return 0;
  const char *env = getenv("IDE_FILE_ICON_FONT");
  if (chengCopyPathIfReadable(env, buffer, cap)) return 1;
  const char *resourceRoot = getenv("IDE_RESOURCE_ROOT");
  if (chengJoinPathIfReadable(resourceRoot, "fonts/seti.woff", buffer, cap)) return 1;
  if (chengJoinPathIfReadable(resourceRoot, "resources/fonts/seti.woff", buffer, cap)) return 1;
  const char *rootEnv = getenv("IDE_ROOT");
  if (chengJoinPathIfReadable(rootEnv, "resources/fonts/seti.woff", buffer, cap)) return 1;
  if (chengJoinPathIfReadable(rootEnv, "ide/resources/fonts/seti.woff", buffer, cap)) return 1;
  const char *vscodeRoot = getenv("IDE_VSCODE_ROOT");
  if (chengJoinPathIfReadable(vscodeRoot, "extensions/theme-seti/icons/seti.woff", buffer, cap)) return 1;
  if (chengJoinPathIfReadable("/Users/lbcheng/vscode", "extensions/theme-seti/icons/seti.woff", buffer, cap)) return 1;
  char exeDir[PATH_MAX];
  if (chengExecutableDir(exeDir, sizeof(exeDir))) {
    if (chengJoinPathIfReadable(exeDir, "resources/fonts/seti.woff", buffer, cap)) return 1;
    if (chengJoinPathIfReadable(exeDir, "../resources/fonts/seti.woff", buffer, cap)) return 1;
    if (chengJoinPathIfReadable(exeDir, "../ide/resources/fonts/seti.woff", buffer, cap)) return 1;
  }
  char cwd[PATH_MAX];
  if (getcwd(cwd, sizeof(cwd)) == NULL) return 0;
  const char *candidates[] = {
      "resources/fonts/seti.woff",
      "ide/resources/fonts/seti.woff",
      "resources/seti.woff",
      "seti.woff",
  };
  const size_t candidateCount = sizeof(candidates) / sizeof(candidates[0]);
  for (size_t i = 0; i < candidateCount; i++) {
    int written = snprintf(buffer, cap, "%s/%s", cwd, candidates[i]);
    if (written > 0 && (size_t)written < cap && access(buffer, R_OK) == 0) {
      return 1;
    }
  }
  return 0;
}

int chengGuiFileIconFontAvailable(void) {
  CTFontRef font = createChengFileIconFont(12.0);
  if (font == NULL) return 0;
  int ok = chengFontHasCodepoint(font, 0xE023u);
  CFRelease(font);
  return ok;
}

int chengGuiFileIconGlyphAvailable(const char *text) {
  CTFontRef font = createChengFileIconFont(12.0);
  if (font == NULL) return 0;
  int ok = chengFontHasUtf8Glyph(font, text);
  CFRelease(font);
  return ok;
}

static CTFontRef createFontFromPath(const char *path, double fontSize) {
  if (path == NULL || path[0] == '\0') return NULL;
  CFStringRef cfPath = CFStringCreateWithCString(kCFAllocatorDefault, path, kCFStringEncodingUTF8);
  if (cfPath == NULL) return NULL;
  CFURLRef url = CFURLCreateWithFileSystemPath(kCFAllocatorDefault, cfPath, kCFURLPOSIXPathStyle, false);
  CFRelease(cfPath);
  if (url == NULL) return NULL;
  CGDataProviderRef provider = CGDataProviderCreateWithURL(url);
  CFRelease(url);
  if (provider == NULL) return NULL;
  CGFontRef cgFont = CGFontCreateWithDataProvider(provider);
  CFRelease(provider);
  if (cgFont == NULL) return NULL;
  if (fontSize <= 1.0) fontSize = 12.0;
  CTFontRef font = CTFontCreateWithGraphicsFont(cgFont, (CGFloat)fontSize, NULL, NULL);
  CGFontRelease(cgFont);
  return font;
}

static CTFontDescriptorRef createIconFontDescriptor(double fontSize) {
  char path[PATH_MAX];
  if (!chengResolveIconFontPath(path, sizeof(path))) return NULL;

  CFStringRef cfPath = CFStringCreateWithCString(kCFAllocatorDefault, path, kCFStringEncodingUTF8);
  if (cfPath == NULL) return NULL;
  CFURLRef url = CFURLCreateWithFileSystemPath(kCFAllocatorDefault, cfPath, kCFURLPOSIXPathStyle, false);
  CFRelease(cfPath);
  if (url == NULL) return NULL;

  if (!chengIconFontRegistered) {
    CTFontManagerRegisterFontsForURL(url, kCTFontManagerScopeProcess, NULL);
    chengIconFontRegistered = 1;
  }

  CTFontDescriptorRef desc = NULL;
  CFArrayRef descriptors = CTFontManagerCreateFontDescriptorsFromURL(url);
  if (descriptors != NULL && CFArrayGetCount(descriptors) > 0) {
    CTFontDescriptorRef base = (CTFontDescriptorRef)CFArrayGetValueAtIndex(descriptors, 0);
    CFRetain(base);
    CFNumberRef sizeNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &fontSize);
    if (sizeNum != NULL) {
      const void *keys[] = {kCTFontSizeAttribute};
      const void *values[] = {sizeNum};
      CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                                 keys,
                                                 values,
                                                 1,
                                                 &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);
      if (attrs != NULL) {
        desc = CTFontDescriptorCreateCopyWithAttributes(base, attrs);
        CFRelease(attrs);
      }
      CFRelease(sizeNum);
    }
    CFRelease(base);
    CFRelease(descriptors);
  }
  if (desc == NULL) {
    CFNumberRef sizeNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &fontSize);
    const void *keys[] = {kCTFontURLAttribute, kCTFontSizeAttribute};
    const void *values[] = {url, sizeNum};
    CFDictionaryRef attrs = NULL;
    if (sizeNum != NULL) {
      attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                 keys,
                                 values,
                                 2,
                                 &kCFTypeDictionaryKeyCallBacks,
                                 &kCFTypeDictionaryValueCallBacks);
    }
    if (attrs != NULL) {
      desc = CTFontDescriptorCreateWithAttributes(attrs);
      CFRelease(attrs);
    }
    if (sizeNum != NULL) {
      CFRelease(sizeNum);
    }
  }
  if (desc == NULL) {
    CTFontRef font = createFontFromPath(path, fontSize);
    if (font != NULL) {
      desc = CTFontCopyFontDescriptor(font);
      CFRelease(font);
    }
  }
  CFRelease(url);
  return desc;
}

static CTFontDescriptorRef createFileIconFontDescriptor(double fontSize) {
  char path[PATH_MAX];
  if (!chengResolveFileIconFontPath(path, sizeof(path))) return NULL;

  CFStringRef cfPath = CFStringCreateWithCString(kCFAllocatorDefault, path, kCFStringEncodingUTF8);
  if (cfPath == NULL) return NULL;
  CFURLRef url = CFURLCreateWithFileSystemPath(kCFAllocatorDefault, cfPath, kCFURLPOSIXPathStyle, false);
  CFRelease(cfPath);
  if (url == NULL) return NULL;

  if (!chengFileIconFontRegistered) {
    CTFontManagerRegisterFontsForURL(url, kCTFontManagerScopeProcess, NULL);
    chengFileIconFontRegistered = 1;
  }

  CTFontDescriptorRef desc = NULL;
  CFArrayRef descriptors = CTFontManagerCreateFontDescriptorsFromURL(url);
  if (descriptors != NULL && CFArrayGetCount(descriptors) > 0) {
    CTFontDescriptorRef base = (CTFontDescriptorRef)CFArrayGetValueAtIndex(descriptors, 0);
    CFRetain(base);
    CFNumberRef sizeNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &fontSize);
    if (sizeNum != NULL) {
      const void *keys[] = {kCTFontSizeAttribute};
      const void *values[] = {sizeNum};
      CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                                 keys,
                                                 values,
                                                 1,
                                                 &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);
      if (attrs != NULL) {
        desc = CTFontDescriptorCreateCopyWithAttributes(base, attrs);
        CFRelease(attrs);
      }
      CFRelease(sizeNum);
    }
    CFRelease(base);
    CFRelease(descriptors);
  }
  if (desc == NULL) {
    CFNumberRef sizeNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &fontSize);
    const void *keys[] = {kCTFontURLAttribute, kCTFontSizeAttribute};
    const void *values[] = {url, sizeNum};
    CFDictionaryRef attrs = NULL;
    if (sizeNum != NULL) {
      attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                 keys,
                                 values,
                                 2,
                                 &kCFTypeDictionaryKeyCallBacks,
                                 &kCFTypeDictionaryValueCallBacks);
    }
    if (attrs != NULL) {
      desc = CTFontDescriptorCreateWithAttributes(attrs);
      CFRelease(attrs);
    }
    if (sizeNum != NULL) {
      CFRelease(sizeNum);
    }
  }
  if (desc == NULL) {
    CTFontRef font = createFontFromPath(path, fontSize);
    if (font != NULL) {
      desc = CTFontCopyFontDescriptor(font);
      CFRelease(font);
    }
  }
  CFRelease(url);
  return desc;
}

static CFArrayRef createChengCascadeList(double fontSize) {
  CFStringRef fallbackNames[] = {
      CFSTR("PingFang SC"),
      CFSTR("Hiragino Sans GB"),
      CFSTR("Heiti SC"),
      CFSTR("Arial Unicode MS"),
  };
  const CFIndex fallbackCap = (CFIndex)(sizeof(fallbackNames) / sizeof(fallbackNames[0]));
  CTFontDescriptorRef descs[8];
  CFIndex descCount = 0;
  for (CFIndex i = 0; i < fallbackCap; i++) {
    CTFontDescriptorRef desc = CTFontDescriptorCreateWithNameAndSize(fallbackNames[i], (CGFloat)fontSize);
    if (desc != NULL) {
      descs[descCount++] = desc;
    }
  }
  CTFontDescriptorRef iconDesc = createIconFontDescriptor(fontSize);
  if (iconDesc != NULL) {
    descs[descCount++] = iconDesc;
  }
  CTFontDescriptorRef fileIconDesc = createFileIconFontDescriptor(fontSize);
  if (fileIconDesc != NULL) {
    descs[descCount++] = fileIconDesc;
  }
  CFArrayRef cascadeList = NULL;
  if (descCount > 0) {
    cascadeList = CFArrayCreate(kCFAllocatorDefault, (const void **)descs, descCount, &kCFTypeArrayCallBacks);
  }
  for (CFIndex i = 0; i < descCount; i++) {
    CFRelease(descs[i]);
  }
  return cascadeList;
}

static CTFontRef createChengIconFont(double fontSize) {
  const uint32_t probe = 0xEAF0u;
  char path[PATH_MAX];
  path[0] = '\0';
  chengResolveIconFontPath(path, sizeof(path));
  CTFontRef font = NULL;
  CTFontDescriptorRef desc = createIconFontDescriptor(fontSize);
  if (desc != NULL) {
    font = CTFontCreateWithFontDescriptor(desc, (CGFloat)fontSize, NULL);
    CFRelease(desc);
    if (font != NULL && !chengFontHasCodepoint(font, probe)) {
      CFRelease(font);
      font = NULL;
    }
  }
  if (font == NULL && path[0] != '\0') {
    font = createFontFromPath(path, fontSize);
    if (font != NULL && !chengFontHasCodepoint(font, probe)) {
      CFRelease(font);
      font = NULL;
    }
  }
  if (font == NULL) {
    font = CTFontCreateWithName(CFSTR("codicon"), (CGFloat)fontSize, NULL);
    if (font != NULL && !chengFontHasCodepoint(font, probe)) {
      CFRelease(font);
      font = NULL;
    }
  }
  chengDebugIconFontOnce("icon", path, font, probe, &chengIconFontDebugged);
  return font;
}

static CTFontRef createChengFileIconFont(double fontSize) {
  const uint32_t probe = 0xE023u;
  char path[PATH_MAX];
  path[0] = '\0';
  chengResolveFileIconFontPath(path, sizeof(path));
  CTFontRef font = NULL;
  CTFontDescriptorRef desc = createFileIconFontDescriptor(fontSize);
  if (desc != NULL) {
    font = CTFontCreateWithFontDescriptor(desc, (CGFloat)fontSize, NULL);
    CFRelease(desc);
    if (font != NULL && !chengFontHasCodepoint(font, probe)) {
      CFRelease(font);
      font = NULL;
    }
  }
  if (font == NULL && path[0] != '\0') {
    font = createFontFromPath(path, fontSize);
    if (font != NULL && !chengFontHasCodepoint(font, probe)) {
      CFRelease(font);
      font = NULL;
    }
  }
  if (font == NULL) {
    font = CTFontCreateWithName(CFSTR("seti"), (CGFloat)fontSize, NULL);
    if (font != NULL && !chengFontHasCodepoint(font, probe)) {
      CFRelease(font);
      font = NULL;
    }
  }
  chengDebugIconFontOnce("fileicon", path, font, probe, &chengFileIconFontDebugged);
  return font;
}

static int chengFontHasCodepoint(CTFontRef font, uint32_t codepoint) {
  if (font == NULL) return 0;
  UniChar chars[2] = {0, 0};
  CGGlyph glyphs[2] = {0, 0};
  CFIndex length = 1;
  if (codepoint <= 0xFFFFu) {
    chars[0] = (UniChar)codepoint;
  } else {
    uint32_t v = codepoint - 0x10000u;
    chars[0] = (UniChar)(0xD800u + ((v >> 10) & 0x3FFu));
    chars[1] = (UniChar)(0xDC00u + (v & 0x3FFu));
    length = 2;
  }
  if (!CTFontGetGlyphsForCharacters(font, chars, glyphs, length)) return 0;
  for (CFIndex i = 0; i < length; i++) {
    if (glyphs[i] == 0) return 0;
  }
  return 1;
}

static int chengFontHasUtf8Glyph(CTFontRef font, const char *text) {
  if (font == NULL || text == NULL || text[0] == '\0') return 0;
  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0;
  int ok = chengFontHasGlyph(font, cfText);
  CFRelease(cfText);
  return ok;
}

static int chengFontHasGlyph(CTFontRef font, CFStringRef text) {
  if (font == NULL || text == NULL) return 0;
  CFIndex length = CFStringGetLength(text);
  if (length <= 0 || length > 2) return 0;
  UniChar chars[2] = {0, 0};
  CGGlyph glyphs[2] = {0, 0};
  CFStringGetCharacters(text, CFRangeMake(0, length), chars);
  if (!CTFontGetGlyphsForCharacters(font, chars, glyphs, length)) {
    return 0;
  }
  for (CFIndex i = 0; i < length; i++) {
    if (glyphs[i] == 0) return 0;
  }
  return 1;
}

static void chengDebugIconFontOnce(const char *kind,
                                   const char *path,
                                   CTFontRef font,
                                   uint32_t codepoint,
                                   int *printedFlag) {
  if (!chengEnvFlagEnabled("IDE_DEBUG_ICONS")) return;
  if (printedFlag == NULL || *printedFlag) return;
  *printedFlag = 1;
  char nameBuf[256] = {0};
  if (font != NULL) {
    CFStringRef name = CTFontCopyPostScriptName(font);
    if (name != NULL) {
      CFStringGetCString(name, nameBuf, sizeof(nameBuf), kCFStringEncodingUTF8);
      CFRelease(name);
    }
  }
  int glyphOk = (font != NULL) ? chengFontHasCodepoint(font, codepoint) : 0;
  fprintf(stderr,
          "[ide][%s] path=%s name=%s glyph=0x%X ok=%d\n",
          kind ? kind : "font",
          (path != NULL && path[0] != '\0') ? path : "-",
          nameBuf[0] != '\0' ? nameBuf : "-",
          (unsigned int)codepoint,
          glyphOk);
}

static CTFontRef createChengFont(double fontSize) {
  CFStringRef baseName = CFSTR("Menlo");
  CTFontDescriptorRef baseDesc = CTFontDescriptorCreateWithNameAndSize(baseName, (CGFloat)fontSize);
  if (baseDesc == NULL) {
    return CTFontCreateWithName(baseName, (CGFloat)fontSize, NULL);
  }

  CFArrayRef cascadeList = createChengCascadeList(fontSize);
  CTFontRef font = NULL;
  if (cascadeList != NULL) {
    const void *keys[] = {kCTFontCascadeListAttribute};
    const void *values[] = {cascadeList};
    CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                               keys,
                                               values,
                                               1,
                                               &kCFTypeDictionaryKeyCallBacks,
                                               &kCFTypeDictionaryValueCallBacks);
    if (attrs != NULL) {
      CTFontDescriptorRef desc = CTFontDescriptorCreateCopyWithAttributes(baseDesc, attrs);
      if (desc != NULL) {
        font = CTFontCreateWithFontDescriptor(desc, (CGFloat)fontSize, NULL);
        CFRelease(desc);
      }
      CFRelease(attrs);
    }
    CFRelease(cascadeList);
  }

  CFRelease(baseDesc);
  if (font == NULL) {
    font = CTFontCreateWithName(baseName, (CGFloat)fontSize, NULL);
  }
  return font;
}

static CTFontRef createChengUIFont(double fontSize) {
  CTFontRef baseFont = CTFontCreateUIFontForLanguage(kCTFontUIFontSystem, (CGFloat)fontSize, NULL);
  if (baseFont == NULL) {
    baseFont = CTFontCreateWithName(CFSTR("Helvetica Neue"), (CGFloat)fontSize, NULL);
  }
  CTFontDescriptorRef baseDesc = NULL;
  if (baseFont != NULL) {
    baseDesc = CTFontCopyFontDescriptor(baseFont);
  }
  if (baseDesc == NULL) {
    if (baseFont != NULL) {
      return baseFont;
    }
    return CTFontCreateWithName(CFSTR("Helvetica Neue"), (CGFloat)fontSize, NULL);
  }

  CFArrayRef cascadeList = createChengCascadeList(fontSize);
  CTFontRef font = NULL;
  if (cascadeList != NULL) {
    const void *keys[] = {kCTFontCascadeListAttribute};
    const void *values[] = {cascadeList};
    CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                               keys,
                                               values,
                                               1,
                                               &kCFTypeDictionaryKeyCallBacks,
                                               &kCFTypeDictionaryValueCallBacks);
    if (attrs != NULL) {
      CTFontDescriptorRef desc = CTFontDescriptorCreateCopyWithAttributes(baseDesc, attrs);
      if (desc != NULL) {
        font = CTFontCreateWithFontDescriptor(desc, (CGFloat)fontSize, NULL);
        CFRelease(desc);
      }
      CFRelease(attrs);
    }
    CFRelease(cascadeList);
  }

  CFRelease(baseDesc);
  if (font == NULL && baseFont != NULL) {
    font = baseFont;
    baseFont = NULL;
  }
  if (baseFont != NULL) {
    CFRelease(baseFont);
  }
  return font;
}

static int utf8Decode(const unsigned char *s, int len, uint32_t *out) {
  if (len <= 0 || s == NULL || out == NULL) return 0;
  unsigned char c0 = s[0];
  if (c0 < 0x80u) {
    *out = (uint32_t)c0;
    return 1;
  }
  if ((c0 & 0xE0u) == 0xC0u && len >= 2) {
    unsigned char c1 = s[1];
    if ((c1 & 0xC0u) == 0x80u) {
      *out = ((uint32_t)(c0 & 0x1Fu) << 6) | (uint32_t)(c1 & 0x3Fu);
      return 2;
    }
  }
  if ((c0 & 0xF0u) == 0xE0u && len >= 3) {
    unsigned char c1 = s[1];
    unsigned char c2 = s[2];
    if (((c1 & 0xC0u) == 0x80u) && ((c2 & 0xC0u) == 0x80u)) {
      *out = ((uint32_t)(c0 & 0x0Fu) << 12) | ((uint32_t)(c1 & 0x3Fu) << 6) | (uint32_t)(c2 & 0x3Fu);
      return 3;
    }
  }
  if ((c0 & 0xF8u) == 0xF0u && len >= 4) {
    unsigned char c1 = s[1];
    unsigned char c2 = s[2];
    unsigned char c3 = s[3];
    if (((c1 & 0xC0u) == 0x80u) && ((c2 & 0xC0u) == 0x80u) && ((c3 & 0xC0u) == 0x80u)) {
      *out = ((uint32_t)(c0 & 0x07u) << 18) | ((uint32_t)(c1 & 0x3Fu) << 12) |
             ((uint32_t)(c2 & 0x3Fu) << 6) | (uint32_t)(c3 & 0x3Fu);
      return 4;
    }
  }
  *out = (uint32_t)c0;
  return 1;
}

static int utf16UnitsForCodepoint(uint32_t cp) {
  return cp > 0xFFFFu ? 2 : 1;
}

static int32_t utf8ToUtf16Index(const char *text, int32_t byteIndex) {
  if (text == NULL || byteIndex <= 0) return 0;
  int32_t len = (int32_t)strlen(text);
  if (byteIndex > len) byteIndex = len;
  int32_t utf16 = 0;
  int32_t i = 0;
  while (i < len) {
    if (i >= byteIndex) break;
    uint32_t cp = 0;
    int step = utf8Decode((const unsigned char *)text + i, len - i, &cp);
    if (step <= 0) break;
    if (i + step > byteIndex) break;
    utf16 += (int32_t)utf16UnitsForCodepoint(cp);
    i += step;
  }
  return utf16;
}

static int32_t utf16ToUtf8Index(const char *text, int32_t utf16Index) {
  if (text == NULL || utf16Index <= 0) return 0;
  int32_t len = (int32_t)strlen(text);
  int32_t utf16 = 0;
  int32_t i = 0;
  while (i < len) {
    uint32_t cp = 0;
    int step = utf8Decode((const unsigned char *)text + i, len - i, &cp);
    if (step <= 0) break;
    int units = utf16UnitsForCodepoint(cp);
    if (utf16 + units > utf16Index) {
      return i;
    }
    utf16 += (int32_t)units;
    i += step;
  }
  return len;
}

static int chengGuiDrawTextBgraLenInternal(void *pixels,
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
                                           size_t textLen) {
  if (pixels == NULL || text == NULL) return -1;
  if ((uintptr_t)text < (uintptr_t)4096u) return -12;
  if (textLen > (size_t)(1u << 20)) return -13;
  if (width <= 0 || height <= 0) return -2;
  if (strideBytes <= 0) strideBytes = width * 4;
  if (fontSize <= 1.0) fontSize = 12.0;

  CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  if (cs == NULL) return -3;
  const CGBitmapInfo bitmapInfo =
      (CGBitmapInfo)(kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
  CGContextRef ctx = CGBitmapContextCreate(pixels,
                                           (size_t)width,
                                           (size_t)height,
                                           8,
                                           (size_t)strideBytes,
                                           cs,
                                           bitmapInfo);
  CGColorSpaceRelease(cs);
  if (ctx == NULL) return -4;

  CGContextSetAllowsAntialiasing(ctx, true);
  CGContextSetShouldAntialias(ctx, true);
  CGContextSetAllowsFontSmoothing(ctx, true);
  CGContextSetShouldSmoothFonts(ctx, true);

  // Flip to a top-left origin with y+ down, matching Cheng canvas coordinates.
  CGContextTranslateCTM(ctx, 0.0, (double)height);
  CGContextScaleCTM(ctx, 1.0, -1.0);
  CGContextSetTextMatrix(ctx, CGAffineTransformMake(1.0, 0.0, 0.0, -1.0, 0.0, 0.0));

  CFStringRef cfText = chengCreateUtf8StringLen(text, textLen);
  if (cfText == NULL) {
    CGContextRelease(ctx);
    return -5;
  }

  CTFontRef baseFont = createChengUIFont(fontSize);
  if (baseFont == NULL) {
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -6;
  }
  CTFontRef font = baseFont;

  double r, g, b, a;
  colorToRgba(color, &r, &g, &b, &a);
  CGColorRef cgColor = CGColorCreateGenericRGB((CGFloat)r, (CGFloat)g, (CGFloat)b, (CGFloat)a);
  if (cgColor == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -7;
  }

  const void *keys[] = {kCTFontAttributeName, kCTForegroundColorAttributeName};
  const void *values[] = {font, cgColor};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             2,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CGColorRelease(cgColor);
    CFRelease(font);
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -8;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  if (attrString == NULL) {
    CGColorRelease(cgColor);
    CFRelease(font);
    CGContextRelease(ctx);
    return -9;
  }

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  CGColorRelease(cgColor);
  if (font != NULL) {
    CFRelease(font);
  }
  if (baseFont != NULL && baseFont != font) {
    CFRelease(baseFont);
  }
  if (line == NULL) {
    CGContextRelease(ctx);
    return -10;
  }

  double ascent = 0.0;
  double descent = 0.0;
  double leading = 0.0;
  (void)CTLineGetTypographicBounds(line, &ascent, &descent, &leading);
  double textHeight = ascent + descent;

  CGContextSaveGState(ctx);
  if (w > 0.0 && h > 0.0) {
    CGRect clip = CGRectMake((CGFloat)x, (CGFloat)y, (CGFloat)w, (CGFloat)h);
    CGContextClipToRect(ctx, clip);
  }

  double baselineY = y + ascent;
  if (h > 0.0 && textHeight > 0.0 && h > textHeight) {
    baselineY = y + (h - textHeight) * 0.5 + ascent;
  }
  CGContextSetTextPosition(ctx, (CGFloat)x, (CGFloat)baselineY);
  CTLineDraw(line, ctx);
  CGContextRestoreGState(ctx);

  CFRelease(line);
  CGContextRelease(ctx);
  return 0;
}

int chengGuiDrawTextBgra(void *pixels,
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
  if (text == NULL) return -1;
  size_t textLen = chengSafeTextLen(text);
  if (textLen == 0 && text[0] != '\0') {
    return -11;
  }
  return chengGuiDrawTextBgraLenInternal(
      pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text, textLen);
}

int chengGuiDrawTextBgraLen(void *pixels,
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
                            int textLen) {
  if (text == NULL) return -1;
  if (textLen < 0) return -11;
  return chengGuiDrawTextBgraLenInternal(
      pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text, (size_t)textLen);
}

int chengGuiDrawTextBgraLenI(void *pixels,
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
                             int textLen) {
  if (text == NULL) return -1;
  if (textLen < 0) return -11;
  double fontSize = (double)fontSizeX100 / 100.0;
  if (fontSize <= 1.0) {
    fontSize = 14.0;
  }
  return chengGuiDrawTextBgraLenInternal(
      pixels,
      width,
      height,
      strideBytes,
      (double)x,
      (double)y,
      (double)w,
      (double)h,
      color,
      fontSize,
      text,
      (size_t)textLen);
}

int chengGuiMacDrawTextBgraLenI(void *pixels,
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
                                int textLen) {
  return chengGuiDrawTextBgraLenI(
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
      textLen);
}

double chengGuiTextWidth(const char *text, double fontSize) {
  if (text == NULL) return 0.0;
  if (fontSize <= 1.0) fontSize = 12.0;
  if (text[0] == '\0') return 0.0;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0.0;
  CTFontRef font = createChengUIFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0.0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0.0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0.0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0.0;

  double width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  CFRelease(line);
  if (width < 0.0) width = 0.0;
  return width;
}

double chengGuiTextWidthIcon(const char *text, double fontSize) {
  if (text == NULL) return 0.0;
  if (fontSize <= 1.0) fontSize = 12.0;
  if (text[0] == '\0') return 0.0;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0.0;
  CTFontRef font = createChengIconFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0.0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0.0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0.0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0.0;

  double width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  CFRelease(line);
  if (width < 0.0) width = 0.0;
  return width;
}

double chengGuiTextWidthFileIcon(const char *text, double fontSize) {
  if (text == NULL) return 0.0;
  if (fontSize <= 1.0) fontSize = 12.0;
  if (text[0] == '\0') return 0.0;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0.0;
  CTFontRef font = createChengFileIconFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0.0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0.0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0.0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0.0;

  double width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  CFRelease(line);
  if (width < 0.0) width = 0.0;
  return width;
}

double chengGuiTextXAtIndex(const char *text, double fontSize, int32_t byteIndex) {
  if (text == NULL) return 0.0;
  if (fontSize <= 1.0) fontSize = 12.0;
  int32_t byteLen = (int32_t)strlen(text);
  if (byteLen <= 0) return 0.0;
  if (byteIndex < 0) byteIndex = 0;
  if (byteIndex > byteLen) byteIndex = byteLen;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0.0;
  CFIndex textLen = CFStringGetLength(cfText);
  CTFontRef font = createChengUIFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0.0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0.0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0.0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0.0;

  CFIndex utf16Index = (CFIndex)utf8ToUtf16Index(text, byteIndex);
  if (utf16Index < 0) utf16Index = 0;
  if (utf16Index > textLen) utf16Index = textLen;
  double x = CTLineGetOffsetForStringIndex(line, utf16Index, NULL);
  CFRelease(line);
  if (x < 0.0) x = 0.0;
  return x;
}

int32_t chengGuiTextIndexAtX(const char *text, double fontSize, double x) {
  if (text == NULL) return 0;
  if (fontSize <= 1.0) fontSize = 12.0;
  int32_t byteLen = (int32_t)strlen(text);
  if (byteLen <= 0) return 0;
  if (x <= 0.0) return 0;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0;
  CFIndex textLen = CFStringGetLength(cfText);
  CTFontRef font = createChengUIFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0;

  double width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  if (x >= width) {
    CFRelease(line);
    return byteLen;
  }
  CFIndex idx = CTLineGetStringIndexForPosition(line, CGPointMake((CGFloat)x, 0.0));
  CFRelease(line);
  if (idx == kCFNotFound) {
    return byteLen;
  }
  if (idx < 0) idx = 0;
  if (idx > textLen) idx = textLen;
  return utf16ToUtf8Index(text, (int32_t)idx);
}

int chengGuiMacDrawTextBgra(void *pixels,
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
  return chengGuiDrawTextBgra(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text);
}

int chengGuiMacDrawTextBgraLen(void *pixels,
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
                               int textLen) {
  return chengGuiDrawTextBgraLen(pixels, width, height, strideBytes, x, y, w, h, color, fontSize, text, textLen);
}

int chengGuiMacDrawTextBgraCode(void *pixels,
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
  if (pixels == NULL || text == NULL) return -1;
  if (width <= 0 || height <= 0) return -2;
  if (strideBytes <= 0) strideBytes = width * 4;
  if (fontSize <= 1.0) fontSize = 12.0;

  CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  if (cs == NULL) return -3;
  const CGBitmapInfo bitmapInfo =
      (CGBitmapInfo)(kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
  CGContextRef ctx = CGBitmapContextCreate(pixels,
                                           (size_t)width,
                                           (size_t)height,
                                           8,
                                           (size_t)strideBytes,
                                           cs,
                                           bitmapInfo);
  CGColorSpaceRelease(cs);
  if (ctx == NULL) return -4;

  CGContextSetAllowsAntialiasing(ctx, true);
  CGContextSetShouldAntialias(ctx, true);
  CGContextSetAllowsFontSmoothing(ctx, true);
  CGContextSetShouldSmoothFonts(ctx, true);

  CGContextTranslateCTM(ctx, 0.0, (double)height);
  CGContextScaleCTM(ctx, 1.0, -1.0);
  CGContextSetTextMatrix(ctx, CGAffineTransformMake(1.0, 0.0, 0.0, -1.0, 0.0, 0.0));

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) {
    CGContextRelease(ctx);
    return -5;
  }

  CTFontRef baseFont = createChengFont(fontSize);
  if (baseFont == NULL) {
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -6;
  }
  CTFontRef font = baseFont;

  double r, g, b, a;
  colorToRgba(color, &r, &g, &b, &a);
  CGColorRef cgColor = CGColorCreateGenericRGB((CGFloat)r, (CGFloat)g, (CGFloat)b, (CGFloat)a);
  if (cgColor == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -7;
  }

  const void *keys[] = {kCTFontAttributeName, kCTForegroundColorAttributeName};
  const void *values[] = {font, cgColor};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             2,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CGColorRelease(cgColor);
    CFRelease(font);
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -8;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  if (attrString == NULL) {
    CGColorRelease(cgColor);
    CFRelease(font);
    CGContextRelease(ctx);
    return -9;
  }

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  CGColorRelease(cgColor);
  if (font != NULL) {
    CFRelease(font);
  }
  if (baseFont != NULL && baseFont != font) {
    CFRelease(baseFont);
  }
  if (line == NULL) {
    CGContextRelease(ctx);
    return -10;
  }

  double ascent = 0.0;
  double descent = 0.0;
  double leading = 0.0;
  (void)CTLineGetTypographicBounds(line, &ascent, &descent, &leading);
  double textHeight = ascent + descent;

  CGContextSaveGState(ctx);
  if (w > 0.0 && h > 0.0) {
    CGRect clip = CGRectMake((CGFloat)x, (CGFloat)y, (CGFloat)w, (CGFloat)h);
    CGContextClipToRect(ctx, clip);
  }

  double baselineY = y + ascent;
  if (h > 0.0 && textHeight > 0.0 && h > textHeight) {
    baselineY = y + (h - textHeight) * 0.5 + ascent;
  }
  CGContextSetTextPosition(ctx, (CGFloat)x, (CGFloat)baselineY);
  CTLineDraw(line, ctx);
  CGContextRestoreGState(ctx);

  CFRelease(line);
  CGContextRelease(ctx);
  return 0;
}

int chengGuiMacDrawTextBgraIcon(void *pixels,
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
  if (pixels == NULL || text == NULL) return -1;
  if (width <= 0 || height <= 0) return -2;
  if (strideBytes <= 0) strideBytes = width * 4;
  if (fontSize <= 1.0) fontSize = 12.0;

  CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  if (cs == NULL) return -3;
  const CGBitmapInfo bitmapInfo =
      (CGBitmapInfo)(kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
  CGContextRef ctx = CGBitmapContextCreate(pixels,
                                           (size_t)width,
                                           (size_t)height,
                                           8,
                                           (size_t)strideBytes,
                                           cs,
                                           bitmapInfo);
  CGColorSpaceRelease(cs);
  if (ctx == NULL) return -4;

  CGContextSetAllowsAntialiasing(ctx, true);
  CGContextSetShouldAntialias(ctx, true);
  CGContextSetAllowsFontSmoothing(ctx, true);
  CGContextSetShouldSmoothFonts(ctx, true);

  CGContextTranslateCTM(ctx, 0.0, (double)height);
  CGContextScaleCTM(ctx, 1.0, -1.0);
  CGContextSetTextMatrix(ctx, CGAffineTransformMake(1.0, 0.0, 0.0, -1.0, 0.0, 0.0));

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) {
    CGContextRelease(ctx);
    return -5;
  }

  CTFontRef font = createChengIconFont(fontSize);
  
  if (font == NULL) {
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -6;
  }
  
  if (!chengFontHasUtf8Glyph(font, text)) {
      CFRelease(font);
      CFRelease(cfText);
      CGContextRelease(ctx);
      return -11;
  }

  const void *keys[] = {kCTFontAttributeName, kCTForegroundColorAttributeName};
  double r = 0.0, g = 0.0, b = 0.0, a = 1.0;
  colorToRgba(color, &r, &g, &b, &a);
  CGColorRef cgColor = CGColorCreateGenericRGB(r, g, b, a);
  const void *values[] = {font, cgColor};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             2,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  CGColorRelease(cgColor);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -7;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) {
    CGContextRelease(ctx);
    return -8;
  }

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) {
    CGContextRelease(ctx);
    return -9;
  }

  double ascent = 0.0;
  double descent = 0.0;
  double leading = 0.0;
  (void)CTLineGetTypographicBounds(line, &ascent, &descent, &leading);
  double textHeight = ascent + descent;

  CGContextSaveGState(ctx);
  if (w > 0.0 && h > 0.0) {
    CGRect clip = CGRectMake((CGFloat)x, (CGFloat)y, (CGFloat)w, (CGFloat)h);
    CGContextClipToRect(ctx, clip);
  }

  double baselineY = y + ascent;
  if (h > 0.0 && textHeight > 0.0 && h > textHeight) {
    baselineY = y + (h - textHeight) * 0.5 + ascent;
  }
  CGContextSetTextPosition(ctx, (CGFloat)x, (CGFloat)baselineY);
  CTLineDraw(line, ctx);
  CGContextRestoreGState(ctx);

  CFRelease(line);
  CGContextRelease(ctx);
  return 0;
}

int chengGuiMacDrawTextBgraFileIcon(void *pixels,
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
  if (pixels == NULL || text == NULL) return -1;
  if (width <= 0 || height <= 0) return -2;
  if (strideBytes <= 0) strideBytes = width * 4;
  if (fontSize <= 1.0) fontSize = 12.0;

  CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  if (cs == NULL) return -3;
  const CGBitmapInfo bitmapInfo =
      (CGBitmapInfo)(kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
  CGContextRef ctx = CGBitmapContextCreate(pixels,
                                           (size_t)width,
                                           (size_t)height,
                                           8,
                                           (size_t)strideBytes,
                                           cs,
                                           bitmapInfo);
  CGColorSpaceRelease(cs);
  if (ctx == NULL) return -4;

  CGContextSetAllowsAntialiasing(ctx, true);
  CGContextSetShouldAntialias(ctx, true);
  CGContextSetAllowsFontSmoothing(ctx, true);
  CGContextSetShouldSmoothFonts(ctx, true);

  CGContextTranslateCTM(ctx, 0.0, (double)height);
  CGContextScaleCTM(ctx, 1.0, -1.0);
  CGContextSetTextMatrix(ctx, CGAffineTransformMake(1.0, 0.0, 0.0, -1.0, 0.0, 0.0));

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) {
    CGContextRelease(ctx);
    return -5;
  }

  CTFontRef font = createChengFileIconFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -6;
  }
  
  if (!chengFontHasUtf8Glyph(font, text)) {
      CFRelease(font);
      CFRelease(cfText);
      CGContextRelease(ctx);
      return -11; 
  }

  const void *keys[] = {kCTFontAttributeName, kCTForegroundColorAttributeName};
  double r = 0.0, g = 0.0, b = 0.0, a = 1.0;
  colorToRgba(color, &r, &g, &b, &a);
  CGColorRef cgColor = CGColorCreateGenericRGB(r, g, b, a);
  const void *values[] = {font, cgColor};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             2,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  CGColorRelease(cgColor);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    CGContextRelease(ctx);
    return -7;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) {
    CGContextRelease(ctx);
    return -8;
  }

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) {
    CGContextRelease(ctx);
    return -9;
  }

  double ascent = 0.0;
  double descent = 0.0;
  double leading = 0.0;
  (void)CTLineGetTypographicBounds(line, &ascent, &descent, &leading);
  double textHeight = ascent + descent;

  CGContextSaveGState(ctx);
  if (w > 0.0 && h > 0.0) {
    CGRect clip = CGRectMake((CGFloat)x, (CGFloat)y, (CGFloat)w, (CGFloat)h);
    CGContextClipToRect(ctx, clip);
  }

  double baselineY = y + ascent;
  if (h > 0.0 && textHeight > 0.0 && h > textHeight) {
    baselineY = y + (h - textHeight) * 0.5 + ascent;
  }
  CGContextSetTextPosition(ctx, (CGFloat)x, (CGFloat)baselineY);
  CTLineDraw(line, ctx);
  CGContextRestoreGState(ctx);

  CFRelease(line);
  CGContextRelease(ctx);
  return 0;
}

double chengGuiTextWidthCode(const char *text, double fontSize) {
  if (text == NULL) return 0.0;
  if (fontSize <= 1.0) fontSize = 12.0;
  if (text[0] == '\0') return 0.0;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0.0;
  CTFontRef font = createChengFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0.0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0.0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0.0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0.0;

  double width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  CFRelease(line);
  if (width < 0.0) width = 0.0;
  return width;
}

double chengGuiTextXAtIndexCode(const char *text, double fontSize, int32_t byteIndex) {
  if (text == NULL) return 0.0;
  if (fontSize <= 1.0) fontSize = 12.0;
  int32_t byteLen = (int32_t)strlen(text);
  if (byteLen <= 0) return 0.0;
  if (byteIndex < 0) byteIndex = 0;
  if (byteIndex > byteLen) byteIndex = byteLen;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0.0;
  CFIndex textLen = CFStringGetLength(cfText);
  CTFontRef font = createChengFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0.0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0.0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0.0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0.0;

  CFIndex utf16Index = (CFIndex)utf8ToUtf16Index(text, byteIndex);
  if (utf16Index < 0) utf16Index = 0;
  if (utf16Index > textLen) utf16Index = textLen;
  double x = CTLineGetOffsetForStringIndex(line, utf16Index, NULL);
  CFRelease(line);
  if (x < 0.0) x = 0.0;
  return x;
}

int32_t chengGuiTextIndexAtXCode(const char *text, double fontSize, double x) {
  if (text == NULL) return 0;
  if (fontSize <= 1.0) fontSize = 12.0;
  int32_t byteLen = (int32_t)strlen(text);
  if (byteLen <= 0) return 0;
  if (x <= 0.0) return 0;

  CFStringRef cfText = CFStringCreateWithCString(kCFAllocatorDefault, text, kCFStringEncodingUTF8);
  if (cfText == NULL) return 0;
  CFIndex textLen = CFStringGetLength(cfText);
  CTFontRef font = createChengFont(fontSize);
  if (font == NULL) {
    CFRelease(cfText);
    return 0;
  }

  const void *keys[] = {kCTFontAttributeName};
  const void *values[] = {font};
  CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault,
                                             keys,
                                             values,
                                             1,
                                             &kCFTypeDictionaryKeyCallBacks,
                                             &kCFTypeDictionaryValueCallBacks);
  if (attrs == NULL) {
    CFRelease(font);
    CFRelease(cfText);
    return 0;
  }

  CFAttributedStringRef attrString = CFAttributedStringCreate(kCFAllocatorDefault, cfText, attrs);
  CFRelease(attrs);
  CFRelease(cfText);
  CFRelease(font);
  if (attrString == NULL) return 0;

  CTLineRef line = CTLineCreateWithAttributedString(attrString);
  CFRelease(attrString);
  if (line == NULL) return 0;

  double width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
  if (x >= width) {
    CFRelease(line);
    return byteLen;
  }
  CFIndex idx = CTLineGetStringIndexForPosition(line, CGPointMake((CGFloat)x, 0.0));
  CFRelease(line);
  if (idx == kCFNotFound) {
    return byteLen;
  }
  if (idx < 0) idx = 0;
  if (idx > textLen) idx = textLen;
  return utf16ToUtf8Index(text, (int32_t)idx);
}

int chengGuiNativeTextAvailable(void) {
  return 1;
}

const char *chengGuiNativeTextBackend(void) {
  return "macos-coretext";
}
