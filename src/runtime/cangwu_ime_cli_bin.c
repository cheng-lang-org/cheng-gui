#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define UTFZH_DICT_EXPECTED_COUNT 9698
#define UTFZH_REPLACEMENT_CP 0xFFFD
#define DECODE_ERROR_STORE_LIMIT 4096

typedef enum {
    kLegacyAuto = 0,
    kLegacyUtf8,
    kLegacyUtf16Le,
    kLegacyUtf16Be,
    kLegacyGbk,
    kLegacyGb2312,
} LegacyEncoding;

typedef struct {
    int32_t offset;
    char message[96];
} DecodeError;

typedef struct {
    bool ok;
    LegacyEncoding detected;
    int32_t error_count;
    int32_t valid_scalar_count;
    int32_t han_count;
    int32_t* cps;
    size_t cps_len;
    size_t cps_cap;
    DecodeError* errors;
    size_t errors_len;
    size_t errors_cap;
} DecodeState;

typedef struct {
    unsigned char* data;
    size_t len;
    size_t cap;
} ByteBuf;

typedef struct {
    int64_t ascii_count;
    int64_t dict1_count;
    int64_t dict2_count;
    int64_t dict3_count;
    int64_t fallback4_count;
} EncodeStats;

typedef struct {
    int32_t key;
    int32_t cp;
} LegacyMapEntry;

typedef struct {
    LegacyMapEntry* items;
    size_t len;
    size_t cap;
} LegacyMap;

typedef struct {
    int32_t* bmp_index;
    int32_t* nonbmp_cp;
    int32_t* nonbmp_idx;
    size_t nonbmp_len;
    size_t nonbmp_cap;
    int32_t count;
} UtfZhDict;

typedef struct {
    UtfZhDict dict;
    LegacyMap gbk;
    LegacyMap gb2312;
    bool has_gbk;
    bool has_gb2312;
} BuiltinAssets;

typedef struct {
    int32_t cp;
    int32_t base_idx;
    int64_t base_freq;
} DictRow;

static const uint32_t* g_dict_opt_counts = NULL;

static void cli_usage(void) {
    fprintf(stdout, "仓五码 UTF-ZH 工具\n");
    fprintf(stdout, "用法: cangwu_ime_cli <subcommand> [options]\n\n");
    fprintf(stdout, "subcommand:\n");
    fprintf(stdout, "  convert      旧编码 -> Unicode Hub -> UTF-ZH 严格转码\n");
    fprintf(stdout, "  build-assets 生成并校验 IME/UTF-ZH/legacy 资产\n");
    fprintf(stdout, "  verify       运行 IME 闭环验证\n");
    fprintf(stdout, "\n");
    fprintf(stdout, "也可直接用别名二进制执行:\n");
    fprintf(stdout, "  convert_to_utfzh [options]\n");
    fprintf(stdout, "  build_cangwu_assets [options]\n");
    fprintf(stdout, "  verify_cangwu_ime [options]\n");
}

static bool starts_with(const char* text, const char* prefix) {
    size_t n = strlen(prefix);
    return strncmp(text, prefix, n) == 0;
}

static bool str_truthy(const char* value) {
    if (value == NULL || value[0] == '\0') {
        return false;
    }
    if (strcmp(value, "1") == 0 || strcmp(value, "true") == 0 || strcmp(value, "TRUE") == 0 ||
        strcmp(value, "yes") == 0 || strcmp(value, "YES") == 0 || strcmp(value, "on") == 0 ||
        strcmp(value, "ON") == 0) {
        return true;
    }
    return false;
}

static const char* base_name(const char* path) {
    if (path == NULL) {
        return "";
    }
    const char* last = strrchr(path, '/');
    return last != NULL ? last + 1 : path;
}

static const char* parse_flag_value(const char* arg, const char* key) {
    size_t key_len = strlen(key);
    if (starts_with(arg, key) && strlen(arg) > key_len) {
        char sep = arg[key_len];
        if (sep == ':' || sep == '=') {
            return arg + key_len + 1;
        }
    }
    return NULL;
}

static int spawn_wait(char* const argv[]) {
    pid_t pid = fork();
    if (pid < 0) {
        return 127;
    }
    if (pid == 0) {
        execvp(argv[0], argv);
        _exit(127);
    }
    int status = 0;
    if (waitpid(pid, &status, 0) < 0) {
        return 127;
    }
    if (WIFEXITED(status)) {
        return WEXITSTATUS(status);
    }
    if (WIFSIGNALED(status)) {
        return 128 + WTERMSIG(status);
    }
    return 127;
}

static bool join_path2(char* out, size_t cap, const char* a, const char* b) {
    if (snprintf(out, cap, "%s/%s", a, b) >= (int)cap) {
        return false;
    }
    return true;
}

static bool file_exists(const char* path) {
    return access(path, F_OK) == 0;
}

static bool derive_pkg_root_from_argv0(const char* argv0, char* out, size_t out_cap) {
    if (argv0 == NULL || argv0[0] == '\0') {
        return false;
    }
    char resolved[PATH_MAX];
    const char* base = argv0;
    if (realpath(argv0, resolved) != NULL) {
        base = resolved;
    }
    const char* marker = strstr(base, "/build/cangwu_ime/bin/");
    if (marker == NULL) {
        marker = strstr(base, "/build/cangwu_ime/bin");
    }
    if (marker == NULL) {
        return false;
    }
    size_t n = (size_t)(marker - base);
    if (n == 0 || n >= out_cap) {
        return false;
    }
    memcpy(out, base, n);
    out[n] = '\0';
    return true;
}

static int line_count(const char* path) {
    FILE* f = fopen(path, "rb");
    if (f == NULL) {
        return -1;
    }
    int lines = 0;
    int ch = 0;
    int last = '\n';
    while ((ch = fgetc(f)) != EOF) {
        if (ch == '\n') {
            lines++;
        }
        last = ch;
    }
    fclose(f);
    if (last != '\n') {
        lines++;
    }
    return lines;
}

static void byte_buf_init(ByteBuf* out) {
    out->data = NULL;
    out->len = 0;
    out->cap = 0;
}

static void byte_buf_free(ByteBuf* out) {
    free(out->data);
    out->data = NULL;
    out->len = 0;
    out->cap = 0;
}

static bool byte_buf_reserve(ByteBuf* out, size_t need_cap) {
    if (need_cap <= out->cap) {
        return true;
    }
    size_t next_cap = out->cap > 0 ? out->cap : 256;
    while (next_cap < need_cap) {
        if (next_cap > (SIZE_MAX / 2)) {
            next_cap = need_cap;
            break;
        }
        next_cap = next_cap * 2;
    }
    unsigned char* next = (unsigned char*)realloc(out->data, next_cap);
    if (next == NULL) {
        return false;
    }
    out->data = next;
    out->cap = next_cap;
    return true;
}

static bool byte_buf_push(ByteBuf* out, unsigned char v) {
    if (!byte_buf_reserve(out, out->len + 1)) {
        return false;
    }
    out->data[out->len++] = v;
    return true;
}

static bool read_file_bytes(const char* path, unsigned char** out_data, size_t* out_len) {
    *out_data = NULL;
    *out_len = 0;
    FILE* f = fopen(path, "rb");
    if (f == NULL) {
        return false;
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return false;
    }
    long n = ftell(f);
    if (n < 0) {
        fclose(f);
        return false;
    }
    if (fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return false;
    }
    unsigned char* data = NULL;
    if (n > 0) {
        data = (unsigned char*)malloc((size_t)n);
        if (data == NULL) {
            fclose(f);
            return false;
        }
        size_t got = fread(data, 1, (size_t)n, f);
        if (got != (size_t)n) {
            free(data);
            fclose(f);
            return false;
        }
    }
    fclose(f);
    *out_data = data;
    *out_len = (size_t)n;
    return true;
}

static bool write_file_bytes(const char* path, const unsigned char* data, size_t len) {
    FILE* f = fopen(path, "wb");
    if (f == NULL) {
        return false;
    }
    if (len > 0) {
        size_t wrote = fwrite(data, 1, len, f);
        if (wrote != len) {
            fclose(f);
            return false;
        }
    }
    if (fclose(f) != 0) {
        return false;
    }
    return true;
}

