#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void __cheng_global_init(void);
void __cheng_setCmdLine(int32_t argc, void* argv);
int32_t cwUtfzhTranscodeEnvRun(void);
int32_t cwUtfzhPing(void);
int32_t cwUtfzhProbeEnvLen(void);
int32_t cwUtfzhProbeFileExists(void);
int32_t cwUtfzhProbeReadLen(void);
int32_t cwUtfzhProbeDictFileExists(void);
int32_t cwUtfzhProbeDictReadLen(void);
int32_t cwUtfzhProbeDictNoMapLen(void);
int32_t cwUtfzhProbeDictLen(void);

static const char* g_utfzh_in = "";
static const char* g_utfzh_out = "";
static const char* g_utfzh_from = "auto";
static const char* g_utfzh_report = "";
static const char* g_utfzh_data_root = "src/ime/data";
static int g_debug = 0;

int32_t cw_utfzh_bridge_enabled(void) {
    return 0;
}

static const char* cw_utfzh_bridge_slot_value(int32_t slot) {
    switch (slot) {
        case 0:
            return g_utfzh_in != NULL ? g_utfzh_in : "";
        case 1:
            return g_utfzh_out != NULL ? g_utfzh_out : "";
        case 2:
            return g_utfzh_from != NULL ? g_utfzh_from : "auto";
        case 3:
            return g_utfzh_report != NULL ? g_utfzh_report : "";
        case 4:
            return g_utfzh_data_root != NULL ? g_utfzh_data_root : "src/ime/data";
        default:
            return "";
    }
}

int32_t cw_utfzh_bridge_len(int32_t slot) {
    const char* text = cw_utfzh_bridge_slot_value(slot);
    if (g_debug) {
        fprintf(stderr, "[utfzh-bridge] len slot=%d ptr=%p\n", (int)slot, (void*)text);
        fflush(stderr);
    }
    return text != NULL ? (int32_t)strlen(text) : 0;
}

int32_t cw_utfzh_bridge_byte(int32_t slot, int32_t idx) {
    const char* text = cw_utfzh_bridge_slot_value(slot);
    if (g_debug && idx < 4) {
        fprintf(stderr, "[utfzh-bridge] byte slot=%d idx=%d ptr=%p\n", (int)slot, (int)idx, (void*)text);
        fflush(stderr);
    }
    if (text == NULL || idx < 0) {
        return -1;
    }
    size_t n = strlen(text);
    if ((size_t)idx >= n) {
        return -1;
    }
    return (int32_t)((unsigned char)text[idx]);
}

static const char* env_or_default(const char* key, const char* fallback) {
    const char* v = getenv(key);
    if (v == NULL || v[0] == '\0') {
        return fallback;
    }
    return v;
}

static const char* base_name(const char* path) {
    if (path == NULL) {
        return "";
    }
    const char* last = strrchr(path, '/');
    return last != NULL ? last + 1 : path;
}

static int starts_with(const char* text, const char* prefix) {
    size_t n = strlen(prefix);
    return strncmp(text, prefix, n) == 0;
}

static const char* parse_inline_value(const char* arg, const char* key) {
    size_t n = strlen(key);
    if (starts_with(arg, key) && arg[n] == ':') {
        return arg + n + 1;
    }
    if (starts_with(arg, key) && arg[n] == '=') {
        return arg + n + 1;
    }
    return NULL;
}

static void usage(const char* program) {
    const char* name = (program != NULL && program[0] != '\0') ? program : "convert_to_utfzh";
    fprintf(stdout, "用法: %s --in <input> --out <output> [--from auto|utf8|utf16le|utf16be|gbk|gb2312] [--report <path>] [--data-root <path>]\n", name);
}

static int parse_cli(int argc, char** argv, int start_index) {
    for (int i = start_index; i < argc; ++i) {
        const char* arg = argv[i];
        if (arg == NULL) {
            continue;
        }
        if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
            usage(base_name(argv[0]));
            return 0;
        }

        const char* v = NULL;

        v = parse_inline_value(arg, "--in");
        if (v != NULL) {
            g_utfzh_in = v;
            continue;
        }
        if (strcmp(arg, "--in") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "[convert_to_utfzh] missing value for --in\n");
                return 2;
            }
            g_utfzh_in = argv[++i];
            continue;
        }

        v = parse_inline_value(arg, "--out");
        if (v != NULL) {
            g_utfzh_out = v;
            continue;
        }
        if (strcmp(arg, "--out") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "[convert_to_utfzh] missing value for --out\n");
                return 2;
            }
            g_utfzh_out = argv[++i];
            continue;
        }

        v = parse_inline_value(arg, "--from");
        if (v != NULL) {
            g_utfzh_from = v;
            continue;
        }
        if (strcmp(arg, "--from") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "[convert_to_utfzh] missing value for --from\n");
                return 2;
            }
            g_utfzh_from = argv[++i];
            continue;
        }

        v = parse_inline_value(arg, "--report");
        if (v != NULL) {
            g_utfzh_report = v;
            continue;
        }
        if (strcmp(arg, "--report") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "[convert_to_utfzh] missing value for --report\n");
                return 2;
            }
            g_utfzh_report = argv[++i];
            continue;
        }

        v = parse_inline_value(arg, "--data-root");
        if (v != NULL) {
            g_utfzh_data_root = v;
            continue;
        }
        if (strcmp(arg, "--data-root") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "[convert_to_utfzh] missing value for --data-root\n");
                return 2;
            }
            g_utfzh_data_root = argv[++i];
            continue;
        }

        fprintf(stderr, "[convert_to_utfzh] unknown arg: %s\n", arg);
        return 2;
    }

    if (g_utfzh_in == NULL || g_utfzh_in[0] == '\0' || g_utfzh_out == NULL || g_utfzh_out[0] == '\0') {
        usage(base_name(argv[0]));
        return 2;
    }
    return -1;
}

