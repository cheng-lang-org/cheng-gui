#define _POSIX_C_SOURCE 200809L

#include "native_claude_route_bfs_1to1_android.h"

#include "native_capture_route_layer_android.h"
#include "native_r2c_compile_react_project.h"
#include "native_r2c_report_validate.h"
#include "native_verify_route_layer_android.h"

#include <ctype.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  char routes[256][128];
  int count;
} RouteList;

typedef struct {
  int current_layer;
  int next_layer;
  char status[64];
} LayerStateSnapshot;

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
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

static const char *infer_main_activity_for_package_local(const char *pkg, char *buf, size_t buf_cap) {
  if (buf != NULL && buf_cap > 0u) buf[0] = '\0';
  if (pkg == NULL || pkg[0] == '\0') return "";
  if (strcmp(pkg, "com.cheng.mobile") == 0) return "com.cheng.mobile/.ChengActivity";
  if (strcmp(pkg, "com.unimaker.app") == 0) return "com.unimaker.app/.MainActivity";
  if (buf != NULL && buf_cap > 0u) {
    if (snprintf(buf, buf_cap, "%s/.MainActivity", pkg) < (int)buf_cap) return buf;
  }
  return "";
}

static int to_abs_path(const char *in, char *out, size_t cap) {
  if (in == NULL || in[0] == '\0' || out == NULL || cap == 0u) return -1;
  if (in[0] == '/') {
    if (snprintf(out, cap, "%s", in) >= (int)cap) return -1;
    return 0;
  }
  char cwd[PATH_MAX];
  if (getcwd(cwd, sizeof(cwd)) == NULL) return -1;
  if (snprintf(out, cap, "%s/%s", cwd, in) >= (int)cap) return -1;
  return 0;
}

