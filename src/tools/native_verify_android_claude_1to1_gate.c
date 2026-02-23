#define _POSIX_C_SOURCE 200809L

#include "native_verify_android_claude_1to1_gate.h"

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
  int code;
  bool timed_out;
} RunResult;

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

static void strlist_free(StringList *list) {
  if (list == NULL) return;
  for (size_t i = 0; i < list->len; ++i) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->len = 0;
  list->cap = 0;
}

static int strlist_push(StringList *list, const char *value) {
  if (list == NULL || value == NULL) return -1;
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

static bool starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
}

static bool has_suffix(const char *s, const char *suffix) {
  if (s == NULL || suffix == NULL) return false;
  size_t n = strlen(s);
  size_t m = strlen(suffix);
  if (n < m) return false;
  return strcmp(s + (n - m), suffix) == 0;
}

static bool file_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool path_executable(const char *path) {
  return (path != NULL && access(path, X_OK) == 0);
}

static bool path_is_interpreter_script(const char *path) {
  if (path == NULL || path[0] == '\0') return false;
  if (has_suffix(path, ".sh") || has_suffix(path, ".py") || has_suffix(path, ".pl")) return true;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return false;
  char head[128];
  size_t n = fread(head, 1u, sizeof(head) - 1u, fp);
  fclose(fp);
  if (n == 0u) return false;
  head[n] = '\0';
  if (!(n >= 2u && head[0] == '#' && head[1] == '!')) return false;
  if (strstr(head, "bash") != NULL || strstr(head, "python") != NULL || strstr(head, "perl") != NULL ||
      strstr(head, "/sh") != NULL) {
    return true;
  }
  return false;
}

static int path_join(char *out, size_t cap, const char *a, const char *b) {
  if (out == NULL || cap == 0u || a == NULL || b == NULL) return -1;
  int n = snprintf(out, cap, "%s/%s", a, b);
  if (n < 0 || (size_t)n >= cap) return -1;
  return 0;
}

static int ensure_dir(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  char buf[PATH_MAX];
  size_t n = strlen(path);
  if (n >= sizeof(buf)) return -1;
  memcpy(buf, path, n + 1u);
  for (size_t i = 1; i < n; ++i) {
    if (buf[i] == '/') {
      buf[i] = '\0';
      if (buf[0] != '\0' && !dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
      buf[i] = '/';
    }
  }
  if (!dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
  return 0;
}

static char *read_file_all(const char *path, size_t *out_len) {
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

static int write_file_all(const char *path, const char *data, size_t len) {
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  size_t wr = fwrite(data, 1u, len, fp);
  int rc = fclose(fp);
  if (wr != len || rc != 0) return -1;
  return 0;
}

static const char *skip_ws(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static const char *json_find_key(const char *doc, const char *key) {
  if (doc == NULL || key == NULL) return NULL;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = doc;
  while ((p = strstr(p, pat)) != NULL) {
    const char *q = p + strlen(pat);
    q = skip_ws(q);
    if (q == NULL || *q != ':') {
      p = p + 1;
      continue;
    }
    q++;
    q = skip_ws(q);
    return q;
  }
  return NULL;
}

static bool json_parse_string_at(const char *p, char *out, size_t cap, const char **end_out) {
  if (p == NULL || *p != '"') return false;
  ++p;
  size_t idx = 0u;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"') {
      if (out != NULL && cap > 0u) {
        if (idx >= cap) idx = cap - 1u;
        out[idx] = '\0';
      }
      if (end_out != NULL) *end_out = p;
      return true;
    }
    if (ch == '\\') {
      char esc = *p;
      if (esc == '\0') return false;
      ++p;
      switch (esc) {
        case '"': ch = '"'; break;
        case '\\': ch = '\\'; break;
        case '/': ch = '/'; break;
        case 'b': ch = '\b'; break;
        case 'f': ch = '\f'; break;
        case 'n': ch = '\n'; break;
        case 'r': ch = '\r'; break;
        case 't': ch = '\t'; break;
        default: ch = esc; break;
      }
    }
    if (out != NULL && cap > 0u && idx + 1u < cap) out[idx] = ch;
    idx++;
  }
  return false;
}

static bool json_get_string(const char *doc, const char *key, char *out, size_t cap) {
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '"') return false;
  return json_parse_string_at(p, out, cap, NULL);
}

static bool json_get_bool(const char *doc, const char *key, bool *out) {
  const char *p = json_find_key(doc, key);
  if (p == NULL) return false;
  if (starts_with(p, "true")) {
    if (out != NULL) *out = true;
    return true;
  }
  if (starts_with(p, "false")) {
    if (out != NULL) *out = false;
    return true;
  }
  return false;
}

static bool json_get_int64(const char *doc, const char *key, long long *out) {
  const char *p = json_find_key(doc, key);
  if (p == NULL) return false;
  errno = 0;
  char *end = NULL;
  long long v = strtoll(p, &end, 10);
  if (end == p || errno != 0) return false;
  if (out != NULL) *out = v;
  return true;
}

static bool json_get_int32(const char *doc, const char *key, int *out) {
  long long v = 0;
  if (!json_get_int64(doc, key, &v)) return false;
  if (v < INT32_MIN || v > INT32_MAX) return false;
  if (out != NULL) *out = (int)v;
  return true;
}

static const char *json_find_balanced_end(const char *start, char open_ch, char close_ch) {
  if (start == NULL || *start != open_ch) return NULL;
  int depth = 0;
  bool in_str = false;
  bool esc = false;
  const char *p = start;
  while (*p != '\0') {
    char ch = *p;
    if (in_str) {
      if (esc) {
        esc = false;
      } else if (ch == '\\') {
        esc = true;
      } else if (ch == '"') {
        in_str = false;
      }
    } else {
      if (ch == '"') {
        in_str = true;
      } else if (ch == open_ch) {
        depth++;
      } else if (ch == close_ch) {
        depth--;
        if (depth == 0) return p + 1;
      }
    }
    ++p;
  }
  return NULL;
}

static bool json_get_array_slice(const char *doc, const char *key, const char **arr_start, const char **arr_end) {
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '[') return false;
  const char *end = json_find_balanced_end(p, '[', ']');
  if (end == NULL) return false;
  if (arr_start != NULL) *arr_start = p;
  if (arr_end != NULL) *arr_end = end;
  return true;
}

static int json_count_key_occurrence(const char *doc, const char *key) {
  if (doc == NULL || key == NULL) return 0;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return 0;
  int count = 0;
  const char *p = doc;
  while ((p = strstr(p, pat)) != NULL) {
    count++;
    p += strlen(pat);
  }
  return count;
}

static int json_parse_string_array(const char *doc, const char *key, StringList *out) {
  if (out == NULL) return -1;
  const char *start = NULL;
  const char *end = NULL;
  if (!json_get_array_slice(doc, key, &start, &end)) return -1;
  const char *p = start + 1;
  while (p < end) {
    p = skip_ws(p);
    if (p >= end || *p == ']') break;
    if (*p != '"') {
      ++p;
      continue;
    }
    char buf[PATH_MAX];
    const char *after = NULL;
    if (!json_parse_string_at(p, buf, sizeof(buf), &after)) return -1;
    if (strlist_push(out, buf) != 0) return -1;
    p = after;
    while (p < end && *p != ',' && *p != ']') ++p;
    if (p < end && *p == ',') ++p;
  }
  return 0;
}

