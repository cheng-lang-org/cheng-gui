#define _POSIX_C_SOURCE 200809L

#include "native_r2c_report_validate.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdarg.h>
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

static void set_contract_error(char *err, size_t err_cap, const char *fmt, ...) {
  if (err == NULL || err_cap == 0u) return;
  const char *prefix = "[compile-report-contract] ";
  int used = snprintf(err, err_cap, "%s", prefix);
  if (used < 0) return;
  size_t pos = (size_t)used;
  if (pos >= err_cap) {
    err[err_cap - 1u] = '\0';
    return;
  }
  va_list ap;
  va_start(ap, fmt);
  (void)vsnprintf(err + pos, err_cap - pos, fmt, ap);
  va_end(ap);
}

static bool resolve_report_path(const char *report_path, const char *raw, char *out, size_t out_cap) {
  if (report_path == NULL || raw == NULL || out == NULL || out_cap == 0u) return false;
  if (raw[0] == '\0') return false;
  if (raw[0] == '/') {
    if (snprintf(out, out_cap, "%s", raw) >= (int)out_cap) return false;
    return true;
  }
  struct stat st;
  if (stat(raw, &st) == 0) {
    if (snprintf(out, out_cap, "%s", raw) >= (int)out_cap) return false;
    return true;
  }
  char dir[PATH_MAX];
  dirname_copy(report_path, dir, sizeof(dir));
  return nr_path_join(out, out_cap, dir, raw) == 0;
}

static bool validate_path_key(const char *report_path, const char *doc, const char *key, char *err, size_t err_cap) {
  char raw[PATH_MAX];
  if (!json_get_string(doc, key, raw, sizeof(raw))) {
    set_contract_error(err, err_cap, "missing required key: %s", key);
    return false;
  }
  if (raw[0] == '\0') {
    set_contract_error(err, err_cap, "empty required path: %s", key);
    return false;
  }
  char resolved[PATH_MAX];
  if (!resolve_report_path(report_path, raw, resolved, sizeof(resolved))) {
    set_contract_error(err, err_cap, "relative-path resolve failed: %s=%s", key, raw);
    return false;
  }
  if (!nr_file_exists(resolved)) {
    set_contract_error(err, err_cap, "path not found: %s -> %s", key, resolved);
    return false;
  }
  return true;
}

static bool ensure_semantic_render_nodes_file(const char *report_path, const char *doc, char *err, size_t err_cap) {
  char raw_path[PATH_MAX];
  if (!json_get_string(doc, "semantic_render_nodes_path", raw_path, sizeof(raw_path))) {
    set_contract_error(err, err_cap, "missing required key: semantic_render_nodes_path");
    return false;
  }
  if (raw_path[0] == '\0') {
    set_contract_error(err, err_cap, "empty required path: semantic_render_nodes_path");
    return false;
  }
  char resolved[PATH_MAX];
  if (!resolve_report_path(report_path, raw_path, resolved, sizeof(resolved))) {
    set_contract_error(err, err_cap, "relative-path resolve failed: semantic_render_nodes_path=%s", raw_path);
    return false;
  }
  if (!nr_file_exists(resolved)) {
    set_contract_error(err, err_cap, "path not found: semantic_render_nodes_path -> %s", resolved);
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

static bool validate_route_semantic_tree_file(const char *path, char *err, size_t err_cap) {
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL || n == 0u) {
    if (err != NULL) snprintf(err, err_cap, "cannot read route_semantic_tree_path");
    free(doc);
    return false;
  }
  bool ok = true;
  long long route_count = 0;
  long long semantic_total_count = 0;
  char semantic_total_hash[128];
  semantic_total_hash[0] = '\0';
  if (!json_get_int64(doc, "route_count", &route_count) || route_count <= 0) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree route_count invalid");
  }
  if (ok && (!json_get_int64(doc, "semantic_total_count", &semantic_total_count) || semantic_total_count <= 0)) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree semantic_total_count invalid");
  }
  if (ok && !json_get_string(doc, "semantic_total_hash", semantic_total_hash, sizeof(semantic_total_hash))) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing semantic_total_hash");
  }
  if (ok) {
    size_t hash_n = strlen(semantic_total_hash);
    if (hash_n != 16u) {
      ok = false;
      if (err != NULL) snprintf(err, err_cap, "route semantic tree semantic_total_hash invalid length");
    } else {
      for (size_t i = 0u; i < hash_n; ++i) {
        char ch = semantic_total_hash[i];
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) {
          ok = false;
          if (err != NULL) snprintf(err, err_cap, "route semantic tree semantic_total_hash not-lower-hex64");
          break;
        }
      }
    }
  }
  if (ok && strstr(doc, "\"format\":\"r2c-route-semantic-tree-v1\"") == NULL &&
      strstr(doc, "\"format\": \"r2c-route-semantic-tree-v1\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree format mismatch");
  }
  if (ok && strstr(doc, "\"route\":\"home_default\"") == NULL &&
      strstr(doc, "\"route\": \"home_default\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing home_default");
  }
  if (ok && strstr(doc, "\"path_signature\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing path_signature");
  }
  if (ok && strstr(doc, "\"node_ids\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing node_ids");
  }
  if (ok && strstr(doc, "\"edge_ids\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing edge_ids");
  }
  if (ok && strstr(doc, "\"subtree_hash\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing subtree_hash");
  }
  if (ok && strstr(doc, "\"subtree_node_count\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing subtree_node_count");
  }
  if (ok && strstr(doc, "\"component_sources\"") == NULL) {
    ok = false;
    if (err != NULL) snprintf(err, err_cap, "route semantic tree missing component_sources");
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

static bool validate_route_actions_file(const char *path, char *err, size_t err_cap) {
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL || n == 0u) {
    if (err != NULL) snprintf(err, err_cap, "cannot read route_actions_android_path");
    free(doc);
    return false;
  }
  long long route_count = 0;
  if (!json_get_int64(doc, "route_count", &route_count) || route_count <= 0) {
    if (err != NULL) snprintf(err, err_cap, "route actions route_count invalid");
    free(doc);
    return false;
  }
  if (strstr(doc, "\"route\":\"home_default\"") == NULL &&
      strstr(doc, "\"route\": \"home_default\"") == NULL) {
    if (err != NULL) snprintf(err, err_cap, "route actions missing home_default");
    free(doc);
    return false;
  }
  if (strstr(doc, "\"actions\"") == NULL) {
    if (err != NULL) snprintf(err, err_cap, "route actions missing actions[]");
    free(doc);
    return false;
  }
  if (strstr(doc, "\"action_script\"") != NULL) {
    set_contract_error(err, err_cap, "route actions contains forbidden key: action_script");
    free(doc);
    return false;
  }
  if (strstr(doc, "\"type\":\"launch_main\"") == NULL &&
      strstr(doc, "\"type\": \"launch_main\"") == NULL) {
    if (err != NULL) snprintf(err, err_cap, "route actions missing launch_main action");
    free(doc);
    return false;
  }
  free(doc);
  return true;
}

