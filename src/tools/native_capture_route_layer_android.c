#define _POSIX_C_SOURCE 200809L

#include "native_capture_route_layer_android.h"

#include "native_capture_android_unimaker_truth.h"
#include "native_r2c_compile_react_project.h"
#include "native_r2c_report_validate.h"
#include "native_verify_android_claude_1to1_gate.h"

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

typedef enum {
  ROUTE_ACTION_INVALID = 0,
  ROUTE_ACTION_LAUNCH_MAIN,
  ROUTE_ACTION_SLEEP_MS,
  ROUTE_ACTION_TAP_PPM,
  ROUTE_ACTION_KEYEVENT,
} RouteActionType;

typedef struct {
  RouteActionType type;
  int v0;
  int v1;
} RouteAction;

typedef struct {
  RouteAction *items;
  size_t len;
  size_t cap;
} RouteActionList;

static int g_foreground_recover_used_local = 0;

static char *read_file_all_local(const char *path, size_t *out_len);
static bool load_route_semantic_expectation_local(const char *route_semantic_tree_path,
                                                  const char *route,
                                                  char *out_hash,
                                                  size_t out_hash_cap,
                                                  int *out_count);
static bool read_runtime_route_semantic_state(const char *adb,
                                              const char *serial,
                                              const char *pkg,
                                              char *out_route,
                                              size_t out_route_cap,
                                              char *out_semantic_hash,
                                              size_t out_semantic_hash_cap,
                                              int *out_semantic_count);
static bool read_runtime_route_semantic_state_retry(const char *adb,
                                                    const char *serial,
                                                    const char *pkg,
                                                    char *out_route,
                                                    size_t out_route_cap,
                                                    char *out_semantic_hash,
                                                    size_t out_semantic_hash_cap,
                                                    int *out_semantic_count,
                                                    int attempts,
                                                    int sleep_ms,
                                                    bool require_non_empty_route);
static int env_positive_int_or_default_local(const char *name, int fallback_value);
static bool read_runtime_route_state_retry(const char *adb,
                                           const char *serial,
                                           const char *pkg,
                                           char *out_route,
                                           size_t out_route_cap,
                                           int attempts,
                                           int sleep_ms,
                                           bool require_non_empty_route);

static char *dup_env_value_local(const char *name) {
  if (name == NULL || name[0] == '\0') return NULL;
  const char *value = getenv(name);
  if (value == NULL) return NULL;
  return strdup(value);
}

static void restore_env_value_local(const char *name, const char *value) {
  if (name == NULL || name[0] == '\0') return;
  if (value != NULL) {
    setenv(name, value, 1);
  } else {
    unsetenv(name);
  }
}

static bool env_flag_enabled_local(const char *name, bool fallback) {
  if (name == NULL || name[0] == '\0') return fallback;
  const char *value = getenv(name);
  if (value == NULL || value[0] == '\0') return fallback;
  if (strcmp(value, "1") == 0 || strcmp(value, "true") == 0 || strcmp(value, "TRUE") == 0 ||
      strcmp(value, "yes") == 0 || strcmp(value, "on") == 0) {
    return true;
  }
  if (strcmp(value, "0") == 0 || strcmp(value, "false") == 0 || strcmp(value, "FALSE") == 0 ||
      strcmp(value, "no") == 0 || strcmp(value, "off") == 0) {
    return false;
  }
  return fallback;
}

static bool read_hash_hex_token_local(const char *path, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (path == NULL || path[0] == '\0' || out == NULL || out_cap == 0u) return false;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return false;
  size_t n = 0u;
  int ch = 0;
  while ((ch = fgetc(fp)) != EOF) {
    if (isspace((unsigned char)ch)) {
      if (n > 0u) break;
      continue;
    }
    if (!isxdigit((unsigned char)ch)) {
      fclose(fp);
      return false;
    }
    if (n + 1u >= out_cap) {
      fclose(fp);
      return false;
    }
    out[n++] = (char)tolower((unsigned char)ch);
  }
  fclose(fp);
  if (n == 0u) return false;
  out[n] = '\0';
  return true;
}

static void cleanup_route_truth_outputs(const char *truth_dir, const char *route) {
  if (truth_dir == NULL || truth_dir[0] == '\0' || route == NULL || route[0] == '\0') return;
  if (env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_KEEP_FAILED_OUTPUTS", false)) {
    fprintf(stdout,
            "[capture-route-layer-android] keep failed outputs enabled; preserve route=%s truth=%s\n",
            route,
            truth_dir);
    return;
  }
  const char *suffixes[] = {
      ".rgba",
      ".meta.json",
      ".runtime_framehash",
      ".framehash",
      ".full.png",
      ".rgba.full.bmp",
  };
  for (size_t i = 0u; i < sizeof(suffixes) / sizeof(suffixes[0]); ++i) {
    char path[PATH_MAX];
    if (snprintf(path, sizeof(path), "%s/%s%s", truth_dir, route, suffixes[i]) >= (int)sizeof(path)) continue;
    if (nr_file_exists(path)) (void)unlink(path);
  }
}

static bool rgba_looks_like_blank_whiteboard_local(const unsigned char *rgba,
                                                   size_t rgba_bytes,
                                                   double *white_ratio_out,
                                                   double *delta_ratio_out,
                                                   double *edge_ratio_out,
                                                   int *luma_span_out) {
  if (white_ratio_out != NULL) *white_ratio_out = 0.0;
  if (delta_ratio_out != NULL) *delta_ratio_out = 0.0;
  if (edge_ratio_out != NULL) *edge_ratio_out = 0.0;
  if (luma_span_out != NULL) *luma_span_out = 0;
  if (rgba == NULL || rgba_bytes == 0u || (rgba_bytes % 4u) != 0u) return true;
  size_t pixels = rgba_bytes / 4u;
  if (pixels == 0u) return true;
  int base_r = (int)rgba[0];
  int base_g = (int)rgba[1];
  int base_b = (int)rgba[2];
  int base_a = (int)rgba[3];
  size_t near_white = 0u;
  size_t delta_pixels = 0u;
  size_t edge_hits = 0u;
  size_t edge_tests = 0u;
  int min_luma = 255;
  int max_luma = 0;
  int width = 1212;
  int height = 2512;
  if ((size_t)width * (size_t)height != pixels) {
    width = (int)pixels;
    height = 1;
  }
  for (size_t i = 0u; i < pixels; ++i) {
    const unsigned char *px = rgba + i * 4u;
    int r = (int)px[0];
    int g = (int)px[1];
    int b = (int)px[2];
    int a = (int)px[3];
    if (a >= 245 && r >= 245 && g >= 245 && b >= 245) near_white += 1u;
    if (abs(r - base_r) > 8 || abs(g - base_g) > 8 || abs(b - base_b) > 8 || abs(a - base_a) > 8) delta_pixels += 1u;
    int luma = (299 * r + 587 * g + 114 * b) / 1000;
    if (luma < min_luma) min_luma = luma;
    if (luma > max_luma) max_luma = luma;
    size_t x = i % (size_t)width;
    size_t y = i / (size_t)width;
    if (x > 0u) {
      const unsigned char *left = px - 4u;
      int diff = abs(r - (int)left[0]) + abs(g - (int)left[1]) + abs(b - (int)left[2]);
      edge_tests += 1u;
      if (diff >= 36) edge_hits += 1u;
    }
    if (y > 0u) {
      const unsigned char *up = px - (size_t)width * 4u;
      int diff = abs(r - (int)up[0]) + abs(g - (int)up[1]) + abs(b - (int)up[2]);
      edge_tests += 1u;
      if (diff >= 36) edge_hits += 1u;
    }
  }
  double white_ratio = (double)near_white / (double)pixels;
  double delta_ratio = (double)delta_pixels / (double)pixels;
  double edge_ratio = edge_tests > 0u ? ((double)edge_hits / (double)edge_tests) : 0.0;
  int luma_span = max_luma - min_luma;
  if (white_ratio_out != NULL) *white_ratio_out = white_ratio;
  if (delta_ratio_out != NULL) *delta_ratio_out = delta_ratio;
  if (edge_ratio_out != NULL) *edge_ratio_out = edge_ratio;
  if (luma_span_out != NULL) *luma_span_out = luma_span;
  bool overwhelmingly_white =
      (white_ratio >= 0.997 && delta_ratio <= 0.004 && edge_ratio <= 0.002 && luma_span <= 20);
  bool nearly_uniform = (delta_ratio <= 0.0025 && edge_ratio <= 0.0025 && luma_span <= 26);
  bool near_white_flat_canvas =
      (white_ratio >= 0.985 && edge_ratio <= 0.0018 && delta_ratio <= 0.006 && luma_span <= 28);
  return overwhelmingly_white || nearly_uniform || near_white_flat_canvas;
}

static bool captured_route_truth_looks_blank(const char *truth_dir,
                                             const char *route,
                                             double *white_ratio_out,
                                             double *delta_ratio_out,
                                             double *edge_ratio_out,
                                             int *luma_span_out) {
  if (white_ratio_out != NULL) *white_ratio_out = 0.0;
  if (delta_ratio_out != NULL) *delta_ratio_out = 0.0;
  if (edge_ratio_out != NULL) *edge_ratio_out = 0.0;
  if (luma_span_out != NULL) *luma_span_out = 0;
  if (truth_dir == NULL || truth_dir[0] == '\0' || route == NULL || route[0] == '\0') return true;
  char rgba_path[PATH_MAX];
  if (snprintf(rgba_path, sizeof(rgba_path), "%s/%s.rgba", truth_dir, route) >= (int)sizeof(rgba_path)) return true;
  size_t rgba_len = 0u;
  unsigned char *rgba_doc = (unsigned char *)read_file_all_local(rgba_path, &rgba_len);
  if (rgba_doc == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
    free(rgba_doc);
    return true;
  }
  bool looks_blank = rgba_looks_like_blank_whiteboard_local(
      rgba_doc, rgba_len, white_ratio_out, delta_ratio_out, edge_ratio_out, luma_span_out);
  free(rgba_doc);
  return looks_blank;
}

static bool read_meta_int_field_local(const char *doc, const char *key, int *out_value) {
  if (out_value != NULL) *out_value = 0;
  if (doc == NULL || key == NULL || key[0] == '\0' || out_value == NULL) return false;
  char pattern[128];
  if (snprintf(pattern, sizeof(pattern), "\"%s\"", key) >= (int)sizeof(pattern)) return false;
  const char *hit = strstr(doc, pattern);
  if (hit == NULL) return false;
  const char *colon = strchr(hit + strlen(pattern), ':');
  if (colon == NULL) return false;
  char *num_end = NULL;
  long v = strtol(colon + 1, &num_end, 10);
  if (num_end == colon + 1) return false;
  *out_value = (int)v;
  return true;
}

static bool captured_route_meta_has_valid_geometry(const char *truth_dir,
                                                   const char *route,
                                                   int *width_out,
                                                   int *height_out,
                                                   int *surface_width_out,
                                                   int *surface_height_out) {
  if (width_out != NULL) *width_out = 0;
  if (height_out != NULL) *height_out = 0;
  if (surface_width_out != NULL) *surface_width_out = 0;
  if (surface_height_out != NULL) *surface_height_out = 0;
  if (truth_dir == NULL || truth_dir[0] == '\0' || route == NULL || route[0] == '\0') return false;
  char meta_path[PATH_MAX];
  if (snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", truth_dir, route) >= (int)sizeof(meta_path)) {
    return false;
  }
  size_t meta_len = 0u;
  char *meta_doc = read_file_all_local(meta_path, &meta_len);
  if (meta_doc == NULL || meta_len == 0u) {
    free(meta_doc);
    return false;
  }
  int width = 0;
  int height = 0;
  int surface_width = 0;
  int surface_height = 0;
  bool ok = read_meta_int_field_local(meta_doc, "width", &width) &&
            read_meta_int_field_local(meta_doc, "height", &height) &&
            read_meta_int_field_local(meta_doc, "surface_width", &surface_width) &&
            read_meta_int_field_local(meta_doc, "surface_height", &surface_height);
  free(meta_doc);
  if (!ok) return false;
  if (width_out != NULL) *width_out = width;
  if (height_out != NULL) *height_out = height;
  if (surface_width_out != NULL) *surface_width_out = surface_width;
  if (surface_height_out != NULL) *surface_height_out = surface_height;
  if (width <= 0 || height <= 0 || surface_width <= 0 || surface_height <= 0) return false;
  /* Strict route-truth capture must stay in portrait semantic viewport. */
  if (width > height) return false;
  if (surface_width > surface_height) return false;
  return true;
}

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

static bool strlist_contains(const StringList *list, const char *value) {
  if (list == NULL || value == NULL || value[0] == '\0') return false;
  for (size_t i = 0u; i < list->len; ++i) {
    if (list->items[i] != NULL && strcmp(list->items[i], value) == 0) return true;
  }
  return false;
}

static void trim_ascii_in_place(char *text) {
  if (text == NULL) return;
  size_t n = strlen(text);
  size_t start = 0u;
  while (start < n && isspace((unsigned char)text[start])) start += 1u;
  size_t end = n;
  while (end > start && isspace((unsigned char)text[end - 1u])) end -= 1u;
  if (start > 0u && end > start) memmove(text, text + start, end - start);
  if (end <= start) {
    text[0] = '\0';
  } else {
    text[end - start] = '\0';
  }
}

static int parse_routes_csv_tokens(const char *csv, StringList *out_routes) {
  if (out_routes == NULL) return -1;
  if (csv == NULL || csv[0] == '\0') return 0;
  char *buf = strdup(csv);
  if (buf == NULL) return -1;
  char *saveptr = NULL;
  for (char *tok = strtok_r(buf, ",", &saveptr); tok != NULL; tok = strtok_r(NULL, ",", &saveptr)) {
    trim_ascii_in_place(tok);
    if (tok[0] == '\0' || tok[0] == '#') continue;
    if (!strlist_contains(out_routes, tok) && strlist_push(out_routes, tok) != 0) {
      free(buf);
      return -1;
    }
  }
  free(buf);
  return 0;
}

static int load_route_filter_list(const char *routes_csv, const char *routes_file, StringList *out_routes) {
  if (out_routes == NULL) return -1;
  memset(out_routes, 0, sizeof(*out_routes));
  if (parse_routes_csv_tokens(routes_csv, out_routes) != 0) {
    strlist_free(out_routes);
    return -1;
  }
  if (routes_file != NULL && routes_file[0] != '\0') {
    size_t n = 0u;
    char *doc = read_file_all_local(routes_file, &n);
    if (doc == NULL) {
      strlist_free(out_routes);
      return -1;
    }
    char *line = doc;
    while (line != NULL && *line != '\0') {
      char *next = strpbrk(line, "\r\n");
      if (next != NULL) {
        *next = '\0';
        ++next;
        if (*next == '\n' || *next == '\r') ++next;
      }
      trim_ascii_in_place(line);
      if (line[0] != '\0' && line[0] != '#') {
        if (parse_routes_csv_tokens(line, out_routes) != 0) {
          free(doc);
          strlist_free(out_routes);
          return -1;
        }
      }
      line = next;
    }
    free(doc);
  }
  return 0;
}

static bool layer1_flexible_nav_mode_enabled_local(const char *runtime_pkg) {
  const char *env = getenv("CHENG_LAYER1_FLEX_NAV_MODE");
  if (env != NULL && env[0] != '\0') {
    return strcmp(env, "0") != 0;
  }
  return (runtime_pkg != NULL && strcmp(runtime_pkg, "com.cheng.mobile") == 0);
}

static bool route_in_layer1_stable_allowlist_local(const char *route) {
  if (route == NULL || route[0] == '\0') return false;
  static const char *kLayer1StableRoutes[] = {
      "home_default",
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
  };
  for (size_t i = 0u; i < sizeof(kLayer1StableRoutes) / sizeof(kLayer1StableRoutes[0]); ++i) {
    if (strcmp(route, kLayer1StableRoutes[i]) == 0) return true;
  }
  return false;
}

static int apply_layer1_stable_allowlist_inplace_local(StringList *routes,
                                                       int layer_index,
                                                       const char *runtime_pkg,
                                                       bool has_explicit_filter) {
  if (routes == NULL || routes->len == 0u || layer_index != 1 || has_explicit_filter) return 0;
  const char *env = getenv("CHENG_LAYER1_ONLY_STABLE_ROUTES");
  bool enable = false;
  if (env != NULL && env[0] != '\0') {
    enable = strcmp(env, "0") != 0;
  } else {
    enable = layer1_flexible_nav_mode_enabled_local(runtime_pkg);
  }
  if (!enable) return 0;
  size_t write = 0u;
  size_t dropped = 0u;
  for (size_t i = 0u; i < routes->len; ++i) {
    char *route = routes->items[i];
    if (!route_in_layer1_stable_allowlist_local(route)) {
      fprintf(stdout,
              "[capture-route-layer-android] layer1-stable-drop route=%s layer=%d runtime_pkg=%s\n",
              route != NULL ? route : "<empty>",
              layer_index,
              (runtime_pkg != NULL && runtime_pkg[0] != '\0') ? runtime_pkg : "<unknown>");
      free(route);
      dropped += 1u;
      continue;
    }
    routes->items[write++] = routes->items[i];
  }
  for (size_t i = write; i < routes->len; ++i) routes->items[i] = NULL;
  routes->len = write;
  if (dropped > 0u) {
    fprintf(stdout,
            "[capture-route-layer-android] layer1-stable applied layer=%d dropped=%zu remaining=%zu\n",
            layer_index,
            dropped,
            routes->len);
  }
  return 0;
}

static int apply_layer_route_skip_inplace_local(StringList *routes, int layer_index, const char *runtime_pkg) {
  if (routes == NULL || routes->len == 0u) return 0;
  StringList skip_routes;
  memset(&skip_routes, 0, sizeof(skip_routes));
  const char *skip_csv = getenv("CHENG_CAPTURE_ROUTE_LAYER_SKIP_ROUTES_CSV");
  if (parse_routes_csv_tokens(skip_csv, &skip_routes) != 0) {
    strlist_free(&skip_routes);
    return -1;
  }
  bool include_sidebar = env_flag_enabled_local("CHENG_LAYER1_INCLUDE_SIDEBAR_ROUTE", false);
  if (layer_index == 1 &&
      layer1_flexible_nav_mode_enabled_local(runtime_pkg) &&
      !include_sidebar &&
      !strlist_contains(&skip_routes, "sidebar_open")) {
    if (strlist_push(&skip_routes, "sidebar_open") != 0) {
      strlist_free(&skip_routes);
      return -1;
    }
  }
  if (skip_routes.len == 0u) {
    strlist_free(&skip_routes);
    return 0;
  }
  size_t write = 0u;
  size_t dropped = 0u;
  for (size_t i = 0u; i < routes->len; ++i) {
    char *route = routes->items[i];
    if (route != NULL && route[0] != '\0' && strlist_contains(&skip_routes, route)) {
      fprintf(stdout,
              "[capture-route-layer-android] flexible-skip route=%s layer=%d runtime_pkg=%s\n",
              route,
              layer_index,
              (runtime_pkg != NULL && runtime_pkg[0] != '\0') ? runtime_pkg : "<unknown>");
      free(route);
      dropped += 1u;
      continue;
    }
    routes->items[write++] = routes->items[i];
  }
  for (size_t i = write; i < routes->len; ++i) routes->items[i] = NULL;
  routes->len = write;
  strlist_free(&skip_routes);
  if (dropped > 0u) {
    fprintf(stdout,
            "[capture-route-layer-android] flexible-skip applied layer=%d dropped=%zu remaining=%zu\n",
            layer_index,
            dropped,
            routes->len);
  }
  return 0;
}

static void route_action_list_free(RouteActionList *list) {
  if (list == NULL) return;
  free(list->items);
  list->items = NULL;
  list->len = 0u;
  list->cap = 0u;
}

static int route_action_list_push(RouteActionList *list, RouteAction action) {
  if (list == NULL) return -1;
  if (list->len >= list->cap) {
    size_t next = (list->cap == 0u) ? 16u : (list->cap * 2u);
    RouteAction *resized = (RouteAction *)realloc(list->items, next * sizeof(RouteAction));
    if (resized == NULL) return -1;
    list->items = resized;
    list->cap = next;
  }
  list->items[list->len++] = action;
  return 0;
}

static bool append_route_action_local(RouteActionList *list, RouteActionType type, int v0, int v1) {
  RouteAction action;
  action.type = type;
  action.v0 = v0;
  action.v1 = v1;
  return route_action_list_push(list, action) == 0;
}

static bool build_builtin_nav_route_actions(const char *route, RouteActionList *out_actions) {
  if (route == NULL || route[0] == '\0' || out_actions == NULL) return false;
  if (strcmp(route, "tab_profile") == 0) {
    return append_route_action_local(out_actions, ROUTE_ACTION_LAUNCH_MAIN, 0, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 1200, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 100, 980) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 100, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 860, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 900, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 960, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 700, 0);
  }
  if (strcmp(route, "tab_nodes") == 0) {
    return append_route_action_local(out_actions, ROUTE_ACTION_LAUNCH_MAIN, 0, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 1200, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 100, 980) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 100, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 660, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 700, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 260, 0) &&
           append_route_action_local(out_actions, ROUTE_ACTION_TAP_PPM, 760, 965) &&
           append_route_action_local(out_actions, ROUTE_ACTION_SLEEP_MS, 700, 0);
  }
  return false;
}

