#define _POSIX_C_SOURCE 200809L

#include "native_verify_android_fullroute_visual_pixel.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

typedef struct {
  char name[128];
  char framehash[128];
  char rgba_sha256[128];
  long long rgba_bytes;
  char rgba_path[PATH_MAX];
  char framehash_path[PATH_MAX];
} TruthState;

typedef struct {
  TruthState *items;
  size_t len;
  size_t cap;
} TruthStateList;

typedef struct {
  bool started;
  bool native_ready;
  bool render_ready;
  bool semantic_nodes_loaded;
  long long semantic_nodes_applied_count;
  char route[128];
  char framehash[128];
  int semantic_total_count;
  char semantic_total_hash[64];
  int semantic_applied_count;
  char semantic_applied_hash[64];
  int semantic_ready;
  char launch_args_kv[4096];
  char last_error[4096];
} RuntimeSnapshot;

typedef struct {
  char state[128];
  int run;
  char route[128];
  char runtime_framehash[64];
  char expected_runtime_framehash[64];
  bool runtime_framehash_match;
  bool runtime_reported_framehash_match_capture;
  bool runtime_route_match;
  bool runtime_render_ready;
  bool runtime_semantic_nodes_loaded;
  int runtime_semantic_nodes_applied_count;
  bool runtime_semantic_ready;
  int runtime_semantic_total_count;
  char runtime_semantic_total_hash[64];
  int runtime_semantic_applied_count;
  char runtime_semantic_applied_hash[64];
  char capture_framehash[64];
  size_t capture_bytes;
  char capture_path[PATH_MAX];
  char runtime_state_path[PATH_MAX];
  int width;
  int height;
  int format;
} RunRow;

typedef struct {
  int x;
  int y;
  int w;
  int h;
} Rect;

typedef enum {
  ROUTE_ACTION_INVALID = 0,
  ROUTE_ACTION_LAUNCH_MAIN,
  ROUTE_ACTION_SLEEP_MS,
  ROUTE_ACTION_TAP_PPM,
  ROUTE_ACTION_KEYEVENT,
} RouteActionType;

typedef struct {
  RouteActionType type;
  int v0;
  int v1;
} RouteAction;

typedef struct {
  RouteAction *items;
  size_t len;
  size_t cap;
} RouteActionList;

typedef struct {
  const char *adb;
  const char *serial;
  const char *runtime_package;
  const char *runtime_activity;
  const char *manifest_json;
  const char *route_actions_path;
  const StringList *states;
  const char *capture_dir;
  const char *capture_source;
  int strict_framehash;
  int strict_semantic_hash;
  int strict_runtime_ready;
  int wait_ms;
  int expected_semantic_total_count;
  const char *expected_semantic_total_hash;
} LaunchContext;

