#define _POSIX_C_SOURCE 200809L

#include "native_mobile_run_android.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

static int run_simple(char *const argv[], int timeout_sec, char **out);

static void strlist_free(StringList *list) {
  if (list == NULL) return;
  for (size_t i = 0; i < list->len; ++i) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static int strlist_push(StringList *list, const char *value) {
  if (list == NULL || value == NULL) return -1;
  if (list->len >= list->cap) {
    size_t next = (list->cap == 0u) ? 16u : list->cap * 2u;
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

static uint64_t fnv1a64_extend(uint64_t seed, const unsigned char *data, size_t n) {
  uint64_t h = seed;
  for (size_t i = 0; i < n; ++i) {
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
    size_t n = fread(buf, 1u, sizeof(buf), fp);
    if (n > 0u) h = fnv1a64_extend(h, buf, n);
    if (n < sizeof(buf)) {
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

static char *json_inject_string_field_if_missing(const char *doc, const char *key, const char *value) {
  if (doc == NULL || key == NULL || key[0] == '\0' || value == NULL) return NULL;
  char key_pat[256];
  if (snprintf(key_pat, sizeof(key_pat), "\"%s\"", key) >= (int)sizeof(key_pat)) return NULL;
  if (strstr(doc, key_pat) != NULL) return strdup(doc);

  size_t n = strlen(doc);
  size_t end = n;
  while (end > 0u && isspace((unsigned char)doc[end - 1u])) end -= 1u;
  if (end == 0u || doc[end - 1u] != '}') return strdup(doc);

  size_t insert = end - 1u;
  size_t p = insert;
  while (p > 0u && isspace((unsigned char)doc[p - 1u])) p -= 1u;
  bool need_comma = (p > 0u && doc[p - 1u] != '{');

  char field[1024];
  if (snprintf(field,
               sizeof(field),
               "%s\"%s\":\"%s\"",
               need_comma ? "," : "",
               key,
               value) >= (int)sizeof(field)) {
    return NULL;
  }

  size_t field_len = strlen(field);
  char *out = (char *)malloc(n + field_len + 1u);
  if (out == NULL) return NULL;
  memcpy(out, doc, insert);
  memcpy(out + insert, field, field_len);
  memcpy(out + insert + field_len, doc + insert, n - insert);
  out[n + field_len] = '\0';
  return out;
}

static bool runtime_state_render_ready(const char *doc) {
  if (doc == NULL || doc[0] == '\0') return false;
  if (strstr(doc, "\"render_ready\":true") != NULL || strstr(doc, "\"render_ready\": true") != NULL) {
    return true;
  }
  const char *last_error = strstr(doc, "\"last_error\":\"");
  if (last_error != NULL && strstr(last_error, "sr=1") != NULL) {
    return true;
  }
  return false;
}

static const char *json_find_value(const char *doc, const char *key) {
  if (doc == NULL || key == NULL || key[0] == '\0') return NULL;
  char pattern[128];
  if (snprintf(pattern, sizeof(pattern), "\"%s\"", key) >= (int)sizeof(pattern)) return NULL;
  const char *p = strstr(doc, pattern);
  if (p == NULL) return NULL;
  p += strlen(pattern);
  while (*p != '\0' && isspace((unsigned char)*p)) p += 1;
  if (*p != ':') return NULL;
  p += 1;
  while (*p != '\0' && isspace((unsigned char)*p)) p += 1;
  return p;
}

static bool json_get_string_field(const char *doc, const char *key, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (doc == NULL || key == NULL || out == NULL || out_cap < 2u) return false;
  const char *p = json_find_value(doc, key);
  if (p == NULL || *p != '"') return false;
  p += 1;
  size_t n = 0u;
  while (*p != '\0' && *p != '"') {
    if (*p == '\\' && p[1] != '\0') p += 1;
    if (n + 1u >= out_cap) break;
    out[n++] = *p;
    p += 1;
  }
  out[n] = '\0';
  return n > 0u;
}

static bool json_get_int64_field(const char *doc, const char *key, long long *out_value) {
  if (out_value != NULL) *out_value = 0;
  if (doc == NULL || key == NULL || out_value == NULL) return false;
  const char *p = json_find_value(doc, key);
  if (p == NULL) return false;
  char *end = NULL;
  long long value = strtoll(p, &end, 10);
  if (end == p) return false;
  *out_value = value;
  return true;
}

static bool runtime_state_has_nonzero_hash(const char *doc) {
  if (doc == NULL || doc[0] == '\0') return false;
  char hash[64];
  if (!json_get_string_field(doc, "last_frame_hash", hash, sizeof(hash))) return false;
  for (size_t i = 0u; hash[i] != '\0'; ++i) {
    if (hash[i] != '0') return true;
  }
  return false;
}

static bool parse_current_focus_component(const char *dumpsys, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (dumpsys == NULL || out == NULL || out_cap == 0u) return false;
  const char *key = "mCurrentFocus=Window{";
  const char *p = strstr(dumpsys, key);
  if (p == NULL) return false;
  p += strlen(key);
  const char *u = strstr(p, " u");
  if (u == NULL) return false;
  u += 2;
  while (*u != '\0' && isdigit((unsigned char)*u)) u += 1;
  while (*u == ' ') u += 1;
  if (*u == '\0') return false;
  size_t n = 0u;
  while (u[n] != '\0' && !isspace((unsigned char)u[n]) && u[n] != '}') n += 1u;
  if (n == 0u) return false;
  if (n >= out_cap) n = out_cap - 1u;
  memcpy(out, u, n);
  out[n] = '\0';
  return true;
}

static int query_current_focus_component(const char *adb, const char *serial, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (adb == NULL || serial == NULL || out == NULL || out_cap == 0u) return -1;
  char *argv[] = {(char *)adb, "-s", (char *)serial, "shell", "dumpsys", "window", NULL};
  char *doc = NULL;
  int rc = run_simple(argv, 15, &doc);
  if (rc != 0 || doc == NULL) {
    free(doc);
    return -1;
  }
  bool ok = parse_current_focus_component(doc, out, out_cap);
  free(doc);
  return ok ? 0 : -1;
}

static bool starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
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

static int copy_file(const char *src, const char *dst, mode_t mode) {
  if (src == NULL || dst == NULL) return -1;
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
    if (rd > 0u) {
      if (fwrite(buf, 1u, rd, out) != rd) {
        fclose(in);
        fclose(out);
        return -1;
      }
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
  fclose(in);
  if (fclose(out) != 0) return -1;
  if (chmod(dst, mode) != 0) {
    if (mode & S_IXUSR) (void)chmod(dst, 0755);
  }
  return 0;
}

static int copy_tree(const char *src, const char *dst) {
  if (src == NULL || dst == NULL) return -1;
  struct stat st;
  if (stat(src, &st) != 0) return -1;
  if (S_ISREG(st.st_mode)) {
    return copy_file(src, dst, st.st_mode);
  }
  if (!S_ISDIR(st.st_mode)) return -1;
  if (ensure_dir(dst) != 0) return -1;
  DIR *dir = opendir(src);
  if (dir == NULL) return -1;
  struct dirent *ent = NULL;
  while ((ent = readdir(dir)) != NULL) {
    const char *name = ent->d_name;
    if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) continue;
    char src_child[PATH_MAX];
    char dst_child[PATH_MAX];
    if (path_join(src_child, sizeof(src_child), src, name) != 0 ||
        path_join(dst_child, sizeof(dst_child), dst, name) != 0) {
      closedir(dir);
      return -1;
    }
    struct stat child_st;
    if (stat(src_child, &child_st) != 0) continue;
    if (S_ISDIR(child_st.st_mode)) {
      if (copy_tree(src_child, dst_child) != 0) {
        closedir(dir);
        return -1;
      }
    } else if (S_ISREG(child_st.st_mode)) {
      if (copy_file(src_child, dst_child, child_st.st_mode) != 0) {
        closedir(dir);
        return -1;
      }
    }
  }
  closedir(dir);
  return 0;
}

static int resolve_repo_root(const char *scripts_dir, char *out, size_t out_cap) {
  if (scripts_dir == NULL || scripts_dir[0] == '\0' || out == NULL || out_cap == 0u) return -1;
  if (snprintf(out, out_cap, "%s", scripts_dir) >= (int)out_cap) return -1;
  size_t n = strlen(out);
  if (n >= 12u && strcmp(out + n - 12u, "/src/scripts") == 0) {
    out[n - 12u] = '\0';
  } else if (n >= 8u && strcmp(out + n - 8u, "/scripts") == 0) {
    out[n - 8u] = '\0';
  }
  return 0;
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
    int devnull = open("/dev/null", O_RDONLY);
    if (devnull >= 0) {
      (void)dup2(devnull, STDIN_FILENO);
      close(devnull);
    }
    dup2(pipefd[1], STDOUT_FILENO);
    dup2(pipefd[1], STDERR_FILENO);
    close(pipefd[0]);
    close(pipefd[1]);
    execvp(argv[0], argv);
    _exit(127);
  }
  close(pipefd[1]);
  setpgid(pid, pid);
  int flags = fcntl(pipefd[0], F_GETFL, 0);
  if (flags >= 0) {
    (void)fcntl(pipefd[0], F_SETFL, flags | O_NONBLOCK);
  }

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
  int status = 0;
  bool pipe_open = true;
  bool child_done = false;
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
      (void)waitpid(pid, &status, 0);
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
    if (timeout_sec > 0 && !child_done) {
      time_t now = time(NULL);
      long remain = (long)(deadline - now);
      if (remain < 0L) remain = 0L;
      if (remain < (long)tv.tv_sec) {
        tv.tv_sec = remain;
        tv.tv_usec = 0;
      }
    }
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
  if (path_env == NULL) return false;
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

static bool resolve_adb_executable(char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  const char *env_adb = getenv("CHENG_ANDROID_ADB");
  if (env_adb != NULL && env_adb[0] != '\0' && access(env_adb, X_OK) == 0) {
    snprintf(out, out_cap, "%s", env_adb);
    return true;
  }
  const char *sdk = getenv("ANDROID_SDK_ROOT");
  if (sdk == NULL || sdk[0] == '\0') sdk = getenv("ANDROID_HOME");
  if (sdk != NULL && sdk[0] != '\0') {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/platform-tools/adb", sdk) < (int)sizeof(candidate) &&
        access(candidate, X_OK) == 0) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  const char *home = getenv("HOME");
  if (home != NULL && home[0] != '\0') {
    char candidate[PATH_MAX];
    if (snprintf(candidate, sizeof(candidate), "%s/Library/Android/sdk/platform-tools/adb", home) <
            (int)sizeof(candidate) &&
        access(candidate, X_OK) == 0) {
      snprintf(out, out_cap, "%s", candidate);
      return true;
    }
  }
  return find_executable_in_path("adb", out, out_cap);
}

static bool resolve_adb_and_serial(char *adb, size_t adb_cap, char *serial, size_t serial_cap) {
  if (!resolve_adb_executable(adb, adb_cap)) return false;
  const char *forced = getenv("ANDROID_SERIAL");
  if (forced != NULL && forced[0] != '\0') {
    snprintf(serial, serial_cap, "%s", forced);
    return true;
  }
  char *out = NULL;
  char *argv[] = {adb, "devices", NULL};
  int rc = run_capture(argv, &out, 10);
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
      snprintf(serial, serial_cap, "%s", id);
      ok = true;
      break;
    }
  }
  free(out);
  return ok;
}

static char *base64url_encode(const unsigned char *src, size_t n) {
  static const char *kAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  if (src == NULL) return strdup("");
  size_t out_cap = ((n + 2u) / 3u) * 4u + 4u;
  char *out = (char *)malloc(out_cap);
  if (out == NULL) return NULL;
  size_t i = 0u;
  size_t j = 0u;
  while (i + 3u <= n) {
    uint32_t v = ((uint32_t)src[i] << 16) | ((uint32_t)src[i + 1] << 8) | (uint32_t)src[i + 2];
    out[j++] = kAlphabet[(v >> 18) & 0x3F];
    out[j++] = kAlphabet[(v >> 12) & 0x3F];
    out[j++] = kAlphabet[(v >> 6) & 0x3F];
    out[j++] = kAlphabet[v & 0x3F];
    i += 3u;
  }
  size_t rem = n - i;
  if (rem == 1u) {
    uint32_t v = ((uint32_t)src[i] << 16);
    out[j++] = kAlphabet[(v >> 18) & 0x3F];
    out[j++] = kAlphabet[(v >> 12) & 0x3F];
  } else if (rem == 2u) {
    uint32_t v = ((uint32_t)src[i] << 16) | ((uint32_t)src[i + 1] << 8);
    out[j++] = kAlphabet[(v >> 18) & 0x3F];
    out[j++] = kAlphabet[(v >> 12) & 0x3F];
    out[j++] = kAlphabet[(v >> 6) & 0x3F];
  }
  out[j] = '\0';
  return out;
}

static char *join_app_args(const StringList *list) {
  if (list == NULL || list->len == 0u) return strdup("");
  size_t cap = 1u;
  for (size_t i = 0; i < list->len; ++i) cap += strlen(list->items[i]) + 1u;
  char *out = (char *)malloc(cap);
  if (out == NULL) return NULL;
  out[0] = '\0';
  for (size_t i = 0; i < list->len; ++i) {
    if (i > 0u) strcat(out, ";");
    strcat(out, list->items[i]);
  }
  return out;
}

static bool strlist_has_kv_key(const StringList *list, const char *key) {
  if (list == NULL || key == NULL || key[0] == '\0') return false;
  size_t key_len = strlen(key);
  for (size_t i = 0; i < list->len; ++i) {
    const char *entry = list->items[i];
    if (entry == NULL || entry[0] == '\0') continue;
    const char *eq = strchr(entry, '=');
    size_t name_len = (eq != NULL) ? (size_t)(eq - entry) : strlen(entry);
    if (name_len == key_len && strncmp(entry, key, key_len) == 0) return true;
  }
  return false;
}

static bool strlist_get_kv_value(const StringList *list, const char *key, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (list == NULL || key == NULL || key[0] == '\0' || out == NULL || out_cap < 2u) return false;
  size_t key_len = strlen(key);
  for (size_t i = 0; i < list->len; ++i) {
    const char *entry = list->items[i];
    if (entry == NULL || entry[0] == '\0') continue;
    const char *eq = strchr(entry, '=');
    size_t name_len = (eq != NULL) ? (size_t)(eq - entry) : strlen(entry);
    if (name_len == key_len && strncmp(entry, key, key_len) == 0 && eq != NULL && eq[1] != '\0') {
      size_t value_len = strlen(eq + 1);
      if (value_len >= out_cap) value_len = out_cap - 1u;
      memcpy(out, eq + 1, value_len);
      out[value_len] = '\0';
      return true;
    }
  }
  return false;
}

static bool json_file_get_nonempty_route_state(const char *path, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (path == NULL || path[0] == '\0' || !file_exists(path) || out == NULL || out_cap < 2u) return false;
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  bool ok = false;
  const char *p = strstr(doc, "\"route_state\"");
  if (p != NULL) {
    p = strchr(p, ':');
    if (p != NULL) {
      p += 1;
      while (*p != '\0' && isspace((unsigned char)*p)) p += 1;
      if (*p == '"') {
        p += 1;
        const char *start = p;
        while (*p != '\0' && *p != '"') p += 1;
        if (p > start) {
          size_t len = (size_t)(p - start);
          if (len >= out_cap) len = out_cap - 1u;
          memcpy(out, start, len);
          out[len] = '\0';
          ok = true;
        }
      }
    }
  }
  free(doc);
  return ok;
}

static bool read_truth_runtime_framehash(const char *assets_dir,
                                         const char *route_state,
                                         char *out_hash,
                                         size_t out_hash_cap) {
  if (out_hash != NULL && out_hash_cap > 0u) out_hash[0] = '\0';
  if (assets_dir == NULL || assets_dir[0] == '\0' || route_state == NULL || route_state[0] == '\0' ||
      out_hash == NULL || out_hash_cap < 2u) {
    return false;
  }
  char truth_dir[PATH_MAX];
  char hash_path[PATH_MAX];
  if (path_join(truth_dir, sizeof(truth_dir), assets_dir, "truth") != 0 ||
      path_join(hash_path, sizeof(hash_path), truth_dir, route_state) != 0) {
    return false;
  }
  size_t prefix_len = strlen(hash_path);
  if (prefix_len + strlen(".runtime_framehash") >= sizeof(hash_path)) return false;
  memcpy(hash_path + prefix_len, ".runtime_framehash", strlen(".runtime_framehash") + 1u);
  size_t n = 0u;
  char *doc = read_file_all(hash_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  size_t s = 0u;
  while (s < n && isspace((unsigned char)doc[s])) s += 1u;
  size_t e = n;
  while (e > s && isspace((unsigned char)doc[e - 1u])) e -= 1u;
  if (e <= s) {
    free(doc);
    return false;
  }
  size_t len = e - s;
  if (len >= out_hash_cap) len = out_hash_cap - 1u;
  memcpy(out_hash, doc + s, len);
  out_hash[len] = '\0';
  free(doc);
  return (out_hash[0] != '\0');
}

static int run_simple(char *const argv[], int timeout_sec, char **out) {
  int rc = run_capture(argv, out, timeout_sec);
  return rc;
}

static bool parse_kv_value(const char *kv, const char *key, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (kv == NULL || key == NULL || key[0] == '\0' || out == NULL || out_cap < 2u) return false;
  size_t key_len = strlen(key);
  const char *p = kv;
  while (*p != '\0') {
    while (*p == ';') p++;
    if (*p == '\0') break;
    const char *entry = p;
    while (*p != '\0' && *p != ';') p++;
    const char *entry_end = p;
    const char *eq = entry;
    while (eq < entry_end && *eq != '=') eq++;
    if (eq < entry_end) {
      size_t name_len = (size_t)(eq - entry);
      if (name_len == key_len && strncmp(entry, key, key_len) == 0) {
        const char *value = eq + 1;
        size_t value_len = (size_t)(entry_end - value);
        if (value_len >= out_cap) value_len = out_cap - 1u;
        memcpy(out, value, value_len);
        out[value_len] = '\0';
        return true;
      }
    }
  }
  return false;
}

static int sync_truth_route_asset_file(const char *adb,
                                       const char *serial,
                                       const char *pkg,
                                       const char *truth_src_dir,
                                       const char *route_state,
                                       const char *suffix) {
  if (adb == NULL || serial == NULL || pkg == NULL || truth_src_dir == NULL || route_state == NULL || suffix == NULL) {
    return -1;
  }
  char src[PATH_MAX];
  if (snprintf(src, sizeof(src), "%s/%s.%s", truth_src_dir, route_state, suffix) >= (int)sizeof(src)) return -1;
  if (!file_exists(src)) return 0;

  char remote_tmp[PATH_MAX];
  char remote_dst[PATH_MAX];
  if (snprintf(remote_tmp,
               sizeof(remote_tmp),
               "/data/local/tmp/cheng_truth_%d_%s.%s",
               (int)getpid(),
               route_state,
               suffix) >= (int)sizeof(remote_tmp) ||
      snprintf(remote_dst, sizeof(remote_dst), "files/cheng_assets/truth/%s.%s", route_state, suffix) >=
          (int)sizeof(remote_dst)) {
    return -1;
  }

  char *push_argv[] = {(char *)adb, "-s", (char *)serial, "push", src, remote_tmp, NULL};
  char *push_out = NULL;
  int push_rc = run_simple(push_argv, 30, &push_out);
  if (push_rc != 0) {
    fprintf(stderr,
            "[mobile-run-android] truth sync push failed route=%s suffix=%s rc=%d\n%s\n",
            route_state,
            suffix,
            push_rc,
            push_out ? push_out : "");
    free(push_out);
    return -1;
  }
  free(push_out);

  char *mkdir_argv[] = {(char *)adb,
                        "-s",
                        (char *)serial,
                        "shell",
                        "run-as",
                        (char *)pkg,
                        "mkdir",
                        "-p",
                        "files/cheng_assets/truth",
                        NULL};
  if (run_simple(mkdir_argv, 10, NULL) != 0) {
    fprintf(stderr, "[mobile-run-android] truth sync mkdir failed route=%s\n", route_state);
    char *rm_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "rm", "-f", remote_tmp, NULL};
    (void)run_simple(rm_argv, 10, NULL);
    return -1;
  }

  char *cp_argv[] = {(char *)adb,
                     "-s",
                     (char *)serial,
                     "shell",
                     "run-as",
                     (char *)pkg,
                     "cp",
                     remote_tmp,
                     remote_dst,
                     NULL};
  char *cp_out = NULL;
  int cp_rc = run_simple(cp_argv, 15, &cp_out);
  char *rm_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "rm", "-f", remote_tmp, NULL};
  (void)run_simple(rm_argv, 10, NULL);
  if (cp_rc != 0) {
    fprintf(stderr,
            "[mobile-run-android] truth sync copy failed route=%s suffix=%s rc=%d\n%s\n",
            route_state,
            suffix,
            cp_rc,
            cp_out ? cp_out : "");
    free(cp_out);
    return -1;
  }
  free(cp_out);
  return 1;
}

static void remove_remote_truth_route_assets(const char *adb,
                                             const char *serial,
                                             const char *pkg,
                                             const char *route_state) {
  if (adb == NULL || serial == NULL || pkg == NULL || route_state == NULL || route_state[0] == '\0') return;
  const char *suffixes[] = {"rgba", "meta.json", "runtime_framehash", "framehash"};
  for (size_t i = 0u; i < sizeof(suffixes) / sizeof(suffixes[0]); ++i) {
    char remote_dst[PATH_MAX];
    if (snprintf(remote_dst,
                 sizeof(remote_dst),
                 "files/cheng_assets/truth/%s.%s",
                 route_state,
                 suffixes[i]) >= (int)sizeof(remote_dst)) {
      continue;
    }
    char *rm_argv[] = {(char *)adb,
                       "-s",
                       (char *)serial,
                       "shell",
                       "run-as",
                       (char *)pkg,
                       "rm",
                       "-f",
                       remote_dst,
                       NULL};
    (void)run_simple(rm_argv, 10, NULL);
  }
}

static int sync_truth_route_assets(const char *adb,
                                   const char *serial,
                                   const char *pkg,
                                   const char *assets_dir,
                                   const char *kv) {
  if (adb == NULL || serial == NULL || pkg == NULL || assets_dir == NULL || kv == NULL) return 0;
  char route_state[128];
  route_state[0] = '\0';
  if (!parse_kv_value(kv, "route_state", route_state, sizeof(route_state)) || route_state[0] == '\0') return 0;
  char truth_src_dir[PATH_MAX];
  if (path_join(truth_src_dir, sizeof(truth_src_dir), assets_dir, "truth") != 0 || !dir_exists(truth_src_dir)) {
    fprintf(stderr,
            "[mobile-run-android] missing truth dir for route=%s dir=%s/truth\n",
            route_state,
            assets_dir);
    remove_remote_truth_route_assets(adb, serial, pkg, route_state);
    return -1;
  }
  int rgba_sync = sync_truth_route_asset_file(adb, serial, pkg, truth_src_dir, route_state, "rgba");
  if (rgba_sync < 0) return -1;
  if (rgba_sync == 0) {
    fprintf(stderr,
            "[mobile-run-android] missing truth rgba for route=%s src=%s/%s.rgba\n",
            route_state,
            truth_src_dir,
            route_state);
    remove_remote_truth_route_assets(adb, serial, pkg, route_state);
    return -1;
  }
  (void)sync_truth_route_asset_file(adb, serial, pkg, truth_src_dir, route_state, "meta.json");
  int runtime_hash_sync =
      sync_truth_route_asset_file(adb, serial, pkg, truth_src_dir, route_state, "runtime_framehash");
  if (runtime_hash_sync < 0) return -1;
  if (runtime_hash_sync == 0) {
    fprintf(stderr,
            "[mobile-run-android] missing truth runtime_framehash for route=%s src=%s/%s.runtime_framehash\n",
            route_state,
            truth_src_dir,
            route_state);
    remove_remote_truth_route_assets(adb, serial, pkg, route_state);
    return -1;
  }
  int framehash_sync = sync_truth_route_asset_file(adb, serial, pkg, truth_src_dir, route_state, "framehash");
  if (framehash_sync < 0) return -1;
  if (framehash_sync == 0) {
    fprintf(stderr,
            "[mobile-run-android] missing truth framehash for route=%s src=%s/%s.framehash\n",
            route_state,
            truth_src_dir,
            route_state);
    remove_remote_truth_route_assets(adb, serial, pkg, route_state);
    return -1;
  }
  fprintf(stdout, "[mobile-run-android] truth route synced: %s\n", route_state);
  return 0;
}

static int parse_positive_int_env(const char *name, int fallback) {
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return fallback;
  char *end = NULL;
  long v = strtol(raw, &end, 10);
  if (end == raw || *end != '\0' || v <= 0 || v > 86400) return fallback;
  return (int)v;
}

static int run_direct_launch_smoke(const char *adb,
                                   const char *serial,
                                   const char *pkg,
                                   const char *activity,
                                   const char *expected_route,
                                   int wait_ms) {
  if (adb == NULL || serial == NULL || pkg == NULL || activity == NULL || expected_route == NULL ||
      expected_route[0] == '\0') {
    return -1;
  }
  fprintf(stdout, "[mobile-run-android] direct-launch-smoke route=%s\n", expected_route);

  char *force_stop[] = {(char *)adb, "-s", (char *)serial, "shell", "am", "force-stop", (char *)pkg, NULL};
  (void)run_simple(force_stop, 10, NULL);
  char *rm_state[] = {(char *)adb,
                      "-s",
                      (char *)serial,
                      "shell",
                      "run-as",
                      (char *)pkg,
                      "rm",
                      "-f",
                      "files/cheng_runtime_state.json",
                      NULL};
  (void)run_simple(rm_state, 10, NULL);

  char *start_argv[] = {(char *)adb,
                        "-s",
                        (char *)serial,
                        "shell",
                        "am",
                        "start-activity",
                        "-S",
                        "--windowingMode",
                        "1",
                        "-W",
                        "-n",
                        (char *)activity,
                        NULL};
  char *start_out = NULL;
  int start_rc = run_simple(start_argv, 20, &start_out);
  if (start_rc != 0) {
    fprintf(stderr,
            "[mobile-run-android] direct-launch-smoke start failed rc=%d\n%s\n",
            start_rc,
            start_out ? start_out : "");
    free(start_out);
    return -1;
  }
  free(start_out);

  int poll_times = wait_ms / 250;
  if (poll_times < 1) poll_times = 1;
  char *state_text = NULL;
  for (int i = 0; i < poll_times; ++i) {
    char *cat_argv[] = {(char *)adb,
                        "-s",
                        (char *)serial,
                        "shell",
                        "run-as",
                        (char *)pkg,
                        "cat",
                        "files/cheng_runtime_state.json",
                        NULL};
    char *out = NULL;
    int rc = run_simple(cat_argv, 5, &out);
    if (rc == 0 && out != NULL && out[0] != '\0') {
      free(state_text);
      state_text = out;
      if (runtime_state_render_ready(out)) {
        break;
      }
      usleep(250000);
      continue;
    }
    free(out);
    usleep(250000);
  }
  if (state_text == NULL) {
    fprintf(stderr, "[mobile-run-android] direct-launch-smoke missing runtime state\n");
    return -1;
  }
  char launch_kv[4096];
  char gate_mode[128];
  char truth_mode[128];
  char expected_framehash[128];
  launch_kv[0] = '\0';
  gate_mode[0] = '\0';
  truth_mode[0] = '\0';
  expected_framehash[0] = '\0';
  if (!json_get_string_field(state_text, "launch_args_kv", launch_kv, sizeof(launch_kv))) {
    fprintf(stderr, "[mobile-run-android] direct-launch-smoke missing launch_args_kv\n");
    free(state_text);
    return -1;
  }
  if (!parse_kv_value(launch_kv, "gate_mode", gate_mode, sizeof(gate_mode)) ||
      strcmp(gate_mode, "android-semantic-visual-1to1") != 0) {
    fprintf(stderr, "[mobile-run-android] direct-launch-smoke gate_mode is not strict visual 1:1\n");
    free(state_text);
    return -1;
  }
  if (!parse_kv_value(launch_kv, "truth_mode", truth_mode, sizeof(truth_mode)) ||
      strcmp(truth_mode, "strict") != 0) {
    fprintf(stderr, "[mobile-run-android] direct-launch-smoke truth_mode is not strict\n");
    free(state_text);
    return -1;
  }
  if (!parse_kv_value(launch_kv, "expected_framehash", expected_framehash, sizeof(expected_framehash)) ||
      expected_framehash[0] == '\0') {
    fprintf(stderr, "[mobile-run-android] direct-launch-smoke missing expected_framehash\n");
    free(state_text);
    return -1;
  }
  if (!runtime_state_render_ready(state_text)) {
    fprintf(stderr, "[mobile-run-android] direct-launch-smoke render_ready=false\n");
    free(state_text);
    return -1;
  }
  if (!runtime_state_has_nonzero_hash(state_text)) {
    fprintf(stderr, "[mobile-run-android] direct-launch-smoke last_frame_hash is zero\n");
    free(state_text);
    return -1;
  }
  char route_state[128];
  route_state[0] = '\0';
  if (!json_get_string_field(state_text, "route_state", route_state, sizeof(route_state)) ||
      strcmp(route_state, expected_route) != 0) {
    fprintf(stderr,
            "[mobile-run-android] direct-launch-smoke route mismatch expected=%s got=%s\n",
            expected_route,
            route_state[0] != '\0' ? route_state : "<empty>");
    free(state_text);
    return -1;
  }
  long long applied = 0;
  if (!json_get_int64_field(state_text, "semantic_nodes_applied_count", &applied) || applied <= 0) {
    fprintf(stderr,
            "[mobile-run-android] direct-launch-smoke semantic_nodes_applied_count invalid: %lld\n",
            applied);
    free(state_text);
    return -1;
  }
  fprintf(stdout,
          "[mobile-run-android] direct-launch-smoke ok route=%s semantic_nodes_applied_count=%lld\n",
          route_state,
          applied);
  free(state_text);
  return 0;
}

static char *shell_single_quote(const char *text) {
  if (text == NULL) return strdup("''");
  size_t len = strlen(text);
  size_t cap = len * 4u + 3u;
  char *out = (char *)malloc(cap);
  if (out == NULL) return NULL;
  size_t j = 0u;
  out[j++] = '\'';
  for (size_t i = 0u; i < len; ++i) {
    if (text[i] == '\'') {
      if (j + 4u >= cap) {
        free(out);
        return NULL;
      }
      out[j++] = '\'';
      out[j++] = '\\';
      out[j++] = '\'';
      out[j++] = '\'';
    } else {
      if (j + 1u >= cap) {
        free(out);
        return NULL;
      }
      out[j++] = text[i];
    }
  }
  out[j++] = '\'';
  out[j] = '\0';
  return out;
}

static int copy_named_file(const char *src_dir, const char *filename, const char *dst_dir) {
  char src[PATH_MAX];
  char dst[PATH_MAX];
  if (path_join(src, sizeof(src), src_dir, filename) != 0 || path_join(dst, sizeof(dst), dst_dir, filename) != 0) {
    return -1;
  }
  struct stat st;
  if (stat(src, &st) != 0 || !S_ISREG(st.st_mode)) return -1;
  return copy_file(src, dst, st.st_mode);
}

static int prepare_android_project(const char *root,
                                   const char *project_dir,
                                   const char *assets_dir,
                                   const char *native_obj) {
  const char *cheng_mobile_root = getenv("CHENG_MOBILE_ROOT");
  if (cheng_mobile_root == NULL || cheng_mobile_root[0] == '\0') {
    cheng_mobile_root = "/Users/lbcheng/.cheng-packages/cheng-mobile";
  }
  const char *cheng_lang_root = getenv("CHENG_LANG_ROOT");
  if (cheng_lang_root == NULL || cheng_lang_root[0] == '\0') {
    cheng_lang_root = "/Users/lbcheng/cheng-lang";
  }

  char template_dir[PATH_MAX];
  if (path_join(template_dir, sizeof(template_dir), cheng_mobile_root, "src/android/project_template") != 0 ||
      !dir_exists(template_dir)) {
    fprintf(stderr, "[mobile-run-android] missing project template: %s\n", template_dir);
    return 1;
  }
  (void)remove_tree(project_dir);
  if (copy_tree(template_dir, project_dir) != 0) {
    fprintf(stderr, "[mobile-run-android] failed to copy Android project template\n");
    return 1;
  }

  char cpp_dir[PATH_MAX];
  if (path_join(cpp_dir, sizeof(cpp_dir), project_dir, "app/src/main/cpp") != 0 || ensure_dir(cpp_dir) != 0) {
    fprintf(stderr, "[mobile-run-android] failed to prepare cpp dir\n");
    return 1;
  }

  char android_src[PATH_MAX];
  char bridge_src[PATH_MAX];
  char runtime_mobile_src[PATH_MAX];
  char runtime_native_src[PATH_MAX];
  if (path_join(android_src, sizeof(android_src), cheng_mobile_root, "src/android") != 0 ||
      path_join(bridge_src, sizeof(bridge_src), cheng_mobile_root, "src/bridge") != 0 ||
      path_join(runtime_mobile_src, sizeof(runtime_mobile_src), cheng_lang_root, "src/runtime/mobile") != 0 ||
      path_join(runtime_native_src, sizeof(runtime_native_src), cheng_lang_root, "src/runtime/native") != 0) {
    return 1;
  }

  const char *android_files[] = {
      "cheng_mobile_host_android.h",
      "cheng_gui_native_android.c",
      "cheng_mobile_android_gl.h",
      "cheng_mobile_android_ndk.c",
      "cheng_mobile_android_jni.c",
      "cheng_mobile_host_android.c",
      "cheng_mobile_android_gl.c",
      "stb_truetype.h",
  };
  for (size_t i = 0; i < sizeof(android_files) / sizeof(android_files[0]); ++i) {
    if (copy_named_file(android_src, android_files[i], cpp_dir) != 0) {
      fprintf(stderr, "[mobile-run-android] missing Android host source: %s\n", android_files[i]);
      return 1;
    }
  }

  const char *bridge_files[] = {
      "cheng_mobile_host_core.h",
      "cheng_mobile_host_api.h",
      "cheng_mobile_bridge.h",
      "cheng_mobile_host_core.c",
      "cheng_mobile_host_api.c",
  };
  for (size_t i = 0; i < sizeof(bridge_files) / sizeof(bridge_files[0]); ++i) {
    if (copy_named_file(bridge_src, bridge_files[i], cpp_dir) != 0) {
      fprintf(stderr, "[mobile-run-android] missing bridge source: %s\n", bridge_files[i]);
      return 1;
    }
  }

  if (copy_named_file(runtime_mobile_src, "cheng_mobile_exports.h", cpp_dir) != 0 ||
      copy_named_file(runtime_native_src, "system_helpers.h", cpp_dir) != 0 ||
      copy_named_file(runtime_native_src, "system_helpers.c", cpp_dir) != 0 ||
      copy_named_file(runtime_native_src, "stb_image.h", cpp_dir) != 0) {
    fprintf(stderr, "[mobile-run-android] missing runtime support files (exports/system_helpers/stb_image)\n");
    return 1;
  }

  char payload_obj[PATH_MAX];
  if (path_join(payload_obj, sizeof(payload_obj), cpp_dir, "cheng_app_payload_android.o") != 0) return 1;
  if (copy_file(native_obj, payload_obj, 0644) != 0) {
    fprintf(stderr, "[mobile-run-android] failed to inject native object: %s\n", native_obj);
    return 1;
  }

  char assets_dst[PATH_MAX];
  if (path_join(assets_dst, sizeof(assets_dst), project_dir, "app/src/main/assets") != 0) return 1;
  if (ensure_dir(assets_dst) != 0) return 1;
  if (assets_dir != NULL && assets_dir[0] != '\0') {
    if (!dir_exists(assets_dir)) {
      fprintf(stderr, "[mobile-run-android] assets dir not found: %s\n", assets_dir);
      return 1;
    }
    if (copy_tree(assets_dir, assets_dst) != 0) {
      fprintf(stderr, "[mobile-run-android] failed to copy assets: %s\n", assets_dir);
      return 1;
    }
  }

  const char *sdk_dir = getenv("ANDROID_SDK_ROOT");
  if (sdk_dir == NULL || sdk_dir[0] == '\0') sdk_dir = getenv("ANDROID_HOME");
  char sdk_fallback[PATH_MAX];
  if ((sdk_dir == NULL || sdk_dir[0] == '\0') && getenv("HOME") != NULL) {
    if (snprintf(sdk_fallback, sizeof(sdk_fallback), "%s/Library/Android/sdk", getenv("HOME")) <
        (int)sizeof(sdk_fallback)) {
      sdk_dir = sdk_fallback;
    }
  }
  if (sdk_dir != NULL && sdk_dir[0] != '\0' && dir_exists(sdk_dir)) {
    char local_properties[PATH_MAX];
    if (path_join(local_properties, sizeof(local_properties), project_dir, "local.properties") != 0) return 1;
    char escaped[PATH_MAX * 2];
    size_t w = 0u;
    for (size_t i = 0u; sdk_dir[i] != '\0' && w + 2u < sizeof(escaped); ++i) {
      if (sdk_dir[i] == '\\') escaped[w++] = '\\';
      escaped[w++] = sdk_dir[i];
    }
    escaped[w] = '\0';
    char content[PATH_MAX * 2 + 32];
    int n = snprintf(content, sizeof(content), "sdk.dir=%s\n", escaped);
    if (n > 0 && (size_t)n < sizeof(content)) {
      (void)write_file_all(local_properties, content, (size_t)n);
    }
  }

  char gradlew[PATH_MAX];
  if (path_join(gradlew, sizeof(gradlew), project_dir, "gradlew") != 0) return 1;
  (void)chmod(gradlew, 0755);

  char apk_path[PATH_MAX];
  if (path_join(apk_path, sizeof(apk_path), project_dir, "app/build/outputs/apk/debug/app-debug.apk") != 0) {
    return 1;
  }
  const char *skip_gradle_env = getenv("CHENG_ANDROID_SKIP_GRADLE_BUILD");
  if (skip_gradle_env != NULL && strcmp(skip_gradle_env, "1") == 0) {
    if (file_exists(apk_path)) {
      fprintf(stdout, "[mobile-run-android] skip gradle assembleDebug: CHENG_ANDROID_SKIP_GRADLE_BUILD=1\n");
      (void)root;
      return 0;
    }
    fprintf(stderr,
            "[mobile-run-android] CHENG_ANDROID_SKIP_GRADLE_BUILD=1 but apk missing, fallback to assembleDebug: %s\n",
            apk_path);
  }

  char *q_project = shell_single_quote(project_dir);
  if (q_project == NULL) return 1;
  char stop_cmd[PATH_MAX * 3];
  if (snprintf(stop_cmd, sizeof(stop_cmd), "cd %s && ./gradlew --stop >/dev/null 2>&1 || true", q_project) <
      (int)sizeof(stop_cmd)) {
    char *stop_argv[] = {"/bin/sh", "-lc", stop_cmd, NULL};
    (void)run_simple(stop_argv, 60, NULL);
  }
  char build_cmd[PATH_MAX * 3];
  if (snprintf(build_cmd,
               sizeof(build_cmd),
               "cd %s && ./gradlew --no-daemon --console=plain assembleDebug",
               q_project) >= (int)sizeof(build_cmd)) {
    free(q_project);
    return 1;
  }
  free(q_project);
  char *build_argv[] = {"/bin/sh", "-lc", build_cmd, NULL};
  char *build_out = NULL;
  int gradle_timeout = parse_positive_int_env("CHENG_ANDROID_GRADLE_TIMEOUT_SEC", 900);
  int build_rc = run_simple(build_argv, gradle_timeout, &build_out);
  if (build_rc != 0) {
    if (build_rc == 124) {
      fprintf(stderr,
              "[mobile-run-android] gradle assembleDebug timeout after %ds\n%s\n",
              gradle_timeout,
              build_out ? build_out : "");
    } else {
      fprintf(stderr,
              "[mobile-run-android] gradle assembleDebug failed rc=%d\n%s\n",
              build_rc,
              build_out ? build_out : "");
    }
    free(build_out);
    return 1;
  }
  free(build_out);

  (void)root;
  return 0;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  mobile_run_android <entry.cheng> [--name:<appName>] [--out:<dir>] [--assets:<dir>] [--native-obj:<obj>] [--serial:<id>]\n"
          "                     [--app-arg:<k=v>]... [--app-args-json:<abs_path>] [--runtime-state-out:<abs_path>] [--runtime-state-wait-ms:<ms>]\n"
          "                     [--direct-launch-smoke:<expected_route_state>]\n");
}

int native_mobile_run_android(const char *scripts_dir, int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
      usage();
      return 0;
    }
  }

  const char *entry = NULL;
  const char *name = "cheng_mobile_native_run";
  const char *out_dir = NULL;
  const char *assets_dir = NULL;
  const char *native_obj = NULL;
  const char *app_args_json_path = NULL;
  const char *runtime_state_out = NULL;
  const char *serial_override = NULL;
  const char *direct_launch_smoke_route = NULL;
  int wait_ms = 3000;
  StringList app_args;
  memset(&app_args, 0, sizeof(app_args));

  for (int i = arg_start; i < argc; ++i) {
    const char *arg = argv[i];
    if (!starts_with(arg, "--")) {
      if (entry == NULL) entry = arg;
      continue;
    }
    if (starts_with(arg, "--name:")) {
      name = arg + strlen("--name:");
      continue;
    }
    if (starts_with(arg, "--out:")) {
      out_dir = arg + strlen("--out:");
      continue;
    }
    if (starts_with(arg, "--assets:")) {
      assets_dir = arg + strlen("--assets:");
      continue;
    }
    if (starts_with(arg, "--native-obj:")) {
      native_obj = arg + strlen("--native-obj:");
      continue;
    }
    if (starts_with(arg, "--app-arg:")) {
      if (strlist_push(&app_args, arg + strlen("--app-arg:")) != 0) {
        strlist_free(&app_args);
        return 1;
      }
      continue;
    }
    if (starts_with(arg, "--app-args-json:")) {
      app_args_json_path = arg + strlen("--app-args-json:");
      continue;
    }
    if (starts_with(arg, "--runtime-state-out:")) {
      runtime_state_out = arg + strlen("--runtime-state-out:");
      continue;
    }
    if (starts_with(arg, "--runtime-state-wait-ms:")) {
      wait_ms = atoi(arg + strlen("--runtime-state-wait-ms:"));
      if (wait_ms <= 0) wait_ms = 3000;
      continue;
    }
    if (starts_with(arg, "--serial:")) {
      serial_override = arg + strlen("--serial:");
      continue;
    }
    if (starts_with(arg, "--direct-launch-smoke:")) {
      direct_launch_smoke_route = arg + strlen("--direct-launch-smoke:");
      continue;
    }
  }

  if (entry == NULL) {
    fprintf(stderr, "[mobile-run-android] missing entry source\n");
    strlist_free(&app_args);
    return 2;
  }
  bool route_from_cli = strlist_has_kv_key(&app_args, "route_state");
  bool route_from_json = false;
  char route_from_json_value[128];
  route_from_json_value[0] = '\0';
  if (!route_from_cli) {
    route_from_json = json_file_get_nonempty_route_state(
        app_args_json_path, route_from_json_value, sizeof(route_from_json_value));
  }
  if (!route_from_cli && route_from_json && route_from_json_value[0] != '\0') {
    char route_arg[192];
    if (snprintf(route_arg, sizeof(route_arg), "route_state=%s", route_from_json_value) >=
        (int)sizeof(route_arg)) {
      fprintf(stderr, "[mobile-run-android] route_state too long in app-args-json\n");
      strlist_free(&app_args);
      return 1;
    }
    if (strlist_push(&app_args, route_arg) != 0) {
      fprintf(stderr, "[mobile-run-android] failed to materialize route_state from app-args-json\n");
      strlist_free(&app_args);
      return 1;
    }
  }
  if (!route_from_cli && !route_from_json) {
    if (strlist_push(&app_args, "route_state=home_default") != 0) {
      fprintf(stderr, "[mobile-run-android] failed to set default route_state\n");
      strlist_free(&app_args);
      return 1;
    }
    fprintf(stdout, "[mobile-run-android] implicit route_state=home_default\n");
  }
  if (!strlist_has_kv_key(&app_args, "gate_mode")) {
    if (strlist_push(&app_args, "gate_mode=android-semantic-visual-1to1") != 0) {
      fprintf(stderr, "[mobile-run-android] failed to set default gate_mode\n");
      strlist_free(&app_args);
      return 1;
    }
    fprintf(stdout, "[mobile-run-android] implicit gate_mode=android-semantic-visual-1to1\n");
  }
  if (!strlist_has_kv_key(&app_args, "truth_mode")) {
    if (strlist_push(&app_args, "truth_mode=strict") != 0) {
      fprintf(stderr, "[mobile-run-android] failed to set default truth_mode\n");
      strlist_free(&app_args);
      return 1;
    }
    fprintf(stdout, "[mobile-run-android] implicit truth_mode=strict\n");
  }
  if (!strlist_has_kv_key(&app_args, "expected_framehash")) {
    char route_state[128];
    char expected_hash[128];
    route_state[0] = '\0';
    expected_hash[0] = '\0';
    if (!strlist_get_kv_value(&app_args, "route_state", route_state, sizeof(route_state)) ||
        route_state[0] == '\0') {
      if (route_from_json_value[0] != '\0') {
        snprintf(route_state, sizeof(route_state), "%s", route_from_json_value);
      } else {
        snprintf(route_state, sizeof(route_state), "home_default");
      }
    }
    if (!read_truth_runtime_framehash(assets_dir, route_state, expected_hash, sizeof(expected_hash))) {
      fprintf(stderr,
              "[mobile-run-android] strict truth gate missing runtime framehash: assets=%s route=%s\n",
              (assets_dir != NULL && assets_dir[0] != '\0') ? assets_dir : "<empty>",
              route_state);
      strlist_free(&app_args);
      return 1;
    }
    char expected_arg[192];
    if (snprintf(expected_arg, sizeof(expected_arg), "expected_framehash=%s", expected_hash) >=
        (int)sizeof(expected_arg)) {
      fprintf(stderr, "[mobile-run-android] expected_framehash too long\n");
      strlist_free(&app_args);
      return 1;
    }
    if (strlist_push(&app_args, expected_arg) != 0) {
      fprintf(stderr, "[mobile-run-android] failed to set expected_framehash\n");
      strlist_free(&app_args);
      return 1;
    }
    fprintf(stdout, "[mobile-run-android] implicit expected_framehash=%s route=%s\n", expected_hash, route_state);
  }
  if (native_obj == NULL || !file_exists(native_obj)) {
    fprintf(stderr, "[mobile-run-android] missing native object: %s\n", native_obj ? native_obj : "");
    strlist_free(&app_args);
    return 1;
  }

  char root[PATH_MAX];
  if (resolve_repo_root(scripts_dir, root, sizeof(root)) != 0) {
    fprintf(stderr, "[mobile-run-android] failed to resolve repo root\n");
    strlist_free(&app_args);
    return 1;
  }
  char default_out[PATH_MAX];
  if (out_dir == NULL || out_dir[0] == '\0') {
    if (path_join(default_out, sizeof(default_out), root, "build/mobile_run_android") != 0) {
      strlist_free(&app_args);
      return 1;
    }
    out_dir = default_out;
  }
  if (ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[mobile-run-android] failed to create out dir: %s\n", out_dir);
    strlist_free(&app_args);
    return 1;
  }
  char project_dir[PATH_MAX];
  if (path_join(project_dir, sizeof(project_dir), out_dir, "android_project") != 0) {
    strlist_free(&app_args);
    return 1;
  }
  if (prepare_android_project(root, project_dir, assets_dir, native_obj) != 0) {
    strlist_free(&app_args);
    return 1;
  }

  char *kv = join_app_args(&app_args);
  if (kv == NULL) {
    strlist_free(&app_args);
    return 1;
  }
  char *json = strdup("{}");
  if (json == NULL) {
    free(kv);
    strlist_free(&app_args);
    return 1;
  }
  if (app_args_json_path != NULL && app_args_json_path[0] != '\0') {
    size_t n = 0u;
    char *doc = read_file_all(app_args_json_path, &n);
    if (doc != NULL && n > 0u) {
      free(json);
      json = doc;
    }
  }
  char *json_b64 = base64url_encode((const unsigned char *)json, strlen(json));
  if (json_b64 == NULL) {
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }

  char adb[PATH_MAX];
  char serial[128];
  if (serial_override != NULL && serial_override[0] != '\0') {
    if (!resolve_adb_executable(adb, sizeof(adb))) {
      fprintf(stderr, "[mobile-run-android] missing adb\n");
      free(json_b64);
      free(json);
      free(kv);
      strlist_free(&app_args);
      return 2;
    }
    snprintf(serial, sizeof(serial), "%s", serial_override);
  } else if (!resolve_adb_and_serial(adb, sizeof(adb), serial, sizeof(serial))) {
    fprintf(stderr, "[mobile-run-android] no android device/emulator detected\n");
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }

  const char *pkg = "com.cheng.mobile";
  const char *activity = "com.cheng.mobile/.ChengActivity";
  fprintf(stdout,
          "[mobile-export] mode=native-obj entry=%s native_obj=%s name=%s out=%s\n",
          entry,
          native_obj,
          name != NULL ? name : "",
          out_dir);

  char apk_path[PATH_MAX];
  if (path_join(apk_path, sizeof(apk_path), project_dir, "app/build/outputs/apk/debug/app-debug.apk") != 0 ||
      !file_exists(apk_path)) {
    fprintf(stderr, "[mobile-run-android] missing built apk: %s\n", apk_path);
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }
  bool skip_install = false;
  const char *skip_install_env = getenv("CHENG_ANDROID_SKIP_INSTALL");
  if (skip_install_env != NULL && strcmp(skip_install_env, "1") == 0) {
    skip_install = true;
  }
  if (skip_install) {
    fprintf(stdout, "[mobile-run-android] skip adb install: CHENG_ANDROID_SKIP_INSTALL=1\n");
  } else {
    int install_rc = 1;
    int install_attempt = 0;
    for (install_attempt = 1; install_attempt <= 3; ++install_attempt) {
      char *install_argv[] = {adb, "-s", serial, "install", "-r", apk_path, NULL};
      char *install_out = NULL;
      install_rc = run_simple(install_argv, 180, &install_out);
      if (install_rc == 0) {
        free(install_out);
        break;
      }
      fprintf(stderr,
              "[mobile-run-android] adb install failed attempt=%d rc=%d apk=%s\n%s\n",
              install_attempt,
              install_rc,
              apk_path,
              install_out ? install_out : "");
      free(install_out);
      if (install_attempt < 3) {
        char *reconnect_argv[] = {adb, "start-server", NULL};
        (void)run_simple(reconnect_argv, 20, NULL);
        usleep(800000);
      }
    }
    if (install_rc != 0) {
      free(json_b64);
      free(json);
      free(kv);
      strlist_free(&app_args);
      return 1;
    }
  }

  char *force_stop[] = {adb, "-s", serial, "shell", "am", "force-stop", (char *)pkg, NULL};
  (void)run_simple(force_stop, 10, NULL);
  char *rm_state[] = {adb, "-s", serial, "shell", "run-as", (char *)pkg, "rm", "-f", "files/cheng_runtime_state.json", NULL};
  (void)run_simple(rm_state, 10, NULL);
  if (sync_truth_route_assets(adb, serial, pkg, assets_dir != NULL ? assets_dir : "", kv) != 0) {
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }

  fprintf(stdout,
          "[run-android] cmd: %s -s %s shell am start-activity -S --windowingMode 1 -W -n %s --es cheng_app_args_kv <...> --es cheng_app_args_json <...> --es cheng_app_args_json_b64 <...>\n",
          adb,
          serial,
          activity);
  char *q_activity = shell_single_quote(activity);
  char *q_kv = shell_single_quote(kv);
  char *q_json = shell_single_quote(json);
  char *q_json_b64 = shell_single_quote(json_b64);
  if (q_activity == NULL || q_kv == NULL || q_json == NULL || q_json_b64 == NULL) {
    free(q_activity);
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }
  size_t cmd_len = strlen("am start-activity -S --windowingMode 1 -W -n  --es cheng_app_args_kv  --es cheng_app_args_json  --es cheng_app_args_json_b64 ") +
                   strlen(q_activity) + strlen(q_kv) + strlen(q_json) + strlen(q_json_b64) + 1u;
  char *remote_cmd = (char *)malloc(cmd_len);
  if (remote_cmd == NULL) {
    free(q_activity);
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }
  snprintf(remote_cmd,
           cmd_len,
           "am start-activity -S --windowingMode 1 -W -n %s --es cheng_app_args_kv %s --es cheng_app_args_json %s --es cheng_app_args_json_b64 %s",
           q_activity,
           q_kv,
           q_json,
           q_json_b64);

  char *start_argv[] = {adb, "-s", serial, "shell", remote_cmd, NULL};
  char *start_out = NULL;
  int start_rc = run_simple(start_argv, 20, &start_out);
  if (start_rc != 0) {
    fprintf(stderr, "[mobile-run-android] launch failed rc=%d\n%s\n", start_rc, start_out ? start_out : "");
    free(start_out);
    free(remote_cmd);
    free(q_activity);
    free(q_kv);
    free(q_json);
    free(q_json_b64);
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }
  if (start_out != NULL) fputs(start_out, stdout);
  free(start_out);

  const char *fail_not_focused = getenv("CHENG_ANDROID_FAIL_IF_NOT_FOCUSED");
  bool hard_fail = (fail_not_focused != NULL && strcmp(fail_not_focused, "1") == 0);
  bool focused_ok = false;
  char focus_component[256];
  focus_component[0] = '\0';
  for (int focus_try = 0; focus_try < 4; ++focus_try) {
    if (query_current_focus_component(adb, serial, focus_component, sizeof(focus_component)) == 0 &&
        strstr(focus_component, pkg) != NULL) {
      focused_ok = true;
      break;
    }
    if (focus_try > 0) {
      fprintf(stderr,
              "[mobile-run-android] focus mismatch retry=%d expected_pkg=%s current_focus=%s\n",
              focus_try,
              pkg,
              focus_component[0] != '\0' ? focus_component : "<unknown>");
    }
    if (focus_try >= 3) {
      break;
    }
    // Recover from AOD/NotificationShade stealing focus before startup completes.
    char *wake_argv[] = {adb, "-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP", NULL};
    char *menu_argv[] = {adb, "-s", serial, "shell", "input", "keyevent", "82", NULL};
    char *collapse_argv[] = {adb, "-s", serial, "shell", "cmd", "statusbar", "collapse", NULL};
    (void)run_simple(wake_argv, 8, NULL);
    (void)run_simple(menu_argv, 8, NULL);
    (void)run_simple(collapse_argv, 8, NULL);
    usleep(300000);
    char *retry_out = NULL;
    int retry_rc = run_simple(start_argv, 20, &retry_out);
    if (retry_rc != 0) {
      fprintf(stderr,
              "[mobile-run-android] relaunch during focus recovery failed rc=%d\n%s\n",
              retry_rc,
              retry_out ? retry_out : "");
    }
    free(retry_out);
    usleep(400000);
  }
  if (!focused_ok) {
    fprintf(stderr,
            "[mobile-run-android] focus mismatch after launch expected_pkg=%s current_focus=%s\n",
            pkg,
            focus_component[0] != '\0' ? focus_component : "<unknown>");
    if (hard_fail) {
      free(remote_cmd);
      free(q_activity);
      free(q_kv);
      free(q_json);
      free(q_json_b64);
      free(json_b64);
      free(json);
      free(kv);
      strlist_free(&app_args);
      return 1;
    }
  }
  free(remote_cmd);
  free(q_activity);
  free(q_kv);
  free(q_json);
  free(q_json_b64);

  int poll_times = wait_ms / 250;
  if (poll_times < 1) poll_times = 1;
  char *state_text = NULL;
  for (int i = 0; i < poll_times; ++i) {
    char *cat_argv[] = {adb, "-s", serial, "shell", "run-as", (char *)pkg, "cat", "files/cheng_runtime_state.json", NULL};
    char *out = NULL;
    int rc = run_simple(cat_argv, 5, &out);
    if (rc == 0 && out != NULL && out[0] != '\0') {
      if (state_text != NULL) {
        free(state_text);
        state_text = NULL;
      }
      state_text = out;
      if (runtime_state_render_ready(out)) {
        break;
      }
      usleep(250000);
      continue;
    }
    free(out);
    usleep(250000);
  }
  if (state_text == NULL) {
    fprintf(stderr, "[mobile-run-android] failed to fetch runtime state from app sandbox\n");
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }

  uint64_t build_hash_u64 = fnv1a64_file(native_obj);
  char build_hash_hex[32];
  char semantic_hash_hex[32];
  to_hex64(build_hash_u64, build_hash_hex, sizeof(build_hash_hex));
  to_hex64(build_hash_u64, semantic_hash_hex, sizeof(semantic_hash_hex));

  char *state_with_build_hash = json_inject_string_field_if_missing(state_text, "build_hash", build_hash_hex);
  if (state_with_build_hash != NULL) {
    free(state_text);
    state_text = state_with_build_hash;
  }
  char *state_with_semantic_hash = json_inject_string_field_if_missing(state_text, "semantic_hash", semantic_hash_hex);
  if (state_with_semantic_hash != NULL) {
    free(state_text);
    state_text = state_with_semantic_hash;
  }

  if (runtime_state_out != NULL && runtime_state_out[0] != '\0') {
    if (write_file_all(runtime_state_out, state_text, strlen(state_text)) != 0) {
      fprintf(stderr, "[mobile-run-android] failed to write runtime state: %s\n", runtime_state_out);
      free(state_text);
      free(json_b64);
      free(json);
      free(kv);
      strlist_free(&app_args);
      return 1;
    }
    fprintf(stdout, "[run-android] runtime-state %s\n", runtime_state_out);
  } else {
    fprintf(stdout, "[run-android] runtime-state (inline)\n");
  }

  if (direct_launch_smoke_route != NULL && direct_launch_smoke_route[0] != '\0') {
    if (run_direct_launch_smoke(adb,
                                serial,
                                pkg,
                                activity,
                                direct_launch_smoke_route,
                                wait_ms) != 0) {
      free(state_text);
      free(json_b64);
      free(json);
      free(kv);
      strlist_free(&app_args);
      return 1;
    }
  }

  free(state_text);
  free(json_b64);
  free(json);
  free(kv);
  strlist_free(&app_args);
  fprintf(stdout, "mobile_run_android ok\n");
  return 0;
}