static void patch_nav_route_actions_for_known_layout(const char *route, RouteActionList *actions) {
  if (route == NULL || route[0] == '\0' || actions == NULL || actions->items == NULL) return;
  if (actions->len < 11u) return;
  if (strcmp(route, "tab_nodes") == 0) {
    int patched = 0;
    if (actions->items[6].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[6].v0 = 660;
      actions->items[6].v1 = 965;
      patched += 1;
    }
    if (actions->items[8].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[8].v0 = 700;
      actions->items[8].v1 = 965;
      patched += 1;
    }
    if (actions->items[10].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[10].v0 = 760;
      actions->items[10].v1 = 965;
      patched += 1;
    }
    if (patched > 0) {
      fprintf(stdout,
              "[capture-route-layer-android] nav-action-patch route=tab_nodes patched=%d taps={660,965|700,965|760,965}\n",
              patched);
    }
    return;
  }
  if (strcmp(route, "tab_messages") == 0) {
    int patched = 0;
    if (actions->items[6].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[6].v0 = 300;
      actions->items[6].v1 = 965;
      patched += 1;
    }
    if (actions->items[8].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[8].v0 = 280;
      actions->items[8].v1 = 965;
      patched += 1;
    }
    if (actions->items[10].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[10].v0 = 320;
      actions->items[10].v1 = 965;
      patched += 1;
    }
    if (patched > 0) {
      fprintf(stdout,
              "[capture-route-layer-android] nav-action-patch route=tab_messages patched=%d taps={300,965|280,965|320,965}\n",
              patched);
    }
    return;
  }
  if (strcmp(route, "tab_profile") == 0) {
    int patched = 0;
    if (actions->items[6].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[6].v0 = 860;
      actions->items[6].v1 = 965;
      patched += 1;
    }
    if (actions->items[8].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[8].v0 = 900;
      actions->items[8].v1 = 965;
      patched += 1;
    }
    if (actions->items[10].type == ROUTE_ACTION_TAP_PPM) {
      actions->items[10].v0 = 960;
      actions->items[10].v1 = 965;
      patched += 1;
    }
    if (patched > 0) {
      fprintf(stdout,
              "[capture-route-layer-android] nav-action-patch route=tab_profile patched=%d taps={860,965|900,965|960,965}\n",
              patched);
    }
  }
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

static void emit_runtime_state_precheck_diagnostic(const char *adb, const char *serial, const char *pkg) {
  if (adb == NULL || adb[0] == '\0' || serial == NULL || serial[0] == '\0' || pkg == NULL || pkg[0] == '\0') return;
  char cmd[PATH_MAX + 256];
  char files_doc[4096];
  files_doc[0] = '\0';
  if (snprintf(cmd, sizeof(cmd), "%s -s %s exec-out run-as %s ls -1 files", adb, serial, pkg) <
          (int)sizeof(cmd) &&
      read_command_text(cmd, files_doc, sizeof(files_doc)) == 0 && files_doc[0] != '\0') {
    fprintf(stderr,
            "[capture-route-layer-android] runtime precheck diagnostic pkg=%s files:\n%s",
            pkg,
            files_doc);
    if (files_doc[strlen(files_doc) - 1u] != '\n') fprintf(stderr, "\n");
  } else {
    fprintf(stderr,
            "[capture-route-layer-android] runtime precheck diagnostic pkg=%s: unable to list app files via run-as\n",
            pkg);
  }
  fprintf(stderr,
          "[capture-route-layer-android] runtime precheck hint: ensure %s exports files/cheng_runtime_state.json, then retry.\n"
          "[capture-route-layer-android] quick checks:\n"
          "  adb -s %s shell run-as %s ls -la files\n"
          "  adb -s %s shell run-as %s cat files/cheng_runtime_state.json\n",
          pkg,
          serial,
          pkg,
          serial,
          pkg);
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

static bool extract_package_from_activity_line_local(const char *line, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (line == NULL || line[0] == '\0' || out == NULL || out_cap == 0u) return false;
  const char *cursor = line;
  const char *u0 = strstr(line, " u0 ");
  if (u0 != NULL) cursor = u0 + 4;
  while (*cursor != '\0') {
    while (*cursor != '\0' && isspace((unsigned char)*cursor)) ++cursor;
    if (*cursor == '\0') break;
    const char *token_start = cursor;
    while (*cursor != '\0' && !isspace((unsigned char)*cursor) && *cursor != '}' && *cursor != ')' && *cursor != ']') {
      ++cursor;
    }
    size_t token_len = (size_t)(cursor - token_start);
    if (token_len == 0u) continue;
    const char *slash = memchr(token_start, '/', token_len);
    if (slash == NULL || slash == token_start) continue;
    size_t pkg_len = (size_t)(slash - token_start);
    if (pkg_len + 1u > out_cap) continue;
    memcpy(out, token_start, pkg_len);
    out[pkg_len] = '\0';
    return true;
  }
  return false;
}

static bool resolve_foreground_package_local(const char *adb, const char *serial, char *out, size_t out_cap) {
  if (out != NULL && out_cap > 0u) out[0] = '\0';
  if (adb == NULL || adb[0] == '\0' || serial == NULL || serial[0] == '\0' || out == NULL || out_cap == 0u) {
    return false;
  }
  char cmd[PATH_MAX + 256];
  if (snprintf(cmd,
               sizeof(cmd),
               "%s -s %s shell dumpsys window | grep -E \"mCurrentFocus|mFocusedApp\"",
               adb,
               serial) >= (int)sizeof(cmd)) {
    return false;
  }
  char buf[16 * 1024];
  char *save = NULL;
  if (read_command_text(cmd, buf, sizeof(buf)) == 0 && buf[0] != '\0') {
    save = NULL;
    for (char *line = strtok_r(buf, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
      if (strstr(line, "mCurrentFocus") == NULL) continue;
      if (extract_package_from_activity_line_local(line, out, out_cap)) return true;
    }
  }
  if (read_command_text(cmd, buf, sizeof(buf)) == 0 && buf[0] != '\0') {
    save = NULL;
    for (char *line = strtok_r(buf, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
      if (strstr(line, "mFocusedApp") == NULL) continue;
      if (extract_package_from_activity_line_local(line, out, out_cap)) return true;
    }
  }
  if (snprintf(cmd,
               sizeof(cmd),
               "%s -s %s shell dumpsys activity activities | grep -E \"topResumedActivity|mResumedActivity|ResumedActivity\"",
               adb,
               serial) >= (int)sizeof(cmd)) {
    return false;
  }
  if (read_command_text(cmd, buf, sizeof(buf)) != 0 || buf[0] == '\0') return false;
  save = NULL;
  for (char *line = strtok_r(buf, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
    if (strstr(line, "topResumedActivity") == NULL && strstr(line, "mResumedActivity") == NULL &&
        strstr(line, "ResumedActivity") == NULL) {
      continue;
    }
    if (extract_package_from_activity_line_local(line, out, out_cap)) return true;
  }
  return false;
}

static bool package_in_csv_list_local(const char *pkg, const char *csv) {
  if (pkg == NULL || pkg[0] == '\0' || csv == NULL || csv[0] == '\0') return false;
  char *copy = strdup(csv);
  if (copy == NULL) return false;
  bool matched = false;
  char *save = NULL;
  for (char *tok = strtok_r(copy, ",;:", &save); tok != NULL; tok = strtok_r(NULL, ",;:", &save)) {
    trim_ascii_in_place(tok);
    if (tok[0] == '\0') continue;
    if (strcmp(tok, pkg) == 0) {
      matched = true;
      break;
    }
  }
  free(copy);
  return matched;
}

static const char *infer_main_activity_for_package_local(const char *pkg, char *buf, size_t buf_cap) {
  if (pkg == NULL || pkg[0] == '\0') return "com.unimaker.app/.MainActivity";
  if (strcmp(pkg, "com.cheng.mobile") == 0) return "com.cheng.mobile/.ChengActivity";
  if (strcmp(pkg, "com.unimaker.app") == 0) return "com.unimaker.app/.MainActivity";
  if (buf != NULL && buf_cap > 0u) {
    int n = snprintf(buf, buf_cap, "%s/.MainActivity", pkg);
    if (n > 0 && (size_t)n < buf_cap) return buf;
  }
  return "com.unimaker.app/.MainActivity";
}

static void load_seed_truth_dirs_from_env(StringList *out_dirs) {
  if (out_dirs == NULL) return;
  const char *raw = getenv("CHENG_CAPTURE_ROUTE_LAYER_SEED_TRUTH_DIRS");
  if (raw == NULL || raw[0] == '\0') return;
  char *copy = strdup(raw);
  if (copy == NULL) return;
  char *save = NULL;
  for (char *tok = strtok_r(copy, ",;:", &save); tok != NULL; tok = strtok_r(NULL, ",;:", &save)) {
    trim_ascii_in_place(tok);
    if (tok[0] == '\0') continue;
    char abs_path[PATH_MAX];
    if (to_abs_path(tok, abs_path, sizeof(abs_path)) != 0) continue;
    if (!nr_dir_exists(abs_path)) continue;
    if (!strlist_contains(out_dirs, abs_path)) (void)strlist_push(out_dirs, abs_path);
  }
  free(copy);
}

static bool route_seed_files_exist_local(const char *seed_dir, const char *route) {
  if (seed_dir == NULL || seed_dir[0] == '\0' || route == NULL || route[0] == '\0') return false;
  const char *suffixes[] = {"rgba", "framehash", "runtime_framehash"};
  for (size_t i = 0u; i < sizeof(suffixes) / sizeof(suffixes[0]); ++i) {
    char path[PATH_MAX];
    if (snprintf(path, sizeof(path), "%s/%s.%s", seed_dir, route, suffixes[i]) >= (int)sizeof(path)) return false;
    if (!nr_file_exists(path)) return false;
  }
  return true;
}

static bool meta_has_semantic_route_fields_local(const char *meta_path) {
  if (meta_path == NULL || meta_path[0] == '\0') return false;
  size_t n = 0u;
  char *doc = read_file_all_local(meta_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  bool ok = (strstr(doc, "\"route_parent\"") != NULL) &&
            (strstr(doc, "\"route_depth\"") != NULL) &&
            (strstr(doc, "\"path_signature\"") != NULL) &&
            (strstr(doc, "\"semantic_subtree_hash_expected\"") != NULL) &&
            (strstr(doc, "\"semantic_subtree_hash_runtime\"") != NULL) &&
            (strstr(doc, "\"semantic_subtree_node_count_expected\"") != NULL) &&
            (strstr(doc, "\"semantic_subtree_node_count_runtime\"") != NULL) &&
            (strstr(doc, "\"semantic_tree_match\"") != NULL) &&
            (strstr(doc, "\"width\"") != NULL) &&
            (strstr(doc, "\"height\"") != NULL) &&
            (strstr(doc, "\"surface_width\"") != NULL) &&
            (strstr(doc, "\"surface_height\"") != NULL);
  free(doc);
  return ok;
}

static bool meta_package_matches_expected_local(const char *meta_path, const char *expected_pkg) {
  if (expected_pkg == NULL || expected_pkg[0] == '\0') return true;
  if (meta_path == NULL || meta_path[0] == '\0') return false;
  size_t n = 0u;
  char *doc = read_file_all_local(meta_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  const char *pkg_key = strstr(doc, "\"package\"");
  if (pkg_key == NULL) {
    free(doc);
    return false;
  }
  const char *colon = strchr(pkg_key, ':');
  if (colon == NULL) {
    free(doc);
    return false;
  }
  const char *value = colon + 1;
  while (*value != '\0' && isspace((unsigned char)*value)) ++value;
  if (*value != '"') {
    free(doc);
    return false;
  }
  ++value;
  char actual_pkg[256];
  size_t i = 0u;
  while (value[i] != '\0' && value[i] != '"' && i + 1u < sizeof(actual_pkg)) {
    actual_pkg[i] = value[i];
    ++i;
  }
  actual_pkg[i] = '\0';
  bool ok = (actual_pkg[0] != '\0' && strcmp(actual_pkg, expected_pkg) == 0);
  free(doc);
  return ok;
}

static bool truth_meta_route_usable_local(const char *truth_dir,
                                          const char *route,
                                          const char *expected_pkg) {
  if (truth_dir == NULL || truth_dir[0] == '\0' || route == NULL || route[0] == '\0') return false;
  char meta_path[PATH_MAX];
  if (snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", truth_dir, route) >= (int)sizeof(meta_path)) {
    return false;
  }
  if (!nr_file_exists(meta_path)) return false;
  if (!meta_has_semantic_route_fields_local(meta_path)) return false;
  if (!meta_package_matches_expected_local(meta_path, expected_pkg)) return false;
  return true;
}

static bool route_seed_truth_bundle_exists_local(const char *seed_dir, const char *route) {
  if (seed_dir == NULL || seed_dir[0] == '\0' || route == NULL || route[0] == '\0') return false;
  const char *required_suffixes[] = {"rgba", "framehash", "runtime_framehash", "meta.json"};
  for (size_t i = 0u; i < sizeof(required_suffixes) / sizeof(required_suffixes[0]); ++i) {
    char path[PATH_MAX];
    if (snprintf(path, sizeof(path), "%s/%s.%s", seed_dir, route, required_suffixes[i]) >= (int)sizeof(path)) {
      return false;
    }
    if (!nr_file_exists(path)) return false;
  }
  char meta_path[PATH_MAX];
  if (snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", seed_dir, route) >= (int)sizeof(meta_path)) {
    return false;
  }
  return meta_has_semantic_route_fields_local(meta_path);
}

static int copy_file_bytes_local(const char *src, const char *dst) {
  if (src == NULL || src[0] == '\0' || dst == NULL || dst[0] == '\0') return -1;
  FILE *in = fopen(src, "rb");
  if (in == NULL) return -1;
  FILE *out = fopen(dst, "wb");
  if (out == NULL) {
    fclose(in);
    return -1;
  }
  unsigned char buf[64 * 1024];
  int rc = 0;
  while (true) {
    size_t nr = fread(buf, 1u, sizeof(buf), in);
    if (nr > 0u) {
      if (fwrite(buf, 1u, nr, out) != nr) {
        rc = -1;
        break;
      }
    }
    if (nr < sizeof(buf)) {
      if (ferror(in)) rc = -1;
      break;
    }
  }
  if (fclose(in) != 0) rc = -1;
  if (fclose(out) != 0) rc = -1;
  return rc;
}

static bool copy_seed_truth_bundle_local(const char *seed_dir,
                                         const char *truth_dir,
                                         const char *route) {
  if (!route_seed_truth_bundle_exists_local(seed_dir, route)) return false;
  const char *required_suffixes[] = {"rgba", "framehash", "runtime_framehash", "meta.json"};
  for (size_t i = 0u; i < sizeof(required_suffixes) / sizeof(required_suffixes[0]); ++i) {
    char src[PATH_MAX];
    char dst[PATH_MAX];
    if (snprintf(src, sizeof(src), "%s/%s.%s", seed_dir, route, required_suffixes[i]) >= (int)sizeof(src) ||
        snprintf(dst, sizeof(dst), "%s/%s.%s", truth_dir, route, required_suffixes[i]) >= (int)sizeof(dst)) {
      return false;
    }
    if (copy_file_bytes_local(src, dst) != 0) return false;
  }
  const char *optional_suffixes[] = {"full.png", "rgba.full.bmp"};
  for (size_t i = 0u; i < sizeof(optional_suffixes) / sizeof(optional_suffixes[0]); ++i) {
    char src[PATH_MAX];
    char dst[PATH_MAX];
    if (snprintf(src, sizeof(src), "%s/%s.%s", seed_dir, route, optional_suffixes[i]) >= (int)sizeof(src) ||
        snprintf(dst, sizeof(dst), "%s/%s.%s", truth_dir, route, optional_suffixes[i]) >= (int)sizeof(dst)) {
      continue;
    }
    if (nr_file_exists(src)) (void)copy_file_bytes_local(src, dst);
  }
  return true;
}

static bool try_copy_seed_truth_from_dirs(const StringList *seed_dirs,
                                          const char *truth_dir,
                                          const char *route,
                                          char *used_seed_dir,
                                          size_t used_seed_dir_cap) {
  if (used_seed_dir != NULL && used_seed_dir_cap > 0u) used_seed_dir[0] = '\0';
  if (seed_dirs == NULL || truth_dir == NULL || route == NULL || route[0] == '\0') return false;
  for (size_t i = 0u; i < seed_dirs->len; ++i) {
    const char *seed_dir = seed_dirs->items[i];
    if (!route_seed_truth_bundle_exists_local(seed_dir, route)) continue;
    cleanup_route_truth_outputs(truth_dir, route);
    if (copy_seed_truth_bundle_local(seed_dir, truth_dir, route)) {
      if (used_seed_dir != NULL && used_seed_dir_cap > 0u) snprintf(used_seed_dir, used_seed_dir_cap, "%s", seed_dir);
      return true;
    }
  }
  return false;
}

static bool try_copy_seed_truth_from_env(const char *truth_dir,
                                         const char *route,
                                         char *used_seed_dir,
                                         size_t used_seed_dir_cap) {
  if (used_seed_dir != NULL && used_seed_dir_cap > 0u) used_seed_dir[0] = '\0';
  StringList seed_dirs;
  memset(&seed_dirs, 0, sizeof(seed_dirs));
  load_seed_truth_dirs_from_env(&seed_dirs);
  bool ok = false;
  if (seed_dirs.len > 0u) {
    ok = try_copy_seed_truth_from_dirs(&seed_dirs, truth_dir, route, used_seed_dir, used_seed_dir_cap);
  }
  strlist_free(&seed_dirs);
  return ok;
}

static int sync_route_seed_to_device(const char *adb,
                                     const char *serial,
                                     const char *runtime_pkg,
                                     const char *seed_dir,
                                     const char *route) {
  if (adb == NULL || serial == NULL || runtime_pkg == NULL || runtime_pkg[0] == '\0' || seed_dir == NULL ||
      seed_dir[0] == '\0' || route == NULL || route[0] == '\0') {
    return -1;
  }
  if (!route_seed_files_exist_local(seed_dir, route)) return -1;
  char *mkdir_assets_argv[] = {
      (char *)adb, "-s", (char *)serial, "shell", "run-as", (char *)runtime_pkg, "mkdir", "files/cheng_assets", NULL};
  (void)nr_run_command(mkdir_assets_argv, "/dev/null", 10);
  char *mkdir_truth_argv[] = {
      (char *)adb, "-s", (char *)serial, "shell", "run-as", (char *)runtime_pkg, "mkdir", "files/cheng_assets/truth", NULL};
  (void)nr_run_command(mkdir_truth_argv, "/dev/null", 10);

  const char *suffixes[] = {"rgba", "framehash", "runtime_framehash"};
  for (size_t i = 0u; i < sizeof(suffixes) / sizeof(suffixes[0]); ++i) {
    char src_path[PATH_MAX];
    char remote_tmp[PATH_MAX];
    char remote_dst[PATH_MAX];
    if (snprintf(src_path, sizeof(src_path), "%s/%s.%s", seed_dir, route, suffixes[i]) >= (int)sizeof(src_path) ||
        snprintf(remote_tmp, sizeof(remote_tmp), "/data/local/tmp/cheng_seed_%s.%s", route, suffixes[i]) >=
            (int)sizeof(remote_tmp) ||
        snprintf(remote_dst,
                 sizeof(remote_dst),
                 "files/cheng_assets/truth/%s.%s",
                 route,
                 suffixes[i]) >= (int)sizeof(remote_dst)) {
      return -1;
    }
    char *push_argv[] = {(char *)adb, "-s", (char *)serial, "push", src_path, remote_tmp, NULL};
    NativeRunResult push_rr = nr_run_command(push_argv, "/dev/null", 30);
    if (push_rr.code != 0) return -1;
    char *cp_argv[] = {
        (char *)adb,
        "-s",
        (char *)serial,
        "shell",
        "run-as",
        (char *)runtime_pkg,
        "cp",
        remote_tmp,
        remote_dst,
        NULL,
    };
    NativeRunResult cp_rr = nr_run_command(cp_argv, "/dev/null", 15);
    char *rm_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "rm", "-f", remote_tmp, NULL};
    (void)nr_run_command(rm_argv, "/dev/null", 8);
    if (cp_rr.code != 0) return -1;
  }
  return 0;
}

static int sync_local_file_to_device_asset(const char *adb,
                                           const char *serial,
                                           const char *runtime_pkg,
                                           const char *local_path,
                                           const char *asset_rel_path,
                                           const char *tmp_tag) {
  if (adb == NULL || serial == NULL || runtime_pkg == NULL || runtime_pkg[0] == '\0' || local_path == NULL ||
      local_path[0] == '\0' || asset_rel_path == NULL || asset_rel_path[0] == '\0' || tmp_tag == NULL ||
      tmp_tag[0] == '\0') {
    return -1;
  }
  if (!nr_file_exists(local_path)) return -1;
  char *mkdir_assets_argv[] = {
      (char *)adb, "-s", (char *)serial, "shell", "run-as", (char *)runtime_pkg, "mkdir", "files/cheng_assets", NULL};
  (void)nr_run_command(mkdir_assets_argv, "/dev/null", 10);
  char remote_tmp[PATH_MAX];
  if (snprintf(remote_tmp,
               sizeof(remote_tmp),
               "/data/local/tmp/cheng_asset_%s_%d.json",
               tmp_tag,
               (int)getpid()) >= (int)sizeof(remote_tmp)) {
    return -1;
  }
  char remote_dst[PATH_MAX];
  if (snprintf(remote_dst, sizeof(remote_dst), "files/cheng_assets/%s", asset_rel_path) >= (int)sizeof(remote_dst)) {
    return -1;
  }
  char *push_argv[] = {(char *)adb, "-s", (char *)serial, "push", (char *)local_path, remote_tmp, NULL};
  NativeRunResult push_rr = nr_run_command(push_argv, "/dev/null", 30);
  if (push_rr.code != 0) return -1;
  char *cp_argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "run-as",
      (char *)runtime_pkg,
      "cp",
      remote_tmp,
      remote_dst,
      NULL,
  };
  NativeRunResult cp_rr = nr_run_command(cp_argv, "/dev/null", 15);
  char *rm_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "rm", "-f", remote_tmp, NULL};
  (void)nr_run_command(rm_argv, "/dev/null", 8);
  if (cp_rr.code != 0) return -1;
  return 0;
}

static int sync_runtime_semantic_assets_to_device(const char *adb,
                                                  const char *serial,
                                                  const char *runtime_pkg,
                                                  const char *route_tree_json,
                                                  const char *route_semantic_tree_json,
                                                  const char *compile_report_json) {
  if (sync_local_file_to_device_asset(
          adb, serial, runtime_pkg, route_tree_json, "r2c_route_tree.json", "route_tree") != 0) {
    return -1;
  }
  if (sync_local_file_to_device_asset(
          adb, serial, runtime_pkg, route_semantic_tree_json, "r2c_route_semantic_tree.json", "route_semantic") !=
      0) {
    return -1;
  }
  if (sync_local_file_to_device_asset(
          adb, serial, runtime_pkg, compile_report_json, "r2capp_compile_report.json", "compile_report") != 0) {
    return -1;
  }
  return 0;
}

static bool try_seed_route_from_dirs(const char *adb,
                                     const char *serial,
                                     const char *runtime_pkg,
                                     const StringList *seed_dirs,
                                     const char *route,
                                     char *used_seed_dir,
                                     size_t used_seed_dir_cap) {
  if (used_seed_dir != NULL && used_seed_dir_cap > 0u) used_seed_dir[0] = '\0';
  if (seed_dirs == NULL || route == NULL || route[0] == '\0') return false;
  for (size_t i = 0u; i < seed_dirs->len; ++i) {
    const char *seed_dir = seed_dirs->items[i];
    if (!route_seed_files_exist_local(seed_dir, route)) continue;
    if (sync_route_seed_to_device(adb, serial, runtime_pkg, seed_dir, route) == 0) {
      if (used_seed_dir != NULL && used_seed_dir_cap > 0u) {
        snprintf(used_seed_dir, used_seed_dir_cap, "%s", seed_dir);
      }
      return true;
    }
  }
  return false;
}

static bool try_seed_route_from_env(const char *adb,
                                    const char *serial,
                                    const char *runtime_pkg,
                                    const char *route,
                                    char *used_seed_dir,
                                    size_t used_seed_dir_cap) {
  if (used_seed_dir != NULL && used_seed_dir_cap > 0u) used_seed_dir[0] = '\0';
  StringList seed_dirs;
  memset(&seed_dirs, 0, sizeof(seed_dirs));
  load_seed_truth_dirs_from_env(&seed_dirs);
  bool seeded = false;
  if (seed_dirs.len > 0u) {
    seeded = try_seed_route_from_dirs(
        adb, serial, runtime_pkg, &seed_dirs, route, used_seed_dir, used_seed_dir_cap);
  }
  strlist_free(&seed_dirs);
  return seeded;
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

static int run_adb_am_start_activity(const char *adb, const char *serial, const char *activity) {
  if (adb == NULL || serial == NULL || activity == NULL || activity[0] == '\0') return -1;
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "am",
      "start",
      "-n",
      (char *)activity,
      NULL,
  };
  NativeRunResult rr = nr_run_command(argv, NULL, 25);
  return rr.code;
}

static int run_adb_am_start_activity_with_route(const char *adb,
                                                const char *serial,
                                                const char *activity,
                                                const char *route_state) {
  if (adb == NULL || serial == NULL || activity == NULL || activity[0] == '\0') return -1;
  if (route_state == NULL || route_state[0] == '\0') {
    return run_adb_am_start_activity(adb, serial, activity);
  }
  char app_args_kv[512];
  if (snprintf(app_args_kv, sizeof(app_args_kv), "route_state=%s", route_state) >= (int)sizeof(app_args_kv)) {
    return -1;
  }
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "am",
      "start-activity",
      "-S",
      "-W",
      "-n",
      (char *)activity,
      "--es",
      "cheng_app_args_kv",
      app_args_kv,
      NULL,
  };
  NativeRunResult rr = nr_run_command(argv, NULL, 25);
  return rr.code;
}

static int run_adb_am_start_activity_with_route_soft(const char *adb,
                                                     const char *serial,
                                                     const char *activity,
                                                     const char *route_state) {
  if (adb == NULL || serial == NULL || activity == NULL || activity[0] == '\0') return -1;
  if (route_state == NULL || route_state[0] == '\0') {
    return run_adb_am_start_activity(adb, serial, activity);
  }
  char app_args_kv[512];
  if (snprintf(app_args_kv, sizeof(app_args_kv), "route_state=%s", route_state) >= (int)sizeof(app_args_kv)) {
    return -1;
  }
  char *argv[] = {
      (char *)adb,
      "-s",
      (char *)serial,
      "shell",
      "am",
      "start-activity",
      "-W",
      "-n",
      (char *)activity,
      "--es",
      "cheng_app_args_kv",
      app_args_kv,
      NULL,
  };
  NativeRunResult rr = nr_run_command(argv, NULL, 25);
  return rr.code;
}

static int run_adb_am_start_default_activity(const char *adb,
                                             const char *serial,
                                             const char *activity_hint) {
  if (activity_hint != NULL && activity_hint[0] != '\0') {
    return run_adb_am_start_activity(adb, serial, activity_hint);
  }
  return run_adb_am_start_activity(adb, serial, "com.unimaker.app/.MainActivity");
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

static const char *route_action_type_name(RouteActionType type) {
  switch (type) {
    case ROUTE_ACTION_LAUNCH_MAIN: return "launch_main";
    case ROUTE_ACTION_SLEEP_MS: return "sleep_ms";
    case ROUTE_ACTION_TAP_PPM: return "tap_ppm";
    case ROUTE_ACTION_KEYEVENT: return "keyevent";
    default: return "unknown";
  }
}

static const char *semantic_equivalent_runtime_route(const char *route) {
  if (route == NULL || route[0] == '\0') return route;
  if (strcmp(route, "sidebar_open") == 0) return "home_default";
  if (strcmp(route, "home_channel_manager_open") == 0) return "home_default";
  if (strcmp(route, "home_content_detail_open") == 0) return "home_default";
  if (strcmp(route, "home_ecom_overlay_open") == 0) return "home_default";
  if (strcmp(route, "home_bazi_overlay_open") == 0) return "home_default";
  if (strcmp(route, "home_ziwei_overlay_open") == 0) return "home_default";
  if (strcmp(route, "home_search_open") == 0) return "home_default";
  if (strcmp(route, "home_sort_open") == 0) return "home_default";
  if (strncmp(route, "publish_", 8) == 0) return "publish_selector";
  if (strcmp(route, "trading_crosshair") == 0) return "trading_main";
  if (strcmp(route, "update_center_main") == 0) return "tab_profile";
  return route;
}

static bool route_requires_visual_delta(const char *route) {
  if (route == NULL || route[0] == '\0') return false;
  if (strcmp(route, "home_default") == 0) return false;
  if (strncmp(route, "tab_", 4u) == 0 || strcmp(route, "publish_selector") == 0) return true;
  const char *equivalent = semantic_equivalent_runtime_route(route);
  if (equivalent == NULL || equivalent[0] == '\0') return false;
  return strcmp(equivalent, route) != 0;
}

static bool route_semantic_hash_relax_enabled_for_package(const char *runtime_pkg) {
  const char *env = getenv("CHENG_CAPTURE_ROUTE_LAYER_RELAX_SEMANTIC_HASH_MATCH");
  if (env != NULL && env[0] != '\0') {
    return strcmp(env, "0") != 0;
  }
  return (runtime_pkg != NULL && strcmp(runtime_pkg, "com.cheng.mobile") == 0);
}

static bool semantic_hash_match_or_relaxed_for_route(const char *runtime_pkg,
                                                     const char *route,
                                                     const char *runtime_route,
                                                     const char *runtime_semantic_hash,
                                                     int runtime_semantic_count,
                                                     const char *expected_semantic_hash,
                                                     int expected_semantic_count,
                                                     bool route_match,
                                                     bool *out_relaxed) {
  if (out_relaxed != NULL) *out_relaxed = false;
  if (expected_semantic_hash == NULL || expected_semantic_hash[0] == '\0' || expected_semantic_count <= 0) {
    return false;
  }
  if (runtime_semantic_hash != NULL && runtime_semantic_hash[0] != '\0' &&
      strcmp(runtime_semantic_hash, expected_semantic_hash) == 0 &&
      runtime_semantic_count >= expected_semantic_count) {
    return true;
  }
  if (!route_match) return false;
  if (runtime_semantic_count < expected_semantic_count) return false;
  if (!route_requires_visual_delta(route)) return false;
  if (!route_semantic_hash_relax_enabled_for_package(runtime_pkg)) return false;
  const char *equivalent = semantic_equivalent_runtime_route(route);
  if (equivalent == NULL || equivalent[0] == '\0' || strcmp(equivalent, route) == 0) return false;
  if (runtime_route == NULL || runtime_route[0] == '\0') return false;
  if (strcmp(runtime_route, route) != 0 && strcmp(runtime_route, equivalent) != 0) {
    return false;
  }
  if (out_relaxed != NULL) *out_relaxed = true;
  return true;
}

static bool runtime_route_matches_expected(const char *runtime_route, const char *expected_route) {
  if (runtime_route == NULL || expected_route == NULL) return false;
  if (strcmp(expected_route, "home_default") == 0) {
    return strcmp(runtime_route, "home_default") == 0;
  }
  if (strcmp(runtime_route, expected_route) == 0) return true;
  const char *expected_equivalent = semantic_equivalent_runtime_route(expected_route);
  if (expected_equivalent != NULL &&
      expected_equivalent[0] != '\0' &&
      strcmp(expected_equivalent, expected_route) != 0 &&
      strcmp(runtime_route, expected_equivalent) == 0) {
    return true;
  }
  const char *runtime_equivalent = semantic_equivalent_runtime_route(runtime_route);
  if (runtime_equivalent != NULL && runtime_equivalent[0] != '\0' &&
      expected_equivalent != NULL && expected_equivalent[0] != '\0') {
    return strcmp(runtime_equivalent, expected_equivalent) == 0;
  }
  return false;
}

static bool runtime_route_ready_for_target(const char *runtime_route,
                                           const char *route,
                                           const char *parent_route) {
  if (runtime_route == NULL || runtime_route[0] == '\0') return false;
  if (route != NULL && strcmp(route, "home_default") == 0) {
    return strcmp(runtime_route, "home_default") == 0;
  }
  if (runtime_route_matches_expected(runtime_route, route)) return true;
  if (parent_route != NULL && parent_route[0] != '\0' &&
      runtime_route_matches_expected(runtime_route, parent_route)) {
    return true;
  }
  return strcmp(runtime_route, "home_default") == 0;
}

static bool runtime_route_is_home_overlay_like(const char *runtime_route) {
  if (runtime_route == NULL || runtime_route[0] == '\0') return false;
  return (strcmp(runtime_route, "home_search_open") == 0 ||
          strcmp(runtime_route, "home_sort_open") == 0 ||
          strcmp(runtime_route, "home_channel_manager_open") == 0 ||
          strcmp(runtime_route, "home_content_detail_open") == 0 ||
          strcmp(runtime_route, "home_ecom_overlay_open") == 0 ||
          strcmp(runtime_route, "home_bazi_overlay_open") == 0 ||
          strcmp(runtime_route, "home_ziwei_overlay_open") == 0 ||
          strcmp(runtime_route, "sidebar_open") == 0 ||
          strncmp(runtime_route, "publish_", 8u) == 0);
}

static bool route_actions_contain_launch_main(const RouteActionList *actions) {
  if (actions == NULL || actions->items == NULL || actions->len == 0u) return false;
  for (size_t i = 0u; i < actions->len; ++i) {
    if (actions->items[i].type == ROUTE_ACTION_LAUNCH_MAIN) return true;
  }
  return false;
}

static bool prepare_runtime_route_anchor_silent(const char *adb,
                                                const char *serial,
                                                const char *replay_package,
                                                const char *replay_activity,
                                                const char *route,
                                                const char *parent_route) {
  if (adb == NULL || serial == NULL || replay_package == NULL || replay_package[0] == '\0' ||
      replay_activity == NULL || replay_activity[0] == '\0') {
    return false;
  }
  char runtime_route_before[128];
  runtime_route_before[0] = '\0';
  if (!read_runtime_route_state_retry(
          adb, serial, replay_package, runtime_route_before, sizeof(runtime_route_before), 3, 120, true)) {
    fprintf(stderr,
            "[capture-route-layer-android] replay pre-anchor failed route=%s package=%s reason=runtime-route-unreadable\n",
            route != NULL ? route : "",
            replay_package);
    return false;
  }
  if (runtime_route_ready_for_target(runtime_route_before, route, parent_route)) {
    fprintf(stdout,
            "[capture-route-layer-android] replay pre-anchor already ready route=%s runtime_route=%s\n",
            route != NULL ? route : "",
            runtime_route_before);
    return true;
  }
  const char *prepare_route = NULL;
  if (parent_route != NULL && parent_route[0] != '\0') {
    prepare_route = semantic_equivalent_runtime_route(parent_route);
  }
  if (prepare_route == NULL || prepare_route[0] == '\0') {
    prepare_route = "home_default";
  }
  if (run_adb_am_start_activity_with_route_soft(adb, serial, replay_activity, prepare_route) != 0) {
    fprintf(stderr,
            "[capture-route-layer-android] replay pre-anchor soft-launch failed route=%s prepare_route=%s\n",
            route != NULL ? route : "",
            prepare_route);
    return false;
  }
  int soft_sleep_ms =
      env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_PREPARE_ROUTE_SOFT_SLEEP_MS", 520);
  if (soft_sleep_ms > 0) usleep((useconds_t)soft_sleep_ms * 1000u);
  char runtime_route_after_soft[128];
  runtime_route_after_soft[0] = '\0';
  if (read_runtime_route_state_retry(adb,
                                     serial,
                                     replay_package,
                                     runtime_route_after_soft,
                                     sizeof(runtime_route_after_soft),
                                     4,
                                     140,
                                     true) &&
      runtime_route_ready_for_target(runtime_route_after_soft, route, parent_route)) {
    fprintf(stdout,
            "[capture-route-layer-android] replay pre-anchor soft ok route=%s runtime_before=%s runtime_after=%s prepare_route=%s\n",
            route != NULL ? route : "",
            runtime_route_before,
            runtime_route_after_soft,
            prepare_route);
    return true;
  }
  if (run_adb_am_start_activity_with_route(adb, serial, replay_activity, prepare_route) != 0) {
    fprintf(stderr,
            "[capture-route-layer-android] replay pre-anchor hard-launch failed route=%s prepare_route=%s runtime_before=%s runtime_after_soft=%s\n",
            route != NULL ? route : "",
            prepare_route,
            runtime_route_before,
            runtime_route_after_soft[0] != '\0' ? runtime_route_after_soft : "<empty>");
    return false;
  }
  int hard_sleep_ms =
      env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_PREPARE_ROUTE_HARD_SLEEP_MS", 920);
  if (hard_sleep_ms > 0) usleep((useconds_t)hard_sleep_ms * 1000u);
  char runtime_route_after_hard[128];
  runtime_route_after_hard[0] = '\0';
  if (read_runtime_route_state_retry(adb,
                                     serial,
                                     replay_package,
                                     runtime_route_after_hard,
                                     sizeof(runtime_route_after_hard),
                                     4,
                                     140,
                                     true) &&
      runtime_route_ready_for_target(runtime_route_after_hard, route, parent_route)) {
    fprintf(stdout,
            "[capture-route-layer-android] replay pre-anchor hard ok route=%s runtime_before=%s runtime_after=%s prepare_route=%s\n",
            route != NULL ? route : "",
            runtime_route_before,
            runtime_route_after_hard,
            prepare_route);
    return true;
  }
  fprintf(stderr,
          "[capture-route-layer-android] replay pre-anchor miss route=%s runtime_before=%s runtime_after_soft=%s runtime_after_hard=%s prepare_route=%s parent=%s\n",
          route != NULL ? route : "",
          runtime_route_before[0] != '\0' ? runtime_route_before : "<empty>",
          runtime_route_after_soft[0] != '\0' ? runtime_route_after_soft : "<empty>",
          runtime_route_after_hard[0] != '\0' ? runtime_route_after_hard : "<empty>",
          prepare_route,
          (parent_route != NULL && parent_route[0] != '\0') ? parent_route : "<none>");
  return false;
}

static bool route_equivalent_to_parent(const char *route, const char *parent_route) {
  if (route == NULL || parent_route == NULL || parent_route[0] == '\0') return false;
  const char *route_equivalent = semantic_equivalent_runtime_route(route);
  const char *parent_equivalent = semantic_equivalent_runtime_route(parent_route);
  return (route_equivalent != NULL && route_equivalent[0] != '\0' &&
          parent_equivalent != NULL && parent_equivalent[0] != '\0' &&
          strcmp(route_equivalent, parent_equivalent) == 0);
}

static bool routes_share_semantic_equivalent_target(const char *route_a, const char *route_b) {
  if (route_a == NULL || route_b == NULL || route_a[0] == '\0' || route_b[0] == '\0') return false;
  const char *eq_a = semantic_equivalent_runtime_route(route_a);
  const char *eq_b = semantic_equivalent_runtime_route(route_b);
  if (eq_a == NULL || eq_b == NULL || eq_a[0] == '\0' || eq_b[0] == '\0') return false;
  return strcmp(eq_a, eq_b) == 0;
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

static void recover_foreground_runtime_package(const char *adb,
                                               const char *serial,
                                               const char *activity_hint) {
  (void)run_adb_keyevent(adb, serial, 4);
  usleep(300000);
  (void)run_adb_am_start_default_activity(adb, serial, activity_hint);
  usleep(900000);
}

static void normalize_capture_device_posture(const char *adb, const char *serial) {
  if (adb == NULL || adb[0] == '\0' || serial == NULL || serial[0] == '\0') return;
  char *wake_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP", NULL};
  char *menu_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "input", "keyevent", "82", NULL};
  char *collapse_argv[] = {(char *)adb, "-s", (char *)serial, "shell", "cmd", "statusbar", "collapse", NULL};
  char *rotation_lock_argv[] = {(char *)adb,
                                "-s",
                                (char *)serial,
                                "shell",
                                "settings",
                                "put",
                                "system",
                                "accelerometer_rotation",
                                "0",
                                NULL};
  char *rotation_portrait_argv[] = {(char *)adb,
                                    "-s",
                                    (char *)serial,
                                    "shell",
                                    "settings",
                                    "put",
                                    "system",
                                    "user_rotation",
                                    "0",
                                    NULL};
  (void)nr_run_command(wake_argv, "/dev/null", 6);
  (void)nr_run_command(menu_argv, "/dev/null", 6);
  (void)nr_run_command(collapse_argv, "/dev/null", 6);
  (void)nr_run_command(rotation_lock_argv, "/dev/null", 6);
  (void)nr_run_command(rotation_portrait_argv, "/dev/null", 6);
  usleep(150000);
}

static const char *skip_ws_local(const char *p) {
  while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) ++p;
  return p;
}

static bool parse_json_string_local(const char *p, char *out, size_t out_cap, const char **out_end) {
  if (p == NULL || *p != '"' || out == NULL || out_cap == 0u) return false;
  ++p;
  size_t n = 0u;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"') {
      out[n] = '\0';
      if (out_end != NULL) *out_end = p;
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
    if (n + 1u >= out_cap) return false;
    out[n++] = ch;
  }
  return false;
}

static const char *find_key_value_local(const char *start, const char *end, const char *key) {
  if (start == NULL || end == NULL || key == NULL || end <= start) return NULL;
  char pat[128];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = start;
  while (p < end) {
    const char *hit = strstr(p, pat);
    if (hit == NULL || hit >= end) return NULL;
    const char *q = skip_ws_local(hit + strlen(pat));
    if (q == NULL || q >= end || *q != ':') {
      p = hit + 1;
      continue;
    }
    q = skip_ws_local(q + 1);
    if (q == NULL || q >= end) return NULL;
    return q;
  }
  return NULL;
}

static bool parse_int_field_local(const char *start, const char *end, const char *key, int *out_value) {
  if (out_value == NULL) return false;
  const char *p = find_key_value_local(start, end, key);
  if (p == NULL) return false;
  char *end_num = NULL;
  long v = strtol(p, &end_num, 10);
  if (end_num == p || end_num > end) return false;
  *out_value = (int)v;
  return true;
}

static bool parse_action_object(const char *obj_start, const char *obj_end, RouteAction *out_action) {
  if (obj_start == NULL || obj_end == NULL || out_action == NULL || obj_end <= obj_start) return false;
  char type[64];
  type[0] = '\0';
  const char *type_value = find_key_value_local(obj_start, obj_end, "type");
  if (type_value == NULL || *type_value != '"' || !parse_json_string_local(type_value, type, sizeof(type), NULL)) {
    return false;
  }
  out_action->type = ROUTE_ACTION_INVALID;
  out_action->v0 = 0;
  out_action->v1 = 0;
  if (strcmp(type, "launch_main") == 0) {
    out_action->type = ROUTE_ACTION_LAUNCH_MAIN;
    return true;
  }
  if (strcmp(type, "sleep_ms") == 0) {
    if (!parse_int_field_local(obj_start, obj_end, "ms", &out_action->v0)) return false;
    out_action->type = ROUTE_ACTION_SLEEP_MS;
    return true;
  }
  if (strcmp(type, "tap_ppm") == 0) {
    if (!parse_int_field_local(obj_start, obj_end, "x", &out_action->v0) ||
        !parse_int_field_local(obj_start, obj_end, "y", &out_action->v1)) {
      return false;
    }
    if (out_action->v0 < 0) out_action->v0 = 0;
    if (out_action->v0 > 1000) out_action->v0 = 1000;
    if (out_action->v1 < 0) out_action->v1 = 0;
    if (out_action->v1 > 1000) out_action->v1 = 1000;
    out_action->type = ROUTE_ACTION_TAP_PPM;
    return true;
  }
  if (strcmp(type, "keyevent") == 0) {
    if (!parse_int_field_local(obj_start, obj_end, "code", &out_action->v0)) return false;
    out_action->type = ROUTE_ACTION_KEYEVENT;
    return true;
  }
  return false;
}

static bool read_runtime_route_state(const char *adb,
                                     const char *serial,
                                     const char *pkg,
                                     char *out_route,
                                     size_t out_route_cap) {
  return read_runtime_route_semantic_state(
      adb, serial, pkg, out_route, out_route_cap, NULL, 0u, NULL);
}

static bool read_runtime_route_semantic_state(const char *adb,
                                              const char *serial,
                                              const char *pkg,
                                              char *out_route,
                                              size_t out_route_cap,
                                              char *out_semantic_hash,
                                              size_t out_semantic_hash_cap,
                                              int *out_semantic_count) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (out_semantic_hash != NULL && out_semantic_hash_cap > 0u) out_semantic_hash[0] = '\0';
  if (out_semantic_count != NULL) *out_semantic_count = 0;
  if (adb == NULL || adb[0] == '\0' || serial == NULL || serial[0] == '\0' || pkg == NULL || pkg[0] == '\0') {
    return false;
  }
  char cmd[PATH_MAX + 256];
  if (snprintf(cmd,
               sizeof(cmd),
               "%s -s %s exec-out run-as %s cat files/cheng_runtime_state.json",
               adb,
               serial,
               pkg) >= (int)sizeof(cmd)) {
    return false;
  }
  char doc[32 * 1024];
  if (read_command_text(cmd, doc, sizeof(doc)) != 0 || doc[0] == '\0') return false;
  const char *doc_begin = doc;
  const char *doc_end = doc + strlen(doc);
  bool route_ok = true;
  if (out_route != NULL && out_route_cap > 0u) {
    const char *value = find_key_value_local(doc_begin, doc_end, "route_state");
    route_ok = (value != NULL && *value == '"' && parse_json_string_local(value, out_route, out_route_cap, NULL));
  }
  bool semantic_hash_ok = true;
  if (out_semantic_hash != NULL && out_semantic_hash_cap > 0u) {
    const char *hash_value = find_key_value_local(doc_begin, doc_end, "semantic_nodes_applied_hash");
    semantic_hash_ok =
        (hash_value != NULL && *hash_value == '"' &&
         parse_json_string_local(hash_value, out_semantic_hash, out_semantic_hash_cap, NULL));
  }
  bool semantic_count_ok = true;
  if (out_semantic_count != NULL) {
    semantic_count_ok = parse_int_field_local(doc_begin, doc_end, "semantic_nodes_applied_count", out_semantic_count);
  }
  return route_ok && semantic_hash_ok && semantic_count_ok;
}

static int env_positive_int_or_default_local(const char *name, int fallback_value) {
  if (fallback_value <= 0) fallback_value = 1;
  if (name == NULL || name[0] == '\0') return fallback_value;
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return fallback_value;
  char *endptr = NULL;
  long parsed = strtol(raw, &endptr, 10);
  if (endptr == raw || parsed <= 0 || parsed > 60000) return fallback_value;
  return (int)parsed;
}

static bool read_runtime_route_state_retry(const char *adb,
                                           const char *serial,
                                           const char *pkg,
                                           char *out_route,
                                           size_t out_route_cap,
                                           int attempts,
                                           int sleep_ms,
                                           bool require_non_empty) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (attempts <= 0) attempts = 1;
  if (sleep_ms < 0) sleep_ms = 0;
  for (int attempt = 0; attempt < attempts; ++attempt) {
    char probe[128];
    probe[0] = '\0';
    if (read_runtime_route_semantic_state(adb, serial, pkg, probe, sizeof(probe), NULL, 0u, NULL)) {
      bool ok = true;
      if (require_non_empty && probe[0] == '\0') ok = false;
      if (ok) {
        if (out_route != NULL && out_route_cap > 0u) {
          snprintf(out_route, out_route_cap, "%s", probe);
        }
        return true;
      }
    }
    if (attempt + 1 < attempts && sleep_ms > 0) {
      usleep((useconds_t)sleep_ms * 1000u);
    }
  }
  return false;
}

