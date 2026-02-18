#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

#if defined(__GNUC__)
#define CHENG_WEAK __attribute__((weak))
#else
#define CHENG_WEAK
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>
#include <stdint.h>

static inline const char* cheng_recover_cstr(const char* s) {
    uintptr_t raw = (uintptr_t)s;
    if (raw == 0u) {
        return NULL;
    }
    if ((raw >> 32) == 0u) {
        uintptr_t high = ((uintptr_t)&raw) & 0xffffffff00000000ULL;
        raw = high | raw;
    }
    return (const char*)raw;
}

// Compatibility entrypoints expected by generated MVP runtime objects.
CHENG_WEAK int __cheng_str_eq(const char* lhs, const char* rhs) {
    lhs = cheng_recover_cstr(lhs);
    rhs = cheng_recover_cstr(rhs);
    if (lhs == rhs) {
        return 1;
    }
    if (lhs == NULL || rhs == NULL) {
        return 0;
    }
    return strcmp(lhs, rhs) == 0 ? 1 : 0;
}

CHENG_WEAK const char* __cheng_sym_2b(const char* lhs, const char* rhs) {
    lhs = cheng_recover_cstr(lhs);
    rhs = cheng_recover_cstr(rhs);
    if (lhs == NULL) {
        lhs = "";
    }
    if (rhs == NULL) {
        rhs = "";
    }
    size_t lhs_len = strlen(lhs);
    size_t rhs_len = strlen(rhs);
    size_t total = lhs_len + rhs_len + 1u;
    char* out = (char*)malloc(total);
    if (out == NULL) {
        return lhs;
    }
    if (lhs_len > 0u) {
        memcpy(out, lhs, lhs_len);
    }
    if (rhs_len > 0u) {
        memcpy(out + lhs_len, rhs, rhs_len);
    }
    out[lhs_len + rhs_len] = '\0';
    return out;
}

CHENG_WEAK int len(const char* value) {
    value = cheng_recover_cstr(value);
    if (value == NULL) {
        return 0;
    }
    return (int)strlen(value);
}

CHENG_WEAK int32_t cheng_strlen(char* s) {
    const char* value = cheng_recover_cstr((const char*)s);
    if (value == NULL) {
        return 0;
    }
    return (int32_t)strlen(value);
}

CHENG_WEAK int32_t cheng_strcmp(const char* a, const char* b) {
    a = cheng_recover_cstr(a);
    b = cheng_recover_cstr(b);
    if (a == b) {
        return 0;
    }
    if (a == NULL) {
        return -1;
    }
    if (b == NULL) {
        return 1;
    }
    return (int32_t)strcmp(a, b);
}

CHENG_WEAK const char* getEnv(const char* key) {
    key = cheng_recover_cstr(key);
    if (key == NULL) {
        return NULL;
    }
    return getenv(key);
}

CHENG_WEAK int dirExists(const char* path) {
    path = cheng_recover_cstr(path);
    if (path == NULL || path[0] == '\0') {
        return 0;
    }
    struct stat st;
    if (stat(path, &st) != 0) {
        return 0;
    }
    return S_ISDIR(st.st_mode) ? 1 : 0;
}

CHENG_WEAK int fileExists(const char* path) {
    path = cheng_recover_cstr(path);
    if (path == NULL || path[0] == '\0') {
        return 0;
    }
    struct stat st;
    return (stat(path, &st) == 0) ? 1 : 0;
}

CHENG_WEAK int createDir(const char* path) {
    path = cheng_recover_cstr(path);
    if (path == NULL || path[0] == '\0') {
        return 0;
    }
    if (dirExists(path)) {
        return 1;
    }
    if (mkdir(path, 0755) == 0) {
        return 1;
    }
    if (errno == EEXIST) {
        return 1;
    }
    return 0;
}

CHENG_WEAK int writeFile(const char* path, const char* content) {
    path = cheng_recover_cstr(path);
    content = cheng_recover_cstr(content);
    if (path == NULL || content == NULL) {
        return 0;
    }
    FILE* f = fopen(path, "wb");
    if (!f) {
        return 0;
    }
    const char* p = content;
    size_t len = strlen(content);
    size_t n = fwrite(p, 1, len, f);
    int ok = (n == len);
    if (ok) {
        fputc('\n', f);
        fflush(f);
    }
    fclose(f);
    return ok;
}

CHENG_WEAK const char* charToStr(char ch) {
    static char ring[16][2];
    static unsigned int idx = 0;
    unsigned int slot = idx & 15u;
    idx = idx + 1u;
    ring[slot][0] = ch;
    ring[slot][1] = '\0';
    return ring[slot];
}

CHENG_WEAK const char* intToStr(int value) {
    static char ring[16][32];
    static unsigned int idx = 0;
    unsigned int slot = idx & 15u;
    idx = idx + 1u;
    snprintf(ring[slot], sizeof(ring[slot]), "%d", value);
    return ring[slot];
}

CHENG_WEAK int streq(const char* a, const char* b) {
    a = cheng_recover_cstr(a);
    b = cheng_recover_cstr(b);
    if (a == b) {
        return 1;
    }
    if (a == NULL || b == NULL) {
        return 0;
    }
    while (*a != '\0' && *b != '\0') {
        if (*a != *b) {
            return 0;
        }
        ++a;
        ++b;
    }
    return *a == *b;
}

CHENG_WEAK void* alloc(size_t size) {
    if (size == 0) {
        size = 1;
    }
    return malloc(size);
}

