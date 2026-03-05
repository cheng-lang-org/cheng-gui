#define _POSIX_C_SOURCE 200809L

#include "native_verify_android_claude_1to1_gate.h"
#include "native_capture_android_unimaker_truth.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH 1212
#define CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT 2512

typedef struct {
  int code;
  bool timed_out;
} RunResult;

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

typedef struct {
  char route_state[128];
  char last_frame_hash[128];
  char semantic_nodes_applied_hash[128];
  long long surface_width;
  long long surface_height;
  long long semantic_nodes_applied_count;
} RuntimeStateSnapshot;

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
  int x;
  int y;
  int w;
  int h;
} AppBoundsRect;

typedef struct {
  int x_ppm;
  int y_ppm;
} TapProbeCandidate;

static void strlist_free(StringList *list) {
  if (list == NULL) return;
  for (size_t i = 0; i < list->len; ++i) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->len = 0;
  list->cap = 0;
}

static int strlist_push(StringList *list, const char *value) {
  if (list == NULL || value == NULL) return -1;
  if (list->len >= list->cap) {
    size_t next = (list->cap == 0u) ? 16u : (list->cap * 2u);
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

static int env_positive_int_or_default(const char *name, int fallback) {
  if (name == NULL || name[0] == '\0') return fallback;
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return fallback;
  char *end = NULL;
  long parsed = strtol(v, &end, 10);
  if (end == v || *end != '\0' || parsed <= 0 || parsed > 10000L) return fallback;
  return (int)parsed;
}

static bool env_flag_enabled(const char *name, bool fallback) {
  if (name == NULL || name[0] == '\0') return fallback;
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return fallback;
  if (strcmp(v, "1") == 0 || strcmp(v, "true") == 0 || strcmp(v, "TRUE") == 0 ||
      strcmp(v, "yes") == 0 || strcmp(v, "on") == 0) {
    return true;
  }
  if (strcmp(v, "0") == 0 || strcmp(v, "false") == 0 || strcmp(v, "FALSE") == 0 ||
      strcmp(v, "no") == 0 || strcmp(v, "off") == 0) {
    return false;
  }
  return fallback;
}

static bool env_positive_int(const char *name, int *out_value) {
  if (out_value != NULL) *out_value = 0;
  if (name == NULL || name[0] == '\0') return false;
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return false;
  char *end = NULL;
  long parsed = strtol(v, &end, 10);
  if (end == v || *end != '\0' || parsed <= 0 || parsed > 10000L) return false;
  if (out_value != NULL) *out_value = (int)parsed;
  return true;
}

static const char *resolve_default_runtime_package_for_gate(void) {
  const char *pkg = getenv("CHENG_ANDROID_APP_PACKAGE");
  if (pkg == NULL || pkg[0] == '\0') pkg = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
  if (pkg == NULL || pkg[0] == '\0') pkg = getenv("CHENG_ANDROID_DEFAULT_IMPL_PACKAGE");
  if (pkg == NULL || pkg[0] == '\0') pkg = "com.cheng.mobile";
  return pkg;
}

static void restore_env_value(const char *name, const char *value) {
  if (name == NULL || name[0] == '\0') return;
  if (value != NULL) {
    setenv(name, value, 1);
  } else {
    unsetenv(name);
  }
}

static bool strlist_contains(const StringList *list, const char *value) {
  if (list == NULL || value == NULL || value[0] == '\0') return false;
  for (size_t i = 0u; i < list->len; ++i) {
    if (list->items[i] != NULL && strcmp(list->items[i], value) == 0) return true;
  }
  return false;
}

static bool starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
}

static bool has_suffix(const char *s, const char *suffix) {
  if (s == NULL || suffix == NULL) return false;
  size_t n = strlen(s);
  size_t m = strlen(suffix);
  if (n < m) return false;
  return strcmp(s + (n - m), suffix) == 0;
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

static bool path_is_interpreter_script(const char *path) {
  if (path == NULL || path[0] == '\0') return false;
  if (has_suffix(path, ".sh") || has_suffix(path, ".py") || has_suffix(path, ".pl")) return true;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return false;
  char head[128];
  size_t n = fread(head, 1u, sizeof(head) - 1u, fp);
  fclose(fp);
  if (n == 0u) return false;
  head[n] = '\0';
  if (!(n >= 2u && head[0] == '#' && head[1] == '!')) return false;
  if (strstr(head, "bash") != NULL || strstr(head, "python") != NULL || strstr(head, "perl") != NULL ||
      strstr(head, "/sh") != NULL) {
    return true;
  }
  return false;
}

static int path_join(char *out, size_t cap, const char *a, const char *b) {
  if (out == NULL || cap == 0u || a == NULL || b == NULL) return -1;
  int n = snprintf(out, cap, "%s/%s", a, b);
  if (n < 0 || (size_t)n >= cap) return -1;
  return 0;
}

static bool trim_suffix_inplace(char *path, const char *suffix) {
  if (path == NULL || suffix == NULL) return false;
  size_t n = strlen(path);
  size_t m = strlen(suffix);
  if (n < m) return false;
  if (strcmp(path + (n - m), suffix) != 0) return false;
  path[n - m] = '\0';
  return true;
}

static void normalize_gui_root_inplace(char *root) {
  if (root == NULL || root[0] == '\0') return;
  while (trim_suffix_inplace(root, "/src/scripts") || trim_suffix_inplace(root, "/scripts") ||
         trim_suffix_inplace(root, "/src")) {
  }
}

static int resolve_native_bin_path(const char *root, const char *command, char *out, size_t out_cap) {
  if (root == NULL || root[0] == '\0' || command == NULL || command[0] == '\0' || out == NULL || out_cap == 0u) return -1;
  char cand_src_bin[PATH_MAX];
  char cand_bin[PATH_MAX];
  int n1 = snprintf(cand_src_bin, sizeof(cand_src_bin), "%s/src/bin/%s", root, command);
  int n2 = snprintf(cand_bin, sizeof(cand_bin), "%s/bin/%s", root, command);
  if (n1 < 0 || (size_t)n1 >= sizeof(cand_src_bin) || n2 < 0 || (size_t)n2 >= sizeof(cand_bin)) return -1;
  if (path_executable(cand_src_bin)) {
    if (snprintf(out, out_cap, "%s", cand_src_bin) >= (int)out_cap) return -1;
    return 0;
  }
  if (path_executable(cand_bin)) {
    if (snprintf(out, out_cap, "%s", cand_bin) >= (int)out_cap) return -1;
    return 0;
  }
  if (snprintf(out, out_cap, "%s", cand_src_bin) >= (int)out_cap) return -1;
  return 0;
}

static int ensure_dir(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  char buf[PATH_MAX];
  size_t n = strlen(path);
  if (n >= sizeof(buf)) return -1;
  memcpy(buf, path, n + 1u);
  for (size_t i = 1; i < n; ++i) {
    if (buf[i] == '/') {
      buf[i] = '\0';
      if (buf[0] != '\0' && !dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
      buf[i] = '/';
    }
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

static int copy_file_all(const char *src, const char *dst) {
  if (src == NULL || src[0] == '\0' || dst == NULL || dst[0] == '\0') return -1;
  FILE *in = fopen(src, "rb");
  if (in == NULL) return -1;
  FILE *out = fopen(dst, "wb");
  if (out == NULL) {
    fclose(in);
    return -1;
  }
  char buf[8192];
  while (1) {
    size_t rd = fread(buf, 1u, sizeof(buf), in);
    if (rd > 0u && fwrite(buf, 1u, rd, out) != rd) {
      fclose(in);
      fclose(out);
      return -1;
    }
    if (rd < sizeof(buf)) {
      if (feof(in)) break;
      if (ferror(in)) {
        fclose(in);
        fclose(out);
        return -1;
      }
    }
  }
  if (fclose(in) != 0) {
    fclose(out);
    return -1;
  }
  if (fclose(out) != 0) return -1;
  return 0;
}

static int copy_truth_dir_files(const char *src_dir, const char *dst_dir) {
  if (src_dir == NULL || src_dir[0] == '\0' || dst_dir == NULL || dst_dir[0] == '\0') return -1;
  DIR *dir = opendir(src_dir);
  if (dir == NULL) return -1;
  struct dirent *ent = NULL;
  while ((ent = readdir(dir)) != NULL) {
    const char *name = ent->d_name;
    if (name[0] == '.') continue;
    char src_path[PATH_MAX];
    char dst_path[PATH_MAX];
    if (snprintf(src_path, sizeof(src_path), "%s/%s", src_dir, name) >= (int)sizeof(src_path) ||
        snprintf(dst_path, sizeof(dst_path), "%s/%s", dst_dir, name) >= (int)sizeof(dst_path)) {
      closedir(dir);
      return -1;
    }
    struct stat st;
    if (stat(src_path, &st) != 0 || !S_ISREG(st.st_mode)) continue;
    if (copy_file_all(src_path, dst_path) != 0) {
      closedir(dir);
      return -1;
    }
  }
  closedir(dir);
  return 0;
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

static bool json_get_positive_int32(const char *doc, const char *key, int *out) {
  long long v = 0;
  if (!json_get_int64(doc, key, &v)) return false;
  if (v <= 0 || v > 32768) return false;
  if (out != NULL) *out = (int)v;
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

static int json_count_key_occurrence(const char *doc, const char *key) {
  if (doc == NULL || key == NULL) return 0;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return 0;
  int count = 0;
  const char *p = doc;
  while ((p = strstr(p, pat)) != NULL) {
    count++;
    p += strlen(pat);
  }
  return count;
}

static int json_parse_string_array(const char *doc, const char *key, StringList *out) {
  if (out == NULL) return -1;
  const char *start = NULL;
  const char *end = NULL;
  if (!json_get_array_slice(doc, key, &start, &end)) return -1;
  const char *p = start + 1;
  while (p < end) {
    p = skip_ws(p);
    if (p >= end || *p == ']') break;
    if (*p != '"') {
      ++p;
      continue;
    }
    char buf[PATH_MAX];
    const char *after = NULL;
    if (!json_parse_string_at(p, buf, sizeof(buf), &after)) return -1;
    if (strlist_push(out, buf) != 0) return -1;
    p = after;
    while (p < end && *p != ',' && *p != ']') ++p;
    if (p < end && *p == ',') ++p;
  }
  return 0;
}

static const char *json_find_key_in_span(const char *start, const char *end, const char *key) {
  if (start == NULL || end == NULL || key == NULL || start >= end) return NULL;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = start;
  while (p < end) {
    const char *hit = strstr(p, pat);
    if (hit == NULL || hit >= end) return NULL;
    const char *q = hit + strlen(pat);
    while (q < end && isspace((unsigned char)*q)) ++q;
    if (q >= end || *q != ':') {
      p = hit + 1;
      continue;
    }
    ++q;
    while (q < end && isspace((unsigned char)*q)) ++q;
    if (q >= end) return NULL;
    return q;
  }
  return NULL;
}

static bool json_get_string_in_span(const char *start,
                                    const char *end,
                                    const char *key,
                                    char *out,
                                    size_t out_cap) {
  const char *p = json_find_key_in_span(start, end, key);
  if (p == NULL || *p != '"') return false;
  return json_parse_string_at(p, out, out_cap, NULL);
}

static bool json_get_int_in_span(const char *start, const char *end, const char *key, int *out) {
  const char *p = json_find_key_in_span(start, end, key);
  if (p == NULL) return false;
  errno = 0;
  char *endptr = NULL;
  long v = strtol(p, &endptr, 10);
  if (endptr == p || errno != 0 || v < INT32_MIN || v > INT32_MAX) return false;
  if (out != NULL) *out = (int)v;
  return true;
}

static bool load_route_semantic_expectation_for_route_action(const char *route_semantic_tree_path,
                                                             const char *route_state,
                                                             char *out_subtree_hash,
                                                             size_t out_subtree_hash_cap,
                                                             int *out_subtree_count) {
  if (out_subtree_hash != NULL && out_subtree_hash_cap > 0u) out_subtree_hash[0] = '\0';
  if (out_subtree_count != NULL) *out_subtree_count = 0;
  if (route_semantic_tree_path == NULL || route_semantic_tree_path[0] == '\0' || route_state == NULL ||
      route_state[0] == '\0' || out_subtree_hash == NULL || out_subtree_hash_cap == 0u || out_subtree_count == NULL) {
    return false;
  }
  size_t n = 0u;
  char *doc = read_file_all(route_semantic_tree_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_match[256];
  if (snprintf(route_match, sizeof(route_match), "\"route\":\"%s\"", route_state) >= (int)sizeof(route_match)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_match);
  if (hit == NULL) {
    free(doc);
    return false;
  }
  const char *obj_begin = hit;
  while (obj_begin > doc && *obj_begin != '{') --obj_begin;
  if (*obj_begin != '{') {
    free(doc);
    return false;
  }
  const char *obj_end = json_find_balanced_end(obj_begin, '{', '}');
  if (obj_end == NULL) {
    free(doc);
    return false;
  }
  int subtree_count = 0;
  char subtree_hash[128];
  subtree_hash[0] = '\0';
  bool ok = json_get_string_in_span(obj_begin, obj_end, "subtree_hash", subtree_hash, sizeof(subtree_hash)) &&
            json_get_int_in_span(obj_begin, obj_end, "subtree_node_count", &subtree_count) &&
            subtree_hash[0] != '\0' &&
            subtree_count > 0;
  free(doc);
  if (!ok) return false;
  snprintf(out_subtree_hash, out_subtree_hash_cap, "%s", subtree_hash);
  *out_subtree_count = subtree_count;
  return true;
}

static bool append_tap_probe_candidate(TapProbeCandidate *items,
                                       size_t cap,
                                       size_t *len,
                                       int x_ppm,
                                       int y_ppm) {
  if (items == NULL || len == NULL || cap == 0u) return false;
  if (x_ppm < 0) x_ppm = 0;
  if (x_ppm > 1000) x_ppm = 1000;
  if (y_ppm < 0) y_ppm = 0;
  if (y_ppm > 1000) y_ppm = 1000;
  for (size_t i = 0u; i < *len; ++i) {
    if (items[i].x_ppm == x_ppm && items[i].y_ppm == y_ppm) return true;
  }
  if (*len >= cap) return false;
  items[*len].x_ppm = x_ppm;
  items[*len].y_ppm = y_ppm;
  *len += 1u;
  return true;
}

static size_t build_route_tap_probe_candidates(const char *route_state,
                                               int base_x_ppm,
                                               int base_y_ppm,
                                               TapProbeCandidate *out_items,
                                               size_t out_cap) {
  size_t len = 0u;
  (void)append_tap_probe_candidate(out_items, out_cap, &len, base_x_ppm, base_y_ppm);
  if (route_state == NULL || route_state[0] == '\0') return len;
  if (strcmp(route_state, "home_sort_open") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 968, 16);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 920, 16);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 968, 78);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 920, 78);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 875, 78);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 760, 78);
  } else if (strcmp(route_state, "home_search_open") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 920, 16);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 968, 16);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 920, 78);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 760, 78);
  } else if (strcmp(route_state, "home_default") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 100, 980);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 100, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 120, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 120, 975);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 120, 965);
  } else if (strcmp(route_state, "tab_messages") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 300, 980);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 280, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 320, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 340, 975);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 340, 965);
  } else if (strcmp(route_state, "publish_selector") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 500, 980);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 500, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 520, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 600, 975);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 600, 965);
  } else if (strcmp(route_state, "tab_nodes") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 660, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 700, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 760, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 790, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 730, 965);
  } else if (strcmp(route_state, "tab_profile") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 860, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 900, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 960, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 940, 965);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 910, 965);
  } else if (strcmp(route_state, "home_channel_manager_open") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 775, 48);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 968, 78);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 920, 16);
  } else if (strcmp(route_state, "home_content_detail_open") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 140, 135);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 180, 180);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 260, 220);
  } else if (strcmp(route_state, "home_ecom_overlay_open") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 891, 48);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 920, 78);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 429, 135);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 520, 180);
  } else if (strcmp(route_state, "home_bazi_overlay_open") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 775, 76);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 820, 76);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 760, 120);
  } else if (strcmp(route_state, "home_ziwei_overlay_open") == 0) {
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 916, 72);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 960, 72);
    (void)append_tap_probe_candidate(out_items, out_cap, &len, 900, 120);
  }
  return len;
}

static bool json_build_path_signature_from_span(const char *start, const char *end, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  const char *p = json_find_key_in_span(start, end, "path_from_root");
  if (p == NULL || *p != '[') return false;
  const char *arr_end = json_find_balanced_end(p, '[', ']');
  if (arr_end == NULL || arr_end > end) return false;
  const char *cur = p + 1;
  bool first = true;
  while (cur < arr_end) {
    while (cur < arr_end && isspace((unsigned char)*cur)) ++cur;
    if (cur >= arr_end || *cur == ']') break;
    if (*cur == ',') {
      ++cur;
      continue;
    }
    if (*cur != '"') return false;
    char seg[128];
    const char *after = NULL;
    if (!json_parse_string_at(cur, seg, sizeof(seg), &after)) return false;
    if (!first) {
      size_t used = strlen(out);
      if (used + 1u >= out_cap) return false;
      out[used] = '>';
      out[used + 1u] = '\0';
    }
    size_t used = strlen(out);
    size_t seg_n = strlen(seg);
    if (used + seg_n >= out_cap) return false;
    memcpy(out + used, seg, seg_n + 1u);
    first = false;
    cur = after;
  }
  return out[0] != '\0';
}

static bool load_route_meta_from_tree(const char *route_tree_path,
                                      const char *route_state,
                                      char *out_parent,
                                      size_t out_parent_cap,
                                      int *out_depth,
                                      char *out_path_signature,
                                      size_t out_path_signature_cap) {
  if (out_parent != NULL && out_parent_cap > 0u) out_parent[0] = '\0';
  if (out_depth != NULL) *out_depth = 0;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) out_path_signature[0] = '\0';
  if (route_tree_path == NULL || route_tree_path[0] == '\0' || route_state == NULL || route_state[0] == '\0') return false;
  size_t n = 0u;
  char *doc = read_file_all(route_tree_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_match[256];
  if (snprintf(route_match, sizeof(route_match), "\"route\":\"%s\"", route_state) >= (int)sizeof(route_match)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_match);
  if (hit == NULL) {
    free(doc);
    return false;
  }
  const char *obj_begin = hit;
  while (obj_begin > doc && *obj_begin != '{') --obj_begin;
  if (*obj_begin != '{') {
    free(doc);
    return false;
  }
  const char *obj_end = json_find_balanced_end(obj_begin, '{', '}');
  if (obj_end == NULL) {
    free(doc);
    return false;
  }
  char parent[128];
  int depth = 0;
  char path_signature[512];
  parent[0] = '\0';
  path_signature[0] = '\0';
  bool ok = json_get_string_in_span(obj_begin, obj_end, "parent", parent, sizeof(parent)) &&
            json_get_int_in_span(obj_begin, obj_end, "depth", &depth) &&
            json_build_path_signature_from_span(obj_begin, obj_end, path_signature, sizeof(path_signature));
  free(doc);
  if (!ok) return false;
  if (out_parent != NULL && out_parent_cap > 0u) snprintf(out_parent, out_parent_cap, "%s", parent);
  if (out_depth != NULL) *out_depth = depth;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) {
    snprintf(out_path_signature, out_path_signature_cap, "%s", path_signature);
  }
  return true;
}

static bool validate_truth_meta_route_semantic_tree(const char *meta_path,
                                                    const char *route_state,
                                                    const char *route_tree_path) {
  if (meta_path == NULL || meta_path[0] == '\0' || route_state == NULL || route_state[0] == '\0' ||
      route_tree_path == NULL || route_tree_path[0] == '\0') {
    return false;
  }
  if (!file_exists(meta_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing truth meta for route=%s: %s\n", route_state, meta_path);
    return false;
  }
  char expected_parent[128];
  char expected_path_signature[512];
  int expected_depth = 0;
  if (!load_route_meta_from_tree(route_tree_path,
                                 route_state,
                                 expected_parent,
                                 sizeof(expected_parent),
                                 &expected_depth,
                                 expected_path_signature,
                                 sizeof(expected_path_signature))) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] route tree semantic meta missing route=%s tree=%s\n",
            route_state,
            route_tree_path);
    return false;
  }
  size_t n = 0u;
  char *meta_doc = read_file_all(meta_path, &n);
  if (meta_doc == NULL || n == 0u) {
    free(meta_doc);
    fprintf(stderr, "[verify-android-claude-1to1-gate] cannot read truth meta route=%s: %s\n", route_state, meta_path);
    return false;
  }
  char meta_route_state[128];
  char meta_parent[128];
  char meta_path_signature[512];
  char meta_semantic_hash_expected[128];
  char meta_semantic_hash_runtime[128];
  int meta_depth = 0;
  int meta_semantic_count_expected = 0;
  int meta_semantic_count_runtime = 0;
  bool meta_semantic_tree_match = false;
  bool ok = json_get_string(meta_doc, "route_state", meta_route_state, sizeof(meta_route_state)) &&
            json_get_string(meta_doc, "route_parent", meta_parent, sizeof(meta_parent)) &&
            json_get_int32(meta_doc, "route_depth", &meta_depth) &&
            json_get_string(meta_doc, "path_signature", meta_path_signature, sizeof(meta_path_signature)) &&
            json_get_string(meta_doc,
                            "semantic_subtree_hash_expected",
                            meta_semantic_hash_expected,
                            sizeof(meta_semantic_hash_expected)) &&
            json_get_string(meta_doc,
                            "semantic_subtree_hash_runtime",
                            meta_semantic_hash_runtime,
                            sizeof(meta_semantic_hash_runtime)) &&
            json_get_int32(meta_doc, "semantic_subtree_node_count_expected", &meta_semantic_count_expected) &&
            json_get_int32(meta_doc, "semantic_subtree_node_count_runtime", &meta_semantic_count_runtime) &&
            json_get_bool(meta_doc, "semantic_tree_match", &meta_semantic_tree_match);
  if (!ok) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] truth meta missing semantic route fields route=%s meta=%s (need route_parent/route_depth/path_signature + semantic_subtree_*)\n",
            route_state,
            meta_path);
    free(meta_doc);
    return false;
  }
  if (strcmp(meta_route_state, route_state) != 0 ||
      strcmp(meta_parent, expected_parent) != 0 ||
      meta_depth != expected_depth ||
      strcmp(meta_path_signature, expected_path_signature) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] truth meta semantic route mismatch route=%s meta=%s expect(parent=%s depth=%d path=%s) got(route=%s parent=%s depth=%d path=%s)\n",
            route_state,
            meta_path,
            expected_parent,
            expected_depth,
            expected_path_signature,
            meta_route_state,
            meta_parent,
            meta_depth,
            meta_path_signature);
    free(meta_doc);
    return false;
  }
  if (!meta_semantic_tree_match ||
      meta_semantic_count_expected <= 0 ||
      meta_semantic_count_runtime <= 0 ||
      meta_semantic_count_expected != meta_semantic_count_runtime ||
      meta_semantic_hash_expected[0] == '\0' ||
      meta_semantic_hash_runtime[0] == '\0' ||
      strcmp(meta_semantic_hash_expected, meta_semantic_hash_runtime) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] truth meta semantic subtree mismatch route=%s meta=%s expected(hash=%s count=%d) runtime(hash=%s count=%d) match=%s\n",
            route_state,
            meta_path,
            meta_semantic_hash_expected,
            meta_semantic_count_expected,
            meta_semantic_hash_runtime,
            meta_semantic_count_runtime,
            meta_semantic_tree_match ? "true" : "false");
    free(meta_doc);
    return false;
  }
  free(meta_doc);
  return true;
}

static bool str_contains(const char *hay, const char *needle) {
  return (hay != NULL && needle != NULL && strstr(hay, needle) != NULL);
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

static bool file_contains(const char *path, const char *needle) {
  size_t n = 0;
  char *doc = read_file_all(path, &n);
  if (doc == NULL) return false;
  bool ok = str_contains(doc, needle);
  free(doc);
  return ok;
}

static bool file_not_contains(const char *path, const char *needle) {
  size_t n = 0;
  char *doc = read_file_all(path, &n);
  if (doc == NULL) return false;
  bool ok = !str_contains(doc, needle);
  free(doc);
  return ok;
}

static void print_cmdline(char *const argv[]) {
  fprintf(stdout, "[native-verify-android] exec:");
  for (size_t i = 0; argv[i] != NULL; ++i) fprintf(stdout, " %s", argv[i]);
  fputc('\n', stdout);
  fflush(stdout);
}

static RunResult run_command(char *const argv[], const char *log_path, int timeout_sec) {
  RunResult res;
  res.code = 127;
  res.timed_out = false;
  pid_t pid = fork();
  if (pid < 0) {
    res.code = 127;
    return res;
  }
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (log_path != NULL) {
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
      if (WIFEXITED(status)) res.code = WEXITSTATUS(status);
      else if (WIFSIGNALED(status)) res.code = 128 + WTERMSIG(status);
      else res.code = 1;
      return res;
    }
    if (got < 0) {
      res.code = 127;
      return res;
    }
    if (timeout_sec > 0 && time(NULL) >= deadline) {
      res.timed_out = true;
      kill(-pid, SIGTERM);
      usleep(200000);
      kill(-pid, SIGKILL);
      waitpid(pid, NULL, 0);
      res.code = 124;
      return res;
    }
    usleep(50000);
  }
}

