#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

#if defined(__GNUC__)
#define WEAK __attribute__((weak))
#else
#define WEAK
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>
#include <stdint.h>
#if defined(__APPLE__)
#include <crt_externs.h>
#endif

typedef struct ChengStrHeaderCompat {
    int32_t len;
    int32_t cap;
    const char* buffer;
} ChengStrHeaderCompat;

typedef struct ChengStrView {
    const char* ptr;
    size_t len;
} ChengStrView;

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

static ChengStrView cheng_view_string(const char* s) {
    ChengStrView v;
    v.ptr = "";
    v.len = 0u;
    const char* raw = cheng_recover_cstr(s);
    if (raw == NULL) {
        return v;
    }
    // Current bridge path uses cstring lowering; treating every incoming `str`
    // as C string avoids probing past short getenv() buffers.
    v.ptr = raw;
    v.len = strlen(raw);
    return v;
}

static char* cheng_copy_cstr(const char* s) {
    ChengStrView v = cheng_view_string(s);
    char* out = (char*)malloc(v.len + 1u);
    if (out == NULL) {
        return NULL;
    }
    if (v.len > 0u && v.ptr != NULL) {
        memcpy(out, v.ptr, v.len);
    }
    out[v.len] = '\0';
    return out;
}

// Compatibility entrypoints expected by generated MVP runtime objects.
WEAK int __cheng_str_eq(const char* lhs, const char* rhs) {
    ChengStrView a = cheng_view_string(lhs);
    ChengStrView b = cheng_view_string(rhs);
    if (a.len != b.len) {
        return 0;
    }
    if (a.len == 0u) {
        return 1;
    }
    return memcmp(a.ptr, b.ptr, a.len) == 0 ? 1 : 0;
}

WEAK const char* __cheng_sym_2b(const char* lhs, const char* rhs) {
    ChengStrView a = cheng_view_string(lhs);
    ChengStrView b = cheng_view_string(rhs);
    size_t total = a.len + b.len + 1u;
    char* out = (char*)malloc(total);
    if (out == NULL) {
        return a.ptr != NULL ? a.ptr : "";
    }
    if (a.len > 0u && a.ptr != NULL) {
        memcpy(out, a.ptr, a.len);
    }
    if (b.len > 0u && b.ptr != NULL) {
        memcpy(out + a.len, b.ptr, b.len);
    }
    out[a.len + b.len] = '\0';
    return out;
}

WEAK int len(const char* value) {
    ChengStrView v = cheng_view_string(value);
    return (int)v.len;
}

WEAK int32_t cheng_strlen(char* s) {
    ChengStrView v = cheng_view_string((const char*)s);
    return (int32_t)v.len;
}

WEAK int32_t cheng_strcmp(const char* a, const char* b) {
    ChengStrView av = cheng_view_string(a);
    ChengStrView bv = cheng_view_string(b);
    size_t min_len = av.len < bv.len ? av.len : bv.len;
    if (min_len > 0u) {
        int c = memcmp(av.ptr, bv.ptr, min_len);
        if (c != 0) {
            return (int32_t)c;
        }
    }
    if (av.len < bv.len) {
        return -1;
    }
    if (av.len > bv.len) {
        return 1;
    }
    return 0;
}

WEAK const char* getEnv(const char* key) {
    char* name = cheng_copy_cstr(key);
    if (name == NULL) {
        return NULL;
    }
    const char* value = getenv(name);
    free(name);
    return value;
}

WEAK const char* libc_getenv(const char* key) {
    return getEnv(key);
}

WEAK int libc_remove(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return -1;
    }
    int rc = remove(p);
    free(p);
    return rc;
}

WEAK int libc_rename(const char* old_path, const char* new_path) {
    char* a = cheng_copy_cstr(old_path);
    char* b = cheng_copy_cstr(new_path);
    if (a == NULL || b == NULL || a[0] == '\0' || b[0] == '\0') {
        free(a);
        free(b);
        return -1;
    }
    int rc = rename(a, b);
    free(a);
    free(b);
    return rc;
}

WEAK int dirExists(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return 0;
    }
    struct stat st;
    int ok = (stat(p, &st) == 0 && S_ISDIR(st.st_mode)) ? 1 : 0;
    free(p);
    return ok;
}

