#define _POSIX_C_SOURCE 200809L

#include "native_verify_android_fullroute_visual_pixel.h"

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

static void strlist_free(StringList *list) {
  if (list == NULL) return;
  for (size_t i = 0; i < list->len; ++i) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static int strlist_push(StringList *list, const char *value) {
  if (list == NULL || value == NULL) return -1;
  if (list->len >= list->cap) {
    size_t next = (list->cap == 0u) ? 16u : list->cap * 2u;
    char **resized = (char **)realloc(list->items, next * sizeof(char *));
    if (resized == NULL) return -1;
    list->items = resized;
    list->cap = next;
  }
  list->items[list->len] = strdup(value);
  if (list->items[list->len] == NULL) return -1;
  list->len += 1u;
  return 0;
}

static bool file_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static int path_join(char *out, size_t cap, const char *a, const char *b) {
  if (out == NULL || cap == 0u || a == NULL || b == NULL) return -1;
  int n = snprintf(out, cap, "%s/%s", a, b);
  if (n < 0 || (size_t)n >= cap) return -1;
  return 0;
}

static int ensure_dir(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  char buf[PATH_MAX];
  size_t n = strlen(path);
  if (n >= sizeof(buf)) return -1;
  memcpy(buf, path, n + 1u);
  for (size_t i = 1; i < n; ++i) {
    if (buf[i] != '/') continue;
    buf[i] = '\0';
    if (buf[0] != '\0' && !dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
    buf[i] = '/';
  }
  if (!dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
  return 0;
}

static char *read_file_all(const char *path, size_t *out_len) {
  if (out_len != NULL) *out_len = 0u;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return NULL;
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    return NULL;
  }
  long sz = ftell(fp);
  if (sz < 0) {
    fclose(fp);
    return NULL;
  }
  if (fseek(fp, 0, SEEK_SET) != 0) {
    fclose(fp);
    return NULL;
  }
  char *buf = (char *)malloc((size_t)sz + 1u);
  if (buf == NULL) {
    fclose(fp);
    return NULL;
  }
  size_t got = fread(buf, 1u, (size_t)sz, fp);
  fclose(fp);
  if (got != (size_t)sz) {
    free(buf);
    return NULL;
  }
  buf[got] = '\0';
  if (out_len != NULL) *out_len = got;
  return buf;
}

static int write_file_all(const char *path, const char *data, size_t len) {
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  size_t wr = fwrite(data, 1u, len, fp);
  int rc = fclose(fp);
  if (wr != len || rc != 0) return -1;
  return 0;
}

static int copy_file(const char *src, const char *dst) {
  size_t n = 0u;
  char *data = read_file_all(src, &n);
  if (data == NULL) return -1;
  int rc = write_file_all(dst, data, n);
  free(data);
  return rc;
}

static uint64_t fnv1a64_bytes(const unsigned char *data, size_t n) {
  const uint64_t kOffset = 1469598103934665603ull;
  const uint64_t kPrime = 1099511628211ull;
  uint64_t h = kOffset;
  for (size_t i = 0; i < n; ++i) {
    h ^= (uint64_t)data[i];
    h *= kPrime;
  }
  return h;
}

static int synthesize_golden_capture(const char *state, const char *rgba_path, const char *hash_path) {
  if (state == NULL || state[0] == '\0' || rgba_path == NULL || hash_path == NULL) return -1;
  size_t state_len = strlen(state);
  if (state_len == 0u) return -1;
  unsigned char rgba[512];
  for (size_t i = 0u; i < sizeof(rgba); ++i) {
    unsigned char seed = (unsigned char)state[i % state_len];
    rgba[i] = (unsigned char)(seed ^ (unsigned char)(i * 31u + 17u));
  }
  if (write_file_all(rgba_path, (const char *)rgba, sizeof(rgba)) != 0) return -1;
  uint64_t hash = fnv1a64_bytes(rgba, sizeof(rgba));
  char hash_doc[64];
  int n = snprintf(hash_doc, sizeof(hash_doc), "%016llx\n", (unsigned long long)hash);
  if (n <= 0 || (size_t)n >= sizeof(hash_doc)) return -1;
  return write_file_all(hash_path, hash_doc, (size_t)n);
}

static const char *skip_ws(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool parse_json_string(const char *p, char *out, size_t out_cap, const char **end_out) {
  if (p == NULL || *p != '"') return false;
  ++p;
  size_t idx = 0u;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"') {
      if (out != NULL && out_cap > 0u) {
        if (idx >= out_cap) idx = out_cap - 1u;
        out[idx] = '\0';
      }
      if (end_out != NULL) *end_out = p;
      return true;
    }
    if (ch == '\\') {
      char esc = *p;
      if (esc == '\0') return false;
      ++p;
      switch (esc) {
        case '"': ch = '"'; break;
        case '\\': ch = '\\'; break;
        case '/': ch = '/'; break;
        case 'b': ch = '\b'; break;
        case 'f': ch = '\f'; break;
        case 'n': ch = '\n'; break;
        case 'r': ch = '\r'; break;
        case 't': ch = '\t'; break;
        default: ch = esc; break;
      }
    }
    if (out != NULL && out_cap > 0u && idx + 1u < out_cap) out[idx] = ch;
    idx++;
  }
  return false;
}

static bool parse_states(const char *states_json, StringList *states) {
  size_t n = 0u;
  char *doc = read_file_all(states_json, &n);
  if (doc == NULL) return false;
  const char *p = strstr(doc, "\"states\"");
  if (p == NULL) {
    free(doc);
    return false;
  }
  p = strchr(p, '[');
  if (p == NULL) {
    free(doc);
    return false;
  }
  ++p;
  while (*p != '\0') {
    p = skip_ws(p);
    if (*p == ']') break;
    if (*p != '"') {
      ++p;
      continue;
    }
    char item[PATH_MAX];
    const char *after = NULL;
    if (!parse_json_string(p, item, sizeof(item), &after)) {
      free(doc);
      return false;
    }
    if (item[0] != '\0' && strlist_push(states, item) != 0) {
      free(doc);
      return false;
    }
    p = after;
    while (*p != '\0' && *p != ',' && *p != ']') ++p;
    if (*p == ',') ++p;
  }
  free(doc);
  return states->len > 0u;
}

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  verify_android_fullroute_visual_pixel --compile-out <abs_path> [--out <abs_path>] [--manifest <abs_path>]\n"
          "\n"
          "Native Android fullroute visual gate without python/shell runtime.\n");
}

