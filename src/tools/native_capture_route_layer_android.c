#define _POSIX_C_SOURCE 200809L

#include "native_capture_route_layer_android.h"

#include "native_capture_android_unimaker_truth.h"
#include "native_r2c_compile_react_project.h"
#include "native_r2c_report_validate.h"

#include <ctype.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

typedef struct {
  int x;
  int y;
  int w;
  int h;
} Rect;

static char *read_file_all_local(const char *path, size_t *out_len);

static void strlist_free(StringList *list) {
  if (list == NULL) return;
  for (size_t i = 0u; i < list->len; ++i) free(list->items[i]);
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static int strlist_push(StringList *list, const char *value) {
  if (list == NULL || value == NULL || value[0] == '\0') return -1;
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

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
}

static int to_abs_path(const char *in, char *out, size_t cap) {
  if (in == NULL || in[0] == '\0' || out == NULL || cap == 0u) return -1;
  if (in[0] == '/') {
    if (snprintf(out, cap, "%s", in) >= (int)cap) return -1;
    return 0;
  }
  char cwd[PATH_MAX];
  if (getcwd(cwd, sizeof(cwd)) == NULL) return -1;
  if (snprintf(out, cap, "%s/%s", cwd, in) >= (int)cap) return -1;
  return 0;
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

static bool resolve_adb(char *out, size_t out_cap) {
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
  return find_executable_in_path("adb", out, out_cap);
}

static int read_command_text(const char *cmd, char *out, size_t out_cap) {
  if (cmd == NULL || out == NULL || out_cap == 0u) return -1;
  FILE *fp = popen(cmd, "r");
  if (fp == NULL) return -1;
  size_t n = 0u;
  out[0] = '\0';
  char line[512];
  while (fgets(line, sizeof(line), fp) != NULL) {
    size_t m = strlen(line);
    if (n + m + 1u >= out_cap) {
      pclose(fp);
      return -1;
    }
    memcpy(out + n, line, m);
    n += m;
    out[n] = '\0';
  }
  int rc = pclose(fp);
  if (rc != 0) return -1;
  return 0;
}

static bool resolve_android_serial(const char *adb, const char *preferred, char *out, size_t out_cap) {
  if (adb == NULL || adb[0] == '\0' || out == NULL || out_cap == 0u) return false;
  if (preferred != NULL && preferred[0] != '\0') {
    snprintf(out, out_cap, "%s", preferred);
    return true;
  }
  const char *env_serial = getenv("ANDROID_SERIAL");
  if (env_serial != NULL && env_serial[0] != '\0') {
    snprintf(out, out_cap, "%s", env_serial);
    return true;
  }
  char cmd[PATH_MAX + 32];
  if (snprintf(cmd, sizeof(cmd), "%s devices", adb) >= (int)sizeof(cmd)) return false;
  char buf[4096];
  if (read_command_text(cmd, buf, sizeof(buf)) != 0) return false;
  char *save = NULL;
  for (char *line = strtok_r(buf, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
    while (*line != '\0' && isspace((unsigned char)*line)) ++line;
    if (*line == '\0' || strncmp(line, "List of devices", 15) == 0) continue;
    char id[128];
    char state[64];
    id[0] = '\0';
    state[0] = '\0';
    (void)sscanf(line, "%127s %63s", id, state);
    if (id[0] != '\0' && strcmp(state, "device") == 0) {
      snprintf(out, out_cap, "%s", id);
      return true;
    }
  }
  return false;
}

static int parse_first_four_ints(const char *s, int *a, int *b, int *c, int *d) {
  if (s == NULL || a == NULL || b == NULL || c == NULL || d == NULL) return -1;
  int vals[4];
  int count = 0;
  const char *p = s;
  while (*p != '\0' && count < 4) {
    if (*p == '-' || isdigit((unsigned char)*p)) {
      char *end = NULL;
      long v = strtol(p, &end, 10);
      if (end != p) {
        vals[count++] = (int)v;
        p = end;
        continue;
      }
    }
    ++p;
  }
  if (count < 4) return -1;
  *a = vals[0];
  *b = vals[1];
  *c = vals[2];
  *d = vals[3];
  return 0;
}

static bool read_app_bounds(const char *adb, const char *serial, Rect *out_rect) {
  if (adb == NULL || serial == NULL || out_rect == NULL) return false;
  char cmd[PATH_MAX + 256];
  if (snprintf(cmd, sizeof(cmd), "%s -s %s shell dumpsys window displays", adb, serial) >= (int)sizeof(cmd)) return false;
  char buf[64 * 1024];
  if (read_command_text(cmd, buf, sizeof(buf)) != 0) return false;
  const char *p = buf;
  while ((p = strstr(p, "mAppBounds=")) != NULL) {
    const char *line_end = strchr(p, '\n');
    size_t line_len = (line_end == NULL) ? strlen(p) : (size_t)(line_end - p);
    if (line_len > 0u && line_len < 512u) {
      char line[512];
      memcpy(line, p, line_len);
      line[line_len] = '\0';
      int x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      if (parse_first_four_ints(line, &x1, &y1, &x2, &y2) == 0 && x2 > x1 && y2 > y1) {
        out_rect->x = x1;
        out_rect->y = y1;
        out_rect->w = x2 - x1;
        out_rect->h = y2 - y1;
        return true;
      }
    }
    if (line_end == NULL) break;
    p = line_end + 1;
  }
  return false;
}

static int run_adb_simple(const char *adb, const char *serial, const char *arg1, const char *arg2, const char *arg3, const char *arg4) {
  char *argv[10];
  int argc = 0;
  argv[argc++] = (char *)adb;
  argv[argc++] = "-s";
  argv[argc++] = (char *)serial;
  if (arg1 != NULL) argv[argc++] = (char *)arg1;
  if (arg2 != NULL) argv[argc++] = (char *)arg2;
  if (arg3 != NULL) argv[argc++] = (char *)arg3;
  if (arg4 != NULL) argv[argc++] = (char *)arg4;
  argv[argc] = NULL;
  NativeRunResult rr = nr_run_command(argv, NULL, 25);
  return rr.code;
}

static int run_adb_am_start(const char *adb, const char *serial) {
  return run_adb_simple(adb, serial, "shell", "am", "start", "-n com.unimaker.app/.MainActivity");
}

static int run_adb_force_stop(const char *adb, const char *serial, const char *pkg) {
  if (adb == NULL || serial == NULL || pkg == NULL || pkg[0] == '\0') return -1;
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "am",
      "force-stop",
      (char *)pkg,
      NULL,
  };
  NativeRunResult rr = nr_run_command(argv, NULL, 20);
  return rr.code;
}

static int run_adb_keyevent(const char *adb, const char *serial, int keycode) {
  char code[32];
  snprintf(code, sizeof(code), "%d", keycode);
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "input",
      "keyevent",
      code,
      NULL,
  };
  NativeRunResult rr = nr_run_command(argv, NULL, 20);
  return rr.code;
}

static int run_adb_tap(const char *adb, const char *serial, int x, int y) {
  char sx[32];
  char sy[32];
  snprintf(sx, sizeof(sx), "%d", x);
  snprintf(sy, sizeof(sy), "%d", y);
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "input",
      "tap",
      sx,
      sy,
      NULL,
  };
  NativeRunResult rr = nr_run_command(argv, NULL, 20);
  return rr.code;
}