static void strlist_free(StringList *list) {
  if (list == NULL) return;
  for (size_t i = 0u; i < list->len; ++i) {
    free(list->items[i]);
  }
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

static void truth_list_free(TruthStateList *list) {
  if (list == NULL) return;
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static int truth_list_push(TruthStateList *list, const TruthState *row) {
  if (list == NULL || row == NULL) return -1;
  if (list->len >= list->cap) {
    size_t next = (list->cap == 0u) ? 16u : list->cap * 2u;
    TruthState *resized = (TruthState *)realloc(list->items, next * sizeof(TruthState));
    if (resized == NULL) return -1;
    list->items = resized;
    list->cap = next;
  }
  list->items[list->len] = *row;
  list->len += 1u;
  return 0;
}

static void route_action_list_free(RouteActionList *list) {
  if (list == NULL) return;
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static int route_action_list_push(RouteActionList *list, RouteAction action) {
  if (list == NULL) return -1;
  if (list->len >= list->cap) {
    size_t next = (list->cap == 0u) ? 16u : (list->cap * 2u);
    RouteAction *resized = (RouteAction *)realloc(list->items, next * sizeof(RouteAction));
    if (resized == NULL) return -1;
    list->items = resized;
    list->cap = next;
  }
  list->items[list->len] = action;
  list->len += 1u;
  return 0;
}

static const TruthState *truth_list_find(const TruthStateList *list, const char *name) {
  if (list == NULL || name == NULL || name[0] == '\0') return NULL;
  for (size_t i = 0u; i < list->len; ++i) {
    if (strcmp(list->items[i].name, name) == 0) return &list->items[i];
  }
  return NULL;
}

static bool starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
}

static bool env_flag_enabled(const char *name, bool fallback) {
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return fallback;
  return strcmp(raw, "0") != 0;
}

static const char *infer_main_activity_for_package(const char *pkg, char *buf, size_t buf_cap) {
  if (pkg == NULL || pkg[0] == '\0') return "com.unimaker.app/.MainActivity";
  if (strcmp(pkg, "com.unimaker.app") == 0) return "com.unimaker.app/.MainActivity";
  if (strcmp(pkg, "com.cheng.mobile") == 0) return "com.cheng.mobile/.ChengActivity";
  if (buf != NULL && buf_cap > 0u) {
    int n = snprintf(buf, buf_cap, "%s/.MainActivity", pkg);
    if (n > 0 && (size_t)n < buf_cap) return buf;
  }
  return "com.unimaker.app/.MainActivity";
}

static bool ends_with(const char *s, const char *suffix) {
  if (s == NULL || suffix == NULL) return false;
  size_t sn = strlen(s);
  size_t pn = strlen(suffix);
  if (sn < pn) return false;
  return strcmp(s + sn - pn, suffix) == 0;
}

static bool file_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool path_executable(const char *path) {
  return (path != NULL && access(path, X_OK) == 0);
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
  for (size_t i = 1u; i < n; ++i) {
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

static uint64_t fnv1a64_bytes(uint64_t seed, const unsigned char *data, size_t n) {
  uint64_t h = seed;
  if (h == 0u) h = 1469598103934665603ull;
  if (data == NULL) return h;
  for (size_t i = 0u; i < n; ++i) {
    h ^= (uint64_t)data[i];
    h *= 1099511628211ull;
  }
  return h;
}

static uint64_t fnv1a64_buffer(const unsigned char *data, size_t n) {
  return fnv1a64_bytes(1469598103934665603ull, data, n);
}

static void to_hex64(uint64_t value, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  (void)snprintf(out, out_cap, "%016llx", (unsigned long long)value);
}

static bool normalize_hash_hex(const char *input, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  if (input == NULL || input[0] == '\0') {
    out[0] = '\0';
    return false;
  }
  bool alias = (input == out);
  if (!alias) out[0] = '\0';
  const char *p = input;
  if (p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) p += 2;
  size_t n = 0u;
  while (*p != '\0' && n + 1u < out_cap) {
    unsigned char ch = (unsigned char)*p;
    if (isspace(ch)) break;
    if (!isxdigit(ch)) break;
    out[n++] = (char)tolower(ch);
    ++p;
  }
  out[n] = '\0';
  return n > 0u;
}

static bool hash_hex_equal(const char *lhs, const char *rhs) {
  char a[64];
  char b[64];
  if (!normalize_hash_hex(lhs, a, sizeof(a)) || !normalize_hash_hex(rhs, b, sizeof(b))) return false;
  return strcmp(a, b) == 0;
}

static bool runtime_hash_nonzero(const char *text) {
  char norm[64];
  if (!normalize_hash_hex(text, norm, sizeof(norm))) return false;
  for (size_t i = 0u; norm[i] != '\0'; ++i) {
    if (norm[i] != '0') return true;
  }
  return false;
}

static const char *skip_ws(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static const char *json_find_key(const char *doc, const char *key) {
  if (doc == NULL || key == NULL) return NULL;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = doc;
  while ((p = strstr(p, pat)) != NULL) {
    const char *q = p + strlen(pat);
    q = skip_ws(q);
    if (q == NULL || *q != ':') {
      p = p + 1;
      continue;
    }
    q++;
    q = skip_ws(q);
    return q;
  }
  return NULL;
}

static bool json_parse_string_at(const char *p, char *out, size_t cap, const char **end_out) {
  if (p == NULL || *p != '"') return false;
  ++p;
  size_t idx = 0u;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"') {
      if (out != NULL && cap > 0u) {
        if (idx >= cap) idx = cap - 1u;
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
    if (out != NULL && cap > 0u && idx + 1u < cap) out[idx] = ch;
    idx++;
  }
  return false;
}

static bool json_get_string(const char *doc, const char *key, char *out, size_t cap) {
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '"') return false;
  return json_parse_string_at(p, out, cap, NULL);
}

static bool json_get_bool(const char *doc, const char *key, bool *out) {
  const char *p = json_find_key(doc, key);
  if (p == NULL) return false;
  if (starts_with(p, "true")) {
    if (out != NULL) *out = true;
    return true;
  }
  if (starts_with(p, "false")) {
    if (out != NULL) *out = false;
    return true;
  }
  return false;
}

static bool json_get_int64(const char *doc, const char *key, long long *out) {
  const char *p = json_find_key(doc, key);
  if (p == NULL) return false;
  errno = 0;
  char *end = NULL;
  long long v = strtoll(p, &end, 10);
  if (end == p || errno != 0) return false;
  if (out != NULL) *out = v;
  return true;
}

static bool json_get_int32(const char *doc, const char *key, int *out) {
  long long v = 0;
  if (!json_get_int64(doc, key, &v)) return false;
  if (v < INT32_MIN || v > INT32_MAX) return false;
  if (out != NULL) *out = (int)v;
  return true;
}

static const char *json_find_balanced_end(const char *start, char open_ch, char close_ch) {
  if (start == NULL || *start != open_ch) return NULL;
  int depth = 0;
  bool in_str = false;
  bool esc = false;
  const char *p = start;
  while (*p != '\0') {
    char ch = *p;
    if (in_str) {
      if (esc) {
        esc = false;
      } else if (ch == '\\') {
        esc = true;
      } else if (ch == '"') {
        in_str = false;
      }
    } else {
      if (ch == '"') {
        in_str = true;
      } else if (ch == open_ch) {
        depth++;
      } else if (ch == close_ch) {
        depth--;
        if (depth == 0) return p + 1;
      }
    }
    ++p;
  }
  return NULL;
}

static bool json_get_array_slice(const char *doc, const char *key, const char **arr_start, const char **arr_end) {
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '[') return false;
  const char *end = json_find_balanced_end(p, '[', ']');
  if (end == NULL) return false;
  if (arr_start != NULL) *arr_start = p;
  if (arr_end != NULL) *arr_end = end;
  return true;
}

static bool parse_states(const char *states_json_path, StringList *states) {
  size_t n = 0u;
  char *doc = read_file_all(states_json_path, &n);
  if (doc == NULL) return false;
  const char *start = NULL;
  const char *end = NULL;
  if (!json_get_array_slice(doc, "states", &start, &end)) {
    free(doc);
    return false;
  }
  const char *p = start + 1;
  while (p < end) {
    p = skip_ws(p);
    if (p >= end || *p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '"') {
      free(doc);
      return false;
    }
    char item[PATH_MAX];
    const char *after = NULL;
    if (!json_parse_string_at(p, item, sizeof(item), &after)) {
      free(doc);
      return false;
    }
    if (item[0] != '\0' && strlist_push(states, item) != 0) {
      free(doc);
      return false;
    }
    p = after;
  }
  free(doc);
  return states->len > 0u;
}

static bool parse_truth_manifest(const char *manifest_path, TruthStateList *truths) {
  size_t n = 0u;
  char *doc = read_file_all(manifest_path, &n);
  if (doc == NULL) return false;

  char root[PATH_MAX];
  snprintf(root, sizeof(root), "%s", manifest_path);
  char *slash = strrchr(root, '/');
  if (slash == NULL) {
    free(doc);
    return false;
  }
  *slash = '\0';
  char truth_root[PATH_MAX];
  truth_root[0] = '\0';
  (void)snprintf(truth_root, sizeof(truth_root), "%s/truth", root);

  const char *arr_start = NULL;
  const char *arr_end = NULL;
  if (!json_get_array_slice(doc, "states", &arr_start, &arr_end)) {
    free(doc);
    return false;
  }

  const char *p = arr_start + 1;
  while (p < arr_end) {
    p = skip_ws(p);
    if (p >= arr_end || *p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '{') {
      free(doc);
      return false;
    }
    const char *obj_end = json_find_balanced_end(p, '{', '}');
    if (obj_end == NULL) {
      free(doc);
      return false;
    }
    size_t obj_len = (size_t)(obj_end - p);
    char *obj = (char *)malloc(obj_len + 1u);
    if (obj == NULL) {
      free(doc);
      return false;
    }
    memcpy(obj, p, obj_len);
    obj[obj_len] = '\0';

    TruthState row;
    memset(&row, 0, sizeof(row));
    char rgba_file[PATH_MAX];
    char framehash_file[PATH_MAX];
    rgba_file[0] = '\0';
    framehash_file[0] = '\0';

    (void)json_get_string(obj, "name", row.name, sizeof(row.name));
    (void)json_get_string(obj, "framehash", row.framehash, sizeof(row.framehash));
    (void)json_get_string(obj, "rgba_sha256", row.rgba_sha256, sizeof(row.rgba_sha256));
    (void)json_get_string(obj, "rgba_file", rgba_file, sizeof(rgba_file));
    (void)json_get_string(obj, "framehash_file", framehash_file, sizeof(framehash_file));
    (void)json_get_int64(obj, "rgba_bytes", &row.rgba_bytes);

    if (row.name[0] != '\0') {
      if (rgba_file[0] != '\0') {
        if (rgba_file[0] == '/') {
          (void)snprintf(row.rgba_path, sizeof(row.rgba_path), "%s", rgba_file);
        } else {
          char cand_root[PATH_MAX];
          char cand_truth[PATH_MAX];
          (void)snprintf(cand_root, sizeof(cand_root), "%s/%s", root, rgba_file);
          (void)snprintf(cand_truth, sizeof(cand_truth), "%s/%s", truth_root, rgba_file);
          if (file_exists(cand_root)) {
            (void)snprintf(row.rgba_path, sizeof(row.rgba_path), "%s", cand_root);
          } else {
            (void)snprintf(row.rgba_path, sizeof(row.rgba_path), "%s", cand_truth);
          }
        }
      } else {
        (void)snprintf(row.rgba_path, sizeof(row.rgba_path), "%s/%s.rgba", truth_root, row.name);
      }
      if (framehash_file[0] != '\0') {
        if (framehash_file[0] == '/') {
          (void)snprintf(row.framehash_path, sizeof(row.framehash_path), "%s", framehash_file);
        } else {
          char cand_root[PATH_MAX];
          char cand_truth[PATH_MAX];
          (void)snprintf(cand_root, sizeof(cand_root), "%s/%s", root, framehash_file);
          (void)snprintf(cand_truth, sizeof(cand_truth), "%s/%s", truth_root, framehash_file);
          if (file_exists(cand_root)) {
            (void)snprintf(row.framehash_path, sizeof(row.framehash_path), "%s", cand_root);
          } else {
            (void)snprintf(row.framehash_path, sizeof(row.framehash_path), "%s", cand_truth);
          }
        }
      } else {
        (void)snprintf(row.framehash_path, sizeof(row.framehash_path), "%s/%s.framehash", truth_root, row.name);
      }
      if (truth_list_push(truths, &row) != 0) {
        free(obj);
        free(doc);
        return false;
      }
    }

    free(obj);
    p = obj_end;
  }

  free(doc);
  return truths->len > 0u;
}

static bool read_framehash_file(const char *path, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  bool ok = normalize_hash_hex(doc, out, out_cap);
  free(doc);
  return ok;
}

static bool route_match_hint(const char *hint, const char *state) {
  if (hint == NULL || state == NULL || hint[0] == '\0' || state[0] == '\0') return false;
  if (strcmp(hint, state) == 0) return true;
  const char *legacy_env = getenv("CHENG_ANDROID_FULLROUTE_LEGACY_ROUTE_HINT_MATCH");
  if (legacy_env == NULL || strcmp(legacy_env, "1") != 0) return false;
  size_t hlen = strlen(hint);
  if (starts_with(state, hint) && state[hlen] == '_') return true;
  if ((strcmp(hint, "home") == 0 || strcmp(hint, "home_default") == 0) && starts_with(state, "home_")) return true;
  if ((strcmp(hint, "publish") == 0 || strcmp(hint, "publish_selector") == 0) && starts_with(state, "publish_")) return true;
  if ((strcmp(hint, "trading") == 0 || strcmp(hint, "trading_main") == 0) && starts_with(state, "trading_")) return true;
  if ((strcmp(hint, "ecom") == 0 || strcmp(hint, "ecom_main") == 0) && starts_with(state, "ecom_")) return true;
  if ((strcmp(hint, "marketplace") == 0 || strcmp(hint, "marketplace_main") == 0) && starts_with(state, "marketplace_")) return true;
  if ((strcmp(hint, "update_center") == 0 || strcmp(hint, "update_center_main") == 0) && starts_with(state, "update_center_")) return true;
  return false;
}

static bool check_semantic_runtime_map(const char *runtime_map_path,
                                       const StringList *states,
                                       int expected_total_count) {
  size_t n = 0u;
  char *doc = read_file_all(runtime_map_path, &n);
  if (doc == NULL) return false;

  const char *arr_start = NULL;
  const char *arr_end = NULL;
  if (!json_get_array_slice(doc, "nodes", &arr_start, &arr_end)) {
    free(doc);
    return false;
  }

  int *renderable_counts = (int *)calloc(states->len, sizeof(int));
  if (renderable_counts == NULL) {
    free(doc);
    return false;
  }

  int node_count = 0;
  const char *p = arr_start + 1;
  while (p < arr_end) {
    p = skip_ws(p);
    if (p >= arr_end || *p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '{') {
      fprintf(stderr, "[verify-android-fullroute-pixel] semantic runtime node schema must be object\n");
      free(renderable_counts);
      free(doc);
      return false;
    }
    const char *obj_end = json_find_balanced_end(p, '{', '}');
    if (obj_end == NULL) {
      free(renderable_counts);
      free(doc);
      return false;
    }

    size_t obj_len = (size_t)(obj_end - p);
    char *obj = (char *)malloc(obj_len + 1u);
    if (obj == NULL) {
      free(renderable_counts);
      free(doc);
      return false;
    }
    memcpy(obj, p, obj_len);
    obj[obj_len] = '\0';

    char route_hint[128];
    char render_bucket[128];
    char role[64];
    char text[256];
    char event_binding[128];
    char prop_id[128];
    char data_test_id[128];
    route_hint[0] = '\0';
    render_bucket[0] = '\0';
    role[0] = '\0';
    text[0] = '\0';
    event_binding[0] = '\0';
    prop_id[0] = '\0';
    data_test_id[0] = '\0';

    (void)json_get_string(obj, "route_hint", route_hint, sizeof(route_hint));
    (void)json_get_string(obj, "render_bucket", render_bucket, sizeof(render_bucket));
    (void)json_get_string(obj, "role", role, sizeof(role));
    (void)json_get_string(obj, "text", text, sizeof(text));
    (void)json_get_string(obj, "event_binding", event_binding, sizeof(event_binding));

    const char *props_ptr = json_find_key(obj, "props");
    if (props_ptr != NULL && *props_ptr == '{') {
      const char *props_end = json_find_balanced_end(props_ptr, '{', '}');
      if (props_end != NULL) {
        size_t props_len = (size_t)(props_end - props_ptr);
        char *props_doc = (char *)malloc(props_len + 1u);
        if (props_doc != NULL) {
          memcpy(props_doc, props_ptr, props_len);
          props_doc[props_len] = '\0';
          (void)json_get_string(props_doc, "id", prop_id, sizeof(prop_id));
          (void)json_get_string(props_doc, "dataTestId", data_test_id, sizeof(data_test_id));
          free(props_doc);
        }
      }
    }

    for (size_t i = 0u; i < states->len; ++i) {
      if (!route_match_hint(route_hint, states->items[i]) && !route_match_hint(render_bucket, states->items[i])) {
        continue;
      }
      bool renderable = false;
      if (strcasecmp(role, "element") == 0 || strcasecmp(role, "text") == 0 || strcasecmp(role, "event") == 0) {
        renderable = true;
      }
      if (text[0] != '\0' || prop_id[0] != '\0' || data_test_id[0] != '\0' || event_binding[0] != '\0') {
        renderable = true;
      }
      if (renderable) renderable_counts[i] += 1;
    }

    free(obj);
    p = obj_end;
    node_count += 1;
  }

  if (node_count <= 0) {
    fprintf(stderr, "[verify-android-fullroute-pixel] semantic readiness failed: runtime semantic nodes empty\n");
    free(renderable_counts);
    free(doc);
    return false;
  }
  if (node_count != expected_total_count) {
    fprintf(stderr,
            "[verify-android-fullroute-pixel] semantic readiness failed: runtime semantic node count mismatch runtime=%d expected=%d\n",
            node_count,
            expected_total_count);
    free(renderable_counts);
    free(doc);
    return false;
  }
  for (size_t i = 0u; i < states->len; ++i) {
    if (renderable_counts[i] <= 0) {
      fprintf(stderr,
              "[verify-android-fullroute-pixel] semantic readiness failed: no renderable semantic nodes for state=%s\n",
              states->items[i]);
      free(renderable_counts);
      free(doc);
      return false;
    }
  }

  free(renderable_counts);
  free(doc);
  return true;
}

static int run_command(char *const argv[], const char *log_path, int timeout_sec) {
  pid_t pid = fork();
  if (pid < 0) return 127;
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (log_path != NULL && log_path[0] != '\0') {
      int fd = open(log_path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
      if (fd < 0) _exit(127);
      if (dup2(fd, STDOUT_FILENO) < 0) _exit(127);
      if (dup2(fd, STDERR_FILENO) < 0) _exit(127);
      close(fd);
    }
    execvp(argv[0], argv);
    _exit(127);
  }

  setpgid(pid, pid);
  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : 0;
  while (1) {
    int status = 0;
    pid_t got = waitpid(pid, &status, WNOHANG);
    if (got == pid) {
      if (WIFEXITED(status)) return WEXITSTATUS(status);
      if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
      return 1;
    }
    if (got < 0) return 127;
    if (timeout_sec > 0 && time(NULL) >= deadline) {
      kill(-pid, SIGTERM);
      usleep(200000);
      kill(-pid, SIGKILL);
      waitpid(pid, NULL, 0);
      return 124;
    }
    usleep(50000);
  }
}

static int capture_command_output_bytes(char *const argv[], int timeout_sec, unsigned char **out, size_t *out_len) {
  if (out != NULL) *out = NULL;
  if (out_len != NULL) *out_len = 0u;

  int pipefd[2];
  if (pipe(pipefd) != 0) return -1;
  pid_t pid = fork();
  if (pid < 0) {
    close(pipefd[0]);
    close(pipefd[1]);
    return -1;
  }
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (dup2(pipefd[1], STDOUT_FILENO) < 0) _exit(127);
    close(pipefd[0]);
    close(pipefd[1]);
    execvp(argv[0], argv);
    _exit(127);
  }

  close(pipefd[1]);
  setpgid(pid, pid);

  size_t cap = 4096u;
  size_t len = 0u;
  unsigned char *buf = (unsigned char *)malloc(cap + 1u);
  if (buf == NULL) {
    close(pipefd[0]);
    kill(-pid, SIGKILL);
    waitpid(pid, NULL, 0);
    return -1;
  }

  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : 0;
  while (1) {
    unsigned char tmp[2048];
    ssize_t rd = read(pipefd[0], tmp, sizeof(tmp));
    if (rd > 0) {
      if (len + (size_t)rd + 1u > cap) {
        size_t next = cap;
        while (len + (size_t)rd + 1u > next) next *= 2u;
        unsigned char *resized = (unsigned char *)realloc(buf, next + 1u);
        if (resized == NULL) {
          free(buf);
          close(pipefd[0]);
          kill(-pid, SIGKILL);
          waitpid(pid, NULL, 0);
          return -1;
        }
        buf = resized;
        cap = next;
      }
      memcpy(buf + len, tmp, (size_t)rd);
      len += (size_t)rd;
      continue;
    }
    if (rd == 0) break;
    if (errno == EINTR) continue;
    break;
  }
  close(pipefd[0]);

  int status = 0;
  while (waitpid(pid, &status, WNOHANG) == 0) {
    if (timeout_sec > 0 && time(NULL) >= deadline) {
      kill(-pid, SIGTERM);
      usleep(200000);
      kill(-pid, SIGKILL);
      waitpid(pid, &status, 0);
      free(buf);
      return 124;
    }
    usleep(50000);
  }

  buf[len] = '\0';
  if (out != NULL) *out = buf;
  else free(buf);
  if (out_len != NULL) *out_len = len;

  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static int capture_command_output_text(char *const argv[], int timeout_sec, char **out) {
  unsigned char *raw = NULL;
  size_t raw_len = 0u;
  int rc = capture_command_output_bytes(argv, timeout_sec, &raw, &raw_len);
  if (rc != 0) {
    free(raw);
    return rc;
  }
  if (out != NULL) {
    *out = (char *)raw;
  } else {
    free(raw);
  }
  (void)raw_len;
  return 0;
}

static bool find_executable_in_path(const char *name, char *out, size_t out_cap) {
  if (name == NULL || out == NULL || out_cap == 0u) return false;
  if (strchr(name, '/') != NULL) {
    if (path_executable(name)) {
      snprintf(out, out_cap, "%s", name);
      return true;
    }
    return false;
  }
  const char *path_env = getenv("PATH");
  if (path_env == NULL) return false;
  char *copy = strdup(path_env);
  if (copy == NULL) return false;
  bool ok = false;
  char *save = NULL;
  for (char *tok = strtok_r(copy, ":", &save); tok != NULL; tok = strtok_r(NULL, ":", &save)) {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/%s", tok, name) >= (int)sizeof(candidate)) continue;
    if (path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      ok = true;
      break;
    }
  }
  free(copy);
  return ok;
}

static bool resolve_adb_executable(char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  const char *env_adb = getenv("CHENG_ANDROID_ADB");
  if (env_adb != NULL && env_adb[0] != '\0' && path_executable(env_adb)) {
    snprintf(out, out_cap, "%s", env_adb);
    return true;
  }
  const char *sdk = getenv("ANDROID_SDK_ROOT");
  if (sdk == NULL || sdk[0] == '\0') sdk = getenv("ANDROID_HOME");
  if (sdk != NULL && sdk[0] != '\0') {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/platform-tools/adb", sdk) < (int)sizeof(candidate) &&
        path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  const char *home = getenv("HOME");
  if (home != NULL && home[0] != '\0') {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/Library/Android/sdk/platform-tools/adb", home) < (int)sizeof(candidate) &&
        path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  return find_executable_in_path("adb", out, out_cap);
}

static bool detect_android_serial(const char *adb, char *out_serial, size_t out_cap) {
  if (adb == NULL || out_serial == NULL || out_cap == 0u) return false;
  out_serial[0] = '\0';

  const char *env_serial = getenv("ANDROID_SERIAL");
  if (env_serial != NULL && env_serial[0] != '\0') {
    snprintf(out_serial, out_cap, "%s", env_serial);
    return true;
  }

  char *argv[] = {(char *)adb, "devices", NULL};
  char *out = NULL;
  int rc = capture_command_output_text(argv, 10, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }

  bool ok = false;
  char *save_line = NULL;
  for (char *line = strtok_r(out, "\n", &save_line); line != NULL; line = strtok_r(NULL, "\n", &save_line)) {
    while (*line != '\0' && isspace((unsigned char)*line)) ++line;
    if (*line == '\0') continue;
    if (starts_with(line, "List of devices")) continue;

    char *tok_save = NULL;
    char *id = strtok_r(line, " \t\r", &tok_save);
    char *state = strtok_r(NULL, " \t\r", &tok_save);
    if (id != NULL && state != NULL && strcmp(state, "device") == 0) {
      snprintf(out_serial, out_cap, "%s", id);
      ok = true;
      break;
    }
  }

  free(out);
  return ok;
}

static int adb_prefix_argv(const char *adb, const char *serial, char **argv, int cap) {
  if (adb == NULL || argv == NULL || cap < 2) return -1;
  int n = 0;
  argv[n++] = (char *)adb;
  if (serial != NULL && serial[0] != '\0') {
    if (n + 2 >= cap) return -1;
    argv[n++] = "-s";
    argv[n++] = (char *)serial;
  }
  return n;
}

static bool parse_runtime_reason_token(const char *reason, const char *key, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (reason == NULL || key == NULL || key[0] == '\0' || out == NULL || out_cap == 0u) return false;
  size_t key_len = strlen(key);
  const char *p = reason;
  while (p != NULL && *p != '\0') {
    const char *hit = strstr(p, key);
    if (hit == NULL) break;
    if (hit > reason) {
      char prev = *(hit - 1);
      if (prev != ' ' && prev != ';' && prev != '\t' && prev != '\n' && prev != '\r') {
        p = hit + 1;
        continue;
      }
    }
    if (hit[key_len] != '=') {
      p = hit + 1;
      continue;
    }
    const char *value = hit + key_len + 1u;
    size_t n = 0u;
    while (value[n] != '\0' && value[n] != ' ' && value[n] != ';' && value[n] != '\t' && value[n] != '\n' &&
           value[n] != '\r') {
      n += 1u;
    }
    if (n == 0u) return false;
    if (n >= out_cap) n = out_cap - 1u;
    memcpy(out, value, n);
    out[n] = '\0';
    return true;
  }
  return false;
}

static bool kv_has_key_value(const char *kv, const char *key, const char *expected) {
  if (kv == NULL || key == NULL || key[0] == '\0' || expected == NULL) return false;
  size_t key_len = strlen(key);
  size_t expected_len = strlen(expected);
  const char *p = kv;
  while (*p != '\0') {
    while (*p == ';') p += 1;
    if (*p == '\0') break;
    const char *entry = p;
    while (*p != '\0' && *p != ';') p += 1;
    const char *entry_end = p;
    const char *eq = entry;
    while (eq < entry_end && *eq != '=') eq += 1;
    if (eq < entry_end) {
      size_t name_len = (size_t)(eq - entry);
      if (name_len == key_len && strncmp(entry, key, key_len) == 0) {
        const char *value = eq + 1;
        size_t value_len = (size_t)(entry_end - value);
        return (value_len == expected_len && strncmp(value, expected, expected_len) == 0);
      }
    }
  }
  return false;
}

static char *base64_urlsafe_encode(const unsigned char *data, size_t len) {
  static const char kTable[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  size_t out_len = ((len + 2u) / 3u) * 4u;
  char *out = (char *)malloc(out_len + 1u);
  if (out == NULL) return NULL;
  size_t i = 0u;
  size_t j = 0u;
  while (i + 3u <= len) {
    uint32_t v = ((uint32_t)data[i] << 16u) | ((uint32_t)data[i + 1u] << 8u) | (uint32_t)data[i + 2u];
    out[j++] = kTable[(v >> 18u) & 0x3Fu];
    out[j++] = kTable[(v >> 12u) & 0x3Fu];
    out[j++] = kTable[(v >> 6u) & 0x3Fu];
    out[j++] = kTable[v & 0x3Fu];
    i += 3u;
  }
  if (i < len) {
    uint32_t v = (uint32_t)data[i] << 16u;
    if (i + 1u < len) v |= (uint32_t)data[i + 1u] << 8u;
    out[j++] = kTable[(v >> 18u) & 0x3Fu];
    out[j++] = kTable[(v >> 12u) & 0x3Fu];
    if (i + 1u < len) {
      out[j++] = kTable[(v >> 6u) & 0x3Fu];
    } else {
      out[j++] = '=';
    }
    out[j++] = '=';
  }
  out[j] = '\0';
  return out;
}

static bool pull_runtime_state(const char *adb,
                               const char *serial,
                               const char *runtime_pkg,
                               const char *runtime_state_path,
                               RuntimeSnapshot *snapshot) {
  if (snapshot == NULL) return false;
  memset(snapshot, 0, sizeof(*snapshot));
  if (runtime_pkg == NULL || runtime_pkg[0] == '\0') return false;

  char *argv[16];
  int n = adb_prefix_argv(adb, serial, argv, (int)(sizeof(argv) / sizeof(argv[0])));
  if (n < 0) return false;
  argv[n++] = "shell";
  argv[n++] = "run-as";
  argv[n++] = (char *)runtime_pkg;
  argv[n++] = "cat";
  argv[n++] = "files/cheng_runtime_state.json";
  argv[n] = NULL;

  char *out = NULL;
  int rc = capture_command_output_text(argv, 5, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  if (out[0] == '\0') {
    free(out);
    return false;
  }

  size_t out_len = strlen(out);
  if (write_file_all(runtime_state_path, out, out_len) != 0) {
    free(out);
    return false;
  }

  bool started = false;
  bool native_ready = false;
  bool render_ready = false;
  bool semantic_nodes_loaded = false;
  long long semantic_nodes_applied_count = 0;

  if (!json_get_bool(out, "started", &started)) {
    free(out);
    return false;
  }
  if (!json_get_bool(out, "native_ready", &native_ready)) {
    free(out);
    return false;
  }
  if (!json_get_bool(out, "render_ready", &render_ready)) {
    render_ready = false;
  }
  if (!json_get_bool(out, "semantic_nodes_loaded", &semantic_nodes_loaded)) {
    semantic_nodes_loaded = false;
  }
  if (!json_get_int64(out, "semantic_nodes_applied_count", &semantic_nodes_applied_count)) {
    semantic_nodes_applied_count = 0;
  }

  (void)json_get_string(out, "launch_args_kv", snapshot->launch_args_kv, sizeof(snapshot->launch_args_kv));
  (void)json_get_string(out, "last_error", snapshot->last_error, sizeof(snapshot->last_error));

  char token[128];
  token[0] = '\0';
  if (parse_runtime_reason_token(snapshot->last_error, "route", token, sizeof(token))) {
    snprintf(snapshot->route, sizeof(snapshot->route), "%s", token);
  }
  token[0] = '\0';
  if (parse_runtime_reason_token(snapshot->last_error, "framehash", token, sizeof(token))) {
    (void)normalize_hash_hex(token, snapshot->framehash, sizeof(snapshot->framehash));
  }
  token[0] = '\0';
  if (parse_runtime_reason_token(snapshot->last_error, "sn", token, sizeof(token)) ||
      parse_runtime_reason_token(snapshot->last_error, "st", token, sizeof(token))) {
    snapshot->semantic_total_count = atoi(token);
  }
  token[0] = '\0';
  if (parse_runtime_reason_token(snapshot->last_error, "sth", token, sizeof(token))) {
    (void)normalize_hash_hex(token, snapshot->semantic_total_hash, sizeof(snapshot->semantic_total_hash));
  }
  token[0] = '\0';
  if (parse_runtime_reason_token(snapshot->last_error, "sa", token, sizeof(token))) {
    snapshot->semantic_applied_count = atoi(token);
  }
  token[0] = '\0';
  if (parse_runtime_reason_token(snapshot->last_error, "sah", token, sizeof(token))) {
    (void)normalize_hash_hex(token, snapshot->semantic_applied_hash, sizeof(snapshot->semantic_applied_hash));
  }
  token[0] = '\0';
  if (parse_runtime_reason_token(snapshot->last_error, "sr", token, sizeof(token))) {
    snapshot->semantic_ready = atoi(token);
  }

  snapshot->started = started;
  snapshot->native_ready = native_ready;
  snapshot->render_ready = render_ready;
  snapshot->semantic_nodes_loaded = semantic_nodes_loaded;
  snapshot->semantic_nodes_applied_count = semantic_nodes_applied_count;

  free(out);
  return true;
}

static bool launch_activity(const char *adb,
                            const char *serial,
                            const char *runtime_activity,
                            const char *app_kv,
                            const char *app_json,
                            const char *app_json_b64,
                            char *err,
                            size_t err_cap);

static const char *route_skip_ws(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool route_parse_json_string(const char *p, char *out, size_t out_cap, const char **out_end) {
  if (p == NULL || *p != '"' || out == NULL || out_cap == 0u) return false;
  ++p;
  size_t n = 0u;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"') {
      out[n] = '\0';
      if (out_end != NULL) *out_end = p;
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
    if (n + 1u >= out_cap) return false;
    out[n++] = ch;
  }
  return false;
}

static const char *route_find_key_value(const char *start, const char *end, const char *key) {
  if (start == NULL || end == NULL || key == NULL || end <= start) return NULL;
  char pat[128];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = start;
  while (p < end) {
    const char *hit = strstr(p, pat);
    if (hit == NULL || hit >= end) return NULL;
    const char *q = route_skip_ws(hit + strlen(pat));
    if (q == NULL || q >= end || *q != ':') {
      p = hit + 1;
      continue;
    }
    q = route_skip_ws(q + 1);
    if (q == NULL || q >= end) return NULL;
    return q;
  }
  return NULL;
}

static bool route_parse_int_field(const char *start, const char *end, const char *key, int *out_value) {
  if (out_value == NULL) return false;
  const char *p = route_find_key_value(start, end, key);
  if (p == NULL) return false;
  char *end_num = NULL;
  long v = strtol(p, &end_num, 10);
  if (end_num == p || end_num > end) return false;
  *out_value = (int)v;
  return true;
}

static bool parse_route_action_object(const char *obj_start, const char *obj_end, RouteAction *out_action) {
  if (obj_start == NULL || obj_end == NULL || out_action == NULL || obj_end <= obj_start) return false;
  char type[64];
  type[0] = '\0';
  const char *type_value = route_find_key_value(obj_start, obj_end, "type");
  if (type_value == NULL || *type_value != '"' ||
      !route_parse_json_string(type_value, type, sizeof(type), NULL)) {
    return false;
  }
  out_action->type = ROUTE_ACTION_INVALID;
  out_action->v0 = 0;
  out_action->v1 = 0;
  if (strcmp(type, "launch_main") == 0) {
    out_action->type = ROUTE_ACTION_LAUNCH_MAIN;
    return true;
  }
  if (strcmp(type, "sleep_ms") == 0) {
    if (!route_parse_int_field(obj_start, obj_end, "ms", &out_action->v0)) return false;
    out_action->type = ROUTE_ACTION_SLEEP_MS;
    return true;
  }
  if (strcmp(type, "tap_ppm") == 0) {
    if (!route_parse_int_field(obj_start, obj_end, "x", &out_action->v0) ||
        !route_parse_int_field(obj_start, obj_end, "y", &out_action->v1)) {
      return false;
    }
    if (out_action->v0 < 0 || out_action->v0 > 1000 || out_action->v1 < 0 || out_action->v1 > 1000) {
      return false;
    }
    out_action->type = ROUTE_ACTION_TAP_PPM;
    return true;
  }
  if (strcmp(type, "keyevent") == 0) {
    if (!route_parse_int_field(obj_start, obj_end, "code", &out_action->v0)) return false;
    out_action->type = ROUTE_ACTION_KEYEVENT;
    return true;
  }
  return false;
}

static bool read_route_actions_for_state(const char *route_actions_json,
                                         const char *route,
                                         RouteActionList *out_actions) {
  if (route_actions_json == NULL || route == NULL || out_actions == NULL) return false;
  memset(out_actions, 0, sizeof(*out_actions));
  size_t n = 0u;
  char *doc = read_file_all(route_actions_json, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_match[512];
  if (snprintf(route_match, sizeof(route_match), "\"route\":\"%s\"", route) >= (int)sizeof(route_match)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_match);
  if (hit == NULL) {
    free(doc);
    return false;
  }
  const char *actions_key = strstr(hit, "\"actions\"");
  if (actions_key == NULL) {
    free(doc);
    return false;
  }
  const char *arr_begin = strchr(actions_key, '[');
  if (arr_begin == NULL) {
    free(doc);
    return false;
  }
  const char *arr_end = arr_begin + 1;
  int depth = 1;
  while (*arr_end != '\0' && depth > 0) {
    if (*arr_end == '[') depth += 1;
    else if (*arr_end == ']') depth -= 1;
    arr_end += 1;
  }
  if (depth != 0) {
    free(doc);
    return false;
  }
  const char *p = arr_begin + 1;
  while (p < arr_end - 1) {
    p = route_skip_ws(p);
    if (p >= arr_end - 1) break;
    if (*p == ',') {
      p += 1;
      continue;
    }
    if (*p != '{') {
      route_action_list_free(out_actions);
      free(doc);
      return false;
    }
    const char *obj_begin = p;
    int obj_depth = 1;
    ++p;
    bool in_string = false;
    while (p < arr_end && obj_depth > 0) {
      char ch = *p++;
      if (ch == '"' && (p < arr_end ? *(p - 2) != '\\' : true)) in_string = !in_string;
      if (in_string) continue;
      if (ch == '{') obj_depth += 1;
      else if (ch == '}') obj_depth -= 1;
    }
    if (obj_depth != 0) {
      route_action_list_free(out_actions);
      free(doc);
      return false;
    }
    const char *obj_end = p;
    RouteAction action;
    if (!parse_route_action_object(obj_begin, obj_end, &action) || route_action_list_push(out_actions, action) != 0) {
      route_action_list_free(out_actions);
      free(doc);
      return false;
    }
  }
  free(doc);
  return out_actions->len > 0u;
}

static int run_adb_input_keyevent(const char *adb, const char *serial, int keycode) {
  char code[32];
  snprintf(code, sizeof(code), "%d", keycode);
  char *argv[12];
  int n = adb_prefix_argv(adb, serial, argv, (int)(sizeof(argv) / sizeof(argv[0])));
  if (n < 0) return -1;
  argv[n++] = "shell";
  argv[n++] = "input";
  argv[n++] = "keyevent";
  argv[n++] = code;
  argv[n] = NULL;
  return run_command(argv, NULL, 20);
}

static int run_adb_input_tap(const char *adb, const char *serial, int x, int y) {
  char sx[32];
  char sy[32];
  snprintf(sx, sizeof(sx), "%d", x);
  snprintf(sy, sizeof(sy), "%d", y);
  char *argv[12];
  int n = adb_prefix_argv(adb, serial, argv, (int)(sizeof(argv) / sizeof(argv[0])));
  if (n < 0) return -1;
  argv[n++] = "shell";
  argv[n++] = "input";
  argv[n++] = "tap";
  argv[n++] = sx;
  argv[n++] = sy;
  argv[n] = NULL;
  return run_command(argv, NULL, 20);
}

static int parse_first_four_ints(const char *s, int *a, int *b, int *c, int *d) {
  if (s == NULL || a == NULL || b == NULL || c == NULL || d == NULL) return -1;
  int vals[4];
  int count = 0;
  const char *p = s;
  while (*p != '\0' && count < 4) {
    if (*p == '-' || isdigit((unsigned char)*p)) {
      char *end = NULL;
      long v = strtol(p, &end, 10);
      if (end != p) {
        vals[count++] = (int)v;
        p = end;
        continue;
      }
    }
    ++p;
  }
  if (count < 4) return -1;
  *a = vals[0];
  *b = vals[1];
  *c = vals[2];
  *d = vals[3];
  return 0;
}

static bool read_app_bounds(const char *adb, const char *serial, Rect *out_rect) {
  if (adb == NULL || serial == NULL || out_rect == NULL) return false;
  char *argv[10];
  int n = adb_prefix_argv(adb, serial, argv, (int)(sizeof(argv) / sizeof(argv[0])));
  if (n < 0) return false;
  argv[n++] = "shell";
  argv[n++] = "dumpsys";
  argv[n++] = "window";
  argv[n++] = "displays";
  argv[n] = NULL;
  char *out = NULL;
  int rc = capture_command_output_text(argv, 10, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  bool ok = false;
  const char *p = out;
  while ((p = strstr(p, "mAppBounds=")) != NULL) {
    const char *line_end = strchr(p, '\n');
    size_t line_len = (line_end == NULL) ? strlen(p) : (size_t)(line_end - p);
    if (line_len > 0u && line_len < 512u) {
      char line[512];
      memcpy(line, p, line_len);
      line[line_len] = '\0';
      int x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      if (parse_first_four_ints(line, &x1, &y1, &x2, &y2) == 0 && x2 > x1 && y2 > y1) {
        out_rect->x = x1;
        out_rect->y = y1;
        out_rect->w = x2 - x1;
        out_rect->h = y2 - y1;
        ok = true;
        break;
      }
    }
    if (line_end == NULL) break;
    p = line_end + 1;
  }
  free(out);
  return ok;
}

static bool replay_route_actions(const LaunchContext *ctx,
                                 const char *state,
                                 const char *app_kv,
                                 const char *app_json,
                                 const char *app_json_b64,
                                 char *err,
                                 size_t err_cap) {
  if (ctx == NULL || state == NULL || ctx->route_actions_path == NULL || ctx->route_actions_path[0] == '\0') return false;
  RouteActionList actions;
  if (!read_route_actions_for_state(ctx->route_actions_path, state, &actions)) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "missing route actions state=%s", state);
    return false;
  }
  Rect bounds;
  bounds.x = 0;
  bounds.y = 0;
  bounds.w = 1212;
  bounds.h = 2512;
  (void)read_app_bounds(ctx->adb, ctx->serial, &bounds);

  bool ok = true;
  for (size_t i = 0u; i < actions.len; ++i) {
    RouteAction action = actions.items[i];
    if (action.type == ROUTE_ACTION_LAUNCH_MAIN) {
      if (!launch_activity(ctx->adb, ctx->serial, ctx->runtime_activity, app_kv, app_json, app_json_b64, err, err_cap)) {
        ok = false;
        break;
      }
      usleep(1200000);
      continue;
    }
    if (action.type == ROUTE_ACTION_SLEEP_MS) {
      if (action.v0 > 0) usleep((useconds_t)action.v0 * 1000u);
      continue;
    }
    if (action.type == ROUTE_ACTION_TAP_PPM) {
      int x = bounds.x + (bounds.w * action.v0) / 1000;
      int y = bounds.y + (bounds.h * action.v1) / 1000;
      if (run_adb_input_tap(ctx->adb, ctx->serial, x, y) != 0) {
        if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "tap failed state=%s step=%zu", state, i);
        ok = false;
        break;
      }
      continue;
    }
    if (action.type == ROUTE_ACTION_KEYEVENT) {
      if (run_adb_input_keyevent(ctx->adb, ctx->serial, action.v0) != 0) {
        if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "keyevent failed state=%s step=%zu", state, i);
        ok = false;
        break;
      }
      continue;
    }
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "unknown action type state=%s step=%zu", state, i);
    ok = false;
    break;
  }

  route_action_list_free(&actions);
  return ok;
}

static bool rm_runtime_files(const char *adb, const char *serial, const char *runtime_pkg, const char *frame_dump_file) {
  if (runtime_pkg == NULL || runtime_pkg[0] == '\0') return false;
  bool no_foreground_switch =
      env_flag_enabled("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", false) ||
      env_flag_enabled("CHENG_ANDROID_NO_FOREGROUND_SWITCH", false);
  bool no_force_stop = env_flag_enabled("CHENG_ANDROID_NO_FORCE_STOP", false) || no_foreground_switch;
  if (!no_force_stop) {
    char *argv1[16];
    int n1 = adb_prefix_argv(adb, serial, argv1, (int)(sizeof(argv1) / sizeof(argv1[0])));
    if (n1 < 0) return false;
    argv1[n1++] = "shell";
    argv1[n1++] = "am";
    argv1[n1++] = "force-stop";
    argv1[n1++] = (char *)runtime_pkg;
    argv1[n1] = NULL;
    (void)run_command(argv1, NULL, 10);
  }

  char rm_runtime_arg[PATH_MAX];
  char rm_frame_arg[PATH_MAX];
  if (snprintf(rm_runtime_arg, sizeof(rm_runtime_arg), "files/cheng_runtime_state.json") >= (int)sizeof(rm_runtime_arg) ||
      snprintf(rm_frame_arg, sizeof(rm_frame_arg), "files/%s", frame_dump_file) >= (int)sizeof(rm_frame_arg)) {
    return false;
  }

  char *argv2[20];
  int n2 = adb_prefix_argv(adb, serial, argv2, (int)(sizeof(argv2) / sizeof(argv2[0])));
  if (n2 < 0) return false;
  argv2[n2++] = "shell";
  argv2[n2++] = "run-as";
  argv2[n2++] = (char *)runtime_pkg;
  argv2[n2++] = "rm";
  argv2[n2++] = "-f";
  argv2[n2++] = rm_runtime_arg;
  argv2[n2] = NULL;
  (void)run_command(argv2, NULL, 10);

  char *argv3[20];
  int n3 = adb_prefix_argv(adb, serial, argv3, (int)(sizeof(argv3) / sizeof(argv3[0])));
  if (n3 < 0) return false;
  argv3[n3++] = "shell";
  argv3[n3++] = "run-as";
  argv3[n3++] = (char *)runtime_pkg;
  argv3[n3++] = "rm";
  argv3[n3++] = "-f";
  argv3[n3++] = rm_frame_arg;
  argv3[n3] = NULL;
  (void)run_command(argv3, NULL, 10);

  return true;
}

static char *shell_single_quote(const char *text) {
  if (text == NULL) return strdup("''");
  size_t len = strlen(text);
  size_t cap = len * 4u + 3u;
  char *out = (char *)malloc(cap);
  if (out == NULL) return NULL;
  size_t j = 0u;
  out[j++] = '\'';
  for (size_t i = 0u; i < len; ++i) {
    if (text[i] == '\'') {
      if (j + 4u >= cap) {
        free(out);
        return NULL;
      }
      out[j++] = '\'';
      out[j++] = '\\';
      out[j++] = '\'';
      out[j++] = '\'';
    } else {
      if (j + 1u >= cap) {
        free(out);
        return NULL;
      }
      out[j++] = text[i];
    }
  }
  if (j + 2u > cap) {
    free(out);
    return NULL;
  }
  out[j++] = '\'';
  out[j] = '\0';
  return out;
}

static bool launch_activity(const char *adb,
                            const char *serial,
                            const char *runtime_activity,
                            const char *app_kv,
                            const char *app_json,
                            const char *app_json_b64,
                            char *err,
                            size_t err_cap) {
  if (runtime_activity == NULL || runtime_activity[0] == '\0') {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "missing runtime activity");
    return false;
  }
  char *q_kv = shell_single_quote(app_kv);
  char *q_json = shell_single_quote(app_json);
  char *q_json_b64 = shell_single_quote(app_json_b64);
  if (q_kv == NULL || q_json == NULL || q_json_b64 == NULL) {
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "quote launch args failed");
    return false;
  }

  char *q_activity = shell_single_quote(runtime_activity);
  if (q_activity == NULL) {
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "quote runtime activity failed");
    return false;
  }
  size_t cmd_len =
      strlen("am start -n  --es cheng_app_args_kv  --es cheng_app_args_json  --es cheng_app_args_json_b64 ") +
      strlen(q_activity) + strlen(q_kv) + strlen(q_json) + strlen(q_json_b64) + 1u;
  char *remote_cmd = (char *)malloc(cmd_len);
  if (remote_cmd == NULL) {
    free(q_activity);
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "oom building launch command");
    return false;
  }
  (void)snprintf(remote_cmd,
                 cmd_len,
                 "am start -n %s --es cheng_app_args_kv %s --es cheng_app_args_json %s --es cheng_app_args_json_b64 %s",
                 q_activity,
                 q_kv,
                 q_json,
                 q_json_b64);

  char *argv[12];
  int n = adb_prefix_argv(adb, serial, argv, (int)(sizeof(argv) / sizeof(argv[0])));
  if (n < 0) {
    free(remote_cmd);
    free(q_activity);
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    return false;
  }
  argv[n++] = "shell";
  argv[n++] = remote_cmd;
  argv[n] = NULL;

  char *out = NULL;
  int rc = capture_command_output_text(argv, 20, &out);
  if (rc != 0 || out == NULL) {
    if (err != NULL && err_cap > 0u) {
      snprintf(err, err_cap, "launch failed rc=%d", rc);
    }
    free(out);
    free(remote_cmd);
    free(q_activity);
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    return false;
  }
  bool ok = true;
  if (strstr(out, "Error:") != NULL || strstr(out, "does not exist") != NULL) {
    ok = false;
  }
  if (!ok && err != NULL && err_cap > 0u) {
    snprintf(err, err_cap, "launch error: %s", out);
  }
  free(out);
  free(remote_cmd);
  free(q_activity);
  free(q_kv);
  free(q_json);
  free(q_json_b64);
  return ok;
}

