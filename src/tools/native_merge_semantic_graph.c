#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
}

static char *read_file_all(const char *path, size_t *out_len) {
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

static int write_file_all(const char *path, const char *data, size_t len) {
  if (path == NULL || path[0] == '\0' || data == NULL) return -1;
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  size_t wr = fwrite(data, 1u, len, fp);
  int rc = fclose(fp);
  return (wr == len && rc == 0) ? 0 : -1;
}

static const char *skip_ws(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool parse_json_string(const char *p, char *out, size_t out_cap, const char **end_out) {
  if (p == NULL || *p != '"' || out == NULL || out_cap == 0u) return false;
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
    if (n + 1u >= out_cap) return false;
    out[n++] = ch;
  }
  return false;
}

static bool find_first_string_value(const char *doc, const char *key, char *out, size_t out_cap) {
  if (doc == NULL || key == NULL || out == NULL || out_cap == 0u) return false;
  char pat[96];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return false;
  const char *p = strstr(doc, pat);
  if (p == NULL) return false;
  const char *q = strchr(p + strlen(pat), ':');
  if (q == NULL) return false;
  q = skip_ws(q + 1);
  if (q == NULL || *q != '"') return false;
  return parse_json_string(q, out, out_cap, NULL);
}

static const char *find_key_value_in_span(const char *start, const char *end, const char *key) {
  if (start == NULL || end == NULL || key == NULL || end <= start) return NULL;
  char pat[96];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = start;
  while (p < end) {
    const char *hit = strstr(p, pat);
    if (hit == NULL || hit >= end) return NULL;
    const char *q = strchr(hit + strlen(pat), ':');
    if (q == NULL || q >= end) return NULL;
    q = skip_ws(q + 1);
    if (q == NULL || q >= end) return NULL;
    return q;
  }
  return NULL;
}

static bool parse_string_field_in_span(const char *start,
                                       const char *end,
                                       const char *key,
                                       char *out,
                                       size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  const char *v = find_key_value_in_span(start, end, key);
  if (v == NULL || *v != '"') return false;
  return parse_json_string(v, out, out_cap, NULL);
}

static const char *find_object_begin_for_key(const char *doc, const char *hit) {
  if (doc == NULL || hit == NULL || hit <= doc) return NULL;
  const char *p = hit;
  while (p > doc) {
    --p;
    if (*p == '{') return p;
  }
  return NULL;
}

static const char *find_object_end(const char *obj_begin) {
  if (obj_begin == NULL || *obj_begin != '{') return NULL;
  int depth = 0;
  bool in_string = false;
  for (const char *p = obj_begin; *p != '\0'; ++p) {
    char ch = *p;
    if (ch == '"' && (p == obj_begin || *(p - 1) != '\\')) in_string = !in_string;
    if (in_string) continue;
    if (ch == '{') depth += 1;
    else if (ch == '}') {
      depth -= 1;
      if (depth == 0) return p + 1;
    }
  }
  return NULL;
}

static bool semantic_has_node_id(const char *semantic_doc, const char *node_id) {
  if (semantic_doc == NULL || node_id == NULL || node_id[0] == '\0') return false;
  char pat1[256];
  char pat2[256];
  if (snprintf(pat1, sizeof(pat1), "\"node_id\":\"%s\"", node_id) >= (int)sizeof(pat1)) return false;
  if (snprintf(pat2, sizeof(pat2), "\"id\":\"%s\"", node_id) >= (int)sizeof(pat2)) return false;
  return (strstr(semantic_doc, pat1) != NULL || strstr(semantic_doc, pat2) != NULL);
}

static bool semantic_role_for_node(const char *semantic_doc, const char *node_id, char *out_role, size_t out_role_cap) {
  if (out_role != NULL && out_role_cap > 0u) out_role[0] = '\0';
  if (semantic_doc == NULL || node_id == NULL || node_id[0] == '\0') return false;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"node_id\":\"%s\"", node_id) >= (int)sizeof(pat)) return false;
  const char *hit = strstr(semantic_doc, pat);
  if (hit == NULL) return false;
  const char *obj_begin = find_object_begin_for_key(semantic_doc, hit);
  const char *obj_end = find_object_end(obj_begin);
  if (obj_begin == NULL || obj_end == NULL || obj_end <= obj_begin) return false;
  if (parse_string_field_in_span(obj_begin, obj_end, "role", out_role, out_role_cap)) return true;
  if (parse_string_field_in_span(obj_begin, obj_end, "kind", out_role, out_role_cap)) return true;
  return false;
}

