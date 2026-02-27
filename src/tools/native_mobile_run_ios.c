#define _POSIX_C_SOURCE 200809L

#include "native_mobile_run_ios.h"

#include "native_r2c_report_validate.h"

#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  mobile_run_ios [--file <main.cheng>] [--name <app>] [--out <dir>] [--assets <dir>] [--plugins <csv>] [--sdk iphonesimulator|iphoneos]\n"
          "\n"
          "Native iOS build runner (no local shell script wrapper).\n");
}

static bool dir_exists_local(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool file_exists_local(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool find_executable_in_path(const char *name, char *out, size_t out_cap) {
  if (name == NULL || out == NULL || out_cap == 0u) return false;
  if (strchr(name, '/') != NULL) {
    if (access(name, X_OK) == 0) {
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
    if (access(candidate, X_OK) == 0) {
      snprintf(out, out_cap, "%s", candidate);
      ok = true;
      break;
    }
  }
  free(copy);
  return ok;
}

static int find_lang_root(char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return -1;
  out[0] = '\0';
  const char *env_root = getenv("LANG_ROOT");
  if (env_root != NULL && env_root[0] != '\0') {
    char probe_tooling[PATH_MAX];
    char probe_script[PATH_MAX];
    bool has_tooling = (snprintf(probe_tooling, sizeof(probe_tooling), "%s/artifacts/tooling_cmd/cheng_tooling", env_root) <
                            (int)sizeof(probe_tooling) &&
                        access(probe_tooling, X_OK) == 0);
    bool has_script = (snprintf(probe_script, sizeof(probe_script), "%s/src/tooling/build_mobile_export.sh", env_root) <
                           (int)sizeof(probe_script) &&
                       file_exists_local(probe_script));
    if (has_tooling || has_script) {
      snprintf(out, out_cap, "%s", env_root);
      return 0;
    }
  }
  const char *fixed[] = {
      "/Users/lbcheng/cheng-lang",
      NULL,
  };
  for (size_t i = 0u; fixed[i] != NULL; ++i) {
    char probe_tooling[PATH_MAX];
    char probe_script[PATH_MAX];
    bool has_tooling = (snprintf(probe_tooling, sizeof(probe_tooling), "%s/artifacts/tooling_cmd/cheng_tooling", fixed[i]) <
                            (int)sizeof(probe_tooling) &&
                        access(probe_tooling, X_OK) == 0);
    bool has_script = (snprintf(probe_script, sizeof(probe_script), "%s/src/tooling/build_mobile_export.sh", fixed[i]) <
                           (int)sizeof(probe_script) &&
                       file_exists_local(probe_script));
    if (has_tooling || has_script) {
      snprintf(out, out_cap, "%s", fixed[i]);
      return 0;
    }
  }
  const char *home = getenv("HOME");
  if (home != NULL && home[0] != '\0') {
    char root[PATH_MAX];
    char probe_tooling[PATH_MAX];
    char probe_script[PATH_MAX];
    if (snprintf(root, sizeof(root), "%s/cheng-lang", home) < (int)sizeof(root)) {
      bool has_tooling = (snprintf(probe_tooling, sizeof(probe_tooling), "%s/artifacts/tooling_cmd/cheng_tooling", root) <
                              (int)sizeof(probe_tooling) &&
                          access(probe_tooling, X_OK) == 0);
      bool has_script = (snprintf(probe_script, sizeof(probe_script), "%s/src/tooling/build_mobile_export.sh", root) <
                             (int)sizeof(probe_script) &&
                         file_exists_local(probe_script));
      if (has_tooling || has_script) {
        snprintf(out, out_cap, "%s", root);
        return 0;
      }
    }
  }
  return -1;
}

static int find_mobile_root(char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return -1;
  out[0] = '\0';
  const char *env_mobile_root = getenv("MOBILE_ROOT");
  if (env_mobile_root != NULL && env_mobile_root[0] != '\0' && dir_exists_local(env_mobile_root)) {
    snprintf(out, out_cap, "%s", env_mobile_root);
    return 0;
  }
  const char *fixed[] = {
      "/Users/lbcheng/.cheng-packages/cheng-mobile/src",
      NULL,
  };
  for (size_t i = 0u; fixed[i] != NULL; ++i) {
    if (dir_exists_local(fixed[i])) {
      snprintf(out, out_cap, "%s", fixed[i]);
      return 0;
    }
  }
  return -1;
}

static int find_tooling_bin(const char *lang_root, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return -1;
  out[0] = '\0';
  const char *env_bin = getenv("CHENG_TOOLING_BIN");
  if (env_bin != NULL && env_bin[0] != '\0' && access(env_bin, X_OK) == 0) {
    snprintf(out, out_cap, "%s", env_bin);
    return 0;
  }
  if (lang_root != NULL && lang_root[0] != '\0') {
    char probe[PATH_MAX];
    if (snprintf(probe, sizeof(probe), "%s/artifacts/tooling_cmd/cheng_tooling", lang_root) < (int)sizeof(probe) &&
        access(probe, X_OK) == 0) {
      snprintf(out, out_cap, "%s", probe);
      return 0;
    }
  }
  const char *fixed[] = {
      "/Users/lbcheng/cheng-lang/artifacts/tooling_cmd/cheng_tooling",
      NULL,
  };
  for (size_t i = 0u; fixed[i] != NULL; ++i) {
    if (access(fixed[i], X_OK) == 0) {
      snprintf(out, out_cap, "%s", fixed[i]);
      return 0;
    }
  }
  const char *home = getenv("HOME");
  if (home != NULL && home[0] != '\0') {
    char probe[PATH_MAX];
    if (snprintf(probe, sizeof(probe), "%s/cheng-lang/artifacts/tooling_cmd/cheng_tooling", home) <
            (int)sizeof(probe) &&
        access(probe, X_OK) == 0) {
      snprintf(out, out_cap, "%s", probe);
      return 0;
    }
  }
  return -1;
}

static int run_and_require(char *const argv[], const char *log, int timeout_sec, const char *label) {
  NativeRunResult rr = nr_run_command(argv, log, timeout_sec);
  if (rr.code != 0) {
    fprintf(stderr, "[mobile-run-ios] %s failed rc=%d log=%s\n", label, rr.code, log ? log : "");
    return -1;
  }
  return 0;
}

static int run_in_dir_and_require(const char *workdir,
                                  char *const argv[],
                                  const char *log,
                                  int timeout_sec,
                                  const char *label) {
  if (workdir == NULL || workdir[0] == '\0') return -1;
  char cwd[PATH_MAX];
  if (getcwd(cwd, sizeof(cwd)) == NULL) return -1;
  if (chdir(workdir) != 0) return -1;
  int rc = run_and_require(argv, log, timeout_sec, label);
  int restore_rc = chdir(cwd);
  if (restore_rc != 0 && rc == 0) rc = -1;
  return rc;
}

static int write_marker(const char *path, const char *project) {
  if (path == NULL || project == NULL) return -1;
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp, "ios_native_source_gate=ok\n");
  fprintf(fp, "project=%s\n", project);
  fclose(fp);
  return 0;
}

int native_mobile_run_ios(const char *scripts_dir, int argc, char **argv, int arg_start) {
  (void)scripts_dir;
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  const char *file = NULL;
  const char *name = "cheng_mobile_ios_native_release";
  char out_default[PATH_MAX];
  const char *home = getenv("HOME");
  if (home == NULL || home[0] == '\0') home = "/tmp";
  if (snprintf(out_default, sizeof(out_default), "%s/cheng-mobile-build/%s", home, name) >= (int)sizeof(out_default)) return 2;
  const char *out_dir = out_default;
  const char *assets = NULL;
  const char *plugins = NULL;
  const char *sdk = getenv("IOS_RELEASE_SDK");
  if (sdk == NULL || sdk[0] == '\0') sdk = "iphonesimulator";

  char default_file[PATH_MAX];
  if (snprintf(default_file,
               sizeof(default_file),
               "%s/.cheng-packages/cheng-mobile/examples/mobile_smoke.cheng",
               home) >= (int)sizeof(default_file)) {
    return 2;
  }
  file = default_file;

  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--file") == 0) {
      if (i + 1 >= argc) return 2;
      file = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--name") == 0) {
      if (i + 1 >= argc) return 2;
      name = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out") == 0) {
      if (i + 1 >= argc) return 2;
      out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--assets") == 0) {
      if (i + 1 >= argc) return 2;
      assets = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--plugins") == 0) {
      if (i + 1 >= argc) return 2;
      plugins = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--sdk") == 0) {
      if (i + 1 >= argc) return 2;
      sdk = argv[i + 1];
      i += 2;
      continue;
    }
    fprintf(stderr, "[mobile-run-ios] unknown arg: %s\n", arg);
    return 2;
  }

  if (name == NULL || name[0] == '\0' || file == NULL || file[0] == '\0' || out_dir == NULL || out_dir[0] == '\0') {
    usage();
    return 2;
  }
  if (!file_exists_local(file)) {
    fprintf(stderr, "[mobile-run-ios] missing source file: %s\n", file);
    return 1;
  }
  if (nr_ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[mobile-run-ios] failed to create out dir: %s\n", out_dir);
    return 1;
  }

  char lang_root[PATH_MAX];
  if (find_lang_root(lang_root, sizeof(lang_root)) != 0) {
    fprintf(stderr, "[mobile-run-ios] cheng-lang not found; set LANG_ROOT\n");
    return 2;
  }
  char mobile_root[PATH_MAX];
  mobile_root[0] = '\0';
  if (find_mobile_root(mobile_root, sizeof(mobile_root)) == 0) {
    setenv("MOBILE_ROOT", mobile_root, 1);
  }

  char tooling_bin[PATH_MAX];
  if (find_tooling_bin(lang_root, tooling_bin, sizeof(tooling_bin)) != 0) {
    fprintf(stderr, "[mobile-run-ios] cheng_tooling not found; set CHENG_TOOLING_BIN\n");
    return 2;
  }

  char log_export[PATH_MAX];
  if (nr_path_join(log_export, sizeof(log_export), out_dir, "build_mobile_export_ios.log") != 0) return 1;
  char arg_name[PATH_MAX + 16];
  char arg_out[PATH_MAX + 16];
  char arg_assets[PATH_MAX + 16];
  char arg_plugins[PATH_MAX + 16];
  char arg_mobile_root[PATH_MAX + 32];
  if (snprintf(arg_name, sizeof(arg_name), "--name:%s", name) >= (int)sizeof(arg_name) ||
      snprintf(arg_out, sizeof(arg_out), "--out:%s", out_dir) >= (int)sizeof(arg_out)) {
    return 1;
  }
  char *export_argv[14];
  int export_argc = 0;
  export_argv[export_argc++] = tooling_bin;
  export_argv[export_argc++] = "build_mobile_export";
  export_argv[export_argc++] = (char *)file;
  export_argv[export_argc++] = arg_name;
  export_argv[export_argc++] = arg_out;
  export_argv[export_argc++] = "--with-ios-project";
  if (mobile_root[0] != '\0') {
    if (snprintf(arg_mobile_root, sizeof(arg_mobile_root), "--mobile-root:%s", mobile_root) >= (int)sizeof(arg_mobile_root)) {
      return 1;
    }
    export_argv[export_argc++] = arg_mobile_root;
  }
  if (assets != NULL && assets[0] != '\0') {
    if (snprintf(arg_assets, sizeof(arg_assets), "--assets:%s", assets) >= (int)sizeof(arg_assets)) return 1;
    export_argv[export_argc++] = arg_assets;
  }
  if (plugins != NULL && plugins[0] != '\0') {
    if (snprintf(arg_plugins, sizeof(arg_plugins), "--plugins:%s", plugins) >= (int)sizeof(arg_plugins)) return 1;
    export_argv[export_argc++] = arg_plugins;
  }
  export_argv[export_argc] = NULL;
  if (run_in_dir_and_require(lang_root, export_argv, log_export, 0, "export ios project") != 0) return 1;

  char project[PATH_MAX];
  char app_src[PATH_MAX];
  if (nr_path_join(project, sizeof(project), out_dir, "ios_project") != 0 ||
      nr_path_join(app_src, sizeof(app_src), project, "ChengMobileApp") != 0) {
    return 1;
  }
  if (!dir_exists_local(project) || !dir_exists_local(app_src)) {
    fprintf(stderr, "[mobile-run-ios] missing generated project: %s\n", project);
    return 1;
  }

  const char *require_xcode_build = getenv("CHENG_IOS_REQUIRE_XCODE_BUILD");
  if (require_xcode_build == NULL || require_xcode_build[0] == '\0' || strcmp(require_xcode_build, "1") != 0) {
    char marker_dir[PATH_MAX];
    char marker[PATH_MAX];
    if (nr_path_join(marker_dir, sizeof(marker_dir), project, "build_release") != 0 ||
        nr_ensure_dir(marker_dir) != 0 ||
        nr_path_join(marker, sizeof(marker), marker_dir, "ios_native_source_gate.ok") != 0 ||
        write_marker(marker, project) != 0) {
      fprintf(stderr, "[mobile-run-ios] failed to write source gate marker\n");
      return 1;
    }
    fprintf(stdout, "[mobile-run-ios] ok(native-source-gate): %s\n", marker);
    return 0;
  }

  char xcodegen_bin[PATH_MAX];
  char xcodebuild_bin[PATH_MAX];
  if (!find_executable_in_path("xcodegen", xcodegen_bin, sizeof(xcodegen_bin))) {
    fprintf(stderr, "[mobile-run-ios] xcodegen not found\n");
    return 2;
  }
  if (!find_executable_in_path("xcodebuild", xcodebuild_bin, sizeof(xcodebuild_bin))) {
    fprintf(stderr, "[mobile-run-ios] xcodebuild not found\n");
    return 2;
  }

  char spec[PATH_MAX];
  if (nr_path_join(spec, sizeof(spec), project, "project.yml") != 0) return 1;
  char log_xcodegen[PATH_MAX];
  if (nr_path_join(log_xcodegen, sizeof(log_xcodegen), out_dir, "xcodegen.log") != 0) return 1;
  char *xcodegen_argv[] = {
      xcodegen_bin,
      "--spec",
      spec,
      NULL,
  };
  if (run_and_require(xcodegen_argv, log_xcodegen, 0, "xcodegen") != 0) return 1;

  char xcodeproj[PATH_MAX];
  char derived[PATH_MAX];
  char destination[64];
  if (nr_path_join(xcodeproj, sizeof(xcodeproj), project, "ChengMobileApp.xcodeproj") != 0 ||
      nr_path_join(derived, sizeof(derived), project, "build_release") != 0 ||
      nr_ensure_dir(derived) != 0) {
    return 1;
  }
  if (strcmp(sdk, "iphoneos") == 0) {
    snprintf(destination, sizeof(destination), "generic/platform=iOS");
  } else {
    snprintf(destination, sizeof(destination), "generic/platform=iOS Simulator");
  }
  char log_xcodebuild[PATH_MAX];
  if (nr_path_join(log_xcodebuild, sizeof(log_xcodebuild), out_dir, "xcodebuild_release.log") != 0) return 1;
  char *xcodebuild_argv[] = {
      xcodebuild_bin,
      "-project",
      xcodeproj,
      "-scheme",
      "ChengMobileApp",
      "-configuration",
      "Release",
      "-sdk",
      (char *)sdk,
      "-destination",
      destination,
      "-derivedDataPath",
      derived,
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "build",
      NULL,
  };
  if (run_and_require(xcodebuild_argv, log_xcodebuild, 0, "xcodebuild release") != 0) return 1;

  char app_path[PATH_MAX];
  if (strcmp(sdk, "iphoneos") == 0) {
    snprintf(app_path, sizeof(app_path), "%s/Build/Products/Release-iphoneos/ChengMobileApp.app", derived);
  } else {
    snprintf(app_path, sizeof(app_path), "%s/Build/Products/Release-iphonesimulator/ChengMobileApp.app", derived);
  }
  if (!dir_exists_local(app_path)) {
    fprintf(stderr, "[mobile-run-ios] release app not found: %s\n", app_path);
    return 1;
  }

  fprintf(stdout, "[mobile-run-ios] ok: %s\n", app_path);
  return 0;
}
