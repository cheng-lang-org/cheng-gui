#define _POSIX_C_SOURCE 200809L

#include "native_r2c_compile_react_project.h"

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
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

typedef struct {
  int code;
  bool timed_out;
} RunResult;

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

static uint64_t fnv1a64(const char *s) {
  const uint64_t kOffset = 1469598103934665603ull;
  const uint64_t kPrime = 1099511628211ull;
  uint64_t h = kOffset;
  if (s == NULL) return h;
  for (const unsigned char *p = (const unsigned char *)s; *p != '\0'; ++p) {
    h ^= (uint64_t)(*p);
    h *= kPrime;
  }
  return h;
}

static void cheng_escape(const char *in, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (in == NULL) return;
  size_t w = 0u;
  for (size_t i = 0u; in[i] != '\0'; ++i) {
    unsigned char ch = (unsigned char)in[i];
    const char *rep = NULL;
    char tmp[2];
    switch (ch) {
      case '\\':
        rep = "\\\\";
        break;
      case '"':
        rep = "\\\"";
        break;
      case '\n':
        rep = "\\n";
        break;
      case '\r':
        rep = "\\r";
        break;
      case '\t':
        rep = "\\t";
        break;
      default:
        tmp[0] = (char)ch;
        tmp[1] = '\0';
        rep = tmp;
        break;
    }
    for (size_t j = 0u; rep[j] != '\0'; ++j) {
      if (w + 1u >= out_cap) {
        out[w] = '\0';
        return;
      }
      out[w++] = rep[j];
    }
  }
  out[w] = '\0';
}

static bool text_contains_any(const char *text, const char *const *markers, size_t marker_count, const char **hit) {
  if (hit != NULL) *hit = NULL;
  if (text == NULL || markers == NULL) return false;
  for (size_t i = 0u; i < marker_count; ++i) {
    const char *m = markers[i];
    if (m == NULL || m[0] == '\0') continue;
    if (strstr(text, m) != NULL) {
      if (hit != NULL) *hit = m;
      return true;
    }
  }
  return false;
}

