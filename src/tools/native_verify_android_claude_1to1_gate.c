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

#define CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH 1212
#define CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT 2512

typedef struct {
  int code;
  bool timed_out;
} RunResult;

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

typedef struct {
  char route_state[128];
  char last_frame_hash[128];
  char semantic_nodes_applied_hash[128];
  long long surface_width;
  long long surface_height;
  long long semantic_nodes_applied_count;
} RuntimeStateSnapshot;

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

static int env_positive_int_or_default(const char *name, int fallback) {
  if (name == NULL || name[0] == '\0') return fallback;
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return fallback;
  char *end = NULL;
  long parsed = strtol(v, &end, 10);
  if (end == v || *end != '\0' || parsed <= 0 || parsed > 10000L) return fallback;
  return (int)parsed;
}

static bool env_positive_int(const char *name, int *out_value) {
  if (out_value != NULL) *out_value = 0;
  if (name == NULL || name[0] == '\0') return false;
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return false;
  char *end = NULL;
  long parsed = strtol(v, &end, 10);
  if (end == v || *end != '\0' || parsed <= 0 || parsed > 10000L) return false;
  if (out_value != NULL) *out_value = (int)parsed;
  return true;
}

static bool strlist_contains(const StringList *list, const char *value) {
  if (list == NULL || value == NULL || value[0] == '\0') return false;
  for (size_t i = 0u; i < list->len; ++i) {
    if (list->items[i] != NULL && strcmp(list->items[i], value) == 0) return true;
  }
  return false;
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

static bool trim_suffix_inplace(char *path, const char *suffix) {
  if (path == NULL || suffix == NULL) return false;
  size_t n = strlen(path);
  size_t m = strlen(suffix);
  if (n < m) return false;
  if (strcmp(path + (n - m), suffix) != 0) return false;
  path[n - m] = '\0';
  return true;
}

static void normalize_gui_root_inplace(char *root) {
  if (root == NULL || root[0] == '\0') return;
  while (trim_suffix_inplace(root, "/src/scripts") || trim_suffix_inplace(root, "/scripts") ||
         trim_suffix_inplace(root, "/src")) {
  }
}

static int resolve_native_bin_path(const char *root, const char *command, char *out, size_t out_cap) {
  if (root == NULL || root[0] == '\0' || command == NULL || command[0] == '\0' || out == NULL || out_cap == 0u) return -1;
  char cand_src_bin[PATH_MAX];
  char cand_bin[PATH_MAX];
  int n1 = snprintf(cand_src_bin, sizeof(cand_src_bin), "%s/src/bin/%s", root, command);
  int n2 = snprintf(cand_bin, sizeof(cand_bin), "%s/bin/%s", root, command);
  if (n1 < 0 || (size_t)n1 >= sizeof(cand_src_bin) || n2 < 0 || (size_t)n2 >= sizeof(cand_bin)) return -1;
  if (path_executable(cand_src_bin)) {
    if (snprintf(out, out_cap, "%s", cand_src_bin) >= (int)out_cap) return -1;
    return 0;
  }
  if (path_executable(cand_bin)) {
    if (snprintf(out, out_cap, "%s", cand_bin) >= (int)out_cap) return -1;
    return 0;
  }
  if (snprintf(out, out_cap, "%s", cand_src_bin) >= (int)out_cap) return -1;
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

static int copy_file_all(const char *src, const char *dst) {
  if (src == NULL || src[0] == '\0' || dst == NULL || dst[0] == '\0') return -1;
  FILE *in = fopen(src, "rb");
  if (in == NULL) return -1;
  FILE *out = fopen(dst, "wb");
  if (out == NULL) {
    fclose(in);
    return -1;
  }
  char buf[8192];
  while (1) {
    size_t rd = fread(buf, 1u, sizeof(buf), in);
    if (rd > 0u && fwrite(buf, 1u, rd, out) != rd) {
      fclose(in);
      fclose(out);
      return -1;
    }
    if (rd < sizeof(buf)) {
      if (feof(in)) break;
      if (ferror(in)) {
        fclose(in);
        fclose(out);
        return -1;
      }
    }
  }
  if (fclose(in) != 0) {
    fclose(out);
    return -1;
  }
  if (fclose(out) != 0) return -1;
  return 0;
}

static int copy_truth_dir_files(const char *src_dir, const char *dst_dir) {
  if (src_dir == NULL || src_dir[0] == '\0' || dst_dir == NULL || dst_dir[0] == '\0') return -1;
  DIR *dir = opendir(src_dir);
  if (dir == NULL) return -1;
  struct dirent *ent = NULL;
  while ((ent = readdir(dir)) != NULL) {
    const char *name = ent->d_name;
    if (name[0] == '.') continue;
    char src_path[PATH_MAX];
    char dst_path[PATH_MAX];
    if (snprintf(src_path, sizeof(src_path), "%s/%s", src_dir, name) >= (int)sizeof(src_path) ||
        snprintf(dst_path, sizeof(dst_path), "%s/%s", dst_dir, name) >= (int)sizeof(dst_path)) {
      closedir(dir);
      return -1;
    }
    struct stat st;
    if (stat(src_path, &st) != 0 || !S_ISREG(st.st_mode)) continue;
    if (copy_file_all(src_path, dst_path) != 0) {
      closedir(dir);
      return -1;
    }
  }
  closedir(dir);
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

static bool json_get_positive_int32(const char *doc, const char *key, int *out) {
  long long v = 0;
  if (!json_get_int64(doc, key, &v)) return false;
  if (v <= 0 || v > 32768) return false;
  if (out != NULL) *out = (int)v;
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

static bool kv_has_key_value(const char *kv, const char *key, const char *expected) {
  if (kv == NULL || key == NULL || key[0] == '\0' || expected == NULL) return false;
  size_t key_len = strlen(key);
  size_t expected_len = strlen(expected);
  const char *p = kv;
  while (*p != '\0') {
    while (*p == ';') p += 1;
    if (*p == '\0') break;
    const char *entry = p;
    while (*p != '\0' && *p != ';') p += 1;
    const char *entry_end = p;
    const char *eq = entry;
    while (eq < entry_end && *eq != '=') eq += 1;
    if (eq < entry_end) {
      size_t name_len = (size_t)(eq - entry);
      if (name_len == key_len && strncmp(entry, key, key_len) == 0) {
        const char *value = eq + 1;
        size_t value_len = (size_t)(entry_end - value);
        return (value_len == expected_len && strncmp(value, expected, expected_len) == 0);
      }
    }
  }
  return false;
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

static int count_truth_states(const char *truth_manifest_path) {
  size_t n = 0;
  char *doc = read_file_all(truth_manifest_path, &n);
  if (doc == NULL) return -1;
  int routes = 0;
  if (!json_get_int32(doc, "routes", &routes) || routes <= 0) {
    if (!json_get_int32(doc, "state_count", &routes) || routes <= 0) {
      free(doc);
      return -1;
    }
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

static bool parse_runtime_reason_token(const char *reason, const char *key, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (reason == NULL || key == NULL || key[0] == '\0' || out == NULL || out_cap == 0u) return false;
  size_t key_len = strlen(key);
  const char *p = reason;
  while (p != NULL && *p != '\0') {
    const char *hit = strstr(p, key);
    if (hit == NULL) break;
    if (hit > reason) {
      char prev = *(hit - 1);
      if (prev != ' ' && prev != ';' && prev != '\t' && prev != '\n' && prev != '\r') {
        p = hit + 1;
        continue;
      }
    }
    if (hit[key_len] != '=') {
      p = hit + 1;
      continue;
    }
    const char *value = hit + key_len + 1u;
    size_t n = 0u;
    while (value[n] != '\0' && value[n] != ' ' && value[n] != ';' && value[n] != '\t' && value[n] != '\n' &&
           value[n] != '\r') {
      n += 1u;
    }
    if (n == 0u) return false;
    if (n >= out_cap) n = out_cap - 1u;
    memcpy(out, value, n);
    out[n] = '\0';
    return true;
  }
  return false;
}

static bool runtime_hash_nonzero(const char *text) {
  if (text == NULL || text[0] == '\0') return false;
  const char *p = text;
  if (p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) p += 2;
  bool seen_hex = false;
  while (*p != '\0') {
    unsigned char ch = (unsigned char)*p;
    if (isspace(ch)) break;
    if (!isxdigit(ch)) break;
    seen_hex = true;
    if (ch != '0') return true;
    ++p;
  }
  return !seen_hex ? false : false;
}

static bool normalize_hash_hex(const char *input, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  if (input == NULL || input[0] == '\0') return false;
  const char *p = input;
  if (p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) p += 2;
  size_t n = 0u;
  while (*p != '\0' && n + 1u < out_cap) {
    unsigned char ch = (unsigned char)*p;
    if (isspace(ch)) break;
    if (!isxdigit(ch)) break;
    out[n++] = (char)tolower(ch);
    ++p;
  }
  out[n] = '\0';
  return n > 0u;
}

static bool hash_hex_equal(const char *lhs, const char *rhs) {
  char a[64];
  char b[64];
  if (!normalize_hash_hex(lhs, a, sizeof(a)) || !normalize_hash_hex(rhs, b, sizeof(b))) return false;
  return strcmp(a, b) == 0;
}

static uint64_t fnv1a64_bytes(uint64_t seed, const unsigned char *data, size_t n) {
  uint64_t h = seed;
  if (h == 0u) h = 1469598103934665603ull;
  if (data == NULL) return h;
  for (size_t i = 0u; i < n; ++i) {
    h ^= (uint64_t)data[i];
    h *= 1099511628211ull;
  }
  return h;
}

static uint64_t fnv1a64_file(const char *path) {
  if (path == NULL || path[0] == '\0') return 0u;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return 0u;
  uint64_t h = 1469598103934665603ull;
  unsigned char buf[8192];
  while (1) {
    size_t rd = fread(buf, 1u, sizeof(buf), fp);
    if (rd > 0u) h = fnv1a64_bytes(h, buf, rd);
    if (rd < sizeof(buf)) {
      if (feof(fp)) break;
      if (ferror(fp)) {
        fclose(fp);
        return 0u;
      }
    }
  }
  fclose(fp);
  return h;
}

static void to_hex64(uint64_t value, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  (void)snprintf(out, out_cap, "%016llx", (unsigned long long)value);
}

static bool resolve_truth_dims(const char *meta_path,
                               size_t rgba_len,
                               int target_w,
                               int target_h,
                               int *out_w,
                               int *out_h) {
  if (out_w == NULL || out_h == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) return false;
  if (target_w <= 0 || target_h <= 0) return false;
  *out_w = 0;
  *out_h = 0;
  if (meta_path != NULL && meta_path[0] != '\0' && file_exists(meta_path)) {
    size_t meta_len = 0u;
    char *meta_doc = read_file_all(meta_path, &meta_len);
    if (meta_doc != NULL && meta_len > 0u) {
      int w = 0;
      int h = 0;
      if (json_get_positive_int32(meta_doc, "width", &w) &&
          json_get_positive_int32(meta_doc, "height", &h) &&
          ((uint64_t)w * (uint64_t)h * 4u) == (uint64_t)rgba_len) {
        *out_w = w;
        *out_h = h;
        free(meta_doc);
        return true;
      }
      free(meta_doc);
    }
  }
  if (((uint64_t)target_w * (uint64_t)target_h * 4u) == (uint64_t)rgba_len) {
    *out_w = target_w;
    *out_h = target_h;
    return true;
  }
  uint64_t pixels = (uint64_t)rgba_len / 4u;
  const int candidates[] = {360, 375, 390, 393, 412, 414, 428, 540, 720, 1080, 1170, 1212, 1242, 1440};
  uint64_t best_diff = UINT64_MAX;
  int best_w = 0;
  int best_h = 0;
  for (size_t i = 0u; i < sizeof(candidates) / sizeof(candidates[0]); ++i) {
    int w = candidates[i];
    if (w <= 0) continue;
    if ((pixels % (uint64_t)w) != 0u) continue;
    uint64_t h_u64 = pixels / (uint64_t)w;
    if (h_u64 == 0u || h_u64 > 10000u) continue;
    int h = (int)h_u64;
    uint64_t diff = ((uint64_t)w * (uint64_t)target_h > (uint64_t)h * (uint64_t)target_w)
                        ? ((uint64_t)w * (uint64_t)target_h - (uint64_t)h * (uint64_t)target_w)
                        : ((uint64_t)h * (uint64_t)target_w - (uint64_t)w * (uint64_t)target_h);
    if (best_w == 0 || diff < best_diff) {
      best_diff = diff;
      best_w = w;
      best_h = h;
    }
  }
  if (best_w > 0 && best_h > 0) {
    *out_w = best_w;
    *out_h = best_h;
    return true;
  }
  return false;
}

static uint64_t runtime_expected_hash_from_rgba(const unsigned char *rgba,
                                                int src_w,
                                                int src_h,
                                                int dst_w,
                                                int dst_h) {
  if (rgba == NULL || src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0) return 0u;
  uint64_t h = 1469598103934665603ull;
  for (int y = 0; y < dst_h; ++y) {
    uint64_t sy_u64 = ((uint64_t)y * (uint64_t)src_h) / (uint64_t)dst_h;
    int sy = (int)sy_u64;
    if (sy < 0) sy = 0;
    if (sy >= src_h) sy = src_h - 1;
    for (int x = 0; x < dst_w; ++x) {
      uint64_t sx_u64 = ((uint64_t)x * (uint64_t)src_w) / (uint64_t)dst_w;
      int sx = (int)sx_u64;
      if (sx < 0) sx = 0;
      if (sx >= src_w) sx = src_w - 1;
      const unsigned char *px = rgba + (((size_t)sy * (size_t)src_w + (size_t)sx) * 4u);
      unsigned char bgra[4];
      bgra[0] = px[2];
      bgra[1] = px[1];
      bgra[2] = px[0];
      bgra[3] = px[3];
      h = fnv1a64_bytes(h, bgra, sizeof(bgra));
    }
  }
  return h;
}

static bool prepare_route_truth_assets(const char *truth_dir,
                                       const char *route_state,
                                       const char *assets_dir,
                                       char *expected_hash_out,
                                       size_t expected_hash_out_cap,
                                       int *target_width_out,
                                       int *target_height_out) {
  if (target_width_out != NULL) *target_width_out = 0;
  if (target_height_out != NULL) *target_height_out = 0;
  if (expected_hash_out != NULL && expected_hash_out_cap > 0u) expected_hash_out[0] = '\0';
  if (truth_dir == NULL || truth_dir[0] == '\0') return true;
  if (route_state == NULL || route_state[0] == '\0') {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] CHENG_ANDROID_1TO1_TRUTH_DIR requires --route-state\n");
    return false;
  }
  if (!dir_exists(truth_dir)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] truth dir not found: %s\n", truth_dir);
    return false;
  }
  if (assets_dir == NULL || assets_dir[0] == '\0' || !dir_exists(assets_dir)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] invalid compile assets dir: %s\n", assets_dir ? assets_dir : "");
    return false;
  }

  char src_rgba[PATH_MAX];
  char src_framehash[PATH_MAX];
  char src_meta[PATH_MAX];
  if (snprintf(src_rgba, sizeof(src_rgba), "%s/%s.rgba", truth_dir, route_state) >= (int)sizeof(src_rgba) ||
      snprintf(src_framehash, sizeof(src_framehash), "%s/%s.framehash", truth_dir, route_state) >=
          (int)sizeof(src_framehash) ||
      snprintf(src_meta, sizeof(src_meta), "%s/%s.meta.json", truth_dir, route_state) >= (int)sizeof(src_meta)) {
    return false;
  }
  if (!file_exists(src_rgba)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing truth rgba for route=%s: %s\n",
            route_state,
            src_rgba);
    return false;
  }

  char truth_dst_dir[PATH_MAX];
  char dst_rgba[PATH_MAX];
  char dst_framehash[PATH_MAX];
  char dst_meta[PATH_MAX];
  if (snprintf(truth_dst_dir, sizeof(truth_dst_dir), "%s/truth", assets_dir) >= (int)sizeof(truth_dst_dir) ||
      snprintf(dst_rgba, sizeof(dst_rgba), "%s/%s.rgba", truth_dst_dir, route_state) >= (int)sizeof(dst_rgba) ||
      snprintf(dst_framehash, sizeof(dst_framehash), "%s/%s.framehash", truth_dst_dir, route_state) >=
          (int)sizeof(dst_framehash) ||
      snprintf(dst_meta, sizeof(dst_meta), "%s/%s.meta.json", truth_dst_dir, route_state) >= (int)sizeof(dst_meta)) {
    return false;
  }
  if (ensure_dir(truth_dst_dir) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to create truth asset dir: %s\n", truth_dst_dir);
    return false;
  }
  const char *copy_all = getenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
  if (copy_all != NULL && strcmp(copy_all, "1") == 0) {
    if (copy_truth_dir_files(truth_dir, truth_dst_dir) != 0) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] failed to copy truth dir: %s\n", truth_dir);
      return false;
    }
  }
  if (copy_file_all(src_rgba, dst_rgba) != 0) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to copy truth rgba: %s\n", src_rgba);
    return false;
  }
  if (file_exists(src_framehash)) (void)copy_file_all(src_framehash, dst_framehash);
  if (file_exists(src_meta)) (void)copy_file_all(src_meta, dst_meta);

  char framehash_from_file[128];
  framehash_from_file[0] = '\0';
  if (file_exists(src_framehash)) {
    size_t fh_len = 0u;
    char *fh_doc = read_file_all(src_framehash, &fh_len);
    if (fh_doc != NULL && fh_len > 0u) {
      size_t pos = 0u;
      for (size_t i = 0u; i < fh_len && pos + 1u < sizeof(framehash_from_file); ++i) {
        unsigned char ch = (unsigned char)fh_doc[i];
        if (isxdigit(ch)) {
          framehash_from_file[pos++] = (char)tolower(ch);
          continue;
        }
        if (isspace(ch)) break;
        pos = 0u;
        break;
      }
      framehash_from_file[pos] = '\0';
    }
    free(fh_doc);
  }

  size_t rgba_len = 0u;
  char *rgba_doc = read_file_all(src_rgba, &rgba_len);
  if (rgba_doc == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
    free(rgba_doc);
    fprintf(stderr, "[verify-android-claude-1to1-gate] invalid truth rgba content: %s\n", src_rgba);
    return false;
  }

  int src_w = 0;
  int src_h = 0;
  int probe_w = CHENG_ANDROID_GATE_TRUTH_FRAME_WIDTH;
  int probe_h = CHENG_ANDROID_GATE_TRUTH_FRAME_HEIGHT;
  int env_target_w = 0;
  int env_target_h = 0;
  if (env_positive_int("CHENG_ANDROID_1TO1_TARGET_WIDTH", &env_target_w)) probe_w = env_target_w;
  if (env_positive_int("CHENG_ANDROID_1TO1_TARGET_HEIGHT", &env_target_h)) probe_h = env_target_h;
  if (!resolve_truth_dims(src_meta, rgba_len, probe_w, probe_h, &src_w, &src_h)) {
    free(rgba_doc);
    fprintf(stderr, "[verify-android-claude-1to1-gate] cannot resolve truth rgba dimensions: %s\n", src_rgba);
    return false;
  }
  int hash_target_w = env_target_w > 0 ? env_target_w : src_w;
  int hash_target_h = env_target_h > 0 ? env_target_h : src_h;
  bool require_native_dims = false;
  const char *require_dims_env = getenv("CHENG_ANDROID_1TO1_REQUIRE_NATIVE_TRUTH_DIMS");
  if (require_dims_env != NULL && require_dims_env[0] != '\0') {
    require_native_dims = (strcmp(require_dims_env, "0") != 0);
  } else {
    const char *enforce_surface_env = getenv("CHENG_ANDROID_1TO1_ENFORCE_SURFACE_TARGET");
    if (enforce_surface_env != NULL && strcmp(enforce_surface_env, "1") == 0) require_native_dims = true;
  }
  if (require_native_dims && env_target_w > 0 && env_target_h > 0 &&
      (src_w != env_target_w || src_h != env_target_h)) {
    free(rgba_doc);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] truth size mismatch route=%s got=%dx%d expect=%dx%d\n",
            route_state,
            src_w,
            src_h,
            env_target_w,
            env_target_h);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] regenerate truth with native size or set CHENG_ANDROID_1TO1_REQUIRE_NATIVE_TRUTH_DIMS=0 to bypass\n");
    return false;
  }

  uint64_t runtime_hash = runtime_expected_hash_from_rgba((const unsigned char *)rgba_doc,
                                                          src_w,
                                                          src_h,
                                                          hash_target_w,
                                                          hash_target_h);
  free(rgba_doc);
  if (runtime_hash == 0u) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] failed to compute expected runtime frame hash\n");
    return false;
  }
  const char *expected_hash = framehash_from_file;
  bool expected_hash_from_file = runtime_hash_nonzero(framehash_from_file);
  char runtime_hash_doc[32];
  to_hex64(runtime_hash, runtime_hash_doc, sizeof(runtime_hash_doc));
  if (!expected_hash_from_file) expected_hash = runtime_hash_doc;
  bool fullscreen_mode = false;
  const char *truth_frame_mode = getenv("CHENG_ANDROID_1TO1_TRUTH_FRAME_MODE");
  if (truth_frame_mode == NULL || truth_frame_mode[0] == '\0' ||
      strcmp(truth_frame_mode, "fullscreen") == 0) {
    fullscreen_mode = true;
  }
  bool disable_expected_framehash = fullscreen_mode;
  const char *disable_expected_env = getenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH");
  if (disable_expected_env != NULL && disable_expected_env[0] != '\0') {
    disable_expected_framehash = (strcmp(disable_expected_env, "1") == 0);
  }
  const char *enforce_expected_env = getenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
  if (enforce_expected_env != NULL && strcmp(enforce_expected_env, "1") == 0) {
    disable_expected_framehash = false;
  }
  if (expected_hash_out != NULL && expected_hash_out_cap > 0u) {
    if (disable_expected_framehash) {
      expected_hash_out[0] = '\0';
    } else {
      snprintf(expected_hash_out, expected_hash_out_cap, "%s", expected_hash);
    }
  }
  char runtime_hash_path[PATH_MAX];
  if (snprintf(runtime_hash_path, sizeof(runtime_hash_path), "%s/%s.runtime_framehash", truth_dst_dir, route_state) <
      (int)sizeof(runtime_hash_path)) {
    char line[40];
    int n = snprintf(line, sizeof(line), "%s\n", runtime_hash_doc);
    if (n > 0 && (size_t)n < sizeof(line)) {
      (void)write_file_all(runtime_hash_path, line, (size_t)n);
    }
  }
  uint64_t source_hash = fnv1a64_file(src_rgba);
  fprintf(stdout,
          "[verify-android-claude-1to1-gate] truth route=%s src=%dx%d src_hash=%016llx runtime_hash=%016llx expected=%s source=%s\n",
          route_state,
          src_w,
          src_h,
          (unsigned long long)source_hash,
          (unsigned long long)runtime_hash,
          disable_expected_framehash ? "<disabled>" : expected_hash,
          expected_hash_from_file ? "framehash-file" : "rgba-derived");
  if (target_width_out != NULL) *target_width_out = (env_target_w > 0) ? env_target_w : 0;
  if (target_height_out != NULL) *target_height_out = (env_target_h > 0) ? env_target_h : 0;
  return true;
}

