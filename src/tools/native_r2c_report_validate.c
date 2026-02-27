#define _POSIX_C_SOURCE 200809L

#include "native_r2c_report_validate.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

bool nr_file_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

bool nr_dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool env_flag_on(const char *name) {
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return false;
  return (strcmp(v, "1") == 0 || strcmp(v, "true") == 0 || strcmp(v, "TRUE") == 0 ||
          strcmp(v, "yes") == 0 || strcmp(v, "YES") == 0);
}

int nr_path_join(char *out, size_t cap, const char *a, const char *b) {
  if (out == NULL || cap == 0u || a == NULL || b == NULL) return -1;
  int n = snprintf(out, cap, "%s/%s", a, b);
  if (n < 0 || (size_t)n >= cap) return -1;
  return 0;
}

int nr_ensure_dir(const char *path) {
  if (path == NULL || path[0] == '\0') return -1;
  char buf[PATH_MAX];
  size_t n = strlen(path);
  if (n >= sizeof(buf)) return -1;
  memcpy(buf, path, n + 1u);
  for (size_t i = 1; i < n; ++i) {
    if (buf[i] != '/') continue;
    buf[i] = '\0';
    if (buf[0] != '\0' && !nr_dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
    buf[i] = '/';
  }
  if (!nr_dir_exists(buf) && mkdir(buf, 0755) != 0 && errno != EEXIST) return -1;
  return 0;
}

void nr_basename_copy(const char *path, char *out, size_t out_cap) {
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

int nr_enforce_no_compat_mounts(const char *repo_root, char *err, size_t err_cap) {
  if (err != NULL && err_cap > 0u) err[0] = '\0';
  if (repo_root == NULL || repo_root[0] == '\0') {
    if (err != NULL) snprintf(err, err_cap, "repo root is empty");
    return 1;
  }
  const char *blocked_paths[] = {
      "src/gui",
      "src/std",
      "src/system",
      "src/core/core",
  };
  for (size_t i = 0u; i < sizeof(blocked_paths) / sizeof(blocked_paths[0]); ++i) {
    char abs_path[PATH_MAX];
    if (nr_path_join(abs_path, sizeof(abs_path), repo_root, blocked_paths[i]) != 0) {
      if (err != NULL) snprintf(err, err_cap, "invalid blocked path: %s", blocked_paths[i]);
      return 1;
    }
    struct stat st;
    if (lstat(abs_path, &st) != 0) {
      if (errno == ENOENT) continue;
      if (err != NULL) snprintf(err, err_cap, "failed to stat path: %s", abs_path);
      return 1;
    }
    const char *kind = "path";
    if (S_ISLNK(st.st_mode)) kind = "symlink";
    else if (S_ISDIR(st.st_mode)) kind = "directory";
    else if (S_ISREG(st.st_mode)) kind = "file";
    if (err != NULL) {
      snprintf(err, err_cap, "forbidden compatibility mount exists: %s (%s)", abs_path, kind);
    }
    return 1;
  }
  return 0;
}

static bool has_suffix(const char *name, const char *suffix) {
  if (name == NULL || suffix == NULL) return false;
  size_t name_n = strlen(name);
  size_t suffix_n = strlen(suffix);
  if (name_n < suffix_n) return false;
  return strcmp(name + name_n - suffix_n, suffix) == 0;
}

static bool should_skip_scan_dir(const char *name) {
  if (name == NULL) return true;
  if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) return true;
  if (strcmp(name, ".git") == 0 || strcmp(name, "build") == 0) return true;
  if (strcmp(name, "chengcache") == 0 || strcmp(name, "bin") == 0) return true;
  return false;
}

static int scan_legacy_gui_imports_recursive(const char *dir, char *hit_path, size_t hit_path_cap, long long *hit_line) {
  if (dir == NULL || dir[0] == '\0') return -1;
  DIR *dp = opendir(dir);
  if (dp == NULL) {
    if (errno == ENOENT) return 0;
    return -1;
  }
  struct dirent *ent = NULL;
  while ((ent = readdir(dp)) != NULL) {
    if (should_skip_scan_dir(ent->d_name)) continue;
    char path[PATH_MAX];
    if (nr_path_join(path, sizeof(path), dir, ent->d_name) != 0) continue;
    struct stat st;
    if (lstat(path, &st) != 0) continue;
    if (S_ISDIR(st.st_mode)) {
      int rc = scan_legacy_gui_imports_recursive(path, hit_path, hit_path_cap, hit_line);
      if (rc != 0) {
        closedir(dp);
        return rc;
      }
      continue;
    }
    if (!S_ISREG(st.st_mode) || !has_suffix(path, ".cheng")) continue;
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) continue;
    char line[4096];
    long long line_no = 0;
    while (fgets(line, sizeof(line), fp) != NULL) {
      line_no += 1;
      if (strstr(line, "cheng/gui/") != NULL) {
        if (hit_path != NULL && hit_path_cap > 0u) {
          snprintf(hit_path, hit_path_cap, "%s", path);
        }
        if (hit_line != NULL) *hit_line = line_no;
        fclose(fp);
        closedir(dp);
        return 1;
      }
    }
    fclose(fp);
  }
  closedir(dp);
  return 0;
}