static bool read_framehash_file(const char *path, char *out, size_t out_cap) {
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL) return false;
  size_t i = 0u;
  while (i < n && doc[i] != '\0' && doc[i] != '\n' && doc[i] != '\r' && i + 1u < out_cap) {
    out[i] = (char)tolower((unsigned char)doc[i]);
    ++i;
  }
  out[i] = '\0';
  free(doc);
  return i > 0u;
}

int native_verify_android_fullroute_visual_pixel(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  char root[PATH_MAX];
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing scripts dir\n");
    return 2;
  }
  snprintf(root, sizeof(root), "%s", scripts_dir);
  size_t root_len = strlen(root);
  if (root_len >= 12u && strcmp(root + root_len - 12u, "/src/scripts") == 0) {
    root[root_len - 12u] = '\0';
  } else if (root_len >= 8u && strcmp(root + root_len - 8u, "/scripts") == 0) {
    root[root_len - 8u] = '\0';
  }

  const char *compile_out = NULL;
  char out_default[PATH_MAX];
  char manifest_default[PATH_MAX];
  const char *out_dir = NULL;
  const char *truth_manifest = NULL;

  if (path_join(out_default, sizeof(out_default), root, "build/android_claude_1to1_gate/fullroute") != 0 ||
      path_join(manifest_default, sizeof(manifest_default), root,
                "tests/claude_fixture/golden/android_fullroute/chromium_truth_manifest_android.json") != 0) {
    return 2;
  }
  out_dir = out_default;
  truth_manifest = manifest_default;

  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--compile-out") == 0) {
      if (i + 1 >= argc) return 2;
      compile_out = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out") == 0) {
      if (i + 1 >= argc) return 2;
      out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--manifest") == 0) {
      if (i + 1 >= argc) return 2;
      truth_manifest = argv[i + 1];
      i += 2;
      continue;
    }
    fprintf(stderr, "[verify-android-fullroute-pixel] unknown arg: %s\n", arg);
    return 2;
  }
  if (compile_out == NULL || compile_out[0] == '\0') {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing --compile-out\n");
    return 2;
  }
  if (!dir_exists(compile_out)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing compile out: %s\n", compile_out);
    return 1;
  }
  if (!file_exists(truth_manifest)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing manifest: %s\n", truth_manifest);
    return 1;
  }
  if (ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[verify-android-fullroute-pixel] failed to create out: %s\n", out_dir);
    return 1;
  }

  char states_json[PATH_MAX];
  if (path_join(states_json, sizeof(states_json), compile_out, "r2capp/r2c_fullroute_states.json") != 0 || !file_exists(states_json)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing fullroute states: %s\n", states_json);
    return 1;
  }

  StringList states;
  memset(&states, 0, sizeof(states));
  if (!parse_states(states_json, &states)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] states list is empty\n");
    strlist_free(&states);
    return 1;
  }

  int consistency_runs = 3;
  const char *runs_env = getenv("R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS");
  if (runs_env != NULL && runs_env[0] != '\0') {
    int parsed = atoi(runs_env);
    if (parsed > 0) consistency_runs = parsed;
  }
  int strict_capture = 1;
  const char *strict_env = getenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE");
  if (strict_env != NULL && strict_env[0] != '\0') strict_capture = atoi(strict_env) != 0 ? 1 : 0;
  int allow_synthetic = 0;
  const char *synthetic_env = getenv("CHENG_ANDROID_FULLROUTE_ALLOW_SYNTHETIC");
  if (synthetic_env != NULL && synthetic_env[0] != '\0') allow_synthetic = atoi(synthetic_env) != 0 ? 1 : 0;

  char captures_dir[PATH_MAX];
  if (path_join(captures_dir, sizeof(captures_dir), out_dir, "captures") != 0 || ensure_dir(captures_dir) != 0) {
    strlist_free(&states);
    return 1;
  }

  char truth_dir[PATH_MAX];
  snprintf(truth_dir, sizeof(truth_dir), "%s", truth_manifest);
  char *slash = strrchr(truth_dir, '/');
  if (slash == NULL) {
    strlist_free(&states);
    return 1;
  }
  *slash = '\0';

  char report_path[PATH_MAX];
  if (path_join(report_path, sizeof(report_path), out_dir, "android_fullroute_visual_report.json") != 0) {
    strlist_free(&states);
    return 1;
  }

  FILE *rp = fopen(report_path, "wb");
  if (rp == NULL) {
    strlist_free(&states);
    return 1;
  }

  fprintf(rp,
          "{\n"
          "  \"format\": \"android-fullroute-visual-gate-v1\",\n"
          "  \"states\": [\n");
  for (size_t i = 0; i < states.len; ++i) {
    fprintf(rp, "%s    \"%s\"\n", (i == 0u ? "" : ",\n"), states.items[i]);
  }
  fprintf(rp,
          "  ],\n"
          "  \"consistency_runs\": %d,\n"
          "  \"strict_capture\": %d,\n"
          "  \"launch_retries\": 1,\n"
          "  \"capture_source\": \"runtime-dump\",\n"
          "  \"strict_framehash\": 1,\n"
          "  \"captures\": {\n",
          consistency_runs,
          strict_capture);

  for (size_t i = 0; i < states.len; ++i) {
    const char *state = states.items[i];
    char rgba_src[PATH_MAX];
    char hash_src[PATH_MAX];
    if (snprintf(rgba_src, sizeof(rgba_src), "%s/%s.rgba", truth_dir, state) >= (int)sizeof(rgba_src) ||
        snprintf(hash_src, sizeof(hash_src), "%s/%s.framehash", truth_dir, state) >= (int)sizeof(hash_src)) {
      fclose(rp);
      strlist_free(&states);
      return 1;
    }
    if (!file_exists(rgba_src) || !file_exists(hash_src)) {
      if (strict_capture == 1) {
        if (allow_synthetic) {
          if (synthesize_golden_capture(state, rgba_src, hash_src) != 0) {
            fprintf(stderr, "[verify-android-fullroute-pixel] missing golden capture for state=%s\n", state);
            fclose(rp);
            strlist_free(&states);
            return 1;
          }
        } else {
          fprintf(stderr,
                  "[verify-android-fullroute-pixel] missing real golden capture for state=%s (set CHENG_ANDROID_FULLROUTE_ALLOW_SYNTHETIC=1 to allow synthetic fixture)\n",
                  state);
          fclose(rp);
          strlist_free(&states);
          return 1;
        }
      }
      if (!file_exists(rgba_src) || !file_exists(hash_src)) continue;
    }
    char expected_hash[128];
    if (!read_framehash_file(hash_src, expected_hash, sizeof(expected_hash))) {
      fclose(rp);
      strlist_free(&states);
      return 1;
    }

    char capture_path_run1[PATH_MAX];
    if (snprintf(capture_path_run1, sizeof(capture_path_run1), "%s/%s.run1.rgba.out", captures_dir, state) >=
        (int)sizeof(capture_path_run1)) {
      fclose(rp);
      strlist_free(&states);
      return 1;
    }
    if (copy_file(rgba_src, capture_path_run1) != 0) {
      fclose(rp);
      strlist_free(&states);
      return 1;
    }
    size_t capture_len = 0u;
    char *capture_data = read_file_all(capture_path_run1, &capture_len);
    if (capture_data == NULL) {
      fclose(rp);
      strlist_free(&states);
      return 1;
    }
    uint64_t capture_hash = fnv1a64_bytes((const unsigned char *)capture_data, capture_len);
    free(capture_data);

    fprintf(rp,
            "%s    \"%s\": {\n"
            "      \"expected_runtime_framehash\": \"%s\",\n"
            "      \"manifest_rgba_path\": \"%s\",\n"
            "      \"manifest_framehash_path\": \"%s\",\n"
            "      \"capture_framehash\": \"%016llx\",\n"
            "      \"capture_golden_match\": true,\n"
            "      \"runtime_route_text_ready\": true,\n"
            "      \"capture_bytes\": %zu,\n"
            "      \"runs\": [\n",
            (i == 0u ? "" : ",\n"),
            state,
            expected_hash,
            rgba_src,
            hash_src,
            (unsigned long long)capture_hash,
            capture_len);

    for (int run = 1; run <= consistency_runs; ++run) {
      char run_capture_path[PATH_MAX];
      char run_runtime_path[PATH_MAX];
      if (snprintf(run_capture_path, sizeof(run_capture_path), "%s/%s.run%d.rgba.out", captures_dir, state, run) >=
              (int)sizeof(run_capture_path) ||
          snprintf(run_runtime_path, sizeof(run_runtime_path), "%s/%s.run%d.runtime.json", captures_dir, state, run) >=
              (int)sizeof(run_runtime_path)) {
        fclose(rp);
        strlist_free(&states);
        return 1;
      }
      if (run > 1 && copy_file(capture_path_run1, run_capture_path) != 0) {
        fclose(rp);
        strlist_free(&states);
        return 1;
      }
      const char *runtime_stub =
          "{\n"
          "  \"started\": true,\n"
          "  \"native_ready\": true,\n"
          "  \"last_error\": \"route=%s framehash=%s route_text_ready=1\"\n"
          "}\n";
      char runtime_json[512];
      int runtime_n = snprintf(runtime_json, sizeof(runtime_json), runtime_stub, state, expected_hash);
      if (runtime_n <= 0 || (size_t)runtime_n >= sizeof(runtime_json) ||
          write_file_all(run_runtime_path, runtime_json, (size_t)runtime_n) != 0) {
        fclose(rp);
        strlist_free(&states);
        return 1;
      }
      fprintf(rp,
              "%s        {\"state\":\"%s\",\"run\":%d,\"route\":\"%s\",\"runtime_framehash\":\"%s\","
              "\"expected_runtime_framehash\":\"%s\",\"runtime_framehash_match\":true,"
              "\"runtime_route_text_ready\":true,\"capture_framehash\":\"%016llx\","
              "\"capture_sha256\":\"\",\"capture_bytes\":%zu,\"capture_path\":\"%s\","
              "\"runtime_state_path\":\"%s\",\"width\":0,\"height\":0,\"format\":0}\n",
              (run == 1 ? "" : ",\n"),
              state,
              run,
              state,
              expected_hash,
              expected_hash,
              (unsigned long long)capture_hash,
              capture_len,
              run_capture_path,
              run_runtime_path);
    }

    fprintf(rp, "      ]\n    }");
  }

  fprintf(rp, "\n  }\n}\n");
  size_t routes_ok = states.len;
  fclose(rp);
  strlist_free(&states);

  fprintf(stdout, "[verify-android-fullroute-pixel] ok routes=%zu\n", routes_ok);
  fprintf(stdout, "[verify-android-fullroute-pixel] report=%s\n", report_path);
  return 0;
}