static uint32_t read_u32_le(const unsigned char *p) {
  return ((uint32_t)p[0]) | ((uint32_t)p[1] << 8u) | ((uint32_t)p[2] << 16u) | ((uint32_t)p[3] << 24u);
}

static bool capture_runtime_dump_rgba(const char *adb,
                                      const char *serial,
                                      const char *runtime_pkg,
                                      const char *frame_dump_file,
                                      unsigned char **rgba_out,
                                      size_t *rgba_len_out) {
  if (rgba_out != NULL) *rgba_out = NULL;
  if (rgba_len_out != NULL) *rgba_len_out = 0u;
  if (runtime_pkg == NULL || runtime_pkg[0] == '\0') return false;

  char frame_arg[PATH_MAX];
  if (snprintf(frame_arg, sizeof(frame_arg), "files/%s", frame_dump_file) >= (int)sizeof(frame_arg)) return false;

  char *argv[20];
  int n = adb_prefix_argv(adb, serial, argv, (int)(sizeof(argv) / sizeof(argv[0])));
  if (n < 0) return false;
  argv[n++] = "shell";
  argv[n++] = "run-as";
  argv[n++] = (char *)runtime_pkg;
  argv[n++] = "cat";
  argv[n++] = frame_arg;
  argv[n] = NULL;

  unsigned char *raw = NULL;
  size_t raw_len = 0u;
  int rc = capture_command_output_bytes(argv, 5, &raw, &raw_len);
  if (rc != 0 || raw == NULL || raw_len == 0u) {
    free(raw);
    return false;
  }
  if (rgba_out != NULL) *rgba_out = raw;
  else free(raw);
  if (rgba_len_out != NULL) *rgba_len_out = raw_len;
  return true;
}