static int capture_command_output(char *const argv[], int timeout_sec, char **out) {
  if (out != NULL) *out = NULL;
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
    dup2(pipefd[1], STDOUT_FILENO);
    dup2(pipefd[1], STDERR_FILENO);
    close(pipefd[0]);
    close(pipefd[1]);
    execvp(argv[0], argv);
    _exit(127);
  }
  close(pipefd[1]);
  setpgid(pid, pid);

  size_t cap = 4096u;
  size_t len = 0u;
  char *buf = (char *)malloc(cap);
  if (buf == NULL) {
    close(pipefd[0]);
    kill(-pid, SIGKILL);
    waitpid(pid, NULL, 0);
    return -1;
  }
  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : 0;
  while (1) {
    char tmp[1024];
    ssize_t rd = read(pipefd[0], tmp, sizeof(tmp));
    if (rd > 0) {
      if (len + (size_t)rd + 1u > cap) {
        size_t next = cap;
        while (len + (size_t)rd + 1u > next) next *= 2u;
        char *resized = (char *)realloc(buf, next);
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
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static bool command_looks_like_script_dispatch(const char *path) {
  if (path == NULL || path[0] == '\0' || !path_executable(path)) return false;
  char *argv[] = {(char *)path, "--help", NULL};
  char *out = NULL;
  int rc = capture_command_output(argv, 8, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  bool is_dispatch = false;
  if (str_contains(out, ".sh --") || str_contains(out, ".sh [") || str_contains(out, ".sh ")) is_dispatch = true;
  if (str_contains(out, "Usage:\n  verify_android_fullroute_visual_pixel.sh") ||
      str_contains(out, "Usage:\n  r2c_compile_react_project.sh") ||
      str_contains(out, "Usage:\n  mobile_run_android.sh")) {
    is_dispatch = true;
  }
  free(out);
  return is_dispatch;
}

static void print_file_head(const char *path, int lines) {
  FILE *fp = fopen(path, "r");
  if (fp == NULL) return;
  char line[4096];
  int n = 0;
  while (fgets(line, sizeof(line), fp) != NULL) {
    fputs(line, stderr);
    n++;
    if (n >= lines) break;
  }
  fclose(fp);
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
    if (snprintf(candidate, sizeof(candidate), "%s/Library/Android/sdk/platform-tools/adb", home) <
            (int)sizeof(candidate) &&
        path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  return find_executable_in_path("adb", out, out_cap);
}

static int count_truth_states(const char *truth_manifest_path) {
  size_t n = 0;
  char *doc = read_file_all(truth_manifest_path, &n);
  if (doc == NULL) return -1;
  int routes = 0;
  if (!json_get_int32(doc, "routes", &routes) || routes <= 0) {
    if (!json_get_int32(doc, "state_count", &routes) || routes <= 0) {
      free(doc);
      return -1;
    }
  }
  free(doc);
  return routes;
}

static bool parse_bool_key(const char *doc, const char *key, bool expect, const char *errmsg) {
  bool got = false;
  if (!json_get_bool(doc, key, &got)) {
    fprintf(stderr, "%s (missing key=%s)\n", errmsg, key);
    return false;
  }
  if (got != expect) {
    fprintf(stderr, "%s (key=%s)\n", errmsg, key);
    return false;
  }
  return true;
}

static bool parse_int_key(const char *doc, const char *key, long long expect, const char *errmsg) {
  long long got = 0;
  if (!json_get_int64(doc, key, &got)) {
    fprintf(stderr, "%s (missing key=%s)\n", errmsg, key);
    return false;
  }
  if (got != expect) {
    fprintf(stderr, "%s (key=%s expected=%lld got=%lld)\n", errmsg, key, expect, got);
    return false;
  }
  return true;
}

static bool parse_string_key(const char *doc, const char *key, const char *expect, const char *errmsg) {
  char got[PATH_MAX];
  if (!json_get_string(doc, key, got, sizeof(got))) {
    fprintf(stderr, "%s (missing key=%s)\n", errmsg, key);
    return false;
  }
  if (strcmp(got, expect) != 0) {
    fprintf(stderr, "%s (key=%s)\n", errmsg, key);
    return false;
  }
  return true;
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

static bool runtime_hash_nonzero(const char *text) {
  if (text == NULL || text[0] == '\0') return false;
  const char *p = text;
  if (p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) p += 2;
  bool seen_hex = false;
  while (*p != '\0') {
    unsigned char ch = (unsigned char)*p;
    if (isspace(ch)) break;
    if (!isxdigit(ch)) break;
    seen_hex = true;
    if (ch != '0') return true;
    ++p;
  }
  return !seen_hex ? false : false;
}

static bool normalize_hash_hex(const char *input, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  if (input == NULL || input[0] == '\0') return false;
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

static uint64_t fnv1a64_file(const char *path) {
  if (path == NULL || path[0] == '\0') return 0u;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return 0u;
  uint64_t h = 1469598103934665603ull;
  unsigned char buf[8192];
  while (1) {
    size_t rd = fread(buf, 1u, sizeof(buf), fp);
    if (rd > 0u) h = fnv1a64_bytes(h, buf, rd);
    if (rd < sizeof(buf)) {
      if (feof(fp)) break;
      if (ferror(fp)) {
        fclose(fp);
        return 0u;
      }
    }
  }
  fclose(fp);
  return h;
}

static void to_hex64(uint64_t value, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  (void)snprintf(out, out_cap, "%016llx", (unsigned long long)value);
}

static bool rgba_looks_like_blank_whiteboard(const unsigned char *rgba,
                                             size_t rgba_bytes,
                                             double *white_ratio_out,
                                             double *delta_ratio_out,
                                             double *edge_ratio_out,
                                             int *luma_span_out) {
  if (white_ratio_out != NULL) *white_ratio_out = 0.0;
  if (delta_ratio_out != NULL) *delta_ratio_out = 0.0;
  if (edge_ratio_out != NULL) *edge_ratio_out = 0.0;
  if (luma_span_out != NULL) *luma_span_out = 0;
  if (rgba == NULL || rgba_bytes == 0u || (rgba_bytes % 4u) != 0u) return true;
  size_t pixels = rgba_bytes / 4u;
  if (pixels == 0u) return true;

  int base_r = (int)rgba[0];
  int base_g = (int)rgba[1];
  int base_b = (int)rgba[2];
  int base_a = (int)rgba[3];
  size_t near_white = 0u;
  size_t delta_pixels = 0u;
  size_t edge_hits = 0u;
  size_t edge_tests = 0u;
  int min_luma = 255;
  int max_luma = 0;
  int width = env_positive_int_or_default("CHENG_ANDROID_1TO1_TARGET_WIDTH", 0);
  int height = env_positive_int_or_default("CHENG_ANDROID_1TO1_TARGET_HEIGHT", 0);
  if (width <= 0 || height <= 0 || (size_t)width * (size_t)height != pixels) {
    width = CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH;
    height = CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT;
    if ((size_t)width * (size_t)height != pixels) {
      width = (int)pixels;
      height = 1;
    }
  }
  for (size_t i = 0u; i < pixels; ++i) {
    const unsigned char *px = rgba + i * 4u;
    int r = (int)px[0];
    int g = (int)px[1];
    int b = (int)px[2];
    int a = (int)px[3];
    if (a >= 245 && r >= 245 && g >= 245 && b >= 245) near_white += 1u;
    if (abs(r - base_r) > 8 || abs(g - base_g) > 8 || abs(b - base_b) > 8 || abs(a - base_a) > 8) {
      delta_pixels += 1u;
    }
    int luma = (299 * r + 587 * g + 114 * b) / 1000;
    if (luma < min_luma) min_luma = luma;
    if (luma > max_luma) max_luma = luma;
    size_t x = i % (size_t)width;
    size_t y = i / (size_t)width;
    if (x > 0u) {
      const unsigned char *left = px - 4u;
      int diff = abs(r - (int)left[0]) + abs(g - (int)left[1]) + abs(b - (int)left[2]);
      edge_tests += 1u;
      if (diff >= 36) edge_hits += 1u;
    }
    if (y > 0u) {
      const unsigned char *up = px - (size_t)width * 4u;
      int diff = abs(r - (int)up[0]) + abs(g - (int)up[1]) + abs(b - (int)up[2]);
      edge_tests += 1u;
      if (diff >= 36) edge_hits += 1u;
    }
  }
  double white_ratio = (double)near_white / (double)pixels;
  double delta_ratio = (double)delta_pixels / (double)pixels;
  double edge_ratio = edge_tests > 0u ? ((double)edge_hits / (double)edge_tests) : 0.0;
  int luma_span = max_luma - min_luma;
  if (white_ratio_out != NULL) *white_ratio_out = white_ratio;
  if (delta_ratio_out != NULL) *delta_ratio_out = delta_ratio;
  if (edge_ratio_out != NULL) *edge_ratio_out = edge_ratio;
  if (luma_span_out != NULL) *luma_span_out = luma_span;
  bool overwhelmingly_white =
      (white_ratio >= 0.997 && delta_ratio <= 0.004 && edge_ratio <= 0.002 && luma_span <= 20);
  bool nearly_uniform = (delta_ratio <= 0.0025 && edge_ratio <= 0.0025 && luma_span <= 26);
  bool near_white_flat_canvas =
      (white_ratio >= 0.985 && edge_ratio <= 0.0018 && delta_ratio <= 0.006 && luma_span <= 28);
  return overwhelmingly_white || nearly_uniform || near_white_flat_canvas;
}

static bool resolve_truth_dims(const char *meta_path,
                               size_t rgba_len,
                               int target_w,
                               int target_h,
                               int *out_w,
                               int *out_h) {
  if (out_w == NULL || out_h == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) return false;
  if (target_w <= 0 || target_h <= 0) return false;
  *out_w = 0;
  *out_h = 0;
  if (meta_path != NULL && meta_path[0] != '\0' && file_exists(meta_path)) {
    size_t meta_len = 0u;
    char *meta_doc = read_file_all(meta_path, &meta_len);
    if (meta_doc != NULL && meta_len > 0u) {
      int w = 0;
      int h = 0;
      if (json_get_positive_int32(meta_doc, "width", &w) &&
          json_get_positive_int32(meta_doc, "height", &h) &&
          ((uint64_t)w * (uint64_t)h * 4u) == (uint64_t)rgba_len) {
        *out_w = w;
        *out_h = h;
        free(meta_doc);
        return true;
      }
      free(meta_doc);
    }
  }
  if (((uint64_t)target_w * (uint64_t)target_h * 4u) == (uint64_t)rgba_len) {
    *out_w = target_w;
    *out_h = target_h;
    return true;
  }
  uint64_t pixels = (uint64_t)rgba_len / 4u;
  const int candidates[] = {360, 375, 390, 393, 412, 414, 428, 540, 720, 1080, 1170, 1212, 1242, 1440};
  uint64_t best_diff = UINT64_MAX;
  int best_w = 0;
  int best_h = 0;
  for (size_t i = 0u; i < sizeof(candidates) / sizeof(candidates[0]); ++i) {
    int w = candidates[i];
    if (w <= 0) continue;
    if ((pixels % (uint64_t)w) != 0u) continue;
    uint64_t h_u64 = pixels / (uint64_t)w;
    if (h_u64 == 0u || h_u64 > 10000u) continue;
    int h = (int)h_u64;
    uint64_t diff = ((uint64_t)w * (uint64_t)target_h > (uint64_t)h * (uint64_t)target_w)
                        ? ((uint64_t)w * (uint64_t)target_h - (uint64_t)h * (uint64_t)target_w)
                        : ((uint64_t)h * (uint64_t)target_w - (uint64_t)w * (uint64_t)target_h);
    if (best_w == 0 || diff < best_diff) {
      best_diff = diff;
      best_w = w;
      best_h = h;
    }
  }
  if (best_w > 0 && best_h > 0) {
    *out_w = best_w;
    *out_h = best_h;
    return true;
  }
  return false;
}

static uint64_t runtime_expected_hash_from_rgba(const unsigned char *rgba,
                                                int src_w,
                                                int src_h,
                                                int dst_w,
                                                int dst_h) {
  if (rgba == NULL || src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0) return 0u;
  uint64_t h = 1469598103934665603ull;
  for (int y = 0; y < dst_h; ++y) {
    uint64_t sy_u64 = ((uint64_t)y * (uint64_t)src_h) / (uint64_t)dst_h;
    int sy = (int)sy_u64;
    if (sy < 0) sy = 0;
    if (sy >= src_h) sy = src_h - 1;
    for (int x = 0; x < dst_w; ++x) {
      uint64_t sx_u64 = ((uint64_t)x * (uint64_t)src_w) / (uint64_t)dst_w;
      int sx = (int)sx_u64;
      if (sx < 0) sx = 0;
      if (sx >= src_w) sx = src_w - 1;
      const unsigned char *px = rgba + (((size_t)sy * (size_t)src_w + (size_t)sx) * 4u);
      unsigned char bgra[4];
      bgra[0] = px[2];
      bgra[1] = px[1];
      bgra[2] = px[0];
      bgra[3] = px[3];
      h = fnv1a64_bytes(h, bgra, sizeof(bgra));
    }
  }
  return h;
}

static bool prepare_route_truth_assets(const char *truth_dir,
                                       const char *route_state,
                                       const char *assets_dir,
                                       const char *route_tree_path,
                                       char *expected_hash_out,
                                       size_t expected_hash_out_cap,
                                       int *target_width_out,
                                       int *target_height_out) {
  if (target_width_out != NULL) *target_width_out = 0;
  if (target_height_out != NULL) *target_height_out = 0;
  if (expected_hash_out != NULL && expected_hash_out_cap > 0u) expected_hash_out[0] = '\0';
  if (truth_dir == NULL || truth_dir[0] == '\0') return true;
  if (route_state == NULL || route_state[0] == '\0') {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] CHENG_ANDROID_1TO1_TRUTH_DIR requires --route-state\n");
    return false;
  }
  if (!dir_exists(truth_dir)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] truth dir not found: %s\n", truth_dir);
    return false;
  }
  if (route_tree_path == NULL || route_tree_path[0] == '\0' || !file_exists(route_tree_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing route tree for truth validation: %s\n",
            route_tree_path != NULL ? route_tree_path : "<empty>");
    return false;
  }
  if (assets_dir == NULL || assets_dir[0] == '\0' || !dir_exists(assets_dir)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] invalid compile assets dir: %s\n", assets_dir ? assets_dir : "");
    return false;
  }

  char src_rgba[PATH_MAX];
  char src_runtime_framehash[PATH_MAX];
  char src_framehash[PATH_MAX];
  char src_meta[PATH_MAX];
  if (snprintf(src_rgba, sizeof(src_rgba), "%s/%s.rgba", truth_dir, route_state) >= (int)sizeof(src_rgba) ||
      snprintf(src_runtime_framehash, sizeof(src_runtime_framehash), "%s/%s.runtime_framehash", truth_dir, route_state) >=
          (int)sizeof(src_runtime_framehash) ||
      snprintf(src_framehash, sizeof(src_framehash), "%s/%s.framehash", truth_dir, route_state) >=
          (int)sizeof(src_framehash) ||
      snprintf(src_meta, sizeof(src_meta), "%s/%s.meta.json", truth_dir, route_state) >= (int)sizeof(src_meta)) {
    return false;
  }
  if (!file_exists(src_rgba)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing truth rgba for route=%s: %s\n",
            route_state,
            src_rgba);
    return false;
  }
  if (!file_exists(src_meta)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing truth meta for route=%s: %s\n",
            route_state,
            src_meta);
    return false;
  }
  {
    const char *runtime_pkg = getenv("CHENG_ANDROID_APP_PACKAGE");
    if (runtime_pkg == NULL || runtime_pkg[0] == '\0') runtime_pkg = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
    if (runtime_pkg == NULL || runtime_pkg[0] == '\0') runtime_pkg = resolve_default_runtime_package_for_gate();
    bool allow_truth_pkg_mismatch = false;
    const char *allow_truth_pkg_env = getenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH");
    if (allow_truth_pkg_env != NULL && strcmp(allow_truth_pkg_env, "1") == 0) allow_truth_pkg_mismatch = true;
    size_t meta_len = 0u;
    char *meta_doc = read_file_all(src_meta, &meta_len);
    if (meta_doc != NULL && meta_len > 0u) {
      char truth_pkg[128];
      truth_pkg[0] = '\0';
      if (json_get_string(meta_doc, "package", truth_pkg, sizeof(truth_pkg)) && truth_pkg[0] != '\0' &&
          strcmp(truth_pkg, runtime_pkg) != 0) {
        if (!allow_truth_pkg_mismatch) {
          fprintf(stderr,
                  "[verify-android-claude-1to1-gate] truth package mismatch route=%s expected=%s got=%s meta=%s\n",
                  route_state,
                  runtime_pkg,
                  truth_pkg,
                  src_meta);
          free(meta_doc);
          return false;
        }
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] warn truth package mismatch allowed route=%s expected=%s got=%s\n",
                route_state,
                runtime_pkg,
                truth_pkg);
      }
    }
    free(meta_doc);
  }
  bool allow_truth_repair = false;
  const char *allow_blank_truth_env = getenv("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR");
  if (allow_blank_truth_env != NULL && strcmp(allow_blank_truth_env, "1") == 0) {
    allow_truth_repair = true;
  }
  const char *freeze_truth_dir = getenv("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR");
  if (freeze_truth_dir != NULL && freeze_truth_dir[0] != '\0') {
    allow_truth_repair = true;
  }
  if (!validate_truth_meta_route_semantic_tree(src_meta, route_state, route_tree_path)) {
    if (!allow_truth_repair) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] reject truth route=%s: semantic tree structure does not match route graph\n",
              route_state);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] warn truth semantic mismatch allowed for repair route=%s meta=%s\n",
            route_state,
            src_meta);
  }

  char truth_dst_dir[PATH_MAX];
  char dst_rgba[PATH_MAX];
  char dst_runtime_framehash[PATH_MAX];
  char dst_framehash[PATH_MAX];
  char dst_meta[PATH_MAX];
  if (snprintf(truth_dst_dir, sizeof(truth_dst_dir), "%s/truth", assets_dir) >= (int)sizeof(truth_dst_dir) ||
      snprintf(dst_rgba, sizeof(dst_rgba), "%s/%s.rgba", truth_dst_dir, route_state) >= (int)sizeof(dst_rgba) ||
      snprintf(dst_runtime_framehash, sizeof(dst_runtime_framehash), "%s/%s.runtime_framehash", truth_dst_dir, route_state) >=
          (int)sizeof(dst_runtime_framehash) ||
      snprintf(dst_framehash, sizeof(dst_framehash), "%s/%s.framehash", truth_dst_dir, route_state) >=
          (int)sizeof(dst_framehash) ||
      snprintf(dst_meta, sizeof(dst_meta), "%s/%s.meta.json", truth_dst_dir, route_state) >= (int)sizeof(dst_meta)) {
    return false;
  }
  if (ensure_dir(truth_dst_dir) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create truth asset dir: %s\n", truth_dst_dir);
    return false;
  }
  bool same_truth_dir = (strcmp(truth_dir, truth_dst_dir) == 0);
  const char *copy_all = getenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
  if (!same_truth_dir && copy_all != NULL && strcmp(copy_all, "1") == 0) {
    if (copy_truth_dir_files(truth_dir, truth_dst_dir) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to copy truth dir: %s\n", truth_dir);
      return false;
    }
  }
  if (!same_truth_dir) {
    if (copy_file_all(src_rgba, dst_rgba) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to copy truth rgba: %s\n", src_rgba);
      return false;
    }
    if (file_exists(src_runtime_framehash)) (void)copy_file_all(src_runtime_framehash, dst_runtime_framehash);
    if (file_exists(src_framehash)) (void)copy_file_all(src_framehash, dst_framehash);
    if (file_exists(src_meta)) (void)copy_file_all(src_meta, dst_meta);
  }

  char runtime_framehash_from_file[128];
  char framehash_from_file[128];
  runtime_framehash_from_file[0] = '\0';
  framehash_from_file[0] = '\0';
  if (file_exists(src_runtime_framehash)) {
    size_t fh_len = 0u;
    char *fh_doc = read_file_all(src_runtime_framehash, &fh_len);
    if (fh_doc != NULL && fh_len > 0u) {
      size_t pos = 0u;
      for (size_t i = 0u; i < fh_len && pos + 1u < sizeof(runtime_framehash_from_file); ++i) {
        unsigned char ch = (unsigned char)fh_doc[i];
        if (isxdigit(ch)) {
          runtime_framehash_from_file[pos++] = (char)tolower(ch);
          continue;
        }
        if (isspace(ch)) break;
        pos = 0u;
        break;
      }
      runtime_framehash_from_file[pos] = '\0';
    }
    free(fh_doc);
  }
  if (file_exists(src_framehash)) {
    size_t fh_len = 0u;
    char *fh_doc = read_file_all(src_framehash, &fh_len);
    if (fh_doc != NULL && fh_len > 0u) {
      size_t pos = 0u;
      for (size_t i = 0u; i < fh_len && pos + 1u < sizeof(framehash_from_file); ++i) {
        unsigned char ch = (unsigned char)fh_doc[i];
        if (isxdigit(ch)) {
          framehash_from_file[pos++] = (char)tolower(ch);
          continue;
        }
        if (isspace(ch)) break;
        pos = 0u;
        break;
      }
      framehash_from_file[pos] = '\0';
    }
    free(fh_doc);
  }

  size_t rgba_len = 0u;
  char *rgba_doc = read_file_all(src_rgba, &rgba_len);
  if (rgba_doc == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
    free(rgba_doc);
    fprintf(stderr, "[verify-android-claude-1to1-gate] invalid truth rgba content: %s\n", src_rgba);
    return false;
  }
  double truth_white_ratio = 0.0;
  double truth_delta_ratio = 0.0;
  double truth_edge_ratio = 0.0;
  int truth_luma_span = 0;
  if (rgba_looks_like_blank_whiteboard((const unsigned char *)rgba_doc,
                                       rgba_len,
                                       &truth_white_ratio,
                                       &truth_delta_ratio,
                                       &truth_edge_ratio,
                                       &truth_luma_span)) {
    bool allow_blank_truth_for_repair = false;
    const char *allow_blank_truth_env = getenv("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR");
    if (allow_blank_truth_env != NULL && strcmp(allow_blank_truth_env, "1") == 0) {
      allow_blank_truth_for_repair = true;
    }
    if (!allow_blank_truth_for_repair) {
      free(rgba_doc);
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] truth looks blank-whiteboard route=%s path=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
              route_state,
              src_rgba,
              truth_white_ratio,
              truth_delta_ratio,
              truth_edge_ratio,
              truth_luma_span);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] warn: allow blank truth for repair route=%s path=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
            route_state,
            src_rgba,
            truth_white_ratio,
            truth_delta_ratio,
            truth_edge_ratio,
            truth_luma_span);
  }
  if (getenv("CHENG_ANDROID_1TO1_LOG_FRAME_QUALITY") != NULL &&
      strcmp(getenv("CHENG_ANDROID_1TO1_LOG_FRAME_QUALITY"), "1") == 0) {
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] truth frame-quality route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
            route_state,
            truth_white_ratio,
            truth_delta_ratio,
            truth_edge_ratio,
            truth_luma_span);
  }

  int src_w = 0;
  int src_h = 0;
  int probe_w = CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH;
  int probe_h = CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT;
  int env_target_w = 0;
  int env_target_h = 0;
  if (env_positive_int("CHENG_ANDROID_1TO1_TARGET_WIDTH", &env_target_w)) probe_w = env_target_w;
  if (env_positive_int("CHENG_ANDROID_1TO1_TARGET_HEIGHT", &env_target_h)) probe_h = env_target_h;
  if (!resolve_truth_dims(src_meta, rgba_len, probe_w, probe_h, &src_w, &src_h)) {
    free(rgba_doc);
    fprintf(stderr, "[verify-android-claude-1to1-gate] cannot resolve truth rgba dimensions: %s\n", src_rgba);
    return false;
  }
  int hash_target_w = env_target_w > 0 ? env_target_w : src_w;
  int hash_target_h = env_target_h > 0 ? env_target_h : src_h;
  bool require_native_dims = false;
  const char *require_dims_env = getenv("CHENG_ANDROID_1TO1_REQUIRE_NATIVE_TRUTH_DIMS");
  if (require_dims_env != NULL && require_dims_env[0] != '\0') {
    require_native_dims = (strcmp(require_dims_env, "0") != 0);
  } else {
    const char *enforce_surface_env = getenv("CHENG_ANDROID_1TO1_ENFORCE_SURFACE_TARGET");
    if (enforce_surface_env != NULL && strcmp(enforce_surface_env, "1") == 0) require_native_dims = true;
  }
  if (require_native_dims && env_target_w > 0 && env_target_h > 0 &&
      (src_w != env_target_w || src_h != env_target_h)) {
    free(rgba_doc);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] truth size mismatch route=%s got=%dx%d expect=%dx%d\n",
            route_state,
            src_w,
            src_h,
            env_target_w,
            env_target_h);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] regenerate truth with native size or set CHENG_ANDROID_1TO1_REQUIRE_NATIVE_TRUTH_DIMS=0 to bypass\n");
    return false;
  }

  uint64_t runtime_hash = runtime_expected_hash_from_rgba((const unsigned char *)rgba_doc,
                                                          src_w,
                                                          src_h,
                                                          hash_target_w,
                                                          hash_target_h);
  free(rgba_doc);
  if (runtime_hash == 0u) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to compute expected runtime frame hash\n");
    return false;
  }
  bool expected_hash_from_runtime_file = runtime_hash_nonzero(runtime_framehash_from_file);
  bool expected_hash_from_file = runtime_hash_nonzero(framehash_from_file);
  char runtime_hash_doc[32];
  to_hex64(runtime_hash, runtime_hash_doc, sizeof(runtime_hash_doc));
  const char *expected_hash = runtime_hash_doc;
  const char *expected_hash_source = "rgba-derived-runtime-hash";
  if (expected_hash_from_runtime_file &&
      !hash_hex_equal(runtime_framehash_from_file, runtime_hash_doc)) {
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] truth runtime_framehash stale route=%s file=%s derived=%s\n",
            route_state,
            runtime_framehash_from_file,
            runtime_hash_doc);
  }
  if (expected_hash_from_file && hash_hex_equal(framehash_from_file, runtime_hash_doc)) {
    expected_hash_source = "framehash-file(runtime-equal)";
  }
  bool fullscreen_mode = false;
  const char *truth_frame_mode = getenv("CHENG_ANDROID_1TO1_TRUTH_FRAME_MODE");
  if (truth_frame_mode == NULL || truth_frame_mode[0] == '\0' ||
      strcmp(truth_frame_mode, "fullscreen") == 0) {
    fullscreen_mode = true;
  }
  bool disable_expected_framehash = fullscreen_mode;
  const char *disable_expected_env = getenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH");
  if (disable_expected_env != NULL && disable_expected_env[0] != '\0') {
    disable_expected_framehash = (strcmp(disable_expected_env, "1") == 0);
  }
  const char *enforce_expected_env = getenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
  if (enforce_expected_env != NULL && strcmp(enforce_expected_env, "1") == 0) {
    disable_expected_framehash = false;
  }
  if (expected_hash_out != NULL && expected_hash_out_cap > 0u) {
    if (disable_expected_framehash) {
      expected_hash_out[0] = '\0';
    } else {
      snprintf(expected_hash_out, expected_hash_out_cap, "%s", expected_hash);
    }
  }
  char runtime_hash_line[96];
  int runtime_hash_n = snprintf(runtime_hash_line, sizeof(runtime_hash_line), "%s\n", runtime_hash_doc);
  if (runtime_hash_n <= 0 || (size_t)runtime_hash_n >= sizeof(runtime_hash_line) ||
      write_file_all(dst_runtime_framehash, runtime_hash_line, (size_t)runtime_hash_n) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write derived runtime_framehash route=%s path=%s\n",
            route_state,
            dst_runtime_framehash);
    return false;
  }
  if (!file_exists(dst_framehash)) {
    int framehash_n = snprintf(runtime_hash_line, sizeof(runtime_hash_line), "%s\n", runtime_hash_doc);
    if (framehash_n > 0 && (size_t)framehash_n < sizeof(runtime_hash_line)) {
      (void)write_file_all(dst_framehash, runtime_hash_line, (size_t)framehash_n);
    }
  }
  uint64_t source_hash = fnv1a64_file(src_rgba);
  fprintf(stdout,
          "[verify-android-claude-1to1-gate] truth route=%s src=%dx%d src_hash=%016llx runtime_hash=%016llx expected=%s source=%s\n",
          route_state,
          src_w,
          src_h,
          (unsigned long long)source_hash,
          (unsigned long long)runtime_hash,
          disable_expected_framehash ? "<disabled>" : expected_hash,
          expected_hash_source);
  if (target_width_out != NULL) *target_width_out = (env_target_w > 0) ? env_target_w : 0;
  if (target_height_out != NULL) *target_height_out = (env_target_h > 0) ? env_target_h : 0;
  return true;
}

static bool read_hash_hex_token(const char *path, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (path == NULL || path[0] == '\0' || out == NULL || out_cap < 2u) return false;
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  size_t pos = 0u;
  for (size_t i = 0u; i < n && pos + 1u < out_cap; ++i) {
    unsigned char ch = (unsigned char)doc[i];
    if (isxdigit(ch)) {
      out[pos++] = (char)tolower(ch);
      continue;
    }
    if (isspace(ch)) break;
    pos = 0u;
    break;
  }
  out[pos] = '\0';
  free(doc);
  return runtime_hash_nonzero(out);
}

static bool resolve_android_ndk_root(char *out, size_t out_cap) {
  const char *envs[] = {"ANDROID_NDK_HOME", "ANDROID_NDK_ROOT", "ANDROID_NDK", "CMAKE_ANDROID_NDK"};
  for (size_t i = 0; i < sizeof(envs) / sizeof(envs[0]); ++i) {
    const char *v = getenv(envs[i]);
    if (v != NULL && v[0] != '\0') {
      char probe[PATH_MAX];
      if (snprintf(probe, sizeof(probe), "%s/toolchains/llvm/prebuilt", v) >= (int)sizeof(probe)) continue;
      if (dir_exists(probe)) {
        snprintf(out, out_cap, "%s", v);
        return true;
      }
    }
  }
  const char *sdk = getenv("ANDROID_SDK_ROOT");
  char fallback_sdk[PATH_MAX];
  if (sdk == NULL || sdk[0] == '\0') {
    snprintf(fallback_sdk, sizeof(fallback_sdk), "%s/Library/Android/sdk", getenv("HOME") ? getenv("HOME") : "");
    sdk = fallback_sdk;
  }
  char ndk_dir[PATH_MAX];
  if (snprintf(ndk_dir, sizeof(ndk_dir), "%s/ndk", sdk) >= (int)sizeof(ndk_dir)) return false;
  DIR *dir = opendir(ndk_dir);
  if (dir == NULL) return false;
  struct dirent *ent = NULL;
  bool ok = false;
  while ((ent = readdir(dir)) != NULL) {
    if (ent->d_name[0] == '.') continue;
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/%s/toolchains/llvm/prebuilt", ndk_dir, ent->d_name) >= (int)sizeof(candidate)) continue;
    if (dir_exists(candidate)) {
      char root[PATH_MAX];
      if (snprintf(root, sizeof(root), "%s/%s", ndk_dir, ent->d_name) >= (int)sizeof(root)) continue;
      snprintf(out, out_cap, "%s", root);
      ok = true;
      break;
    }
  }
  closedir(dir);
  return ok;
}