static char *read_file_all_local(const char *path, size_t *out_len) {
  if (out_len != NULL) *out_len = 0u;
  if (path == NULL || path[0] == '\0') return NULL;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return NULL;
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    return NULL;
  }
  long sz = ftell(fp);
  if (sz <= 0) {
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

static int write_file_all_local(const char *path, const char *data, size_t len) {
  if (path == NULL || path[0] == '\0' || data == NULL) return -1;
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  size_t wr = fwrite(data, 1u, len, fp);
  int rc = fclose(fp);
  if (wr != len || rc != 0) return -1;
  return 0;
}

static const char *skip_ws_local(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool json_parse_string_at(const char *p, char *out, size_t cap, const char **end_out) {
  if (p == NULL || *p != '"' || out == NULL || cap == 0u) return false;
  ++p;
  size_t n = 0u;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"') {
      out[n] = '\0';
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
    if (n + 1u >= cap) return false;
    out[n++] = ch;
  }
  return false;
}

static int parse_int_key(const char *doc, const char *key, int *out_value) {
  if (doc == NULL || key == NULL || out_value == NULL) return -1;
  char pattern[128];
  if (snprintf(pattern, sizeof(pattern), "\"%s\"", key) >= (int)sizeof(pattern)) return -1;
  const char *p = strstr(doc, pattern);
  if (p == NULL) return -1;
  const char *colon = strchr(p + strlen(pattern), ':');
  if (colon == NULL) return -1;
  char *end = NULL;
  long v = strtol(colon + 1, &end, 10);
  if (end == colon + 1) return -1;
  *out_value = (int)v;
  return 0;
}

static int parse_string_key(const char *doc, const char *key, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (doc == NULL || key == NULL || out == NULL || out_cap == 0u) return -1;
  char pattern[128];
  if (snprintf(pattern, sizeof(pattern), "\"%s\"", key) >= (int)sizeof(pattern)) return -1;
  const char *p = strstr(doc, pattern);
  if (p == NULL) return -1;
  const char *colon = strchr(p + strlen(pattern), ':');
  if (colon == NULL) return -1;
  colon = skip_ws_local(colon + 1);
  if (colon == NULL || *colon != '"') return -1;
  return json_parse_string_at(colon, out, out_cap, NULL) ? 0 : -1;
}

static void dirname_copy(const char *path, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (path == NULL || path[0] == '\0') return;
  size_t n = strlen(path);
  if (n >= out_cap) n = out_cap - 1u;
  memcpy(out, path, n);
  out[n] = '\0';
  char *slash = strrchr(out, '/');
  if (slash == NULL) {
    snprintf(out, out_cap, ".");
    return;
  }
  if (slash == out) {
    slash[1] = '\0';
    return;
  }
  *slash = '\0';
}

static bool resolve_report_path(const char *report_path, const char *raw, char *out, size_t out_cap) {
  if (report_path == NULL || raw == NULL || out == NULL || out_cap == 0u) return false;
  if (raw[0] == '\0') return false;
  if (raw[0] == '/') {
    if (snprintf(out, out_cap, "%s", raw) >= (int)out_cap) return false;
    return true;
  }
  if (nr_file_exists(raw)) {
    if (snprintf(out, out_cap, "%s", raw) >= (int)out_cap) return false;
    return true;
  }
  char base[PATH_MAX];
  dirname_copy(report_path, base, sizeof(base));
  return nr_path_join(out, out_cap, base, raw) == 0;
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

static const char *json_find_balanced_end(const char *start, char open_ch, char close_ch) {
  if (start == NULL || *start != open_ch) return NULL;
  int depth = 0;
  bool in_string = false;
  const char *p = start;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"' && (p - start < 3 || *(p - 2) != '\\')) in_string = !in_string;
    if (in_string) continue;
    if (ch == open_ch) {
      depth += 1;
      continue;
    }
    if (ch == close_ch) {
      depth -= 1;
      if (depth == 0) return p;
      if (depth < 0) return NULL;
    }
  }
  return NULL;
}

static int parse_route_strings_from_array(const char *arr_start,
                                          const char *arr_end,
                                          char routes[][128],
                                          int max_routes,
                                          int *out_count) {
  if (out_count != NULL) *out_count = 0;
  if (arr_start == NULL || arr_end == NULL || arr_start >= arr_end || *arr_start != '[') return -1;
  int count = 0;
  const char *p = arr_start + 1;
  while (p < arr_end) {
    p = skip_ws_local(p);
    if (p == NULL || p >= arr_end || *p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '"') return -1;
    if (count >= max_routes) return -1;
    const char *after = NULL;
    if (!json_parse_string_at(p, routes[count], sizeof(routes[count]), &after)) return -1;
    count += 1;
    p = after;
  }
  if (out_count != NULL) *out_count = count;
  return (count > 0) ? 0 : -1;
}

static int parse_layer_routes(const char *route_layers_path,
                              int layer_index,
                              char routes[][128],
                              int max_routes,
                              int *out_count) {
  if (out_count != NULL) *out_count = 0;
  size_t n = 0u;
  char *doc = read_file_all_local(route_layers_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return -1;
  }
  const char *p = doc;
  int rc = -1;
  while ((p = strstr(p, "\"layer_index\"")) != NULL) {
    const char *colon = strchr(p, ':');
    if (colon == NULL) break;
    char *end_num = NULL;
    long v = strtol(colon + 1, &end_num, 10);
    if (end_num == colon + 1) {
      p += 13;
      continue;
    }
    if ((int)v != layer_index) {
      p = end_num;
      continue;
    }
    const char *obj_start = p;
    while (obj_start > doc && *obj_start != '{') --obj_start;
    if (*obj_start != '{') break;
    const char *obj_end = json_find_balanced_end(obj_start, '{', '}');
    if (obj_end == NULL) break;
    const char *routes_val = json_find_key_in_span(obj_start, obj_end, "routes");
    if (routes_val == NULL || *routes_val != '[') break;
    const char *routes_end = json_find_balanced_end(routes_val, '[', ']');
    if (routes_end == NULL || routes_end > obj_end) break;
    rc = parse_route_strings_from_array(routes_val, routes_end, routes, max_routes, out_count);
    break;
  }
  free(doc);
  return rc;
}

static bool parse_path_signature_from_obj(const char *obj_start,
                                          const char *obj_end,
                                          char *out,
                                          size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  const char *arr_val = json_find_key_in_span(obj_start, obj_end, "path_from_root");
  if (arr_val == NULL || *arr_val != '[') return false;
  const char *arr_end = json_find_balanced_end(arr_val, '[', ']');
  if (arr_end == NULL || arr_end > obj_end) return false;
  const char *p = arr_val + 1;
  bool first = true;
  while (p < arr_end) {
    p = skip_ws_local(p);
    if (p == NULL || p >= arr_end || *p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '"') return false;
    char seg[128];
    const char *after = NULL;
    if (!json_parse_string_at(p, seg, sizeof(seg), &after)) return false;
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

static bool read_route_meta_from_tree(const char *route_tree_path,
                                      const char *route,
                                      char *out_parent,
                                      size_t out_parent_cap,
                                      char *out_path_signature,
                                      size_t out_path_signature_cap) {
  if (out_parent != NULL && out_parent_cap > 0u) out_parent[0] = '\0';
  if (out_path_signature != NULL && out_path_signature_cap > 0u) out_path_signature[0] = '\0';
  if (route_tree_path == NULL || route == NULL || route[0] == '\0') return false;
  size_t n = 0u;
  char *doc = read_file_all_local(route_tree_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_pat[256];
  if (snprintf(route_pat, sizeof(route_pat), "\"route\":\"%s\"", route) >= (int)sizeof(route_pat)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_pat);
  if (hit == NULL) {
    free(doc);
    return false;
  }
  const char *obj_start = hit;
  while (obj_start > doc && *obj_start != '{') --obj_start;
  if (*obj_start != '{') {
    free(doc);
    return false;
  }
  const char *obj_end = json_find_balanced_end(obj_start, '{', '}');
  if (obj_end == NULL) {
    free(doc);
    return false;
  }
  const char *parent_val = json_find_key_in_span(obj_start, obj_end, "parent");
  bool ok = (parent_val != NULL && *parent_val == '"' &&
             json_parse_string_at(parent_val, out_parent, out_parent_cap, NULL) &&
             parse_path_signature_from_obj(obj_start, obj_end, out_path_signature, out_path_signature_cap));
  free(doc);
  return ok;
}

static bool read_route_subtree_hash(const char *route_semantic_tree_path,
                                    const char *route,
                                    char *out_subtree_hash,
                                    size_t out_subtree_hash_cap) {
  if (out_subtree_hash != NULL && out_subtree_hash_cap > 0u) out_subtree_hash[0] = '\0';
  if (route_semantic_tree_path == NULL || route == NULL || route[0] == '\0') return false;
  size_t n = 0u;
  char *doc = read_file_all_local(route_semantic_tree_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_pat[256];
  if (snprintf(route_pat, sizeof(route_pat), "\"route\":\"%s\"", route) >= (int)sizeof(route_pat)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_pat);
  if (hit == NULL) {
    free(doc);
    return false;
  }
  const char *obj_start = hit;
  while (obj_start > doc && *obj_start != '{') --obj_start;
  if (*obj_start != '{') {
    free(doc);
    return false;
  }
  const char *obj_end = json_find_balanced_end(obj_start, '{', '}');
  if (obj_end == NULL) {
    free(doc);
    return false;
  }
  const char *hash_val = json_find_key_in_span(obj_start, obj_end, "subtree_hash");
  bool ok = (hash_val != NULL && *hash_val == '"' &&
             json_parse_string_at(hash_val, out_subtree_hash, out_subtree_hash_cap, NULL));
  free(doc);
  return ok && out_subtree_hash[0] != '\0';
}

static int write_layer_state_file(const char *state_file,
                                  int current_layer,
                                  int next_layer,
                                  const char *compile_out,
                                  const char *truth_dir,
                                  const char *route_semantic_tree_path,
                                  const char *status) {
  char doc[4096];
  int n = snprintf(doc,
                   sizeof(doc),
                   "{\n"
                   "  \"current_layer\": %d,\n"
                   "  \"next_layer\": %d,\n"
                   "  \"compile_out\": \"%s\",\n"
                   "  \"truth_dir\": \"%s\",\n"
                   "  \"route_semantic_tree_path\": \"%s\",\n"
                   "  \"status\": \"%s\"\n"
                   "}\n",
                   current_layer,
                   next_layer,
                   compile_out != NULL ? compile_out : "",
                   truth_dir != NULL ? truth_dir : "",
                   route_semantic_tree_path != NULL ? route_semantic_tree_path : "",
                   status != NULL ? status : "unknown");
  if (n <= 0 || (size_t)n >= sizeof(doc)) return -1;
  return write_file_all_local(state_file, doc, (size_t)n);
}

static int write_layer_handoff_file(const char *handoff_file,
                                    int next_layer,
                                    const RouteList *next_routes,
                                    const char *route_tree_path,
                                    const char *route_semantic_tree_path) {
  if (handoff_file == NULL || handoff_file[0] == '\0' || next_routes == NULL) return -1;
  char *buf = (char *)malloc(1 << 20);
  if (buf == NULL) return -1;
  size_t cap = (size_t)(1 << 20);
  size_t used = 0u;
  int n = snprintf(buf + used, cap - used,
                   "{\n"
                   "  \"next_layer\": %d,\n"
                   "  \"route_tree_path\": \"%s\",\n"
                   "  \"route_semantic_tree_path\": \"%s\",\n"
                   "  \"routes\": [\n",
                   next_layer,
                   route_tree_path != NULL ? route_tree_path : "",
                   route_semantic_tree_path != NULL ? route_semantic_tree_path : "");
  if (n <= 0 || (size_t)n >= cap - used) {
    free(buf);
    return -1;
  }
  used += (size_t)n;

  for (int i = 0; i < next_routes->count; ++i) {
    char parent[128];
    char path_signature[512];
    char subtree_hash[128];
    parent[0] = '\0';
    path_signature[0] = '\0';
    subtree_hash[0] = '\0';
    if (!read_route_meta_from_tree(route_tree_path,
                                   next_routes->routes[i],
                                   parent,
                                   sizeof(parent),
                                   path_signature,
                                   sizeof(path_signature)) ||
        !read_route_subtree_hash(route_semantic_tree_path,
                                 next_routes->routes[i],
                                 subtree_hash,
                                 sizeof(subtree_hash))) {
      free(buf);
      return -1;
    }
    n = snprintf(buf + used,
                 cap - used,
                 "%s    {\"route\":\"%s\",\"expected_parent\":\"%s\",\"path_signature\":\"%s\",\"subtree_hash\":\"%s\"}",
                 (i == 0) ? "" : ",\n",
                 next_routes->routes[i],
                 parent,
                 path_signature,
                 subtree_hash);
    if (n <= 0 || (size_t)n >= cap - used) {
      free(buf);
      return -1;
    }
    used += (size_t)n;
  }

  n = snprintf(buf + used, cap - used, "\n  ]\n}\n");
  if (n <= 0 || (size_t)n >= cap - used) {
    free(buf);
    return -1;
  }
  used += (size_t)n;
  int rc = write_file_all_local(handoff_file, buf, used);
  free(buf);
  return rc;
}

static int read_layer_state_file(const char *state_file, LayerStateSnapshot *out) {
  if (out == NULL) return -1;
  out->current_layer = -1;
  out->next_layer = -1;
  out->status[0] = '\0';
  if (state_file == NULL || state_file[0] == '\0' || !nr_file_exists(state_file)) return -1;
  size_t n = 0u;
  char *doc = read_file_all_local(state_file, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return -1;
  }
  int rc = 0;
  if (parse_int_key(doc, "current_layer", &out->current_layer) != 0 ||
      parse_int_key(doc, "next_layer", &out->next_layer) != 0 ||
      parse_string_key(doc, "status", out->status, sizeof(out->status)) != 0 ||
      out->status[0] == '\0') {
    rc = -1;
  }
  free(doc);
  return rc;
}

static int read_handoff_next_layer(const char *handoff_file, int *out_next_layer) {
  if (out_next_layer == NULL) return -1;
  *out_next_layer = -1;
  if (handoff_file == NULL || handoff_file[0] == '\0' || !nr_file_exists(handoff_file)) return -1;
  size_t n = 0u;
  char *doc = read_file_all_local(handoff_file, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return -1;
  }
  int rc = parse_int_key(doc, "next_layer", out_next_layer);
  free(doc);
  return rc;
}

static int enforce_layer_sequence_guard(const char *state_file,
                                        const char *handoff_file,
                                        int requested_layer) {
  if (env_flag_enabled_local("CHENG_BFS_IGNORE_STATE_GUARD", false)) return 0;
  LayerStateSnapshot snap;
  if (read_layer_state_file(state_file, &snap) != 0) return 0;
  if (strcmp(snap.status, "awaiting_confirm") == 0) {
    if (requested_layer != snap.next_layer) {
      fprintf(stderr,
              "[claude-route-bfs-android] sequence guard: state awaiting_confirm requires --layer-index=%d (got %d)\n",
              snap.next_layer,
              requested_layer);
      return -1;
    }
    int handoff_next = -1;
    if (read_handoff_next_layer(handoff_file, &handoff_next) != 0 || handoff_next != snap.next_layer) {
      fprintf(stderr,
              "[claude-route-bfs-android] sequence guard: layer_handoff mismatch (state.next_layer=%d handoff.next_layer=%d)\n",
              snap.next_layer,
              handoff_next);
      return -1;
    }
    return 0;
  }
  if (strcmp(snap.status, "failed") == 0) {
    if (requested_layer != snap.current_layer) {
      fprintf(stderr,
              "[claude-route-bfs-android] sequence guard: previous layer failed; rerun --layer-index=%d first (got %d)\n",
              snap.current_layer,
              requested_layer);
      return -1;
    }
    return 0;
  }
  if (strcmp(snap.status, "running") == 0) {
    fprintf(stderr,
            "[claude-route-bfs-android] sequence guard: previous run still marked running at layer=%d; resolve or retry same layer\n",
            snap.current_layer);
    return -1;
  }
  if (strcmp(snap.status, "completed") == 0) {
    fprintf(stderr,
            "[claude-route-bfs-android] sequence guard: all layers already completed (state=%s)\n",
            state_file);
    return -1;
  }
  fprintf(stderr,
          "[claude-route-bfs-android] sequence guard: unknown state status=%s (state=%s)\n",
          snap.status,
          state_file);
  return -1;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  claude_route_bfs_1to1_android --layer-index <n> [--state-file <abs>] [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--capture-source unimaker_foreground_runtime_visible] [--first-install-pass 0|1] [--no-foreground-switch 0|1] [--require-runtime 1] [--routes-csv <a,b,c>] [--routes-file <path>]\n");
}

int native_claude_route_bfs_1to1_android(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }
  const char *project = getenv("R2C_REAL_PROJECT");
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  const char *entry = getenv("R2C_REAL_ENTRY");
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";
  const char *out_dir = "/Users/lbcheng/.cheng-packages/cheng-gui/build/claude_bfs_android";
  const char *state_file_arg = NULL;
  const char *capture_source = "unimaker_foreground_runtime_visible";
  const char *routes_csv = getenv("CHENG_BFS_LAYER_ROUTES_CSV");
  const char *routes_file = getenv("CHENG_BFS_LAYER_ROUTES_FILE");
  int first_install_pass = 0;
  int no_foreground_switch = 1;
  int verify_require_runtime_cli = -1;
  int layer_index = -1;

  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--project") == 0) {
      if (i + 1 >= argc) return 2;
      project = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--entry") == 0) {
      if (i + 1 >= argc) return 2;
      entry = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out") == 0) {
      if (i + 1 >= argc) return 2;
      out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--state-file") == 0) {
      if (i + 1 >= argc) return 2;
      state_file_arg = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--layer-index") == 0) {
      if (i + 1 >= argc) return 2;
      layer_index = atoi(argv[i + 1]);
      i += 2;
      continue;
    }
    if (strcmp(arg, "--capture-source") == 0) {
      if (i + 1 >= argc) return 2;
      capture_source = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--routes-csv") == 0) {
      if (i + 1 >= argc) return 2;
      routes_csv = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--routes-file") == 0) {
      if (i + 1 >= argc) return 2;
      routes_file = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--first-install-pass") == 0) {
      if (i + 1 >= argc) return 2;
      first_install_pass = atoi(argv[i + 1]) != 0 ? 1 : 0;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--no-foreground-switch") == 0) {
      if (i + 1 >= argc) return 2;
      no_foreground_switch = (strcmp(argv[i + 1], "0") == 0) ? 0 : 1;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--require-runtime") == 0) {
      if (i + 1 >= argc) return 2;
      if (strcmp(argv[i + 1], "1") != 0) {
        fprintf(stderr,
                "[claude-route-bfs-android] strict runtime mode requires --require-runtime=1\n");
        return 2;
      }
      verify_require_runtime_cli = 1;
      i += 2;
      continue;
    }
    fprintf(stderr, "[claude-route-bfs-android] unknown arg: %s\n", arg);
    return 2;
  }

  if (layer_index < 0) {
    fprintf(stderr, "[claude-route-bfs-android] --layer-index is required\n");
    return 2;
  }
  if (strcmp(capture_source, "unimaker_foreground_runtime_visible") != 0) {
    fprintf(stderr, "[claude-route-bfs-android] capture-source must be unimaker_foreground_runtime_visible\n");
    return 2;
  }
  if (no_foreground_switch == 0) {
    fprintf(stderr,
            "[claude-route-bfs-android] foreground switching is forbidden; --no-foreground-switch must be 1\n");
    return 2;
  }
  char layer1_default_routes_file[PATH_MAX];
  bool layer1_default_routes_active = false;
  layer1_default_routes_file[0] = '\0';
  bool layer1_default_routes_enabled = env_flag_enabled_local("CHENG_BFS_LAYER1_DEFAULT_ROUTES", true);
  if (layer1_default_routes_enabled &&
      layer_index == 1 &&
      (routes_csv == NULL || routes_csv[0] == '\0') &&
      (routes_file == NULL || routes_file[0] == '\0')) {
    if (to_abs_path("src/tools/r2c_aot/layer1_stable_routes.routes",
                    layer1_default_routes_file,
                    sizeof(layer1_default_routes_file)) == 0 &&
        nr_file_exists(layer1_default_routes_file)) {
      routes_file = layer1_default_routes_file;
      layer1_default_routes_active = true;
    }
  }
  no_foreground_switch = 1;
  setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", no_foreground_switch ? "1" : "0", 1);
  setenv("CHENG_ANDROID_FIRST_INSTALL_PASS", first_install_pass ? "1" : "0", 1);

  char out_abs[PATH_MAX];
  if (to_abs_path(out_dir, out_abs, sizeof(out_abs)) != 0) return 2;
  if (nr_ensure_dir(out_abs) != 0) return 1;

  char state_file[PATH_MAX];
  if (state_file_arg != NULL && state_file_arg[0] != '\0') {
    if (to_abs_path(state_file_arg, state_file, sizeof(state_file)) != 0) return 2;
  } else {
    if (nr_path_join(state_file, sizeof(state_file), out_abs, "layer_state.json") != 0) return 1;
  }
  char handoff_file[PATH_MAX];
  if (nr_path_join(handoff_file, sizeof(handoff_file), out_abs, "layer_handoff.json") != 0) return 1;
  if (enforce_layer_sequence_guard(state_file, handoff_file, layer_index) != 0) return 2;

  char compile_out[PATH_MAX];
  if (nr_path_join(compile_out, sizeof(compile_out), out_abs, "compile") != 0) return 1;
  if (nr_ensure_dir(compile_out) != 0) return 1;

  char report_json[PATH_MAX];
  if (nr_path_join(report_json, sizeof(report_json), compile_out, "r2capp/r2capp_compile_report.json") != 0) {
    (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
    return 1;
  }

  bool force_compile = env_flag_enabled_local("CHENG_ANDROID_1TO1_BFS_FORCE_COMPILE", false);
  bool need_compile = true;
  if (!force_compile && nr_file_exists(report_json)) {
    char report_err[512];
    report_err[0] = '\0';
    if (nr_validate_compile_report(report_json, NULL, project, report_err, sizeof(report_err)) == 0) {
      need_compile = false;
      fprintf(stdout,
              "== claude bfs 1:1 android: reuse compile(strict) ==\n"
              "[claude-route-bfs-android] compile reuse report=%s\n",
              report_json);
    } else {
      fprintf(stdout,
              "[claude-route-bfs-android] existing report invalid; recompile required: %s\n",
              report_err[0] != '\0' ? report_err : "<unknown>");
    }
  }

  int rc = 0;
  if (need_compile) {
    fprintf(stdout, "== claude bfs 1:1 android: compile(strict) ==\n");
    char *compile_argv[] = {
        "r2c_compile_react_project",
        "--project",
        (char *)project,
        "--entry",
        (char *)entry,
        "--out",
        compile_out,
        "--strict",
        NULL,
    };
    rc = native_r2c_compile_react_project(scripts_dir, 8, compile_argv, 1);
    if (rc != 0) {
      (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
      return rc;
    }
  }

  if (!nr_file_exists(report_json)) {
    fprintf(stderr, "[claude-route-bfs-android] missing report: %s\n", report_json);
    (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
    return 1;
  }
  size_t report_n = 0u;
  char *report_doc = read_file_all_local(report_json, &report_n);
  if (report_doc == NULL || report_n == 0u) {
    free(report_doc);
    fprintf(stderr, "[claude-route-bfs-android] failed to read report\n");
    (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
    return 1;
  }

  int layer_count = 0;
  if (parse_int_key(report_doc, "layer_count", &layer_count) != 0 || layer_count <= 0) {
    free(report_doc);
    fprintf(stderr, "[claude-route-bfs-android] invalid layer_count\n");
    (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
    return 1;
  }
  if (layer_index >= layer_count) {
    fprintf(stderr,
            "[claude-route-bfs-android] layer-index out of range: %d (layer_count=%d)\n",
            layer_index,
            layer_count);
    free(report_doc);
    (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
    return 2;
  }

  char route_layers_raw[PATH_MAX];
  char route_tree_raw[PATH_MAX];
  char route_semantic_tree_raw[PATH_MAX];
  if (parse_string_key(report_doc, "route_layers_path", route_layers_raw, sizeof(route_layers_raw)) != 0 ||
      parse_string_key(report_doc, "route_tree_path", route_tree_raw, sizeof(route_tree_raw)) != 0 ||
      parse_string_key(report_doc,
                       "route_semantic_tree_path",
                       route_semantic_tree_raw,
                       sizeof(route_semantic_tree_raw)) != 0) {
    fprintf(stderr, "[claude-route-bfs-android] missing route path keys in report\n");
    free(report_doc);
    (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
    return 1;
  }
  char route_layers_path[PATH_MAX];
  char route_tree_path[PATH_MAX];
  char route_semantic_tree_path[PATH_MAX];
  if (!resolve_report_path(report_json, route_layers_raw, route_layers_path, sizeof(route_layers_path)) ||
      !resolve_report_path(report_json, route_tree_raw, route_tree_path, sizeof(route_tree_path)) ||
      !resolve_report_path(report_json,
                           route_semantic_tree_raw,
                           route_semantic_tree_path,
                           sizeof(route_semantic_tree_path)) ||
      !nr_file_exists(route_layers_path) || !nr_file_exists(route_tree_path) ||
      !nr_file_exists(route_semantic_tree_path)) {
    fprintf(stderr,
            "[claude-route-bfs-android] invalid route artifact paths\n"
            "  route_layers=%s\n"
            "  route_tree=%s\n"
            "  route_semantic_tree=%s\n",
            route_layers_path,
            route_tree_path,
            route_semantic_tree_path);
    free(report_doc);
    (void)write_layer_state_file(state_file, layer_index, layer_index, compile_out, "", "", "failed");
    return 1;
  }
  free(report_doc);

  char truth_dir[PATH_MAX];
  if (nr_path_join(truth_dir, sizeof(truth_dir), compile_out, "r2capp/truth") != 0) return 1;
  if (nr_ensure_dir(truth_dir) != 0) return 1;
  if (write_layer_state_file(
          state_file, layer_index, layer_index, compile_out, truth_dir, route_semantic_tree_path, "running") != 0) {
    fprintf(stderr, "[claude-route-bfs-android] failed to write running state file: %s\n", state_file);
    return 1;
  }

  char layer_text[32];
  char no_foreground_text[8];
  char require_runtime_text[8];
  char truth_activity_buf[192];
  char impl_activity_buf[192];
  truth_activity_buf[0] = '\0';
  impl_activity_buf[0] = '\0';
  const char *truth_pkg = getenv("CHENG_BFS_TRUTH_PACKAGE");
  if (truth_pkg == NULL || truth_pkg[0] == '\0') truth_pkg = "com.unimaker.app";
  const char *truth_activity = getenv("CHENG_BFS_TRUTH_ACTIVITY");
  if (truth_activity == NULL || truth_activity[0] == '\0') {
    truth_activity = infer_main_activity_for_package_local(truth_pkg, truth_activity_buf, sizeof(truth_activity_buf));
  }
  const char *impl_pkg = getenv("CHENG_BFS_IMPL_PACKAGE");
  if (impl_pkg == NULL || impl_pkg[0] == '\0') impl_pkg = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
  if (impl_pkg == NULL || impl_pkg[0] == '\0') impl_pkg = getenv("CHENG_ANDROID_APP_PACKAGE");
  if (impl_pkg == NULL || impl_pkg[0] == '\0') impl_pkg = "com.cheng.mobile";
  const char *impl_activity = getenv("CHENG_BFS_IMPL_ACTIVITY");
  if (impl_activity == NULL || impl_activity[0] == '\0') impl_activity = getenv("CHENG_ANDROID_EQ_APP_ACTIVITY");
  if (impl_activity == NULL || impl_activity[0] == '\0') impl_activity = getenv("CHENG_ANDROID_APP_ACTIVITY");
  if (impl_activity == NULL || impl_activity[0] == '\0') {
    impl_activity = infer_main_activity_for_package_local(impl_pkg, impl_activity_buf, sizeof(impl_activity_buf));
  }
  snprintf(layer_text, sizeof(layer_text), "%d", layer_index);
  snprintf(no_foreground_text, sizeof(no_foreground_text), "%d", no_foreground_switch ? 1 : 0);
  int verify_require_runtime = (verify_require_runtime_cli >= 0) ? verify_require_runtime_cli : 1;
  snprintf(require_runtime_text, sizeof(require_runtime_text), "%d", verify_require_runtime ? 1 : 0);
  setenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_PACKAGE", truth_pkg, 1);
  setenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_ACTIVITY", truth_activity, 1);
  setenv("CHENG_CAPTURE_ROUTE_LAYER_EXPECT_TRUTH_PACKAGE", truth_pkg, 1);
  setenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGES", truth_pkg, 1);
  setenv("CHENG_CAPTURE_ROUTE_LAYER_ALLOW_FOREGROUND_RECOVER", "0", 1);
  setenv("CHENG_CAPTURE_ROUTE_LAYER_ALLOW_OVERLAY_FOREGROUND", "0", 1);
  setenv("CHENG_CAPTURE_UNIMAKER_ALLOW_OVERLAY_FOREGROUND", "0", 1);
  setenv("CHENG_CAPTURE_UNIMAKER_HOME_DEFAULT_EXACT_MATCH", "1", 1);
  setenv("CHENG_CAPTURE_ROUTE_LAYER_REQUIRE_RUNTIME_ROUTE_MATCH", "1", 1);
  setenv("CHENG_CAPTURE_ROUTE_LAYER_REQUIRE_RUNTIME_ROUTE_PROBE", "1", 1);
  fprintf(stdout,
          "[claude-route-bfs-android] mode require-runtime=%d capture-route-match=%d capture-route-probe=%d no-foreground-switch=%d\n",
          verify_require_runtime ? 1 : 0,
          verify_require_runtime ? 1 : 0,
          verify_require_runtime ? 1 : 0,
          no_foreground_switch ? 1 : 0);
  fprintf(stdout,
          "[claude-route-bfs-android] capture(truth) package=%s activity=%s\n",
          truth_pkg,
          truth_activity != NULL ? truth_activity : "<empty>");
  fprintf(stdout,
          "[claude-route-bfs-android] verify(runtime) package=%s activity=%s\n",
          impl_pkg,
          impl_activity != NULL ? impl_activity : "<empty>");
  if (layer1_default_routes_active) {
    fprintf(stdout,
            "[claude-route-bfs-android] layer1 default routes active file=%s\n",
            routes_file);
  }

  fprintf(stdout, "== claude bfs 1:1 android: layer %d capture ==\n", layer_index);
  char *cap_argv[32];
  int cap_argc = 0;
  cap_argv[cap_argc++] = "capture_route_layer_android";
  cap_argv[cap_argc++] = "--project";
  cap_argv[cap_argc++] = (char *)project;
  cap_argv[cap_argc++] = "--entry";
  cap_argv[cap_argc++] = (char *)entry;
  cap_argv[cap_argc++] = "--out";
  cap_argv[cap_argc++] = out_abs;
  cap_argv[cap_argc++] = "--compile-out";
  cap_argv[cap_argc++] = compile_out;
  cap_argv[cap_argc++] = "--truth-dir";
  cap_argv[cap_argc++] = truth_dir;
  cap_argv[cap_argc++] = "--layer-index";
  cap_argv[cap_argc++] = layer_text;
  cap_argv[cap_argc++] = "--capture-source";
  cap_argv[cap_argc++] = (char *)capture_source;
  cap_argv[cap_argc++] = "--first-install-pass";
  cap_argv[cap_argc++] = first_install_pass ? "1" : "0";
  cap_argv[cap_argc++] = "--no-foreground-switch";
  cap_argv[cap_argc++] = no_foreground_text;
  if (routes_csv != NULL && routes_csv[0] != '\0') {
    cap_argv[cap_argc++] = "--routes-csv";
    cap_argv[cap_argc++] = (char *)routes_csv;
  }
  if (routes_file != NULL && routes_file[0] != '\0') {
    cap_argv[cap_argc++] = "--routes-file";
    cap_argv[cap_argc++] = (char *)routes_file;
  }
  cap_argv[cap_argc] = NULL;
  rc = native_capture_route_layer_android(scripts_dir, cap_argc, cap_argv, 1);
  if (rc != 0) {
    fprintf(stderr, "[claude-route-bfs-android] capture failed at layer=%d rc=%d\n", layer_index, rc);
    (void)write_layer_state_file(
        state_file, layer_index, layer_index, compile_out, truth_dir, route_semantic_tree_path, "failed");
    return rc;
  }
  setenv("CHENG_ANDROID_EQ_APP_PACKAGE", impl_pkg, 1);
  setenv("CHENG_ANDROID_EQ_APP_ACTIVITY", impl_activity, 1);
  setenv("CHENG_ANDROID_APP_PACKAGE", impl_pkg, 1);
  setenv("CHENG_ANDROID_APP_ACTIVITY", impl_activity, 1);
  setenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGES", impl_pkg, 1);
  setenv("CHENG_ANDROID_1TO1_HOME_DEFAULT_EXACT_MATCH", "1", 1);
  if (truth_pkg != NULL && truth_pkg[0] != '\0' &&
      impl_pkg != NULL && impl_pkg[0] != '\0' &&
      strcmp(truth_pkg, impl_pkg) != 0) {
    setenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH", "1", 1);
    fprintf(stdout,
            "[claude-route-bfs-android] enable cross-package truth compare truth=%s runtime=%s\n",
            truth_pkg,
            impl_pkg);
  } else {
    unsetenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH");
  }

  char verify_out[PATH_MAX];
  char verify_suffix[64];
  snprintf(verify_suffix, sizeof(verify_suffix), "verify_layer_%d", layer_index);
  if (nr_path_join(verify_out, sizeof(verify_out), out_abs, verify_suffix) != 0) return 1;
  if (nr_ensure_dir(verify_out) != 0) return 1;

  fprintf(stdout, "== claude bfs 1:1 android: layer %d verify ==\n", layer_index);
  char *verify_argv[24];
  int verify_argc = 0;
  verify_argv[verify_argc++] = "verify_route_layer_android";
  verify_argv[verify_argc++] = "--project";
  verify_argv[verify_argc++] = (char *)project;
  verify_argv[verify_argc++] = "--entry";
  verify_argv[verify_argc++] = (char *)entry;
  verify_argv[verify_argc++] = "--out";
  verify_argv[verify_argc++] = verify_out;
  verify_argv[verify_argc++] = "--truth-dir";
  verify_argv[verify_argc++] = truth_dir;
  verify_argv[verify_argc++] = "--layer-index";
  verify_argv[verify_argc++] = layer_text;
  verify_argv[verify_argc++] = "--require-runtime";
  verify_argv[verify_argc++] = require_runtime_text;
  if (routes_csv != NULL && routes_csv[0] != '\0') {
    verify_argv[verify_argc++] = "--routes-csv";
    verify_argv[verify_argc++] = (char *)routes_csv;
  }
  if (routes_file != NULL && routes_file[0] != '\0') {
    verify_argv[verify_argc++] = "--routes-file";
    verify_argv[verify_argc++] = (char *)routes_file;
  }
  verify_argv[verify_argc] = NULL;
  rc = native_verify_route_layer_android(scripts_dir, verify_argc, verify_argv, 1);
  if (rc != 0) {
    fprintf(stderr, "[claude-route-bfs-android] verify failed at layer=%d rc=%d\n", layer_index, rc);
    (void)write_layer_state_file(
        state_file, layer_index, layer_index, compile_out, truth_dir, route_semantic_tree_path, "failed");
    return rc;
  }

  int next_layer = layer_index + 1;
  const char *status = (next_layer < layer_count) ? "awaiting_confirm" : "completed";
  if (write_layer_state_file(state_file,
                             layer_index,
                             next_layer,
                             compile_out,
                             truth_dir,
                             route_semantic_tree_path,
                             status) != 0) {
    fprintf(stderr, "[claude-route-bfs-android] failed to write state file: %s\n", state_file);
    return 1;
  }

  RouteList next_routes;
  memset(&next_routes, 0, sizeof(next_routes));
  if (next_layer < layer_count) {
    if (parse_layer_routes(route_layers_path,
                           next_layer,
                           next_routes.routes,
                           (int)(sizeof(next_routes.routes) / sizeof(next_routes.routes[0])),
                           &next_routes.count) != 0) {
      fprintf(stderr,
              "[claude-route-bfs-android] failed to parse next layer routes: layer=%d file=%s\n",
              next_layer,
              route_layers_path);
      return 1;
    }
  }
  if (write_layer_handoff_file(
          handoff_file, next_layer, &next_routes, route_tree_path, route_semantic_tree_path) != 0) {
    fprintf(stderr, "[claude-route-bfs-android] failed to write handoff file: %s\n", handoff_file);
    return 1;
  }

  fprintf(stdout,
          "[claude-route-bfs-android] ok layer=%d next_layer=%d status=%s state=%s handoff=%s\n",
          layer_index,
          next_layer,
          status,
          state_file,
          handoff_file);
  return 0;
}