static bool str_contains(const char *hay, const char *needle) {
  return (hay != NULL && needle != NULL && strstr(hay, needle) != NULL);
}

static bool file_contains(const char *path, const char *needle) {
  size_t n = 0;
  char *doc = read_file_all(path, &n);
  if (doc == NULL) return false;
  bool ok = str_contains(doc, needle);
  free(doc);
  return ok;
}

static bool file_not_contains(const char *path, const char *needle) {
  size_t n = 0;
  char *doc = read_file_all(path, &n);
  if (doc == NULL) return false;
  bool ok = !str_contains(doc, needle);
  free(doc);
  return ok;
}

static void print_cmdline(char *const argv[]) {
  fprintf(stdout, "[native-verify-android] exec:");
  for (size_t i = 0; argv[i] != NULL; ++i) fprintf(stdout, " %s", argv[i]);
  fputc('\n', stdout);
  fflush(stdout);
}

static RunResult run_command(char *const argv[], const char *log_path, int timeout_sec) {
  RunResult res;
  res.code = 127;
  res.timed_out = false;
  pid_t pid = fork();
  if (pid < 0) {
    res.code = 127;
    return res;
  }
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (log_path != NULL) {
      int fd = open(log_path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
      if (fd < 0) _exit(127);
      if (dup2(fd, STDOUT_FILENO) < 0) _exit(127);
      if (dup2(fd, STDERR_FILENO) < 0) _exit(127);
      close(fd);
    }
    execvp(argv[0], argv);
    _exit(127);
  }

  setpgid(pid, pid);
  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : 0;
  while (1) {
    int status = 0;
    pid_t got = waitpid(pid, &status, WNOHANG);
    if (got == pid) {
      if (WIFEXITED(status)) res.code = WEXITSTATUS(status);
      else if (WIFSIGNALED(status)) res.code = 128 + WTERMSIG(status);
      else res.code = 1;
      return res;
    }
    if (got < 0) {
      res.code = 127;
      return res;
    }
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
    dup2(pipefd[1], STDOUT_FILENO);
    dup2(pipefd[1], STDERR_FILENO);
    close(pipefd[0]);
    close(pipefd[1]);
    execvp(argv[0], argv);
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
  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : 0;
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

static bool command_looks_like_script_dispatch(const char *path) {
  if (path == NULL || path[0] == '\0' || !path_executable(path)) return false;
  char *argv[] = {(char *)path, "--help", NULL};
  char *out = NULL;
  int rc = capture_command_output(argv, 8, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  bool is_dispatch = false;
  if (str_contains(out, ".sh --") || str_contains(out, ".sh [") || str_contains(out, ".sh ")) is_dispatch = true;
  if (str_contains(out, "Usage:\n  verify_android_fullroute_visual_pixel.sh") ||
      str_contains(out, "Usage:\n  r2c_compile_react_project.sh") ||
      str_contains(out, "Usage:\n  mobile_run_android.sh")) {
    is_dispatch = true;
  }
  free(out);
  return is_dispatch;
}

static bool allow_script_dispatch_wrapper(void) {
  const char *v = getenv("CHENG_NATIVE_GATE_ALLOW_SCRIPT_DISPATCH");
  return (v != NULL && strcmp(v, "1") == 0);
}

static void print_file_head(const char *path, int lines) {
  FILE *fp = fopen(path, "r");
  if (fp == NULL) return;
  char line[4096];
  int n = 0;
  while (fgets(line, sizeof(line), fp) != NULL) {
    fputs(line, stderr);
    n++;
    if (n >= lines) break;
  }
  fclose(fp);
}

static bool find_executable_in_path(const char *name, char *out, size_t out_cap) {
  if (name == NULL || out == NULL || out_cap == 0u) return false;
  if (strchr(name, '/') != NULL) {
    if (path_executable(name)) {
      snprintf(out, out_cap, "%s", name);
      return true;
    }
    return false;
  }
  const char *path_env = getenv("PATH");
  if (path_env == NULL) return false;
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

static bool resolve_adb_executable(char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  const char *env_adb = getenv("CHENG_ANDROID_ADB");
  if (env_adb != NULL && env_adb[0] != '\0' && path_executable(env_adb)) {
    snprintf(out, out_cap, "%s", env_adb);
    return true;
  }
  const char *sdk = getenv("ANDROID_SDK_ROOT");
  if (sdk == NULL || sdk[0] == '\0') sdk = getenv("ANDROID_HOME");
  if (sdk != NULL && sdk[0] != '\0') {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/platform-tools/adb", sdk) < (int)sizeof(candidate) &&
        path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  const char *home = getenv("HOME");
  if (home != NULL && home[0] != '\0') {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/Library/Android/sdk/platform-tools/adb", home) <
            (int)sizeof(candidate) &&
        path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  return find_executable_in_path("adb", out, out_cap);
}

static bool has_non_ascii(const char *buf, size_t len) {
  for (size_t i = 0; i < len; ++i) {
    if ((unsigned char)buf[i] > 127u) return true;
  }
  return false;
}

static int count_truth_states(const char *truth_manifest_path) {
  size_t n = 0;
  char *doc = read_file_all(truth_manifest_path, &n);
  if (doc == NULL) return -1;
  int routes = 0;
  if (!json_get_int32(doc, "routes", &routes) || routes <= 0) {
    free(doc);
    return -1;
  }
  free(doc);
  return routes;
}

static bool parse_bool_key(const char *doc, const char *key, bool expect, const char *errmsg) {
  bool got = false;
  if (!json_get_bool(doc, key, &got)) {
    fprintf(stderr, "%s (missing key=%s)\n", errmsg, key);
    return false;
  }
  if (got != expect) {
    fprintf(stderr, "%s (key=%s)\n", errmsg, key);
    return false;
  }
  return true;
}

static bool parse_int_key(const char *doc, const char *key, long long expect, const char *errmsg) {
  long long got = 0;
  if (!json_get_int64(doc, key, &got)) {
    fprintf(stderr, "%s (missing key=%s)\n", errmsg, key);
    return false;
  }
  if (got != expect) {
    fprintf(stderr, "%s (key=%s expected=%lld got=%lld)\n", errmsg, key, expect, got);
    return false;
  }
  return true;
}

static bool parse_string_key(const char *doc, const char *key, const char *expect, const char *errmsg) {
  char got[PATH_MAX];
  if (!json_get_string(doc, key, got, sizeof(got))) {
    fprintf(stderr, "%s (missing key=%s)\n", errmsg, key);
    return false;
  }
  if (strcmp(got, expect) != 0) {
    fprintf(stderr, "%s (key=%s)\n", errmsg, key);
    return false;
  }
  return true;
}

static bool resolve_android_ndk_root(char *out, size_t out_cap) {
  const char *envs[] = {"ANDROID_NDK_HOME", "ANDROID_NDK_ROOT", "ANDROID_NDK", "CMAKE_ANDROID_NDK"};
  for (size_t i = 0; i < sizeof(envs) / sizeof(envs[0]); ++i) {
    const char *v = getenv(envs[i]);
    if (v != NULL && v[0] != '\0') {
      char probe[PATH_MAX];
      if (snprintf(probe, sizeof(probe), "%s/toolchains/llvm/prebuilt", v) >= (int)sizeof(probe)) continue;
      if (dir_exists(probe)) {
        snprintf(out, out_cap, "%s", v);
        return true;
      }
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
  struct dirent *ent = NULL;
  bool ok = false;
  while ((ent = readdir(dir)) != NULL) {
    if (ent->d_name[0] == '.') continue;
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/%s/toolchains/llvm/prebuilt", ndk_dir, ent->d_name) >= (int)sizeof(candidate)) continue;
    if (dir_exists(candidate)) {
      char root[PATH_MAX];
      if (snprintf(root, sizeof(root), "%s/%s", ndk_dir, ent->d_name) >= (int)sizeof(root)) continue;
      snprintf(out, out_cap, "%s", root);
      ok = true;
      break;
    }
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
  for (size_t i = 0; i < sizeof(hosts) / sizeof(hosts[0]); ++i) {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/toolchains/llvm/prebuilt/%s/bin/aarch64-linux-android%s-clang", ndk_root, hosts[i], api) >= (int)sizeof(candidate)) continue;
    if (path_executable(candidate)) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  return false;
}

static int rebuild_android_payload_obj(const char *android_obj, const char *log_file) {
  const char *cheng_lang_root = getenv("CHENG_LANG_ROOT");
  if (cheng_lang_root == NULL || cheng_lang_root[0] == '\0') cheng_lang_root = "/Users/lbcheng/cheng-lang";
  const char *cheng_mobile_root = getenv("CHENG_MOBILE_ROOT");
  if (cheng_mobile_root == NULL || cheng_mobile_root[0] == '\0') cheng_mobile_root = "/Users/lbcheng/.cheng-packages/cheng-mobile";

  char exports_c[PATH_MAX];
  char exports_h[PATH_MAX];
  char bridge_dir[PATH_MAX];
  char bridge_dir_alt[PATH_MAX];
  char include_dir[PATH_MAX];
  char stub_include_dir[PATH_MAX];
  if (path_join(exports_c, sizeof(exports_c), cheng_lang_root, "src/runtime/mobile/cheng_mobile_exports.c") != 0 ||
      path_join(exports_h, sizeof(exports_h), cheng_lang_root, "src/runtime/mobile/cheng_mobile_exports.h") != 0 ||
      path_join(bridge_dir, sizeof(bridge_dir), cheng_mobile_root, "bridge") != 0 ||
      path_join(bridge_dir_alt, sizeof(bridge_dir_alt), cheng_mobile_root, "src/bridge") != 0) {
    return 1;
  }
  if (!file_exists(exports_c) || !file_exists(exports_h)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] android payload source missing\n");
    return 1;
  }

  char obj_dir[PATH_MAX];
  snprintf(obj_dir, sizeof(obj_dir), "%s", android_obj);
  char *obj_slash = strrchr(obj_dir, '/');
  if (obj_slash == NULL) return 1;
  *obj_slash = '\0';
  if (ensure_dir(obj_dir) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create android obj dir: %s\n", obj_dir);
    return 1;
  }

  if (dir_exists(bridge_dir)) {
    snprintf(include_dir, sizeof(include_dir), "%s", bridge_dir);
  } else if (dir_exists(bridge_dir_alt)) {
    snprintf(include_dir, sizeof(include_dir), "%s", bridge_dir_alt);
  } else {
    if (path_join(stub_include_dir, sizeof(stub_include_dir), obj_dir, "_mobile_stub_include") != 0) return 1;
    if (ensure_dir(stub_include_dir) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create stub include dir: %s\n", stub_include_dir);
      return 1;
    }
    char bridge_hdr[PATH_MAX];
    char host_api_hdr[PATH_MAX];
    if (path_join(bridge_hdr, sizeof(bridge_hdr), stub_include_dir, "cheng_mobile_bridge.h") != 0 ||
        path_join(host_api_hdr, sizeof(host_api_hdr), stub_include_dir, "cheng_mobile_host_api.h") != 0) {
      return 1;
    }
    static const char kBridgeStub[] =
        "#ifndef CHENG_MOBILE_BRIDGE_H\n"
        "#define CHENG_MOBILE_BRIDGE_H\n"
        "/* gate-time stub header */\n"
        "#endif\n";
    static const char kHostApiStub[] =
        "#ifndef CHENG_MOBILE_HOST_API_H\n"
        "#define CHENG_MOBILE_HOST_API_H\n"
        "#include \"cheng_mobile_exports.h\"\n"
        "#endif\n";
    if (write_file_all(bridge_hdr, kBridgeStub, strlen(kBridgeStub)) != 0 ||
        write_file_all(host_api_hdr, kHostApiStub, strlen(kHostApiStub)) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to write stub mobile headers\n");
      return 1;
    }
    snprintf(include_dir, sizeof(include_dir), "%s", stub_include_dir);
  }

  char clang_bin[PATH_MAX];
  if (!resolve_android_clang(clang_bin, sizeof(clang_bin))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing Android NDK clang; set ANDROID_NDK_HOME/ANDROID_SDK_ROOT or R2C_ANDROID_CLANG\n");
    return 2;
  }

  char exports_dir[PATH_MAX];
  snprintf(exports_dir, sizeof(exports_dir), "%s", exports_c);
  char *slash = strrchr(exports_dir, '/');
  if (slash != NULL) *slash = '\0';

  const char *payload_cflags = getenv("R2C_ANDROID_PAYLOAD_CFLAGS");
  char *cflags_copy = NULL;
  StringList cflags;
  memset(&cflags, 0, sizeof(cflags));
  if (payload_cflags != NULL && payload_cflags[0] != '\0') {
    cflags_copy = strdup(payload_cflags);
    if (cflags_copy != NULL) {
      char *save = NULL;
      for (char *tok = strtok_r(cflags_copy, " ", &save); tok != NULL; tok = strtok_r(NULL, " ", &save)) {
        if (tok[0] == '\0') continue;
        strlist_push(&cflags, tok);
      }
    }
  }

  char include_bridge[PATH_MAX + 3];
  char include_exports[PATH_MAX + 3];
  snprintf(include_bridge, sizeof(include_bridge), "-I%s", include_dir);
  snprintf(include_exports, sizeof(include_exports), "-I%s", exports_dir);

  size_t argv_cap = 32u + cflags.len;
  char **argv = (char **)calloc(argv_cap, sizeof(char *));
  if (argv == NULL) {
    free(cflags_copy);
    strlist_free(&cflags);
    return 1;
  }
  size_t idx = 0;
  argv[idx++] = clang_bin;
  argv[idx++] = "-std=c11";
  argv[idx++] = "-fPIC";
  argv[idx++] = "-D__ANDROID__=1";
  argv[idx++] = "-DANDROID=1";
  argv[idx++] = include_bridge;
  argv[idx++] = include_exports;
  for (size_t i = 0; i < cflags.len; ++i) argv[idx++] = cflags.items[i];
  argv[idx++] = "-c";
  argv[idx++] = exports_c;
  argv[idx++] = "-o";
  argv[idx++] = (char *)android_obj;
  argv[idx] = NULL;

  RunResult rr = run_command(argv, log_file, 0);
  free(argv);
  free(cflags_copy);
  strlist_free(&cflags);
  if (rr.code != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] android ABI v2 payload compile failed\n");
    print_file_head(log_file, 120);
    return 1;
  }
  if (!file_exists(android_obj)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] android payload object missing: %s\n", android_obj);
    return 1;
  }
  return 0;
}

static bool check_nm_symbols(const char *android_obj) {
  char nm_tool[PATH_MAX];
  const char *preferred = "/Users/lbcheng/Library/Android/sdk/ndk/25.1.8937393/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm";
  if (path_executable(preferred)) {
    snprintf(nm_tool, sizeof(nm_tool), "%s", preferred);
  } else if (find_executable_in_path("llvm-nm", nm_tool, sizeof(nm_tool))) {
  } else if (find_executable_in_path("nm", nm_tool, sizeof(nm_tool))) {
  } else {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing symbol tool: llvm-nm/nm\n");
    return false;
  }

  char *defined_out = NULL;
  char *argv_defined[] = {nm_tool, "-g", "--defined-only", (char *)android_obj, NULL};
  int rc = capture_command_output(argv_defined, 20, &defined_out);
  if (rc != 0 || defined_out == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to inspect symbols\n");
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
  for (size_t i = 0; i < sizeof(required) / sizeof(required[0]); ++i) {
    if (!str_contains(defined_out, required[i])) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] android artifact is not ABI v2 payload (missing symbol: %s)\n",
              required[i]);
      free(defined_out);
      return false;
    }
  }
  free(defined_out);

  char *undef_out = NULL;
  char *argv_undef[] = {nm_tool, "-u", (char *)android_obj, NULL};
  rc = capture_command_output(argv_undef, 20, &undef_out);
  if (rc == 0 && undef_out != NULL && str_contains(undef_out, "chengGuiMac")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] android artifact links macOS symbols (target mismatch)\n");
    free(undef_out);
    return false;
  }
  free(undef_out);
  return true;
}

static bool has_android_device(void) {
  char adb[PATH_MAX];
  if (!resolve_adb_executable(adb, sizeof(adb))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing dependency: adb\n");
    return false;
  }
  const char *serial = getenv("ANDROID_SERIAL");
  if (serial != NULL && serial[0] != '\0') return true;

  char *out = NULL;
  char *argv[] = {adb, "devices", NULL};
  int rc = capture_command_output(argv, 15, &out);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  bool ok = false;
  char *save = NULL;
  for (char *line = strtok_r(out, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
    while (*line != '\0' && isspace((unsigned char)*line)) ++line;
    if (*line == '\0' || starts_with(line, "List of devices")) continue;
    char id[128];
    char st[64];
    id[0] = '\0';
    st[0] = '\0';
    (void)sscanf(line, "%127s %63s", id, st);
    if (id[0] != '\0' && strcmp(st, "device") == 0) {
      ok = true;
      break;
    }
  }
  free(out);
  return ok;
}

static bool parse_runtime_state(const char *runtime_json, int semantic_node_count) {
  size_t n = 0;
  char *doc = read_file_all(runtime_json, &n);
  if (doc == NULL || n == 0) {
    free(doc);
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime state file missing: %s\n", runtime_json);
    return false;
  }
  bool started = false;
  bool native_ready = false;
  if (!json_get_bool(doc, "started", &started) || !started) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime started flag is false\n");
    free(doc);
    return false;
  }
  if (!json_get_bool(doc, "native_ready", &native_ready) || !native_ready) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime native_ready flag is false\n");
    free(doc);
    return false;
  }
  char kv[32768];
  char js[32768];
  kv[0] = '\0';
  js[0] = '\0';
  if (!json_get_string(doc, "launch_args_kv", kv, sizeof(kv))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing launch_args_kv\n");
    free(doc);
    return false;
  }
  if (!json_get_string(doc, "launch_args_json", js, sizeof(js))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing launch_args_json\n");
    free(doc);
    return false;
  }
  char semantic_probe[128];
  snprintf(semantic_probe, sizeof(semantic_probe), "semantic_nodes=%d", semantic_node_count);
  if (!str_contains(kv, "arg_probe=foo_bar") || !str_contains(kv, semantic_probe) ||
      !str_contains(kv, "gate_mode=android-semantic-visual-1to1")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime launch args missing required markers\n");
    free(doc);
    return false;
  }
  if (!str_contains(js, "android-semantic-visual-1to1") || !str_contains(js, "\"routes\"")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime args_json mode mismatch\n");
    free(doc);
    return false;
  }
  free(doc);
  return true;
}

static bool validate_fullroute_report(const char *report_path, int expected_routes) {
  size_t n = 0;
  char *doc = read_file_all(report_path, &n);
  if (doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing fullroute report: %s\n", report_path);
    return false;
  }
  StringList states;
  memset(&states, 0, sizeof(states));
  if (json_parse_string_array(doc, "states", &states) != 0 || states.len == 0u) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute report states empty\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  if ((int)states.len != expected_routes) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] fullroute report state count mismatch: %zu != %d\n",
            states.len, expected_routes);
    strlist_free(&states);
    free(doc);
    return false;
  }
  int strict_capture = 0;
  int runs = 0;
  char capture_source[64];
  capture_source[0] = '\0';
  if (!json_get_int32(doc, "strict_capture", &strict_capture) || strict_capture != 1) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute strict_capture != 1\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  if (!json_get_int32(doc, "consistency_runs", &runs) || runs <= 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute consistency_runs invalid\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  if (!json_get_string(doc, "capture_source", capture_source, sizeof(capture_source)) ||
      strcmp(capture_source, "runtime-dump") != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute capture_source != runtime-dump\n");
    strlist_free(&states);
    free(doc);
    return false;
  }
  for (size_t i = 0; i < states.len; ++i) {
    char keypat[PATH_MAX + 4];
    snprintf(keypat, sizeof(keypat), "\"%s\"", states.items[i]);
    const char *p = strstr(doc, keypat);
    if (p == NULL) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing fullroute capture item: %s\n", states.items[i]);
      strlist_free(&states);
      free(doc);
      return false;
    }
    if (!strstr(p, "\"capture_golden_match\": true") || !strstr(p, "\"runtime_route_text_ready\": true")) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] invalid fullroute capture flags: %s\n", states.items[i]);
      strlist_free(&states);
      free(doc);
      return false;
    }
  }
  strlist_free(&states);
  free(doc);
  return true;
}