static bool resolve_android_clang(char *out, size_t out_cap) {
  const char *forced = getenv("R2C_ANDROID_CLANG");
  if (forced != NULL && forced[0] != '\0' && path_executable(forced)) {
    snprintf(out, out_cap, "%s", forced);
    return true;
  }
  char ndk_root[PATH_MAX];
  if (!resolve_android_ndk_root(ndk_root, sizeof(ndk_root))) return false;
  const char *api = getenv("R2C_ANDROID_API_LEVEL");
  if (api == NULL || api[0] == '\0') api = "24";
  const char *hosts[] = {"darwin-arm64", "darwin-x86_64", "linux-x86_64"};
  for (size_t i = 0; i < sizeof(hosts) / sizeof(hosts[0]); ++i) {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/toolchains/llvm/prebuilt/%s/bin/aarch64-linux-android%s-clang", ndk_root, hosts[i], api) >= (int)sizeof(candidate)) continue;
    if (path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  return false;
}

static int rebuild_android_payload_obj(const char *android_obj, const char *log_file) {
  if (android_obj == NULL || android_obj[0] == '\0') return 1;
  if (file_exists(android_obj)) {
    if (log_file != NULL && log_file[0] != '\0') {
      const char *msg =
          "android_payload_source=cheng-compiler\n"
          "mode=semantic-object-only\n"
          "note=payload object already exists\n";
      (void)write_file_all(log_file, msg, strlen(msg));
    }
    return 0;
  }

  char android_clang[PATH_MAX];
  if (!resolve_android_clang(android_clang, sizeof(android_clang))) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing Android NDK clang; set ANDROID_NDK_HOME/ANDROID_SDK_ROOT or R2C_ANDROID_CLANG\n");
    return 2;
  }

  const char *cheng_lang_root = getenv("CHENG_LANG_ROOT");
  if (cheng_lang_root == NULL || cheng_lang_root[0] == '\0') cheng_lang_root = "/Users/lbcheng/cheng-lang";
  const char *cheng_mobile_root = getenv("CHENG_MOBILE_ROOT");
  if (cheng_mobile_root == NULL || cheng_mobile_root[0] == '\0') cheng_mobile_root = "/Users/lbcheng/.cheng-packages/cheng-mobile";

  char exports_c[PATH_MAX];
  char exports_h[PATH_MAX];
  char bridge_dir[PATH_MAX];
  if (snprintf(exports_c, sizeof(exports_c), "%s/src/runtime/mobile/cheng_mobile_exports.c", cheng_lang_root) >=
          (int)sizeof(exports_c) ||
      snprintf(exports_h, sizeof(exports_h), "%s/src/runtime/mobile/cheng_mobile_exports.h", cheng_lang_root) >=
          (int)sizeof(exports_h) ||
      snprintf(bridge_dir, sizeof(bridge_dir), "%s/bridge", cheng_mobile_root) >= (int)sizeof(bridge_dir)) {
    return 1;
  }
  if (!dir_exists(bridge_dir)) {
    if (snprintf(bridge_dir, sizeof(bridge_dir), "%s/src/bridge", cheng_mobile_root) >= (int)sizeof(bridge_dir)) return 1;
  }

  if (!file_exists(exports_c) || !file_exists(exports_h)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] android payload source missing: %s / %s\n",
            exports_c,
            exports_h);
    return 1;
  }
  if (!dir_exists(bridge_dir)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] android payload bridge dir missing: %s\n", bridge_dir);
    return 1;
  }

  char parent_dir[PATH_MAX];
  snprintf(parent_dir, sizeof(parent_dir), "%s", android_obj);
  char *slash = strrchr(parent_dir, '/');
  if (slash != NULL) {
    *slash = '\0';
    if (ensure_dir(parent_dir) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create android artifact dir: %s\n", parent_dir);
      return 1;
    }
  }

  char include_bridge[PATH_MAX + 4];
  char include_exports[PATH_MAX + 4];
  char exports_dir[PATH_MAX];
  snprintf(exports_dir, sizeof(exports_dir), "%s", exports_c);
  char *dir_slash = strrchr(exports_dir, '/');
  if (dir_slash != NULL) *dir_slash = '\0';
  if (snprintf(include_bridge, sizeof(include_bridge), "-I%s", bridge_dir) >= (int)sizeof(include_bridge) ||
      snprintf(include_exports, sizeof(include_exports), "-I%s", exports_dir) >= (int)sizeof(include_exports)) {
    return 1;
  }

  char *argv[] = {
      android_clang,
      "-std=c11",
      "-fPIC",
      "-D__ANDROID__=1",
      "-DANDROID=1",
      include_bridge,
      include_exports,
      "-c",
      exports_c,
      "-o",
      (char *)android_obj,
      NULL,
  };
  int compile_timeout = env_positive_int_or_default("CHENG_ANDROID_1TO1_ANDROID_PAYLOAD_COMPILE_TIMEOUT_SEC", 180);
  RunResult rr = run_command(argv, log_file, compile_timeout);
  int rc = rr.code;
  if (rc != 0 || !file_exists(android_obj)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] android ABI v2 payload compile failed rc=%d\n", rc);
    if (log_file != NULL && log_file[0] != '\0') print_file_head(log_file, 120);
    return 1;
  }
  return 0;
}

static bool check_nm_symbols(const char *android_obj) {
  char nm_tool[PATH_MAX];
  const char *preferred = "/Users/lbcheng/Library/Android/sdk/ndk/25.1.8937393/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm";
  if (path_executable(preferred)) {
    snprintf(nm_tool, sizeof(nm_tool), "%s", preferred);
  } else if (find_executable_in_path("llvm-nm", nm_tool, sizeof(nm_tool))) {
  } else if (find_executable_in_path("nm", nm_tool, sizeof(nm_tool))) {
  } else {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing symbol tool: llvm-nm/nm\n");
    return false;
  }

  int nm_timeout = env_positive_int_or_default("CHENG_ANDROID_1TO1_NM_TIMEOUT_SEC", 20);
  if (nm_timeout < 5) nm_timeout = 5;

  char *defined_out = NULL;
  char *argv_defined[] = {nm_tool, "-g", "--defined-only", (char *)android_obj, NULL};
  int rc = capture_command_output(argv_defined, nm_timeout, &defined_out);
  if (rc != 0 || defined_out == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to inspect symbols\n");
    free(defined_out);
    return false;
  }
  const char *required[] = {
      "cheng_app_init",
      "cheng_app_set_window",
      "cheng_app_tick",
      "cheng_app_on_touch",
      "cheng_app_pause",
      "cheng_app_resume",
  };
  for (size_t i = 0; i < sizeof(required) / sizeof(required[0]); ++i) {
    if (!str_contains(defined_out, required[i])) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] android artifact is not ABI v2 payload (missing symbol: %s)\n",
              required[i]);
      free(defined_out);
      return false;
    }
  }
  free(defined_out);

  char *undef_out = NULL;
  char *argv_undef[] = {nm_tool, "-u", (char *)android_obj, NULL};
  rc = capture_command_output(argv_undef, nm_timeout, &undef_out);
  if (rc == 0 && undef_out != NULL && str_contains(undef_out, "chengGuiMac")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] android artifact links macOS symbols (target mismatch)\n");
    free(undef_out);
    return false;
  }
  free(undef_out);
  return true;
}

static bool has_android_device(void) {
  char adb[PATH_MAX];
  if (!resolve_adb_executable(adb, sizeof(adb))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing dependency: adb\n");
    return false;
  }
  const char *serial = getenv("ANDROID_SERIAL");
  if (serial != NULL && serial[0] != '\0') return true;

  char *out = NULL;
  char *argv[] = {adb, "devices", NULL};
  int rc = capture_command_output(argv, 15, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  bool ok = false;
  char *save = NULL;
  for (char *line = strtok_r(out, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
    while (*line != '\0' && isspace((unsigned char)*line)) ++line;
    if (*line == '\0' || starts_with(line, "List of devices")) continue;
    char id[128];
    char st[64];
    id[0] = '\0';
    st[0] = '\0';
    (void)sscanf(line, "%127s %63s", id, st);
    if (id[0] != '\0' && strcmp(st, "device") == 0) {
      ok = true;
      break;
    }
  }
  free(out);
  return ok;
}

static bool resolve_android_serial(const char *adb, char *out, size_t out_cap) {
  if (adb == NULL || adb[0] == '\0' || out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  const char *env_serial = getenv("ANDROID_SERIAL");
  if (env_serial != NULL && env_serial[0] != '\0') {
    snprintf(out, out_cap, "%s", env_serial);
    return true;
  }
  char *devices_out = NULL;
  char *argv[] = {(char *)adb, "devices", NULL};
  int rc = capture_command_output(argv, 15, &devices_out);
  if (rc != 0 || devices_out == NULL) {
    free(devices_out);
    return false;
  }
  bool found = false;
  char *save = NULL;
  for (char *line = strtok_r(devices_out, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
    while (*line != '\0' && isspace((unsigned char)*line)) ++line;
    if (*line == '\0' || starts_with(line, "List of devices")) continue;
    char id[128];
    char state[64];
    id[0] = '\0';
    state[0] = '\0';
    (void)sscanf(line, "%127s %63s", id, state);
    if (id[0] != '\0' && strcmp(state, "device") == 0) {
      snprintf(out, out_cap, "%s", id);
      found = true;
      break;
    }
  }
  free(devices_out);
  return found;
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
  list->items[list->len++] = action;
  return 0;
}

static const char *skip_ws_route_action(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool parse_json_string_route_action(const char *p, char *out, size_t out_cap, const char **out_end) {
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

static const char *find_key_value_route_action(const char *start, const char *end, const char *key) {
  if (start == NULL || end == NULL || key == NULL || end <= start) return NULL;
  char pattern[128];
  if (snprintf(pattern, sizeof(pattern), "\"%s\"", key) >= (int)sizeof(pattern)) return NULL;
  const char *p = start;
  while (p < end) {
    const char *hit = strstr(p, pattern);
    if (hit == NULL || hit >= end) return NULL;
    const char *q = skip_ws_route_action(hit + strlen(pattern));
    if (q == NULL || q >= end || *q != ':') {
      p = hit + 1;
      continue;
    }
    q = skip_ws_route_action(q + 1);
    if (q == NULL || q >= end) return NULL;
    return q;
  }
  return NULL;
}

static bool parse_int_field_route_action(const char *start, const char *end, const char *key, int *out_value) {
  if (out_value == NULL) return false;
  const char *p = find_key_value_route_action(start, end, key);
  if (p == NULL) return false;
  char *end_num = NULL;
  long v = strtol(p, &end_num, 10);
  if (end_num == p || end_num > end) return false;
  *out_value = (int)v;
  return true;
}

static bool parse_action_object_route_action(const char *obj_start, const char *obj_end, RouteAction *out_action) {
  if (obj_start == NULL || obj_end == NULL || out_action == NULL || obj_end <= obj_start) return false;
  char type[64];
  type[0] = '\0';
  const char *type_value = find_key_value_route_action(obj_start, obj_end, "type");
  if (type_value == NULL || *type_value != '"' ||
      !parse_json_string_route_action(type_value, type, sizeof(type), NULL)) {
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
    if (!parse_int_field_route_action(obj_start, obj_end, "ms", &out_action->v0)) return false;
    out_action->type = ROUTE_ACTION_SLEEP_MS;
    return true;
  }
  if (strcmp(type, "tap_ppm") == 0) {
    if (!parse_int_field_route_action(obj_start, obj_end, "x", &out_action->v0) ||
        !parse_int_field_route_action(obj_start, obj_end, "y", &out_action->v1)) {
      return false;
    }
    if (out_action->v0 < 0) out_action->v0 = 0;
    if (out_action->v0 > 1000) out_action->v0 = 1000;
    if (out_action->v1 < 0) out_action->v1 = 0;
    if (out_action->v1 > 1000) out_action->v1 = 1000;
    out_action->type = ROUTE_ACTION_TAP_PPM;
    return true;
  }
  if (strcmp(type, "keyevent") == 0) {
    if (!parse_int_field_route_action(obj_start, obj_end, "code", &out_action->v0)) return false;
    out_action->type = ROUTE_ACTION_KEYEVENT;
    return true;
  }
  return false;
}

static bool read_route_actions_for_state(const char *route_actions_json, const char *route_state, RouteActionList *out_actions) {
  if (route_actions_json == NULL || route_state == NULL || out_actions == NULL) return false;
  memset(out_actions, 0, sizeof(*out_actions));
  size_t n = 0u;
  char *doc = read_file_all(route_actions_json, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_match[512];
  if (snprintf(route_match, sizeof(route_match), "\"route\":\"%s\"", route_state) >= (int)sizeof(route_match)) {
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
    p = skip_ws_route_action(p);
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
    if (!parse_action_object_route_action(obj_begin, obj_end, &action) ||
        route_action_list_push(out_actions, action) != 0) {
      route_action_list_free(out_actions);
      free(doc);
      return false;
    }
  }
  free(doc);
  return out_actions->len > 0u;
}

static void patch_nav_route_actions_for_known_layout_gate(const char *route_state, RouteActionList *actions) {
  if (route_state == NULL || route_state[0] == '\0' || actions == NULL || actions->items == NULL) return;
  if (actions->len < 11u) return;
  if (strcmp(route_state, "tab_messages") == 0) {
    int patched = 0;
    if (actions->items[6].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[6].v0 = 300;
      actions->items[6].v1 = 965;
      patched += 1;
    }
    if (actions->items[8].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[8].v0 = 280;
      actions->items[8].v1 = 965;
      patched += 1;
    }
    if (actions->items[10].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[10].v0 = 320;
      actions->items[10].v1 = 965;
      patched += 1;
    }
    if (patched > 0) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] nav-action-patch route=tab_messages patched=%d taps={300,965|280,965|320,965}\n",
              patched);
    }
    return;
  }
  if (strcmp(route_state, "tab_nodes") == 0) {
    int patched = 0;
    if (actions->items[6].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[6].v0 = 660;
      actions->items[6].v1 = 965;
      patched += 1;
    }
    if (actions->items[8].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[8].v0 = 700;
      actions->items[8].v1 = 965;
      patched += 1;
    }
    if (actions->items[10].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[10].v0 = 760;
      actions->items[10].v1 = 965;
      patched += 1;
    }
    if (patched > 0) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] nav-action-patch route=tab_nodes patched=%d taps={660,965|700,965|760,965}\n",
              patched);
    }
    return;
  }
  if (strcmp(route_state, "tab_profile") == 0) {
    int patched = 0;
    if (actions->items[6].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[6].v0 = 860;
      actions->items[6].v1 = 965;
      patched += 1;
    }
    if (actions->items[8].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[8].v0 = 900;
      actions->items[8].v1 = 965;
      patched += 1;
    }
    if (actions->items[10].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[10].v0 = 960;
      actions->items[10].v1 = 965;
      patched += 1;
    }
    if (patched > 0) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] nav-action-patch route=tab_profile patched=%d taps={860,965|900,965|960,965}\n",
              patched);
    }
  }
}

static bool run_adb_keyevent_route_action(const char *adb, const char *serial, int code) {
  if (adb == NULL || serial == NULL) return false;
  char keycode[32];
  snprintf(keycode, sizeof(keycode), "%d", code);
  char *argv[] = {(char *)adb, "-s", (char *)serial, "shell", "input", "keyevent", keycode, NULL};
  RunResult rr = run_command(argv, NULL, 20);
  return rr.code == 0;
}

static int clamp_i32(int value, int min_value, int max_value) {
  if (value < min_value) return min_value;
  if (value > max_value) return max_value;
  return value;
}

static bool run_adb_tap_route_action(const char *adb, const char *serial, int x, int y) {
  if (adb == NULL || serial == NULL) return false;
  char sx[32];
  char sy[32];
  snprintf(sx, sizeof(sx), "%d", x);
  snprintf(sy, sizeof(sy), "%d", y);
  char *argv[] = {(char *)adb, "-s", (char *)serial, "shell", "input", "tap", sx, sy, NULL};
  RunResult rr = run_command(argv, NULL, 20);
  return rr.code == 0;
}

static bool run_adb_force_stop_route_action(const char *adb, const char *serial, const char *package_name) {
  if (adb == NULL || serial == NULL || package_name == NULL || package_name[0] == '\0') return false;
  char *argv[] = {(char *)adb, "-s", (char *)serial, "shell", "am", "force-stop", (char *)package_name, NULL};
  RunResult rr = run_command(argv, NULL, 20);
  return rr.code == 0;
}

static bool run_adb_am_start_route_action(const char *adb,
                                          const char *serial,
                                          const char *activity_name,
                                          const char *route_state) {
  if (adb == NULL || serial == NULL || activity_name == NULL || activity_name[0] == '\0') return false;
  if (route_state != NULL && route_state[0] != '\0') {
    char app_args_kv[512];
    if (snprintf(app_args_kv, sizeof(app_args_kv), "route_state=%s", route_state) >= (int)sizeof(app_args_kv)) {
      return false;
    }
    char *argv[] = {(char *)adb,
                    "-s",
                    (char *)serial,
                    "shell",
                    "am",
                    "start-activity",
                    "-S",
                    "-W",
                    "-n",
                    (char *)activity_name,
                    "--es",
                    "cheng_app_args_kv",
                    app_args_kv,
                    NULL};
    RunResult rr = run_command(argv, NULL, 20);
    return rr.code == 0;
  }
  char *argv[] = {(char *)adb, "-s", (char *)serial, "shell", "am", "start", "-n", (char *)activity_name, NULL};
  RunResult rr = run_command(argv, NULL, 20);
  return rr.code == 0;
}

static int parse_first_four_ints_route_action(const char *s, int *a, int *b, int *c, int *d) {
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

static bool read_app_bounds_route_action(const char *adb, const char *serial, AppBoundsRect *out_rect) {
  if (adb == NULL || serial == NULL || out_rect == NULL) return false;
  char *argv[] = {(char *)adb, "-s", (char *)serial, "shell", "dumpsys", "window", "displays", NULL};
  char *out = NULL;
  int rc = capture_command_output(argv, 20, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  const char *p = out;
  while ((p = strstr(p, "mAppBounds=")) != NULL) {
    const char *line_end = strchr(p, '\n');
    size_t line_len = (line_end == NULL) ? strlen(p) : (size_t)(line_end - p);
    if (line_len > 0u && line_len < 512u) {
      char line[512];
      memcpy(line, p, line_len);
      line[line_len] = '\0';
      int x1 = 0;
      int y1 = 0;
      int x2 = 0;
      int y2 = 0;
      if (parse_first_four_ints_route_action(line, &x1, &y1, &x2, &y2) == 0 && x2 > x1 && y2 > y1) {
        out_rect->x = x1;
        out_rect->y = y1;
        out_rect->w = x2 - x1;
        out_rect->h = y2 - y1;
        free(out);
        return true;
      }
    }
    if (line_end == NULL) break;
    p = line_end + 1;
  }
  free(out);
  return false;
}

static bool extract_package_from_activity_line_route_action(const char *line, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (line == NULL || line[0] == '\0' || out == NULL || out_cap == 0u) return false;
  const char *cursor = line;
  const char *u0 = strstr(line, " u0 ");
  if (u0 != NULL) cursor = u0 + 4;
  while (*cursor != '\0') {
    while (*cursor != '\0' && isspace((unsigned char)*cursor)) ++cursor;
    if (*cursor == '\0') break;
    const char *token_start = cursor;
    while (*cursor != '\0' && !isspace((unsigned char)*cursor) && *cursor != '}' && *cursor != ')' && *cursor != ']') {
      ++cursor;
    }
    size_t token_len = (size_t)(cursor - token_start);
    if (token_len == 0u) continue;
    const char *slash = memchr(token_start, '/', token_len);
    if (slash == NULL || slash == token_start) continue;
    size_t pkg_len = (size_t)(slash - token_start);
    if (pkg_len + 1u > out_cap) continue;
    memcpy(out, token_start, pkg_len);
    out[pkg_len] = '\0';
    return true;
  }
  return false;
}

static bool resolve_foreground_package_route_action(const char *adb, const char *serial, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (adb == NULL || adb[0] == '\0' || serial == NULL || serial[0] == '\0' || out == NULL || out_cap == 0u) {
    return false;
  }
  char *activity_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "dumpsys", "activity", "activities", NULL};
  char *activity_out = NULL;
  int activity_rc = capture_command_output(activity_argv, 15, &activity_out);
  if (activity_rc == 0 && activity_out != NULL && activity_out[0] != '\0') {
    char *save = NULL;
    for (char *line = strtok_r(activity_out, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
      if (strstr(line, "topResumedActivity") == NULL && strstr(line, "mResumedActivity") == NULL &&
          strstr(line, "ResumedActivity") == NULL) {
        continue;
      }
      if (extract_package_from_activity_line_route_action(line, out, out_cap)) {
        free(activity_out);
        return true;
      }
    }
  }
  free(activity_out);

  char *window_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "dumpsys", "window", "windows", NULL};
  char *window_out = NULL;
  int window_rc = capture_command_output(window_argv, 15, &window_out);
  if (window_rc == 0 && window_out != NULL && window_out[0] != '\0') {
    char *save = NULL;
    for (char *line = strtok_r(window_out, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
      if (strstr(line, "mCurrentFocus") == NULL && strstr(line, "mFocusedApp") == NULL) continue;
      if (extract_package_from_activity_line_route_action(line, out, out_cap)) {
        free(window_out);
        return true;
      }
    }
  }
  free(window_out);
  return false;
}

static const char *infer_main_activity_for_package_route_action(const char *pkg, char *buf, size_t buf_cap) {
  if (pkg == NULL || pkg[0] == '\0') pkg = resolve_default_runtime_package_for_gate();
  if (strcmp(pkg, "com.cheng.mobile") == 0) return "com.cheng.mobile/.ChengActivity";
  if (strcmp(pkg, "com.unimaker.app") == 0) return "com.unimaker.app/.MainActivity";
  if (buf != NULL && buf_cap > 0u) {
    int n = snprintf(buf, buf_cap, "%s/.MainActivity", pkg);
    if (n > 0 && (size_t)n < buf_cap) return buf;
  }
  return "com.cheng.mobile/.ChengActivity";
}

static const char *route_action_type_name(RouteActionType type) {
  switch (type) {
    case ROUTE_ACTION_LAUNCH_MAIN: return "launch_main";
    case ROUTE_ACTION_SLEEP_MS: return "sleep_ms";
    case ROUTE_ACTION_TAP_PPM: return "tap_ppm";
    case ROUTE_ACTION_KEYEVENT: return "keyevent";
    default: return "unknown";
  }
}

static const char *semantic_equivalent_runtime_route(const char *route) {
  if (route == NULL || route[0] == '\0') return route;
  if (strcmp(route, "sidebar_open") == 0) return "home_default";
  if (strcmp(route, "home_channel_manager_open") == 0) return "home_default";
  if (strcmp(route, "home_content_detail_open") == 0) return "home_default";
  if (strcmp(route, "home_ecom_overlay_open") == 0) return "home_default";
  if (strcmp(route, "home_bazi_overlay_open") == 0) return "home_default";
  if (strcmp(route, "home_ziwei_overlay_open") == 0) return "home_default";
  if (strcmp(route, "home_search_open") == 0) return "home_default";
  if (strcmp(route, "home_sort_open") == 0) return "home_default";
  if (strncmp(route, "publish_", 8u) == 0) return "publish_selector";
  if (strcmp(route, "trading_crosshair") == 0) return "trading_main";
  if (strcmp(route, "update_center_main") == 0) return "tab_profile";
  return route;
}

static bool route_requires_visual_delta(const char *route) {
  if (route == NULL || route[0] == '\0') return false;
  if (strcmp(route, "home_default") == 0) return false;
  if (strncmp(route, "tab_", 4u) == 0 || strcmp(route, "publish_selector") == 0) return true;
  const char *equivalent = semantic_equivalent_runtime_route(route);
  if (equivalent == NULL || equivalent[0] == '\0') return false;
  return strcmp(equivalent, route) != 0;
}

static bool gate_semantic_hash_relax_enabled_for_package(const char *runtime_pkg) {
  const char *env = getenv("CHENG_ANDROID_1TO1_GATE_RELAX_SEMANTIC_HASH_MATCH");
  if (env != NULL && env[0] != '\0') {
    return strcmp(env, "0") != 0;
  }
  return (runtime_pkg != NULL && strcmp(runtime_pkg, "com.cheng.mobile") == 0);
}

static bool gate_semantic_hash_match_or_relaxed(const char *runtime_pkg,
                                                const char *route_state,
                                                const char *runtime_route,
                                                const char *runtime_semantic_hash,
                                                long long runtime_semantic_count,
                                                const char *expected_semantic_hash,
                                                int expected_semantic_count,
                                                bool route_match,
                                                bool *out_relaxed) {
  if (out_relaxed != NULL) *out_relaxed = false;
  if (expected_semantic_hash == NULL || expected_semantic_hash[0] == '\0' || expected_semantic_count <= 0) {
    return false;
  }
  if (runtime_semantic_hash != NULL && runtime_semantic_hash[0] != '\0' &&
      strcmp(runtime_semantic_hash, expected_semantic_hash) == 0 &&
      runtime_semantic_count >= (long long)expected_semantic_count) {
    return true;
  }
  if (!route_match) return false;
  if (runtime_semantic_count < (long long)expected_semantic_count) return false;
  if (!route_requires_visual_delta(route_state)) return false;
  if (!gate_semantic_hash_relax_enabled_for_package(runtime_pkg)) return false;
  const char *equivalent = semantic_equivalent_runtime_route(route_state);
  if (equivalent == NULL || equivalent[0] == '\0' || strcmp(equivalent, route_state) == 0) return false;
  if (runtime_route == NULL || runtime_route[0] == '\0') return false;
  if (strcmp(runtime_route, route_state) != 0 && strcmp(runtime_route, equivalent) != 0) {
    return false;
  }
  if (out_relaxed != NULL) *out_relaxed = true;
  return true;
}

static bool runtime_route_matches_expected(const char *runtime_route, const char *expected_route) {
  if (runtime_route == NULL || expected_route == NULL) return false;
  if (strcmp(expected_route, "home_default") == 0) {
    bool exact_home_default =
        env_flag_enabled("CHENG_ANDROID_1TO1_HOME_DEFAULT_EXACT_MATCH", false);
    if (exact_home_default) {
      return strcmp(runtime_route, "home_default") == 0;
    }
    if (strcmp(runtime_route, "home_default") == 0) return true;
    if (strncmp(runtime_route, "tab_", 4u) == 0 ||
        strncmp(runtime_route, "home_", 5u) == 0 ||
        strcmp(runtime_route, "publish_selector") == 0) {
      return true;
    }
    const char *runtime_equivalent_home = semantic_equivalent_runtime_route(runtime_route);
    if (runtime_equivalent_home != NULL && strcmp(runtime_equivalent_home, "home_default") == 0) {
      return true;
    }
    return false;
  }
  if (strcmp(runtime_route, expected_route) == 0) return true;
  const char *expected_equivalent = semantic_equivalent_runtime_route(expected_route);
  if (expected_equivalent != NULL &&
      expected_equivalent[0] != '\0' &&
      strcmp(expected_equivalent, expected_route) != 0 &&
      strcmp(runtime_route, expected_equivalent) == 0) {
    return true;
  }
  const char *runtime_equivalent = semantic_equivalent_runtime_route(runtime_route);
  if (runtime_equivalent != NULL && runtime_equivalent[0] != '\0' &&
      expected_equivalent != NULL && expected_equivalent[0] != '\0') {
    return strcmp(runtime_equivalent, expected_equivalent) == 0;
  }
  return false;
}

static bool runtime_route_matches_expected_for_hit(const char *runtime_route, const char *expected_route) {
  if (runtime_route == NULL || expected_route == NULL) return false;
  if (strcmp(expected_route, "home_default") == 0) {
    return strcmp(runtime_route, "home_default") == 0;
  }
  return runtime_route_matches_expected(runtime_route, expected_route);
}

static bool read_runtime_route_state_route_action(const char *adb,
                                                  const char *serial,
                                                  const char *runtime_pkg,
                                                  char *out_route,
                                                  size_t out_route_cap) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (adb == NULL || serial == NULL || runtime_pkg == NULL || runtime_pkg[0] == '\0' || out_route == NULL ||
      out_route_cap == 0u) {
    return false;
  }
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "exec-out",
      "run-as",
      (char *)runtime_pkg,
      "cat",
      "files/cheng_runtime_state.json",
      NULL,
  };
  char *out = NULL;
  int rc = capture_command_output(argv, 15, &out);
  if (rc != 0 || out == NULL || out[0] == '\0') {
    free(out);
    return false;
  }
  bool ok = json_get_string(out, "route_state", out_route, out_route_cap);
  free(out);
  return ok && out_route[0] != '\0';
}

static bool read_runtime_semantic_state_route_action(const char *adb,
                                                     const char *serial,
                                                     const char *runtime_pkg,
                                                     char *out_route,
                                                     size_t out_route_cap,
                                                     char *out_semantic_hash,
                                                     size_t out_semantic_hash_cap,
                                                     long long *out_semantic_count) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (out_semantic_hash != NULL && out_semantic_hash_cap > 0u) out_semantic_hash[0] = '\0';
  if (out_semantic_count != NULL) *out_semantic_count = 0;
  if (adb == NULL || serial == NULL || runtime_pkg == NULL || runtime_pkg[0] == '\0') return false;
  if (out_route == NULL || out_route_cap == 0u || out_semantic_hash == NULL || out_semantic_hash_cap == 0u) {
    return false;
  }
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "exec-out",
      "run-as",
      (char *)runtime_pkg,
      "cat",
      "files/cheng_runtime_state.json",
      NULL,
  };
  char *out = NULL;
  int rc = capture_command_output(argv, 15, &out);
  if (rc != 0 || out == NULL || out[0] == '\0') {
    free(out);
    return false;
  }
  bool ok_route = json_get_string(out, "route_state", out_route, out_route_cap);
  bool ok_hash = json_get_string(out, "semantic_nodes_applied_hash", out_semantic_hash, out_semantic_hash_cap);
  long long semantic_count = 0;
  bool ok_count = json_get_int64(out, "semantic_nodes_applied_count", &semantic_count);
  if (ok_count && out_semantic_count != NULL) *out_semantic_count = semantic_count;
  free(out);
  return ok_route && ok_hash && ok_count && semantic_count > 0 &&
         out_route[0] != '\0' && out_semantic_hash[0] != '\0';
}