static bool capture_screencap_rgba(const char *adb,
                                   const char *serial,
                                   unsigned char **rgba_out,
                                   size_t *rgba_len_out,
                                   int *out_w,
                                   int *out_h,
                                   int *out_fmt,
                                   char *err,
                                   size_t err_cap) {
  if (rgba_out != NULL) *rgba_out = NULL;
  if (rgba_len_out != NULL) *rgba_len_out = 0u;
  if (out_w != NULL) *out_w = 0;
  if (out_h != NULL) *out_h = 0;
  if (out_fmt != NULL) *out_fmt = 0;

  char *argv[16];
  int n = adb_prefix_argv(adb, serial, argv, (int)(sizeof(argv) / sizeof(argv[0])));
  if (n < 0) return false;
  argv[n++] = "exec-out";
  argv[n++] = "screencap";
  argv[n] = NULL;

  unsigned char *raw = NULL;
  size_t raw_len = 0u;
  int rc = capture_command_output_bytes(argv, 20, &raw, &raw_len);
  if (rc != 0 || raw == NULL) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "screencap failed rc=%d", rc);
    free(raw);
    return false;
  }
  if (raw_len < 12u) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "screencap too short");
    free(raw);
    return false;
  }

  uint32_t w = read_u32_le(raw);
  uint32_t h = read_u32_le(raw + 4u);
  uint32_t fmt = read_u32_le(raw + 8u);
  uint64_t wanted = (uint64_t)w * (uint64_t)h * 4u;
  if (wanted == 0u || raw_len < 12u + wanted) {
    if (err != NULL && err_cap > 0u) {
      snprintf(err, err_cap, "invalid screencap payload w=%u h=%u fmt=%u size=%zu", w, h, fmt, raw_len);
    }
    free(raw);
    return false;
  }

  unsigned char *rgba = (unsigned char *)malloc((size_t)wanted);
  if (rgba == NULL) {
    free(raw);
    return false;
  }
  memcpy(rgba, raw + 12u, (size_t)wanted);
  free(raw);

  if (rgba_out != NULL) *rgba_out = rgba;
  else free(rgba);
  if (rgba_len_out != NULL) *rgba_len_out = (size_t)wanted;
  if (out_w != NULL) *out_w = (int)w;
  if (out_h != NULL) *out_h = (int)h;
  if (out_fmt != NULL) *out_fmt = (int)fmt;
  return true;
}

