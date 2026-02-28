#define _POSIX_C_SOURCE 200809L

#include "native_verify_r2c_equivalence_all_native.h"

#include "native_r2c_report_validate.h"
#include "native_verify_r2c_equivalence_android_native.h"
#include "native_verify_r2c_equivalence_harmony_native.h"
#include "native_verify_r2c_equivalence_ios_native.h"

#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
          "  verify_r2c_equivalence_all_native [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--platform android|all] [--android-fullroute 0|1] [--android-layer-index <n>] [--layer-index <n>]\n"
          "\n"
          "Native all-platform equivalence gate (android + ios + harmony).\n");
}

int native_verify_r2c_equivalence_all_native(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  char root[PATH_MAX];
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[verify-r2c-all-native] missing scripts dir\n");
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
  if (nr_path_join(out_default, sizeof(out_default), root, "build/r2c_equivalence_all_native") != 0) return 2;
  const char *out_dir = out_default;

  const char *android_fullroute = getenv("CHENG_ANDROID_EQ_ENABLE_FULLROUTE");
  if (android_fullroute == NULL || android_fullroute[0] == '\0') android_fullroute = "0";
  const char *android_layer_index = getenv("CHENG_ANDROID_EQ_LAYER_INDEX");
  if (android_layer_index == NULL) android_layer_index = "";
  const char *platform = getenv("CHENG_R2C_EQ_PLATFORM");
  if (platform == NULL || platform[0] == '\0') platform = "all";

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
    if (strcmp(arg, "--android-layer-index") == 0) {
      if (i + 1 >= argc) return 2;
      android_layer_index = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--layer-index") == 0) {
      if (i + 1 >= argc) return 2;
      android_layer_index = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--platform") == 0) {
      if (i + 1 >= argc) return 2;
      platform = argv[i + 1];
      i += 2;
      continue;
    }
    fprintf(stderr, "[verify-r2c-all-native] unknown arg: %s\n", arg);
    return 2;
  }

  if ((strcmp(android_fullroute, "0") != 0) && (strcmp(android_fullroute, "1") != 0)) {
    fprintf(stderr,
            "[verify-r2c-all-native] invalid --android-fullroute: %s (expect 0 or 1)\n",
            android_fullroute);
    return 2;
  }
  if (strcmp(platform, "android") != 0 && strcmp(platform, "all") != 0) {
    fprintf(stderr, "[verify-r2c-all-native] invalid --platform: %s (expect android or all)\n", platform);
    return 2;
  }
  if (!path_is_under_root(project, root)) {
    setenv("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX", "1", 1);
  }
  {
    char compat_err[512];
    if (nr_enforce_no_compat_mounts(root, compat_err, sizeof(compat_err)) != 0) {
      fprintf(stderr, "[verify-r2c-all-native] %s\n", compat_err);
      return 1;
    }
    if (nr_enforce_no_legacy_gui_imports(root, compat_err, sizeof(compat_err)) != 0) {
      fprintf(stderr, "[verify-r2c-all-native] %s\n", compat_err);
      return 1;
    }
  }

  if (nr_ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[verify-r2c-all-native] failed to create out dir: %s\n", out_dir);
    return 1;
  }

  fprintf(stdout, "== all-native equivalence: android ==\n");
  char android_out[PATH_MAX];
  if (nr_path_join(android_out, sizeof(android_out), out_dir, "android") != 0) return 1;
  char *android_argv[16];
  int android_argc = 0;
  android_argv[android_argc++] = "verify_r2c_equivalence_android_native";
  android_argv[android_argc++] = "--project";
  android_argv[android_argc++] = (char *)project;
  android_argv[android_argc++] = "--entry";
  android_argv[android_argc++] = (char *)entry;
  android_argv[android_argc++] = "--out";
  android_argv[android_argc++] = android_out;
  android_argv[android_argc++] = "--android-fullroute";
  android_argv[android_argc++] = (char *)android_fullroute;
  if (android_layer_index != NULL && android_layer_index[0] != '\0') {
    android_argv[android_argc++] = "--layer-index";
    android_argv[android_argc++] = (char *)android_layer_index;
  }
  android_argv[android_argc] = NULL;
  int rc = native_verify_r2c_equivalence_android_native(scripts_dir, android_argc, android_argv, 1);
  if (rc != 0) return rc;
  if (strcmp(platform, "android") == 0) {
    fprintf(stdout, "[verify-r2c-all-native] ok (platform=android)\n");
    return 0;
  }

  fprintf(stdout, "== all-native equivalence: ios ==\n");
  char ios_out[PATH_MAX];
  if (nr_path_join(ios_out, sizeof(ios_out), out_dir, "ios") != 0) return 1;
  char *ios_argv[] = {
      "verify_r2c_equivalence_ios_native",
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      ios_out,
      NULL,
  };
  rc = native_verify_r2c_equivalence_ios_native(scripts_dir, 7, ios_argv, 1);
  if (rc != 0) return rc;

  fprintf(stdout, "== all-native equivalence: harmony ==\n");
  char harmony_out[PATH_MAX];
  if (nr_path_join(harmony_out, sizeof(harmony_out), out_dir, "harmony") != 0) return 1;
  char *harmony_argv[] = {
      "verify_r2c_equivalence_harmony_native",
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      harmony_out,
      NULL,
  };
  rc = native_verify_r2c_equivalence_harmony_native(scripts_dir, 7, harmony_argv, 1);
  if (rc != 0) return rc;

  fprintf(stdout, "[verify-r2c-all-native] ok\n");
  return 0;
}
