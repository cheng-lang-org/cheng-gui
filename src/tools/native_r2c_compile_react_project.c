#define _POSIX_C_SOURCE 200809L

#include "native_r2c_compile_react_project.h"
#include "native_r2c_report_validate.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <signal.h>
#include <sys/select.h>
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
} PathList;

static bool resolve_report_path(const char *report_path, const char *raw, char *out, size_t out_cap);
static int run_capture(char *const argv[], char **out, int timeout_sec);
static RunResult run_command(char *const argv[], const char *workdir, const char *log_path, int timeout_sec);

static void path_list_free(PathList *list) {
  if (list == NULL) return;
  for (size_t i = 0; i < list->len; ++i) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static bool path_list_contains(const PathList *list, const char *value) {
  if (list == NULL || value == NULL || value[0] == '\0') return false;
  for (size_t i = 0; i < list->len; ++i) {
    if (strcmp(list->items[i], value) == 0) return true;
  }
  return false;
}

static int path_list_push(PathList *list, const char *value) {
  if (list == NULL || value == NULL || value[0] == '\0') return -1;
  if (path_list_contains(list, value)) return 0;
  if (list->len >= list->cap) {
    size_t next = (list->cap == 0u) ? 8u : list->cap * 2u;
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

static int ensure_dir(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  char buf[PATH_MAX];
  size_t n = strlen(path);
  if (n >= sizeof(buf)) return -1;
  memcpy(buf, path, n + 1u);
  for (size_t i = 1; i < n; ++i) {
    if (buf[i] != '/') continue;
    buf[i] = '\0';
    if (buf[0] != '\0' && !dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
    buf[i] = '/';
  }
  if (!dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
  return 0;
}

static int remove_tree(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  DIR *dir = opendir(path);
  if (dir == NULL) {
    if (errno == ENOENT) return 0;
    struct stat st;
    if (stat(path, &st) != 0 && errno == ENOENT) return 0;
    return -1;
  }

  struct dirent *ent = NULL;
  while ((ent = readdir(dir)) != NULL) {
    const char *name = ent->d_name;
    if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) continue;
    char child[PATH_MAX];
    if (path_join(child, sizeof(child), path, name) != 0) {
      closedir(dir);
      return -1;
    }
    struct stat st;
    if (lstat(child, &st) != 0) continue;
    if (S_ISDIR(st.st_mode)) {
      if (remove_tree(child) != 0) {
        closedir(dir);
        return -1;
      }
      continue;
    }
    if (unlink(child) != 0 && errno != ENOENT) {
      closedir(dir);
      return -1;
    }
  }
  closedir(dir);
  if (rmdir(path) != 0 && errno != ENOENT) return -1;
  return 0;
}

static int append_executable_candidate(PathList *candidates, const char *path) {
  if (path == NULL || path[0] == '\0') return 0;
  if (!path_executable(path)) return 0;
  return path_list_push(candidates, path);
}

static int discover_compiler_candidates(const char *root, bool strict, PathList *candidates) {
  if (root == NULL || candidates == NULL) return -1;

  const char *env_compiler = getenv("CHENG_R2C_NATIVE_COMPILER_BIN");
  if (env_compiler != NULL && env_compiler[0] != '\0') {
    if (append_executable_candidate(candidates, env_compiler) != 0) return -1;
    return candidates->len > 0u ? 0 : -1;
  }

  if (strict) {
    const char *track_env = getenv("CHENG_R2C_BUILD_TRACK");
    const bool prefer_release = (track_env != NULL && strcmp(track_env, "release") == 0);
    const char *strict_candidates_preferred[] = {
        "build/r2c_compiler_tracks/dev/r2c_compile_macos",
        "build/r2c_compiler_tracks/release/r2c_compile_macos",
    };
    const char *strict_candidates_release_first[] = {
        "build/r2c_compiler_tracks/release/r2c_compile_macos",
        "build/r2c_compiler_tracks/dev/r2c_compile_macos",
    };
    const char **ordered = prefer_release ? strict_candidates_release_first : strict_candidates_preferred;
    size_t ordered_len = 2u;
    for (size_t i = 0u; i < ordered_len; ++i) {
      char path[PATH_MAX];
      if (path_join(path, sizeof(path), root, ordered[i]) != 0) return -1;
      if (append_executable_candidate(candidates, path) != 0) return -1;
    }
    if (candidates->len > 0u) {
      return 0;
    }
    fprintf(stderr,
            "[r2c-compile] strict mode requires CHENG_R2C_NATIVE_COMPILER_BIN or build/r2c_compiler_tracks/{dev|release}/r2c_compile_macos\n");
    return -1;
  }

  const char *fixed_candidates[] = {
      "build/semantic_real_compile/r2c_compile_macos",
      "build/_tmp_true_semantic_compile/r2c_compile_macos",
      "build/_tmp_strict_compile/r2c_compile_macos",
      "build/r2c_semantic_strict_manual/r2c_compile_macos",
  };
  for (size_t i = 0u; i < sizeof(fixed_candidates) / sizeof(fixed_candidates[0]); ++i) {
    char path[PATH_MAX];
    if (path_join(path, sizeof(path), root, fixed_candidates[i]) != 0) continue;
    if (append_executable_candidate(candidates, path) != 0) return -1;
  }

  return 0;
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

static bool env_flag_on(const char *name) {
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return false;
  return (strcmp(v, "1") == 0 || strcmp(v, "true") == 0 || strcmp(v, "TRUE") == 0 ||
          strcmp(v, "yes") == 0 || strcmp(v, "YES") == 0);
}

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

static bool allow_legacy_gui_prefix_for_project(const char *project_root, const char *repo_root) {
  if (env_flag_on("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX")) return true;
  if (project_root == NULL || project_root[0] == '\0' || repo_root == NULL || repo_root[0] == '\0') return false;
  return !path_is_under_root(project_root, repo_root);
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
  if (path == NULL || data == NULL) return -1;
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

static bool compiler_binary_appears_broken(const char *compiler_bin, char *reason, size_t reason_cap) {
  if (reason != NULL && reason_cap > 0u) reason[0] = '\0';
  if (compiler_bin == NULL || compiler_bin[0] == '\0') {
    if (reason != NULL) snprintf(reason, reason_cap, "empty compiler path");
    return true;
  }
  if (!path_executable(compiler_bin)) {
    if (reason != NULL) snprintf(reason, reason_cap, "compiler not executable");
    return true;
  }
  if (getenv("CHENG_R2C_IN_ROOT") != NULL || getenv("CHENG_R2C_OUT_ROOT") != NULL) {
    return false;
  }

  char *argv[] = {(char *)compiler_bin, NULL};
  char *captured = NULL;
  int rc = run_capture(argv, &captured, 8);
  bool broken = false;
  if (rc == 127) broken = true;
  if (rc == 124) broken = true;
  if (captured != NULL) {
    if (strstr(captured, "dyld[") != NULL && strstr(captured, "Symbol not found") != NULL) broken = true;
    if (strstr(captured, "missing LC_SYMTAB") != NULL) broken = true;
    if (strstr(captured, "Undefined symbols for architecture") != NULL) broken = true;
  }

  if (broken && reason != NULL && reason_cap > 0u) {
    if (captured != NULL && captured[0] != '\0') {
      const char *line_end = strchr(captured, '\n');
      size_t n = line_end == NULL ? strlen(captured) : (size_t)(line_end - captured);
      if (n >= reason_cap) n = reason_cap - 1u;
      memcpy(reason, captured, n);
      reason[n] = '\0';
    } else if (rc == 124) {
      snprintf(reason, reason_cap, "compiler self-check timed out");
    } else {
      snprintf(reason, reason_cap, "compiler binary cannot start");
    }
  }
  free(captured);
  return broken;
}

static bool configure_backend_track_env(bool strict) {
  (void)strict;
  const char *canonical_driver = "/Users/lbcheng/cheng-lang/artifacts/backend_driver/cheng";
  if (!path_executable(canonical_driver)) {
    fprintf(stderr,
            "[r2c-compile] canonical BACKEND_DRIVER missing or not executable: %s\n",
            canonical_driver);
    return false;
  }

  const char *track_env = getenv("CHENG_R2C_BUILD_TRACK");
  const char *track = (track_env != NULL && track_env[0] != '\0') ? track_env : "dev";
  if (strcmp(track, "dev") != 0 && strcmp(track, "release") != 0) {
    fprintf(stderr, "[r2c-compile] invalid CHENG_R2C_BUILD_TRACK=%s (expected dev|release)\n", track);
    return false;
  }

  setenv("BACKEND_DRIVER", canonical_driver, 1);
  setenv("R2C_ALLOW_TEMPLATE_FALLBACK", "0", 1);
  setenv("R2C_STRICT_ALLOW_SEMANTIC_SHELL_GENERATOR", "0", 1);

  if (strcmp(track, "dev") == 0) {
    setenv("BACKEND_BUILD_TRACK", "dev", 1);
    setenv("BACKEND_LINKER", "self", 1);
    setenv("BACKEND_DIRECT_EXE", "1", 1);
    setenv("BACKEND_HOTPATCH_MODE", "trampoline", 1);
    setenv("BACKEND_INCREMENTAL", "1", 1);
    setenv("BACKEND_MULTI", "1", 1);
    setenv("BACKEND_MULTI_FORCE", "1", 1);
    setenv("BACKEND_WHOLE_PROGRAM", "1", 1);
  } else {
    setenv("BACKEND_BUILD_TRACK", "release", 1);
    setenv("BACKEND_LINKER", "system", 1);
    setenv("BACKEND_DIRECT_EXE", "0", 1);
    setenv("BACKEND_NO_RUNTIME_C", "0", 1);
    setenv("BACKEND_INCREMENTAL", "0", 1);
    setenv("BACKEND_MULTI", "1", 1);
    setenv("BACKEND_MULTI_FORCE", "1", 1);
    setenv("BACKEND_WHOLE_PROGRAM", "1", 1);
  }

  fprintf(stderr,
          "[r2c-compile] build-track=%s backend-driver=%s\n",
          getenv("BACKEND_BUILD_TRACK") ? getenv("BACKEND_BUILD_TRACK") : "",
          getenv("BACKEND_DRIVER") ? getenv("BACKEND_DRIVER") : "");
  return true;
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
      p += 1;
      continue;
    }
    q += 1;
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
    idx += 1u;
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
  if (strncmp(p, "true", 4u) == 0) {
    if (out != NULL) *out = true;
    return true;
  }
  if (strncmp(p, "false", 5u) == 0) {
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

static int run_capture(char *const argv[], char **out, int timeout_sec) {
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
    execvp(argv[0], argv);
    _exit(127);
  }
  close(pipefd[1]);
  setpgid(pid, pid);
  int flags = fcntl(pipefd[0], F_GETFL, 0);
  if (flags >= 0) (void)fcntl(pipefd[0], F_SETFL, flags | O_NONBLOCK);

  size_t cap = 4096u;
  size_t len = 0u;
  char *buf = (char *)malloc(cap);
  if (buf == NULL) {
    close(pipefd[0]);
    kill(-pid, SIGKILL);
    for (int spin = 0; spin < 40; ++spin) {
      pid_t done = waitpid(pid, NULL, WNOHANG);
      if (done == pid || done < 0) break;
      usleep(50000);
    }
    return -1;
  }

  time_t deadline = (timeout_sec > 0) ? (time(NULL) + timeout_sec) : 0;
  int status = 0;
  bool child_done = false;
  bool pipe_open = true;
  while (!child_done || pipe_open) {
    if (!child_done) {
      pid_t wr = waitpid(pid, &status, WNOHANG);
      if (wr == pid) {
        child_done = true;
      } else if (wr < 0 && errno != EINTR) {
        child_done = true;
        status = 1;
      }
    }

    if (timeout_sec > 0 && !child_done && time(NULL) >= deadline) {
      kill(-pid, SIGTERM);
      usleep(200000);
      kill(-pid, SIGKILL);
      for (int spin = 0; spin < 40; ++spin) {
        pid_t done = waitpid(pid, &status, WNOHANG);
        if (done == pid || done < 0) {
          child_done = true;
          break;
        }
        usleep(50000);
      }
      if (pipe_open) close(pipefd[0]);
      free(buf);
      return 124;
    }

    if (!pipe_open) {
      usleep(50000);
      continue;
    }

    fd_set rfds;
    FD_ZERO(&rfds);
    FD_SET(pipefd[0], &rfds);
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 200000;
    int sr = select(pipefd[0] + 1, &rfds, NULL, NULL, &tv);
    if (sr < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (sr == 0 || !FD_ISSET(pipefd[0], &rfds)) continue;

    while (1) {
      char tmp[1024];
      ssize_t rd = read(pipefd[0], tmp, sizeof(tmp));
      if (rd > 0) {
        if (len + (size_t)rd + 1u > cap) {
          size_t next = cap * 2u;
          while (len + (size_t)rd + 1u > next) next *= 2u;
          char *resized = (char *)realloc(buf, next);
          if (resized == NULL) {
            free(buf);
            close(pipefd[0]);
            kill(-pid, SIGKILL);
            for (int spin = 0; spin < 40; ++spin) {
              pid_t done = waitpid(pid, NULL, WNOHANG);
              if (done == pid || done < 0) break;
              usleep(50000);
            }
            return -1;
          }
          buf = resized;
          cap = next;
        }
        memcpy(buf + len, tmp, (size_t)rd);
        len += (size_t)rd;
        continue;
      }
      if (rd == 0) {
        pipe_open = false;
        close(pipefd[0]);
        break;
      }
      if (errno == EINTR) continue;
      if (errno == EAGAIN || errno == EWOULDBLOCK) break;
      pipe_open = false;
      close(pipefd[0]);
      break;
    }
  }
  if (pipe_open) close(pipefd[0]);
  buf[len] = '\0';
  if (out != NULL) *out = buf;
  else free(buf);
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static bool extract_hex_token(const char *text, int expected_len, char *out, size_t out_cap) {
  if (text == NULL || out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  if (expected_len <= 0 || (size_t)expected_len + 1u > out_cap) return false;
  const char *p = text;
  while (*p != '\0') {
    while (*p != '\0' && isspace((unsigned char)*p)) ++p;
    int n = 0;
    const char *start = p;
    while (p[n] != '\0' && isxdigit((unsigned char)p[n])) ++n;
    if (n == expected_len) {
      memcpy(out, start, (size_t)n);
      out[n] = '\0';
      for (int i = 0; i < n; ++i) out[i] = (char)tolower((unsigned char)out[i]);
      return true;
    }
    while (*p != '\0' && !isspace((unsigned char)*p)) ++p;
  }
  return false;
}

static bool compute_sha256_hex(const char *path, char *out_hex, size_t out_cap) {
  if (path == NULL || out_hex == NULL || out_cap < 65u) return false;
  out_hex[0] = '\0';
  char tool[PATH_MAX];
  bool use_shasum = false;
  if (find_executable_in_path("shasum", tool, sizeof(tool))) {
    use_shasum = true;
  } else if (!find_executable_in_path("sha256sum", tool, sizeof(tool))) {
    return false;
  }
  char *cmd_argv_shasum[] = {tool, "-a", "256", (char *)path, NULL};
  char *cmd_argv_sha256sum[] = {tool, (char *)path, NULL};
  char *out = NULL;
  int rc = run_capture(use_shasum ? cmd_argv_shasum : cmd_argv_sha256sum, &out, 20);
  if (rc != 0 || out == NULL) {
    free(out);
    return false;
  }
  bool ok = extract_hex_token(out, 64, out_hex, out_cap);
  free(out);
  return ok;
}

static bool compute_fnv64_hex(const unsigned char *data, size_t n, char *out_hex, size_t out_cap) {
  if (data == NULL || out_hex == NULL || out_cap < 17u) return false;
  uint64_t fnv = 1469598103934665603ULL;
  for (size_t i = 0u; i < n; ++i) {
    fnv ^= (uint64_t)data[i];
    fnv *= 1099511628211ULL;
  }
  snprintf(out_hex, out_cap, "%016llx", (unsigned long long)fnv);
  return true;
}

static bool json_replace_string_field(char **doc_io, const char *key, const char *value) {
  if (doc_io == NULL || *doc_io == NULL || key == NULL || value == NULL) return false;
  char *doc = *doc_io;
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '"') return false;
  const char *end = NULL;
  if (!json_parse_string_at(p, NULL, 0u, &end) || end == NULL || end <= p) return false;
  size_t old_len = strlen(doc);
  size_t prefix_len = (size_t)(p - doc);
  size_t old_segment_len = (size_t)(end - p);
  size_t replacement_len = strlen(value) + 2u;
  if (prefix_len > old_len || old_segment_len > old_len || prefix_len + old_segment_len > old_len) return false;
  size_t suffix_len = old_len - (prefix_len + old_segment_len);
  size_t new_len = prefix_len + replacement_len + suffix_len;
  char *next = (char *)malloc(new_len + 1u);
  if (next == NULL) return false;
  memcpy(next, doc, prefix_len);
  size_t w = prefix_len;
  next[w++] = '"';
  memcpy(next + w, value, strlen(value));
  w += strlen(value);
  next[w++] = '"';
  memcpy(next + w, end, suffix_len);
  w += suffix_len;
  next[w] = '\0';
  free(doc);
  *doc_io = next;
  return true;
}

static bool backfill_semantic_render_meta(const char *report_path) {
  if (report_path == NULL || report_path[0] == '\0') return false;
  size_t report_n = 0u;
  char *doc = read_file_all(report_path, &report_n);
  if (doc == NULL || report_n == 0u) {
    free(doc);
    return false;
  }
  char render_raw[PATH_MAX];
  if (!json_get_string(doc, "semantic_render_nodes_path", render_raw, sizeof(render_raw))) {
    free(doc);
    return false;
  }
  char render_path[PATH_MAX];
  if (!resolve_report_path(report_path, render_raw, render_path, sizeof(render_path)) || !file_exists(render_path)) {
    free(doc);
    return false;
  }
  size_t payload_n = 0u;
  char *payload = read_file_all(render_path, &payload_n);
  if (payload == NULL || payload_n == 0u) {
    free(payload);
    free(doc);
    return false;
  }
  char sha256_hex[65];
  char fnv64_hex[17];
  bool ok = compute_sha256_hex(render_path, sha256_hex, sizeof(sha256_hex)) &&
            compute_fnv64_hex((const unsigned char *)payload, payload_n, fnv64_hex, sizeof(fnv64_hex));
  free(payload);
  if (!ok) {
    free(doc);
    return false;
  }
  if (!json_replace_string_field(&doc, "semantic_render_nodes_hash", sha256_hex) ||
      !json_replace_string_field(&doc, "semantic_render_nodes_fnv64", fnv64_hex)) {
    free(doc);
    return false;
  }
  bool wr_ok = (write_file_all(report_path, doc, strlen(doc)) == 0);
  free(doc);
  return wr_ok;
}

static bool buf_appendf(char *buf, size_t cap, size_t *len, const char *fmt, ...) {
  if (buf == NULL || cap == 0u || len == NULL || fmt == NULL) return false;
  if (*len >= cap) return false;
  va_list ap;
  va_start(ap, fmt);
  int wrote = vsnprintf(buf + *len, cap - *len, fmt, ap);
  va_end(ap);
  if (wrote < 0) return false;
  if ((size_t)wrote >= cap - *len) return false;
  *len += (size_t)wrote;
  return true;
}

static void cheng_escape(const char *in, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (in == NULL) return;
  size_t o = 0u;
  for (size_t i = 0u; in[i] != '\0'; ++i) {
    const char ch = in[i];
    const char *rep = NULL;
    switch (ch) {
      case '\\': rep = "\\\\"; break;
      case '"': rep = "\\\""; break;
      case '\n': rep = "\\n"; break;
      case '\r': rep = "\\r"; break;
      case '\t': rep = "\\t"; break;
      default: rep = NULL; break;
    }
    if (rep != NULL) {
      const size_t rn = strlen(rep);
      if (o + rn + 1u >= out_cap) break;
      memcpy(out + o, rep, rn);
      o += rn;
      continue;
    }
    if (o + 2u >= out_cap) break;
    out[o++] = ch;
  }
  out[o] = '\0';
}

static bool string_contains_icase(const char *haystack, const char *needle) {
  if (haystack == NULL || needle == NULL) return false;
  size_t n = strlen(needle);
  if (n == 0u) return true;
  size_t h = strlen(haystack);
  if (h < n) return false;
  for (size_t i = 0u; i + n <= h; ++i) {
    bool ok = true;
    for (size_t j = 0u; j < n; ++j) {
      unsigned char a = (unsigned char)haystack[i + j];
      unsigned char b = (unsigned char)needle[j];
      if ((unsigned char)tolower(a) != (unsigned char)tolower(b)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

static void infer_route_hint(const char *module_id, const char *value, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  char source[4096];
  const char *mid = (module_id == NULL) ? "" : module_id;
  const char *val = (value == NULL) ? "" : value;
  snprintf(source, sizeof(source), "%s|%s", mid, val);
  if (string_contains_icase(source, "language")) {
    snprintf(out, out_cap, "%s", "lang_select");
    return;
  }
  if (string_contains_icase(source, "publish")) {
    if (string_contains_icase(source, "crowdfunding")) snprintf(out, out_cap, "%s", "publish_crowdfunding");
    else if (string_contains_icase(source, "secondhand")) snprintf(out, out_cap, "%s", "publish_secondhand");
    else if (string_contains_icase(source, "product")) snprintf(out, out_cap, "%s", "publish_product");
    else if (string_contains_icase(source, "content")) snprintf(out, out_cap, "%s", "publish_content");
    else if (string_contains_icase(source, "food")) snprintf(out, out_cap, "%s", "publish_food");
    else if (string_contains_icase(source, "ride")) snprintf(out, out_cap, "%s", "publish_ride");
    else if (string_contains_icase(source, "rent")) snprintf(out, out_cap, "%s", "publish_rent");
    else if (string_contains_icase(source, "sell")) snprintf(out, out_cap, "%s", "publish_sell");
    else if (string_contains_icase(source, "hire")) snprintf(out, out_cap, "%s", "publish_hire");
    else if (string_contains_icase(source, "job")) snprintf(out, out_cap, "%s", "publish_job");
    else if (string_contains_icase(source, "live")) snprintf(out, out_cap, "%s", "publish_live");
    else if (string_contains_icase(source, "app")) snprintf(out, out_cap, "%s", "publish_app");
    else snprintf(out, out_cap, "%s", "publish_selector");
    return;
  }
  if (string_contains_icase(source, "trading") || string_contains_icase(source, "kline") ||
      string_contains_icase(source, "chart")) {
    snprintf(out, out_cap, "%s", "trading_main");
    return;
  }
  if (string_contains_icase(source, "marketplace")) {
    snprintf(out, out_cap, "%s", "marketplace_main");
    return;
  }
  if (string_contains_icase(source, "update")) {
    snprintf(out, out_cap, "%s", "update_center_main");
    return;
  }
  if (string_contains_icase(source, "ecom")) {
    snprintf(out, out_cap, "%s", "ecom_main");
    return;
  }
  if (string_contains_icase(source, "message") || string_contains_icase(source, "chat")) {
    snprintf(out, out_cap, "%s", "tab_messages");
    return;
  }
  if (string_contains_icase(source, "node")) {
    snprintf(out, out_cap, "%s", "tab_nodes");
    return;
  }
  if (string_contains_icase(source, "profile") || string_contains_icase(source, "wallet")) {
    snprintf(out, out_cap, "%s", "tab_profile");
    return;
  }
  if (string_contains_icase(source, "home")) {
    snprintf(out, out_cap, "%s", "home_default");
    return;
  }
}

static bool parse_semantic_row(const char *row,
                               char *module_id,
                               size_t module_cap,
                               char *kind,
                               size_t kind_cap,
                               char *value,
                               size_t value_cap) {
  if (row == NULL || module_id == NULL || kind == NULL || value == NULL) return false;
  const char *first = strchr(row, '|');
  if (first == NULL || first == row) return false;
  const char *second = strchr(first + 1, '|');
  if (second == NULL || second <= first + 1) return false;
  if (*(second + 1) == '\0') return false;
  size_t module_n = (size_t)(first - row);
  size_t kind_n = (size_t)(second - (first + 1));
  const char *val_start = second + 1;
  size_t value_n = strlen(val_start);
  if (module_n + 1u > module_cap || kind_n + 1u > kind_cap || value_n + 1u > value_cap) return false;
  memcpy(module_id, row, module_n);
  module_id[module_n] = '\0';
  memcpy(kind, first + 1, kind_n);
  kind[kind_n] = '\0';
  memcpy(value, val_start, value_n);
  value[value_n] = '\0';
  return true;
}

static void hex_encode_utf8(const char *text, char *out, size_t out_cap) {
  static const char *hex = "0123456789abcdef";
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (text == NULL) return;
  size_t o = 0u;
  for (size_t i = 0u; text[i] != '\0'; ++i) {
    unsigned char b = (unsigned char)text[i];
    if (o + 3u >= out_cap) break;
    out[o++] = hex[(b >> 4u) & 0x0Fu];
    out[o++] = hex[b & 0x0Fu];
  }
  out[o] = '\0';
}

static int count_semantic_tsv_meaningful_rows(const char *tsv_path, int *out_total_rows) {
  if (out_total_rows != NULL) *out_total_rows = 0;
  if (tsv_path == NULL || tsv_path[0] == '\0') return 0;
  FILE *fp = fopen(tsv_path, "rb");
  if (fp == NULL) return 0;
  char line[4096];
  int total_rows = 0;
  int meaningful_rows = 0;
  while (fgets(line, sizeof(line), fp) != NULL) {
    size_t n = strnlen(line, sizeof(line));
    while (n > 0u && (line[n - 1u] == '\n' || line[n - 1u] == '\r')) {
      line[--n] = '\0';
    }
    if (n == 0u || line[0] == '#') continue;
    total_rows += 1;
    char row[4096];
    memcpy(row, line, n + 1u);
    char *fields[8] = {0};
    int field_count = 0;
    fields[field_count++] = row;
    for (char *p = row; *p != '\0' && field_count < 8; ++p) {
      if (*p == '\t') {
        *p = '\0';
        fields[field_count++] = p + 1;
      }
    }
    if (field_count < 8) continue;
    bool text_required = true;
    if (strcmp(fields[2], "hook") == 0 || strcmp(fields[2], "event") == 0) text_required = false;
    if (fields[0][0] != '\0' && fields[2][0] != '\0' && fields[6][0] != '\0' &&
        (!text_required || fields[3][0] != '\0')) {
      meaningful_rows += 1;
    }
  }
  fclose(fp);
  if (out_total_rows != NULL) *out_total_rows = total_rows;
  return meaningful_rows;
}

static __attribute__((unused)) bool write_semantic_render_nodes_from_react_ir(const char *react_ir_path,
                                                                              const char *tsv_path,
                                                                              long long expected_count) {
  if (react_ir_path == NULL || tsv_path == NULL) return false;
  size_t n = 0u;
  char *doc = read_file_all(react_ir_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  const char *p = json_find_key(doc, "semantic_nodes");
  if (p == NULL || *p != '[') {
    free(doc);
    return false;
  }
  ++p;

  FILE *fp = fopen(tsv_path, "wb");
  if (fp == NULL) {
    free(doc);
    return false;
  }
  fprintf(fp, "# node_id\troute_hint\trole\ttext_hex\tselector\tevent_binding\tsource_module\tjsx_path\n");

  int index = 0;
  while (*p != '\0') {
    p = skip_ws(p);
    if (*p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '"') {
      ++p;
      continue;
    }

    char row[4096];
    const char *after = NULL;
    if (!json_parse_string_at(p, row, sizeof(row), &after)) break;
    p = after;

    char module_id_raw[2048];
    char kind[256];
    char value[2048];
    bool parsed = parse_semantic_row(row,
                                     module_id_raw,
                                     sizeof(module_id_raw),
                                     kind,
                                     sizeof(kind),
                                     value,
                                     sizeof(value));
    if (!parsed) {
      snprintf(module_id_raw, sizeof(module_id_raw), "%s", "/semantic/unknown");
      snprintf(kind, sizeof(kind), "%s", "text");
      snprintf(value, sizeof(value), "%s", row);
    }

    char module_id[2048];
    if (module_id_raw[0] == '/') snprintf(module_id, sizeof(module_id), "%s", module_id_raw);
    else snprintf(module_id, sizeof(module_id), "/%s", module_id_raw);

    const bool is_hook = (strcmp(kind, "hook") == 0);
    const bool is_event = (strcmp(kind, "event") == 0);
    char role[32];
    if (strcmp(kind, "jsx-tag") == 0 || strcmp(kind, "id") == 0 || strcmp(kind, "class") == 0 ||
        strcmp(kind, "testid") == 0) {
      snprintf(role, sizeof(role), "%s", "element");
    } else if (is_event) {
      snprintf(role, sizeof(role), "%s", "event");
    } else if (is_hook) {
      snprintf(role, sizeof(role), "%s", "hook");
    } else {
      snprintf(role, sizeof(role), "%s", "text");
    }

    char label[2048];
    if (strcmp(kind, "jsx-tag") == 0) snprintf(label, sizeof(label), "<%s>", value);
    else if (is_hook) snprintf(label, sizeof(label), "%s", "");
    else snprintf(label, sizeof(label), "%s", value);
    char text_hex[4096];
    hex_encode_utf8(label, text_hex, sizeof(text_hex));
    if (text_hex[0] == '\0' && !is_hook) {
      char fallback[64];
      snprintf(fallback, sizeof(fallback), "node-%d", index);
      hex_encode_utf8(fallback, text_hex, sizeof(text_hex));
    }

    char idx_text[32];
    snprintf(idx_text, sizeof(idx_text), "%d", index);
    char node_id[64];
    snprintf(node_id, sizeof(node_id), "sn_%s", idx_text);
    char route_hint[128];
    infer_route_hint(module_id, value, route_hint, sizeof(route_hint));
    char selector[128];
    if (is_hook) selector[0] = '\0';
    else snprintf(selector, sizeof(selector), "#r2c-id-%s", idx_text);
    char event_binding[128];
    if (is_event) snprintf(event_binding, sizeof(event_binding), "%s", value);
    else event_binding[0] = '\0';
    char jsx_path[128];
    if (is_event) snprintf(jsx_path, sizeof(jsx_path), "event:%s", idx_text);
    else if (is_hook) snprintf(jsx_path, sizeof(jsx_path), "hook:%s", idx_text);
    else snprintf(jsx_path, sizeof(jsx_path), "semantic:%s", idx_text);

    fprintf(fp,
            "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
            node_id,
            route_hint,
            role,
            text_hex,
            selector,
            event_binding,
            module_id,
            jsx_path);
    index += 1;
  }

  fclose(fp);
  free(doc);
  if (index <= 0) return false;
  if (expected_count > 0 && index != (int)expected_count) return false;
  int total_rows = 0;
  int meaningful_rows = count_semantic_tsv_meaningful_rows(tsv_path, &total_rows);
  return total_rows > 0 && meaningful_rows > 0;
}

static int count_runtime_append_calls(const char *runtime_src) {
  if (runtime_src == NULL) return 0;
  int count = 0;
  const char *line = runtime_src;
  while (*line != '\0') {
    const char *end = line;
    while (*end != '\0' && *end != '\n' && *end != '\r') ++end;
    const char *p = line;
    while (p < end && isspace((unsigned char)*p)) ++p;
    if (p < end && *p != '#') {
      if (strncmp(p, "appendSemanticNode(", 19u) == 0) count += 1;
    }
    if (*end == '\0') break;
    line = end + 1;
  }
  return count;
}

static bool runtime_has_comment_append_marker(const char *runtime_src) {
  if (runtime_src == NULL) return false;
  const char *line = runtime_src;
  while (*line != '\0') {
    const char *end = line;
    while (*end != '\0' && *end != '\n' && *end != '\r') ++end;
    const char *p = line;
    while (p < end && isspace((unsigned char)*p)) ++p;
    if (p < end && *p == '#') {
      if (strstr(p, "appendSemanticNode(") != NULL) return true;
    }
    if (*end == '\0') break;
    line = end + 1;
  }
  return false;
}

static bool build_semantic_append_block_from_ir(const char *react_ir_path,
                                                char *out,
                                                size_t out_cap,
                                                int *out_count) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (out_count != NULL) *out_count = 0;
  if (react_ir_path == NULL || out == NULL || out_cap == 0u) return false;
  size_t n = 0u;
  char *doc = read_file_all(react_ir_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  const char *p = json_find_key(doc, "semantic_nodes");
  if (p == NULL || *p != '[') {
    free(doc);
    return false;
  }
  ++p;

  size_t len = 0u;
  int index = 0;
  while (*p != '\0') {
    p = skip_ws(p);
    if (*p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '"') {
      ++p;
      continue;
    }
    char row[4096];
    const char *after = NULL;
    if (!json_parse_string_at(p, row, sizeof(row), &after)) break;
    p = after;

    char module_id_raw[2048];
    char kind[256];
    char value[2048];
    if (!parse_semantic_row(row,
                            module_id_raw,
                            sizeof(module_id_raw),
                            kind,
                            sizeof(kind),
                            value,
                            sizeof(value))) {
      continue;
    }

    char module_id[2048];
    if (module_id_raw[0] == '/') snprintf(module_id, sizeof(module_id), "%s", module_id_raw);
    else snprintf(module_id, sizeof(module_id), "/%s", module_id_raw);

    const bool is_hook = (strcmp(kind, "hook") == 0);
    const bool is_event = (strcmp(kind, "event") == 0);
    char role[64];
    if (strcmp(kind, "jsx-tag") == 0 || strcmp(kind, "id") == 0 || strcmp(kind, "class") == 0 ||
        strcmp(kind, "testid") == 0) {
      snprintf(role, sizeof(role), "%s", "element");
    } else if (is_event) {
      snprintf(role, sizeof(role), "%s", "event");
    } else if (is_hook) {
      snprintf(role, sizeof(role), "%s", "hook");
    } else {
      snprintf(role, sizeof(role), "%s", "text");
    }

    char text_out[2048];
    snprintf(text_out, sizeof(text_out), "%s", value);
    if (strcmp(kind, "jsx-tag") == 0) snprintf(text_out, sizeof(text_out), "<%s>", value);
    if (is_hook) snprintf(text_out, sizeof(text_out), "%s", "");
    if (is_event && text_out[0] == '\0') snprintf(text_out, sizeof(text_out), "%s", value);

    char prop_id[128] = "";
    char class_name[256] = "";
    char test_id[128] = "";
    char hit_test_id[128] = "";
    if (strcmp(kind, "id") == 0) {
      snprintf(prop_id, sizeof(prop_id), "%s", value);
      snprintf(hit_test_id, sizeof(hit_test_id), "%s", value);
    } else if (strcmp(kind, "class") == 0) {
      snprintf(class_name, sizeof(class_name), "%s", value);
    } else if (strcmp(kind, "testid") == 0) {
      snprintf(test_id, sizeof(test_id), "%s", value);
      snprintf(hit_test_id, sizeof(hit_test_id), "%s", value);
    }

    char idx_text[32];
    snprintf(idx_text, sizeof(idx_text), "%d", index);
    if (!is_hook && prop_id[0] == '\0') snprintf(prop_id, sizeof(prop_id), "r2c-id-%s", idx_text);
    if (!is_hook && test_id[0] == '\0') snprintf(test_id, sizeof(test_id), "r2c-testid-%s", idx_text);
    if (class_name[0] == '\0') {
      if (is_hook) snprintf(class_name, sizeof(class_name), "%s", "semantic-hook");
      else if (is_event) snprintf(class_name, sizeof(class_name), "%s", "semantic-event");
      else snprintf(class_name, sizeof(class_name), "%s", "semantic-node");
    }
    if (hit_test_id[0] == '\0') {
      if (prop_id[0] != '\0') snprintf(hit_test_id, sizeof(hit_test_id), "%s", prop_id);
      else if (test_id[0] != '\0') snprintf(hit_test_id, sizeof(hit_test_id), "%s", test_id);
      else snprintf(hit_test_id, sizeof(hit_test_id), "r2c-hit-%s", idx_text);
    }

    char jsx_path[64];
    if (is_event) snprintf(jsx_path, sizeof(jsx_path), "event:%s", idx_text);
    else if (is_hook) snprintf(jsx_path, sizeof(jsx_path), "hook:%s", idx_text);
    else snprintf(jsx_path, sizeof(jsx_path), "semantic:%s", idx_text);
    char node_id[64];
    snprintf(node_id, sizeof(node_id), "sn_%s", idx_text);

    char route_hint[128];
    infer_route_hint(module_id, value, route_hint, sizeof(route_hint));
    char render_bucket[128];
    if (route_hint[0] == '\0') snprintf(render_bucket, sizeof(render_bucket), "%s", "global");
    else snprintf(render_bucket, sizeof(render_bucket), "%s", route_hint);
    char event_binding[128] = "";
    char hook_slot[128] = "";
    if (is_event) snprintf(event_binding, sizeof(event_binding), "%s", value);
    if (is_hook) snprintf(hook_slot, sizeof(hook_slot), "%s", value);

    char e_node_id[256];
    char e_module_id[4096];
    char e_jsx_path[256];
    char e_role[128];
    char e_text_out[4096];
    char e_prop_id[256];
    char e_class_name[1024];
    char e_test_id[256];
    char e_event_binding[256];
    char e_hook_slot[256];
    char e_route_hint[256];
    char e_render_bucket[256];
    char e_hit_test_id[256];
    cheng_escape(node_id, e_node_id, sizeof(e_node_id));
    cheng_escape(module_id, e_module_id, sizeof(e_module_id));
    cheng_escape(jsx_path, e_jsx_path, sizeof(e_jsx_path));
    cheng_escape(role, e_role, sizeof(e_role));
    cheng_escape(text_out, e_text_out, sizeof(e_text_out));
    cheng_escape(prop_id, e_prop_id, sizeof(e_prop_id));
    cheng_escape(class_name, e_class_name, sizeof(e_class_name));
    cheng_escape(test_id, e_test_id, sizeof(e_test_id));
    cheng_escape(event_binding, e_event_binding, sizeof(e_event_binding));
    cheng_escape(hook_slot, e_hook_slot, sizeof(e_hook_slot));
    cheng_escape(route_hint, e_route_hint, sizeof(e_route_hint));
    cheng_escape(render_bucket, e_render_bucket, sizeof(e_render_bucket));
    cheng_escape(hit_test_id, e_hit_test_id, sizeof(e_hit_test_id));

    if (!buf_appendf(out,
                     out_cap,
                     &len,
                     "    appendSemanticNode(\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        \"%s\",\n"
                     "        int32(%d),\n"
                     "        \"%s\",\n"
                     "        \"%s\"\n"
                     "    )\n",
                     e_node_id,
                     e_module_id,
                     e_jsx_path,
                     e_role,
                     e_text_out,
                     e_prop_id,
                     e_class_name,
                     e_test_id,
                     e_event_binding,
                     e_hook_slot,
                     e_route_hint,
                     index,
                     e_render_bucket,
                     e_hit_test_id)) {
      free(doc);
      return false;
    }
    index += 1;
  }

  free(doc);
  if (index <= 0) return false;
  if (out_count != NULL) *out_count = index;
  return true;
}

static bool json_array_is_empty(const char *doc, const char *key) {
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '[') return false;
  ++p;
  p = skip_ws(p);
  return (p != NULL && *p == ']');
}

static void dirname_copy(const char *path, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (path == NULL || path[0] == '\0') return;
  size_t n = strlen(path);
  if (n >= out_cap) n = out_cap - 1u;
  memcpy(out, path, n);
  out[n] = '\0';
  char *slash = strrchr(out, '/');
  if (slash == NULL) {
    snprintf(out, out_cap, ".");
    return;
  }
  if (slash == out) {
    slash[1] = '\0';
    return;
  }
  *slash = '\0';
}

static bool resolve_report_path(const char *report_path, const char *raw, char *out, size_t out_cap) {
  if (report_path == NULL || raw == NULL || out == NULL || out_cap == 0u) return false;
  if (raw[0] == '\0') return false;
  if (raw[0] == '/') {
    if (snprintf(out, out_cap, "%s", raw) >= (int)out_cap) return false;
    return true;
  }
  if (snprintf(out, out_cap, "%s", raw) < (int)out_cap && file_exists(out)) {
    return true;
  }
  char dir[PATH_MAX];
  dirname_copy(report_path, dir, sizeof(dir));
  if (path_join(out, out_cap, dir, raw) != 0) return false;
  return true;
}

static const char *route_parent_for(const char *route) {
  if (route == NULL || route[0] == '\0') return "home_default";
  if (strcmp(route, "home_default") == 0) return "";
  if (strcmp(route, "lang_select") == 0) return "home_default";
  if (strncmp(route, "home_", 5u) == 0) return "home_default";
  if (strncmp(route, "tab_", 4u) == 0) return "home_default";
  if (strcmp(route, "publish_selector") == 0) return "home_default";
  if (strncmp(route, "publish_", 8u) == 0) return "publish_selector";
  if (strcmp(route, "trading_main") == 0) return "tab_nodes";
  if (strncmp(route, "trading_", 8u) == 0) return "trading_main";
  if (strcmp(route, "ecom_main") == 0 || strcmp(route, "marketplace_main") == 0) return "home_ecom_overlay_open";
  if (strcmp(route, "update_center_main") == 0) return "tab_profile";
  return "home_default";
}

static int route_depth_for(const char *route) {
  if (route != NULL && strcmp(route, "home_default") == 0) return 0;
  const char *parent = route_parent_for(route);
  if (parent == NULL || parent[0] == '\0' || (route != NULL && strcmp(parent, route) == 0)) return 0;
  if (strcmp(parent, "home_default") == 0) return 1;
  return 2;
}

static const char *route_entry_event_for(const char *route) {
  if (route == NULL || route[0] == '\0') return "route.navigate";
  if (strcmp(route, "home_default") == 0) return "app_launch";
  if (strcmp(route, "lang_select") == 0) return "app_launch_first_run";
  if (strncmp(route, "home_", 5u) == 0) return "home.interaction";
  if (strncmp(route, "tab_", 4u) == 0) return "bottom_tab.switch";
  if (strcmp(route, "publish_selector") == 0) return "bottom_tab.publish";
  if (strncmp(route, "publish_", 8u) == 0) return "publish_selector.choose";
  if (strncmp(route, "trading_", 8u) == 0) return "node.market.open";
  if (strcmp(route, "ecom_main") == 0 || strcmp(route, "marketplace_main") == 0) return "home.ecom.open";
  if (strcmp(route, "update_center_main") == 0) return "profile.update_center.open";
  return "route.navigate";
}

static void route_path_signature_for(const char *route, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (route == NULL || route[0] == '\0' || strcmp(route, "home_default") == 0) {
    snprintf(out, out_cap, "home_default");
    return;
  }
  const char *parent = route_parent_for(route);
  if (parent == NULL || parent[0] == '\0' || strcmp(parent, "home_default") == 0) {
    snprintf(out, out_cap, "home_default>%s", route);
    return;
  }
  snprintf(out, out_cap, "home_default>%s>%s", parent, route);
}

static int parse_string_array_key(const char *doc, const char *key, PathList *out_list) {
  if (doc == NULL || key == NULL || out_list == NULL) return -1;
  memset(out_list, 0, sizeof(*out_list));
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '[') return -1;
  ++p;
  while (*p != '\0') {
    while (*p != '\0' && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n' || *p == ',')) ++p;
    if (*p == ']') break;
    if (*p != '"') {
      path_list_free(out_list);
      return -1;
    }
    ++p;
    const char *start = p;
    while (*p != '\0' && *p != '"') {
      if (*p == '\\' && p[1] != '\0') p += 2;
      else ++p;
    }
    if (*p != '"') {
      path_list_free(out_list);
      return -1;
    }
    size_t n = (size_t)(p - start);
    if (n == 0u || n >= 256u) {
      path_list_free(out_list);
      return -1;
    }
    char token[256];
    memcpy(token, start, n);
    token[n] = '\0';
    if (path_list_push(out_list, token) != 0) {
      path_list_free(out_list);
      return -1;
    }
    ++p;
  }
  return out_list->len > 0u ? 0 : -1;
}

static bool json_replace_int_field(char **doc_io, const char *key, long long value) {
  if (doc_io == NULL || *doc_io == NULL || key == NULL) return false;
  char *doc = *doc_io;
  const char *p = json_find_key(doc, key);
  if (p == NULL) return false;
  const char *end = p;
  while (*end != '\0' && *end != ',' && *end != '\n' && *end != '\r' && *end != '}') ++end;
  size_t old_len = strlen(doc);
  size_t prefix_len = (size_t)(p - doc);
  size_t old_segment_len = (size_t)(end - p);
  char num_buf[64];
  int num_n = snprintf(num_buf, sizeof(num_buf), "%lld", value);
  if (num_n <= 0 || (size_t)num_n >= sizeof(num_buf)) return false;
  size_t replacement_len = (size_t)num_n;
  if (prefix_len > old_len || old_segment_len > old_len || prefix_len + old_segment_len > old_len) return false;
  size_t suffix_len = old_len - (prefix_len + old_segment_len);
  size_t new_len = prefix_len + replacement_len + suffix_len;
  char *next = (char *)malloc(new_len + 1u);
  if (next == NULL) return false;
  memcpy(next, doc, prefix_len);
  memcpy(next + prefix_len, num_buf, replacement_len);
  memcpy(next + prefix_len + replacement_len, end, suffix_len);
  next[new_len] = '\0';
  free(doc);
  *doc_io = next;
  return true;
}

static bool json_insert_after_key_line(char **doc_io, const char *anchor_key, const char *line_text) {
  if (doc_io == NULL || *doc_io == NULL || anchor_key == NULL || line_text == NULL) return false;
  char *doc = *doc_io;
  const char *p = json_find_key(doc, anchor_key);
  if (p == NULL) return false;
  const char *line_end = strchr(p, '\n');
  if (line_end == NULL) return false;
  size_t insert_at = (size_t)(line_end - doc + 1);
  size_t old_len = strlen(doc);
  size_t ins_len = strlen(line_text);
  char *next = (char *)malloc(old_len + ins_len + 1u);
  if (next == NULL) return false;
  memcpy(next, doc, insert_at);
  memcpy(next + insert_at, line_text, ins_len);
  memcpy(next + insert_at + ins_len, doc + insert_at, old_len - insert_at);
  next[old_len + ins_len] = '\0';
  free(doc);
  *doc_io = next;
  return true;
}

static bool write_route_tree_json(const char *path, const PathList *states) {
  if (path == NULL || states == NULL || states->len == 0u) return false;
  char buf[256 * 1024];
  size_t len = 0u;
  if (!buf_appendf(buf, sizeof(buf), &len,
                   "{\n"
                   "  \"format\": \"r2c-route-tree-v1\",\n"
                   "  \"root_route\": \"home_default\",\n"
                   "  \"route_count\": %zu,\n"
                   "  \"nodes\": [\n",
                   states->len)) return false;
  for (size_t i = 0u; i < states->len; ++i) {
    const char *route = states->items[i];
    const char *parent = route_parent_for(route);
    char path_sig[512];
    route_path_signature_for(route, path_sig, sizeof(path_sig));
    if (i > 0u) {
      if (!buf_appendf(buf, sizeof(buf), &len, ",\n")) return false;
    }
    if (!buf_appendf(buf, sizeof(buf), &len,
                     "    {\"route\":\"%s\",\"depth\":%d,\"parent\":\"%s\",\"entry_event\":\"%s\",\"path_from_root\":[",
                     route,
                     route_depth_for(route),
                     parent != NULL ? parent : "",
                     route_entry_event_for(route))) return false;
    if (strcmp(route, "home_default") == 0) {
      if (!buf_appendf(buf, sizeof(buf), &len, "\"home_default\"]")) return false;
    } else if (parent == NULL || parent[0] == '\0' || strcmp(parent, "home_default") == 0) {
      if (!buf_appendf(buf, sizeof(buf), &len, "\"home_default\",\"%s\"]", route)) return false;
    } else {
      if (!buf_appendf(buf, sizeof(buf), &len, "\"home_default\",\"%s\",\"%s\"]", parent, route)) return false;
    }
    if (!buf_appendf(buf, sizeof(buf), &len, ",\"component_source\":\"/app/App.tsx\",\"path_signature\":\"%s\"}", path_sig)) {
      return false;
    }
  }
  if (!buf_appendf(buf, sizeof(buf), &len, "\n  ]\n}\n")) return false;
  return write_file_all(path, buf, len) == 0;
}

static bool write_route_layers_json(const char *path, const PathList *states, int *out_layer_count) {
  if (path == NULL || states == NULL || states->len == 0u) return false;
  int max_depth = 0;
  for (size_t i = 0u; i < states->len; ++i) {
    int d = route_depth_for(states->items[i]);
    if (d > max_depth) max_depth = d;
  }
  const int layer_count = max_depth + 1;
  if (out_layer_count != NULL) *out_layer_count = layer_count;

  char buf[256 * 1024];
  size_t len = 0u;
  if (!buf_appendf(buf, sizeof(buf), &len,
                   "{\n"
                   "  \"format\": \"r2c-route-layers-v1\",\n"
                   "  \"root_route\": \"home_default\",\n"
                   "  \"layer_count\": %d,\n"
                   "  \"layers\": [\n",
                   layer_count)) return false;

  bool wrote_layer = false;
  for (int layer = 0; layer < layer_count; ++layer) {
    PathList routes;
    PathList deps;
    memset(&routes, 0, sizeof(routes));
    memset(&deps, 0, sizeof(deps));
    for (size_t i = 0u; i < states->len; ++i) {
      const char *route = states->items[i];
      if (route_depth_for(route) != layer) continue;
      (void)path_list_push(&routes, route);
      const char *parent = route_parent_for(route);
      if (parent != NULL && parent[0] != '\0') (void)path_list_push(&deps, parent);
    }
    if (routes.len == 0u) {
      path_list_free(&routes);
      path_list_free(&deps);
      continue;
    }
    if (wrote_layer) {
      if (!buf_appendf(buf, sizeof(buf), &len, ",\n")) {
        path_list_free(&routes);
        path_list_free(&deps);
        return false;
      }
    }
    if (!buf_appendf(buf, sizeof(buf), &len, "    {\"layer_index\":%d,\"routes\":[", layer)) {
      path_list_free(&routes);
      path_list_free(&deps);
      return false;
    }
    for (size_t i = 0u; i < routes.len; ++i) {
      if (i > 0u && !buf_appendf(buf, sizeof(buf), &len, ",")) {
        path_list_free(&routes);
        path_list_free(&deps);
        return false;
      }
      if (!buf_appendf(buf, sizeof(buf), &len, "\"%s\"", routes.items[i])) {
        path_list_free(&routes);
        path_list_free(&deps);
        return false;
      }
    }
    if (!buf_appendf(buf, sizeof(buf), &len, "],\"blocking_dependencies\":["))
    {
      path_list_free(&routes);
      path_list_free(&deps);
      return false;
    }
    for (size_t i = 0u; i < deps.len; ++i) {
      if (i > 0u && !buf_appendf(buf, sizeof(buf), &len, ",")) {
        path_list_free(&routes);
        path_list_free(&deps);
        return false;
      }
      if (!buf_appendf(buf, sizeof(buf), &len, "\"%s\"", deps.items[i])) {
        path_list_free(&routes);
        path_list_free(&deps);
        return false;
      }
    }
    if (!buf_appendf(buf, sizeof(buf), &len, "]}")) {
      path_list_free(&routes);
      path_list_free(&deps);
      return false;
    }
    wrote_layer = true;
    path_list_free(&routes);
    path_list_free(&deps);
  }

  if (!buf_appendf(buf, sizeof(buf), &len, "\n  ]\n}\n")) return false;
  return write_file_all(path, buf, len) == 0;
}

static bool backfill_route_tree_layers_meta(const char *report_path) {
  if (report_path == NULL || report_path[0] == '\0') return false;
  size_t n = 0u;
  char *doc = read_file_all(report_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }

  PathList states;
  if (parse_string_array_key(doc, "visual_states", &states) != 0 || states.len == 0u) {
    path_list_free(&states);
    free(doc);
    return false;
  }

  char report_dir[PATH_MAX];
  dirname_copy(report_path, report_dir, sizeof(report_dir));
  char route_tree_path[PATH_MAX];
  char route_layers_path[PATH_MAX];
  if (!json_get_string(doc, "route_tree_path", route_tree_path, sizeof(route_tree_path)) ||
      route_tree_path[0] == '\0') {
    snprintf(route_tree_path, sizeof(route_tree_path), "%s/r2c_route_tree.json", report_dir);
  } else {
    char resolved[PATH_MAX];
    if (resolve_report_path(report_path, route_tree_path, resolved, sizeof(resolved))) {
      snprintf(route_tree_path, sizeof(route_tree_path), "%s", resolved);
    }
  }
  if (!json_get_string(doc, "route_layers_path", route_layers_path, sizeof(route_layers_path)) ||
      route_layers_path[0] == '\0') {
    snprintf(route_layers_path, sizeof(route_layers_path), "%s/r2c_route_layers.json", report_dir);
  } else {
    char resolved[PATH_MAX];
    if (resolve_report_path(report_path, route_layers_path, resolved, sizeof(resolved))) {
      snprintf(route_layers_path, sizeof(route_layers_path), "%s", resolved);
    }
  }

  int layer_count = 0;
  bool tree_ok = write_route_tree_json(route_tree_path, &states);
  bool layers_ok = write_route_layers_json(route_layers_path, &states, &layer_count);
  if (!tree_ok || !layers_ok || layer_count <= 0) {
    path_list_free(&states);
    free(doc);
    return false;
  }

  const char *layer_gate = getenv("R2C_CURRENT_LAYER_GATE");
  char gate_value[64];
  if (layer_gate != NULL && layer_gate[0] != '\0') {
    snprintf(gate_value, sizeof(gate_value), "%s", layer_gate);
  } else {
    const char *layer_index = getenv("CHENG_ANDROID_EQ_LAYER_INDEX");
    if (layer_index != NULL && layer_index[0] != '\0') {
      snprintf(gate_value, sizeof(gate_value), "layer-%s", layer_index);
    } else {
      snprintf(gate_value, sizeof(gate_value), "all");
    }
  }

  if (!json_replace_string_field(&doc, "route_tree_path", route_tree_path)) {
    char line[PATH_MAX + 64];
    snprintf(line, sizeof(line), "  \"route_tree_path\": \"%s\",\n", route_tree_path);
    if (!json_insert_after_key_line(&doc, "route_graph_path", line)) {
      path_list_free(&states);
      free(doc);
      return false;
    }
  }
  if (!json_replace_string_field(&doc, "route_layers_path", route_layers_path)) {
    char line[PATH_MAX + 64];
    snprintf(line, sizeof(line), "  \"route_layers_path\": \"%s\",\n", route_layers_path);
    if (!json_insert_after_key_line(&doc, "route_tree_path", line)) {
      path_list_free(&states);
      free(doc);
      return false;
    }
  }
  if (!json_replace_int_field(&doc, "layer_count", layer_count)) {
    char line[128];
    snprintf(line, sizeof(line), "  \"layer_count\": %d,\n", layer_count);
    if (!json_insert_after_key_line(&doc, "route_layers_path", line)) {
      path_list_free(&states);
      free(doc);
      return false;
    }
  }
  if (!json_replace_string_field(&doc, "current_layer_gate", gate_value)) {
    char line[128];
    snprintf(line, sizeof(line), "  \"current_layer_gate\": \"%s\",\n", gate_value);
    if (!json_insert_after_key_line(&doc, "layer_count", line)) {
      path_list_free(&states);
      free(doc);
      return false;
    }
  }

  bool wr_ok = (write_file_all(report_path, doc, strlen(doc)) == 0);
  path_list_free(&states);
  free(doc);
  return wr_ok;
}

static bool validate_path_key(const char *report_path, const char *doc, const char *key) {
  char raw[PATH_MAX];
  if (!json_get_string(doc, key, raw, sizeof(raw))) {
    fprintf(stderr, "[r2c-compile] missing report field: %s\n", key);
    return false;
  }
  char resolved[PATH_MAX];
  if (!resolve_report_path(report_path, raw, resolved, sizeof(resolved))) {
    fprintf(stderr, "[r2c-compile] invalid report path field: %s=%s\n", key, raw);
    return false;
  }
  if (!file_exists(resolved)) {
    fprintf(stderr, "[r2c-compile] report path not found: %s -> %s\n", key, resolved);
    return false;
  }
  return true;
}

static bool ensure_semantic_render_nodes_file(const char *report_path, const char *doc) {
  char raw_path[PATH_MAX];
  if (!json_get_string(doc, "semantic_render_nodes_path", raw_path, sizeof(raw_path))) return false;
  char resolved[PATH_MAX];
  if (!resolve_report_path(report_path, raw_path, resolved, sizeof(resolved))) return false;
  if (!file_exists(resolved)) {
    fprintf(stderr, "[r2c-compile] semantic_render_nodes_path not found: %s\n", resolved);
    return false;
  }

  long long expected_count = 0;
  if (!json_get_int64(doc, "semantic_render_nodes_count", &expected_count) || expected_count <= 0 ||
      expected_count > 200000) {
    fprintf(stderr, "[r2c-compile] invalid semantic_render_nodes_count: %lld\n", expected_count);
    return false;
  }

  int total_rows = 0;
  int meaningful_rows = count_semantic_tsv_meaningful_rows(resolved, &total_rows);
  if (meaningful_rows < (int)expected_count) {
    fprintf(stderr,
            "[r2c-compile] semantic_render_nodes.tsv meaningful rows too small: %d < %lld (path=%s)\n",
            meaningful_rows,
            expected_count,
            resolved);
    return false;
  }
  if (total_rows <= 0) {
    fprintf(stderr, "[r2c-compile] semantic_render_nodes.tsv has zero rows: %s\n", resolved);
    return false;
  }
  return true;
}

static bool validate_compile_report(const char *report_path, bool strict) {
  size_t n = 0u;
  char *doc = read_file_all(report_path, &n);
  if (doc == NULL || n == 0u) {
    fprintf(stderr, "[r2c-compile] failed to read report: %s\n", report_path);
    free(doc);
    return false;
  }

  bool ok = true;
  const bool allow_legacy_prefix = env_flag_on("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX");
  char generated_runtime_raw[PATH_MAX];
  if (json_get_string(doc, "generated_runtime_path", generated_runtime_raw, sizeof(generated_runtime_raw))) {
    char generated_runtime_path[PATH_MAX];
    if (resolve_report_path(report_path, generated_runtime_raw, generated_runtime_path, sizeof(generated_runtime_path)) &&
        file_exists(generated_runtime_path)) {
      size_t runtime_n = 0u;
      char *runtime_src = read_file_all(generated_runtime_path, &runtime_n);
      if (runtime_src != NULL) {
        int append_calls = count_runtime_append_calls(runtime_src);
        if (runtime_has_comment_append_marker(runtime_src)) {
          fprintf(stderr,
                  "[r2c-compile] generated runtime contains commented semantic marker lines: %s\n",
                  generated_runtime_path);
          ok = false;
        }
        if (!allow_legacy_prefix && strstr(runtime_src, "import cheng/gui/") != NULL) {
          fprintf(stderr,
                  "[r2c-compile] generated runtime still uses legacy import prefix cheng/gui/: %s\n",
                  generated_runtime_path);
          ok = false;
        }
        if (strstr(runtime_src, "legacy.mountUnimakerAot") != NULL ||
            strstr(runtime_src, "legacy.unimakerDispatch") != NULL ||
            strstr(runtime_src, "import gui/browser/r2capp/runtime as legacy") != NULL) {
          fprintf(stderr,
                  "[r2c-compile] compiler output is legacy runtime template (semantic nodes not compiled): %s\n",
                  generated_runtime_path);
          ok = false;
        }
        if (append_calls <= 0) {
          fprintf(stderr,
                  "[r2c-compile] generated runtime has zero executable semantic append calls: %s\n",
                  generated_runtime_path);
          ok = false;
        }
        free(runtime_src);
      } else {
        fprintf(stderr, "[r2c-compile] cannot read generated runtime: %s\n", generated_runtime_path);
        ok = false;
      }
    }
  }

  if (strict) {
    bool flag = false;
    if (!json_get_bool(doc, "strict_no_fallback", &flag) || !flag) {
      fprintf(stderr, "[r2c-compile] strict_no_fallback must be true\n");
      ok = false;
    }
    if (!json_get_bool(doc, "used_fallback", &flag) || flag) {
      fprintf(stderr, "[r2c-compile] used_fallback must be false\n");
      ok = false;
    }
    if (!json_get_bool(doc, "template_runtime_used", &flag) || flag) {
      fprintf(stderr, "[r2c-compile] template_runtime_used must be false\n");
      ok = false;
    }

    char origin[128];
    if (!json_get_string(doc, "compiler_report_origin", origin, sizeof(origin)) ||
        strcmp(origin, "cheng-compiler") != 0) {
      fprintf(stderr, "[r2c-compile] compiler_report_origin must be cheng-compiler\n");
      ok = false;
    }

    char mode[128];
    if (!json_get_string(doc, "semantic_compile_mode", mode, sizeof(mode)) ||
        strcmp(mode, "react-semantic-ir-node-compile") != 0) {
      fprintf(stderr, "[r2c-compile] semantic_compile_mode invalid\n");
      ok = false;
    }

    if (!json_array_is_empty(doc, "unsupported_syntax") || !json_array_is_empty(doc, "unsupported_imports") ||
        !json_array_is_empty(doc, "degraded_features")) {
      fprintf(stderr, "[r2c-compile] unsupported/degraded fields must be empty arrays\n");
      ok = false;
    }

    long long semantic_nodes = 0;
    if (!json_get_int64(doc, "semantic_node_count", &semantic_nodes) || semantic_nodes <= 0) {
      fprintf(stderr, "[r2c-compile] semantic_node_count must be > 0\n");
      ok = false;
    }
    long long layer_count = 0;
    if (!json_get_int64(doc, "layer_count", &layer_count) || layer_count <= 0) {
      fprintf(stderr, "[r2c-compile] layer_count must be > 0\n");
      ok = false;
    }
    char current_layer_gate[128];
    if (!json_get_string(doc, "current_layer_gate", current_layer_gate, sizeof(current_layer_gate)) ||
        current_layer_gate[0] == '\0') {
      fprintf(stderr, "[r2c-compile] missing current_layer_gate\n");
      ok = false;
    }
    char runtime_raw[PATH_MAX];
    if (!json_get_string(doc, "generated_runtime_path", runtime_raw, sizeof(runtime_raw))) {
      fprintf(stderr, "[r2c-compile] generated_runtime_path missing\n");
      ok = false;
    } else {
      char runtime_path[PATH_MAX];
      if (!resolve_report_path(report_path, runtime_raw, runtime_path, sizeof(runtime_path)) || !file_exists(runtime_path)) {
        fprintf(stderr, "[r2c-compile] generated_runtime_path invalid: %s\n", runtime_raw);
        ok = false;
      } else {
        size_t runtime_n = 0u;
        char *runtime_src = read_file_all(runtime_path, &runtime_n);
        if (runtime_src == NULL) {
          fprintf(stderr, "[r2c-compile] cannot read generated runtime: %s\n", runtime_path);
          ok = false;
        } else {
          if (runtime_has_comment_append_marker(runtime_src)) {
            fprintf(stderr,
                    "[r2c-compile] generated runtime still contains commented appendSemanticNode markers\n");
            ok = false;
          }
          int append_calls = count_runtime_append_calls(runtime_src);
          free(runtime_src);
          if (append_calls < (int)semantic_nodes) {
            fprintf(stderr,
                    "[r2c-compile] generated runtime semantic append calls too small: %d < %lld\n",
                    append_calls,
                    semantic_nodes);
            ok = false;
          }
        }
      }
    }

    const char *required_paths[] = {
        "generated_runtime_path",
        "react_ir_path",
        "hook_graph_path",
        "effect_plan_path",
        "route_tree_path",
        "route_layers_path",
        "semantic_node_map_path",
        "semantic_runtime_map_path",
        "semantic_render_nodes_path",
        "full_route_states_path",
        "perf_summary_path",
    };
    if (!ensure_semantic_render_nodes_file(report_path, doc)) {
      fprintf(stderr, "[r2c-compile] failed to materialize semantic_render_nodes_path\n");
      ok = false;
    }
    for (size_t i = 0u; i < sizeof(required_paths) / sizeof(required_paths[0]); ++i) {
      if (!validate_path_key(report_path, doc, required_paths[i])) ok = false;
    }

    bool truth_ok = false;
    const char *truth_keys[] = {
        "truth_trace_manifest_android_path",
        "truth_trace_manifest_ios_path",
        "truth_trace_manifest_harmony_path",
    };
    for (size_t i = 0u; i < sizeof(truth_keys) / sizeof(truth_keys[0]); ++i) {
      char raw[PATH_MAX];
      if (!json_get_string(doc, truth_keys[i], raw, sizeof(raw))) continue;
      char resolved[PATH_MAX];
      if (!resolve_report_path(report_path, raw, resolved, sizeof(resolved))) continue;
      if (file_exists(resolved)) {
        truth_ok = true;
        break;
      }
    }
    if (!truth_ok) {
      fprintf(stderr, "[r2c-compile] no truth_trace_manifest_*_path exists\n");
      ok = false;
    }
  }

  free(doc);
  return ok;
}

static bool csv_contains_token(const char *csv, const char *token) {
  if (csv == NULL || token == NULL || token[0] == '\0') return false;
  size_t token_n = strlen(token);
  const char *p = csv;
  while (*p != '\0') {
    while (*p != '\0' && (isspace((unsigned char)*p) || *p == ',')) ++p;
    if (*p == '\0') break;
    const char *start = p;
    while (*p != '\0' && *p != ',') ++p;
    const char *end = p;
    while (end > start && isspace((unsigned char)*(end - 1))) --end;
    size_t n = (size_t)(end - start);
    if (n == token_n && strncmp(start, token, n) == 0) return true;
    if (*p == ',') ++p;
  }
  return false;
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
    const char *home = getenv("HOME");
    if (home == NULL || home[0] == '\0') return false;
    if (snprintf(fallback_sdk, sizeof(fallback_sdk), "%s/Library/Android/sdk", home) >= (int)sizeof(fallback_sdk)) {
      return false;
    }
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
    char probe[PATH_MAX];
    if (snprintf(probe,
                 sizeof(probe),
                 "%s/%s/toolchains/llvm/prebuilt",
                 ndk_dir,
                 ent->d_name) >= (int)sizeof(probe)) {
      continue;
    }
    if (!dir_exists(probe)) continue;
    if (snprintf(out, out_cap, "%s/%s", ndk_dir, ent->d_name) >= (int)out_cap) continue;
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
  for (size_t i = 0; i < sizeof(hosts) / sizeof(hosts[0]); ++i) {
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

static bool ensure_android_payload_object(const char *out_dir) {
  const char *matrix = getenv("R2C_TARGET_MATRIX");
  if (matrix == NULL || matrix[0] == '\0' || !csv_contains_token(matrix, "android")) return true;
  if (out_dir == NULL || out_dir[0] == '\0') return false;

  char artifacts_root[PATH_MAX];
  char android_dir[PATH_MAX];
  char android_obj[PATH_MAX];
  if (path_join(artifacts_root, sizeof(artifacts_root), out_dir, "r2capp_platform_artifacts") != 0 ||
      path_join(android_dir, sizeof(android_dir), artifacts_root, "android") != 0 ||
      path_join(android_obj, sizeof(android_obj), android_dir, "r2c_app_android.o") != 0) {
    return false;
  }
  if (ensure_dir(android_dir) != 0) return false;

  const char *cheng_lang_root = getenv("CHENG_LANG_ROOT");
  if (cheng_lang_root == NULL || cheng_lang_root[0] == '\0') cheng_lang_root = "/Users/lbcheng/cheng-lang";
  const char *cheng_mobile_root = getenv("CHENG_MOBILE_ROOT");
  if (cheng_mobile_root == NULL || cheng_mobile_root[0] == '\0') {
    cheng_mobile_root = "/Users/lbcheng/.cheng-packages/cheng-mobile";
  }

  char exports_c[PATH_MAX];
  char exports_h[PATH_MAX];
  char bridge_dir[PATH_MAX];
  if (path_join(exports_c, sizeof(exports_c), cheng_lang_root, "src/runtime/mobile/cheng_mobile_exports.c") != 0 ||
      path_join(exports_h, sizeof(exports_h), cheng_lang_root, "src/runtime/mobile/cheng_mobile_exports.h") != 0 ||
      path_join(bridge_dir, sizeof(bridge_dir), cheng_mobile_root, "bridge") != 0) {
    return false;
  }
  if (!dir_exists(bridge_dir)) {
    if (path_join(bridge_dir, sizeof(bridge_dir), cheng_mobile_root, "src/bridge") != 0) return false;
  }
  if (!file_exists(exports_c) || !file_exists(exports_h) || !dir_exists(bridge_dir)) {
    fprintf(stderr,
            "[r2c-compile] android payload source missing: %s / %s (bridge=%s)\n",
            exports_c,
            exports_h,
            bridge_dir);
    return false;
  }

  struct stat st;
  struct stat src_c_st;
  struct stat src_h_st;
  bool obj_ok = (stat(android_obj, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0);
  bool src_c_ok = (stat(exports_c, &src_c_st) == 0 && S_ISREG(src_c_st.st_mode));
  bool src_h_ok = (stat(exports_h, &src_h_st) == 0 && S_ISREG(src_h_st.st_mode));
  if (!src_c_ok || !src_h_ok) {
    fprintf(stderr, "[r2c-compile] failed to stat android payload sources\n");
    return false;
  }
  bool force_rebuild = false;
  const char *force_rebuild_env = getenv("R2C_FORCE_REBUILD_ANDROID_PAYLOAD");
  if (force_rebuild_env != NULL && force_rebuild_env[0] != '\0' && strcmp(force_rebuild_env, "0") != 0) {
    force_rebuild = true;
  }
  bool source_newer = false;
  if (obj_ok && (src_c_st.st_mtime > st.st_mtime || src_h_st.st_mtime > st.st_mtime)) {
    source_newer = true;
  }
  if (obj_ok && !force_rebuild && !source_newer) {
    return true;
  }

  char android_clang[PATH_MAX];
  if (!resolve_android_clang(android_clang, sizeof(android_clang))) {
    fprintf(stderr,
            "[r2c-compile] missing Android NDK clang; set ANDROID_NDK_HOME/ANDROID_SDK_ROOT or R2C_ANDROID_CLANG\n");
    return false;
  }

  char exports_dir[PATH_MAX];
  snprintf(exports_dir, sizeof(exports_dir), "%s", exports_c);
  char *slash = strrchr(exports_dir, '/');
  if (slash != NULL) *slash = '\0';

  char include_bridge_arg[PATH_MAX + 3];
  char include_exports_arg[PATH_MAX + 3];
  if (snprintf(include_bridge_arg, sizeof(include_bridge_arg), "-I%s", bridge_dir) >= (int)sizeof(include_bridge_arg) ||
      snprintf(include_exports_arg, sizeof(include_exports_arg), "-I%s", exports_dir) >= (int)sizeof(include_exports_arg)) {
    return false;
  }

  char compile_log[PATH_MAX];
  if (path_join(compile_log, sizeof(compile_log), out_dir, "r2c_app_android.compile.log") != 0) {
    return false;
  }

  if (obj_ok && (force_rebuild || source_newer)) {
    fprintf(stdout,
            "[r2c-compile] rebuilding android payload object reason=%s%s\n",
            force_rebuild ? "forced" : "",
            source_newer ? (force_rebuild ? "+source-newer" : "source-newer") : "");
  }

  unlink(android_obj);
  char *argv[] = {
      android_clang,
      "-std=c11",
      "-fPIC",
      "-D__ANDROID__=1",
      "-DANDROID=1",
      include_bridge_arg,
      include_exports_arg,
      "-c",
      exports_c,
      "-o",
      android_obj,
      NULL,
  };
  RunResult rr = run_command(argv, NULL, compile_log, 120);
  if (rr.code != 0) {
    fprintf(stderr, "[r2c-compile] android ABI v2 payload compile failed rc=%d (log=%s)\n", rr.code, compile_log);
    return false;
  }
  if (stat(android_obj, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size <= 0) {
    fprintf(stderr, "[r2c-compile] android payload object missing after compile: %s\n", android_obj);
    return false;
  }
  return true;
}

static RunResult run_command(char *const argv[], const char *workdir, const char *log_path, int timeout_sec) {
  RunResult res;
  res.code = 127;
  res.timed_out = false;

  pid_t pid = fork();
  if (pid < 0) return res;
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
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
    if (got < 0) return res;
    if (timeout_sec > 0 && time(NULL) >= deadline) {
      res.timed_out = true;
      kill(-pid, SIGTERM);
      usleep(200000);
      kill(-pid, SIGKILL);
      /* Avoid indefinite blocking when the child enters an uninterruptible kernel wait. */
      for (int spin = 0; spin < 40; ++spin) {
        int status = 0;
        pid_t done = waitpid(pid, &status, WNOHANG);
        if (done == pid || done < 0) break;
        usleep(50000);
      }
      res.code = 124;
      return res;
    }
    usleep(50000);
  }
}

static int parse_positive_int_env(const char *name, int fallback) {
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return fallback;
  char *end = NULL;
  long v = strtol(raw, &end, 10);
  if (end == raw || *end != '\0' || v <= 0 || v > 86400) return fallback;
  return (int)v;
}

static int to_absolute_path(const char *input, char *out, size_t cap) {
  if (input == NULL || input[0] == '\0' || out == NULL || cap == 0u) return -1;
  if (input[0] == '/') {
    int n = snprintf(out, cap, "%s", input);
    if (n < 0 || (size_t)n >= cap) return -1;
    return 0;
  }
  char cwd[PATH_MAX];
  if (getcwd(cwd, sizeof(cwd)) == NULL) return -1;
  int n = snprintf(out, cap, "%s/%s", cwd, input);
  if (n < 0 || (size_t)n >= cap) return -1;
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
          "  r2c_compile_react_project --project <abs_path> [--entry </app/main.tsx>] --out <abs_path> [--strict]\n"
          "\n"
          "Native R2C compile path (no shell/python fallback).\n");
}

int native_r2c_compile_react_project(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  const char *project = NULL;
  const char *entry = "/app/main.tsx";
  const char *out_dir = NULL;
  bool strict = false;

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
    if (strcmp(arg, "--strict") == 0) {
      strict = true;
      i += 1;
      continue;
    }
    fprintf(stderr, "[r2c-compile] unknown arg: %s\n", arg);
    return 2;
  }

  if (project == NULL || out_dir == NULL) {
    usage();
    return 2;
  }

  char project_abs[PATH_MAX];
  char out_dir_abs[PATH_MAX];
  if (to_absolute_path(project, project_abs, sizeof(project_abs)) != 0 ||
      to_absolute_path(out_dir, out_dir_abs, sizeof(out_dir_abs)) != 0) {
    fprintf(stderr, "[r2c-compile] failed to resolve absolute paths\n");
    return 1;
  }
  project = project_abs;
  out_dir = out_dir_abs;

  if (!dir_exists(project)) {
    fprintf(stderr, "[r2c-compile] missing project: %s\n", project);
    return 1;
  }

  char root[PATH_MAX];
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[r2c-compile] missing scripts dir\n");
    return 2;
  }
  snprintf(root, sizeof(root), "%s", scripts_dir);
  size_t root_len = strlen(root);
  if (root_len >= 12u && strcmp(root + root_len - 12u, "/src/scripts") == 0) {
    root[root_len - 12u] = '\0';
  } else if (root_len >= 8u && strcmp(root + root_len - 8u, "/scripts") == 0) {
    root[root_len - 8u] = '\0';
  }
  if (allow_legacy_gui_prefix_for_project(project, root)) {
    setenv("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX", "1", 1);
  }

  {
    char compat_err[512];
    if (nr_enforce_no_compat_mounts(root, compat_err, sizeof(compat_err)) != 0) {
      fprintf(stderr, "[r2c-compile] %s\n", compat_err);
      return 1;
    }
    if (nr_enforce_no_legacy_gui_imports(root, compat_err, sizeof(compat_err)) != 0) {
      fprintf(stderr, "[r2c-compile] %s\n", compat_err);
      return 1;
    }
  }

  {
    char gui_root_src[PATH_MAX];
    if (path_join(gui_root_src, sizeof(gui_root_src), root, "src") == 0 && dir_exists(gui_root_src)) {
      setenv("GUI_ROOT", gui_root_src, 1);
    } else {
      setenv("GUI_ROOT", root, 1);
    }
    setenv("GUI_PACKAGE_ROOT", root, 1);
  }
  {
    const char *pkg_roots_env = getenv("PKG_ROOTS");
    if (pkg_roots_env == NULL || pkg_roots_env[0] == '\0') {
      setenv("PKG_ROOTS", "/Users/lbcheng/.cheng-packages", 1);
    }
  }

  if (!configure_backend_track_env(strict)) return 1;

  PathList candidates;
  memset(&candidates, 0, sizeof(candidates));
  if (discover_compiler_candidates(root, strict, &candidates) != 0) {
    fprintf(stderr, "[r2c-compile] failed to discover compiler candidates\n");
    path_list_free(&candidates);
    return 1;
  }
  if (candidates.len == 0u) {
    fprintf(stderr, "[r2c-compile] missing native compiler binary candidates under %s/build\n", root);
    path_list_free(&candidates);
    return 1;
  }

  if (ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[r2c-compile] failed to create out dir: %s\n", out_dir);
    path_list_free(&candidates);
    return 1;
  }

  char out_root[PATH_MAX];
  if (path_join(out_root, sizeof(out_root), out_dir, "r2capp") != 0) {
    path_list_free(&candidates);
    return 1;
  }
  if (ensure_dir(out_root) != 0) {
    fprintf(stderr, "[r2c-compile] failed to create out root: %s\n", out_root);
    path_list_free(&candidates);
    return 1;
  }

  char project_name[PATH_MAX];
  basename_copy(project, project_name, sizeof(project_name));
  if (project_name[0] == '\0') snprintf(project_name, sizeof(project_name), "r2capp");

  const char *profile = getenv("CHENG_R2C_PROFILE");
  if (profile == NULL || profile[0] == '\0') profile = "generic";

  setenv("R2C_IN_ROOT", project, 1);
  setenv("R2C_OUT_ROOT", out_root, 1);
  setenv("R2C_ENTRY", entry, 1);
  setenv("R2C_PROJECT_NAME", project_name, 1);
  setenv("R2C_PROFILE", profile, 1);
  setenv("R2C_STRICT", strict ? "1" : "0", 1);
  setenv("CHENG_R2C_IN_ROOT", project, 1);
  setenv("CHENG_R2C_OUT_ROOT", out_root, 1);
  setenv("CHENG_R2C_ENTRY", entry, 1);
  setenv("CHENG_R2C_PROJECT_NAME", project_name, 1);
  setenv("CHENG_R2C_PROFILE", profile, 1);
  setenv("CHENG_R2C_STRICT", strict ? "1" : "0", 1);

  if (strict) {
    setenv("R2C_SKIP_COMPILER_EXEC", "0", 1);
    setenv("R2C_SKIP_COMPILER_RUN", "0", 1);
    setenv("R2C_REUSE_COMPILER_BIN", "0", 1);
    setenv("R2C_REUSE_RUNTIME_BINS", "0", 1);
  }

  char compile_log[PATH_MAX];
  if (path_join(compile_log, sizeof(compile_log), out_dir, "r2c_compile.native.log") != 0) return 1;

  int timeout_sec = parse_positive_int_env("R2C_COMPILER_RUN_TIMEOUT_SEC", strict ? 60 : 0);
  char report_path[PATH_MAX];
  if (path_join(report_path, sizeof(report_path), out_root, "r2capp_compile_report.json") != 0) {
    path_list_free(&candidates);
    return 1;
  }

  {
    char request_env_path[PATH_MAX];
    if (path_join(request_env_path, sizeof(request_env_path), out_dir, "r2c_compile_request.env") == 0) {
      FILE *req = fopen(request_env_path, "wb");
      if (req != NULL) {
        fprintf(req, "R2C_IN_ROOT=%s\n", project);
        fprintf(req, "R2C_OUT_ROOT=%s\n", out_root);
        fprintf(req, "R2C_ENTRY=%s\n", entry);
        fprintf(req, "R2C_PROFILE=%s\n", profile);
        fprintf(req, "R2C_PROJECT_NAME=%s\n", project_name);
        fprintf(req, "R2C_STRICT=%d\n", strict ? 1 : 0);
        fclose(req);
      }
    }
  }

  bool compiled_ok = false;
  for (size_t i = 0u; i < candidates.len; ++i) {
    const char *compiler_bin = candidates.items[i];
    if (!path_executable(compiler_bin)) continue;
    char broken_reason[256];
    if (compiler_binary_appears_broken(compiler_bin, broken_reason, sizeof(broken_reason))) {
      fprintf(stderr,
              "[r2c-compile] skip broken compiler candidate: %s (%s)\n",
              compiler_bin,
              broken_reason[0] != '\0' ? broken_reason : "load check failed");
      continue;
    }

    if (dir_exists(out_root)) {
      if (remove_tree(out_root) != 0) {
        fprintf(stderr, "[r2c-compile] failed to clean out root before retry: %s\n", out_root);
        path_list_free(&candidates);
        return 1;
      }
    }
    if (ensure_dir(out_root) != 0) {
      fprintf(stderr, "[r2c-compile] failed to recreate out root: %s\n", out_root);
      path_list_free(&candidates);
      return 1;
    }

    char attempt_log[PATH_MAX];
    if (snprintf(attempt_log, sizeof(attempt_log), "%s/r2c_compile.native.%zu.log", out_dir, i + 1u) >=
        (int)sizeof(attempt_log)) {
      path_list_free(&candidates);
      return 1;
    }

    fprintf(stderr, "[r2c-compile] trying compiler[%zu/%zu]: %s\n", i + 1u, candidates.len, compiler_bin);
    char *compile_argv[] = {(char *)compiler_bin, NULL};
    RunResult rr = run_command(compile_argv, out_dir, attempt_log, timeout_sec);
    if (rr.code != 0) {
      if (rr.timed_out) {
        fprintf(stderr,
                "[r2c-compile] candidate timeout after %ds: %s (log=%s)\n",
                timeout_sec,
                compiler_bin,
                attempt_log);
      } else {
        fprintf(stderr, "[r2c-compile] candidate failed rc=%d: %s (log=%s)\n", rr.code, compiler_bin, attempt_log);
      }
      continue;
    }

    if (!file_exists(report_path)) {
      fprintf(stderr, "[r2c-compile] candidate produced no report: %s (compiler=%s)\n", report_path, compiler_bin);
      continue;
    }
    if (!backfill_route_tree_layers_meta(report_path)) {
      fprintf(stderr,
              "[r2c-compile] failed to backfill route tree/layers metadata: %s\n",
              report_path);
      continue;
    }
    if (!validate_compile_report(report_path, strict)) {
      fprintf(stderr, "[r2c-compile] candidate report rejected: %s\n", compiler_bin);
      continue;
    }
    if (!backfill_semantic_render_meta(report_path)) {
      fprintf(stderr, "[r2c-compile] failed to backfill semantic_render_nodes_hash/fnv64: %s\n", report_path);
      continue;
    }
    if (!ensure_android_payload_object(out_dir)) {
      fprintf(stderr, "[r2c-compile] failed to materialize android payload object for target matrix=%s\n",
              getenv("R2C_TARGET_MATRIX") ? getenv("R2C_TARGET_MATRIX") : "");
      continue;
    }

    compiled_ok = true;
    FILE *dst = fopen(compile_log, "wb");
    if (dst != NULL) {
      FILE *src = fopen(attempt_log, "rb");
      if (src != NULL) {
        char buf[4096];
        size_t n = 0u;
        while ((n = fread(buf, 1u, sizeof(buf), src)) > 0u) fwrite(buf, 1u, n, dst);
        fclose(src);
      }
      fclose(dst);
    }
    break;
  }

  if (!compiled_ok) {
    fprintf(stderr, "[r2c-compile] all compiler candidates failed strict validation\n");
    path_list_free(&candidates);
    return 1;
  }

  path_list_free(&candidates);
  return 0;
}
