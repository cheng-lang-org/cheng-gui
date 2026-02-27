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
#include <sys/types.h>
#include <dirent.h>
#include <unistd.h>
#include <time.h>
#include <dlfcn.h>
#include <stdint.h>
#if defined(__APPLE__)
#include <crt_externs.h>
#endif

typedef struct ChengStrHeaderCompat {
    int32_t len;
    int32_t cap;
    const char* buffer;
} ChengStrHeaderCompat;

typedef struct ChengSeqHeaderCompat {
    int32_t len;
    int32_t cap;
    void* buffer;
} ChengSeqHeaderCompat;


typedef struct ChengStrView {
    const char* ptr;
    size_t len;
} ChengStrView;

static inline const char* cheng_recover_cstr(const char* s) {
    uintptr_t raw = (uintptr_t)s;
    if (raw == 0u) {
        return NULL;
    }
#if UINTPTR_MAX > 0xffffffffu
    if ((raw >> 32) == 0u && raw >= 0x1000u) {
        uintptr_t high = ((uintptr_t)&s) & 0xffffffff00000000ULL;
        raw = high | raw;
    }
#endif
    return (const char*)raw;
}

static int cheng_try_header_string(const char* raw, ChengStrView* out_view) {
    if (raw == NULL || out_view == NULL) {
        return 0;
    }
    if ((uintptr_t)raw < 0x10000u) {
        return 0;
    }
    if (raw[0] == '\0') {
        return 0;
    }
    if ((((uintptr_t)raw) & (sizeof(void*) - 1u)) != 0u) {
        return 0;
    }
    const unsigned char* p = (const unsigned char*)raw;
    int zero_bytes = 0;
    for (int i = 0; i < 4; i++) {
        if (p[i] == 0u) {
            zero_bytes += 1;
        }
    }
    if (zero_bytes == 0) {
        return 0;
    }
    const ChengStrHeaderCompat* hdr = (const ChengStrHeaderCompat*)raw;
    int32_t len32 = hdr->len;
    int32_t cap32 = hdr->cap;
    uintptr_t buf_ptr = (uintptr_t)hdr->buffer;
    if (len32 < 0 || cap32 < len32 || cap32 > (1 << 27)) {
        return 0;
    }
    if (len32 == 0) {
        out_view->ptr = "";
        out_view->len = 0u;
        return 1;
    }
    if (buf_ptr == 0u || buf_ptr < 0x10000u) {
        return 0;
    }
    if ((buf_ptr & (sizeof(void*) - 1u)) != 0u) {
        return 0;
    }
    if ((const char*)buf_ptr == raw) {
        return 0;
    }
    out_view->ptr = (const char*)buf_ptr;
    out_view->len = (size_t)len32;
    return 1;
}

