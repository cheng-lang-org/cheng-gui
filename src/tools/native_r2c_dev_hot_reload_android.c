#define _POSIX_C_SOURCE 200809L

#include "native_r2c_dev_hot_reload_android.h"

#include "native_mobile_run_android.h"
#include "native_r2c_compile_react_project.h"

#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static int path_join(char *out, size_t cap, const char *a, const char *b) {
  if (out == NULL || cap == 0u || a == NULL || b == NULL) return -1;
  int n = snprintf(out, cap, "%s/%s", a, b);
  if (n < 0 || (size_t)n >= cap) return -1;
  return 0;
}

static bool dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool file_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool path_executable(const char *path) { return (path != NULL && access(path, X_OK) == 0); }

static bool should_skip_dir(const char *name) {
  if (name == NULL || name[0] == '\0') return true;
  return (strcmp(name, ".git") == 0 || strcmp(name, "node_modules") == 0 || strcmp(name, "build") == 0 ||
          strcmp(name, "dist") == 0 || strcmp(name, ".next") == 0);
}

static bool has_watch_ext(const char *name) {
  if (name == NULL) return false;
  const char *dot = strrchr(name, '.');
  if (dot == NULL) return false;
  return (strcmp(dot, ".ts") == 0 || strcmp(dot, ".tsx") == 0 || strcmp(dot, ".js") == 0 || strcmp(dot, ".jsx") == 0 ||
          strcmp(dot, ".json") == 0 || strcmp(dot, ".css") == 0 || strcmp(dot, ".scss") == 0 ||
          strcmp(dot, ".less") == 0 || strcmp(dot, ".md") == 0);
}

static uint64_t fnv1a64_extend(uint64_t seed, const unsigned char *data, size_t n) {
  uint64_t h = seed;
  for (size_t i = 0; i < n; ++i) {
    h ^= (uint64_t)data[i];
    h *= 1099511628211ull;
  }
  return h;
}

static uint64_t fnv1a64_cstr(uint64_t seed, const char *s) {
  if (s == NULL) return seed;
  return fnv1a64_extend(seed, (const unsigned char *)s, strlen(s));
}

static uint64_t scan_tree_hash(const char *root, uint64_t seed) {
  DIR *dir = opendir(root);
  if (dir == NULL) return seed;

  struct dirent *ent = NULL;
  while ((ent = readdir(dir)) != NULL) {
    const char *name = ent->d_name;
    if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) continue;

    char path[PATH_MAX];
    if (path_join(path, sizeof(path), root, name) != 0) continue;
    struct stat st;
    if (lstat(path, &st) != 0) continue;

    if (S_ISDIR(st.st_mode)) {
      if (should_skip_dir(name)) continue;
      seed = scan_tree_hash(path, seed);
      continue;
    }
    if (!S_ISREG(st.st_mode)) continue;
    if (!has_watch_ext(name)) continue;

    seed = fnv1a64_cstr(seed, path);
    seed = fnv1a64_extend(seed, (const unsigned char *)&st.st_mtime, sizeof(st.st_mtime));
    seed = fnv1a64_extend(seed, (const unsigned char *)&st.st_size, sizeof(st.st_size));
  }

  closedir(dir);
  return seed;
}

static uint64_t project_fingerprint(const char *project) {
  uint64_t h = 1469598103934665603ull;
  h = scan_tree_hash(project, h);
  return h;
}

static bool resolve_repo_root_from_scripts_dir(const char *scripts_dir, char *out, size_t cap) {
  if (scripts_dir == NULL || scripts_dir[0] == '\0' || out == NULL || cap == 0u) return false;
  int n = snprintf(out, cap, "%s", scripts_dir);
  if (n < 0 || (size_t)n >= cap) return false;
  size_t len = strlen(out);
  if (len >= 12u && strcmp(out + len - 12u, "/src/scripts") == 0) {
    out[len - 12u] = '\0';
    return true;
  }
  if (len >= 8u && strcmp(out + len - 8u, "/scripts") == 0) {
    out[len - 8u] = '\0';
    return true;
  }
  return true;
}

