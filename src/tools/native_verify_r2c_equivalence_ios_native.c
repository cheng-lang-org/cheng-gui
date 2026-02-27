#define _POSIX_C_SOURCE 200809L

#include "native_verify_r2c_equivalence_ios_native.h"

#include "native_mobile_run_ios.h"
#include "native_r2c_compile_react_project.h"
#include "native_r2c_report_validate.h"

#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

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

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  verify_r2c_equivalence_ios_native [--project <abs>] [--entry </app/main.tsx>] [--out <abs>]\n"
          "\n"
          "Native iOS equivalence gate (no local shell/python fallback).\n");
}

int native_verify_r2c_equivalence_ios_native(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  char root[PATH_MAX];
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[verify-r2c-ios-native] missing scripts dir\n");
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
  if (nr_path_join(out_default, sizeof(out_default), root, "build/r2c_equivalence_ios_native") != 0) return 2;
  const char *out_dir = out_default;

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
    fprintf(stderr, "[verify-r2c-ios-native] unknown arg: %s\n", arg);
    return 2;
  }

  char out_dir_abs[PATH_MAX];
  if (to_abs_path(out_dir, out_dir_abs, sizeof(out_dir_abs)) != 0) {
    fprintf(stderr, "[verify-r2c-ios-native] invalid out dir: %s\n", out_dir);
    return 2;
  }
  out_dir = out_dir_abs;

  char compile_out[PATH_MAX];
  char native_out[PATH_MAX];
  if (nr_path_join(compile_out, sizeof(compile_out), out_dir, "compile") != 0 ||
      nr_path_join(native_out, sizeof(native_out), out_dir, "native") != 0) {
    return 1;
  }
  if (nr_ensure_dir(compile_out) != 0 || nr_ensure_dir(native_out) != 0) {
    fprintf(stderr, "[verify-r2c-ios-native] failed to create output directories\n");
    return 1;
  }

  setenv("STRICT_GATE_CONTEXT", "1", 1);
  setenv("R2C_TARGET_MATRIX", "ios", 1);
  setenv("R2C_RUNTIME_TEXT_SOURCE", "project", 1);
  setenv("R2C_RUNTIME_ROUTE_TITLE_SOURCE", "project", 1);
  setenv("R2C_SKIP_HOST_RUNTIME_BIN_BUILD", "1", 1);
  setenv("R2C_SKIP_COMPILER_RUN", "0", 1);
  setenv("R2C_TRY_COMPILER_FIRST", "1", 1);
  setenv("R2C_REUSE_COMPILER_BIN", "0", 1);
  setenv("R2C_SKIP_COMPILER_EXEC", "0", 1);
  setenv("R2C_STRICT_SKIP_COMPILER_EXEC_DEFAULT", "0", 1);
  setenv("R2C_STRICT_ALLOW_SEMANTIC_SHELL_GENERATOR", "0", 1);
  if (getenv("R2C_COMPILER_RUN_TIMEOUT_SEC") == NULL) setenv("R2C_COMPILER_RUN_TIMEOUT_SEC", "180", 1);
  if (getenv("CHENG_IOS_REQUIRE_XCODE_BUILD") == NULL) setenv("CHENG_IOS_REQUIRE_XCODE_BUILD", "1", 1);

  fprintf(stdout, "== r2c native equivalence: ios compile ==\n");
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
  int compile_rc = native_r2c_compile_react_project(scripts_dir, 8, compile_argv, 1);
  if (compile_rc != 0) return compile_rc;

  char report_json[PATH_MAX];
  if (nr_path_join(report_json, sizeof(report_json), compile_out, "r2capp/r2capp_compile_report.json") != 0) {
    return 1;
  }

  char err[512];
  if (nr_validate_compile_report(report_json, "truth_trace_manifest_ios_path", project, err, sizeof(err)) != 0) {
    fprintf(stderr, "[verify-r2c-ios-native] %s\n", err);
    return 1;
  }
  fprintf(stdout, "[verify-r2c-ios-native] report fields ok\n");

  char entry_cheng[PATH_MAX];
  if (nr_path_join(entry_cheng, sizeof(entry_cheng), compile_out, "r2capp/src/entry.cheng") != 0 ||
      !nr_file_exists(entry_cheng)) {
    fprintf(stderr, "[verify-r2c-ios-native] missing generated entry: %s\n", entry_cheng);
    return 1;
  }

  fprintf(stdout, "== r2c native equivalence: ios native release build ==\n");
  char *run_argv[] = {
      "mobile_run_ios",
      "--file",
      entry_cheng,
      "--name",
      "r2c_ios_native_equivalence",
      "--out",
      native_out,
      NULL,
  };
  int run_rc = native_mobile_run_ios(scripts_dir, 7, run_argv, 1);
  if (run_rc != 0) return run_rc;

  fprintf(stdout, "[verify-r2c-ios-native] ok\n");
  return 0;
}