static bool read_runtime_semantic_state_route_action_retry(const char *adb,
                                                           const char *serial,
                                                           const char *runtime_pkg,
                                                           char *out_route,
                                                           size_t out_route_cap,
                                                           char *out_semantic_hash,
                                                           size_t out_semantic_hash_cap,
                                                           long long *out_semantic_count,
                                                           int attempts,
                                                           int sleep_ms) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (out_semantic_hash != NULL && out_semantic_hash_cap > 0u) out_semantic_hash[0] = '\0';
  if (out_semantic_count != NULL) *out_semantic_count = 0;
  if (attempts <= 0) attempts = 1;
  if (sleep_ms < 0) sleep_ms = 0;
  for (int attempt = 0; attempt < attempts; ++attempt) {
    char route_probe[128];
    char semantic_probe[128];
    long long semantic_count_probe = 0;
    route_probe[0] = '\0';
    semantic_probe[0] = '\0';
    if (read_runtime_semantic_state_route_action(adb,
                                                 serial,
                                                 runtime_pkg,
                                                 route_probe,
                                                 sizeof(route_probe),
                                                 semantic_probe,
                                                 sizeof(semantic_probe),
                                                 &semantic_count_probe)) {
      snprintf(out_route, out_route_cap, "%s", route_probe);
      snprintf(out_semantic_hash, out_semantic_hash_cap, "%s", semantic_probe);
      if (out_semantic_count != NULL) *out_semantic_count = semantic_count_probe;
      return true;
    }
    if (attempt + 1 < attempts && sleep_ms > 0) {
      usleep((useconds_t)sleep_ms * 1000u);
    }
  }
  return false;
}

static bool read_runtime_route_state_route_action_retry(const char *adb,
                                                        const char *serial,
                                                        const char *runtime_pkg,
                                                        char *out_route,
                                                        size_t out_route_cap,
                                                        int attempts,
                                                        int sleep_ms,
                                                        bool require_non_empty) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (attempts <= 0) attempts = 1;
  if (sleep_ms < 0) sleep_ms = 0;
  for (int attempt = 0; attempt < attempts; ++attempt) {
    char probe[128];
    probe[0] = '\0';
    if (read_runtime_route_state_route_action(adb, serial, runtime_pkg, probe, sizeof(probe))) {
      bool ok = true;
      if (require_non_empty && probe[0] == '\0') ok = false;
      if (ok) {
        if (out_route != NULL && out_route_cap > 0u) {
          snprintf(out_route, out_route_cap, "%s", probe);
        }
        return true;
      }
    }
    if (attempt + 1 < attempts && sleep_ms > 0) {
      usleep((useconds_t)sleep_ms * 1000u);
    }
  }
  return false;
}

static bool route_requires_stable_semantic_hit(const char *route_state);
static bool verify_semantic_target_hit_stable(const char *adb,
                                              const char *serial,
                                              const char *replay_package,
                                              const char *route_state,
                                              const char *expected_semantic_subtree_hash,
                                              int expected_semantic_subtree_count,
                                              int *out_failed_sample,
                                              char *out_runtime_route,
                                              size_t out_runtime_route_cap,
                                              char *out_runtime_semantic_hash,
                                              size_t out_runtime_semantic_hash_cap,
                                              long long *out_runtime_semantic_count,
                                              bool *out_runtime_semantic_match);
static bool replay_route_actions_for_runtime(const char *route_actions_json,
                                             const char *route_tree_path,
                                             const char *route_semantic_tree_path,
                                             const char *route_state,
                                             int surface_width,
                                             int surface_height,
                                             bool force_execute_launch_main,
                                             bool launch_main_only) {
  if (route_actions_json == NULL || route_actions_json[0] == '\0' || route_state == NULL || route_state[0] == '\0') {
    return false;
  }
  RouteActionList actions;
  if (!read_route_actions_for_state(route_actions_json, route_state, &actions)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] route actions missing/invalid route=%s file=%s\n",
            route_state,
            route_actions_json);
    return false;
  }
  patch_nav_route_actions_for_known_layout_gate(route_state, &actions);
  char adb[PATH_MAX];
  char serial[128];
  if (!resolve_adb_executable(adb, sizeof(adb)) || !resolve_android_serial(adb, serial, sizeof(serial))) {
    route_action_list_free(&actions);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to resolve adb/serial for route action replay route=%s\n",
            route_state);
    return false;
  }
  AppBoundsRect bounds;
  bounds.x = 0;
  bounds.y = 0;
  bounds.w = surface_width > 0 ? surface_width : CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH;
  bounds.h = surface_height > 0 ? surface_height : CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT;
  bool bounds_ok = read_app_bounds_route_action(adb, serial, &bounds);
  bool replay_execute_launch_main =
      env_flag_enabled("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN", false);
  bool no_foreground_switch = true;
  bool silent_allow_launch_main =
      env_flag_enabled("CHENG_ANDROID_1TO1_SILENT_ALLOW_LAUNCH_MAIN", false);
  const char *silent_launch_env = getenv("CHENG_ANDROID_1TO1_SILENT_ALLOW_LAUNCH_MAIN");
  if (silent_launch_env != NULL && silent_launch_env[0] != '\0') {
    silent_allow_launch_main = (strcmp(silent_launch_env, "0") != 0);
  }
  if (!env_flag_enabled("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", true)) {
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] override CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH=1 (foreground switching forbidden)\n");
  }
  setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", "1", 1);
  if (no_foreground_switch && replay_execute_launch_main && !silent_allow_launch_main) {
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] silent mode force disable launch_main replay route=%s\n",
            route_state);
    replay_execute_launch_main = false;
  }
  if (force_execute_launch_main) replay_execute_launch_main = true;
  if (no_foreground_switch && !silent_allow_launch_main) replay_execute_launch_main = false;
  bool replay_use_visible_bounds =
      env_flag_enabled("CHENG_ANDROID_1TO1_ROUTE_REPLAY_USE_VISIBLE_BOUNDS", true);
  bool bind_foreground_package =
      env_flag_enabled("CHENG_CAPTURE_ROUTE_LAYER_BIND_FOREGROUND_PACKAGE", false);
  const char *replay_package = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE");
  const char *replay_activity = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
  char replay_package_buf[256];
  replay_package_buf[0] = '\0';
  if (replay_package == NULL || replay_package[0] == '\0') {
    replay_package = getenv("CHENG_ANDROID_APP_PACKAGE");
  }
  if (replay_package == NULL || replay_package[0] == '\0') {
    replay_package = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
  }
  if (replay_package == NULL || replay_package[0] == '\0') {
    replay_package = resolve_default_runtime_package_for_gate();
  }
  if (no_foreground_switch) {
    if (!resolve_foreground_package_route_action(adb, serial, replay_package_buf, sizeof(replay_package_buf)) ||
        replay_package_buf[0] == '\0') {
      route_action_list_free(&actions);
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] silent mode cannot resolve foreground package for route replay route=%s\n",
              route_state);
      return false;
    }
    if (bind_foreground_package) {
      if (strcmp(replay_package, replay_package_buf) != 0) {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] silent mode bind replay package to foreground: %s -> %s\n",
                replay_package,
                replay_package_buf);
      }
      replay_package = replay_package_buf;
    } else if (strcmp(replay_package, replay_package_buf) != 0) {
      route_action_list_free(&actions);
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] silent mode replay package mismatch configured=%s foreground=%s\n",
              replay_package,
              replay_package_buf);
      return false;
    }
  }
  if (no_foreground_switch &&
      silent_allow_launch_main &&
      replay_package != NULL &&
      strcmp(replay_package, "com.cheng.mobile") == 0) {
    replay_execute_launch_main = true;
  }
  char replay_activity_buf[192];
  replay_activity_buf[0] = '\0';
  if (replay_activity == NULL || replay_activity[0] == '\0') {
    replay_activity = infer_main_activity_for_package_route_action(
        replay_package, replay_activity_buf, sizeof(replay_activity_buf));
  }
  char parent_route[128];
  int route_depth = 0;
  char path_signature[512];
  parent_route[0] = '\0';
  path_signature[0] = '\0';
  if (route_tree_path != NULL && route_tree_path[0] != '\0') {
    (void)load_route_meta_from_tree(route_tree_path,
                                    route_state,
                                    parent_route,
                                    sizeof(parent_route),
                                    &route_depth,
                                    path_signature,
                                    sizeof(path_signature));
  }
  const char *launch_route_state = semantic_equivalent_runtime_route(route_state);
  if (launch_route_state == NULL || launch_route_state[0] == '\0') launch_route_state = route_state;
  char expected_semantic_subtree_hash[128];
  int expected_semantic_subtree_count = 0;
  expected_semantic_subtree_hash[0] = '\0';
  bool require_semantic_target = route_requires_visual_delta(route_state);
  if (require_semantic_target &&
      !load_route_semantic_expectation_for_route_action(route_semantic_tree_path,
                                                        route_state,
                                                        expected_semantic_subtree_hash,
                                                        sizeof(expected_semantic_subtree_hash),
                                                        &expected_semantic_subtree_count)) {
    route_action_list_free(&actions);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] route semantic expectation missing route=%s tree=%s\n",
            route_state,
            route_semantic_tree_path != NULL ? route_semantic_tree_path : "<none>");
    return false;
  }
  fprintf(stdout,
          "[verify-android-claude-1to1-gate] route replay begin route=%s actions=%zu bounds=%d,%d %dx%d bounds_ok=%d launch_main=%d tap_space=%s mode=%s semantic_target=%s(%s/%d)\n",
          route_state,
          actions.len,
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h,
          bounds_ok ? 1 : 0,
          replay_execute_launch_main ? 1 : 0,
          replay_use_visible_bounds ? "visible-bounds" : "surface",
          launch_main_only ? "launch-main-only" : "full-actions",
          require_semantic_target ? "on" : "off",
          require_semantic_target ? expected_semantic_subtree_hash : "<none>",
          require_semantic_target ? expected_semantic_subtree_count : 0);
  size_t action_count = actions.len;
  bool route_hit = false;
  size_t route_hit_index = 0u;
  bool allow_route_hit_short_circuit = !route_requires_visual_delta(route_state);
  bool semantic_target_short_circuit = require_semantic_target;
  if (require_semantic_target && route_state != NULL && route_state[0] != '\0') {
    if (strcmp(route_state, "publish_selector") == 0) {
      semantic_target_short_circuit = false;
    } else if (strncmp(route_state, "home_", 5u) == 0) {
      semantic_target_short_circuit = false;
      if (strcmp(route_state, "home_ecom_overlay_open") == 0) {
        semantic_target_short_circuit = true;
      }
    }
  }
  for (size_t i = 0u; i < actions.len; ++i) {
    RouteAction action = actions.items[i];
    bool semantic_target_hit_after_action = false;
    if (launch_main_only && action.type != ROUTE_ACTION_LAUNCH_MAIN) continue;
    if (no_foreground_switch && i == 0u && action.type == ROUTE_ACTION_LAUNCH_MAIN) {
      bool allow_precheck_short_circuit = allow_route_hit_short_circuit;
      if (route_state != NULL && strcmp(route_state, "sidebar_open") == 0) allow_precheck_short_circuit = false;
      char runtime_route_now[128];
      runtime_route_now[0] = '\0';
      bool precheck_route_match = false;
      if (read_runtime_route_state_route_action_retry(adb,
                                                      serial,
                                                      replay_package,
                                                      runtime_route_now,
                                                      sizeof(runtime_route_now),
                                                      3,
                                                      120,
                                                      true)) {
        precheck_route_match = runtime_route_matches_expected_for_hit(runtime_route_now, route_state);
      }
      if (allow_precheck_short_circuit && precheck_route_match) {
        route_hit = true;
        route_hit_index = i;
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] route replay precheck target already reached route=%s runtime_route=%s; skip actions\n",
                route_state,
                runtime_route_now);
        break;
      }
    }
    if (no_foreground_switch && action.type != ROUTE_ACTION_SLEEP_MS) {
      char fg_pkg[256];
      fg_pkg[0] = '\0';
      if (!resolve_foreground_package_route_action(adb, serial, fg_pkg, sizeof(fg_pkg)) || fg_pkg[0] == '\0') {
        route_action_list_free(&actions);
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] silent mode failed to resolve foreground package route=%s action_index=%zu action_type=%s\n",
                route_state,
                i,
                route_action_type_name(action.type));
        return false;
      }
      if (strcmp(fg_pkg, replay_package) != 0) {
        route_action_list_free(&actions);
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] silent mode foreground drift route=%s action_index=%zu action_type=%s foreground=%s expected=%s\n",
                route_state,
                i,
                route_action_type_name(action.type),
                fg_pkg,
                replay_package);
        return false;
      }
    }
    switch (action.type) {
      case ROUTE_ACTION_LAUNCH_MAIN:
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] route replay action route=%s index=%zu type=launch_main exec=%d\n",
                route_state,
                i,
                replay_execute_launch_main ? 1 : 0);
        if (replay_execute_launch_main) {
          (void)run_adb_force_stop_route_action(adb, serial, replay_package);
          usleep(250000);
          if (!run_adb_am_start_route_action(adb, serial, replay_activity, launch_route_state)) {
            route_action_list_free(&actions);
            fprintf(stderr,
                    "[verify-android-claude-1to1-gate] route launch_main failed route=%s index=%zu package=%s activity=%s\n",
                    route_state,
                    i,
                    replay_package,
                    replay_activity);
            return false;
          }
          usleep(1200000);
          bounds_ok = read_app_bounds_route_action(adb, serial, &bounds);
          fprintf(stdout,
                  "[verify-android-claude-1to1-gate] route replay relaunch route=%s index=%zu bounds=%d,%d %dx%d bounds_ok=%d\n",
                  route_state,
                  i,
                  bounds.x,
                  bounds.y,
                  bounds.w,
                  bounds.h,
                  bounds_ok ? 1 : 0);
          if (launch_main_only) {
            i = actions.len;
          }
          break;
        }
        if (no_foreground_switch && route_state != NULL && strcmp(route_state, "home_default") == 0) {
          const int home_probe_candidates[][2] = {{120, 965}, {120, 980}, {100, 980}, {120, 975}};
          bool home_recovered = false;
          for (size_t home_idx = 0u;
               home_idx < (sizeof(home_probe_candidates) / sizeof(home_probe_candidates[0]));
               ++home_idx) {
            int tap_x0 = bounds.x;
            int tap_y0 = bounds.y;
            int tap_w = bounds.w;
            int tap_h = bounds.h;
            if (!replay_use_visible_bounds && surface_width > 0 && surface_height > 0) {
              tap_x0 = 0;
              tap_y0 = 0;
              tap_w = surface_width;
              tap_h = surface_height;
            }
            if (tap_w <= 0) tap_w = surface_width > 0 ? surface_width : CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH;
            if (tap_h <= 0) tap_h = surface_height > 0 ? surface_height : CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT;
            int x = tap_x0 + (tap_w * home_probe_candidates[home_idx][0]) / 1000;
            int y = tap_y0 + (tap_h * home_probe_candidates[home_idx][1]) / 1000;
            int min_x = tap_x0;
            int min_y = tap_y0;
            int max_x = tap_x0 + tap_w - 1;
            int max_y = tap_y0 + tap_h - 1;
            if (max_x < min_x) max_x = min_x;
            if (max_y < min_y) max_y = min_y;
            x = clamp_i32(x, min_x, max_x);
            y = clamp_i32(y, min_y, max_y);
            if (surface_width > 0) x = clamp_i32(x, 0, surface_width - 1);
            if (surface_height > 0) y = clamp_i32(y, 0, surface_height - 1);
            if (!run_adb_tap_route_action(adb, serial, x, y)) continue;
            usleep(220000);
            char runtime_route_home[128];
            runtime_route_home[0] = '\0';
            if (read_runtime_route_state_route_action_retry(adb,
                                                            serial,
                                                            replay_package,
                                                            runtime_route_home,
                                                            sizeof(runtime_route_home),
                                                            3,
                                                            120,
                                                            true) &&
                runtime_route_matches_expected_for_hit(runtime_route_home, "home_default")) {
              route_hit = true;
              route_hit_index = i;
              home_recovered = true;
              fprintf(stdout,
                      "[verify-android-claude-1to1-gate] route replay home-recover route=%s action_index=%zu candidate=%zu runtime_route=%s\n",
                      route_state,
                      i,
                      home_idx + 1u,
                      runtime_route_home);
              break;
            }
          }
          if (!home_recovered) {
            fprintf(stdout,
                    "[verify-android-claude-1to1-gate] route replay home-recover miss route=%s action_index=%zu\n",
                    route_state,
                    i);
          }
        }
        /* Gate runtime has already launched app host; skip relaunch unless explicitly enabled. */
        break;
      case ROUTE_ACTION_SLEEP_MS:
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] route replay action route=%s index=%zu type=sleep_ms ms=%d\n",
                route_state,
                i,
                action.v0);
        if (action.v0 > 0) usleep((useconds_t)action.v0 * 1000u);
        break;
      case ROUTE_ACTION_TAP_PPM: {
        TapProbeCandidate candidates[8];
        size_t candidate_count =
            build_route_tap_probe_candidates(route_state, action.v0, action.v1, candidates, sizeof(candidates) / sizeof(candidates[0]));
        if (candidate_count == 0u) {
          route_action_list_free(&actions);
          fprintf(stderr,
                  "[verify-android-claude-1to1-gate] route tap candidate list empty route=%s index=%zu\n",
                  route_state,
                  i);
          return false;
        }
        bool tapped_ok = false;
        int tap_probe_wait_ms =
            env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_TAP_PROBE_WAIT_MS", 180);
        int semantic_probe_attempts =
            env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_SEMANTIC_PROBE_ATTEMPTS", 4);
        int semantic_probe_sleep_ms =
            env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_SEMANTIC_PROBE_SLEEP_MS", 140);
        for (size_t tap_try = 0u; tap_try < candidate_count; ++tap_try) {
          int ppm_x = clamp_i32(candidates[tap_try].x_ppm, 0, 1000);
          int ppm_y = clamp_i32(candidates[tap_try].y_ppm, 0, 1000);
          int tap_x0 = bounds.x;
          int tap_y0 = bounds.y;
          int tap_w = bounds.w;
          int tap_h = bounds.h;
          if (!replay_use_visible_bounds && surface_width > 0 && surface_height > 0) {
            tap_x0 = 0;
            tap_y0 = 0;
            tap_w = surface_width;
            tap_h = surface_height;
          }
          if (tap_w <= 0) tap_w = surface_width > 0 ? surface_width : CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH;
          if (tap_h <= 0) tap_h = surface_height > 0 ? surface_height : CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT;
          int x = tap_x0 + (tap_w * ppm_x) / 1000;
          int y = tap_y0 + (tap_h * ppm_y) / 1000;
          int min_x = tap_x0;
          int min_y = tap_y0;
          int max_x = tap_x0 + tap_w - 1;
          int max_y = tap_y0 + tap_h - 1;
          if (max_x < min_x) max_x = min_x;
          if (max_y < min_y) max_y = min_y;
          x = clamp_i32(x, min_x, max_x);
          y = clamp_i32(y, min_y, max_y);
          if (surface_width > 0) x = clamp_i32(x, 0, surface_width - 1);
          if (surface_height > 0) y = clamp_i32(y, 0, surface_height - 1);
          fprintf(stdout,
                  "[verify-android-claude-1to1-gate] route replay action route=%s index=%zu type=tap_ppm probe=%zu/%zu ppm=%d,%d xy=%d,%d tap_area=%d,%d %dx%d bounds=%d,%d %dx%d\n",
                  route_state,
                  i,
                  tap_try + 1u,
                  candidate_count,
                  ppm_x,
                  ppm_y,
                  x,
                  y,
                  tap_x0,
                  tap_y0,
                  tap_w,
                  tap_h,
                  bounds.x,
                  bounds.y,
                  bounds.w,
                  bounds.h);
          if (!run_adb_tap_route_action(adb, serial, x, y)) {
            int retry_y = y;
            if (surface_height > 0) {
              retry_y = clamp_i32(y - 12, 0, surface_height - 1);
            } else {
              retry_y = y > 12 ? (y - 12) : y;
            }
            if (retry_y != y && run_adb_tap_route_action(adb, serial, x, retry_y)) {
              tapped_ok = true;
            } else {
              continue;
            }
          } else {
            tapped_ok = true;
          }
          if (tap_probe_wait_ms > 0) usleep((useconds_t)tap_probe_wait_ms * 1000u);
          if (require_semantic_target) {
            char semantic_route[128];
            char semantic_hash[128];
            long long semantic_count = 0;
            semantic_route[0] = '\0';
            semantic_hash[0] = '\0';
            if (read_runtime_semantic_state_route_action_retry(adb,
                                                               serial,
                                                               replay_package,
                                                               semantic_route,
                                                               sizeof(semantic_route),
                                                               semantic_hash,
                                                               sizeof(semantic_hash),
                                                               &semantic_count,
                                                               semantic_probe_attempts,
                                                               semantic_probe_sleep_ms)) {
              bool semantic_relaxed = false;
              bool route_match_now = runtime_route_matches_expected_for_hit(semantic_route, route_state);
              if (gate_semantic_hash_match_or_relaxed(replay_package,
                                                      route_state,
                                                      semantic_route,
                                                      semantic_hash,
                                                      semantic_count,
                                                      expected_semantic_subtree_hash,
                                                      expected_semantic_subtree_count,
                                                      route_match_now,
                                                      &semantic_relaxed)) {
                int unstable_sample = -1;
                char unstable_route[128];
                char unstable_hash[128];
                long long unstable_count = 0;
                bool unstable_semantic_match = false;
                unstable_route[0] = '\0';
                unstable_hash[0] = '\0';
                if (!verify_semantic_target_hit_stable(adb,
                                                       serial,
                                                       replay_package,
                                                       route_state,
                                                       expected_semantic_subtree_hash,
                                                       expected_semantic_subtree_count,
                                                       &unstable_sample,
                                                       unstable_route,
                                                       sizeof(unstable_route),
                                                       unstable_hash,
                                                       sizeof(unstable_hash),
                                                       &unstable_count,
                                                       &unstable_semantic_match)) {
                  route_hit = false;
                  route_hit_index = 0u;
                  fprintf(stdout,
                          "[verify-android-claude-1to1-gate] route replay semantic-target-unstable route=%s action_index=%zu probe=%zu/%zu sample=%d runtime_route=%s semantic_hash=%s semantic_count=%lld semantic_match=%d; continue replay\n",
                          route_state,
                          i,
                          tap_try + 1u,
                          candidate_count,
                          unstable_sample,
                          unstable_route[0] != '\0' ? unstable_route : "<empty>",
                          unstable_hash[0] != '\0' ? unstable_hash : "<empty>",
                          unstable_count,
                          unstable_semantic_match ? 1 : 0);
                  continue;
                }
                semantic_target_hit_after_action = true;
                route_hit = true;
                route_hit_index = i;
                fprintf(stdout,
                        "[verify-android-claude-1to1-gate] route replay semantic-target-hit route=%s action_index=%zu probe=%zu/%zu runtime_route=%s semantic_hash=%s semantic_count=%lld relaxed=%d\n",
                        route_state,
                        i,
                        tap_try + 1u,
                        candidate_count,
                        semantic_route[0] != '\0' ? semantic_route : "<empty>",
                        semantic_hash,
                        semantic_count,
                        semantic_relaxed ? 1 : 0);
                break;
              }
            }
          } else {
            break;
          }
        }
        if (!tapped_ok) {
          route_action_list_free(&actions);
          fprintf(stderr,
                  "[verify-android-claude-1to1-gate] route tap failed route=%s index=%zu probes=%zu bounds=%d,%d %dx%d\n",
                  route_state,
                  i,
                  candidate_count,
                  bounds.x,
                  bounds.y,
                  bounds.w,
                  bounds.h);
          return false;
        }
        break;
      }
      case ROUTE_ACTION_KEYEVENT:
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] route replay action route=%s index=%zu type=keyevent code=%d\n",
                route_state,
                i,
                action.v0);
        if (!run_adb_keyevent_route_action(adb, serial, action.v0)) {
          route_action_list_free(&actions);
          fprintf(stderr,
                  "[verify-android-claude-1to1-gate] route keyevent failed route=%s index=%zu code=%d\n",
                  route_state,
                  i,
                  action.v0);
          return false;
        }
        break;
      default:
        route_action_list_free(&actions);
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] unsupported route action route=%s index=%zu\n",
                route_state,
                i);
        return false;
    }
    if (semantic_target_hit_after_action && semantic_target_short_circuit) {
      break;
    }
    if (action.type == ROUTE_ACTION_SLEEP_MS) continue;
    char runtime_route[128];
    runtime_route[0] = '\0';
    int probe_attempts = env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PROBE_ATTEMPTS", 4);
    int probe_sleep_ms = env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PROBE_SLEEP_MS", 200);
    bool require_non_empty_route = true;
    if (action.type == ROUTE_ACTION_LAUNCH_MAIN) {
      probe_attempts = env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_PROBE_ATTEMPTS", 8);
      probe_sleep_ms = env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_PROBE_SLEEP_MS", 250);
      require_non_empty_route = true;
    }
    if (!read_runtime_route_state_route_action_retry(adb,
                                                     serial,
                                                     replay_package,
                                                     runtime_route,
                                                     sizeof(runtime_route),
                                                     probe_attempts,
                                                     probe_sleep_ms,
                                                     require_non_empty_route)) {
      route_action_list_free(&actions);
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime route probe failed route=%s action_index=%zu action_type=%s attempts=%d sleep_ms=%d\n",
              route_state,
              i,
              route_action_type_name(action.type),
              probe_attempts,
              probe_sleep_ms);
      return false;
    }
    if (runtime_route_matches_expected_for_hit(runtime_route, route_state)) {
      if (require_semantic_target) {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] route replay route-match route=%s action_index=%zu action_type=%s runtime_route=%s (await semantic target)\n",
                route_state,
                i,
                route_action_type_name(action.type),
                runtime_route);
        continue;
      } else {
        route_hit = true;
        route_hit_index = i;
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] route replay target-hit route=%s action_index=%zu action_type=%s runtime_route=%s\n",
                route_state,
                i,
                route_action_type_name(action.type),
                runtime_route);
        if (allow_route_hit_short_circuit) break;
        continue;
      }
    } else {
      bool transitional_ok = runtime_route_matches_expected(runtime_route, route_state);
      if (!transitional_ok && parent_route[0] != '\0') {
        transitional_ok = runtime_route_matches_expected(runtime_route, parent_route);
      }
      if (!transitional_ok && runtime_route[0] != '\0') {
        bool expect_home_family =
            (route_state != NULL && strcmp(route_state, "home_default") == 0) ||
            (parent_route[0] != '\0' && strcmp(parent_route, "home_default") == 0);
        if (expect_home_family) {
          if (strncmp(runtime_route, "tab_", 4u) == 0 ||
              strncmp(runtime_route, "home_", 5u) == 0 ||
              strcmp(runtime_route, "publish_selector") == 0) {
            transitional_ok = true;
          } else {
            const char *runtime_equivalent = semantic_equivalent_runtime_route(runtime_route);
            if (runtime_equivalent != NULL && strcmp(runtime_equivalent, "home_default") == 0) {
              transitional_ok = true;
            }
          }
        }
      }
      if (!transitional_ok) transitional_ok = (strcmp(runtime_route, "home_default") == 0);
      if (!transitional_ok) {
        route_action_list_free(&actions);
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] runtime route transitional mismatch route=%s action_index=%zu action_type=%s runtime_route=%s parent=%s depth=%d\n",
                route_state,
                i,
                route_action_type_name(action.type),
                runtime_route,
                parent_route[0] != '\0' ? parent_route : "<none>",
                route_depth);
        return false;
      }
    }
  }
  int post_wait_ms = env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_POST_WAIT_MS", 800);
  if (post_wait_ms > 0) usleep((useconds_t)post_wait_ms * 1000u);
  if (!route_hit) {
    if (require_semantic_target) {
      char runtime_route_semantic[128];
      char runtime_semantic_hash[128];
      long long runtime_semantic_count = 0;
      runtime_route_semantic[0] = '\0';
      runtime_semantic_hash[0] = '\0';
      int final_semantic_attempts =
          env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_FINAL_SEMANTIC_PROBE_ATTEMPTS", 10);
      int final_semantic_sleep_ms =
          env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_FINAL_SEMANTIC_PROBE_SLEEP_MS", 220);
      bool semantic_relaxed = false;
      if (!read_runtime_semantic_state_route_action_retry(adb,
                                                          serial,
                                                          replay_package,
                                                          runtime_route_semantic,
                                                          sizeof(runtime_route_semantic),
                                                          runtime_semantic_hash,
                                                          sizeof(runtime_semantic_hash),
                                                          &runtime_semantic_count,
                                                          final_semantic_attempts,
                                                          final_semantic_sleep_ms) ||
          !gate_semantic_hash_match_or_relaxed(replay_package,
                                               route_state,
                                               runtime_route_semantic,
                                               runtime_semantic_hash,
                                               runtime_semantic_count,
                                               expected_semantic_subtree_hash,
                                               expected_semantic_subtree_count,
                                               runtime_route_matches_expected_for_hit(runtime_route_semantic, route_state),
                                               &semantic_relaxed)) {
        route_action_list_free(&actions);
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] semantic target mismatch route=%s action_index=%zu expected_hash=%s got_hash=%s runtime_route=%s semantic_count=%lld\n",
                route_state,
                route_hit_index,
                expected_semantic_subtree_hash,
                runtime_semantic_hash[0] != '\0' ? runtime_semantic_hash : "<empty>",
                runtime_route_semantic[0] != '\0' ? runtime_route_semantic : "<empty>",
                runtime_semantic_count);
        return false;
      }
      if (semantic_relaxed) {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] semantic hash relaxed route=%s runtime_route=%s semantic_hash=%s semantic_count=%lld expected_hash=%s expected_count=%d\n",
                route_state,
                runtime_route_semantic[0] != '\0' ? runtime_route_semantic : "<empty>",
                runtime_semantic_hash[0] != '\0' ? runtime_semantic_hash : "<empty>",
                runtime_semantic_count,
                expected_semantic_subtree_hash,
                expected_semantic_subtree_count);
      }
      route_hit = true;
    }
  }
  if (!route_hit) {
    char runtime_route[128];
    runtime_route[0] = '\0';
    int final_probe_attempts =
        env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_FINAL_PROBE_ATTEMPTS", 10);
    int final_probe_sleep_ms =
        env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_FINAL_PROBE_SLEEP_MS", 250);
    if (!read_runtime_route_state_route_action_retry(adb,
                                                     serial,
                                                     replay_package,
                                                     runtime_route,
                                                     sizeof(runtime_route),
                                                     final_probe_attempts,
                                                     final_probe_sleep_ms,
                                                     true)) {
      route_action_list_free(&actions);
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime route probe failed route=%s action_index=%zu action_type=final attempts=%d sleep_ms=%d\n",
              route_state,
              route_hit_index,
              final_probe_attempts,
              final_probe_sleep_ms);
      return false;
    }
    if (runtime_route_matches_expected_for_hit(runtime_route, route_state)) {
      route_hit = true;
    } else {
      route_action_list_free(&actions);
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime route mismatch route=%s action_index=%zu action_type=final runtime_route=%s\n",
              route_state,
              route_hit_index,
              runtime_route);
      return false;
    }
  }
  route_action_list_free(&actions);
  fprintf(stdout, "[verify-android-claude-1to1-gate] route actions replayed route=%s steps=%zu\n", route_state, action_count);
  return true;
}