WEAK int fileExists(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return 0;
    }
    struct stat st;
    int ok = (stat(p, &st) == 0) ? 1 : 0;
    free(p);
    return ok;
}

WEAK int createDir(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return 0;
    }
    if (dirExists(path)) {
        free(p);
        return 1;
    }
    int rc = mkdir(p, 0755);
    int ok = (rc == 0 || errno == EEXIST) ? 1 : 0;
    free(p);
    return ok;
}

WEAK int writeFile(const char* path, const char* content) {
    ChengStrView c = cheng_view_string(content);
    char* p = cheng_copy_cstr(path);
    if (p == NULL) {
        return 0;
    }
    FILE* f = fopen(p, "wb");
    free(p);
    if (!f) {
        return 0;
    }
    size_t n = 0u;
    if (c.len > 0u && c.ptr != NULL) {
        n = fwrite(c.ptr, 1, c.len, f);
    }
    int ok = (c.len == 0u) || (n == c.len);
    fflush(f);
    fclose(f);
    return ok;
}

WEAK int32_t cheng_write_bytes(const char* path, const char* data, int32_t len) {
    char* p = cheng_copy_cstr(path);
    ChengStrView d = cheng_view_string(data);
    if (p == NULL || len < 0) {
        free(p);
        return 0;
    }
    FILE* f = fopen(p, "wb");
    free(p);
    if (f == NULL) {
        return 0;
    }
    size_t wrote = 0;
    if (len > 0) {
        if (d.ptr == NULL) {
            fclose(f);
            return 0;
        }
        size_t cap = d.len < (size_t)len ? d.len : (size_t)len;
        wrote = fwrite(d.ptr, 1, cap, f);
        if (cap != (size_t)len) {
            fclose(f);
            return 0;
        }
    }
    int ok = (len == 0) || ((int32_t)wrote == len);
    fclose(f);
    return ok ? 1 : 0;
}

WEAK int32_t cw_utfzh_bridge_enabled(void) {
    return 0;
}

WEAK const char* cw_utfzh_bridge_in(void) {
    return "";
}

WEAK const char* cw_utfzh_bridge_out(void) {
    return "";
}

WEAK const char* cw_utfzh_bridge_from(void) {
    return "";
}

WEAK const char* cw_utfzh_bridge_report(void) {
    return "";
}

WEAK const char* cw_utfzh_bridge_data_root(void) {
    return "";
}

WEAK int32_t cw_utfzh_bridge_len(int32_t slot) {
    (void)slot;
    return 0;
}

WEAK int32_t cw_utfzh_bridge_byte(int32_t slot, int32_t idx) {
    (void)slot;
    (void)idx;
    return -1;
}

WEAK const char* charToStr(char ch) {
    static char ring[16][2];
    static unsigned int idx = 0;
    unsigned int slot = idx & 15u;
    idx = idx + 1u;
    ring[slot][0] = ch;
    ring[slot][1] = '\0';
    return ring[slot];
}

WEAK const char* intToStr(int value) {
    static char ring[16][32];
    static unsigned int idx = 0;
    unsigned int slot = idx & 15u;
    idx = idx + 1u;
    snprintf(ring[slot], sizeof(ring[slot]), "%d", value);
    return ring[slot];
}

WEAK int streq(const char* a, const char* b) {
    ChengStrView av = cheng_view_string(a);
    ChengStrView bv = cheng_view_string(b);
    if (av.len != bv.len) {
        return 0;
    }
    if (av.len == 0u) {
        return 1;
    }
    return memcmp(av.ptr, bv.ptr, av.len) == 0 ? 1 : 0;
}

WEAK int32_t cheng_compat_argc(void) {
#if defined(__APPLE__)
    int* argc_ptr = _NSGetArgc();
    if (argc_ptr == NULL) {
        return 0;
    }
    int argc = *argc_ptr;
    if (argc <= 0 || argc > 4096) {
        return 0;
    }
    return (int32_t)argc;
#else
    return 0;
#endif
}

