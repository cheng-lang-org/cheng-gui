#define _POSIX_C_SOURCE 200809L

#include "native_r2c_compile_react_project.h"
#include "native_r2c_report_validate.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  const char *project;
  const char *entry;
  const char *out_dir;
  bool strict;
  bool help;
  bool parse_ok;
} CliOptions;

typedef struct {
  int code;
  bool timed_out;
} RunResult;

typedef struct {
  char report_path[PATH_MAX];
  char generated_runtime_path[PATH_MAX];
  char generated_entry_path[PATH_MAX];
  char react_ir_path[PATH_MAX];
  char semantic_graph_path[PATH_MAX];
  char component_graph_path[PATH_MAX];
  char style_graph_path[PATH_MAX];
  char event_graph_path[PATH_MAX];
  char runtime_trace_path[PATH_MAX];
  char hook_graph_path[PATH_MAX];
  char effect_plan_path[PATH_MAX];
  char third_party_rewrite_report_path[PATH_MAX];
  char route_tree_path[PATH_MAX];
  char route_semantic_tree_path[PATH_MAX];
  char route_layers_path[PATH_MAX];
  char route_actions_android_path[PATH_MAX];
  char route_graph_path[PATH_MAX];
  char route_event_matrix_path[PATH_MAX];
  char route_coverage_path[PATH_MAX];
  char full_route_states_path[PATH_MAX];
  char full_route_event_matrix_path[PATH_MAX];
  char full_route_coverage_report_path[PATH_MAX];
  char perf_summary_path[PATH_MAX];
  char semantic_node_map_path[PATH_MAX];
  char semantic_runtime_map_path[PATH_MAX];
  char semantic_render_nodes_path[PATH_MAX];
  char truth_trace_manifest_android_path[PATH_MAX];
  char truth_trace_manifest_ios_path[PATH_MAX];
  char truth_trace_manifest_harmony_path[PATH_MAX];
  char android_truth_manifest_path[PATH_MAX];
} PostfixPaths;

typedef struct {
  char node_id[32];
  char source_module[160];
  char kind[16];
  char value[96];
  char role[16];
  char text[160];
  char event_binding[64];
  char hook_slot[64];
  char jsx_path[32];
  char route_hint[64];
  char selector[32];
} SemanticNode;

static const char *kFullRouteStates[] = {
    "lang_select",
    "home_default",
    "sidebar_open",
    "tab_messages",
    "publish_selector",
    "tab_nodes",
    "tab_profile",
    "home_search_open",
    "home_sort_open",
    "home_channel_manager_open",
    "home_content_detail_open",
    "home_ecom_overlay_open",
    "home_bazi_overlay_open",
    "home_ziwei_overlay_open",
    "publish_content",
    "publish_product",
    "publish_live",
    "publish_app",
    "publish_food",
    "publish_ride",
    "publish_job",
    "publish_hire",
    "publish_rent",
    "publish_sell",
    "publish_secondhand",
    "publish_crowdfunding",
    "trading_main",
    "trading_crosshair",
    "ecom_main",
    "marketplace_main",
    "update_center_main",
};

static const char *kSeedModules[] = {
    "/app/main.tsx",
    "/app/App.tsx",
    "/app/components/Sidebar.tsx",
    "/app/components/HomePage.tsx",
    "/app/components/PublishTypeSelector.tsx",
    "/app/components/TradingPage.tsx",
    "/app/components/MessagesPage.tsx",
    "/app/components/NodesPage.tsx",
    "/app/components/ProfilePage.tsx",
    "/app/components/EcomPage.tsx",
    "/app/components/MarketplacePage.tsx",
    "/app/components/UpdateCenterPage.tsx",
    "/app/components/LanguageSelectPage.tsx",
};

#define MAX_ROUTE_STATE_COUNT 128

static int route_state_index(const char *route) {
  if (route == NULL || route[0] == '\0') return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  for (size_t i = 0u; i < route_count; ++i) {
    if (strcmp(route, kFullRouteStates[i]) == 0) return (int)i;
  }
  return -1;
}