static void grant_runtime_permissions_best_effort(const char *adb, const char *serial, const char *pkg) {
  if (adb == NULL || serial == NULL || pkg == NULL || pkg[0] == '\0') return;
  const char *perms[] = {
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.POST_NOTIFICATIONS",
  };
  for (size_t i = 0u; i < sizeof(perms) / sizeof(perms[0]); ++i) {
    char *argv[] = {
        (char *)adb,
        "-s",
        (char *)serial,
        "shell",
        "pm",
        "grant",
        (char *)pkg,
        (char *)perms[i],
        NULL,
    };
    (void)nr_run_command(argv, "/dev/null", 12);
  }
}

static void recover_foreground_unimaker(const char *adb, const char *serial) {
  (void)run_adb_keyevent(adb, serial, 4);
  usleep(300000);
  (void)run_adb_am_start(adb, serial);
  usleep(900000);
}

static bool read_route_action_script(const char *route_actions_json,
                                     const char *route,
                                     char *out_script,
                                     size_t out_cap) {
  if (route_actions_json == NULL || route == NULL || out_script == NULL || out_cap == 0u) return false;
  out_script[0] = '\0';
  size_t n = 0u;
  char *doc = read_file_all_local(route_actions_json, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_match[512];
  if (snprintf(route_match, sizeof(route_match), "\"route\":\"%s\"", route) >= (int)sizeof(route_match)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_match);
  if (hit == NULL) {
    free(doc);
    return false;
  }
  const char *script_key = strstr(hit, "\"action_script\":\"");
  if (script_key == NULL) {
    free(doc);
    return false;
  }
  script_key += strlen("\"action_script\":\"");
  const char *script_end = script_key;
  bool escaped = false;
  while (*script_end != '\0') {
    if (*script_end == '"' && !escaped) break;
    escaped = (*script_end == '\\' && !escaped);
    if (*script_end != '\\') escaped = false;
    ++script_end;
  }
  if (*script_end != '"') {
    free(doc);
    return false;
  }
  size_t len = (size_t)(script_end - script_key);
  if (len == 0u || len + 1u > out_cap) {
    free(doc);
    return false;
  }
  memcpy(out_script, script_key, len);
  out_script[len] = '\0';
  free(doc);
  return true;
}

static int replay_route_state(const char *adb, const char *serial, const char *route, const char *script) {
  if (script == NULL || script[0] == '\0') {
    fprintf(stderr, "[capture-route-layer-android] route action script empty: %s\n", route ? route : "");
    return -1;
  }
  Rect bounds;
  bounds.x = 0;
  bounds.y = 0;
  bounds.w = 1212;
  bounds.h = 2512;
  (void)read_app_bounds(adb, serial, &bounds);
  const char *p = script;
  while (*p != '\0') {
    const char *seg = p;
    while (*p != '\0' && *p != ';') ++p;
    size_t seg_len = (size_t)(p - seg);
    if (seg_len > 0u) {
      char token[128];
      if (seg_len >= sizeof(token)) return -1;
      memcpy(token, seg, seg_len);
      token[seg_len] = '\0';
      if (strcmp(token, "launch") == 0) {
        (void)run_adb_force_stop(adb, serial, "com.unimaker.app");
        usleep(250000);
        if (run_adb_am_start(adb, serial) != 0) return -1;
        usleep(1200000);
      } else if (strncmp(token, "sleep:", 6u) == 0) {
        int ms = atoi(token + 6);
        if (ms > 0) usleep((useconds_t)ms * 1000u);
      } else if (strncmp(token, "tapppm:", 7u) == 0) {
        int x_ppm = 0;
        int y_ppm = 0;
        if (sscanf(token + 7, "%d,%d", &x_ppm, &y_ppm) != 2) return -1;
        int x = bounds.x + (bounds.w * x_ppm) / 1000;
        int y = bounds.y + (bounds.h * y_ppm) / 1000;
        if (run_adb_tap(adb, serial, x, y) != 0) return -1;
      } else if (strncmp(token, "keyevent:", 9u) == 0) {
        int key = atoi(token + 9);
        if (run_adb_keyevent(adb, serial, key) != 0) return -1;
      } else {
        return -1;
      }
    }
    if (*p == ';') ++p;
  }
  return 0;
}

static int parse_int_key(const char *doc, const char *key, int *out_value) {
  if (doc == NULL || key == NULL || out_value == NULL) return -1;
  char pattern[128];
  if (snprintf(pattern, sizeof(pattern), "\"%s\"", key) >= (int)sizeof(pattern)) return -1;
  const char *p = strstr(doc, pattern);
  if (p == NULL) return -1;
  const char *colon = strchr(p + strlen(pattern), ':');
  if (colon == NULL) return -1;
  char *end = NULL;
  long v = strtol(colon + 1, &end, 10);
  if (end == colon + 1) return -1;
  *out_value = (int)v;
  return 0;
}

static char *read_file_all_local(const char *path, size_t *out_len) {
  if (out_len != NULL) *out_len = 0u;
  if (path == NULL || path[0] == '\0') return NULL;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return NULL;
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    return NULL;
  }
  long sz = ftell(fp);
  if (sz <= 0) {
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

static int parse_string_array_in_range(const char *start, const char *end, StringList *out_items) {
  if (start == NULL || end == NULL || out_items == NULL || end <= start) return -1;
  memset(out_items, 0, sizeof(*out_items));
  const char *p = start;
  while (p < end) {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n' || *p == ',')) p += 1;
    if (p >= end || *p == ']') break;
    if (*p != '"') {
      strlist_free(out_items);
      return -1;
    }
    p += 1;
    const char *token_start = p;
    while (p < end && *p != '"') {
      if (*p == '\\' && (p + 1) < end) p += 2;
      else p += 1;
    }
    if (p >= end || *p != '"') {
      strlist_free(out_items);
      return -1;
    }
    size_t len = (size_t)(p - token_start);
    if (len == 0u || len >= 256u) {
      strlist_free(out_items);
      return -1;
    }
    char token[256];
    memcpy(token, token_start, len);
    token[len] = '\0';
    if (strlist_push(out_items, token) != 0) {
      strlist_free(out_items);
      return -1;
    }
    p += 1;
  }
  return out_items->len > 0u ? 0 : -1;
}

static int parse_route_layer_states(const char *layers_json_path, int layer_index, int *out_layer_count, StringList *out_states) {
  if (layers_json_path == NULL || layer_index < 0 || out_states == NULL) return -1;
  memset(out_states, 0, sizeof(*out_states));
  if (out_layer_count != NULL) *out_layer_count = 0;
  size_t n = 0u;
  char *doc = read_file_all_local(layers_json_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return -1;
  }
  int parsed_layer_count = 0;
  if (parse_int_key(doc, "layer_count", &parsed_layer_count) == 0 && out_layer_count != NULL) {
    *out_layer_count = parsed_layer_count;
  }

  const char *p = doc;
  while ((p = strstr(p, "\"layer_index\"")) != NULL) {
    const char *colon = strchr(p, ':');
    if (colon == NULL) break;
    char *end_num = NULL;
    long current = strtol(colon + 1, &end_num, 10);
    if (end_num == colon + 1) {
      p += strlen("\"layer_index\"");
      continue;
    }
    const char *obj_end = strchr(end_num, '}');
    if (obj_end == NULL) break;
    if ((int)current == layer_index) {
      const char *routes_key = strstr(end_num, "\"routes\"");
      if (routes_key == NULL || routes_key >= obj_end) {
        free(doc);
        return -1;
      }
      const char *routes_arr = strchr(routes_key, '[');
      if (routes_arr == NULL || routes_arr >= obj_end) {
        free(doc);
        return -1;
      }
      const char *routes_end = strchr(routes_arr, ']');
      if (routes_end == NULL || routes_end >= obj_end) {
        free(doc);
        return -1;
      }
      int rc = parse_string_array_in_range(routes_arr + 1, routes_end, out_states);
      free(doc);
      return rc;
    }
    p = obj_end + 1;
  }
  free(doc);
  return -1;
}

static int ensure_compile_artifacts(const char *scripts_dir, const char *project, const char *entry, const char *compile_out) {
  char report_json[PATH_MAX];
  if (nr_path_join(report_json, sizeof(report_json), compile_out, "r2capp/r2capp_compile_report.json") == 0 &&
      nr_file_exists(report_json)) {
    return 0;
  }
  if (nr_ensure_dir(compile_out) != 0) return -1;
  char *compile_argv[] = {
      "r2c_compile_react_project",
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      (char *)compile_out,
      "--strict",
      NULL,
  };
  return native_r2c_compile_react_project(scripts_dir, 8, compile_argv, 1);
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  capture_route_layer_android --layer-index <n> [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--compile-out <abs>] [--truth-dir <abs>] [--serial <id>] [--first-install-pass 0|1]\n");
}

int native_capture_route_layer_android(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }
  const char *project = getenv("R2C_REAL_PROJECT");
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  const char *entry = getenv("R2C_REAL_ENTRY");
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";
  const char *out_dir = "/Users/lbcheng/.cheng-packages/cheng-gui/build/claude_bfs_android";
  const char *compile_out = NULL;
  const char *truth_dir = NULL;
  const char *serial_opt = NULL;
  int layer_index = -1;
  int first_install_pass = 0;
  const char *capture_source = "unimaker_foreground_runtime_visible";

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
    if (strcmp(arg, "--compile-out") == 0) {
      if (i + 1 >= argc) return 2;
      compile_out = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--truth-dir") == 0) {
      if (i + 1 >= argc) return 2;
      truth_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--serial") == 0) {
      if (i + 1 >= argc) return 2;
      serial_opt = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--layer-index") == 0) {
      if (i + 1 >= argc) return 2;
      layer_index = atoi(argv[i + 1]);
      i += 2;
      continue;
    }
    if (strcmp(arg, "--first-install-pass") == 0) {
      if (i + 1 >= argc) return 2;
      first_install_pass = atoi(argv[i + 1]) != 0 ? 1 : 0;
      i += 2;
      continue;
    }
    if (strcmp(arg, "--capture-source") == 0) {
      if (i + 1 >= argc) return 2;
      capture_source = argv[i + 1];
      i += 2;
      continue;
    }
    fprintf(stderr, "[capture-route-layer-android] unknown arg: %s\n", arg);
    return 2;
  }

  if (strcmp(capture_source, "unimaker_foreground_runtime_visible") != 0) {
    fprintf(stderr, "[capture-route-layer-android] unsupported capture source: %s\n", capture_source);
    return 2;
  }
  if (layer_index < 0) {
    fprintf(stderr, "[capture-route-layer-android] --layer-index is required\n");
    return 2;
  }

  char out_abs[PATH_MAX];
  if (to_abs_path(out_dir, out_abs, sizeof(out_abs)) != 0) return 2;
  if (nr_ensure_dir(out_abs) != 0) return 1;

  char compile_out_default[PATH_MAX];
  if (compile_out == NULL || compile_out[0] == '\0') {
    if (nr_path_join(compile_out_default, sizeof(compile_out_default), out_abs, "compile") != 0) return 1;
    compile_out = compile_out_default;
  }
  char compile_out_abs[PATH_MAX];
  if (to_abs_path(compile_out, compile_out_abs, sizeof(compile_out_abs)) != 0) return 2;
  compile_out = compile_out_abs;

  if (truth_dir == NULL || truth_dir[0] == '\0') {
    static char truth_default[PATH_MAX];
    if (nr_path_join(truth_default, sizeof(truth_default), compile_out, "r2capp/truth") != 0) return 1;
    truth_dir = truth_default;
  }
  char truth_abs[PATH_MAX];
  if (to_abs_path(truth_dir, truth_abs, sizeof(truth_abs)) != 0) return 2;
  truth_dir = truth_abs;
  if (nr_ensure_dir(truth_dir) != 0) return 1;

  if (ensure_compile_artifacts(scripts_dir, project, entry, compile_out) != 0) {
    fprintf(stderr, "[capture-route-layer-android] compile failed\n");
    return 1;
  }

  char route_layers_json[PATH_MAX];
  if (nr_path_join(route_layers_json, sizeof(route_layers_json), compile_out, "r2capp/r2c_route_layers.json") != 0 ||
      !nr_file_exists(route_layers_json)) {
    fprintf(stderr, "[capture-route-layer-android] missing route layers json: %s\n", route_layers_json);
    return 1;
  }
  char route_actions_json[PATH_MAX];
  if (nr_path_join(route_actions_json, sizeof(route_actions_json), compile_out, "r2capp/r2c_route_actions_android.json") != 0 ||
      !nr_file_exists(route_actions_json)) {
    fprintf(stderr, "[capture-route-layer-android] missing route actions json: %s\n", route_actions_json);
    return 1;
  }

  StringList routes;
  memset(&routes, 0, sizeof(routes));
  int layer_count = 0;
  if (parse_route_layer_states(route_layers_json, layer_index, &layer_count, &routes) != 0 || routes.len == 0u) {
    fprintf(stderr,
            "[capture-route-layer-android] failed to parse routes for layer=%d file=%s\n",
            layer_index,
            route_layers_json);
    strlist_free(&routes);
    return 1;
  }

  char adb[PATH_MAX];
  char serial[128];
  if (!resolve_adb(adb, sizeof(adb)) || !resolve_android_serial(adb, serial_opt, serial, sizeof(serial))) {
    fprintf(stderr, "[capture-route-layer-android] failed to resolve adb/serial\n");
    strlist_free(&routes);
    return 1;
  }

  fprintf(stdout,
          "[capture-route-layer-android] layer=%d/%d routes=%zu truth=%s serial=%s\n",
          layer_index,
          layer_count,
          routes.len,
          truth_dir,
          serial);

  grant_runtime_permissions_best_effort(adb, serial, "com.unimaker.app");

  for (size_t i = 0u; i < routes.len; ++i) {
    const char *route = routes.items[i];
    if (strcmp(route, "lang_select") == 0 && !first_install_pass) {
      fprintf(stdout, "[capture-route-layer-android] skip route=%s (first-install only)\n", route);
      continue;
    }
    char action_script[1024];
    if (!read_route_action_script(route_actions_json, route, action_script, sizeof(action_script))) {
      fprintf(stderr,
              "[capture-route-layer-android] route action missing in compile output: route=%s file=%s\n",
              route,
              route_actions_json);
      strlist_free(&routes);
      return 1;
    }
    int cap_rc = 1;
    for (int attempt = 0; attempt < 2; ++attempt) {
      if (replay_route_state(adb, serial, route, action_script) != 0) {
        fprintf(stderr, "[capture-route-layer-android] replay failed route=%s attempt=%d\n", route, attempt + 1);
        strlist_free(&routes);
        return 1;
      }
      char *cap_argv[] = {
          "capture_android_unimaker_truth",
          "--route-state",
          (char *)route,
          "--out-dir",
          (char *)truth_dir,
          "--serial",
          serial,
          NULL,
      };
      cap_rc = native_capture_android_unimaker_truth(scripts_dir, 7, cap_argv, 1);
      if (cap_rc == 0) break;
      if (attempt == 0) {
        fprintf(stdout,
                "[capture-route-layer-android] retry route=%s after foreground recovery\n",
                route);
        recover_foreground_unimaker(adb, serial);
      }
    }
    if (cap_rc != 0) {
      fprintf(stderr, "[capture-route-layer-android] capture failed route=%s rc=%d\n", route, cap_rc);
      strlist_free(&routes);
      return cap_rc;
    }
  }

  strlist_free(&routes);
  fprintf(stdout, "[capture-route-layer-android] ok layer=%d\n", layer_index);
  return 0;
}