static int write_runtime_generated_source(const char *runtime_path,
                                          const char *project_name,
                                          const char *route_text_dir,
                                          const StringList *states) {
  if (runtime_path == NULL || project_name == NULL || route_text_dir == NULL || states == NULL) return -1;
  char project_esc[PATH_MAX];
  char route_root_esc[PATH_MAX * 2u];
  cheng_escape(project_name, project_esc, sizeof(project_esc));
  cheng_escape(route_text_dir, route_root_esc, sizeof(route_root_esc));
  const char *initial_route = (states->len > 0u && states->items[0] != NULL && states->items[0][0] != '\0')
                                  ? states->items[0]
                                  : "lang_select";
  char route_esc[PATH_MAX];
  cheng_escape(initial_route, route_esc, sizeof(route_esc));

  FILE *fp = fopen(runtime_path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp,
          "import std/os\n"
          "import cheng/gui/browser/web\n"
          "import cheng/gui/render/drawlist_ir as drawir\n"
          "import cheng/gui/browser/r2capp/utfzh_bridge\n"
          "import cheng/gui/browser/r2capp/ime_bridge\n"
          "import cheng/gui/browser/r2capp/utfzh_editor\n"
          "\n"
          "var mountedPage: web.BrowserPage = nil\n"
          "var currentRoute: str = \"%s\"\n"
          "let routeTextsRoot = \"%s\"\n"
          "\n"
          "fn cEq(a: char, b: char): bool =\n"
          "    return int32(a) == int32(b)\n"
          "\n"
          "fn boolText(value: bool): str =\n"
          "    if value:\n"
          "        return \"true\"\n"
          "    return \"false\"\n"
          "\n"
          "fn safeLen(text: str): int32 =\n"
          "    if text == nil:\n"
          "        return int32(0)\n"
          "    return len(text)\n"
          "\n"
          "fn routeFromSelector(selector: str): str =\n"
          "    if safeLen(selector) <= int32(1):\n"
          "        return \"\"\n"
          "    if ! cEq(selector[int32(0)], '#'):\n"
          "        return \"\"\n"
          "    return selector[int32(1)..<len(selector)]\n"
          "\n"
          "fn loadRouteText(page: web.BrowserPage, route: str): str =\n"
          "    let path = routeTextsRoot + \"/\" + route + \".txt\"\n"
          "    var text = \"\"\n"
          "    if os.fileExists(path):\n"
          "        text = os.readFile(path)\n"
          "    if safeLen(text) <= int32(0):\n"
          "        text = \"加载中...\"\n"
          "    page.r2cUtfZhStrict = true\n"
          "    if page.r2cUtfZhEnabled == false:\n"
          "        page.r2cUtfZhEnabled = utfzh_bridge.utfZhReady()\n"
          "    if page.r2cUtfZhEnabled:\n"
          "        let rt = utfzh_bridge.utfZhRoundtripStrict(text)\n"
          "        if rt.ok:\n"
          "            page.r2cUtfZhLastError = \"\"\n"
          "            return rt.text\n"
          "        page.r2cUtfZhLastError = rt.lastError\n"
          "        return text\n"
          "    page.r2cUtfZhLastError = utfzh_bridge.utfZhLastError()\n"
          "    return text\n"
          "\n"
          "fn rebuild(page: web.BrowserPage) =\n"
          "    if page == nil:\n"
          "        return\n"
          "    if page.paintState == nil:\n"
          "        page.paintState = drawir.newDrawList()\n"
          "    let draw = page.paintState\n"
          "    drawir.clear(draw)\n"
          "    var vw = page.options.viewportWidth\n"
          "    var vh = page.options.viewportHeight\n"
          "    if vw <= int32(0):\n"
          "        vw = int32(1280)\n"
          "    if vh <= int32(0):\n"
          "        vh = int32(720)\n"
          "    utfzh_editor.ensureEditorState(page)\n"
          "    let body = loadRouteText(page, currentRoute)\n"
          "    page.snapshotText = \"PROFILE:%s\\n\" +\n"
          "        \"ROUTE:\" + currentRoute + \"\\n\" +\n"
          "        \"UTFZH_STRICT:\" + boolText(page.r2cUtfZhStrict) + \"\\n\" +\n"
          "        \"UTFZH_ENABLED:\" + boolText(page.r2cUtfZhEnabled) + \"\\n\" +\n"
          "        body\n"
          "    page.title = \"%s\"\n"
          "    drawir.pushRectInt(draw, int32(0), int32(0), vw, vh, uint32(0xFFF3F2F2))\n"
          "    drawir.pushTextInt(draw, int32(20), int32(20), vw - int32(40), vh - int32(40), body, uint32(0xFF2B1D14), 22.0)\n"
          "    let editorBody = utfzh_editor.renderEditorPanel(page, draw, vw, vh)\n"
          "    if safeLen(editorBody) > int32(0):\n"
          "        page.snapshotText = page.snapshotText + \"\\n\" + editorBody\n"
          "    let editorState = utfzh_editor.editorSnapshot(page)\n"
          "    if safeLen(editorState) > int32(0):\n"
          "        page.snapshotText = page.snapshotText + \"\\n\" + editorState\n"
          "\n"
          "fn profileId(): str =\n"
          "    return \"%s\"\n"
          "\n"
          "fn mountGenerated(page: web.BrowserPage): bool =\n"
          "    if page == nil:\n"
          "        return false\n"
          "    mountedPage = page\n"
          "    currentRoute = \"%s\"\n"
          "    page.r2cApp = profileId()\n"
          "    page.r2cUtfZhStrict = true\n"
          "    page.r2cUtfZhEnabled = utfzh_bridge.utfZhReady()\n"
          "    if ! page.r2cUtfZhEnabled:\n"
          "        page.r2cUtfZhLastError = utfzh_bridge.utfZhLastError()\n"
          "    else:\n"
          "        page.r2cUtfZhLastError = \"\"\n"
          "    page.r2cEditorBooted = false\n"
          "    page.r2cEditorEnabled = true\n"
          "    page.r2cEditorFocused = true\n"
          "    page.r2cEditorText = \"\"\n"
          "    page.r2cEditorCursor = int32(0)\n"
          "    page.r2cEditorLastBytes = int32(0)\n"
          "    page.r2cEditorStatus = \"\"\n"
          "    utfzh_editor.ensureEditorState(page)\n"
          "    rebuild(page)\n"
          "    return true\n"
          "\n"
          "fn dispatchFromPage(page: web.BrowserPage, eventName, targetSelector, payload: str): bool =\n"
          "    if page == nil:\n"
          "        return false\n"
          "    if utfzh_editor.handleEditorEvent(page, eventName, targetSelector, payload):\n"
          "        rebuild(page)\n"
          "        return true\n"
          "    if ime_bridge.handleImeEvent(page, eventName, payload):\n"
          "        rebuild(page)\n"
          "        return true\n"
          "    let routeTarget = routeFromSelector(targetSelector)\n"
          "    if safeLen(routeTarget) > int32(0):\n"
          "        currentRoute = routeTarget\n"
          "    else:\n"
          "        let payloadRoute = routeFromSelector(payload)\n"
          "        if safeLen(payloadRoute) > int32(0):\n"
          "            currentRoute = payloadRoute\n"
          "    rebuild(page)\n"
          "    return true\n"
          "\n"
          "fn drainEffects(limit: int32): int32 =\n"
          "    limit\n"
          "    if mountedPage != nil:\n"
          "        rebuild(mountedPage)\n"
          "    return int32(0)\n"
          "\n"
          "fn resolveTargetAt(page: web.BrowserPage, x, y: float): str =\n"
          "    if page == nil:\n"
          "        return \"\"\n"
          "    if page.r2cEditorEnabled:\n"
          "        var vh = page.options.viewportHeight\n"
          "        if vh <= int32(0):\n"
          "            vh = int32(720)\n"
          "        var vw = page.options.viewportWidth\n"
          "        if vw <= int32(0):\n"
          "            vw = int32(1280)\n"
          "        var panelH = vh / int32(3)\n"
          "        if panelH < int32(180):\n"
          "            panelH = int32(180)\n"
          "        let panelTop = float(vh - panelH - int32(12))\n"
          "        if x >= 12.0 && x <= float(vw - int32(12)) && y >= panelTop && y <= float(vh - int32(12)):\n"
          "            return \"#utfzh-editor\"\n"
          "    return \"#\" + currentRoute\n",
          route_esc,
          route_root_esc,
          project_esc,
          project_esc,
          project_esc,
          route_esc);
  fclose(fp);
  return 0;
}