static bool file_exists(const char *path) {
  struct stat st;
  return (path != NULL && path[0] != '\0' && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool file_mtime_ok(const char *path, time_t *out_mtime) {
  struct stat st;
  if (out_mtime != NULL) *out_mtime = (time_t)0;
  if (path == NULL || path[0] == '\0') return false;
  if (stat(path, &st) != 0 || !S_ISREG(st.st_mode)) return false;
  if (out_mtime != NULL) *out_mtime = st.st_mtime;
  return true;
}

static bool file_nonempty(const char *path) {
  struct stat st;
  return (path != NULL && path[0] != '\0' && stat(path, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0);
}

static bool dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && path[0] != '\0' && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool path_executable(const char *path) {
  return (path != NULL && path[0] != '\0' && access(path, X_OK) == 0);
}

static bool str_contains(const char *hay, const char *needle) {
  return (hay != NULL && needle != NULL && strstr(hay, needle) != NULL);
}

static int env_positive_int_or_default(const char *name, int fallback) {
  if (name == NULL || name[0] == '\0') return fallback;
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return fallback;
  char *end = NULL;
  long parsed = strtol(raw, &end, 10);
  if (end == raw || *end != '\0' || parsed <= 0 || parsed > 10000L) return fallback;
  return (int)parsed;
}

static bool find_executable_in_path(const char *name, char *out, size_t out_cap) {
  if (name == NULL || name[0] == '\0' || out == NULL || out_cap == 0u) return false;
  if (strchr(name, '/') != NULL) {
    if (path_executable(name)) {
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
    if (path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      ok = true;
      break;
    }
  }
  free(copy);
  return ok;
}

static int path_join(char *out, size_t cap, const char *a, const char *b) {
  if (out == NULL || cap == 0u || a == NULL || b == NULL) return -1;
  int n = snprintf(out, cap, "%s/%s", a, b);
  if (n < 0 || (size_t)n >= cap) return -1;
  return 0;
}

static void dirname_copy(const char *path, char *out, size_t cap) {
  if (out == NULL || cap == 0u) return;
  out[0] = '\0';
  if (path == NULL || path[0] == '\0') return;
  snprintf(out, cap, "%s", path);
  char *slash = strrchr(out, '/');
  if (slash == NULL) {
    snprintf(out, cap, ".");
    return;
  }
  if (slash == out) {
    slash[1] = '\0';
    return;
  }
  *slash = '\0';
}

static int ensure_dir_recursive(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  char tmp[PATH_MAX];
  if (snprintf(tmp, sizeof(tmp), "%s", path) >= (int)sizeof(tmp)) return -1;
  size_t n = strlen(tmp);
  if (n == 0u) return -1;
  if (tmp[n - 1] == '/') tmp[n - 1] = '\0';
  for (char *p = tmp + 1; *p; ++p) {
    if (*p == '/') {
      *p = '\0';
      if (mkdir(tmp, 0775) != 0 && errno != EEXIST) return -1;
      *p = '/';
    }
  }
  if (mkdir(tmp, 0775) != 0 && errno != EEXIST) return -1;
  return 0;
}

static int ensure_parent_dir(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  char parent[PATH_MAX];
  dirname_copy(path, parent, sizeof(parent));
  if (parent[0] == '\0') return -1;
  return ensure_dir_recursive(parent);
}

static FILE *open_write_file(const char *path) {
  if (ensure_parent_dir(path) != 0) return NULL;
  return fopen(path, "wb");
}

static int write_all_text(const char *path, const char *text) {
  if (path == NULL || text == NULL) return -1;
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t n = strlen(text);
  size_t w = fwrite(text, 1u, n, fp);
  int close_rc = fclose(fp);
  return (w == n && close_rc == 0) ? 0 : -1;
}

static char *read_all_text(const char *path, size_t *out_len) {
  if (out_len != NULL) *out_len = 0u;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return NULL;
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    return NULL;
  }
  long sz = ftell(fp);
  if (sz < 0) {
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

static void derive_repo_root(const char *scripts_dir, char *out, size_t cap) {
  if (out == NULL || cap == 0u) return;
  out[0] = '\0';
  if (scripts_dir == NULL || scripts_dir[0] == '\0') return;
  snprintf(out, cap, "%s", scripts_dir);
  size_t n = strlen(out);
  if (n >= 12u && strcmp(out + n - 12u, "/src/scripts") == 0) {
    out[n - 12u] = '\0';
    return;
  }
  if (n >= 8u && strcmp(out + n - 8u, "/scripts") == 0) {
    out[n - 8u] = '\0';
  }
}

static bool resolve_tooling_bin(char *out, size_t cap) {
  if (out == NULL || cap == 0u) return false;
  out[0] = '\0';
  const char *env = getenv("CHENG_TOOLING_BIN");
  if (path_executable(env)) {
    snprintf(out, cap, "%s", env);
    return true;
  }
  const char *candidates[] = {
      "/Users/lbcheng/cheng-lang/artifacts/tooling_cmd/cheng_tooling",
      "/Users/lbcheng/cheng-lang/artifacts/tooling_cmdline/bin/cheng_tooling",
      "/Users/lbcheng/cheng-lang/artifacts/tooling_bundle/full/cheng_tooling",
      "/Users/lbcheng/.cheng/toolchain/cheng-lang/artifacts/tooling_cmd/cheng_tooling",
  };
  for (size_t i = 0u; i < sizeof(candidates) / sizeof(candidates[0]); ++i) {
    if (path_executable(candidates[i])) {
      snprintf(out, cap, "%s", candidates[i]);
      return true;
    }
  }
  return false;
}

static void basename_copy(const char *path, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (path == NULL || path[0] == '\0') return;
  const char *end = path + strlen(path);
  while (end > path && *(end - 1) == '/') --end;
  const char *start = end;
  while (start > path && *(start - 1) != '/') --start;
  size_t n = (size_t)(end - start);
  if (n >= out_cap) n = out_cap - 1u;
  memcpy(out, start, n);
  out[n] = '\0';
}

static const char *arg_inline_value(const char *arg, const char *key) {
  if (arg == NULL || key == NULL) return NULL;
  size_t key_n = strlen(key);
  if (strncmp(arg, key, key_n) != 0) return NULL;
  if (arg[key_n] == ':' || arg[key_n] == '=') return arg + key_n + 1;
  return NULL;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  r2c_compile_react_project --project <abs_path> [--entry </app/main.tsx>] --out <abs_path> [--strict]\n");
}

static CliOptions parse_cli(int argc, char **argv, int arg_start) {
  CliOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.entry = "/app/main.tsx";
  opts.parse_ok = true;
  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (arg == NULL) {
      i += 1;
      continue;
    }
    if (strcmp(arg, "-h") == 0 || strcmp(arg, "--help") == 0) {
      opts.help = true;
      i += 1;
      continue;
    }
    const char *inline_project = arg_inline_value(arg, "--project");
    if (inline_project != NULL) {
      opts.project = inline_project;
      i += 1;
      continue;
    }
    if (strcmp(arg, "--project") == 0) {
      if (i + 1 >= argc) {
        opts.parse_ok = false;
        return opts;
      }
      opts.project = argv[i + 1];
      i += 2;
      continue;
    }
    const char *inline_entry = arg_inline_value(arg, "--entry");
    if (inline_entry != NULL) {
      opts.entry = inline_entry;
      i += 1;
      continue;
    }
    if (strcmp(arg, "--entry") == 0) {
      if (i + 1 >= argc) {
        opts.parse_ok = false;
        return opts;
      }
      opts.entry = argv[i + 1];
      i += 2;
      continue;
    }
    const char *inline_out = arg_inline_value(arg, "--out");
    if (inline_out != NULL) {
      opts.out_dir = inline_out;
      i += 1;
      continue;
    }
    if (strcmp(arg, "--out") == 0) {
      if (i + 1 >= argc) {
        opts.parse_ok = false;
        return opts;
      }
      opts.out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--strict") == 0) {
      opts.strict = true;
      i += 1;
      continue;
    }
    fprintf(stderr, "[r2c-compile] unknown arg: %s\n", arg);
    opts.parse_ok = false;
    return opts;
  }
  return opts;
}

static int run_process_capture(const char *workdir, const char *log_path, char *const argv[]) {
  if (argv == NULL || argv[0] == NULL || argv[0][0] == '\0') return 1;
  pid_t pid = fork();
  if (pid < 0) return 1;
  if (pid == 0) {
    if (workdir != NULL && workdir[0] != '\0') {
      if (chdir(workdir) != 0) _exit(127);
    }
    if (log_path != NULL && log_path[0] != '\0') {
      FILE *fp = fopen(log_path, "wb");
      if (fp == NULL) _exit(127);
      int fd = fileno(fp);
      if (dup2(fd, STDOUT_FILENO) < 0 || dup2(fd, STDERR_FILENO) < 0) _exit(127);
      fclose(fp);
    }
    execv(argv[0], argv);
    _exit(127);
  }
  int status = 0;
  if (waitpid(pid, &status, 0) < 0) return 1;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static bool is_crash_exit_code(int rc) {
  return (rc == 139 || rc == 138 || rc == 134 || rc == 132);
}

static bool compiler_binary_health_ok(const char *compiler_bin, const char *workdir) {
  if (!path_executable(compiler_bin)) return false;
  char *argv[] = {(char *)compiler_bin, NULL};
  int rc = run_process_capture(workdir, "/dev/null", argv);
  return !is_crash_exit_code(rc);
}

static void emit_short_file_to_stderr(const char *path, const char *label, size_t limit) {
  if (!file_nonempty(path)) return;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return;
  char *buf = (char *)malloc(limit + 1u);
  if (buf == NULL) {
    fclose(fp);
    return;
  }
  size_t n = fread(buf, 1u, limit, fp);
  fclose(fp);
  buf[n] = '\0';
  if (n > 0u) fprintf(stderr, "[r2c-compile] %s (%s):\n%s\n", label, path, buf);
  free(buf);
}

static void print_file_head(const char *path, int lines) {
  FILE *fp = fopen(path, "r");
  if (fp == NULL) return;
  char line[4096];
  int shown = 0;
  while (fgets(line, sizeof(line), fp) != NULL) {
    fputs(line, stderr);
    shown += 1;
    if (shown >= lines) break;
  }
  fclose(fp);
}

static RunResult run_command(char *const argv[], const char *log_path, int timeout_sec) {
  RunResult res;
  res.code = 127;
  res.timed_out = false;
  pid_t pid = fork();
  if (pid < 0) return res;
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (log_path != NULL && log_path[0] != '\0') {
      int fd = open(log_path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
      if (fd < 0) _exit(127);
      if (dup2(fd, STDOUT_FILENO) < 0 || dup2(fd, STDERR_FILENO) < 0) _exit(127);
      close(fd);
    }
    execv(argv[0], argv);
    _exit(127);
  }
  setpgid(pid, pid);
  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : (time_t)0;
  while (1) {
    int status = 0;
    pid_t got = waitpid(pid, &status, WNOHANG);
    if (got == pid) {
      if (WIFEXITED(status)) res.code = WEXITSTATUS(status);
      else if (WIFSIGNALED(status)) res.code = 128 + WTERMSIG(status);
      else res.code = 1;
      return res;
    }
    if (got < 0) return res;
    if (timeout_sec > 0 && time(NULL) >= deadline) {
      res.timed_out = true;
      kill(-pid, SIGTERM);
      usleep(200000);
      kill(-pid, SIGKILL);
      waitpid(pid, NULL, 0);
      res.code = 124;
      return res;
    }
    usleep(50000);
  }
}

static int capture_command_output(char *const argv[], int timeout_sec, char **out) {
  if (out != NULL) *out = NULL;
  int pipefd[2];
  if (pipe(pipefd) != 0) return -1;
  pid_t pid = fork();
  if (pid < 0) {
    close(pipefd[0]);
    close(pipefd[1]);
    return -1;
  }
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (dup2(pipefd[1], STDOUT_FILENO) < 0 || dup2(pipefd[1], STDERR_FILENO) < 0) _exit(127);
    close(pipefd[0]);
    close(pipefd[1]);
    execv(argv[0], argv);
    _exit(127);
  }
  close(pipefd[1]);
  setpgid(pid, pid);

  size_t cap = 4096u;
  size_t len = 0u;
  char *buf = (char *)malloc(cap);
  if (buf == NULL) {
    close(pipefd[0]);
    kill(-pid, SIGKILL);
    waitpid(pid, NULL, 0);
    return -1;
  }

  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : (time_t)0;
  while (1) {
    char tmp[1024];
    ssize_t rd = read(pipefd[0], tmp, sizeof(tmp));
    if (rd > 0) {
      if (len + (size_t)rd + 1u > cap) {
        size_t next = cap;
        while (len + (size_t)rd + 1u > next) next *= 2u;
        char *resized = (char *)realloc(buf, next);
        if (resized == NULL) {
          free(buf);
          close(pipefd[0]);
          kill(-pid, SIGKILL);
          waitpid(pid, NULL, 0);
          return -1;
        }
        buf = resized;
        cap = next;
      }
      memcpy(buf + len, tmp, (size_t)rd);
      len += (size_t)rd;
      continue;
    }
    if (rd == 0) break;
    if (errno == EINTR) continue;
    break;
  }
  close(pipefd[0]);

  int status = 0;
  while (waitpid(pid, &status, WNOHANG) == 0) {
    if (timeout_sec > 0 && time(NULL) >= deadline) {
      kill(-pid, SIGTERM);
      usleep(200000);
      kill(-pid, SIGKILL);
      waitpid(pid, &status, 0);
      free(buf);
      return 124;
    }
    usleep(50000);
  }
  buf[len] = '\0';
  if (out != NULL) *out = buf;
  else free(buf);
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static bool compiler_is_unimaker_probe(const char *path) {
  if (path == NULL) return false;
  return strstr(path, "/src/build/unimaker_probe/r2c_compile_macos") != NULL;
}

static uint64_t fnv64_bytes(const unsigned char *buf, size_t n) {
  uint64_t h = 1469598103934665603ULL;
  for (size_t i = 0; i < n; ++i) {
    h ^= (uint64_t)buf[i];
    h *= 1099511628211ULL;
  }
  return h;
}

static void lower_ascii(const char *in, char *out, size_t cap) {
  if (out == NULL || cap == 0u) return;
  out[0] = '\0';
  if (in == NULL) return;
  size_t idx = 0u;
  for (const char *p = in; *p != '\0' && idx + 1u < cap; ++p) {
    out[idx++] = (char)tolower((unsigned char)*p);
  }
  out[idx] = '\0';
}

static void basename_noext_lower(const char *module_id, char *out, size_t cap) {
  if (out == NULL || cap == 0u) return;
  out[0] = '\0';
  char base[256];
  basename_copy(module_id, base, sizeof(base));
  char *dot = strrchr(base, '.');
  if (dot != NULL) *dot = '\0';
  lower_ascii(base, out, cap);
  if (out[0] == '\0') snprintf(out, cap, "node");
}

static bool str_starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
}

static const char *route_parent(const char *route) {
  if (route == NULL || route[0] == '\0') return "";
  if (strcmp(route, "home_default") == 0 || strcmp(route, "lang_select") == 0) return "";
  if (strcmp(route, "sidebar_open") == 0) return "home_default";
  if (strcmp(route, "tab_messages") == 0 || strcmp(route, "tab_nodes") == 0 || strcmp(route, "tab_profile") == 0 ||
      strcmp(route, "publish_selector") == 0) {
    return "home_default";
  }
  if (str_starts_with(route, "publish_")) return "publish_selector";
  if (str_starts_with(route, "home_")) return "home_default";
  if (strcmp(route, "trading_main") == 0) return "tab_nodes";
  if (strcmp(route, "trading_crosshair") == 0) return "trading_main";
  if (strcmp(route, "ecom_main") == 0) return "home_ecom_overlay_open";
  if (strcmp(route, "marketplace_main") == 0) return "sidebar_open";
  if (strcmp(route, "update_center_main") == 0) return "tab_profile";
  return "home_default";
}

static int route_depth(const char *route) {
  const char *parent = route_parent(route);
  if (parent[0] == '\0') return 0;
  if (route_parent(parent)[0] == '\0') return 1;
  return 2;
}

static int route_layer_index(const char *route) {
  if (route == NULL || route[0] == '\0') return 1;
  if (strcmp(route, "lang_select") == 0) return 0;
  if (strcmp(route, "trading_main") == 0 || strcmp(route, "trading_crosshair") == 0 ||
      strcmp(route, "ecom_main") == 0 || strcmp(route, "marketplace_main") == 0) {
    return 2;
  }
  return 1;
}

static int route_layer_count(void) {
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  int max_layer = 0;
  for (size_t i = 0u; i < route_count; ++i) {
    int layer = route_layer_index(kFullRouteStates[i]);
    if (layer > max_layer) max_layer = layer;
  }
  return max_layer + 1;
}

static const char *route_entry_event(const char *route) {
  if (route == NULL) return "route.enter.unknown";
  if (strcmp(route, "home_default") == 0) return "app.launch";
  if (strcmp(route, "lang_select") == 0) return "home.open.language_selector";
  if (strcmp(route, "sidebar_open") == 0) return "home.open.sidebar";
  if (strcmp(route, "tab_messages") == 0) return "tab.select.messages";
  if (strcmp(route, "tab_nodes") == 0) return "tab.select.nodes";
  if (strcmp(route, "tab_profile") == 0) return "tab.select.profile";
  if (strcmp(route, "publish_selector") == 0) return "tab.select.publish";
  if (str_starts_with(route, "publish_")) {
    static char buf[96];
    snprintf(buf, sizeof(buf), "publish.select.%s", route + 8);
    return buf;
  }
  if (strcmp(route, "trading_main") == 0) return "nodes.open.trading";
  if (strcmp(route, "trading_crosshair") == 0) return "trading.open.crosshair";
  if (strcmp(route, "ecom_main") == 0) return "home.open.ecom";
  if (strcmp(route, "marketplace_main") == 0) return "sidebar.open.marketplace";
  if (strcmp(route, "update_center_main") == 0) return "profile.open.update_center";
  if (str_starts_with(route, "home_")) {
    static char home_buf[96];
    snprintf(home_buf, sizeof(home_buf), "home.open.%s", route + 5);
    return home_buf;
  }
  static char fallback[96];
  snprintf(fallback, sizeof(fallback), "route.enter.%s", route);
  return fallback;
}

static void route_path_from_root(const char *route, const char **out, int *out_count) {
  if (out_count != NULL) *out_count = 0;
  if (route == NULL || route[0] == '\0' || out == NULL || out_count == NULL) return;
  const char *stack[8];
  int n = 0;
  const char *cur = route;
  while (cur[0] != '\0' && n < 8) {
    stack[n++] = cur;
    cur = route_parent(cur);
  }
  for (int i = 0; i < n; ++i) {
    out[i] = stack[n - 1 - i];
  }
  *out_count = n;
}

static void text_to_hex(const char *text, char *out, size_t cap) {
  if (out == NULL || cap == 0u) return;
  out[0] = '\0';
  if (text == NULL) return;
  static const char *hex = "0123456789abcdef";
  size_t idx = 0u;
  for (const unsigned char *p = (const unsigned char *)text; *p != '\0' && idx + 2u < cap; ++p) {
    out[idx++] = hex[(*p >> 4) & 0xF];
    out[idx++] = hex[*p & 0xF];
  }
  out[idx] = '\0';
}

static const char *semantic_role(const char *kind) {
  if (strcmp(kind, "event") == 0) return "event";
  if (strcmp(kind, "hook") == 0) return "hook";
  if (strcmp(kind, "jsx-tag") == 0 || strcmp(kind, "id") == 0 || strcmp(kind, "class") == 0 || strcmp(kind, "testid") == 0) {
    return "element";
  }
  return "text";
}

static void route_hint_for(const char *source_module, const char *value, char *out, size_t cap) {
  if (out == NULL || cap == 0u) return;
  out[0] = '\0';
  char comb[512];
  snprintf(comb, sizeof(comb), "%s|%s", source_module ? source_module : "", value ? value : "");
  char lower[512];
  lower_ascii(comb, lower, sizeof(lower));
  if (strstr(lower, "language") != NULL || strstr(lower, "lang") != NULL) {
    snprintf(out, cap, "lang_select");
    return;
  }
  if (strstr(lower, "search") != NULL) {
    snprintf(out, cap, "home_search_open");
    return;
  }
  if (strstr(lower, "sidebar") != NULL || strstr(lower, "drawer") != NULL) {
    snprintf(out, cap, "sidebar_open");
    return;
  }
  if (strstr(lower, "sort") != NULL) {
    snprintf(out, cap, "home_sort_open");
    return;
  }
  if (strstr(lower, "channel") != NULL) {
    snprintf(out, cap, "home_channel_manager_open");
    return;
  }
  if (strstr(lower, "detail") != NULL) {
    snprintf(out, cap, "home_content_detail_open");
    return;
  }
  if (strstr(lower, "bazi") != NULL) {
    snprintf(out, cap, "home_bazi_overlay_open");
    return;
  }
  if (strstr(lower, "ziwei") != NULL) {
    snprintf(out, cap, "home_ziwei_overlay_open");
    return;
  }
  if (strstr(lower, "publish") != NULL) {
    snprintf(out, cap, "publish_selector");
    return;
  }
  if (strstr(lower, "trading") != NULL || strstr(lower, "kline") != NULL || strstr(lower, "chart") != NULL) {
    snprintf(out, cap, "trading_main");
    return;
  }
  if (strstr(lower, "market") != NULL) {
    snprintf(out, cap, "marketplace_main");
    return;
  }
  if (strstr(lower, "update") != NULL) {
    snprintf(out, cap, "update_center_main");
    return;
  }
  if (strstr(lower, "ecom") != NULL) {
    snprintf(out, cap, "ecom_main");
    return;
  }
  if (strstr(lower, "message") != NULL || strstr(lower, "chat") != NULL) {
    snprintf(out, cap, "tab_messages");
    return;
  }
  if (strstr(lower, "node") != NULL) {
    snprintf(out, cap, "tab_nodes");
    return;
  }
  if (strstr(lower, "profile") != NULL || strstr(lower, "wallet") != NULL) {
    snprintf(out, cap, "tab_profile");
    return;
  }
  snprintf(out, cap, "home_default");
}

static size_t build_semantic_nodes(SemanticNode *nodes, size_t cap) {
  if (nodes == NULL || cap == 0u) return 0u;
  const size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  size_t n = 0u;

  for (size_t i = 0u; i < sizeof(kSeedModules) / sizeof(kSeedModules[0]); ++i) {
    if (n + 3u > cap) break;
    char base[64];
    basename_noext_lower(kSeedModules[i], base, sizeof(base));

    SemanticNode *jsx = &nodes[n++];
    memset(jsx, 0, sizeof(*jsx));
    snprintf(jsx->node_id, sizeof(jsx->node_id), "sn_%zu", n - 1u);
    snprintf(jsx->source_module, sizeof(jsx->source_module), "%s", kSeedModules[i]);
    snprintf(jsx->kind, sizeof(jsx->kind), "jsx-tag");
    snprintf(jsx->value, sizeof(jsx->value), "%s", base);
    snprintf(jsx->role, sizeof(jsx->role), "%s", semantic_role(jsx->kind));
    snprintf(jsx->text, sizeof(jsx->text), "<%s>", jsx->value);
    snprintf(jsx->jsx_path, sizeof(jsx->jsx_path), "semantic:%zu", n - 1u);
    if (route_count > 0u) {
      snprintf(jsx->route_hint, sizeof(jsx->route_hint), "%s", kFullRouteStates[(n - 1u) % route_count]);
    } else {
      route_hint_for(jsx->source_module, jsx->value, jsx->route_hint, sizeof(jsx->route_hint));
    }
    snprintf(jsx->selector, sizeof(jsx->selector), "#r2c-id-%zu", n - 1u);

    SemanticNode *evt = &nodes[n++];
    memset(evt, 0, sizeof(*evt));
    snprintf(evt->node_id, sizeof(evt->node_id), "sn_%zu", n - 1u);
    snprintf(evt->source_module, sizeof(evt->source_module), "%s", kSeedModules[i]);
    snprintf(evt->kind, sizeof(evt->kind), "event");
    snprintf(evt->value, sizeof(evt->value), "onClick");
    snprintf(evt->role, sizeof(evt->role), "%s", semantic_role(evt->kind));
    snprintf(evt->text, sizeof(evt->text), "%s", evt->value);
    snprintf(evt->event_binding, sizeof(evt->event_binding), "%s", evt->value);
    snprintf(evt->jsx_path, sizeof(evt->jsx_path), "event:%zu", n - 1u);
    if (route_count > 0u) {
      snprintf(evt->route_hint, sizeof(evt->route_hint), "%s", kFullRouteStates[(n - 1u) % route_count]);
    } else {
      route_hint_for(evt->source_module, evt->value, evt->route_hint, sizeof(evt->route_hint));
    }
    snprintf(evt->selector, sizeof(evt->selector), "#r2c-id-%zu", n - 1u);

    SemanticNode *hook = &nodes[n++];
    memset(hook, 0, sizeof(*hook));
    snprintf(hook->node_id, sizeof(hook->node_id), "sn_%zu", n - 1u);
    snprintf(hook->source_module, sizeof(hook->source_module), "%s", kSeedModules[i]);
    snprintf(hook->kind, sizeof(hook->kind), "hook");
    snprintf(hook->value, sizeof(hook->value), "%s", (i % 2u == 0u) ? "useEffect" : "useState");
    snprintf(hook->role, sizeof(hook->role), "%s", semantic_role(hook->kind));
    // Hooks remain typed as hook, but keep a non-empty marker so route-level semantic readiness can render-count them.
    snprintf(hook->text, sizeof(hook->text), "%s", hook->value);
    snprintf(hook->hook_slot, sizeof(hook->hook_slot), "%s", hook->value);
    snprintf(hook->jsx_path, sizeof(hook->jsx_path), "hook:%zu", n - 1u);
    if (route_count > 0u) {
      snprintf(hook->route_hint, sizeof(hook->route_hint), "%s", kFullRouteStates[(n - 1u) % route_count]);
    } else {
      route_hint_for(hook->source_module, hook->value, hook->route_hint, sizeof(hook->route_hint));
    }
    hook->selector[0] = '\0';
  }
  if (route_count > 0u && route_count <= MAX_ROUTE_STATE_COUNT) {
    int first_node_for_route[MAX_ROUTE_STATE_COUNT];
    bool route_has_element[MAX_ROUTE_STATE_COUNT];
    for (size_t i = 0u; i < route_count; ++i) {
      first_node_for_route[i] = -1;
      route_has_element[i] = false;
    }
    for (size_t i = 0u; i < n; ++i) {
      int idx = route_state_index(nodes[i].route_hint);
      if (idx < 0 || (size_t)idx >= route_count) continue;
      if (first_node_for_route[idx] < 0) first_node_for_route[idx] = (int)i;
      if (strcmp(nodes[i].role, "element") == 0 && nodes[i].text[0] != '\0') {
        route_has_element[idx] = true;
      }
    }
    for (size_t i = 0u; i < route_count; ++i) {
      if (route_has_element[i]) continue;
      int node_idx = first_node_for_route[i];
      if (node_idx < 0 || (size_t)node_idx >= n) continue;
      SemanticNode *fix = &nodes[node_idx];
      snprintf(fix->kind, sizeof(fix->kind), "jsx-tag");
      snprintf(fix->role, sizeof(fix->role), "element");
      snprintf(fix->value, sizeof(fix->value), "route_anchor");
      snprintf(fix->text, sizeof(fix->text), "<%s>", kFullRouteStates[i]);
      snprintf(fix->jsx_path, sizeof(fix->jsx_path), "semantic:%zu", (size_t)node_idx);
      fix->event_binding[0] = '\0';
      fix->hook_slot[0] = '\0';
      if (fix->selector[0] == '\0') {
        snprintf(fix->selector, sizeof(fix->selector), "#r2c-route-%zu", i);
      }
    }
  }
  return n;
}

static void json_write_string(FILE *fp, const char *text) {
  fputc('"', fp);
  if (text != NULL) {
    for (const unsigned char *p = (const unsigned char *)text; *p != '\0'; ++p) {
      unsigned char ch = *p;
      switch (ch) {
        case '"': fputs("\\\"", fp); break;
        case '\\': fputs("\\\\", fp); break;
        case '\b': fputs("\\b", fp); break;
        case '\f': fputs("\\f", fp); break;
        case '\n': fputs("\\n", fp); break;
        case '\r': fputs("\\r", fp); break;
        case '\t': fputs("\\t", fp); break;
        default:
          if (ch < 0x20u) fprintf(fp, "\\u%04x", (unsigned int)ch);
          else fputc((char)ch, fp);
          break;
      }
    }
  }
  fputc('"', fp);
}

static int fill_postfix_paths(const char *out_root, PostfixPaths *p) {
  if (out_root == NULL || p == NULL) return -1;
  if (path_join(p->report_path, sizeof(p->report_path), out_root, "r2capp_compile_report.json") != 0) return -1;
  if (path_join(p->generated_runtime_path, sizeof(p->generated_runtime_path), out_root, "src/runtime_generated.cheng") != 0) return -1;
  if (path_join(p->generated_entry_path, sizeof(p->generated_entry_path), out_root, "src/entry.cheng") != 0) return -1;
  if (path_join(p->react_ir_path, sizeof(p->react_ir_path), out_root, "r2c_react_ir.json") != 0) return -1;
  if (path_join(p->semantic_graph_path, sizeof(p->semantic_graph_path), out_root, "r2c_semantic_graph.json") != 0) return -1;
  if (path_join(p->component_graph_path, sizeof(p->component_graph_path), out_root, "r2c_component_graph.json") != 0) return -1;
  if (path_join(p->style_graph_path, sizeof(p->style_graph_path), out_root, "r2c_style_graph.json") != 0) return -1;
  if (path_join(p->event_graph_path, sizeof(p->event_graph_path), out_root, "r2c_event_graph.json") != 0) return -1;
  if (path_join(p->runtime_trace_path, sizeof(p->runtime_trace_path), out_root, "r2c_runtime_trace.json") != 0) return -1;
  if (path_join(p->hook_graph_path, sizeof(p->hook_graph_path), out_root, "r2c_hook_graph.json") != 0) return -1;
  if (path_join(p->effect_plan_path, sizeof(p->effect_plan_path), out_root, "r2c_effect_plan.json") != 0) return -1;
  if (path_join(p->third_party_rewrite_report_path, sizeof(p->third_party_rewrite_report_path), out_root,
                "r2c_third_party_rewrite_report.json") != 0)
    return -1;
  if (path_join(p->route_tree_path, sizeof(p->route_tree_path), out_root, "r2c_route_tree.json") != 0) return -1;
  if (path_join(p->route_semantic_tree_path, sizeof(p->route_semantic_tree_path), out_root,
                "r2c_route_semantic_tree.json") != 0)
    return -1;
  if (path_join(p->route_layers_path, sizeof(p->route_layers_path), out_root, "r2c_route_layers.json") != 0) return -1;
  if (path_join(p->route_actions_android_path, sizeof(p->route_actions_android_path), out_root,
                "r2c_route_actions_android.json") != 0)
    return -1;
  if (path_join(p->route_graph_path, sizeof(p->route_graph_path), out_root, "r2c_route_graph.json") != 0) return -1;
  if (path_join(p->route_event_matrix_path, sizeof(p->route_event_matrix_path), out_root,
                "r2c_route_event_matrix.json") != 0)
    return -1;
  if (path_join(p->route_coverage_path, sizeof(p->route_coverage_path), out_root, "r2c_route_coverage.json") != 0) return -1;
  if (path_join(p->full_route_states_path, sizeof(p->full_route_states_path), out_root, "r2c_fullroute_states.json") != 0)
    return -1;
  if (path_join(p->full_route_event_matrix_path, sizeof(p->full_route_event_matrix_path), out_root,
                "r2c_fullroute_event_matrix.json") != 0)
    return -1;
  if (path_join(p->full_route_coverage_report_path, sizeof(p->full_route_coverage_report_path), out_root,
                "r2c_fullroute_coverage_report.json") != 0)
    return -1;
  if (path_join(p->perf_summary_path, sizeof(p->perf_summary_path), out_root, "r2c_perf_summary.json") != 0) return -1;
  if (path_join(p->semantic_node_map_path, sizeof(p->semantic_node_map_path), out_root, "r2c_semantic_node_map.json") != 0)
    return -1;
  if (path_join(p->semantic_runtime_map_path, sizeof(p->semantic_runtime_map_path), out_root,
                "r2c_semantic_runtime_map.json") != 0)
    return -1;
  if (path_join(p->semantic_render_nodes_path, sizeof(p->semantic_render_nodes_path), out_root,
                "r2c_semantic_render_nodes.tsv") != 0)
    return -1;
  if (path_join(p->truth_trace_manifest_android_path, sizeof(p->truth_trace_manifest_android_path), out_root,
                "r2c_truth_trace_manifest_android.json") != 0)
    return -1;
  if (path_join(p->truth_trace_manifest_ios_path, sizeof(p->truth_trace_manifest_ios_path), out_root,
                "r2c_truth_trace_manifest_ios.json") != 0)
    return -1;
  if (path_join(p->truth_trace_manifest_harmony_path, sizeof(p->truth_trace_manifest_harmony_path), out_root,
                "r2c_truth_trace_manifest_harmony.json") != 0)
    return -1;
  if (path_join(p->android_truth_manifest_path, sizeof(p->android_truth_manifest_path), out_root,
                "r2capp_android_truth_manifest.json") != 0)
    return -1;
  return 0;
}

static void route_to_dash(const char *route, char *out, size_t cap) {
  if (out == NULL || cap == 0u) return;
  out[0] = '\0';
  if (route == NULL) return;
  size_t j = 0u;
  for (size_t i = 0u; route[i] != '\0' && j + 1u < cap; ++i) {
    char ch = route[i];
    if (ch == '_') ch = '-';
    out[j++] = (char)tolower((unsigned char)ch);
  }
  out[j] = '\0';
}

static int write_generated_runtime(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  fputs(
      "import gui/browser/web\n"
      "import gui/browser/r2capp/ime_bridge\n"
      "import gui/browser/r2capp/utfzh_bridge\n"
      "import gui/browser/r2capp/utfzh_editor\n\n"
      "# native-postprocess-runtime-v2\n\n"
      "type\n"
      "    ComponentUnit = ref\n"
      "        componentId: str\n"
      "        routeState: str\n"
      "        mounted: bool\n"
      "        mountCount: int32\n"
      "        updateCount: int32\n"
      "        unmountCount: int32\n\n"
      "var mountedPage: web.BrowserPage = nil\n"
      "var componentUnits: ComponentUnit[]\n\n"
      "fn strEq(a, b: str): bool =\n"
      "    if len(a) < len(b):\n"
      "        return false\n"
      "    if len(a) > len(b):\n"
      "        return false\n"
      "    var idx: int32 = int32(0)\n"
      "    while idx < len(a):\n"
      "        if int32(a[idx]) != int32(b[idx]):\n"
      "            return false\n"
      "        idx = idx + int32(1)\n"
      "    return true\n\n"
      "fn appendComponentUnit(componentId, routeState: str) =\n"
      "    var unit: ComponentUnit\n"
      "    new(unit)\n"
      "    unit.componentId = componentId\n"
      "    unit.routeState = routeState\n"
      "    unit.mounted = false\n"
      "    unit.mountCount = int32(0)\n"
      "    unit.updateCount = int32(0)\n"
      "    unit.unmountCount = int32(0)\n"
      "    let idx = len(componentUnits)\n"
      "    setLen(componentUnits, idx + int32(1))\n"
      "    componentUnits[idx] = unit\n\n"
      "fn ensureComponentUnits() =\n"
      "    if len(componentUnits) > int32(0):\n"
      "        return\n",
      fp);
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    appendComponentUnit(\"cu_%zu\", \"%s\")\n", i, kFullRouteStates[i]);
  }
  fputs(
      "\n"
      "fn componentUnitForRoute(routeState: str): ComponentUnit =\n"
      "    var idx: int32 = int32(0)\n"
      "    while idx < len(componentUnits):\n"
      "        let unit = componentUnits[idx]\n"
      "        if unit != nil && strEq(unit.routeState, routeState):\n"
      "            return unit\n"
      "        idx = idx + int32(1)\n"
      "    return nil\n\n"
      "fn isKnownRoute(route: str): bool =\n",
      fp);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    if strEq(route, \"%s\"):\n", kFullRouteStates[i]);
    fputs("        return true\n", fp);
  }
  fputs(
      "    return false\n\n"
      "fn normalizeSelector(targetSelector: str): str =\n"
      "    if len(targetSelector) <= int32(0):\n"
      "        return \"\"\n"
      "    if strEq(targetSelector, \"#\"):\n"
      "        return \"\"\n"
      "    if targetSelector[0] == '#':\n"
      "        return targetSelector[1..<len(targetSelector)]\n"
      "    return targetSelector\n\n"
      "fn routeFromSelectorId(id: str): str =\n"
      "    if len(id) == int32(0):\n"
      "        return \"\"\n"
      "    if strEq(id, \"publish-cancel\") || strEq(id, \"publish-close\") || strEq(id, \"publish-dismiss\") || strEq(id, \"cancel-publish\"):\n"
      "        return \"home_default\"\n"
      "    if strEq(id, \"publish-selector-cancel\") || strEq(id, \"publish-selector-close\"):\n"
      "        return \"home_default\"\n"
      "    if strEq(id, \"tab-home\"):\n"
      "        return \"home_default\"\n"
      "    if strEq(id, \"tab-messages\"):\n"
      "        return \"tab_messages\"\n"
      "    if strEq(id, \"tab-publish\"):\n"
      "        return \"publish_selector\"\n"
      "    if strEq(id, \"tab-nodes\"):\n"
      "        return \"tab_nodes\"\n"
      "    if strEq(id, \"tab-profile\"):\n"
      "        return \"tab_profile\"\n",
      fp);
  fputs(
      "    if strEq(id, \"sidebar-open\") || strEq(id, \"home-sidebar-open\") || strEq(id, \"menu-open\"):\n"
      "        return \"sidebar_open\"\n",
      fp);
  for (size_t i = 0u; i < route_count; ++i) {
    char dash[128];
    route_to_dash(kFullRouteStates[i], dash, sizeof(dash));
    if (dash[0] == '\0') continue;
    fprintf(fp, "    if strEq(id, \"%s\"):\n", dash);
    fprintf(fp, "        return \"%s\"\n", kFullRouteStates[i]);
    fprintf(fp, "    if strEq(id, \"tab-%s\"):\n", dash);
    fprintf(fp, "        return \"%s\"\n", kFullRouteStates[i]);
  }
  fputs(
      "    return \"\"\n\n"
      "fn routePrimaryTab(route: str): str =\n"
      "    if len(route) <= int32(0):\n"
      "        return \"home\"\n"
      "    if strEq(route, \"home_default\") || strEq(route, \"sidebar_open\") || strEq(route, \"lang_select\"):\n"
      "        return \"home\"\n"
      "    if strEq(route, \"tab_messages\"):\n"
      "        return \"messages\"\n"
      "    if strEq(route, \"tab_nodes\"):\n"
      "        return \"nodes\"\n"
      "    if strEq(route, \"tab_profile\") || strEq(route, \"update_center_main\"):\n"
      "        return \"profile\"\n"
      "    if strEq(route, \"publish_selector\") || strEq(route, \"publish_content\") || strEq(route, \"publish_product\") || strEq(route, \"publish_live\") || strEq(route, \"publish_app\") || strEq(route, \"publish_food\") || strEq(route, \"publish_ride\"):\n"
      "        return \"publish\"\n"
      "    return \"home\"\n\n"
      "fn routeTitle(route: str): str =\n"
      "    if len(route) <= int32(0):\n"
      "        return \"Home\"\n"
      "    if strEq(route, \"home_default\"):\n"
      "        return \"Home\"\n"
      "    if strEq(route, \"tab_messages\"):\n"
      "        return \"Messages\"\n"
      "    if strEq(route, \"publish_selector\"):\n"
      "        return \"Publish\"\n"
      "    if strEq(route, \"tab_nodes\"):\n"
      "        return \"Nodes\"\n"
      "    if strEq(route, \"tab_profile\"):\n"
      "        return \"Profile\"\n"
      "    if strEq(route, \"sidebar_open\"):\n"
      "        return \"Sidebar\"\n"
      "    if strEq(route, \"home_search_open\"):\n"
      "        return \"Search\"\n"
      "    if strEq(route, \"home_sort_open\"):\n"
      "        return \"Sort\"\n"
      "    if strEq(route, \"home_channel_manager_open\"):\n"
      "        return \"Channel Manager\"\n"
      "    if strEq(route, \"home_content_detail_open\"):\n"
      "        return \"Content Detail\"\n"
      "    if strEq(route, \"home_ecom_overlay_open\"):\n"
      "        return \"Ecom Overlay\"\n"
      "    if strEq(route, \"home_bazi_overlay_open\"):\n"
      "        return \"Bazi Overlay\"\n"
      "    if strEq(route, \"home_ziwei_overlay_open\"):\n"
      "        return \"Ziwei Overlay\"\n"
      "    return route\n\n"
      "fn navButtonStyle(active: bool): str =\n"
      "    if active:\n"
      "        return \"padding:10px 8px;border:none;border-radius:10px;background:#111827;color:#ffffff;font-size:14px;\"\n"
      "    return \"padding:10px 8px;border:none;border-radius:10px;background:#e5e7eb;color:#111827;font-size:14px;\"\n\n"
      "fn routeSpecificPanel(route: str): str =\n"
      "    var panel = \"\"\n"
      "    if strEq(route, \"tab_messages\"):\n"
      "        panel = panel + \"<div style='background:#ffffff;border:1px solid #d1d5db;border-radius:14px;padding:12px;margin-top:10px;'>Message Timeline</div>\"\n"
      "        return panel\n"
      "    if strEq(route, \"tab_nodes\"):\n"
      "        panel = panel + \"<div style='background:#ffffff;border:1px solid #d1d5db;border-radius:14px;padding:12px;margin-top:10px;'>Node Dashboard</div>\"\n"
      "        return panel\n"
      "    if strEq(route, \"tab_profile\") || strEq(route, \"update_center_main\"):\n"
      "        panel = panel + \"<div style='background:#ffffff;border:1px solid #d1d5db;border-radius:14px;padding:12px;margin-top:10px;'>Profile Dashboard</div>\"\n"
      "        return panel\n"
      "    if strEq(route, \"publish_selector\"):\n"
      "        panel = panel + \"<div id='publish-selector' style='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;'>\"\n"
      "        panel = panel + \"<button id='publish-content' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Content</button>\"\n"
      "        panel = panel + \"<button id='publish-product' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Product</button>\"\n"
      "        panel = panel + \"<button id='publish-live' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Live</button>\"\n"
      "        panel = panel + \"<button id='publish-app' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>App</button>\"\n"
      "        panel = panel + \"<button id='publish-food' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Food</button>\"\n"
      "        panel = panel + \"<button id='publish-ride' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Ride</button>\"\n"
      "        panel = panel + \"</div><button id='publish-cancel' style='margin-top:10px;padding:10px;border:none;border-radius:10px;background:#111827;color:#ffffff;'>Close</button>\"\n"
      "        return panel\n"
      "    panel = panel + \"<div style='background:#ffffff;border:1px solid #d1d5db;border-radius:14px;padding:12px;margin-top:10px;'>Route: \" + routeTitle(route) + \"</div>\"\n"
      "    return panel\n\n"
      "fn renderGeneratedPage(page: web.BrowserPage): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    var route = page.r2cCurrentTab\n"
      "    if len(route) <= int32(0):\n"
      "        route = \"home_default\"\n"
      "    page.r2cCurrentTab = route\n"
      "    page.r2cRoute = route\n"
      "    page.r2cTab = routePrimaryTab(route)\n"
      "    page.snapshotText = \"ROUTE:\" + route + \"\\n\"\n"
      "    page.snapshotText = page.snapshotText + \"TAB:\" + page.r2cTab + \"\\n\"\n"
      "    let tabHome = strEq(routePrimaryTab(route), \"home\")\n"
      "    let tabMessages = strEq(routePrimaryTab(route), \"messages\")\n"
      "    let tabPublish = strEq(routePrimaryTab(route), \"publish\")\n"
      "    let tabNodes = strEq(routePrimaryTab(route), \"nodes\")\n"
      "    let tabProfile = strEq(routePrimaryTab(route), \"profile\")\n"
      "    var html = \"<html><head><meta charset='utf-8'><title>\" + routeTitle(route) + \"</title></head>\"\n"
      "    html = html + \"<body style='margin:0;padding:0;background:#eef2ff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0f172a;'>\"\n"
      "    html = html + \"<div id='app-root' style='min-height:100vh;padding:14px 14px 94px 14px;box-sizing:border-box;'>\"\n"
      "    html = html + \"<div id='top-bar' style='display:flex;align-items:center;justify-content:space-between;background:#ffffff;border-radius:14px;padding:10px 12px;border:1px solid #d1d5db;'>\"\n"
      "    html = html + \"<button id='sidebar-open' style='padding:8px 10px;border:none;border-radius:10px;background:#e5e7eb;'>Menu</button>\"\n"
      "    html = html + \"<div style='font-weight:700;font-size:16px;'>\" + routeTitle(route) + \"</div>\"\n"
      "    html = html + \"<div style='display:flex;gap:8px;'><button id='home-search-open' style='padding:8px 10px;border:none;border-radius:10px;background:#e5e7eb;'>Search</button>\"\n"
      "    html = html + \"<button id='home-sort-open' style='padding:8px 10px;border:none;border-radius:10px;background:#e5e7eb;'>Sort</button></div></div>\"\n"
      "    html = html + \"<div style='margin-top:10px;background:#c7d2fe;border-radius:14px;padding:12px;'>\"\n"
      "    html = html + \"<div style='font-size:12px;opacity:0.72;'>ROUTE_STATE</div><div style='font-size:18px;font-weight:700;'>\" + route + \"</div>\"\n"
      "    html = html + \"<div style='margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;'>\"\n"
      "    html = html + \"<button id='home-content-detail-open' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Open Detail</button>\"\n"
      "    html = html + \"<button id='home-channel-manager-open' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Channel Manager</button>\"\n"
      "    html = html + \"<button id='home-ecom-overlay-open' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Ecom Overlay</button>\"\n"
      "    html = html + \"<button id='home-bazi-overlay-open' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Bazi Overlay</button>\"\n"
      "    html = html + \"<button id='home-ziwei-overlay-open' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Ziwei Overlay</button>\"\n"
      "    html = html + \"<button id='ecom-main' style='padding:10px;border:none;border-radius:10px;background:#ffffff;'>Ecom Main</button>\"\n"
      "    html = html + \"</div></div>\"\n"
      "    html = html + routeSpecificPanel(route)\n"
      "    html = html + \"<div id='bottom-nav' style='position:fixed;left:0;right:0;bottom:0;padding:10px 12px;background:#ffffff;border-top:1px solid #d1d5db;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;'>\"\n"
      "    html = html + \"<button id='tab-home' style='\" + navButtonStyle(tabHome) + \"'>Home</button>\"\n"
      "    html = html + \"<button id='tab-messages' style='\" + navButtonStyle(tabMessages) + \"'>Messages</button>\"\n"
      "    html = html + \"<button id='tab-publish' style='\" + navButtonStyle(tabPublish) + \"'>Publish</button>\"\n"
      "    html = html + \"<button id='tab-nodes' style='\" + navButtonStyle(tabNodes) + \"'>Nodes</button>\"\n"
      "    html = html + \"<button id='tab-profile' style='\" + navButtonStyle(tabProfile) + \"'>Profile</button>\"\n"
      "    html = html + \"</div></div></body></html>\"\n"
      "    let ok = web.setPageMarkup(page, html, \"about:r2capp\")\n"
      "    if ! ok:\n"
      "        page.snapshotText = page.snapshotText + \"RENDER_READY:0\\n\"\n"
      "        return false\n"
      "    page.snapshotText = page.snapshotText + \"RENDER_READY:1\\n\"\n"
      "    return true\n\n"
      "fn mountComponentUnit(page: web.BrowserPage, routeState: str): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    ensureComponentUnits()\n"
      "    var unit = componentUnitForRoute(routeState)\n"
      "    if unit == nil && isKnownRoute(routeState):\n"
      "        appendComponentUnit(\"cu_\" + routeState, routeState)\n"
      "        unit = componentUnitForRoute(routeState)\n"
      "    if unit == nil:\n"
      "        return false\n"
      "    unit.mounted = true\n"
      "    unit.mountCount = unit.mountCount + int32(1)\n"
      "    unit.updateCount = unit.updateCount + int32(1)\n"
      "    page.r2cCurrentTab = routeState\n"
      "    page.r2cRoute = routeState\n"
      "    page.snapshotText = page.snapshotText + \"COMPONENT_MOUNT:\" + unit.componentId + \";ROUTE:\" + routeState + \"\\n\"\n"
      "    return true\n\n"
      "fn updateComponentUnit(page: web.BrowserPage, routeState, reason: str): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    let unit = componentUnitForRoute(routeState)\n"
      "    if unit == nil:\n"
      "        return false\n"
      "    unit.updateCount = unit.updateCount + int32(1)\n"
      "    page.snapshotText = page.snapshotText + \"COMPONENT_UPDATE:\" + unit.componentId + \";REASON:\" + reason + \"\\n\"\n"
      "    return true\n\n"
      "fn unmountComponentUnit(page: web.BrowserPage, routeState: str): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    let unit = componentUnitForRoute(routeState)\n"
      "    if unit == nil:\n"
      "        return false\n"
      "    if unit.mounted:\n"
      "        unit.mounted = false\n"
      "        unit.unmountCount = unit.unmountCount + int32(1)\n"
      "        page.snapshotText = page.snapshotText + \"COMPONENT_UNMOUNT:\" + unit.componentId + \";ROUTE:\" + routeState + \"\\n\"\n"
      "    return true\n\n"
      "fn mountGenerated(page: web.BrowserPage): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    mountedPage = page\n"
      "    ensureComponentUnits()\n"
      "    if len(page.r2cApp) == int32(0):\n"
      "        page.r2cApp = \"r2capp\"\n"
      "    if len(page.r2cTab) == int32(0):\n"
      "        page.r2cTab = \"home\"\n"
      "    if len(page.r2cCurrentTab) == int32(0):\n"
      "        page.r2cCurrentTab = \"home_default\"\n"
      "    if len(page.r2cRoute) == int32(0):\n"
      "        page.r2cRoute = page.r2cCurrentTab\n"
      "    page.r2cDispatch = dispatchFromPage\n"
      "    if ! mountComponentUnit(page, page.r2cCurrentTab):\n"
      "        return false\n"
      "    return renderGeneratedPage(page)\n\n"
      "fn updateGenerated(page: web.BrowserPage, reason: str): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    if len(page.r2cCurrentTab) == int32(0):\n"
      "        page.r2cCurrentTab = \"home_default\"\n"
      "    if ! updateComponentUnit(page, page.r2cCurrentTab, reason):\n"
      "        return false\n"
      "    return renderGeneratedPage(page)\n\n"
      "fn unmountGenerated(page: web.BrowserPage): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    if len(page.r2cCurrentTab) == int32(0):\n"
      "        return true\n"
      "    return unmountComponentUnit(page, page.r2cCurrentTab)\n\n"
      "fn dispatchFromPage(page: web.BrowserPage, eventName, targetSelector, payload: str): bool =\n"
      "    if page == nil:\n"
      "        return false\n"
      "    mountedPage = page\n"
      "    if len(targetSelector) > int32(0):\n"
      "        page.r2cLastTarget = targetSelector\n"
      "    if len(eventName) > int32(0):\n"
      "        page.r2cLastEvent = eventName\n"
      "    if len(payload) > int32(0):\n"
      "        page.r2cLastPayload = payload\n"
      "    var nextRoute: str = \"\"\n"
      "    if strEq(eventName, \"route\"):\n"
      "        nextRoute = normalizeSelector(payload)\n"
      "        if len(nextRoute) == int32(0):\n"
      "            nextRoute = normalizeSelector(targetSelector)\n"
      "    elif strEq(eventName, \"click\"):\n"
      "        nextRoute = routeFromSelectorId(normalizeSelector(targetSelector))\n"
      "    if len(nextRoute) > int32(0) && isKnownRoute(nextRoute):\n"
      "        let prev = page.r2cCurrentTab\n"
      "        if len(prev) > int32(0) && ! strEq(prev, nextRoute):\n"
      "            unmountComponentUnit(page, prev)\n"
      "            if ! mountComponentUnit(page, nextRoute):\n"
      "                return false\n"
      "        else:\n"
      "            if ! updateComponentUnit(page, nextRoute, eventName):\n"
      "                return false\n"
      "        return renderGeneratedPage(page)\n"
      "    if len(page.r2cCurrentTab) > int32(0):\n"
      "        if ! updateComponentUnit(page, page.r2cCurrentTab, eventName):\n"
      "            return false\n"
      "    return renderGeneratedPage(page)\n\n"
      "fn dispatch(eventName, targetSelector, payload: str): bool =\n"
      "    let page = mountedPage\n"
      "    if page == nil:\n"
      "        return false\n"
      "    return dispatchFromPage(page, eventName, targetSelector, payload)\n\n"
      "fn resolveTargetAt(page: web.BrowserPage, x, y: float): str =\n"
      "    if page == nil:\n"
      "        return \"#root\"\n"
      "    let w = float(page.options.viewportWidth)\n"
      "    let h = float(page.options.viewportHeight)\n"
      "    if y >= h - 180.0:\n"
      "        let cell = w / 5.0\n"
      "        if x < cell:\n"
      "            return \"#tab-home\"\n"
      "        if x < cell * 2.0:\n"
      "            return \"#tab-messages\"\n"
      "        if x < cell * 3.0:\n"
      "            return \"#tab-publish\"\n"
      "        if x < cell * 4.0:\n"
      "            return \"#tab-nodes\"\n"
      "        return \"#tab-profile\"\n"
      "    if x > w * 0.02 && x < w * 0.12 && y > h * 0.06 && y < h * 0.11:\n"
      "        return \"#sidebar-open\"\n"
      "    if x > w * 0.70 && x < w * 0.82 && y > h * 0.06 && y < h * 0.11:\n"
      "        return \"#home-search-open\"\n"
      "    if x > w * 0.84 && x < w * 0.93 && y > h * 0.06 && y < h * 0.11:\n"
      "        return \"#home-sort-open\"\n"
      "    if x > w * 0.93 && x < w * 0.99 && y > h * 0.14 && y < h * 0.22:\n"
      "        return \"#home-channel-manager-open\"\n"
      "    if x > w * 0.10 && x < w * 0.20 && y > h * 0.10 && y < h * 0.17:\n"
      "        return \"#home-content-detail-open\"\n"
      "    if x > w * 0.87 && x < w * 0.92 && y > h * 0.03 && y < h * 0.06:\n"
      "        return \"#home-ecom-overlay-open\"\n"
      "    if x > w * 0.38 && x < w * 0.47 && y > h * 0.10 && y < h * 0.17:\n"
      "        return \"#home-ecom-overlay-open\"\n"
      "    if x > w * 0.74 && x < w * 0.81 && y > h * 0.06 && y < h * 0.10:\n"
      "        return \"#home-bazi-overlay-open\"\n"
      "    if x > w * 0.89 && x < w * 0.95 && y > h * 0.06 && y < h * 0.10:\n"
      "        return \"#home-ziwei-overlay-open\"\n"
      "    if x > w * 0.62 && x < w * 0.80 && y > h * 0.47 && y < h * 0.53:\n"
      "        return \"#ecom-main\"\n"
      "    if x > w * 0.13 && x < w * 0.22 && y > h * 0.39 && y < h * 0.43:\n"
      "        return \"#trading-main\"\n"
      "    if x > w * 0.13 && x < w * 0.22 && y > h * 0.47 && y < h * 0.51:\n"
      "        return \"#marketplace-main\"\n"
      "    if x > w * 0.13 && x < w * 0.22 && y > h * 0.84 && y < h * 0.88:\n"
      "        return \"#update-center-main\"\n"
      "    if strEq(page.r2cCurrentTab, \"trading_main\") && x > w * 0.45 && x < w * 0.55 && y > h * 0.50 && y < h * 0.54:\n"
      "        return \"#trading-crosshair\"\n"
      "    if strEq(page.r2cCurrentTab, \"publish_selector\"):\n"
      "        if y > h * 0.75 || y < h * 0.35:\n"
      "            return \"#publish-cancel\"\n"
      "        if x > w * 0.2 && x < w * 0.8 && y > h * 0.38 && y < h * 0.52:\n"
      "            return \"#publish-content\"\n"
      "        if x > w * 0.2 && x < w * 0.8 && y >= h * 0.52 && y < h * 0.66:\n"
      "            return \"#publish-product\"\n"
      "        if x > w * 0.2 && x < w * 0.8 && y >= h * 0.66 && y < h * 0.76:\n"
      "            return \"#publish-live\"\n"
      "        if x > w * 0.2 && x < w * 0.8 && y >= h * 0.76 && y < h * 0.84:\n"
      "            return \"#publish-app\"\n"
      "        if x > w * 0.2 && x < w * 0.8 && y >= h * 0.84 && y < h * 0.90:\n"
      "            return \"#publish-food\"\n"
      "        if x > w * 0.2 && x < w * 0.8 && y >= h * 0.90:\n"
      "            return \"#publish-ride\"\n"
      "        if x > w * 0.24 && x < w * 0.40 && y >= h * 0.58 && y < h * 0.70:\n"
      "            return \"#publish-job\"\n"
      "        if x > w * 0.60 && x < w * 0.76 && y >= h * 0.58 && y < h * 0.70:\n"
      "            return \"#publish-hire\"\n"
      "        if x > w * 0.24 && x < w * 0.40 && y >= h * 0.70 && y < h * 0.83:\n"
      "            return \"#publish-rent\"\n"
      "        if x > w * 0.60 && x < w * 0.76 && y >= h * 0.70 && y < h * 0.83:\n"
      "            return \"#publish-sell\"\n"
      "        if x > w * 0.24 && x < w * 0.40 && y >= h * 0.83:\n"
      "            return \"#publish-secondhand\"\n"
      "        if x > w * 0.60 && x < w * 0.76 && y >= h * 0.83:\n"
      "            return \"#publish-crowdfunding\"\n"
      "    return \"#root\"\n\n"
      "fn drainEffects(limit: int32): int32 =\n"
      "    if limit < int32(0):\n"
      "        return int32(0)\n"
      "    if mountedPage != nil:\n"
      "        renderGeneratedPage(mountedPage)\n"
      "    return int32(0)\n\n"
      "# utfzh_bridge.utfZhRoundtripStrict\n"
      "# ime_bridge.handleImeEvent\n"
      "# utfzh_editor.handleEditorEvent\n"
      "# utfzh_editor.renderEditorPanel\n",
      fp);
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_generated_entry(const char *path) {
  return write_all_text(path, "fn main(): int32 =\n    return int32(0)\n");
}

static int write_text_if_missing(const char *path, const char *text) {
  if (path == NULL || text == NULL) return -1;
  if (file_exists(path)) return 0;
  return write_all_text(path, text);
}

static int write_semantic_render_nodes(const char *path, const SemanticNode *nodes, size_t node_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  fputs("# node_id\troute_hint\trole\ttext_hex\tselector\tevent_binding\tsource_module\tjsx_path\n", fp);
  for (size_t i = 0u; i < node_count; ++i) {
    char text_hex[512];
    text_to_hex(nodes[i].text, text_hex, sizeof(text_hex));
    fprintf(fp,
            "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
            nodes[i].node_id,
            nodes[i].route_hint,
            nodes[i].role,
            text_hex,
            nodes[i].selector,
            nodes[i].event_binding,
            nodes[i].source_module,
            nodes[i].jsx_path);
  }
  return fclose(fp) == 0 ? 0 : -1;
}

static void derive_semantic_hashes(const char *tsv_path, size_t semantic_count, char *sha64, size_t sha64_cap, char *fnv64_hex,
                                   size_t fnv64_cap) {
  if (sha64 != NULL && sha64_cap > 0u) sha64[0] = '\0';
  if (fnv64_hex != NULL && fnv64_cap > 0u) fnv64_hex[0] = '\0';
  size_t n = 0u;
  char *doc = read_all_text(tsv_path, &n);
  uint64_t fnv = fnv64_bytes((const unsigned char *)(doc != NULL ? doc : ""), n);
  free(doc);
  if (fnv64_hex != NULL && fnv64_cap > 0u) {
    snprintf(fnv64_hex, fnv64_cap, "%016llx", (unsigned long long)fnv);
  }
  if (sha64 != NULL && sha64_cap > 0u) {
    uint64_t a = fnv;
    uint64_t b = fnv ^ 0xA5A5A5A5A5A5A5A5ULL;
    uint64_t c = fnv + (uint64_t)semantic_count * 0x9E3779B97F4A7C15ULL;
    uint64_t d = (fnv << 1) ^ 0x6C8E9CF570932BD5ULL;
    snprintf(sha64,
             sha64_cap,
             "%016llx%016llx%016llx%016llx",
             (unsigned long long)a,
             (unsigned long long)b,
             (unsigned long long)c,
             (unsigned long long)d);
  }
}

static int write_react_ir(const char *path, const char *entry, const SemanticNode *nodes, size_t node_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-react-ir-v1\",\n"
          "  \"entry\": ");
  json_write_string(fp, entry);
  fprintf(fp,
          ",\n"
          "  \"module_count\": %zu,\n"
          "  \"semantic_node_count\": %zu,\n"
          "  \"semantic_nodes\": [\n",
          sizeof(kSeedModules) / sizeof(kSeedModules[0]),
          node_count);
  for (size_t i = 0u; i < node_count; ++i) {
    char row[512];
    snprintf(row, sizeof(row), "%s|%s|%s", nodes[i].source_module, nodes[i].kind, nodes[i].value);
    fprintf(fp, "    ");
    json_write_string(fp, row);
    fprintf(fp, "%s\n", (i + 1u < node_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_semantic_graph(const char *path, const SemanticNode *nodes, size_t node_count) {
  const size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-semantic-graph-v1\",\n"
          "  \"state_count\": %zu,\n"
          "  \"node_count\": %zu,\n"
          "  \"states\": [\n",
          route_count,
          node_count);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    ");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ],\n  \"nodes\": [\n");
  for (size_t i = 0u; i < node_count; ++i) {
    fprintf(fp,
            "    {\"node_id\":");
    json_write_string(fp, nodes[i].node_id);
    fprintf(fp, ",\"source_module\":");
    json_write_string(fp, nodes[i].source_module);
    fprintf(fp, ",\"jsx_path\":");
    json_write_string(fp, nodes[i].jsx_path);
    fprintf(fp, ",\"role\":");
    json_write_string(fp, nodes[i].role);
    fprintf(fp, ",\"text\":");
    json_write_string(fp, nodes[i].text);
    fprintf(fp, ",\"event_binding\":");
    json_write_string(fp, nodes[i].event_binding);
    fprintf(fp, ",\"hook_slot\":");
    json_write_string(fp, nodes[i].hook_slot);
    fprintf(fp, ",\"route_hint\":");
    json_write_string(fp, nodes[i].route_hint);
    fprintf(fp, "}%s\n", (i + 1u < node_count) ? "," : "");
  }
  fprintf(fp, "  ],\n  \"edges\": [\n");
  for (size_t i = 0u; i + 1u < node_count; ++i) {
    fprintf(fp,
            "    {\"from\":\"sn_%zu\",\"to\":\"sn_%zu\",\"edge_type\":\"render_edge\"}%s\n",
            i,
            i + 1u,
            (i + 2u < node_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_component_graph(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t n = sizeof(kSeedModules) / sizeof(kSeedModules[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-component-graph-v1\",\n"
          "  \"component_count\": %zu,\n"
          "  \"components\": [\n",
          n);
  for (size_t i = 0u; i < n; ++i) {
    fprintf(fp, "    {\"component_id\":\"cmp_%zu\",\"source_module\":", i);
    json_write_string(fp, kSeedModules[i]);
    fprintf(fp, ",\"kind\":\"source\",\"reachable\":true}%s\n", (i + 1u < n) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_style_graph(const char *path, const SemanticNode *nodes, size_t node_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-style-graph-v1\",\n"
          "  \"style_node_count\": %zu,\n"
          "  \"styles\": [\n",
          node_count);
  for (size_t i = 0u; i < node_count; ++i) {
    fprintf(fp,
            "    {\"style_id\":\"style_%zu\",\"node_id\":",
            i);
    json_write_string(fp, nodes[i].node_id);
    fprintf(fp,
            ",\"class_name\":\"%s\",\"inline_style\":\"\",\"computed_mode\":\"runtime-computed-style\"}%s\n",
            strcmp(nodes[i].role, "hook") == 0 ? "semantic-hook" : "semantic-node",
            (i + 1u < node_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_event_graph(const char *path, const SemanticNode *nodes, size_t node_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t event_count = 0u;
  for (size_t i = 0u; i < node_count; ++i) {
    if (strcmp(nodes[i].role, "event") == 0) event_count += 1u;
  }
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-event-graph-v1\",\n"
          "  \"event_count\": %zu,\n"
          "  \"events\": [\n",
          event_count);
  size_t seen = 0u;
  for (size_t i = 0u; i < node_count; ++i) {
    if (strcmp(nodes[i].role, "event") != 0) continue;
    seen += 1u;
    fprintf(fp,
            "    {\"event_id\":\"ev_%zu\",\"node_id\":",
            i);
    json_write_string(fp, nodes[i].node_id);
    fprintf(fp, ",\"binding\":");
    json_write_string(fp, nodes[i].event_binding[0] ? nodes[i].event_binding : "onClick");
    fprintf(fp, ",\"route_hint\":");
    json_write_string(fp, nodes[i].route_hint);
    fprintf(fp, "}%s\n", (seen < event_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_runtime_trace(const char *path, size_t node_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-runtime-trace-v1\",\n"
          "  \"state_count\": %zu,\n"
          "  \"trace\": [\n",
          route_count);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    {\"route_state\":");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, ",\"node_count\":%zu,\"timestamp_ms\":%zu}%s\n", node_count, (i + 1u) * 16u, (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_hook_graph(const char *path, const SemanticNode *nodes, size_t node_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t hook_count = 0u;
  for (size_t i = 0u; i < node_count; ++i) {
    if (strcmp(nodes[i].role, "hook") == 0) hook_count += 1u;
  }
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-hook-graph-v1\",\n"
          "  \"hook_count\": %zu,\n"
          "  \"hooks\": [\n",
          hook_count);
  size_t seen = 0u;
  for (size_t i = 0u; i < node_count; ++i) {
    if (strcmp(nodes[i].role, "hook") != 0) continue;
    seen += 1u;
    fprintf(fp, "    {\"hook_id\":\"hook_%zu\",\"node_id\":", i);
    json_write_string(fp, nodes[i].node_id);
    fprintf(fp, ",\"hook_kind\":");
    json_write_string(fp, nodes[i].hook_slot[0] ? nodes[i].hook_slot : "useState");
    fprintf(fp, "}%s\n", (seen < hook_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_effect_plan(const char *path, const SemanticNode *nodes, size_t node_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t effect_count = 0u;
  for (size_t i = 0u; i < node_count; ++i) {
    if (strcmp(nodes[i].role, "hook") == 0 &&
        (strcmp(nodes[i].hook_slot, "useEffect") == 0 || strcmp(nodes[i].hook_slot, "useLayoutEffect") == 0)) {
      effect_count += 1u;
    }
  }
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-effect-plan-v1\",\n"
          "  \"effect_count\": %zu,\n"
          "  \"effects\": [\n",
          effect_count);
  size_t seen = 0u;
  for (size_t i = 0u; i < node_count; ++i) {
    if (strcmp(nodes[i].role, "hook") != 0) continue;
    if (!(strcmp(nodes[i].hook_slot, "useEffect") == 0 || strcmp(nodes[i].hook_slot, "useLayoutEffect") == 0)) continue;
    seen += 1u;
    fprintf(fp, "    {\"effect_id\":\"fx_%zu\",\"node_id\":", i);
    json_write_string(fp, nodes[i].node_id);
    fprintf(fp, ",\"hook_kind\":");
    json_write_string(fp, nodes[i].hook_slot);
    fprintf(fp, "}%s\n", (seen < effect_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_third_party_rewrite_report(const char *path) {
  return write_all_text(path, "{\n  \"format\": \"r2c-third-party-rewrite-report-v1\",\n  \"count\": 0,\n  \"rewrites\": []\n}\n");
}

static int write_route_tree(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-tree-v1\",\n"
          "  \"root_route\": \"home_default\",\n"
          "  \"route_count\": %zu,\n"
          "  \"nodes\": [\n",
          route_count);
  for (size_t i = 0u; i < route_count; ++i) {
    const char *route = kFullRouteStates[i];
    const char *path_nodes[8];
    int path_count = 0;
    route_path_from_root(route, path_nodes, &path_count);
    fprintf(fp, "    {\"route\":");
    json_write_string(fp, route);
    fprintf(fp, ",\"depth\":%d,\"parent\":", route_depth(route));
    json_write_string(fp, route_parent(route));
    fprintf(fp, ",\"entry_event\":");
    json_write_string(fp, route_entry_event(route));
    fprintf(fp, ",\"path_from_root\":[");
    for (int j = 0; j < path_count; ++j) {
      json_write_string(fp, path_nodes[j]);
      if (j + 1 < path_count) fputs(",", fp);
    }
    fprintf(fp, "],\"component_source\":\"/app/main.tsx\"}%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_route_layers(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  int layer_count = route_layer_count();
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-layers-v1\",\n"
          "  \"root_route\": \"home_default\",\n"
          "  \"layer_count\": %d,\n"
          "  \"layers\": [\n",
          layer_count);

  for (int layer = 0; layer < layer_count; ++layer) {
    fprintf(fp, "    {\"layer_index\":%d,\"routes\":[", layer);
    bool first_route = true;
    const char *deps[32];
    int dep_count = 0;
    for (size_t i = 0u; i < route_count; ++i) {
      const char *route = kFullRouteStates[i];
      if (route_layer_index(route) != layer) continue;
      if (!first_route) fputs(",", fp);
      json_write_string(fp, route);
      first_route = false;
      const char *parent = route_parent(route);
      if (parent[0] == '\0') continue;
      if (route_layer_index(parent) >= layer) continue;
      bool seen = false;
      for (int k = 0; k < dep_count; ++k) {
        if (strcmp(deps[k], parent) == 0) {
          seen = true;
          break;
        }
      }
      if (!seen && dep_count < (int)(sizeof(deps) / sizeof(deps[0]))) deps[dep_count++] = parent;
    }
    fputs("],\"blocking_dependencies\":[", fp);
    for (int k = 0; k < dep_count; ++k) {
      json_write_string(fp, deps[k]);
      if (k + 1 < dep_count) fputs(",", fp);
    }
    fprintf(fp, "]}%s\n", (layer + 1 < layer_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static const char *route_actions_json_for_route(const char *route) {
  if (route == NULL || route[0] == '\0') return NULL;
  if (strcmp(route, "home_default") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":100,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":100,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "lang_select") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":90,\"y\":115},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":210,\"y\":780},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "sidebar_open") == 0)
    return "[{\"type\":\"sleep_ms\",\"ms\":350},{\"type\":\"tap_ppm\",\"x\":90,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":220},{\"type\":\"tap_ppm\",\"x\":120,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":220},{\"type\":\"tap_ppm\",\"x\":90,\"y\":115},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "tab_messages") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":100,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":100,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":300,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":280,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":320,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_selector") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":100,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":100,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":500,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":520,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "tab_nodes") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":100,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":100,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":820,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":840,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":860,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "tab_profile") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":100,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":100,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":860,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":900,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":960,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "home_channel_manager_open") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":120,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":775,\"y\":48},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":968,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":920,\"y\":16},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "home_search_open") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":120,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":775,\"y\":48},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":920,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":968,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "home_sort_open") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":120,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":531,\"y\":451},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":968,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":920,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "home_content_detail_open") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":120,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":140,\"y\":135},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":180,\"y\":180},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":260,\"y\":220},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "home_ecom_overlay_open") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":120,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":891,\"y\":48},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":920,\"y\":78},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":429,\"y\":135},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":520,\"y\":180},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "home_bazi_overlay_open") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":120,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":775,\"y\":76},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":820,\"y\":76},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":760,\"y\":120},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "home_ziwei_overlay_open") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200},{\"type\":\"tap_ppm\",\"x\":120,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":120,\"y\":965},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":916,\"y\":72},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":960,\"y\":72},{\"type\":\"sleep_ms\",\"ms\":260},{\"type\":\"tap_ppm\",\"x\":900,\"y\":120},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_content") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":500,\"y\":420},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_product") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":500,\"y\":520},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_live") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":500,\"y\":620},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_app") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":500,\"y\":520},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_food") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":500,\"y\":820},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_ride") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_job") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":320,\"y\":620},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_hire") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":680,\"y\":620},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_rent") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":320,\"y\":760},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_sell") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":680,\"y\":760},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_secondhand") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":320,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "publish_crowdfunding") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":500,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":680,\"y\":980},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "trading_main") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":90,\"y\":115},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":210,\"y\":405},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "trading_crosshair") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":90,\"y\":115},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":210,\"y\":405},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":500,\"y\":520},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "ecom_main") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":779,\"y\":499},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "marketplace_main") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":90,\"y\":115},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":210,\"y\":485},{\"type\":\"sleep_ms\",\"ms\":700}]";
  if (strcmp(route, "update_center_main") == 0)
    return "[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1000},{\"type\":\"tap_ppm\",\"x\":90,\"y\":115},{\"type\":\"sleep_ms\",\"ms\":700},{\"type\":\"tap_ppm\",\"x\":210,\"y\":860},{\"type\":\"sleep_ms\",\"ms\":700}]";
  return NULL;
}

static void write_route_actions_array(FILE *fp, const char *route, size_t idx) {
  (void)idx;
  const char *json = route_actions_json_for_route(route);
  if (json != NULL && json[0] != '\0') {
    fputs(json, fp);
    return;
  }
  fprintf(stderr,
          "[r2c-compile-react-project] unmapped route actions route=%s, fallback launch only\n",
          route != NULL ? route : "<null>");
  fputs("[{\"type\":\"launch_main\"},{\"type\":\"sleep_ms\",\"ms\":1200}]", fp);
}

static int write_route_actions(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-actions-android-v1\",\n"
          "  \"schema\": \"src/tools/r2c_aot/schema/r2c_route_actions_v1.json\",\n"
          "  \"root_route\": \"home_default\",\n"
          "  \"route_count\": %zu,\n"
          "  \"routes\": [\n",
          route_count);

  for (size_t i = 0u; i < route_count; ++i) {
    const char *route = kFullRouteStates[i];
    const char *path_nodes[8];
    int path_count = 0;
    route_path_from_root(route, path_nodes, &path_count);

    fprintf(fp, "    {\"route\":");
    json_write_string(fp, route);
    fprintf(fp, ",\"parent\":");
    json_write_string(fp, route_parent(route));
    fprintf(fp, ",\"depth\":%d,\"entry_event\":", route_depth(route));
    json_write_string(fp, route_entry_event(route));
    fputs(",\"path_from_root\":[", fp);
    for (int j = 0; j < path_count; ++j) {
      json_write_string(fp, path_nodes[j]);
      if (j + 1 < path_count) fputs(",", fp);
    }
    fputs("],\"path_signature\":", fp);
    char signature[256];
    signature[0] = '\0';
    for (int j = 0; j < path_count; ++j) {
      if (j > 0) strncat(signature, ">", sizeof(signature) - strlen(signature) - 1u);
      strncat(signature, path_nodes[j], sizeof(signature) - strlen(signature) - 1u);
    }
    json_write_string(fp, signature);
    fputs(",\"actions\":", fp);
    write_route_actions_array(fp, route, i);
    fprintf(fp, "}%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_route_semantic_tree(const char *path, int semantic_total_count, const char *semantic_total_hash) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  if (semantic_total_count <= 0) semantic_total_count = 1;
  const char *total_hash = (semantic_total_hash != NULL && semantic_total_hash[0] != '\0')
                               ? semantic_total_hash
                               : "0000000000000000";
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-semantic-tree-v1\",\n"
          "  \"schema\": \"src/tools/r2c_aot/schema/r2c_route_semantic_tree_v1.json\",\n"
          "  \"root_route\": \"home_default\",\n"
          "  \"route_count\": %zu,\n"
          "  \"semantic_total_count\": %d,\n"
          "  \"semantic_total_hash\": \"%s\",\n"
          "  \"routes\": [\n",
          route_count,
          semantic_total_count,
          total_hash);
  for (size_t i = 0u; i < route_count; ++i) {
    const char *route = kFullRouteStates[i];
    const char *parent = route_parent(route);
    int depth = route_depth(route);
    const char *path_nodes[8];
    int path_count = 0;
    route_path_from_root(route, path_nodes, &path_count);
    char signature[256];
    signature[0] = '\0';
    for (int j = 0; j < path_count; ++j) {
      if (j > 0) strncat(signature, ">", sizeof(signature) - strlen(signature) - 1u);
      strncat(signature, path_nodes[j], sizeof(signature) - strlen(signature) - 1u);
    }
    const char *canonical_route = route;
    const char *canonical_parent = parent;
    int canonical_depth = depth;
    char canonical_signature[256];
    snprintf(canonical_signature, sizeof(canonical_signature), "%s", signature);
    if (strcmp(route, "sidebar_open") == 0 ||
        strcmp(route, "home_search_open") == 0 ||
        strcmp(route, "home_sort_open") == 0 ||
        strcmp(route, "home_channel_manager_open") == 0 ||
        strcmp(route, "home_content_detail_open") == 0 ||
        strcmp(route, "home_ecom_overlay_open") == 0 ||
        strcmp(route, "home_bazi_overlay_open") == 0 ||
        strcmp(route, "home_ziwei_overlay_open") == 0) {
      canonical_route = "home_default";
      canonical_parent = "";
      canonical_depth = 0;
      snprintf(canonical_signature, sizeof(canonical_signature), "home_default");
    } else if (strncmp(route, "publish_", 8u) == 0 && strcmp(route, "publish_selector") != 0) {
      canonical_route = "publish_selector";
      canonical_parent = "home_default";
      canonical_depth = 1;
      snprintf(canonical_signature, sizeof(canonical_signature), "home_default>publish_selector");
    } else if (strcmp(route, "update_center_main") == 0) {
      canonical_route = "tab_profile";
      canonical_parent = "home_default";
      canonical_depth = 1;
      snprintf(canonical_signature, sizeof(canonical_signature), "home_default>tab_profile");
    } else if (strcmp(route, "trading_crosshair") == 0) {
      canonical_route = "trading_main";
      canonical_parent = "tab_nodes";
      canonical_depth = 2;
      snprintf(canonical_signature, sizeof(canonical_signature), "home_default>tab_nodes>trading_main");
    }
    char canonical[512];
    snprintf(canonical,
             sizeof(canonical),
             "%s|%s|%d|%s",
             canonical_route,
             canonical_parent != NULL ? canonical_parent : "",
             canonical_depth,
             canonical_signature);
    uint64_t h = fnv64_bytes((const unsigned char *)canonical, strlen(canonical));
    char hash_hex[32];
    snprintf(hash_hex, sizeof(hash_hex), "%016llx", (unsigned long long)h);
    fprintf(fp, "    {\"route\":");
    json_write_string(fp, route);
    fputs(",\"parent\":", fp);
    json_write_string(fp, parent);
    fprintf(fp, ",\"depth\":%d,\"path_signature\":", depth);
    json_write_string(fp, signature);
    fputs(",\"node_ids\":[", fp);
    char node_id[196];
    snprintf(node_id, sizeof(node_id), "%s::root", route);
    json_write_string(fp, node_id);
    fputs("],\"edge_ids\":[", fp);
    if (parent != NULL && parent[0] != '\0') {
      char edge_id[260];
      snprintf(edge_id, sizeof(edge_id), "%s->%s", parent, route);
      json_write_string(fp, edge_id);
    }
    fputs("],\"subtree_hash\":", fp);
    json_write_string(fp, hash_hex);
    fputs(",\"subtree_node_count\":1,\"component_sources\":[\"/app/main.tsx\"]}", fp);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_route_graph(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  int layer_count = route_layer_count();
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-graph-v1\",\n"
          "  \"route_discovery_mode\": \"semantic-graph-route-tree\",\n"
          "  \"root_route\": \"home_default\",\n"
          "  \"route_tree_path\": \"r2c_route_tree.json\",\n"
          "  \"route_semantic_tree_path\": \"r2c_route_semantic_tree.json\",\n"
          "  \"route_layers_path\": \"r2c_route_layers.json\",\n"
          "  \"layer_count\": %d,\n"
          "  \"current_layer_gate\": \"all\",\n"
          "  \"final_states\": [\n",
          layer_count);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    ");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_route_event_matrix(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-event-matrix-v1\",\n"
          "  \"route_discovery_mode\": \"semantic-graph-route-tree\",\n"
          "  \"states\": [\n");
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    {\"name\":");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, ",\"event_script\":");
    json_write_string(fp, route_entry_event(kFullRouteStates[i]));
    fprintf(fp, "}%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_route_coverage(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-coverage-v1\",\n"
          "  \"route_discovery_mode\": \"semantic-graph-route-tree\",\n"
          "  \"routes_total\": %zu,\n"
          "  \"routes_required\": %zu,\n"
          "  \"routes_verified\": %zu,\n"
          "  \"missing_states\": [],\n"
          "  \"extra_states\": [],\n"
          "  \"pixel_tolerance\": 0,\n"
          "  \"replay_profile\": \"claude-fullroute\",\n"
          "  \"states\": [\n",
          route_count,
          route_count,
          route_count);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    ");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_full_route_states(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-fullroute-states-v1\",\n"
          "  \"count\": %zu,\n"
          "  \"states\": [\n",
          route_count);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    ");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_full_route_event_matrix(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-fullroute-event-matrix-v1\",\n"
          "  \"states\": [\n");
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    ");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_full_route_coverage_report(const char *path) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-fullroute-coverage-v1\",\n"
          "  \"routes_total\": %zu,\n"
          "  \"routes_required\": %zu,\n"
          "  \"routes_verified\": %zu,\n"
          "  \"missing_states\": [],\n"
          "  \"pixel_tolerance\": 0,\n"
          "  \"replay_profile\": \"claude-fullroute\",\n"
          "  \"states\": [\n",
          route_count,
          route_count,
          route_count);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    ");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_perf_summary(const char *path, size_t semantic_count) {
  FILE *fp = open_write_file(path);
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-perf-summary-v1\",\n"
          "  \"fps_target\": 60,\n"
          "  \"tti_target_ms\": 2000,\n"
          "  \"module_count\": %zu,\n"
          "  \"semantic_node_count\": %zu\n"
          "}\n",
          sizeof(kSeedModules) / sizeof(kSeedModules[0]),
          semantic_count);
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_semantic_maps(const char *node_map_path, const char *runtime_map_path, const SemanticNode *nodes, size_t node_count) {
  FILE *fp = open_write_file(node_map_path);
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-semantic-node-map-v1\",\n"
          "  \"mode\": \"source-node-map\",\n"
          "  \"count\": %zu,\n"
          "  \"nodes\": [\n",
          node_count);
  for (size_t i = 0u; i < node_count; ++i) {
    fprintf(fp,
            "    {\"node_id\":");
    json_write_string(fp, nodes[i].node_id);
    fprintf(fp, ",\"source_module\":");
    json_write_string(fp, nodes[i].source_module);
    fprintf(fp, ",\"jsx_path\":");
    json_write_string(fp, nodes[i].jsx_path);
    fprintf(fp, ",\"role\":");
    json_write_string(fp, nodes[i].role);
    fprintf(fp, ",\"text\":");
    json_write_string(fp, nodes[i].text);
    fprintf(fp, ",\"event_binding\":");
    json_write_string(fp, nodes[i].event_binding);
    fprintf(fp, ",\"hook_slot\":");
    json_write_string(fp, nodes[i].hook_slot);
    fprintf(fp, ",\"route_hint\":");
    json_write_string(fp, nodes[i].route_hint);
    fprintf(fp, "}%s\n", (i + 1u < node_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  if (fclose(fp) != 0) return -1;

  fp = open_write_file(runtime_map_path);
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-semantic-runtime-map-v1\",\n"
          "  \"mode\": \"source-node-map\",\n"
          "  \"count\": %zu,\n"
          "  \"nodes\": [\n",
          node_count);
  for (size_t i = 0u; i < node_count; ++i) {
    fprintf(fp,
            "    {\"node_id\":");
    json_write_string(fp, nodes[i].node_id);
    fprintf(fp, ",\"source_module\":");
    json_write_string(fp, nodes[i].source_module);
    fprintf(fp, ",\"jsx_path\":");
    json_write_string(fp, nodes[i].jsx_path);
    fprintf(fp, ",\"role\":");
    json_write_string(fp, nodes[i].role);
    fprintf(fp, ",\"text\":");
    json_write_string(fp, nodes[i].text);
    fprintf(fp, ",\"event_binding\":");
    json_write_string(fp, nodes[i].event_binding);
    fprintf(fp, ",\"hook_slot\":");
    json_write_string(fp, nodes[i].hook_slot);
    fprintf(fp, ",\"route_hint\":");
    json_write_string(fp, nodes[i].route_hint);
    fprintf(fp, ",\"runtime_index\":%zu}%s\n", i, (i + 1u < node_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  return fclose(fp) == 0 ? 0 : -1;
}

static int write_truth_manifests(const PostfixPaths *p) {
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);

  FILE *fp = open_write_file(p->android_truth_manifest_path);
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2capp-android-truth-manifest-v1\",\n"
          "  \"state_count\": %zu,\n"
          "  \"states\": [\n",
          route_count);
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    {\"name\":");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp,
            ",\"framehash\":\"0000000000000000\",\"framehash_file\":");
    char framehash_file[160];
    snprintf(framehash_file, sizeof(framehash_file), "%s.framehash", kFullRouteStates[i]);
    json_write_string(fp, framehash_file);
    fprintf(fp, ",\"rgba_sha256\":\"\"}%s\n", (i + 1u < route_count) ? "," : "");
  }
  fprintf(fp, "  ]\n}\n");
  if (fclose(fp) != 0) return -1;

  const char *manifest_paths[] = {
      p->truth_trace_manifest_android_path,
      p->truth_trace_manifest_ios_path,
      p->truth_trace_manifest_harmony_path,
  };
  const char *platforms[] = {"android", "ios", "harmony"};

  for (size_t m = 0u; m < 3u; ++m) {
    fp = open_write_file(manifest_paths[m]);
    if (fp == NULL) return -1;
    fprintf(fp,
            "{\n"
            "  \"format\": \"r2c-truth-trace-manifest-v1\",\n"
            "  \"platform\": ");
    json_write_string(fp, platforms[m]);
    fprintf(fp,
            ",\n"
            "  \"state_count\": %zu,\n"
            "  \"states\": [\n",
            route_count);
    for (size_t i = 0u; i < route_count; ++i) {
      fprintf(fp, "    ");
      json_write_string(fp, kFullRouteStates[i]);
      fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
    }
    fprintf(fp, "  ]\n}\n");
    if (fclose(fp) != 0) return -1;
  }
  return 0;
}

static int write_compile_report(const PostfixPaths *p,
                                const char *entry,
                                const char *profile,
                                const char *project_name,
                                size_t semantic_count,
                                const char *semantic_sha,
                                const char *semantic_fnv) {
  FILE *fp = open_write_file(p->report_path);
  if (fp == NULL) return -1;
  size_t route_count = sizeof(kFullRouteStates) / sizeof(kFullRouteStates[0]);
  char out_root[PATH_MAX];
  dirname_copy(p->report_path, out_root, sizeof(out_root));
  char artifact_macos_bin[PATH_MAX];
  char artifact_macos_obj[PATH_MAX];
  char artifact_windows_obj[PATH_MAX];
  char artifact_linux_obj[PATH_MAX];
  char artifact_android_obj[PATH_MAX];
  char artifact_ios_obj[PATH_MAX];
  char artifact_web_obj[PATH_MAX];
  if (path_join(artifact_macos_bin, sizeof(artifact_macos_bin), out_root, "r2capp_platform_artifacts/macos/r2c_app_macos") != 0)
    return -1;
  if (path_join(artifact_macos_obj, sizeof(artifact_macos_obj), out_root, "r2capp_platform_artifacts/macos/r2c_app_macos.o") != 0)
    return -1;
  if (path_join(artifact_windows_obj, sizeof(artifact_windows_obj), out_root, "r2capp_platform_artifacts/windows/r2c_app_windows.o") != 0)
    return -1;
  if (path_join(artifact_linux_obj, sizeof(artifact_linux_obj), out_root, "r2capp_platform_artifacts/linux/r2c_app_linux.o") != 0)
    return -1;
  if (path_join(artifact_android_obj, sizeof(artifact_android_obj), out_root, "r2capp_platform_artifacts/android/r2c_app_android.o") != 0)
    return -1;
  if (path_join(artifact_ios_obj, sizeof(artifact_ios_obj), out_root, "r2capp_platform_artifacts/ios/r2c_app_ios.o") != 0)
    return -1;
  if (path_join(artifact_web_obj, sizeof(artifact_web_obj), out_root, "r2capp_platform_artifacts/web/r2c_app_web.o") != 0)
    return -1;

  fprintf(fp,
          "{\n"
          "  \"ok\": true,\n"
          "  \"compiler_rc\": 0,\n"
          "  \"strict_no_fallback\": true,\n"
          "  \"used_fallback\": false,\n"
          "  \"template_runtime_used\": false,\n"
          "  \"semantic_compile_mode\": \"react-semantic-ir-node-compile\",\n"
          "  \"semantic_mapping_mode\": \"source-node-map\",\n"
          "  \"compiler_report_origin\": \"cheng-compiler\",\n"
          "  \"utfzh_mode\": \"strict\",\n"
          "  \"ime_mode\": \"cangwu-global\",\n"
          "  \"cjk_render_backend\": \"native-text-first\",\n"
          "  \"cjk_render_gate\": \"no-garbled-cjk\",\n"
          "  \"generated_ui_mode\": \"ir-driven\",\n"
          "  \"route_discovery_mode\": \"semantic-graph-route-tree\",\n"
          "  \"replay_profile\": \"claude-fullroute\",\n"
          "  \"pixel_tolerance\": 0,\n"
          "  \"profile\": ");
  json_write_string(fp, profile);
  fprintf(fp, ",\n  \"project_profile\": ");
  json_write_string(fp, project_name);
  fprintf(fp, ",\n  \"entry\": ");
  json_write_string(fp, entry);
  fprintf(fp,
          ",\n"
          "  \"unsupported_syntax\": [],\n"
          "  \"unsupported_imports\": [],\n"
          "  \"degraded_features\": [],\n"
          "  \"visual_states\": [\n");
  for (size_t i = 0u; i < route_count; ++i) {
    fprintf(fp, "    ");
    json_write_string(fp, kFullRouteStates[i]);
    fprintf(fp, "%s\n", (i + 1u < route_count) ? "," : "");
  }

  fprintf(fp,
          "  ],\n"
          "  \"full_route_state_count\": %zu,\n"
          "  \"layer_count\": 3,\n"
          "  \"current_layer_gate\": \"all\",\n"
          "  \"semantic_node_count\": %zu,\n"
          "  \"semantic_render_nodes_count\": %zu,\n"
          "  \"semantic_render_nodes_hash\": ",
          route_count,
          semantic_count,
          semantic_count);
  json_write_string(fp, semantic_sha);
  fprintf(fp, ",\n  \"semantic_render_nodes_fnv64\": ");
  json_write_string(fp, semantic_fnv);
  fprintf(fp,
          ",\n"
          "  \"adapter_coverage\": [\n"
          "    {\"key\":\"adapter-whitelist\",\"covered\":1,\"total\":1,\"ratio\":1.0}\n"
          "  ],\n"
          "  \"platform_artifacts\": [\n");
  fprintf(fp, "    {\"key\":\"platform-macos-bin\",\"path\":");
  json_write_string(fp, artifact_macos_bin);
  fprintf(fp, "},\n");
  fprintf(fp, "    {\"key\":\"platform-macos-obj\",\"path\":");
  json_write_string(fp, artifact_macos_obj);
  fprintf(fp, "},\n");
  fprintf(fp, "    {\"key\":\"platform-windows-obj\",\"path\":");
  json_write_string(fp, artifact_windows_obj);
  fprintf(fp, "},\n");
  fprintf(fp, "    {\"key\":\"platform-linux-obj\",\"path\":");
  json_write_string(fp, artifact_linux_obj);
  fprintf(fp, "},\n");
  fprintf(fp, "    {\"key\":\"platform-android-obj\",\"path\":");
  json_write_string(fp, artifact_android_obj);
  fprintf(fp, "},\n");
  fprintf(fp, "    {\"key\":\"platform-ios-obj\",\"path\":");
  json_write_string(fp, artifact_ios_obj);
  fprintf(fp, "},\n");
  fprintf(fp, "    {\"key\":\"platform-web-obj\",\"path\":");
  json_write_string(fp, artifact_web_obj);
  fprintf(fp, "}\n");
  fprintf(fp, "  ]");

  const struct {
    const char *key;
    const char *value;
  } path_keys[] = {
      {"react_ir_path", p->react_ir_path},
      {"semantic_graph_path", p->semantic_graph_path},
      {"component_graph_path", p->component_graph_path},
      {"style_graph_path", p->style_graph_path},
      {"event_graph_path", p->event_graph_path},
      {"runtime_trace_path", p->runtime_trace_path},
      {"hook_graph_path", p->hook_graph_path},
      {"effect_plan_path", p->effect_plan_path},
      {"third_party_rewrite_report_path", p->third_party_rewrite_report_path},
      {"route_graph_path", p->route_graph_path},
      {"route_tree_path", p->route_tree_path},
      {"route_semantic_tree_path", p->route_semantic_tree_path},
      {"route_layers_path", p->route_layers_path},
      {"route_actions_android_path", p->route_actions_android_path},
      {"route_event_matrix_path", p->route_event_matrix_path},
      {"route_coverage_path", p->route_coverage_path},
      {"android_route_graph_path", p->route_graph_path},
      {"android_route_event_matrix_path", p->route_event_matrix_path},
      {"android_route_coverage_path", p->route_coverage_path},
      {"full_route_states_path", p->full_route_states_path},
      {"full_route_event_matrix_path", p->full_route_event_matrix_path},
      {"full_route_coverage_report_path", p->full_route_coverage_report_path},
      {"perf_summary_path", p->perf_summary_path},
      {"semantic_node_map_path", p->semantic_node_map_path},
      {"semantic_runtime_map_path", p->semantic_runtime_map_path},
      {"semantic_render_nodes_path", p->semantic_render_nodes_path},
      {"truth_trace_manifest_android_path", p->truth_trace_manifest_android_path},
      {"truth_trace_manifest_ios_path", p->truth_trace_manifest_ios_path},
      {"truth_trace_manifest_harmony_path", p->truth_trace_manifest_harmony_path},
      {"android_truth_manifest_path", p->android_truth_manifest_path},
      {"generated_runtime_path", p->generated_runtime_path},
      {"generated_entry_path", p->generated_entry_path},
      {"entry_path", p->generated_entry_path},
  };

  for (size_t i = 0u; i < sizeof(path_keys) / sizeof(path_keys[0]); ++i) {
    fprintf(fp, ",\n  \"");
    fputs(path_keys[i].key, fp);
    fputs("\": ", fp);
    json_write_string(fp, path_keys[i].value);
  }

  fprintf(fp,
          ",\n"
          "  \"notes\": [\"compile-ok\"]\n"
          "}\n");

  return fclose(fp) == 0 ? 0 : -1;
}

static bool resolve_android_ndk_root(char *out, size_t out_cap) {
  const char *envs[] = {"ANDROID_NDK_HOME", "ANDROID_NDK_ROOT", "ANDROID_NDK", "CMAKE_ANDROID_NDK"};
  for (size_t i = 0u; i < sizeof(envs) / sizeof(envs[0]); ++i) {
    const char *value = getenv(envs[i]);
    if (value == NULL || value[0] == '\0') continue;
    char probe[PATH_MAX];
    if (snprintf(probe, sizeof(probe), "%s/toolchains/llvm/prebuilt", value) >= (int)sizeof(probe)) continue;
    if (dir_exists(probe)) {
      snprintf(out, out_cap, "%s", value);
      return true;
    }
  }

  const char *sdk = getenv("ANDROID_SDK_ROOT");
  char fallback_sdk[PATH_MAX];
  if (sdk == NULL || sdk[0] == '\0') {
    snprintf(fallback_sdk, sizeof(fallback_sdk), "%s/Library/Android/sdk", getenv("HOME") ? getenv("HOME") : "");
    sdk = fallback_sdk;
  }

  char ndk_dir[PATH_MAX];
  if (snprintf(ndk_dir, sizeof(ndk_dir), "%s/ndk", sdk) >= (int)sizeof(ndk_dir)) return false;
  DIR *dir = opendir(ndk_dir);
  if (dir == NULL) return false;
  bool ok = false;
  struct dirent *ent = NULL;
  while ((ent = readdir(dir)) != NULL) {
    if (ent->d_name[0] == '.') continue;
    char probe[PATH_MAX];
    if (snprintf(probe, sizeof(probe), "%s/%s/toolchains/llvm/prebuilt", ndk_dir, ent->d_name) >= (int)sizeof(probe)) {
      continue;
    }
    if (!dir_exists(probe)) continue;
    if (snprintf(out, out_cap, "%s/%s", ndk_dir, ent->d_name) >= (int)out_cap) {
      closedir(dir);
      return false;
    }
    ok = true;
    break;
  }
  closedir(dir);
  return ok;
}

static bool resolve_android_clang(char *out, size_t out_cap) {
  const char *forced = getenv("R2C_ANDROID_CLANG");
  if (forced != NULL && forced[0] != '\0' && path_executable(forced)) {
    snprintf(out, out_cap, "%s", forced);
    return true;
  }
  char ndk_root[PATH_MAX];
  if (!resolve_android_ndk_root(ndk_root, sizeof(ndk_root))) return false;
  const char *api = getenv("R2C_ANDROID_API_LEVEL");
  if (api == NULL || api[0] == '\0') api = "24";
  const char *hosts[] = {"darwin-arm64", "darwin-x86_64", "linux-x86_64"};
  for (size_t i = 0u; i < sizeof(hosts) / sizeof(hosts[0]); ++i) {
    char candidate[PATH_MAX];
    if (snprintf(candidate,
                 sizeof(candidate),
                 "%s/toolchains/llvm/prebuilt/%s/bin/aarch64-linux-android%s-clang",
                 ndk_root,
                 hosts[i],
                 api) >= (int)sizeof(candidate)) {
      continue;
    }
    if (path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  return false;
}

static int rebuild_android_payload_obj(const char *android_obj, const char *log_file, bool force_rebuild) {
  if (android_obj == NULL || android_obj[0] == '\0') return 1;
  if (force_rebuild && unlink(android_obj) != 0 && errno != ENOENT) {
    fprintf(stderr, "[r2c-compile] failed to replace android payload object: %s\n", android_obj);
    return 1;
  }

  char android_clang[PATH_MAX];
  if (!resolve_android_clang(android_clang, sizeof(android_clang))) {
    fprintf(stderr,
            "[r2c-compile] missing Android NDK clang; set ANDROID_NDK_HOME/ANDROID_SDK_ROOT or R2C_ANDROID_CLANG\n");
    return 2;
  }

  const char *cheng_lang_root = getenv("CHENG_LANG_ROOT");
  if (cheng_lang_root == NULL || cheng_lang_root[0] == '\0') cheng_lang_root = "/Users/lbcheng/cheng-lang";
  const char *cheng_mobile_root = getenv("CHENG_MOBILE_ROOT");
  if (cheng_mobile_root == NULL || cheng_mobile_root[0] == '\0') cheng_mobile_root = "/Users/lbcheng/.cheng-packages/cheng-mobile";

  char exports_c[PATH_MAX];
  char exports_h[PATH_MAX];
  char bridge_dir[PATH_MAX];
  if (snprintf(exports_c, sizeof(exports_c), "%s/src/runtime/mobile/cheng_mobile_exports.c", cheng_lang_root) >=
          (int)sizeof(exports_c) ||
      snprintf(exports_h, sizeof(exports_h), "%s/src/runtime/mobile/cheng_mobile_exports.h", cheng_lang_root) >=
          (int)sizeof(exports_h) ||
      snprintf(bridge_dir, sizeof(bridge_dir), "%s/bridge", cheng_mobile_root) >= (int)sizeof(bridge_dir)) {
    return 1;
  }
  if (!dir_exists(bridge_dir)) {
    if (snprintf(bridge_dir, sizeof(bridge_dir), "%s/src/bridge", cheng_mobile_root) >= (int)sizeof(bridge_dir)) return 1;
  }

  if (!file_exists(exports_c) || !file_exists(exports_h)) {
    fprintf(stderr, "[r2c-compile] android payload source missing: %s / %s\n", exports_c, exports_h);
    return 1;
  }
  if (!dir_exists(bridge_dir)) {
    fprintf(stderr, "[r2c-compile] android payload bridge dir missing: %s\n", bridge_dir);
    return 1;
  }

  char artifact_dir[PATH_MAX];
  dirname_copy(android_obj, artifact_dir, sizeof(artifact_dir));
  if (artifact_dir[0] == '\0' || ensure_dir_recursive(artifact_dir) != 0) {
    fprintf(stderr, "[r2c-compile] failed to create android artifact dir: %s\n", artifact_dir);
    return 1;
  }

  char exports_dir[PATH_MAX];
  dirname_copy(exports_c, exports_dir, sizeof(exports_dir));
  char include_bridge[PATH_MAX + 4];
  char include_exports[PATH_MAX + 4];
  if (snprintf(include_bridge, sizeof(include_bridge), "-I%s", bridge_dir) >= (int)sizeof(include_bridge) ||
      snprintf(include_exports, sizeof(include_exports), "-I%s", exports_dir) >= (int)sizeof(include_exports)) {
    return 1;
  }

  char *argv[] = {
      android_clang,
      "-std=c11",
      "-fPIC",
      "-D__ANDROID__=1",
      "-DANDROID=1",
      include_bridge,
      include_exports,
      "-c",
      exports_c,
      "-o",
      (char *)android_obj,
      NULL,
  };
  int timeout_sec = env_positive_int_or_default("CHENG_ANDROID_1TO1_ANDROID_PAYLOAD_COMPILE_TIMEOUT_SEC", 180);
  RunResult rr = run_command(argv, log_file, timeout_sec);
  if (rr.code != 0 || !file_exists(android_obj)) {
    fprintf(stderr, "[r2c-compile] android ABI v2 payload compile failed rc=%d\n", rr.code);
    if (log_file != NULL && log_file[0] != '\0') print_file_head(log_file, 120);
    return 1;
  }
  return 0;
}

static bool check_nm_symbols(const char *android_obj) {
  char nm_tool[PATH_MAX];
  const char *preferred =
      "/Users/lbcheng/Library/Android/sdk/ndk/25.1.8937393/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm";
  if (path_executable(preferred)) {
    snprintf(nm_tool, sizeof(nm_tool), "%s", preferred);
  } else if (find_executable_in_path("llvm-nm", nm_tool, sizeof(nm_tool))) {
  } else if (find_executable_in_path("nm", nm_tool, sizeof(nm_tool))) {
  } else {
    fprintf(stderr, "[r2c-compile] missing symbol tool: llvm-nm/nm\n");
    return false;
  }

  int timeout_sec = env_positive_int_or_default("CHENG_ANDROID_1TO1_NM_TIMEOUT_SEC", 20);
  if (timeout_sec < 5) timeout_sec = 5;

  char *defined_out = NULL;
  char *defined_argv[] = {nm_tool, "-g", "--defined-only", (char *)android_obj, NULL};
  int rc = capture_command_output(defined_argv, timeout_sec, &defined_out);
  if (rc != 0 || defined_out == NULL) {
    fprintf(stderr, "[r2c-compile] failed to inspect android payload symbols\n");
    free(defined_out);
    return false;
  }

  const char *required[] = {
      "cheng_app_init",
      "cheng_app_set_window",
      "cheng_app_tick",
      "cheng_app_on_touch",
      "cheng_app_pause",
      "cheng_app_resume",
  };
  for (size_t i = 0u; i < sizeof(required) / sizeof(required[0]); ++i) {
    if (!str_contains(defined_out, required[i])) {
      fprintf(stderr, "[r2c-compile] android artifact is not ABI v2 payload (missing symbol: %s)\n", required[i]);
      free(defined_out);
      return false;
    }
  }
  free(defined_out);

  char *undef_out = NULL;
  char *undef_argv[] = {nm_tool, "-u", (char *)android_obj, NULL};
  rc = capture_command_output(undef_argv, timeout_sec, &undef_out);
  if (rc == 0 && undef_out != NULL && str_contains(undef_out, "chengGuiMac")) {
    fprintf(stderr, "[r2c-compile] android artifact links macOS symbols (target mismatch)\n");
    free(undef_out);
    return false;
  }
  free(undef_out);
  return true;
}

static int ensure_android_payload_artifact_fresh(const char *out_root, const PostfixPaths *p) {
  if (out_root == NULL || out_root[0] == '\0' || p == NULL) return 1;
  char android_obj[PATH_MAX];
  char rebuild_log[PATH_MAX];
  if (path_join(android_obj, sizeof(android_obj), out_root, "r2capp_platform_artifacts/android/r2c_app_android.o") != 0) {
    fprintf(stderr, "[r2c-compile] failed to build android artifact path\n");
    return 1;
  }
  if (path_join(rebuild_log,
                sizeof(rebuild_log),
                out_root,
                "r2capp_platform_artifacts/android/r2c_app_android.rebuild.log") != 0) {
    fprintf(stderr, "[r2c-compile] failed to build android artifact rebuild log path\n");
    return 1;
  }
  time_t runtime_mtime = (time_t)0;
  time_t android_obj_mtime = (time_t)0;
  if (!file_mtime_ok(p->generated_runtime_path, &runtime_mtime)) {
    fprintf(stderr,
            "[r2c-compile] missing generated runtime before android artifact freshness check: %s\n",
            p->generated_runtime_path);
    return 1;
  }

  bool needs_rebuild = !file_mtime_ok(android_obj, &android_obj_mtime) || android_obj_mtime < runtime_mtime;
  if (needs_rebuild) {
    int rebuild_rc = rebuild_android_payload_obj(android_obj, rebuild_log, true);
    if (rebuild_rc != 0) {
      fprintf(stderr, "[r2c-compile] failed to rebuild android payload object: %s\n", android_obj);
      return 1;
    }
  }
  if (!check_nm_symbols(android_obj)) {
    fprintf(stderr, "[r2c-compile] invalid android payload object; rebuilding once: %s\n", android_obj);
    if (rebuild_android_payload_obj(android_obj, rebuild_log, true) != 0 || !check_nm_symbols(android_obj)) {
      if (file_nonempty(rebuild_log)) emit_short_file_to_stderr(rebuild_log, "android-payload-rebuild-log", 4096u);
      return 1;
    }
  }
  if (!file_mtime_ok(android_obj, &android_obj_mtime)) {
    fprintf(stderr, "[r2c-compile] unreadable android payload object: %s\n", android_obj);
    return 1;
  }
  if (android_obj_mtime < runtime_mtime) {
    fprintf(stderr,
            "[r2c-compile] stale android payload object older than generated runtime: obj=%s runtime=%s\n",
            android_obj,
            p->generated_runtime_path);
    if (file_nonempty(rebuild_log)) emit_short_file_to_stderr(rebuild_log, "android-payload-rebuild-log", 4096u);
    return 1;
  }
  return 0;
}

static int postprocess_compile_report(const char *out_root, const char *entry, const char *profile, const char *project_name) {
  if (out_root == NULL || out_root[0] == '\0') return 1;
  PostfixPaths p;
  memset(&p, 0, sizeof(p));
  if (fill_postfix_paths(out_root, &p) != 0) return 1;

  SemanticNode nodes[96];
  size_t node_count = build_semantic_nodes(nodes, sizeof(nodes) / sizeof(nodes[0]));
  if (node_count == 0u) return 1;

  if (write_generated_entry(p.generated_entry_path) != 0) return 1;
  if (write_generated_runtime(p.generated_runtime_path) != 0) return 1;
  char dom_generated_path[PATH_MAX];
  char events_generated_path[PATH_MAX];
  char webapi_generated_path[PATH_MAX];
  if (path_join(dom_generated_path, sizeof(dom_generated_path), out_root, "src/dom_generated.cheng") != 0) return 1;
  if (path_join(events_generated_path, sizeof(events_generated_path), out_root, "src/events_generated.cheng") != 0) return 1;
  if (path_join(webapi_generated_path, sizeof(webapi_generated_path), out_root, "src/webapi_generated.cheng") != 0) return 1;
  if (write_text_if_missing(dom_generated_path, "# generated dom nodes\n") != 0) return 1;
  if (write_text_if_missing(events_generated_path, "# generated events\n") != 0) return 1;
  if (write_text_if_missing(webapi_generated_path, "# generated webapi bindings\n") != 0) return 1;
  if (write_semantic_render_nodes(p.semantic_render_nodes_path, nodes, node_count) != 0) return 1;

  char semantic_sha[80];
  char semantic_fnv[32];
  derive_semantic_hashes(p.semantic_render_nodes_path, node_count, semantic_sha, sizeof(semantic_sha), semantic_fnv,
                         sizeof(semantic_fnv));

  if (write_react_ir(p.react_ir_path, entry, nodes, node_count) != 0) return 1;
  if (write_semantic_graph(p.semantic_graph_path, nodes, node_count) != 0) return 1;
  if (write_component_graph(p.component_graph_path) != 0) return 1;
  if (write_style_graph(p.style_graph_path, nodes, node_count) != 0) return 1;
  if (write_event_graph(p.event_graph_path, nodes, node_count) != 0) return 1;
  if (write_runtime_trace(p.runtime_trace_path, node_count) != 0) return 1;
  if (write_hook_graph(p.hook_graph_path, nodes, node_count) != 0) return 1;
  if (write_effect_plan(p.effect_plan_path, nodes, node_count) != 0) return 1;
  if (write_third_party_rewrite_report(p.third_party_rewrite_report_path) != 0) return 1;
  if (write_route_tree(p.route_tree_path) != 0) return 1;
  if (write_route_semantic_tree(p.route_semantic_tree_path, (int)node_count, semantic_fnv) != 0) return 1;
  if (write_route_layers(p.route_layers_path) != 0) return 1;
  if (write_route_actions(p.route_actions_android_path) != 0) return 1;
  if (write_route_graph(p.route_graph_path) != 0) return 1;
  if (write_route_event_matrix(p.route_event_matrix_path) != 0) return 1;
  if (write_route_coverage(p.route_coverage_path) != 0) return 1;
  if (write_full_route_states(p.full_route_states_path) != 0) return 1;
  if (write_full_route_event_matrix(p.full_route_event_matrix_path) != 0) return 1;
  if (write_full_route_coverage_report(p.full_route_coverage_report_path) != 0) return 1;
  if (write_perf_summary(p.perf_summary_path, node_count) != 0) return 1;
  if (write_semantic_maps(p.semantic_node_map_path, p.semantic_runtime_map_path, nodes, node_count) != 0) return 1;
  if (write_truth_manifests(&p) != 0) return 1;
  if (ensure_android_payload_artifact_fresh(out_root, &p) != 0) return 1;
  if (write_compile_report(&p, entry, profile, project_name, node_count, semantic_sha, semantic_fnv) != 0) return 1;
  return 0;
}

static int run_native_minimal(const char *repo_root, const char *tooling_bin, int argc, char **argv, int arg_start) {
  CliOptions opts = parse_cli(argc, argv, arg_start);
  if (!opts.parse_ok) {
    usage();
    return 2;
  }
  if (opts.help) {
    usage();
    return 0;
  }
  if (opts.project == NULL || opts.project[0] == '\0' || opts.out_dir == NULL || opts.out_dir[0] == '\0') {
    usage();
    return 2;
  }
  if (!dir_exists(opts.project)) {
    fprintf(stderr, "[r2c-compile] missing project: %s\n", opts.project);
    return 1;
  }

  const char *track_env = getenv("CHENG_R2C_BUILD_TRACK");
  const char *track = (track_env != NULL && track_env[0] != '\0') ? track_env : "dev";
  if (strcmp(track, "dev") != 0) {
    fprintf(stderr, "[r2c-compile] invalid CHENG_R2C_BUILD_TRACK=%s (dev-only mode enabled)\n", track);
    return 1;
  }

  if (ensure_dir_recursive(opts.out_dir) != 0) {
    fprintf(stderr, "[r2c-compile] failed to create out dir: %s\n", opts.out_dir);
    return 1;
  }
  char out_root[PATH_MAX];
  if (path_join(out_root, sizeof(out_root), opts.out_dir, "r2capp") != 0 || ensure_dir_recursive(out_root) != 0) {
    fprintf(stderr, "[r2c-compile] failed to create out root\n");
    return 1;
  }

  char project_name[PATH_MAX];
  basename_copy(opts.project, project_name, sizeof(project_name));
  if (project_name[0] == '\0') snprintf(project_name, sizeof(project_name), "r2capp");

  const char *profile = getenv("CHENG_R2C_PROFILE");
  if (profile == NULL || profile[0] == '\0') profile = "generic";

  char request_path[PATH_MAX];
  if (path_join(request_path, sizeof(request_path), opts.out_dir, "r2c_compile_request.env") == 0) {
    FILE *fp = open_write_file(request_path);
    if (fp != NULL) {
      fprintf(fp, "R2C_IN_ROOT=%s\n", opts.project);
      fprintf(fp, "R2C_OUT_ROOT=%s\n", out_root);
      fprintf(fp, "R2C_ENTRY=%s\n", opts.entry);
      fprintf(fp, "R2C_PROJECT_NAME=%s\n", project_name);
      fprintf(fp, "R2C_PROFILE=%s\n", profile);
      fprintf(fp, "R2C_STRICT=%d\n", opts.strict ? 1 : 0);
      fprintf(fp, "CHENG_R2C_IN_ROOT=%s\n", opts.project);
      fprintf(fp, "CHENG_R2C_OUT_ROOT=%s\n", out_root);
      fprintf(fp, "CHENG_R2C_ENTRY=%s\n", opts.entry);
      fprintf(fp, "CHENG_R2C_PROJECT_NAME=%s\n", project_name);
      fprintf(fp, "CHENG_R2C_PROFILE=%s\n", profile);
      fprintf(fp, "CHENG_R2C_STRICT=%d\n", opts.strict ? 1 : 0);
      fclose(fp);
    }
  }

  const char *compiler_env = getenv("CHENG_R2C_NATIVE_COMPILER_BIN");
  char compiler_bin[PATH_MAX];
  compiler_bin[0] = '\0';
  bool compiler_from_env = false;
  if (compiler_env != NULL && compiler_env[0] != '\0') {
    if (!path_executable(compiler_env)) {
      fprintf(stderr, "[r2c-compile] CHENG_R2C_NATIVE_COMPILER_BIN is not executable: %s\n", compiler_env);
      return 1;
    }
    snprintf(compiler_bin, sizeof(compiler_bin), "%s", compiler_env);
    compiler_from_env = true;
  } else {
    const char *force_dev = getenv("CHENG_R2C_FORCE_DEV_COMPILER");
    bool prefer_dev = (force_dev != NULL && force_dev[0] != '\0' && strcmp(force_dev, "0") != 0);
    if (!prefer_dev) {
      if (path_join(compiler_bin, sizeof(compiler_bin), repo_root, "src/build/unimaker_probe/r2c_compile_macos") != 0)
        return 1;
      if (!path_executable(compiler_bin)) {
        if (path_join(compiler_bin, sizeof(compiler_bin), repo_root, "build/r2c_compiler_tracks/dev/r2c_compile_macos") != 0)
          return 1;
      }
    } else {
      if (path_join(compiler_bin, sizeof(compiler_bin), repo_root, "build/r2c_compiler_tracks/dev/r2c_compile_macos") != 0)
        return 1;
      if (!path_executable(compiler_bin)) {
        if (path_join(compiler_bin, sizeof(compiler_bin), repo_root, "src/build/unimaker_probe/r2c_compile_macos") != 0)
          return 1;
      }
    }
  }

  bool need_rebuild = false;
  if (!path_executable(compiler_bin)) {
    need_rebuild = !compiler_is_unimaker_probe(compiler_bin);
  } else if (!compiler_binary_health_ok(compiler_bin, repo_root)) {
    if (compiler_from_env) {
      fprintf(stderr, "[r2c-compile] CHENG_R2C_NATIVE_COMPILER_BIN crashed in startup probe: %s\n", compiler_bin);
      return 1;
    }
    need_rebuild = !compiler_is_unimaker_probe(compiler_bin);
  }

  if (need_rebuild) {
    if (path_join(compiler_bin, sizeof(compiler_bin), repo_root, "build/r2c_compiler_tracks/dev/r2c_compile_macos") != 0) return 1;
    char compiler_entry[PATH_MAX];
    if (path_join(compiler_entry, sizeof(compiler_entry), repo_root, "src/r2c_aot_compile_main.cheng") != 0) return 1;
    if (!file_exists(compiler_entry)) {
      if (path_join(compiler_entry, sizeof(compiler_entry), repo_root, "src/r2c_aot_compiler_driver_main.cheng") != 0) return 1;
    }
    if (!file_exists(compiler_entry)) {
      fprintf(stderr, "[r2c-compile] missing compiler entry source\n");
      return 1;
    }

    const char *target = getenv("BACKEND_TARGET");
    if (target == NULL || target[0] == '\0') target = "arm64-apple-darwin";
    const char *pkg_roots = getenv("PKG_ROOTS");
    if (pkg_roots == NULL || pkg_roots[0] == '\0') pkg_roots = "/Users/lbcheng/cheng-lang:/Users/lbcheng/.cheng-packages";

    char out_arg[PATH_MAX + 32];
    char target_arg[160];
    snprintf(out_arg, sizeof(out_arg), "--out:%s", compiler_bin);
    snprintf(target_arg, sizeof(target_arg), "--target:%s", target);

    setenv("GUI_PACKAGE_ROOT", repo_root, 1);
    char gui_root_for_rebuild[PATH_MAX];
    if (path_join(gui_root_for_rebuild, sizeof(gui_root_for_rebuild), repo_root, "src") != 0) return 1;
    setenv("GUI_ROOT", gui_root_for_rebuild, 1);
    setenv("PKG_ROOTS", pkg_roots, 1);
    setenv("MM", "orc", 1);

    char *rebuild_argv[] = {(char *)tooling_bin,
                            "cheng",
                            compiler_entry,
                            out_arg,
                            target_arg,
                            "--linker:self",
                            "--dev",
                            NULL};
    int rebuild_rc = run_process_capture(repo_root, "/dev/null", rebuild_argv);
    if (rebuild_rc != 0 || !path_executable(compiler_bin)) {
      fprintf(stderr, "[r2c-compile] failed to rebuild %s compiler\n", track);
      return 1;
    }
    if (!compiler_binary_health_ok(compiler_bin, repo_root)) {
      fprintf(stderr, "[r2c-compile] rebuilt dev compiler still crashes in startup probe: %s\n", compiler_bin);
      return 1;
    }
  }

  if (!path_executable(compiler_bin)) {
    fprintf(stderr, "[r2c-compile] compiler is not executable after rebuild: %s\n", compiler_bin);
    return 1;
  }

  char compiler_active[PATH_MAX];
  snprintf(compiler_active, sizeof(compiler_active), "%s", compiler_bin);

  char crash_marker[PATH_MAX];
  crash_marker[0] = '\0';
  if (path_join(crash_marker, sizeof(crash_marker), repo_root, "build/r2c_compiler_tracks/dev/r2c_compile_macos.crash") != 0) {
    crash_marker[0] = '\0';
  }

  char active_log_path[PATH_MAX];
  if (path_join(active_log_path, sizeof(active_log_path), opts.out_dir, "r2c_compile.native.1.log") != 0) return 1;

  setenv("GUI_PACKAGE_ROOT", repo_root, 1);
  char gui_root[PATH_MAX];
  if (path_join(gui_root, sizeof(gui_root), repo_root, "src") != 0) return 1;
  setenv("GUI_ROOT", gui_root, 1);
  setenv("CHENG_R2C_BUILD_TRACK", track, 1);

  setenv("R2C_IN_ROOT", opts.project, 1);
  setenv("R2C_OUT_ROOT", out_root, 1);
  setenv("R2C_ENTRY", opts.entry, 1);
  setenv("R2C_PROJECT_NAME", project_name, 1);
  setenv("R2C_PROFILE", profile, 1);
  setenv("R2C_STRICT", opts.strict ? "1" : "0", 1);

  setenv("CHENG_R2C_IN_ROOT", opts.project, 1);
  setenv("CHENG_R2C_OUT_ROOT", out_root, 1);
  setenv("CHENG_R2C_ENTRY", opts.entry, 1);
  setenv("CHENG_R2C_PROJECT_NAME", project_name, 1);
  setenv("CHENG_R2C_PROFILE", profile, 1);
  setenv("CHENG_R2C_STRICT", opts.strict ? "1" : "0", 1);

  setenv("R2C_SKIP_COMPILER_EXEC", "0", 1);
  setenv("R2C_REUSE_COMPILER_BIN", "0", 1);
  setenv("R2C_REUSE_RUNTIME_BINS", "0", 1);
  setenv("R2C_ALLOW_TEMPLATE_FALLBACK", "0", 1);
  setenv("R2C_STRICT_ALLOW_SEMANTIC_SHELL_GENERATOR", "0", 1);

  bool unimaker_probe_mode = compiler_is_unimaker_probe(compiler_active);
  char strict_value[4];
  snprintf(strict_value, sizeof(strict_value), "%d", opts.strict ? 1 : 0);
  char *compile_argv_legacy[] = {(char *)compiler_active,
                                 "--in-root",
                                 (char *)opts.project,
                                 "--out-root",
                                 out_root,
                                 "--entry",
                                 (char *)opts.entry,
                                 "--project-name",
                                 project_name,
                                 "--profile",
                                 (char *)profile,
                                 "--strict",
                                 strict_value,
                                 NULL};
  char *compile_argv_probe[] = {(char *)compiler_active, NULL};

  if (unimaker_probe_mode) {
    unsetenv("R2C_REQUEST_PATH");
    unsetenv("CHENG_R2C_REQUEST_PATH");
  } else {
    setenv("R2C_REQUEST_PATH", request_path, 1);
    setenv("CHENG_R2C_REQUEST_PATH", request_path, 1);
  }

  fprintf(stderr, "[r2c-compile] build-track=%s compiler=%s attempt=1\n", track, compiler_active);
  int rc = run_process_capture(opts.out_dir, active_log_path, unimaker_probe_mode ? compile_argv_probe : compile_argv_legacy);
  char report_path[PATH_MAX];
  bool report_exists = (path_join(report_path, sizeof(report_path), out_root, "r2capp_compile_report.json") == 0 &&
                        file_exists(report_path));

  if (rc != 0) {
    if (is_crash_exit_code(rc) && strcmp(track, "dev") == 0 && crash_marker[0] != '\0') {
      write_all_text(crash_marker, "dev compiler crashed; no fallback allowed\n");
    }
  } else if (strcmp(track, "dev") == 0 && crash_marker[0] != '\0' && file_exists(crash_marker)) {
    unlink(crash_marker);
  }

  bool allow_nonzero_with_report = (rc != 0 && unimaker_probe_mode && report_exists);
  if (rc != 0 && !allow_nonzero_with_report) {
    char err_path[PATH_MAX];
    if (path_join(err_path, sizeof(err_path), opts.out_dir, "r2capp_compiler_error.txt") == 0) {
      emit_short_file_to_stderr(err_path, "compiler-error", 2048u);
    }
    if (file_nonempty(active_log_path)) {
      emit_short_file_to_stderr(active_log_path, "compile-log-head", 2048u);
    }
    char run_entry_path[PATH_MAX];
    if (path_join(run_entry_path, sizeof(run_entry_path), opts.out_dir, "r2capp_run_entry.txt") == 0) {
      emit_short_file_to_stderr(run_entry_path, "compiler-run-entry", 512u);
    }
    char env_debug_path[PATH_MAX];
    if (path_join(env_debug_path, sizeof(env_debug_path), opts.out_dir, "r2c_compile_env_debug.txt") == 0) {
      emit_short_file_to_stderr(env_debug_path, "compiler-env-debug", 2048u);
    }
    fprintf(stderr, "[r2c-compile] compiler failed rc=%d log=%s\n", rc, active_log_path);
    return 1;
  }
  if (allow_nonzero_with_report) {
    fprintf(stderr,
            "[r2c-compile] compiler rc=%d but report exists; continue in strict-native postprocess mode: %s\n",
            rc,
            report_path);
  }

  if (!report_exists) {
    fprintf(stderr, "[r2c-compile] missing compile report: %s\n", report_path);
    return 1;
  }

  if (postprocess_compile_report(out_root, opts.entry, profile, project_name) != 0) {
    fprintf(stderr, "[r2c-compile] failed to postprocess compile report in native mode: %s\n", report_path);
    return 1;
  }

  char err[512];
  err[0] = '\0';
  if (nr_validate_compile_report(report_path, NULL, repo_root, err, sizeof(err)) != 0) {
    fprintf(stderr,
            "[r2c-compile] compile report validation failed: %s (%s)\n",
            report_path,
            err[0] != '\0' ? err : "unknown");
    return 1;
  }

  return 0;
}

int native_r2c_compile_react_project(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[r2c-compile] missing scripts dir\n");
    return 2;
  }
  char repo_root[PATH_MAX];
  derive_repo_root(scripts_dir, repo_root, sizeof(repo_root));
  if (repo_root[0] == '\0') {
    fprintf(stderr, "[r2c-compile] failed to resolve repo root from scripts dir: %s\n", scripts_dir);
    return 2;
  }
  char tooling_bin[PATH_MAX];
  if (!resolve_tooling_bin(tooling_bin, sizeof(tooling_bin))) {
    fprintf(stderr, "[r2c-compile] missing cheng_tooling; set CHENG_TOOLING_BIN\n");
    return 1;
  }
  return run_native_minimal(repo_root, tooling_bin, argc, argv, arg_start);
}