static const char* legacy_encoding_label(LegacyEncoding enc) {
    switch (enc) {
        case kLegacyUtf8:
            return "utf8";
        case kLegacyUtf16Le:
            return "utf16le";
        case kLegacyUtf16Be:
            return "utf16be";
        case kLegacyGbk:
            return "gbk";
        case kLegacyGb2312:
            return "gb2312";
        case kLegacyAuto:
        default:
            return "auto";
    }
}

static LegacyEncoding legacy_encoding_from_text(const char* text, bool* ok) {
    char norm[64];
    size_t n = 0;
    if (text != NULL) {
        for (size_t i = 0; text[i] != '\0' && n + 1 < sizeof(norm); i++) {
            unsigned char ch = (unsigned char)text[i];
            if (ch == '-' || ch == '_' || ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
                continue;
            }
            norm[n++] = (char)tolower((int)ch);
        }
    }
    norm[n] = '\0';

    if (n == 0 || strcmp(norm, "auto") == 0) {
        if (ok != NULL) {
            *ok = true;
        }
        return kLegacyAuto;
    }
    if (strcmp(norm, "utf8") == 0 || strcmp(norm, "utf") == 0) {
        if (ok != NULL) {
            *ok = true;
        }
        return kLegacyUtf8;
    }
    if (strcmp(norm, "utf16") == 0 || strcmp(norm, "utf16le") == 0) {
        if (ok != NULL) {
            *ok = true;
        }
        return kLegacyUtf16Le;
    }
    if (strcmp(norm, "utf16be") == 0) {
        if (ok != NULL) {
            *ok = true;
        }
        return kLegacyUtf16Be;
    }
    if (strcmp(norm, "gbk") == 0 || strcmp(norm, "cp936") == 0) {
        if (ok != NULL) {
            *ok = true;
        }
        return kLegacyGbk;
    }
    if (strcmp(norm, "gb2312") == 0) {
        if (ok != NULL) {
            *ok = true;
        }
        return kLegacyGb2312;
    }
    if (ok != NULL) {
        *ok = false;
    }
    return kLegacyAuto;
}

static bool is_han_codepoint(int32_t cp) {
    if (cp >= 0x3400 && cp <= 0x4DBF) {
        return true;
    }
    if (cp >= 0x4E00 && cp <= 0x9FFF) {
        return true;
    }
    if (cp >= 0xF900 && cp <= 0xFAFF) {
        return true;
    }
    if (cp >= 0x20000 && cp <= 0x2FA1F) {
        return true;
    }
    return false;
}

static bool is_scalar(int32_t cp) {
    if (cp < 0 || cp > 0x10FFFF) {
        return false;
    }
    if (cp >= 0xD800 && cp <= 0xDFFF) {
        return false;
    }
    return true;
}

static bool load_dict_rows(const char* path, DictRow** out_rows, size_t* out_len) {
    if (out_rows == NULL || out_len == NULL) {
        return false;
    }
    *out_rows = NULL;
    *out_len = 0u;
    FILE* f = fopen(path, "rb");
    if (f == NULL) {
        return false;
    }
    DictRow* rows = NULL;
    size_t len = 0u;
    size_t cap = 0u;
    char line[2048];
    while (fgets(line, sizeof(line), f) != NULL) {
        char* t1 = strchr(line, '\t');
        if (t1 == NULL) {
            continue;
        }
        *t1 = '\0';
        char* idx_text = line;

        char* t2 = strchr(t1 + 1, '\t');
        if (t2 == NULL) {
            continue;
        }
        char* cp_text = t2 + 1;
        char* cp_end = cp_text;
        while (*cp_end != '\0' && *cp_end != '\t' && *cp_end != '\n' && *cp_end != '\r') {
            cp_end++;
        }
        char* freq_text = NULL;
        if (*cp_end == '\t') {
            *cp_end = '\0';
            freq_text = cp_end + 1;
        } else {
            *cp_end = '\0';
        }

        long idx = strtol(idx_text, NULL, 10);
        long cp = strtol(cp_text, NULL, 10);
        if (idx < 0 || idx > INT32_MAX || cp < 0 || cp > 0x10FFFF) {
            continue;
        }
        int64_t freq = 0;
        if (freq_text != NULL) {
            char* f_end = freq_text;
            while (*f_end != '\0' && *f_end != '\n' && *f_end != '\r') {
                f_end++;
            }
            *f_end = '\0';
            errno = 0;
            long long raw_freq = strtoll(freq_text, NULL, 10);
            if (errno == 0 && raw_freq > 0) {
                freq = raw_freq;
            }
        }

        if (len == cap) {
            size_t next_cap = cap > 0 ? cap * 2u : 1024u;
            DictRow* next = (DictRow*)realloc(rows, next_cap * sizeof(DictRow));
            if (next == NULL) {
                free(rows);
                fclose(f);
                return false;
            }
            rows = next;
            cap = next_cap;
        }
        rows[len].cp = (int32_t)cp;
        rows[len].base_idx = (int32_t)idx;
        rows[len].base_freq = freq;
        len += 1u;
    }
    fclose(f);
    if (len == 0u) {
        free(rows);
        return false;
    }
    *out_rows = rows;
    *out_len = len;
    return true;
}

static int cmp_dict_rows_for_opt(const void* a, const void* b) {
    const DictRow* ra = (const DictRow*)a;
    const DictRow* rb = (const DictRow*)b;
    uint32_t ca = 0u;
    uint32_t cb = 0u;
    if (g_dict_opt_counts != NULL) {
        if (ra->cp >= 0 && ra->cp <= 0x10FFFF) {
            ca = g_dict_opt_counts[ra->cp];
        }
        if (rb->cp >= 0 && rb->cp <= 0x10FFFF) {
            cb = g_dict_opt_counts[rb->cp];
        }
    }
    if (ca > cb) return -1;
    if (ca < cb) return 1;
    if (ra->base_freq > rb->base_freq) return -1;
    if (ra->base_freq < rb->base_freq) return 1;
    if (ra->base_idx < rb->base_idx) return -1;
    if (ra->base_idx > rb->base_idx) return 1;
    if (ra->cp < rb->cp) return -1;
    if (ra->cp > rb->cp) return 1;
    return 0;
}

static bool write_dict_rows(const char* out_path, const DictRow* rows, size_t row_len) {
    FILE* f = fopen(out_path, "wb");
    if (f == NULL) {
        return false;
    }
    for (size_t i = 0; i < row_len; i++) {
        const DictRow* row = &rows[i];
        long long freq = row->base_freq > 0 ? (long long)row->base_freq : 1;
        if (fprintf(f, "%zu\t?\t%d\t%lld\n", i, row->cp, freq) < 0) {
            fclose(f);
            return false;
        }
    }
    if (fclose(f) != 0) {
        return false;
    }
    return true;
}

static bool build_optimized_dict_file(const char* base_dict_path, const int32_t* cps, size_t cp_len,
                                      const char* out_dict_path) {
    if (base_dict_path == NULL || out_dict_path == NULL) {
        return false;
    }
    DictRow* rows = NULL;
    size_t row_len = 0u;
    if (!load_dict_rows(base_dict_path, &rows, &row_len)) {
        return false;
    }
    uint32_t* counts = (uint32_t*)calloc(0x110000u, sizeof(uint32_t));
    if (counts == NULL) {
        free(rows);
        return false;
    }
    for (size_t i = 0; i < cp_len; i++) {
        int32_t cp = cps[i];
        if (cp >= 0 && cp <= 0x10FFFF && counts[cp] < UINT32_MAX) {
            counts[cp] += 1u;
        }
    }
    g_dict_opt_counts = counts;
    qsort(rows, row_len, sizeof(DictRow), cmp_dict_rows_for_opt);
    g_dict_opt_counts = NULL;
    bool ok = write_dict_rows(out_dict_path, rows, row_len);
    free(counts);
    free(rows);
    return ok;
}

static void decode_state_init(DecodeState* out) {
    out->ok = true;
    out->detected = kLegacyAuto;
    out->error_count = 0;
    out->valid_scalar_count = 0;
    out->han_count = 0;
    out->cps = NULL;
    out->cps_len = 0;
    out->cps_cap = 0;
    out->errors = NULL;
    out->errors_len = 0;
    out->errors_cap = 0;
}

static void decode_state_free(DecodeState* out) {
    free(out->cps);
    free(out->errors);
    decode_state_init(out);
}