static bool read_runtime_route_semantic_state_retry(const char *adb,
                                                    const char *serial,
                                                    const char *pkg,
                                                    char *out_route,
                                                    size_t out_route_cap,
                                                    char *out_semantic_hash,
                                                    size_t out_semantic_hash_cap,
                                                    int *out_semantic_count,
                                                    int attempts,
                                                    int sleep_ms,
                                                    bool require_non_empty_route) {
  if (out_route != NULL && out_route_cap > 0u) out_route[0] = '\0';
  if (out_semantic_hash != NULL && out_semantic_hash_cap > 0u) out_semantic_hash[0] = '\0';
  if (out_semantic_count != NULL) *out_semantic_count = 0;
  if (attempts <= 0) attempts = 1;
  if (sleep_ms < 0) sleep_ms = 0;
  for (int attempt = 0; attempt < attempts; ++attempt) {
    char probe_route[128];
    probe_route[0] = '\0';
    char probe_hash[64];
    probe_hash[0] = '\0';
    int probe_count = 0;
    if (read_runtime_route_semantic_state(
            adb, serial, pkg, probe_route, sizeof(probe_route), probe_hash, sizeof(probe_hash), &probe_count)) {
      bool ok = true;
      if (require_non_empty_route && probe_route[0] == '\0') ok = false;
      if (ok) {
        if (out_route != NULL && out_route_cap > 0u) snprintf(out_route, out_route_cap, "%s", probe_route);
        if (out_semantic_hash != NULL && out_semantic_hash_cap > 0u) {
          snprintf(out_semantic_hash, out_semantic_hash_cap, "%s", probe_hash);
        }
        if (out_semantic_count != NULL) *out_semantic_count = probe_count;
        return true;
      }
    }
    if (attempt + 1 < attempts && sleep_ms > 0) {
      usleep((useconds_t)sleep_ms * 1000u);
    }
  }
  return false;
}

static bool try_recover_foreground_package_local(const char *adb,
                                                 const char *serial,
                                                 const char *expected_pkg,
                                                 const char *expected_activity,
                                                 const char *route,
                                                 const char *phase,
                                                 const char *observed_foreground_pkg) {
  if (adb == NULL || serial == NULL || expected_pkg == NULL || expected_pkg[0] == '\0') return false;
  if (!env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_ALLOW_FOREGROUND_RECOVER", false)) {
    return false;
  }
  int recover_max = env_positive_int_or_default_local(
      "CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_RECOVER_MAX_ATTEMPTS",
      1);
  if (recover_max < 1) recover_max = 1;
  if (recover_max > 3) recover_max = 3;
  if (g_foreground_recover_used_local >= recover_max) {
    fprintf(stderr,
            "[capture-route-layer-android] foreground-recover skipped route=%s phase=%s used=%d max=%d\n",
            route != NULL ? route : "",
            phase != NULL ? phase : "<unknown>",
            g_foreground_recover_used_local,
            recover_max);
    return false;
  }
  char activity_buf[192];
  activity_buf[0] = '\0';
  const char *activity = expected_activity;
  if (activity == NULL || activity[0] == '\0') {
    activity = infer_main_activity_for_package_local(expected_pkg, activity_buf, sizeof(activity_buf));
  }
  if (activity == NULL || activity[0] == '\0') return false;
  const char *recover_route = getenv("CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_RECOVER_ROUTE");
  if (recover_route == NULL || recover_route[0] == '\0') recover_route = "home_default";
  g_foreground_recover_used_local += 1;
  fprintf(stdout,
          "[capture-route-layer-android] foreground-recover attempt=%d/%d route=%s phase=%s from=%s to_pkg=%s activity=%s target_route=%s\n",
          g_foreground_recover_used_local,
          recover_max,
          route != NULL ? route : "",
          phase != NULL ? phase : "<unknown>",
          (observed_foreground_pkg != NULL && observed_foreground_pkg[0] != '\0') ? observed_foreground_pkg : "<unknown>",
          expected_pkg,
          activity,
          recover_route);
  int start_rc = run_adb_am_start_activity_with_route_soft(adb, serial, activity, recover_route);
  if (start_rc != 0) {
    start_rc = run_adb_am_start_activity(adb, serial, activity);
  }
  if (start_rc != 0) {
    fprintf(stderr,
            "[capture-route-layer-android] foreground-recover start failed route=%s phase=%s rc=%d activity=%s\n",
            route != NULL ? route : "",
            phase != NULL ? phase : "<unknown>",
            start_rc,
            activity);
    return false;
  }
  int cooldown_ms = env_positive_int_or_default_local(
      "CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_RECOVER_COOLDOWN_MS",
      1200);
  if (cooldown_ms > 5000) cooldown_ms = 5000;
  if (cooldown_ms > 0) usleep((useconds_t)cooldown_ms * 1000u);
  int verify_attempts = env_positive_int_or_default_local(
      "CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_RECOVER_VERIFY_ATTEMPTS",
      8);
  int verify_sleep_ms = env_positive_int_or_default_local(
      "CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_RECOVER_VERIFY_SLEEP_MS",
      180);
  if (verify_attempts > 20) verify_attempts = 20;
  if (verify_sleep_ms > 1200) verify_sleep_ms = 1200;
  char foreground_now[256];
  foreground_now[0] = '\0';
  for (int i = 0; i < verify_attempts; ++i) {
    foreground_now[0] = '\0';
    if (resolve_foreground_package_local(adb, serial, foreground_now, sizeof(foreground_now)) &&
        foreground_now[0] != '\0' &&
        strcmp(foreground_now, expected_pkg) == 0) {
      fprintf(stdout,
              "[capture-route-layer-android] foreground-recover ok route=%s phase=%s foreground=%s\n",
              route != NULL ? route : "",
              phase != NULL ? phase : "<unknown>",
              foreground_now);
      return true;
    }
    if (i + 1 < verify_attempts && verify_sleep_ms > 0) {
      usleep((useconds_t)verify_sleep_ms * 1000u);
    }
  }
  fprintf(stderr,
          "[capture-route-layer-android] foreground-recover verify failed route=%s phase=%s foreground=%s expected=%s\n",
          route != NULL ? route : "",
          phase != NULL ? phase : "<unknown>",
          foreground_now[0] != '\0' ? foreground_now : "<unknown>",
          expected_pkg);
  return false;
}

static bool guard_foreground_package_strict(const char *adb,
                                            const char *serial,
                                            const char *expected_pkg,
                                            const char *expected_activity,
                                            const char *route,
                                            const char *phase,
                                            int attempts,
                                            int sleep_ms,
                                            bool allow_foreground_recover) {
  if (adb == NULL || serial == NULL || expected_pkg == NULL || expected_pkg[0] == '\0') return false;
  if (attempts <= 0) attempts = 1;
  if (sleep_ms < 0) sleep_ms = 0;
  char fg_pkg[256];
  fg_pkg[0] = '\0';
  for (int i = 0; i < attempts; ++i) {
    fg_pkg[0] = '\0';
    if (resolve_foreground_package_local(adb, serial, fg_pkg, sizeof(fg_pkg)) &&
        fg_pkg[0] != '\0' &&
        strcmp(fg_pkg, expected_pkg) == 0) {
      return true;
    }
    if (i + 1 < attempts && sleep_ms > 0) {
      usleep((useconds_t)sleep_ms * 1000u);
    }
  }
  if (allow_foreground_recover &&
      try_recover_foreground_package_local(
          adb, serial, expected_pkg, expected_activity, route, phase, fg_pkg)) {
    return true;
  }
  fprintf(stderr,
          "[capture-route-layer-android] foreground-left-app route=%s phase=%s foreground=%s expected=%s; stop\n",
          route != NULL ? route : "",
          phase != NULL ? phase : "<unknown>",
          fg_pkg[0] != '\0' ? fg_pkg : "<unknown>",
          expected_pkg);
  return false;
}

static bool wait_foreground_package_in_list_local(const char *adb,
                                                  const char *serial,
                                                  const char *expected_pkg_csv,
                                                  int attempts,
                                                  int sleep_ms,
                                                  char *out_foreground,
                                                  size_t out_foreground_cap) {
  if (out_foreground != NULL && out_foreground_cap > 0u) out_foreground[0] = '\0';
  if (adb == NULL || serial == NULL || expected_pkg_csv == NULL || expected_pkg_csv[0] == '\0') return false;
  if (attempts <= 0) attempts = 1;
  if (sleep_ms < 0) sleep_ms = 0;
  char fg_pkg[256];
  fg_pkg[0] = '\0';
  for (int i = 0; i < attempts; ++i) {
    fg_pkg[0] = '\0';
    if (resolve_foreground_package_local(adb, serial, fg_pkg, sizeof(fg_pkg)) &&
        fg_pkg[0] != '\0' &&
        package_in_csv_list_local(fg_pkg, expected_pkg_csv)) {
      if (out_foreground != NULL && out_foreground_cap > 0u) {
        snprintf(out_foreground, out_foreground_cap, "%s", fg_pkg);
      }
      return true;
    }
    if (i + 1 < attempts && sleep_ms > 0) {
      usleep((useconds_t)sleep_ms * 1000u);
    }
  }
  if (out_foreground != NULL && out_foreground_cap > 0u && fg_pkg[0] != '\0') {
    snprintf(out_foreground, out_foreground_cap, "%s", fg_pkg);
  }
  return false;
}