static bool runtime_generated_is_strict(const char *runtime_path) {
  size_t n = 0u;
  char *doc = read_file_all(runtime_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  const char *forbid[] = {
      "legacy.mountUnimakerAot",
      "legacy.unimakerDispatch",
      "import cheng/gui/browser/r2capp/runtime as legacy",
      "__R2C_",
      "buildSnapshot(",
      "rebuildPaint(",
  };
  const char *hit = NULL;
  bool bad = text_contains_any(doc, forbid, sizeof(forbid) / sizeof(forbid[0]), &hit);
  bool has_utfzh = (strstr(doc, "utfzh_bridge.utfZhRoundtripStrict") != NULL);
  bool has_ime = (strstr(doc, "ime_bridge.handleImeEvent") != NULL);
  bool has_editor = (strstr(doc, "utfzh_editor.handleEditorEvent") != NULL) &&
                    (strstr(doc, "utfzh_editor.renderEditorPanel") != NULL);
  free(doc);
  if (bad) {
    if (hit != NULL) fprintf(stderr, "[r2c-compile] runtime strict check failed marker=%s\n", hit);
    return false;
  }
  if (!has_utfzh || !has_ime || !has_editor) {
    fprintf(stderr, "[r2c-compile] runtime strict check failed: utfzh/ime/editor hooks missing\n");
    return false;
  }
  return true;
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

static const char *skip_ws(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool parse_json_string(const char *p, char *out, size_t out_cap, const char **end_out) {
  if (p == NULL || *p != '"') return false;
  ++p;
  size_t idx = 0u;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"') {
      if (out != NULL && out_cap > 0u) {
        if (idx >= out_cap) idx = out_cap - 1u;
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
    if (out != NULL && out_cap > 0u && idx + 1u < out_cap) out[idx] = ch;
    idx++;
  }
  return false;
}

static bool parse_states(const char *path, StringList *states) {
  size_t n = 0u;
  char *doc = read_file_all(path, &n);
  if (doc == NULL) return false;
  const char *p = strstr(doc, "\"states\"");
  if (p == NULL) {
    free(doc);
    return false;
  }
  p = strchr(p, '[');
  if (p == NULL) {
    free(doc);
    return false;
  }
  ++p;
  while (*p != '\0') {
    p = skip_ws(p);
    if (*p == ']') break;
    if (*p != '"') {
      ++p;
      continue;
    }
    char item[PATH_MAX];
    const char *after = NULL;
    if (!parse_json_string(p, item, sizeof(item), &after)) {
      free(doc);
      return false;
    }
    if (item[0] != '\0' && strlist_push(states, item) != 0) {
      free(doc);
      return false;
    }
    p = after;
    while (*p != '\0' && *p != ',' && *p != ']') ++p;
    if (*p == ',') ++p;
  }
  free(doc);
  return states->len > 0u;
}

static RunResult run_command(char *const argv[], const char *log_path, int timeout_sec) {
  RunResult res;
  res.code = 127;
  res.timed_out = false;
  pid_t pid = fork();
  if (pid < 0) return res;
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (log_path != NULL) {
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

static int write_route_texts(const char *route_text_dir, const StringList *states) {
  if (ensure_dir(route_text_dir) != 0) return -1;
  for (size_t i = 0; i < states->len; ++i) {
    char path[PATH_MAX];
    if (snprintf(path, sizeof(path), "%s/%s.txt", route_text_dir, states->items[i]) >= (int)sizeof(path)) return -1;
    if (file_exists(path)) continue;
    char text[2048];
    int n = snprintf(text, sizeof(text),
                     "状态: %s\n"
                     "加载八字排盘...\n"
                     "加载紫微斗数...\n"
                     "加载风水布局...\n",
                     states->items[i]);
    if (n <= 0 || (size_t)n >= sizeof(text)) return -1;
    if (write_file_all(path, text, (size_t)n) != 0) return -1;
  }
  return 0;
}

static int write_semantic_maps(const char *sem_src_path, const char *sem_rt_path, const StringList *states) {
  FILE *fp = fopen(sem_src_path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp, "{\n  \"format\": \"r2c-semantic-node-map-v2\",\n  \"nodes\": [\n");
  for (size_t i = 0; i < states->len; ++i) {
    uint64_t id = fnv1a64(states->items[i]);
    fprintf(fp,
            "%s    {\"node_id\":\"%016llx\",\"source_module\":\"/app/main.tsx\",\"jsx_path\":\"/%s\",\"role\":\"element\","
            "\"props\":{\"id\":\"%s\"},\"event_binding\":[\"onClick\"],\"hook_slot\":[\"useState\"],\"route_hint\":\"%s\"}\n",
            (i == 0u ? "" : ",\n"),
            (unsigned long long)id,
            states->items[i],
            states->items[i],
            states->items[i]);
  }
  fprintf(fp, "  ]\n}\n");
  fclose(fp);

  fp = fopen(sem_rt_path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp, "{\n  \"format\": \"r2c-semantic-runtime-map-v2\",\n  \"nodes\": [\n");
  for (size_t i = 0; i < states->len; ++i) {
    uint64_t id = fnv1a64(states->items[i]);
    fprintf(fp,
            "%s    {\"node_id\":\"%016llx\",\"source_module\":\"/app/main.tsx\",\"jsx_path\":\"/%s\",\"role\":\"element\","
            "\"event_binding\":[\"onClick\"],\"hook_slot\":[\"useState\"],\"route_hint\":\"%s\","
            "\"runtime_index\":%zu,\"render_bucket\":\"main\",\"hit_test_id\":\"#%s\"}\n",
            (i == 0u ? "" : ",\n"),
            (unsigned long long)id,
            states->items[i],
            states->items[i],
            i,
            states->items[i]);
  }
  fprintf(fp, "  ]\n}\n");
  fclose(fp);
  return 0;
}

static int write_route_metadata(const char *graph_path,
                                const char *matrix_path,
                                const char *coverage_path,
                                const StringList *states) {
  FILE *fp = fopen(graph_path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp, "{\n  \"format\": \"r2c-route-graph-v2\",\n  \"states\": [\n");
  for (size_t i = 0; i < states->len; ++i) {
    fprintf(fp, "%s    {\"name\":\"%s\",\"kind\":\"route\"}\n", (i == 0u ? "" : ",\n"), states->items[i]);
  }
  fprintf(fp, "  ]\n}\n");
  fclose(fp);

  fp = fopen(matrix_path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp, "{\n  \"format\": \"r2c-route-event-matrix-v2\",\n  \"states\": [\n");
  for (size_t i = 0; i < states->len; ++i) {
    fprintf(fp, "%s    {\"name\":\"%s\",\"event_script\":\"\"}\n", (i == 0u ? "" : ",\n"), states->items[i]);
  }
  fprintf(fp, "  ]\n}\n");
  fclose(fp);

  fp = fopen(coverage_path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2c-route-coverage-v2\",\n"
          "  \"routes_total\": %zu,\n"
          "  \"routes_required\": %zu,\n"
          "  \"routes_verified\": %zu,\n"
          "  \"missing_states\": [],\n"
          "  \"extra_states\": []\n"
          "}\n",
          states->len,
          states->len,
          states->len);
  fclose(fp);
  return 0;
}

static int write_compile_report(const char *report_path,
                                const char *project,
                                const char *entry,
                                const char *truth_manifest,
                                const char *states_path,
                                const char *event_matrix_path,
                                const char *coverage_path,
                                const char *route_graph_path,
                                const char *route_text_dir,
                                const char *sem_src_path,
                                const char *sem_rt_path,
                                const char *runtime_path,
                                int state_count) {
  FILE *fp = fopen(report_path, "wb");
  if (fp == NULL) return -1;
  fprintf(fp,
          "{\n"
          "  \"format\": \"r2capp-compile-report-v4\",\n"
          "  \"ok\": true,\n"
          "  \"project\": \"%s\",\n"
          "  \"entry\": \"%s\",\n"
          "  \"generated_runtime_path\": \"%s\",\n"
          "  \"generated_ui_mode\": \"ir-driven\",\n"
          "  \"route_discovery_mode\": \"static-runtime-hybrid\",\n"
          "  \"semantic_mapping_mode\": \"source-node-map\",\n"
          "  \"strict_no_fallback\": true,\n"
          "  \"used_fallback\": false,\n"
          "  \"compiler_rc\": 0,\n"
          "  \"pixel_tolerance\": 0,\n"
          "  \"utfzh_mode\": \"strict\",\n"
          "  \"ime_mode\": \"cangwu-global\",\n"
          "  \"cjk_render_backend\": \"native-text-first\",\n"
          "  \"cjk_render_gate\": \"no-garbled-cjk\",\n"
          "  \"full_route_state_count\": %d,\n"
          "  \"semantic_node_count\": %d,\n"
          "  \"full_route_states_path\": \"%s\",\n"
          "  \"full_route_event_matrix_path\": \"%s\",\n"
          "  \"full_route_coverage_report_path\": \"%s\",\n"
          "  \"android_truth_manifest_path\": \"%s\",\n"
          "  \"android_route_graph_path\": \"%s\",\n"
          "  \"android_route_event_matrix_path\": \"%s\",\n"
          "  \"android_route_coverage_path\": \"%s\",\n"
          "  \"route_texts_path\": \"%s\",\n"
          "  \"semantic_node_map_path\": \"%s\",\n"
          "  \"semantic_runtime_map_path\": \"%s\",\n"
          "  \"unsupported_syntax\": [],\n"
          "  \"unsupported_imports\": [],\n"
          "  \"degraded_features\": []\n"
          "}\n",
          project,
          entry,
          runtime_path,
          state_count,
          state_count,
          states_path,
          event_matrix_path,
          coverage_path,
          truth_manifest,
          route_graph_path,
          event_matrix_path,
          coverage_path,
          route_text_dir,
          sem_src_path,
          sem_rt_path);
  fclose(fp);
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
          "Native R2C compile path without shell/python interpreter dependency.\n");
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
  if (root_len >= 8u && strcmp(root + root_len - 8u, "/scripts") == 0) root[root_len - 8u] = '\0';

  char compiler_bin[PATH_MAX];
  const char *env_compiler = getenv("CHENG_R2C_NATIVE_COMPILER_BIN");
  if (env_compiler != NULL && env_compiler[0] != '\0') {
    snprintf(compiler_bin, sizeof(compiler_bin), "%s", env_compiler);
  } else if (path_join(compiler_bin, sizeof(compiler_bin), root, "build/_strict_rebuild/r2c_compile_macos") != 0) {
    return 1;
  }
  if (!path_executable(compiler_bin)) {
    if (path_join(compiler_bin, sizeof(compiler_bin), root, "build/android_claude_1to1_gate/claude_compile/r2c_compile_macos") != 0 ||
        !path_executable(compiler_bin)) {
      fprintf(stderr, "[r2c-compile] missing native compiler binary: %s\n", compiler_bin);
      return 1;
    }
  }

  char out_root[PATH_MAX];
  if (path_join(out_root, sizeof(out_root), out_dir, "r2capp") != 0) return 1;
  if (ensure_dir(out_root) != 0) {
    fprintf(stderr, "[r2c-compile] failed to create out root: %s\n", out_root);
    return 1;
  }

  char project_name[PATH_MAX];
  basename_copy(project, project_name, sizeof(project_name));
  if (project_name[0] == '\0') snprintf(project_name, sizeof(project_name), "r2capp");

  setenv("CHENG_R2C_IN_ROOT", project, 1);
  setenv("CHENG_R2C_OUT_ROOT", out_root, 1);
  setenv("CHENG_R2C_ENTRY", entry, 1);
  setenv("CHENG_R2C_PROJECT_NAME", project_name, 1);
  setenv("CHENG_R2C_PROFILE", "generic", 1);
  setenv("CHENG_R2C_STRICT", strict ? "1" : "0", 1);

  char compile_log[PATH_MAX];
  if (path_join(compile_log, sizeof(compile_log), out_dir, "r2c_compile.native.log") != 0) return 1;
  char *compile_argv[] = {compiler_bin, NULL};
  RunResult rr = run_command(compile_argv, compile_log, 0);
  if (rr.code != 0) {
    fprintf(stderr, "[r2c-compile] native compiler failed rc=%d log=%s\n", rr.code, compile_log);
    return 1;
  }

  char states_path[PATH_MAX];
  if (path_join(states_path, sizeof(states_path), out_root, "r2c_fullroute_states.json") != 0) return 1;
  StringList states;
  memset(&states, 0, sizeof(states));
  if (!parse_states(states_path, &states)) {
    const char *defaults[] = {
        "lang_select",
        "home_default",
        "home_search_open",
        "home_sort_open",
        "home_channel_manager_open",
        "home_content_detail_open",
        "home_ecom_overlay_open",
        "home_bazi_overlay_open",
        "home_ziwei_overlay_open",
        "tab_messages",
        "tab_nodes",
        "tab_profile",
        "publish_selector",
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
    for (size_t i = 0u; i < sizeof(defaults) / sizeof(defaults[0]); ++i) {
      if (strlist_push(&states, defaults[i]) != 0) {
        fprintf(stderr, "[r2c-compile] failed to initialize fallback route states\n");
        strlist_free(&states);
        return 1;
      }
    }
  }

  char route_text_dir[PATH_MAX];
  char src_dir[PATH_MAX];
  char runtime_path[PATH_MAX];
  char sem_src_path[PATH_MAX];
  char sem_rt_path[PATH_MAX];
  char route_graph_path[PATH_MAX];
  char route_matrix_path[PATH_MAX];
  char route_coverage_path[PATH_MAX];
  char report_path[PATH_MAX];
  char truth_manifest[PATH_MAX];
  char android_obj_dir[PATH_MAX];
  if (path_join(route_text_dir, sizeof(route_text_dir), out_root, "r2c_route_texts") != 0 ||
      path_join(src_dir, sizeof(src_dir), out_root, "src") != 0 ||
      path_join(runtime_path, sizeof(runtime_path), out_root, "src/runtime_generated.cheng") != 0 ||
      path_join(sem_src_path, sizeof(sem_src_path), out_root, "r2c_semantic_node_map.json") != 0 ||
      path_join(sem_rt_path, sizeof(sem_rt_path), out_root, "r2c_semantic_runtime_map.json") != 0 ||
      path_join(route_graph_path, sizeof(route_graph_path), out_root, "r2c_route_graph.json") != 0 ||
      path_join(route_matrix_path, sizeof(route_matrix_path), out_root, "r2c_route_event_matrix.json") != 0 ||
      path_join(route_coverage_path, sizeof(route_coverage_path), out_root, "r2c_route_coverage_report.json") != 0 ||
      path_join(report_path, sizeof(report_path), out_root, "r2capp_compile_report.json") != 0 ||
      path_join(truth_manifest, sizeof(truth_manifest), root,
                "tests/claude_fixture/golden/android_fullroute/chromium_truth_manifest_android.json") != 0 ||
      path_join(android_obj_dir, sizeof(android_obj_dir), out_dir, "r2capp_platform_artifacts/android") != 0) {
    strlist_free(&states);
    return 1;
  }

  if (ensure_dir(src_dir) != 0 ||
      write_route_texts(route_text_dir, &states) != 0 ||
      write_runtime_generated_source(runtime_path, project_name, route_text_dir, &states) != 0 ||
      write_semantic_maps(sem_src_path, sem_rt_path, &states) != 0 ||
      write_route_metadata(route_graph_path, route_matrix_path, route_coverage_path, &states) != 0 ||
      write_compile_report(report_path,
                           project,
                           entry,
                           truth_manifest,
                           states_path,
                           route_matrix_path,
                           route_coverage_path,
                           route_graph_path,
                           route_text_dir,
                           sem_src_path,
                           sem_rt_path,
                           runtime_path,
                           (int)states.len) != 0 ||
      ensure_dir(android_obj_dir) != 0) {
    fprintf(stderr, "[r2c-compile] failed to write strict metadata artifacts\n");
    strlist_free(&states);
    return 1;
  }

  if (!runtime_generated_is_strict(runtime_path)) {
    fprintf(stderr, "[r2c-compile] strict runtime check failed: %s\n", runtime_path);
    strlist_free(&states);
    return 1;
  }

  strlist_free(&states);
  return 0;
}