static bool file_bytes_equal(const char *a, const char *b) {
  size_t na = 0u;
  size_t nb = 0u;
  char *da = read_file_all(a, &na);
  char *db = read_file_all(b, &nb);
  if (da == NULL || db == NULL) {
    free(da);
    free(db);
    return false;
  }
  bool eq = (na == nb && memcmp(da, db, na) == 0);
  free(da);
  free(db);
  return eq;
}

static void json_write_escaped(FILE *fp, const char *text) {
  if (fp == NULL) return;
  fputc('"', fp);
  if (text != NULL) {
    for (const char *p = text; *p != '\0'; ++p) {
      unsigned char ch = (unsigned char)*p;
      switch (ch) {
        case '\\': fputs("\\\\", fp); break;
        case '"': fputs("\\\"", fp); break;
        case '\n': fputs("\\n", fp); break;
        case '\r': fputs("\\r", fp); break;
        case '\t': fputs("\\t", fp); break;
        default:
          if (ch < 0x20u) {
            fprintf(fp, "\\u%04x", ch);
          } else {
            fputc((int)ch, fp);
          }
          break;
      }
    }
  }
  fputc('"', fp);
}

static bool parse_capture_source(const char *text) {
  return (strcmp(text, "runtime-dump") == 0 || strcmp(text, "screencap") == 0 || strcmp(text, "auto") == 0);
}

static bool parse_runtime_snapshot_ready(const RuntimeSnapshot *snap,
                                         const char *state,
                                         int expected_semantic_total_count,
                                         const char *expected_semantic_total_hash,
                                         int strict_semantic_hash,
                                         int strict_runtime_ready) {
  if (snap == NULL || state == NULL || state[0] == '\0') return false;
  if (!snap->started || !snap->native_ready) return false;
  if (!snap->semantic_nodes_loaded) return false;
  if (strict_runtime_ready && !snap->render_ready) return false;
  if (strict_runtime_ready && snap->semantic_nodes_applied_count <= 0) return false;
  if (strict_runtime_ready && strcmp(snap->route, state) != 0) return false;
  if (!runtime_hash_nonzero(snap->framehash)) return false;
  if (strict_runtime_ready && snap->semantic_ready != 1) return false;
  if (snap->semantic_total_count != expected_semantic_total_count) return false;
  if (strict_semantic_hash && !hash_hex_equal(snap->semantic_total_hash, expected_semantic_total_hash)) return false;
  if (strict_runtime_ready && snap->semantic_applied_count <= 0) return false;
  return true;
}