int nr_enforce_no_legacy_gui_imports(const char *repo_root, char *err, size_t err_cap) {
  if (err != NULL && err_cap > 0u) err[0] = '\0';
  if (env_flag_on("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX")) return 0;
  if (repo_root == NULL || repo_root[0] == '\0') {
    if (err != NULL) snprintf(err, err_cap, "repo root is empty");
    return 1;
  }
  char src_root[PATH_MAX];
  if (nr_path_join(src_root, sizeof(src_root), repo_root, "src") != 0) {
    if (err != NULL) snprintf(err, err_cap, "invalid src root");
    return 1;
  }
  if (!nr_dir_exists(src_root)) {
    if (err != NULL) snprintf(err, err_cap, "missing src root: %s", src_root);
    return 1;
  }
  char hit_path[PATH_MAX];
  long long hit_line = 0;
  int rc = scan_legacy_gui_imports_recursive(src_root, hit_path, sizeof(hit_path), &hit_line);
  if (rc < 0) {
    if (err != NULL) snprintf(err, err_cap, "failed to scan source imports: %s", src_root);
    return 1;
  }
  if (rc > 0) {
    if (err != NULL) {
      snprintf(err,
               err_cap,
               "legacy import prefix detected (use gui/...): %s:%lld",
               hit_path,
               hit_line);
    }
    return 1;
  }
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

static bool json_array_is_empty(const char *doc, const char *key) {
  const char *p = json_find_key(doc, key);
  if (p == NULL || *p != '[') return false;
  ++p;
  p = skip_ws(p);
  return (p != NULL && *p == ']');
}

static int json_count_key_occurrence(const char *doc, const char *key) {
  if (doc == NULL || key == NULL) return 0;
  char pat[256];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return 0;
  int count = 0;
  const char *p = doc;
  while ((p = strstr(p, pat)) != NULL) {
    count += 1;
    p += strlen(pat);
  }
  return count;
}

static int count_substr_occurrence(const char *doc, const char *needle) {
  if (doc == NULL || needle == NULL || needle[0] == '\0') return 0;
  int count = 0;
  const char *p = doc;
  size_t n = strlen(needle);
  while ((p = strstr(p, needle)) != NULL) {
    count += 1;
    p += n;
  }
  return count;
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
  if (snprintf(out, out_cap, "%s", raw) < (int)out_cap && nr_file_exists(out)) {
    return true;
  }
  char dir[PATH_MAX];
  dirname_copy(report_path, dir, sizeof(dir));
  return nr_path_join(out, out_cap, dir, raw) == 0;
}

static bool validate_path_key(const char *report_path, const char *doc, const char *key, char *err, size_t err_cap) {
  char raw[PATH_MAX];
  if (!json_get_string(doc, key, raw, sizeof(raw))) {
    snprintf(err, err_cap, "missing report field: %s", key);
    return false;
  }
  char resolved[PATH_MAX];
  if (!resolve_report_path(report_path, raw, resolved, sizeof(resolved))) {
    snprintf(err, err_cap, "invalid report path: %s=%s", key, raw);
    return false;
  }
  if (!nr_file_exists(resolved)) {
    snprintf(err, err_cap, "report path not found: %s -> %s", key, resolved);
    return false;
  }
  return true;
}

static bool ensure_semantic_render_nodes_file(const char *report_path, const char *doc, char *err, size_t err_cap) {
  char raw_path[PATH_MAX];
  if (!json_get_string(doc, "semantic_render_nodes_path", raw_path, sizeof(raw_path))) {
    if (err != NULL) snprintf(err, err_cap, "missing semantic_render_nodes_path");
    return false;
  }
  char resolved[PATH_MAX];
  if (!resolve_report_path(report_path, raw_path, resolved, sizeof(resolved))) {
    if (err != NULL) snprintf(err, err_cap, "invalid semantic_render_nodes_path: %s", raw_path);
    return false;
  }
  if (!nr_file_exists(resolved)) {
    if (err != NULL) snprintf(err, err_cap, "semantic_render_nodes_path not found: %s", resolved);
    return false;
  }
  return true;
}

static bool render_line_is_placeholder_auto(const char *line, size_t len) {
  if (line == NULL || len == 0u) return false;
  char row[8192];
  if (len >= sizeof(row)) return true;
  memcpy(row, line, len);
  row[len] = '\0';
  char *fields[8] = {0};
  int field_count = 0;
  fields[field_count++] = row;
  for (char *p = row; *p != '\0' && field_count < 8; ++p) {
    if (*p == '\t') {
      *p = '\0';
      fields[field_count++] = p + 1;
    }
  }
  if (field_count < 8) return true;
  if (strncmp(fields[0], "auto-", 5u) != 0) return false;
  for (int i = 1; i < 8; ++i) {
    if (fields[i] != NULL && fields[i][0] != '\0') return false;
  }
  return true;
}

static bool validate_render_rows_strict(const char *path,
                                        long long expected_rows,
                                        int *out_rows,
                                        char *err,
                                        size_t err_cap) {
  if (out_rows != NULL) *out_rows = 0;
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL) {
    if (err != NULL) snprintf(err, err_cap, "failed to read semantic_render_nodes_path");
    return false;
  }
  int rows = 0;
  const char *p = doc;
  while (*p != '\0') {
    while (*p == '\n' || *p == '\r') ++p;
    if (*p == '\0') break;
    const char *line = p;
    while (*p != '\0' && *p != '\n' && *p != '\r') ++p;
    size_t len = (size_t)(p - line);
    if (len == 0u) continue;
    size_t i = 0u;
    while (i < len && isspace((unsigned char)line[i])) ++i;
    if (i >= len || line[i] == '#') continue;
    if (render_line_is_placeholder_auto(line + i, len - i)) {
      if (err != NULL) snprintf(err, err_cap, "semantic_render_nodes has placeholder/auto rows");
      free(doc);
      return false;
    }
    rows += 1;
  }
  free(doc);
  if (out_rows != NULL) *out_rows = rows;
  if (rows <= 0) {
    if (err != NULL) snprintf(err, err_cap, "semantic_render_nodes rows empty");
    return false;
  }
  if (expected_rows > 0 && rows != (int)expected_rows) {
    if (err != NULL) snprintf(err, err_cap, "semantic render row mismatch: rows=%d report=%lld", rows, expected_rows);
    return false;
  }
  return true;
}

