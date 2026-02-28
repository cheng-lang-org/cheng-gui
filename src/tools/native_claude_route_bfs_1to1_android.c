#define _POSIX_C_SOURCE 200809L

#include "native_claude_route_bfs_1to1_android.h"

#include "native_capture_route_layer_android.h"
#include "native_r2c_compile_react_project.h"
#include "native_r2c_report_validate.h"
#include "native_verify_route_layer_android.h"

#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
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

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  claude_route_bfs_1to1_android [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--capture-source unimaker_foreground_runtime_visible] [--stop-on-fail 0|1] [--first-install-pass 0|1]\n");
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
  const char *capture_source = "unimaker_foreground_runtime_visible";
  int stop_on_fail = 1;
  int first_install_pass = 0;

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
    if (strcmp(arg, "--capture-source") == 0) {
      if (i + 1 >= argc) return 2;
      capture_source = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--stop-on-fail") == 0) {
      if (i + 1 >= argc) return 2;
      stop_on_fail = atoi(argv[i + 1]) != 0 ? 1 : 0;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--first-install-pass") == 0) {
      if (i + 1 >= argc) return 2;
      first_install_pass = atoi(argv[i + 1]) != 0 ? 1 : 0;
      i += 2;
      continue;
    }
    fprintf(stderr, "[claude-route-bfs-android] unknown arg: %s\n", arg);
    return 2;
  }

  if (strcmp(capture_source, "unimaker_foreground_runtime_visible") != 0) {
    fprintf(stderr, "[claude-route-bfs-android] capture-source must be unimaker_foreground_runtime_visible\n");
    return 2;
  }
  setenv("CHENG_ANDROID_FIRST_INSTALL_PASS", first_install_pass ? "1" : "0", 1);

  char out_abs[PATH_MAX];
  if (to_abs_path(out_dir, out_abs, sizeof(out_abs)) != 0) return 2;
  if (nr_ensure_dir(out_abs) != 0) return 1;

  char compile_out[PATH_MAX];
  if (nr_path_join(compile_out, sizeof(compile_out), out_abs, "compile") != 0) return 1;
  if (nr_ensure_dir(compile_out) != 0) return 1;

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
  int rc = native_r2c_compile_react_project(scripts_dir, 8, compile_argv, 1);
  if (rc != 0) return rc;

  char report_json[PATH_MAX];
  if (nr_path_join(report_json, sizeof(report_json), compile_out, "r2capp/r2capp_compile_report.json") != 0 ||
      !nr_file_exists(report_json)) {
    fprintf(stderr, "[claude-route-bfs-android] missing report: %s\n", report_json);
    return 1;
  }
  size_t report_n = 0u;
  char *report_doc = read_file_all_local(report_json, &report_n);
  if (report_doc == NULL || report_n == 0u) {
    free(report_doc);
    fprintf(stderr, "[claude-route-bfs-android] failed to read report\n");
    return 1;
  }
  int layer_count = 0;
  if (parse_int_key(report_doc, "layer_count", &layer_count) != 0 || layer_count <= 0) {
    free(report_doc);
    fprintf(stderr, "[claude-route-bfs-android] invalid layer_count\n");
    return 1;
  }
  free(report_doc);

  char truth_dir[PATH_MAX];
  if (nr_path_join(truth_dir, sizeof(truth_dir), compile_out, "r2capp/truth") != 0) return 1;
  if (nr_ensure_dir(truth_dir) != 0) return 1;

  int has_failure = 0;
  for (int layer = 0; layer < layer_count; ++layer) {
    char layer_text[32];
    snprintf(layer_text, sizeof(layer_text), "%d", layer);
    fprintf(stdout, "== claude bfs 1:1 android: layer %d/%d capture ==\n", layer, layer_count - 1);
    char *cap_argv[] = {
        "capture_route_layer_android",
        "--project",
        (char *)project,
        "--entry",
        (char *)entry,
        "--out",
        out_abs,
        "--compile-out",
        compile_out,
        "--truth-dir",
        truth_dir,
        "--layer-index",
        layer_text,
        "--capture-source",
        (char *)capture_source,
        "--first-install-pass",
        first_install_pass ? "1" : "0",
        NULL,
    };
    rc = native_capture_route_layer_android(scripts_dir, 17, cap_argv, 1);
    if (rc != 0) {
      has_failure = rc;
      fprintf(stderr, "[claude-route-bfs-android] capture failed at layer=%d rc=%d\n", layer, rc);
      if (stop_on_fail) return rc;
      continue;
    }

    char verify_out[PATH_MAX];
    char verify_suffix[64];
    snprintf(verify_suffix, sizeof(verify_suffix), "verify_layer_%d", layer);
    if (nr_path_join(verify_out, sizeof(verify_out), out_abs, verify_suffix) != 0) return 1;
    if (nr_ensure_dir(verify_out) != 0) return 1;
    fprintf(stdout, "== claude bfs 1:1 android: layer %d/%d verify ==\n", layer, layer_count - 1);
    char *verify_argv[] = {
        "verify_route_layer_android",
        "--project",
        (char *)project,
        "--entry",
        (char *)entry,
        "--out",
        verify_out,
        "--truth-dir",
        truth_dir,
        "--layer-index",
        layer_text,
        NULL,
    };
    rc = native_verify_route_layer_android(scripts_dir, 11, verify_argv, 1);
    if (rc != 0) {
      has_failure = rc;
      fprintf(stderr, "[claude-route-bfs-android] verify failed at layer=%d rc=%d\n", layer, rc);
      if (stop_on_fail) return rc;
      continue;
    }
  }

  if (has_failure != 0) return has_failure;
  fprintf(stdout, "[claude-route-bfs-android] ok\n");
  return 0;
}