static ChengStrView cheng_view_string(const char* s) {
    ChengStrView v;
    v.ptr = "";
    v.len = 0u;
    const char* raw = cheng_recover_cstr(s);
    if (raw == NULL) {
        return v;
    }
    if (cheng_try_header_string(raw, &v)) {
        return v;
    }
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

// Stage1 compiler/runtime objects may reference typed setLen shims.
// Delegate them to the generic runtime setLen implementation so the
// transient compiler binary remains executable in strict mode.
extern void setLen(void* array_ref, int32_t new_len);

WEAK void setLen_str(void* array_ref, int32_t new_len) {
    setLen(array_ref, new_len);
}

WEAK void setLen_R2cSyntaxIssue(void* array_ref, int32_t new_len) {
    setLen(array_ref, new_len);
}

typedef char* (*cheng_libc_getenv_fn)(const char*);
typedef int (*cheng_libc_remove_fn)(const char*);
typedef int (*cheng_libc_rename_fn)(const char*, const char*);

static char* cheng_call_real_getenv(const char* key) {
    if (key == NULL) {
        return NULL;
    }
    static cheng_libc_getenv_fn fn = NULL;
    if (fn == NULL) {
        fn = (cheng_libc_getenv_fn)dlsym(RTLD_NEXT, "getenv");
    }
    if (fn == NULL) {
        fn = (cheng_libc_getenv_fn)dlsym(RTLD_DEFAULT, "getenv");
    }
    if (fn == NULL) {
        return NULL;
    }
    return fn(key);
}

static int cheng_call_real_remove(const char* path) {
    if (path == NULL) {
        return -1;
    }
    static cheng_libc_remove_fn fn = NULL;
    if (fn == NULL) {
        fn = (cheng_libc_remove_fn)dlsym(RTLD_NEXT, "remove");
    }
    if (fn == NULL) {
        fn = (cheng_libc_remove_fn)dlsym(RTLD_DEFAULT, "remove");
    }
    if (fn == NULL) {
        return -1;
    }
    return fn(path);
}

static int cheng_call_real_rename(const char* old_path, const char* new_path) {
    if (old_path == NULL || new_path == NULL) {
        return -1;
    }
    static cheng_libc_rename_fn fn = NULL;
    if (fn == NULL) {
        fn = (cheng_libc_rename_fn)dlsym(RTLD_NEXT, "rename");
    }
    if (fn == NULL) {
        fn = (cheng_libc_rename_fn)dlsym(RTLD_DEFAULT, "rename");
    }
    if (fn == NULL) {
        return -1;
    }
    return fn(old_path, new_path);
}

WEAK const char* getEnv(const char* key) {
    char* name = cheng_copy_cstr(key);
    if (name == NULL) {
        return NULL;
    }
    char* value = cheng_call_real_getenv(name);
    free(name);
    return value;
}

WEAK char* getenv(const char* key) {
    return (char*)getEnv(key);
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
    int rc = cheng_call_real_remove(p);
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
    int rc = cheng_call_real_rename(a, b);
    free(a);
    free(b);
    return rc;
}

WEAK int remove(const char* path) {
    return libc_remove(path);
}

WEAK int rename(const char* old_path, const char* new_path) {
    return libc_rename(old_path, new_path);
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

static int cheng_buf_reserve(char** buf, size_t* cap, size_t need) {
    if (buf == NULL || cap == NULL) {
        return 0;
    }
    if (need <= *cap) {
        return 1;
    }
    size_t next = (*cap == 0u) ? 256u : *cap;
    while (next < need) {
        next *= 2u;
    }
    char* p = (char*)realloc(*buf, next);
    if (p == NULL) {
        return 0;
    }
    *buf = p;
    *cap = next;
    return 1;
}

WEAK void* cheng_fopen(const char* filename, const char* mode) {
    char* path = cheng_copy_cstr(filename);
    char* open_mode = cheng_copy_cstr(mode);
    if (path == NULL) {
        free(open_mode);
        return NULL;
    }
    if (open_mode == NULL || open_mode[0] == '\0') {
        free(open_mode);
        open_mode = cheng_copy_cstr("rb");
    }
    FILE* f = fopen(path, open_mode != NULL ? open_mode : "rb");
    free(path);
    free(open_mode);
    return (void*)f;
}

WEAK int32_t cheng_fclose(void* f) {
    if (f == NULL) {
        return 0;
    }
    return (int32_t)fclose((FILE*)f);
}

WEAK int32_t cheng_fread(void* ptr, int64_t size, int64_t n, void* stream) {
    if (ptr == NULL || stream == NULL || size <= 0 || n <= 0) {
        return 0;
    }
    return (int32_t)fread(ptr, (size_t)size, (size_t)n, (FILE*)stream);
}

WEAK int32_t cheng_fwrite(void* ptr, int64_t size, int64_t n, void* stream) {
    if (ptr == NULL || stream == NULL || size <= 0 || n <= 0) {
        return 0;
    }
    return (int32_t)fwrite(ptr, (size_t)size, (size_t)n, (FILE*)stream);
}

WEAK int32_t cheng_fflush(void* stream) {
    if (stream == NULL) {
        return 0;
    }
    return (int32_t)fflush((FILE*)stream);
}

WEAK int32_t cheng_fgetc(void* stream) {
    if (stream == NULL) {
        return -1;
    }
    return (int32_t)fgetc((FILE*)stream);
}

WEAK void* get_stdin(void) {
    return (void*)stdin;
}

WEAK void* get_stdout(void) {
    return (void*)stdout;
}

WEAK void* get_stderr(void) {
    return (void*)stderr;
}

WEAK int32_t cheng_file_exists(const char* path) {
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

WEAK int32_t cheng_dir_exists(const char* path) {
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

WEAK int32_t cheng_mkdir1(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return -1;
    }
    int rc = mkdir(p, 0755);
    free(p);
    if (rc == 0 || errno == EEXIST) {
        return 0;
    }
    return -1;
}

WEAK int64_t cheng_file_mtime(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return 0;
    }
    struct stat st;
    int64_t out = 0;
    if (stat(p, &st) == 0) {
        out = (int64_t)st.st_mtime;
    }
    free(p);
    return out;
}

WEAK int64_t cheng_file_size(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return 0;
    }
    struct stat st;
    int64_t out = 0;
    if (stat(p, &st) == 0) {
        out = (int64_t)st.st_size;
    }
    free(p);
    return out;
}

WEAK char* cheng_getcwd(void) {
    static char cwd_buf[4096];
    if (getcwd(cwd_buf, sizeof(cwd_buf)) == NULL) {
        cwd_buf[0] = '\0';
    }
    cwd_buf[sizeof(cwd_buf) - 1u] = '\0';
    return cwd_buf;
}

WEAK char* cheng_list_dir(const char* path) {
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return cheng_copy_cstr("");
    }
    DIR* dir = opendir(p);
    free(p);
    if (dir == NULL) {
        return cheng_copy_cstr("");
    }
    size_t cap = 256u;
    size_t len_buf = 0u;
    char* out = (char*)malloc(cap);
    if (out == NULL) {
        closedir(dir);
        return NULL;
    }
    out[0] = '\0';
    struct dirent* ent = NULL;
    while ((ent = readdir(dir)) != NULL) {
        const char* name = ent->d_name;
        if (name == NULL) {
            continue;
        }
        if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) {
            continue;
        }
        size_t nlen = strlen(name);
        size_t need = len_buf + nlen + 2u;
        if (!cheng_buf_reserve(&out, &cap, need)) {
            break;
        }
        memcpy(out + len_buf, name, nlen);
        len_buf += nlen;
        out[len_buf++] = '\n';
    }
    closedir(dir);
    if (len_buf > 0u && out[len_buf - 1u] == '\n') {
        len_buf -= 1u;
    }
    if (!cheng_buf_reserve(&out, &cap, len_buf + 1u)) {
        return out;
    }
    out[len_buf] = '\0';
    return out;
}