static bool runtime_map_has_route_hint(const char *runtime_map_doc, const char *route) {
  if (runtime_map_doc == NULL || route == NULL || route[0] == '\0') return false;
  char pat1[320];
  char pat2[320];
  char pat3[320];
  char pat4[320];
  if (snprintf(pat1, sizeof(pat1), "\"route_hint\":\"%s\"", route) >= (int)sizeof(pat1) ||
      snprintf(pat2, sizeof(pat2), "\"route_hint\": \"%s\"", route) >= (int)sizeof(pat2) ||
      snprintf(pat3, sizeof(pat3), "\"render_bucket\":\"%s\"", route) >= (int)sizeof(pat3) ||
      snprintf(pat4, sizeof(pat4), "\"render_bucket\": \"%s\"", route) >= (int)sizeof(pat4)) {
    return false;
  }
  return strstr(runtime_map_doc, pat1) != NULL || strstr(runtime_map_doc, pat2) != NULL ||
         strstr(runtime_map_doc, pat3) != NULL || strstr(runtime_map_doc, pat4) != NULL;
}

static bool validate_runtime_map_route_coverage(const char *runtime_map_doc,
                                                const char *route_actions_path,
                                                char *err,
                                                size_t err_cap) {
  if (runtime_map_doc == NULL || route_actions_path == NULL || route_actions_path[0] == '\0') {
    if (err != NULL) snprintf(err, err_cap, "semantic runtime route coverage input invalid");
    return false;
  }
  size_t n = 0u;
  char *route_doc = read_file_all(route_actions_path, &n);
  if (route_doc == NULL || n == 0u) {
    if (err != NULL) snprintf(err, err_cap, "cannot read route_actions_android_path for runtime map coverage");
    free(route_doc);
    return false;
  }
  int seen = 0;
  const char *p = route_doc;
  while ((p = strstr(p, "\"route\"")) != NULL) {
    const char *q = strchr(p, ':');
    if (q == NULL) break;
    q += 1;
    while (*q != '\0' && isspace((unsigned char)*q)) q += 1;
    if (*q != '"') {
      p += 7;
      continue;
    }
    q += 1;
    const char *end = q;
    while (*end != '\0' && *end != '"') {
      if (*end == '\\' && end[1] != '\0') {
        end += 2;
      } else {
        end += 1;
      }
    }
    if (*end != '"') break;
    size_t route_len = (size_t)(end - q);
    if (route_len > 0u && route_len < 128u) {
      char route[128];
      memcpy(route, q, route_len);
      route[route_len] = '\0';
      seen += 1;
      if (!runtime_map_has_route_hint(runtime_map_doc, route)) {
        if (err != NULL) snprintf(err, err_cap, "semantic runtime map missing route coverage: %s", route);
        free(route_doc);
        return false;
      }
    }
    p = end + 1;
  }
  free(route_doc);
  if (seen <= 0) {
    if (err != NULL) snprintf(err, err_cap, "route_actions_android_path has no route entries");
    return false;
  }
  return true;
}