static void configure_default_compiler_bin(const char *scripts_dir) {
  const char *explicit_bin = getenv("CHENG_R2C_NATIVE_COMPILER_BIN");
  if (explicit_bin != NULL && explicit_bin[0] != '\0') return;

  char repo_root[PATH_MAX];
  if (!resolve_repo_root_from_scripts_dir(scripts_dir, repo_root, sizeof(repo_root))) return;
  const char *track = getenv("CHENG_R2C_BUILD_TRACK");
  if (track == NULL || track[0] == '\0') track = "dev";

  const char *candidates[] = {
      "r2c_compile_macos",
      "r2c_compile_macos.bench",
      "r2c_compile_macos.syslink",
      "r2c_compile_macos.try",
  };
  for (size_t i = 0; i < sizeof(candidates) / sizeof(candidates[0]); ++i) {
    char path[PATH_MAX];
    int n = snprintf(path, sizeof(path), "%s/build/r2c_compiler_tracks/%s/%s", repo_root, track, candidates[i]);
    if (n < 0 || (size_t)n >= sizeof(path)) continue;
    if (path_executable(path)) {
      setenv("CHENG_R2C_NATIVE_COMPILER_BIN", path, 1);
      fprintf(stdout, "[r2c-dev-hot] using compiler bin: %s\n", path);
      return;
    }
  }
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  r2c_dev_hot_reload_android --project <abs_path> [--entry </app/main.tsx>] --out <abs_path>\n"
          "                             [--interval-ms <ms>] [--serial <id>] [--name <appName>]\n"
          "                             [--max-reloads <n>] [--strict] [--once]\n");
}