static char* g_cheng_read_file_buf = NULL;
static size_t g_cheng_read_file_cap = 0u;

static int cheng_read_file_reserve(size_t need) {
    if (need <= g_cheng_read_file_cap) {
        return 1;
    }
    size_t next = (g_cheng_read_file_cap == 0u) ? 256u : g_cheng_read_file_cap;
    while (next < need) {
        next *= 2u;
    }
    char* p = (char*)realloc(g_cheng_read_file_buf, next);
    if (p == NULL) {
        return 0;
    }
    g_cheng_read_file_buf = p;
    g_cheng_read_file_cap = next;
    return 1;
}

WEAK char* cheng_read_file(const char* path) {
    static char empty[1] = {0};
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return empty;
    }
    FILE* f = fopen(p, "rb");
    free(p);
    if (f == NULL) {
        return empty;
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return empty;
    }
    long sz = ftell(f);
    if (sz < 0) {
        fclose(f);
        return empty;
    }
    if (fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return empty;
    }
    size_t need = (size_t)sz + 1u;
    if (!cheng_read_file_reserve(need)) {
        fclose(f);
        return empty;
    }
    size_t n = fread(g_cheng_read_file_buf, 1u, (size_t)sz, f);
    g_cheng_read_file_buf[n] = '\0';
    fclose(f);
    return g_cheng_read_file_buf;
}

WEAK int32_t cheng_write_file(const char* path, const char* content) {
    ChengStrView v = cheng_view_string(content);
    char* p = cheng_copy_cstr(path);
    if (p == NULL || p[0] == '\0') {
        free(p);
        return 0;
    }
    FILE* f = fopen(p, "wb");
    free(p);
    if (f == NULL) {
        return 0;
    }
    size_t wrote = 0u;
    if (v.len > 0u && v.ptr != NULL) {
        wrote = fwrite(v.ptr, 1u, v.len, f);
    }
    fclose(f);
    return (v.len == 0u || wrote == v.len) ? 1 : 0;
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

WEAK char* cheng_exec_cmd_ex(const char* command, const char* workingDir, int32_t mergeStderr, int64_t* exitCode) {
    if (exitCode != NULL) {
        *exitCode = -1;
    }
    char* cmd = cheng_copy_cstr(command);
    char* cwd = cheng_copy_cstr(workingDir);
    if (cmd == NULL || cmd[0] == '\0') {
        free(cmd);
        free(cwd);
        return cheng_copy_cstr("");
    }
    size_t cmd_len = strlen(cmd);
    const char* suffix = mergeStderr != 0 ? " 2>&1" : "";
    size_t suffix_len = strlen(suffix);
    char* shell_cmd = (char*)malloc(cmd_len + suffix_len + 1u);
    if (shell_cmd == NULL) {
        free(cmd);
        free(cwd);
        return cheng_copy_cstr("");
    }
    memcpy(shell_cmd, cmd, cmd_len);
    memcpy(shell_cmd + cmd_len, suffix, suffix_len);
    shell_cmd[cmd_len + suffix_len] = '\0';
    free(cmd);

    char old_cwd[4096];
    int has_old_cwd = 0;
    if (cwd != NULL && cwd[0] != '\0') {
        if (getcwd(old_cwd, sizeof(old_cwd)) != NULL) {
            has_old_cwd = 1;
        }
        (void)chdir(cwd);
    }
    free(cwd);

    FILE* pipe = popen(shell_cmd, "r");
    free(shell_cmd);
    if (pipe == NULL) {
        if (has_old_cwd) {
            (void)chdir(old_cwd);
        }
        return cheng_copy_cstr("");
    }

    size_t cap = 1024u;
    size_t len_buf = 0u;
    char* out = (char*)malloc(cap);
    if (out == NULL) {
        out = cheng_copy_cstr("");
        cap = (out != NULL) ? strlen(out) + 1u : 0u;
    }
    if (out != NULL) {
        out[0] = '\0';
    }
    char tmp[512];
    while (fgets(tmp, sizeof(tmp), pipe) != NULL) {
        size_t n = strlen(tmp);
        size_t need = len_buf + n + 1u;
        if (!cheng_buf_reserve(&out, &cap, need)) {
            break;
        }
        memcpy(out + len_buf, tmp, n);
        len_buf += n;
        out[len_buf] = '\0';
    }
    int status = pclose(pipe);
    if (exitCode != NULL) {
        *exitCode = (int64_t)status;
    }
    if (has_old_cwd) {
        (void)chdir(old_cwd);
    }
    if (out == NULL) {
        return cheng_copy_cstr("");
    }
    return out;
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