static __attribute__((unused)) bool resolve_android_ndk_root(char *out, size_t out_cap) {
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

static __attribute__((unused)) bool resolve_android_clang(char *out, size_t out_cap) {
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
  if (!file_exists(android_obj)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing Cheng semantic android payload object: %s\n",
            android_obj);
    return 1;
  }
  if (log_file != NULL && log_file[0] != '\0') {
    const char *msg =
        "android_payload_source=cheng-compiler\n"
        "mode=semantic-object-only\n"
        "note=gate no longer rebuilds from cheng_mobile_exports.c\n";
    (void)write_file_all(log_file, msg, strlen(msg));
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

static bool resolve_android_serial(const char *adb, char *out, size_t out_cap) {
  if (adb == NULL || adb[0] == '\0' || out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  const char *env_serial = getenv("ANDROID_SERIAL");
  if (env_serial != NULL && env_serial[0] != '\0') {
    snprintf(out, out_cap, "%s", env_serial);
    return true;
  }
  char *devices_out = NULL;
  char *argv[] = {(char *)adb, "devices", NULL};
  int rc = capture_command_output(argv, 15, &devices_out);
  if (rc != 0 || devices_out == NULL) {
    free(devices_out);
    return false;
  }
  bool found = false;
  char *save = NULL;
  for (char *line = strtok_r(devices_out, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
    while (*line != '\0' && isspace((unsigned char)*line)) ++line;
    if (*line == '\0' || starts_with(line, "List of devices")) continue;
    char id[128];
    char state[64];
    id[0] = '\0';
    state[0] = '\0';
    (void)sscanf(line, "%127s %63s", id, state);
    if (id[0] != '\0' && strcmp(state, "device") == 0) {
      snprintf(out, out_cap, "%s", id);
      found = true;
      break;
    }
  }
  free(devices_out);
  return found;
}

static bool capture_runtime_route_visual(const char *out_dir,
                                         const RuntimeStateSnapshot *runtime_state,
                                         const char *runtime_frame_dump_file,
                                         bool require_success) {
  if (out_dir == NULL || out_dir[0] == '\0' || runtime_state == NULL) return !require_success;
  if (runtime_state->route_state[0] == '\0') return !require_success;
  if (runtime_frame_dump_file == NULL || runtime_frame_dump_file[0] == '\0') {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing runtime frame dump file arg\n");
    return !require_success;
  }

  char adb[PATH_MAX];
  if (!resolve_adb_executable(adb, sizeof(adb))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing adb for route visual capture\n");
    return !require_success;
  }
  char serial[128];
  if (!resolve_android_serial(adb, serial, sizeof(serial))) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] unable to resolve android serial for route visual capture\n");
    return !require_success;
  }

  char frame_dump_remote_path[PATH_MAX];
  char raw_path[PATH_MAX];
  char rgba_path[PATH_MAX];
  char meta_path[PATH_MAX];
  char runtime_hash_path[PATH_MAX];
  char framehash_path[PATH_MAX];
  if (snprintf(frame_dump_remote_path,
               sizeof(frame_dump_remote_path),
               "files/%s",
               runtime_frame_dump_file) >= (int)sizeof(frame_dump_remote_path) ||
      snprintf(raw_path, sizeof(raw_path), "%s/%s.runtime_raw", out_dir, runtime_state->route_state) >=
          (int)sizeof(raw_path) ||
      snprintf(rgba_path, sizeof(rgba_path), "%s/%s.rgba", out_dir, runtime_state->route_state) >=
          (int)sizeof(rgba_path) ||
      snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", out_dir, runtime_state->route_state) >=
          (int)sizeof(meta_path) ||
      snprintf(runtime_hash_path,
               sizeof(runtime_hash_path),
               "%s/%s.runtime_framehash",
               out_dir,
               runtime_state->route_state) >= (int)sizeof(runtime_hash_path) ||
      snprintf(framehash_path, sizeof(framehash_path), "%s/%s.framehash", out_dir, runtime_state->route_state) >=
          (int)sizeof(framehash_path)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] route visual output path too long\n");
    return !require_success;
  }

  char *raw_argv[] = {
      adb,
      "-s",
      serial,
      "exec-out",
      "run-as",
      "com.cheng.mobile",
      "cat",
      frame_dump_remote_path,
      NULL};
  RunResult raw_rr = run_command(raw_argv, raw_path, 25);
  if (raw_rr.code != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to capture runtime raw frame route=%s file=%s rc=%d\n",
            runtime_state->route_state,
            frame_dump_remote_path,
            raw_rr.code);
    return !require_success;
  }

  size_t raw_len = 0u;
  unsigned char *raw = (unsigned char *)read_file_all(raw_path, &raw_len);
  if (raw == NULL || raw_len == 0u) {
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] invalid runtime raw frame route=%s path=%s\n",
            runtime_state->route_state,
            raw_path);
    return !require_success;
  }
  uint32_t width = (runtime_state->surface_width > 0) ? (uint32_t)runtime_state->surface_width : 0u;
  uint32_t height = (runtime_state->surface_height > 0) ? (uint32_t)runtime_state->surface_height : 0u;
  if (width == 0u || height == 0u) {
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] zero-sized runtime raw frame target route=%s\n",
            runtime_state->route_state);
    return !require_success;
  }
  size_t full_bytes = (size_t)width * (size_t)height * 4u;
  if (raw_len != full_bytes) {
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime raw frame size mismatch route=%s got=%zu expected=%zu (%ux%u)\n",
            runtime_state->route_state,
            raw_len,
            full_bytes,
            width,
            height);
    return !require_success;
  }
  size_t rgba_bytes = full_bytes;
  unsigned char *rgba = (unsigned char *)malloc(rgba_bytes);
  if (rgba == NULL) {
    free(raw);
    fprintf(stderr, "[verify-android-claude-1to1-gate] oom while converting runtime frame\n");
    return !require_success;
  }
  for (size_t i = 0u; i < (size_t)width * (size_t)height; ++i) {
    const size_t src = i * 4u;
    const size_t dst = src;
    // runtime raw frame stores little-endian 0xAARRGGBB words => B,G,R,A bytes.
    rgba[dst + 0u] = raw[src + 2u];
    rgba[dst + 1u] = raw[src + 1u];
    rgba[dst + 2u] = raw[src + 0u];
    rgba[dst + 3u] = raw[src + 3u];
  }
  if (write_file_all(rgba_path, (const char *)rgba, rgba_bytes) != 0) {
    free(rgba);
    free(raw);
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write runtime rgba route=%s path=%s\n",
            runtime_state->route_state,
            rgba_path);
    return !require_success;
  }

  uint64_t runtime_raw_hash = fnv1a64_bytes(1469598103934665603ull, raw, raw_len);
  uint64_t rgba_hash = fnv1a64_bytes(1469598103934665603ull, rgba, rgba_bytes);
  free(rgba);
  free(raw);
  char runtime_raw_hash_hex[32];
  char rgba_hash_hex[32];
  to_hex64(runtime_raw_hash, runtime_raw_hash_hex, sizeof(runtime_raw_hash_hex));
  to_hex64(rgba_hash, rgba_hash_hex, sizeof(rgba_hash_hex));

  if (runtime_state->last_frame_hash[0] != '\0' &&
      !hash_hex_equal(runtime_raw_hash_hex, runtime_state->last_frame_hash)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime frame hash mismatch route=%s raw=%s state=%s\n",
            runtime_state->route_state,
            runtime_raw_hash_hex,
            runtime_state->last_frame_hash);
    if (require_success) return false;
  }

  char runtime_hash_line[160];
  int runtime_hash_n = snprintf(runtime_hash_line, sizeof(runtime_hash_line), "%s\n", runtime_state->last_frame_hash);
  if (runtime_hash_n <= 0 || (size_t)runtime_hash_n >= sizeof(runtime_hash_line) ||
      write_file_all(runtime_hash_path, runtime_hash_line, (size_t)runtime_hash_n) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write runtime framehash route=%s path=%s\n",
            runtime_state->route_state,
            runtime_hash_path);
    return !require_success;
  }
  char framehash_line[160];
  int framehash_n = snprintf(framehash_line, sizeof(framehash_line), "%s\n", runtime_raw_hash_hex);
  if (framehash_n <= 0 || (size_t)framehash_n >= sizeof(framehash_line) ||
      write_file_all(framehash_path, framehash_line, (size_t)framehash_n) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write framehash route=%s path=%s\n",
            runtime_state->route_state,
            framehash_path);
    return !require_success;
  }

  char meta_doc[1024];
  int meta_n = snprintf(meta_doc,
                        sizeof(meta_doc),
                        "{\n"
                        "  \"route_state\": \"%s\",\n"
                        "  \"width\": %u,\n"
                        "  \"height\": %u,\n"
                        "  \"capture_source\": \"runtime_raw_frame\",\n"
                        "  \"runtime_frame_dump_file\": \"%s\",\n"
                        "  \"raw_bytes\": %zu,\n"
                        "  \"rgba_bytes\": %zu,\n"
                        "  \"rgba_fnv1a64\": \"%s\",\n"
                        "  \"raw_fnv1a64\": \"%s\",\n"
                        "  \"runtime_frame_hash\": \"%s\",\n"
                        "  \"semantic_nodes_applied_hash\": \"%s\",\n"
                        "  \"surface_width\": %lld,\n"
                        "  \"surface_height\": %lld,\n"
                        "  \"semantic_nodes_applied_count\": %lld\n"
                        "}\n",
                        runtime_state->route_state,
                        width,
                        height,
                        runtime_frame_dump_file,
                        raw_len,
                        rgba_bytes,
                        rgba_hash_hex,
                        runtime_raw_hash_hex,
                        runtime_state->last_frame_hash,
                        runtime_state->semantic_nodes_applied_hash,
                        runtime_state->surface_width,
                        runtime_state->surface_height,
                        runtime_state->semantic_nodes_applied_count);
  if (meta_n <= 0 || (size_t)meta_n >= sizeof(meta_doc) ||
      write_file_all(meta_path, meta_doc, (size_t)meta_n) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] failed to write runtime meta route=%s path=%s\n",
            runtime_state->route_state,
            meta_path);
    return !require_success;
  }
  fprintf(stdout,
          "[verify-android-claude-1to1-gate] runtime capture route=%s source=runtime_raw_frame rgba=%s\n",
          runtime_state->route_state,
          rgba_path);

  const char *freeze_truth_dir = getenv("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR");
  if (freeze_truth_dir != NULL && freeze_truth_dir[0] != '\0') {
    if (ensure_dir(freeze_truth_dir) != 0) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] failed to create freeze truth dir: %s\n",
              freeze_truth_dir);
      return false;
    }
    char truth_rgba[PATH_MAX];
    char truth_meta[PATH_MAX];
    char truth_runtime_hash[PATH_MAX];
    char truth_hash[PATH_MAX];
    if (snprintf(truth_rgba, sizeof(truth_rgba), "%s/%s.rgba", freeze_truth_dir, runtime_state->route_state) >=
            (int)sizeof(truth_rgba) ||
        snprintf(truth_meta, sizeof(truth_meta), "%s/%s.meta.json", freeze_truth_dir, runtime_state->route_state) >=
            (int)sizeof(truth_meta) ||
        snprintf(truth_runtime_hash,
                 sizeof(truth_runtime_hash),
                 "%s/%s.runtime_framehash",
                 freeze_truth_dir,
                 runtime_state->route_state) >= (int)sizeof(truth_runtime_hash) ||
        snprintf(truth_hash, sizeof(truth_hash), "%s/%s.framehash", freeze_truth_dir, runtime_state->route_state) >=
            (int)sizeof(truth_hash)) {
      fprintf(stderr, "[verify-android-claude-1to1-gate] freeze truth path too long\n");
      return false;
    }
    if (copy_file_all(rgba_path, truth_rgba) != 0 ||
        copy_file_all(meta_path, truth_meta) != 0 ||
        copy_file_all(runtime_hash_path, truth_runtime_hash) != 0 ||
        copy_file_all(framehash_path, truth_hash) != 0) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] failed to freeze route truth assets route=%s dir=%s\n",
              runtime_state->route_state,
              freeze_truth_dir);
      return false;
    }
    fprintf(stdout,
            "[verify-android-claude-1to1-gate] truth frozen route=%s dir=%s\n",
            runtime_state->route_state,
            freeze_truth_dir);
  }
  return true;
}