WEAK void* cheng_compat_argv(void) {
#if defined(__APPLE__)
    char*** argv_ptr = _NSGetArgv();
    if (argv_ptr == NULL || *argv_ptr == NULL) {
        return NULL;
    }
    return (void*)(*argv_ptr);
#else
    return NULL;
#endif
}

WEAK int32_t cheng_cli_arg_count(void) {
#if defined(__APPLE__)
    int* argc_ptr = _NSGetArgc();
    if (argc_ptr == NULL) {
        return 0;
    }
    int argc = *argc_ptr;
    if (argc <= 0 || argc > 4096) {
        return 0;
    }
    return (int32_t)(argc - 1);
#else
    return 0;
#endif
}

WEAK const char* cheng_cli_arg_at(int32_t i) {
#if defined(__APPLE__)
    if (i < 0) {
        return "";
    }
    int* argc_ptr = _NSGetArgc();
    char*** argv_ptr = _NSGetArgv();
    if (argc_ptr == NULL || argv_ptr == NULL || *argv_ptr == NULL) {
        return "";
    }
    int argc = *argc_ptr;
    if (argc <= 0 || argc > 4096 || i >= argc) {
        return "";
    }
    char* s = (*argv_ptr)[i];
    return s != NULL ? s : "";
#else
    (void)i;
    return "";
#endif
}

WEAK void* alloc(size_t size) {
    if (size == 0) {
        size = 1;
    }
    return malloc(size);
}

WEAK void dealloc(void* ptr) {
    if (ptr != NULL) {
        free(ptr);
    }
}

WEAK void* copyMem(void* dst, const void* src, size_t size) {
    if (dst == NULL || src == NULL || size == 0) {
        return dst;
    }
    return memcpy(dst, src, size);
}

WEAK void* setMem(void* dst, int value, size_t size) {
    if (dst == NULL || size == 0) {
        return dst;
    }
    return memset(dst, value, size);
}

WEAK void* zeroMem(void* dst, size_t size) {
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

WEAK void reserve(void* seq, int32_t newCap) {
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

WEAK void setLen(void* seq, int32_t newLen) {
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

WEAK void chengGuiMacInitialize(void) {}
WEAK void chengGuiMacShutdown(void) {}

WEAK void* chengGuiMacCreateDefaultWindow(const char* title) {
    static unsigned char window_token = 2;
    (void)title;
    return &window_token;
}

WEAK void* chengGuiMacCreateWindow(const char* title, double x, double y, double width, double height, bool resizable, bool highDpi) {
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

WEAK void chengGuiMacDestroyWindow(void* handle) {
    (void)handle;
}

WEAK int chengGuiMacPollEvents(void* events, int maxEvents, int timeoutMs) {
    (void)events;
    (void)maxEvents;
    (void)timeoutMs;
    return 0;
}

WEAK void* chengGuiMacCreateSurface(void* window) {
    static unsigned char surface_token = 1;
    (void)window;
    return &surface_token;
}

WEAK void chengGuiMacDestroySurface(void* surface) {
    (void)surface;
}

WEAK int chengGuiMacBeginFrame(void* surface) {
    (void)surface;
    return 0;
}

WEAK int chengGuiMacEndFrame(void* surface) {
    (void)surface;
    return 0;
}

WEAK int chengGuiMacGetSurfaceInfo(void* surface, ChengGuiMacSurfaceInfoCompat* info) {
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

WEAK int chengGuiMacPresentPixels(void* surface, void* pixels, int width, int height, int strideBytes) {
    (void)surface;
    (void)pixels;
    (void)width;
    (void)height;
    (void)strideBytes;
    return 0;
}

WEAK int chengGuiMacPresentPixelsPayload(void* surface, const ChengGuiMacPresentPayloadCompat* payload) {
    if (payload == NULL) {
        return -1;
    }
    return chengGuiMacPresentPixels(surface, (void*)payload->pixels, payload->width, payload->height, payload->strideBytes);
}

WEAK int chengGuiMacSurfaceReadbackRgba(void* surface, const char* outPath) {
    (void)surface;
    (void)outPath;
    return -1;
}

WEAK size_t chengGuiMacEventStructSize(void) {
    return 0;
}

WEAK size_t chengGuiMacSurfaceInfoStructSize(void) {
    return sizeof(ChengGuiMacSurfaceInfoCompat);
}
