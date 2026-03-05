#define _POSIX_C_SOURCE 200809L

#include "native_verify_r2c_equivalence_android_native.h"

#include "native_r2c_report_validate.h"
#include "native_verify_android_claude_1to1_gate.h"
#include "native_verify_android_fullroute_visual_pixel.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  char **items;
  size_t len;
  size_t cap;
} StringList;

typedef struct {
  char type[32];
} RouteActionStep;

typedef struct {
  RouteActionStep *items;
  size_t len;
  size_t cap;
} RouteActionPlan;

static char *read_file_all(const char *path, size_t *out_len);
static bool rgba_looks_like_blank_whiteboard_local(const unsigned char *rgba,
                                                   size_t rgba_bytes,
                                                   double *white_ratio_out,
                                                   double *delta_ratio_out,
                                                   double *edge_ratio_out,
                                                   int *luma_span_out);
static int parse_nonnegative_int_env(const char *name, int default_value);
static int enforce_android_eq_cooldown(bool fullroute_mode);
static int enforce_android_eq_thermal_guard(bool fullroute_mode, const char *route_state);
static bool read_android_battery_temp_decic(int *out_temp_decic);

static int g_android_eq_lock_fd = -1;

static bool env_flag_true(const char *name) {
  if (name == NULL || name[0] == '\0') return false;
  const char *v = getenv(name);
  if (v == NULL || v[0] == '\0') return false;
  return (strcmp(v, "1") == 0 || strcmp(v, "true") == 0 || strcmp(v, "TRUE") == 0 ||
          strcmp(v, "yes") == 0 || strcmp(v, "YES") == 0);
}

static long long now_epoch_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_REALTIME, &ts) != 0) return 0;
  return (long long)ts.tv_sec * 1000LL + (long long)(ts.tv_nsec / 1000000LL);
}

static void release_android_eq_lock(void) {
  if (g_android_eq_lock_fd < 0) return;
  struct flock unlock;
  memset(&unlock, 0, sizeof(unlock));
  unlock.l_type = F_UNLCK;
  unlock.l_whence = SEEK_SET;
  unlock.l_start = 0;
  unlock.l_len = 0;
  (void)fcntl(g_android_eq_lock_fd, F_SETLK, &unlock);
  close(g_android_eq_lock_fd);
  g_android_eq_lock_fd = -1;
}

static int acquire_android_eq_lock(void) {
  if (env_flag_true("CHENG_ANDROID_EQ_ALLOW_PARALLEL")) return 0;
  const char *lock_file = getenv("CHENG_ANDROID_EQ_LOCK_FILE");
  if (lock_file == NULL || lock_file[0] == '\0') {
    lock_file = "/tmp/cheng_android_eq_native.lock";
  }
  int fd = open(lock_file, O_CREAT | O_RDWR, 0666);
  if (fd < 0) {
    fprintf(stderr,
            "[verify-r2c-android-native] lock open failed path=%s errno=%d\n",
            lock_file,
            errno);
    return 76;
  }
  struct flock lock;
  memset(&lock, 0, sizeof(lock));
  lock.l_type = F_WRLCK;
  lock.l_whence = SEEK_SET;
  lock.l_start = 0;
  lock.l_len = 0;
  if (fcntl(fd, F_SETLK, &lock) != 0) {
    fprintf(stderr,
            "[verify-r2c-android-native] another verify is running; lock=%s (set CHENG_ANDROID_EQ_ALLOW_PARALLEL=1 to bypass)\n",
            lock_file);
    close(fd);
    return 77;
  }
  g_android_eq_lock_fd = fd;
  char buf[64];
  int n = snprintf(buf, sizeof(buf), "%ld\n", (long)getpid());
  if (n > 0) {
    ftruncate(fd, 0);
    lseek(fd, 0, SEEK_SET);
    write(fd, buf, (size_t)n);
  }
  return 0;
}

static int resolve_android_eq_min_interval_ms(bool fullroute_mode) {
  const char *global = getenv("CHENG_ANDROID_EQ_MIN_INTERVAL_MS");
  if (global != NULL && global[0] != '\0') {
    return parse_nonnegative_int_env("CHENG_ANDROID_EQ_MIN_INTERVAL_MS", 12000);
  }
  if (fullroute_mode) {
    return parse_nonnegative_int_env("CHENG_ANDROID_EQ_MIN_INTERVAL_FULLROUTE_MS", 180000);
  }
  return parse_nonnegative_int_env("CHENG_ANDROID_EQ_MIN_INTERVAL_SINGLE_MS", 12000);
}

static bool read_android_battery_temp_decic(int *out_temp_decic) {
  const char *adb = getenv("CHENG_ANDROID_ADB");
  if (adb == NULL || adb[0] == '\0') adb = "adb";
  const char *serial = getenv("ANDROID_SERIAL");

  char cmd[PATH_MAX + 256];
  if (serial != NULL && serial[0] != '\0') {
    (void)snprintf(cmd, sizeof(cmd), "%s -s %s shell dumpsys battery 2>/dev/null", adb, serial);
  } else {
    (void)snprintf(cmd, sizeof(cmd), "%s shell dumpsys battery 2>/dev/null", adb);
  }
  FILE *fp = popen(cmd, "r");
  if (fp == NULL) return false;

  bool found = false;
  int temp_decic = 0;
  char line[256];
  while (fgets(line, sizeof(line), fp) != NULL) {
    const char *p = strstr(line, "temperature");
    if (p == NULL) continue;
    while (*p != '\0' && !isdigit((unsigned char)*p) && *p != '-') ++p;
    if (*p == '\0') continue;
    char *end = NULL;
    long value = strtol(p, &end, 10);
    if (end == p || value < INT_MIN || value > INT_MAX) continue;
    temp_decic = (int)value;
    found = true;
    break;
  }
  (void)pclose(fp);
  if (!found) return false;
  if (out_temp_decic != NULL) *out_temp_decic = temp_decic;
  return true;
}

static int enforce_android_eq_cooldown(bool fullroute_mode) {
  if (env_flag_true("CHENG_ANDROID_EQ_DISABLE_COOLDOWN")) return 0;
  int min_interval_ms = resolve_android_eq_min_interval_ms(fullroute_mode);
  if (min_interval_ms <= 0) return 0;
  const char *stamp_file = getenv("CHENG_ANDROID_EQ_STAMP_FILE");
  if (stamp_file == NULL || stamp_file[0] == '\0') {
    stamp_file = fullroute_mode
                     ? "/tmp/cheng_android_eq_native.fullroute.last_ms"
                     : "/tmp/cheng_android_eq_native.single.last_ms";
  }

  long long now = now_epoch_ms();
  long long prev = 0;
  FILE *in = fopen(stamp_file, "rb");
  if (in != NULL) {
    (void)fscanf(in, "%lld", &prev);
    fclose(in);
  }
  if (prev > 0 && now > 0 && (now - prev) < (long long)min_interval_ms) {
    fprintf(stderr,
            "[verify-r2c-android-native] throttled %s run: delta=%lldms (<%dms). set CHENG_ANDROID_EQ_DISABLE_COOLDOWN=1 to bypass\n",
            fullroute_mode ? "fullroute" : "single-route",
            (now - prev),
            min_interval_ms);
    return 78;
  }
  FILE *out = fopen(stamp_file, "wb");
  if (out != NULL) {
    fprintf(out, "%lld\n", now);
    fclose(out);
  }
  return 0;
}

static int enforce_android_eq_thermal_guard(bool fullroute_mode, const char *route_state) {
  if (env_flag_true("CHENG_ANDROID_EQ_DISABLE_THERMAL_GUARD")) return 0;
  int max_temp_decic = parse_nonnegative_int_env("CHENG_ANDROID_EQ_MAX_BATTERY_TEMP_DECIC",
                                                 fullroute_mode ? 410 : 430);
  if (max_temp_decic <= 0) return 0;

  int temp_decic = 0;
  if (!read_android_battery_temp_decic(&temp_decic)) {
    if (env_flag_true("CHENG_ANDROID_EQ_LOG_THERMAL")) {
      fprintf(stdout,
              "[verify-r2c-android-native] thermal probe skipped (battery temperature unavailable)\n");
    }
    return 0;
  }
  if (env_flag_true("CHENG_ANDROID_EQ_LOG_THERMAL")) {
    fprintf(stdout,
            "[verify-r2c-android-native] battery-temp=%d.%dC limit=%d.%dC mode=%s%s%s\n",
            temp_decic / 10,
            abs(temp_decic % 10),
            max_temp_decic / 10,
            abs(max_temp_decic % 10),
            fullroute_mode ? "fullroute" : "single-route",
            (route_state != NULL && route_state[0] != '\0') ? " route=" : "",
            (route_state != NULL && route_state[0] != '\0') ? route_state : "");
  }
  if (temp_decic >= max_temp_decic) {
    fprintf(stderr,
            "[verify-r2c-android-native] thermal guard blocked: battery-temp=%d.%dC >= %d.%dC mode=%s%s%s. "
            "wait for cooldown or raise CHENG_ANDROID_EQ_MAX_BATTERY_TEMP_DECIC\n",
            temp_decic / 10,
            abs(temp_decic % 10),
            max_temp_decic / 10,
            abs(max_temp_decic % 10),
            fullroute_mode ? "fullroute" : "single-route",
            (route_state != NULL && route_state[0] != '\0') ? " route=" : "",
            (route_state != NULL && route_state[0] != '\0') ? route_state : "");
    return 79;
  }
  return 0;
}

static int parse_nonnegative_int_env(const char *name, int default_value) {
  if (name == NULL || name[0] == '\0') return default_value;
  const char *raw = getenv(name);
  if (raw == NULL || raw[0] == '\0') return default_value;
  char *end = NULL;
  long v = strtol(raw, &end, 10);
  if (end == raw || *end != '\0' || v < 0 || v > INT_MAX) {
    fprintf(stderr,
            "[verify-r2c-android-native] invalid %s=%s; fallback=%d\n",
            name,
            raw,
            default_value);
    return default_value;
  }
  return (int)v;
}

static void sleep_ms(int wait_ms) {
  if (wait_ms <= 0) return;
  struct timespec req;
  req.tv_sec = wait_ms / 1000;
  req.tv_nsec = (long)(wait_ms % 1000) * 1000000L;
  while (nanosleep(&req, &req) != 0 && errno == EINTR) {}
}

static char *dup_env_value(const char *name) {
  if (name == NULL || name[0] == '\0') return NULL;
  const char *value = getenv(name);
  if (value == NULL) return NULL;
  return strdup(value);
}

static void restore_env_value(const char *name, const char *value) {
  if (name == NULL || name[0] == '\0') return;
  if (value != NULL) {
    setenv(name, value, 1);
  } else {
    unsetenv(name);
  }
}

static bool csv_route_contains(const char *csv, const char *route) {
  if (csv == NULL || route == NULL || route[0] == '\0') return false;
  const char *p = csv;
  while (*p != '\0') {
    while (*p == ' ' || *p == '\t' || *p == ',') ++p;
    if (*p == '\0') break;
    const char *start = p;
    while (*p != '\0' && *p != ',') ++p;
    const char *end = p;
    while (end > start && (end[-1] == ' ' || end[-1] == '\t')) --end;
    size_t n = (size_t)(end - start);
    if (n > 0u && strlen(route) == n && strncmp(start, route, n) == 0) return true;
    if (*p == ',') ++p;
  }
  return false;
}

static int copy_file_bytes(const char *src, const char *dst) {
  if (src == NULL || dst == NULL || src[0] == '\0' || dst[0] == '\0') return -1;
  FILE *in = fopen(src, "rb");
  if (in == NULL) return -1;
  FILE *out = fopen(dst, "wb");
  if (out == NULL) {
    fclose(in);
    return -1;
  }
  char buf[16384];
  while (1) {
    size_t n = fread(buf, 1u, sizeof(buf), in);
    if (n > 0u) {
      if (fwrite(buf, 1u, n, out) != n) {
        fclose(in);
        fclose(out);
        return -1;
      }
    }
    if (n < sizeof(buf)) {
      if (ferror(in)) {
        fclose(in);
        fclose(out);
        return -1;
      }
      break;
    }
  }
  fclose(in);
  fclose(out);
  return 0;
}

static int freeze_route_truth_from_outputs(const char *out_dir,
                                           const char *truth_dir,
                                           const char *route_state) {
  if (out_dir == NULL || truth_dir == NULL || route_state == NULL ||
      out_dir[0] == '\0' || truth_dir[0] == '\0' || route_state[0] == '\0') {
    return -1;
  }
  char src_rgba[PATH_MAX];
  char src_meta[PATH_MAX];
  char src_hash[PATH_MAX];
  char src_runtime_hash[PATH_MAX];
  char dst_rgba[PATH_MAX];
  char dst_meta[PATH_MAX];
  char dst_hash[PATH_MAX];
  char dst_runtime_hash[PATH_MAX];
  if (snprintf(src_rgba, sizeof(src_rgba), "%s/%s.rgba", out_dir, route_state) >= (int)sizeof(src_rgba) ||
      snprintf(src_meta, sizeof(src_meta), "%s/%s.meta.json", out_dir, route_state) >= (int)sizeof(src_meta) ||
      snprintf(src_hash, sizeof(src_hash), "%s/%s.framehash", out_dir, route_state) >= (int)sizeof(src_hash) ||
      snprintf(src_runtime_hash, sizeof(src_runtime_hash), "%s/%s.runtime_framehash", out_dir, route_state) >=
          (int)sizeof(src_runtime_hash) ||
      snprintf(dst_rgba, sizeof(dst_rgba), "%s/%s.rgba", truth_dir, route_state) >= (int)sizeof(dst_rgba) ||
      snprintf(dst_meta, sizeof(dst_meta), "%s/%s.meta.json", truth_dir, route_state) >= (int)sizeof(dst_meta) ||
      snprintf(dst_hash, sizeof(dst_hash), "%s/%s.framehash", truth_dir, route_state) >= (int)sizeof(dst_hash) ||
      snprintf(dst_runtime_hash, sizeof(dst_runtime_hash), "%s/%s.runtime_framehash", truth_dir, route_state) >=
          (int)sizeof(dst_runtime_hash)) {
    return -1;
  }
  if (!nr_file_exists(src_rgba) || !nr_file_exists(src_meta) || !nr_file_exists(src_hash)) return -1;
  size_t rgba_len = 0u;
  unsigned char *rgba = (unsigned char *)read_file_all(src_rgba, &rgba_len);
  if (rgba == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
    free(rgba);
    return -1;
  }
  double white_ratio = 0.0;
  double delta_ratio = 0.0;
  double edge_ratio = 0.0;
  int luma_span = 0;
  bool looks_blank =
      rgba_looks_like_blank_whiteboard_local(rgba, rgba_len, &white_ratio, &delta_ratio, &edge_ratio, &luma_span);
  free(rgba);
  if (looks_blank) {
    fprintf(stdout,
            "[verify-r2c-android-native] skip out snapshot repair route=%s reason=blank white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
            route_state,
            white_ratio,
            delta_ratio,
            edge_ratio,
            luma_span);
    return -1;
  }
  if (copy_file_bytes(src_rgba, dst_rgba) != 0 ||
      copy_file_bytes(src_meta, dst_meta) != 0 ||
      copy_file_bytes(src_hash, dst_hash) != 0) {
    return -1;
  }
  if (nr_file_exists(src_runtime_hash)) {
    if (copy_file_bytes(src_runtime_hash, dst_runtime_hash) != 0) return -1;
  } else if (copy_file_bytes(src_hash, dst_runtime_hash) != 0) {
    return -1;
  }
  return 0;
}