static bool decode_state_push_cp(DecodeState* out, int32_t cp, bool keep_cps) {
    if (!is_scalar(cp)) {
        cp = UTFZH_REPLACEMENT_CP;
    }
    out->valid_scalar_count += 1;
    if (is_han_codepoint(cp)) {
        out->han_count += 1;
    }
    if (!keep_cps) {
        return true;
    }
    if (out->cps_len == out->cps_cap) {
        size_t next_cap = out->cps_cap > 0 ? out->cps_cap * 2 : 256;
        int32_t* next = (int32_t*)realloc(out->cps, next_cap * sizeof(int32_t));
        if (next == NULL) {
            return false;
        }
        out->cps = next;
        out->cps_cap = next_cap;
    }
    out->cps[out->cps_len++] = cp;
    return true;
}

static void decode_state_add_error(DecodeState* out, int32_t offset, const char* message, bool keep_errors) {
    out->ok = false;
    out->error_count += 1;
    if (!keep_errors || out->errors_len >= DECODE_ERROR_STORE_LIMIT) {
        return;
    }
    if (out->errors_len == out->errors_cap) {
        size_t next_cap = out->errors_cap > 0 ? out->errors_cap * 2 : 32;
        DecodeError* next = (DecodeError*)realloc(out->errors, next_cap * sizeof(DecodeError));
        if (next == NULL) {
            return;
        }
        out->errors = next;
        out->errors_cap = next_cap;
    }
    DecodeError* slot = &out->errors[out->errors_len++];
    slot->offset = offset;
    if (message == NULL) {
        slot->message[0] = '\0';
    } else {
        snprintf(slot->message, sizeof(slot->message), "%s", message);
    }
}

static int legacy_hex_key_to_int(const char* text) {
    if (text == NULL || strlen(text) != 4) {
        return -1;
    }
    int out = 0;
    for (int i = 0; i < 4; i++) {
        unsigned char c = (unsigned char)text[i];
        int nibble = -1;
        if (c >= '0' && c <= '9') {
            nibble = (int)(c - '0');
        } else if (c >= 'A' && c <= 'F') {
            nibble = 10 + (int)(c - 'A');
        } else if (c >= 'a' && c <= 'f') {
            nibble = 10 + (int)(c - 'a');
        }
        if (nibble < 0) {
            return -1;
        }
        out = (out << 4) | nibble;
    }
    return out;
}

static void legacy_map_init(LegacyMap* map) {
    map->items = NULL;
    map->len = 0;
    map->cap = 0;
}

static void legacy_map_free(LegacyMap* map) {
    free(map->items);
    legacy_map_init(map);
}

static bool legacy_map_push(LegacyMap* map, int32_t key, int32_t cp) {
    if (map->len == map->cap) {
        size_t next_cap = map->cap > 0 ? map->cap * 2 : 1024;
        LegacyMapEntry* next = (LegacyMapEntry*)realloc(map->items, next_cap * sizeof(LegacyMapEntry));
        if (next == NULL) {
            return false;
        }
        map->items = next;
        map->cap = next_cap;
    }
    map->items[map->len].key = key;
    map->items[map->len].cp = cp;
    map->len += 1;
    return true;
}

static int cmp_legacy_map_entry(const void* a, const void* b) {
    const LegacyMapEntry* ea = (const LegacyMapEntry*)a;
    const LegacyMapEntry* eb = (const LegacyMapEntry*)b;
    if (ea->key < eb->key) {
        return -1;
    }
    if (ea->key > eb->key) {
        return 1;
    }
    return 0;
}

static bool load_legacy_map(const char* path, LegacyMap* out) {
    FILE* f = fopen(path, "rb");
    if (f == NULL) {
        return false;
    }
    legacy_map_init(out);
    char line[1024];
    while (fgets(line, sizeof(line), f) != NULL) {
        char* t1 = strchr(line, '\t');
        if (t1 == NULL) {
            continue;
        }
        *t1 = '\0';
        char* col1 = line;
        char* col2 = t1 + 1;
        char* t2 = strchr(col2, '\t');
        if (t2 != NULL) {
            *t2 = '\0';
        } else {
            char* end = col2 + strlen(col2);
            while (end > col2 && (end[-1] == '\n' || end[-1] == '\r')) {
                end--;
            }
            *end = '\0';
        }
        int key = legacy_hex_key_to_int(col1);
        long cp = strtol(col2, NULL, 10);
        if (key < 0 || cp < 0 || cp > 0x10FFFF) {
            continue;
        }
        if (!legacy_map_push(out, key, (int32_t)cp)) {
            fclose(f);
            legacy_map_free(out);
            return false;
        }
    }
    fclose(f);
    if (out->len > 1) {
        qsort(out->items, out->len, sizeof(LegacyMapEntry), cmp_legacy_map_entry);
    }
    return true;
}

static int32_t legacy_map_lookup(const LegacyMap* map, int32_t key) {
    if (map == NULL || map->len == 0) {
        return -1;
    }
    size_t lo = 0;
    size_t hi = map->len;
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        int32_t pivot = map->items[mid].key;
        if (pivot == key) {
            return map->items[mid].cp;
        }
        if (key < pivot) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return -1;
}

static void utfzh_dict_init(UtfZhDict* out) {
    out->bmp_index = NULL;
    out->nonbmp_cp = NULL;
    out->nonbmp_idx = NULL;
    out->nonbmp_len = 0;
    out->nonbmp_cap = 0;
    out->count = 0;
}

static void utfzh_dict_free(UtfZhDict* out) {
    free(out->bmp_index);
    free(out->nonbmp_cp);
    free(out->nonbmp_idx);
    utfzh_dict_init(out);
}

static bool utfzh_dict_push_nonbmp(UtfZhDict* out, int32_t cp, int32_t idx) {
    if (out->nonbmp_len == out->nonbmp_cap) {
        size_t next_cap = out->nonbmp_cap > 0 ? out->nonbmp_cap * 2 : 64;
        int32_t* next_cp = (int32_t*)realloc(out->nonbmp_cp, next_cap * sizeof(int32_t));
        if (next_cp == NULL) {
            return false;
        }
        int32_t* next_idx = (int32_t*)realloc(out->nonbmp_idx, next_cap * sizeof(int32_t));
        if (next_idx == NULL) {
            out->nonbmp_cp = next_cp;
            return false;
        }
        out->nonbmp_cp = next_cp;
        out->nonbmp_idx = next_idx;
        out->nonbmp_cap = next_cap;
    }
    out->nonbmp_cp[out->nonbmp_len] = cp;
    out->nonbmp_idx[out->nonbmp_len] = idx;
    out->nonbmp_len += 1;
    return true;
}

typedef struct {
    int32_t cp;
    int32_t idx;
} NonBmpEntry;

static int cmp_nonbmp_entry(const void* a, const void* b) {
    const NonBmpEntry* ea = (const NonBmpEntry*)a;
    const NonBmpEntry* eb = (const NonBmpEntry*)b;
    if (ea->cp < eb->cp) {
        return -1;
    }
    if (ea->cp > eb->cp) {
        return 1;
    }
    return 0;
}

static bool load_utfzh_dict(const char* path, UtfZhDict* out) {
    utfzh_dict_init(out);
    out->bmp_index = (int32_t*)calloc(65536u, sizeof(int32_t));
    if (out->bmp_index == NULL) {
        return false;
    }

    FILE* f = fopen(path, "rb");
    if (f == NULL) {
        utfzh_dict_free(out);
        return false;
    }

    char line[2048];
    NonBmpEntry* nonbmp = NULL;
    size_t nonbmp_len = 0;
    size_t nonbmp_cap = 0;

    while (fgets(line, sizeof(line), f) != NULL) {
        char* t1 = strchr(line, '\t');
        if (t1 == NULL) {
            continue;
        }
        *t1 = '\0';
        char* idx_text = line;

        char* t2 = strchr(t1 + 1, '\t');
        if (t2 == NULL) {
            continue;
        }
        char* cp_text = t2 + 1;
        char* cp_end = cp_text;
        while (*cp_end != '\0' && *cp_end != '\t' && *cp_end != '\n' && *cp_end != '\r') {
            cp_end++;
        }
        *cp_end = '\0';

        long idx = strtol(idx_text, NULL, 10);
        long cp = strtol(cp_text, NULL, 10);
        if (idx < 0 || idx > INT32_MAX || cp < 0 || cp > 0x10FFFF) {
            continue;
        }
        out->count += 1;
        if (cp < 65536) {
            out->bmp_index[(int32_t)cp] = (int32_t)idx + 1;
        } else {
            if (nonbmp_len == nonbmp_cap) {
                size_t next_cap = nonbmp_cap > 0 ? nonbmp_cap * 2 : 64;
                NonBmpEntry* next = (NonBmpEntry*)realloc(nonbmp, next_cap * sizeof(NonBmpEntry));
                if (next == NULL) {
                    free(nonbmp);
                    fclose(f);
                    utfzh_dict_free(out);
                    return false;
                }
                nonbmp = next;
                nonbmp_cap = next_cap;
            }
            nonbmp[nonbmp_len].cp = (int32_t)cp;
            nonbmp[nonbmp_len].idx = (int32_t)idx;
            nonbmp_len += 1;
        }
    }
    fclose(f);

    if (nonbmp_len > 1) {
        qsort(nonbmp, nonbmp_len, sizeof(NonBmpEntry), cmp_nonbmp_entry);
    }
    for (size_t i = 0; i < nonbmp_len; i++) {
        if (!utfzh_dict_push_nonbmp(out, nonbmp[i].cp, nonbmp[i].idx)) {
            free(nonbmp);
            utfzh_dict_free(out);
            return false;
        }
    }
    free(nonbmp);
    return out->count > 0;
}

