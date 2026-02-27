#define _POSIX_C_SOURCE 200809L

#include "native_verify_production_closed_loop.h"

#include "native_r2c_report_validate.h"
#include "native_verify_r2c_equivalence_all_native.h"

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
          "  verify_production_closed_loop [verify_r2c_equivalence_all_native args...]\n"
          "\n"
          "Native production closed-loop entry (depends only on all-native equivalence).\n");
}

int native_verify_production_closed_loop(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  char root[PATH_MAX];
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[verify-production-closed-loop] missing scripts dir\n");
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
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "--project") == 0 && (i + 1) < argc) {
      project = argv[i + 1];
      break;
    }
  }
  if (!path_is_under_root(project, root)) {
    setenv("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX", "1", 1);
  }
  {
    char compat_err[512];
    if (nr_enforce_no_compat_mounts(root, compat_err, sizeof(compat_err)) != 0) {
      fprintf(stderr, "[verify-production-closed-loop] %s\n", compat_err);
      return 1;
    }
    if (nr_enforce_no_legacy_gui_imports(root, compat_err, sizeof(compat_err)) != 0) {
      fprintf(stderr, "[verify-production-closed-loop] %s\n", compat_err);
      return 1;
    }
  }

  const char *runtime_required = getenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME");
  if (runtime_required != NULL && runtime_required[0] != '\0' && strcmp(runtime_required, "1") != 0) {
    fprintf(stderr,
            "[verify-production-closed-loop] strict mode requires CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=1\n");
    return 1;
  }
  setenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", "1", 1);
  setenv("CHENG_R2C_BUILD_TRACK", "release", 1);

  const char *fullroute = getenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE");
  if (fullroute == NULL || fullroute[0] == '\0') {
    fullroute = getenv("CHENG_ANDROID_EQ_ENABLE_FULLROUTE");
    if (fullroute == NULL || fullroute[0] == '\0') fullroute = "1";
    setenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", fullroute, 1);
  }

  const char *require_fullroute = getenv("CHENG_PRODUCTION_REQUIRE_ANDROID_FULLROUTE");
  if (require_fullroute == NULL || require_fullroute[0] == '\0') require_fullroute = "1";
  if (strcmp(require_fullroute, "1") == 0 && strcmp(fullroute, "1") != 0) {
    fprintf(stderr,
            "[verify-production-closed-loop] CHENG_PRODUCTION_REQUIRE_ANDROID_FULLROUTE=1 requires CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=1\n");
    return 1;
  }

  setenv("CHENG_ANDROID_EQ_ENABLE_FULLROUTE", fullroute, 1);

  fprintf(stdout, "== closed-loop: native equivalence (android + ios + harmony) ==\n");
  fprintf(stdout, "[verify-production-closed-loop] android fullroute=%s\n", fullroute);

  int rc = native_verify_r2c_equivalence_all_native(scripts_dir, argc, argv, arg_start);
  if (rc != 0) return rc;

  fprintf(stdout, "[verify-production-closed-loop] ok\n");
  return 0;
}
