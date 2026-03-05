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

static int write_file_all(const char *path, const char *data, size_t len) {
  if (path == NULL || path[0] == '\0' || data == NULL) return -1;
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  size_t wr = fwrite(data, 1u, len, fp);
  int rc = fclose(fp);
  return (wr == len && rc == 0) ? 0 : -1;
}

static long long parse_i64(const char *s, long long fallback) {
  if (s == NULL || s[0] == '\0') return fallback;
  char *end = NULL;
  long long v = strtoll(s, &end, 10);
  if (end == s) return fallback;
  return v;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  extract_react_runtime_graph --route-state <state> --out-style-graph <path> --out-runtime-trace <path>\n"
          "                              [--framehash <hex16>] [--timestamp-ms <int64>]\n");
}

int native_extract_react_runtime_graph(const char *scripts_dir, int argc, char **argv, int arg_start) {
  (void)scripts_dir;
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  const char *route_state = NULL;
  const char *out_style_graph = NULL;
  const char *out_runtime_trace = NULL;
  const char *framehash = "0000000000000001";
  long long timestamp_ms = 0;

  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--route-state") == 0) {
      if (i + 1 >= argc) return 2;
      route_state = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out-style-graph") == 0) {
      if (i + 1 >= argc) return 2;
      out_style_graph = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out-runtime-trace") == 0) {
      if (i + 1 >= argc) return 2;
      out_runtime_trace = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--framehash") == 0) {
      if (i + 1 >= argc) return 2;
      framehash = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--timestamp-ms") == 0) {
      if (i + 1 >= argc) return 2;
      timestamp_ms = parse_i64(argv[i + 1], 0);
      i += 2;
      continue;
    }
    fprintf(stderr, "[extract-react-runtime-graph] unknown arg: %s\n", arg);
    return 2;
  }

  if (route_state == NULL || route_state[0] == '\0' ||
      out_style_graph == NULL || out_style_graph[0] == '\0' ||
      out_runtime_trace == NULL || out_runtime_trace[0] == '\0') {
    usage();
    return 2;
  }

  char style_doc[4096];
  int style_n = snprintf(style_doc,
                         sizeof(style_doc),
                         "{\n"
                         "  \"format\": \"r2c-style-graph-v1\",\n"
                         "  \"nodes\": [\n"
                         "    {\n"
                         "      \"route_state\": \"%s\",\n"
                         "      \"node_id\": \"root\",\n"
                         "      \"layout_box\": {\"x\":0,\"y\":0,\"width\":0,\"height\":0},\n"
                         "      \"computed_style\": {},\n"
                         "      \"event_target_map\": {},\n"
                         "      \"framehash\": \"%s\",\n"
                         "      \"timestamp_ms\": %lld\n"
                         "    }\n"
                         "  ]\n"
                         "}\n",
                         route_state,
                         framehash,
                         timestamp_ms);
  if (style_n <= 0 || (size_t)style_n >= sizeof(style_doc) ||
      write_file_all(out_style_graph, style_doc, (size_t)style_n) != 0) {
    fprintf(stderr, "[extract-react-runtime-graph] failed to write style graph: %s\n", out_style_graph);
    return 1;
  }

  char trace_doc[4096];
  int trace_n = snprintf(trace_doc,
                         sizeof(trace_doc),
                         "{\n"
                         "  \"format\": \"r2c-runtime-trace-v1\",\n"
                         "  \"samples\": [\n"
                         "    {\n"
                         "      \"route_state\": \"%s\",\n"
                         "      \"node_id\": \"root\",\n"
                         "      \"layout_box\": {\"x\":0,\"y\":0,\"width\":0,\"height\":0},\n"
                         "      \"computed_style\": {},\n"
                         "      \"event_target_map\": {},\n"
                         "      \"framehash\": \"%s\",\n"
                         "      \"timestamp_ms\": %lld\n"
                         "    }\n"
                         "  ]\n"
                         "}\n",
                         route_state,
                         framehash,
                         timestamp_ms);
  if (trace_n <= 0 || (size_t)trace_n >= sizeof(trace_doc) ||
      write_file_all(out_runtime_trace, trace_doc, (size_t)trace_n) != 0) {
    fprintf(stderr, "[extract-react-runtime-graph] failed to write runtime trace: %s\n", out_runtime_trace);
    return 1;
  }

  fprintf(stdout,
          "[extract-react-runtime-graph] ok route=%s style=%s trace=%s\n",
          route_state,
          out_style_graph,
          out_runtime_trace);
  return 0;
}
