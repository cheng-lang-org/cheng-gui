#define _POSIX_C_SOURCE 200809L

#include "native_verify_r2c_equivalence_android_native.h"

#include "native_r2c_report_validate.h"
#include "native_verify_android_claude_1to1_gate.h"
#include "native_verify_android_fullroute_visual_pixel.h"

#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

static void strlist_free(StringList *list) {
  if (list == NULL) return;
  for (size_t i = 0u; i < list->len; ++i) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static int strlist_push(StringList *list, const char *value) {
  if (list == NULL || value == NULL || value[0] == '\0') return -1;
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

static int parse_fullroute_states(const char *states_json_path, StringList *out_states) {
  if (states_json_path == NULL || out_states == NULL) return -1;
  memset(out_states, 0, sizeof(*out_states));
  size_t n = 0u;
  char *doc = read_file_all(states_json_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return -1;
  }
  const char *key = strstr(doc, "\"states\"");
  if (key == NULL) {
    free(doc);
    return -1;
  }
  const char *p = strchr(key, '[');
  if (p == NULL) {
    free(doc);
    return -1;
  }
  p += 1;
  while (*p != '\0') {
    while (*p != '\0' && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n' || *p == ',')) p += 1;
    if (*p == ']') break;
    if (*p != '"') {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    p += 1;
    const char *start = p;
    while (*p != '\0' && *p != '"') {
      if (*p == '\\' && p[1] != '\0') p += 2;
      else p += 1;
    }
    if (*p != '"') {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    size_t len = (size_t)(p - start);
    if (len == 0u || len >= 128u) {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    char token[128];
    memcpy(token, start, len);
    token[len] = '\0';
    if (strlist_push(out_states, token) != 0) {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    p += 1;
  }
  free(doc);
  return out_states->len > 0u ? 0 : -1;
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

static int parse_string_array_in_range(const char *start, const char *end, StringList *out_items) {
  if (start == NULL || end == NULL || out_items == NULL || end <= start) return -1;
  memset(out_items, 0, sizeof(*out_items));
  const char *p = start;
  while (p < end) {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n' || *p == ',')) p += 1;
    if (p >= end || *p == ']') break;
    if (*p != '"') {
      strlist_free(out_items);
      return -1;
    }
    p += 1;
    const char *token_start = p;
    while (p < end && *p != '"') {
      if (*p == '\\' && (p + 1) < end) p += 2;
      else p += 1;
    }
    if (p >= end || *p != '"') {
      strlist_free(out_items);
      return -1;
    }
    size_t len = (size_t)(p - token_start);
    if (len == 0u || len >= 256u) {
      strlist_free(out_items);
      return -1;
    }
    char token[256];
    memcpy(token, token_start, len);
    token[len] = '\0';
    if (strlist_push(out_items, token) != 0) {
      strlist_free(out_items);
      return -1;
    }
    p += 1;
  }
  return out_items->len > 0u ? 0 : -1;
}

static int parse_route_layer_states(const char *layers_json_path,
                                    int layer_index,
                                    int *out_layer_count,
                                    StringList *out_states,
                                    StringList *out_dependencies) {
  if (layers_json_path == NULL || layer_index < 0 || out_states == NULL || out_dependencies == NULL) return -1;
  memset(out_states, 0, sizeof(*out_states));
  memset(out_dependencies, 0, sizeof(*out_dependencies));
  if (out_layer_count != NULL) *out_layer_count = 0;
  size_t n = 0u;
  char *doc = read_file_all(layers_json_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return -1;
  }
  int parsed_layer_count = 0;
  if (parse_int_key(doc, "layer_count", &parsed_layer_count) == 0 && out_layer_count != NULL) {
    *out_layer_count = parsed_layer_count;
  }

  const char *p = doc;
  while ((p = strstr(p, "\"layer_index\"")) != NULL) {
    const char *colon = strchr(p, ':');
    if (colon == NULL) break;
    char *end_num = NULL;
    long current = strtol(colon + 1, &end_num, 10);
    if (end_num == colon + 1) {
      p += strlen("\"layer_index\"");
      continue;
    }
    const char *obj_end = strchr(end_num, '}');
    if (obj_end == NULL) break;
    if ((int)current == layer_index) {
      const char *routes_key = strstr(end_num, "\"routes\"");
      if (routes_key == NULL || routes_key >= obj_end) {
        free(doc);
        return -1;
      }
      const char *routes_arr = strchr(routes_key, '[');
      if (routes_arr == NULL || routes_arr >= obj_end) {
        free(doc);
        return -1;
      }
      const char *routes_end = strchr(routes_arr, ']');
      if (routes_end == NULL || routes_end >= obj_end) {
        free(doc);
        return -1;
      }
      if (parse_string_array_in_range(routes_arr + 1, routes_end, out_states) != 0) {
        free(doc);
        return -1;
      }

      const char *deps_key = strstr(routes_end, "\"blocking_dependencies\"");
      if (deps_key != NULL && deps_key < obj_end) {
        const char *deps_arr = strchr(deps_key, '[');
        const char *deps_end = (deps_arr != NULL) ? strchr(deps_arr, ']') : NULL;
        if (deps_arr != NULL && deps_end != NULL && deps_end < obj_end) {
          (void)parse_string_array_in_range(deps_arr + 1, deps_end, out_dependencies);
        }
      }
      free(doc);
      return 0;
    }
    p = obj_end + 1;
  }

  free(doc);
  return -1;
}

static int validate_truth_assets_for_states(const char *truth_dir, const StringList *states) {
  if (truth_dir == NULL || truth_dir[0] == '\0') {
    fprintf(stderr, "[verify-r2c-android-native] missing truth-dir for fullroute runtime gate\n");
    return -1;
  }
  if (!nr_dir_exists(truth_dir)) {
    fprintf(stderr, "[verify-r2c-android-native] truth-dir not found: %s\n", truth_dir);
    return -1;
  }
  if (states == NULL || states->len == 0u) {
    fprintf(stderr, "[verify-r2c-android-native] fullroute states is empty\n");
    return -1;
  }
  for (size_t i = 0u; i < states->len; ++i) {
    const char *state = states->items[i];
    if (state == NULL || state[0] == '\0') {
      fprintf(stderr, "[verify-r2c-android-native] invalid empty route state at index=%zu\n", i);
      return -1;
    }
    char rgba[PATH_MAX];
    char meta[PATH_MAX];
    if (snprintf(rgba, sizeof(rgba), "%s/%s.rgba", truth_dir, state) >= (int)sizeof(rgba) ||
        snprintf(meta, sizeof(meta), "%s/%s.meta.json", truth_dir, state) >= (int)sizeof(meta)) {
      fprintf(stderr,
              "[verify-r2c-android-native] truth path overflow route=%s truth-dir=%s\n",
              state,
              truth_dir);
      return -1;
    }
    if (!nr_file_exists(rgba)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing truth rgba for route=%s path=%s\n",
              state,
              rgba);
      return -1;
    }
    if (!nr_file_exists(meta)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing truth meta for route=%s path=%s\n",
              state,
              meta);
      return -1;
    }
  }
  return 0;
}

static bool path_is_under_root(const char *path, const char *root) {
  if (path == NULL || root == NULL || path[0] == '\0' || root[0] == '\0') return false;
  size_t root_n = strlen(root);
  size_t path_n = strlen(path);
  if (path_n < root_n) return false;
  if (strncmp(path, root, root_n) != 0) return false;
  if (path_n == root_n) return true;
  char c = path[root_n];
  return (c == '/' || c == '\0');
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
          "  verify_r2c_equivalence_android_native [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--android-fullroute 0|1] [--route-state <state>] [--truth-dir <abs>] [--layer-index <n>]\n"
          "\n"
          "Native Android equivalence gate (no shell/python fallback).\n");
}

int native_verify_r2c_equivalence_android_native(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  char root[PATH_MAX];
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[verify-r2c-android-native] missing scripts dir\n");
    return 2;
  }
  snprintf(root, sizeof(root), "%s", scripts_dir);
  size_t root_len = strlen(root);
  if (root_len >= 12u && strcmp(root + root_len - 12u, "/src/scripts") == 0) {
    root[root_len - 12u] = '\0';
  } else if (root_len >= 8u && strcmp(root + root_len - 8u, "/scripts") == 0) {
    root[root_len - 8u] = '\0';
  }

  const char *project = getenv("R2C_REAL_PROJECT");
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  const char *entry = getenv("R2C_REAL_ENTRY");
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";

  char out_default[PATH_MAX];
  if (nr_path_join(out_default, sizeof(out_default), root, "build/r2c_equivalence_android_native") != 0) return 2;
  const char *out_dir = out_default;

  const char *android_fullroute = getenv("CHENG_ANDROID_EQ_ENABLE_FULLROUTE");
  if (android_fullroute == NULL || android_fullroute[0] == '\0') android_fullroute = "0";
  const char *route_state = getenv("CHENG_ANDROID_1TO1_ROUTE_STATE");
  const char *truth_dir = getenv("CHENG_ANDROID_1TO1_TRUTH_DIR");
  const char *layer_index_env = getenv("CHENG_ANDROID_EQ_LAYER_INDEX");
  const char *runtime_required = getenv("CHENG_ANDROID_EQ_REQUIRE_RUNTIME");
  if (runtime_required == NULL || runtime_required[0] == '\0') runtime_required = "1";
  int layer_index = -1;
  if (layer_index_env != NULL && layer_index_env[0] != '\0') {
    layer_index = atoi(layer_index_env);
  }

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
    if (strcmp(arg, "--android-fullroute") == 0) {
      if (i + 1 >= argc) return 2;
      android_fullroute = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--route-state") == 0) {
      if (i + 1 >= argc) return 2;
      route_state = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--truth-dir") == 0) {
      if (i + 1 >= argc) return 2;
      truth_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--layer-index") == 0) {
      if (i + 1 >= argc) return 2;
      layer_index = atoi(argv[i + 1]);
      i += 2;
      continue;
    }
    fprintf(stderr, "[verify-r2c-android-native] unknown arg: %s\n", arg);
    return 2;
  }

  if ((strcmp(android_fullroute, "0") != 0) && (strcmp(android_fullroute, "1") != 0)) {
    fprintf(stderr,
            "[verify-r2c-android-native] invalid --android-fullroute: %s (expect 0 or 1)\n",
            android_fullroute);
    return 2;
  }
  if ((strcmp(runtime_required, "0") != 0) && (strcmp(runtime_required, "1") != 0)) {
    fprintf(stderr,
            "[verify-r2c-android-native] invalid CHENG_ANDROID_EQ_REQUIRE_RUNTIME: %s (expect 0 or 1)\n",
            runtime_required);
    return 2;
  }
  if (!path_is_under_root(project, root)) {
    setenv("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX", "1", 1);
  }

  if (nr_ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[verify-r2c-android-native] failed to create out dir: %s\n", out_dir);
    return 1;
  }

  fprintf(stdout, "== r2c native equivalence: android gate ==\n");
  fprintf(stdout, "[verify-r2c-android-native] android fullroute(requested)=%s\n", android_fullroute);
  fprintf(stdout, "[verify-r2c-android-native] android fullroute(readiness-phase)=0\n");
  fprintf(stdout, "[verify-r2c-android-native] android runtime(required)=%s\n", runtime_required);
  if (route_state != NULL && route_state[0] != '\0') {
    fprintf(stdout, "[verify-r2c-android-native] route-state=%s\n", route_state);
    setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", route_state, 1);
  }
  if (layer_index >= 0) {
    fprintf(stdout, "[verify-r2c-android-native] layer-index=%d\n", layer_index);
  }
  if (truth_dir != NULL && truth_dir[0] != '\0') {
    fprintf(stdout, "[verify-r2c-android-native] truth-dir=%s\n", truth_dir);
    setenv("CHENG_ANDROID_1TO1_TRUTH_DIR", truth_dir, 1);
  }

  if (layer_index >= 0) {
    char layer_gate_value[64];
    snprintf(layer_gate_value, sizeof(layer_gate_value), "layer-%d", layer_index);
    setenv("R2C_CURRENT_LAYER_GATE", layer_gate_value, 1);
  } else {
    setenv("R2C_CURRENT_LAYER_GATE", "all", 1);
  }

  bool fullroute_runtime_loop =
      (strcmp(android_fullroute, "1") == 0 &&
       (route_state == NULL || route_state[0] == '\0'));
  setenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", "0", 1);
  setenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", fullroute_runtime_loop ? "0" : runtime_required, 1);

  char *gate_argv[] = {
      "verify_android_claude_1to1_gate",
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      (char *)out_dir,
      NULL,
  };
  int gate_rc = native_verify_android_claude_1to1_gate(scripts_dir, 7, gate_argv, 1);
  if (gate_rc != 0) return gate_rc;

  char report_json[PATH_MAX];
  if (nr_path_join(report_json,
                   sizeof(report_json),
                   out_dir,
                   "claude_compile/r2capp/r2capp_compile_report.json") != 0) {
    return 1;
  }

  char err[512];
  if (nr_validate_compile_report(report_json, "truth_trace_manifest_android_path", project, err, sizeof(err)) != 0) {
    fprintf(stderr, "[verify-r2c-android-native] %s\n", err);
    return 1;
  }
  fprintf(stdout, "[verify-r2c-android-native] report fields ok\n");

  if (strcmp(android_fullroute, "1") == 0) {
    char compile_out[PATH_MAX];
    char states_json[PATH_MAX];
    if (nr_path_join(compile_out, sizeof(compile_out), out_dir, "claude_compile") != 0 ||
        nr_path_join(states_json,
                     sizeof(states_json),
                     compile_out,
                     "r2capp/r2c_fullroute_states.json") != 0) {
      return 1;
    }
    if (!nr_file_exists(states_json)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing fullroute states json: %s\n",
              states_json);
      return 1;
    }

    fprintf(stdout, "== r2c native equivalence: android fullroute runtime hash gate ==\n");
    setenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", runtime_required, 1);
    StringList states;
    memset(&states, 0, sizeof(states));
    StringList layer_deps;
    memset(&layer_deps, 0, sizeof(layer_deps));
    if (route_state != NULL && route_state[0] != '\0') {
      if (strlist_push(&states, route_state) != 0) {
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
    } else if (layer_index >= 0) {
      char route_layers_json[PATH_MAX];
      if (nr_path_join(route_layers_json,
                       sizeof(route_layers_json),
                       compile_out,
                       "r2capp/r2c_route_layers.json") != 0 ||
          !nr_file_exists(route_layers_json)) {
        fprintf(stderr,
                "[verify-r2c-android-native] missing route layers json for --layer-index=%d: %s\n",
                layer_index,
                route_layers_json);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      int total_layers = 0;
      if (parse_route_layer_states(route_layers_json, layer_index, &total_layers, &states, &layer_deps) != 0 ||
          states.len == 0u) {
        fprintf(stderr,
                "[verify-r2c-android-native] failed to resolve layer routes layer=%d from %s\n",
                layer_index,
                route_layers_json);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      fprintf(stdout,
              "[verify-r2c-android-native] layer-gate route set resolved layer=%d/%d routes=%zu deps=%zu\n",
              layer_index,
              total_layers,
              states.len,
              layer_deps.len);
    } else if (parse_fullroute_states(states_json, &states) != 0 || states.len == 0u) {
      fprintf(stderr,
              "[verify-r2c-android-native] failed to parse fullroute states: %s\n",
              states_json);
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 1;
    }

    int limit = 0;
    const char *limit_env = getenv("CHENG_ANDROID_EQ_FULLROUTE_LIMIT");
    if (limit_env != NULL && limit_env[0] != '\0') {
      limit = atoi(limit_env);
    }
    if (limit > 0 && (size_t)limit < states.len) {
      states.len = (size_t)limit;
    }

    char auto_truth_dir[PATH_MAX];
    auto_truth_dir[0] = '\0';
    const char *truth_dir_in_use = truth_dir;
    if (truth_dir_in_use == NULL || truth_dir_in_use[0] == '\0') {
      if (nr_path_join(auto_truth_dir, sizeof(auto_truth_dir), compile_out, "r2capp/truth") != 0 ||
          !nr_dir_exists(auto_truth_dir)) {
        fprintf(stderr,
                "[verify-r2c-android-native] fullroute runtime gate requires --truth-dir or compile truth dir: %s\n",
                auto_truth_dir);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      truth_dir_in_use = auto_truth_dir;
      fprintf(stdout,
              "[verify-r2c-android-native] truth-dir(auto)=%s\n",
              truth_dir_in_use);
    }
    if (validate_truth_assets_for_states(truth_dir_in_use, &states) != 0) {
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 1;
    }
    setenv("CHENG_ANDROID_1TO1_TRUTH_DIR", truth_dir_in_use, 1);

    const char *prev_skip_compile = getenv("CHENG_ANDROID_1TO1_SKIP_COMPILE");
    const char *prev_skip_install = getenv("CHENG_ANDROID_SKIP_INSTALL");
    setenv("CHENG_ANDROID_1TO1_SKIP_COMPILE", "1", 1);
    setenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", "0", 1);
    setenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL", "1", 1);
    unsetenv("CHENG_ANDROID_SKIP_INSTALL");
    int route_fail = 0;
    for (size_t i = 0u; i < states.len; ++i) {
      const char *state = states.items[i];
      fprintf(stdout,
              "[verify-r2c-android-native] fullroute runtime state[%zu/%zu]=%s\n",
              i + 1u,
              states.len,
              state);
      if (i > 0u) {
        setenv("CHENG_ANDROID_SKIP_INSTALL", "1", 1);
      }
      setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", state, 1);
      char *route_gate_argv[] = {
          "verify_android_claude_1to1_gate",
          "--project",
          (char *)project,
          "--entry",
          (char *)entry,
          "--out",
          (char *)out_dir,
          "--route-state",
          (char *)state,
          "--truth-dir",
          (char *)truth_dir_in_use,
          NULL,
      };
      int route_rc = native_verify_android_claude_1to1_gate(scripts_dir, 11, route_gate_argv, 1);
      if (route_rc != 0) {
        route_fail = route_rc;
        break;
      }
    }
    if (prev_skip_compile != NULL) {
      setenv("CHENG_ANDROID_1TO1_SKIP_COMPILE", prev_skip_compile, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_SKIP_COMPILE");
    }
    if (prev_skip_install != NULL) {
      setenv("CHENG_ANDROID_SKIP_INSTALL", prev_skip_install, 1);
    } else {
      unsetenv("CHENG_ANDROID_SKIP_INSTALL");
    }
    unsetenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
    strlist_free(&states);
    strlist_free(&layer_deps);
    if (route_fail != 0) return route_fail;
  }

  fprintf(stdout, "[verify-r2c-android-native] ok\n");
  return 0;
}