int main(int argc, char** argv) {
    g_utfzh_in = env_or_default("UTFZH_IN", "");
    g_utfzh_out = env_or_default("UTFZH_OUT", "");
    g_utfzh_from = env_or_default("UTFZH_FROM", "auto");
    g_utfzh_report = env_or_default("UTFZH_REPORT", "");
    g_utfzh_data_root = env_or_default("UTFZH_DATA_ROOT", "src/ime/data");
    g_debug = (getenv("UTFZH_DEBUG") != NULL && strcmp(getenv("UTFZH_DEBUG"), "1") == 0) ? 1 : 0;

    int start_index = 1;
    const char* invoked = base_name(argc > 0 ? argv[0] : "");
    if (strcmp(invoked, "cangwu_ime_cli") == 0) {
        if (argc > 1 && strcmp(argv[1], "convert") == 0) {
            start_index = 2;
        } else if (argc > 1 && (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0 || strcmp(argv[1], "help") == 0)) {
            usage(invoked);
            return 0;
        } else if (argc > 1) {
            fprintf(stderr, "[cangwu_ime_cli] only convert subcommand is supported in this binary\n");
            return 2;
        }
    }

    int parse_rc = parse_cli(argc, argv, start_index);
    if (parse_rc >= 0) {
        return parse_rc;
    }
    if (g_debug) {
        fprintf(stderr, "[utfzh-bridge] in=%s out=%s from=%s report=%s dataRoot=%s\n",
                g_utfzh_in, g_utfzh_out, g_utfzh_from, g_utfzh_report, g_utfzh_data_root);
        fflush(stderr);
    }

    setenv("UTFZH_IN", g_utfzh_in != NULL ? g_utfzh_in : "", 1);
    setenv("UTFZH_OUT", g_utfzh_out != NULL ? g_utfzh_out : "", 1);
    setenv("UTFZH_FROM", g_utfzh_from != NULL ? g_utfzh_from : "auto", 1);
    setenv("UTFZH_REPORT", g_utfzh_report != NULL ? g_utfzh_report : "", 1);
    setenv("UTFZH_DATA_ROOT", g_utfzh_data_root != NULL ? g_utfzh_data_root : "src/ime/data", 1);

    __cheng_global_init();
    __cheng_setCmdLine((int32_t)argc, (void*)argv);
    if (g_debug) {
        fprintf(stderr, "[utfzh-bridge] ping=%d\n", (int)cwUtfzhPing());
        fprintf(stderr, "[utfzh-bridge] probe env_len=%d\n", (int)cwUtfzhProbeEnvLen());
        fflush(stderr);
        fprintf(stderr, "[utfzh-bridge] probe file_exists=%d\n", (int)cwUtfzhProbeFileExists());
        fflush(stderr);
        fprintf(stderr, "[utfzh-bridge] probe read_len=%d\n", (int)cwUtfzhProbeReadLen());
        fflush(stderr);
        fprintf(stderr, "[utfzh-bridge] probe dict_file_exists=%d\n", (int)cwUtfzhProbeDictFileExists());
        fflush(stderr);
        fprintf(stderr, "[utfzh-bridge] probe dict_read_len=%d\n", (int)cwUtfzhProbeDictReadLen());
        fflush(stderr);
        fprintf(stderr, "[utfzh-bridge] probe dict_nomap_len=%d\n", (int)cwUtfzhProbeDictNoMapLen());
        fflush(stderr);
        fprintf(stderr, "[utfzh-bridge] probe dict_len=%d\n", (int)cwUtfzhProbeDictLen());
        fflush(stderr);
    }
    int32_t rc = cwUtfzhTranscodeEnvRun();
    if (rc == 0) {
        fprintf(stdout, "[convert_to_utfzh] ok\n");
        fprintf(stdout, "  in=%s\n", g_utfzh_in);
        fprintf(stdout, "  out=%s\n", g_utfzh_out);
        fprintf(stdout, "  from=%s\n", g_utfzh_from);
        if (g_utfzh_report != NULL && g_utfzh_report[0] != '\0') {
            fprintf(stdout, "  report=%s\n", g_utfzh_report);
        }
    } else {
        fprintf(stderr, "[convert_to_utfzh] failed rc=%d\n", (int)rc);
    }
    return (int)rc;
}