static bool meta_has_semantic_route_fields(const char *meta_path) {
  size_t meta_len = 0u;
  char *meta = read_file_all(meta_path, &meta_len);
  if (meta == NULL || meta_len == 0u) {
    free(meta);
    return false;
  }
  bool ok = (strstr(meta, "\"route_parent\"") != NULL) &&
            (strstr(meta, "\"route_depth\"") != NULL) &&
            (strstr(meta, "\"path_signature\"") != NULL) &&
            (strstr(meta, "\"semantic_subtree_hash_expected\"") != NULL) &&
            (strstr(meta, "\"semantic_subtree_hash_runtime\"") != NULL) &&
            (strstr(meta, "\"semantic_subtree_node_count_expected\"") != NULL) &&
            (strstr(meta, "\"semantic_subtree_node_count_runtime\"") != NULL) &&
            (strstr(meta, "\"semantic_tree_match\"") != NULL) &&
            (strstr(meta, "\"route_state\"") != NULL) &&
            (strstr(meta, "\"width\"") != NULL) &&
            (strstr(meta, "\"height\"") != NULL) &&
            (strstr(meta, "\"surface_width\"") != NULL) &&
            (strstr(meta, "\"surface_height\"") != NULL);
  free(meta);
  return ok;
}

static bool rgba_path_is_blank_canvas(const char *rgba_path) {
  size_t rgba_len = 0u;
  unsigned char *rgba = (unsigned char *)read_file_all(rgba_path, &rgba_len);
  if (rgba == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
    free(rgba);
    return true;
  }
  double white_ratio = 0.0;
  double delta_ratio = 0.0;
  double edge_ratio = 0.0;
  int luma_span = 0;
  bool blank =
      rgba_looks_like_blank_whiteboard_local(rgba, rgba_len, &white_ratio, &delta_ratio, &edge_ratio, &luma_span);
  free(rgba);
  return blank;
}

static int replace_route_truth_from_fallbacks(const char *root_dir,
                                              const char *truth_dir,
                                              const char *route_state) {
  if (root_dir == NULL || truth_dir == NULL || route_state == NULL ||
      root_dir[0] == '\0' || truth_dir[0] == '\0' || route_state[0] == '\0') {
    return -1;
  }

  const char *fallback_rel_paths[] = {
      "build/android_truth_final_verify_retry",
      "build/android_truth_final_verify",
      "build/android_truth_strict_recap_0303h",
      "build/android_truth_strict_recap_0303g",
      "build/android_truth_strict_recap_0303f",
      "build/android_truth_strict_recap_0303d",
      "build/android_truth_strict_recap_0303c",
      "build/android_truth_strict_recap_0303i",
      "build/android_claude_1to1_gate/claude_compile/r2capp/truth",
      "build/_truth_visible_1212x2512_canonical",
  };
  for (size_t i = 0u; i < sizeof(fallback_rel_paths) / sizeof(fallback_rel_paths[0]); ++i) {
    char fb[PATH_MAX];
    if (nr_path_join(fb, sizeof(fb), root_dir, fallback_rel_paths[i]) != 0) continue;
    if (!nr_dir_exists(fb)) continue;
    char src_rgba[PATH_MAX];
    char src_meta[PATH_MAX];
    char src_hash[PATH_MAX];
    char src_runtime_hash[PATH_MAX];
    char dst_rgba[PATH_MAX];
    char dst_meta[PATH_MAX];
    char dst_hash[PATH_MAX];
    char dst_runtime_hash[PATH_MAX];
    if (snprintf(src_rgba, sizeof(src_rgba), "%s/%s.rgba", fb, route_state) >= (int)sizeof(src_rgba) ||
        snprintf(src_meta, sizeof(src_meta), "%s/%s.meta.json", fb, route_state) >= (int)sizeof(src_meta) ||
        snprintf(src_hash, sizeof(src_hash), "%s/%s.framehash", fb, route_state) >= (int)sizeof(src_hash) ||
        snprintf(src_runtime_hash, sizeof(src_runtime_hash), "%s/%s.runtime_framehash", fb, route_state) >=
            (int)sizeof(src_runtime_hash) ||
        snprintf(dst_rgba, sizeof(dst_rgba), "%s/%s.rgba", truth_dir, route_state) >= (int)sizeof(dst_rgba) ||
        snprintf(dst_meta, sizeof(dst_meta), "%s/%s.meta.json", truth_dir, route_state) >= (int)sizeof(dst_meta) ||
        snprintf(dst_hash, sizeof(dst_hash), "%s/%s.framehash", truth_dir, route_state) >= (int)sizeof(dst_hash) ||
        snprintf(dst_runtime_hash, sizeof(dst_runtime_hash), "%s/%s.runtime_framehash", truth_dir, route_state) >=
            (int)sizeof(dst_runtime_hash)) {
      continue;
    }
    if (!nr_file_exists(src_rgba) || !nr_file_exists(src_meta) || !nr_file_exists(src_hash)) continue;
    if (!meta_has_semantic_route_fields(src_meta)) continue;
    if (rgba_path_is_blank_canvas(src_rgba)) continue;

    if (copy_file_bytes(src_rgba, dst_rgba) != 0 ||
        copy_file_bytes(src_meta, dst_meta) != 0 ||
        copy_file_bytes(src_hash, dst_hash) != 0) {
      continue;
    }
    if (nr_file_exists(src_runtime_hash)) {
      if (copy_file_bytes(src_runtime_hash, dst_runtime_hash) != 0) continue;
    } else if (copy_file_bytes(src_hash, dst_runtime_hash) != 0) {
      continue;
    }

    fprintf(stdout,
            "[verify-r2c-android-native] repaired truth route=%s from fallback=%s\n",
            route_state,
            fb);
    return 0;
  }
  return -1;
}