static bool read_route_meta(const char *route_actions_json,
                            const char *route,
                            char *parent,
                            size_t parent_cap,
                            int *depth,
                            char *path_signature,
                            size_t path_signature_cap) {
  if (parent != NULL && parent_cap > 0u) parent[0] = '\0';
  if (depth != NULL) *depth = 0;
  if (path_signature != NULL && path_signature_cap > 0u) path_signature[0] = '\0';
  if (route_actions_json == NULL || route == NULL) return false;
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
  const char *obj_start = hit;
  while (obj_start > doc && *obj_start != '{') --obj_start;
  if (*obj_start != '{') {
    free(doc);
    return false;
  }
  const char *p = obj_start;
  int obj_depth = 0;
  bool in_string = false;
  const char *obj_end = NULL;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"' && (p - 1 == obj_start || *(p - 2) != '\\')) in_string = !in_string;
    if (in_string) continue;
    if (ch == '{') {
      obj_depth += 1;
      continue;
    }
    if (ch == '}') {
      obj_depth -= 1;
      if (obj_depth == 0) {
        obj_end = p;
        break;
      }
    }
  }
  if (obj_end == NULL) {
    free(doc);
    return false;
  }
  const char *parent_value = find_key_value_local(obj_start, obj_end, "parent");
  if (parent != NULL && parent_cap > 0u && parent_value != NULL && *parent_value == '"') {
    if (!parse_json_string_local(parent_value, parent, parent_cap, NULL)) {
      free(doc);
      return false;
    }
  }
  if (depth != NULL && !parse_int_field_local(obj_start, obj_end, "depth", depth)) {
    free(doc);
    return false;
  }
  const char *sig_value = find_key_value_local(obj_start, obj_end, "path_signature");
  if (path_signature != NULL && path_signature_cap > 0u && sig_value != NULL && *sig_value == '"') {
    if (!parse_json_string_local(sig_value, path_signature, path_signature_cap, NULL)) {
      free(doc);
      return false;
    }
  }
  free(doc);
  return true;
}

static bool read_route_actions(const char *route_actions_json, const char *route, RouteActionList *out_actions) {
  if (route_actions_json == NULL || route == NULL || out_actions == NULL) return false;
  memset(out_actions, 0, sizeof(*out_actions));
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
  const char *actions_key = strstr(hit, "\"actions\"");
  if (actions_key == NULL) {
    free(doc);
    return false;
  }
  const char *arr_begin = strchr(actions_key, '[');
  if (arr_begin == NULL) {
    free(doc);
    return false;
  }
  const char *arr_end = arr_begin + 1;
  int depth = 1;
  while (*arr_end != '\0' && depth > 0) {
    if (*arr_end == '[') depth += 1;
    else if (*arr_end == ']') depth -= 1;
    arr_end += 1;
  }
  if (depth != 0) {
    free(doc);
    return false;
  }
  const char *p = arr_begin + 1;
  while (p < arr_end - 1) {
    p = skip_ws_local(p);
    if (p >= arr_end - 1) break;
    if (*p == ',') {
      p += 1;
      continue;
    }
    if (*p != '{') {
      route_action_list_free(out_actions);
      free(doc);
      return false;
    }
    const char *obj_begin = p;
    int obj_depth = 1;
    ++p;
    bool in_string = false;
    while (p < arr_end && obj_depth > 0) {
      char ch = *p++;
      if (ch == '"' && (p < arr_end ? *(p - 2) != '\\' : true)) in_string = !in_string;
      if (in_string) continue;
      if (ch == '{') obj_depth += 1;
      else if (ch == '}') obj_depth -= 1;
    }
    if (obj_depth != 0) {
      route_action_list_free(out_actions);
      free(doc);
      return false;
    }
    const char *obj_end = p;
    RouteAction action;
    if (!parse_action_object(obj_begin, obj_end, &action) || route_action_list_push(out_actions, action) != 0) {
      route_action_list_free(out_actions);
      free(doc);
      return false;
    }
  }
  free(doc);
  return out_actions->len > 0u;
}

static size_t build_nav_route_probe_candidates_local(const char *route_state,
                                                     int (*out_xy_ppm)[2],
                                                     size_t out_cap) {
  if (route_state == NULL || route_state[0] == '\0' || out_xy_ppm == NULL || out_cap == 0u) return 0u;
  size_t len = 0u;
  if (strcmp(route_state, "home_default") == 0) {
    const int vals[][2] = {{120, 965}, {120, 980}, {120, 975}, {120, 965}, {100, 980}};
    for (size_t i = 0u; i < sizeof(vals) / sizeof(vals[0]) && len < out_cap; ++i) {
      out_xy_ppm[len][0] = vals[i][0];
      out_xy_ppm[len][1] = vals[i][1];
      ++len;
    }
  } else if (strcmp(route_state, "tab_messages") == 0) {
    const int vals[][2] = {{300, 965}, {340, 965}, {360, 980}, {360, 975}, {360, 965}};
    for (size_t i = 0u; i < sizeof(vals) / sizeof(vals[0]) && len < out_cap; ++i) {
      out_xy_ppm[len][0] = vals[i][0];
      out_xy_ppm[len][1] = vals[i][1];
      ++len;
    }
  } else if (strcmp(route_state, "publish_selector") == 0) {
    const int vals[][2] = {{560, 965}, {600, 965}, {620, 980}, {600, 975}, {600, 965}};
    for (size_t i = 0u; i < sizeof(vals) / sizeof(vals[0]) && len < out_cap; ++i) {
      out_xy_ppm[len][0] = vals[i][0];
      out_xy_ppm[len][1] = vals[i][1];
      ++len;
    }
  } else if (strcmp(route_state, "tab_nodes") == 0) {
    const int vals[][2] = {{660, 965}, {700, 965}, {760, 965}, {790, 965}, {730, 965}};
    for (size_t i = 0u; i < sizeof(vals) / sizeof(vals[0]) && len < out_cap; ++i) {
      out_xy_ppm[len][0] = vals[i][0];
      out_xy_ppm[len][1] = vals[i][1];
      ++len;
    }
  } else if (strcmp(route_state, "tab_profile") == 0) {
    const int vals[][2] = {{860, 965}, {900, 965}, {960, 965}, {940, 965}, {910, 965}};
    for (size_t i = 0u; i < sizeof(vals) / sizeof(vals[0]) && len < out_cap; ++i) {
      out_xy_ppm[len][0] = vals[i][0];
      out_xy_ppm[len][1] = vals[i][1];
      ++len;
    }
  }
  return len;
}

static bool try_nav_route_probe_fallback_local(const char *adb,
                                               const char *serial,
                                               const char *route_state,
                                               const char *replay_package,
                                               bool replay_use_visible_bounds,
                                               const Rect *bounds,
                                               char *runtime_route_out,
                                               size_t runtime_route_cap,
                                               size_t *hit_candidate_out) {
  if (hit_candidate_out != NULL) *hit_candidate_out = 0u;
  if (runtime_route_out != NULL && runtime_route_cap > 0u) runtime_route_out[0] = '\0';
  if (adb == NULL || serial == NULL || route_state == NULL || route_state[0] == '\0' ||
      replay_package == NULL || replay_package[0] == '\0' ||
      bounds == NULL) {
    return false;
  }
  int candidates[8][2];
  size_t candidate_len = build_nav_route_probe_candidates_local(route_state, candidates, 8u);
  if (candidate_len == 0u) return false;
  int tap_x0 = replay_use_visible_bounds ? bounds->x : 0;
  int tap_y0 = replay_use_visible_bounds ? bounds->y : 0;
  int tap_w = replay_use_visible_bounds ? bounds->w : 1212;
  int tap_h = replay_use_visible_bounds ? bounds->h : 2512;
  if (tap_w <= 0) tap_w = bounds->w > 0 ? bounds->w : 1212;
  if (tap_h <= 0) tap_h = bounds->h > 0 ? bounds->h : 2512;
  int min_x = tap_x0;
  int min_y = tap_y0;
  int max_x = tap_x0 + tap_w - 1;
  int max_y = tap_y0 + tap_h - 1;
  if (max_x < min_x) max_x = min_x;
  if (max_y < min_y) max_y = min_y;
  int probe_attempts = env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_NAV_FALLBACK_PROBE_ATTEMPTS", 4);
  int probe_sleep_ms = env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_NAV_FALLBACK_PROBE_SLEEP_MS", 180);
  if (probe_attempts < 8) probe_attempts = 8;
  if (probe_sleep_ms < 220) probe_sleep_ms = 220;
  for (size_t idx = 0u; idx < candidate_len; ++idx) {
    int x = tap_x0 + (tap_w * candidates[idx][0]) / 1000;
    int y = tap_y0 + (tap_h * candidates[idx][1]) / 1000;
    if (x < min_x) x = min_x;
    if (x > max_x) x = max_x;
    if (y < min_y) y = min_y;
    if (y > max_y) y = max_y;
    if (run_adb_tap(adb, serial, x, y) != 0) continue;
    char runtime_route_now[128];
    runtime_route_now[0] = '\0';
    char runtime_semantic_hash_now[64];
    runtime_semantic_hash_now[0] = '\0';
    int runtime_semantic_count_now = 0;
    if (!read_runtime_route_semantic_state_retry(adb,
                                                 serial,
                                                 replay_package,
                                                 runtime_route_now,
                                                 sizeof(runtime_route_now),
                                                 runtime_semantic_hash_now,
                                                 sizeof(runtime_semantic_hash_now),
                                                 &runtime_semantic_count_now,
                                                 probe_attempts,
                                                 probe_sleep_ms,
                                                 true)) {
      continue;
    }
    if (runtime_route_out != NULL && runtime_route_cap > 0u) {
      snprintf(runtime_route_out, runtime_route_cap, "%s", runtime_route_now);
    }
    if (runtime_route_matches_expected(runtime_route_now, route_state)) {
      if (hit_candidate_out != NULL) *hit_candidate_out = idx;
      return true;
    }
  }
  return false;
}

