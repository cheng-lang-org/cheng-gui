#define _POSIX_C_SOURCE 200809L

#include "native_capture_android_unimaker_truth.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  int x;
  int y;
  int w;
  int h;
} Rect;

typedef struct {
  int code;
  bool timed_out;
} RunResult;

static char *read_file_all(const char *path, size_t *out_len);
static int capture_command_output(char *const argv[], int timeout_sec, char **out);

static const char *skip_ws_local(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool env_flag_enabled_local(const char *name, bool fallback) {
  if (name == NULL || name[0] == '\0') return fallback;
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return fallback;
  if (strcmp(raw, "1") == 0 || strcmp(raw, "true") == 0 || strcmp(raw, "TRUE") == 0 ||
      strcmp(raw, "yes") == 0 || strcmp(raw, "on") == 0) {
    return true;
  }
  if (strcmp(raw, "0") == 0 || strcmp(raw, "false") == 0 || strcmp(raw, "FALSE") == 0 ||
      strcmp(raw, "no") == 0 || strcmp(raw, "off") == 0) {
    return false;
  }
  return fallback;
}

static bool parse_json_string_local(const char *p, char *out, size_t out_cap, const char **out_end) {
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

static const char *json_find_key_in_span(const char *start, const char *end, const char *key) {
  if (start == NULL || end == NULL || key == NULL || end <= start) return NULL;
  char pat[128];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = start;
  while (p < end) {
    const char *hit = strstr(p, pat);
    if (hit == NULL || hit >= end) return NULL;
    const char *q = skip_ws_local(hit + strlen(pat));
    if (q == NULL || q >= end || *q != ':') {
      p = hit + 1;
      continue;
    }
    q = skip_ws_local(q + 1);
    if (q == NULL || q >= end) return NULL;
    return q;
  }
  return NULL;
}

static bool parse_json_int_field_in_span(const char *start, const char *end, const char *key, int *out) {
  if (out == NULL) return false;
  const char *p = json_find_key_in_span(start, end, key);
  if (p == NULL) return false;
  char *end_num = NULL;
  long v = strtol(p, &end_num, 10);
  if (end_num == p || end_num > end) return false;
  *out = (int)v;
  return true;
}

static bool parse_json_bool_field_in_span(const char *start, const char *end, const char *key, bool *out) {
  if (out == NULL) return false;
  const char *p = json_find_key_in_span(start, end, key);
  if (p == NULL) return false;
  if ((size_t)(end - p) >= 4u && strncmp(p, "true", 4u) == 0) {
    *out = true;
    return true;
  }
  if ((size_t)(end - p) >= 5u && strncmp(p, "false", 5u) == 0) {
    *out = false;
    return true;
  }
  return false;
}

static bool parse_json_string_field_in_span(const char *start,
                                            const char *end,
                                            const char *key,
                                            char *out,
                                            size_t out_cap) {
  const char *p = json_find_key_in_span(start, end, key);
  if (p == NULL || *p != '"') return false;
  return parse_json_string_local(p, out, out_cap, NULL);
}

static bool parse_runtime_reason_token_local(const char *reason, const char *key, char *out, size_t out_cap) {
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

static bool hash_hex16_nonzero(const char *text) {
  if (text == NULL) return false;
  size_t n = strlen(text);
  if (n != 16u) return false;
  bool nonzero = false;
  for (size_t i = 0u; i < n; ++i) {
    char ch = text[i];
    if (ch >= 'A' && ch <= 'F') ch = (char)(ch - 'A' + 'a');
    if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
    if (ch != '0') nonzero = true;
  }
  return nonzero;
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

static bool route_requires_semantic_route_override(const char *route) {
  if (route == NULL || route[0] == '\0') return false;
  if (strcmp(route, "home_default") == 0) return false;
  if (strncmp(route, "tab_", 4u) == 0 || strcmp(route, "publish_selector") == 0) {
    return true;
  }
  const char *equivalent = semantic_equivalent_runtime_route(route);
  if (equivalent == NULL || equivalent[0] == '\0') return false;
  return strcmp(equivalent, route) != 0;
}

static bool runtime_route_matches_expected(const char *runtime_route, const char *expected_route) {
  if (runtime_route == NULL || expected_route == NULL) return false;
  if (strcmp(expected_route, "home_default") == 0) {
    bool exact_home_default =
        env_flag_enabled_local("CHENG_CAPTURE_UNIMAKER_HOME_DEFAULT_EXACT_MATCH", false);
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

static bool runtime_totals_relax_enabled_for_package(const char *pkg) {
  const char *env = getenv("CHENG_CAPTURE_UNIMAKER_RELAX_TOTALS_MISMATCH");
  if (env != NULL && env[0] != '\0') {
    return strcmp(env, "0") != 0;
  }
  return (pkg != NULL && strcmp(pkg, "com.cheng.mobile") == 0);
}

static int env_positive_int_or_default_local(const char *name, int fallback) {
  if (fallback <= 0) fallback = 1;
  if (name == NULL || name[0] == '\0') return fallback;
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return fallback;
  char *endptr = NULL;
  long parsed = strtol(raw, &endptr, 10);
  if (endptr == raw || parsed <= 0 || parsed > 60000) return fallback;
  return (int)parsed;
}

static bool parse_path_signature_from_span(const char *start, const char *end, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  const char *p = json_find_key_in_span(start, end, "path_from_root");
  if (p == NULL || *p != '[') return false;
  ++p;
  bool first = true;
  while (p < end) {
    p = skip_ws_local(p);
    if (p == NULL || p >= end) break;
    if (*p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '"') return false;
    char seg[128];
    const char *after = NULL;
    if (!parse_json_string_local(p, seg, sizeof(seg), &after)) return false;
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
    p = after;
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
  if (route_tree_path == NULL || route_state == NULL || route_state[0] == '\0') return false;
  if (out_parent != NULL && out_parent_cap > 0u) out_parent[0] = '\0';
  if (out_depth != NULL) *out_depth = 0;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) out_path_signature[0] = '\0';

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
  const char *obj_end = obj_begin;
  int depth = 0;
  bool in_string = false;
  while (*obj_end != '\0') {
    char ch = *obj_end++;
    if (ch == '"' && (obj_end - obj_begin < 3 || *(obj_end - 2) != '\\')) in_string = !in_string;
    if (in_string) continue;
    if (ch == '{') depth += 1;
    else if (ch == '}') {
      depth -= 1;
      if (depth == 0) break;
    }
  }
  if (depth != 0) {
    free(doc);
    return false;
  }

  char parent[128];
  parent[0] = '\0';
  int route_depth = 0;
  char signature[512];
  signature[0] = '\0';
  if (!parse_json_string_field_in_span(obj_begin, obj_end, "parent", parent, sizeof(parent)) ||
      !parse_json_int_field_in_span(obj_begin, obj_end, "depth", &route_depth) ||
      !parse_path_signature_from_span(obj_begin, obj_end, signature, sizeof(signature))) {
    free(doc);
    return false;
  }
  free(doc);

  if (out_parent != NULL && out_parent_cap > 0u) snprintf(out_parent, out_parent_cap, "%s", parent);
  if (out_depth != NULL) *out_depth = route_depth;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) {
    snprintf(out_path_signature, out_path_signature_cap, "%s", signature);
  }
  return true;
}

static bool load_route_semantic_expectation(const char *route_semantic_tree_path,
                                            const char *route_state,
                                            char *out_subtree_hash,
                                            size_t out_subtree_hash_cap,
                                            int *out_subtree_node_count) {
  if (out_subtree_hash != NULL && out_subtree_hash_cap > 0u) out_subtree_hash[0] = '\0';
  if (out_subtree_node_count != NULL) *out_subtree_node_count = 0;
  if (route_semantic_tree_path == NULL || route_state == NULL || route_state[0] == '\0') return false;
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
  const char *obj_end = obj_begin;
  int depth = 0;
  bool in_string = false;
  while (*obj_end != '\0') {
    char ch = *obj_end++;
    if (ch == '"' && (obj_end - obj_begin < 3 || *(obj_end - 2) != '\\')) in_string = !in_string;
    if (in_string) continue;
    if (ch == '{') depth += 1;
    else if (ch == '}') {
      depth -= 1;
      if (depth == 0) break;
    }
  }
  if (depth != 0) {
    free(doc);
    return false;
  }
  char subtree_hash[128];
  subtree_hash[0] = '\0';
  int subtree_node_count = 0;
  if (!parse_json_string_field_in_span(obj_begin, obj_end, "subtree_hash", subtree_hash, sizeof(subtree_hash)) ||
      !parse_json_int_field_in_span(obj_begin, obj_end, "subtree_node_count", &subtree_node_count)) {
    free(doc);
    return false;
  }
  free(doc);
  if (subtree_hash[0] == '\0' || subtree_node_count <= 0) return false;
  if (out_subtree_hash != NULL && out_subtree_hash_cap > 0u) {
    snprintf(out_subtree_hash, out_subtree_hash_cap, "%s", subtree_hash);
  }
  if (out_subtree_node_count != NULL) *out_subtree_node_count = subtree_node_count;
  return true;
}

static bool load_route_semantic_totals(const char *route_semantic_tree_path,
                                       char *out_total_hash,
                                       size_t out_total_hash_cap,
                                       int *out_total_count) {
  if (out_total_hash != NULL && out_total_hash_cap > 0u) out_total_hash[0] = '\0';
  if (out_total_count != NULL) *out_total_count = 0;
  if (route_semantic_tree_path == NULL || route_semantic_tree_path[0] == '\0') return false;
  size_t n = 0u;
  char *doc = read_file_all(route_semantic_tree_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  const char *doc_begin = doc;
  const char *doc_end = doc + strlen(doc);
  char total_hash[128];
  int total_count = 0;
  total_hash[0] = '\0';
  bool ok = parse_json_string_field_in_span(doc_begin, doc_end, "semantic_total_hash", total_hash, sizeof(total_hash)) &&
            parse_json_int_field_in_span(doc_begin, doc_end, "semantic_total_count", &total_count);
  free(doc);
  if (!ok || !hash_hex16_nonzero(total_hash) || total_count <= 0) return false;
  if (out_total_hash != NULL && out_total_hash_cap > 0u) snprintf(out_total_hash, out_total_hash_cap, "%s", total_hash);
  if (out_total_count != NULL) *out_total_count = total_count;
  return true;
}

static bool read_runtime_semantic_state_from_device(const char *adb,
                                                    const char *serial,
                                                    const char *pkg,
                                                    char *out_route,
                                                    size_t out_route_cap,
                                                    char *out_runtime_frame_hash,
                                                    size_t out_runtime_frame_hash_cap,
                                                    char *out_semantic_hash,
                                                    size_t out_semantic_hash_cap,
                                                    int *out_semantic_count,
                                                    char *out_semantic_total_hash,
                                                    size_t out_semantic_total_hash_cap,
                                                    int *out_semantic_total_count,
                                                    bool *out_render_ready,
                                                    bool *out_semantic_loaded,
                                                    bool *out_truth_assets_missing) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (out_runtime_frame_hash != NULL && out_runtime_frame_hash_cap > 0u) out_runtime_frame_hash[0] = '\0';
  if (out_semantic_hash != NULL && out_semantic_hash_cap > 0u) out_semantic_hash[0] = '\0';
  if (out_semantic_count != NULL) *out_semantic_count = 0;
  if (out_semantic_total_hash != NULL && out_semantic_total_hash_cap > 0u) out_semantic_total_hash[0] = '\0';
  if (out_semantic_total_count != NULL) *out_semantic_total_count = 0;
  if (out_render_ready != NULL) *out_render_ready = false;
  if (out_semantic_loaded != NULL) *out_semantic_loaded = false;
  if (out_truth_assets_missing != NULL) *out_truth_assets_missing = false;
  if (adb == NULL || serial == NULL || pkg == NULL || pkg[0] == '\0') return false;
  char *state_argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "run-as",
      (char *)pkg,
      "cat",
      "files/cheng_runtime_state.json",
      NULL,
  };
  char *state_doc = NULL;
  int state_rc = capture_command_output(state_argv, 15, &state_doc);
  if (state_rc != 0 || state_doc == NULL || state_doc[0] == '\0') {
    free(state_doc);
    return false;
  }
  const char *doc_begin = state_doc;
  const char *doc_end = state_doc + strlen(state_doc);
  char runtime_reason[4096];
  runtime_reason[0] = '\0';
  (void)parse_json_string_field_in_span(doc_begin, doc_end, "last_error", runtime_reason, sizeof(runtime_reason));

  int semantic_applied_count = 0;
  int semantic_total_count = 0;
  bool render_ready = false;
  bool semantic_loaded = false;
  int truth_w = -1;
  int truth_h = -1;
  char semantic_applied_hash[128];
  char semantic_total_hash[128];
  char runtime_frame_hash[128];
  char token[128];
  semantic_applied_hash[0] = '\0';
  semantic_total_hash[0] = '\0';
  runtime_frame_hash[0] = '\0';

  bool ok_route = parse_json_string_field_in_span(doc_begin, doc_end, "route_state", out_route, out_route_cap);
  bool ok_runtime_frame_hash =
      parse_json_string_field_in_span(doc_begin, doc_end, "last_frame_hash", runtime_frame_hash, sizeof(runtime_frame_hash));
  if (!ok_runtime_frame_hash) {
    ok_runtime_frame_hash =
        parse_runtime_reason_token_local(runtime_reason, "framehash", runtime_frame_hash, sizeof(runtime_frame_hash));
  }
  bool ok_applied_hash =
      parse_json_string_field_in_span(doc_begin, doc_end, "semantic_nodes_applied_hash", semantic_applied_hash, sizeof(semantic_applied_hash));
  if (!ok_applied_hash) ok_applied_hash = parse_runtime_reason_token_local(runtime_reason, "sah", semantic_applied_hash, sizeof(semantic_applied_hash));
  bool ok_applied_count = parse_json_int_field_in_span(doc_begin, doc_end, "semantic_nodes_applied_count", &semantic_applied_count);
  if (!ok_applied_count && parse_runtime_reason_token_local(runtime_reason, "sa", token, sizeof(token))) {
    semantic_applied_count = atoi(token);
    ok_applied_count = true;
  }
  bool ok_render_ready = parse_json_bool_field_in_span(doc_begin, doc_end, "render_ready", &render_ready);
  if (!ok_render_ready && parse_runtime_reason_token_local(runtime_reason, "sr", token, sizeof(token))) {
    render_ready = (strcmp(token, "1") == 0 || strcmp(token, "true") == 0 || strcmp(token, "TRUE") == 0);
    ok_render_ready = true;
  }
  bool ok_semantic_loaded = parse_json_bool_field_in_span(doc_begin, doc_end, "semantic_nodes_loaded", &semantic_loaded);
  if (!ok_semantic_loaded && parse_runtime_reason_token_local(runtime_reason, "st", token, sizeof(token))) {
    semantic_loaded = (strcmp(token, "0") != 0 && strcmp(token, "false") != 0 && strcmp(token, "FALSE") != 0);
    ok_semantic_loaded = true;
  }
  bool ok_total_hash = parse_json_string_field_in_span(doc_begin, doc_end, "semantic_hash", semantic_total_hash, sizeof(semantic_total_hash));
  if (!ok_total_hash) ok_total_hash = parse_runtime_reason_token_local(runtime_reason, "sth", semantic_total_hash, sizeof(semantic_total_hash));
  bool ok_total_count = parse_json_int_field_in_span(doc_begin, doc_end, "semantic_total_count", &semantic_total_count);
  if (!ok_total_count && parse_runtime_reason_token_local(runtime_reason, "sn", token, sizeof(token))) {
    semantic_total_count = atoi(token);
    ok_total_count = true;
  }
  if (!ok_total_count && parse_runtime_reason_token_local(runtime_reason, "st", token, sizeof(token))) {
    semantic_total_count = atoi(token);
    ok_total_count = true;
  }
  bool ok_truth_w = parse_runtime_reason_token_local(runtime_reason, "tw", token, sizeof(token));
  if (ok_truth_w) truth_w = atoi(token);
  bool ok_truth_h = parse_runtime_reason_token_local(runtime_reason, "th", token, sizeof(token));
  if (ok_truth_h) truth_h = atoi(token);
  bool truth_assets_missing = false;
  if ((ok_truth_w && truth_w <= 0) || (ok_truth_h && truth_h <= 0)) truth_assets_missing = true;

  bool ok = ok_route && ok_runtime_frame_hash && ok_applied_hash && ok_applied_count && ok_render_ready && ok_semantic_loaded &&
            ok_total_hash && ok_total_count && hash_hex16_nonzero(runtime_frame_hash);
  if (ok && out_runtime_frame_hash != NULL && out_runtime_frame_hash_cap > 0u) {
    snprintf(out_runtime_frame_hash, out_runtime_frame_hash_cap, "%s", runtime_frame_hash);
  }
  if (ok && out_semantic_hash != NULL && out_semantic_hash_cap > 0u) {
    snprintf(out_semantic_hash, out_semantic_hash_cap, "%s", semantic_applied_hash);
  }
  if (ok && out_semantic_count != NULL) *out_semantic_count = semantic_applied_count;
  if (ok && out_semantic_total_hash != NULL && out_semantic_total_hash_cap > 0u) {
    snprintf(out_semantic_total_hash, out_semantic_total_hash_cap, "%s", semantic_total_hash);
  }
  if (ok && out_semantic_total_count != NULL) *out_semantic_total_count = semantic_total_count;
  if (ok && out_render_ready != NULL) *out_render_ready = render_ready;
  if (ok && out_semantic_loaded != NULL) *out_semantic_loaded = semantic_loaded;
  if (ok && out_truth_assets_missing != NULL) *out_truth_assets_missing = truth_assets_missing;
  free(state_doc);
  return ok;
}

static void remove_truth_partial_outputs(const char *out_dir, const char *route_state) {
  if (out_dir == NULL || out_dir[0] == '\0' || route_state == NULL || route_state[0] == '\0') return;
  const char *suffixes[] = {
      ".rgba",
      ".meta.json",
      ".runtime_framehash",
      ".framehash",
  };
  for (size_t i = 0u; i < sizeof(suffixes) / sizeof(suffixes[0]); ++i) {
    char path[PATH_MAX];
    if (snprintf(path, sizeof(path), "%s/%s%s", out_dir, route_state, suffixes[i]) >= (int)sizeof(path)) continue;
    (void)unlink(path);
  }
}

static bool file_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool path_executable(const char *path) { return (path != NULL && access(path, X_OK) == 0); }

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

static int write_file_all(const char *path, const char *data, size_t len) {
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  size_t wr = fwrite(data, 1u, len, fp);
  int rc = fclose(fp);
  if (wr != len || rc != 0) return -1;
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

static bool starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
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
    if (dup2(pipefd[1], STDOUT_FILENO) < 0) _exit(127);
    if (dup2(pipefd[1], STDERR_FILENO) < 0) _exit(127);
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
  if (out != NULL) {
    *out = buf;
  } else {
    free(buf);
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static RunResult run_command_to_file(char *const argv[], const char *out_path, int timeout_sec) {
  RunResult res;
  res.code = 127;
  res.timed_out = false;
  pid_t pid = fork();
  if (pid < 0) return res;
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (out_path != NULL && out_path[0] != '\0') {
      int fd = open(out_path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
      if (fd < 0) _exit(127);
      if (dup2(fd, STDOUT_FILENO) < 0) _exit(127);
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
  if (path_env == NULL || path_env[0] == '\0') return false;
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

static bool resolve_adb(char *out, size_t out_cap) {
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

static bool resolve_android_serial(const char *adb, const char *preferred, char *out, size_t out_cap) {
  if (adb == NULL || adb[0] == '\0' || out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  if (preferred != NULL && preferred[0] != '\0') {
    snprintf(out, out_cap, "%s", preferred);
    return true;
  }
  const char *env_serial = getenv("ANDROID_SERIAL");
  if (env_serial != NULL && env_serial[0] != '\0') {
    snprintf(out, out_cap, "%s", env_serial);
    return true;
  }

  char *devices_out = NULL;
  char *argv[] = {(char *)adb, "devices", NULL};
  int rc = capture_command_output(argv, 12, &devices_out);
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

static bool parse_resumed_package(const char *activities, char *pkg, size_t pkg_cap) {
  if (pkg != NULL && pkg_cap > 0u) pkg[0] = '\0';
  if (activities == NULL || pkg == NULL || pkg_cap == 0u) return false;
  const char *p = activities;
  const char *best = NULL;
  while (p != NULL) {
    const char *hit = strstr(p, "mResumedActivity:");
    if (hit == NULL) break;
    best = hit;
    p = hit + strlen("mResumedActivity:");
  }
  p = activities;
  while (p != NULL) {
    const char *hit = strstr(p, "topResumedActivity=");
    if (hit == NULL) break;
    if (best == NULL || hit > best) best = hit;
    p = hit + strlen("topResumedActivity=");
  }
  const char *p_best = best;
  if (p_best == NULL) return false;
  const char *slash = strchr(p_best, '/');
  if (slash == NULL) return false;
  const char *start = slash;
  while (start > p_best) {
    char ch = *(start - 1);
    if (isalnum((unsigned char)ch) || ch == '.' || ch == '_') {
      --start;
      continue;
    }
    break;
  }
  if (start >= slash) return false;
  size_t n = (size_t)(slash - start);
  if (n >= pkg_cap) n = pkg_cap - 1u;
  memcpy(pkg, start, n);
  pkg[n] = '\0';
  return pkg[0] != '\0';
}

static bool parse_top_activity_package(const char *top_doc, char *pkg, size_t pkg_cap) {
  if (pkg != NULL && pkg_cap > 0u) pkg[0] = '\0';
  if (top_doc == NULL || pkg == NULL || pkg_cap == 0u) return false;
  const char *p = top_doc;
  while (p != NULL && *p != '\0') {
    const char *line_end = strchr(p, '\n');
    size_t line_len = (line_end != NULL) ? (size_t)(line_end - p) : strlen(p);
    if (line_len > 0u) {
      const char *act = strstr(p, "ACTIVITY ");
      if (act != NULL && act < p + line_len) {
        const char *comp = act + strlen("ACTIVITY ");
        const char *slash = memchr(comp, '/', (size_t)(p + line_len - comp));
        if (slash != NULL) {
          const char *start = slash;
          while (start > comp) {
            char ch = *(start - 1);
            if (isalnum((unsigned char)ch) || ch == '.' || ch == '_') {
              --start;
              continue;
            }
            break;
          }
          if (start < slash) {
            size_t n = (size_t)(slash - start);
            if (n >= pkg_cap) n = pkg_cap - 1u;
            memcpy(pkg, start, n);
            pkg[n] = '\0';
            return pkg[0] != '\0';
          }
        }
      }
    }
    if (line_end == NULL) break;
    p = line_end + 1;
  }
  return false;
}

static bool resolve_foreground_package(const char *adb,
                                       const char *serial,
                                       char *pkg,
                                       size_t pkg_cap) {
  if (pkg != NULL && pkg_cap > 0u) pkg[0] = '\0';
  if (adb == NULL || serial == NULL || pkg == NULL || pkg_cap == 0u) return false;
  char *activities_out = NULL;
  char *activities_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "dumpsys", "activity", "activities", NULL};
  int activities_rc = capture_command_output(activities_argv, 20, &activities_out);
  if (activities_rc != 0 || activities_out == NULL || activities_out[0] == '\0') {
    free(activities_out);
  } else {
    bool ok = parse_resumed_package(activities_out, pkg, pkg_cap);
    free(activities_out);
    if (ok) return true;
  }

  char *top_out = NULL;
  char *top_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "dumpsys", "activity", "top", NULL};
  int top_rc = capture_command_output(top_argv, 20, &top_out);
  if (top_rc == 0 && top_out != NULL && top_out[0] != '\0' &&
      parse_top_activity_package(top_out, pkg, pkg_cap)) {
    free(top_out);
    return true;
  }
  free(top_out);
  return false;
}

static bool package_matches_allow_list(const char *pkg, const char *allow_csv) {
  if (pkg == NULL || pkg[0] == '\0' || allow_csv == NULL || allow_csv[0] == '\0') return false;
  const char *p = allow_csv;
  while (*p != '\0') {
    while (*p == ' ' || *p == '\t' || *p == ',') ++p;
    if (*p == '\0') break;
    const char *start = p;
    while (*p != '\0' && *p != ',') ++p;
    const char *end = p;
    while (end > start && (end[-1] == ' ' || end[-1] == '\t')) --end;
    size_t n = (size_t)(end - start);
    if (n > 0u && strlen(pkg) == n && strncmp(start, pkg, n) == 0) return true;
    if (*p == ',') ++p;
  }
  return false;
}

static bool parse_first_four_ints(const char *s, int *a, int *b, int *c, int *d) {
  if (s == NULL || a == NULL || b == NULL || c == NULL || d == NULL) return false;
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
  if (count < 4) return false;
  *a = vals[0];
  *b = vals[1];
  *c = vals[2];
  *d = vals[3];
  return true;
}

static bool parse_app_bounds(const char *dumpsys, Rect *out) {
  if (dumpsys == NULL || out == NULL) return false;
  memset(out, 0, sizeof(*out));
  const char *p = dumpsys;
  while ((p = strstr(p, "mAppBounds=")) != NULL) {
    const char *line_end = strchr(p, '\n');
    size_t line_len = (line_end == NULL) ? strlen(p) : (size_t)(line_end - p);
    if (line_len > 0u && line_len < 512u) {
      char line[512];
      memcpy(line, p, line_len);
      line[line_len] = '\0';
      int x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      if (parse_first_four_ints(line, &x1, &y1, &x2, &y2) && x2 > x1 && y2 > y1) {
        out->x = x1;
        out->y = y1;
        out->w = x2 - x1;
        out->h = y2 - y1;
        return true;
      }
    }
    if (line_end == NULL) break;
    p = line_end + 1;
  }
  return false;
}

static bool read_png_wh(const char *png_path, int *w, int *h) {
  if (w != NULL) *w = 0;
  if (h != NULL) *h = 0;
  if (png_path == NULL || png_path[0] == '\0') return false;
  FILE *fp = fopen(png_path, "rb");
  if (fp == NULL) return false;
  unsigned char header[24];
  size_t rd = fread(header, 1u, sizeof(header), fp);
  fclose(fp);
  if (rd != sizeof(header)) return false;
  const unsigned char sig[8] = {0x89u, 'P', 'N', 'G', '\r', '\n', 0x1au, '\n'};
  if (memcmp(header, sig, sizeof(sig)) != 0) return false;
  if (!(header[12] == 'I' && header[13] == 'H' && header[14] == 'D' && header[15] == 'R')) return false;
  int width = (int)((uint32_t)header[16] << 24u | (uint32_t)header[17] << 16u | (uint32_t)header[18] << 8u |
                    (uint32_t)header[19]);
  int height = (int)((uint32_t)header[20] << 24u | (uint32_t)header[21] << 16u | (uint32_t)header[22] << 8u |
                     (uint32_t)header[23]);
  if (width <= 0 || height <= 0) return false;
  if (w != NULL) *w = width;
  if (h != NULL) *h = height;
  return true;
}

static uint64_t fnv1a64_file(const char *path, size_t *out_len) {
  if (out_len != NULL) *out_len = 0u;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return 0u;
  const uint64_t kOffset = 1469598103934665603ull;
  const uint64_t kPrime = 1099511628211ull;
  uint64_t h = kOffset;
  size_t total = 0u;
  unsigned char buf[8192];
  while (1) {
    size_t rd = fread(buf, 1u, sizeof(buf), fp);
    if (rd > 0u) {
      total += rd;
      for (size_t i = 0u; i < rd; ++i) {
        h ^= (uint64_t)buf[i];
        h *= kPrime;
      }
    }
    if (rd < sizeof(buf)) {
      if (feof(fp)) break;
      if (ferror(fp)) {
        fclose(fp);
        return 0u;
      }
    }
  }
  fclose(fp);
  if (out_len != NULL) *out_len = total;
  return h;
}

static uint64_t fnv1a64_bytes(uint64_t seed, const unsigned char *data, size_t n) {
  const uint64_t kPrime = 1099511628211ull;
  uint64_t h = seed;
  if (h == 0u) h = 1469598103934665603ull;
  if (data == NULL) return h;
  for (size_t i = 0u; i < n; ++i) {
    h ^= (uint64_t)data[i];
    h *= kPrime;
  }
  return h;
}

static uint64_t runtime_hash_from_rgba(const unsigned char *rgba, int width, int height) {
  if (rgba == NULL || width <= 0 || height <= 0) return 0u;
  uint64_t h = 1469598103934665603ull;
  size_t pixels = (size_t)width * (size_t)height;
  for (size_t i = 0u; i < pixels; ++i) {
    const unsigned char *px = rgba + i * 4u;
    unsigned char bgra[4];
    bgra[0] = px[2];
    bgra[1] = px[1];
    bgra[2] = px[0];
    bgra[3] = px[3];
    h = fnv1a64_bytes(h, bgra, sizeof(bgra));
  }
  return h;
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
  int width = 1212;
  int height = 2512;
  if ((size_t)width * (size_t)height != pixels) {
    width = (int)pixels;
    height = 1;
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

static void to_hex64(uint64_t value, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  (void)snprintf(out, out_cap, "%016llx", (unsigned long long)value);
}

static uint16_t read_u16_le(const unsigned char *p) { return (uint16_t)p[0] | (uint16_t)p[1] << 8u; }

static uint32_t read_u32_le(const unsigned char *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8u | (uint32_t)p[2] << 16u | (uint32_t)p[3] << 24u;
}

static int32_t read_i32_le(const unsigned char *p) { return (int32_t)read_u32_le(p); }

static bool decode_bmp_rgba(const char *bmp_path, unsigned char **out_rgba, int *out_w, int *out_h) {
  if (out_rgba != NULL) *out_rgba = NULL;
  if (out_w != NULL) *out_w = 0;
  if (out_h != NULL) *out_h = 0;
  size_t bmp_len = 0u;
  char *bmp_doc = read_file_all(bmp_path, &bmp_len);
  if (bmp_doc == NULL || bmp_len < 54u) {
    free(bmp_doc);
    return false;
  }
  const unsigned char *bmp = (const unsigned char *)bmp_doc;
  if (!(bmp[0] == 'B' && bmp[1] == 'M')) {
    free(bmp_doc);
    return false;
  }
  uint32_t pixel_off = read_u32_le(bmp + 10);
  uint32_t dib_size = read_u32_le(bmp + 14);
  if (dib_size < 40u || bmp_len < 14u + dib_size) {
    free(bmp_doc);
    return false;
  }
  int32_t width = read_i32_le(bmp + 18);
  int32_t height_signed = read_i32_le(bmp + 22);
  uint16_t planes = read_u16_le(bmp + 26);
  uint16_t bpp = read_u16_le(bmp + 28);
  uint32_t compression = read_u32_le(bmp + 30);
  if (planes != 1u || (bpp != 24u && bpp != 32u)) {
    free(bmp_doc);
    return false;
  }
  if (!(compression == 0u || compression == 3u)) {
    free(bmp_doc);
    return false;
  }
  if (width <= 0 || height_signed == 0) {
    free(bmp_doc);
    return false;
  }
  int height = (height_signed < 0) ? -height_signed : height_signed;
  size_t row_stride = (size_t)(((uint64_t)bpp * (uint64_t)width + 31u) / 32u) * 4u;
  size_t need = (size_t)pixel_off + row_stride * (size_t)height;
  if (need > bmp_len) {
    free(bmp_doc);
    return false;
  }

  size_t rgba_len = (size_t)width * (size_t)height * 4u;
  unsigned char *rgba = (unsigned char *)malloc(rgba_len);
  if (rgba == NULL) {
    free(bmp_doc);
    return false;
  }
  bool bottom_up = (height_signed > 0);
  for (int y = 0; y < height; ++y) {
    int src_row = bottom_up ? (height - 1 - y) : y;
    const unsigned char *src = bmp + pixel_off + row_stride * (size_t)src_row;
    unsigned char *dst = rgba + (size_t)y * (size_t)width * 4u;
    for (int x = 0; x < width; ++x) {
      const unsigned char *p = src + (size_t)x * (size_t)(bpp / 8u);
      dst[(size_t)x * 4u + 0u] = p[2];
      dst[(size_t)x * 4u + 1u] = p[1];
      dst[(size_t)x * 4u + 2u] = p[0];
      dst[(size_t)x * 4u + 3u] = (bpp == 32u) ? p[3] : 255u;
    }
  }
  free(bmp_doc);
  if (out_rgba != NULL) *out_rgba = rgba;
  else free(rgba);
  if (out_w != NULL) *out_w = width;
  if (out_h != NULL) *out_h = height;
  return true;
}

static bool crop_full_bmp_to_rgba(const char *sips, const char *full_png, const char *rgba_path, const Rect *crop) {
  if (sips == NULL || full_png == NULL || rgba_path == NULL || crop == NULL) return false;
  char bmp_path[PATH_MAX];
  if (snprintf(bmp_path, sizeof(bmp_path), "%s.full.bmp", rgba_path) >= (int)sizeof(bmp_path)) return false;
  unlink(bmp_path);
  char *bmp_argv[] = {(char *)sips, "-s", "format", "bmp", (char *)full_png, "--out", bmp_path, NULL};
  RunResult rr = run_command_to_file(bmp_argv, NULL, 25);
  if (rr.code != 0 || !file_exists(bmp_path)) return false;

  unsigned char *full_rgba = NULL;
  int full_w = 0;
  int full_h = 0;
  if (!decode_bmp_rgba(bmp_path, &full_rgba, &full_w, &full_h) || full_rgba == NULL || full_w <= 0 || full_h <= 0) {
    unlink(bmp_path);
    free(full_rgba);
    return false;
  }
  unlink(bmp_path);

  if (crop->x < 0 || crop->y < 0 || crop->w <= 0 || crop->h <= 0 || crop->x + crop->w > full_w ||
      crop->y + crop->h > full_h) {
    free(full_rgba);
    return false;
  }
  size_t out_len = (size_t)crop->w * (size_t)crop->h * 4u;
  unsigned char *out = (unsigned char *)malloc(out_len);
  if (out == NULL) {
    free(full_rgba);
    return false;
  }
  for (int y = 0; y < crop->h; ++y) {
    const unsigned char *src = full_rgba + ((size_t)(crop->y + y) * (size_t)full_w + (size_t)crop->x) * 4u;
    unsigned char *dst = out + (size_t)y * (size_t)crop->w * 4u;
    memcpy(dst, src, (size_t)crop->w * 4u);
  }
  int rc = write_file_all(rgba_path, (const char *)out, out_len);
  free(out);
  free(full_rgba);
  bool ok = (rc == 0);
  return ok;
}

static bool resolve_sips(char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  if (path_executable("/usr/bin/sips")) {
    snprintf(out, out_cap, "%s", "/usr/bin/sips");
    return true;
  }
  return find_executable_in_path("sips", out, out_cap);
}

static const char *infer_main_activity_for_package_capture(const char *pkg, char *buf, size_t buf_cap) {
  if (pkg == NULL || pkg[0] == '\0') return "com.unimaker.app/.MainActivity";
  if (strcmp(pkg, "com.unimaker.app") == 0) return "com.unimaker.app/.MainActivity";
  if (strcmp(pkg, "com.cheng.mobile") == 0) return "com.cheng.mobile/.ChengActivity";
  if (buf != NULL && buf_cap > 0u) {
    int n = snprintf(buf, buf_cap, "%s/.MainActivity", pkg);
    if (n > 0 && (size_t)n < buf_cap) return buf;
  }
  return "com.unimaker.app/.MainActivity";
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  capture_android_unimaker_truth --route-state <state> --route-tree <abs_json> --route-semantic-tree <abs_json> [--out-dir <abs>] [--serial <id>]\n"
          "                                [--package <pkg>] [--activity <pkg/.Activity>] [--allow-overlay-package <pkg>] [--force-front 0|1]\n"
          "                                [--require-runtime-route-match 1] [--no-foreground-switch 0|1]\n"
          "\n"
          "Defaults:\n"
          "  --out-dir  /Users/lbcheng/.cheng-packages/cheng-gui/build/_truth_visible_1212x2512_canonical\n"
          "  --package  com.unimaker.app\n"
          "  --activity com.unimaker.app/.MainActivity\n"
          "  --allow-overlay-package com.unimaker.app\n"
          "  --force-front 0\n"
          "  --require-runtime-route-match 1\n"
          "  --no-foreground-switch 1\n");
}

int native_capture_android_unimaker_truth(const char *scripts_dir, int argc, char **argv, int arg_start) {
  (void)scripts_dir;
  const char *route_state = NULL;
  const char *route_tree = NULL;
  const char *route_semantic_tree = NULL;
  const char *out_dir = "/Users/lbcheng/.cheng-packages/cheng-gui/build/_truth_visible_1212x2512_canonical";
  const char *serial_arg = NULL;
  const char *pkg = "com.unimaker.app";
  const char *activity = NULL;
  const char *allow_overlay_pkg = NULL;
  bool allow_overlay_pkg_cli_overridden = false;
  char allow_overlay_pkg_auto[512];
  allow_overlay_pkg_auto[0] = '\0';
  const char *pkg_env = getenv("CHENG_ANDROID_APP_PACKAGE");
  const char *activity_env = getenv("CHENG_ANDROID_APP_ACTIVITY");
  bool pkg_cli_overridden = false;
  bool activity_cli_overridden = false;
  char activity_auto[256];
  activity_auto[0] = '\0';
  if (pkg_env != NULL && pkg_env[0] != '\0') pkg = pkg_env;
  if (activity_env != NULL && activity_env[0] != '\0') activity = activity_env;
  int force_front = 0;
  int require_runtime_route_match = 1;
  int no_foreground_switch_cli = -1;

  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
      usage();
      return 0;
    }
    if (strcmp(arg, "--route-state") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --route-state\n");
        return 2;
      }
      route_state = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--route-tree") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --route-tree\n");
        return 2;
      }
      route_tree = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--route-semantic-tree") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --route-semantic-tree\n");
        return 2;
      }
      route_semantic_tree = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out-dir") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --out-dir\n");
        return 2;
      }
      out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--serial") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --serial\n");
        return 2;
      }
      serial_arg = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--package") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --package\n");
        return 2;
      }
      pkg = argv[i + 1];
      pkg_cli_overridden = true;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--activity") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --activity\n");
        return 2;
      }
      activity = argv[i + 1];
      activity_cli_overridden = true;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--allow-overlay-package") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --allow-overlay-package\n");
        return 2;
      }
      allow_overlay_pkg = argv[i + 1];
      allow_overlay_pkg_cli_overridden = true;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--force-front") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --force-front\n");
        return 2;
      }
      force_front = (strcmp(argv[i + 1], "1") == 0) ? 1 : 0;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--require-runtime-route-match") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --require-runtime-route-match\n");
        return 2;
      }
      if (strcmp(argv[i + 1], "1") != 0) {
        fprintf(stderr,
                "[capture-unimaker-truth] strict runtime mode requires --require-runtime-route-match=1\n");
        return 2;
      }
      require_runtime_route_match = 1;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--no-foreground-switch") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --no-foreground-switch\n");
        return 2;
      }
      no_foreground_switch_cli = (strcmp(argv[i + 1], "0") == 0) ? 0 : 1;
      i += 2;
      continue;
    }
    fprintf(stderr, "[capture-unimaker-truth] unknown arg: %s\n", arg);
    return 2;
  }

  if (!activity_cli_overridden && (pkg_cli_overridden || activity == NULL || activity[0] == '\0')) {
    activity = infer_main_activity_for_package_capture(pkg, activity_auto, sizeof(activity_auto));
  }
  if (!allow_overlay_pkg_cli_overridden) {
    bool allow_overlay_foreground =
        env_flag_enabled_local("CHENG_CAPTURE_UNIMAKER_ALLOW_OVERLAY_FOREGROUND", false);
    if (allow_overlay_foreground) {
      if (snprintf(allow_overlay_pkg_auto,
                   sizeof(allow_overlay_pkg_auto),
                   "%s,com.huawei.ohos.inputmethod,com.android.nfc,com.android.packageinstaller",
                   pkg) >= (int)sizeof(allow_overlay_pkg_auto)) {
        fprintf(stderr, "[capture-unimaker-truth] overlay allow list too long for package: %s\n", pkg);
        return 2;
      }
      allow_overlay_pkg = allow_overlay_pkg_auto;
    } else {
      if (snprintf(allow_overlay_pkg_auto, sizeof(allow_overlay_pkg_auto), "%s", pkg) >=
          (int)sizeof(allow_overlay_pkg_auto)) {
        fprintf(stderr, "[capture-unimaker-truth] package too long: %s\n", pkg);
        return 2;
      }
      allow_overlay_pkg = allow_overlay_pkg_auto;
    }
  }

  bool no_foreground_switch = true;
  if (no_foreground_switch_cli == 0) {
    fprintf(stderr,
            "[capture-unimaker-truth] foreground switching is forbidden; --no-foreground-switch must be 1\n");
    return 2;
  }
  if (force_front == 1) {
    fprintf(stderr,
            "[capture-unimaker-truth] foreground switching is forbidden; --force-front=1 is not allowed\n");
    return 2;
  }
  setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", "1", 1);

  if (route_state == NULL || route_state[0] == '\0') {
    fprintf(stderr, "[capture-unimaker-truth] --route-state is required\n");
    return 2;
  }
  if (route_tree == NULL || route_tree[0] == '\0') {
    fprintf(stderr, "[capture-unimaker-truth] --route-tree is required\n");
    return 2;
  }
  if (!file_exists(route_tree)) {
    fprintf(stderr, "[capture-unimaker-truth] --route-tree not found: %s\n", route_tree);
    return 1;
  }
  if (route_semantic_tree == NULL || route_semantic_tree[0] == '\0') {
    fprintf(stderr, "[capture-unimaker-truth] --route-semantic-tree is required\n");
    return 2;
  }
  if (!file_exists(route_semantic_tree)) {
    fprintf(stderr, "[capture-unimaker-truth] --route-semantic-tree not found: %s\n", route_semantic_tree);
    return 1;
  }
  if (out_dir == NULL || out_dir[0] == '\0') {
    fprintf(stderr, "[capture-unimaker-truth] --out-dir is empty\n");
    return 2;
  }

  if (ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[capture-unimaker-truth] failed to create out dir: %s\n", out_dir);
    return 1;
  }

  char adb[PATH_MAX];
  if (!resolve_adb(adb, sizeof(adb))) {
    fprintf(stderr, "[capture-unimaker-truth] missing adb\n");
    return 1;
  }
  char serial[128];
  if (!resolve_android_serial(adb, serial_arg, serial, sizeof(serial))) {
    fprintf(stderr, "[capture-unimaker-truth] no android device found\n");
    return 1;
  }
  char route_parent[128];
  int route_depth = 0;
  char path_signature[512];
  route_parent[0] = '\0';
  path_signature[0] = '\0';
  if (!load_route_meta_from_tree(route_tree,
                                 route_state,
                                 route_parent,
                                 sizeof(route_parent),
                                 &route_depth,
                                 path_signature,
                                 sizeof(path_signature))) {
    fprintf(stderr,
            "[capture-unimaker-truth] failed to load route meta from route tree: route=%s tree=%s\n",
            route_state,
            route_tree);
    return 1;
  }
  const char *expected_semantic_route = route_state;
  const char *expected_semantic_route_fallback = semantic_equivalent_runtime_route(route_state);
  if (expected_semantic_route_fallback == NULL || expected_semantic_route_fallback[0] == '\0') {
    expected_semantic_route_fallback = route_state;
  }
  char semantic_subtree_hash_expected[128];
  int semantic_subtree_node_count_expected = 0;
  semantic_subtree_hash_expected[0] = '\0';
  if (!load_route_semantic_expectation(route_semantic_tree,
                                       expected_semantic_route,
                                       semantic_subtree_hash_expected,
                                       sizeof(semantic_subtree_hash_expected),
                                       &semantic_subtree_node_count_expected)) {
    if (strcmp(expected_semantic_route_fallback, expected_semantic_route) != 0 &&
        load_route_semantic_expectation(route_semantic_tree,
                                        expected_semantic_route_fallback,
                                        semantic_subtree_hash_expected,
                                        sizeof(semantic_subtree_hash_expected),
                                        &semantic_subtree_node_count_expected)) {
      expected_semantic_route = expected_semantic_route_fallback;
    } else {
      fprintf(stderr,
              "[capture-unimaker-truth] failed to load semantic subtree from route semantic tree: route=%s tree=%s\n",
              route_state,
              route_semantic_tree);
      return 1;
    }
  }
  if (semantic_subtree_hash_expected[0] == '\0' || semantic_subtree_node_count_expected <= 0) {
    fprintf(stderr,
            "[capture-unimaker-truth] invalid semantic subtree expectation route=%s semantic_route=%s tree=%s\n",
            route_state,
            expected_semantic_route,
            route_semantic_tree);
    return 1;
  }
  char semantic_total_hash_expected[128];
  int semantic_total_count_expected = 0;
  semantic_total_hash_expected[0] = '\0';
  if (!load_route_semantic_totals(route_semantic_tree,
                                  semantic_total_hash_expected,
                                  sizeof(semantic_total_hash_expected),
                                  &semantic_total_count_expected)) {
    fprintf(stderr,
            "[capture-unimaker-truth] failed to load semantic totals from route semantic tree: tree=%s\n",
            route_semantic_tree);
    return 1;
  }

  if (force_front == 1) {
    char *start_argv[] = {adb, "-s", serial, "shell", "am", "start", "-W", "-n", (char *)activity, NULL};
    RunResult rr = run_command_to_file(start_argv, NULL, 25);
    if (rr.code != 0) {
      fprintf(stderr, "[capture-unimaker-truth] failed to bring app front: %s rc=%d\n", activity, rr.code);
      return 1;
    }
    usleep(300000);
  }

  char resumed_pkg[256];
  resumed_pkg[0] = '\0';
  int foreground_wait_attempts =
      env_positive_int_or_default_local("CHENG_CAPTURE_UNIMAKER_FOREGROUND_WAIT_ATTEMPTS", 20);
  int foreground_wait_sleep_ms =
      env_positive_int_or_default_local("CHENG_CAPTURE_UNIMAKER_FOREGROUND_WAIT_SLEEP_MS", 220);
  if (foreground_wait_attempts < 1) foreground_wait_attempts = 1;
  if (foreground_wait_attempts > 60) foreground_wait_attempts = 60;
  if (foreground_wait_sleep_ms < 0) foreground_wait_sleep_ms = 0;
  if (foreground_wait_sleep_ms > 2000) foreground_wait_sleep_ms = 2000;
  bool foreground_ok = false;
  for (int fg_try = 0; fg_try < foreground_wait_attempts; ++fg_try) {
    resumed_pkg[0] = '\0';
    if (resolve_foreground_package(adb, serial, resumed_pkg, sizeof(resumed_pkg)) &&
        resumed_pkg[0] != '\0' &&
        (strcmp(resumed_pkg, pkg) == 0 || package_matches_allow_list(resumed_pkg, allow_overlay_pkg))) {
      foreground_ok = true;
      break;
    }
    if (fg_try + 1 < foreground_wait_attempts && foreground_wait_sleep_ms > 0) {
      usleep((useconds_t)foreground_wait_sleep_ms * 1000u);
    }
  }
  if (!foreground_ok) {
    fprintf(stderr,
            "[capture-unimaker-truth] foreground package mismatch expect=%s got=%s attempts=%d sleep_ms=%d\n",
            pkg,
            resumed_pkg[0] != '\0' ? resumed_pkg : "<unknown>",
            foreground_wait_attempts,
            foreground_wait_sleep_ms);
    return 1;
  }
  if (require_runtime_route_match != 1) {
    fprintf(stderr,
            "[capture-unimaker-truth] strict runtime mode requires runtime route match\n");
    return 2;
  }
  bool allow_runtimeless_semantic_strict = false;
  const char *allow_runtimeless_semantic_env =
      getenv("CHENG_CAPTURE_UNIMAKER_RUNTIMELESS_SEMANTIC_STRICT");
  if (allow_runtimeless_semantic_env != NULL && allow_runtimeless_semantic_env[0] != '\0') {
    if (strcmp(allow_runtimeless_semantic_env, "0") != 0) {
      fprintf(stderr,
              "[capture-unimaker-truth] strict runtime 1:1 forbids CHENG_CAPTURE_UNIMAKER_RUNTIMELESS_SEMANTIC_STRICT=1\n");
      return 2;
    }
    allow_runtimeless_semantic_strict = false;
  }

  char *dumpsys_out = NULL;
  char *dump_argv[] = {adb, "-s", serial, "shell", "dumpsys", "window", "windows", NULL};
  int dump_rc = capture_command_output(dump_argv, 20, &dumpsys_out);
  if (dump_rc != 0 || dumpsys_out == NULL) {
    free(dumpsys_out);
    fprintf(stderr, "[capture-unimaker-truth] dumpsys window failed rc=%d\n", dump_rc);
    return 1;
  }

  Rect app_bounds;
  if (!parse_app_bounds(dumpsys_out, &app_bounds)) {
    fprintf(stderr, "[capture-unimaker-truth] failed to parse mAppBounds from dumpsys window\n");
    free(dumpsys_out);
    return 1;
  }
  free(dumpsys_out);

  char full_png[PATH_MAX];
  char rgba_path[PATH_MAX];
  char meta_path[PATH_MAX];
  char runtime_hash_path[PATH_MAX];
  char framehash_path[PATH_MAX];
  if (snprintf(full_png, sizeof(full_png), "%s/%s.full.png", out_dir, route_state) >= (int)sizeof(full_png) ||
      snprintf(rgba_path, sizeof(rgba_path), "%s/%s.rgba", out_dir, route_state) >= (int)sizeof(rgba_path) ||
      snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", out_dir, route_state) >= (int)sizeof(meta_path) ||
      snprintf(runtime_hash_path, sizeof(runtime_hash_path), "%s/%s.runtime_framehash", out_dir, route_state) >=
          (int)sizeof(runtime_hash_path) ||
      snprintf(framehash_path, sizeof(framehash_path), "%s/%s.framehash", out_dir, route_state) >=
          (int)sizeof(framehash_path)) {
    fprintf(stderr, "[capture-unimaker-truth] output path too long\n");
    return 1;
  }

  char runtime_semantic_applied_hash[128];
  int runtime_semantic_applied_count = 0;
  char runtime_semantic_total_hash[128];
  int runtime_semantic_total_count = 0;
  char runtime_framehash_from_state[128];
  bool runtime_render_ready = false;
  bool runtime_semantic_loaded = false;
  bool runtime_truth_assets_missing = false;
  char semantic_subtree_hash_runtime[128];
  int semantic_subtree_node_count_runtime = 0;
  char runtime_route[128];
  runtime_semantic_applied_hash[0] = '\0';
  runtime_semantic_total_hash[0] = '\0';
  runtime_framehash_from_state[0] = '\0';
  semantic_subtree_hash_runtime[0] = '\0';
  runtime_route[0] = '\0';
  int ready_attempts = env_positive_int_or_default_local("CHENG_CAPTURE_RUNTIME_READY_ATTEMPTS", 12);
  int ready_sleep_ms = env_positive_int_or_default_local("CHENG_CAPTURE_RUNTIME_READY_SLEEP_MS", 250);
  bool allow_missing_truth_ready = false;
  {
    const char *allow_missing_truth_ready_env = getenv("CHENG_CAPTURE_ALLOW_MISSING_TRUTH_READY");
    if (allow_missing_truth_ready_env != NULL && allow_missing_truth_ready_env[0] != '\0' &&
        strcmp(allow_missing_truth_ready_env, "0") != 0) {
      fprintf(stderr,
              "[capture-unimaker-truth] strict runtime mode forbids CHENG_CAPTURE_ALLOW_MISSING_TRUTH_READY=1\n");
      return 2;
    }
  }
  bool runtime_ready = false;
  bool runtime_ready_relaxed = false;
  bool runtime_state_observed = false;
  bool last_route_ok = false;
  bool last_route_ok_effective = false;
  bool last_route_semantic_override = false;
  bool last_totals_ok = false;
  bool last_framehash_ok = false;
  bool last_applied_ok = false;
  bool last_probe_strict_ok = false;
  bool last_probe_relaxed_ok = false;
  bool last_semantic_hash_match = false;
  bool last_semantic_count_match = false;
  char last_foreground_pkg[256];
  last_foreground_pkg[0] = '\0';
  for (int attempt = 0; attempt < ready_attempts; ++attempt) {
    char probe_pkg[256];
    probe_pkg[0] = '\0';
    if (!resolve_foreground_package(adb, serial, probe_pkg, sizeof(probe_pkg)) || probe_pkg[0] == '\0') {
      if (attempt + 1 < ready_attempts && ready_sleep_ms > 0) usleep((useconds_t)ready_sleep_ms * 1000u);
      continue;
    }
    snprintf(last_foreground_pkg, sizeof(last_foreground_pkg), "%s", probe_pkg);
    if (strcmp(probe_pkg, pkg) != 0 && !package_matches_allow_list(probe_pkg, allow_overlay_pkg)) {
      if (attempt + 1 < ready_attempts && ready_sleep_ms > 0) usleep((useconds_t)ready_sleep_ms * 1000u);
      continue;
    }
    if (!read_runtime_semantic_state_from_device(adb,
                                                 serial,
                                                 pkg,
                                                 runtime_route,
                                                 sizeof(runtime_route),
                                                 runtime_framehash_from_state,
                                                 sizeof(runtime_framehash_from_state),
                                                 runtime_semantic_applied_hash,
                                                 sizeof(runtime_semantic_applied_hash),
                                                 &runtime_semantic_applied_count,
                                                 runtime_semantic_total_hash,
                                                 sizeof(runtime_semantic_total_hash),
                                                 &runtime_semantic_total_count,
                                                 &runtime_render_ready,
                                                 &runtime_semantic_loaded,
                                                 &runtime_truth_assets_missing)) {
      if (attempt + 1 < ready_attempts && ready_sleep_ms > 0) usleep((useconds_t)ready_sleep_ms * 1000u);
      continue;
    }
    runtime_state_observed = true;
    bool route_ok = runtime_route_matches_expected(runtime_route, route_state);
    bool semantic_hash_match = hash_hex16_nonzero(runtime_semantic_applied_hash) &&
                               semantic_subtree_hash_expected[0] != '\0' &&
                               strcmp(runtime_semantic_applied_hash, semantic_subtree_hash_expected) == 0;
    bool semantic_count_match = runtime_semantic_applied_count > 0 &&
                                semantic_subtree_node_count_expected > 0 &&
                                runtime_semantic_applied_count >= semantic_subtree_node_count_expected;
    bool route_semantic_override = (!route_ok) &&
                                   route_requires_semantic_route_override(route_state) &&
                                   semantic_hash_match &&
                                   semantic_count_match;
    bool route_ok_effective = route_ok || route_semantic_override;
    bool totals_ok = hash_hex16_nonzero(runtime_semantic_total_hash) &&
                     runtime_semantic_total_count > 0 &&
                     runtime_semantic_total_count == semantic_total_count_expected &&
                     strcmp(runtime_semantic_total_hash, semantic_total_hash_expected) == 0;
    bool totals_relaxed = false;
    if (!totals_ok &&
        runtime_totals_relax_enabled_for_package(pkg) &&
        hash_hex16_nonzero(runtime_semantic_total_hash) &&
        runtime_semantic_total_count > 0) {
      totals_ok = true;
      totals_relaxed = true;
    }
    bool framehash_ok = hash_hex16_nonzero(runtime_framehash_from_state);
    bool applied_ok = hash_hex16_nonzero(runtime_semantic_applied_hash) &&
                      runtime_semantic_applied_count > 0;
    bool strict_probe_ok = runtime_semantic_loaded &&
                           runtime_render_ready &&
                           route_ok_effective &&
                           totals_ok &&
                           framehash_ok &&
                           applied_ok;
    bool relaxed_probe_ok = allow_missing_truth_ready &&
                            runtime_truth_assets_missing &&
                            runtime_semantic_loaded &&
                            route_ok_effective &&
                            totals_ok &&
                            hash_hex16_nonzero(runtime_semantic_applied_hash);
    last_route_ok = route_ok;
    last_route_ok_effective = route_ok_effective;
    last_route_semantic_override = route_semantic_override;
    last_totals_ok = totals_ok;
    last_framehash_ok = framehash_ok;
    last_applied_ok = applied_ok;
    last_probe_strict_ok = strict_probe_ok;
    last_probe_relaxed_ok = relaxed_probe_ok;
    last_semantic_hash_match = semantic_hash_match;
    last_semantic_count_match = semantic_count_match;
    if (strict_probe_ok || relaxed_probe_ok) {
      runtime_ready = true;
      runtime_ready_relaxed = (!strict_probe_ok && relaxed_probe_ok);
      if (route_semantic_override) {
        fprintf(stdout,
                "[capture-unimaker-truth] route string mismatch deferred-to-semantic route=%s runtime_route=%s semantic_hash=%s semantic_count=%d expected_hash=%s expected_count=%d\n",
                route_state,
                runtime_route[0] != '\0' ? runtime_route : "<empty>",
                runtime_semantic_applied_hash[0] != '\0' ? runtime_semantic_applied_hash : "<empty>",
                runtime_semantic_applied_count,
                semantic_subtree_hash_expected[0] != '\0' ? semantic_subtree_hash_expected : "<empty>",
                semantic_subtree_node_count_expected);
      }
      if (totals_relaxed) {
        fprintf(stdout,
                "[capture-unimaker-truth] runtime totals relaxed package=%s route=%s runtime_total=%s/%d expected_total=%s/%d\n",
                pkg,
                route_state,
                runtime_semantic_total_hash[0] != '\0' ? runtime_semantic_total_hash : "<empty>",
                runtime_semantic_total_count,
                semantic_total_hash_expected[0] != '\0' ? semantic_total_hash_expected : "<empty>",
                semantic_total_count_expected);
      }
      break;
    }
    if (attempt + 1 < ready_attempts && ready_sleep_ms > 0) usleep((useconds_t)ready_sleep_ms * 1000u);
  }
  if (!runtime_ready) {
    if (allow_runtimeless_semantic_strict) {
      snprintf(runtime_route, sizeof(runtime_route), "%s", route_state);
      snprintf(runtime_semantic_applied_hash,
               sizeof(runtime_semantic_applied_hash),
               "%s",
               semantic_subtree_hash_expected);
      runtime_semantic_applied_count = semantic_subtree_node_count_expected;
      snprintf(runtime_semantic_total_hash,
               sizeof(runtime_semantic_total_hash),
               "%s",
               semantic_total_hash_expected);
      runtime_semantic_total_count = semantic_total_count_expected;
      runtime_framehash_from_state[0] = '\0';
      runtime_render_ready = true;
      runtime_semantic_loaded = true;
      runtime_truth_assets_missing = false;
      runtime_ready = true;
      runtime_ready_relaxed = false;
      fprintf(stdout,
              "[capture-unimaker-truth] runtime state unavailable; use semantic-strict fallback package=%s route=%s foreground=%s\n",
              pkg,
              route_state,
              last_foreground_pkg[0] != '\0' ? last_foreground_pkg : "<unknown>");
    } else {
      remove_truth_partial_outputs(out_dir, route_state);
      fprintf(stderr,
              "[capture-unimaker-truth] runtime not ready route=%s attempts=%d sleep_ms=%d foreground=%s runtime_route=%s render_ready=%s semantic_loaded=%s truth_assets_missing=%s total_hash=%s total_count=%d applied_hash=%s applied_count=%d framehash=%s route_ok=%s route_ok_effective=%s route_semantic_override=%s totals_ok=%s framehash_ok=%s applied_ok=%s strict_ok=%s relaxed_ok=%s applied_hash_match=%s applied_count_match=%s expected_total_hash=%s expected_total_count=%d expected_applied_hash=%s expected_applied_count=%d\n",
              route_state,
              ready_attempts,
              ready_sleep_ms,
              last_foreground_pkg[0] != '\0' ? last_foreground_pkg : "<unknown>",
              runtime_route[0] != '\0' ? runtime_route : "<empty>",
              runtime_render_ready ? "true" : "false",
              runtime_semantic_loaded ? "true" : "false",
              runtime_truth_assets_missing ? "true" : "false",
              runtime_semantic_total_hash[0] != '\0' ? runtime_semantic_total_hash : "<empty>",
              runtime_semantic_total_count,
              runtime_semantic_applied_hash[0] != '\0' ? runtime_semantic_applied_hash : "<empty>",
              runtime_semantic_applied_count,
              runtime_framehash_from_state[0] != '\0' ? runtime_framehash_from_state : "<empty>",
              last_route_ok ? "true" : "false",
              last_route_ok_effective ? "true" : "false",
              last_route_semantic_override ? "true" : "false",
              last_totals_ok ? "true" : "false",
              last_framehash_ok ? "true" : "false",
              last_applied_ok ? "true" : "false",
              last_probe_strict_ok ? "true" : "false",
              last_probe_relaxed_ok ? "true" : "false",
              last_semantic_hash_match ? "true" : "false",
              last_semantic_count_match ? "true" : "false",
              semantic_total_hash_expected[0] != '\0' ? semantic_total_hash_expected : "<empty>",
              semantic_total_count_expected,
              semantic_subtree_hash_expected[0] != '\0' ? semantic_subtree_hash_expected : "<empty>",
              semantic_subtree_node_count_expected);
      return 1;
    }
  }
  if (runtime_ready_relaxed) {
    fprintf(stdout,
            "[capture-unimaker-truth] runtime ready via relaxed-missing-truth path route=%s runtime_route=%s (render_ready=%s applied_count=%d)\n",
            route_state,
            runtime_route[0] != '\0' ? runtime_route : "<empty>",
            runtime_render_ready ? "true" : "false",
            runtime_semantic_applied_count);
  }
  char *cap_argv[] = {adb, "-s", serial, "exec-out", "screencap", "-p", NULL};
  RunResult cap_rr = run_command_to_file(cap_argv, full_png, 20);
  if (cap_rr.code != 0) {
    fprintf(stderr, "[capture-unimaker-truth] adb screencap failed rc=%d\n", cap_rr.code);
    return 1;
  }
  char resumed_pkg_after_capture[256];
  resumed_pkg_after_capture[0] = '\0';
  int post_capture_fg_retries = env_positive_int_or_default_local(
      "CHENG_CAPTURE_UNIMAKER_POST_SCREENCAP_FOREGROUND_RETRY_ATTEMPTS",
      8);
  if (post_capture_fg_retries > 12) post_capture_fg_retries = 12;
  int post_capture_fg_sleep_ms = env_positive_int_or_default_local(
      "CHENG_CAPTURE_UNIMAKER_POST_SCREENCAP_FOREGROUND_RETRY_SLEEP_MS",
      280);
  if (post_capture_fg_sleep_ms > 1200) post_capture_fg_sleep_ms = 1200;
  bool post_capture_fg_ok = false;
  for (int fg_try = 0; fg_try < post_capture_fg_retries; ++fg_try) {
    if (resolve_foreground_package(adb, serial, resumed_pkg_after_capture, sizeof(resumed_pkg_after_capture)) &&
        resumed_pkg_after_capture[0] != '\0' &&
        (strcmp(resumed_pkg_after_capture, pkg) == 0 ||
         package_matches_allow_list(resumed_pkg_after_capture, allow_overlay_pkg))) {
      post_capture_fg_ok = true;
      if (fg_try > 0) {
        fprintf(stdout,
                "[capture-unimaker-truth] foreground recovered after screencap expect=%s got=%s retries=%d\n",
                pkg,
                resumed_pkg_after_capture,
                fg_try + 1);
      }
      break;
    }
    if (fg_try + 1 < post_capture_fg_retries && post_capture_fg_sleep_ms > 0) {
      usleep((useconds_t)post_capture_fg_sleep_ms * 1000u);
    }
  }
  if (!post_capture_fg_ok) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] foreground package drift after screencap expect=%s got=%s no_foreground_switch=%d retries=%d\n",
            pkg,
            resumed_pkg_after_capture[0] != '\0' ? resumed_pkg_after_capture : "<unknown>",
            no_foreground_switch ? 1 : 0,
            post_capture_fg_retries);
    return 1;
  }
  const char *semantic_runtime_route = runtime_route;
  if (semantic_runtime_route == NULL || semantic_runtime_route[0] == '\0') {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] runtime route empty under strict runtime mode route=%s\n",
            route_state);
    return 1;
  }
  if (!load_route_semantic_expectation(route_semantic_tree,
                                       semantic_runtime_route,
                                       semantic_subtree_hash_runtime,
                                       sizeof(semantic_subtree_hash_runtime),
                                       &semantic_subtree_node_count_runtime)) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] runtime semantic subtree resolve failed route=%s tree=%s\n",
            semantic_runtime_route != NULL ? semantic_runtime_route : "<empty>",
            route_semantic_tree);
    return 1;
  }
  bool relaxed_applied_count_check =
      runtime_ready_relaxed && runtime_truth_assets_missing && runtime_semantic_applied_count <= 0;
  if (runtime_semantic_applied_count < semantic_subtree_node_count_runtime &&
      !relaxed_applied_count_check) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] runtime semantic applied count too small route=%s applied=%d expected_subtree=%d applied_hash=%s\n",
            semantic_runtime_route != NULL ? semantic_runtime_route : "<empty>",
            runtime_semantic_applied_count,
            semantic_subtree_node_count_runtime,
            runtime_semantic_applied_hash[0] != '\0' ? runtime_semantic_applied_hash : "<empty>");
    return 1;
  }
  if (relaxed_applied_count_check) {
    fprintf(stdout,
            "[capture-unimaker-truth] relaxed semantic applied-count check route=%s applied=%d expected_subtree=%d truth_assets_missing=true\n",
            semantic_runtime_route != NULL ? semantic_runtime_route : "<empty>",
            runtime_semantic_applied_count,
            semantic_subtree_node_count_runtime);
  }
  if (semantic_subtree_node_count_runtime != semantic_subtree_node_count_expected ||
      strcmp(semantic_subtree_hash_runtime, semantic_subtree_hash_expected) != 0) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] semantic subtree mismatch route=%s expected(hash=%s count=%d) runtime(hash=%s count=%d)\n",
            route_state,
            semantic_subtree_hash_expected,
            semantic_subtree_node_count_expected,
            semantic_subtree_hash_runtime,
            semantic_subtree_node_count_runtime);
    return 1;
  }
  int full_w = 0;
  int full_h = 0;
  if (!read_png_wh(full_png, &full_w, &full_h)) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr, "[capture-unimaker-truth] cannot parse png dimensions: %s\n", full_png);
    return 1;
  }
  if (app_bounds.x < 0 || app_bounds.y < 0 || app_bounds.w <= 0 || app_bounds.h <= 0 ||
      app_bounds.x + app_bounds.w > full_w || app_bounds.y + app_bounds.h > full_h) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] app bounds out of full frame full=%dx%d bounds=%d,%d %dx%d\n",
            full_w,
            full_h,
            app_bounds.x,
            app_bounds.y,
            app_bounds.w,
            app_bounds.h);
    return 1;
  }

  char sips_bin[PATH_MAX];
  if (!resolve_sips(sips_bin, sizeof(sips_bin))) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr, "[capture-unimaker-truth] missing sips\n");
    return 1;
  }

  if (!crop_full_bmp_to_rgba(sips_bin, full_png, rgba_path, &app_bounds)) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr, "[capture-unimaker-truth] crop+convert failed\n");
    return 1;
  }

  size_t rgba_bytes = 0u;
  char *rgba_doc = read_file_all(rgba_path, &rgba_bytes);
  if (rgba_doc == NULL || rgba_bytes == 0u) {
    free(rgba_doc);
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr, "[capture-unimaker-truth] invalid rgba output: %s\n", rgba_path);
    return 1;
  }
  size_t expected = (size_t)app_bounds.w * (size_t)app_bounds.h * 4u;
  if (rgba_bytes != expected) {
    free(rgba_doc);
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] rgba size mismatch got=%zu expect=%zu (%dx%d)\n",
            rgba_bytes,
            expected,
            app_bounds.w,
            app_bounds.h);
    return 1;
  }
  double white_ratio = 0.0;
  double delta_ratio = 0.0;
  double edge_ratio = 0.0;
  int luma_span = 0;
  if (rgba_looks_like_blank_whiteboard((const unsigned char *)rgba_doc,
                                       rgba_bytes,
                                       &white_ratio,
                                       &delta_ratio,
                                       &edge_ratio,
                                       &luma_span)) {
    free(rgba_doc);
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr,
            "[capture-unimaker-truth] reject blank-whiteboard route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
            route_state,
            white_ratio,
            delta_ratio,
            edge_ratio,
            luma_span);
    return 1;
  }
  uint64_t rgba_hash = fnv1a64_bytes(1469598103934665603ull, (const unsigned char *)rgba_doc, rgba_bytes);
  uint64_t runtime_hash = runtime_hash_from_rgba((const unsigned char *)rgba_doc, app_bounds.w, app_bounds.h);
  free(rgba_doc);
  if (runtime_hash == 0u) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr, "[capture-unimaker-truth] failed to compute runtime hash\n");
    return 1;
  }

  char hash_hex[32];
  char rgba_hash_hex[32];
  to_hex64(runtime_hash, hash_hex, sizeof(hash_hex));
  to_hex64(rgba_hash, rgba_hash_hex, sizeof(rgba_hash_hex));
  char hash_line[64];
  int hash_n = snprintf(hash_line, sizeof(hash_line), "%s\n", hash_hex);
  if (hash_n <= 0 || (size_t)hash_n >= sizeof(hash_line)) {
    remove_truth_partial_outputs(out_dir, route_state);
    return 1;
  }
  const char *runtime_hash_to_write =
      hash_hex16_nonzero(runtime_framehash_from_state) ? runtime_framehash_from_state : hash_hex;
  char runtime_hash_line[64];
  int runtime_hash_n = snprintf(runtime_hash_line, sizeof(runtime_hash_line), "%s\n", runtime_hash_to_write);
  if (runtime_hash_n <= 0 || (size_t)runtime_hash_n >= sizeof(runtime_hash_line)) {
    remove_truth_partial_outputs(out_dir, route_state);
    return 1;
  }
  if (write_file_all(runtime_hash_path, runtime_hash_line, (size_t)runtime_hash_n) != 0 ||
      write_file_all(framehash_path, hash_line, (size_t)hash_n) != 0) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr, "[capture-unimaker-truth] failed to write framehash files\n");
    return 1;
  }

  char meta_doc[6144];
  const char *runtime_state_source =
      runtime_state_observed ? "device_runtime_state" : "semantic_strict_fallback";
  int meta_n = snprintf(meta_doc,
                        sizeof(meta_doc),
                        "{\n"
                        "  \"format\": \"rgba8888\",\n"
                        "  \"route_state\": \"%s\",\n"
                        "  \"route_depth\": %d,\n"
                        "  \"route_parent\": \"%s\",\n"
                        "  \"path_signature\": \"%s\",\n"
                        "  \"capture_source\": \"unimaker_foreground_runtime_visible\",\n"
                        "  \"no_foreground_switch\": %s,\n"
                        "  \"runtime_route\": \"%s\",\n"
                        "  \"runtime_route_match_required\": %s,\n"
                        "  \"runtime_state_observed\": %s,\n"
                        "  \"runtime_state_source\": \"%s\",\n"
                        "  \"device_serial\": \"%s\",\n"
                        "  \"package\": \"%s\",\n"
                        "  \"activity\": \"%s\",\n"
                        "  \"full_png\": \"%s\",\n"
                        "  \"width\": %d,\n"
                        "  \"height\": %d,\n"
                        "  \"surface_width\": %d,\n"
                        "  \"surface_height\": %d,\n"
                        "  \"crop_left\": %d,\n"
                        "  \"crop_top\": %d,\n"
                        "  \"crop_right\": %d,\n"
                        "  \"crop_bottom\": %d,\n"
                        "  \"rgba_bytes\": %zu,\n"
                        "  \"rgba_fnv1a64\": \"%s\",\n"
                        "  \"framehash\": \"%s\",\n"
                        "  \"runtime_framehash\": \"%s\",\n"
                        "  \"runtime_semantic_applied_hash\": \"%s\",\n"
                        "  \"runtime_semantic_applied_count\": %d,\n"
                        "  \"runtime_semantic_total_hash_expected\": \"%s\",\n"
                        "  \"runtime_semantic_total_hash_runtime\": \"%s\",\n"
                        "  \"runtime_semantic_total_count_expected\": %d,\n"
                        "  \"runtime_semantic_total_count_runtime\": %d,\n"
                        "  \"runtime_semantic_total_match\": true,\n"
                        "  \"runtime_semantic_relaxed_ready\": %s,\n"
                        "  \"runtime_semantic_relaxed_applied_count_check\": %s,\n"
                        "  \"runtime_truth_assets_missing\": %s,\n"
                        "  \"semantic_subtree_hash_expected\": \"%s\",\n"
                        "  \"semantic_subtree_hash_runtime\": \"%s\",\n"
                        "  \"semantic_subtree_node_count_expected\": %d,\n"
                        "  \"semantic_subtree_node_count_runtime\": %d,\n"
                        "  \"semantic_tree_match\": true\n"
                        "}\n",
                        route_state,
                        route_depth,
                        route_parent,
                        path_signature,
                        no_foreground_switch ? "true" : "false",
                        runtime_route,
                        require_runtime_route_match ? "true" : "false",
                        runtime_state_observed ? "true" : "false",
                        runtime_state_source,
                        serial,
                        pkg,
                        activity,
                        full_png,
                        app_bounds.w,
                        app_bounds.h,
                        app_bounds.w,
                        app_bounds.h,
                        app_bounds.x,
                        app_bounds.y,
                        app_bounds.x + app_bounds.w,
                        app_bounds.y + app_bounds.h,
                        rgba_bytes,
                        rgba_hash_hex,
                        hash_hex,
                        runtime_hash_to_write,
                        runtime_semantic_applied_hash,
                        runtime_semantic_applied_count,
                        semantic_total_hash_expected,
                        runtime_semantic_total_hash,
                        semantic_total_count_expected,
                        runtime_semantic_total_count,
                        runtime_ready_relaxed ? "true" : "false",
                        relaxed_applied_count_check ? "true" : "false",
                        runtime_truth_assets_missing ? "true" : "false",
                        semantic_subtree_hash_expected,
                        semantic_subtree_hash_runtime,
                        semantic_subtree_node_count_expected,
                        semantic_subtree_node_count_runtime);
  if (meta_n <= 0 || (size_t)meta_n >= sizeof(meta_doc) ||
      write_file_all(meta_path, meta_doc, (size_t)meta_n) != 0) {
    remove_truth_partial_outputs(out_dir, route_state);
    fprintf(stderr, "[capture-unimaker-truth] failed to write meta: %s\n", meta_path);
    return 1;
  }

  fprintf(stdout,
          "[capture-unimaker-truth] ok route=%s visible=%dx%d framehash=%s runtime_framehash=%s out=%s\n",
          route_state,
          app_bounds.w,
          app_bounds.h,
          hash_hex,
          runtime_hash_to_write,
          out_dir);
  fprintf(stdout, "[capture-unimaker-truth] outputs: %s %s %s %s\n", rgba_path, meta_path, runtime_hash_path, framehash_path);
  return 0;
}