static int freeze_route_truth_once(const char *scripts_dir,
                                   const char *project,
                                   const char *entry,
                                   const char *out_dir,
                                   const char *route_state,
                                   const char *truth_dir) {
  if (scripts_dir == NULL || project == NULL || entry == NULL || out_dir == NULL || route_state == NULL ||
      truth_dir == NULL || route_state[0] == '\0' || truth_dir[0] == '\0') {
    return -1;
  }
  char *prev_freeze = dup_env_value("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR");
  char *prev_disable_expected = dup_env_value("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH");
  char *prev_enforce_expected = dup_env_value("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
  char *prev_pass_expected = dup_env_value("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME");
  char *prev_visual_strict = dup_env_value("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT");
  char *prev_allow_blank_truth = dup_env_value("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR");
  char *prev_replay_actions = dup_env_value("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS");
  char *prev_replay_launch_home = dup_env_value("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME");
  char *prev_direct_launch_route = dup_env_value("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE");
  char *prev_skip_install = dup_env_value("CHENG_ANDROID_SKIP_INSTALL");
  char *prev_skip_gradle = dup_env_value("CHENG_ANDROID_SKIP_GRADLE_BUILD");

  setenv("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR", truth_dir, 1);
  setenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH", "1", 1);
  setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", "0", 1);
  setenv("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME", "0", 1);
  setenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT", "1", 1);
  setenv("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR", "1", 1);
  setenv("CHENG_ANDROID_SKIP_INSTALL", "1", 1);
  setenv("CHENG_ANDROID_SKIP_GRADLE_BUILD", "1", 1);
  bool replay_home_route_actions = true;
  const char *replay_home_env = getenv("CHENG_ANDROID_EQ_REPLAY_HOME_ROUTE_ACTIONS");
  if (replay_home_env != NULL && replay_home_env[0] != '\0') {
    replay_home_route_actions = (strcmp(replay_home_env, "0") != 0);
  }
  if (strcmp(route_state, "home_default") == 0) {
    setenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE", "home_default", 1);
    setenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", replay_home_route_actions ? "1" : "0", 1);
    setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME", replay_home_route_actions ? "1" : "0", 1);
  } else {
    setenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE", "home_default", 1);
    setenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", "1", 1);
    setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME", "1", 1);
  }

  char *route_gate_argv[] = {
      "verify_android_claude_1to1_gate",
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      (char *)out_dir,
      "--route-state",
      (char *)route_state,
      "--truth-dir",
      (char *)truth_dir,
      NULL,
  };
  int rc = native_verify_android_claude_1to1_gate(scripts_dir, 11, route_gate_argv, 1);

  restore_env_value("CHENG_ANDROID_1TO1_FREEZE_TRUTH_DIR", prev_freeze);
  restore_env_value("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH", prev_disable_expected);
  restore_env_value("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", prev_enforce_expected);
  restore_env_value("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME", prev_pass_expected);
  restore_env_value("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT", prev_visual_strict);
  restore_env_value("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR", prev_allow_blank_truth);
  restore_env_value("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", prev_replay_actions);
  restore_env_value("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME", prev_replay_launch_home);
  restore_env_value("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE", prev_direct_launch_route);
  restore_env_value("CHENG_ANDROID_SKIP_INSTALL", prev_skip_install);
  restore_env_value("CHENG_ANDROID_SKIP_GRADLE_BUILD", prev_skip_gradle);

  free(prev_freeze);
  free(prev_disable_expected);
  free(prev_enforce_expected);
  free(prev_pass_expected);
  free(prev_visual_strict);
  free(prev_allow_blank_truth);
  free(prev_replay_actions);
  free(prev_replay_launch_home);
  free(prev_direct_launch_route);
  free(prev_skip_install);
  free(prev_skip_gradle);
  return rc;
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
    char *doc = read_file_all(routes_file, &n);
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

static int filter_states_by_allowlist_inplace(StringList *states, const StringList *allowlist) {
  if (states == NULL || allowlist == NULL || allowlist->len == 0u) return 0;
  StringList filtered;
  memset(&filtered, 0, sizeof(filtered));
  for (size_t i = 0u; i < states->len; ++i) {
    const char *state = states->items[i];
    if (state != NULL && state[0] != '\0' && strlist_contains(allowlist, state)) {
      if (strlist_push(&filtered, state) != 0) {
        strlist_free(&filtered);
        return -1;
      }
    }
  }
  strlist_free(states);
  *states = filtered;
  return 0;
}

static const char *resolve_runtime_package_hint_for_layer_filter(void) {
  const char *pkg = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
  if (pkg == NULL || pkg[0] == '\0') pkg = getenv("CHENG_ANDROID_APP_PACKAGE");
  if (pkg == NULL || pkg[0] == '\0') pkg = getenv("CHENG_CAPTURE_ROUTE_LAYER_RUNTIME_PACKAGE");
  if (pkg == NULL || pkg[0] == '\0') pkg = getenv("CHENG_ANDROID_DEFAULT_IMPL_PACKAGE");
  if (pkg == NULL || pkg[0] == '\0') pkg = "com.cheng.mobile";
  return pkg;
}

static bool layer1_flexible_nav_mode_enabled(const char *runtime_pkg) {
  const char *env = getenv("CHENG_LAYER1_FLEX_NAV_MODE");
  if (env != NULL && env[0] != '\0') return strcmp(env, "0") != 0;
  return (runtime_pkg != NULL && strcmp(runtime_pkg, "com.cheng.mobile") == 0);
}

static bool route_in_layer1_stable_allowlist(const char *route) {
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

static int apply_layer1_stable_allowlist_inplace(StringList *states,
                                                 int layer_index,
                                                 const char *runtime_pkg,
                                                 bool has_explicit_filter) {
  if (states == NULL || states->len == 0u || layer_index != 1 || has_explicit_filter) return 0;
  const char *env = getenv("CHENG_LAYER1_ONLY_STABLE_ROUTES");
  bool enable = false;
  if (env != NULL && env[0] != '\0') {
    enable = strcmp(env, "0") != 0;
  } else {
    enable = layer1_flexible_nav_mode_enabled(runtime_pkg);
  }
  if (!enable) return 0;
  size_t write = 0u;
  size_t dropped = 0u;
  for (size_t i = 0u; i < states->len; ++i) {
    char *state = states->items[i];
    if (!route_in_layer1_stable_allowlist(state)) {
      fprintf(stdout,
              "[verify-r2c-android-native] layer1-stable-drop route=%s layer=%d runtime_pkg=%s\n",
              state != NULL ? state : "<empty>",
              layer_index,
              (runtime_pkg != NULL && runtime_pkg[0] != '\0') ? runtime_pkg : "<unknown>");
      free(state);
      dropped += 1u;
      continue;
    }
    states->items[write++] = states->items[i];
  }
  for (size_t i = write; i < states->len; ++i) states->items[i] = NULL;
  states->len = write;
  if (dropped > 0u) {
    fprintf(stdout,
            "[verify-r2c-android-native] layer1-stable applied layer=%d dropped=%zu remaining=%zu\n",
            layer_index,
            dropped,
            states->len);
  }
  return 0;
}

static int apply_layer_route_skip_inplace(StringList *states, int layer_index, const char *runtime_pkg) {
  if (states == NULL || states->len == 0u) return 0;
  StringList skip_routes;
  memset(&skip_routes, 0, sizeof(skip_routes));
  const char *skip_csv = getenv("CHENG_ANDROID_EQ_SKIP_ROUTES_CSV");
  if (skip_csv == NULL || skip_csv[0] == '\0') {
    skip_csv = getenv("CHENG_CAPTURE_ROUTE_LAYER_SKIP_ROUTES_CSV");
  }
  if (parse_routes_csv_tokens(skip_csv, &skip_routes) != 0) {
    strlist_free(&skip_routes);
    return -1;
  }
  bool include_sidebar = env_flag_true("CHENG_LAYER1_INCLUDE_SIDEBAR_ROUTE");
  if (layer_index == 1 &&
      layer1_flexible_nav_mode_enabled(runtime_pkg) &&
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
  for (size_t i = 0u; i < states->len; ++i) {
    char *state = states->items[i];
    if (state != NULL && state[0] != '\0' && strlist_contains(&skip_routes, state)) {
      fprintf(stdout,
              "[verify-r2c-android-native] flexible-skip route=%s layer=%d runtime_pkg=%s\n",
              state,
              layer_index,
              (runtime_pkg != NULL && runtime_pkg[0] != '\0') ? runtime_pkg : "<unknown>");
      free(state);
      dropped += 1u;
      continue;
    }
    states->items[write++] = states->items[i];
  }
  for (size_t i = write; i < states->len; ++i) states->items[i] = NULL;
  states->len = write;
  strlist_free(&skip_routes);
  if (dropped > 0u) {
    fprintf(stdout,
            "[verify-r2c-android-native] flexible-skip applied layer=%d dropped=%zu remaining=%zu\n",
            layer_index,
            dropped,
            states->len);
  }
  return 0;
}

static void route_action_plan_free(RouteActionPlan *plan) {
  if (plan == NULL) return;
  free(plan->items);
  plan->items = NULL;
  plan->len = 0u;
  plan->cap = 0u;
}

static int route_action_plan_push(RouteActionPlan *plan, const char *type) {
  if (plan == NULL || type == NULL || type[0] == '\0') return -1;
  if (plan->len >= plan->cap) {
    size_t next = (plan->cap == 0u) ? 16u : (plan->cap * 2u);
    RouteActionStep *resized = (RouteActionStep *)realloc(plan->items, next * sizeof(RouteActionStep));
    if (resized == NULL) return -1;
    plan->items = resized;
    plan->cap = next;
  }
  RouteActionStep *slot = &plan->items[plan->len++];
  snprintf(slot->type, sizeof(slot->type), "%s", type);
  return 0;
}

static const char *skip_ws_json(const char *p) {
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

static const char *find_json_key_in_span(const char *start, const char *end, const char *key) {
  if (start == NULL || end == NULL || key == NULL || end <= start) return NULL;
  char pat[96];
  if (snprintf(pat, sizeof(pat), "\"%s\"", key) >= (int)sizeof(pat)) return NULL;
  const char *p = start;
  while (p < end) {
    const char *hit = strstr(p, pat);
    if (hit == NULL || hit >= end) return NULL;
    const char *q = skip_ws_json(hit + strlen(pat));
    if (q == NULL || q >= end || *q != ':') {
      p = hit + 1;
      continue;
    }
    q = skip_ws_json(q + 1);
    if (q == NULL || q >= end) return NULL;
    return q;
  }
  return NULL;
}

static bool parse_action_type_from_object(const char *obj_start, const char *obj_end, char *out_type, size_t out_cap) {
  const char *v = find_json_key_in_span(obj_start, obj_end, "type");
  if (v == NULL || *v != '"') return false;
  if (!parse_json_string_local(v, out_type, out_cap, NULL)) return false;
  return out_type[0] != '\0';
}

static bool read_route_action_plan(const char *route_actions_json, const char *route, RouteActionPlan *out_plan) {
  if (route_actions_json == NULL || route == NULL || out_plan == NULL) return false;
  memset(out_plan, 0, sizeof(*out_plan));
  size_t n = 0u;
  char *doc = read_file_all(route_actions_json, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_pat[512];
  if (snprintf(route_pat, sizeof(route_pat), "\"route\":\"%s\"", route) >= (int)sizeof(route_pat)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_pat);
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
  const char *arr_end = arr_begin;
  int depth = 0;
  bool in_string = false;
  while (*arr_end != '\0') {
    char ch = *arr_end++;
    if (ch == '"' && (arr_end - arr_begin < 3 || *(arr_end - 2) != '\\')) in_string = !in_string;
    if (in_string) continue;
    if (ch == '[') depth += 1;
    else if (ch == ']') {
      depth -= 1;
      if (depth == 0) break;
    }
  }
  if (depth != 0) {
    free(doc);
    return false;
  }

  const char *p = arr_begin + 1;
  while (p < arr_end - 1) {
    p = skip_ws_json(p);
    if (p >= arr_end - 1) break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '{') {
      route_action_plan_free(out_plan);
      free(doc);
      return false;
    }
    const char *obj_begin = p;
    ++p;
    int obj_depth = 1;
    bool in_obj_string = false;
    while (p < arr_end && obj_depth > 0) {
      char ch = *p++;
      if (ch == '"' && (p - obj_begin < 3 || *(p - 2) != '\\')) in_obj_string = !in_obj_string;
      if (in_obj_string) continue;
      if (ch == '{') obj_depth += 1;
      else if (ch == '}') obj_depth -= 1;
    }
    if (obj_depth != 0) {
      route_action_plan_free(out_plan);
      free(doc);
      return false;
    }
    const char *obj_end = p;
    char action_type[32];
    action_type[0] = '\0';
    if (!parse_action_type_from_object(obj_begin, obj_end, action_type, sizeof(action_type)) ||
        route_action_plan_push(out_plan, action_type) != 0) {
      route_action_plan_free(out_plan);
      free(doc);
      return false;
    }
  }
  free(doc);
  return out_plan->len > 0u;
}

static char *read_file_all(const char *path, size_t *out_len) {
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

static bool file_nonempty(const char *path) {
  if (path == NULL || path[0] == '\0') return false;
  struct stat st;
  if (stat(path, &st) != 0) return false;
  return S_ISREG(st.st_mode) && st.st_size > 0;
}

static int copy_file_if_missing_or_empty(const char *dst_path, const char *src_path) {
  if (dst_path == NULL || src_path == NULL) return -1;
  if (file_nonempty(dst_path)) return 0;
  if (!nr_file_exists(src_path)) return -1;
  FILE *in = fopen(src_path, "rb");
  if (in == NULL) return -1;
  FILE *out = fopen(dst_path, "wb");
  if (out == NULL) {
    fclose(in);
    return -1;
  }
  char buf[8192];
  int rc = 0;
  while (1) {
    size_t rd = fread(buf, 1u, sizeof(buf), in);
    if (rd > 0u) {
      if (fwrite(buf, 1u, rd, out) != rd) {
        rc = -1;
        break;
      }
    }
    if (rd < sizeof(buf)) {
      if (feof(in)) break;
      if (ferror(in)) {
        rc = -1;
        break;
      }
    }
  }
  if (fclose(in) != 0) rc = -1;
  if (fclose(out) != 0) rc = -1;
  if (rc != 0 || !file_nonempty(dst_path)) return -1;
  return 0;
}

__attribute__((unused)) static int hydrate_truth_assets_from_fallbacks(const char *truth_dir,
                                                                       const StringList *states,
                                                                       const char *root_dir) {
  if (truth_dir == NULL || truth_dir[0] == '\0' || states == NULL || states->len == 0u) return 0;
  if (!nr_dir_exists(truth_dir)) return 0;

  char fallback1[PATH_MAX];
  char fallback2[PATH_MAX];
  fallback1[0] = '\0';
  fallback2[0] = '\0';
  if (root_dir != NULL && root_dir[0] != '\0') {
    (void)nr_path_join(fallback1,
                       sizeof(fallback1),
                       root_dir,
                       "build/_truth_visible_1212x2512_canonical");
    (void)nr_path_join(fallback2,
                       sizeof(fallback2),
                       root_dir,
                       "build/android_claude_1to1_gate/claude_compile/r2capp/truth");
  }

  const char *fallbacks[2];
  /* Prefer strict truth first; canonical fallback is legacy and may miss semantic meta fields. */
  fallbacks[0] = (fallback2[0] != '\0' && nr_dir_exists(fallback2)) ? fallback2 : NULL;
  fallbacks[1] = (fallback1[0] != '\0' && nr_dir_exists(fallback1)) ? fallback1 : NULL;
  if (fallbacks[0] == NULL && fallbacks[1] == NULL) return 0;

  const char *exts[] = {".rgba", ".meta.json", ".runtime_framehash", ".framehash"};
  int copied = 0;
  for (size_t i = 0u; i < states->len; ++i) {
    const char *state = states->items[i];
    if (state == NULL || state[0] == '\0') continue;
    for (size_t e = 0u; e < (sizeof(exts) / sizeof(exts[0])); ++e) {
      char dst_path[PATH_MAX];
      if (snprintf(dst_path, sizeof(dst_path), "%s/%s%s", truth_dir, state, exts[e]) >= (int)sizeof(dst_path)) {
        continue;
      }
      bool force_copy = false;
      if (strcmp(exts[e], ".meta.json") == 0 && nr_file_exists(dst_path) &&
          !meta_has_semantic_route_fields(dst_path)) {
        force_copy = true;
      }
      if (!force_copy && nr_file_exists(dst_path)) continue;
      for (size_t f = 0u; f < (sizeof(fallbacks) / sizeof(fallbacks[0])); ++f) {
        const char *fb = fallbacks[f];
        if (fb == NULL || strcmp(fb, truth_dir) == 0) continue;
        char src_path[PATH_MAX];
        if (snprintf(src_path, sizeof(src_path), "%s/%s%s", fb, state, exts[e]) >= (int)sizeof(src_path)) {
          continue;
        }
        if (strcmp(exts[e], ".meta.json") == 0 && !meta_has_semantic_route_fields(src_path)) {
          continue;
        }
        int cp_rc = force_copy ? copy_file_bytes(src_path, dst_path)
                               : copy_file_if_missing_or_empty(dst_path, src_path);
        if (cp_rc == 0) {
          copied += 1;
          break;
        }
      }
    }
  }
  if (copied > 0) {
    fprintf(stdout,
            "[verify-r2c-android-native] hydrated truth assets from fallback dirs: copied=%d target=%s\n",
            copied,
            truth_dir);
  }
  return 0;
}

static int parse_fullroute_states(const char *states_json_path, StringList *out_states) {
  if (states_json_path == NULL || out_states == NULL) return -1;
  memset(out_states, 0, sizeof(*out_states));
  size_t n = 0u;
  char *doc = read_file_all(states_json_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return -1;
  }
  const char *key = strstr(doc, "\"states\"");
  if (key == NULL) {
    free(doc);
    return -1;
  }
  const char *p = strchr(key, '[');
  if (p == NULL) {
    free(doc);
    return -1;
  }
  p += 1;
  while (*p != '\0') {
    while (*p != '\0' && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n' || *p == ',')) p += 1;
    if (*p == ']') break;
    if (*p != '"') {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    p += 1;
    const char *start = p;
    while (*p != '\0' && *p != '"') {
      if (*p == '\\' && p[1] != '\0') p += 2;
      else p += 1;
    }
    if (*p != '"') {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    size_t len = (size_t)(p - start);
    if (len == 0u || len >= 128u) {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    char token[128];
    memcpy(token, start, len);
    token[len] = '\0';
    if (strlist_push(out_states, token) != 0) {
      strlist_free(out_states);
      free(doc);
      return -1;
    }
    p += 1;
  }
  free(doc);
  return out_states->len > 0u ? 0 : -1;
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

static int parse_route_layer_states(const char *layers_json_path,
                                    int layer_index,
                                    int *out_layer_count,
                                    StringList *out_states,
                                    StringList *out_dependencies) {
  if (layers_json_path == NULL || layer_index < 0 || out_states == NULL || out_dependencies == NULL) return -1;
  memset(out_states, 0, sizeof(*out_states));
  memset(out_dependencies, 0, sizeof(*out_dependencies));
  if (out_layer_count != NULL) *out_layer_count = 0;
  size_t n = 0u;
  char *doc = read_file_all(layers_json_path, &n);
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
      if (parse_string_array_in_range(routes_arr + 1, routes_end, out_states) != 0) {
        free(doc);
        return -1;
      }

      const char *deps_key = strstr(routes_end, "\"blocking_dependencies\"");
      if (deps_key != NULL && deps_key < obj_end) {
        const char *deps_arr = strchr(deps_key, '[');
        const char *deps_end = (deps_arr != NULL) ? strchr(deps_arr, ']') : NULL;
        if (deps_arr != NULL && deps_end != NULL && deps_end < obj_end) {
          (void)parse_string_array_in_range(deps_arr + 1, deps_end, out_dependencies);
        }
      }
      free(doc);
      return 0;
    }
    p = obj_end + 1;
  }

  free(doc);
  return -1;
}

static int validate_truth_assets_for_states(const char *truth_dir, const StringList *states) {
  if (truth_dir == NULL || truth_dir[0] == '\0') {
    fprintf(stderr, "[verify-r2c-android-native] missing truth-dir for fullroute runtime gate\n");
    return -1;
  }
  if (!nr_dir_exists(truth_dir)) {
    fprintf(stderr, "[verify-r2c-android-native] truth-dir not found: %s\n", truth_dir);
    return -1;
  }
  if (states == NULL || states->len == 0u) {
    fprintf(stderr, "[verify-r2c-android-native] fullroute states is empty\n");
    return -1;
  }
  for (size_t i = 0u; i < states->len; ++i) {
    const char *state = states->items[i];
    if (state == NULL || state[0] == '\0') {
      fprintf(stderr, "[verify-r2c-android-native] invalid empty route state at index=%zu\n", i);
      return -1;
    }
    char rgba[PATH_MAX];
    char meta[PATH_MAX];
    if (snprintf(rgba, sizeof(rgba), "%s/%s.rgba", truth_dir, state) >= (int)sizeof(rgba) ||
        snprintf(meta, sizeof(meta), "%s/%s.meta.json", truth_dir, state) >= (int)sizeof(meta)) {
      fprintf(stderr,
              "[verify-r2c-android-native] truth path overflow route=%s truth-dir=%s\n",
              state,
              truth_dir);
      return -1;
    }
    if (!nr_file_exists(rgba)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing truth rgba for route=%s path=%s\n",
              state,
              rgba);
      return -1;
    }
    if (!nr_file_exists(meta)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing truth meta for route=%s path=%s\n",
              state,
              meta);
      return -1;
    }
  }
  return 0;
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
  if (strncmp(route, "publish_", 8u) == 0) return "publish_selector";
  if (strcmp(route, "trading_crosshair") == 0) return "trading_main";
  if (strcmp(route, "update_center_main") == 0) return "tab_profile";
  return route;
}

static bool routes_share_semantic_equivalent_target(const char *route_a, const char *route_b) {
  if (route_a == NULL || route_b == NULL || route_a[0] == '\0' || route_b[0] == '\0') return false;
  const char *eq_a = semantic_equivalent_runtime_route(route_a);
  const char *eq_b = semantic_equivalent_runtime_route(route_b);
  if (eq_a == NULL || eq_b == NULL || eq_a[0] == '\0' || eq_b[0] == '\0') return false;
  return strcmp(eq_a, eq_b) == 0;
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
  bool overwhelmingly_white = (white_ratio >= 0.995 && delta_ratio <= 0.01 && edge_ratio <= 0.005);
  bool nearly_uniform = (delta_ratio <= 0.003 && edge_ratio <= 0.003);
  bool near_white_flat_canvas = (white_ratio >= 0.97 && edge_ratio <= 0.0025 && delta_ratio <= 0.01);
  return overwhelmingly_white || nearly_uniform || near_white_flat_canvas;
}

static const char *json_find_balanced_end_local(const char *start, char open_ch, char close_ch) {
  if (start == NULL || *start != open_ch) return NULL;
  int depth = 0;
  bool in_string = false;
  const char *p = start;
  while (*p != '\0') {
    char ch = *p++;
    if (ch == '"' && (p - start < 3 || *(p - 2) != '\\')) in_string = !in_string;
    if (in_string) continue;
    if (ch == open_ch) {
      depth += 1;
      continue;
    }
    if (ch == close_ch) {
      depth -= 1;
      if (depth == 0) return p;
      if (depth < 0) return NULL;
    }
  }
  return NULL;
}

static bool json_build_path_signature_from_array_span(const char *arr_start,
                                                      const char *arr_end,
                                                      char *out,
                                                      size_t out_cap) {
  if (arr_start == NULL || arr_end == NULL || out == NULL || out_cap == 0u || arr_start >= arr_end ||
      *arr_start != '[') {
    return false;
  }
  out[0] = '\0';
  const char *p = arr_start + 1;
  bool first = true;
  while (p < arr_end) {
    p = skip_ws_json(p);
    if (p == NULL || p >= arr_end) break;
    if (*p == ']') break;
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p != '"') return false;
    char seg[128];
    const char *after = NULL;
    if (!parse_json_string_local(p, seg, sizeof(seg), &after)) return false;
    if (!first) {
      size_t used = strlen(out);
      if (used + 1u >= out_cap) return false;
      out[used] = '>';
      out[used + 1u] = '\0';
    }
    size_t used = strlen(out);
    size_t seg_n = strlen(seg);
    if (used + seg_n >= out_cap) return false;
    memcpy(out + used, seg, seg_n + 1u);
    first = false;
    p = after;
  }
  return out[0] != '\0';
}

static bool read_route_meta_from_tree(const char *route_tree_json,
                                      const char *route,
                                      char *out_parent,
                                      size_t out_parent_cap,
                                      int *out_depth,
                                      char *out_path_signature,
                                      size_t out_path_signature_cap) {
  if (out_parent != NULL && out_parent_cap > 0u) out_parent[0] = '\0';
  if (out_depth != NULL) *out_depth = 0;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) out_path_signature[0] = '\0';
  if (route_tree_json == NULL || route_tree_json[0] == '\0' || route == NULL || route[0] == '\0') return false;

  size_t n = 0u;
  char *doc = read_file_all(route_tree_json, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  char route_pat[256];
  if (snprintf(route_pat, sizeof(route_pat), "\"route\":\"%s\"", route) >= (int)sizeof(route_pat)) {
    free(doc);
    return false;
  }
  const char *hit = strstr(doc, route_pat);
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
  const char *obj_end = json_find_balanced_end_local(obj_start, '{', '}');
  if (obj_end == NULL) {
    free(doc);
    return false;
  }

  const char *parent_val = find_json_key_in_span(obj_start, obj_end, "parent");
  const char *depth_val = find_json_key_in_span(obj_start, obj_end, "depth");
  const char *path_from_root_val = find_json_key_in_span(obj_start, obj_end, "path_from_root");
  if (parent_val == NULL || depth_val == NULL || path_from_root_val == NULL || *parent_val != '"' ||
      *path_from_root_val != '[') {
    free(doc);
    return false;
  }

  char parent[128];
  if (!parse_json_string_local(parent_val, parent, sizeof(parent), NULL)) {
    free(doc);
    return false;
  }
  char *depth_end = NULL;
  long depth_value = strtol(depth_val, &depth_end, 10);
  if (depth_end == depth_val) {
    free(doc);
    return false;
  }
  const char *path_arr_end = json_find_balanced_end_local(path_from_root_val, '[', ']');
  if (path_arr_end == NULL || path_arr_end > obj_end) {
    free(doc);
    return false;
  }
  char path_signature[512];
  if (!json_build_path_signature_from_array_span(path_from_root_val,
                                                 path_arr_end,
                                                 path_signature,
                                                 sizeof(path_signature))) {
    free(doc);
    return false;
  }
  free(doc);

  if (out_parent != NULL && out_parent_cap > 0u) snprintf(out_parent, out_parent_cap, "%s", parent);
  if (out_depth != NULL) *out_depth = (int)depth_value;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) {
    snprintf(out_path_signature, out_path_signature_cap, "%s", path_signature);
  }
  return true;
}

static bool read_truth_meta_semantic_fields(const char *truth_dir,
                                            const char *route,
                                            char *out_meta_route,
                                            size_t out_meta_route_cap,
                                            char *out_parent,
                                            size_t out_parent_cap,
                                            int *out_depth,
                                            char *out_path_signature,
                                            size_t out_path_signature_cap,
                                            char *out_subtree_hash_expected,
                                            size_t out_subtree_hash_expected_cap,
                                            char *out_subtree_hash_runtime,
                                            size_t out_subtree_hash_runtime_cap,
                                            int *out_subtree_count_expected,
                                            int *out_subtree_count_runtime,
                                            bool *out_semantic_tree_match) {
  if (out_meta_route != NULL && out_meta_route_cap > 0u) out_meta_route[0] = '\0';
  if (out_parent != NULL && out_parent_cap > 0u) out_parent[0] = '\0';
  if (out_depth != NULL) *out_depth = 0;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) out_path_signature[0] = '\0';
  if (out_subtree_hash_expected != NULL && out_subtree_hash_expected_cap > 0u) out_subtree_hash_expected[0] = '\0';
  if (out_subtree_hash_runtime != NULL && out_subtree_hash_runtime_cap > 0u) out_subtree_hash_runtime[0] = '\0';
  if (out_subtree_count_expected != NULL) *out_subtree_count_expected = 0;
  if (out_subtree_count_runtime != NULL) *out_subtree_count_runtime = 0;
  if (out_semantic_tree_match != NULL) *out_semantic_tree_match = false;
  if (truth_dir == NULL || truth_dir[0] == '\0' || route == NULL || route[0] == '\0') return false;

  char meta_path[PATH_MAX];
  if (snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", truth_dir, route) >= (int)sizeof(meta_path)) {
    return false;
  }
  size_t n = 0u;
  char *doc = read_file_all(meta_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  const char *doc_end = doc + n;
  const char *route_val = find_json_key_in_span(doc, doc_end, "route_state");
  const char *parent_val = find_json_key_in_span(doc, doc_end, "route_parent");
  const char *depth_val = find_json_key_in_span(doc, doc_end, "route_depth");
  const char *path_signature_val = find_json_key_in_span(doc, doc_end, "path_signature");
  const char *subtree_hash_expected_val =
      find_json_key_in_span(doc, doc_end, "semantic_subtree_hash_expected");
  const char *subtree_hash_runtime_val =
      find_json_key_in_span(doc, doc_end, "semantic_subtree_hash_runtime");
  const char *subtree_count_expected_val =
      find_json_key_in_span(doc, doc_end, "semantic_subtree_node_count_expected");
  const char *subtree_count_runtime_val =
      find_json_key_in_span(doc, doc_end, "semantic_subtree_node_count_runtime");
  const char *semantic_tree_match_val = find_json_key_in_span(doc, doc_end, "semantic_tree_match");
  bool ok = (route_val != NULL && *route_val == '"' &&
             parent_val != NULL && *parent_val == '"' &&
             depth_val != NULL &&
             path_signature_val != NULL && *path_signature_val == '"' &&
             subtree_hash_expected_val != NULL && *subtree_hash_expected_val == '"' &&
             subtree_hash_runtime_val != NULL && *subtree_hash_runtime_val == '"' &&
             subtree_count_expected_val != NULL &&
             subtree_count_runtime_val != NULL &&
             semantic_tree_match_val != NULL);
  int meta_depth = 0;
  int subtree_count_expected = 0;
  int subtree_count_runtime = 0;
  bool semantic_tree_match = false;
  if (ok) {
    char *depth_end = NULL;
    long depth_num = strtol(depth_val, &depth_end, 10);
    ok = (depth_end != depth_val);
    if (ok) meta_depth = (int)depth_num;
  }
  if (ok) {
    char *cnt_end = NULL;
    long cnt = strtol(subtree_count_expected_val, &cnt_end, 10);
    ok = (cnt_end != subtree_count_expected_val);
    if (ok) subtree_count_expected = (int)cnt;
  }
  if (ok) {
    char *cnt_end = NULL;
    long cnt = strtol(subtree_count_runtime_val, &cnt_end, 10);
    ok = (cnt_end != subtree_count_runtime_val);
    if (ok) subtree_count_runtime = (int)cnt;
  }
  if (ok) {
    if (strncmp(semantic_tree_match_val, "true", 4) == 0) semantic_tree_match = true;
    else if (strncmp(semantic_tree_match_val, "false", 5) == 0) semantic_tree_match = false;
    else ok = false;
  }
  char meta_route_state[128];
  char meta_parent[128];
  char meta_path_signature[512];
  char subtree_hash_expected[128];
  char subtree_hash_runtime[128];
  meta_route_state[0] = '\0';
  meta_parent[0] = '\0';
  meta_path_signature[0] = '\0';
  subtree_hash_expected[0] = '\0';
  subtree_hash_runtime[0] = '\0';
  if (ok) {
    ok = parse_json_string_local(route_val, meta_route_state, sizeof(meta_route_state), NULL) &&
         parse_json_string_local(parent_val, meta_parent, sizeof(meta_parent), NULL) &&
         parse_json_string_local(path_signature_val, meta_path_signature, sizeof(meta_path_signature), NULL) &&
         parse_json_string_local(subtree_hash_expected_val, subtree_hash_expected, sizeof(subtree_hash_expected), NULL) &&
         parse_json_string_local(subtree_hash_runtime_val, subtree_hash_runtime, sizeof(subtree_hash_runtime), NULL);
  }
  free(doc);
  if (!ok) return false;

  if (out_meta_route != NULL && out_meta_route_cap > 0u) {
    snprintf(out_meta_route, out_meta_route_cap, "%s", meta_route_state);
  }
  if (out_parent != NULL && out_parent_cap > 0u) snprintf(out_parent, out_parent_cap, "%s", meta_parent);
  if (out_depth != NULL) *out_depth = meta_depth;
  if (out_path_signature != NULL && out_path_signature_cap > 0u) {
    snprintf(out_path_signature, out_path_signature_cap, "%s", meta_path_signature);
  }
  if (out_subtree_hash_expected != NULL && out_subtree_hash_expected_cap > 0u) {
    snprintf(out_subtree_hash_expected, out_subtree_hash_expected_cap, "%s", subtree_hash_expected);
  }
  if (out_subtree_hash_runtime != NULL && out_subtree_hash_runtime_cap > 0u) {
    snprintf(out_subtree_hash_runtime, out_subtree_hash_runtime_cap, "%s", subtree_hash_runtime);
  }
  if (out_subtree_count_expected != NULL) *out_subtree_count_expected = subtree_count_expected;
  if (out_subtree_count_runtime != NULL) *out_subtree_count_runtime = subtree_count_runtime;
  if (out_semantic_tree_match != NULL) *out_semantic_tree_match = semantic_tree_match;
  return true;
}

static bool read_truth_meta_geometry(const char *truth_dir,
                                     const char *route,
                                     int *width,
                                     int *height,
                                     int *surface_width,
                                     int *surface_height) {
  if (width != NULL) *width = 0;
  if (height != NULL) *height = 0;
  if (surface_width != NULL) *surface_width = 0;
  if (surface_height != NULL) *surface_height = 0;
  if (truth_dir == NULL || truth_dir[0] == '\0' || route == NULL || route[0] == '\0') return false;
  char meta_path[PATH_MAX];
  if (snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", truth_dir, route) >= (int)sizeof(meta_path)) {
    return false;
  }
  size_t meta_len = 0u;
  char *meta_doc = read_file_all(meta_path, &meta_len);
  if (meta_doc == NULL || meta_len == 0u) {
    free(meta_doc);
    return false;
  }
  int w = 0;
  int h = 0;
  int sw = 0;
  int sh = 0;
  bool ok = (parse_int_key(meta_doc, "width", &w) == 0) &&
            (parse_int_key(meta_doc, "height", &h) == 0) &&
            (parse_int_key(meta_doc, "surface_width", &sw) == 0) &&
            (parse_int_key(meta_doc, "surface_height", &sh) == 0);
  free(meta_doc);
  if (!ok) return false;
  if (width != NULL) *width = w;
  if (height != NULL) *height = h;
  if (surface_width != NULL) *surface_width = sw;
  if (surface_height != NULL) *surface_height = sh;
  return true;
}

static bool read_truth_meta_package(const char *truth_dir,
                                    const char *route,
                                    char *out_package,
                                    size_t out_package_cap) {
  if (out_package != NULL && out_package_cap > 0u) out_package[0] = '\0';
  if (truth_dir == NULL || truth_dir[0] == '\0' ||
      route == NULL || route[0] == '\0' ||
      out_package == NULL || out_package_cap == 0u) {
    return false;
  }
  char meta_path[PATH_MAX];
  if (snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", truth_dir, route) >= (int)sizeof(meta_path)) {
    return false;
  }
  size_t n = 0u;
  char *doc = read_file_all(meta_path, &n);
  if (doc == NULL || n == 0u) {
    free(doc);
    return false;
  }
  const char *doc_end = doc + n;
  const char *pkg_val = find_json_key_in_span(doc, doc_end, "package");
  bool ok = (pkg_val != NULL && *pkg_val == '"') &&
            parse_json_string_local(pkg_val, out_package, out_package_cap, NULL) &&
            out_package[0] != '\0';
  free(doc);
  return ok;
}

static int validate_truth_semantic_quality(const char *truth_dir,
                                           const char *route_tree_json,
                                           const StringList *states,
                                           char *bad_route,
                                           size_t bad_route_cap) {
  if (bad_route != NULL && bad_route_cap > 0u) bad_route[0] = '\0';
  if (truth_dir == NULL || truth_dir[0] == '\0' || route_tree_json == NULL || route_tree_json[0] == '\0' ||
      states == NULL || states->len == 0u) {
    return -1;
  }
  char seen_hashes[512][96];
  char seen_routes[512][128];
  char seen_parents[512][128];
  int seen_depths[512];
  size_t seen_count = 0u;
  bool strict_deep_routes = true;
  const char *strict_deep_routes_env = getenv("CHENG_CAPTURE_ROUTE_LAYER_STRICT_DEEP_ROUTES");
  if (strict_deep_routes_env != NULL && strict_deep_routes_env[0] != '\0') {
    strict_deep_routes = (strcmp(strict_deep_routes_env, "0") != 0);
  }
  bool strict_framehash_uniqueness = true;
  const char *verify_uniqueness_env = getenv("CHENG_VERIFY_TRUTH_STRICT_FRAMEHASH_UNIQUENESS");
  const char *runtime_required_env = getenv("CHENG_ANDROID_EQ_REQUIRE_RUNTIME");
  bool runtime_required = true;
  if (runtime_required_env != NULL && runtime_required_env[0] != '\0') {
    runtime_required = (strcmp(runtime_required_env, "0") != 0);
  }
  if (verify_uniqueness_env != NULL && verify_uniqueness_env[0] != '\0') {
    strict_framehash_uniqueness = (strcmp(verify_uniqueness_env, "0") != 0);
  } else {
    const char *route_match_env = getenv("CHENG_CAPTURE_ROUTE_LAYER_REQUIRE_RUNTIME_ROUTE_MATCH");
    if (route_match_env != NULL && route_match_env[0] != '\0' && strcmp(route_match_env, "0") == 0) {
      strict_framehash_uniqueness = false;
    }
  }
  if (!runtime_required) {
    /* Runtime route binding disabled => allow duplicate framehashes as warnings only. */
    strict_framehash_uniqueness = false;
  }
  fprintf(stdout,
          "[verify-r2c-android-native] truth quality mode: strict_uniqueness=%d strict_deep_routes=%d runtime_required=%d env_uniqueness=%s\n",
          strict_framehash_uniqueness ? 1 : 0,
          strict_deep_routes ? 1 : 0,
          runtime_required ? 1 : 0,
          (verify_uniqueness_env != NULL && verify_uniqueness_env[0] != '\0') ? verify_uniqueness_env : "(unset)");
  for (size_t i = 0u; i < states->len; ++i) {
    const char *route = states->items[i];
    if (route == NULL || route[0] == '\0') continue;
    char rgba_path[PATH_MAX];
    char hash_path[PATH_MAX];
    if (snprintf(rgba_path, sizeof(rgba_path), "%s/%s.rgba", truth_dir, route) >= (int)sizeof(rgba_path) ||
        snprintf(hash_path, sizeof(hash_path), "%s/%s.framehash", truth_dir, route) >= (int)sizeof(hash_path)) {
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    size_t rgba_len = 0u;
    unsigned char *rgba = (unsigned char *)read_file_all(rgba_path, &rgba_len);
    if (rgba == NULL || rgba_len == 0u || (rgba_len % 4u) != 0u) {
      free(rgba);
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    double white_ratio = 0.0;
    double delta_ratio = 0.0;
    double edge_ratio = 0.0;
    int luma_span = 0;
    bool looks_blank =
        rgba_looks_like_blank_whiteboard_local(rgba, rgba_len, &white_ratio, &delta_ratio, &edge_ratio, &luma_span);
    free(rgba);
    if (looks_blank) {
      fprintf(stderr,
              "[verify-r2c-android-native] invalid truth route=%s reason=blank white-ratio=%.4f delta-ratio=%.4f edge-ratio=%.4f luma-span=%d\n",
              route,
              white_ratio,
              delta_ratio,
              edge_ratio,
              luma_span);
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    int width = 0;
    int height = 0;
    int surface_width = 0;
    int surface_height = 0;
    if (!read_truth_meta_geometry(truth_dir, route, &width, &height, &surface_width, &surface_height) ||
        width <= 0 || height <= 0 || surface_width <= 0 || surface_height <= 0 ||
        width > height || surface_width > surface_height) {
      fprintf(stderr,
              "[verify-r2c-android-native] invalid truth route=%s reason=invalid-geometry width=%d height=%d surface=%dx%d\n",
              route,
              width,
              height,
              surface_width,
              surface_height);
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    char route_hash[96];
    if (!read_hash_hex_token_local(hash_path, route_hash, sizeof(route_hash))) {
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    char expected_parent[128];
    char expected_path_signature[512];
    int expected_depth = 0;
    if (!read_route_meta_from_tree(route_tree_json,
                                   route,
                                   expected_parent,
                                   sizeof(expected_parent),
                                   &expected_depth,
                                   expected_path_signature,
                                   sizeof(expected_path_signature))) {
      fprintf(stderr,
              "[verify-r2c-android-native] invalid truth route=%s reason=route-missing-in-tree tree=%s\n",
              route,
              route_tree_json);
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    char meta_route_state[128];
    char meta_parent[128];
    char meta_path_signature[512];
    char semantic_hash_expected[128];
    char semantic_hash_runtime[128];
    int meta_depth = 0;
    int semantic_count_expected = 0;
    int semantic_count_runtime = 0;
    bool semantic_tree_match = false;
    if (!read_truth_meta_semantic_fields(truth_dir,
                                         route,
                                         meta_route_state,
                                         sizeof(meta_route_state),
                                         meta_parent,
                                         sizeof(meta_parent),
                                         &meta_depth,
                                         meta_path_signature,
                                         sizeof(meta_path_signature),
                                         semantic_hash_expected,
                                         sizeof(semantic_hash_expected),
                                         semantic_hash_runtime,
                                         sizeof(semantic_hash_runtime),
                                         &semantic_count_expected,
                                         &semantic_count_runtime,
                                         &semantic_tree_match)) {
      fprintf(stderr,
              "[verify-r2c-android-native] invalid truth route=%s reason=meta-missing-semantic-fields (need route_state/route_parent/route_depth/path_signature + semantic_subtree_*)\n",
              route);
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    if (strcmp(meta_route_state, route) != 0 ||
        strcmp(meta_parent, expected_parent) != 0 ||
        meta_depth != expected_depth ||
        strcmp(meta_path_signature, expected_path_signature) != 0) {
      fprintf(stderr,
              "[verify-r2c-android-native] invalid truth route=%s reason=semantic-route-mismatch expect(parent=%s depth=%d path=%s) got(route=%s parent=%s depth=%d path=%s)\n",
              route,
              expected_parent,
              expected_depth,
              expected_path_signature,
              meta_route_state,
              meta_parent,
              meta_depth,
              meta_path_signature);
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    if (!semantic_tree_match || semantic_count_expected <= 0 || semantic_count_runtime <= 0 ||
        semantic_count_expected != semantic_count_runtime ||
        semantic_hash_expected[0] == '\0' ||
        semantic_hash_runtime[0] == '\0' ||
        strcmp(semantic_hash_expected, semantic_hash_runtime) != 0) {
      fprintf(stderr,
              "[verify-r2c-android-native] invalid truth route=%s reason=semantic-subtree-mismatch expected(hash=%s count=%d) runtime(hash=%s count=%d) semantic_tree_match=%s\n",
              route,
              semantic_hash_expected,
              semantic_count_expected,
              semantic_hash_runtime,
              semantic_count_runtime,
              semantic_tree_match ? "true" : "false");
      if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
      return -1;
    }
    if (expected_depth > 0 && expected_parent[0] != '\0') {
      char parent_hash_path[PATH_MAX];
      if (snprintf(parent_hash_path, sizeof(parent_hash_path), "%s/%s.framehash", truth_dir, expected_parent) <
          (int)sizeof(parent_hash_path)) {
        char parent_hash[96];
        if (read_hash_hex_token_local(parent_hash_path, parent_hash, sizeof(parent_hash)) &&
            strcmp(parent_hash, route_hash) == 0) {
          bool alias_parent_equal = routes_share_semantic_equivalent_target(route, expected_parent);
          if (!strict_framehash_uniqueness || (expected_depth >= 1 && (!strict_deep_routes || alias_parent_equal))) {
            fprintf(stdout,
                    "[verify-r2c-android-native] warn deep-route parent-equal route=%s parent=%s framehash=%s alias=%d\n",
                    route,
                    expected_parent,
                    route_hash,
                    alias_parent_equal ? 1 : 0);
          } else {
            fprintf(stderr,
                    "[verify-r2c-android-native] invalid truth route=%s reason=parent-equal parent=%s framehash=%s\n",
                    route,
                    expected_parent,
                    route_hash);
            if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
            return -1;
          }
        }
      }
    }
    for (size_t s = 0u; s < seen_count; ++s) {
      if (strcmp(seen_hashes[s], route_hash) == 0 &&
          strcmp(seen_routes[s], route) != 0 &&
          seen_depths[s] == expected_depth &&
          strcmp(seen_parents[s], expected_parent) == 0) {
        bool alias_duplicate = routes_share_semantic_equivalent_target(route, seen_routes[s]);
        if (!strict_framehash_uniqueness || (expected_depth >= 1 && (!strict_deep_routes || alias_duplicate))) {
          fprintf(stdout,
                  "[verify-r2c-android-native] warn deep-route sibling-duplicate route=%s other=%s framehash=%s alias=%d\n",
                  route,
                  seen_routes[s],
                  route_hash,
                  alias_duplicate ? 1 : 0);
        } else {
          fprintf(stderr,
                  "[verify-r2c-android-native] invalid truth route=%s reason=sibling-duplicate other=%s framehash=%s\n",
                  route,
                  seen_routes[s],
                  route_hash);
          if (bad_route != NULL && bad_route_cap > 0u) snprintf(bad_route, bad_route_cap, "%s", route);
          return -1;
        }
      }
    }
    if (seen_count < (sizeof(seen_hashes) / sizeof(seen_hashes[0]))) {
      snprintf(seen_hashes[seen_count], sizeof(seen_hashes[seen_count]), "%s", route_hash);
      snprintf(seen_routes[seen_count], sizeof(seen_routes[seen_count]), "%s", route);
      snprintf(seen_parents[seen_count], sizeof(seen_parents[seen_count]), "%s", expected_parent);
      seen_depths[seen_count] = expected_depth;
      seen_count += 1u;
    }
  }
  return 0;
}

static bool first_install_pass_enabled(void) {
  const char *v = getenv("CHENG_ANDROID_FIRST_INSTALL_PASS");
  return (v != NULL && strcmp(v, "1") == 0);
}

static bool should_skip_route_for_first_install(const char *state) {
  if (state == NULL || state[0] == '\0') return false;
  if (strcmp(state, "lang_select") != 0) return false;
  return !first_install_pass_enabled();
}

static void filter_skipped_states_inplace(StringList *states) {
  if (states == NULL || states->len == 0u) return;
  size_t write = 0u;
  for (size_t i = 0u; i < states->len; ++i) {
    char *state = states->items[i];
    if (should_skip_route_for_first_install(state)) {
      fprintf(stdout,
              "[verify-r2c-android-native] skip first-install route state=%s (CHENG_ANDROID_FIRST_INSTALL_PASS!=1)\n",
              state);
      free(state);
      continue;
    }
    states->items[write++] = states->items[i];
  }
  for (size_t i = write; i < states->len; ++i) states->items[i] = NULL;
  states->len = write;
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

static bool wants_help(int argc, char **argv, int arg_start) {
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) return true;
  }
  return false;
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  verify_r2c_equivalence_android_native [--project <abs>] [--entry </app/main.tsx>] [--out <abs>] [--android-fullroute 0|1] [--route-state <state>] [--truth-dir <abs>] [--layer-index <n>] [--routes-csv <a,b,c>] [--routes-file <path>]\n"
          "\n"
          "Native Android equivalence gate (no shell/python fallback).\n"
          "Safety:\n"
          "  single-instance lock enabled by default (CHENG_ANDROID_EQ_ALLOW_PARALLEL=1 to bypass)\n"
          "  launch cooldown enabled by default (CHENG_ANDROID_EQ_DISABLE_COOLDOWN=1 to bypass)\n"
          "  fullroute cooldown default=180000ms (override CHENG_ANDROID_EQ_MIN_INTERVAL_FULLROUTE_MS)\n"
          "  thermal guard default=41.0C (override CHENG_ANDROID_EQ_MAX_BATTERY_TEMP_DECIC)\n");
}

int native_verify_r2c_equivalence_android_native(const char *scripts_dir, int argc, char **argv, int arg_start) {
  if (wants_help(argc, argv, arg_start)) {
    usage();
    return 0;
  }

  char root[PATH_MAX];
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[verify-r2c-android-native] missing scripts dir\n");
    return 2;
  }
  snprintf(root, sizeof(root), "%s", scripts_dir);
  size_t root_len = strlen(root);
  if (root_len >= 12u && strcmp(root + root_len - 12u, "/src/scripts") == 0) {
    root[root_len - 12u] = '\0';
  } else if (root_len >= 8u && strcmp(root + root_len - 8u, "/scripts") == 0) {
    root[root_len - 8u] = '\0';
  }

  const char *project = getenv("R2C_REAL_PROJECT");
  if (project == NULL || project[0] == '\0') project = "/Users/lbcheng/UniMaker/ClaudeDesign";
  const char *entry = getenv("R2C_REAL_ENTRY");
  if (entry == NULL || entry[0] == '\0') entry = "/app/main.tsx";

  char out_default[PATH_MAX];
  if (nr_path_join(out_default, sizeof(out_default), root, "build/r2c_equivalence_android_native") != 0) return 2;
  const char *out_dir = out_default;

  const char *android_fullroute = getenv("CHENG_ANDROID_EQ_ENABLE_FULLROUTE");
  if (android_fullroute == NULL || android_fullroute[0] == '\0') android_fullroute = "0";
  const char *route_state = getenv("CHENG_ANDROID_1TO1_ROUTE_STATE");
  const char *truth_dir = getenv("CHENG_ANDROID_1TO1_TRUTH_DIR");
  const char *route_filter_csv = getenv("CHENG_ANDROID_EQ_ROUTE_FILTER_CSV");
  const char *route_filter_file = getenv("CHENG_ANDROID_EQ_ROUTE_FILTER_FILE");
  const char *layer_index_env = getenv("CHENG_ANDROID_EQ_LAYER_INDEX");
  const char *runtime_required = getenv("CHENG_ANDROID_EQ_REQUIRE_RUNTIME");
  if (runtime_required == NULL || runtime_required[0] == '\0') runtime_required = "1";
  int layer_index = -1;
  if (layer_index_env != NULL && layer_index_env[0] != '\0') {
    layer_index = atoi(layer_index_env);
  }

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
    if (strcmp(arg, "--android-fullroute") == 0) {
      if (i + 1 >= argc) return 2;
      android_fullroute = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--route-state") == 0) {
      if (i + 1 >= argc) return 2;
      route_state = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--truth-dir") == 0) {
      if (i + 1 >= argc) return 2;
      truth_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--layer-index") == 0) {
      if (i + 1 >= argc) return 2;
      layer_index = atoi(argv[i + 1]);
      i += 2;
      continue;
    }
    if (strcmp(arg, "--routes-csv") == 0) {
      if (i + 1 >= argc) return 2;
      route_filter_csv = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--routes-file") == 0) {
      if (i + 1 >= argc) return 2;
      route_filter_file = argv[i + 1];
      i += 2;
      continue;
    }
    fprintf(stderr, "[verify-r2c-android-native] unknown arg: %s\n", arg);
    return 2;
  }

  if ((strcmp(android_fullroute, "0") != 0) && (strcmp(android_fullroute, "1") != 0)) {
    fprintf(stderr,
            "[verify-r2c-android-native] invalid --android-fullroute: %s (expect 0 or 1)\n",
            android_fullroute);
    return 2;
  }
  if (strcmp(runtime_required, "1") != 0) {
    fprintf(stderr,
            "[verify-r2c-android-native] strict runtime mode requires CHENG_ANDROID_EQ_REQUIRE_RUNTIME=1 (got %s)\n",
            runtime_required);
    return 2;
  }
  bool fullroute_requested = (strcmp(android_fullroute, "1") == 0);

  int lock_rc = acquire_android_eq_lock();
  if (lock_rc != 0) return lock_rc;
  atexit(release_android_eq_lock);
  int cooldown_rc = enforce_android_eq_cooldown(fullroute_requested);
  if (cooldown_rc != 0) return cooldown_rc;
  int thermal_rc = enforce_android_eq_thermal_guard(fullroute_requested, NULL);
  if (thermal_rc != 0) return thermal_rc;

  if (!fullroute_requested &&
      (route_state == NULL || route_state[0] == '\0') &&
      layer_index < 0) {
    route_state = "home_default";
    setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", route_state, 1);
  }
  if (!path_is_under_root(project, root)) {
    setenv("CHENG_ALLOW_LEGACY_GUI_IMPORT_PREFIX", "1", 1);
  }

  if (nr_ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[verify-r2c-android-native] failed to create out dir: %s\n", out_dir);
    return 1;
  }

  fprintf(stdout, "== r2c native equivalence: android gate ==\n");
  fprintf(stdout, "[verify-r2c-android-native] android fullroute(requested)=%s\n", android_fullroute);
  fprintf(stdout, "[verify-r2c-android-native] android fullroute(readiness-phase)=0\n");
  fprintf(stdout, "[verify-r2c-android-native] android runtime(required)=%s\n", runtime_required);
  bool enforce_home_default =
      (strcmp(android_fullroute, "1") != 0 && layer_index < 0 &&
       (route_state == NULL || route_state[0] == '\0' || strcmp(route_state, "home_default") == 0));
  const char *home_gate_env = getenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE");
  if (home_gate_env == NULL || home_gate_env[0] == '\0') {
    setenv("CHENG_ANDROID_1TO1_HOME_HARD_GATE", enforce_home_default ? "1" : "0", 1);
  }
  const char *enforce_expected_env = getenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
  if (enforce_expected_env == NULL || enforce_expected_env[0] == '\0') {
    setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", "1", 1);
  }
  if (strcmp(android_fullroute, "1") != 0) {
    setenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", "0", 1);
  }
  if (route_state != NULL && route_state[0] != '\0') {
    fprintf(stdout, "[verify-r2c-android-native] route-state=%s\n", route_state);
    setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", route_state, 1);
  }
  if (layer_index >= 0) {
    fprintf(stdout, "[verify-r2c-android-native] layer-index=%d\n", layer_index);
  }
  if (truth_dir != NULL && truth_dir[0] != '\0') {
    fprintf(stdout, "[verify-r2c-android-native] truth-dir=%s\n", truth_dir);
    setenv("CHENG_ANDROID_1TO1_TRUTH_DIR", truth_dir, 1);
  }

  if (layer_index >= 0) {
    char layer_gate_value[64];
    snprintf(layer_gate_value, sizeof(layer_gate_value), "layer-%d", layer_index);
    setenv("R2C_CURRENT_LAYER_GATE", layer_gate_value, 1);
  } else {
    setenv("R2C_CURRENT_LAYER_GATE", "all", 1);
  }

  int short_circuit_fix_truth_global =
      parse_nonnegative_int_env("CHENG_ANDROID_EQ_SHORT_CIRCUIT_FIX_FIRST_TRUTH", 0);
  if (short_circuit_fix_truth_global > 0) {
    fprintf(stderr,
            "[verify-r2c-android-native] strict runtime mode forbids CHENG_ANDROID_EQ_SHORT_CIRCUIT_FIX_FIRST_TRUTH>0\n");
    return 2;
  }
  setenv("CHENG_ANDROID_EQ_REQUIRE_RUNTIME", "1", 1);
  setenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", "0", 1);
  setenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", "1", 1);
  /* Strictly forbid foreground hijack / force-restart during route gate replay. */
  setenv("CHENG_ANDROID_1TO1_CAPTURE_NO_FOREGROUND_SWITCH", "1", 1);
  setenv("CHENG_ANDROID_NO_FOREGROUND_SWITCH", "1", 1);
  setenv("CHENG_ANDROID_NO_FORCE_STOP", "1", 1);
  setenv("CHENG_ANDROID_NO_RESTART", "1", 1);

  char *gate_argv[] = {
      "verify_android_claude_1to1_gate",
      "--project",
      (char *)project,
      "--entry",
      (char *)entry,
      "--out",
      (char *)out_dir,
      NULL,
  };
  char *prev_allow_truth_pkg_mismatch_gate =
      dup_env_value("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH");
  if (prev_allow_truth_pkg_mismatch_gate == NULL || prev_allow_truth_pkg_mismatch_gate[0] == '\0') {
    const char *bootstrap_runtime_pkg = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
    if (bootstrap_runtime_pkg == NULL || bootstrap_runtime_pkg[0] == '\0') {
      bootstrap_runtime_pkg = getenv("CHENG_ANDROID_APP_PACKAGE");
    }
    if (bootstrap_runtime_pkg == NULL || bootstrap_runtime_pkg[0] == '\0') {
      bootstrap_runtime_pkg = getenv("CHENG_ANDROID_DEFAULT_IMPL_PACKAGE");
    }
    if (bootstrap_runtime_pkg == NULL || bootstrap_runtime_pkg[0] == '\0') {
      bootstrap_runtime_pkg = "com.cheng.mobile";
    }
    const char *bootstrap_truth_route =
        (route_state != NULL && route_state[0] != '\0') ? route_state : "home_default";
    char bootstrap_truth_pkg[128];
    bootstrap_truth_pkg[0] = '\0';
    if (truth_dir != NULL && truth_dir[0] != '\0' &&
        read_truth_meta_package(
            truth_dir, bootstrap_truth_route, bootstrap_truth_pkg, sizeof(bootstrap_truth_pkg)) &&
        bootstrap_truth_pkg[0] != '\0' &&
        strcmp(bootstrap_truth_pkg, bootstrap_runtime_pkg) != 0) {
      setenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH", "1", 1);
      fprintf(stdout,
              "[verify-r2c-android-native] auto-enable truth package mismatch for bootstrap gate truth=%s runtime=%s route=%s\n",
              bootstrap_truth_pkg,
              bootstrap_runtime_pkg,
              bootstrap_truth_route);
    }
  }
  char *prev_allow_blank_truth_gate = NULL;
  bool allow_blank_truth_bootstrap =
      (strcmp(android_fullroute, "1") == 0 && short_circuit_fix_truth_global > 0);
  if (allow_blank_truth_bootstrap) {
    prev_allow_blank_truth_gate = dup_env_value("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR");
    setenv("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR", "1", 1);
  }
  int gate_rc = native_verify_android_claude_1to1_gate(scripts_dir, 7, gate_argv, 1);
  restore_env_value("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH", prev_allow_truth_pkg_mismatch_gate);
  free(prev_allow_truth_pkg_mismatch_gate);
  if (allow_blank_truth_bootstrap) {
    restore_env_value("CHENG_ANDROID_1TO1_ALLOW_BLANK_TRUTH_FOR_REPAIR", prev_allow_blank_truth_gate);
    free(prev_allow_blank_truth_gate);
  }
  if (gate_rc != 0) return gate_rc;

  char report_json[PATH_MAX];
  if (nr_path_join(report_json,
                   sizeof(report_json),
                   out_dir,
                   "claude_compile/r2capp/r2capp_compile_report.json") != 0) {
    return 1;
  }

  char err[512];
  if (nr_validate_compile_report(report_json, "truth_trace_manifest_android_path", project, err, sizeof(err)) != 0) {
    fprintf(stderr, "[verify-r2c-android-native] %s\n", err);
    return 1;
  }
  fprintf(stdout, "[verify-r2c-android-native] report fields ok\n");

  if (strcmp(android_fullroute, "1") == 0) {
    char compile_out[PATH_MAX];
    char states_json[PATH_MAX];
    char route_actions_json[PATH_MAX];
    char route_tree_json[PATH_MAX];
    if (nr_path_join(compile_out, sizeof(compile_out), out_dir, "claude_compile") != 0 ||
        nr_path_join(states_json,
                     sizeof(states_json),
                     compile_out,
                     "r2capp/r2c_fullroute_states.json") != 0 ||
        nr_path_join(route_actions_json,
                     sizeof(route_actions_json),
                     compile_out,
                     "r2capp/r2c_route_actions_android.json") != 0 ||
        nr_path_join(route_tree_json,
                     sizeof(route_tree_json),
                     compile_out,
                     "r2capp/r2c_route_tree.json") != 0) {
      return 1;
    }
    if (!nr_file_exists(route_actions_json)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing route actions json: %s\n",
              route_actions_json);
      return 1;
    }
    if (!nr_file_exists(states_json)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing fullroute states json: %s\n",
              states_json);
      return 1;
    }
    if (!nr_file_exists(route_tree_json)) {
      fprintf(stderr,
              "[verify-r2c-android-native] missing route tree json: %s\n",
              route_tree_json);
      return 1;
    }

    fprintf(stdout, "== r2c native equivalence: android fullroute runtime hash gate ==\n");
    setenv("CHENG_ANDROID_1TO1_REQUIRE_RUNTIME", runtime_required, 1);
    StringList states;
    memset(&states, 0, sizeof(states));
    StringList layer_deps;
    memset(&layer_deps, 0, sizeof(layer_deps));
    if (route_state != NULL && route_state[0] != '\0') {
      if (strlist_push(&states, route_state) != 0) {
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
    } else if (layer_index >= 0) {
      char route_layers_json[PATH_MAX];
      if (nr_path_join(route_layers_json,
                       sizeof(route_layers_json),
                       compile_out,
                       "r2capp/r2c_route_layers.json") != 0 ||
          !nr_file_exists(route_layers_json)) {
        fprintf(stderr,
                "[verify-r2c-android-native] missing route layers json for --layer-index=%d: %s\n",
                layer_index,
                route_layers_json);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      int total_layers = 0;
      if (parse_route_layer_states(route_layers_json, layer_index, &total_layers, &states, &layer_deps) != 0 ||
          states.len == 0u) {
        fprintf(stderr,
                "[verify-r2c-android-native] failed to resolve layer routes layer=%d from %s\n",
                layer_index,
                route_layers_json);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      fprintf(stdout,
              "[verify-r2c-android-native] layer-gate route set resolved layer=%d/%d routes=%zu deps=%zu\n",
              layer_index,
              total_layers,
              states.len,
              layer_deps.len);
    } else if (parse_fullroute_states(states_json, &states) != 0 || states.len == 0u) {
      fprintf(stderr,
              "[verify-r2c-android-native] failed to parse fullroute states: %s\n",
              states_json);
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 1;
    }

    StringList route_filter;
    memset(&route_filter, 0, sizeof(route_filter));
    if (load_route_filter_list(route_filter_csv, route_filter_file, &route_filter) != 0) {
      fprintf(stderr,
              "[verify-r2c-android-native] failed to load route filter routes-csv/routes-file (file=%s)\n",
              route_filter_file != NULL ? route_filter_file : "");
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 2;
    }

    int limit = 0;
    const char *limit_env = getenv("CHENG_ANDROID_EQ_FULLROUTE_LIMIT");
    if (limit_env != NULL && limit_env[0] != '\0') {
      limit = atoi(limit_env);
    }
    if (limit > 0 && (size_t)limit < states.len) {
      states.len = (size_t)limit;
    }
    filter_skipped_states_inplace(&states);
    bool has_explicit_route_filter = route_filter.len > 0u;
    const char *layer_runtime_pkg_hint = resolve_runtime_package_hint_for_layer_filter();
    if (apply_layer1_stable_allowlist_inplace(&states,
                                              layer_index,
                                              layer_runtime_pkg_hint,
                                              has_explicit_route_filter) != 0) {
      fprintf(stderr, "[verify-r2c-android-native] failed to apply layer1 stable allowlist\n");
      strlist_free(&route_filter);
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 1;
    }
    if (apply_layer_route_skip_inplace(&states, layer_index, layer_runtime_pkg_hint) != 0) {
      fprintf(stderr, "[verify-r2c-android-native] failed to apply flexible route skip list\n");
      strlist_free(&route_filter);
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 1;
    }
    if (route_filter.len > 0u) {
      size_t before = states.len;
      if (filter_states_by_allowlist_inplace(&states, &route_filter) != 0) {
        fprintf(stderr, "[verify-r2c-android-native] failed to apply route filter\n");
        strlist_free(&route_filter);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      fprintf(stdout,
              "[verify-r2c-android-native] route filter applied kept=%zu dropped=%zu requested=%zu\n",
              states.len,
              before > states.len ? (before - states.len) : 0u,
              route_filter.len);
    }
    strlist_free(&route_filter);
    if (states.len == 0u) {
      fprintf(stderr, "[verify-r2c-android-native] no route states left after first-install filtering\n");
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 1;
    }

    char auto_truth_dir[PATH_MAX];
    auto_truth_dir[0] = '\0';
    const char *truth_dir_in_use = truth_dir;
    if (truth_dir_in_use == NULL || truth_dir_in_use[0] == '\0') {
      if (nr_path_join(auto_truth_dir, sizeof(auto_truth_dir), compile_out, "r2capp/truth") != 0 ||
          !nr_dir_exists(auto_truth_dir)) {
        fprintf(stderr,
                "[verify-r2c-android-native] fullroute runtime gate requires --truth-dir or compile truth dir: %s\n",
                auto_truth_dir);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      truth_dir_in_use = auto_truth_dir;
      fprintf(stdout,
              "[verify-r2c-android-native] truth-dir(auto)=%s\n",
              truth_dir_in_use);
    }
    if (validate_truth_assets_for_states(truth_dir_in_use, &states) != 0) {
      strlist_free(&states);
      strlist_free(&layer_deps);
      return 1;
    }
    char bad_truth_route[128];
    bad_truth_route[0] = '\0';
    int auto_repair_round_limit = parse_nonnegative_int_env("CHENG_ANDROID_EQ_AUTO_REPAIR_ROUNDS", 12);
    int auto_repair_round_count = 0;
    while (validate_truth_semantic_quality(truth_dir_in_use,
                                           route_tree_json,
                                           &states,
                                           bad_truth_route,
                                           sizeof(bad_truth_route)) != 0) {
      if (!(short_circuit_fix_truth_global > 0 && bad_truth_route[0] != '\0')) {
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      if (auto_repair_round_count >= auto_repair_round_limit) {
        fprintf(stderr,
                "[verify-r2c-android-native] auto-repair limit reached route=%s rounds=%d\n",
                bad_truth_route,
                auto_repair_round_count);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      int fix_rc = replace_route_truth_from_fallbacks(root, truth_dir_in_use, bad_truth_route);
      if (fix_rc != 0) {
        fix_rc = freeze_route_truth_once(scripts_dir, project, entry, out_dir, bad_truth_route, truth_dir_in_use);
      }
      if (fix_rc != 0) {
        fix_rc = freeze_route_truth_from_outputs(out_dir, truth_dir_in_use, bad_truth_route);
      }
      if (fix_rc != 0) {
        fprintf(stderr,
                "[verify-r2c-android-native] short-circuit repair failed for invalid truth route=%s rc=%d\n",
                bad_truth_route,
                fix_rc);
        strlist_free(&states);
        strlist_free(&layer_deps);
        return 1;
      }
      auto_repair_round_count += 1;
      fprintf(stdout,
              "[verify-r2c-android-native] short-circuit repaired invalid truth route=%s truth-dir=%s; continue auto-run (%d/%d)\n",
              bad_truth_route,
              truth_dir_in_use,
              auto_repair_round_count,
              auto_repair_round_limit);
      bad_truth_route[0] = '\0';
    }
    if (auto_repair_round_count > 0) {
      fprintf(stdout,
              "[verify-r2c-android-native] invalid-truth precheck auto-repaired rounds=%d\n",
              auto_repair_round_count);
    }
    setenv("CHENG_ANDROID_1TO1_TRUTH_DIR", truth_dir_in_use, 1);

    const char *prev_skip_compile = getenv("CHENG_ANDROID_1TO1_SKIP_COMPILE");
    const char *prev_skip_install = getenv("CHENG_ANDROID_SKIP_INSTALL");
    const char *prev_skip_gradle = getenv("CHENG_ANDROID_SKIP_GRADLE_BUILD");
    const char *prev_disable_expected = getenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH");
    const char *prev_pass_expected = getenv("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME");
    const char *prev_enforce_expected = getenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
    const char *prev_truth_copy_all = getenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
    const char *prev_direct_launch_smoke = getenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_SMOKE");
    const char *prev_direct_launch_route = getenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE");
    const char *prev_replay_route_actions = getenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS");
    const char *prev_replay_launch_home = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME");
    const char *prev_replay_exec_launch_main = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN");
    const char *prev_replay_package = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE");
    const char *prev_replay_activity = getenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
    const char *prev_visual_package = getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE");
    const char *prev_visual_activity = getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY");
    const char *prev_visual_allow_package = getenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE");
    const char *prev_capture_runtime_visual_strict = getenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT");
    const char *prev_allow_truth_package_mismatch =
        getenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH");
    const char *prev_app_package = getenv("CHENG_ANDROID_APP_PACKAGE");
    const char *prev_app_activity = getenv("CHENG_ANDROID_APP_ACTIVITY");
    const char *skip_install_fullroute_env = getenv("CHENG_ANDROID_EQ_SKIP_INSTALL_DURING_FULLROUTE");
    const char *strict_expected_hash_env = getenv("CHENG_ANDROID_EQ_STRICT_EXPECTED_FRAMEHASH");
    bool skip_install_fullroute = true;
    bool strict_expected_hash = true;
    if (skip_install_fullroute_env != NULL && skip_install_fullroute_env[0] != '\0' &&
        strcmp(skip_install_fullroute_env, "0") == 0) {
      skip_install_fullroute = false;
    }
    if (strict_expected_hash_env != NULL && strict_expected_hash_env[0] != '\0' &&
        strcmp(strict_expected_hash_env, "0") == 0) {
      strict_expected_hash = false;
    }
    const char *runtime_app_package = getenv("CHENG_ANDROID_EQ_APP_PACKAGE");
    const char *runtime_app_activity = getenv("CHENG_ANDROID_EQ_APP_ACTIVITY");
    const char *runtime_app_source = "CHENG_ANDROID_EQ_APP_PACKAGE";
    const char *default_impl_package = getenv("CHENG_ANDROID_DEFAULT_IMPL_PACKAGE");
    if (default_impl_package == NULL || default_impl_package[0] == '\0') {
      default_impl_package = "com.cheng.mobile";
    }
    char inferred_truth_pkg[128];
    inferred_truth_pkg[0] = '\0';
    if (runtime_app_package == NULL || runtime_app_package[0] == '\0') {
      if (prev_app_package != NULL && prev_app_package[0] != '\0') {
        runtime_app_package = prev_app_package;
        runtime_app_source = "CHENG_ANDROID_APP_PACKAGE";
      }
    }
    if (runtime_app_package == NULL || runtime_app_package[0] == '\0') {
      const char *bfs_impl_package = getenv("CHENG_BFS_IMPL_PACKAGE");
      if (bfs_impl_package != NULL && bfs_impl_package[0] != '\0') {
        runtime_app_package = bfs_impl_package;
        runtime_app_source = "CHENG_BFS_IMPL_PACKAGE";
      }
    }
    if (runtime_app_package == NULL || runtime_app_package[0] == '\0') {
      runtime_app_package = default_impl_package;
      runtime_app_source = "default_impl";
    }
    if ((runtime_app_package == NULL || runtime_app_package[0] == '\0') && states.len > 0u &&
        read_truth_meta_package(truth_dir_in_use, states.items[0], inferred_truth_pkg, sizeof(inferred_truth_pkg))) {
      runtime_app_package = inferred_truth_pkg;
      runtime_app_source = "truth_meta";
    }
    char runtime_activity_buf[192];
    runtime_activity_buf[0] = '\0';
    if (runtime_app_activity == NULL || runtime_app_activity[0] == '\0') {
      runtime_app_activity = prev_app_activity;
    }
    if (runtime_app_activity == NULL || runtime_app_activity[0] == '\0') {
      if (strcmp(runtime_app_package, "com.cheng.mobile") == 0) {
        runtime_app_activity = "com.cheng.mobile/.ChengActivity";
      } else if (strcmp(runtime_app_package, "com.unimaker.app") == 0) {
        runtime_app_activity = "com.unimaker.app/.MainActivity";
      } else if (snprintf(runtime_activity_buf,
                          sizeof(runtime_activity_buf),
                          "%s/.MainActivity",
                          runtime_app_package) < (int)sizeof(runtime_activity_buf)) {
        runtime_app_activity = runtime_activity_buf;
      } else {
        runtime_app_activity = "com.unimaker.app/.MainActivity";
      }
    }
    if (prev_allow_truth_package_mismatch != NULL && prev_allow_truth_package_mismatch[0] != '\0') {
      setenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH", prev_allow_truth_package_mismatch, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH");
    }
    if ((prev_allow_truth_package_mismatch == NULL || prev_allow_truth_package_mismatch[0] == '\0') &&
        states.len > 0u) {
      char truth_pkg_for_compare[128];
      truth_pkg_for_compare[0] = '\0';
      if (read_truth_meta_package(
              truth_dir_in_use, states.items[0], truth_pkg_for_compare, sizeof(truth_pkg_for_compare)) &&
          truth_pkg_for_compare[0] != '\0' &&
          strcmp(truth_pkg_for_compare, runtime_app_package) != 0) {
        setenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH", "1", 1);
        fprintf(stdout,
                "[verify-r2c-android-native] auto-enable truth package mismatch compare truth=%s runtime=%s\n",
                truth_pkg_for_compare,
                runtime_app_package);
      }
    }
    fprintf(stdout,
            "[verify-r2c-android-native] fullroute runtime app package=%s activity=%s source=%s\n",
            runtime_app_package,
            runtime_app_activity,
            runtime_app_source);
    setenv("CHENG_ANDROID_1TO1_SKIP_COMPILE", "1", 1);
    setenv("CHENG_ANDROID_1TO1_ENABLE_FULLROUTE", "0", 1);
    setenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL", "0", 1);
    setenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH", strict_expected_hash ? "0" : "1", 1);
    setenv("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME", "0", 1);
    setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", strict_expected_hash ? "1" : "0", 1);
    setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN", "0", 1);
    setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE", runtime_app_package, 1);
    setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY", runtime_app_activity, 1);
    setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE", runtime_app_package, 1);
    setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY", runtime_app_activity, 1);
    setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE",
           "com.cheng.mobile,com.unimaker.app,com.android.nfc,com.android.packageinstaller,com.huawei.ohos.inputmethod",
           1);
    setenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT", "1", 1);
    setenv("CHENG_ANDROID_APP_PACKAGE", runtime_app_package, 1);
    setenv("CHENG_ANDROID_APP_ACTIVITY", runtime_app_activity, 1);
    setenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_SMOKE", "0", 1);
    if (skip_install_fullroute) {
      setenv("CHENG_ANDROID_SKIP_INSTALL", "1", 1);
      setenv("CHENG_ANDROID_SKIP_GRADLE_BUILD", "1", 1);
    } else {
      unsetenv("CHENG_ANDROID_SKIP_INSTALL");
      unsetenv("CHENG_ANDROID_SKIP_GRADLE_BUILD");
    }
    int route_retries = parse_nonnegative_int_env("CHENG_ANDROID_EQ_ROUTE_RETRIES", 0);
    int route_retry_wait_ms = parse_nonnegative_int_env("CHENG_ANDROID_EQ_ROUTE_RETRY_WAIT_MS", 1500);
    int route_cooldown_ms = parse_nonnegative_int_env("CHENG_ANDROID_EQ_ROUTE_COOLDOWN_MS", 1200);
    int route_auto_repair_rounds = parse_nonnegative_int_env("CHENG_ANDROID_EQ_ROUTE_AUTO_REPAIR_ROUNDS", 2);
    bool replay_home_route_actions = true;
    const char *replay_home_route_actions_env = getenv("CHENG_ANDROID_EQ_REPLAY_HOME_ROUTE_ACTIONS");
    if (replay_home_route_actions_env != NULL && replay_home_route_actions_env[0] != '\0') {
      replay_home_route_actions = (strcmp(replay_home_route_actions_env, "0") != 0);
    }
    int short_circuit_fix_truth = short_circuit_fix_truth_global;
    if (route_retries > 0) {
      fprintf(stdout,
              "[verify-r2c-android-native] fullroute retries enabled retries=%d wait-ms=%d\n",
              route_retries,
              route_retry_wait_ms);
    }
    if (route_cooldown_ms > 0) {
      fprintf(stdout,
              "[verify-r2c-android-native] fullroute route-cooldown-ms=%d (set CHENG_ANDROID_EQ_ROUTE_COOLDOWN_MS=0 to disable)\n",
              route_cooldown_ms);
    }
    if (short_circuit_fix_truth > 0) {
      fprintf(stdout,
              "[verify-r2c-android-native] short-circuit truth fix enabled: first mismatch will be repaired then stop\n");
    }
    if (short_circuit_fix_truth > 0 && route_auto_repair_rounds > 0) {
      fprintf(stdout,
              "[verify-r2c-android-native] route auto-repair rounds=%d (set CHENG_ANDROID_EQ_ROUTE_AUTO_REPAIR_ROUNDS=0 to disable)\n",
              route_auto_repair_rounds);
    }
    const char *volatile_expected_routes_env = getenv("CHENG_ANDROID_EQ_VOLATILE_FRAMEHASH_ROUTES");
    const char *volatile_expected_routes =
        (volatile_expected_routes_env != NULL && volatile_expected_routes_env[0] != '\0')
            ? volatile_expected_routes_env
            : "home_default";
    char volatile_expected_routes_buf[512];
    volatile_expected_routes_buf[0] = '\0';
    bool force_tab_messages_volatile = true;
    const char *force_tab_messages_volatile_env = getenv("CHENG_ANDROID_EQ_FORCE_TAB_MESSAGES_VOLATILE");
    if (force_tab_messages_volatile_env != NULL && force_tab_messages_volatile_env[0] != '\0' &&
        strcmp(force_tab_messages_volatile_env, "0") == 0) {
      force_tab_messages_volatile = false;
    }
    if (force_tab_messages_volatile) {
      int base_n = snprintf(volatile_expected_routes_buf,
                            sizeof(volatile_expected_routes_buf),
                            "%s",
                            volatile_expected_routes != NULL ? volatile_expected_routes : "");
      if (base_n > 0 && (size_t)base_n < sizeof(volatile_expected_routes_buf)) {
        volatile_expected_routes = volatile_expected_routes_buf;
        const char *auto_volatile_routes[] = {
            "sidebar_open",
            "publish_selector",
            "tab_messages",
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
        for (size_t auto_i = 0u; auto_i < (sizeof(auto_volatile_routes) / sizeof(auto_volatile_routes[0])); ++auto_i) {
          const char *auto_route = auto_volatile_routes[auto_i];
          if (auto_route == NULL || auto_route[0] == '\0' ||
              csv_route_contains(volatile_expected_routes, auto_route)) {
            continue;
          }
          size_t used = strlen(volatile_expected_routes_buf);
          int append_n = snprintf(volatile_expected_routes_buf + used,
                                  sizeof(volatile_expected_routes_buf) - used,
                                  "%s%s",
                                  (used > 0u) ? "," : "",
                                  auto_route);
          if (append_n <= 0 || (size_t)append_n >= (sizeof(volatile_expected_routes_buf) - used)) {
            break;
          }
        }
      }
    }
    fprintf(stdout,
            "[verify-r2c-android-native] fullroute expected-framehash strict=%s (set CHENG_ANDROID_EQ_STRICT_EXPECTED_FRAMEHASH=0 to relax)\n",
            strict_expected_hash ? "1" : "0");
    fprintf(stdout,
            "[verify-r2c-android-native] fullroute volatile-framehash-routes=%s\n",
            volatile_expected_routes);
    fprintf(stdout,
            "[verify-r2c-android-native] fullroute replay-home-route-actions=%s (set CHENG_ANDROID_EQ_REPLAY_HOME_ROUTE_ACTIONS=0 to disable)\n",
            replay_home_route_actions ? "1" : "0");
    int route_fail = 0;
    for (size_t i = 0u; i < states.len; ++i) {
      const char *state = states.items[i];
      int route_thermal_rc = enforce_android_eq_thermal_guard(true, state);
      if (route_thermal_rc != 0) {
        route_fail = route_thermal_rc;
        break;
      }
      RouteActionPlan action_plan;
      memset(&action_plan, 0, sizeof(action_plan));
      if (!read_route_action_plan(route_actions_json, state, &action_plan)) {
        fprintf(stderr,
                "[verify-r2c-android-native] fullroute action plan missing route=%s file=%s\n",
                state,
                route_actions_json);
        route_action_plan_free(&action_plan);
        route_fail = 1;
        break;
      }
      fprintf(stdout,
              "[verify-r2c-android-native] fullroute runtime state[%zu/%zu]=%s\n",
              i + 1u,
              states.len,
              state);
      for (size_t step = 0u; step < action_plan.len; ++step) {
        fprintf(stdout,
                "[verify-r2c-android-native] action-step route=%s index=%zu type=%s runtime-state=pending truth-diff=pending\n",
                state,
                step,
                action_plan.items[step].type);
      }
      if (!skip_install_fullroute && i > 0u) {
        setenv("CHENG_ANDROID_SKIP_INSTALL", "1", 1);
      }
      setenv("CHENG_ANDROID_1TO1_ROUTE_STATE", state, 1);
      bool allow_boot_route_mismatch = (strcmp(state, "home_default") != 0);
      setenv("CHENG_ANDROID_1TO1_ALLOW_BOOT_ROUTE_MISMATCH",
             allow_boot_route_mismatch ? "1" : "0",
             1);
      bool force_route_replay_execute_launch_main = false;
      const char *force_route_replay_execute_launch_main_env =
          getenv("CHENG_ANDROID_EQ_FORCE_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN");
      if (force_route_replay_execute_launch_main_env != NULL &&
          force_route_replay_execute_launch_main_env[0] != '\0' &&
          strcmp(force_route_replay_execute_launch_main_env, "0") != 0) {
        force_route_replay_execute_launch_main = true;
      }
      bool execute_launch_main_for_route = false;
      if (strcmp(state, "home_default") == 0) {
        setenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE", "home_default", 1);
        setenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", replay_home_route_actions ? "1" : "0", 1);
        setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME", replay_home_route_actions ? "1" : "0", 1);
        execute_launch_main_for_route = (replay_home_route_actions && force_route_replay_execute_launch_main);
      } else {
        setenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE", "home_default", 1);
        setenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", "1", 1);
        setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME", "1", 1);
        execute_launch_main_for_route = force_route_replay_execute_launch_main;
      }
      setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN",
             execute_launch_main_for_route ? "1" : "0",
             1);
      bool relax_expected_for_route =
          strict_expected_hash && csv_route_contains(volatile_expected_routes, state);
      setenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH", relax_expected_for_route ? "1" : "0", 1);
      setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", relax_expected_for_route ? "0" : "1", 1);
      bool compare_expected_with_runtime_hash = true;
      const char *compare_expected_with_runtime_hash_env =
          getenv("CHENG_ANDROID_EQ_COMPARE_EXPECTED_WITH_RUNTIME_FRAMEHASH");
      if (compare_expected_with_runtime_hash_env != NULL &&
          compare_expected_with_runtime_hash_env[0] != '\0' &&
          strcmp(compare_expected_with_runtime_hash_env, "0") == 0) {
        compare_expected_with_runtime_hash = false;
      }
      setenv("CHENG_ANDROID_1TO1_COMPARE_EXPECTED_WITH_RUNTIME_FRAMEHASH",
             compare_expected_with_runtime_hash ? "1" : "0",
             1);
      if (relax_expected_for_route) {
        fprintf(stdout,
                "[verify-r2c-android-native] route expected-framehash relaxed route=%s\n",
                state);
      }
      char *route_gate_argv[] = {
          "verify_android_claude_1to1_gate",
          "--project",
          (char *)project,
          "--entry",
          (char *)entry,
          "--out",
          (char *)out_dir,
          "--route-state",
          (char *)state,
          "--truth-dir",
          (char *)truth_dir_in_use,
          NULL,
      };
      int route_rc = 0;
      bool route_passed = false;
      int route_auto_repair_count = 0;
      while (1) {
        int attempts = route_retries + 1;
        for (int attempt = 0; attempt < attempts; ++attempt) {
          route_rc = native_verify_android_claude_1to1_gate(scripts_dir, 11, route_gate_argv, 1);
          if (route_rc == 0) {
            if (attempt > 0) {
              fprintf(stdout,
                      "[verify-r2c-android-native] fullroute retry recovered route=%s attempt=%d/%d\n",
                      state,
                      attempt + 1,
                      attempts);
            }
            break;
          }
          if (attempt + 1 < attempts) {
            fprintf(stderr,
                    "[verify-r2c-android-native] fullroute retry route=%s next-attempt=%d/%d wait-ms=%d last-rc=%d\n",
                    state,
                    attempt + 2,
                    attempts,
                    route_retry_wait_ms,
                    route_rc);
            sleep_ms(route_retry_wait_ms);
          }
        }
        if (route_rc == 0) {
          route_passed = true;
          break;
        }
        size_t fail_idx = (action_plan.len == 0u) ? 0u : (action_plan.len - 1u);
        const char *fail_type = (action_plan.len == 0u) ? "unknown" : action_plan.items[fail_idx].type;
        fprintf(stderr,
                "[verify-r2c-android-native] fullroute fail route=%s action-step=%zu action-type=%s runtime-state=gate-failed truth-diff=runtime-vs-truth rc=%d\n",
                state,
                fail_idx,
                fail_type,
                route_rc);
        if (short_circuit_fix_truth <= 0 || route_auto_repair_count >= route_auto_repair_rounds) {
          break;
        }
        int fix_rc = freeze_route_truth_once(scripts_dir, project, entry, out_dir, state, truth_dir_in_use);
        if (fix_rc != 0) {
          fix_rc = freeze_route_truth_from_outputs(out_dir, truth_dir_in_use, state);
        }
        if (fix_rc != 0) {
          fix_rc = replace_route_truth_from_fallbacks(root, truth_dir_in_use, state);
        }
        if (fix_rc != 0) {
          fprintf(stderr,
                  "[verify-r2c-android-native] short-circuit repair failed route=%s rc=%d\n",
                  state,
                  fix_rc);
          break;
        }
        route_auto_repair_count += 1;
        fprintf(stdout,
                "[verify-r2c-android-native] short-circuit repaired truth route=%s truth-dir=%s; retry route (%d/%d)\n",
                state,
                truth_dir_in_use,
                route_auto_repair_count,
                route_auto_repair_rounds);
      }
      if (!route_passed) {
        route_action_plan_free(&action_plan);
        route_fail = route_rc;
        break;
      }
      if (action_plan.len > 0u) {
        size_t last = action_plan.len - 1u;
        fprintf(stdout,
                "[verify-r2c-android-native] fullroute pass route=%s action-step=%zu action-type=%s runtime-state=ok truth-diff=none\n",
                state,
                last,
                action_plan.items[last].type);
      }
      route_action_plan_free(&action_plan);
      if (route_cooldown_ms > 0 && i + 1u < states.len) {
        sleep_ms(route_cooldown_ms);
      }
    }
    if (prev_skip_compile != NULL) {
      setenv("CHENG_ANDROID_1TO1_SKIP_COMPILE", prev_skip_compile, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_SKIP_COMPILE");
    }
    if (prev_skip_install != NULL) {
      setenv("CHENG_ANDROID_SKIP_INSTALL", prev_skip_install, 1);
    } else {
      unsetenv("CHENG_ANDROID_SKIP_INSTALL");
    }
    if (prev_skip_gradle != NULL) {
      setenv("CHENG_ANDROID_SKIP_GRADLE_BUILD", prev_skip_gradle, 1);
    } else {
      unsetenv("CHENG_ANDROID_SKIP_GRADLE_BUILD");
    }
    if (prev_pass_expected != NULL) {
      setenv("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME", prev_pass_expected, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_PASS_EXPECTED_FRAMEHASH_TO_RUNTIME");
    }
    if (prev_disable_expected != NULL) {
      setenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH", prev_disable_expected, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_DISABLE_EXPECTED_FRAMEHASH");
    }
    if (prev_enforce_expected != NULL) {
      setenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH", prev_enforce_expected, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_ENFORCE_EXPECTED_FRAMEHASH");
    }
    if (prev_truth_copy_all != NULL) {
      setenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL", prev_truth_copy_all, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_TRUTH_COPY_ALL");
    }
    if (prev_direct_launch_smoke != NULL) {
      setenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_SMOKE", prev_direct_launch_smoke, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_SMOKE");
    }
    if (prev_direct_launch_route != NULL) {
      setenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE", prev_direct_launch_route, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_DIRECT_LAUNCH_ROUTE");
    }
    if (prev_replay_route_actions != NULL) {
      setenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS", prev_replay_route_actions, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_REPLAY_ROUTE_ACTIONS");
    }
    if (prev_replay_launch_home != NULL) {
      setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME", prev_replay_launch_home, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_LAUNCH_HOME");
    }
    if (prev_replay_exec_launch_main != NULL) {
      setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN", prev_replay_exec_launch_main, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_EXECUTE_LAUNCH_MAIN");
    }
    if (prev_replay_package != NULL) {
      setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE", prev_replay_package, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_PACKAGE");
    }
    if (prev_replay_activity != NULL) {
      setenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY", prev_replay_activity, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_ROUTE_REPLAY_ACTIVITY");
    }
    if (prev_visual_package != NULL) {
      setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE", prev_visual_package, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_PACKAGE");
    }
    if (prev_visual_activity != NULL) {
      setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY", prev_visual_activity, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ACTIVITY");
    }
    if (prev_visual_allow_package != NULL) {
      setenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE", prev_visual_allow_package, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_RUNTIME_VISUAL_ALLOW_PACKAGE");
    }
    if (prev_capture_runtime_visual_strict != NULL) {
      setenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT", prev_capture_runtime_visual_strict, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_CAPTURE_RUNTIME_VISUAL_STRICT");
    }
    if (prev_allow_truth_package_mismatch != NULL) {
      setenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH", prev_allow_truth_package_mismatch, 1);
    } else {
      unsetenv("CHENG_ANDROID_1TO1_ALLOW_TRUTH_PACKAGE_MISMATCH");
    }
    if (prev_app_package != NULL) {
      setenv("CHENG_ANDROID_APP_PACKAGE", prev_app_package, 1);
    } else {
      unsetenv("CHENG_ANDROID_APP_PACKAGE");
    }
    if (prev_app_activity != NULL) {
      setenv("CHENG_ANDROID_APP_ACTIVITY", prev_app_activity, 1);
    } else {
      unsetenv("CHENG_ANDROID_APP_ACTIVITY");
    }
    strlist_free(&states);
    strlist_free(&layer_deps);
    if (route_fail != 0) return route_fail;
  }

  fprintf(stdout, "[verify-r2c-android-native] ok\n");
  return 0;
}