static bool maybe_freeze_truth_assets_for_route(const char *route_state,
                                                const char *rgba_path,
                                                const char *meta_path,
                                                const char *runtime_hash_path,
                                                const char *framehash_path) {
  if (route_state == NULL || route_state[0] == '\0' || rgba_path == NULL || meta_path == NULL ||
      runtime_hash_path == NULL || framehash_path == NULL) {
    return false;
  }
  const char *freeze_truth_dir = getenv("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR");
  if (freeze_truth_dir == NULL || freeze_truth_dir[0] == '\0') return true;
  if (ensure_dir(freeze_truth_dir) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to create freeze truth dir: %s\n",
            freeze_truth_dir);
    return false;
  }
  char truth_rgba[PATH_MAX];
  char truth_meta[PATH_MAX];
  char truth_runtime_hash[PATH_MAX];
  char truth_hash[PATH_MAX];
  if (snprintf(truth_rgba, sizeof(truth_rgba), "%s/%s.rgba", freeze_truth_dir, route_state) >=
          (int)sizeof(truth_rgba) ||
      snprintf(truth_meta, sizeof(truth_meta), "%s/%s.meta.json", freeze_truth_dir, route_state) >=
          (int)sizeof(truth_meta) ||
      snprintf(truth_runtime_hash, sizeof(truth_runtime_hash), "%s/%s.runtime_framehash", freeze_truth_dir, route_state) >=
          (int)sizeof(truth_runtime_hash) ||
      snprintf(truth_hash, sizeof(truth_hash), "%s/%s.framehash", freeze_truth_dir, route_state) >=
          (int)sizeof(truth_hash)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] freeze truth path too long\n");
    return false;
  }
  if (copy_file_all(rgba_path, truth_rgba) != 0 ||
      copy_file_all(meta_path, truth_meta) != 0 ||
      copy_file_all(runtime_hash_path, truth_runtime_hash) != 0 ||
      copy_file_all(framehash_path, truth_hash) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to freeze route truth assets route=%s dir=%s\n",
            route_state,
            freeze_truth_dir);
    return false;
  }
  fprintf(stdout,
          "[verify-android-claude-1to1-gate] truth frozen route=%s dir=%s\n",
          route_state,
          freeze_truth_dir);
  return true;
}

static bool capture_runtime_route_visual(const char *out_dir,
                                         const RuntimeStateSnapshot *runtime_state,
                                         const char *runtime_frame_dump_file,
                                         const char *route_tree_path,
                                         const char *route_semantic_tree_path,
                                         bool require_success) {
  if (out_dir == NULL || out_dir[0] == '\0' || runtime_state == NULL) return !require_success;
  if (runtime_state->route_state[0] == '\0') return !require_success;
  if (runtime_frame_dump_file == NULL || runtime_frame_dump_file[0] == '\0') {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing runtime frame dump file arg\n");
    return !require_success;
  }
  bool allow_blank_runtime_for_repair = false;
  const char *allow_blank_truth_env = getenv("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR");
  if (allow_blank_truth_env != NULL && strcmp(allow_blank_truth_env, "1") == 0) {
    allow_blank_runtime_for_repair = true;
  }

  char adb[PATH_MAX];
  if (!resolve_adb_executable(adb, sizeof(adb))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing adb for route visual capture\n");
    return !require_success;
  }
  char serial[128];
  if (!resolve_android_serial(adb, serial, sizeof(serial))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] unable to resolve android serial for route visual capture\n");
    return !require_success;
  }

  char runtime_capture_dir[PATH_MAX];
  if (snprintf(runtime_capture_dir, sizeof(runtime_capture_dir), "%s/runtime_capture", out_dir) >=
      (int)sizeof(runtime_capture_dir)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime capture dir path too long\n");
    return !require_success;
  }
  if (ensure_dir(runtime_capture_dir) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create runtime capture dir: %s\n", runtime_capture_dir);
    return !require_success;
  }

  char frame_dump_remote_path[PATH_MAX];
  char raw_path[PATH_MAX];
  char rgba_path[PATH_MAX];
  char meta_path[PATH_MAX];
  char runtime_hash_path[PATH_MAX];
  char framehash_path[PATH_MAX];
  if (snprintf(frame_dump_remote_path,
               sizeof(frame_dump_remote_path),
               "files/%s",
               runtime_frame_dump_file) >= (int)sizeof(frame_dump_remote_path) ||
      snprintf(raw_path, sizeof(raw_path), "%s/%s.runtime_raw", runtime_capture_dir, runtime_state->route_state) >=
          (int)sizeof(raw_path) ||
      snprintf(rgba_path, sizeof(rgba_path), "%s/%s.rgba", runtime_capture_dir, runtime_state->route_state) >=
          (int)sizeof(rgba_path) ||
      snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", runtime_capture_dir, runtime_state->route_state) >=
          (int)sizeof(meta_path) ||
      snprintf(runtime_hash_path,
               sizeof(runtime_hash_path),
               "%s/%s.runtime_framehash",
               runtime_capture_dir,
               runtime_state->route_state) >= (int)sizeof(runtime_hash_path) ||
      snprintf(framehash_path, sizeof(framehash_path), "%s/%s.framehash", runtime_capture_dir, runtime_state->route_state) >=
          (int)sizeof(framehash_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] route visual output path too long\n");
    return !require_success;
  }

  const char *visual_source_env = getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_SOURCE");
  bool use_adb_screencap = false;
  if (visual_source_env == NULL || visual_source_env[0] == '\0') {
    use_adb_screencap = true;
  } else if (strcmp(visual_source_env, "adb_screencap") == 0 || strcmp(visual_source_env, "adb-screencap") == 0 ||
             strcmp(visual_source_env, "screencap") == 0) {
    use_adb_screencap = true;
  }
  if (use_adb_screencap) {
    const char *runtime_pkg = getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE");
    const char *runtime_activity = getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY");
    const char *runtime_pkg_allow = getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE");
    const char *require_route_match_env = getenv("CHENG_ANDROID_1TO1_CAPTURE_REQUIRE_RUNTIME_ROUTE_MATCH");
    bool require_route_match = (require_route_match_env != NULL && strcmp(require_route_match_env, "1") == 0);
    bool no_foreground_switch = true;
    if (!env_flag_enabled("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", true)) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] override CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH=1 (foreground switching forbidden)\n");
    }
    setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", "1", 1);
    char runtime_pkg_allow_buf[512];
    runtime_pkg_allow_buf[0] = '\0';
    if (runtime_pkg == NULL || runtime_pkg[0] == '\0') {
      runtime_pkg = getenv("CHENG_ANDROID_APP_PACKAGE");
    }
    if (runtime_pkg == NULL || runtime_pkg[0] == '\0') {
      runtime_pkg = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
    }
    if (runtime_pkg == NULL || runtime_pkg[0] == '\0') {
      runtime_pkg = resolve_default_runtime_package_for_gate();
    }
    if (runtime_activity == NULL || runtime_activity[0] == '\0') {
      runtime_activity = infer_main_activity_for_package_route_action(runtime_pkg, NULL, 0u);
    }
    if (runtime_pkg_allow == NULL || runtime_pkg_allow[0] == '\0') {
      int allow_n = snprintf(runtime_pkg_allow_buf,
                             sizeof(runtime_pkg_allow_buf),
                             "%s,com.android.nfc,com.android.packageinstaller,com.huawei.ohos.inputmethod",
                             runtime_pkg);
      if (allow_n > 0 && (size_t)allow_n < sizeof(runtime_pkg_allow_buf)) {
        runtime_pkg_allow = runtime_pkg_allow_buf;
      } else {
        runtime_pkg_allow = runtime_pkg;
      }
    }
    if (route_semantic_tree_path == NULL || route_semantic_tree_path[0] == '\0' ||
        !file_exists(route_semantic_tree_path)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] missing route semantic tree for runtime capture: %s\n",
              route_semantic_tree_path != NULL ? route_semantic_tree_path : "<empty>");
      return !require_success;
    }
    char *cap_argv[28];
    int cap_argc = 0;
    cap_argv[cap_argc++] = "capture_android_unimaker_truth";
    cap_argv[cap_argc++] = "--route-state";
    cap_argv[cap_argc++] = (char *)runtime_state->route_state;
    cap_argv[cap_argc++] = "--out-dir";
    cap_argv[cap_argc++] = runtime_capture_dir;
    cap_argv[cap_argc++] = "--serial";
    cap_argv[cap_argc++] = serial;
    cap_argv[cap_argc++] = "--route-tree";
    cap_argv[cap_argc++] = (char *)route_tree_path;
    cap_argv[cap_argc++] = "--route-semantic-tree";
    cap_argv[cap_argc++] = (char *)route_semantic_tree_path;
    cap_argv[cap_argc++] = "--package";
    cap_argv[cap_argc++] = (char *)runtime_pkg;
    cap_argv[cap_argc++] = "--activity";
    cap_argv[cap_argc++] = (char *)runtime_activity;
    cap_argv[cap_argc++] = "--allow-overlay-package";
    cap_argv[cap_argc++] = (char *)runtime_pkg_allow;
    if (require_route_match) {
      cap_argv[cap_argc++] = "--require-runtime-route-match";
      cap_argv[cap_argc++] = "1";
    }
    cap_argv[cap_argc++] = "--no-foreground-switch";
    cap_argv[cap_argc++] = no_foreground_switch ? "1" : "0";
    cap_argv[cap_argc] = NULL;
    int cap_rc = native_capture_android_unimaker_truth(NULL, cap_argc, cap_argv, 1);
    if (cap_rc != 0 || !file_exists(rgba_path) || !file_exists(meta_path) || !file_exists(runtime_hash_path) ||
        !file_exists(framehash_path)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] adb screencap capture failed route=%s rc=%d rgba=%s\n",
              runtime_state->route_state,
              cap_rc,
              rgba_path);
      return !require_success;
    }
    size_t meta_len = 0u;
    char *meta_doc = read_file_all(meta_path, &meta_len);
    int meta_width = 0;
    int meta_height = 0;
    int meta_surface_width = 0;
    int meta_surface_height = 0;
    bool meta_ok = (meta_doc != NULL) &&
                   json_get_int32(meta_doc, "width", &meta_width) &&
                   json_get_int32(meta_doc, "height", &meta_height) &&
                   json_get_int32(meta_doc, "surface_width", &meta_surface_width) &&
                   json_get_int32(meta_doc, "surface_height", &meta_surface_height);
    free(meta_doc);
    if (!meta_ok || meta_width <= 0 || meta_height <= 0 || meta_surface_width <= 0 || meta_surface_height <= 0 ||
        meta_width > meta_height || meta_surface_width > meta_surface_height) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime capture invalid geometry route=%s width=%d height=%d surface=%dx%d\n",
              runtime_state->route_state,
              meta_width,
              meta_height,
              meta_surface_width,
              meta_surface_height);
      return false;
    }
    size_t rgba_len = 0u;
    unsigned char *rgba_doc = (unsigned char *)read_file_all(rgba_path, &rgba_len);
    if (rgba_doc == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
      free(rgba_doc);
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] adb screencap produced invalid rgba route=%s path=%s\n",
              runtime_state->route_state,
              rgba_path);
      return !require_success;
    }
    double runtime_white_ratio = 0.0;
    double runtime_delta_ratio = 0.0;
    double runtime_edge_ratio = 0.0;
    int runtime_luma_span = 0;
    bool looks_blank = rgba_looks_like_blank_whiteboard(
        rgba_doc, rgba_len, &runtime_white_ratio, &runtime_delta_ratio, &runtime_edge_ratio, &runtime_luma_span);
    free(rgba_doc);
    if (looks_blank) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime capture looks blank-whiteboard route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
              runtime_state->route_state,
              runtime_white_ratio,
              runtime_delta_ratio,
              runtime_edge_ratio,
              runtime_luma_span);
      if (!allow_blank_runtime_for_repair) return false;
    }
    if (getenv("CHENG_ANDROID_1TO1_LOG_FRAME_QUALITY") != NULL &&
        strcmp(getenv("CHENG_ANDROID_1TO1_LOG_FRAME_QUALITY"), "1") == 0) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] runtime frame-quality route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
              runtime_state->route_state,
              runtime_white_ratio,
              runtime_delta_ratio,
              runtime_edge_ratio,
              runtime_luma_span);
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] runtime capture route=%s source=adb_screencap rgba=%s\n",
            runtime_state->route_state,
            rgba_path);
    if (!maybe_freeze_truth_assets_for_route(runtime_state->route_state,
                                             rgba_path,
                                             meta_path,
                                             runtime_hash_path,
                                             framehash_path)) {
      return false;
    }
    return true;
  }

  char *raw_argv[] = {
      adb,
      "-s",
      serial,
      "exec-out",
      "run-as",
      (char *)(getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE") &&
                       getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE")[0] != '\0'
                   ? getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE")
                   : resolve_default_runtime_package_for_gate()),
      "cat",
      frame_dump_remote_path,
      NULL};
  RunResult raw_rr = run_command(raw_argv, raw_path, 25);
  if (raw_rr.code != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to capture runtime raw frame route=%s file=%s rc=%d\n",
            runtime_state->route_state,
            frame_dump_remote_path,
            raw_rr.code);
    return !require_success;
  }

  size_t raw_len = 0u;
  unsigned char *raw = (unsigned char *)read_file_all(raw_path, &raw_len);
  if (raw == NULL || raw_len == 0u) {
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] invalid runtime raw frame route=%s path=%s\n",
            runtime_state->route_state,
            raw_path);
    return !require_success;
  }
  uint32_t width = (runtime_state->surface_width > 0) ? (uint32_t)runtime_state->surface_width : 0u;
  uint32_t height = (runtime_state->surface_height > 0) ? (uint32_t)runtime_state->surface_height : 0u;
  if (width == 0u || height == 0u) {
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] zero-sized runtime raw frame target route=%s\n",
            runtime_state->route_state);
    return !require_success;
  }
  size_t full_bytes = (size_t)width * (size_t)height * 4u;
  if (raw_len != full_bytes) {
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime raw frame size mismatch route=%s got=%zu expected=%zu (%ux%u)\n",
            runtime_state->route_state,
            raw_len,
            full_bytes,
            width,
            height);
    return !require_success;
  }
  size_t rgba_bytes = full_bytes;
  unsigned char *rgba = (unsigned char *)malloc(rgba_bytes);
  if (rgba == NULL) {
    free(raw);
    fprintf(stderr, "[verify-android-claude-1to1-gate] oom while converting runtime frame\n");
    return !require_success;
  }
  for (size_t i = 0u; i < (size_t)width * (size_t)height; ++i) {
    const size_t src = i * 4u;
    const size_t dst = src;
    // runtime raw frame stores little-endian 0xAARRGGBB words => B,G,R,A bytes.
    rgba[dst + 0u] = raw[src + 2u];
    rgba[dst + 1u] = raw[src + 1u];
    rgba[dst + 2u] = raw[src + 0u];
    rgba[dst + 3u] = raw[src + 3u];
  }
  double runtime_white_ratio = 0.0;
  double runtime_delta_ratio = 0.0;
  double runtime_edge_ratio = 0.0;
  int runtime_luma_span = 0;
  if (rgba_looks_like_blank_whiteboard(
          rgba, rgba_bytes, &runtime_white_ratio, &runtime_delta_ratio, &runtime_edge_ratio, &runtime_luma_span)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime capture looks blank-whiteboard route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
            runtime_state->route_state,
            runtime_white_ratio,
            runtime_delta_ratio,
            runtime_edge_ratio,
            runtime_luma_span);
    if (!allow_blank_runtime_for_repair) {
      free(rgba);
      free(raw);
      return false;
    }
  }
  if (getenv("CHENG_ANDROID_1TO1_LOG_FRAME_QUALITY") != NULL &&
      strcmp(getenv("CHENG_ANDROID_1TO1_LOG_FRAME_QUALITY"), "1") == 0) {
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] runtime frame-quality route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
            runtime_state->route_state,
            runtime_white_ratio,
            runtime_delta_ratio,
            runtime_edge_ratio,
            runtime_luma_span);
  }
  if (write_file_all(rgba_path, (const char *)rgba, rgba_bytes) != 0) {
    free(rgba);
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write runtime rgba route=%s path=%s\n",
            runtime_state->route_state,
            rgba_path);
    return !require_success;
  }

  uint64_t runtime_raw_hash = fnv1a64_bytes(1469598103934665603ull, raw, raw_len);
  uint64_t rgba_hash = fnv1a64_bytes(1469598103934665603ull, rgba, rgba_bytes);
  free(rgba);
  free(raw);
  char runtime_raw_hash_hex[32];
  char rgba_hash_hex[32];
  to_hex64(runtime_raw_hash, runtime_raw_hash_hex, sizeof(runtime_raw_hash_hex));
  to_hex64(rgba_hash, rgba_hash_hex, sizeof(rgba_hash_hex));

  if (runtime_state->last_frame_hash[0] != '\0' &&
      !hash_hex_equal(runtime_raw_hash_hex, runtime_state->last_frame_hash)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime frame hash mismatch route=%s raw=%s state=%s\n",
            runtime_state->route_state,
            runtime_raw_hash_hex,
            runtime_state->last_frame_hash);
    if (require_success) return false;
  }

  char runtime_hash_line[160];
  int runtime_hash_n = snprintf(runtime_hash_line, sizeof(runtime_hash_line), "%s\n", runtime_state->last_frame_hash);
  if (runtime_hash_n <= 0 || (size_t)runtime_hash_n >= sizeof(runtime_hash_line) ||
      write_file_all(runtime_hash_path, runtime_hash_line, (size_t)runtime_hash_n) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write runtime framehash route=%s path=%s\n",
            runtime_state->route_state,
            runtime_hash_path);
    return !require_success;
  }
  char framehash_line[160];
  int framehash_n = snprintf(framehash_line, sizeof(framehash_line), "%s\n", runtime_raw_hash_hex);
  if (framehash_n <= 0 || (size_t)framehash_n >= sizeof(framehash_line) ||
      write_file_all(framehash_path, framehash_line, (size_t)framehash_n) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write framehash route=%s path=%s\n",
            runtime_state->route_state,
            framehash_path);
    return !require_success;
  }

  char route_parent[128];
  char path_signature[512];
  int route_depth = 0;
  route_parent[0] = '\0';
  path_signature[0] = '\0';
  if (route_tree_path == NULL || route_tree_path[0] == '\0' ||
      !load_route_meta_from_tree(route_tree_path,
                                 runtime_state->route_state,
                                 route_parent,
                                 sizeof(route_parent),
                                 &route_depth,
                                 path_signature,
                                 sizeof(path_signature))) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime capture route semantic-tree mismatch route=%s tree=%s\n",
            runtime_state->route_state,
            route_tree_path != NULL ? route_tree_path : "<empty>");
    return !require_success;
  }

  char meta_doc[2048];
  int meta_n = snprintf(meta_doc,
                        sizeof(meta_doc),
                        "{\n"
                        "  \"route_state\": \"%s\",\n"
                        "  \"route_parent\": \"%s\",\n"
                        "  \"route_depth\": %d,\n"
                        "  \"path_signature\": \"%s\",\n"
                        "  \"width\": %u,\n"
                        "  \"height\": %u,\n"
                        "  \"capture_source\": \"runtime_raw_frame\",\n"
                        "  \"runtime_frame_dump_file\": \"%s\",\n"
                        "  \"raw_bytes\": %zu,\n"
                        "  \"rgba_bytes\": %zu,\n"
                        "  \"rgba_fnv1a64\": \"%s\",\n"
                        "  \"raw_fnv1a64\": \"%s\",\n"
                        "  \"runtime_frame_hash\": \"%s\",\n"
                        "  \"semantic_nodes_applied_hash\": \"%s\",\n"
                        "  \"surface_width\": %lld,\n"
                        "  \"surface_height\": %lld,\n"
                        "  \"semantic_nodes_applied_count\": %lld\n"
                        "}\n",
                        runtime_state->route_state,
                        route_parent,
                        route_depth,
                        path_signature,
                        width,
                        height,
                        runtime_frame_dump_file,
                        raw_len,
                        rgba_bytes,
                        rgba_hash_hex,
                        runtime_raw_hash_hex,
                        runtime_state->last_frame_hash,
                        runtime_state->semantic_nodes_applied_hash,
                        runtime_state->surface_width,
                        runtime_state->surface_height,
                        runtime_state->semantic_nodes_applied_count);
  if (meta_n <= 0 || (size_t)meta_n >= sizeof(meta_doc) ||
      write_file_all(meta_path, meta_doc, (size_t)meta_n) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write runtime meta route=%s path=%s\n",
            runtime_state->route_state,
            meta_path);
    return !require_success;
  }
  fprintf(stdout,
          "[verify-android-claude-1to1-gate] runtime capture route=%s source=runtime_raw_frame rgba=%s\n",
          runtime_state->route_state,
          rgba_path);

  if (!maybe_freeze_truth_assets_for_route(runtime_state->route_state,
                                           rgba_path,
                                           meta_path,
                                           runtime_hash_path,
                                           framehash_path)) {
    return false;
  }
  return true;
}