static bool validate_route_tree_file(const char *path, char *err, size_t err_cap) {
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL || n == 0u) {
    if (err != NULL) snprintf(err, err_cap, "cannot read route_tree_path");
    free(doc);
    return false;
  }
  bool ok = true;
  if (strstr(doc, "\"route\":\"home_default\"") == NULL &&
      strstr(doc, "\"route\": \"home_default\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route tree missing home_default route");
  }
  if (ok && strstr(doc, "\"path_from_root\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route tree missing path_from_root");
  }
  if (ok && strstr(doc, "\"depth\":0") == NULL && strstr(doc, "\"depth\": 0") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route tree missing depth=0 root node");
  }
  free(doc);
  return ok;
}

static bool validate_route_layers_file(const char *path,
                                       long long expected_layer_count,
                                       char *err,
                                       size_t err_cap) {
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL || n == 0u) {
    if (err != NULL) snprintf(err, err_cap, "cannot read route_layers_path");
    free(doc);
    return false;
  }
  long long layer_count = 0;
  if (!json_get_int64(doc, "layer_count", &layer_count) || layer_count <= 0) {
    if (err != NULL) snprintf(err, err_cap, "route layers layer_count invalid");
    free(doc);
    return false;
  }
  if (expected_layer_count > 0 && layer_count != expected_layer_count) {
    if (err != NULL) {
      snprintf(err,
               err_cap,
               "route layers layer_count mismatch: file=%lld report=%lld",
               layer_count,
               expected_layer_count);
    }
    free(doc);
    return false;
  }
  int layer_entries = json_count_key_occurrence(doc, "layer_index");
  if (layer_entries <= 0) {
    if (err != NULL) snprintf(err, err_cap, "route layers missing layer_index entries");
    free(doc);
    return false;
  }
  if (strstr(doc, "\"layer_index\":0") == NULL && strstr(doc, "\"layer_index\": 0") == NULL) {
    if (err != NULL) snprintf(err, err_cap, "route layers missing layer 0");
    free(doc);
    return false;
  }
  if (strstr(doc, "\"home_default\"") == NULL) {
    if (err != NULL) snprintf(err, err_cap, "route layers missing home_default");
    free(doc);
    return false;
  }
  free(doc);
  return true;
}