static bool runtime_kind_for_node(const char *obj_begin, const char *obj_end, char *out_kind, size_t out_kind_cap) {
  if (out_kind != NULL && out_kind_cap > 0u) out_kind[0] = '\0';
  if (obj_begin == NULL || obj_end == NULL || obj_end <= obj_begin) return false;
  if (parse_string_field_in_span(obj_begin, obj_end, "node_kind", out_kind, out_kind_cap)) return true;
  if (parse_string_field_in_span(obj_begin, obj_end, "kind", out_kind, out_kind_cap)) return true;
  if (parse_string_field_in_span(obj_begin, obj_end, "role", out_kind, out_kind_cap)) return true;
  return false;
}

static bool semantic_has_route_state(const char *semantic_doc, const char *route_state) {
  if (semantic_doc == NULL || route_state == NULL || route_state[0] == '\0') return false;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"%s\"", route_state) >= (int)sizeof(pat)) return false;
  const char *states_key = strstr(semantic_doc, "\"states\"");
  if (states_key != NULL) {
    const char *arr_begin = strchr(states_key, '[');
    if (arr_begin != NULL) {
      const char *arr_end = strchr(arr_begin, ']');
      if (arr_end != NULL && arr_end > arr_begin) {
        const char *hit = strstr(arr_begin, pat);
        if (hit != NULL && hit < arr_end) return true;
        return false;
      }
    }
  }
  return strstr(semantic_doc, pat) != NULL;
}

static bool scan_runtime_nodes_and_validate(const char *semantic_doc,
                                            const char *runtime_doc,
                                            char *err,
                                            size_t err_cap,
                                            int *out_node_count) {
  if (out_node_count != NULL) *out_node_count = 0;
  if (semantic_doc == NULL || runtime_doc == NULL) return false;
  const char *p = runtime_doc;
  int node_count = 0;
  while ((p = strstr(p, "\"node_id\"")) != NULL) {
    const char *obj_begin = find_object_begin_for_key(runtime_doc, p);
    const char *obj_end = find_object_end(obj_begin);
    if (obj_begin == NULL || obj_end == NULL || obj_end <= obj_begin) {
      if (err != NULL) snprintf(err, err_cap, "invalid runtime node object");
      return false;
    }
    const char *colon = strchr(p + 8, ':');
    if (colon == NULL) break;
    const char *v = skip_ws(colon + 1);
    char node_id[160];
    const char *after = NULL;
    if (v == NULL || *v != '"' || !parse_json_string(v, node_id, sizeof(node_id), &after)) {
      if (err != NULL) snprintf(err, err_cap, "invalid runtime node_id field");
      return false;
    }
    char semantic_kind[64];
    semantic_kind[0] = '\0';
    if (!semantic_has_node_id(semantic_doc, node_id) ||
        !semantic_role_for_node(semantic_doc, node_id, semantic_kind, sizeof(semantic_kind))) {
      if (err != NULL) snprintf(err, err_cap, "merge conflict: node_id not found in semantic graph: %s", node_id);
      return false;
    }
    char runtime_kind[64];
    runtime_kind[0] = '\0';
    if (runtime_kind_for_node(obj_begin, obj_end, runtime_kind, sizeof(runtime_kind)) &&
        semantic_kind[0] != '\0' && strcmp(runtime_kind, semantic_kind) != 0) {
      if (err != NULL) {
        snprintf(err,
                 err_cap,
                 "merge conflict: node type mismatch node_id=%s semantic=%s runtime=%s",
                 node_id,
                 semantic_kind,
                 runtime_kind);
      }
      return false;
    }
    node_count += 1;
    p = (after != NULL) ? after : (p + 1);
  }
  if (node_count <= 0) {
    if (err != NULL) snprintf(err, err_cap, "runtime trace contains no node_id");
    return false;
  }
  if (out_node_count != NULL) *out_node_count = node_count;
  return true;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  merge_semantic_graph --semantic-graph <path> --style-graph <path> --runtime-trace <path> --out <path>\n");
}