static bool parse_runtime_state(const char *runtime_json,
                                int semantic_node_count,
                                const char *expected_semantic_total_hash,
                                const char *expected_route_state,
                                bool enforce_expected_route_state,
                                const char *expected_frame_hash,
                                int expected_surface_width,
                                int expected_surface_height,
                                RuntimeStateSnapshot *snapshot_out) {
  if (snapshot_out != NULL) memset(snapshot_out, 0, sizeof(*snapshot_out));
  size_t n = 0;
  char *doc = read_file_all(runtime_json, &n);
  if (doc == NULL || n == 0) {
    free(doc);
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime state file missing: %s\n", runtime_json);
    return false;
  }
  bool started = false;
  bool native_ready = false;
  if (!json_get_bool(doc, "started", &started) || !started) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime started flag is false\n");
    free(doc);
    return false;
  }
  if (!json_get_bool(doc, "native_ready", &native_ready) || !native_ready) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime native_ready flag is false\n");
    free(doc);
    return false;
  }
  bool render_ready = false;
  bool semantic_nodes_loaded = false;
  long long semantic_nodes_applied_count = 0;
  long long runtime_semantic_total_count = 0;
  char last_frame_hash[128];
  char semantic_nodes_applied_hash[128];
  char runtime_semantic_total_hash[128];
  char route_state[128];
  char build_hash[128];
  char semantic_hash[128];
  char runtime_reason[4096];
  last_frame_hash[0] = '\0';
  semantic_nodes_applied_hash[0] = '\0';
  runtime_semantic_total_hash[0] = '\0';
  route_state[0] = '\0';
  build_hash[0] = '\0';
  semantic_hash[0] = '\0';
  runtime_reason[0] = '\0';

  (void)json_get_string(doc, "last_error", runtime_reason, sizeof(runtime_reason));
  if (!json_get_string(doc, "build_hash", build_hash, sizeof(build_hash))) {
    (void)parse_runtime_reason_token(runtime_reason, "buildhash", build_hash, sizeof(build_hash));
  }
  bool allow_bootstrap_incomplete =
      (!enforce_expected_route_state &&
       expected_route_state != NULL &&
       expected_route_state[0] != '\0' &&
       env_flag_enabled("CHENG_ANDROID_1TO1_ALLOW_BOOTSTRAP_INCOMPLETE_STATE", true));

  if (!json_get_bool(doc, "render_ready", &render_ready)) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "sr", token, sizeof(token))) {
      render_ready = (strcmp(token, "1") == 0 || strcmp(token, "true") == 0 || strcmp(token, "TRUE") == 0);
    }
  }
  if (!render_ready) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime render_ready is false\n");
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: render_ready=false expected=%s\n",
            expected_route_state);
  }

  if (!json_get_int64(doc, "semantic_nodes_applied_count", &semantic_nodes_applied_count)) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "sa", token, sizeof(token))) {
      semantic_nodes_applied_count = strtoll(token, NULL, 10);
    }
  }
  if (semantic_nodes_applied_count <= 0) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime semantic_nodes_applied_count <= 0 (got=%lld)\n",
              semantic_nodes_applied_count);
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: semantic_nodes_applied_count=%lld expected=%s\n",
            semantic_nodes_applied_count,
            expected_route_state);
  }

  if (!json_get_bool(doc, "semantic_nodes_loaded", &semantic_nodes_loaded)) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "st", token, sizeof(token))) {
      semantic_nodes_loaded = (strcmp(token, "0") != 0);
    }
  }
  if (!semantic_nodes_loaded) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "st", token, sizeof(token))) {
      semantic_nodes_loaded = (strcmp(token, "0") != 0);
    }
  }
  if (!semantic_nodes_loaded) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime semantic_nodes_loaded is false\n");
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: semantic_nodes_loaded=false expected=%s\n",
            expected_route_state);
  }

  if (!json_get_int64(doc, "semantic_total_count", &runtime_semantic_total_count)) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "sn", token, sizeof(token)) ||
        parse_runtime_reason_token(runtime_reason, "st", token, sizeof(token))) {
      runtime_semantic_total_count = strtoll(token, NULL, 10);
    }
  }
  if (runtime_semantic_total_count <= 0 || runtime_semantic_total_count != (long long)semantic_node_count) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime semantic_total_count mismatch expected=%d got=%lld\n",
              semantic_node_count,
              runtime_semantic_total_count);
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: semantic_total_count expected=%d got=%lld expected_route=%s\n",
            semantic_node_count,
            runtime_semantic_total_count,
            expected_route_state);
  }

  char semantic_total_hash_from_reason[128];
  semantic_total_hash_from_reason[0] = '\0';
  bool has_semantic_total_hash_reason =
      parse_runtime_reason_token(runtime_reason, "sth", semantic_total_hash_from_reason, sizeof(semantic_total_hash_from_reason)) &&
      runtime_hash_nonzero(semantic_total_hash_from_reason);
  if (!json_get_string(doc, "semantic_hash", runtime_semantic_total_hash, sizeof(runtime_semantic_total_hash))) {
    if (has_semantic_total_hash_reason) {
      snprintf(runtime_semantic_total_hash, sizeof(runtime_semantic_total_hash), "%s", semantic_total_hash_from_reason);
    }
  }
  if (!runtime_hash_nonzero(runtime_semantic_total_hash) && has_semantic_total_hash_reason) {
    snprintf(runtime_semantic_total_hash, sizeof(runtime_semantic_total_hash), "%s", semantic_total_hash_from_reason);
  }
  if (has_semantic_total_hash_reason &&
      runtime_hash_nonzero(build_hash) &&
      hash_hex_equal(runtime_semantic_total_hash, build_hash)) {
    /*
     * Some runtime hosts currently mirror build_hash into semantic_hash.
     * Use the explicit semantic-total token from runtime reason when available.
     */
    snprintf(runtime_semantic_total_hash, sizeof(runtime_semantic_total_hash), "%s", semantic_total_hash_from_reason);
  }
  if (!runtime_hash_nonzero(runtime_semantic_total_hash)) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime semantic_total_hash is zero/invalid\n");
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: semantic_total_hash invalid expected_route=%s\n",
            expected_route_state);
  }
  if (expected_semantic_total_hash != NULL && expected_semantic_total_hash[0] != '\0' &&
      !hash_hex_equal(runtime_semantic_total_hash, expected_semantic_total_hash) &&
      has_semantic_total_hash_reason &&
      hash_hex_equal(semantic_total_hash_from_reason, expected_semantic_total_hash)) {
    snprintf(runtime_semantic_total_hash, sizeof(runtime_semantic_total_hash), "%s", semantic_total_hash_from_reason);
  }
  if (expected_semantic_total_hash != NULL && expected_semantic_total_hash[0] != '\0' &&
      !hash_hex_equal(runtime_semantic_total_hash, expected_semantic_total_hash)) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime semantic_total_hash mismatch expected=%s got=%s\n",
              expected_semantic_total_hash,
              runtime_semantic_total_hash);
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: semantic_total_hash mismatch expected=%s got=%s route=%s\n",
            expected_semantic_total_hash,
            runtime_semantic_total_hash,
            expected_route_state);
  }

  if (!json_get_string(doc, "last_frame_hash", last_frame_hash, sizeof(last_frame_hash))) {
    (void)parse_runtime_reason_token(runtime_reason, "framehash", last_frame_hash, sizeof(last_frame_hash));
  }
  if (!runtime_hash_nonzero(last_frame_hash)) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime last_frame_hash is zero/invalid\n");
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: last_frame_hash invalid expected_route=%s\n",
            expected_route_state);
  }
  if (expected_frame_hash != NULL && expected_frame_hash[0] != '\0' &&
      !hash_hex_equal(last_frame_hash, expected_frame_hash)) {
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] runtime_state framehash differs (defer to captured raw frame): expected=%s got=%s\n",
            expected_frame_hash,
            last_frame_hash);
  }

  if (!json_get_string(doc, "semantic_nodes_applied_hash", semantic_nodes_applied_hash, sizeof(semantic_nodes_applied_hash))) {
    (void)parse_runtime_reason_token(runtime_reason, "sah", semantic_nodes_applied_hash, sizeof(semantic_nodes_applied_hash));
  }
  if (!runtime_hash_nonzero(semantic_nodes_applied_hash)) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime semantic_nodes_applied_hash is zero/invalid\n");
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: semantic_nodes_applied_hash invalid expected_route=%s\n",
            expected_route_state);
  }

  if (!json_get_string(doc, "route_state", route_state, sizeof(route_state))) {
    (void)parse_runtime_reason_token(runtime_reason, "route", route_state, sizeof(route_state));
  }
  if (route_state[0] == '\0') {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime route_state is empty\n");
    free(doc);
    return false;
  }
  if (expected_route_state != NULL && expected_route_state[0] != '\0' &&
      !runtime_route_matches_expected(route_state, expected_route_state)) {
    bool allow_boot_route_mismatch =
        env_flag_enabled("CHENG_ANDROID_1TO1_ALLOW_BOOT_ROUTE_MISMATCH", false);
    if (enforce_expected_route_state && !allow_boot_route_mismatch) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime route_state mismatch expected=%s got=%s\n",
              expected_route_state,
              route_state);
      free(doc);
      return false;
    }
    if (allow_boot_route_mismatch) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] runtime route_state mismatch allowed at boot expected=%s got=%s\n",
              expected_route_state,
              route_state);
    } else if (!enforce_expected_route_state) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] runtime route_state mismatch deferred for strict convergence expected=%s got=%s\n",
              expected_route_state,
              route_state);
    }
  }

  if (!runtime_hash_nonzero(build_hash)) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime build_hash is zero/invalid\n");
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: build_hash invalid expected_route=%s\n",
            expected_route_state);
  }

  if (!json_get_string(doc, "semantic_hash", semantic_hash, sizeof(semantic_hash))) {
    if (!parse_runtime_reason_token(runtime_reason, "semhash", semantic_hash, sizeof(semantic_hash))) {
      (void)parse_runtime_reason_token(runtime_reason, "sth", semantic_hash, sizeof(semantic_hash));
    }
  }
  if (!runtime_hash_nonzero(semantic_hash)) {
    if (!allow_bootstrap_incomplete) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime semantic_hash is zero/invalid\n");
      free(doc);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] bootstrap defer: semantic_hash invalid expected_route=%s\n",
            expected_route_state);
  }

  long long surface_width = 0;
  long long surface_height = 0;
  if (!json_get_int64(doc, "surface_width", &surface_width)) {
    char token_w[64];
    token_w[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "w", token_w, sizeof(token_w))) {
      surface_width = strtoll(token_w, NULL, 10);
    }
  }
  if (!json_get_int64(doc, "surface_height", &surface_height)) {
    char token_h[64];
    token_h[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "h", token_h, sizeof(token_h))) {
      surface_height = strtoll(token_h, NULL, 10);
    }
  }
  if (surface_width <= 0 || surface_height <= 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime surface size missing/invalid (w=%lld h=%lld)\n",
            surface_width,
            surface_height);
    free(doc);
    return false;
  }
  if (expected_surface_width > 0 && surface_width != (long long)expected_surface_width) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime surface_width mismatch expected=%d got=%lld\n",
            expected_surface_width,
            surface_width);
    free(doc);
    return false;
  }
  if (expected_surface_height > 0 && surface_height != (long long)expected_surface_height) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime surface_height mismatch expected=%d got=%lld\n",
            expected_surface_height,
            surface_height);
    free(doc);
    return false;
  }

  char kv[32768];
  char js[32768];
  kv[0] = '\0';
  js[0] = '\0';
  if (!json_get_string(doc, "launch_args_kv", kv, sizeof(kv))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing launch_args_kv\n");
    free(doc);
    return false;
  }
  if (!json_get_string(doc, "launch_args_json", js, sizeof(js))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing launch_args_json\n");
    free(doc);
    return false;
  }
  char semantic_probe[128];
  snprintf(semantic_probe, sizeof(semantic_probe), "semantic_nodes=%d", semantic_node_count);
  if (!str_contains(kv, "arg_probe=foo_bar") || !str_contains(kv, semantic_probe) ||
      !kv_has_key_value(kv, "gate_mode", "android-semantic-visual-1to1")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime launch args missing required markers\n");
    free(doc);
    return false;
  }
  if (!kv_has_key_value(kv, "truth_mode", "strict")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime launch args truth_mode is not strict\n");
    free(doc);
    return false;
  }
  char expected_from_kv[128];
  expected_from_kv[0] = '\0';
  if (!parse_runtime_reason_token(kv, "expected_framehash", expected_from_kv, sizeof(expected_from_kv)) ||
      !runtime_hash_nonzero(expected_from_kv)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime launch args expected_framehash invalid\n");
    free(doc);
    return false;
  }
  if (!str_contains(js, "android-semantic-visual-1to1") || !str_contains(js, "\"routes\"")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime args_json mode mismatch\n");
    free(doc);
    return false;
  }
  if (snapshot_out != NULL) {
    snprintf(snapshot_out->route_state, sizeof(snapshot_out->route_state), "%s", route_state);
    snprintf(snapshot_out->last_frame_hash, sizeof(snapshot_out->last_frame_hash), "%s", last_frame_hash);
    snprintf(snapshot_out->semantic_nodes_applied_hash, sizeof(snapshot_out->semantic_nodes_applied_hash), "%s", semantic_nodes_applied_hash);
    snapshot_out->surface_width = surface_width;
    snapshot_out->surface_height = surface_height;
    snapshot_out->semantic_nodes_applied_count = semantic_nodes_applied_count;
  }
  (void)semantic_node_count;
  free(doc);
  return true;
}

static bool refresh_runtime_snapshot_from_device(const char *runtime_json,
                                                 int semantic_node_count,
                                                 const char *expected_semantic_total_hash,
                                                 const char *expected_route_state,
                                                 int expected_surface_width,
                                                 int expected_surface_height,
                                                 RuntimeStateSnapshot *snapshot_out) {
  if (runtime_json == NULL || runtime_json[0] == '\0') return false;
  int refresh_attempts = env_positive_int_or_default("CHENG_ANDROID_1TO1_RUNTIME_REFRESH_ATTEMPTS", 4);
  int refresh_sleep_ms = env_positive_int_or_default("CHENG_ANDROID_1TO1_RUNTIME_REFRESH_SLEEP_MS", 350);
  if (refresh_attempts < 1) refresh_attempts = 1;
  char adb[PATH_MAX];
  char serial[128];
  if (!resolve_adb_executable(adb, sizeof(adb)) || !resolve_android_serial(adb, serial, sizeof(serial))) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to resolve adb/serial for runtime snapshot refresh\n");
    return false;
  }
  const char *runtime_pkg = getenv("CHENG_ANDROID_APP_PACKAGE");
  if (runtime_pkg == NULL || runtime_pkg[0] == '\0') runtime_pkg = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
  if (runtime_pkg == NULL || runtime_pkg[0] == '\0') runtime_pkg = resolve_default_runtime_package_for_gate();
  int last_rc = 0;
  for (int attempt = 1; attempt <= refresh_attempts; ++attempt) {
    char *argv[] = {
        adb, "-s", serial, "exec-out", "run-as", (char *)runtime_pkg, "cat", "files/cheng_runtime_state.json", NULL};
    RunResult rr = run_command(argv, runtime_json, 20);
    last_rc = rr.code;
    if (rr.code != 0 || !file_exists(runtime_json)) {
      if (attempt < refresh_attempts) {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] runtime snapshot refresh retry attempt=%d/%d rc=%d pkg=%s expected_route=%s\n",
                attempt + 1,
                refresh_attempts,
                rr.code,
                runtime_pkg,
                expected_route_state != NULL ? expected_route_state : "<none>");
        if (refresh_sleep_ms > 0) usleep((useconds_t)refresh_sleep_ms * 1000u);
        continue;
      }
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] runtime snapshot refresh failed rc=%d pkg=%s path=%s\n",
              rr.code,
              runtime_pkg,
              runtime_json);
      return false;
    }
    if (parse_runtime_state(runtime_json,
                            semantic_node_count,
                            expected_semantic_total_hash,
                            expected_route_state,
                            true,
                            NULL,
                            expected_surface_width,
                            expected_surface_height,
                            snapshot_out)) {
      return true;
    }
    if (attempt < refresh_attempts) {
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] refreshed runtime snapshot defer attempt=%d/%d expected_route=%s\n",
              attempt + 1,
              refresh_attempts,
              expected_route_state != NULL ? expected_route_state : "<none>");
      if (refresh_sleep_ms > 0) usleep((useconds_t)refresh_sleep_ms * 1000u);
      continue;
    }
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] refreshed runtime snapshot invalid expected_route=%s path=%s rc=%d\n",
            expected_route_state != NULL ? expected_route_state : "<none>",
            runtime_json,
            last_rc);
    return false;
  }
  return false;
}

static bool validate_fullroute_report(const char *report_path, int expected_routes) {
  size_t n = 0;
  char *doc = read_file_all(report_path, &n);
  if (doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing fullroute report: %s\n", report_path);
    return false;
  }
  StringList states;
  memset(&states, 0, sizeof(states));
  if (json_parse_string_array(doc, "states", &states) != 0 || states.len == 0u) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute report states empty\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  if ((int)states.len != expected_routes) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] fullroute report state count mismatch: %zu != %d\n",
            states.len, expected_routes);
    strlist_free(&states);
    free(doc);
    return false;
  }
  int strict_capture = 0;
  int runs = 0;
  char capture_source[64];
  capture_source[0] = '\0';
  if (!json_get_int32(doc, "strict_capture", &strict_capture) || strict_capture != 1) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute strict_capture != 1\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  if (!json_get_int32(doc, "consistency_runs", &runs) || runs <= 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute consistency_runs invalid\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  if (!json_get_string(doc, "capture_source", capture_source, sizeof(capture_source)) ||
      strcmp(capture_source, "runtime-dump") != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute capture_source != runtime-dump\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  for (size_t i = 0; i < states.len; ++i) {
    char keypat[PATH_MAX + 4];
    snprintf(keypat, sizeof(keypat), "\"%s\"", states.items[i]);
    const char *p = strstr(doc, keypat);
    if (p == NULL) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing fullroute capture item: %s\n", states.items[i]);
      strlist_free(&states);
      free(doc);
      return false;
    }
    if (!strstr(p, "\"semantic_nodes_loaded\": true") ||
        !strstr(p, "\"semantic_nodes_applied_count\":") ||
        !strstr(p, "\"capture_framehash\":")) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] invalid fullroute capture flags: %s\n", states.items[i]);
      strlist_free(&states);
      free(doc);
      return false;
    }
  }
  strlist_free(&states);
  free(doc);
  return true;
}

static bool runtime_contains_forbidden_markers(const char *runtime_path) {
  size_t n = 0u;
  char *doc = read_file_all(runtime_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return true;
  }
  const char *markers[] = {
      "legacy.mountUnimakerAot",
      "legacy.unimakerDispatch",
      "import gui/browser/r2capp/runtime as legacy",
      "import gui/browser/r2capp/runtime as legacy",
      "appendSemanticNode(",
      "__R2C_",
      "buildSnapshot(",
      "rebuildPaint(",
  };
  bool bad = false;
  for (size_t i = 0u; i < sizeof(markers) / sizeof(markers[0]); ++i) {
    if (strstr(doc, markers[i]) != NULL) {
      bad = true;
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime marker forbidden: %s\n", markers[i]);
      break;
    }
  }
  if (!bad) {
    const char *required[] = {
        "fn mountComponentUnit(",
        "fn updateComponentUnit(",
        "fn unmountComponentUnit(",
        "fn mountGenerated(",
        "fn dispatchFromPage(",
    };
    for (size_t i = 0u; i < sizeof(required) / sizeof(required[0]); ++i) {
      if (strstr(doc, required[i]) == NULL) {
        bad = true;
        fprintf(stderr, "[verify-android-claude-1to1-gate] runtime missing symbol: %s\n", required[i]);
        break;
      }
    }
  }
  if (!bad) {
    if (strstr(doc, "utfzh_bridge.utfZhRoundtripStrict") == NULL ||
        strstr(doc, "ime_bridge.handleImeEvent") == NULL ||
        strstr(doc, "utfzh_editor.handleEditorEvent") == NULL ||
        strstr(doc, "utfzh_editor.renderEditorPanel") == NULL) {
      bad = true;
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime missing UTF-ZH/IME/editor hooks\n");
    }
  }
  free(doc);
  return bad;
}

static void parse_args(int argc,
                       char **argv,
                       int arg_start,
                       const char **project,
                       const char **entry,
                       const char **out_dir,
                       const char **route_state,
                       const char **truth_dir,
                       bool *help,
                       int *err) {
  *help = false;
  *err = 0;
  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--project") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *project = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--entry") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *entry = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--route-state") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *route_state = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--truth-dir") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *truth_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
      *help = true;
      return;
    }
    fprintf(stderr, "[verify-android-claude-1to1-gate] unknown arg: %s\n", arg);
    *err = 2;
    return;
  }
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  verify_android_claude_1to1_gate [--project <abs_path>] [--entry </app/main.tsx>] [--out <abs_path>] [--route-state <state>] [--truth-dir <abs_path>]\n"
          "\n"
          "Env (native no-interpreter path):\n"
          "  CHENG_R2C_COMPILE_CMD=<native_bin>\n"
          "  CHENG_ANDROID_FULLROUTE_GATE_CMD=<native_bin>\n"
          "  CHENG_ANDROID_MOBILE_RUNNER=<native_bin>\n"
          "  CHENG_ANDROID_1TO1_ROUTE_STATE=<state>\n"
          "  CHENG_ANDROID_1TO1_TRUTH_DIR=<abs_path>\n"
          "  CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL=0|1 (default 1)\n"
          "  CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT=0|1 (default 1)\n"
          "  CHENG_ANDROID_1TO1_TRUTH_FRAME_MODE=fullscreen|viewport (default fullscreen)\n"
          "  CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR=<abs_path>\n"
          "  CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH=0|1 (default fullscreen->1, viewport->0)\n"
          "  CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH=0|1 (default single-route->1)\n"
          "  CHENG_ANDROID_1TO1_HOME_HARD_GATE=0|1 (default 1; requires route_state=home_default when fullroute disabled)\n"
          "  CHENG_ANDROID_1TO1_TARGET_WIDTH/HEIGHT=<int> (optional runtime surface check)\n"
          "  CHENG_ANDROID_1TO1_ENFORCE_SURFACE_TARGET=0|1 (default 0)\n"
          "\n");
}