static bool runtime_contains_forbidden_semantic_append(const char *runtime_doc) {
  if (runtime_doc == NULL) return false;
  return strstr(runtime_doc, "appendSemanticNode(") != NULL;
}

static bool runtime_has_component_executor_api(const char *runtime_doc) {
  if (runtime_doc == NULL) return false;
  const char *required[] = {
      "fn mountComponentUnit(",
      "fn updateComponentUnit(",
      "fn unmountComponentUnit(",
      "fn mountGenerated(",
      "fn dispatchFromPage(",
      "fn resolveTargetAt(",
  };
  for (size_t i = 0u; i < sizeof(required) / sizeof(required[0]); ++i) {
    if (strstr(runtime_doc, required[i]) == NULL) return false;
  }
  return true;
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
      "semantic_graph_path",
      "component_graph_path",
      "style_graph_path",
      "event_graph_path",
      "runtime_trace_path",
      "hook_graph_path",
      "effect_plan_path",
      "third_party_rewrite_report_path",
      "route_tree_path",
      "route_semantic_tree_path",
      "route_layers_path",
      "route_actions_android_path",
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
    if (err != NULL && err[0] == '\0') {
      set_contract_error(err, err_cap, "route_tree_path invalid");
    }
    free(doc);
    return 1;
  }
  char route_layers_raw[PATH_MAX];
  char route_layers_path[PATH_MAX];
  char route_semantic_tree_raw[PATH_MAX];
  char route_semantic_tree_path[PATH_MAX];
  if (!json_get_string(doc, "route_layers_path", route_layers_raw, sizeof(route_layers_raw)) ||
      !resolve_report_path(report_path, route_layers_raw, route_layers_path, sizeof(route_layers_path)) ||
      !validate_route_layers_file(route_layers_path, layer_count, err, err_cap)) {
    if (err != NULL && err[0] == '\0') {
      set_contract_error(err, err_cap, "route_layers_path invalid");
    }
    free(doc);
    return 1;
  }
  if (!json_get_string(doc,
                       "route_semantic_tree_path",
                       route_semantic_tree_raw,
                       sizeof(route_semantic_tree_raw)) ||
      !resolve_report_path(report_path,
                           route_semantic_tree_raw,
                           route_semantic_tree_path,
                           sizeof(route_semantic_tree_path)) ||
      !validate_route_semantic_tree_file(route_semantic_tree_path, err, err_cap)) {
    if (err != NULL && err[0] == '\0') {
      set_contract_error(err, err_cap, "route_semantic_tree_path invalid");
    }
    free(doc);
    return 1;
  }
  char route_actions_raw[PATH_MAX];
  char route_actions_path[PATH_MAX];
  if (!json_get_string(doc, "route_actions_android_path", route_actions_raw, sizeof(route_actions_raw)) ||
      !resolve_report_path(report_path, route_actions_raw, route_actions_path, sizeof(route_actions_path)) ||
      !validate_route_actions_file(route_actions_path, err, err_cap)) {
    if (err != NULL && err[0] == '\0') {
      set_contract_error(err, err_cap, "route_actions_android_path invalid");
    }
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
  if (runtime_contains_forbidden_semantic_append(runtime_doc)) {
    if (err != NULL) {
      snprintf(err, err_cap, "generated runtime contains forbidden semantic fallback: appendSemanticNode");
    }
    free(runtime_doc);
    free(doc);
    return 1;
  }
  if (!runtime_has_component_executor_api(runtime_doc)) {
    if (err != NULL) {
      snprintf(err, err_cap, "generated runtime missing component executor APIs (mount/update/unmount)");
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
  if (rt_map_nodes != (int)semantic_nodes) {
    if (err != NULL) {
      snprintf(err,
               err_cap,
               "semantic runtime map count mismatch: nodes=%d report=%lld",
               rt_map_nodes,
               semantic_nodes);
    }
    free(rt_map_doc);
    free(doc);
    return 1;
  }
  if (!validate_runtime_map_route_coverage(rt_map_doc, route_actions_path, err, err_cap)) {
    free(rt_map_doc);
    free(doc);
    return 1;
  }
  free(rt_map_doc);

  free(doc);
  return 0;
}