int native_merge_semantic_graph(const char *scripts_dir, int argc, char **argv, int arg_start) {
  (void)scripts_dir;
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  const char *semantic_graph_path = NULL;
  const char *style_graph_path = NULL;
  const char *runtime_trace_path = NULL;
  const char *out_path = NULL;

  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--semantic-graph") == 0) {
      if (i + 1 >= argc) return 2;
      semantic_graph_path = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--style-graph") == 0) {
      if (i + 1 >= argc) return 2;
      style_graph_path = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--runtime-trace") == 0) {
      if (i + 1 >= argc) return 2;
      runtime_trace_path = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out") == 0) {
      if (i + 1 >= argc) return 2;
      out_path = argv[i + 1];
      i += 2;
      continue;
    }
    fprintf(stderr, "[merge-semantic-graph] unknown arg: %s\n", arg);
    return 2;
  }

  if (semantic_graph_path == NULL || style_graph_path == NULL || runtime_trace_path == NULL || out_path == NULL ||
      semantic_graph_path[0] == '\0' || style_graph_path[0] == '\0' || runtime_trace_path[0] == '\0' ||
      out_path[0] == '\0') {
    usage();
    return 2;
  }

  size_t semantic_n = 0u;
  size_t style_n = 0u;
  size_t runtime_n = 0u;
  char *semantic_doc = read_file_all(semantic_graph_path, &semantic_n);
  char *style_doc = read_file_all(style_graph_path, &style_n);
  char *runtime_doc = read_file_all(runtime_trace_path, &runtime_n);
  if (semantic_doc == NULL || style_doc == NULL || runtime_doc == NULL) {
    fprintf(stderr, "[merge-semantic-graph] failed to read input files\n");
    free(semantic_doc);
    free(style_doc);
    free(runtime_doc);
    return 1;
  }

  char route_state[128];
  route_state[0] = '\0';
  if (!find_first_string_value(runtime_doc, "route_state", route_state, sizeof(route_state))) {
    fprintf(stderr, "[merge-semantic-graph] merge conflict: runtime trace route_state missing\n");
    free(semantic_doc);
    free(style_doc);
    free(runtime_doc);
    return 1;
  }
  if (!semantic_has_route_state(semantic_doc, route_state)) {
    fprintf(stderr,
            "[merge-semantic-graph] merge conflict: route unreachable in semantic graph: %s\n",
            route_state);
    free(semantic_doc);
    free(style_doc);
    free(runtime_doc);
    return 1;
  }

  char err[256];
  err[0] = '\0';
  int runtime_nodes = 0;
  if (!scan_runtime_nodes_and_validate(semantic_doc, runtime_doc, err, sizeof(err), &runtime_nodes)) {
    fprintf(stderr, "[merge-semantic-graph] %s\n", err[0] != '\0' ? err : "merge conflict");
    free(semantic_doc);
    free(style_doc);
    free(runtime_doc);
    return 1;
  }

  char out_doc[4096];
  int out_n = snprintf(out_doc,
                       sizeof(out_doc),
                       "{\n"
                       "  \"format\": \"r2c-merged-semantic-graph-v1\",\n"
                       "  \"route_state\": \"%s\",\n"
                       "  \"runtime_node_count\": %d,\n"
                       "  \"semantic_graph_path\": \"%s\",\n"
                       "  \"style_graph_path\": \"%s\",\n"
                       "  \"runtime_trace_path\": \"%s\",\n"
                       "  \"merge_policy\": \"ast-structure-runtime-style\",\n"
                       "  \"ok\": true\n"
                       "}\n",
                       route_state,
                       runtime_nodes,
                       semantic_graph_path,
                       style_graph_path,
                       runtime_trace_path);
  if (out_n <= 0 || (size_t)out_n >= sizeof(out_doc) ||
      write_file_all(out_path, out_doc, (size_t)out_n) != 0) {
    fprintf(stderr, "[merge-semantic-graph] failed to write output: %s\n", out_path);
    free(semantic_doc);
    free(style_doc);
    free(runtime_doc);
    return 1;
  }

  free(semantic_doc);
  free(style_doc);
  free(runtime_doc);
  fprintf(stdout, "[merge-semantic-graph] ok out=%s route=%s nodes=%d\n", out_path, route_state, runtime_nodes);
  return 0;
}