int native_r2c_dev_hot_reload_android(const char *scripts_dir, int argc, char **argv, int arg_start) {
  const char *project = NULL;
  const char *entry = "/app/main.tsx";
  const char *out_dir = NULL;
  const char *serial = NULL;
  const char *app_name = "cheng_mobile_dev_hot_reload";
  int interval_ms = 1200;
  int max_reloads = 0;
  bool strict = false;
  bool once = false;

  for (int i = arg_start; i < argc; ++i) {
    const char *arg = argv[i];
    if (strcmp(arg, "-h") == 0 || strcmp(arg, "--help") == 0) {
      usage();
      return 0;
    }
    if (strcmp(arg, "--project") == 0 && i + 1 < argc) {
      project = argv[++i];
      continue;
    }
    if (strcmp(arg, "--entry") == 0 && i + 1 < argc) {
      entry = argv[++i];
      continue;
    }
    if (strcmp(arg, "--out") == 0 && i + 1 < argc) {
      out_dir = argv[++i];
      continue;
    }
    if (strcmp(arg, "--serial") == 0 && i + 1 < argc) {
      serial = argv[++i];
      continue;
    }
    if (strcmp(arg, "--name") == 0 && i + 1 < argc) {
      app_name = argv[++i];
      continue;
    }
    if (strcmp(arg, "--interval-ms") == 0 && i + 1 < argc) {
      interval_ms = atoi(argv[++i]);
      if (interval_ms < 200) interval_ms = 200;
      continue;
    }
    if (strcmp(arg, "--max-reloads") == 0 && i + 1 < argc) {
      max_reloads = atoi(argv[++i]);
      if (max_reloads < 0) max_reloads = 0;
      continue;
    }
    if (strcmp(arg, "--strict") == 0) {
      strict = true;
      continue;
    }
    if (strcmp(arg, "--once") == 0) {
      once = true;
      continue;
    }
    fprintf(stderr, "[r2c-dev-hot] unknown arg: %s\n", arg);
    usage();
    return 2;
  }

  if (project == NULL || out_dir == NULL) {
    usage();
    return 2;
  }
  if (!dir_exists(project)) {
    fprintf(stderr, "[r2c-dev-hot] missing project: %s\n", project);
    return 1;
  }

  if (getenv("CHENG_R2C_BUILD_TRACK") == NULL || getenv("CHENG_R2C_BUILD_TRACK")[0] == '\0') {
    setenv("CHENG_R2C_BUILD_TRACK", "dev", 1);
  }
  configure_default_compiler_bin(scripts_dir);
  if (getenv("R2C_REBUILD_COMPILER_BIN") == NULL || getenv("R2C_REBUILD_COMPILER_BIN")[0] == '\0') {
    setenv("R2C_REBUILD_COMPILER_BIN", "0", 1);
  }

  uint64_t last_fp = 0u;
  int applied = 0;
  bool first = true;
  while (1) {
    const uint64_t fp = project_fingerprint(project);
    const bool changed = first || fp != last_fp;
    if (changed) {
      char *compile_argv[16];
      int c = 0;
      compile_argv[c++] = (char *)"r2c_compile_react_project";
      compile_argv[c++] = (char *)"--project";
      compile_argv[c++] = (char *)project;
      compile_argv[c++] = (char *)"--entry";
      compile_argv[c++] = (char *)entry;
      compile_argv[c++] = (char *)"--out";
      compile_argv[c++] = (char *)out_dir;
      if (strict) compile_argv[c++] = (char *)"--strict";
      compile_argv[c] = NULL;

      fprintf(stdout, "[r2c-dev-hot] compile start #%d\n", applied + 1);
      int compile_rc = native_r2c_compile_react_project(scripts_dir, c, compile_argv, 1);
      if (compile_rc != 0) {
        fprintf(stderr, "[r2c-dev-hot] compile failed rc=%d (watch continues)\n", compile_rc);
        first = false;
        last_fp = fp;
        if (once) return compile_rc;
        usleep((useconds_t)interval_ms * 1000u);
        continue;
      }

      char entry_cheng[PATH_MAX];
      char assets_dir[PATH_MAX];
      char native_obj[PATH_MAX];
      char run_out[PATH_MAX];
      char state_out[PATH_MAX];
      if (path_join(entry_cheng, sizeof(entry_cheng), out_dir, "r2capp/src/entry.cheng") != 0 ||
          path_join(assets_dir, sizeof(assets_dir), out_dir, "r2capp") != 0 ||
          path_join(native_obj, sizeof(native_obj), out_dir, "r2c_app_android.o") != 0 ||
          path_join(run_out, sizeof(run_out), out_dir, "android_dev_hot_run") != 0 ||
          path_join(state_out, sizeof(state_out), out_dir, "android_dev_hot_runtime_state.json") != 0) {
        fprintf(stderr, "[r2c-dev-hot] path build failed\n");
        return 1;
      }
      if (!file_exists(entry_cheng) || !file_exists(native_obj) || !dir_exists(assets_dir)) {
        fprintf(stderr, "[r2c-dev-hot] compile artifacts missing after compile\n");
        if (once) return 1;
        first = false;
        last_fp = fp;
        usleep((useconds_t)interval_ms * 1000u);
        continue;
      }

      char name_arg[256];
      char out_arg[PATH_MAX + 32];
      char assets_arg[PATH_MAX + 32];
      char native_obj_arg[PATH_MAX + 32];
      char state_out_arg[PATH_MAX + 48];
      char wait_arg[64];
      char serial_arg[128];
      (void)snprintf(name_arg, sizeof(name_arg), "--name:%s", app_name);
      (void)snprintf(out_arg, sizeof(out_arg), "--out:%s", run_out);
      (void)snprintf(assets_arg, sizeof(assets_arg), "--assets:%s", assets_dir);
      (void)snprintf(native_obj_arg, sizeof(native_obj_arg), "--native-obj:%s", native_obj);
      (void)snprintf(state_out_arg, sizeof(state_out_arg), "--runtime-state-out:%s", state_out);
      (void)snprintf(wait_arg, sizeof(wait_arg), "--runtime-state-wait-ms:%d", 4500);
      (void)snprintf(serial_arg, sizeof(serial_arg), "--serial:%s", serial ? serial : "");

      char *run_argv[20];
      int r = 0;
      run_argv[r++] = (char *)"mobile_run_android";
      run_argv[r++] = entry_cheng;
      run_argv[r++] = name_arg;
      run_argv[r++] = out_arg;
      run_argv[r++] = assets_arg;
      run_argv[r++] = native_obj_arg;
      run_argv[r++] = state_out_arg;
      run_argv[r++] = wait_arg;
      run_argv[r++] = (char *)"--direct-launch-smoke:home_default";
      if (serial != NULL && serial[0] != '\0') run_argv[r++] = serial_arg;
      run_argv[r] = NULL;

      fprintf(stdout, "[r2c-dev-hot] deploy start #%d\n", applied + 1);
      int run_rc = native_mobile_run_android(scripts_dir, r, run_argv, 1);
      if (run_rc != 0) {
        fprintf(stderr, "[r2c-dev-hot] deploy failed rc=%d (watch continues)\n", run_rc);
        if (once) return run_rc;
      } else {
        applied += 1;
        fprintf(stdout, "[r2c-dev-hot] hot reload applied #%d\n", applied);
      }
      last_fp = fp;
      first = false;

      if (once) return 0;
      if (max_reloads > 0 && applied >= max_reloads) return 0;
    }
    usleep((useconds_t)interval_ms * 1000u);
  }
}