CHENG_WEAK void dealloc(void* ptr) {
    if (ptr != NULL) {
        free(ptr);
    }
}

CHENG_WEAK void* copyMem(void* dst, const void* src, size_t size) {
    if (dst == NULL || src == NULL || size == 0) {
        return dst;
    }
    return memcpy(dst, src, size);
}

CHENG_WEAK void* setMem(void* dst, int value, size_t size) {
    if (dst == NULL || size == 0) {
        return dst;
    }
    return memset(dst, value, size);
}

CHENG_WEAK void* zeroMem(void* dst, size_t size) {
    if (dst == NULL || size == 0) {
        return dst;
    }
    return memset(dst, 0, size);
}

typedef struct {
    int32_t len;
    int32_t cap;
    void* buffer;
} ChengSeqHeaderCompat;

static int32_t chengCompatNextCap(int32_t curCap, int32_t need) {
    if (need <= 0) {
        return need;
    }
    int32_t cap = curCap;
    if (cap < 4) {
        cap = 4;
    }
    while (cap < need) {
        int32_t doubled = cap * 2;
        if (doubled <= 0) {
            return need;
        }
        cap = doubled;
    }
    return cap;
}

CHENG_WEAK void reserve(void* seq, int32_t newCap) {
    if (seq == NULL || newCap < 0) {
        return;
    }
    ChengSeqHeaderCompat* hdr = (ChengSeqHeaderCompat*)seq;
    if (hdr->buffer != NULL && newCap <= hdr->cap) {
        return;
    }
    if (newCap == 0) {
        return;
    }
    int32_t targetCap = chengCompatNextCap(hdr->cap, newCap);
    if (targetCap <= 0) {
        return;
    }
    void* newBuf = realloc(hdr->buffer, (size_t)targetCap);
    if (newBuf == NULL) {
        return;
    }
    hdr->buffer = newBuf;
    hdr->cap = targetCap;
}

CHENG_WEAK void setLen(void* seq, int32_t newLen) {
    if (seq == NULL) {
        return;
    }
    ChengSeqHeaderCompat* hdr = (ChengSeqHeaderCompat*)seq;
    int32_t target = newLen;
    if (target < 0) {
        target = 0;
    }
    if (target > hdr->cap) {
        reserve(hdr, target);
    }
    hdr->len = target;
}

typedef struct {
    double logicalWidth;
    double logicalHeight;
    double pixelWidth;
    double pixelHeight;
    double scale;
    const char* colorSpace;
} ChengGuiMacSurfaceInfoCompat;

typedef struct {
    const unsigned int* pixels;
    int width;
    int height;
    int strideBytes;
} ChengGuiMacPresentPayloadCompat;

CHENG_WEAK void chengGuiMacInitialize(void) {}
CHENG_WEAK void chengGuiMacShutdown(void) {}

CHENG_WEAK void* chengGuiMacCreateDefaultWindow(const char* title) {
    static unsigned char window_token = 2;
    (void)title;
    return &window_token;
}

CHENG_WEAK void* chengGuiMacCreateWindow(const char* title, double x, double y, double width, double height, bool resizable, bool highDpi) {
    static unsigned char window_token = 1;
    (void)title;
    (void)x;
    (void)y;
    (void)width;
    (void)height;
    (void)resizable;
    (void)highDpi;
    return &window_token;
}

CHENG_WEAK void chengGuiMacDestroyWindow(void* handle) {
    (void)handle;
}

CHENG_WEAK int chengGuiMacPollEvents(void* events, int maxEvents, int timeoutMs) {
    (void)events;
    (void)maxEvents;
    (void)timeoutMs;
    return 0;
}

CHENG_WEAK void* chengGuiMacCreateSurface(void* window) {
    static unsigned char surface_token = 1;
    (void)window;
    return &surface_token;
}

CHENG_WEAK void chengGuiMacDestroySurface(void* surface) {
    (void)surface;
}

CHENG_WEAK int chengGuiMacBeginFrame(void* surface) {
    (void)surface;
    return 0;
}

CHENG_WEAK int chengGuiMacEndFrame(void* surface) {
    (void)surface;
    return 0;
}

CHENG_WEAK int chengGuiMacGetSurfaceInfo(void* surface, ChengGuiMacSurfaceInfoCompat* info) {
    (void)surface;
    if (info != NULL) {
        info->logicalWidth = 1280.0;
        info->logicalHeight = 800.0;
        info->pixelWidth = 1280.0;
        info->pixelHeight = 800.0;
        info->scale = 1.0;
        info->colorSpace = "sRGB";
    }
    return 0;
}

CHENG_WEAK int chengGuiMacPresentPixels(void* surface, void* pixels, int width, int height, int strideBytes) {
    (void)surface;
    (void)pixels;
    (void)width;
    (void)height;
    (void)strideBytes;
    return 0;
}

CHENG_WEAK int chengGuiMacPresentPixelsPayload(void* surface, const ChengGuiMacPresentPayloadCompat* payload) {
    if (payload == NULL) {
        return -1;
    }
    return chengGuiMacPresentPixels(surface, (void*)payload->pixels, payload->width, payload->height, payload->strideBytes);
}

CHENG_WEAK int chengGuiMacSurfaceReadbackRgba(void* surface, const char* outPath) {
    (void)surface;
    (void)outPath;
    return -1;
}

CHENG_WEAK size_t chengGuiMacEventStructSize(void) {
    return 0;
}

CHENG_WEAK size_t chengGuiMacSurfaceInfoStructSize(void) {
    return sizeof(ChengGuiMacSurfaceInfoCompat);
}