static bool parse_runtime_state(const char *runtime_json,
                                int semantic_node_count,
                                const char *expected_route_state,
                                const char *expected_frame_hash,
                                int expected_surface_width,
                                int expected_surface_height,
                                RuntimeStateSnapshot *snapshot_out) {
  if (snapshot_out != NULL) memset(snapshot_out, 0, sizeof(*snapshot_out));
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
  bool render_ready = false;
  bool semantic_nodes_loaded = false;
  long long semantic_nodes_applied_count = 0;
  char last_frame_hash[128];
  char semantic_nodes_applied_hash[128];
  char route_state[128];
  char build_hash[128];
  char semantic_hash[128];
  char runtime_reason[4096];
  last_frame_hash[0] = '\0';
  semantic_nodes_applied_hash[0] = '\0';
  route_state[0] = '\0';
  build_hash[0] = '\0';
  semantic_hash[0] = '\0';
  runtime_reason[0] = '\0';

  (void)json_get_string(doc, "last_error", runtime_reason, sizeof(runtime_reason));

  if (!json_get_bool(doc, "render_ready", &render_ready)) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "sr", token, sizeof(token))) {
      render_ready = (strcmp(token, "1") == 0 || strcmp(token, "true") == 0 || strcmp(token, "TRUE") == 0);
    }
  }
  if (!render_ready) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime render_ready is false\n");
    free(doc);
    return false;
  }

  if (!json_get_int64(doc, "semantic_nodes_applied_count", &semantic_nodes_applied_count)) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "sa", token, sizeof(token))) {
      semantic_nodes_applied_count = strtoll(token, NULL, 10);
    }
  }
  if (semantic_nodes_applied_count <= 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime semantic_nodes_applied_count <= 0 (got=%lld)\n",
            semantic_nodes_applied_count);
    free(doc);
    return false;
  }

  if (!json_get_bool(doc, "semantic_nodes_loaded", &semantic_nodes_loaded)) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "st", token, sizeof(token))) {
      semantic_nodes_loaded = (strcmp(token, "0") != 0);
    }
  }
  if (!semantic_nodes_loaded) {
    char token[64];
    token[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "st", token, sizeof(token))) {
      semantic_nodes_loaded = (strcmp(token, "0") != 0);
    }
  }
  if (!semantic_nodes_loaded) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime semantic_nodes_loaded is false\n");
    free(doc);
    return false;
  }

  if (!json_get_string(doc, "last_frame_hash", last_frame_hash, sizeof(last_frame_hash))) {
    (void)parse_runtime_reason_token(runtime_reason, "framehash", last_frame_hash, sizeof(last_frame_hash));
  }
  if (!runtime_hash_nonzero(last_frame_hash)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime last_frame_hash is zero/invalid\n");
    free(doc);
    return false;
  }
  if (expected_frame_hash != NULL && expected_frame_hash[0] != '\0' &&
      !hash_hex_equal(last_frame_hash, expected_frame_hash)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime framehash mismatch expected=%s got=%s\n",
            expected_frame_hash,
            last_frame_hash);
    free(doc);
    return false;
  }

  if (!json_get_string(doc, "semantic_nodes_applied_hash", semantic_nodes_applied_hash, sizeof(semantic_nodes_applied_hash))) {
    (void)parse_runtime_reason_token(runtime_reason, "sah", semantic_nodes_applied_hash, sizeof(semantic_nodes_applied_hash));
  }
  if (!runtime_hash_nonzero(semantic_nodes_applied_hash)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime semantic_nodes_applied_hash is zero/invalid\n");
    free(doc);
    return false;
  }

  if (!json_get_string(doc, "route_state", route_state, sizeof(route_state))) {
    (void)parse_runtime_reason_token(runtime_reason, "route", route_state, sizeof(route_state));
  }
  if (route_state[0] == '\0') {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime route_state is empty\n");
    free(doc);
    return false;
  }
  if (expected_route_state != NULL && expected_route_state[0] != '\0' &&
      strcmp(route_state, expected_route_state) != 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime route_state mismatch expected=%s got=%s\n",
            expected_route_state,
            route_state);
    free(doc);
    return false;
  }

  if (!json_get_string(doc, "build_hash", build_hash, sizeof(build_hash))) {
    (void)parse_runtime_reason_token(runtime_reason, "buildhash", build_hash, sizeof(build_hash));
  }
  if (!runtime_hash_nonzero(build_hash)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime build_hash is zero/invalid\n");
    free(doc);
    return false;
  }

  if (!json_get_string(doc, "semantic_hash", semantic_hash, sizeof(semantic_hash))) {
    (void)parse_runtime_reason_token(runtime_reason, "semhash", semantic_hash, sizeof(semantic_hash));
  }
  if (!runtime_hash_nonzero(semantic_hash)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime semantic_hash is zero/invalid\n");
    free(doc);
    return false;
  }

  long long surface_width = 0;
  long long surface_height = 0;
  if (!json_get_int64(doc, "surface_width", &surface_width)) {
    char token_w[64];
    token_w[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "w", token_w, sizeof(token_w))) {
      surface_width = strtoll(token_w, NULL, 10);
    }
  }
  if (!json_get_int64(doc, "surface_height", &surface_height)) {
    char token_h[64];
    token_h[0] = '\0';
    if (parse_runtime_reason_token(runtime_reason, "h", token_h, sizeof(token_h))) {
      surface_height = strtoll(token_h, NULL, 10);
    }
  }
  if (surface_width <= 0 || surface_height <= 0) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime surface size missing/invalid (w=%lld h=%lld)\n",
            surface_width,
            surface_height);
    free(doc);
    return false;
  }
  if (expected_surface_width > 0 && surface_width != (long long)expected_surface_width) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime surface_width mismatch expected=%d got=%lld\n",
            expected_surface_width,
            surface_width);
    free(doc);
    return false;
  }
  if (expected_surface_height > 0 && surface_height != (long long)expected_surface_height) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] runtime surface_height mismatch expected=%d got=%lld\n",
            expected_surface_height,
            surface_height);
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
      !kv_has_key_value(kv, "gate_mode", "android-semantic-visual-1to1")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime launch args missing required markers\n");
    free(doc);
    return false;
  }
  if (!kv_has_key_value(kv, "truth_mode", "strict")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime launch args truth_mode is not strict\n");
    free(doc);
    return false;
  }
  char expected_from_kv[128];
  expected_from_kv[0] = '\0';
  if (!parse_runtime_reason_token(kv, "expected_framehash", expected_from_kv, sizeof(expected_from_kv)) ||
      !runtime_hash_nonzero(expected_from_kv)) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime launch args expected_framehash invalid\n");
    free(doc);
    return false;
  }
  if (!str_contains(js, "android-semantic-visual-1to1") || !str_contains(js, "\"routes\"")) {
    fprintf(stderr, "[verify-android-claude-1to1-gate] runtime args_json mode mismatch\n");
    free(doc);
    return false;
  }
  if (snapshot_out != NULL) {
    snprintf(snapshot_out->route_state, sizeof(snapshot_out->route_state), "%s", route_state);
    snprintf(snapshot_out->last_frame_hash, sizeof(snapshot_out->last_frame_hash), "%s", last_frame_hash);
    snprintf(snapshot_out->semantic_nodes_applied_hash, sizeof(snapshot_out->semantic_nodes_applied_hash), "%s", semantic_nodes_applied_hash);
    snapshot_out->surface_width = surface_width;
    snapshot_out->surface_height = surface_height;
    snapshot_out->semantic_nodes_applied_count = semantic_nodes_applied_count;
  }
  (void)semantic_node_count;
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
      "import gui/browser/r2capp/runtime as legacy",
      "import gui/browser/r2capp/runtime as legacy",
      "# appendSemanticNode(",
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