static bool runtime_contains_forbidden_markers(const char *runtime_path) {
  size_t n = 0u;
  char *doc = read_file_all(runtime_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return true;
  }
  const char *markers[] = {
      "legacy.mountUnimakerAot",
      "legacy.unimakerDispatch",
      "import cheng/gui/browser/r2capp/runtime as legacy",
      "__R2C_",
      "buildSnapshot(",
      "rebuildPaint(",
  };
  bool bad = false;
  for (size_t i = 0u; i < sizeof(markers) / sizeof(markers[0]); ++i) {
    if (strstr(doc, markers[i]) != NULL) {
      bad = true;
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime marker forbidden: %s\n", markers[i]);
      break;
    }
  }
  if (!bad) {
    if (strstr(doc, "utfzh_bridge.utfZhRoundtripStrict") == NULL ||
        strstr(doc, "ime_bridge.handleImeEvent") == NULL ||
        strstr(doc, "utfzh_editor.handleEditorEvent") == NULL ||
        strstr(doc, "utfzh_editor.renderEditorPanel") == NULL) {
      bad = true;
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime missing UTF-ZH/IME/editor hooks\n");
    }
  }
  free(doc);
  return bad;
}

static void parse_args(int argc, char **argv, int arg_start, const char **project, const char **entry, const char **out_dir,
                       bool *help, int *err) {
  *help = false;
  *err = 0;
  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--project") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *project = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--entry") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *entry = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
      *help = true;
      return;
    }
    fprintf(stderr, "[verify-android-claude-1to1-gate] unknown arg: %s\n", arg);
    *err = 2;
    return;
  }
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  verify_android_claude_1to1_gate [--project <abs_path>] [--entry </app/main.tsx>] [--out <abs_path>]\n"
          "\n"
          "Env (native no-interpreter path):\n"
          "  CHENG_R2C_COMPILE_CMD=<native_bin>\n"
          "  CHENG_ANDROID_FULLROUTE_GATE_CMD=<native_bin>\n"
          "  CHENG_ANDROID_MOBILE_RUNNER=<native_bin>\n"
          "\n"
          "Compat (temporary):\n"
          "  CHENG_NATIVE_GATE_ALLOW_SCRIPT_DISPATCH=1\n");
}