static int32_t utfzh_dict_lookup_idx(const UtfZhDict* dict, int32_t cp) {
    if (dict == NULL) {
        return -1;
    }
    if (cp >= 0 && cp < 65536 && dict->bmp_index != NULL) {
        int32_t idx1 = dict->bmp_index[cp];
        return idx1 > 0 ? idx1 - 1 : -1;
    }
    if (cp >= 65536 && dict->nonbmp_len > 0) {
        size_t lo = 0;
        size_t hi = dict->nonbmp_len;
        while (lo < hi) {
            size_t mid = lo + (hi - lo) / 2;
            int32_t pivot = dict->nonbmp_cp[mid];
            if (pivot == cp) {
                return dict->nonbmp_idx[mid];
            }
            if (cp < pivot) {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
    }
    return -1;
}

static bool decode_utf8_one(const unsigned char* raw, size_t n, size_t offset, int32_t* out_cp, size_t* out_step) {
    if (offset >= n) {
        return false;
    }
    unsigned int b0 = raw[offset];
    if (b0 < 0x80) {
        *out_cp = (int32_t)b0;
        *out_step = 1;
        return true;
    }
    if (b0 >= 0xC2 && b0 <= 0xDF) {
        if (offset + 1 >= n) {
            return false;
        }
        unsigned int b1 = raw[offset + 1];
        if ((b1 & 0xC0) != 0x80) {
            return false;
        }
        *out_cp = (int32_t)(((b0 & 0x1F) << 6) | (b1 & 0x3F));
        *out_step = 2;
        return true;
    }
    if (b0 >= 0xE0 && b0 <= 0xEF) {
        if (offset + 2 >= n) {
            return false;
        }
        unsigned int b1 = raw[offset + 1];
        unsigned int b2 = raw[offset + 2];
        if ((b1 & 0xC0) != 0x80 || (b2 & 0xC0) != 0x80) {
            return false;
        }
        int32_t cp = (int32_t)(((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F));
        if (cp < 0x800 || !is_scalar(cp)) {
            return false;
        }
        *out_cp = cp;
        *out_step = 3;
        return true;
    }
    if (b0 >= 0xF0 && b0 <= 0xF4) {
        if (offset + 3 >= n) {
            return false;
        }
        unsigned int b1 = raw[offset + 1];
        unsigned int b2 = raw[offset + 2];
        unsigned int b3 = raw[offset + 3];
        if ((b1 & 0xC0) != 0x80 || (b2 & 0xC0) != 0x80 || (b3 & 0xC0) != 0x80) {
            return false;
        }
        int32_t cp = (int32_t)(((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
        if (cp < 0x10000 || cp > 0x10FFFF) {
            return false;
        }
        *out_cp = cp;
        *out_step = 4;
        return true;
    }
    return false;
}

static bool decode_utf8(const unsigned char* raw, size_t n, DecodeState* out, bool keep_cps, bool keep_errors) {
    size_t i = 0;
    if (n >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF) {
        i = 3;
    }
    while (i < n) {
        int32_t cp = UTFZH_REPLACEMENT_CP;
        size_t step = 1;
        if (!decode_utf8_one(raw, n, i, &cp, &step)) {
            decode_state_add_error(out, (int32_t)i, "invalid utf-8", keep_errors);
            cp = UTFZH_REPLACEMENT_CP;
            step = 1;
        }
        if (!decode_state_push_cp(out, cp, keep_cps)) {
            return false;
        }
        i += step;
    }
    return true;
}

static bool decode_utf16(const unsigned char* raw, size_t n, bool little_endian, DecodeState* out, bool keep_cps,
                         bool keep_errors) {
    size_t i = 0;
    if (n >= 2) {
        if (little_endian && raw[0] == 0xFF && raw[1] == 0xFE) {
            i = 2;
        } else if (!little_endian && raw[0] == 0xFE && raw[1] == 0xFF) {
            i = 2;
        }
    }
    while (i < n) {
        if (i + 1 >= n) {
            decode_state_add_error(out, (int32_t)i, "truncated utf-16", keep_errors);
            if (!decode_state_push_cp(out, UTFZH_REPLACEMENT_CP, keep_cps)) {
                return false;
            }
            break;
        }

        int32_t u = 0;
        if (little_endian) {
            u = (int32_t)raw[i] | ((int32_t)raw[i + 1] << 8);
        } else {
            u = ((int32_t)raw[i] << 8) | (int32_t)raw[i + 1];
        }
        i += 2;

        if (u >= 0xD800 && u <= 0xDBFF) {
            if (i + 1 >= n) {
                decode_state_add_error(out, (int32_t)(i - 2), "truncated utf-16 surrogate", keep_errors);
                if (!decode_state_push_cp(out, UTFZH_REPLACEMENT_CP, keep_cps)) {
                    return false;
                }
                break;
            }
            int32_t v = 0;
            if (little_endian) {
                v = (int32_t)raw[i] | ((int32_t)raw[i + 1] << 8);
            } else {
                v = ((int32_t)raw[i] << 8) | (int32_t)raw[i + 1];
            }
            if (v < 0xDC00 || v > 0xDFFF) {
                decode_state_add_error(out, (int32_t)i, "invalid utf-16 low surrogate", keep_errors);
                if (!decode_state_push_cp(out, UTFZH_REPLACEMENT_CP, keep_cps)) {
                    return false;
                }
                continue;
            }
            i += 2;
            int32_t cp = 0x10000 + ((u - 0xD800) << 10) + (v - 0xDC00);
            if (!decode_state_push_cp(out, cp, keep_cps)) {
                return false;
            }
            continue;
        }

        if (u >= 0xDC00 && u <= 0xDFFF) {
            decode_state_add_error(out, (int32_t)(i - 2), "unexpected utf-16 low surrogate", keep_errors);
            if (!decode_state_push_cp(out, UTFZH_REPLACEMENT_CP, keep_cps)) {
                return false;
            }
            continue;
        }

        if (u == 0xFEFF && out->valid_scalar_count == 0) {
            continue;
        }
        if (!decode_state_push_cp(out, u, keep_cps)) {
            return false;
        }
    }
    return true;
}

static bool decode_dbcs(const unsigned char* raw, size_t n, const LegacyMap* map, const char* label, DecodeState* out,
                        bool keep_cps, bool keep_errors) {
    size_t i = 0;
    while (i < n) {
        int32_t b1 = (int32_t)raw[i];
        if (b1 < 0x80) {
            if (!decode_state_push_cp(out, b1, keep_cps)) {
                return false;
            }
            i += 1;
            continue;
        }
        if (i + 1 >= n) {
            char msg[96];
            snprintf(msg, sizeof(msg), "truncated %s", label);
            decode_state_add_error(out, (int32_t)i, msg, keep_errors);
            if (!decode_state_push_cp(out, UTFZH_REPLACEMENT_CP, keep_cps)) {
                return false;
            }
            break;
        }
        int32_t b2 = (int32_t)raw[i + 1];
        int32_t key = (b1 << 8) | b2;
        int32_t cp = legacy_map_lookup(map, key);
        if (cp >= 0 && cp <= 0x10FFFF) {
            if (!decode_state_push_cp(out, cp, keep_cps)) {
                return false;
            }
            i += 2;
            continue;
        }
        char msg[96];
        snprintf(msg, sizeof(msg), "invalid %s pair", label);
        decode_state_add_error(out, (int32_t)i, msg, keep_errors);
        if (!decode_state_push_cp(out, UTFZH_REPLACEMENT_CP, keep_cps)) {
            return false;
        }
        i += 1;
    }
    return true;
}

static bool decode_legacy_specific(const unsigned char* raw, size_t n, LegacyEncoding source,
                                   const BuiltinAssets* assets, DecodeState* out, bool keep_cps,
                                   bool keep_errors) {
    out->detected = source;
    switch (source) {
        case kLegacyUtf8:
            return decode_utf8(raw, n, out, keep_cps, keep_errors);
        case kLegacyUtf16Le:
            return decode_utf16(raw, n, true, out, keep_cps, keep_errors);
        case kLegacyUtf16Be:
            return decode_utf16(raw, n, false, out, keep_cps, keep_errors);
        case kLegacyGbk:
            return decode_dbcs(raw, n, &assets->gbk, "gbk", out, keep_cps, keep_errors);
        case kLegacyGb2312:
            return decode_dbcs(raw, n, &assets->gb2312, "gb2312", out, keep_cps, keep_errors);
        case kLegacyAuto:
        default:
            return decode_utf8(raw, n, out, keep_cps, keep_errors);
    }
}

static LegacyEncoding detect_legacy_encoding(const unsigned char* raw, size_t n, const BuiltinAssets* assets) {
    if (n >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF) {
        return kLegacyUtf8;
    }
    if (n >= 2 && raw[0] == 0xFF && raw[1] == 0xFE) {
        return kLegacyUtf16Le;
    }
    if (n >= 2 && raw[0] == 0xFE && raw[1] == 0xFF) {
        return kLegacyUtf16Be;
    }

    const LegacyEncoding candidates[] = {kLegacyUtf8, kLegacyUtf16Le, kLegacyUtf16Be, kLegacyGbk, kLegacyGb2312};
    const int32_t candidate_count = (int32_t)(sizeof(candidates) / sizeof(candidates[0]));
    const bool has_zero_byte = memchr(raw, 0, n) != NULL;

    int32_t best_err = INT32_MAX;
    int32_t best_scalar = -1;
    int32_t best_order = INT32_MAX;
    LegacyEncoding best_enc = kLegacyUtf8;

    for (int32_t order = 0; order < candidate_count; order++) {
        DecodeState cur;
        decode_state_init(&cur);
        if (!decode_legacy_specific(raw, n, candidates[order], assets, &cur, false, false)) {
            decode_state_free(&cur);
            continue;
        }

        int32_t score_err = cur.error_count;
        if (!has_zero_byte && (candidates[order] == kLegacyUtf16Le || candidates[order] == kLegacyUtf16Be)) {
            score_err += 1;
        }
        if (score_err < best_err ||
            (score_err == best_err && cur.valid_scalar_count > best_scalar) ||
            (score_err == best_err && cur.valid_scalar_count == best_scalar && order < best_order)) {
            best_err = score_err;
            best_scalar = cur.valid_scalar_count;
            best_enc = candidates[order];
            best_order = order;
        }
        decode_state_free(&cur);
    }

    return best_order == INT32_MAX ? kLegacyUtf8 : best_enc;
}

static bool utfzh_encode_from_cps(const int32_t* cps, size_t cp_len, const UtfZhDict* dict, ByteBuf* out,
                                  int32_t* out_error_count, EncodeStats* out_stats) {
    *out_error_count = 0;
    if (out_stats != NULL) {
        memset(out_stats, 0, sizeof(*out_stats));
    }
    for (size_t i = 0; i < cp_len; i++) {
        int32_t cp = cps[i];
        if (!is_scalar(cp)) {
            cp = UTFZH_REPLACEMENT_CP;
            *out_error_count += 1;
        }
        if (cp < 0x80) {
            if (out_stats != NULL) {
                out_stats->ascii_count += 1;
            }
            if (!byte_buf_push(out, (unsigned char)cp)) {
                return false;
            }
            continue;
        }
        int32_t d_idx = utfzh_dict_lookup_idx(dict, cp);
        if (d_idx >= 0) {
            if (d_idx <= 33) {
                if (out_stats != NULL) {
                    out_stats->dict1_count += 1;
                }
                if (!byte_buf_push(out, (unsigned char)(0xC0 + d_idx))) {
                    return false;
                }
            } else if (d_idx <= 1505) {
                if (out_stats != NULL) {
                    out_stats->dict2_count += 1;
                }
                int32_t n = d_idx - 34;
                if (!byte_buf_push(out, (unsigned char)(0xE2 + (n / 64))) ||
                    !byte_buf_push(out, (unsigned char)(0x80 + (n % 64)))) {
                    return false;
                }
            } else {
                if (out_stats != NULL) {
                    out_stats->dict3_count += 1;
                }
                int32_t n = d_idx - 1506;
                int32_t b1 = 0xF9 + (n / 4096);
                int32_t rem = n % 4096;
                int32_t b2 = 0x80 + (rem / 64);
                int32_t b3 = 0x80 + (rem % 64);
                if (!byte_buf_push(out, (unsigned char)b1) || !byte_buf_push(out, (unsigned char)b2) ||
                    !byte_buf_push(out, (unsigned char)b3)) {
                    return false;
                }
            }
            continue;
        }
        if (out_stats != NULL) {
            out_stats->fallback4_count += 1;
        }
        int32_t b1 = 0xFB + (cp >> 18);
        int32_t b2 = 0x80 + ((cp >> 12) & 0x3F);
        int32_t b3 = 0x80 + ((cp >> 6) & 0x3F);
        int32_t b4 = 0x80 + (cp & 0x3F);
        if (!byte_buf_push(out, (unsigned char)b1) || !byte_buf_push(out, (unsigned char)b2) ||
            !byte_buf_push(out, (unsigned char)b3) || !byte_buf_push(out, (unsigned char)b4)) {
            return false;
        }
    }
    return true;
}

static bool write_report(const char* report_path, const char* in_path, const char* out_path,
                         LegacyEncoding detected, int32_t error_count, const DecodeError* errors,
                         size_t errors_len, size_t input_bytes, size_t output_bytes,
                         const EncodeStats* stats, size_t scalar_count) {
    if (report_path == NULL || report_path[0] == '\0') {
        return true;
    }
    FILE* f = fopen(report_path, "wb");
    if (f == NULL) {
        return false;
    }
    fprintf(f, "ok=%s\n", error_count == 0 ? "true" : "false");
    fprintf(f, "input=%s\n", in_path != NULL ? in_path : "");
    fprintf(f, "output=%s\n", out_path != NULL ? out_path : "");
    fprintf(f, "detected=%s\n", legacy_encoding_label(detected));
    fprintf(f, "error_count=%d\n", error_count);
    fprintf(f, "input_bytes=%zu\n", input_bytes);
    fprintf(f, "output_bytes=%zu\n", output_bytes);
    if (input_bytes > 0) {
        double ratio = (double)output_bytes / (double)input_bytes;
        fprintf(f, "output_over_input_ratio=%.6f\n", ratio);
    }
    if (stats != NULL) {
        fprintf(f, "utfzh_ascii=%lld\n", (long long)stats->ascii_count);
        fprintf(f, "utfzh_dict_1b=%lld\n", (long long)stats->dict1_count);
        fprintf(f, "utfzh_dict_2b=%lld\n", (long long)stats->dict2_count);
        fprintf(f, "utfzh_dict_3b=%lld\n", (long long)stats->dict3_count);
        fprintf(f, "utfzh_fallback_4b=%lld\n", (long long)stats->fallback4_count);
    }
    if (scalar_count > 0) {
        double avg = (double)output_bytes / (double)scalar_count;
        fprintf(f, "utfzh_avg_bytes_per_scalar=%.6f\n", avg);
    }
    for (size_t i = 0; i < errors_len; i++) {
        fprintf(f, "error[%zu]=%d:%s\n", i, errors[i].offset, errors[i].message);
    }
    if (fclose(f) != 0) {
        return false;
    }
    return true;
}

static void builtin_assets_init(BuiltinAssets* assets) {
    utfzh_dict_init(&assets->dict);
    legacy_map_init(&assets->gbk);
    legacy_map_init(&assets->gb2312);
    assets->has_gbk = false;
    assets->has_gb2312 = false;
}

static void builtin_assets_free(BuiltinAssets* assets) {
    utfzh_dict_free(&assets->dict);
    legacy_map_free(&assets->gbk);
    legacy_map_free(&assets->gb2312);
    assets->has_gbk = false;
    assets->has_gb2312 = false;
}

static bool load_builtin_assets(BuiltinAssets* assets, const char* data_root, bool need_gbk, bool need_gb2312) {
    char dict_path[PATH_MAX];
    if (!join_path2(dict_path, sizeof(dict_path), data_root, "utfzh_dict_v1.tsv")) {
        return false;
    }
    if (!load_utfzh_dict(dict_path, &assets->dict)) {
        return false;
    }

    if (need_gbk) {
        char gbk_path[PATH_MAX];
        if (!join_path2(gbk_path, sizeof(gbk_path), data_root, "legacy_gbk_to_u_v1.tsv")) {
            return false;
        }
        if (!load_legacy_map(gbk_path, &assets->gbk)) {
            return false;
        }
        assets->has_gbk = true;
    }
    if (need_gb2312) {
        char gb2312_path[PATH_MAX];
        if (!join_path2(gb2312_path, sizeof(gb2312_path), data_root, "legacy_gb2312_to_u_v1.tsv")) {
            return false;
        }
        if (!load_legacy_map(gb2312_path, &assets->gb2312)) {
            return false;
        }
        assets->has_gb2312 = true;
    }
    return true;
}

static int run_builtin_convert(const char* in_path, const char* out_path, LegacyEncoding source,
                               const char* report_path, const char* data_root,
                               bool optimize_dict, const char* dict_out_path) {
    unsigned char* input = NULL;
    size_t input_len = 0;
    if (!read_file_bytes(in_path, &input, &input_len)) {
        return 32;
    }

    BuiltinAssets assets;
    builtin_assets_init(&assets);
    bool need_gbk = (source == kLegacyAuto || source == kLegacyGbk);
    bool need_gb2312 = (source == kLegacyAuto || source == kLegacyGb2312);
    if (!load_builtin_assets(&assets, data_root, need_gbk, need_gb2312)) {
        free(input);
        builtin_assets_free(&assets);
        fprintf(stderr, "[cangwu-ime-cli] failed to load data assets from %s\n", data_root);
        return 33;
    }
    if (assets.dict.count != UTFZH_DICT_EXPECTED_COUNT) {
        fprintf(stderr, "[cangwu-ime-cli] dict count mismatch: %d (want %d)\n", assets.dict.count,
                UTFZH_DICT_EXPECTED_COUNT);
        free(input);
        builtin_assets_free(&assets);
        return 33;
    }

    LegacyEncoding detected = source;
    if (source == kLegacyAuto) {
        detected = detect_legacy_encoding(input, input_len, &assets);
    }

    DecodeState decoded;
    decode_state_init(&decoded);
    decoded.detected = detected;
    if (!decode_legacy_specific(input, input_len, detected, &assets, &decoded, true, true)) {
        free(input);
        decode_state_free(&decoded);
        builtin_assets_free(&assets);
        return 33;
    }

    char optimized_dict_path[PATH_MAX];
    optimized_dict_path[0] = '\0';
    bool optimized_used = false;
    if (optimize_dict) {
        char base_dict_path[PATH_MAX];
        if (!join_path2(base_dict_path, sizeof(base_dict_path), data_root, "utfzh_dict_v1.tsv")) {
            free(input);
            decode_state_free(&decoded);
            builtin_assets_free(&assets);
            return 33;
        }
        if (dict_out_path != NULL && dict_out_path[0] != '\0') {
            if (snprintf(optimized_dict_path, sizeof(optimized_dict_path), "%s", dict_out_path) >=
                (int)sizeof(optimized_dict_path)) {
                free(input);
                decode_state_free(&decoded);
                builtin_assets_free(&assets);
                fprintf(stderr, "[cangwu-ime-cli] --dict-out too long\n");
                return 2;
            }
        } else {
            if (snprintf(optimized_dict_path, sizeof(optimized_dict_path), "/tmp/cw_utfzh_dict_opt_%d.tsv", getpid()) >=
                (int)sizeof(optimized_dict_path)) {
                free(input);
                decode_state_free(&decoded);
                builtin_assets_free(&assets);
                return 33;
            }
        }
        if (!build_optimized_dict_file(base_dict_path, decoded.cps, decoded.cps_len, optimized_dict_path)) {
            free(input);
            decode_state_free(&decoded);
            builtin_assets_free(&assets);
            fprintf(stderr, "[cangwu-ime-cli] failed to build optimized dict: %s\n", optimized_dict_path);
            return 33;
        }
        utfzh_dict_free(&assets.dict);
        utfzh_dict_init(&assets.dict);
        if (!load_utfzh_dict(optimized_dict_path, &assets.dict) || assets.dict.count != UTFZH_DICT_EXPECTED_COUNT) {
            free(input);
            decode_state_free(&decoded);
            builtin_assets_free(&assets);
            fprintf(stderr, "[cangwu-ime-cli] failed to load optimized dict: %s\n", optimized_dict_path);
            return 33;
        }
        optimized_used = true;
    }

    ByteBuf out_bytes;
    byte_buf_init(&out_bytes);
    int32_t encode_errors = 0;
    EncodeStats encode_stats;
    memset(&encode_stats, 0, sizeof(encode_stats));
    if (!utfzh_encode_from_cps(decoded.cps, decoded.cps_len, &assets.dict, &out_bytes, &encode_errors,
                               &encode_stats)) {
        free(input);
        decode_state_free(&decoded);
        byte_buf_free(&out_bytes);
        builtin_assets_free(&assets);
        return 33;
    }
    if (encode_errors > 0) {
        decoded.ok = false;
        decoded.error_count += encode_errors;
    }

    if (!write_file_bytes(out_path, out_bytes.data, out_bytes.len)) {
        free(input);
        decode_state_free(&decoded);
        byte_buf_free(&out_bytes);
        builtin_assets_free(&assets);
        return 33;
    }
    if (!write_report(report_path, in_path, out_path, detected, decoded.error_count, decoded.errors,
                      decoded.errors_len, input_len, out_bytes.len, &encode_stats, decoded.cps_len)) {
        free(input);
        decode_state_free(&decoded);
        byte_buf_free(&out_bytes);
        builtin_assets_free(&assets);
        return 34;
    }
    if (report_path != NULL && report_path[0] != '\0') {
        FILE* f = fopen(report_path, "ab");
        if (f != NULL) {
            fprintf(f, "dict_optimized=%s\n", optimized_used ? "true" : "false");
            if (optimized_used) {
                fprintf(f, "dict_path=%s\n", optimized_dict_path);
            }
            fclose(f);
        }
    }

    int rc = decoded.error_count == 0 ? 0 : 35;
    free(input);
    decode_state_free(&decoded);
    byte_buf_free(&out_bytes);
    builtin_assets_free(&assets);
    return rc;
}

static int run_cheng_bridge(const char* transcode_bridge, const char* in_path, const char* out_path,
                            const char* from, const char* report, const char* data_root) {
    int timeout_sec = 8;
    const char* timeout_env = getenv("CW_IME_CHENG_TIMEOUT_SEC");
    if (timeout_env != NULL && timeout_env[0] != '\0') {
        int parsed = atoi(timeout_env);
        if (parsed > 0 && parsed < 300) {
            timeout_sec = parsed;
        }
    }

    pid_t pid = fork();
    if (pid < 0) {
        return 127;
    }
    if (pid == 0) {
        setpgid(0, 0);
        setenv("UTFZH_IN", in_path != NULL ? in_path : "", 1);
        setenv("UTFZH_OUT", out_path != NULL ? out_path : "", 1);
        setenv("UTFZH_FROM", from != NULL ? from : "auto", 1);
        setenv("UTFZH_REPORT", report != NULL ? report : "", 1);
        setenv("UTFZH_DATA_ROOT", data_root, 1);
        execl(transcode_bridge, transcode_bridge, (char*)NULL);
        _exit(127);
    }
    (void)setpgid(pid, pid);

    int status = 0;
    int rc = 127;
    time_t deadline = time(NULL) + timeout_sec;
    while (true) {
        pid_t waited = waitpid(pid, &status, WNOHANG);
        if (waited == pid) {
            if (WIFEXITED(status)) {
                rc = WEXITSTATUS(status);
            } else if (WIFSIGNALED(status)) {
                rc = 128 + WTERMSIG(status);
            }
            break;
        }
        if (waited < 0) {
            if (errno == EINTR) {
                continue;
            }
            rc = 127;
            break;
        }
        if (time(NULL) >= deadline) {
            kill(-pid, SIGTERM);
            kill(pid, SIGTERM);
            usleep(200000);
            kill(-pid, SIGKILL);
            kill(pid, SIGKILL);
            (void)waitpid(pid, &status, 0);
            rc = 124;
            break;
        }
        usleep(50000);
    }
    return rc;
}

static int run_convert(int argc, char** argv, const char* pkg_root) {
    const char* in_path = NULL;
    const char* out_path = NULL;
    const char* from = "auto";
    const char* report = "";
    const char* dict_out = "";
    bool optimize_dict = false;
    const char* engine_env = getenv("CW_IME_CONVERT_ENGINE");
    const char* engine = (engine_env != NULL && engine_env[0] != '\0') ? engine_env : "cheng";
    char data_root[PATH_MAX];
    if (!join_path2(data_root, sizeof(data_root), pkg_root, "src/ime/data")) {
        fprintf(stderr, "[cangwu-ime-cli] data path overflow\n");
        return 2;
    }

    for (int i = 0; i < argc; i++) {
        const char* arg = argv[i];
        if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
            fprintf(stdout,
                    "用法: cangwu_ime_cli convert --in <input> --out <output> [--from auto|utf8|utf16le|utf16be|gbk|gb2312] [--report <path>] [--data-root <path>] [--engine cheng|builtin|auto] [--optimize-dict] [--dict-out <path>]\n");
            return 0;
        }
        if (strcmp(arg, "--optimize-dict") == 0) {
            optimize_dict = true;
            continue;
        }

        const char* v = parse_flag_value(arg, "--in");
        if (v != NULL) {
            in_path = v;
            continue;
        }
        v = parse_flag_value(arg, "--out");
        if (v != NULL) {
            out_path = v;
            continue;
        }
        v = parse_flag_value(arg, "--from");
        if (v != NULL) {
            from = v;
            continue;
        }
        v = parse_flag_value(arg, "--report");
        if (v != NULL) {
            report = v;
            continue;
        }
        v = parse_flag_value(arg, "--data-root");
        if (v != NULL) {
            if (snprintf(data_root, sizeof(data_root), "%s", v) >= (int)sizeof(data_root)) {
                fprintf(stderr, "[cangwu-ime-cli] --data-root too long\n");
                return 2;
            }
            continue;
        }
        v = parse_flag_value(arg, "--engine");
        if (v != NULL) {
            engine = v;
            continue;
        }
        v = parse_flag_value(arg, "--dict-out");
        if (v != NULL) {
            dict_out = v;
            continue;
        }

        if ((strcmp(arg, "--in") == 0 || strcmp(arg, "--out") == 0 || strcmp(arg, "--from") == 0 ||
             strcmp(arg, "--report") == 0 || strcmp(arg, "--data-root") == 0 || strcmp(arg, "--engine") == 0 ||
             strcmp(arg, "--dict-out") == 0) &&
            i + 1 < argc) {
            const char* next = argv[++i];
            if (strcmp(arg, "--in") == 0) {
                in_path = next;
            } else if (strcmp(arg, "--out") == 0) {
                out_path = next;
            } else if (strcmp(arg, "--from") == 0) {
                from = next;
            } else if (strcmp(arg, "--report") == 0) {
                report = next;
            } else if (strcmp(arg, "--engine") == 0) {
                engine = next;
            } else if (strcmp(arg, "--dict-out") == 0) {
                dict_out = next;
            } else {
                if (snprintf(data_root, sizeof(data_root), "%s", next) >= (int)sizeof(data_root)) {
                    fprintf(stderr, "[cangwu-ime-cli] --data-root too long\n");
                    return 2;
                }
            }
            continue;
        }

        if (strcmp(arg, "--in") == 0 || strcmp(arg, "--out") == 0 || strcmp(arg, "--from") == 0 ||
            strcmp(arg, "--report") == 0 || strcmp(arg, "--data-root") == 0 || strcmp(arg, "--engine") == 0 ||
            strcmp(arg, "--dict-out") == 0) {
            fprintf(stderr, "[cangwu-ime-cli] missing value for %s\n", arg);
            return 2;
        }

        fprintf(stderr, "[cangwu-ime-cli] unknown convert arg: %s\n", arg);
        return 2;
    }

    if (in_path == NULL || out_path == NULL) {
        fprintf(stderr, "[cangwu-ime-cli] convert requires --in and --out\n");
        return 2;
    }
    if (!file_exists(in_path)) {
        fprintf(stderr, "[cangwu-ime-cli] missing input: %s\n", in_path);
        return 2;
    }

    bool source_ok = false;
    LegacyEncoding source = legacy_encoding_from_text(from, &source_ok);
    if (!source_ok) {
        fprintf(stderr, "[cangwu-ime-cli] invalid --from: %s\n", from != NULL ? from : "");
        return 2;
    }

    bool use_cheng = false;
    bool use_builtin = false;
    if (strcmp(engine, "cheng") == 0) {
        use_cheng = true;
        use_builtin = true;
    } else if (strcmp(engine, "builtin") == 0) {
        use_builtin = true;
    } else if (strcmp(engine, "auto") == 0) {
        use_cheng = true;
        use_builtin = true;
    } else {
        fprintf(stderr, "[cangwu-ime-cli] invalid --engine: %s (want cheng|builtin|auto)\n", engine);
        return 2;
    }
    if (optimize_dict) {
        use_cheng = false;
        use_builtin = true;
    }

    bool require_cheng = str_truthy(getenv("CW_IME_CHENG_REQUIRED"));
    bool cheng_warn = str_truthy(getenv("CW_IME_CHENG_WARN"));
    if (use_cheng) {
        char transcode_bridge[PATH_MAX];
        if (!join_path2(transcode_bridge, sizeof(transcode_bridge), pkg_root,
                        "build/cangwu_ime/bin/utfzh_transcode_bridge")) {
            fprintf(stderr, "[cangwu-ime-cli] transcode bridge path overflow\n");
            return 2;
        }

        if (!file_exists(transcode_bridge)) {
            if (require_cheng || !use_builtin) {
                fprintf(stderr, "[cangwu-ime-cli] missing cheng transcode bridge: %s\n", transcode_bridge);
                return 2;
            }
            if (cheng_warn) {
                fprintf(stderr,
                        "[cangwu-ime-cli] cheng bridge missing, fallback to builtin engine (run src/scripts/cangwu_ime_cli.sh to rebuild)\n");
            }
        } else {
            int cheng_rc = run_cheng_bridge(transcode_bridge, in_path, out_path, from, report, data_root);
            if (cheng_rc == 0) {
                return 0;
            }
            if (require_cheng || !use_builtin) {
                if (cheng_rc == 124) {
                    fprintf(stderr, "[cangwu-ime-cli] cheng engine timeout\n");
                } else {
                    fprintf(stderr, "[cangwu-ime-cli] cheng engine failed: rc=%d\n", cheng_rc);
                }
                return cheng_rc;
            }
            if (cheng_warn) {
                fprintf(stderr, "[cangwu-ime-cli] cheng engine unavailable (rc=%d), fallback to builtin\n", cheng_rc);
            }
        }
    }

    if (!use_builtin) {
        return 2;
    }
    return run_builtin_convert(in_path, out_path, source, report, data_root, optimize_dict, dict_out);
}

static int run_build_assets(int argc, char** argv, const char* pkg_root) {
    char out_dir[PATH_MAX];
    char python[PATH_MAX];
    bool skip_install = false;
    if (!join_path2(out_dir, sizeof(out_dir), pkg_root, "src/ime/data")) {
        fprintf(stderr, "[cangwu-ime-cli] out path overflow\n");
        return 2;
    }
    if (snprintf(python, sizeof(python), "python3") >= (int)sizeof(python)) {
        return 2;
    }

    for (int i = 0; i < argc; i++) {
        const char* arg = argv[i];
        if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
            fprintf(stdout, "用法: cangwu_ime_cli build-assets [--out-dir <path>] [--python <python3>] [--skip-install]\n");
            return 0;
        }
        if (strcmp(arg, "--skip-install") == 0) {
            skip_install = true;
            continue;
        }
        const char* v = parse_flag_value(arg, "--out-dir");
        if (v != NULL) {
            snprintf(out_dir, sizeof(out_dir), "%s", v);
            continue;
        }
        v = parse_flag_value(arg, "--python");
        if (v != NULL) {
            snprintf(python, sizeof(python), "%s", v);
            continue;
        }
        if ((strcmp(arg, "--out-dir") == 0 || strcmp(arg, "--python") == 0) && i + 1 < argc) {
            const char* next = argv[++i];
            if (strcmp(arg, "--out-dir") == 0) {
                snprintf(out_dir, sizeof(out_dir), "%s", next);
            } else {
                snprintf(python, sizeof(python), "%s", next);
            }
            continue;
        }
        if (strcmp(arg, "--out-dir") == 0 || strcmp(arg, "--python") == 0) {
            fprintf(stderr, "[cangwu-ime-cli] missing value for %s\n", arg);
            return 2;
        }
        fprintf(stderr, "[cangwu-ime-cli] unknown build-assets arg: %s\n", arg);
        return 2;
    }

    char gen_ime[PATH_MAX];
    char gen_legacy[PATH_MAX];
    if (!join_path2(gen_ime, sizeof(gen_ime), pkg_root, "src/ime/tools/gen_ime_assets.py") ||
        !join_path2(gen_legacy, sizeof(gen_legacy), pkg_root, "src/ime/tools/gen_legacy_codec_assets.py")) {
        fprintf(stderr, "[cangwu-ime-cli] generator path overflow\n");
        return 1;
    }
    if (!file_exists(gen_ime) || !file_exists(gen_legacy)) {
        fprintf(stderr, "[cangwu-ime-cli] missing generator script\n");
        return 1;
    }

    char* dep_check[] = {python, "-c", "import rdata,pandas", NULL};
    int rc = spawn_wait(dep_check);
    if (rc != 0) {
        if (skip_install) {
            fprintf(stderr, "[cangwu-ime-cli] python deps missing and --skip-install is set\n");
            return 1;
        }
        char* install[] = {python, "-m", "pip", "install", "--user", "rdata", "pandas", NULL};
        rc = spawn_wait(install);
        if (rc != 0) {
            return rc;
        }
    }

    char* gen1[] = {python, gen_ime, "--out-dir", out_dir, NULL};
    rc = spawn_wait(gen1);
    if (rc != 0) {
        return rc;
    }
    char* gen2[] = {python, gen_legacy, "--out-dir", out_dir, NULL};
    rc = spawn_wait(gen2);
    if (rc != 0) {
        return rc;
    }

    char dict_path[PATH_MAX];
    char gbk_path[PATH_MAX];
    char gb2312_path[PATH_MAX];
    if (!join_path2(dict_path, sizeof(dict_path), out_dir, "utfzh_dict_v1.tsv") ||
        !join_path2(gbk_path, sizeof(gbk_path), out_dir, "legacy_gbk_to_u_v1.tsv") ||
        !join_path2(gb2312_path, sizeof(gb2312_path), out_dir, "legacy_gb2312_to_u_v1.tsv")) {
        return 1;
    }
    int dict_lines = line_count(dict_path);
    int gbk_lines = line_count(gbk_path);
    int gb2312_lines = line_count(gb2312_path);
    if (dict_lines != UTFZH_DICT_EXPECTED_COUNT) {
        fprintf(stderr, "[cangwu-ime-cli] dict line count mismatch: %d (want %d)\n", dict_lines,
                UTFZH_DICT_EXPECTED_COUNT);
        return 1;
    }
    if (gbk_lines <= 0 || gb2312_lines <= 0) {
        fprintf(stderr, "[cangwu-ime-cli] legacy map is empty\n");
        return 1;
    }
    return 0;
}

static int run_verify(int argc, char** argv, const char* pkg_root) {
    char impl_path[PATH_MAX];
    if (!join_path2(impl_path, sizeof(impl_path), pkg_root, "src/scripts/verify_cangwu_ime_impl.sh")) {
        return 2;
    }

    int start = 0;
    for (int i = 0; i < argc; i++) {
        const char* arg = argv[i];
        if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
            fprintf(stdout, "用法: cangwu_ime_cli verify [--impl <path>] [-- <extra args>]\n");
            return 0;
        }
        const char* v = parse_flag_value(arg, "--impl");
        if (v != NULL) {
            snprintf(impl_path, sizeof(impl_path), "%s", v);
            continue;
        }
        if (strcmp(arg, "--impl") == 0 && i + 1 < argc) {
            snprintf(impl_path, sizeof(impl_path), "%s", argv[++i]);
            continue;
        }
        if (strcmp(arg, "--impl") == 0) {
            fprintf(stderr, "[cangwu-ime-cli] missing value for --impl\n");
            return 2;
        }
        if (strcmp(arg, "--") == 0) {
            start = i + 1;
            break;
        }
    }

    if (!file_exists(impl_path)) {
        fprintf(stderr, "[cangwu-ime-cli] missing verify implementation script: %s\n", impl_path);
        return 2;
    }

    int passthrough = argc - start;
    if (start == 0) {
        passthrough = 0;
    }
    char** cmdv = (char**)calloc((size_t)passthrough + 4u, sizeof(char*));
    if (cmdv == NULL) {
        return 127;
    }
    int n = 0;
    cmdv[n++] = "bash";
    cmdv[n++] = impl_path;
    if (start > 0) {
        for (int i = start; i < argc; i++) {
            cmdv[n++] = argv[i];
        }
    } else {
        for (int i = 0; i < argc; i++) {
            if (strcmp(argv[i], "--") == 0) {
                continue;
            }
            if (starts_with(argv[i], "--impl") || strcmp(argv[i], "--impl") == 0) {
                if (strcmp(argv[i], "--impl") == 0) {
                    i++;
                }
                continue;
            }
            cmdv[n++] = argv[i];
        }
    }
    cmdv[n] = NULL;
    int rc = spawn_wait(cmdv);
    free(cmdv);
    return rc;
}

int cw_native_cli_run(int argc, char** argv, const char* pkg_root_override) {
    const char* pkg_root = pkg_root_override;
    char pkg_root_guess[PATH_MAX];
    pkg_root_guess[0] = '\0';
    if (pkg_root == NULL || pkg_root[0] == '\0') {
        pkg_root = getenv("CW_IME_PKG_ROOT");
    }
    if ((pkg_root == NULL || pkg_root[0] == '\0') && argc > 0 && argv != NULL) {
        if (derive_pkg_root_from_argv0(argv[0], pkg_root_guess, sizeof(pkg_root_guess))) {
            pkg_root = pkg_root_guess;
        }
    }
    if (pkg_root == NULL || pkg_root[0] == '\0') {
        fprintf(stderr, "[cangwu-ime-cli] missing CW_IME_PKG_ROOT\n");
        return 2;
    }

    const char* invoked = base_name(argv != NULL ? argv[0] : "");
    if (strcmp(invoked, "convert_to_utfzh") == 0) {
        return run_convert(argc - 1, argv + 1, pkg_root);
    }
    if (strcmp(invoked, "build_cangwu_assets") == 0) {
        return run_build_assets(argc - 1, argv + 1, pkg_root);
    }
    if (strcmp(invoked, "verify_cangwu_ime") == 0) {
        return run_verify(argc - 1, argv + 1, pkg_root);
    }

    if (argc <= 1) {
        cli_usage();
        return 2;
    }

    const char* sub = argv[1];
    if (strcmp(sub, "help") == 0 || strcmp(sub, "--help") == 0 || strcmp(sub, "-h") == 0) {
        cli_usage();
        return 0;
    }
    if (strcmp(sub, "convert") == 0) {
        return run_convert(argc - 2, argv + 2, pkg_root);
    }
    if (strcmp(sub, "build-assets") == 0) {
        return run_build_assets(argc - 2, argv + 2, pkg_root);
    }
    if (strcmp(sub, "verify") == 0) {
        return run_verify(argc - 2, argv + 2, pkg_root);
    }
    fprintf(stderr, "[cangwu-ime-cli] unknown subcommand: %s\n", sub);
    cli_usage();
    return 2;
}

#ifndef CW_IME_NATIVE_CORE_NO_MAIN
int main(int argc, char** argv) {
    return cw_native_cli_run(argc, argv, NULL);
}
#endif