static void parse_args(int argc,
                       char **argv,
                       int arg_start,
                       const char **project,
                       const char **entry,
                       const char **out_dir,
                       const char **route_state,
                       const char **truth_dir,
                       bool *help,
                       int *err) {
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
    if (strcmp(arg, "--route-state") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *route_state = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--truth-dir") == 0) {
      if (i + 1 >= argc) {
        *err = 2;
        return;
      }
      *truth_dir = argv[i + 1];
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
          "  verify_android_claude_1to1_gate [--project <abs_path>] [--entry </app/main.tsx>] [--out <abs_path>] [--route-state <state>] [--truth-dir <abs_path>]\n"
          "\n"
          "Env (native no-interpreter path):\n"
          "  CHENG_R2C_COMPILE_CMD=<native_bin>\n"
          "  CHENG_ANDROID_FULLROUTE_GATE_CMD=<native_bin>\n"
          "  CHENG_ANDROID_MOBILE_RUNNER=<native_bin>\n"
          "  CHENG_ANDROID_1TO1_ROUTE_STATE=<state>\n"
          "  CHENG_ANDROID_1TO1_TRUTH_DIR=<abs_path>\n"
          "  CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL=0|1 (default 1)\n"
          "  CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT=0|1 (default 0)\n"
          "  CHENG_ANDROID_1TO1_TRUTH_FRAME_MODE=fullscreen|viewport (default fullscreen)\n"
          "  CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR=<abs_path>\n"
          "  CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH=0|1 (default fullscreen->1, viewport->0)\n"
          "  CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH=0|1 (default single-route->1)\n"
          "  CHENG_ANDROID_1TO1_HOME_HARD_GATE=0|1 (default 1; requires route_state=home_default when fullroute disabled)\n"
          "  CHENG_ANDROID_1TO1_TARGET_WIDTH/HEIGHT=<int> (optional runtime surface check)\n"
          "  CHENG_ANDROID_1TO1_ENFORCE_SURFACE_TARGET=0|1 (default 0)\n"
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
  } else {
    fprintf(stderr, "[verify-android-claude-1to1-gate] missing GUI root\n");
    return 2;
  }
  normalize_gui_root_inplace(root);

  const char *project = getenv("R2C_REAL_PROJECT");
  const char *entry = getenv("R2C_REAL_ENTRY");
  const char *out_dir = getenv("R2C_ANDROID_1TO1_OUT");
  const char *route_state = getenv("CHENG_ANDROID_1TO1_ROUTE_STATE");
  const char *truth_dir = getenv("CHENG_ANDROID_1TO1_TRUTH_DIR");
  const char *require_runtime = getenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME");
  const char *enable_fullroute = getenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE");
  const char *home_hard_gate_env = getenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE");
  const char *skip_compile_env = getenv("CHENG_ANDROID_1TO1_SKIP_COMPILE");
  bool skip_compile = (skip_compile_env != NULL && strcmp(skip_compile_env, "1") == 0);
  bool home_hard_gate = true;
  if (home_hard_gate_env != NULL && home_hard_gate_env[0] != '\0') {
    home_hard_gate = (strcmp(home_hard_gate_env, "0") != 0);
  }
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";
  bool runtime_required = true;
  if (require_runtime != NULL && require_runtime[0] != '\0') {
    if (strcmp(require_runtime, "1") == 0) {
      runtime_required = true;
    } else if (strcmp(require_runtime, "0") == 0) {
      runtime_required = false;
    } else {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] invalid CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=%s (expect 0 or 1)\n",
              require_runtime);
      return 2;
    }
  }
  bool fullroute_enabled = false;
  bool fullroute_explicit = false;
  if (enable_fullroute != NULL && enable_fullroute[0] != '\0') {
    fullroute_explicit = true;
    if (strcmp(enable_fullroute, "1") == 0) {
      fullroute_enabled = true;
    } else if (strcmp(enable_fullroute, "0") == 0) {
      fullroute_enabled = false;
    } else {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] invalid CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=%s (expect 0 or 1)\n",
              enable_fullroute);
      return 2;
    }
  }
  char out_dir_default[PATH_MAX];
  if (out_dir == NULL || out_dir[0] == '\0') {
    if (path_join(out_dir_default, sizeof(out_dir_default), root, "build/android_claude_1to1_gate") != 0) return 2;
    out_dir = out_dir_default;
  }

  bool want_help = false;
  int arg_err = 0;
  parse_args(argc, argv, arg_start, &project, &entry, &out_dir, &route_state, &truth_dir, &want_help, &arg_err);
  if (want_help) {
    usage();
    return 0;
  }
  if (arg_err != 0) {
    usage();
    return arg_err;
  }
  if (!fullroute_explicit && route_state != NULL && route_state[0] != '\0') {
    fullroute_enabled = false;
  }
  if (!fullroute_enabled) {
    if (route_state == NULL || route_state[0] == '\0') {
      route_state = "home_default";
    }
    if (home_hard_gate && strcmp(route_state, "home_default") != 0) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] home hard gate requires route_state=home_default (got=%s)\n",
              route_state);
      return 2;
    }
    setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", route_state, 1);
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
      path_join(android_truth_manifest, sizeof(android_truth_manifest), compile_out,
                "r2capp/r2c_truth_trace_manifest_android.json") != 0 ||
      resolve_native_bin_path(root, "mobile_run_android", mobile_runner, sizeof(mobile_runner)) != 0 ||
      resolve_native_bin_path(root, "r2c_compile_react_project", compile_cmd, sizeof(compile_cmd)) != 0 ||
      resolve_native_bin_path(root, "verify_android_fullroute_visual_pixel", fullroute_gate_cmd, sizeof(fullroute_gate_cmd)) != 0) {
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
  if (!skip_compile) {
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

  if (skip_compile) {
    fprintf(stdout, "== android 1:1: reuse strict compile output ==\n");
    fprintf(stdout, "[verify-android-claude-1to1-gate] skip compile: CHENG_ANDROID_1TO1_SKIP_COMPILE=1\n");
  } else {
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
      !parse_bool_key(report_doc, "template_runtime_used", false, "[verify-android-claude-1to1-gate] template_runtime_used != false") ||
      !parse_int_key(report_doc, "compiler_rc", 0, "[verify-android-claude-1to1-gate] compiler_rc != 0") ||
      !parse_int_key(report_doc, "pixel_tolerance", 0, "[verify-android-claude-1to1-gate] pixel_tolerance != 0") ||
      !parse_string_key(report_doc, "generated_ui_mode", "ir-driven", "[verify-android-claude-1to1-gate] generated_ui_mode != ir-driven") ||
      !parse_string_key(report_doc, "compiler_report_origin", "cheng-compiler", "[verify-android-claude-1to1-gate] compiler_report_origin != cheng-compiler") ||
      !parse_string_key(report_doc, "semantic_compile_mode", "react-semantic-ir-node-compile",
                        "[verify-android-claude-1to1-gate] semantic_compile_mode != react-semantic-ir-node-compile") ||
      !parse_string_key(report_doc, "utfzh_mode", "strict", "[verify-android-claude-1to1-gate] utfzh_mode != strict") ||
      !parse_string_key(report_doc, "ime_mode", "cangwu-global", "[verify-android-claude-1to1-gate] ime_mode != cangwu-global") ||
      !parse_string_key(report_doc, "cjk_render_backend", "native-text-first",
                        "[verify-android-claude-1to1-gate] cjk_render_backend != native-text-first") ||
      !parse_string_key(report_doc, "cjk_render_gate", "no-garbled-cjk",
                        "[verify-android-claude-1to1-gate] cjk_render_gate != no-garbled-cjk") ||
      !parse_string_key(report_doc, "semantic_mapping_mode", "source-node-map",
                        "[verify-android-claude-1to1-gate] semantic_mapping_mode != source-node-map")) {
    free(report_doc);
    return 1;
  }
  char report_truth_manifest[PATH_MAX];
  bool truth_manifest_ok =
      json_get_string(report_doc, "android_truth_manifest_path", report_truth_manifest, sizeof(report_truth_manifest)) &&
      file_exists(report_truth_manifest);
  if (!truth_manifest_ok) {
    truth_manifest_ok = json_get_string(report_doc,
                                        "truth_trace_manifest_android_path",
                                        report_truth_manifest,
                                        sizeof(report_truth_manifest)) &&
                        file_exists(report_truth_manifest);
  }
  if (truth_manifest_ok) {
    snprintf(android_truth_manifest, sizeof(android_truth_manifest), "%s", report_truth_manifest);
  } else if (!file_exists(android_truth_manifest)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] missing android truth manifest in report/output\n");
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

  const char *path_keys[] = {
      "android_route_graph_path",
      "android_route_event_matrix_path",
      "android_route_coverage_path",
      "route_tree_path",
      "route_layers_path",
      "route_actions_android_path",
      "semantic_graph_path",
      "component_graph_path",
      "style_graph_path",
      "event_graph_path",
      "runtime_trace_path",
  };
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

  int fullroute_routes_ok = fullroute_enabled ? full_route_count : 0;
  int target_surface_w = env_positive_int_or_default("CHENG_ANDROID_1TO1_TARGET_WIDTH", 0);
  int target_surface_h = env_positive_int_or_default("CHENG_ANDROID_1TO1_TARGET_HEIGHT", 0);
  char expected_runtime_frame_hash[64];
  expected_runtime_frame_hash[0] = '\0';
  RuntimeStateSnapshot runtime_snapshot;
  memset(&runtime_snapshot, 0, sizeof(runtime_snapshot));
  const char *freeze_truth_dir = getenv("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR");
  bool capture_runtime_visual = true;
  const char *capture_runtime_visual_env = getenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL");
  if (capture_runtime_visual_env != NULL && strcmp(capture_runtime_visual_env, "0") == 0) {
    capture_runtime_visual = false;
  }
  bool capture_runtime_visual_strict = (freeze_truth_dir != NULL && freeze_truth_dir[0] != '\0');
  const char *capture_runtime_visual_strict_env = getenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT");
  if (capture_runtime_visual_strict_env != NULL && strcmp(capture_runtime_visual_strict_env, "1") == 0) {
    capture_runtime_visual_strict = true;
  }
  if (route_state != NULL && route_state[0] != '\0' && !strlist_contains(&states, route_state)) {
    fprintf(stderr,
            "[verify-android-claude-1to1-gate] route-state not found in full-route states: %s\n",
            route_state);
    strlist_free(&states);
    free(report_doc);
    return 2;
  }
  char assets_dir[PATH_MAX];
  if (path_join(assets_dir, sizeof(assets_dir), compile_out, "r2capp") != 0) {
    strlist_free(&states);
    free(report_doc);
    return 1;
  }
  char auto_truth_dir[PATH_MAX];
  auto_truth_dir[0] = '\0';
  if (!fullroute_enabled &&
      route_state != NULL && route_state[0] != '\0' &&
      (truth_dir == NULL || truth_dir[0] == '\0')) {
    if (path_join(auto_truth_dir, sizeof(auto_truth_dir), compile_out, "r2capp/truth") != 0) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (!dir_exists(auto_truth_dir)) {
      fprintf(stderr,
              "[verify-android-claude-1to1-gate] home hard gate missing truth dir: %s\n",
              auto_truth_dir);
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    truth_dir = auto_truth_dir;
    setenv("CHENG_ANDROID_1TO1_TRUTH_DIR", truth_dir, 1);
    fprintf(stdout, "[verify-android-claude-1to1-gate] auto truth-dir=%s\n", truth_dir);
  }
  if (!fullroute_enabled) {
    const char *enforce_expected_env = getenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
    if (enforce_expected_env == NULL || enforce_expected_env[0] == '\0') {
      setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", "1", 1);
    }
    if (home_hard_gate &&
        route_state != NULL &&
        strcmp(route_state, "home_default") == 0) {
      const char *copy_all_env = getenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
      if (copy_all_env == NULL || copy_all_env[0] == '\0') {
        /* Home gate keeps bottom-tab interactions alive: include sibling tab truths in packaged assets. */
        setenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL", "1", 1);
      }
    }
  }
  if (truth_dir != NULL && truth_dir[0] != '\0' && route_state != NULL && route_state[0] != '\0') {
    if (!prepare_route_truth_assets(truth_dir,
                                    route_state,
                                    assets_dir,
                                    expected_runtime_frame_hash,
                                    sizeof(expected_runtime_frame_hash),
                                    &target_surface_w,
                                    &target_surface_h)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
  }
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
    const char *wait_env = getenv("CHENG_ANDROID_1TO1_RUNTIME_WAIT_MS");
    int runtime_wait_ms = 12000;
    if (wait_env != NULL && wait_env[0] != '\0') runtime_wait_ms = atoi(wait_env);
    if (runtime_wait_ms < 1000) runtime_wait_ms = 1000;

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
    char app_arg_route_state[256];
    app_arg_route_state[0] = '\0';
    const char *route_state_arg = NULL;
    if (route_state != NULL && route_state[0] != '\0') {
      snprintf(app_arg_route_state, sizeof(app_arg_route_state), "--app-arg:route_state=%s", route_state);
      route_state_arg = app_arg_route_state;
    }
    char frame_dump_name[192];
    frame_dump_name[0] = '\0';
    const char *frame_dump_route = (route_state != NULL && route_state[0] != '\0') ? route_state : "route";
    if (snprintf(frame_dump_name, sizeof(frame_dump_name), "%s.runtime_frame.raw", frame_dump_route) >=
        (int)sizeof(frame_dump_name)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char app_arg_frame_dump[256];
    if (snprintf(app_arg_frame_dump,
                 sizeof(app_arg_frame_dump),
                 "--app-arg:frame_dump_file=%s",
                 frame_dump_name) >= (int)sizeof(app_arg_frame_dump)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    char runtime_wait_arg[64];
    snprintf(runtime_wait_arg, sizeof(runtime_wait_arg), "--runtime-state-wait-ms:%d", runtime_wait_ms);
    char out_arg[PATH_MAX + 16];
    snprintf(out_arg, sizeof(out_arg), "--out:%s", mobile_export_out);
    char assets_arg[PATH_MAX + 16];
    snprintf(assets_arg, sizeof(assets_arg), "--assets:%s", assets_dir);
    char app_arg_expected_hash[128];
    app_arg_expected_hash[0] = '\0';
    const char *expected_hash_arg = NULL;
    if (expected_runtime_frame_hash[0] != '\0') {
      snprintf(app_arg_expected_hash,
               sizeof(app_arg_expected_hash),
               "--app-arg:expected_framehash=%s",
               expected_runtime_frame_hash);
      expected_hash_arg = app_arg_expected_hash;
    }
    bool enable_direct_launch_smoke = false;
    const char *direct_launch_smoke_env = getenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_SMOKE");
    if (direct_launch_smoke_env == NULL || strcmp(direct_launch_smoke_env, "0") != 0) {
      if (route_state != NULL && strcmp(route_state, "home_default") == 0) {
        enable_direct_launch_smoke = true;
      }
    }
    const char *direct_launch_smoke_route = getenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE");
    if (direct_launch_smoke_route == NULL || direct_launch_smoke_route[0] == '\0') {
      direct_launch_smoke_route = "home_default";
    }
    char direct_launch_smoke_arg[256];
    direct_launch_smoke_arg[0] = '\0';
    if (enable_direct_launch_smoke) {
      snprintf(direct_launch_smoke_arg,
               sizeof(direct_launch_smoke_arg),
               "--direct-launch-smoke:%s",
               direct_launch_smoke_route);
    }
    char *runtime_argv[31];
    int runtime_argc = 0;
    runtime_argv[runtime_argc++] = mobile_runner;
    runtime_argv[runtime_argc++] = runner_entry;
    runtime_argv[runtime_argc++] = "--name:claude_android_1to1";
    runtime_argv[runtime_argc++] = out_arg;
    runtime_argv[runtime_argc++] = assets_arg;
    runtime_argv[runtime_argc++] = native_obj_arg;
    runtime_argv[runtime_argc++] = app_arg_manifest;
    runtime_argv[runtime_argc++] = app_arg_sem_nodes;
    runtime_argv[runtime_argc++] = app_arg_frame_dump;
    if (expected_hash_arg != NULL) runtime_argv[runtime_argc++] = (char *)expected_hash_arg;
    if (route_state_arg != NULL) runtime_argv[runtime_argc++] = (char *)route_state_arg;
    runtime_argv[runtime_argc++] = "--app-arg:gate_mode=android-semantic-visual-1to1";
    runtime_argv[runtime_argc++] = "--app-arg:truth_mode=strict";
    runtime_argv[runtime_argc++] = "--app-arg:arg_probe=foo_bar";
    runtime_argv[runtime_argc++] = app_args_json_arg;
    runtime_argv[runtime_argc++] = runtime_state_arg;
    runtime_argv[runtime_argc++] = runtime_wait_arg;
    if (enable_direct_launch_smoke) runtime_argv[runtime_argc++] = direct_launch_smoke_arg;
    runtime_argv[runtime_argc] = NULL;

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
    if (!parse_runtime_state(runtime_json,
                             semantic_node_count,
                             route_state,
                             expected_runtime_frame_hash[0] != '\0' ? expected_runtime_frame_hash : NULL,
                             target_surface_w,
                             target_surface_h,
                             &runtime_snapshot)) {
      strlist_free(&states);
      free(report_doc);
      return 1;
    }
    if (capture_runtime_visual && runtime_snapshot.route_state[0] != '\0') {
      if (!capture_runtime_route_visual(out_dir, &runtime_snapshot, frame_dump_name, capture_runtime_visual_strict)) {
        strlist_free(&states);
        free(report_doc);
        return 1;
      }
    }

    if (fullroute_enabled) {
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
      if (fullroute_explicit && enable_fullroute != NULL && strcmp(enable_fullroute, "0") == 0) {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] runtime fullroute skipped: CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=0\n");
      } else if (!fullroute_explicit && route_state != NULL && route_state[0] != '\0') {
        fprintf(stdout,
                "[verify-android-claude-1to1-gate] runtime fullroute skipped: single-route mode (set CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=1 to enable)\n");
      } else {
        fprintf(stdout, "[verify-android-claude-1to1-gate] runtime fullroute skipped\n");
      }
    }
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

  char runtime_capture_png[PATH_MAX];
  char runtime_capture_rgba[PATH_MAX];
  char runtime_capture_meta[PATH_MAX];
  char runtime_capture_runtime_hash[PATH_MAX];
  char runtime_capture_framehash[PATH_MAX];
  runtime_capture_png[0] = '\0';
  runtime_capture_rgba[0] = '\0';
  runtime_capture_meta[0] = '\0';
  runtime_capture_runtime_hash[0] = '\0';
  runtime_capture_framehash[0] = '\0';
  if (runtime_snapshot.route_state[0] != '\0') {
    (void)snprintf(runtime_capture_png,
                   sizeof(runtime_capture_png),
                   "");
    (void)snprintf(runtime_capture_rgba,
                   sizeof(runtime_capture_rgba),
                   "%s/%s.rgba",
                   out_dir,
                   runtime_snapshot.route_state);
    (void)snprintf(runtime_capture_meta,
                   sizeof(runtime_capture_meta),
                   "%s/%s.meta.json",
                   out_dir,
                   runtime_snapshot.route_state);
    (void)snprintf(runtime_capture_runtime_hash,
                   sizeof(runtime_capture_runtime_hash),
                   "%s/%s.runtime_framehash",
                   out_dir,
                   runtime_snapshot.route_state);
    (void)snprintf(runtime_capture_framehash,
                   sizeof(runtime_capture_framehash),
                   "%s/%s.framehash",
                   out_dir,
                   runtime_snapshot.route_state);
  }

  char marker_json[8192];
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
                   "  \"runtime_required\": %s,\n"
                   "  \"runtime_state_path\": \"%s\",\n"
                   "  \"runtime_route_state\": \"%s\",\n"
                   "  \"runtime_last_frame_hash\": \"%s\",\n"
                   "  \"runtime_semantic_nodes_applied_hash\": \"%s\",\n"
                   "  \"runtime_surface_width\": %lld,\n"
                   "  \"runtime_surface_height\": %lld,\n"
                   "  \"runtime_capture_png_path\": \"%s\",\n"
                   "  \"runtime_capture_rgba_path\": \"%s\",\n"
                   "  \"runtime_capture_meta_path\": \"%s\",\n"
                   "  \"runtime_capture_runtime_framehash_path\": \"%s\",\n"
                   "  \"runtime_capture_framehash_path\": \"%s\",\n"
                   "  \"expected_frame_hash\": \"%s\",\n"
                   "  \"freeze_truth_dir\": \"%s\",\n"
                   "  \"run_log_path\": \"%s\",\n"
                   "  \"visual_fullroute_log_path\": \"%s\",\n"
                   "  \"visual_fullroute_report_path\": \"%s\",\n"
                   "  \"visual_passed\": true,\n"
                   "  \"visual_routes_verified\": %d\n"
                   "}\n",
                   git_head,
                   project,
                   entry,
                   full_route_count,
                   semantic_node_count,
                   android_truth_manifest,
                   runtime_required ? "true" : "false",
                   runtime_json,
                   runtime_snapshot.route_state,
                   runtime_snapshot.last_frame_hash,
                   runtime_snapshot.semantic_nodes_applied_hash,
                   runtime_snapshot.surface_width,
                   runtime_snapshot.surface_height,
                   runtime_capture_png,
                   runtime_capture_rgba,
                   runtime_capture_meta,
                   runtime_capture_runtime_hash,
                   runtime_capture_framehash,
                   expected_runtime_frame_hash,
                   freeze_truth_dir != NULL ? freeze_truth_dir : "",
                   run_log,
                   fullroute_log,
                   fullroute_report,
                   fullroute_routes_ok);
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
