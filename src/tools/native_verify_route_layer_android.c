#define _POSIX_C_SOURCE 200809L

#include "native_verify_route_layer_android.h"

#include "native_r2c_report_validate.h"
#include "native_verify_r2c_equivalence_android_native.h"

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

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  verify_route_layer_android --layer-index <n> [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--truth-dir <abs>]\n");
}

int native_verify_route_layer_android(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }
  const char *project = getenv("R2C_REAL_PROJECT");
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  const char *entry = getenv("R2C_REAL_ENTRY");
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";
  const char *out_dir = NULL;
  const char *truth_dir = getenv("CHENG_ANDROID_1TO1_TRUTH_DIR");
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
    fprintf(stderr, "[verify-route-layer-android] unknown arg: %s\n", arg);
    return 2;
  }

  if (layer_index < 0) {
    fprintf(stderr, "[verify-route-layer-android] --layer-index is required\n");
    return 2;
  }
  if (out_dir == NULL || out_dir[0] == '\0') {
    fprintf(stderr, "[verify-route-layer-android] --out is required\n");
    return 2;
  }
  if (truth_dir == NULL || truth_dir[0] == '\0') {
    fprintf(stderr, "[verify-route-layer-android] --truth-dir is required\n");
    return 2;
  }

  char out_abs[PATH_MAX];
  if (to_abs_path(out_dir, out_abs, sizeof(out_abs)) != 0) {
    fprintf(stderr, "[verify-route-layer-android] invalid --out: %s\n", out_dir);
    return 2;
  }
  char truth_abs[PATH_MAX];
  if (to_abs_path(truth_dir, truth_abs, sizeof(truth_abs)) != 0) {
    fprintf(stderr, "[verify-route-layer-android] invalid --truth-dir: %s\n", truth_dir);
    return 2;
  }
  if (nr_ensure_dir(out_abs) != 0) {
    fprintf(stderr, "[verify-route-layer-android] failed to create out dir: %s\n", out_abs);
    return 1;
  }

  setenv("CHENG_ANDROID_EQ_REQUIRE_RUNTIME", "1", 1);
  setenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", "1", 1);
  unsetenv("CHENG_ANDROID_1TO1_ROUTE_STATE");
  char layer_text[32];
  snprintf(layer_text, sizeof(layer_text), "%d", layer_index);
  char *eq_argv[] = {
      "verify_r2c_equivalence_android_native",
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      out_abs,
      "--android-fullroute",
      "1",
      "--layer-index",
      layer_text,
      "--truth-dir",
      truth_abs,
      NULL,
  };
  return native_verify_r2c_equivalence_android_native(scripts_dir, 13, eq_argv, 1);
}