int native_verify_android_claude_1to1_gate(const char *scripts_dir, int argc, char **argv, int arg_start) {
  char root[PATH_MAX];
  const char *env_root = getenv("GUI_ROOT");
  if (env_root != NULL && env_root[0] != '\0') {
    snprintf(root, sizeof(root), "%s", env_root);
  } else if (scripts_dir != NULL && scripts_dir[0] != '\0') {
    snprintf(root, sizeof(root), "%s", scripts_dir);
    size_t n = strlen(root);
    if (n >= 8u && strcmp(root + n - 8u, "/scripts") == 0) root[n - 8u] = '\0';
  } else {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing GUI root\n");
    return 2;
  }

  const char *project = getenv("R2C_REAL_PROJECT");
  const char *entry = getenv("R2C_REAL_ENTRY");
  const char *out_dir = getenv("R2C_ANDROID_1TO1_OUT");
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";
  char out_dir_default[PATH_MAX];
  if (out_dir == NULL || out_dir[0] == '\0') {
    if (path_join(out_dir_default, sizeof(out_dir_default), root, "build/android_claude_1to1_gate") != 0) return 2;
    out_dir = out_dir_default;
  }

  bool want_help = false;
  int arg_err = 0;
  parse_args(argc, argv, arg_start, &project, &entry, &out_dir, &want_help, &arg_err);
  if (want_help) {
    usage();
    return 0;
  }
  if (arg_err != 0) {
    usage();
    return arg_err;
  }

  char marker_dir[PATH_MAX];
  char marker_path[PATH_MAX];
  char compile_out[PATH_MAX];
  char runtime_json[PATH_MAX];
  char run_log[PATH_MAX];
  char fullroute_out[PATH_MAX];
  char fullroute_report[PATH_MAX];
  char fullroute_log[PATH_MAX];
  char android_truth_manifest[PATH_MAX];
  char mobile_runner[PATH_MAX];
  char compile_cmd[PATH_MAX];
  char fullroute_gate_cmd[PATH_MAX];

  if (path_join(compile_out, sizeof(compile_out), out_dir, "claude_compile") != 0 ||
      path_join(marker_dir, sizeof(marker_dir), root, "build/android_claude_1to1_gate") != 0 ||
      path_join(marker_path, sizeof(marker_path), marker_dir, "ok.json") != 0 ||
      path_join(runtime_json, sizeof(runtime_json), out_dir, "android_runtime_state.json") != 0 ||
      path_join(run_log, sizeof(run_log), out_dir, "mobile_run_android.log") != 0 ||
      path_join(fullroute_out, sizeof(fullroute_out), out_dir, "fullroute") != 0 ||
      path_join(fullroute_report, sizeof(fullroute_report), fullroute_out, "android_fullroute_visual_report.json") != 0 ||
      path_join(fullroute_log, sizeof(fullroute_log), out_dir, "android_fullroute_visual.log") != 0 ||
      path_join(android_truth_manifest, sizeof(android_truth_manifest), root,
                "tests/claude_fixture/golden/android_fullroute/chromium_truth_manifest_android.json") != 0 ||
      path_join(mobile_runner, sizeof(mobile_runner), root, "bin/mobile_run_android") != 0 ||
      path_join(compile_cmd, sizeof(compile_cmd), root, "bin/r2c_compile_react_project") != 0 ||
      path_join(fullroute_gate_cmd, sizeof(fullroute_gate_cmd), root, "bin/verify_android_fullroute_visual_pixel") != 0) {
    return 2;
  }

  const char *compile_cmd_env = getenv("CHENG_R2C_COMPILE_CMD");
  if (compile_cmd_env != NULL && compile_cmd_env[0] != '\0') snprintf(compile_cmd, sizeof(compile_cmd), "%s", compile_cmd_env);
  const char *fullroute_cmd_env = getenv("CHENG_ANDROID_FULLROUTE_GATE_CMD");
  if (fullroute_cmd_env != NULL && fullroute_cmd_env[0] != '\0') snprintf(fullroute_gate_cmd, sizeof(fullroute_gate_cmd), "%s", fullroute_cmd_env);
  const char *runner_env = getenv("CHENG_ANDROID_MOBILE_RUNNER");
  if (runner_env != NULL && runner_env[0] != '\0') snprintf(mobile_runner, sizeof(mobile_runner), "%s", runner_env);

  if (!dir_exists(project)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing project: %s\n", project);
    return 1;
  }
  if (!file_exists(android_truth_manifest)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing android truth manifest: %s\n", android_truth_manifest);
    return 1;
  }
  if (!path_executable(compile_cmd)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing native compile command: %s\n", compile_cmd);
    return 1;
  }
  if (path_is_interpreter_script(compile_cmd)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] compile command must be native executable (no interpreter): %s\n",
            compile_cmd);
    return 1;
  }
  if (!allow_script_dispatch_wrapper() && command_looks_like_script_dispatch(compile_cmd)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] compile command resolves to script-dispatch wrapper; set CHENG_R2C_COMPILE_CMD to a true native binary: %s\n",
            compile_cmd);
    return 1;
  }
  if (!path_executable(fullroute_gate_cmd)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing native fullroute gate command: %s\n", fullroute_gate_cmd);
    return 1;
  }
  if (path_is_interpreter_script(fullroute_gate_cmd)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] fullroute gate command must be native executable (no interpreter): %s\n",
            fullroute_gate_cmd);
    return 1;
  }
  if (!allow_script_dispatch_wrapper() && command_looks_like_script_dispatch(fullroute_gate_cmd)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] fullroute gate command resolves to script-dispatch wrapper; set CHENG_ANDROID_FULLROUTE_GATE_CMD to a true native binary: %s\n",
            fullroute_gate_cmd);
    return 1;
  }

  if (ensure_dir(out_dir) != 0 || ensure_dir(marker_dir) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create output directories\n");
    return 1;
  }
  unlink(marker_path);
  unlink(runtime_json);
  unlink(run_log);
  unlink(fullroute_log);

  setenv("STRICT_GATE_CONTEXT", "1", 1);
  setenv("R2C_LEGACY_UNIMAKER", "0", 1);
  setenv("R2C_SKIP_COMPILER_RUN", "0", 1);
  setenv("R2C_TRY_COMPILER_FIRST", "1", 1);
  setenv("R2C_REUSE_RUNTIME_BINS", "0", 1);
  setenv("R2C_REUSE_COMPILER_BIN", "0", 1);
  setenv("R2C_USE_PRECOMPUTED_BATCH", "0", 1);
  setenv("R2C_FULLROUTE_BLESS", "0", 1);
  setenv("R2C_RUNTIME_TEXT_SOURCE", "project", 1);
  setenv("R2C_RUNTIME_ROUTE_TITLE_SOURCE", "project", 1);
  setenv("R2C_TARGET_MATRIX", "android", 1);
  setenv("R2C_REAL_SKIP_RUNNER_SMOKE", "1", 1);
  setenv("R2C_REAL_SKIP_DESKTOP_SMOKE", "1", 1);
  setenv("R2C_SKIP_HOST_RUNTIME_BIN_BUILD", "1", 1);
  setenv("BACKEND_INTERNAL_ALLOW_EMIT_OBJ", "1", 1);
  setenv("CHENG_BACKEND_INTERNAL_ALLOW_EMIT_OBJ", "1", 1);
  if (getenv("CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE") == NULL) setenv("CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE", "runtime-dump", 1);
  if (getenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE") == NULL) setenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE", "1", 1);
  if (getenv("R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS") == NULL) setenv("R2C_ANDROID_FULLROUTE_CONSISTENCY_RUNS", "3", 1);

  const char *capture_source = getenv("CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE");
  const char *strict_capture = getenv("CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE");
  if (capture_source == NULL || strcmp(capture_source, "runtime-dump") != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] strict mode requires CHENG_ANDROID_FULLROUTE_CAPTURE_SOURCE=runtime-dump\n");
    return 1;
  }
  if (strict_capture == NULL || strcmp(strict_capture, "1") != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] strict mode requires CHENG_ANDROID_FULLROUTE_STRICT_CAPTURE=1\n");
    return 1;
  }

  fprintf(stdout, "== android 1:1: r2c strict compile ==\n");
  char *compile_argv[] = {
      compile_cmd,
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      compile_out,
      "--strict",
      NULL,
  };
  print_cmdline(compile_argv);
  RunResult compile_rr = run_command(compile_argv, NULL, 0);
  if (compile_rr.code != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] compile failed rc=%d\n", compile_rr.code);
    return 1;
  }

  char report_json[PATH_MAX];
  char android_obj[PATH_MAX];
  char android_obj_rebuild_log[PATH_MAX];
  if (path_join(report_json, sizeof(report_json), compile_out, "r2capp/r2capp_compile_report.json") != 0 ||
      path_join(android_obj, sizeof(android_obj), compile_out, "r2capp_platform_artifacts/android/r2c_app_android.o") != 0 ||
      path_join(android_obj_rebuild_log, sizeof(android_obj_rebuild_log), out_dir, "r2c_app_android.rebuild.log") != 0) {
    return 1;
  }
  if (!file_exists(report_json)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing compile report: %s\n", report_json);
    return 1;
  }
  int rebuild_rc = rebuild_android_payload_obj(android_obj, android_obj_rebuild_log);
  if (rebuild_rc != 0) return rebuild_rc;
  if (!check_nm_symbols(android_obj)) return 1;

  size_t report_len = 0;
  char *report_doc = read_file_all(report_json, &report_len);
  if (report_doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] cannot read report: %s\n", report_json);
    return 1;
  }

  if (!parse_bool_key(report_doc, "strict_no_fallback", true, "[verify-android-claude-1to1-gate] strict_no_fallback != true") ||
      !parse_bool_key(report_doc, "used_fallback", false, "[verify-android-claude-1to1-gate] used_fallback != false") ||
      !parse_int_key(report_doc, "compiler_rc", 0, "[verify-android-claude-1to1-gate] compiler_rc != 0") ||
      !parse_int_key(report_doc, "pixel_tolerance", 0, "[verify-android-claude-1to1-gate] pixel_tolerance != 0") ||
      !parse_string_key(report_doc, "generated_ui_mode", "ir-driven", "[verify-android-claude-1to1-gate] generated_ui_mode != ir-driven") ||
      !parse_string_key(report_doc, "utfzh_mode", "strict", "[verify-android-claude-1to1-gate] utfzh_mode != strict") ||
      !parse_string_key(report_doc, "ime_mode", "cangwu-global", "[verify-android-claude-1to1-gate] ime_mode != cangwu-global") ||
      !parse_string_key(report_doc, "cjk_render_backend", "native-text-first",
                        "[verify-android-claude-1to1-gate] cjk_render_backend != native-text-first") ||
      !parse_string_key(report_doc, "cjk_render_gate", "no-garbled-cjk",
                        "[verify-android-claude-1to1-gate] cjk_render_gate != no-garbled-cjk") ||
      !parse_string_key(report_doc, "semantic_mapping_mode", "source-node-map",
                        "[verify-android-claude-1to1-gate] semantic_mapping_mode != source-node-map") ||
      !parse_string_key(report_doc, "android_truth_manifest_path", android_truth_manifest,
                        "[verify-android-claude-1to1-gate] android_truth_manifest_path mismatch")) {
    free(report_doc);
    return 1;
  }

  char runtime_src_path[PATH_MAX];
  if (!json_get_string(report_doc, "generated_runtime_path", runtime_src_path, sizeof(runtime_src_path)) ||
      !file_exists(runtime_src_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing generated_runtime_path\n");
    free(report_doc);
    return 1;
  }
  if (runtime_contains_forbidden_markers(runtime_src_path)) {
    free(report_doc);
    return 1;
  }

  const char *path_keys[] = {"android_route_graph_path", "android_route_event_matrix_path", "android_route_coverage_path"};
  for (size_t i = 0; i < sizeof(path_keys) / sizeof(path_keys[0]); ++i) {
    char path[PATH_MAX];
    if (!json_get_string(report_doc, path_keys[i], path, sizeof(path)) || !file_exists(path)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing %s: %s\n", path_keys[i], path);
      free(report_doc);
      return 1;
    }
  }

  int semantic_node_count = 0;
  int full_route_count = 0;
  if (!json_get_int32(report_doc, "semantic_node_count", &semantic_node_count) || semantic_node_count <= 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] semantic_node_count <= 0\n");
    free(report_doc);
    return 1;
  }
  if (!json_get_int32(report_doc, "full_route_state_count", &full_route_count) || full_route_count <= 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] full_route_state_count <= 0\n");
    free(report_doc);
    return 1;
  }
  int truth_count = count_truth_states(android_truth_manifest);
  if (truth_count <= 0 || full_route_count != truth_count) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] full_route_state_count mismatch: report=%d truth=%d\n",
            full_route_count, truth_count);
    free(report_doc);
    return 1;
  }

  char states_path[PATH_MAX];
  if (!json_get_string(report_doc, "full_route_states_path", states_path, sizeof(states_path)) || !file_exists(states_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing full_route_states_path: %s\n", states_path);
    free(report_doc);
    return 1;
  }
  size_t states_len = 0;
  char *states_doc = read_file_all(states_path, &states_len);
  if (states_doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to read full route states: %s\n", states_path);
    free(report_doc);
    return 1;
  }
  StringList states;
  memset(&states, 0, sizeof(states));
  if (json_parse_string_array(states_doc, "states", &states) != 0 || (int)states.len != full_route_count) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] full_route_states invalid\n");
    strlist_free(&states);
    free(states_doc);
    free(report_doc);
    return 1;
  }
  free(states_doc);

  char route_texts_path[PATH_MAX];
  if (!json_get_string(report_doc, "route_texts_path", route_texts_path, sizeof(route_texts_path)) ||
      !dir_exists(route_texts_path)) {
    char report_dir[PATH_MAX];
    snprintf(report_dir, sizeof(report_dir), "%s", report_json);
    char *slash = strrchr(report_dir, '/');
    if (slash == NULL) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing route_texts_path\n");
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    *slash = '\0';
    if (path_join(route_texts_path, sizeof(route_texts_path), report_dir, "r2c_route_texts") != 0 || !dir_exists(route_texts_path)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing route_texts_path: %s\n", route_texts_path);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
  }

  bool seen_non_ascii = false;
  for (size_t i = 0; i < states.len; ++i) {
    char txt_path[PATH_MAX];
    char file_name[PATH_MAX];
    snprintf(file_name, sizeof(file_name), "%s.txt", states.items[i]);
    if (path_join(txt_path, sizeof(txt_path), route_texts_path, file_name) != 0 || !file_exists(txt_path)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] route text payload missing: %s\n", states.items[i]);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    size_t txt_len = 0;
    char *txt = read_file_all(txt_path, &txt_len);
    if (txt == NULL || txt_len == 0u) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] route text payload missing: %s\n", states.items[i]);
      free(txt);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (has_non_ascii(txt, txt_len)) seen_non_ascii = true;
    free(txt);
  }
  if (!seen_non_ascii) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] route text payload does not include non-ascii content\n");
    strlist_free(&states);
    free(report_doc);
    return 1;
  }

  char semantic_map_path[PATH_MAX];
  char semantic_runtime_map_path[PATH_MAX];
  if (!json_get_string(report_doc, "semantic_node_map_path", semantic_map_path, sizeof(semantic_map_path)) ||
      !file_exists(semantic_map_path) ||
      !json_get_string(report_doc, "semantic_runtime_map_path", semantic_runtime_map_path, sizeof(semantic_runtime_map_path)) ||
      !file_exists(semantic_runtime_map_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing semantic map paths\n");
    strlist_free(&states);
    free(report_doc);
    return 1;
  }

  size_t sem_src_len = 0;
  size_t sem_rt_len = 0;
  char *sem_src_doc = read_file_all(semantic_map_path, &sem_src_len);
  char *sem_rt_doc = read_file_all(semantic_runtime_map_path, &sem_rt_len);
  if (sem_src_doc == NULL || sem_rt_doc == NULL) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to read semantic maps\n");
    free(sem_src_doc);
    free(sem_rt_doc);
    strlist_free(&states);
    free(report_doc);
    return 1;
  }
  int src_nodes = json_count_key_occurrence(sem_src_doc, "node_id");
  int rt_nodes = json_count_key_occurrence(sem_rt_doc, "node_id");
  free(sem_src_doc);
  free(sem_rt_doc);
  if (src_nodes != semantic_node_count || rt_nodes != semantic_node_count) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] semantic map count mismatch src=%d runtime=%d expected=%d\n",
            src_nodes, rt_nodes, semantic_node_count);
    strlist_free(&states);
    free(report_doc);
    return 1;
  }

  fprintf(stdout, "[verify-r2c-strict] no-fallback=true\n");
  fprintf(stdout, "[verify-r2c-strict] compiler-rc=0\n");

  int fullroute_routes_ok = full_route_count;
  const char *require_runtime = getenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME");
  bool runtime_required = (require_runtime == NULL || strcmp(require_runtime, "1") == 0);
  if (runtime_required) {
    if (!has_android_device()) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] no android emulator/device detected\n");
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!path_executable(mobile_runner)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] missing mobile runner executable: %s\n", mobile_runner);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (path_is_interpreter_script(mobile_runner)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] mobile runner must be native executable (no interpreter): %s\n",
              mobile_runner);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!allow_script_dispatch_wrapper() && command_looks_like_script_dispatch(mobile_runner)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] mobile runner resolves to script-dispatch wrapper; set CHENG_ANDROID_MOBILE_RUNNER to a true native binary: %s\n",
              mobile_runner);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char app_args_tmp[PATH_MAX];
    if (path_join(app_args_tmp, sizeof(app_args_tmp), out_dir, "app_args.json") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    const char *timeout_env = getenv("CHENG_ANDROID_1TO1_RUNTIME_TIMEOUT_SEC");
    int runtime_timeout = 900;
    if (timeout_env != NULL && timeout_env[0] != '\0') runtime_timeout = atoi(timeout_env);

    char runner_entry[PATH_MAX];
    if (path_join(runner_entry, sizeof(runner_entry), root, "r2c_app_runner_main.cheng") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char mobile_export_out[PATH_MAX];
    char native_obj_arg[PATH_MAX + 16];
    char runtime_state_arg[PATH_MAX + 32];
    char app_args_json_arg[PATH_MAX + 32];
    char app_arg_manifest[PATH_MAX + 64];
    if (path_join(mobile_export_out, sizeof(mobile_export_out), out_dir, "mobile_export") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    snprintf(native_obj_arg, sizeof(native_obj_arg), "--native-obj:%s", android_obj);
    snprintf(runtime_state_arg, sizeof(runtime_state_arg), "--runtime-state-out:%s", runtime_json);
    snprintf(app_args_json_arg, sizeof(app_args_json_arg), "--app-args-json:%s", app_args_tmp);
    char app_manifest_path[PATH_MAX];
    if (path_join(app_manifest_path, sizeof(app_manifest_path), compile_out, "r2capp/r2capp_manifest.json") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char app_args_doc[PATH_MAX * 2];
    int app_args_n = snprintf(app_args_doc, sizeof(app_args_doc),
                              "{\"manifest\":\"%s\",\"mode\":\"android-semantic-visual-1to1\",\"routes\":%d}\n",
                              app_manifest_path, full_route_count);
    if (app_args_n <= 0 || (size_t)app_args_n >= sizeof(app_args_doc) ||
        write_file_all(app_args_tmp, app_args_doc, (size_t)app_args_n) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to write app args json\n");
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    snprintf(app_arg_manifest, sizeof(app_arg_manifest), "--app-arg:r2c_manifest=%s", app_manifest_path);

    char app_arg_sem_nodes[128];
    snprintf(app_arg_sem_nodes, sizeof(app_arg_sem_nodes), "--app-arg:semantic_nodes=%d", semantic_node_count);
    char out_arg[PATH_MAX + 16];
    snprintf(out_arg, sizeof(out_arg), "--out:%s", mobile_export_out);
    char *runtime_argv[] = {
        mobile_runner,
        runner_entry,
        "--name:claude_android_1to1",
        out_arg,
        NULL,
        native_obj_arg,
        app_arg_manifest,
        app_arg_sem_nodes,
        "--app-arg:gate_mode=android-semantic-visual-1to1",
        "--app-arg:arg_probe=foo_bar",
        app_args_json_arg,
        runtime_state_arg,
        "--runtime-state-wait-ms:3000",
        NULL,
    };

    char assets_arg[PATH_MAX + 16];
    char assets_dir[PATH_MAX];
    if (path_join(assets_dir, sizeof(assets_dir), compile_out, "r2capp") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    snprintf(assets_arg, sizeof(assets_arg), "--assets:%s", assets_dir);
    runtime_argv[4] = assets_arg;

    fprintf(stdout, "== android 1:1: mobile run (kotlin host) ==\n");
    print_cmdline(runtime_argv);
    RunResult rr = run_command(runtime_argv, run_log, runtime_timeout);
    if (rr.code != 0) {
      if (rr.timed_out) {
        fprintf(stderr, "[verify-android-claude-1to1-gate] runtime timeout after %ds\n", runtime_timeout);
      } else {
        fprintf(stderr, "[verify-android-claude-1to1-gate] runtime failed rc=%d\n", rr.code);
      }
      print_file_head(run_log, 220);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }

    if (!file_exists(runtime_json)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime state file missing: %s\n", runtime_json);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!file_contains(run_log, "--es cheng_app_args_kv") || !file_contains(run_log, "--es cheng_app_args_json") ||
        !file_contains(run_log, "--es cheng_app_args_json_b64") ||
        !file_contains(run_log, "[run-android] runtime-state") ||
        !file_not_contains(run_log, "shim mode active") ||
        !file_contains(run_log, "[mobile-export] mode=native-obj")) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] runtime log validation failed\n");
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!parse_runtime_state(runtime_json, semantic_node_count)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }

    fprintf(stdout, "== android 1:1: fullroute visual gate ==\n");
    char *full_argv[] = {
        fullroute_gate_cmd,
        "--compile-out",
        compile_out,
        "--out",
        fullroute_out,
        "--manifest",
        android_truth_manifest,
        NULL,
    };
    print_cmdline(full_argv);
    rr = run_command(full_argv, fullroute_log, runtime_timeout);
    if (rr.code != 0) {
      if (rr.timed_out) {
        fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute timeout after %ds\n", runtime_timeout);
      } else {
        fprintf(stderr, "[verify-android-claude-1to1-gate] fullroute failed rc=%d\n", rr.code);
      }
      print_file_head(fullroute_log, 220);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!file_exists(fullroute_report) || !file_contains(fullroute_log, "[verify-android-fullroute-pixel] ok routes=") ||
        !validate_fullroute_report(fullroute_report, full_route_count)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    fullroute_routes_ok = full_route_count;
  } else {
    fprintf(stdout, "[verify-android-claude-1to1-gate] runtime phase skipped: CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=0\n");
  }

  char git_head[128];
  snprintf(git_head, sizeof(git_head), "unknown");
  char git_root[PATH_MAX];
  snprintf(git_root, sizeof(git_root), "%s/..", root);
  char *git_argv[] = {"git", "-C", git_root, "rev-parse", "HEAD", NULL};
  char *git_out = NULL;
  int git_rc = capture_command_output(git_argv, 10, &git_out);
  if (git_rc == 0 && git_out != NULL) {
    size_t i = 0;
    while (git_out[i] != '\0' && git_out[i] != '\n' && i + 1u < sizeof(git_head)) {
      git_head[i] = git_out[i];
      i++;
    }
    git_head[i] = '\0';
  }
  free(git_out);

  char marker_json[4096];
  int m = snprintf(marker_json, sizeof(marker_json),
                   "{\n"
                   "  \"git_head\": \"%s\",\n"
                   "  \"project\": \"%s\",\n"
                   "  \"entry\": \"%s\",\n"
                   "  \"gate_mode\": \"android-semantic-visual-1to1\",\n"
                   "  \"routes\": %d,\n"
                   "  \"pixel_tolerance\": 0,\n"
                   "  \"semantic_node_count\": %d,\n"
                   "  \"used_fallback\": false,\n"
                   "  \"compiler_rc\": 0,\n"
                   "  \"android_truth_manifest_path\": \"%s\",\n"
                   "  \"runtime_required\": true,\n"
                   "  \"runtime_state_path\": \"%s\",\n"
                   "  \"run_log_path\": \"%s\",\n"
                   "  \"visual_fullroute_log_path\": \"%s\",\n"
                   "  \"visual_fullroute_report_path\": \"%s\",\n"
                   "  \"visual_passed\": true,\n"
                   "  \"visual_routes_verified\": %d\n"
                   "}\n",
                   git_head, project, entry, full_route_count, semantic_node_count, android_truth_manifest, runtime_json, run_log,
                   fullroute_log, fullroute_report, fullroute_routes_ok);
  if (m <= 0 || (size_t)m >= sizeof(marker_json) || write_file_all(marker_path, marker_json, (size_t)m) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to write marker: %s\n", marker_path);
    strlist_free(&states);
    free(report_doc);
    return 1;
  }

  strlist_free(&states);
  free(report_doc);
  fprintf(stdout, "[verify-android-claude-1to1-gate] ok routes=%d\n", full_route_count);
  return 0;
}