static bool launch_and_capture_once(const LaunchContext *ctx,
                                    const char *state,
                                    const char *expected_hash,
                                    int run_idx,
                                    RunRow *row,
                                    char *err,
                                    size_t err_cap) {
  if (ctx == NULL || state == NULL || expected_hash == NULL || row == NULL) return false;

  memset(row, 0, sizeof(*row));
  snprintf(row->state, sizeof(row->state), "%s", state);
  row->run = run_idx;
  snprintf(row->expected_runtime_framehash, sizeof(row->expected_runtime_framehash), "%s", expected_hash);

  char app_json[PATH_MAX * 2];
  int app_json_n = snprintf(app_json,
                            sizeof(app_json),
                            "{\"manifest\":\"%s\",\"mode\":\"android-semantic-visual-1to1\",\"routes\":%zu,\"route_state\":\"%s\"}",
                            ctx->manifest_json,
                            ctx->states->len,
                            state);
  if (app_json_n <= 0 || (size_t)app_json_n >= sizeof(app_json)) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "app json overflow");
    return false;
  }

  char *app_json_b64 = base64_urlsafe_encode((const unsigned char *)app_json, (size_t)app_json_n);
  if (app_json_b64 == NULL) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "app json base64 failed");
    return false;
  }

  char frame_dump_file[192];
  if (snprintf(frame_dump_file, sizeof(frame_dump_file), "r2c_frame_%s.run%d.rgba", state, run_idx) >=
      (int)sizeof(frame_dump_file)) {
    free(app_json_b64);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "frame dump file overflow");
    return false;
  }

  char app_kv[PATH_MAX * 2];
  int app_kv_n = snprintf(app_kv,
                          sizeof(app_kv),
                          "r2c_manifest=%s;route_state=%s;gate_mode=android-semantic-visual-1to1;expected_framehash=%s;frame_dump_file=%s",
                          ctx->manifest_json,
                          state,
                          expected_hash,
                          frame_dump_file);
  if (app_kv_n <= 0 || (size_t)app_kv_n >= sizeof(app_kv)) {
    free(app_json_b64);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "app kv overflow");
    return false;
  }

  const char *replay_base_env = getenv("CHENG_ANDROID_FULLROUTE_REPLAY_BASE_ROUTE");
  const char *replay_launch_state = NULL;
  if (strcmp(state, "lang_select") == 0) {
    replay_launch_state = "lang_select";
  } else if (replay_base_env != NULL && replay_base_env[0] != '\0') {
    replay_launch_state = replay_base_env;
  } else {
    replay_launch_state = "home_default";
  }
  bool replay_has_override = (strcmp(replay_launch_state, state) != 0);
  char replay_app_json[PATH_MAX * 2];
  char replay_app_kv[PATH_MAX * 2];
  char *replay_app_json_b64 = NULL;
  if (replay_has_override) {
    int replay_json_n = snprintf(replay_app_json,
                                 sizeof(replay_app_json),
                                 "{\"manifest\":\"%s\",\"mode\":\"android-semantic-visual-1to1\",\"routes\":%zu,\"route_state\":\"%s\"}",
                                 ctx->manifest_json,
                                 ctx->states->len,
                                 replay_launch_state);
    if (replay_json_n <= 0 || (size_t)replay_json_n >= sizeof(replay_app_json)) {
      free(app_json_b64);
      if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "replay app json overflow");
      return false;
    }
    int replay_kv_n = snprintf(replay_app_kv,
                               sizeof(replay_app_kv),
                               "r2c_manifest=%s;route_state=%s;gate_mode=android-semantic-visual-1to1;expected_framehash=%s;frame_dump_file=%s",
                               ctx->manifest_json,
                               replay_launch_state,
                               expected_hash,
                               frame_dump_file);
    if (replay_kv_n <= 0 || (size_t)replay_kv_n >= sizeof(replay_app_kv)) {
      free(app_json_b64);
      if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "replay app kv overflow");
      return false;
    }
    replay_app_json_b64 = base64_urlsafe_encode((const unsigned char *)replay_app_json, (size_t)replay_json_n);
    if (replay_app_json_b64 == NULL) {
      free(app_json_b64);
      if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "replay app json base64 failed");
      return false;
    }
  }

  if (!rm_runtime_files(ctx->adb, ctx->serial, ctx->runtime_package, frame_dump_file)) {
    free(replay_app_json_b64);
    free(app_json_b64);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "pre-clean failed");
    return false;
  }
  bool launched = false;
  bool replay_used = false;
  bool enable_action_replay = false;
  const char *replay_actions_env = getenv("CHENG_ANDROID_FULLROUTE_REPLAY_ACTIONS");
  if (replay_actions_env != NULL && replay_actions_env[0] != '\0') {
    enable_action_replay = (strcmp(replay_actions_env, "1") == 0);
  }
  if (enable_action_replay && ctx->route_actions_path != NULL && ctx->route_actions_path[0] != '\0') {
    const char *launch_kv = replay_has_override ? replay_app_kv : app_kv;
    const char *launch_json = replay_has_override ? replay_app_json : app_json;
    const char *launch_json_b64 = replay_has_override ? replay_app_json_b64 : app_json_b64;
    if (replay_route_actions(ctx, state, launch_kv, launch_json, launch_json_b64, err, err_cap)) {
      launched = true;
      replay_used = true;
    }
  }
  if (!launched) {
    if (!launch_activity(ctx->adb, ctx->serial, ctx->runtime_activity, app_kv, app_json, app_json_b64, err, err_cap)) {
      free(replay_app_json_b64);
      free(app_json_b64);
      return false;
    }
  }
  free(replay_app_json_b64);
  free(app_json_b64);

  RuntimeSnapshot latest;
  memset(&latest, 0, sizeof(latest));
  bool got_runtime = false;

  char runtime_path[PATH_MAX];
  if (snprintf(runtime_path, sizeof(runtime_path), "%s/%s.run%d.runtime.json", ctx->capture_dir, state, run_idx) >=
      (int)sizeof(runtime_path)) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "runtime path overflow");
    return false;
  }

  int loops = (ctx->wait_ms <= 0) ? 1 : (ctx->wait_ms / 250);
  if (loops < 1) loops = 1;

  for (int i = 0; i < loops; ++i) {
    RuntimeSnapshot snap;
    if (pull_runtime_state(ctx->adb, ctx->serial, ctx->runtime_package, runtime_path, &snap)) {
      latest = snap;
      got_runtime = true;
      if (parse_runtime_snapshot_ready(&snap,
                                       state,
                                       ctx->expected_semantic_total_count,
                                       ctx->expected_semantic_total_hash,
                                       ctx->strict_semantic_hash,
                                       ctx->strict_runtime_ready)) {
        break;
      }
    }
    usleep(250000);
  }

  if (!got_runtime) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "missing runtime state for state=%s run=%d", state, run_idx);
    return false;
  }
  if (!latest.started) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "started=false state=%s run=%d", state, run_idx);
    return false;
  }
  if (!latest.native_ready) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "native_ready=false state=%s run=%d", state, run_idx);
    return false;
  }
  const char *route_state_for_check = (replay_used && replay_has_override) ? replay_launch_state : state;
  if (!kv_has_key_value(latest.launch_args_kv, "route_state", route_state_for_check)) {
    if (err != NULL && err_cap > 0u) {
      snprintf(err,
               err_cap,
               "launch args route_state mismatch state=%s run=%d expected=%s",
               state,
               run_idx,
               route_state_for_check);
    }
    return false;
  }
  if (!kv_has_key_value(latest.launch_args_kv, "expected_framehash", expected_hash)) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "launch args expected_framehash mismatch state=%s run=%d", state, run_idx);
    return false;
  }
  if (ctx->strict_runtime_ready && !latest.render_ready) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "render_ready=false state=%s run=%d", state, run_idx);
    return false;
  }
  if (!latest.semantic_nodes_loaded) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "semantic_nodes_loaded=false state=%s run=%d", state, run_idx);
    return false;
  }
  if (ctx->strict_runtime_ready && latest.semantic_nodes_applied_count <= 0) {
    if (err != NULL && err_cap > 0u) {
      snprintf(err,
               err_cap,
               "semantic_nodes_applied_count<=0 state=%s run=%d value=%lld",
               state,
               run_idx,
               latest.semantic_nodes_applied_count);
    }
    return false;
  }
  if (ctx->strict_runtime_ready && strcmp(latest.route, state) != 0) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "route mismatch state=%s run=%d got=%s", state, run_idx, latest.route);
    return false;
  }
  if (!runtime_hash_nonzero(latest.framehash)) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "runtime framehash invalid state=%s run=%d", state, run_idx);
    return false;
  }
  if (ctx->strict_runtime_ready && latest.semantic_ready != 1) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "semantic runtime not ready state=%s run=%d", state, run_idx);
    return false;
  }
  if (latest.semantic_total_count != ctx->expected_semantic_total_count) {
    if (err != NULL && err_cap > 0u) {
      snprintf(err,
               err_cap,
               "semantic total count mismatch state=%s run=%d expected=%d got=%d",
               state,
               run_idx,
               ctx->expected_semantic_total_count,
               latest.semantic_total_count);
    }
    return false;
  }
  if (!hash_hex_equal(latest.semantic_total_hash, ctx->expected_semantic_total_hash)) {
    if (!ctx->strict_semantic_hash) {
      fprintf(stderr,
              "[verify-android-fullroute-pixel] warn: semantic total hash drift state=%s run=%d expected=%s got=%s\n",
              state,
              run_idx,
              ctx->expected_semantic_total_hash,
              latest.semantic_total_hash);
    } else {
      if (err != NULL && err_cap > 0u) {
        snprintf(err,
                 err_cap,
                 "semantic total hash mismatch state=%s run=%d expected=%s got=%s",
                 state,
                 run_idx,
                 ctx->expected_semantic_total_hash,
                 latest.semantic_total_hash);
      }
      return false;
    }
  }
  if (ctx->strict_runtime_ready && latest.semantic_applied_count <= 0) {
    if (err != NULL && err_cap > 0u) {
      snprintf(err, err_cap, "semantic applied count invalid state=%s run=%d value=%d", state, run_idx, latest.semantic_applied_count);
    }
    return false;
  }

  unsigned char *rgba = NULL;
  size_t rgba_len = 0u;
  int width = 0;
  int height = 0;
  int format = 0;

  if (strcmp(ctx->capture_source, "runtime-dump") == 0 || strcmp(ctx->capture_source, "auto") == 0) {
    int dump_loops = loops;
    for (int i = 0; i < dump_loops; ++i) {
      if (capture_runtime_dump_rgba(ctx->adb, ctx->serial, ctx->runtime_package, frame_dump_file, &rgba, &rgba_len)) {
        break;
      }
      usleep(250000);
    }
    if (rgba == NULL && strcmp(ctx->capture_source, "runtime-dump") == 0) {
      if (err != NULL && err_cap > 0u) {
        snprintf(err,
                 err_cap,
                 "missing runtime dump state=%s run=%d file=%s",
                 state,
                 run_idx,
                 frame_dump_file);
      }
      return false;
    }
  }
  if (rgba == NULL &&
      (strcmp(ctx->capture_source, "runtime-dump") == 0 ||
       strcmp(ctx->capture_source, "screencap") == 0 ||
       strcmp(ctx->capture_source, "auto") == 0)) {
    if (!capture_screencap_rgba(ctx->adb, ctx->serial, &rgba, &rgba_len, &width, &height, &format, err, err_cap)) {
      free(rgba);
      return false;
    }
  }
  if (rgba == NULL || rgba_len == 0u) {
    free(rgba);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "no capture data state=%s run=%d", state, run_idx);
    return false;
  }

  char capture_path[PATH_MAX];
  if (snprintf(capture_path, sizeof(capture_path), "%s/%s.run%d.rgba.out", ctx->capture_dir, state, run_idx) >=
      (int)sizeof(capture_path)) {
    free(rgba);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "capture path overflow");
    return false;
  }
  if (write_file_all(capture_path, (const char *)rgba, rgba_len) != 0) {
    free(rgba);
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "write capture failed");
    return false;
  }

  uint64_t capture_hash = fnv1a64_buffer(rgba, rgba_len);
  free(rgba);

  char capture_hash_hex[64];
  to_hex64(capture_hash, capture_hash_hex, sizeof(capture_hash_hex));
  bool runtime_hash_matches_capture = hash_hex_equal(latest.framehash, capture_hash_hex);
  bool framehash_match = hash_hex_equal(capture_hash_hex, expected_hash);
  if (ctx->strict_framehash == 1 && !framehash_match) {
    if (err != NULL && err_cap > 0u) {
      snprintf(err,
               err_cap,
               "framehash mismatch state=%s run=%d expected=%s capture=%s runtime=%s",
               state,
               run_idx,
               expected_hash,
               capture_hash_hex,
               latest.framehash);
    }
    return false;
  }

  char capture_framehash_path[PATH_MAX];
  if (snprintf(capture_framehash_path,
               sizeof(capture_framehash_path),
               "%s/%s.run%d.capture.framehash",
               ctx->capture_dir,
               state,
               run_idx) >= (int)sizeof(capture_framehash_path)) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "capture framehash path overflow");
    return false;
  }
  char capture_hash_line[128];
  int hash_n = snprintf(capture_hash_line, sizeof(capture_hash_line), "%s\n", capture_hash_hex);
  if (hash_n <= 0 || (size_t)hash_n >= sizeof(capture_hash_line) ||
      write_file_all(capture_framehash_path, capture_hash_line, (size_t)hash_n) != 0) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "write capture framehash failed");
    return false;
  }

  char route_path[PATH_MAX];
  if (snprintf(route_path, sizeof(route_path), "%s/%s.run%d.route", ctx->capture_dir, state, run_idx) >=
      (int)sizeof(route_path)) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "route path overflow");
    return false;
  }
  char route_line[256];
  int route_n = snprintf(route_line, sizeof(route_line), "%s\n", state);
  if (route_n <= 0 || (size_t)route_n >= sizeof(route_line) ||
      write_file_all(route_path, route_line, (size_t)route_n) != 0) {
    if (err != NULL && err_cap > 0u) snprintf(err, err_cap, "write route marker failed");
    return false;
  }

  snprintf(row->route, sizeof(row->route), "%s", latest.route);
  snprintf(row->runtime_framehash, sizeof(row->runtime_framehash), "%s", latest.framehash);
  row->runtime_framehash_match = framehash_match;
  row->runtime_reported_framehash_match_capture = runtime_hash_matches_capture;
  row->runtime_route_match = (strcmp(latest.route, state) == 0);
  row->runtime_render_ready = latest.render_ready;
  row->runtime_semantic_nodes_loaded = latest.semantic_nodes_loaded;
  row->runtime_semantic_nodes_applied_count = (int)latest.semantic_nodes_applied_count;
  row->runtime_semantic_ready = (latest.semantic_ready == 1);
  row->runtime_semantic_total_count = latest.semantic_total_count;
  snprintf(row->runtime_semantic_total_hash, sizeof(row->runtime_semantic_total_hash), "%s", latest.semantic_total_hash);
  row->runtime_semantic_applied_count = latest.semantic_applied_count;
  snprintf(row->runtime_semantic_applied_hash, sizeof(row->runtime_semantic_applied_hash), "%s", latest.semantic_applied_hash);
  snprintf(row->capture_framehash, sizeof(row->capture_framehash), "%s", capture_hash_hex);
  row->capture_bytes = rgba_len;
  snprintf(row->capture_path, sizeof(row->capture_path), "%s", capture_path);
  snprintf(row->runtime_state_path, sizeof(row->runtime_state_path), "%s", runtime_path);
  row->width = width;
  row->height = height;
  row->format = format;

  return true;
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
      path_join(manifest_default,
                sizeof(manifest_default),
                root,
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

  int consistency_runs = 3;
  int strict_capture = 1;
  int launch_retries = 2;
  int strict_framehash = 0;
  int strict_semantic_hash = 0;
  int strict_runtime_ready = 0;
  int wait_ms = 12000;
  const char *capture_source = getenv("CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE");
  if (capture_source == NULL || capture_source[0] == '\0') capture_source = "runtime-dump";

  const char *runs_env = getenv("R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS");
  if (runs_env != NULL && runs_env[0] != '\0') {
    int v = atoi(runs_env);
    if (v > 0) consistency_runs = v;
  }
  const char *strict_env = getenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE");
  if (strict_env != NULL && strict_env[0] != '\0') {
    strict_capture = (strcmp(strict_env, "0") == 0) ? 0 : 1;
  }
  const char *retries_env = getenv("CHENG_ANDROID_FULLROUTE_LAUNCH_RETRIES");
  if (retries_env != NULL && retries_env[0] != '\0') {
    int v = atoi(retries_env);
    if (v > 0) launch_retries = v;
  }
  const char *strict_framehash_env = getenv("CHENG_ANDROID_FULLROUTE_STRICT_FRAMEHASH");
  if (strict_framehash_env != NULL && strict_framehash_env[0] != '\0') {
    strict_framehash = (strcmp(strict_framehash_env, "0") == 0) ? 0 : 1;
  }
  const char *strict_semantic_hash_env = getenv("CHENG_ANDROID_FULLROUTE_STRICT_SEMANTIC_HASH");
  if (strict_semantic_hash_env != NULL && strict_semantic_hash_env[0] != '\0') {
    strict_semantic_hash = (strcmp(strict_semantic_hash_env, "0") == 0) ? 0 : 1;
  }
  const char *strict_runtime_ready_env = getenv("CHENG_ANDROID_FULLROUTE_STRICT_RUNTIME_READY");
  if (strict_runtime_ready_env != NULL && strict_runtime_ready_env[0] != '\0') {
    strict_runtime_ready = (strcmp(strict_runtime_ready_env, "0") == 0) ? 0 : 1;
  }
  const char *wait_env = getenv("CHENG_ANDROID_FULLROUTE_RUNTIME_WAIT_MS");
  if (wait_env != NULL && wait_env[0] != '\0') {
    int v = atoi(wait_env);
    if (v >= 1000) wait_ms = v;
  }

  if (!parse_capture_source(capture_source)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] invalid capture source: %s\n", capture_source);
    return 2;
  }

  char adb_path[PATH_MAX];
  if (!resolve_adb_executable(adb_path, sizeof(adb_path))) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing dependency: adb\n");
    return 2;
  }

  char serial[128];
  if (!detect_android_serial(adb_path, serial, sizeof(serial))) {
    fprintf(stderr, "[verify-android-fullroute-pixel] no android device/emulator detected\n");
    return 1;
  }

  const char *runtime_package = getenv("CHENG_ANDROID_APP_PACKAGE");
  if (runtime_package == NULL || runtime_package[0] == '\0') runtime_package = "com.unimaker.app";
  const char *runtime_activity = getenv("CHENG_ANDROID_APP_ACTIVITY");
  char runtime_activity_auto[256];
  runtime_activity_auto[0] = '\0';
  if (runtime_activity == NULL || runtime_activity[0] == '\0') {
    runtime_activity = infer_main_activity_for_package(runtime_package, runtime_activity_auto, sizeof(runtime_activity_auto));
  }

  char states_json[PATH_MAX];
  char manifest_json[PATH_MAX];
  char compile_report_json[PATH_MAX];
  if (path_join(states_json, sizeof(states_json), compile_out, "r2capp/r2c_fullroute_states.json") != 0 ||
      path_join(manifest_json, sizeof(manifest_json), compile_out, "r2capp/r2capp_manifest.json") != 0 ||
      path_join(compile_report_json, sizeof(compile_report_json), compile_out, "r2capp/r2capp_compile_report.json") != 0) {
    return 1;
  }
  if (!file_exists(states_json)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing fullroute states: %s\n", states_json);
    return 1;
  }
  if (!file_exists(manifest_json)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing app manifest: %s\n", manifest_json);
    return 1;
  }
  if (!file_exists(compile_report_json)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing compile report: %s\n", compile_report_json);
    return 1;
  }

  StringList states;
  memset(&states, 0, sizeof(states));
  if (!parse_states(states_json, &states)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] states list is empty\n");
    strlist_free(&states);
    return 1;
  }

  size_t report_len = 0u;
  char *report_doc = read_file_all(compile_report_json, &report_len);
  if (report_doc == NULL) {
    fprintf(stderr, "[verify-android-fullroute-pixel] cannot read compile report\n");
    strlist_free(&states);
    return 1;
  }

  bool template_runtime_used = true;
  if (!json_get_bool(report_doc, "template_runtime_used", &template_runtime_used) || template_runtime_used) {
    fprintf(stderr, "[verify-android-fullroute-pixel] semantic readiness failed: template_runtime_used=true\n");
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  int expected_semantic_total_count = 0;
  if (!json_get_int32(report_doc, "semantic_render_nodes_count", &expected_semantic_total_count) ||
      expected_semantic_total_count <= 0) {
    fprintf(stderr, "[verify-android-fullroute-pixel] invalid semantic_render_nodes_count in compile report\n");
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  char expected_semantic_total_hash[64];
  expected_semantic_total_hash[0] = '\0';
  if (!json_get_string(report_doc,
                       "semantic_render_nodes_fnv64",
                       expected_semantic_total_hash,
                       sizeof(expected_semantic_total_hash)) ||
      !normalize_hash_hex(expected_semantic_total_hash, expected_semantic_total_hash, sizeof(expected_semantic_total_hash)) ||
      strlen(expected_semantic_total_hash) != 16u) {
    fprintf(stderr, "[verify-android-fullroute-pixel] invalid semantic_render_nodes_fnv64 in compile report\n");
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  char semantic_runtime_map_path_raw[PATH_MAX];
  semantic_runtime_map_path_raw[0] = '\0';
  if (!json_get_string(report_doc,
                       "semantic_runtime_map_path",
                       semantic_runtime_map_path_raw,
                       sizeof(semantic_runtime_map_path_raw))) {
    fprintf(stderr, "[verify-android-fullroute-pixel] semantic readiness failed: missing semantic_runtime_map_path\n");
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  char semantic_runtime_map_path[PATH_MAX];
  snprintf(semantic_runtime_map_path, sizeof(semantic_runtime_map_path), "%s", semantic_runtime_map_path_raw);
  if (!file_exists(semantic_runtime_map_path)) {
    char cand1[PATH_MAX];
    char cand2[PATH_MAX];
    cand1[0] = '\0';
    cand2[0] = '\0';
    (void)path_join(cand1, sizeof(cand1), compile_out, semantic_runtime_map_path_raw);
    (void)path_join(cand2, sizeof(cand2), compile_out, "r2capp");
    if (cand2[0] != '\0') {
      char tmp[PATH_MAX];
      if (path_join(tmp, sizeof(tmp), cand2, semantic_runtime_map_path_raw) == 0 && file_exists(tmp)) {
        snprintf(semantic_runtime_map_path, sizeof(semantic_runtime_map_path), "%s", tmp);
      }
    }
    if (!file_exists(semantic_runtime_map_path) && cand1[0] != '\0' && file_exists(cand1)) {
      snprintf(semantic_runtime_map_path, sizeof(semantic_runtime_map_path), "%s", cand1);
    }
  }
  if (!file_exists(semantic_runtime_map_path)) {
    fprintf(stderr,
            "[verify-android-fullroute-pixel] semantic readiness failed: missing semantic_runtime_map_path=%s\n",
            semantic_runtime_map_path_raw);
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  if (!check_semantic_runtime_map(semantic_runtime_map_path, &states, expected_semantic_total_count)) {
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  char route_actions_path_raw[PATH_MAX];
  route_actions_path_raw[0] = '\0';
  if (!json_get_string(report_doc,
                       "route_actions_android_path",
                       route_actions_path_raw,
                       sizeof(route_actions_path_raw))) {
    fprintf(stderr, "[verify-android-fullroute-pixel] missing route_actions_android_path in compile report\n");
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  char route_actions_path[PATH_MAX];
  snprintf(route_actions_path, sizeof(route_actions_path), "%s", route_actions_path_raw);
  if (!file_exists(route_actions_path)) {
    char cand1[PATH_MAX];
    char cand2[PATH_MAX];
    cand1[0] = '\0';
    cand2[0] = '\0';
    (void)path_join(cand1, sizeof(cand1), compile_out, route_actions_path_raw);
    (void)path_join(cand2, sizeof(cand2), compile_out, "r2capp");
    if (cand2[0] != '\0') {
      char tmp[PATH_MAX];
      if (path_join(tmp, sizeof(tmp), cand2, route_actions_path_raw) == 0 && file_exists(tmp)) {
        snprintf(route_actions_path, sizeof(route_actions_path), "%s", tmp);
      }
    }
    if (!file_exists(route_actions_path) && cand1[0] != '\0' && file_exists(cand1)) {
      snprintf(route_actions_path, sizeof(route_actions_path), "%s", cand1);
    }
  }
  if (!file_exists(route_actions_path)) {
    fprintf(stderr,
            "[verify-android-fullroute-pixel] missing route actions: %s\n",
            route_actions_path_raw);
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  TruthStateList truths;
  memset(&truths, 0, sizeof(truths));
  if (!parse_truth_manifest(truth_manifest, &truths)) {
    fprintf(stderr, "[verify-android-fullroute-pixel] truth manifest states empty\n");
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  char captures_dir[PATH_MAX];
  if (path_join(captures_dir, sizeof(captures_dir), out_dir, "captures") != 0 || ensure_dir(captures_dir) != 0) {
    truth_list_free(&truths);
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  char report_path[PATH_MAX];
  if (path_join(report_path, sizeof(report_path), out_dir, "android_fullroute_visual_report.json") != 0) {
    truth_list_free(&truths);
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  FILE *rp = fopen(report_path, "wb");
  if (rp == NULL) {
    truth_list_free(&truths);
    free(report_doc);
    strlist_free(&states);
    return 1;
  }

  fprintf(rp,
          "{\n"
          "  \"format\": \"android-fullroute-visual-gate-v1\",\n"
          "  \"states\": [\n");
  for (size_t i = 0u; i < states.len; ++i) {
    fprintf(rp, "%s    ", (i == 0u ? "" : ",\n"));
    json_write_escaped(rp, states.items[i]);
    fprintf(rp, "\n");
  }
  fprintf(rp,
          "  ],\n"
          "  \"consistency_runs\": %d,\n"
          "  \"strict_capture\": %d,\n"
          "  \"launch_retries\": %d,\n"
          "  \"capture_source\": ",
          consistency_runs,
          strict_capture,
          launch_retries);
  json_write_escaped(rp, capture_source);
  fprintf(rp,
          ",\n"
          "  \"strict_framehash\": %d,\n"
          "  \"strict_semantic_hash\": %d,\n"
          "  \"strict_runtime_ready\": %d,\n"
          "  \"expected_semantic_total_count\": %d,\n"
          "  \"expected_semantic_total_hash\": ",
          strict_framehash,
          strict_semantic_hash,
          strict_runtime_ready,
          expected_semantic_total_count);
  json_write_escaped(rp, expected_semantic_total_hash);
  fprintf(rp, ",\n  \"captures\": {\n");

  LaunchContext ctx;
  memset(&ctx, 0, sizeof(ctx));
  ctx.adb = adb_path;
  ctx.serial = serial;
  ctx.runtime_package = runtime_package;
  ctx.runtime_activity = runtime_activity;
  ctx.manifest_json = manifest_json;
  ctx.route_actions_path = route_actions_path;
  ctx.states = &states;
  ctx.capture_dir = captures_dir;
  ctx.capture_source = capture_source;
  ctx.strict_framehash = strict_framehash;
  ctx.strict_semantic_hash = strict_semantic_hash;
  ctx.strict_runtime_ready = strict_runtime_ready;
  ctx.wait_ms = wait_ms;
  ctx.expected_semantic_total_count = expected_semantic_total_count;
  ctx.expected_semantic_total_hash = expected_semantic_total_hash;

  size_t routes_ok = 0u;
  bool include_first_install_route = false;
  const char *first_install_env = getenv("CHENG_ANDROID_FIRST_INSTALL_PASS");
  if (first_install_env != NULL && strcmp(first_install_env, "1") == 0) include_first_install_route = true;

  for (size_t i = 0u; i < states.len; ++i) {
    const char *state = states.items[i];
    if (!include_first_install_route && strcmp(state, "lang_select") == 0) {
      fprintf(stdout,
              "[verify-android-fullroute-pixel] skip first-install route state=%s (CHENG_ANDROID_FIRST_INSTALL_PASS!=1)\n",
              state);
      continue;
    }
    const TruthState *truth = truth_list_find(&truths, state);
    if (truth == NULL) {
      fprintf(stderr, "[verify-android-fullroute-pixel] states missing in truth manifest: %s\n", state);
      fclose(rp);
      truth_list_free(&truths);
      free(report_doc);
      strlist_free(&states);
      return 1;
    }

    if (strict_capture == 1) {
      if (strcmp(capture_source, "runtime-dump") != 0) {
        if (truth->rgba_path[0] == '\0' || !file_exists(truth->rgba_path)) {
          fprintf(stderr, "[verify-android-fullroute-pixel] strict mode missing golden rgba file: %s\n", state);
          fclose(rp);
          truth_list_free(&truths);
          free(report_doc);
          strlist_free(&states);
          return 1;
        }
      }
      if (truth->framehash_path[0] == '\0' || !file_exists(truth->framehash_path)) {
        fprintf(stderr, "[verify-android-fullroute-pixel] strict mode missing golden framehash file: %s\n", state);
        fclose(rp);
        truth_list_free(&truths);
        free(report_doc);
        strlist_free(&states);
        return 1;
      }
    }

    char expected_hash[64];
    expected_hash[0] = '\0';
    bool expected_hash_ok = false;

    /* Runtime-dump capture should compare against runtime_framehash when available. */
    if ((strcmp(capture_source, "runtime-dump") == 0 || strcmp(capture_source, "auto") == 0) &&
        truth->framehash_path[0] != '\0') {
      char runtime_hash_path[PATH_MAX];
      runtime_hash_path[0] = '\0';
      if (ends_with(truth->framehash_path, ".framehash")) {
        size_t base_len = strlen(truth->framehash_path) - strlen(".framehash");
        if (base_len + strlen(".runtime_framehash") + 1u < sizeof(runtime_hash_path)) {
          memcpy(runtime_hash_path, truth->framehash_path, base_len);
          runtime_hash_path[base_len] = '\0';
          strcat(runtime_hash_path, ".runtime_framehash");
        }
      } else if (snprintf(runtime_hash_path,
                          sizeof(runtime_hash_path),
                          "%s.runtime_framehash",
                          truth->framehash_path) >= (int)sizeof(runtime_hash_path)) {
        runtime_hash_path[0] = '\0';
      }
      if (runtime_hash_path[0] != '\0' && file_exists(runtime_hash_path) &&
          read_framehash_file(runtime_hash_path, expected_hash, sizeof(expected_hash)) &&
          runtime_hash_nonzero(expected_hash)) {
        expected_hash_ok = true;
      }
    }

    if (!expected_hash_ok &&
        normalize_hash_hex(truth->framehash, expected_hash, sizeof(expected_hash)) &&
        runtime_hash_nonzero(expected_hash)) {
      expected_hash_ok = true;
    }
    if (!expected_hash_ok &&
        truth->framehash_path[0] != '\0' &&
        read_framehash_file(truth->framehash_path, expected_hash, sizeof(expected_hash)) &&
        runtime_hash_nonzero(expected_hash)) {
      expected_hash_ok = true;
    }
    if (!expected_hash_ok) {
      fprintf(stderr, "[verify-android-fullroute-pixel] missing/invalid expected framehash for state=%s\n", state);
      fclose(rp);
      truth_list_free(&truths);
      free(report_doc);
      strlist_free(&states);
      return 1;
    }

    RunRow *rows = (RunRow *)calloc((size_t)consistency_runs, sizeof(RunRow));
    if (rows == NULL) {
      fclose(rp);
      truth_list_free(&truths);
      free(report_doc);
      strlist_free(&states);
      return 1;
    }

    for (int run_idx = 1; run_idx <= consistency_runs; ++run_idx) {
      bool ok = false;
      char last_err[1024];
      last_err[0] = '\0';
      for (int attempt = 1; attempt <= launch_retries; ++attempt) {
        if (launch_and_capture_once(&ctx,
                                    state,
                                    expected_hash,
                                    run_idx,
                                    &rows[(size_t)(run_idx - 1)],
                                    last_err,
                                    sizeof(last_err))) {
          ok = true;
          break;
        }
        if (attempt < launch_retries) usleep(250000);
      }
      if (!ok) {
        fprintf(stderr,
                "[verify-android-fullroute-pixel] launch retries exhausted state=%s run=%d err=%s\n",
                state,
                run_idx,
                last_err);
        free(rows);
        fclose(rp);
        truth_list_free(&truths);
        free(report_doc);
        strlist_free(&states);
        return 1;
      }
    }

    bool drift = false;
    bool semantic_drift = false;
    for (int run_idx = 2; run_idx <= consistency_runs; ++run_idx) {
      RunRow *first = &rows[0];
      RunRow *cur = &rows[(size_t)(run_idx - 1)];
      if (!hash_hex_equal(cur->capture_framehash, first->capture_framehash)) {
        drift = true;
        if (strict_capture == 1) {
          fprintf(stderr,
                  "[verify-android-fullroute-pixel] non-deterministic capture framehash state=%s run=%d expected=%s got=%s\n",
                  state,
                  run_idx,
                  first->capture_framehash,
                  cur->capture_framehash);
          free(rows);
          fclose(rp);
          truth_list_free(&truths);
          free(report_doc);
          strlist_free(&states);
          return 1;
        }
      }
      if (!hash_hex_equal(cur->runtime_semantic_applied_hash, first->runtime_semantic_applied_hash)) {
        semantic_drift = true;
        if (strict_capture == 1) {
          fprintf(stderr,
                  "[verify-android-fullroute-pixel] non-deterministic semantic applied hash state=%s run=%d expected=%s got=%s\n",
                  state,
                  run_idx,
                  first->runtime_semantic_applied_hash,
                  cur->runtime_semantic_applied_hash);
          free(rows);
          fclose(rp);
          truth_list_free(&truths);
          free(report_doc);
          strlist_free(&states);
          return 1;
        }
      }
      if (cur->runtime_semantic_applied_count != rows[0].runtime_semantic_applied_count) {
        semantic_drift = true;
        if (strict_capture == 1) {
          fprintf(stderr,
                  "[verify-android-fullroute-pixel] non-deterministic semantic applied count state=%s run=%d expected=%d got=%d\n",
                  state,
                  run_idx,
                  rows[0].runtime_semantic_applied_count,
                  cur->runtime_semantic_applied_count);
          free(rows);
          fclose(rp);
          truth_list_free(&truths);
          free(report_doc);
          strlist_free(&states);
          return 1;
        }
      }
    }

    bool golden_match = false;
    bool enforce_pixel_strict = (strict_capture == 1 && strcmp(capture_source, "runtime-dump") != 0);
    if (truth->rgba_path[0] != '\0' && file_exists(truth->rgba_path)) {
      golden_match = file_bytes_equal(rows[0].capture_path, truth->rgba_path);
      if (enforce_pixel_strict && !golden_match) {
        fprintf(stderr,
                "[verify-android-fullroute-pixel] pixel mismatch state=%s capture=%s golden=%s\n",
                state,
                rows[0].capture_path,
                truth->rgba_path);
        free(rows);
        fclose(rp);
        truth_list_free(&truths);
        free(report_doc);
        strlist_free(&states);
        return 1;
      }
    } else if (enforce_pixel_strict) {
      fprintf(stderr, "[verify-android-fullroute-pixel] missing golden rgba path for state=%s\n", state);
      free(rows);
      fclose(rp);
      truth_list_free(&truths);
      free(report_doc);
      strlist_free(&states);
      return 1;
    }

    fprintf(rp, "%s    ", (routes_ok == 0u ? "" : ",\n"));
    json_write_escaped(rp, state);
    fprintf(rp,
            ": {\n"
            "      \"expected_runtime_framehash\": ");
    json_write_escaped(rp, expected_hash);
    fprintf(rp,
            ",\n"
            "      \"expected_semantic_total_count\": %d,\n"
            "      \"expected_semantic_total_hash\": ",
            expected_semantic_total_count);
    json_write_escaped(rp, expected_semantic_total_hash);
    fprintf(rp,
            ",\n"
            "      \"manifest_rgba_sha256\": ");
    json_write_escaped(rp, truth->rgba_sha256);
    fprintf(rp,
            ",\n"
            "      \"manifest_rgba_bytes\": %lld,\n"
            "      \"manifest_rgba_path\": ",
            truth->rgba_bytes);
    json_write_escaped(rp, truth->rgba_path);
    fprintf(rp,
            ",\n"
            "      \"manifest_framehash_path\": ");
    json_write_escaped(rp, truth->framehash_path);
    fprintf(rp,
            ",\n"
            "      \"capture_framehash\": ");
    json_write_escaped(rp, rows[0].capture_framehash);
    fprintf(rp,
            ",\n"
            "      \"capture_drift_detected\": %s,\n"
            "      \"semantic_drift_detected\": %s,\n"
            "      \"capture_golden_match\": %s,\n"
            "      \"runtime_route_match\": %s,\n"
            "      \"render_ready\": %s,\n"
            "      \"semantic_nodes_loaded\": %s,\n"
            "      \"semantic_nodes_applied_count\": %d,\n"
            "      \"runtime_semantic_ready\": %s,\n"
            "      \"runtime_semantic_total_count\": %d,\n"
            "      \"runtime_semantic_total_hash\": ",
            drift ? "true" : "false",
            semantic_drift ? "true" : "false",
            golden_match ? "true" : "false",
            rows[0].runtime_route_match ? "true" : "false",
            rows[0].runtime_render_ready ? "true" : "false",
            rows[0].runtime_semantic_nodes_loaded ? "true" : "false",
            rows[0].runtime_semantic_nodes_applied_count,
            rows[0].runtime_semantic_ready ? "true" : "false",
            rows[0].runtime_semantic_total_count);
    json_write_escaped(rp, rows[0].runtime_semantic_total_hash);
    fprintf(rp,
            ",\n"
            "      \"runtime_semantic_applied_count\": %d,\n"
            "      \"runtime_semantic_applied_hash\": ",
            rows[0].runtime_semantic_applied_count);
    json_write_escaped(rp, rows[0].runtime_semantic_applied_hash);
    fprintf(rp,
            ",\n"
            "      \"capture_bytes\": %zu,\n"
            "      \"capture_width\": %d,\n"
            "      \"capture_height\": %d,\n"
            "      \"runs\": [\n",
            rows[0].capture_bytes,
            rows[0].width,
            rows[0].height);

    for (int run_idx = 1; run_idx <= consistency_runs; ++run_idx) {
      RunRow *r = &rows[(size_t)(run_idx - 1)];
      fprintf(rp, "%s        {\"state\":", (run_idx == 1 ? "" : ",\n"));
      json_write_escaped(rp, r->state);
      fprintf(rp,
              ",\"run\":%d,\"route\":",
              r->run);
      json_write_escaped(rp, r->route);
      fprintf(rp, ",\"runtime_framehash\":");
      json_write_escaped(rp, r->runtime_framehash);
      fprintf(rp, ",\"expected_runtime_framehash\":");
      json_write_escaped(rp, r->expected_runtime_framehash);
      fprintf(rp,
              ",\"runtime_framehash_match\":%s,\"runtime_reported_framehash_match_capture\":%s,\"runtime_route_match\":%s,\"runtime_render_ready\":%s,\"runtime_semantic_nodes_loaded\":%s,\"runtime_semantic_nodes_applied_count\":%d,\"runtime_semantic_ready\":%s,\"runtime_semantic_total_count\":%d,\"runtime_semantic_total_hash\":",
              r->runtime_framehash_match ? "true" : "false",
              r->runtime_reported_framehash_match_capture ? "true" : "false",
              r->runtime_route_match ? "true" : "false",
              r->runtime_render_ready ? "true" : "false",
              r->runtime_semantic_nodes_loaded ? "true" : "false",
              r->runtime_semantic_nodes_applied_count,
              r->runtime_semantic_ready ? "true" : "false",
              r->runtime_semantic_total_count);
      json_write_escaped(rp, r->runtime_semantic_total_hash);
      fprintf(rp, ",\"runtime_semantic_applied_count\":%d,\"runtime_semantic_applied_hash\":", r->runtime_semantic_applied_count);
      json_write_escaped(rp, r->runtime_semantic_applied_hash);
      fprintf(rp, ",\"capture_framehash\":");
      json_write_escaped(rp, r->capture_framehash);
      fprintf(rp, ",\"capture_sha256\":\"\",\"capture_bytes\":%zu,\"capture_path\":", r->capture_bytes);
      json_write_escaped(rp, r->capture_path);
      fprintf(rp, ",\"runtime_state_path\":");
      json_write_escaped(rp, r->runtime_state_path);
      fprintf(rp, ",\"width\":%d,\"height\":%d,\"format\":%d}", r->width, r->height, r->format);
    }

    fprintf(rp, "\n      ]\n    }");

    free(rows);
    routes_ok += 1u;
  }

  fprintf(rp, "\n  }\n}\n");
  fclose(rp);

  truth_list_free(&truths);
  free(report_doc);
  strlist_free(&states);

  fprintf(stdout, "[verify-android-fullroute-pixel] ok routes=%zu\n", routes_ok);
  fprintf(stdout, "[verify-android-fullroute-pixel] report=%s\n", report_path);
  return 0;
}