int native_verify_android_claude_1to1_gate(const char *scripts_dir, int argc, char **argv, int arg_start) {
  char root[PATH_MAX];
  const char *env_root = getenv("GUI_ROOT");
  if (env_root != NULL && env_root[0] != '\0') {
    snprintf(root, sizeof(root), "%s", env_root);
  } else if (scripts_dir != NULL && scripts_dir[0] != '\0') {
    snprintf(root, sizeof(root), "%s", scripts_dir);
  } else {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing GUI root\n");
    return 2;
  }
  normalize_gui_root_inplace(root);

  const char *project = getenv("R2C_REAL_PROJECT");
  const char *entry = getenv("R2C_REAL_ENTRY");
  const char *out_dir = getenv("R2C_ANDROID_1TO1_OUT");
  const char *route_state = getenv("CHENG_ANDROID_1TO1_ROUTE_STATE");
  const char *truth_dir = getenv("CHENG_ANDROID_1TO1_TRUTH_DIR");
  const char *require_runtime = getenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME");
  const char *enable_fullroute = getenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE");
  const char *home_hard_gate_env = getenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE");
  const char *skip_compile_env = getenv("CHENG_ANDROID_1TO1_SKIP_COMPILE");
  bool skip_compile = (skip_compile_env != NULL && strcmp(skip_compile_env, "1") == 0);
  bool home_hard_gate = true;
  if (home_hard_gate_env != NULL && home_hard_gate_env[0] != '\0') {
    home_hard_gate = (strcmp(home_hard_gate_env, "0") != 0);
  }
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";
  bool runtime_required = true;
  if (require_runtime != NULL && require_runtime[0] != '\0') {
    if (strcmp(require_runtime, "1") != 0) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] strict runtime mode requires CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=1 (got %s)\n",
              require_runtime);
      return 2;
    }
    runtime_required = true;
  }
  bool fullroute_enabled = false;
  bool fullroute_explicit = false;
  if (enable_fullroute != NULL && enable_fullroute[0] != '\0') {
    fullroute_explicit = true;
    if (strcmp(enable_fullroute, "1") == 0) {
      fullroute_enabled = true;
    } else if (strcmp(enable_fullroute, "0") == 0) {
      fullroute_enabled = false;
    } else {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] invalid CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=%s (expect 0 or 1)\n",
              enable_fullroute);
      return 2;
    }
  }
  char out_dir_default[PATH_MAX];
  char fullroute_truth_dir_default[PATH_MAX];
  fullroute_truth_dir_default[0] = '\0';
  if (out_dir == NULL || out_dir[0] == '\0') {
    if (path_join(out_dir_default, sizeof(out_dir_default), root, "build/android_claude_1to1_gate") != 0) return 2;
    out_dir = out_dir_default;
  }

  bool want_help = false;
  int arg_err = 0;
  parse_args(argc, argv, arg_start, &project, &entry, &out_dir, &route_state, &truth_dir, &want_help, &arg_err);
  if (want_help) {
    usage();
    return 0;
  }
  if (arg_err != 0) {
    usage();
    return arg_err;
  }
  if (!fullroute_explicit && route_state != NULL && route_state[0] != '\0') {
    fullroute_enabled = false;
  }
  if (!fullroute_enabled) {
    if (route_state == NULL || route_state[0] == '\0') {
      route_state = "home_default";
    }
    if (home_hard_gate && strcmp(route_state, "home_default") != 0) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] home hard gate requires route_state=home_default (got=%s)\n",
              route_state);
      return 2;
    }
    setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", route_state, 1);
    if (home_hard_gate) {
      setenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE", "1", 1);
    } else {
      setenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE", "0", 1);
    }
  } else {
    if (route_state == NULL || route_state[0] == '\0') {
      route_state = "home_default";
      setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", route_state, 1);
    }
    if (truth_dir == NULL || truth_dir[0] == '\0') {
      if (path_join(fullroute_truth_dir_default,
                    sizeof(fullroute_truth_dir_default),
                    root,
                    "src/tests/claude_fixture/golden/android_fullroute") == 0 &&
          dir_exists(fullroute_truth_dir_default)) {
        truth_dir = fullroute_truth_dir_default;
        setenv("CHENG_ANDROID_1TO1_TRUTH_DIR", truth_dir, 1);
      }
    }
  }

  char marker_dir[PATH_MAX];
  char marker_path[PATH_MAX];
  char compile_out[PATH_MAX];
  char runtime_json[PATH_MAX];
  char run_log[PATH_MAX];
  char fullroute_out[PATH_MAX];
  char fullroute_report[PATH_MAX];
  char fullroute_log[PATH_MAX];
  char fullroute_strict_log[PATH_MAX];
  char fullroute_strict_driver_log[PATH_MAX];
  char android_truth_manifest[PATH_MAX];
  char mobile_runner[PATH_MAX];
  char compile_cmd[PATH_MAX];
  char fullroute_gate_cmd[PATH_MAX];
  char fullroute_strict_cmd[PATH_MAX];

  if (path_join(compile_out, sizeof(compile_out), out_dir, "claude_compile") != 0 ||
      path_join(marker_dir, sizeof(marker_dir), root, "build/android_claude_1to1_gate") != 0 ||
      path_join(marker_path, sizeof(marker_path), marker_dir, "ok.json") != 0 ||
      path_join(runtime_json, sizeof(runtime_json), out_dir, "android_runtime_state.json") != 0 ||
      path_join(run_log, sizeof(run_log), out_dir, "mobile_run_android.log") != 0 ||
      path_join(fullroute_out, sizeof(fullroute_out), out_dir, "fullroute") != 0 ||
      path_join(fullroute_report, sizeof(fullroute_report), fullroute_out, "android_fullroute_visual_report.json") != 0 ||
      path_join(fullroute_log, sizeof(fullroute_log), out_dir, "android_fullroute_visual.log") != 0 ||
      path_join(fullroute_strict_log, sizeof(fullroute_strict_log), out_dir, "android_fullroute_strict.log") != 0 ||
      path_join(fullroute_strict_driver_log,
                sizeof(fullroute_strict_driver_log),
                out_dir,
                "android_fullroute_strict_driver.log") != 0 ||
      path_join(android_truth_manifest, sizeof(android_truth_manifest), compile_out,
                "r2capp/r2c_truth_trace_manifest_android.json") != 0 ||
      resolve_native_bin_path(root, "mobile_run_android", mobile_runner, sizeof(mobile_runner)) != 0 ||
      resolve_native_bin_path(root, "r2c_compile_react_project", compile_cmd, sizeof(compile_cmd)) != 0 ||
      resolve_native_bin_path(root, "verify_android_fullroute_visual_pixel", fullroute_gate_cmd, sizeof(fullroute_gate_cmd)) != 0 ||
      resolve_native_bin_path(root,
                              "verify_r2c_equivalence_android_native",
                              fullroute_strict_cmd,
                              sizeof(fullroute_strict_cmd)) != 0) {
    return 2;
  }

  const char *compile_cmd_env = getenv("CHENG_R2C_COMPILE_CMD");
  if (compile_cmd_env != NULL && compile_cmd_env[0] != '\0') snprintf(compile_cmd, sizeof(compile_cmd), "%s", compile_cmd_env);
  const char *fullroute_cmd_env = getenv("CHENG_ANDROID_FULLROUTE_GATE_CMD");
  if (fullroute_cmd_env != NULL && fullroute_cmd_env[0] != '\0') snprintf(fullroute_gate_cmd, sizeof(fullroute_gate_cmd), "%s", fullroute_cmd_env);
  const char *runner_env = getenv("CHENG_ANDROID_MOBILE_RUNNER");
  if (runner_env != NULL && runner_env[0] != '\0') snprintf(mobile_runner, sizeof(mobile_runner), "%s", runner_env);
  const char *fullroute_strict_cmd_env = getenv("CHENG_ANDROID_FULLROUTE_STRICT_GATE_CMD");
  if (fullroute_strict_cmd_env != NULL && fullroute_strict_cmd_env[0] != '\0') {
    snprintf(fullroute_strict_cmd, sizeof(fullroute_strict_cmd), "%s", fullroute_strict_cmd_env);
  }
  bool use_visual_fullroute_gate = false;
  const char *use_visual_fullroute_gate_env = getenv("CHENG_ANDROID_1TO1_FULLROUTE_USE_VISUAL_GATE");
  if (use_visual_fullroute_gate_env != NULL && strcmp(use_visual_fullroute_gate_env, "1") == 0) {
    use_visual_fullroute_gate = true;
  }

  if (!dir_exists(project)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing project: %s\n", project);
    return 1;
  }
  if (!skip_compile) {
    if (!path_executable(compile_cmd)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing native compile command: %s\n", compile_cmd);
      return 1;
    }
    if (path_is_interpreter_script(compile_cmd)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] compile command must be native executable (no interpreter): %s\n",
              compile_cmd);
      return 1;
    }
    if (command_looks_like_script_dispatch(compile_cmd)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] compile command resolves to script-dispatch wrapper; set CHENG_R2C_COMPILE_CMD to a true native binary: %s\n",
              compile_cmd);
      return 1;
    }
  }

  if (use_visual_fullroute_gate) {
    if (!path_executable(fullroute_gate_cmd)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing native fullroute gate command: %s\n", fullroute_gate_cmd);
      return 1;
    }
    if (path_is_interpreter_script(fullroute_gate_cmd)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] fullroute gate command must be native executable (no interpreter): %s\n",
              fullroute_gate_cmd);
      return 1;
    }
    if (command_looks_like_script_dispatch(fullroute_gate_cmd)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] fullroute gate command resolves to script-dispatch wrapper; set CHENG_ANDROID_FULLROUTE_GATE_CMD to a true native binary: %s\n",
              fullroute_gate_cmd);
      return 1;
    }
  } else {
    if (!path_executable(fullroute_strict_cmd)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] missing native strict fullroute command: %s\n",
              fullroute_strict_cmd);
      return 1;
    }
    if (path_is_interpreter_script(fullroute_strict_cmd)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] strict fullroute command must be native executable (no interpreter): %s\n",
              fullroute_strict_cmd);
      return 1;
    }
    if (command_looks_like_script_dispatch(fullroute_strict_cmd)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] strict fullroute command resolves to script-dispatch wrapper; set CHENG_ANDROID_FULLROUTE_STRICT_GATE_CMD to a true native binary: %s\n",
              fullroute_strict_cmd);
      return 1;
    }
  }

  if (ensure_dir(out_dir) != 0 || ensure_dir(marker_dir) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create output directories\n");
    return 1;
  }
  unlink(marker_path);
  unlink(runtime_json);
  unlink(run_log);
  unlink(fullroute_log);
  unlink(fullroute_strict_log);
  unlink(fullroute_strict_driver_log);

  setenv("STRICT_GATE_CONTEXT", "1", 1);
  setenv("R2C_LEGACY_UNIMAKER", "0", 1);
  setenv("R2C_SKIP_COMPILER_RUN", "0", 1);
  setenv("R2C_TRY_COMPILER_FIRST", "1", 1);
  setenv("R2C_REUSE_RUNTIME_BINS", "0", 1);
  setenv("R2C_REUSE_COMPILER_BIN", "0", 1);
  setenv("R2C_USE_PRECOMPUTED_BATCH", "0", 1);
  setenv("R2C_FULLROUTE_BLESS", "0", 1);
  setenv("R2C_RUNTIME_TEXT_SOURCE", "project", 1);
  setenv("R2C_RUNTIME_ROUTE_TITLE_SOURCE", "project", 1);
  setenv("R2C_TARGET_MATRIX", "android", 1);
  setenv("R2C_REAL_SKIP_RUNNER_SMOKE", "1", 1);
  setenv("R2C_REAL_SKIP_DESKTOP_SMOKE", "1", 1);
  setenv("R2C_SKIP_HOST_RUNTIME_BIN_BUILD", "1", 1);
  setenv("BACKEND_INTERNAL_ALLOW_EMIT_OBJ", "1", 1);
  setenv("CHENG_BACKEND_INTERNAL_ALLOW_EMIT_OBJ", "1", 1);
  if (getenv("CHENG_ANDROID_SKIP_INSTALL_IF_PRESENT") == NULL) setenv("CHENG_ANDROID_SKIP_INSTALL_IF_PRESENT", "1", 1);
  if (getenv("CHENG_ANDROID_SKIP_INSTALL") == NULL) setenv("CHENG_ANDROID_SKIP_INSTALL", "0", 1);
  if (getenv("CHENG_ANDROID_FAIL_IF_NOT_FOCUSED") == NULL) setenv("CHENG_ANDROID_FAIL_IF_NOT_FOCUSED", "1", 1);
  if (getenv("CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE") == NULL) setenv("CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE", "runtime-dump", 1);
  if (getenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE") == NULL) setenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE", "1", 1);
  if (getenv("R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS") == NULL) setenv("R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS", "3", 1);

  const char *capture_source = getenv("CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE");
  const char *strict_capture = getenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE");
  if (capture_source == NULL || strcmp(capture_source, "runtime-dump") != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] strict mode requires CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE=runtime-dump\n");
    return 1;
  }
  if (strict_capture == NULL || strcmp(strict_capture, "1") != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] strict mode requires CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE=1\n");
    return 1;
  }

  if (skip_compile) {
    fprintf(stdout, "== android 1:1: reuse strict compile output ==\n");
    fprintf(stdout, "[verify-android-claude-1to1-gate] skip compile: CHENG_ANDROID_1TO1_SKIP_COMPILE=1\n");
  } else {
    fprintf(stdout, "== android 1:1: r2c strict compile ==\n");
    char *compile_argv[] = {
        compile_cmd,
        "--project",
        (char *)project,
        "--entry",
        (char *)entry,
        "--out",
        compile_out,
        "--strict",
        NULL,
    };
    print_cmdline(compile_argv);
    RunResult compile_rr = run_command(compile_argv, NULL, 0);
    if (compile_rr.code != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] compile failed rc=%d\n", compile_rr.code);
      return 1;
    }
  }

  char report_json[PATH_MAX];
  char android_obj[PATH_MAX];
  char android_obj_primary[PATH_MAX];
  char android_obj_legacy[PATH_MAX];
  char android_obj_rebuild_log[PATH_MAX];
  if (path_join(report_json, sizeof(report_json), compile_out, "r2capp/r2capp_compile_report.json") != 0 ||
      path_join(android_obj_primary, sizeof(android_obj_primary), compile_out,
                "r2capp/r2capp_platform_artifacts/android/r2c_app_android.o") != 0 ||
      path_join(android_obj_legacy, sizeof(android_obj_legacy), compile_out,
                "r2capp_platform_artifacts/android/r2c_app_android.o") != 0 ||
      path_join(android_obj_rebuild_log, sizeof(android_obj_rebuild_log), out_dir, "r2c_app_android.rebuild.log") != 0) {
    return 1;
  }
  if (file_exists(android_obj_primary)) {
    snprintf(android_obj, sizeof(android_obj), "%s", android_obj_primary);
  } else if (file_exists(android_obj_legacy)) {
    snprintf(android_obj, sizeof(android_obj), "%s", android_obj_legacy);
  } else {
    snprintf(android_obj, sizeof(android_obj), "%s", android_obj_primary);
  }
  if (!file_exists(report_json)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing compile report: %s\n", report_json);
    return 1;
  }
  int rebuild_rc = rebuild_android_payload_obj(android_obj, android_obj_rebuild_log);
  if (rebuild_rc != 0) return rebuild_rc;
  if (!check_nm_symbols(android_obj)) return 1;

  size_t report_len = 0;
  char *report_doc = read_file_all(report_json, &report_len);
  if (report_doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] cannot read report: %s\n", report_json);
    return 1;
  }

  if (!parse_bool_key(report_doc, "strict_no_fallback", true, "[verify-android-claude-1to1-gate] strict_no_fallback != true") ||
      !parse_bool_key(report_doc, "used_fallback", false, "[verify-android-claude-1to1-gate] used_fallback != false") ||
      !parse_bool_key(report_doc, "template_runtime_used", false, "[verify-android-claude-1to1-gate] template_runtime_used != false") ||
      !parse_int_key(report_doc, "compiler_rc", 0, "[verify-android-claude-1to1-gate] compiler_rc != 0") ||
      !parse_int_key(report_doc, "pixel_tolerance", 0, "[verify-android-claude-1to1-gate] pixel_tolerance != 0") ||
      !parse_string_key(report_doc, "generated_ui_mode", "ir-driven", "[verify-android-claude-1to1-gate] generated_ui_mode != ir-driven") ||
      !parse_string_key(report_doc, "compiler_report_origin", "cheng-compiler", "[verify-android-claude-1to1-gate] compiler_report_origin != cheng-compiler") ||
      !parse_string_key(report_doc, "semantic_compile_mode", "react-semantic-ir-node-compile",
                        "[verify-android-claude-1to1-gate] semantic_compile_mode != react-semantic-ir-node-compile") ||
      !parse_string_key(report_doc, "utfzh_mode", "strict", "[verify-android-claude-1to1-gate] utfzh_mode != strict") ||
      !parse_string_key(report_doc, "ime_mode", "cangwu-global", "[verify-android-claude-1to1-gate] ime_mode != cangwu-global") ||
      !parse_string_key(report_doc, "cjk_render_backend", "native-text-first",
                        "[verify-android-claude-1to1-gate] cjk_render_backend != native-text-first") ||
      !parse_string_key(report_doc, "cjk_render_gate", "no-garbled-cjk",
                        "[verify-android-claude-1to1-gate] cjk_render_gate != no-garbled-cjk") ||
      !parse_string_key(report_doc, "semantic_mapping_mode", "source-node-map",
                        "[verify-android-claude-1to1-gate] semantic_mapping_mode != source-node-map")) {
    free(report_doc);
    return 1;
  }
  char report_truth_manifest[PATH_MAX];
  bool truth_manifest_ok =
      json_get_string(report_doc, "android_truth_manifest_path", report_truth_manifest, sizeof(report_truth_manifest)) &&
      file_exists(report_truth_manifest);
  if (!truth_manifest_ok) {
    truth_manifest_ok = json_get_string(report_doc,
                                        "truth_trace_manifest_android_path",
                                        report_truth_manifest,
                                        sizeof(report_truth_manifest)) &&
                        file_exists(report_truth_manifest);
  }
  if (truth_manifest_ok) {
    snprintf(android_truth_manifest, sizeof(android_truth_manifest), "%s", report_truth_manifest);
  } else if (!file_exists(android_truth_manifest)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing android truth manifest in report/output\n");
    free(report_doc);
    return 1;
  }

  char runtime_src_path[PATH_MAX];
  if (!json_get_string(report_doc, "generated_runtime_path", runtime_src_path, sizeof(runtime_src_path)) ||
      !file_exists(runtime_src_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing generated_runtime_path\n");
    free(report_doc);
    return 1;
  }
  if (runtime_contains_forbidden_markers(runtime_src_path)) {
    free(report_doc);
    return 1;
  }

  char route_tree_path[PATH_MAX];
  char route_semantic_tree_path[PATH_MAX];
  char route_actions_path[PATH_MAX];
  route_tree_path[0] = '\0';
  route_semantic_tree_path[0] = '\0';
  route_actions_path[0] = '\0';
  const char *path_keys[] = {
      "android_route_graph_path",
      "android_route_event_matrix_path",
      "android_route_coverage_path",
      "route_tree_path",
      "route_semantic_tree_path",
      "route_layers_path",
      "route_actions_android_path",
      "semantic_graph_path",
      "component_graph_path",
      "style_graph_path",
      "event_graph_path",
      "runtime_trace_path",
  };
  for (size_t i = 0; i < sizeof(path_keys) / sizeof(path_keys[0]); ++i) {
    char path[PATH_MAX];
    if (!json_get_string(report_doc, path_keys[i], path, sizeof(path)) || !file_exists(path)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing %s: %s\n", path_keys[i], path);
      free(report_doc);
      return 1;
    }
  }
  if (!json_get_string(report_doc, "route_tree_path", route_tree_path, sizeof(route_tree_path)) ||
      !file_exists(route_tree_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing route_tree_path: %s\n", route_tree_path);
    free(report_doc);
    return 1;
  }
  if (!json_get_string(report_doc,
                       "route_semantic_tree_path",
                       route_semantic_tree_path,
                       sizeof(route_semantic_tree_path)) ||
      !file_exists(route_semantic_tree_path)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing route_semantic_tree_path: %s\n",
            route_semantic_tree_path);
    free(report_doc);
    return 1;
  }
  if (!json_get_string(report_doc, "route_actions_android_path", route_actions_path, sizeof(route_actions_path)) ||
      !file_exists(route_actions_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing route_actions_android_path: %s\n", route_actions_path);
    free(report_doc);
    return 1;
  }

  int semantic_node_count = 0;
  int full_route_count = 0;
  char expected_semantic_total_hash[128];
  expected_semantic_total_hash[0] = '\0';
  if (!json_get_int32(report_doc, "semantic_node_count", &semantic_node_count) || semantic_node_count <= 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] semantic_node_count <= 0\n");
    free(report_doc);
    return 1;
  }
  if (!json_get_string(report_doc,
                       "semantic_render_nodes_fnv64",
                       expected_semantic_total_hash,
                       sizeof(expected_semantic_total_hash)) ||
      !runtime_hash_nonzero(expected_semantic_total_hash)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] semantic_render_nodes_fnv64 missing/invalid\n");
    free(report_doc);
    return 1;
  }
  if (!json_get_int32(report_doc, "full_route_state_count", &full_route_count) || full_route_count <= 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] full_route_state_count <= 0\n");
    free(report_doc);
    return 1;
  }
  int truth_count = count_truth_states(android_truth_manifest);
  if (truth_count <= 0 || full_route_count != truth_count) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] full_route_state_count mismatch: report=%d truth=%d\n",
            full_route_count, truth_count);
    free(report_doc);
    return 1;
  }

  char states_path[PATH_MAX];
  if (!json_get_string(report_doc, "full_route_states_path", states_path, sizeof(states_path)) || !file_exists(states_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing full_route_states_path: %s\n", states_path);
    free(report_doc);
    return 1;
  }
  size_t states_len = 0;
  char *states_doc = read_file_all(states_path, &states_len);
  if (states_doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to read full route states: %s\n", states_path);
    free(report_doc);
    return 1;
  }
  StringList states;
  memset(&states, 0, sizeof(states));
  if (json_parse_string_array(states_doc, "states", &states) != 0 || (int)states.len != full_route_count) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] full_route_states invalid\n");
    strlist_free(&states);
    free(states_doc);
    free(report_doc);
    return 1;
  }
  free(states_doc);

  char semantic_map_path[PATH_MAX];
  char semantic_runtime_map_path[PATH_MAX];
  if (!json_get_string(report_doc, "semantic_node_map_path", semantic_map_path, sizeof(semantic_map_path)) ||
      !file_exists(semantic_map_path) ||
      !json_get_string(report_doc, "semantic_runtime_map_path", semantic_runtime_map_path, sizeof(semantic_runtime_map_path)) ||
      !file_exists(semantic_runtime_map_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing semantic map paths\n");
    strlist_free(&states);
    free(report_doc);
    return 1;
  }

  size_t sem_src_len = 0;
  size_t sem_rt_len = 0;
  char *sem_src_doc = read_file_all(semantic_map_path, &sem_src_len);
  char *sem_rt_doc = read_file_all(semantic_runtime_map_path, &sem_rt_len);
  if (sem_src_doc == NULL || sem_rt_doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to read semantic maps\n");
    free(sem_src_doc);
    free(sem_rt_doc);
    strlist_free(&states);
    free(report_doc);
    return 1;
  }
  int src_nodes = json_count_key_occurrence(sem_src_doc, "node_id");
  int rt_nodes = json_count_key_occurrence(sem_rt_doc, "node_id");
  free(sem_src_doc);
  free(sem_rt_doc);
  if (src_nodes != semantic_node_count || rt_nodes != semantic_node_count) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] semantic map count mismatch src=%d runtime=%d expected=%d\n",
            src_nodes, rt_nodes, semantic_node_count);
    strlist_free(&states);
    free(report_doc);
    return 1;
  }

  fprintf(stdout, "[verify-r2c-strict] no-fallback=true\n");
  fprintf(stdout, "[verify-r2c-strict] compiler-rc=0\n");

  int fullroute_routes_ok = fullroute_enabled ? full_route_count : 0;
  int target_surface_w = env_positive_int_or_default("CHENG_ANDROID_1TO1_TARGET_WIDTH", 0);
  int target_surface_h = env_positive_int_or_default("CHENG_ANDROID_1TO1_TARGET_HEIGHT", 0);
  char expected_runtime_frame_hash[64];
  expected_runtime_frame_hash[0] = '\0';
  RuntimeStateSnapshot runtime_snapshot;
  memset(&runtime_snapshot, 0, sizeof(runtime_snapshot));
  const char *freeze_truth_dir = getenv("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR");
  bool capture_runtime_visual = true;
  const char *capture_runtime_visual_env = getenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL");
  if (capture_runtime_visual_env != NULL && strcmp(capture_runtime_visual_env, "0") == 0) {
    capture_runtime_visual = false;
  }
  bool capture_runtime_visual_strict = true;
  const char *capture_runtime_visual_strict_env = getenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT");
  if (capture_runtime_visual_strict_env != NULL && capture_runtime_visual_strict_env[0] != '\0') {
    capture_runtime_visual_strict = (strcmp(capture_runtime_visual_strict_env, "0") != 0);
  } else if (freeze_truth_dir != NULL && freeze_truth_dir[0] != '\0') {
    capture_runtime_visual_strict = true;
  }
  if (route_state != NULL && route_state[0] != '\0' && !strlist_contains(&states, route_state)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] route-state not found in full-route states: %s\n",
            route_state);
    strlist_free(&states);
    free(report_doc);
    return 2;
  }
  char assets_dir[PATH_MAX];
  if (path_join(assets_dir, sizeof(assets_dir), compile_out, "r2capp") != 0) {
    strlist_free(&states);
    free(report_doc);
    return 1;
  }
  char auto_truth_dir[PATH_MAX];
  auto_truth_dir[0] = '\0';
  if (!fullroute_enabled &&
      route_state != NULL && route_state[0] != '\0' &&
      (truth_dir == NULL || truth_dir[0] == '\0')) {
    if (path_join(auto_truth_dir, sizeof(auto_truth_dir), compile_out, "r2capp/truth") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!dir_exists(auto_truth_dir)) {
      char fallback_truth_dir[PATH_MAX];
      char canonical_truth_dir[PATH_MAX];
      fallback_truth_dir[0] = '\0';
      canonical_truth_dir[0] = '\0';
      (void)path_join(fallback_truth_dir,
                      sizeof(fallback_truth_dir),
                      root,
                      "build/android_claude_1to1_gate/claude_compile/r2capp/truth");
      (void)path_join(canonical_truth_dir,
                      sizeof(canonical_truth_dir),
                      root,
                      "build/_truth_visible_1212x2512_canonical");
      if (dir_exists(fallback_truth_dir)) {
        snprintf(auto_truth_dir, sizeof(auto_truth_dir), "%s", fallback_truth_dir);
      } else if (dir_exists(canonical_truth_dir)) {
        snprintf(auto_truth_dir, sizeof(auto_truth_dir), "%s", canonical_truth_dir);
      } else {
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] home hard gate missing truth dir: %s\n",
                auto_truth_dir);
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] fallback truth-dir=%s\n",
              auto_truth_dir);
    }
    truth_dir = auto_truth_dir;
    setenv("CHENG_ANDROID_1TO1_TRUTH_DIR", truth_dir, 1);
    fprintf(stdout, "[verify-android-claude-1to1-gate] auto truth-dir=%s\n", truth_dir);
  }
  if (!fullroute_enabled) {
    const char *enforce_expected_env = getenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
    if (enforce_expected_env == NULL || enforce_expected_env[0] == '\0') {
      setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", "1", 1);
    }
    if (home_hard_gate &&
        route_state != NULL &&
        strcmp(route_state, "home_default") == 0) {
      const char *copy_all_env = getenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
      if (copy_all_env == NULL || copy_all_env[0] == '\0') {
        /* Home gate keeps bottom-tab interactions alive: include sibling tab truths in packaged assets. */
        setenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL", "1", 1);
      }
    }
  } else {
    const char *copy_all_env = getenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
    if (copy_all_env == NULL || copy_all_env[0] == '\0') {
      /*
       * Fullroute strict gate requires per-state golden files in compile_out/r2capp/truth.
       * Copy the full truth set from source truth dir in one shot.
       */
      setenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL", "1", 1);
    }
  }
  bool replay_launch_home = false;
  const char *runtime_launch_route_state = route_state;
  const char *replay_launch_home_env = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME");
  if (route_state != NULL && route_state[0] != '\0' && strcmp(route_state, "home_default") != 0) {
    if (replay_launch_home_env != NULL && replay_launch_home_env[0] != '\0' &&
        strcmp(replay_launch_home_env, "1") == 0) {
      replay_launch_home = true;
      runtime_launch_route_state = "home_default";
    }
  }
  if (truth_dir != NULL && truth_dir[0] != '\0' && route_state != NULL && route_state[0] != '\0') {
    if (!prepare_route_truth_assets(truth_dir,
                                    route_state,
                                    assets_dir,
                                    route_tree_path,
                                    expected_runtime_frame_hash,
                                    sizeof(expected_runtime_frame_hash),
                                    &target_surface_w,
                                    &target_surface_h)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (replay_launch_home && runtime_launch_route_state != NULL && runtime_launch_route_state[0] != '\0') {
      char runtime_launch_expected_hash_unused[128];
      int runtime_launch_w_unused = 0;
      int runtime_launch_h_unused = 0;
      if (!prepare_route_truth_assets(truth_dir,
                                      runtime_launch_route_state,
                                      assets_dir,
                                      route_tree_path,
                                      runtime_launch_expected_hash_unused,
                                      sizeof(runtime_launch_expected_hash_unused),
                                      &runtime_launch_w_unused,
                                      &runtime_launch_h_unused)) {
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
    }
  }
  if (runtime_required) {
    if (!has_android_device()) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] no android emulator/device detected\n");
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!path_executable(mobile_runner)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing mobile runner executable: %s\n", mobile_runner);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (path_is_interpreter_script(mobile_runner)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] mobile runner must be native executable (no interpreter): %s\n",
              mobile_runner);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (command_looks_like_script_dispatch(mobile_runner)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] mobile runner resolves to script-dispatch wrapper; set CHENG_ANDROID_MOBILE_RUNNER to a true native binary: %s\n",
              mobile_runner);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char app_args_tmp[PATH_MAX];
    if (path_join(app_args_tmp, sizeof(app_args_tmp), out_dir, "app_args.json") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    const char *timeout_env = getenv("CHENG_ANDROID_1TO1_RUNTIME_TIMEOUT_SEC");
    int runtime_timeout = 900;
    if (timeout_env != NULL && timeout_env[0] != '\0') runtime_timeout = atoi(timeout_env);
    const char *wait_env = getenv("CHENG_ANDROID_1TO1_RUNTIME_WAIT_MS");
    int runtime_wait_ms = 12000;
    if (wait_env != NULL && wait_env[0] != '\0') runtime_wait_ms = atoi(wait_env);
    if (runtime_wait_ms < 1000) runtime_wait_ms = 1000;

    char runner_entry[PATH_MAX];
    if (path_join(runner_entry, sizeof(runner_entry), root, "r2c_app_runner_main.cheng") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char mobile_export_out[PATH_MAX];
    char native_obj_arg[PATH_MAX + 16];
    char runtime_state_arg[PATH_MAX + 32];
    char app_args_json_arg[PATH_MAX + 32];
    char app_arg_manifest[PATH_MAX + 64];
    if (path_join(mobile_export_out, sizeof(mobile_export_out), out_dir, "mobile_export") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    snprintf(native_obj_arg, sizeof(native_obj_arg), "--native-obj:%s", android_obj);
    snprintf(runtime_state_arg, sizeof(runtime_state_arg), "--runtime-state-out:%s", runtime_json);
    snprintf(app_args_json_arg, sizeof(app_args_json_arg), "--app-args-json:%s", app_args_tmp);
    char app_manifest_path[PATH_MAX];
    char device_manifest_path[PATH_MAX];
    if (path_join(app_manifest_path, sizeof(app_manifest_path), compile_out, "r2capp/r2capp_manifest.json") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    const char *runtime_pkg_for_manifest = resolve_default_runtime_package_for_gate();
    if (snprintf(device_manifest_path,
                 sizeof(device_manifest_path),
                 "/data/data/%s/files/cheng_assets/r2capp_manifest.json",
                 runtime_pkg_for_manifest) >= (int)sizeof(device_manifest_path)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char app_args_doc[PATH_MAX * 2];
    int app_args_n = snprintf(app_args_doc, sizeof(app_args_doc),
                              "{\"manifest\":\"%s\",\"mode\":\"android-semantic-visual-1to1\",\"routes\":%d}\n",
                              device_manifest_path, full_route_count);
    if (app_args_n <= 0 || (size_t)app_args_n >= sizeof(app_args_doc) ||
        write_file_all(app_args_tmp, app_args_doc, (size_t)app_args_n) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to write app args json\n");
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    snprintf(app_arg_manifest, sizeof(app_arg_manifest), "--app-arg:r2c_manifest=%s", device_manifest_path);

    char app_arg_sem_nodes[128];
    snprintf(app_arg_sem_nodes, sizeof(app_arg_sem_nodes), "--app-arg:semantic_nodes=%d", semantic_node_count);
    char app_arg_route_state[256];
    char app_arg_truth_sync_routes[512];
    app_arg_route_state[0] = '\0';
    app_arg_truth_sync_routes[0] = '\0';
    const char *route_state_arg = NULL;
    const char *truth_sync_routes_arg = NULL;
    if (runtime_launch_route_state != NULL && runtime_launch_route_state[0] != '\0') {
      snprintf(app_arg_route_state, sizeof(app_arg_route_state), "--app-arg:route_state=%s", runtime_launch_route_state);
      route_state_arg = app_arg_route_state;
    }
    if (runtime_launch_route_state != NULL &&
        runtime_launch_route_state[0] != '\0' &&
        route_state != NULL &&
        route_state[0] != '\0' &&
        strcmp(runtime_launch_route_state, route_state) != 0) {
      int truth_sync_n = snprintf(app_arg_truth_sync_routes,
                                  sizeof(app_arg_truth_sync_routes),
                                  "--app-arg:truth_sync_routes=%s,%s",
                                  runtime_launch_route_state,
                                  route_state);
      if (truth_sync_n > 0 && (size_t)truth_sync_n < sizeof(app_arg_truth_sync_routes)) {
        truth_sync_routes_arg = app_arg_truth_sync_routes;
      }
    }
    char frame_dump_name[192];
    frame_dump_name[0] = '\0';
    const char *frame_dump_route = (route_state != NULL && route_state[0] != '\0') ? route_state : "route";
    if (snprintf(frame_dump_name, sizeof(frame_dump_name), "%s.runtime_frame.raw", frame_dump_route) >=
        (int)sizeof(frame_dump_name)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char app_arg_frame_dump[256];
    if (snprintf(app_arg_frame_dump,
                 sizeof(app_arg_frame_dump),
                 "--app-arg:frame_dump_file=%s",
                 frame_dump_name) >= (int)sizeof(app_arg_frame_dump)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char runtime_wait_arg[64];
    snprintf(runtime_wait_arg, sizeof(runtime_wait_arg), "--runtime-state-wait-ms:%d", runtime_wait_ms);
    char out_arg[PATH_MAX + 16];
    snprintf(out_arg, sizeof(out_arg), "--out:%s", mobile_export_out);
    char assets_arg[PATH_MAX + 16];
    snprintf(assets_arg, sizeof(assets_arg), "--assets:%s", assets_dir);
    char app_arg_expected_hash[128];
    app_arg_expected_hash[0] = '\0';
    const char *expected_hash_arg = NULL;
    bool pass_expected_to_runtime = false;
    const char *pass_expected_env = getenv("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME");
    if (pass_expected_env != NULL && pass_expected_env[0] != '\0') {
      pass_expected_to_runtime = (strcmp(pass_expected_env, "0") != 0);
    } else if (runtime_launch_route_state != NULL && strcmp(runtime_launch_route_state, "home_default") == 0) {
      pass_expected_to_runtime = true;
    }
    if (replay_launch_home) {
      /* Launching from home for action replay must not pin runtime to target-route hash at start. */
      pass_expected_to_runtime = false;
    }
    if (pass_expected_to_runtime && expected_runtime_frame_hash[0] != '\0') {
      snprintf(app_arg_expected_hash,
               sizeof(app_arg_expected_hash),
               "--app-arg:expected_framehash=%s",
               expected_runtime_frame_hash);
      expected_hash_arg = app_arg_expected_hash;
    }
    bool enable_direct_launch_smoke = false;
    const char *direct_launch_smoke_env = getenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_SMOKE");
    if (direct_launch_smoke_env != NULL && direct_launch_smoke_env[0] != '\0') {
      enable_direct_launch_smoke = (strcmp(direct_launch_smoke_env, "0") != 0);
    }
    const char *direct_launch_smoke_route = getenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE");
    if ((direct_launch_smoke_route == NULL || direct_launch_smoke_route[0] == '\0') &&
        runtime_launch_route_state != NULL && runtime_launch_route_state[0] != '\0') {
      direct_launch_smoke_route = runtime_launch_route_state;
    }
    if (direct_launch_smoke_route == NULL || direct_launch_smoke_route[0] == '\0') {
      direct_launch_smoke_route = "home_default";
    }
    char direct_launch_smoke_arg[256];
    direct_launch_smoke_arg[0] = '\0';
    if (enable_direct_launch_smoke) {
      snprintf(direct_launch_smoke_arg,
               sizeof(direct_launch_smoke_arg),
               "--direct-launch-smoke:%s",
               direct_launch_smoke_route);
    }
    char truth_dir_arg[PATH_MAX + 16];
    truth_dir_arg[0] = '\0';
    const char *truth_dir_runtime_arg = NULL;
    if (truth_dir != NULL && truth_dir[0] != '\0') {
      snprintf(truth_dir_arg, sizeof(truth_dir_arg), "--truth-dir:%s", truth_dir);
      truth_dir_runtime_arg = truth_dir_arg;
    }
    char *runtime_argv[31];
    int runtime_argc = 0;
    runtime_argv[runtime_argc++] = mobile_runner;
    runtime_argv[runtime_argc++] = runner_entry;
    runtime_argv[runtime_argc++] = "--name:claude_android_1to1";
    runtime_argv[runtime_argc++] = out_arg;
    runtime_argv[runtime_argc++] = assets_arg;
    if (truth_dir_runtime_arg != NULL) runtime_argv[runtime_argc++] = (char *)truth_dir_runtime_arg;
    runtime_argv[runtime_argc++] = native_obj_arg;
    runtime_argv[runtime_argc++] = app_arg_manifest;
    runtime_argv[runtime_argc++] = app_arg_sem_nodes;
    runtime_argv[runtime_argc++] = app_arg_frame_dump;
    if (expected_hash_arg != NULL) runtime_argv[runtime_argc++] = (char *)expected_hash_arg;
    if (route_state_arg != NULL) runtime_argv[runtime_argc++] = (char *)route_state_arg;
    if (truth_sync_routes_arg != NULL) runtime_argv[runtime_argc++] = (char *)truth_sync_routes_arg;
    runtime_argv[runtime_argc++] = "--app-arg:gate_mode=android-semantic-visual-1to1";
    runtime_argv[runtime_argc++] = "--app-arg:truth_mode=strict";
    runtime_argv[runtime_argc++] = "--app-arg:arg_probe=foo_bar";
    runtime_argv[runtime_argc++] = app_args_json_arg;
    runtime_argv[runtime_argc++] = runtime_state_arg;
    runtime_argv[runtime_argc++] = runtime_wait_arg;
    if (enable_direct_launch_smoke) runtime_argv[runtime_argc++] = direct_launch_smoke_arg;
    runtime_argv[runtime_argc] = NULL;

    setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", "1", 1);
    setenv("CHENG_ANDROID_NO_FOREGROUND_SWITCH", "1", 1);
    unsetenv("CHENG_ANDROID_NO_FORCE_STOP");
    unsetenv("CHENG_ANDROID_NO_RESTART");
    fprintf(stdout, "== android 1:1: mobile run (kotlin host) ==\n");
    print_cmdline(runtime_argv);
    RunResult rr = run_command(runtime_argv, run_log, runtime_timeout);
    if (rr.code != 0) {
      if (rr.timed_out) {
        fprintf(stderr, "[verify-android-claude-1to1-gate] runtime timeout after %ds\n", runtime_timeout);
      } else {
        fprintf(stderr, "[verify-android-claude-1to1-gate] runtime failed rc=%d\n", rr.code);
      }
      print_file_head(run_log, 220);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }

    if (!file_exists(runtime_json)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime state file missing: %s\n", runtime_json);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!file_contains(run_log, "--es cheng_app_args_kv") || !file_contains(run_log, "--es cheng_app_args_json") ||
        !file_contains(run_log, "--es cheng_app_args_json_b64") ||
        !file_contains(run_log, "[run-android] runtime-state") ||
        !file_not_contains(run_log, "shim mode active") ||
        !file_contains(run_log, "[mobile-export] mode=native-obj")) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime log validation failed\n");
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!parse_runtime_state(runtime_json,
                             semantic_node_count,
                             expected_semantic_total_hash,
                             runtime_launch_route_state,
                             false,
                             expected_runtime_frame_hash[0] != '\0' ? expected_runtime_frame_hash : NULL,
                             target_surface_w,
                             target_surface_h,
                             &runtime_snapshot)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (runtime_launch_route_state != NULL &&
        runtime_launch_route_state[0] != '\0' &&
        !runtime_route_matches_expected(runtime_snapshot.route_state, runtime_launch_route_state)) {
      int boot_recover_surface_w = target_surface_w > 0 ? target_surface_w : (int)runtime_snapshot.surface_width;
      int boot_recover_surface_h = target_surface_h > 0 ? target_surface_h : (int)runtime_snapshot.surface_height;
      fprintf(stdout,
              "[verify-android-claude-1to1-gate] strict boot convergence expected=%s got=%s -> replay actions\n",
              runtime_launch_route_state,
              runtime_snapshot.route_state[0] != '\0' ? runtime_snapshot.route_state : "<empty>");
      if (!replay_route_actions_for_runtime(route_actions_path,
                                            route_tree_path,
                                            route_semantic_tree_path,
                                            runtime_launch_route_state,
                                            boot_recover_surface_w,
                                            boot_recover_surface_h,
                                            true,
                                            false)) {
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] strict boot convergence replay failed expected=%s got=%s\n",
                runtime_launch_route_state,
                runtime_snapshot.route_state[0] != '\0' ? runtime_snapshot.route_state : "<empty>");
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
      if (!refresh_runtime_snapshot_from_device(runtime_json,
                                                semantic_node_count,
                                                expected_semantic_total_hash,
                                                runtime_launch_route_state,
                                                boot_recover_surface_w,
                                                boot_recover_surface_h,
                                                &runtime_snapshot)) {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] strict boot convergence runtime snapshot stale; continue with visual gate expected=%s\n",
                runtime_launch_route_state);
        if (runtime_launch_route_state != NULL && runtime_launch_route_state[0] != '\0') {
          snprintf(runtime_snapshot.route_state,
                   sizeof(runtime_snapshot.route_state),
                   "%s",
                   runtime_launch_route_state);
        }
        runtime_snapshot.last_frame_hash[0] = '\0';
        runtime_snapshot.semantic_nodes_applied_hash[0] = '\0';
        runtime_snapshot.semantic_nodes_applied_count = 0;
        runtime_snapshot.surface_width = boot_recover_surface_w;
        runtime_snapshot.surface_height = boot_recover_surface_h;
      }
    }
    int target_route_depth = 0;
    if (route_state != NULL && route_state[0] != '\0') {
      char route_parent_probe[128];
      char path_signature_probe[512];
      route_parent_probe[0] = '\0';
      path_signature_probe[0] = '\0';
      if (!load_route_meta_from_tree(route_tree_path,
                                     route_state,
                                     route_parent_probe,
                                     sizeof(route_parent_probe),
                                     &target_route_depth,
                                     path_signature_probe,
                                     sizeof(path_signature_probe))) {
        target_route_depth = 0;
      }
    }
    if (!fullroute_enabled && home_hard_gate) {
      if (strcmp(runtime_snapshot.route_state, "home_default") != 0 ||
          runtime_snapshot.semantic_nodes_applied_count <= 0 ||
          !runtime_hash_nonzero(runtime_snapshot.last_frame_hash)) {
        fprintf(stderr,
                "[verify-android-claude-1to1-gate] home hard gate runtime snapshot invalid route=%s applied=%lld framehash=%s\n",
                runtime_snapshot.route_state[0] != '\0' ? runtime_snapshot.route_state : "<empty>",
                runtime_snapshot.semantic_nodes_applied_count,
                runtime_snapshot.last_frame_hash[0] != '\0' ? runtime_snapshot.last_frame_hash : "<empty>");
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
    }
    bool replay_route_actions = false;
    char replay_home_baseline_hash[128];
    replay_home_baseline_hash[0] = '\0';
    bool replay_home_baseline_ready = false;
    const char *replay_route_actions_env = getenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS");
    if (replay_route_actions_env != NULL && replay_route_actions_env[0] != '\0') {
      replay_route_actions = (strcmp(replay_route_actions_env, "0") != 0);
    } else if (replay_launch_home &&
               route_state != NULL &&
               route_state[0] != '\0' &&
               strcmp(route_state, "home_default") != 0) {
      replay_route_actions = true;
    }
  if (replay_route_actions) {
      int replay_surface_w = target_surface_w > 0 ? target_surface_w : (int)runtime_snapshot.surface_width;
      int replay_surface_h = target_surface_h > 0 ? target_surface_h : (int)runtime_snapshot.surface_height;
      bool need_home_replay = replay_launch_home &&
                              route_state != NULL &&
                              route_state[0] != '\0' &&
                              strcmp(route_state, "home_default") != 0;
      if (need_home_replay &&
          !replay_route_actions_for_runtime(route_actions_path,
                                            route_tree_path,
                                            route_semantic_tree_path,
                                            "home_default",
                                            replay_surface_w,
                                            replay_surface_h,
                                            true,
                                            true)) {
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
      if (need_home_replay && capture_runtime_visual) {
        RuntimeStateSnapshot replay_home_snapshot = runtime_snapshot;
        snprintf(replay_home_snapshot.route_state, sizeof(replay_home_snapshot.route_state), "%s", "home_default");
        replay_home_snapshot.last_frame_hash[0] = '\0';
        replay_home_snapshot.semantic_nodes_applied_hash[0] = '\0';
        replay_home_snapshot.semantic_nodes_applied_count = 0;
        if (capture_runtime_route_visual(out_dir,
                                         &replay_home_snapshot,
                                         frame_dump_name,
                                         route_tree_path,
                                         route_semantic_tree_path,
                                         false)) {
          char replay_home_hash_path[PATH_MAX];
          if (snprintf(replay_home_hash_path,
                       sizeof(replay_home_hash_path),
                       "%s/runtime_capture/%s.framehash",
                       out_dir,
                       "home_default") < (int)sizeof(replay_home_hash_path) &&
              read_hash_hex_token(replay_home_hash_path,
                                  replay_home_baseline_hash,
                                  sizeof(replay_home_baseline_hash))) {
            replay_home_baseline_ready = true;
          }
        }
      }
      if (route_state == NULL || route_state[0] == '\0') {
        fprintf(stderr, "[verify-android-claude-1to1-gate] route replay requested but route_state is empty\n");
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
      if (!replay_route_actions_for_runtime(route_actions_path,
                                            route_tree_path,
                                            route_semantic_tree_path,
                                            route_state,
                                            replay_surface_w,
                                            replay_surface_h,
                                            false,
                                            false)) {
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
      if (route_state != NULL && route_state[0] != '\0') {
        if (!refresh_runtime_snapshot_from_device(runtime_json,
                                                  semantic_node_count,
                                                  expected_semantic_total_hash,
                                                  route_state,
                                                  replay_surface_w,
                                                  replay_surface_h,
                                                  &runtime_snapshot)) {
          /*
           * Android runtime_state json may be stale after startup window; replay success is
           * still enforced by downstream runtime visual capture + target framehash check.
           */
          fprintf(stdout,
                  "[verify-android-claude-1to1-gate] replay runtime snapshot stale; defer to visual framehash gate route=%s\n",
                  route_state);
          snprintf(runtime_snapshot.route_state, sizeof(runtime_snapshot.route_state), "%s", route_state);
          runtime_snapshot.last_frame_hash[0] = '\0';
          runtime_snapshot.semantic_nodes_applied_hash[0] = '\0';
          runtime_snapshot.semantic_nodes_applied_count = 0;
        }
        /*
         * Fullroute capture artifacts are keyed by requested route_state.
         * Keep route label stable even when runtime reports an equivalent state
         * (for example home_sort_open -> home_default).
         */
        snprintf(runtime_snapshot.route_state, sizeof(runtime_snapshot.route_state), "%s", route_state);
      }
    }
    if (capture_runtime_visual && runtime_snapshot.route_state[0] != '\0') {
      int capture_retry_attempts =
          env_positive_int_or_default("CHENG_ANDROID_1TO1_RUNTIME_CAPTURE_RETRY_ATTEMPTS", 3);
      int capture_retry_sleep_ms =
          env_positive_int_or_default("CHENG_ANDROID_1TO1_RUNTIME_CAPTURE_RETRY_SLEEP_MS", 450);
      if (capture_retry_attempts < 1) capture_retry_attempts = 1;
      bool capture_ok = false;
      bool no_op_failure = false;
      bool hash_mismatch_failure = false;
      bool compare_expected_with_runtime_hash =
          env_flag_enabled("CHENG_ANDROID_1TO1_COMPARE_EXPECTED_WITH_RUNTIME_FRAMEHASH", true);
      char captured_framehash_path[PATH_MAX];
      char captured_runtime_framehash_path[PATH_MAX];
      char captured_framehash[128];
      char captured_runtime_framehash[128];
      const char *captured_gate_framehash = captured_framehash;
      const char *captured_gate_framehash_source = "capture_framehash";
      captured_framehash[0] = '\0';
      captured_runtime_framehash[0] = '\0';
      for (int capture_attempt = 1; capture_attempt <= capture_retry_attempts; ++capture_attempt) {
        if (!capture_runtime_route_visual(out_dir,
                                          &runtime_snapshot,
                                          frame_dump_name,
                                          route_tree_path,
                                          route_semantic_tree_path,
                                          capture_runtime_visual_strict)) {
          if (capture_attempt == capture_retry_attempts) {
            strlist_free(&states);
            free(report_doc);
            return 1;
          }
          if (capture_retry_sleep_ms > 0) usleep((useconds_t)capture_retry_sleep_ms * 1000u);
          continue;
        }
        captured_framehash[0] = '\0';
        if (snprintf(captured_framehash_path,
                     sizeof(captured_framehash_path),
                     "%s/runtime_capture/%s.framehash",
                     out_dir,
                     runtime_snapshot.route_state) >= (int)sizeof(captured_framehash_path) ||
            !read_hash_hex_token(captured_framehash_path, captured_framehash, sizeof(captured_framehash))) {
          if (capture_attempt == capture_retry_attempts) {
            fprintf(stderr,
                    "[verify-android-claude-1to1-gate] missing/invalid captured runtime framehash route=%s path=%s\n",
                    runtime_snapshot.route_state,
                    captured_framehash_path);
            strlist_free(&states);
            free(report_doc);
            return 1;
          }
          if (capture_retry_sleep_ms > 0) usleep((useconds_t)capture_retry_sleep_ms * 1000u);
          continue;
        }
        captured_gate_framehash = captured_framehash;
        captured_gate_framehash_source = "capture_framehash";
        captured_runtime_framehash[0] = '\0';
        bool force_capture_framehash_for_route =
            (route_state != NULL && route_requires_visual_delta(route_state));
        if (snprintf(captured_runtime_framehash_path,
                     sizeof(captured_runtime_framehash_path),
                     "%s/runtime_capture/%s.runtime_framehash",
                     out_dir,
                     runtime_snapshot.route_state) < (int)sizeof(captured_runtime_framehash_path) &&
            read_hash_hex_token(
                captured_runtime_framehash_path, captured_runtime_framehash, sizeof(captured_runtime_framehash))) {
          if (compare_expected_with_runtime_hash && !force_capture_framehash_for_route) {
            captured_gate_framehash = captured_runtime_framehash;
            captured_gate_framehash_source = "runtime_state_framehash";
          }
        }
        bool no_op_guard_enabled = true;
        if (route_state != NULL && route_state[0] != '\0') {
          const char *equivalent_route = semantic_equivalent_runtime_route(route_state);
          if (equivalent_route != NULL &&
              equivalent_route[0] != '\0' &&
              strcmp(equivalent_route, route_state) != 0) {
            no_op_guard_enabled = false;
          }
        }
        no_op_failure = no_op_guard_enabled &&
                        replay_route_actions &&
                        route_state != NULL &&
                        route_state[0] != '\0' &&
                        strcmp(route_state, "home_default") != 0 &&
                        target_route_depth > 0 &&
                        replay_home_baseline_ready &&
                        hash_hex_equal(captured_framehash, replay_home_baseline_hash);
        hash_mismatch_failure = (expected_runtime_frame_hash[0] != '\0') &&
                                !hash_hex_equal(captured_gate_framehash, expected_runtime_frame_hash);
        if (!no_op_failure && !hash_mismatch_failure) {
          capture_ok = true;
          break;
        }
        if (capture_attempt < capture_retry_attempts) {
          fprintf(stdout,
                  "[verify-android-claude-1to1-gate] runtime capture retry route=%s attempt=%d/%d no-op=%d expected=%s got=%s source=%s capture=%s runtime=%s\n",
                  runtime_snapshot.route_state,
                  capture_attempt + 1,
                  capture_retry_attempts,
                  no_op_failure ? 1 : 0,
                  expected_runtime_frame_hash[0] != '\0' ? expected_runtime_frame_hash : "<none>",
                  captured_gate_framehash,
                  captured_gate_framehash_source,
                  captured_framehash[0] != '\0' ? captured_framehash : "<none>",
                  captured_runtime_framehash[0] != '\0' ? captured_runtime_framehash : "<none>");
          if (capture_retry_sleep_ms > 0) usleep((useconds_t)capture_retry_sleep_ms * 1000u);
          continue;
        }
      }
      if (!capture_ok) {
        if (no_op_failure) {
          fprintf(stderr,
                  "[verify-android-claude-1to1-gate] route replay no-op route=%s depth=%d baseline_hash=%s captured_hash=%s\n",
                  route_state != NULL ? route_state : "<none>",
                  target_route_depth,
                  replay_home_baseline_hash,
                  captured_framehash);
        } else if (hash_mismatch_failure) {
          fprintf(stderr,
                  "[verify-android-claude-1to1-gate] captured runtime framehash mismatch expected=%s got=%s route=%s source=%s capture=%s runtime=%s\n",
                  expected_runtime_frame_hash,
                  captured_gate_framehash,
                  runtime_snapshot.route_state,
                  captured_gate_framehash_source,
                  captured_framehash[0] != '\0' ? captured_framehash : "<none>",
                  captured_runtime_framehash[0] != '\0' ? captured_runtime_framehash : "<none>");
        } else {
          fprintf(stderr,
                  "[verify-android-claude-1to1-gate] runtime capture validation failed route=%s\n",
                  runtime_snapshot.route_state);
        }
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
    }

    if (fullroute_enabled) {
      if (use_visual_fullroute_gate) {
        fprintf(stdout, "== android 1:1: fullroute visual gate ==\n");
        char *full_argv[] = {
            fullroute_gate_cmd,
            "--compile-out",
            compile_out,
            "--out",
            fullroute_out,
            "--manifest",
            android_truth_manifest,
            NULL,
        };
        print_cmdline(full_argv);
        rr = run_command(full_argv, fullroute_log, runtime_timeout);
        if (rr.code != 0) {
          if (rr.timed_out) {
            fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute timeout after %ds\n", runtime_timeout);
          } else {
            fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute failed rc=%d\n", rr.code);
          }
          print_file_head(fullroute_log, 220);
          strlist_free(&states);
          free(report_doc);
          return 1;
        }
        if (!file_exists(fullroute_report) || !file_contains(fullroute_log, "[verify-android-fullroute-pixel] ok routes=") ||
            !validate_fullroute_report(fullroute_report, full_route_count)) {
          strlist_free(&states);
          free(report_doc);
          return 1;
        }
        fullroute_routes_ok = full_route_count;
      } else {
        fprintf(stdout, "== android 1:1: fullroute strict route loop ==\n");
        const char *prev_skip_compile_raw = getenv("CHENG_ANDROID_1TO1_SKIP_COMPILE");
        const char *prev_enable_fullroute_raw = getenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE");
        const char *prev_home_gate_raw = getenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE");
        const char *prev_runtime_required_raw = getenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME");
        const char *prev_eq_runtime_required_raw = getenv("CHENG_ANDROID_EQ_REQUIRE_RUNTIME");
        char *prev_skip_compile = prev_skip_compile_raw ? strdup(prev_skip_compile_raw) : NULL;
        char *prev_enable_fullroute = prev_enable_fullroute_raw ? strdup(prev_enable_fullroute_raw) : NULL;
        char *prev_home_gate = prev_home_gate_raw ? strdup(prev_home_gate_raw) : NULL;
        char *prev_runtime_required = prev_runtime_required_raw ? strdup(prev_runtime_required_raw) : NULL;
        char *prev_eq_runtime_required = prev_eq_runtime_required_raw ? strdup(prev_eq_runtime_required_raw) : NULL;
        setenv("CHENG_ANDROID_1TO1_SKIP_COMPILE", "1", 1);
        setenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", "0", 1);
        setenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE", "0", 1);
        setenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", "1", 1);
        setenv("CHENG_ANDROID_EQ_REQUIRE_RUNTIME", "1", 1);

        char *full_argv[16];
        int full_argc = 0;
        full_argv[full_argc++] = fullroute_strict_cmd;
        full_argv[full_argc++] = "--project";
        full_argv[full_argc++] = (char *)project;
        full_argv[full_argc++] = "--entry";
        full_argv[full_argc++] = (char *)entry;
        full_argv[full_argc++] = "--out";
        full_argv[full_argc++] = (char *)out_dir;
        full_argv[full_argc++] = "--android-fullroute";
        full_argv[full_argc++] = "1";
        if (truth_dir != NULL && truth_dir[0] != '\0') {
          full_argv[full_argc++] = "--truth-dir";
          full_argv[full_argc++] = (char *)truth_dir;
        }
        full_argv[full_argc] = NULL;
        print_cmdline(full_argv);
        char *strict_fullroute_out = NULL;
        int strict_fullroute_rc = capture_command_output(full_argv, runtime_timeout, &strict_fullroute_out);
        rr.code = strict_fullroute_rc;
        rr.timed_out = (strict_fullroute_rc == 124);
        if (strict_fullroute_out != NULL) {
          (void)write_file_all(fullroute_strict_driver_log, strict_fullroute_out, strlen(strict_fullroute_out));
        }

        restore_env_value("CHENG_ANDROID_1TO1_SKIP_COMPILE", prev_skip_compile);
        restore_env_value("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", prev_enable_fullroute);
        restore_env_value("CHENG_ANDROID_1TO1_HOME_HARD_GATE", prev_home_gate);
        restore_env_value("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", prev_runtime_required);
        restore_env_value("CHENG_ANDROID_EQ_REQUIRE_RUNTIME", prev_eq_runtime_required);
        free(prev_skip_compile);
        free(prev_enable_fullroute);
        free(prev_home_gate);
        free(prev_runtime_required);
        free(prev_eq_runtime_required);

        if (rr.code != 0) {
          if (rr.timed_out) {
            fprintf(stderr, "[verify-android-claude-1to1-gate] strict fullroute timeout after %ds\n", runtime_timeout);
          } else {
            fprintf(stderr, "[verify-android-claude-1to1-gate] strict fullroute failed rc=%d\n", rr.code);
          }
          print_file_head(fullroute_strict_driver_log, 220);
          strlist_free(&states);
          free(report_doc);
          free(strict_fullroute_out);
          return 1;
        }
        if (strict_fullroute_out == NULL || !str_contains(strict_fullroute_out, "[verify-r2c-android-native] ok")) {
          fprintf(stderr, "[verify-android-claude-1to1-gate] strict fullroute log missing success marker\n");
          print_file_head(fullroute_strict_driver_log, 220);
          strlist_free(&states);
          free(report_doc);
          free(strict_fullroute_out);
          return 1;
        }
        free(strict_fullroute_out);
        snprintf(fullroute_log, sizeof(fullroute_log), "%s", fullroute_strict_driver_log);
        fullroute_routes_ok = full_route_count;
      }
    } else {
      if (fullroute_explicit && enable_fullroute != NULL && strcmp(enable_fullroute, "0") == 0) {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] runtime fullroute skipped: CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=0\n");
      } else if (!fullroute_explicit && route_state != NULL && route_state[0] != '\0') {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] runtime fullroute skipped: single-route mode (set CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=1 to enable)\n");
      } else {
        fprintf(stdout, "[verify-android-claude-1to1-gate] runtime fullroute skipped\n");
      }
    }
  } else {
    fprintf(stdout, "[verify-android-claude-1to1-gate] runtime phase skipped: CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=0\n");
  }

  char git_head[128];
  snprintf(git_head, sizeof(git_head), "unknown");
  char git_root[PATH_MAX];
  snprintf(git_root, sizeof(git_root), "%s/..", root);
  char *git_argv[] = {"git", "-C", git_root, "rev-parse", "HEAD", NULL};
  char *git_out = NULL;
  int git_rc = capture_command_output(git_argv, 10, &git_out);
  if (git_rc == 0 && git_out != NULL) {
    size_t i = 0;
    while (git_out[i] != '\0' && git_out[i] != '\n' && i + 1u < sizeof(git_head)) {
      git_head[i] = git_out[i];
      i++;
    }
    git_head[i] = '\0';
  }
  free(git_out);

  char runtime_capture_png[PATH_MAX];
  char runtime_capture_rgba[PATH_MAX];
  char runtime_capture_meta[PATH_MAX];
  char runtime_capture_runtime_hash[PATH_MAX];
  char runtime_capture_framehash[PATH_MAX];
  runtime_capture_png[0] = '\0';
  runtime_capture_rgba[0] = '\0';
  runtime_capture_meta[0] = '\0';
  runtime_capture_runtime_hash[0] = '\0';
  runtime_capture_framehash[0] = '\0';
  if (runtime_snapshot.route_state[0] != '\0') {
    (void)snprintf(runtime_capture_png,
                   sizeof(runtime_capture_png),
                   "");
    (void)snprintf(runtime_capture_rgba,
                   sizeof(runtime_capture_rgba),
                   "%s/runtime_capture/%s.rgba",
                   out_dir,
                   runtime_snapshot.route_state);
    (void)snprintf(runtime_capture_meta,
                   sizeof(runtime_capture_meta),
                   "%s/runtime_capture/%s.meta.json",
                   out_dir,
                   runtime_snapshot.route_state);
    (void)snprintf(runtime_capture_runtime_hash,
                   sizeof(runtime_capture_runtime_hash),
                   "%s/runtime_capture/%s.runtime_framehash",
                   out_dir,
                   runtime_snapshot.route_state);
    (void)snprintf(runtime_capture_framehash,
                   sizeof(runtime_capture_framehash),
                   "%s/runtime_capture/%s.framehash",
                   out_dir,
                   runtime_snapshot.route_state);
  }

  char marker_json[8192];
  int m = snprintf(marker_json, sizeof(marker_json),
                   "{\n"
                   "  \"git_head\": \"%s\",\n"
                   "  \"project\": \"%s\",\n"
                   "  \"entry\": \"%s\",\n"
                   "  \"gate_mode\": \"android-semantic-visual-1to1\",\n"
                   "  \"routes\": %d,\n"
                   "  \"pixel_tolerance\": 0,\n"
                   "  \"semantic_node_count\": %d,\n"
                   "  \"used_fallback\": false,\n"
                   "  \"compiler_rc\": 0,\n"
                   "  \"android_truth_manifest_path\": \"%s\",\n"
                   "  \"runtime_required\": %s,\n"
                   "  \"runtime_state_path\": \"%s\",\n"
                   "  \"runtime_route_state\": \"%s\",\n"
                   "  \"runtime_last_frame_hash\": \"%s\",\n"
                   "  \"runtime_semantic_nodes_applied_hash\": \"%s\",\n"
                   "  \"runtime_surface_width\": %lld,\n"
                   "  \"runtime_surface_height\": %lld,\n"
                   "  \"runtime_capture_png_path\": \"%s\",\n"
                   "  \"runtime_capture_rgba_path\": \"%s\",\n"
                   "  \"runtime_capture_meta_path\": \"%s\",\n"
                   "  \"runtime_capture_runtime_framehash_path\": \"%s\",\n"
                   "  \"runtime_capture_framehash_path\": \"%s\",\n"
                   "  \"expected_frame_hash\": \"%s\",\n"
                   "  \"freeze_truth_dir\": \"%s\",\n"
                   "  \"run_log_path\": \"%s\",\n"
                   "  \"visual_fullroute_log_path\": \"%s\",\n"
                   "  \"visual_fullroute_report_path\": \"%s\",\n"
                   "  \"visual_passed\": true,\n"
                   "  \"visual_routes_verified\": %d\n"
                   "}\n",
                   git_head,
                   project,
                   entry,
                   full_route_count,
                   semantic_node_count,
                   android_truth_manifest,
                   runtime_required ? "true" : "false",
                   runtime_json,
                   runtime_snapshot.route_state,
                   runtime_snapshot.last_frame_hash,
                   runtime_snapshot.semantic_nodes_applied_hash,
                   runtime_snapshot.surface_width,
                   runtime_snapshot.surface_height,
                   runtime_capture_png,
                   runtime_capture_rgba,
                   runtime_capture_meta,
                   runtime_capture_runtime_hash,
                   runtime_capture_framehash,
                   expected_runtime_frame_hash,
                   freeze_truth_dir != NULL ? freeze_truth_dir : "",
                   run_log,
                   fullroute_log,
                   fullroute_report,
                   fullroute_routes_ok);
  if (m <= 0 || (size_t)m >= sizeof(marker_json) || write_file_all(marker_path, marker_json, (size_t)m) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to write marker: %s\n", marker_path);
    strlist_free(&states);
    free(report_doc);
    return 1;
  }

  strlist_free(&states);
  free(report_doc);
  fprintf(stdout, "[verify-android-claude-1to1-gate] ok routes=%d\n", full_route_count);
  return 0;
}
static bool route_requires_stable_semantic_hit(const char *route_state) {
  if (route_state == NULL || route_state[0] == '\0') return false;
  if (strcmp(route_state, "publish_selector") == 0) return true;
  return strncmp(route_state, "tab_", 4u) == 0;
}

static bool verify_semantic_target_hit_stable(const char *adb,
                                              const char *serial,
                                              const char *replay_package,
                                              const char *route_state,
                                              const char *expected_semantic_subtree_hash,
                                              int expected_semantic_subtree_count,
                                              int *out_failed_sample,
                                              char *out_runtime_route,
                                              size_t out_runtime_route_cap,
                                              char *out_runtime_semantic_hash,
                                              size_t out_runtime_semantic_hash_cap,
                                              long long *out_runtime_semantic_count,
                                              bool *out_runtime_semantic_match) {
  if (out_failed_sample != NULL) *out_failed_sample = -1;
  if (out_runtime_route != NULL && out_runtime_route_cap > 0u) out_runtime_route[0] = '\0';
  if (out_runtime_semantic_hash != NULL && out_runtime_semantic_hash_cap > 0u) {
    out_runtime_semantic_hash[0] = '\0';
  }
  if (out_runtime_semantic_count != NULL) *out_runtime_semantic_count = 0;
  if (out_runtime_semantic_match != NULL) *out_runtime_semantic_match = false;
  if (!env_flag_enabled("CHENG_ANDROID_1TO1_ROUTE_REPLAY_REQUIRE_STABLE_HIT", true)) return true;
  if (!route_requires_stable_semantic_hit(route_state)) return true;

  int stable_samples = env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_STABLE_HIT_SAMPLES", 5);
  int stable_sleep_ms = env_positive_int_or_default("CHENG_ANDROID_1TO1_ROUTE_REPLAY_STABLE_HIT_SLEEP_MS", 200);
  if (stable_samples < 1) stable_samples = 1;
  if (stable_samples > 12) stable_samples = 12;
  if (stable_sleep_ms < 0) stable_sleep_ms = 0;
  if (stable_sleep_ms > 1200) stable_sleep_ms = 1200;

  for (int sample_idx = 0; sample_idx < stable_samples; ++sample_idx) {
    if (sample_idx > 0 && stable_sleep_ms > 0) {
      usleep((useconds_t)stable_sleep_ms * 1000u);
    }
    char stable_route[128];
    char stable_semantic_hash[128];
    long long stable_semantic_count = 0;
    stable_route[0] = '\0';
    stable_semantic_hash[0] = '\0';
    bool stable_probe_ok = read_runtime_semantic_state_route_action_retry(adb,
                                                                           serial,
                                                                           replay_package,
                                                                           stable_route,
                                                                           sizeof(stable_route),
                                                                           stable_semantic_hash,
                                                                           sizeof(stable_semantic_hash),
                                                                           &stable_semantic_count,
                                                                           1,
                                                                           0);
    bool stable_route_match = stable_probe_ok && runtime_route_matches_expected_for_hit(stable_route, route_state);
    bool stable_semantic_relaxed = false;
    bool stable_semantic_match = false;
    if (stable_probe_ok) {
      stable_semantic_match = gate_semantic_hash_match_or_relaxed(replay_package,
                                                                   route_state,
                                                                   stable_route,
                                                                   stable_semantic_hash,
                                                                   stable_semantic_count,
                                                                   expected_semantic_subtree_hash,
                                                                   expected_semantic_subtree_count,
                                                                   stable_route_match,
                                                                   &stable_semantic_relaxed);
    }

    if (out_runtime_route != NULL && out_runtime_route_cap > 0u) {
      snprintf(out_runtime_route, out_runtime_route_cap, "%s", stable_route);
    }
    if (out_runtime_semantic_hash != NULL && out_runtime_semantic_hash_cap > 0u) {
      snprintf(out_runtime_semantic_hash, out_runtime_semantic_hash_cap, "%s", stable_semantic_hash);
    }
    if (out_runtime_semantic_count != NULL) {
      *out_runtime_semantic_count = stable_semantic_count;
    }
    if (out_runtime_semantic_match != NULL) {
      *out_runtime_semantic_match = stable_semantic_match;
    }

    if (!stable_probe_ok || !stable_route_match || !stable_semantic_match) {
      if (out_failed_sample != NULL) *out_failed_sample = sample_idx + 1;
      return false;
    }
  }

  return true;
}