static int count_runtime_append_calls_strict(const char *runtime_doc, bool *out_has_comment_marker) {
  if (out_has_comment_marker != NULL) *out_has_comment_marker = false;
  if (runtime_doc == NULL) return 0;
  int append_count = 0;
  const char *line = runtime_doc;
  while (*line != '\0') {
    const char *end = line;
    while (*end != '\0' && *end != '\n' && *end != '\r') ++end;
    const char *p = line;
    while (p < end && isspace((unsigned char)*p)) ++p;
    if (p < end) {
      if (*p == '#') {
        if (strstr(p, "appendSemanticNode(") != NULL && out_has_comment_marker != NULL) {
          *out_has_comment_marker = true;
        }
      } else if (strncmp(p, "appendSemanticNode(", 19u) == 0) {
        append_count += 1;
      }
    }
    if (*end == '\0') break;
    line = end + 1;
  }
  return append_count;
}

NativeRunResult nr_run_command(char *const argv[], const char *log_path, int timeout_sec) {
  NativeRunResult res;
  res.code = 127;
  res.timed_out = false;

  pid_t pid = fork();
  if (pid < 0) return res;
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
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
      waitpid(pid, NULL, 0);
      res.code = 124;
      return res;
    }
    usleep(50000);
  }
}

int nr_validate_compile_report(const char *report_path,
                               const char *truth_manifest_key,
                               const char *project_root,
                               char *err,
                               size_t err_cap) {
  if (err != NULL && err_cap > 0u) err[0] = '\0';
  if (report_path == NULL || report_path[0] == '\0') {
    if (err != NULL) snprintf(err, err_cap, "report path is empty");
    return 1;
  }
  if (!nr_file_exists(report_path)) {
    if (err != NULL) snprintf(err, err_cap, "report not found: %s", report_path);
    return 1;
  }

  size_t n = 0u;
  char *doc = read_file_all(report_path, &n);
  if (doc == NULL || n == 0u) {
    if (err != NULL) snprintf(err, err_cap, "failed to read report: %s", report_path);
    free(doc);
    return 1;
  }

  bool b = false;
  if (!json_get_bool(doc, "strict_no_fallback", &b) || !b) {
    if (err != NULL) snprintf(err, err_cap, "strict_no_fallback != true");
    free(doc);
    return 1;
  }
  if (!json_get_bool(doc, "used_fallback", &b) || b) {
    if (err != NULL) snprintf(err, err_cap, "used_fallback != false");
    free(doc);
    return 1;
  }
  if (!json_get_bool(doc, "template_runtime_used", &b) || b) {
    if (err != NULL) snprintf(err, err_cap, "template_runtime_used != false");
    free(doc);
    return 1;
  }
  if (!json_array_is_empty(doc, "unsupported_syntax") || !json_array_is_empty(doc, "unsupported_imports") ||
      !json_array_is_empty(doc, "degraded_features")) {
    if (err != NULL) snprintf(err, err_cap, "unsupported/degraded must be empty arrays");
    free(doc);
    return 1;
  }

  char mode[128];
  if (!json_get_string(doc, "semantic_compile_mode", mode, sizeof(mode)) ||
      strcmp(mode, "react-semantic-ir-node-compile") != 0) {
    if (err != NULL) snprintf(err, err_cap, "semantic_compile_mode invalid");
    free(doc);
    return 1;
  }
  char mapping[128];
  if (!json_get_string(doc, "semantic_mapping_mode", mapping, sizeof(mapping)) ||
      strcmp(mapping, "source-node-map") != 0) {
    if (err != NULL) snprintf(err, err_cap, "semantic_mapping_mode != source-node-map");
    free(doc);
    return 1;
  }
  char origin[128];
  if (!json_get_string(doc, "compiler_report_origin", origin, sizeof(origin)) ||
      strcmp(origin, "cheng-compiler") != 0) {
    if (err != NULL) snprintf(err, err_cap, "compiler_report_origin != cheng-compiler");
    free(doc);
    return 1;
  }

  long long semantic_nodes = 0;
  if (!json_get_int64(doc, "semantic_node_count", &semantic_nodes) || semantic_nodes <= 0) {
    if (err != NULL) snprintf(err, err_cap, "semantic_node_count <= 0");
    free(doc);
    return 1;
  }

  long long render_nodes = 0;
  if (!json_get_int64(doc, "semantic_render_nodes_count", &render_nodes) || render_nodes <= 0) {
    if (err != NULL) snprintf(err, err_cap, "semantic_render_nodes_count <= 0");
    free(doc);
    return 1;
  }

  const char *required_paths[] = {
      "react_ir_path",
      "hook_graph_path",
      "effect_plan_path",
      "third_party_rewrite_report_path",
      "route_tree_path",
      "route_layers_path",
      "perf_summary_path",
      "semantic_node_map_path",
      "semantic_runtime_map_path",
      "semantic_render_nodes_path",
      "generated_runtime_path",
      "full_route_states_path",
  };
  if (!ensure_semantic_render_nodes_file(report_path, doc, err, err_cap)) {
    free(doc);
    return 1;
  }
  for (size_t i = 0u; i < sizeof(required_paths) / sizeof(required_paths[0]); ++i) {
    if (!validate_path_key(report_path, doc, required_paths[i], err, err_cap)) {
      free(doc);
      return 1;
    }
  }

  long long layer_count = 0;
  if (!json_get_int64(doc, "layer_count", &layer_count) || layer_count <= 0) {
    if (err != NULL) snprintf(err, err_cap, "layer_count <= 0");
    free(doc);
    return 1;
  }
  char current_layer_gate[128];
  if (!json_get_string(doc, "current_layer_gate", current_layer_gate, sizeof(current_layer_gate)) ||
      current_layer_gate[0] == '\0') {
    if (err != NULL) snprintf(err, err_cap, "missing current_layer_gate");
    free(doc);
    return 1;
  }

  if (truth_manifest_key != NULL && truth_manifest_key[0] != '\0') {
    if (!validate_path_key(report_path, doc, truth_manifest_key, err, err_cap)) {
      free(doc);
      return 1;
    }
  }

  char route_tree_raw[PATH_MAX];
  char route_tree_path[PATH_MAX];
  if (!json_get_string(doc, "route_tree_path", route_tree_raw, sizeof(route_tree_raw)) ||
      !resolve_report_path(report_path, route_tree_raw, route_tree_path, sizeof(route_tree_path)) ||
      !validate_route_tree_file(route_tree_path, err, err_cap)) {
    if (err != NULL && err[0] == '\0') snprintf(err, err_cap, "route_tree_path invalid");
    free(doc);
    return 1;
  }
  char route_layers_raw[PATH_MAX];
  char route_layers_path[PATH_MAX];
  if (!json_get_string(doc, "route_layers_path", route_layers_raw, sizeof(route_layers_raw)) ||
      !resolve_report_path(report_path, route_layers_raw, route_layers_path, sizeof(route_layers_path)) ||
      !validate_route_layers_file(route_layers_path, layer_count, err, err_cap)) {
    if (err != NULL && err[0] == '\0') snprintf(err, err_cap, "route_layers_path invalid");
    free(doc);
    return 1;
  }

  char runtime_raw[PATH_MAX];
  char runtime_path[PATH_MAX];
  if (!json_get_string(doc, "generated_runtime_path", runtime_raw, sizeof(runtime_raw)) ||
      !resolve_report_path(report_path, runtime_raw, runtime_path, sizeof(runtime_path))) {
    if (err != NULL) snprintf(err, err_cap, "generated_runtime_path invalid");
    free(doc);
    return 1;
  }
  size_t runtime_n = 0u;
  char *runtime_doc = read_file_all(runtime_path, &runtime_n);
  if (runtime_doc == NULL) {
    if (err != NULL) snprintf(err, err_cap, "cannot read generated runtime: %s", runtime_path);
    free(doc);
    return 1;
  }
  if (!env_flag_on("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX") &&
      strstr(runtime_doc, "import cheng/gui/") != NULL) {
    if (err != NULL) {
      snprintf(err, err_cap, "generated runtime still contains legacy import prefix cheng/gui/: %s", runtime_path);
    }
    free(runtime_doc);
    free(doc);
    return 1;
  }
  if (strstr(runtime_doc, "legacy.mountUnimakerAot") != NULL ||
      strstr(runtime_doc, "legacy.unimakerDispatch") != NULL ||
      strstr(runtime_doc, "import gui/browser/r2capp/runtime as legacy") != NULL) {
    if (err != NULL) {
      snprintf(err,
               err_cap,
               "generated runtime is legacy template (not real semantic node compile): %s",
               runtime_path);
    }
    free(runtime_doc);
    free(doc);
    return 1;
  }
  bool has_append_comment_marker = false;
  int append_count = count_runtime_append_calls_strict(runtime_doc, &has_append_comment_marker);
  if (has_append_comment_marker) {
    if (err != NULL) snprintf(err, err_cap, "generated runtime contains commented appendSemanticNode markers");
    free(runtime_doc);
    free(doc);
    return 1;
  }
  if (append_count < (int)semantic_nodes) {
    if (err != NULL) {
      snprintf(err,
               err_cap,
               "generated runtime semantic nodes insufficient: append=%d expected=%lld",
               append_count,
               semantic_nodes);
    }
    free(runtime_doc);
    free(doc);
    return 1;
  }
  free(runtime_doc);

  char render_raw[PATH_MAX];
  char render_path[PATH_MAX];
  if (!json_get_string(doc, "semantic_render_nodes_path", render_raw, sizeof(render_raw)) ||
      !resolve_report_path(report_path, render_raw, render_path, sizeof(render_path))) {
    if (err != NULL) snprintf(err, err_cap, "semantic_render_nodes_path invalid");
    free(doc);
    return 1;
  }
  int render_rows = 0;
  if (!validate_render_rows_strict(render_path, render_nodes, &render_rows, err, err_cap)) {
    free(doc);
    return 1;
  }
  if (render_rows < (int)semantic_nodes) {
    if (err != NULL) {
      snprintf(err,
               err_cap,
               "semantic render rows too small: rows=%d semantic=%lld",
               render_rows,
               semantic_nodes);
    }
    free(doc);
    return 1;
  }

  char map_raw[PATH_MAX];
  char map_path[PATH_MAX];
  if (!json_get_string(doc, "semantic_node_map_path", map_raw, sizeof(map_raw)) ||
      !resolve_report_path(report_path, map_raw, map_path, sizeof(map_path))) {
    if (err != NULL) snprintf(err, err_cap, "semantic_node_map_path invalid");
    free(doc);
    return 1;
  }
  size_t map_n = 0u;
  char *map_doc = read_file_all(map_path, &map_n);
  if (map_doc == NULL) {
    if (err != NULL) snprintf(err, err_cap, "cannot read semantic_node_map_path");
    free(doc);
    return 1;
  }
  int map_nodes = json_count_key_occurrence(map_doc, "node_id");
  if (map_nodes != (int)semantic_nodes) {
    if (err != NULL) {
      snprintf(err, err_cap, "semantic source map count mismatch: nodes=%d report=%lld", map_nodes, semantic_nodes);
    }
    free(map_doc);
    free(doc);
    return 1;
  }
  if (project_root != NULL && project_root[0] != '\0') {
    int app_module_hits = count_substr_occurrence(map_doc, "\"source_module\":\"/app/");
    if (app_module_hits == 0) {
      app_module_hits = count_substr_occurrence(map_doc, "\"source_module\": \"/app/");
    }
    if (app_module_hits < 5) {
      if (err != NULL) snprintf(err, err_cap, "semantic source_module coverage too small: %d", app_module_hits);
      free(map_doc);
      free(doc);
      return 1;
    }
  }
  free(map_doc);

  char rt_map_raw[PATH_MAX];
  char rt_map_path[PATH_MAX];
  if (!json_get_string(doc, "semantic_runtime_map_path", rt_map_raw, sizeof(rt_map_raw)) ||
      !resolve_report_path(report_path, rt_map_raw, rt_map_path, sizeof(rt_map_path))) {
    if (err != NULL) snprintf(err, err_cap, "semantic_runtime_map_path invalid");
    free(doc);
    return 1;
  }
  size_t rt_map_n = 0u;
  char *rt_map_doc = read_file_all(rt_map_path, &rt_map_n);
  if (rt_map_doc == NULL) {
    if (err != NULL) snprintf(err, err_cap, "cannot read semantic_runtime_map_path");
    free(doc);
    return 1;
  }
  int rt_map_nodes = json_count_key_occurrence(rt_map_doc, "node_id");
  free(rt_map_doc);
  if (rt_map_nodes != (int)semantic_nodes) {
    if (err != NULL) {
      snprintf(err,
               err_cap,
               "semantic runtime map count mismatch: nodes=%d report=%lld",
               rt_map_nodes,
               semantic_nodes);
    }
    free(doc);
    return 1;
  }

  free(doc);
  return 0;
}