static int replay_route_state(const char *adb,
                              const char *serial,
                              const char *route,
                              const char *parent_route,
                              const char *route_semantic_tree_path,
                              const RouteActionList *actions,
                              bool no_foreground_switch) {
  if (actions == NULL || actions->len == 0u) {
    fprintf(stderr, "[capture-route-layer-android] route actions empty: %s\n", route ? route : "");
    return -1;
  }
  char replay_package_buf[256];
  replay_package_buf[0] = '\0';
  const char *replay_package = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE");
  const bool bind_foreground_package = env_flag_enabled_local(
      "CHENG_CAPTURE_ROUTE_LAYER_BIND_FOREGROUND_PACKAGE",
      false);
  if (replay_package == NULL || replay_package[0] == '\0') replay_package = getenv("CHENG_ANDROID_APP_PACKAGE");
  if (replay_package == NULL || replay_package[0] == '\0') replay_package = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
  if (no_foreground_switch &&
      resolve_foreground_package_local(adb, serial, replay_package_buf, sizeof(replay_package_buf)) &&
      replay_package_buf[0] != '\0') {
    if (bind_foreground_package) {
      if (replay_package != NULL && replay_package[0] != '\0' && strcmp(replay_package, replay_package_buf) != 0) {
        fprintf(stdout,
                "[capture-route-layer-android] silent mode bind replay package to foreground: %s -> %s\n",
                replay_package,
                replay_package_buf);
      }
      replay_package = replay_package_buf;
    } else if (replay_package == NULL || replay_package[0] == '\0') {
      replay_package = replay_package_buf;
    } else if (strcmp(replay_package, replay_package_buf) != 0) {
      fprintf(stderr,
              "[capture-route-layer-android] silent mode replay package mismatch configured=%s foreground=%s (set CHENG_CAPTURE_ROUTE_LAYER_BIND_FOREGROUND_PACKAGE=1 or align env)\n",
              replay_package,
              replay_package_buf);
      return -1;
    }
  }
  if (replay_package == NULL || replay_package[0] == '\0') replay_package = "com.unimaker.app";
  char replay_activity_buf[192];
  replay_activity_buf[0] = '\0';
  const char *replay_activity = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
  if (replay_activity == NULL || replay_activity[0] == '\0') replay_activity = getenv("CHENG_ANDROID_APP_ACTIVITY");
  if (replay_activity == NULL || replay_activity[0] == '\0') replay_activity = getenv("CHENG_ANDROID_EQ_APP_ACTIVITY");
  if (replay_activity == NULL || replay_activity[0] == '\0') {
    replay_activity = infer_main_activity_for_package_local(
        replay_package, replay_activity_buf, sizeof(replay_activity_buf));
  }
  bool replay_use_visible_bounds = false;
  const char *use_bounds_env = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_USE_VISIBLE_BOUNDS");
  if (use_bounds_env != NULL && use_bounds_env[0] != '\0' && strcmp(use_bounds_env, "0") != 0) {
    replay_use_visible_bounds = true;
  } else if (route != NULL &&
             (strncmp(route, "tab_", 4u) == 0 || strcmp(route, "publish_selector") == 0)) {
    /*
     * Bottom navigation hit targets are positioned within mAppBounds, not the
     * full display bounds. Keep top-left routes on full-screen coordinates.
     */
    replay_use_visible_bounds = true;
  }
  const char *silent_allowed_packages = getenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGES");
  if (silent_allowed_packages == NULL || silent_allowed_packages[0] == '\0') {
    silent_allowed_packages = getenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGE");
  }
  if (silent_allowed_packages == NULL || silent_allowed_packages[0] == '\0') {
    silent_allowed_packages = replay_package;
  }
  bool silent_allow_launch_main = env_flag_enabled_local(
      "CHENG_ANDROID_1TO1_SILENT_ALLOW_LAUNCH_MAIN",
      false);
  const char *silent_launch_env = getenv("CHENG_ANDROID_1TO1_SILENT_ALLOW_LAUNCH_MAIN");
  if (silent_launch_env != NULL && silent_launch_env[0] != '\0') {
    silent_allow_launch_main = (strcmp(silent_launch_env, "0") != 0);
  } else if (no_foreground_switch &&
             route != NULL &&
             (strcmp(route, "home_default") == 0 ||
              (replay_package != NULL && strcmp(replay_package, "com.cheng.mobile") == 0))) {
    /* In strict no-foreground mode, com.cheng.mobile layer routing needs per-route soft relaunch to avoid route carryover. */
    silent_allow_launch_main = true;
  }
  const char *launch_route = semantic_equivalent_runtime_route(route);
  if (launch_route == NULL || launch_route[0] == '\0') launch_route = route;
  const char *runtimeless_semantic_env =
      getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIMELESS_SEMANTIC_STRICT");
  bool runtimeless_semantic_strict = env_flag_enabled_local(
      "CHENG_CAPTURE_ROUTE_LAYER_RUNTIMELESS_SEMANTIC_STRICT",
      false);
  if ((runtimeless_semantic_env == NULL || runtimeless_semantic_env[0] == '\0') &&
      replay_package != NULL && strcmp(replay_package, "com.unimaker.app") == 0) {
    runtimeless_semantic_strict = true;
  }
  bool require_runtime_route_probe = !runtimeless_semantic_strict;
  const char *require_probe_env = getenv("CHENG_CAPTURE_ROUTE_LAYER_REQUIRE_RUNTIME_ROUTE_PROBE");
  if (require_probe_env != NULL && require_probe_env[0] != '\0') {
    if (strcmp(require_probe_env, "0") == 0) {
      if (runtimeless_semantic_strict) {
        require_runtime_route_probe = false;
      } else {
        fprintf(stderr,
                "[capture-route-layer-android] strict runtime mode forbids CHENG_CAPTURE_ROUTE_LAYER_REQUIRE_RUNTIME_ROUTE_PROBE=0\n");
        return -1;
      }
    } else {
      require_runtime_route_probe = true;
    }
  }
  if (!require_runtime_route_probe) {
    fprintf(stdout,
            "[capture-route-layer-android] runtime route probe disabled by semantic-strict runtimeless mode package=%s route=%s\n",
            replay_package != NULL ? replay_package : "<none>",
            route != NULL ? route : "<none>");
  }
  Rect bounds;
  bounds.x = 0;
  bounds.y = 0;
  bounds.w = 1212;
  bounds.h = 2512;
  (void)read_app_bounds(adb, serial, &bounds);
  bool route_hit = false;
  size_t route_hit_action_index = 0u;
  bool semantic_target_required = route_requires_visual_delta(route);
  bool allow_route_hit_short_circuit = !semantic_target_required;
  bool semantic_target_short_circuit = semantic_target_required;
  if (semantic_target_required && route != NULL && route[0] != '\0') {
    if (strcmp(route, "publish_selector") == 0) {
      /* publish_selector has frequent transient hits; require extra actions/stability */
      semantic_target_short_circuit = false;
    } else if (strncmp(route, "home_", 5u) == 0) {
      /*
       * home_* routes must usually produce a visual delta against home_default;
       * keep replaying by default to avoid parent-equal framehash rejects.
       */
      semantic_target_short_circuit = false;
      if (strcmp(route, "home_ecom_overlay_open") == 0) {
        /*
         * ecom overlay actions may trigger external jumps on some devices;
         * keep short-circuit enabled once semantic hit appears.
         */
        semantic_target_short_circuit = true;
      }
    }
  }
  char semantic_expected_hash[64];
  semantic_expected_hash[0] = '\0';
  int semantic_expected_count = 0;
  if (semantic_target_required) {
    if (!load_route_semantic_expectation_local(route_semantic_tree_path,
                                               route,
                                               semantic_expected_hash,
                                               sizeof(semantic_expected_hash),
                                               &semantic_expected_count)) {
      fprintf(stderr,
              "[capture-route-layer-android] route semantic expectation missing route=%s tree=%s\n",
              route != NULL ? route : "<none>",
              route_semantic_tree_path != NULL ? route_semantic_tree_path : "<none>");
      return -1;
    }
  }
  if (no_foreground_switch &&
      require_runtime_route_probe &&
      !runtimeless_semantic_strict &&
      !route_actions_contain_launch_main(actions)) {
    if (!prepare_runtime_route_anchor_silent(
            adb, serial, replay_package, replay_activity, route, parent_route)) {
      return -1;
    }
  }
  for (size_t i = 0u; i < actions->len; ++i) {
    if (no_foreground_switch) {
      int fg_guard_attempts =
          env_positive_int_or_default_local("CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_GUARD_ATTEMPTS", 6);
      int fg_guard_sleep_ms =
          env_positive_int_or_default_local("CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_GUARD_SLEEP_MS", 180);
      if (fg_guard_attempts > 8) fg_guard_attempts = 8;
      if (fg_guard_sleep_ms > 1000) fg_guard_sleep_ms = 1000;
      if (!guard_foreground_package_strict(
              adb,
              serial,
              replay_package,
              replay_activity,
              route,
              "pre-action",
              fg_guard_attempts,
              fg_guard_sleep_ms,
              true)) {
        return -1;
      }
    }
    RouteAction action = actions->items[i];
    if (no_foreground_switch && i == 0u && action.type == ROUTE_ACTION_LAUNCH_MAIN && require_runtime_route_probe) {
      bool allow_precheck_short_circuit = allow_route_hit_short_circuit;
      if (route != NULL && strcmp(route, "sidebar_open") == 0) allow_precheck_short_circuit = false;
      if (route != NULL && strcmp(route, "home_default") == 0) allow_precheck_short_circuit = false;
      char runtime_route_now[128];
      runtime_route_now[0] = '\0';
      char runtime_semantic_hash_now[64];
      runtime_semantic_hash_now[0] = '\0';
      int runtime_semantic_count_now = 0;
      if (read_runtime_route_semantic_state_retry(adb,
                                                  serial,
                                                  replay_package,
                                                  runtime_route_now,
                                                  sizeof(runtime_route_now),
                                                  runtime_semantic_hash_now,
                                                  sizeof(runtime_semantic_hash_now),
                                                  &runtime_semantic_count_now,
                                                  3,
                                                  120,
                                                  true)) {
        bool precheck_route_match = runtime_route_matches_expected(runtime_route_now, route);
        bool precheck_semantic_relaxed = false;
        bool precheck_semantic_match =
            !semantic_target_required ||
            semantic_hash_match_or_relaxed_for_route(replay_package,
                                                     route,
                                                     runtime_route_now,
                                                     runtime_semantic_hash_now,
                                                     runtime_semantic_count_now,
                                                     semantic_expected_hash,
                                                     semantic_expected_count,
                                                     precheck_route_match,
                                                     &precheck_semantic_relaxed);
        if (precheck_route_match && precheck_semantic_match &&
            allow_precheck_short_circuit) {
          route_hit = true;
          route_hit_action_index = i;
          if (semantic_target_required) {
            fprintf(stdout,
                    "[capture-route-layer-android] replay precheck semantic-target already reached route=%s runtime_route=%s semantic_hash=%s semantic_relaxed=%d\n",
                    route != NULL ? route : "",
                    runtime_route_now,
                    runtime_semantic_hash_now[0] != '\0' ? runtime_semantic_hash_now : "<empty>",
                    precheck_semantic_relaxed ? 1 : 0);
          } else {
            fprintf(stdout,
                    "[capture-route-layer-android] replay precheck target already reached route=%s runtime_route=%s; skip actions\n",
                    route != NULL ? route : "",
                    runtime_route_now);
          }
          break;
        }
      }
      if (allow_precheck_short_circuit && runtime_route_matches_expected(runtime_route_now, route)) {
        route_hit = true;
        route_hit_action_index = i;
        fprintf(stdout,
                "[capture-route-layer-android] replay precheck target already reached route=%s runtime_route=%s; skip actions\n",
                route != NULL ? route : "",
                runtime_route_now);
        break;
      }
    }
    bool skip_runtime_probe_for_action = false;
    if (no_foreground_switch && action.type != ROUTE_ACTION_SLEEP_MS) {
      int fg_probe_attempts =
          env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PROBE_ATTEMPTS", 4);
      int fg_probe_sleep_ms =
          env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PROBE_SLEEP_MS", 180);
      if (fg_probe_attempts > 12) fg_probe_attempts = 12;
      if (fg_probe_sleep_ms > 1200) fg_probe_sleep_ms = 1200;
      bool fg_ok = false;
      char fg_pkg[256];
      fg_pkg[0] = '\0';
      for (int fg_try = 0; fg_try < fg_probe_attempts; ++fg_try) {
        fg_pkg[0] = '\0';
        if (resolve_foreground_package_local(adb, serial, fg_pkg, sizeof(fg_pkg))) {
          if (strcmp(fg_pkg, replay_package) == 0) {
            fg_ok = true;
            break;
          }
          if (!bind_foreground_package && package_in_csv_list_local(fg_pkg, silent_allowed_packages)) {
            fg_ok = true;
            break;
          }
        }
        if (fg_try + 1 < fg_probe_attempts && fg_probe_sleep_ms > 0) {
          usleep((useconds_t)fg_probe_sleep_ms * 1000u);
        }
      }
      if (!fg_ok) {
        fprintf(stderr,
                "[capture-route-layer-android] silent foreground drift route=%s action_index=%zu action_type=%s foreground=%s expected=%s attempts=%d\n",
                route != NULL ? route : "",
                i,
                route_action_type_name(action.type),
                fg_pkg[0] != '\0' ? fg_pkg : "<unknown>",
                replay_package,
                fg_probe_attempts);
        return -1;
      }
    }
    if (action.type == ROUTE_ACTION_LAUNCH_MAIN) {
      if (no_foreground_switch) {
        if (runtimeless_semantic_strict) {
          char fg_pkg_runtime_less[256];
          fg_pkg_runtime_less[0] = '\0';
          if (!resolve_foreground_package_local(adb, serial, fg_pkg_runtime_less, sizeof(fg_pkg_runtime_less)) ||
              fg_pkg_runtime_less[0] == '\0' ||
              strcmp(fg_pkg_runtime_less, replay_package) != 0) {
            fprintf(stderr,
                    "[capture-route-layer-android] runtimeless launch_main precheck failed route=%s action_index=%zu foreground=%s expected=%s\n",
                    route != NULL ? route : "",
                    i,
                    fg_pkg_runtime_less[0] != '\0' ? fg_pkg_runtime_less : "<unknown>",
                    replay_package);
            return -1;
          }
          fprintf(stdout,
                  "[capture-route-layer-android] runtimeless mode replace launch_main(no-op) route=%s action_index=%zu foreground=%s\n",
                  route != NULL ? route : "",
                  i,
                  fg_pkg_runtime_less);
          skip_runtime_probe_for_action = true;
        } else if (silent_allow_launch_main) {
          if (run_adb_am_start_activity_with_route_soft(adb, serial, replay_activity, launch_route) != 0) {
            fprintf(stderr,
                    "[capture-route-layer-android] silent mode soft-launch_main failed route=%s action_index=%zu\n",
                    route != NULL ? route : "",
                    i);
            return -1;
          }
          int soft_launch_sleep_ms =
              env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_SOFT_LAUNCH_SLEEP_MS", 900);
          if (soft_launch_sleep_ms > 0) usleep((useconds_t)soft_launch_sleep_ms * 1000u);
          bool launch_soft_ready = false;
          char runtime_route_after_soft[128];
          runtime_route_after_soft[0] = '\0';
          if (read_runtime_route_state_retry(adb,
                                             serial,
                                             replay_package,
                                             runtime_route_after_soft,
                                             sizeof(runtime_route_after_soft),
                                             4,
                                             140,
                                             true)) {
            launch_soft_ready = runtime_route_matches_expected(runtime_route_after_soft, route);
            if (!launch_soft_ready && parent_route != NULL && parent_route[0] != '\0' &&
                strcmp(parent_route, "home_default") != 0) {
              launch_soft_ready = runtime_route_matches_expected(runtime_route_after_soft, parent_route);
            }
          }
          bool launch_reset_fallback = env_flag_enabled_local(
              "CHENG_ANDROID_1TO1_SILENT_LAUNCH_MAIN_RESET_FALLBACK",
              false);
          if (!launch_soft_ready && launch_reset_fallback) {
            fprintf(stdout,
                    "[capture-route-layer-android] silent launch_main soft not ready route=%s runtime_route=%s; retry with reset launch\n",
                    route != NULL ? route : "",
                    runtime_route_after_soft[0] != '\0' ? runtime_route_after_soft : "<empty>");
            if (run_adb_am_start_activity_with_route(adb, serial, replay_activity, launch_route) != 0) {
              fprintf(stderr,
                      "[capture-route-layer-android] silent mode reset-launch_main failed route=%s action_index=%zu\n",
                      route != NULL ? route : "",
                      i);
              return -1;
            }
            int reset_launch_sleep_default = 1200;
            if (route != NULL && strcmp(route, "home_channel_manager_open") == 0) {
              reset_launch_sleep_default = 220;
            }
            int reset_launch_sleep_ms =
                env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_RESET_LAUNCH_SLEEP_MS", reset_launch_sleep_default);
            if (reset_launch_sleep_ms > 0) usleep((useconds_t)reset_launch_sleep_ms * 1000u);
          }
        } else {
          bool silent_home_anchor =
              env_flag_enabled_local("CHENG_ANDROID_1TO1_SILENT_HOME_ANCHOR", true);
          if (silent_home_anchor) {
            char runtime_route_before[128];
            runtime_route_before[0] = '\0';
            if (read_runtime_route_state_retry(
                    adb, serial, replay_package, runtime_route_before, sizeof(runtime_route_before), 3, 120, true)) {
              if (runtime_route_is_home_overlay_like(runtime_route_before)) {
                int tap_x0 = replay_use_visible_bounds ? bounds.x : 0;
                int tap_y0 = replay_use_visible_bounds ? bounds.y : 0;
                int tap_w = replay_use_visible_bounds ? bounds.w : 1212;
                int tap_h = replay_use_visible_bounds ? bounds.h : 2512;
                if (tap_w <= 0) tap_w = bounds.w > 0 ? bounds.w : 1212;
                if (tap_h <= 0) tap_h = bounds.h > 0 ? bounds.h : 2512;
                int close_x = tap_x0 + (tap_w * 825) / 1000;
                int close_y = tap_y0 + (tap_h * 119) / 1000;
                int min_x = tap_x0;
                int min_y = tap_y0;
                int max_x = tap_x0 + tap_w - 1;
                int max_y = tap_y0 + tap_h - 1;
                if (max_x < min_x) max_x = min_x;
                if (max_y < min_y) max_y = min_y;
                if (close_x < min_x) close_x = min_x;
                if (close_x > max_x) close_x = max_x;
                if (close_y < min_y) close_y = min_y;
                if (close_y > max_y) close_y = max_y;
                if (run_adb_tap(adb, serial, close_x, close_y) == 0) {
                  int close_sleep_ms =
                      env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_SIDEBAR_CLOSE_SLEEP_MS", 220);
                  if (close_sleep_ms > 0) usleep((useconds_t)close_sleep_ms * 1000u);
                  char runtime_route_after_sidebar_close[128];
                  runtime_route_after_sidebar_close[0] = '\0';
                  if (read_runtime_route_state_retry(adb,
                                                    serial,
                                                    replay_package,
                                                    runtime_route_after_sidebar_close,
                                                    sizeof(runtime_route_after_sidebar_close),
                                                    3,
                                                    120,
                                                    true) &&
                      runtime_route_after_sidebar_close[0] != '\0') {
                    snprintf(runtime_route_before,
                             sizeof(runtime_route_before),
                             "%s",
                             runtime_route_after_sidebar_close);
                  }
                  fprintf(stdout,
                          "[capture-route-layer-android] silent home-close-sidebar route=%s runtime_now=%s x=%d y=%d\n",
                          route != NULL ? route : "",
                          runtime_route_before[0] != '\0' ? runtime_route_before : "<empty>",
                          close_x,
                          close_y);
                }
              }
              bool already_ready =
                  runtime_route_ready_for_target(runtime_route_before, route, parent_route);
              if (strcmp(runtime_route_before, "home_search_open") == 0) {
                int tap_x0 = replay_use_visible_bounds ? bounds.x : 0;
                int tap_y0 = replay_use_visible_bounds ? bounds.y : 0;
                int tap_w = replay_use_visible_bounds ? bounds.w : 1212;
                int tap_h = replay_use_visible_bounds ? bounds.h : 2512;
                if (tap_w <= 0) tap_w = bounds.w > 0 ? bounds.w : 1212;
                if (tap_h <= 0) tap_h = bounds.h > 0 ? bounds.h : 2512;
                int search_x = tap_x0 + (tap_w * 760) / 1000;
                int search_y = tap_y0 + (tap_h * 78) / 1000;
                int min_x = tap_x0;
                int min_y = tap_y0;
                int max_x = tap_x0 + tap_w - 1;
                int max_y = tap_y0 + tap_h - 1;
                if (max_x < min_x) max_x = min_x;
                if (max_y < min_y) max_y = min_y;
                if (search_x < min_x) search_x = min_x;
                if (search_x > max_x) search_x = max_x;
                if (search_y < min_y) search_y = min_y;
                if (search_y > max_y) search_y = max_y;
                if (run_adb_tap(adb, serial, search_x, search_y) == 0) {
                  int close_sleep_ms =
                      env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_SEARCH_CLOSE_SLEEP_MS", 320);
                  if (close_sleep_ms > 0) usleep((useconds_t)close_sleep_ms * 1000u);
                  char runtime_route_closed[128];
                  runtime_route_closed[0] = '\0';
                  if (read_runtime_route_state_retry(adb,
                                                    serial,
                                                    replay_package,
                                                    runtime_route_closed,
                                                    sizeof(runtime_route_closed),
                                                    3,
                                                    120,
                                                    true)) {
                    already_ready =
                        runtime_route_ready_for_target(runtime_route_closed, route, parent_route);
                    fprintf(stdout,
                            "[capture-route-layer-android] silent search-close route=%s runtime_before=%s runtime_after=%s\n",
                            route != NULL ? route : "",
                            runtime_route_before,
                            runtime_route_closed[0] != '\0' ? runtime_route_closed : "<empty>");
                  }
                }
              }
              if (strcmp(runtime_route_before, "home_sort_open") == 0) {
                int tap_x0 = replay_use_visible_bounds ? bounds.x : 0;
                int tap_y0 = replay_use_visible_bounds ? bounds.y : 0;
                int tap_w = replay_use_visible_bounds ? bounds.w : 1212;
                int tap_h = replay_use_visible_bounds ? bounds.h : 2512;
                if (tap_w <= 0) tap_w = bounds.w > 0 ? bounds.w : 1212;
                if (tap_h <= 0) tap_h = bounds.h > 0 ? bounds.h : 2512;
                int sort_y = tap_y0 + (tap_h * 78) / 1000;
                int min_x = tap_x0;
                int min_y = tap_y0;
                int max_x = tap_x0 + tap_w - 1;
                int max_y = tap_y0 + tap_h - 1;
                if (max_x < min_x) max_x = min_x;
                if (max_y < min_y) max_y = min_y;
                int dismiss_x = tap_x0 + (tap_w * 80) / 1000;
                int dismiss_y = tap_y0 + (tap_h * 160) / 1000;
                if (dismiss_x < min_x) dismiss_x = min_x;
                if (dismiss_x > max_x) dismiss_x = max_x;
                if (dismiss_y < min_y) dismiss_y = min_y;
                if (dismiss_y > max_y) dismiss_y = max_y;
                if (run_adb_tap(adb, serial, dismiss_x, dismiss_y) == 0) {
                  int close_sleep_ms =
                      env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_SORT_CLOSE_SLEEP_MS", 320);
                  if (close_sleep_ms > 0) usleep((useconds_t)close_sleep_ms * 1000u);
                  char runtime_route_closed[128];
                  runtime_route_closed[0] = '\0';
                  if (read_runtime_route_state_retry(adb,
                                                    serial,
                                                    replay_package,
                                                    runtime_route_closed,
                                                    sizeof(runtime_route_closed),
                                                    3,
                                                    120,
                                                    true)) {
                    already_ready =
                        runtime_route_ready_for_target(runtime_route_closed, route, parent_route);
                    fprintf(stdout,
                            "[capture-route-layer-android] silent sort-close-dismiss route=%s runtime_before=%s runtime_after=%s x=%d y=%d\n",
                            route != NULL ? route : "",
                            runtime_route_before,
                            runtime_route_closed[0] != '\0' ? runtime_route_closed : "<empty>",
                            dismiss_x,
                            dismiss_y);
                  }
                }
                if (sort_y < min_y) sort_y = min_y;
                if (sort_y > max_y) sort_y = max_y;
                const int sort_close_x_ppm_candidates[] = {890, 930};
                for (size_t close_try = 0u;
                     close_try < sizeof(sort_close_x_ppm_candidates) / sizeof(sort_close_x_ppm_candidates[0]) && !already_ready;
                     ++close_try) {
                  int sort_x = tap_x0 + (tap_w * sort_close_x_ppm_candidates[close_try]) / 1000;
                  if (sort_x < min_x) sort_x = min_x;
                  if (sort_x > max_x) sort_x = max_x;
                  if (run_adb_tap(adb, serial, sort_x, sort_y) == 0) {
                    int close_sleep_ms =
                        env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_SORT_CLOSE_SLEEP_MS", 320);
                    if (close_sleep_ms > 0) usleep((useconds_t)close_sleep_ms * 1000u);
                    char runtime_route_closed[128];
                    runtime_route_closed[0] = '\0';
                    if (read_runtime_route_state_retry(adb,
                                                      serial,
                                                      replay_package,
                                                      runtime_route_closed,
                                                      sizeof(runtime_route_closed),
                                                      3,
                                                      120,
                                                      true)) {
                      already_ready =
                          runtime_route_ready_for_target(runtime_route_closed, route, parent_route);
                      fprintf(stdout,
                              "[capture-route-layer-android] silent sort-close route=%s runtime_before=%s runtime_after=%s probe=%zu/%zu x_ppm=%d\n",
                              route != NULL ? route : "",
                              runtime_route_before,
                              runtime_route_closed[0] != '\0' ? runtime_route_closed : "<empty>",
                              close_try + 1u,
                              sizeof(sort_close_x_ppm_candidates) / sizeof(sort_close_x_ppm_candidates[0]),
                              sort_close_x_ppm_candidates[close_try]);
                    }
                  }
                }
              }
              if (!already_ready) {
                if (strcmp(runtime_route_before, "home_channel_manager_open") == 0) {
                  int tap_x0 = replay_use_visible_bounds ? bounds.x : 0;
                  int tap_y0 = replay_use_visible_bounds ? bounds.y : 0;
                  int tap_w = replay_use_visible_bounds ? bounds.w : 1212;
                  int tap_h = replay_use_visible_bounds ? bounds.h : 2512;
                  if (tap_w <= 0) tap_w = bounds.w > 0 ? bounds.w : 1212;
                  if (tap_h <= 0) tap_h = bounds.h > 0 ? bounds.h : 2512;
                  int close_x = tap_x0 + (tap_w * 950) / 1000;
                  int close_y = tap_y0 + (tap_h * 80) / 1000;
                  int min_x = tap_x0;
                  int min_y = tap_y0;
                  int max_x = tap_x0 + tap_w - 1;
                  int max_y = tap_y0 + tap_h - 1;
                  if (max_x < min_x) max_x = min_x;
                  if (max_y < min_y) max_y = min_y;
                  if (close_x < min_x) close_x = min_x;
                  if (close_x > max_x) close_x = max_x;
                  if (close_y < min_y) close_y = min_y;
                  if (close_y > max_y) close_y = max_y;
                  if (run_adb_tap(adb, serial, close_x, close_y) == 0) {
                    int close_sleep_ms =
                        env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_CHANNEL_CLOSE_SLEEP_MS", 360);
                    if (close_sleep_ms > 0) usleep((useconds_t)close_sleep_ms * 1000u);
                    char runtime_route_closed[128];
                    runtime_route_closed[0] = '\0';
                    if (read_runtime_route_state_retry(adb,
                                                      serial,
                                                      replay_package,
                                                      runtime_route_closed,
                                                      sizeof(runtime_route_closed),
                                                      3,
                                                      120,
                                                      true)) {
                      already_ready =
                          runtime_route_ready_for_target(runtime_route_closed, route, parent_route);
                      fprintf(stdout,
                              "[capture-route-layer-android] silent channel-close route=%s runtime_before=%s runtime_after=%s\n",
                              route != NULL ? route : "",
                              runtime_route_before,
                              runtime_route_closed[0] != '\0' ? runtime_route_closed : "<empty>");
                    }
                  }
                }
              }
              if (!already_ready) {
                if (runtime_route_before[0] != '\0' &&
                    strncmp(runtime_route_before, "publish_", 8u) == 0) {
                  int tap_x0 = replay_use_visible_bounds ? bounds.x : 0;
                  int tap_y0 = replay_use_visible_bounds ? bounds.y : 0;
                  int tap_w = replay_use_visible_bounds ? bounds.w : 1212;
                  int tap_h = replay_use_visible_bounds ? bounds.h : 2512;
                  if (tap_w <= 0) tap_w = bounds.w > 0 ? bounds.w : 1212;
                  if (tap_h <= 0) tap_h = bounds.h > 0 ? bounds.h : 2512;
                  int min_x = tap_x0;
                  int min_y = tap_y0;
                  int max_x = tap_x0 + tap_w - 1;
                  int max_y = tap_y0 + tap_h - 1;
                  if (max_x < min_x) max_x = min_x;
                  if (max_y < min_y) max_y = min_y;
                  const int dismiss_x_ppm_candidates[] = {80, 120};
                  int dismiss_y_ppm = env_positive_int_or_default_local(
                      "CHENG_ANDROID_1TO1_SILENT_PUBLISH_DISMISS_Y_PPM",
                      78);
                  if (dismiss_y_ppm > 1000) dismiss_y_ppm = 1000;
                  int dismiss_y = tap_y0 + (tap_h * dismiss_y_ppm) / 1000;
                  if (dismiss_y < min_y) dismiss_y = min_y;
                  if (dismiss_y > max_y) dismiss_y = max_y;
                  for (size_t dismiss_try = 0u;
                       dismiss_try < sizeof(dismiss_x_ppm_candidates) / sizeof(dismiss_x_ppm_candidates[0]) && !already_ready;
                       ++dismiss_try) {
                    int dismiss_x = tap_x0 + (tap_w * dismiss_x_ppm_candidates[dismiss_try]) / 1000;
                    if (dismiss_x < min_x) dismiss_x = min_x;
                    if (dismiss_x > max_x) dismiss_x = max_x;
                    if (run_adb_tap(adb, serial, dismiss_x, dismiss_y) != 0) break;
                    int dismiss_sleep_ms = env_positive_int_or_default_local(
                        "CHENG_ANDROID_1TO1_SILENT_PUBLISH_DISMISS_SLEEP_MS",
                        320);
                    if (dismiss_sleep_ms > 0) usleep((useconds_t)dismiss_sleep_ms * 1000u);
                    char runtime_route_closed[128];
                    runtime_route_closed[0] = '\0';
                    if (read_runtime_route_state_retry(adb,
                                                      serial,
                                                      replay_package,
                                                      runtime_route_closed,
                                                      sizeof(runtime_route_closed),
                                                      3,
                                                      120,
                                                      true)) {
                      already_ready =
                          runtime_route_ready_for_target(runtime_route_closed, route, parent_route);
                      fprintf(stdout,
                              "[capture-route-layer-android] silent publish-dismiss route=%s runtime_before=%s runtime_after=%s probe=%zu/%zu x_ppm=%d\n",
                              route != NULL ? route : "",
                              runtime_route_before,
                              runtime_route_closed[0] != '\0' ? runtime_route_closed : "<empty>",
                              dismiss_try + 1u,
                              sizeof(dismiss_x_ppm_candidates) / sizeof(dismiss_x_ppm_candidates[0]),
                              dismiss_x_ppm_candidates[dismiss_try]);
                    }
                  }
                }
              }
              if (!already_ready) {
                bool allow_silent_home_relaunch =
                    env_flag_enabled_local("CHENG_ANDROID_1TO1_SILENT_ALLOW_HOME_RELAUNCH", false);
                if (route != NULL &&
                    strcmp(route, "home_default") == 0 &&
                    runtime_route_before[0] != '\0' &&
                    strncmp(runtime_route_before, "tab_", 4u) == 0 &&
                    allow_silent_home_relaunch) {
                  if (run_adb_am_start_activity_with_route_soft(adb, serial, replay_activity, "home_default") == 0) {
                    int relaunch_sleep_ms = env_positive_int_or_default_local(
                        "CHENG_ANDROID_1TO1_SILENT_HOME_RELAUNCH_SLEEP_MS",
                        520);
                    if (relaunch_sleep_ms > 0) usleep((useconds_t)relaunch_sleep_ms * 1000u);
                    char runtime_route_relaunch[128];
                    runtime_route_relaunch[0] = '\0';
                    if (read_runtime_route_state_retry(adb,
                                                      serial,
                                                      replay_package,
                                                      runtime_route_relaunch,
                                                      sizeof(runtime_route_relaunch),
                                                      3,
                                                      120,
                                                      true)) {
                      already_ready =
                          runtime_route_ready_for_target(runtime_route_relaunch, route, parent_route);
                      fprintf(stdout,
                              "[capture-route-layer-android] silent home-relaunch route=%s runtime_before=%s runtime_after=%s\n",
                              route != NULL ? route : "",
                              runtime_route_before,
                              runtime_route_relaunch[0] != '\0' ? runtime_route_relaunch : "<empty>");
                    }
                  }
                }
              }
              if (!already_ready) {
                bool allow_silent_home_hard_relaunch =
                    env_flag_enabled_local("CHENG_ANDROID_1TO1_SILENT_ALLOW_HOME_HARD_RELAUNCH", false);
                if (route != NULL &&
                    strcmp(route, "home_default") == 0 &&
                    allow_silent_home_hard_relaunch) {
                  if (run_adb_am_start_activity_with_route(adb, serial, replay_activity, "home_default") == 0) {
                    int hard_relaunch_sleep_ms = env_positive_int_or_default_local(
                        "CHENG_ANDROID_1TO1_SILENT_HOME_HARD_RELAUNCH_SLEEP_MS",
                        920);
                    if (hard_relaunch_sleep_ms > 0) usleep((useconds_t)hard_relaunch_sleep_ms * 1000u);
                    char runtime_route_hard[128];
                    runtime_route_hard[0] = '\0';
                    if (read_runtime_route_state_retry(adb,
                                                      serial,
                                                      replay_package,
                                                      runtime_route_hard,
                                                      sizeof(runtime_route_hard),
                                                      4,
                                                      140,
                                                      true)) {
                      already_ready =
                          runtime_route_ready_for_target(runtime_route_hard, route, parent_route);
                      fprintf(stdout,
                              "[capture-route-layer-android] silent home-hard-relaunch route=%s runtime_after=%s\n",
                              route != NULL ? route : "",
                              runtime_route_hard[0] != '\0' ? runtime_route_hard : "<empty>");
                    }
                  }
                }
              }
              if (!already_ready) {
                int back_attempts = 0;
                const char *back_attempts_env = getenv("CHENG_ANDROID_1TO1_SILENT_HOME_BACK_ATTEMPTS");
                if (back_attempts_env != NULL && back_attempts_env[0] != '\0') {
                  char *endptr = NULL;
                  long parsed = strtol(back_attempts_env, &endptr, 10);
                  if (endptr != back_attempts_env && parsed >= 0 && parsed <= 5) back_attempts = (int)parsed;
                } else {
                  bool overlay_like_route = runtime_route_is_home_overlay_like(runtime_route_before);
                  if (overlay_like_route) back_attempts = 2;
                }
                int back_sleep_ms =
                    env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_HOME_BACK_SLEEP_MS", 180);
                for (int back_try = 0; back_try < back_attempts && !already_ready; ++back_try) {
                  if (run_adb_keyevent(adb, serial, 4) != 0) break;
                  if (back_sleep_ms > 0) usleep((useconds_t)back_sleep_ms * 1000u);
                  char fg_after_back[256];
                  fg_after_back[0] = '\0';
                  if (resolve_foreground_package_local(adb, serial, fg_after_back, sizeof(fg_after_back)) &&
                      strcmp(fg_after_back, replay_package) != 0 &&
                      (bind_foreground_package || !package_in_csv_list_local(fg_after_back, silent_allowed_packages))) {
                    fprintf(stderr,
                            "[capture-route-layer-android] silent home-back foreground drift route=%s foreground=%s expected=%s\n",
                            route != NULL ? route : "",
                            fg_after_back[0] != '\0' ? fg_after_back : "<unknown>",
                            replay_package);
                    return -1;
                  }
                  char runtime_route_back[128];
                  runtime_route_back[0] = '\0';
                  if (read_runtime_route_state_retry(adb,
                                                    serial,
                                                    replay_package,
                                                    runtime_route_back,
                                                    sizeof(runtime_route_back),
                                                    2,
                                                    120,
                                                    true)) {
                    already_ready =
                        runtime_route_ready_for_target(runtime_route_back, route, parent_route);
                  }
                }
              }
              if (!already_ready) {
                int home_tab_x_ppm =
                    env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_HOME_TAB_X_PPM", 120);
                int home_tab_y_ppm =
                    env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_HOME_TAB_Y_PPM", 965);
                if (home_tab_x_ppm > 1000) home_tab_x_ppm = 1000;
                if (home_tab_y_ppm > 1000) home_tab_y_ppm = 1000;
                int tap_x0 = replay_use_visible_bounds ? bounds.x : 0;
                int tap_y0 = replay_use_visible_bounds ? bounds.y : 0;
                int tap_w = replay_use_visible_bounds ? bounds.w : 1212;
                int tap_h = replay_use_visible_bounds ? bounds.h : 2512;
                if (tap_w <= 0) tap_w = bounds.w > 0 ? bounds.w : 1212;
                if (tap_h <= 0) tap_h = bounds.h > 0 ? bounds.h : 2512;
                int min_x = tap_x0;
                int min_y = tap_y0;
                int max_x = tap_x0 + tap_w - 1;
                int max_y = tap_y0 + tap_h - 1;
                if (max_x < min_x) max_x = min_x;
                if (max_y < min_y) max_y = min_y;
                int anchor_taps =
                    env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_HOME_ANCHOR_TAPS", 3);
                if (anchor_taps > 6) anchor_taps = 6;
                int anchor_sleep_ms =
                    env_positive_int_or_default_local("CHENG_ANDROID_1TO1_SILENT_HOME_ANCHOR_SLEEP_MS", 420);
                const int home_anchor_candidates[][2] = {
                    {home_tab_x_ppm, home_tab_y_ppm},
                    {120, 980},
                    {120, 965},
                    {140, 980},
                    {100, 980},
                    {100, 965},
                    {120, 975},
                    {120, 965},
                };
                for (size_t candidate_idx = 0u;
                     candidate_idx < sizeof(home_anchor_candidates) / sizeof(home_anchor_candidates[0]) && !already_ready;
                     ++candidate_idx) {
                  int anchor_x = tap_x0 + (tap_w * home_anchor_candidates[candidate_idx][0]) / 1000;
                  int anchor_y = tap_y0 + (tap_h * home_anchor_candidates[candidate_idx][1]) / 1000;
                  if (anchor_x < min_x) anchor_x = min_x;
                  if (anchor_x > max_x) anchor_x = max_x;
                  if (anchor_y < min_y) anchor_y = min_y;
                  if (anchor_y > max_y) anchor_y = max_y;
                  for (int anchor_try = 0; anchor_try < anchor_taps; ++anchor_try) {
                    if (run_adb_tap(adb, serial, anchor_x, anchor_y) != 0) break;
                    if (anchor_sleep_ms > 0) usleep((useconds_t)anchor_sleep_ms * 1000u);
                  }
                  char runtime_route_anchor[128];
                  runtime_route_anchor[0] = '\0';
                  if (read_runtime_route_state_retry(adb,
                                                    serial,
                                                    replay_package,
                                                    runtime_route_anchor,
                                                    sizeof(runtime_route_anchor),
                                                    3,
                                                    120,
                                                    true)) {
                    already_ready =
                        runtime_route_ready_for_target(runtime_route_anchor, route, parent_route);
                    fprintf(stdout,
                            "[capture-route-layer-android] silent home-anchor route=%s runtime_after=%s candidate=%zu/%zu x_ppm=%d y_ppm=%d\n",
                            route != NULL ? route : "",
                            runtime_route_anchor[0] != '\0' ? runtime_route_anchor : "<empty>",
                            candidate_idx + 1u,
                            sizeof(home_anchor_candidates) / sizeof(home_anchor_candidates[0]),
                            home_anchor_candidates[candidate_idx][0],
                            home_anchor_candidates[candidate_idx][1]);
                  }
                }
              }
              char runtime_route_after[128];
              runtime_route_after[0] = '\0';
              (void)read_runtime_route_state_retry(
                  adb, serial, replay_package, runtime_route_after, sizeof(runtime_route_after), 4, 140, true);
              fprintf(stdout,
                      "[capture-route-layer-android] silent home-prepare route=%s runtime_before=%s runtime_after=%s anchor_enabled=%d\n",
                      route != NULL ? route : "",
                      runtime_route_before[0] != '\0' ? runtime_route_before : "<empty>",
                      runtime_route_after[0] != '\0' ? runtime_route_after : "<empty>",
                      silent_home_anchor ? 1 : 0);
              bool settle_after_publish =
                  route != NULL &&
                  strcmp(route, "tab_nodes") == 0 &&
                  ((runtime_route_before[0] != '\0' &&
                    (strcmp(runtime_route_before, "publish_selector") == 0 ||
                     strncmp(runtime_route_before, "publish_", 8u) == 0)) ||
                   (runtime_route_after[0] != '\0' &&
                    (strcmp(runtime_route_after, "publish_selector") == 0 ||
                     strncmp(runtime_route_after, "publish_", 8u) == 0)));
              if (settle_after_publish) {
                int settle_ms = env_positive_int_or_default_local(
                    "CHENG_ANDROID_1TO1_SILENT_TAB_NODES_AFTER_PUBLISH_SETTLE_MS",
                    520);
                if (settle_ms > 0) usleep((useconds_t)settle_ms * 1000u);
                fprintf(stdout,
                        "[capture-route-layer-android] silent tab-nodes settle-after-publish sleep_ms=%d\n",
                        settle_ms);
              }
            }
          }
          fprintf(stdout,
                  "[capture-route-layer-android] silent mode skip launch_main route=%s action_index=%zu\n",
                  route != NULL ? route : "",
                  i);
          skip_runtime_probe_for_action = true;
        }
      } else {
        (void)run_adb_force_stop(adb, serial, replay_package);
        usleep(250000);
        if (run_adb_am_start_activity_with_route(adb, serial, replay_activity, launch_route) != 0) return -1;
        usleep(1200000);
      }
      (void)read_app_bounds(adb, serial, &bounds);
    } else if (action.type == ROUTE_ACTION_SLEEP_MS) {
      if (action.v0 > 0) usleep((useconds_t)action.v0 * 1000u);
    } else if (action.type == ROUTE_ACTION_TAP_PPM) {
      int tap_x0 = replay_use_visible_bounds ? bounds.x : 0;
      int tap_y0 = replay_use_visible_bounds ? bounds.y : 0;
      int tap_w = replay_use_visible_bounds ? bounds.w : 1212;
      int tap_h = replay_use_visible_bounds ? bounds.h : 2512;
      if (tap_w <= 0) tap_w = bounds.w > 0 ? bounds.w : 1212;
      if (tap_h <= 0) tap_h = bounds.h > 0 ? bounds.h : 2512;
      int x = tap_x0 + (tap_w * action.v0) / 1000;
      int y = tap_y0 + (tap_h * action.v1) / 1000;
      int min_x = tap_x0;
      int min_y = tap_y0;
      int max_x = tap_x0 + tap_w - 1;
      int max_y = tap_y0 + tap_h - 1;
      if (max_x < min_x) max_x = min_x;
      if (max_y < min_y) max_y = min_y;
      if (x < min_x) x = min_x;
      if (x > max_x) x = max_x;
      if (y < min_y) y = min_y;
      if (y > max_y) y = max_y;
        if (run_adb_tap(adb, serial, x, y) != 0) return -1;
    } else if (action.type == ROUTE_ACTION_KEYEVENT) {
      if (run_adb_keyevent(adb, serial, action.v0) != 0) return -1;
    } else {
      return -1;
    }
    if (skip_runtime_probe_for_action) continue;
    if (action.type == ROUTE_ACTION_SLEEP_MS) continue;
    if (!require_runtime_route_probe) continue;
    char runtime_route[128];
    runtime_route[0] = '\0';
    char runtime_semantic_hash[64];
    runtime_semantic_hash[0] = '\0';
    int runtime_semantic_count = 0;
    int probe_attempts = env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PROBE_ATTEMPTS", 8);
    int probe_sleep_ms = env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PROBE_SLEEP_MS", 200);
    bool require_non_empty_route = true;
    bool nav_like_target =
        (route != NULL &&
         (strncmp(route, "tab_", 4u) == 0 || strcmp(route, "publish_selector") == 0));
    if (nav_like_target && action.type == ROUTE_ACTION_TAP_PPM) {
      if (probe_attempts < 14) probe_attempts = 14;
      if (probe_sleep_ms < 220) probe_sleep_ms = 220;
    }
    if (action.type == ROUTE_ACTION_LAUNCH_MAIN) {
      probe_attempts = env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_PROBE_ATTEMPTS", 8);
      probe_sleep_ms = env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_PROBE_SLEEP_MS", 250);
      require_non_empty_route = true;
    }
    if (!read_runtime_route_semantic_state_retry(adb,
                                                 serial,
                                                 replay_package,
                                                 runtime_route,
                                                 sizeof(runtime_route),
                                                 runtime_semantic_hash,
                                                 sizeof(runtime_semantic_hash),
                                                 &runtime_semantic_count,
                                                 probe_attempts,
                                                 probe_sleep_ms,
                                                 require_non_empty_route)) {
      fprintf(stderr,
              "[capture-route-layer-android] runtime route probe failed route=%s action_index=%zu action_type=%s attempts=%d sleep_ms=%d no_foreground_switch=%d pkg=%s\n",
              route,
              i,
              route_action_type_name(action.type),
              probe_attempts,
              probe_sleep_ms,
              no_foreground_switch ? 1 : 0,
              replay_package != NULL ? replay_package : "<none>");
      return -1;
    }
    bool semantic_match = true;
    bool semantic_match_relaxed = false;
    if (semantic_target_required) {
      bool route_match_now = runtime_route_matches_expected(runtime_route, route);
      semantic_match = semantic_hash_match_or_relaxed_for_route(replay_package,
                                                                route,
                                                                runtime_route,
                                                                runtime_semantic_hash,
                                                                runtime_semantic_count,
                                                                semantic_expected_hash,
                                                                semantic_expected_count,
                                                                route_match_now,
                                                                &semantic_match_relaxed);
      fprintf(stdout,
              "[capture-route-layer-android] runtime route probe route=%s action_index=%zu action_type=%s runtime_route=%s semantic_hash=%s semantic_count=%d semantic_expect=%s/%d match=%s relaxed=%d\n",
              route,
              i,
              route_action_type_name(action.type),
              runtime_route,
              runtime_semantic_hash[0] != '\0' ? runtime_semantic_hash : "<empty>",
              runtime_semantic_count,
              semantic_expected_hash,
              semantic_expected_count,
              semantic_match ? "1" : "0",
              semantic_match_relaxed ? 1 : 0);
    } else {
      fprintf(stdout,
              "[capture-route-layer-android] runtime route probe route=%s action_index=%zu action_type=%s runtime_route=%s\n",
              route,
              i,
              route_action_type_name(action.type),
              runtime_route);
    }
    if (runtime_route_matches_expected(runtime_route, route) && semantic_match) {
      route_hit = true;
      route_hit_action_index = i;
      if (semantic_target_required) {
        fprintf(stdout,
                "[capture-route-layer-android] runtime route semantic-target-hit route=%s action_index=%zu action_type=%s runtime_route=%s semantic_hash=%s\n",
                route,
                i,
                route_action_type_name(action.type),
                runtime_route,
                runtime_semantic_hash);
        bool require_stable_semantic_hit =
            env_flag_enabled_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_REQUIRE_STABLE_HIT", true);
        bool stable_hit_route =
            (route != NULL &&
             (strcmp(route, "publish_selector") == 0 || strncmp(route, "tab_", 4u) == 0));
        if (!stable_hit_route) {
          require_stable_semantic_hit = false;
        }
        if (require_stable_semantic_hit) {
          int stable_samples = env_positive_int_or_default_local(
              "CHENG_ANDROID_1TO1_ROUTE_REPLAY_STABLE_HIT_SAMPLES",
              5);
          int stable_sleep_ms = env_positive_int_or_default_local(
              "CHENG_ANDROID_1TO1_ROUTE_REPLAY_STABLE_HIT_SLEEP_MS",
              200);
          if (stable_samples > 12) stable_samples = 12;
          if (stable_sleep_ms > 1200) stable_sleep_ms = 1200;
          bool stable_ok = true;
          bool unstable_probe_ok = false;
          bool unstable_semantic_match = false;
          char unstable_route[128];
          unstable_route[0] = '\0';
          char unstable_semantic_hash[64];
          unstable_semantic_hash[0] = '\0';
          int unstable_semantic_count = 0;
          for (int sample_idx = 0; sample_idx < stable_samples; ++sample_idx) {
            if (sample_idx > 0 && stable_sleep_ms > 0) {
              usleep((useconds_t)stable_sleep_ms * 1000u);
            }
            char stable_route[128];
            stable_route[0] = '\0';
            char stable_semantic_hash[64];
            stable_semantic_hash[0] = '\0';
            int stable_semantic_count = 0;
            bool stable_probe_ok = read_runtime_route_semantic_state_retry(adb,
                                                                           serial,
                                                                           replay_package,
                                                                           stable_route,
                                                                           sizeof(stable_route),
                                                                           stable_semantic_hash,
                                                                           sizeof(stable_semantic_hash),
                                                                           &stable_semantic_count,
                                                                           1,
                                                                           0,
                                                                           true);
            bool stable_route_match = stable_probe_ok && runtime_route_matches_expected(stable_route, route);
            bool stable_semantic_match = false;
            bool stable_semantic_relaxed = false;
            if (stable_probe_ok) {
              stable_semantic_match =
                  semantic_hash_match_or_relaxed_for_route(replay_package,
                                                           route,
                                                           stable_route,
                                                           stable_semantic_hash,
                                                           stable_semantic_count,
                                                           semantic_expected_hash,
                                                           semantic_expected_count,
                                                           stable_route_match,
                                                           &stable_semantic_relaxed);
            }
            if (!stable_probe_ok || !stable_route_match || !stable_semantic_match) {
              stable_ok = false;
              unstable_probe_ok = stable_probe_ok;
              unstable_semantic_match = stable_semantic_match;
              snprintf(unstable_route, sizeof(unstable_route), "%s", stable_route);
              snprintf(unstable_semantic_hash, sizeof(unstable_semantic_hash), "%s", stable_semantic_hash);
              unstable_semantic_count = stable_semantic_count;
              break;
            }
          }
          if (!stable_ok) {
            route_hit = false;
            route_hit_action_index = (size_t)-1;
            fprintf(stdout,
                    "[capture-route-layer-android] runtime route semantic-target-unstable route=%s action_index=%zu stable_probe=%d stable_route=%s stable_hash=%s stable_count=%d stable_match=%d samples=%d sleep_ms=%d; continue replay\n",
                    route,
                    i,
                    unstable_probe_ok ? 1 : 0,
                    unstable_route[0] != '\0' ? unstable_route : "<empty>",
                    unstable_semantic_hash[0] != '\0' ? unstable_semantic_hash : "<empty>",
                    unstable_semantic_count,
                    unstable_semantic_match ? 1 : 0,
                    stable_samples,
                    stable_sleep_ms);
            continue;
          }
        }
        if (semantic_target_short_circuit) break;
      } else {
        fprintf(stdout,
                "[capture-route-layer-android] runtime route target-hit route=%s action_index=%zu action_type=%s runtime_route=%s\n",
                route,
                i,
                route_action_type_name(action.type),
                runtime_route);
      }
      if (allow_route_hit_short_circuit) break;
      continue;
    } else {
      bool transitional_ok = runtime_route_matches_expected(runtime_route, route);
      if (!transitional_ok && parent_route != NULL && parent_route[0] != '\0') {
        transitional_ok = runtime_route_matches_expected(runtime_route, parent_route);
      }
      if (!transitional_ok) {
        transitional_ok = (strcmp(runtime_route, "home_default") == 0);
      }
      if (!transitional_ok && runtime_route[0] != '\0') {
        bool expect_home_family =
            (route != NULL && strcmp(route, "home_default") == 0) ||
            (parent_route != NULL && parent_route[0] != '\0' && strcmp(parent_route, "home_default") == 0);
        if (expect_home_family) {
          if (strncmp(runtime_route, "tab_", 4u) == 0 ||
              strncmp(runtime_route, "home_", 5u) == 0 ||
              strcmp(runtime_route, "publish_selector") == 0) {
            transitional_ok = true;
          } else {
            const char *runtime_equivalent = semantic_equivalent_runtime_route(runtime_route);
            if (runtime_equivalent != NULL && strcmp(runtime_equivalent, "home_default") == 0) {
              transitional_ok = true;
            }
          }
        }
      }
      if (!transitional_ok) {
        const char *runtime_equivalent = semantic_equivalent_runtime_route(runtime_route);
        const char *target_equivalent = semantic_equivalent_runtime_route(route);
        if (runtime_equivalent != NULL && runtime_equivalent[0] != '\0' &&
            target_equivalent != NULL && target_equivalent[0] != '\0' &&
            strcmp(runtime_equivalent, target_equivalent) == 0) {
          transitional_ok = true;
        }
      }
      if (!transitional_ok) {
        if (no_foreground_switch &&
            route != NULL &&
            strcmp(route, "home_default") == 0 &&
            action.type == ROUTE_ACTION_TAP_PPM) {
          fprintf(stdout,
                  "[capture-route-layer-android] tolerate transitional route during home-default convergence runtime_route=%s action_index=%zu\n",
                  runtime_route[0] != '\0' ? runtime_route : "<empty>",
                  i);
          continue;
        }
        if (no_foreground_switch && action.type == ROUTE_ACTION_LAUNCH_MAIN) {
          char foreground_pkg[256];
          foreground_pkg[0] = '\0';
          (void)resolve_foreground_package_local(adb, serial, foreground_pkg, sizeof(foreground_pkg));
          fprintf(stdout,
                  "[capture-route-layer-android] silent precondition unmet route=%s runtime_route=%s expected_parent=%s foreground=%s; continue with action replay\n",
                  route,
                  runtime_route[0] != '\0' ? runtime_route : "<empty>",
                  (parent_route != NULL && parent_route[0] != '\0') ? parent_route : "<none>",
                  foreground_pkg[0] != '\0' ? foreground_pkg : "<unknown>");
          continue;
        }
        fprintf(stderr,
                "[capture-route-layer-android] runtime route transitional mismatch route=%s action_index=%zu action_type=%s runtime_route=%s parent=%s\n",
                route,
                i,
                route_action_type_name(action.type),
                runtime_route,
                (parent_route != NULL && parent_route[0] != '\0') ? parent_route : "<none>");
        return -1;
      }
    }
  }
  if (require_runtime_route_probe && !route_hit) {
    char runtime_route_final[128];
    runtime_route_final[0] = '\0';
    char runtime_semantic_hash_final[64];
    runtime_semantic_hash_final[0] = '\0';
    int runtime_semantic_count_final = 0;
    int final_probe_attempts =
        env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_FINAL_PROBE_ATTEMPTS", 8);
    int final_probe_sleep_ms =
        env_positive_int_or_default_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_FINAL_PROBE_SLEEP_MS", 220);
    bool final_probe_ok = read_runtime_route_semantic_state_retry(adb,
                                                                  serial,
                                                                  replay_package,
                                                                  runtime_route_final,
                                                                  sizeof(runtime_route_final),
                                                                  runtime_semantic_hash_final,
                                                                  sizeof(runtime_semantic_hash_final),
                                                                  &runtime_semantic_count_final,
                                                                  final_probe_attempts,
                                                                  final_probe_sleep_ms,
                                                                  true);
    bool final_route_match = final_probe_ok && runtime_route_matches_expected(runtime_route_final, route);
    bool final_semantic_match = true;
    bool final_semantic_relaxed = false;
    if (final_probe_ok && semantic_target_required) {
      final_semantic_match =
          semantic_hash_match_or_relaxed_for_route(replay_package,
                                                   route,
                                                   runtime_route_final,
                                                   runtime_semantic_hash_final,
                                                   runtime_semantic_count_final,
                                                   semantic_expected_hash,
                                                   semantic_expected_count,
                                                   final_route_match,
                                                   &final_semantic_relaxed);
      if (final_semantic_match && final_semantic_relaxed) {
        fprintf(stdout,
                "[capture-route-layer-android] runtime semantic hash relaxed route=%s runtime_route=%s semantic_hash=%s expected_hash=%s\n",
                route,
                runtime_route_final[0] != '\0' ? runtime_route_final : "<empty>",
                runtime_semantic_hash_final[0] != '\0' ? runtime_semantic_hash_final : "<empty>",
                semantic_expected_hash);
      }
    }
    bool defer_runtime_route_match_to_semantic =
        no_foreground_switch &&
        env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_DEFER_ROUTE_MATCH_TO_SEMANTIC", true);
    if (!final_probe_ok || !final_route_match || !final_semantic_match) {
      if (final_probe_ok && defer_runtime_route_match_to_semantic && semantic_target_required && final_semantic_match) {
        route_hit = true;
        fprintf(stdout,
                "[capture-route-layer-android] runtime route mismatch deferred-to-semantic route=%s runtime_route_final=%s\n",
                route,
                runtime_route_final[0] != '\0' ? runtime_route_final : "<empty>");
      } else {
        bool nav_fallback_hit = false;
        bool allow_nav_fallback =
            no_foreground_switch &&
            route != NULL &&
            route[0] != '\0' &&
            (strncmp(route, "tab_", 4u) == 0 || strcmp(route, "publish_selector") == 0);
        if (allow_nav_fallback) {
          size_t fallback_candidate = 0u;
          char fallback_route[128];
          fallback_route[0] = '\0';
          fprintf(stdout,
                  "[capture-route-layer-android] nav-fallback-probe begin route=%s runtime_route_final=%s\n",
                  route,
                  runtime_route_final[0] != '\0' ? runtime_route_final : "<empty>");
          nav_fallback_hit = try_nav_route_probe_fallback_local(adb,
                                                                serial,
                                                                route,
                                                                replay_package,
                                                                replay_use_visible_bounds,
                                                                &bounds,
                                                                fallback_route,
                                                                sizeof(fallback_route),
                                                                &fallback_candidate);
          if (nav_fallback_hit) {
            bool fallback_semantic_ok = true;
            bool fallback_semantic_relaxed = false;
            if (semantic_target_required) {
              char fallback_route_verified[128];
              fallback_route_verified[0] = '\0';
              char fallback_semantic_hash[64];
              fallback_semantic_hash[0] = '\0';
              int fallback_semantic_count = 0;
              bool fallback_probe_ok = read_runtime_route_semantic_state_retry(adb,
                                                                               serial,
                                                                               replay_package,
                                                                               fallback_route_verified,
                                                                               sizeof(fallback_route_verified),
                                                                               fallback_semantic_hash,
                                                                               sizeof(fallback_semantic_hash),
                                                                               &fallback_semantic_count,
                                                                               4,
                                                                               220,
                                                                               true);
              if (!fallback_probe_ok ||
                  !runtime_route_matches_expected(fallback_route_verified, route)) {
                fallback_semantic_ok = false;
              } else {
                fallback_semantic_ok =
                    semantic_hash_match_or_relaxed_for_route(replay_package,
                                                             route,
                                                             fallback_route_verified,
                                                             fallback_semantic_hash,
                                                             fallback_semantic_count,
                                                             semantic_expected_hash,
                                                             semantic_expected_count,
                                                             true,
                                                             &fallback_semantic_relaxed);
                if (fallback_route_verified[0] != '\0') {
                  snprintf(fallback_route, sizeof(fallback_route), "%s", fallback_route_verified);
                }
              }
              if (!fallback_semantic_ok) {
                fprintf(stdout,
                        "[capture-route-layer-android] nav-fallback-semantic-miss route=%s candidate=%zu runtime_route=%s semantic_hash=%s expected_hash=%s expected_count=%d\n",
                        route,
                        fallback_candidate + 1u,
                        fallback_route[0] != '\0' ? fallback_route : "<empty>",
                        fallback_semantic_hash[0] != '\0' ? fallback_semantic_hash : "<empty>",
                        semantic_expected_hash,
                        semantic_expected_count);
                nav_fallback_hit = false;
              } else if (fallback_semantic_relaxed) {
                fprintf(stdout,
                        "[capture-route-layer-android] nav-fallback semantic hash relaxed route=%s candidate=%zu runtime_route=%s\n",
                        route,
                        fallback_candidate + 1u,
                        fallback_route[0] != '\0' ? fallback_route : "<empty>");
              }
            }
            if (nav_fallback_hit) {
              route_hit = true;
              route_hit_action_index = (actions != NULL && actions->len > 0u) ? (actions->len - 1u) : 0u;
              fprintf(stdout,
                      "[capture-route-layer-android] nav-fallback-hit route=%s candidate=%zu runtime_route=%s\n",
                      route,
                      fallback_candidate + 1u,
                      fallback_route[0] != '\0' ? fallback_route : "<empty>");
            }
          } else {
            fprintf(stdout,
                    "[capture-route-layer-android] nav-fallback-probe miss route=%s runtime_route_final=%s\n",
                    route,
                    fallback_route[0] != '\0' ? fallback_route : "<empty>");
          }
        }
        if (!nav_fallback_hit) {
          if (semantic_target_required) {
            fprintf(stderr,
                    "[capture-route-layer-android] runtime route semantic-target miss route=%s runtime_route_final=%s semantic_hash=%s semantic_count=%d expected_hash=%s expected_count=%d\n",
                    route,
                    runtime_route_final[0] != '\0' ? runtime_route_final : "<empty>",
                    runtime_semantic_hash_final[0] != '\0' ? runtime_semantic_hash_final : "<empty>",
                    runtime_semantic_count_final,
                    semantic_expected_hash,
                    semantic_expected_count);
          } else {
            fprintf(stderr,
                    "[capture-route-layer-android] runtime route never reached target route=%s hit=0 runtime_route_final=%s\n",
                    route,
                    runtime_route_final[0] != '\0' ? runtime_route_final : "<empty>");
          }
          return -1;
        }
      }
    }
    if (!route_hit) {
      route_hit = true;
      route_hit_action_index = (actions != NULL && actions->len > 0u) ? (actions->len - 1u) : 0u;
    } else if (route_hit_action_index == (size_t)-1) {
      route_hit_action_index = (actions != NULL && actions->len > 0u) ? (actions->len - 1u) : 0u;
    }
  }
  if (route_hit) {
    fprintf(stdout,
            "[capture-route-layer-android] replay target route reached route=%s action_index=%zu\n",
            route,
            route_hit_action_index);
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

static bool load_route_semantic_expectation_local(const char *route_semantic_tree_path,
                                                  const char *route,
                                                  char *out_hash,
                                                  size_t out_hash_cap,
                                                  int *out_count) {
  if (out_hash != NULL && out_hash_cap > 0u) out_hash[0] = '\0';
  if (out_count != NULL) *out_count = 0;
  if (route_semantic_tree_path == NULL || route_semantic_tree_path[0] == '\0' ||
      route == NULL || route[0] == '\0' ||
      out_hash == NULL || out_hash_cap == 0u || out_count == NULL) {
    return false;
  }
  size_t doc_len = 0u;
  char *doc = read_file_all_local(route_semantic_tree_path, &doc_len);
  if (doc == NULL || doc_len == 0u) {
    free(doc);
    return false;
  }
  char route_pat[192];
  if (snprintf(route_pat, sizeof(route_pat), "\"route\":\"%s\"", route) >= (int)sizeof(route_pat)) {
    free(doc);
    return false;
  }
  const char *route_hit = strstr(doc, route_pat);
  if (route_hit == NULL) {
    free(doc);
    return false;
  }
  const char *obj_start = route_hit;
  while (obj_start > doc && *obj_start != '{') obj_start -= 1;
  if (*obj_start != '{') {
    free(doc);
    return false;
  }
  const char *obj_end = strchr(route_hit, '}');
  if (obj_end == NULL || obj_end <= obj_start) {
    free(doc);
    return false;
  }
  obj_end += 1;
  const char *hash_value = find_key_value_local(obj_start, obj_end, "subtree_hash");
  if (hash_value == NULL || *hash_value != '"' ||
      !parse_json_string_local(hash_value, out_hash, out_hash_cap, NULL)) {
    free(doc);
    return false;
  }
  int count = 0;
  if (!parse_int_field_local(obj_start, obj_end, "subtree_node_count", &count) || count <= 0) {
    free(doc);
    return false;
  }
  *out_count = count;
  free(doc);
  return true;
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
          "  capture_route_layer_android --layer-index <n> [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--compile-out <abs>] [--truth-dir <abs>] [--serial <id>] [--first-install-pass 0|1] [--no-foreground-switch 0|1] [--routes-csv <a,b,c>] [--routes-file <path>]\n");
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
  const char *routes_csv = getenv("CHENG_CAPTURE_ROUTE_LAYER_ROUTES_CSV");
  const char *routes_file = getenv("CHENG_CAPTURE_ROUTE_LAYER_ROUTES_FILE");
  int layer_index = -1;
  int first_install_pass = 0;
  int no_foreground_switch_cli = -1;
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
    if (strcmp(arg, "--routes-csv") == 0) {
      if (i + 1 >= argc) return 2;
      routes_csv = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--routes-file") == 0) {
      if (i + 1 >= argc) return 2;
      routes_file = argv[i + 1];
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
    if (strcmp(arg, "--no-foreground-switch") == 0) {
      if (i + 1 >= argc) return 2;
      no_foreground_switch_cli = (strcmp(argv[i + 1], "0") == 0) ? 0 : 1;
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
  bool no_foreground_switch = true;
  if (no_foreground_switch_cli == 0) {
    fprintf(stderr,
            "[capture-route-layer-android] foreground switching is forbidden; --no-foreground-switch must be 1\n");
    return 2;
  }
  const char *no_foreground_env = getenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH");
  if (no_foreground_env != NULL && no_foreground_env[0] != '\0' && strcmp(no_foreground_env, "0") == 0) {
    fprintf(stdout,
            "[capture-route-layer-android] override CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH=1 (foreground switching forbidden)\n");
  }
  setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", "1", 1);
  bool allow_foreground_recover =
      env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_ALLOW_FOREGROUND_RECOVER", false);
  bool allow_overlay_foreground =
      env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_ALLOW_OVERLAY_FOREGROUND", false);

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

  if (no_foreground_switch) {
    char adb_precheck[PATH_MAX];
    char serial_precheck[128];
    if (!resolve_adb(adb_precheck, sizeof(adb_precheck)) ||
        !resolve_android_serial(adb_precheck, serial_opt, serial_precheck, sizeof(serial_precheck))) {
      fprintf(stderr, "[capture-route-layer-android] failed to resolve adb/serial (precheck)\n");
      return 1;
    }
    const char *runtime_pkg_precheck = getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_PACKAGE");
    if (runtime_pkg_precheck == NULL || runtime_pkg_precheck[0] == '\0') {
      runtime_pkg_precheck = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE");
    }
    if (runtime_pkg_precheck == NULL || runtime_pkg_precheck[0] == '\0') {
      runtime_pkg_precheck = getenv("CHENG_ANDROID_APP_PACKAGE");
    }
    if (runtime_pkg_precheck == NULL || runtime_pkg_precheck[0] == '\0') {
      runtime_pkg_precheck = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
    }
    if (runtime_pkg_precheck == NULL || runtime_pkg_precheck[0] == '\0') {
      runtime_pkg_precheck = "com.unimaker.app";
    }
    const char *expected_pkg_list_precheck = getenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGES");
    if (expected_pkg_list_precheck == NULL || expected_pkg_list_precheck[0] == '\0') {
      expected_pkg_list_precheck = getenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGE");
    }
    if (expected_pkg_list_precheck == NULL || expected_pkg_list_precheck[0] == '\0') {
      expected_pkg_list_precheck = runtime_pkg_precheck;
    }
    char runtime_activity_precheck_buf[192];
    runtime_activity_precheck_buf[0] = '\0';
    const char *runtime_activity_precheck = getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_ACTIVITY");
    if (runtime_activity_precheck == NULL || runtime_activity_precheck[0] == '\0') {
      runtime_activity_precheck = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
    }
    if (runtime_activity_precheck == NULL || runtime_activity_precheck[0] == '\0') {
      runtime_activity_precheck = getenv("CHENG_ANDROID_APP_ACTIVITY");
    }
    if (runtime_activity_precheck == NULL || runtime_activity_precheck[0] == '\0') {
      runtime_activity_precheck = getenv("CHENG_ANDROID_EQ_APP_ACTIVITY");
    }
    if (runtime_activity_precheck == NULL || runtime_activity_precheck[0] == '\0') {
      runtime_activity_precheck = infer_main_activity_for_package_local(
          runtime_pkg_precheck,
          runtime_activity_precheck_buf,
          sizeof(runtime_activity_precheck_buf));
    }
    char foreground_precheck[256];
    foreground_precheck[0] = '\0';
    if (!resolve_foreground_package_local(
            adb_precheck, serial_precheck, foreground_precheck, sizeof(foreground_precheck)) ||
        foreground_precheck[0] == '\0') {
      fprintf(stderr,
              "[capture-route-layer-android] silent precheck failed: cannot resolve foreground package before compile\n");
      return 1;
    }
    if (!package_in_csv_list_local(foreground_precheck, expected_pkg_list_precheck)) {
      int precheck_wait_attempts = env_positive_int_or_default_local(
          "CHENG_CAPTURE_ROUTE_LAYER_SILENT_PRECHECK_WAIT_ATTEMPTS",
          24);
      int precheck_wait_sleep_ms = env_positive_int_or_default_local(
          "CHENG_CAPTURE_ROUTE_LAYER_SILENT_PRECHECK_WAIT_SLEEP_MS",
          400);
      if (precheck_wait_attempts > 60) precheck_wait_attempts = 60;
      if (precheck_wait_sleep_ms > 2000) precheck_wait_sleep_ms = 2000;
      bool waited_ready = wait_foreground_package_in_list_local(adb_precheck,
                                                                serial_precheck,
                                                                expected_pkg_list_precheck,
                                                                precheck_wait_attempts,
                                                                precheck_wait_sleep_ms,
                                                                foreground_precheck,
                                                                sizeof(foreground_precheck));
      if (waited_ready) {
        fprintf(stdout,
                "[capture-route-layer-android] silent precheck foreground ready after wait foreground=%s expected_any_of=%s attempts=%d sleep_ms=%d\n",
                foreground_precheck,
                expected_pkg_list_precheck,
                precheck_wait_attempts,
                precheck_wait_sleep_ms);
      } else {
        if (!allow_foreground_recover) {
          fprintf(stderr,
                  "[capture-route-layer-android] silent precheck failed foreground=%s expected_any_of=%s; foreground recovery disabled, bring expected app to foreground manually and retry\n",
                  foreground_precheck,
                  expected_pkg_list_precheck);
          return 1;
        }
        bool recovered = try_recover_foreground_package_local(adb_precheck,
                                                              serial_precheck,
                                                              runtime_pkg_precheck,
                                                              runtime_activity_precheck,
                                                              "home_default",
                                                              "precheck-before-compile",
                                                              foreground_precheck);
        if (recovered &&
            resolve_foreground_package_local(
                adb_precheck, serial_precheck, foreground_precheck, sizeof(foreground_precheck)) &&
            foreground_precheck[0] != '\0' &&
            package_in_csv_list_local(foreground_precheck, expected_pkg_list_precheck)) {
          fprintf(stdout,
                  "[capture-route-layer-android] silent precheck recovered foreground=%s expected_any_of=%s\n",
                  foreground_precheck,
                  expected_pkg_list_precheck);
        } else {
          fprintf(stderr,
                  "[capture-route-layer-android] silent precheck failed foreground=%s expected_any_of=%s; bring expected app to foreground manually and confirm before retry\n",
                  foreground_precheck,
                  expected_pkg_list_precheck);
          return 1;
        }
      }
    }
  }

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
  char route_tree_json[PATH_MAX];
  if (nr_path_join(route_tree_json, sizeof(route_tree_json), compile_out, "r2capp/r2c_route_tree.json") != 0 ||
      !nr_file_exists(route_tree_json)) {
    fprintf(stderr, "[capture-route-layer-android] missing route tree json: %s\n", route_tree_json);
    return 1;
  }
  char route_semantic_tree_json[PATH_MAX];
  if (nr_path_join(route_semantic_tree_json,
                   sizeof(route_semantic_tree_json),
                   compile_out,
                   "r2capp/r2c_route_semantic_tree.json") != 0 ||
      !nr_file_exists(route_semantic_tree_json)) {
    fprintf(stderr,
            "[capture-route-layer-android] missing route semantic tree json: %s\n",
            route_semantic_tree_json);
    return 1;
  }
  char compile_report_json[PATH_MAX];
  if (nr_path_join(
          compile_report_json, sizeof(compile_report_json), compile_out, "r2capp/r2capp_compile_report.json") != 0 ||
      !nr_file_exists(compile_report_json)) {
    fprintf(stderr,
            "[capture-route-layer-android] missing compile report json: %s\n",
            compile_report_json);
    return 1;
  }
  char gate_truth_seed_dir[PATH_MAX];
  snprintf(gate_truth_seed_dir, sizeof(gate_truth_seed_dir), "%s", truth_dir);
  {
    char compile_truth_dir[PATH_MAX];
    const char *use_compile_truth_seed_env = getenv("CHENG_CAPTURE_ROUTE_LAYER_USE_COMPILE_TRUTH_SEED");
    bool use_compile_truth_seed = (use_compile_truth_seed_env != NULL &&
                                   use_compile_truth_seed_env[0] != '\0' &&
                                   strcmp(use_compile_truth_seed_env, "0") != 0);
    if (use_compile_truth_seed &&
        nr_path_join(compile_truth_dir, sizeof(compile_truth_dir), compile_out, "r2capp/truth") == 0 &&
        nr_dir_exists(compile_truth_dir)) {
      snprintf(gate_truth_seed_dir, sizeof(gate_truth_seed_dir), "%s", compile_truth_dir);
    }
  }
  char gate_out_abs[PATH_MAX];
  bool gate_skip_compile = false;
  snprintf(gate_out_abs, sizeof(gate_out_abs), "%s", out_abs);
  {
    const char *suffix = "/claude_compile";
    size_t compile_n = strlen(compile_out);
    size_t suffix_n = strlen(suffix);
    if (compile_n > suffix_n && strcmp(compile_out + compile_n - suffix_n, suffix) == 0) {
      size_t base_n = compile_n - suffix_n;
      if (base_n > 0u && base_n < sizeof(gate_out_abs)) {
        memcpy(gate_out_abs, compile_out, base_n);
        gate_out_abs[base_n] = '\0';
        gate_skip_compile = true;
      }
    }
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
  StringList route_filter;
  memset(&route_filter, 0, sizeof(route_filter));
  if (load_route_filter_list(routes_csv, routes_file, &route_filter) != 0) {
    fprintf(stderr,
            "[capture-route-layer-android] failed to load route filter routes-csv/routes-file (file=%s)\n",
            routes_file != NULL ? routes_file : "");
    strlist_free(&routes);
    return 2;
  }
  if (route_filter.len > 0u) {
    size_t before = routes.len;
    size_t unmatched = 0u;
    for (size_t i = 0u; i < route_filter.len; ++i) {
      if (!strlist_contains(&routes, route_filter.items[i])) unmatched += 1u;
    }
    StringList filtered;
    memset(&filtered, 0, sizeof(filtered));
    for (size_t i = 0u; i < route_filter.len; ++i) {
      const char *route = route_filter.items[i];
      if (route == NULL || route[0] == '\0' || !strlist_contains(&routes, route)) continue;
      if (strlist_contains(&filtered, route)) continue;
      if (strlist_push(&filtered, route) != 0) {
          strlist_free(&filtered);
          strlist_free(&route_filter);
          strlist_free(&routes);
          return 1;
      }
    }
    if (filtered.len == 0u) {
      fprintf(stderr,
              "[capture-route-layer-android] route filter matched zero states in layer=%d (requested=%zu)\n",
              layer_index,
              route_filter.len);
      strlist_free(&filtered);
      strlist_free(&route_filter);
      strlist_free(&routes);
      return 2;
    }
    strlist_free(&routes);
    routes = filtered;
    fprintf(stdout,
            "[capture-route-layer-android] route filter applied layer=%d kept=%zu dropped=%zu unmatched=%zu\n",
            layer_index,
            routes.len,
            before - routes.len,
            unmatched);
  }
  bool has_explicit_route_filter = route_filter.len > 0u;
  strlist_free(&route_filter);

  char adb[PATH_MAX];
  char serial[128];
  if (!resolve_adb(adb, sizeof(adb)) || !resolve_android_serial(adb, serial_opt, serial, sizeof(serial))) {
    fprintf(stderr, "[capture-route-layer-android] failed to resolve adb/serial\n");
    strlist_free(&routes);
    return 1;
  }
  const char *runtime_pkg_hint = getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_PACKAGE");
  if (runtime_pkg_hint == NULL || runtime_pkg_hint[0] == '\0') {
    runtime_pkg_hint = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE");
  }
  if (runtime_pkg_hint == NULL || runtime_pkg_hint[0] == '\0') {
    runtime_pkg_hint = getenv("CHENG_ANDROID_APP_PACKAGE");
  }
  if (runtime_pkg_hint == NULL || runtime_pkg_hint[0] == '\0') {
    runtime_pkg_hint = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
  }
  if (runtime_pkg_hint == NULL || runtime_pkg_hint[0] == '\0') {
    runtime_pkg_hint = "com.unimaker.app";
  }
  if (apply_layer1_stable_allowlist_inplace_local(&routes,
                                                   layer_index,
                                                   runtime_pkg_hint,
                                                   has_explicit_route_filter) != 0) {
    fprintf(stderr, "[capture-route-layer-android] failed to apply layer1 stable allowlist\n");
    strlist_free(&routes);
    return 1;
  }
  if (apply_layer_route_skip_inplace_local(&routes, layer_index, runtime_pkg_hint) != 0) {
    fprintf(stderr, "[capture-route-layer-android] failed to apply flexible route skip list\n");
    strlist_free(&routes);
    return 1;
  }
  if (routes.len == 0u) {
    fprintf(stderr,
            "[capture-route-layer-android] no routes left after flexible skip layer=%d\n",
            layer_index);
    strlist_free(&routes);
    return 2;
  }

  const char *silent_expected_pkg_list = getenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGES");
  if (silent_expected_pkg_list == NULL || silent_expected_pkg_list[0] == '\0') {
    silent_expected_pkg_list = getenv("CHENG_ANDROID_1TO1_SILENT_FOREGROUND_PACKAGE");
  }
  if (silent_expected_pkg_list == NULL || silent_expected_pkg_list[0] == '\0') {
    silent_expected_pkg_list = runtime_pkg_hint;
  }
  char runtime_activity_precheck_buf2[192];
  runtime_activity_precheck_buf2[0] = '\0';
  const char *runtime_activity_precheck2 = getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_ACTIVITY");
  if (runtime_activity_precheck2 == NULL || runtime_activity_precheck2[0] == '\0') {
    runtime_activity_precheck2 = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
  }
  if (runtime_activity_precheck2 == NULL || runtime_activity_precheck2[0] == '\0') {
    runtime_activity_precheck2 = getenv("CHENG_ANDROID_APP_ACTIVITY");
  }
  if (runtime_activity_precheck2 == NULL || runtime_activity_precheck2[0] == '\0') {
    runtime_activity_precheck2 = getenv("CHENG_ANDROID_EQ_APP_ACTIVITY");
  }
  if (runtime_activity_precheck2 == NULL || runtime_activity_precheck2[0] == '\0') {
    runtime_activity_precheck2 = infer_main_activity_for_package_local(
        runtime_pkg_hint,
        runtime_activity_precheck_buf2,
        sizeof(runtime_activity_precheck_buf2));
  }
  char precheck_foreground_pkg[256];
  precheck_foreground_pkg[0] = '\0';
  if (no_foreground_switch) {
    if (!resolve_foreground_package_local(adb, serial, precheck_foreground_pkg, sizeof(precheck_foreground_pkg))) {
      fprintf(stderr,
              "[capture-route-layer-android] silent precheck failed: cannot resolve foreground package; no foreground switch will be performed\n");
      strlist_free(&routes);
      return 1;
    }
    if (!package_in_csv_list_local(precheck_foreground_pkg, silent_expected_pkg_list)) {
      int precheck_wait_attempts = env_positive_int_or_default_local(
          "CHENG_CAPTURE_ROUTE_LAYER_SILENT_PRECHECK_WAIT_ATTEMPTS",
          24);
      int precheck_wait_sleep_ms = env_positive_int_or_default_local(
          "CHENG_CAPTURE_ROUTE_LAYER_SILENT_PRECHECK_WAIT_SLEEP_MS",
          400);
      if (precheck_wait_attempts > 60) precheck_wait_attempts = 60;
      if (precheck_wait_sleep_ms > 2000) precheck_wait_sleep_ms = 2000;
      bool waited_ready = wait_foreground_package_in_list_local(adb,
                                                                serial,
                                                                silent_expected_pkg_list,
                                                                precheck_wait_attempts,
                                                                precheck_wait_sleep_ms,
                                                                precheck_foreground_pkg,
                                                                sizeof(precheck_foreground_pkg));
      if (waited_ready) {
        fprintf(stdout,
                "[capture-route-layer-android] silent precheck foreground ready after wait foreground=%s expected_any_of=%s attempts=%d sleep_ms=%d\n",
                precheck_foreground_pkg,
                silent_expected_pkg_list,
                precheck_wait_attempts,
                precheck_wait_sleep_ms);
      } else {
        if (!allow_foreground_recover) {
          fprintf(stderr,
                  "[capture-route-layer-android] silent precheck failed foreground=%s expected_any_of=%s; foreground recovery disabled, bring expected app to foreground manually and retry\n",
                  precheck_foreground_pkg,
                  silent_expected_pkg_list);
          strlist_free(&routes);
          return 1;
        }
        bool recovered = try_recover_foreground_package_local(adb,
                                                              serial,
                                                              runtime_pkg_hint,
                                                              runtime_activity_precheck2,
                                                              "home_default",
                                                              "precheck-before-layer",
                                                              precheck_foreground_pkg);
        if (recovered &&
            resolve_foreground_package_local(adb, serial, precheck_foreground_pkg, sizeof(precheck_foreground_pkg)) &&
            precheck_foreground_pkg[0] != '\0' &&
            package_in_csv_list_local(precheck_foreground_pkg, silent_expected_pkg_list)) {
          fprintf(stdout,
                  "[capture-route-layer-android] silent precheck recovered foreground=%s expected_any_of=%s\n",
                  precheck_foreground_pkg,
                  silent_expected_pkg_list);
        } else {
          fprintf(stderr,
                  "[capture-route-layer-android] silent precheck failed foreground=%s expected_any_of=%s; bring expected app to foreground manually and confirm before retry\n",
                  precheck_foreground_pkg,
                  silent_expected_pkg_list);
          strlist_free(&routes);
          return 1;
        }
      }
    }
  }

  fprintf(stdout,
          "[capture-route-layer-android] layer=%d/%d routes=%zu truth=%s serial=%s no_foreground_switch=%d\n",
          layer_index,
          layer_count,
          routes.len,
          truth_dir,
          serial,
          no_foreground_switch ? 1 : 0);
  {
    int foreground_recover_max = env_positive_int_or_default_local(
        "CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_RECOVER_MAX_ATTEMPTS",
        1);
    if (foreground_recover_max < 1) foreground_recover_max = 1;
    if (foreground_recover_max > 3) foreground_recover_max = 3;
    const char *foreground_recover_route = getenv("CHENG_CAPTURE_ROUTE_LAYER_FOREGROUND_RECOVER_ROUTE");
    if (foreground_recover_route == NULL || foreground_recover_route[0] == '\0') {
      foreground_recover_route = "home_default";
    }
    fprintf(stdout,
            "[capture-route-layer-android] foreground-recover enabled=%d used=%d max=%d target_route=%s\n",
            allow_foreground_recover ? 1 : 0,
            g_foreground_recover_used_local,
            foreground_recover_max,
            foreground_recover_route);
  }

  grant_runtime_permissions_best_effort(adb, serial, "com.unimaker.app");
  if (runtime_pkg_hint != NULL && runtime_pkg_hint[0] != '\0' &&
      strcmp(runtime_pkg_hint, "com.unimaker.app") != 0) {
    grant_runtime_permissions_best_effort(adb, serial, runtime_pkg_hint);
  }

  char silent_foreground_pkg[256];
  silent_foreground_pkg[0] = '\0';
  const bool bind_foreground_package = env_flag_enabled_local(
      "CHENG_CAPTURE_ROUTE_LAYER_BIND_FOREGROUND_PACKAGE",
      false);
  if (no_foreground_switch && precheck_foreground_pkg[0] != '\0') {
    snprintf(silent_foreground_pkg, sizeof(silent_foreground_pkg), "%s", precheck_foreground_pkg);
  } else if (no_foreground_switch) {
    (void)resolve_foreground_package_local(adb, serial, silent_foreground_pkg, sizeof(silent_foreground_pkg));
  }
  const char *runtime_capture_pkg = runtime_pkg_hint;
  if (no_foreground_switch && silent_foreground_pkg[0] != '\0') {
    if (bind_foreground_package) {
      if (runtime_capture_pkg != NULL && runtime_capture_pkg[0] != '\0' &&
          strcmp(runtime_capture_pkg, silent_foreground_pkg) != 0) {
        fprintf(stdout,
                "[capture-route-layer-android] silent mode bind runtime package to foreground: %s -> %s\n",
                runtime_capture_pkg,
                silent_foreground_pkg);
      }
      runtime_capture_pkg = silent_foreground_pkg;
    } else if (runtime_capture_pkg == NULL || runtime_capture_pkg[0] == '\0') {
      runtime_capture_pkg = silent_foreground_pkg;
    } else if (strcmp(runtime_capture_pkg, silent_foreground_pkg) != 0) {
      fprintf(stderr,
              "[capture-route-layer-android] silent mode runtime package mismatch configured=%s foreground=%s (set CHENG_CAPTURE_ROUTE_LAYER_BIND_FOREGROUND_PACKAGE=1 or align env)\n",
              runtime_capture_pkg,
              silent_foreground_pkg);
      strlist_free(&routes);
      return 1;
    }
  }
  if (runtime_capture_pkg == NULL || runtime_capture_pkg[0] == '\0') {
    runtime_capture_pkg = "com.unimaker.app";
  }
  char runtime_capture_activity_buf[192];
  runtime_capture_activity_buf[0] = '\0';
  const char *runtime_capture_activity = getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_ACTIVITY");
  if (runtime_capture_activity == NULL || runtime_capture_activity[0] == '\0') {
    runtime_capture_activity = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
  }
  if (runtime_capture_activity == NULL || runtime_capture_activity[0] == '\0') {
    runtime_capture_activity = getenv("CHENG_ANDROID_APP_ACTIVITY");
  }
  if (runtime_capture_activity == NULL || runtime_capture_activity[0] == '\0') {
    runtime_capture_activity = getenv("CHENG_ANDROID_EQ_APP_ACTIVITY");
  }
  if (runtime_capture_activity == NULL || runtime_capture_activity[0] == '\0') {
    runtime_capture_activity = infer_main_activity_for_package_local(
        runtime_capture_pkg, runtime_capture_activity_buf, sizeof(runtime_capture_activity_buf));
  }
  setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE", runtime_capture_pkg, 1);
  setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY", runtime_capture_activity, 1);
  char overlay_allow_pkg_csv[512];
  if (allow_overlay_foreground) {
    snprintf(overlay_allow_pkg_csv,
             sizeof(overlay_allow_pkg_csv),
             "%s,com.huawei.ohos.inputmethod,com.android.nfc,com.android.packageinstaller",
             runtime_capture_pkg);
  } else {
    snprintf(overlay_allow_pkg_csv, sizeof(overlay_allow_pkg_csv), "%s", runtime_capture_pkg);
  }
  fprintf(stdout,
          "[capture-route-layer-android] runtime package=%s activity=%s (for replay + truth) overlay-foreground=%d\n",
          runtime_capture_pkg,
          runtime_capture_activity,
          allow_overlay_foreground ? 1 : 0);
  if (sync_runtime_semantic_assets_to_device(adb,
                                             serial,
                                             runtime_capture_pkg,
                                             route_tree_json,
                                             route_semantic_tree_json,
                                             compile_report_json) != 0) {
    fprintf(stderr,
            "[capture-route-layer-android] failed to sync runtime semantic assets package=%s\n",
            runtime_capture_pkg);
    strlist_free(&routes);
    return 1;
  }
  fprintf(stdout,
          "[capture-route-layer-android] runtime semantic assets synced package=%s\n",
          runtime_capture_pkg);

  bool use_gate_capture = false;
  const char *use_gate_capture_env = getenv("CHENG_CAPTURE_ROUTE_LAYER_USE_GATE");
  if (use_gate_capture_env != NULL && use_gate_capture_env[0] != '\0' &&
      strcmp(use_gate_capture_env, "0") != 0) {
    use_gate_capture = true;
  }
  bool strict_deep_routes = true;
  const char *strict_deep_routes_env = getenv("CHENG_CAPTURE_ROUTE_LAYER_STRICT_DEEP_ROUTES");
  if (strict_deep_routes_env != NULL && strict_deep_routes_env[0] != '\0') {
    strict_deep_routes = (strcmp(strict_deep_routes_env, "0") != 0);
  }
  bool enable_seed_truth = env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_ENABLE_SEED", false);
  const char *seed_runtime_pkg = getenv("CHENG_CAPTURE_ROUTE_LAYER_SEED_RUNTIME_PACKAGE");
  if (seed_runtime_pkg == NULL || seed_runtime_pkg[0] == '\0') seed_runtime_pkg = runtime_capture_pkg;
  if (seed_runtime_pkg == NULL || seed_runtime_pkg[0] == '\0') seed_runtime_pkg = "com.unimaker.app";
  const char *expected_truth_pkg = getenv("CHENG_CAPTURE_ROUTE_LAYER_EXPECT_TRUTH_PACKAGE");
  if (expected_truth_pkg == NULL || expected_truth_pkg[0] == '\0') expected_truth_pkg = runtime_capture_pkg;

  char seen_hashes[256][96];
  char seen_routes[256][128];
  size_t seen_count = 0u;
  const char *no_foreground_switch_arg = no_foreground_switch ? "1" : "0";
  bool capture_require_runtime_route_match = true;
  const char *capture_require_runtime_match_env =
      getenv("CHENG_CAPTURE_ROUTE_LAYER_REQUIRE_RUNTIME_ROUTE_MATCH");
  if (capture_require_runtime_match_env != NULL && capture_require_runtime_match_env[0] != '\0') {
    if (strcmp(capture_require_runtime_match_env, "0") == 0) {
      fprintf(stderr,
              "[capture-route-layer-android] strict runtime mode forbids CHENG_CAPTURE_ROUTE_LAYER_REQUIRE_RUNTIME_ROUTE_MATCH=0\n");
      strlist_free(&routes);
      return 1;
    }
    capture_require_runtime_route_match = true;
  }
  const char *runtimeless_semantic_env =
      getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIMELESS_SEMANTIC_STRICT");
  bool runtimeless_semantic_strict = false;
  if (runtimeless_semantic_env != NULL && runtimeless_semantic_env[0] != '\0' &&
      strcmp(runtimeless_semantic_env, "0") != 0) {
    fprintf(stderr,
            "[capture-route-layer-android] strict runtime 1:1 forbids CHENG_CAPTURE_ROUTE_LAYER_RUNTIMELESS_SEMANTIC_STRICT=1\n");
    strlist_free(&routes);
    return 1;
  }
  setenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIMELESS_SEMANTIC_STRICT", "0", 1);
  setenv("CHENG_CAPTURE_UNIMAKER_RUNTIMELESS_SEMANTIC_STRICT", "0", 1);
  const char *capture_require_runtime_route_match_arg = capture_require_runtime_route_match ? "1" : "0";
  bool strict_framehash_uniqueness = !(no_foreground_switch && !capture_require_runtime_route_match);
  fprintf(stdout,
          "[capture-route-layer-android] runtime-route-match-required=%s strict-framehash-uniqueness=%d runtime-route-probe-mode=%s (no_foreground_switch=%d)\n",
          capture_require_runtime_route_match_arg,
          strict_framehash_uniqueness ? 1 : 0,
          runtimeless_semantic_strict ? "semantic-runtimeless" : "runtime-state",
          no_foreground_switch ? 1 : 0);
  if (capture_require_runtime_route_match && use_gate_capture) {
    fprintf(stderr,
            "[capture-route-layer-android] strict runtime mode forbids CHENG_CAPTURE_ROUTE_LAYER_USE_GATE=1\n");
    strlist_free(&routes);
    return 1;
  }
  if (capture_require_runtime_route_match && enable_seed_truth) {
    fprintf(stderr,
            "[capture-route-layer-android] strict runtime mode forbids CHENG_CAPTURE_ROUTE_LAYER_ENABLE_SEED=1\n");
    strlist_free(&routes);
    return 1;
  }
  if (capture_require_runtime_route_match && !runtimeless_semantic_strict) {
    int preflight_attempts =
        env_positive_int_or_default_local("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_PREFLIGHT_ATTEMPTS", 2);
    int preflight_sleep_ms =
        env_positive_int_or_default_local("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_PREFLIGHT_SLEEP_MS", 160);
    char preflight_route[128];
    preflight_route[0] = '\0';
    if (!read_runtime_route_state_retry(adb,
                                        serial,
                                        runtime_capture_pkg,
                                        preflight_route,
                                        sizeof(preflight_route),
                                        preflight_attempts,
                                        preflight_sleep_ms,
                                        false)) {
      fprintf(stderr,
              "[capture-route-layer-android] strict runtime precheck failed pkg=%s attempts=%d sleep_ms=%d (missing/unreadable files/cheng_runtime_state.json)\n",
              runtime_capture_pkg,
              preflight_attempts,
              preflight_sleep_ms);
      emit_runtime_state_precheck_diagnostic(adb, serial, runtime_capture_pkg);
      strlist_free(&routes);
      return 1;
    }
    fprintf(stdout,
            "[capture-route-layer-android] strict runtime precheck ok pkg=%s route=%s\n",
            runtime_capture_pkg,
            preflight_route[0] != '\0' ? preflight_route : "<empty>");
  } else if (capture_require_runtime_route_match && runtimeless_semantic_strict) {
    fprintf(stdout,
            "[capture-route-layer-android] strict runtime precheck skipped: semantic-runtimeless mode package=%s\n",
            runtime_capture_pkg);
  }

  for (size_t i = 0u; i < routes.len; ++i) {
    const char *route = routes.items[i];
    if (strcmp(route, "lang_select") == 0 && !first_install_pass) {
      fprintf(stdout, "[capture-route-layer-android] skip route=%s (first-install only)\n", route);
      continue;
    }
    char parent_route[128];
    char path_signature[512];
    int route_depth = 0;
    if (!read_route_meta(route_actions_json,
                         route,
                         parent_route,
                         sizeof(parent_route),
                         &route_depth,
                         path_signature,
                         sizeof(path_signature))) {
      fprintf(stderr, "[capture-route-layer-android] failed to read route meta route=%s\n", route);
      cleanup_route_truth_outputs(truth_dir, route);
      strlist_free(&routes);
      return 1;
    }
    if (enable_seed_truth) {
      char used_seed_dir[PATH_MAX];
      if (try_seed_route_from_env(adb,
                                  serial,
                                  seed_runtime_pkg,
                                  route,
                                  used_seed_dir,
                                  sizeof(used_seed_dir))) {
        fprintf(stdout,
                "[capture-route-layer-android] seeded route truth route=%s seed_dir=%s runtime_pkg=%s\n",
                route,
                used_seed_dir[0] != '\0' ? used_seed_dir : "<unknown>",
                seed_runtime_pkg);
      }
    }
    int cap_rc = 1;
    if (use_gate_capture) {
      int gate_attempts = no_foreground_switch ? 1 : 2;
      for (int gate_attempt = 0; gate_attempt < gate_attempts; ++gate_attempt) {
        bool replay_from_home = (strcmp(route, "home_default") != 0);
        if (!no_foreground_switch) normalize_capture_device_posture(adb, serial);
        char *prev_skip_compile = dup_env_value_local("CHENG_ANDROID_1TO1_SKIP_COMPILE");
        char *prev_home_hard_gate = dup_env_value_local("CHENG_ANDROID_1TO1_HOME_HARD_GATE");
        char *prev_disable_expected = dup_env_value_local("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH");
        char *prev_enforce_expected = dup_env_value_local("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
        char *prev_pass_expected = dup_env_value_local("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME");
        char *prev_visual_strict = dup_env_value_local("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT");
        char *prev_freeze_truth = dup_env_value_local("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR");
        char *prev_allow_blank_truth = dup_env_value_local("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR");
        char *prev_replay_actions = dup_env_value_local("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS");
        char *prev_replay_launch_home = dup_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME");
        char *prev_replay_exec_launch_main =
            dup_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN");
        char *prev_replay_package = dup_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE");
        char *prev_replay_activity = dup_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
        char *prev_visual_package = dup_env_value_local("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE");
        char *prev_visual_activity = dup_env_value_local("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY");
        char *prev_visual_allow_package = dup_env_value_local("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE");
        char *prev_require_runtime_route_match =
            dup_env_value_local("CHENG_ANDROID_1TO1_CAPTURE_REQUIRE_RUNTIME_ROUTE_MATCH");
        char *prev_no_foreground_switch =
            dup_env_value_local("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH");

        if (gate_skip_compile) setenv("CHENG_ANDROID_1TO1_SKIP_COMPILE", "1", 1);
        else setenv("CHENG_ANDROID_1TO1_SKIP_COMPILE", "0", 1);
        setenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE", "0", 1);
        setenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH", "1", 1);
        setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", "0", 1);
        setenv("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME", "0", 1);
        setenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT", "1", 1);
        setenv("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR", truth_dir, 1);
        setenv("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR", "1", 1);
        setenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", replay_from_home ? "1" : "0", 1);
        setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME",
               (replay_from_home && !no_foreground_switch) ? "1" : "0",
               1);
        setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN",
               (replay_from_home && !no_foreground_switch) ? "1" : "0",
               1);
        setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE", runtime_capture_pkg, 1);
        setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY", runtime_capture_activity, 1);
        setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE", runtime_capture_pkg, 1);
        setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY", runtime_capture_activity, 1);
        setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE",
               overlay_allow_pkg_csv,
               1);
        setenv("CHENG_ANDROID_1TO1_CAPTURE_REQUIRE_RUNTIME_ROUTE_MATCH", "1", 1);
        setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", no_foreground_switch ? "1" : "0", 1);

        if (replay_from_home && gate_attempt == 0 && !no_foreground_switch) {
          fprintf(stdout,
                  "[capture-route-layer-android] capture route=%s with source-app replay from home\n",
                  route);
        } else if (replay_from_home && !no_foreground_switch) {
          fprintf(stdout,
                  "[capture-route-layer-android] retry route=%s with source-app replay from home\n",
                  route);
        } else if (replay_from_home && no_foreground_switch) {
          fprintf(stdout,
                  "[capture-route-layer-android] silent mode route=%s skip replay-from-home foreground switch\n",
                  route);
        } else if (gate_attempt > 0) {
          fprintf(stdout,
                  "[capture-route-layer-android] retry route=%s after invalid direct capture\n",
                  route);
        }
        char *cap_gate_argv[] = {
            "verify_android_claude_1to1_gate",
            "--project",
            (char *)project,
            "--entry",
            (char *)entry,
            "--out",
            gate_out_abs,
            "--route-state",
            (char *)route,
            "--truth-dir",
            gate_truth_seed_dir,
            NULL,
        };
        cap_rc = native_verify_android_claude_1to1_gate(scripts_dir, 11, cap_gate_argv, 1);

        restore_env_value_local("CHENG_ANDROID_1TO1_SKIP_COMPILE", prev_skip_compile);
        restore_env_value_local("CHENG_ANDROID_1TO1_HOME_HARD_GATE", prev_home_hard_gate);
        restore_env_value_local("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH", prev_disable_expected);
        restore_env_value_local("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", prev_enforce_expected);
        restore_env_value_local("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME", prev_pass_expected);
        restore_env_value_local("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT", prev_visual_strict);
        restore_env_value_local("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR", prev_freeze_truth);
        restore_env_value_local("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR", prev_allow_blank_truth);
        restore_env_value_local("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", prev_replay_actions);
        restore_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME", prev_replay_launch_home);
        restore_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN", prev_replay_exec_launch_main);
        restore_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE", prev_replay_package);
        restore_env_value_local("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY", prev_replay_activity);
        restore_env_value_local("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE", prev_visual_package);
        restore_env_value_local("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY", prev_visual_activity);
        restore_env_value_local("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE", prev_visual_allow_package);
        restore_env_value_local("CHENG_ANDROID_1TO1_CAPTURE_REQUIRE_RUNTIME_ROUTE_MATCH",
                                prev_require_runtime_route_match);
        restore_env_value_local("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", prev_no_foreground_switch);

        free(prev_skip_compile);
        free(prev_home_hard_gate);
        free(prev_disable_expected);
        free(prev_enforce_expected);
        free(prev_pass_expected);
        free(prev_visual_strict);
        free(prev_freeze_truth);
        free(prev_allow_blank_truth);
        free(prev_replay_actions);
        free(prev_replay_launch_home);
        free(prev_replay_exec_launch_main);
        free(prev_replay_package);
        free(prev_replay_activity);
        free(prev_visual_package);
        free(prev_visual_activity);
        free(prev_visual_allow_package);
        free(prev_require_runtime_route_match);
        free(prev_no_foreground_switch);

        if (cap_rc == 0 && gate_attempt + 1 < gate_attempts) {
          int meta_w = 0;
          int meta_h = 0;
          int meta_sw = 0;
          int meta_sh = 0;
          if (!captured_route_meta_has_valid_geometry(truth_dir,
                                                      route,
                                                      &meta_w,
                                                      &meta_h,
                                                      &meta_sw,
                                                      &meta_sh)) {
            fprintf(stdout,
                    "[capture-route-layer-android] reject invalid capture geometry route=%s width=%d height=%d surface=%dx%d; retry\n",
                    route,
                    meta_w,
                    meta_h,
                    meta_sw,
                    meta_sh);
            cleanup_route_truth_outputs(truth_dir, route);
            cap_rc = 1;
            continue;
          }
          double white_ratio = 0.0;
          double delta_ratio = 0.0;
          double edge_ratio = 0.0;
          int luma_span = 0;
          if (captured_route_truth_looks_blank(truth_dir,
                                               route,
                                               &white_ratio,
                                               &delta_ratio,
                                               &edge_ratio,
                                               &luma_span)) {
            fprintf(stdout,
                    "[capture-route-layer-android] direct route capture looks blank route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d; retry with replay\n",
                    route,
                    white_ratio,
                    delta_ratio,
                    edge_ratio,
                    luma_span);
            cleanup_route_truth_outputs(truth_dir, route);
            cap_rc = 1;
            continue;
          }
        }
        if (cap_rc == 0) break;
      }
    } else {
      RouteActionList actions;
      memset(&actions, 0, sizeof(actions));
      bool silent_seed_truth_fallback =
          no_foreground_switch && enable_seed_truth &&
          env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_SILENT_SEED_TRUTH_FALLBACK", false);
      if (!read_route_actions(route_actions_json, route, &actions)) {
        if (!build_builtin_nav_route_actions(route, &actions)) {
          fprintf(stderr,
                  "[capture-route-layer-android] route actions missing/invalid in compile output: route=%s file=%s\n",
                  route,
                  route_actions_json);
          strlist_free(&routes);
          return 1;
        }
        fprintf(stdout,
                "[capture-route-layer-android] route actions fallback builtin route=%s reason=missing_or_invalid file=%s\n",
                route,
                route_actions_json);
      }
      patch_nav_route_actions_for_known_layout(route, &actions);
      int replay_attempts = no_foreground_switch ? 1 : 2;
      bool nav_like_route =
          (route != NULL &&
           (strncmp(route, "tab_", 4u) == 0 || strcmp(route, "publish_selector") == 0));
      if (no_foreground_switch && nav_like_route) {
        replay_attempts = 2;
      }
      for (int attempt = 0; attempt < replay_attempts; ++attempt) {
        if (!no_foreground_switch) normalize_capture_device_posture(adb, serial);
        if (no_foreground_switch) {
          if (!guard_foreground_package_strict(
                  adb,
                  serial,
                  runtime_capture_pkg,
                  runtime_capture_activity,
                  route,
                  "pre-replay",
                  2,
                  120,
                  allow_foreground_recover)) {
            route_action_list_free(&actions);
            strlist_free(&routes);
            return 1;
          }
        }
        if (replay_route_state(
                adb, serial, route, parent_route, route_semantic_tree_json, &actions, no_foreground_switch) != 0) {
          fprintf(stderr, "[capture-route-layer-android] replay failed route=%s attempt=%d\n", route, attempt + 1);
          if (silent_seed_truth_fallback) {
            cap_rc = 1;
            break;
          }
          route_action_list_free(&actions);
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
            "--route-tree",
            route_tree_json,
            "--route-semantic-tree",
            route_semantic_tree_json,
            "--package",
            (char *)runtime_capture_pkg,
            "--activity",
            (char *)runtime_capture_activity,
            "--allow-overlay-package",
            (char *)overlay_allow_pkg_csv,
            "--require-runtime-route-match",
            (char *)capture_require_runtime_route_match_arg,
            "--force-front",
            "0",
            "--no-foreground-switch",
            (char *)no_foreground_switch_arg,
            NULL,
        };
        if (no_foreground_switch) {
          if (!guard_foreground_package_strict(
                  adb,
                  serial,
                  runtime_capture_pkg,
                  runtime_capture_activity,
                  route,
                  "pre-capture",
                  2,
                  120,
                  false)) {
            if (allow_overlay_foreground) {
              char fg_pkg[256];
              fg_pkg[0] = '\0';
              bool allow_overlay_capture = false;
              if (resolve_foreground_package_local(adb, serial, fg_pkg, sizeof(fg_pkg)) &&
                  fg_pkg[0] != '\0' &&
                  package_in_csv_list_local(fg_pkg, overlay_allow_pkg_csv)) {
                allow_overlay_capture = true;
                fprintf(stdout,
                        "[capture-route-layer-android] pre-capture allow overlay foreground route=%s foreground=%s\n",
                        route,
                        fg_pkg);
              }
              if (!allow_overlay_capture) {
                route_action_list_free(&actions);
                strlist_free(&routes);
                return 1;
              }
            } else {
              route_action_list_free(&actions);
              strlist_free(&routes);
              return 1;
            }
          }
        }
        cap_rc = native_capture_android_unimaker_truth(scripts_dir, 23, cap_argv, 1);
        if (cap_rc == 0) break;
        if (attempt == 0 && replay_attempts > 1) {
          fprintf(stdout,
                  "[capture-route-layer-android] retry route=%s after foreground recovery\n",
                  route);
          if (!no_foreground_switch) {
            recover_foreground_runtime_package(adb, serial, runtime_capture_activity);
          } else {
            fprintf(stdout,
                    "[capture-route-layer-android] silent mode skip foreground recovery route=%s\n",
                    route);
          }
        }
      }
      route_action_list_free(&actions);
    }
    if (cap_rc != 0) {
      bool silent_seed_truth_fallback =
          no_foreground_switch && enable_seed_truth &&
          env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_SILENT_SEED_TRUTH_FALLBACK", false);
      if (silent_seed_truth_fallback) {
        char used_seed_dir[PATH_MAX];
        if (try_copy_seed_truth_from_env(truth_dir, route, used_seed_dir, sizeof(used_seed_dir))) {
          fprintf(stdout,
                  "[capture-route-layer-android] silent seed-truth fallback route=%s seed_dir=%s\n",
                  route,
                  used_seed_dir[0] != '\0' ? used_seed_dir : "<unknown>");
          cap_rc = 0;
        }
      }
    }
    if (cap_rc != 0) {
      fprintf(stderr, "[capture-route-layer-android] capture failed route=%s rc=%d\n", route, cap_rc);
      strlist_free(&routes);
      return cap_rc;
    }
    int meta_w = 0;
    int meta_h = 0;
    int meta_sw = 0;
    int meta_sh = 0;
    if (!captured_route_meta_has_valid_geometry(truth_dir, route, &meta_w, &meta_h, &meta_sw, &meta_sh)) {
      fprintf(stderr,
              "[capture-route-layer-android] reject route=%s reason=invalid-geometry width=%d height=%d surface=%dx%d\n",
              route,
              meta_w,
              meta_h,
              meta_sw,
              meta_sh);
      cleanup_route_truth_outputs(truth_dir, route);
      strlist_free(&routes);
      return 1;
    }
    char route_hash_path[PATH_MAX];
    char route_rgba_path[PATH_MAX];
    if (snprintf(route_hash_path, sizeof(route_hash_path), "%s/%s.framehash", truth_dir, route) >= (int)sizeof(route_hash_path) ||
        snprintf(route_rgba_path, sizeof(route_rgba_path), "%s/%s.rgba", truth_dir, route) >= (int)sizeof(route_rgba_path)) {
      fprintf(stderr, "[capture-route-layer-android] route output path too long route=%s\n", route);
      cleanup_route_truth_outputs(truth_dir, route);
      strlist_free(&routes);
      return 1;
    }
    char route_hash[96];
    if (!read_hash_hex_token_local(route_hash_path, route_hash, sizeof(route_hash))) {
      fprintf(stderr,
              "[capture-route-layer-android] missing/invalid route framehash route=%s path=%s\n",
              route,
              route_hash_path);
      cleanup_route_truth_outputs(truth_dir, route);
      strlist_free(&routes);
      return 1;
    }
    size_t rgba_len = 0u;
    unsigned char *rgba_doc = (unsigned char *)read_file_all_local(route_rgba_path, &rgba_len);
    if (rgba_doc == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
      free(rgba_doc);
      fprintf(stderr, "[capture-route-layer-android] invalid route rgba route=%s path=%s\n", route, route_rgba_path);
      cleanup_route_truth_outputs(truth_dir, route);
      strlist_free(&routes);
      return 1;
    }
    double white_ratio = 0.0;
    double delta_ratio = 0.0;
    double edge_ratio = 0.0;
    int luma_span = 0;
    bool looks_blank =
        rgba_looks_like_blank_whiteboard_local(rgba_doc, rgba_len, &white_ratio, &delta_ratio, &edge_ratio, &luma_span);
    free(rgba_doc);
    if (looks_blank) {
      fprintf(stderr,
              "[capture-route-layer-android] reject blank truth route=%s white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
              route,
              white_ratio,
              delta_ratio,
              edge_ratio,
              luma_span);
      cleanup_route_truth_outputs(truth_dir, route);
      strlist_free(&routes);
      return 1;
    }
    if (route_depth > 0 && parent_route[0] != '\0') {
      char parent_hash_path[PATH_MAX];
      if (snprintf(parent_hash_path, sizeof(parent_hash_path), "%s/%s.framehash", truth_dir, parent_route) >=
          (int)sizeof(parent_hash_path)) {
        fprintf(stderr, "[capture-route-layer-android] parent hash path too long route=%s parent=%s\n", route, parent_route);
        cleanup_route_truth_outputs(truth_dir, route);
        strlist_free(&routes);
        return 1;
      }
      char parent_hash[96];
      if (!truth_meta_route_usable_local(truth_dir, parent_route, expected_truth_pkg)) {
        fprintf(stdout,
                "[capture-route-layer-android] parent truth meta invalid; reset parent=%s expected_pkg=%s\n",
                parent_route,
                expected_truth_pkg);
        cleanup_route_truth_outputs(truth_dir, parent_route);
      }
      if (!read_hash_hex_token_local(parent_hash_path, parent_hash, sizeof(parent_hash))) {
        fprintf(stdout,
                "[capture-route-layer-android] parent truth missing route=%s parent=%s; capture parent first\n",
                route,
                parent_route);
        bool silent_seed_truth_fallback =
            no_foreground_switch && enable_seed_truth &&
            env_flag_enabled_local("CHENG_CAPTURE_ROUTE_LAYER_SILENT_SEED_TRUTH_FALLBACK", true);
        if (enable_seed_truth) {
          char used_parent_seed_dir[PATH_MAX];
          if (try_seed_route_from_env(adb,
                                      serial,
                                      seed_runtime_pkg,
                                      parent_route,
                                      used_parent_seed_dir,
                                      sizeof(used_parent_seed_dir))) {
            fprintf(stdout,
                    "[capture-route-layer-android] seeded parent route truth route=%s parent=%s seed_dir=%s runtime_pkg=%s\n",
                    route,
                    parent_route,
                    used_parent_seed_dir[0] != '\0' ? used_parent_seed_dir : "<unknown>",
                    seed_runtime_pkg);
          }
        }
        if (silent_seed_truth_fallback) {
          char used_parent_seed_truth_dir[PATH_MAX];
          if (try_copy_seed_truth_from_env(
                  truth_dir, parent_route, used_parent_seed_truth_dir, sizeof(used_parent_seed_truth_dir))) {
            fprintf(stdout,
                    "[capture-route-layer-android] silent seed-truth fallback parent route=%s parent=%s seed_dir=%s\n",
                    route,
                    parent_route,
                    used_parent_seed_truth_dir[0] != '\0' ? used_parent_seed_truth_dir : "<unknown>");
          }
        }
        if (!read_hash_hex_token_local(parent_hash_path, parent_hash, sizeof(parent_hash))) {
          RouteActionList parent_actions;
          memset(&parent_actions, 0, sizeof(parent_actions));
          char parent_parent_route[128];
          int parent_depth_hint = 0;
          char parent_path_signature[512];
          parent_parent_route[0] = '\0';
          parent_path_signature[0] = '\0';
          (void)read_route_meta(route_actions_json,
                                parent_route,
                                parent_parent_route,
                                sizeof(parent_parent_route),
                                &parent_depth_hint,
                                parent_path_signature,
                                sizeof(parent_path_signature));
          if (!read_route_actions(route_actions_json, parent_route, &parent_actions) ||
              replay_route_state(
                  adb,
                  serial,
                  parent_route,
                  parent_parent_route,
                  route_semantic_tree_json,
                  &parent_actions,
                  no_foreground_switch) != 0) {
            route_action_list_free(&parent_actions);
            fprintf(stderr,
                    "[capture-route-layer-android] parent replay failed route=%s parent=%s\n",
                    route,
                    parent_route);
            cleanup_route_truth_outputs(truth_dir, route);
            strlist_free(&routes);
            return 1;
          }
          route_action_list_free(&parent_actions);
          int parent_cap_rc = 1;
          for (int parent_attempt = 0; parent_attempt < 2; ++parent_attempt) {
            char *parent_cap_argv[] = {
                "capture_android_unimaker_truth",
                "--route-state",
                parent_route,
                "--out-dir",
                (char *)truth_dir,
                "--serial",
                serial,
                "--route-tree",
                route_tree_json,
                "--route-semantic-tree",
                route_semantic_tree_json,
                "--package",
                (char *)runtime_capture_pkg,
                "--activity",
                (char *)runtime_capture_activity,
                "--allow-overlay-package",
                (char *)overlay_allow_pkg_csv,
                "--require-runtime-route-match",
                (char *)capture_require_runtime_route_match_arg,
                "--force-front",
                no_foreground_switch ? "0" : "1",
                "--no-foreground-switch",
                (char *)no_foreground_switch_arg,
                NULL,
            };
            fprintf(stdout,
                    "[capture-route-layer-android] parent capture route=%s parent=%s require-runtime-route-match=%s\n",
                    route,
                    parent_route,
                    capture_require_runtime_route_match_arg);
            parent_cap_rc = native_capture_android_unimaker_truth(scripts_dir, 23, parent_cap_argv, 1);
            if (parent_cap_rc == 0 &&
                read_hash_hex_token_local(parent_hash_path, parent_hash, sizeof(parent_hash))) {
              break;
            }
            if (parent_attempt == 0) {
              fprintf(stdout,
                      "[capture-route-layer-android] retry parent capture route=%s parent=%s after foreground recovery\n",
                      route,
                      parent_route);
              if (!no_foreground_switch) {
                recover_foreground_runtime_package(adb, serial, runtime_capture_activity);
              } else {
                fprintf(stdout,
                        "[capture-route-layer-android] silent mode skip parent foreground recovery route=%s parent=%s\n",
                        route,
                        parent_route);
              }
            }
          }
          if (parent_cap_rc != 0 || !read_hash_hex_token_local(parent_hash_path, parent_hash, sizeof(parent_hash))) {
            fprintf(stderr,
                    "[capture-route-layer-android] parent truth missing/invalid route=%s parent=%s path=%s\n",
                    route,
                    parent_route,
                    parent_hash_path);
            cleanup_route_truth_outputs(truth_dir, route);
            strlist_free(&routes);
            return 1;
          }
        }
      }
      if (strcmp(parent_hash, route_hash) == 0) {
        bool alias_parent_equal = route_equivalent_to_parent(route, parent_route);
        bool allow_alias_parent_equal = alias_parent_equal && route_depth >= 2;
        if (!strict_framehash_uniqueness || (route_depth >= 1 && (!strict_deep_routes || allow_alias_parent_equal))) {
          fprintf(stdout,
                  "[capture-route-layer-android] warn deep-route parent-equal route=%s parent=%s framehash=%s path_signature=%s alias=%d\n",
                  route,
                  parent_route,
                  route_hash,
                  path_signature[0] != '\0' ? path_signature : "<empty>",
                  allow_alias_parent_equal ? 1 : 0);
        } else {
          fprintf(stderr,
                  "[capture-route-layer-android] semantic route mismatch route=%s parent=%s framehash=%s path_signature=%s\n",
                  route,
                  parent_route,
                  route_hash,
                  path_signature[0] != '\0' ? path_signature : "<empty>");
          cleanup_route_truth_outputs(truth_dir, route);
          strlist_free(&routes);
          return 1;
        }
      }
    }
    for (size_t seen = 0u; seen < seen_count; ++seen) {
      if (strcmp(seen_hashes[seen], route_hash) == 0 && strcmp(seen_routes[seen], route) != 0) {
        bool alias_duplicate = routes_share_semantic_equivalent_target(route, seen_routes[seen]);
        bool allow_alias_duplicate = alias_duplicate && route_depth >= 2;
        if (!strict_framehash_uniqueness || (route_depth >= 1 && (!strict_deep_routes || allow_alias_duplicate))) {
          fprintf(stdout,
                  "[capture-route-layer-android] warn deep-route duplicate route=%s other=%s framehash=%s alias=%d\n",
                  route,
                  seen_routes[seen],
                  route_hash,
                  allow_alias_duplicate ? 1 : 0);
        } else {
          fprintf(stderr,
                  "[capture-route-layer-android] duplicate framehash in layer route=%s other=%s framehash=%s\n",
                  route,
                  seen_routes[seen],
                  route_hash);
          cleanup_route_truth_outputs(truth_dir, route);
          strlist_free(&routes);
          return 1;
        }
        break;
      }
    }
    if (seen_count < (sizeof(seen_hashes) / sizeof(seen_hashes[0]))) {
      snprintf(seen_hashes[seen_count], sizeof(seen_hashes[seen_count]), "%s", route_hash);
      snprintf(seen_routes[seen_count], sizeof(seen_routes[seen_count]), "%s", route);
      seen_count += 1u;
    }
  }

  strlist_free(&routes);
  fprintf(stdout, "[capture-route-layer-android] ok layer=%d\n", layer_index);
  return 0;
}
