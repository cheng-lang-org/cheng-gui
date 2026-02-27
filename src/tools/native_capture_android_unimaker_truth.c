#define _POSIX_C_SOURCE 200809L

#include "native_capture_android_unimaker_truth.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
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
  int x;
  int y;
  int w;
  int h;
} Rect;

typedef struct {
  int code;
  bool timed_out;
} RunResult;

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
  if (parent == NULL || parent[0] == '\0' || strcmp(parent, route) == 0) return 0;
  if (strcmp(parent, "home_default") == 0) return 1;
  return 2;
}

static void route_path_signature_for(const char *route, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  out[0] = '\0';
  if (route == NULL || route[0] == '\0') {
    snprintf(out, out_cap, "home_default");
    return;
  }
  const char *parent = route_parent_for(route);
  if (strcmp(route, "home_default") == 0) {
    snprintf(out, out_cap, "home_default");
    return;
  }
  if (parent == NULL || parent[0] == '\0' || strcmp(parent, "home_default") == 0) {
    snprintf(out, out_cap, "home_default>%s", route);
    return;
  }
  snprintf(out, out_cap, "home_default>%s>%s", parent, route);
}

static bool file_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISREG(st.st_mode));
}

static bool dir_exists(const char *path) {
  struct stat st;
  return (path != NULL && stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static bool path_executable(const char *path) { return (path != NULL && access(path, X_OK) == 0); }

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

static int write_file_all(const char *path, const char *data, size_t len) {
  FILE *fp = fopen(path, "wb");
  if (fp == NULL) return -1;
  size_t wr = fwrite(data, 1u, len, fp);
  int rc = fclose(fp);
  if (wr != len || rc != 0) return -1;
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

static bool starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
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
    if (dup2(pipefd[1], STDOUT_FILENO) < 0) _exit(127);
    if (dup2(pipefd[1], STDERR_FILENO) < 0) _exit(127);
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
  if (out != NULL) {
    *out = buf;
  } else {
    free(buf);
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static RunResult run_command_to_file(char *const argv[], const char *out_path, int timeout_sec) {
  RunResult res;
  res.code = 127;
  res.timed_out = false;
  pid_t pid = fork();
  if (pid < 0) return res;
  if (pid == 0) {
    if (setpgid(0, 0) != 0) _exit(127);
    if (out_path != NULL && out_path[0] != '\0') {
      int fd = open(out_path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
      if (fd < 0) _exit(127);
      if (dup2(fd, STDOUT_FILENO) < 0) _exit(127);
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

static bool resolve_adb(char *out, size_t out_cap) {
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

static bool resolve_android_serial(const char *adb, const char *preferred, char *out, size_t out_cap) {
  if (adb == NULL || adb[0] == '\0' || out == NULL || out_cap == 0u) return false;
  out[0] = '\0';
  if (preferred != NULL && preferred[0] != '\0') {
    snprintf(out, out_cap, "%s", preferred);
    return true;
  }
  const char *env_serial = getenv("ANDROID_SERIAL");
  if (env_serial != NULL && env_serial[0] != '\0') {
    snprintf(out, out_cap, "%s", env_serial);
    return true;
  }

  char *devices_out = NULL;
  char *argv[] = {(char *)adb, "devices", NULL};
  int rc = capture_command_output(argv, 12, &devices_out);
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

static bool parse_resumed_package(const char *activities, char *pkg, size_t pkg_cap) {
  if (pkg != NULL && pkg_cap > 0u) pkg[0] = '\0';
  if (activities == NULL || pkg == NULL || pkg_cap == 0u) return false;
  const char *p = strstr(activities, "mResumedActivity:");
  if (p == NULL) p = strstr(activities, "topResumedActivity=");
  if (p == NULL) return false;
  const char *slash = strchr(p, '/');
  if (slash == NULL) return false;
  const char *start = slash;
  while (start > p) {
    char ch = *(start - 1);
    if (isalnum((unsigned char)ch) || ch == '.' || ch == '_') {
      --start;
      continue;
    }
    break;
  }
  if (start >= slash) return false;
  size_t n = (size_t)(slash - start);
  if (n >= pkg_cap) n = pkg_cap - 1u;
  memcpy(pkg, start, n);
  pkg[n] = '\0';
  return pkg[0] != '\0';
}

static bool parse_first_four_ints(const char *s, int *a, int *b, int *c, int *d) {
  if (s == NULL || a == NULL || b == NULL || c == NULL || d == NULL) return false;
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
  if (count < 4) return false;
  *a = vals[0];
  *b = vals[1];
  *c = vals[2];
  *d = vals[3];
  return true;
}

static bool parse_app_bounds(const char *dumpsys, Rect *out) {
  if (dumpsys == NULL || out == NULL) return false;
  memset(out, 0, sizeof(*out));
  const char *p = dumpsys;
  while ((p = strstr(p, "mAppBounds=")) != NULL) {
    const char *line_end = strchr(p, '\n');
    size_t line_len = (line_end == NULL) ? strlen(p) : (size_t)(line_end - p);
    if (line_len > 0u && line_len < 512u) {
      char line[512];
      memcpy(line, p, line_len);
      line[line_len] = '\0';
      int x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      if (parse_first_four_ints(line, &x1, &y1, &x2, &y2) && x2 > x1 && y2 > y1) {
        out->x = x1;
        out->y = y1;
        out->w = x2 - x1;
        out->h = y2 - y1;
        return true;
      }
    }
    if (line_end == NULL) break;
    p = line_end + 1;
  }
  return false;
}

static bool read_png_wh(const char *png_path, int *w, int *h) {
  if (w != NULL) *w = 0;
  if (h != NULL) *h = 0;
  if (png_path == NULL || png_path[0] == '\0') return false;
  FILE *fp = fopen(png_path, "rb");
  if (fp == NULL) return false;
  unsigned char header[24];
  size_t rd = fread(header, 1u, sizeof(header), fp);
  fclose(fp);
  if (rd != sizeof(header)) return false;
  const unsigned char sig[8] = {0x89u, 'P', 'N', 'G', '\r', '\n', 0x1au, '\n'};
  if (memcmp(header, sig, sizeof(sig)) != 0) return false;
  if (!(header[12] == 'I' && header[13] == 'H' && header[14] == 'D' && header[15] == 'R')) return false;
  int width = (int)((uint32_t)header[16] << 24u | (uint32_t)header[17] << 16u | (uint32_t)header[18] << 8u |
                    (uint32_t)header[19]);
  int height = (int)((uint32_t)header[20] << 24u | (uint32_t)header[21] << 16u | (uint32_t)header[22] << 8u |
                     (uint32_t)header[23]);
  if (width <= 0 || height <= 0) return false;
  if (w != NULL) *w = width;
  if (h != NULL) *h = height;
  return true;
}

static uint64_t fnv1a64_file(const char *path, size_t *out_len) {
  if (out_len != NULL) *out_len = 0u;
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return 0u;
  const uint64_t kOffset = 1469598103934665603ull;
  const uint64_t kPrime = 1099511628211ull;
  uint64_t h = kOffset;
  size_t total = 0u;
  unsigned char buf[8192];
  while (1) {
    size_t rd = fread(buf, 1u, sizeof(buf), fp);
    if (rd > 0u) {
      total += rd;
      for (size_t i = 0u; i < rd; ++i) {
        h ^= (uint64_t)buf[i];
        h *= kPrime;
      }
    }
    if (rd < sizeof(buf)) {
      if (feof(fp)) break;
      if (ferror(fp)) {
        fclose(fp);
        return 0u;
      }
    }
  }
  fclose(fp);
  if (out_len != NULL) *out_len = total;
  return h;
}

static uint64_t fnv1a64_bytes(uint64_t seed, const unsigned char *data, size_t n) {
  const uint64_t kPrime = 1099511628211ull;
  uint64_t h = seed;
  if (h == 0u) h = 1469598103934665603ull;
  if (data == NULL) return h;
  for (size_t i = 0u; i < n; ++i) {
    h ^= (uint64_t)data[i];
    h *= kPrime;
  }
  return h;
}

static uint64_t runtime_hash_from_rgba(const unsigned char *rgba, int width, int height) {
  if (rgba == NULL || width <= 0 || height <= 0) return 0u;
  uint64_t h = 1469598103934665603ull;
  size_t pixels = (size_t)width * (size_t)height;
  for (size_t i = 0u; i < pixels; ++i) {
    const unsigned char *px = rgba + i * 4u;
    unsigned char bgra[4];
    bgra[0] = px[2];
    bgra[1] = px[1];
    bgra[2] = px[0];
    bgra[3] = px[3];
    h = fnv1a64_bytes(h, bgra, sizeof(bgra));
  }
  return h;
}

static void to_hex64(uint64_t value, char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return;
  (void)snprintf(out, out_cap, "%016llx", (unsigned long long)value);
}

static uint16_t read_u16_le(const unsigned char *p) { return (uint16_t)p[0] | (uint16_t)p[1] << 8u; }

static uint32_t read_u32_le(const unsigned char *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8u | (uint32_t)p[2] << 16u | (uint32_t)p[3] << 24u;
}

static int32_t read_i32_le(const unsigned char *p) { return (int32_t)read_u32_le(p); }

static bool decode_bmp_rgba(const char *bmp_path, unsigned char **out_rgba, int *out_w, int *out_h) {
  if (out_rgba != NULL) *out_rgba = NULL;
  if (out_w != NULL) *out_w = 0;
  if (out_h != NULL) *out_h = 0;
  size_t bmp_len = 0u;
  char *bmp_doc = read_file_all(bmp_path, &bmp_len);
  if (bmp_doc == NULL || bmp_len < 54u) {
    free(bmp_doc);
    return false;
  }
  const unsigned char *bmp = (const unsigned char *)bmp_doc;
  if (!(bmp[0] == 'B' && bmp[1] == 'M')) {
    free(bmp_doc);
    return false;
  }
  uint32_t pixel_off = read_u32_le(bmp + 10);
  uint32_t dib_size = read_u32_le(bmp + 14);
  if (dib_size < 40u || bmp_len < 14u + dib_size) {
    free(bmp_doc);
    return false;
  }
  int32_t width = read_i32_le(bmp + 18);
  int32_t height_signed = read_i32_le(bmp + 22);
  uint16_t planes = read_u16_le(bmp + 26);
  uint16_t bpp = read_u16_le(bmp + 28);
  uint32_t compression = read_u32_le(bmp + 30);
  if (planes != 1u || (bpp != 24u && bpp != 32u)) {
    free(bmp_doc);
    return false;
  }
  if (!(compression == 0u || compression == 3u)) {
    free(bmp_doc);
    return false;
  }
  if (width <= 0 || height_signed == 0) {
    free(bmp_doc);
    return false;
  }
  int height = (height_signed < 0) ? -height_signed : height_signed;
  size_t row_stride = (size_t)(((uint64_t)bpp * (uint64_t)width + 31u) / 32u) * 4u;
  size_t need = (size_t)pixel_off + row_stride * (size_t)height;
  if (need > bmp_len) {
    free(bmp_doc);
    return false;
  }

  size_t rgba_len = (size_t)width * (size_t)height * 4u;
  unsigned char *rgba = (unsigned char *)malloc(rgba_len);
  if (rgba == NULL) {
    free(bmp_doc);
    return false;
  }
  bool bottom_up = (height_signed > 0);
  for (int y = 0; y < height; ++y) {
    int src_row = bottom_up ? (height - 1 - y) : y;
    const unsigned char *src = bmp + pixel_off + row_stride * (size_t)src_row;
    unsigned char *dst = rgba + (size_t)y * (size_t)width * 4u;
    for (int x = 0; x < width; ++x) {
      const unsigned char *p = src + (size_t)x * (size_t)(bpp / 8u);
      dst[(size_t)x * 4u + 0u] = p[2];
      dst[(size_t)x * 4u + 1u] = p[1];
      dst[(size_t)x * 4u + 2u] = p[0];
      dst[(size_t)x * 4u + 3u] = (bpp == 32u) ? p[3] : 255u;
    }
  }
  free(bmp_doc);
  if (out_rgba != NULL) *out_rgba = rgba;
  else free(rgba);
  if (out_w != NULL) *out_w = width;
  if (out_h != NULL) *out_h = height;
  return true;
}

static bool crop_full_bmp_to_rgba(const char *sips, const char *full_png, const char *rgba_path, const Rect *crop) {
  if (sips == NULL || full_png == NULL || rgba_path == NULL || crop == NULL) return false;
  char bmp_path[PATH_MAX];
  if (snprintf(bmp_path, sizeof(bmp_path), "%s.full.bmp", rgba_path) >= (int)sizeof(bmp_path)) return false;
  unlink(bmp_path);
  char *bmp_argv[] = {(char *)sips, "-s", "format", "bmp", (char *)full_png, "--out", bmp_path, NULL};
  RunResult rr = run_command_to_file(bmp_argv, NULL, 25);
  if (rr.code != 0 || !file_exists(bmp_path)) return false;

  unsigned char *full_rgba = NULL;
  int full_w = 0;
  int full_h = 0;
  if (!decode_bmp_rgba(bmp_path, &full_rgba, &full_w, &full_h) || full_rgba == NULL || full_w <= 0 || full_h <= 0) {
    unlink(bmp_path);
    free(full_rgba);
    return false;
  }
  unlink(bmp_path);

  if (crop->x < 0 || crop->y < 0 || crop->w <= 0 || crop->h <= 0 || crop->x + crop->w > full_w ||
      crop->y + crop->h > full_h) {
    free(full_rgba);
    return false;
  }
  size_t out_len = (size_t)crop->w * (size_t)crop->h * 4u;
  unsigned char *out = (unsigned char *)malloc(out_len);
  if (out == NULL) {
    free(full_rgba);
    return false;
  }
  for (int y = 0; y < crop->h; ++y) {
    const unsigned char *src = full_rgba + ((size_t)(crop->y + y) * (size_t)full_w + (size_t)crop->x) * 4u;
    unsigned char *dst = out + (size_t)y * (size_t)crop->w * 4u;
    memcpy(dst, src, (size_t)crop->w * 4u);
  }
  int rc = write_file_all(rgba_path, (const char *)out, out_len);
  free(out);
  free(full_rgba);
  bool ok = (rc == 0);
  return ok;
}

static bool resolve_sips(char *out, size_t out_cap) {
  if (out == NULL || out_cap == 0u) return false;
  if (path_executable("/usr/bin/sips")) {
    snprintf(out, out_cap, "%s", "/usr/bin/sips");
    return true;
  }
  return find_executable_in_path("sips", out, out_cap);
}

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  capture_android_unimaker_truth --route-state <state> [--out-dir <abs>] [--serial <id>]\n"
          "                                [--package <pkg>] [--activity <pkg/.Activity>] [--allow-overlay-package <pkg>] [--force-front 0|1]\n"
          "\n"
          "Defaults:\n"
          "  --out-dir  /Users/lbcheng/.cheng-packages/cheng-gui/build/_truth_visible_1212x2512_canonical\n"
          "  --package  com.unimaker.app\n"
          "  --activity com.unimaker.app/.MainActivity\n"
          "  --allow-overlay-package com.huawei.ohos.inputmethod\n"
          "  --force-front 0\n");
}

int native_capture_android_unimaker_truth(const char *scripts_dir, int argc, char **argv, int arg_start) {
  (void)scripts_dir;
  const char *route_state = NULL;
  const char *out_dir = "/Users/lbcheng/.cheng-packages/cheng-gui/build/_truth_visible_1212x2512_canonical";
  const char *serial_arg = NULL;
  const char *pkg = "com.unimaker.app";
  const char *activity = "com.unimaker.app/.MainActivity";
  const char *allow_overlay_pkg = "com.huawei.ohos.inputmethod";
  int force_front = 0;

  for (int i = arg_start; i < argc;) {
    const char *arg = argv[i];
    if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
      usage();
      return 0;
    }
    if (strcmp(arg, "--route-state") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --route-state\n");
        return 2;
      }
      route_state = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--out-dir") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --out-dir\n");
        return 2;
      }
      out_dir = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--serial") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --serial\n");
        return 2;
      }
      serial_arg = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--package") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --package\n");
        return 2;
      }
      pkg = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--activity") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --activity\n");
        return 2;
      }
      activity = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--allow-overlay-package") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --allow-overlay-package\n");
        return 2;
      }
      allow_overlay_pkg = argv[i + 1];
      i += 2;
      continue;
    }
    if (strcmp(arg, "--force-front") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "[capture-unimaker-truth] missing value for --force-front\n");
        return 2;
      }
      force_front = (strcmp(argv[i + 1], "1") == 0) ? 1 : 0;
      i += 2;
      continue;
    }
    fprintf(stderr, "[capture-unimaker-truth] unknown arg: %s\n", arg);
    return 2;
  }

  if (route_state == NULL || route_state[0] == '\0') {
    fprintf(stderr, "[capture-unimaker-truth] --route-state is required\n");
    return 2;
  }
  if (out_dir == NULL || out_dir[0] == '\0') {
    fprintf(stderr, "[capture-unimaker-truth] --out-dir is empty\n");
    return 2;
  }

  if (ensure_dir(out_dir) != 0) {
    fprintf(stderr, "[capture-unimaker-truth] failed to create out dir: %s\n", out_dir);
    return 1;
  }

  char adb[PATH_MAX];
  if (!resolve_adb(adb, sizeof(adb))) {
    fprintf(stderr, "[capture-unimaker-truth] missing adb\n");
    return 1;
  }
  char serial[128];
  if (!resolve_android_serial(adb, serial_arg, serial, sizeof(serial))) {
    fprintf(stderr, "[capture-unimaker-truth] no android device found\n");
    return 1;
  }

  if (force_front == 1) {
    char *start_argv[] = {adb, "-s", serial, "shell", "am", "start", "-W", "-n", (char *)activity, NULL};
    RunResult rr = run_command_to_file(start_argv, NULL, 25);
    if (rr.code != 0) {
      fprintf(stderr, "[capture-unimaker-truth] failed to bring app front: %s rc=%d\n", activity, rr.code);
      return 1;
    }
    usleep(300000);
  }

  char *activities_out = NULL;
  char *activities_argv[] = {adb, "-s", serial, "shell", "dumpsys", "activity", "activities", NULL};
  int activities_rc = capture_command_output(activities_argv, 20, &activities_out);
  if (activities_rc != 0 || activities_out == NULL) {
    free(activities_out);
    fprintf(stderr, "[capture-unimaker-truth] dumpsys activity failed rc=%d\n", activities_rc);
    return 1;
  }

  char resumed_pkg[256];
  resumed_pkg[0] = '\0';
  (void)parse_resumed_package(activities_out, resumed_pkg, sizeof(resumed_pkg));
  free(activities_out);
  if (resumed_pkg[0] == '\0' ||
      (strcmp(resumed_pkg, pkg) != 0 &&
       !(allow_overlay_pkg != NULL && allow_overlay_pkg[0] != '\0' && strcmp(resumed_pkg, allow_overlay_pkg) == 0))) {
    fprintf(stderr,
            "[capture-unimaker-truth] foreground package mismatch expect=%s got=%s\n",
            pkg,
            resumed_pkg[0] != '\0' ? resumed_pkg : "<unknown>");
    return 1;
  }

  char *dumpsys_out = NULL;
  char *dump_argv[] = {adb, "-s", serial, "shell", "dumpsys", "window", "windows", NULL};
  int dump_rc = capture_command_output(dump_argv, 20, &dumpsys_out);
  if (dump_rc != 0 || dumpsys_out == NULL) {
    free(dumpsys_out);
    fprintf(stderr, "[capture-unimaker-truth] dumpsys window failed rc=%d\n", dump_rc);
    return 1;
  }

  Rect app_bounds;
  if (!parse_app_bounds(dumpsys_out, &app_bounds)) {
    fprintf(stderr, "[capture-unimaker-truth] failed to parse mAppBounds from dumpsys window\n");
    free(dumpsys_out);
    return 1;
  }
  free(dumpsys_out);

  char full_png[PATH_MAX];
  char rgba_path[PATH_MAX];
  char meta_path[PATH_MAX];
  char runtime_hash_path[PATH_MAX];
  char framehash_path[PATH_MAX];
  if (snprintf(full_png, sizeof(full_png), "%s/%s.full.png", out_dir, route_state) >= (int)sizeof(full_png) ||
      snprintf(rgba_path, sizeof(rgba_path), "%s/%s.rgba", out_dir, route_state) >= (int)sizeof(rgba_path) ||
      snprintf(meta_path, sizeof(meta_path), "%s/%s.meta.json", out_dir, route_state) >= (int)sizeof(meta_path) ||
      snprintf(runtime_hash_path, sizeof(runtime_hash_path), "%s/%s.runtime_framehash", out_dir, route_state) >=
          (int)sizeof(runtime_hash_path) ||
      snprintf(framehash_path, sizeof(framehash_path), "%s/%s.framehash", out_dir, route_state) >=
          (int)sizeof(framehash_path)) {
    fprintf(stderr, "[capture-unimaker-truth] output path too long\n");
    return 1;
  }

  char *cap_argv[] = {adb, "-s", serial, "exec-out", "screencap", "-p", NULL};
  RunResult cap_rr = run_command_to_file(cap_argv, full_png, 20);
  if (cap_rr.code != 0) {
    fprintf(stderr, "[capture-unimaker-truth] adb screencap failed rc=%d\n", cap_rr.code);
    return 1;
  }
  int full_w = 0;
  int full_h = 0;
  if (!read_png_wh(full_png, &full_w, &full_h)) {
    fprintf(stderr, "[capture-unimaker-truth] cannot parse png dimensions: %s\n", full_png);
    return 1;
  }
  if (app_bounds.x < 0 || app_bounds.y < 0 || app_bounds.w <= 0 || app_bounds.h <= 0 ||
      app_bounds.x + app_bounds.w > full_w || app_bounds.y + app_bounds.h > full_h) {
    fprintf(stderr,
            "[capture-unimaker-truth] app bounds out of full frame full=%dx%d bounds=%d,%d %dx%d\n",
            full_w,
            full_h,
            app_bounds.x,
            app_bounds.y,
            app_bounds.w,
            app_bounds.h);
    return 1;
  }

  char sips_bin[PATH_MAX];
  if (!resolve_sips(sips_bin, sizeof(sips_bin))) {
    fprintf(stderr, "[capture-unimaker-truth] missing sips\n");
    return 1;
  }

  if (!crop_full_bmp_to_rgba(sips_bin, full_png, rgba_path, &app_bounds)) {
    fprintf(stderr, "[capture-unimaker-truth] crop+convert failed\n");
    return 1;
  }

  size_t rgba_bytes = 0u;
  char *rgba_doc = read_file_all(rgba_path, &rgba_bytes);
  if (rgba_doc == NULL || rgba_bytes == 0u) {
    free(rgba_doc);
    fprintf(stderr, "[capture-unimaker-truth] invalid rgba output: %s\n", rgba_path);
    return 1;
  }
  size_t expected = (size_t)app_bounds.w * (size_t)app_bounds.h * 4u;
  if (rgba_bytes != expected) {
    free(rgba_doc);
    fprintf(stderr,
            "[capture-unimaker-truth] rgba size mismatch got=%zu expect=%zu (%dx%d)\n",
            rgba_bytes,
            expected,
            app_bounds.w,
            app_bounds.h);
    return 1;
  }
  uint64_t rgba_hash = fnv1a64_bytes(1469598103934665603ull, (const unsigned char *)rgba_doc, rgba_bytes);
  uint64_t runtime_hash = runtime_hash_from_rgba((const unsigned char *)rgba_doc, app_bounds.w, app_bounds.h);
  free(rgba_doc);
  if (runtime_hash == 0u) {
    fprintf(stderr, "[capture-unimaker-truth] failed to compute runtime hash\n");
    return 1;
  }

  char hash_hex[32];
  char rgba_hash_hex[32];
  to_hex64(runtime_hash, hash_hex, sizeof(hash_hex));
  to_hex64(rgba_hash, rgba_hash_hex, sizeof(rgba_hash_hex));
  char hash_line[64];
  int hash_n = snprintf(hash_line, sizeof(hash_line), "%s\n", hash_hex);
  if (hash_n <= 0 || (size_t)hash_n >= sizeof(hash_line)) return 1;
  if (write_file_all(runtime_hash_path, hash_line, (size_t)hash_n) != 0 ||
      write_file_all(framehash_path, hash_line, (size_t)hash_n) != 0) {
    fprintf(stderr, "[capture-unimaker-truth] failed to write framehash files\n");
    return 1;
  }

  const char *route_parent = route_parent_for(route_state);
  int route_depth = route_depth_for(route_state);
  char path_signature[512];
  route_path_signature_for(route_state, path_signature, sizeof(path_signature));

  char meta_doc[4096];
  int meta_n = snprintf(meta_doc,
                        sizeof(meta_doc),
                        "{\n"
                        "  \"format\": \"rgba8888\",\n"
                        "  \"route_state\": \"%s\",\n"
                        "  \"route_depth\": %d,\n"
                        "  \"route_parent\": \"%s\",\n"
                        "  \"path_signature\": \"%s\",\n"
                        "  \"capture_source\": \"unimaker_foreground_runtime_visible\",\n"
                        "  \"device_serial\": \"%s\",\n"
                        "  \"package\": \"%s\",\n"
                        "  \"activity\": \"%s\",\n"
                        "  \"full_png\": \"%s\",\n"
                        "  \"width\": %d,\n"
                        "  \"height\": %d,\n"
                        "  \"surface_width\": %d,\n"
                        "  \"surface_height\": %d,\n"
                        "  \"crop_left\": %d,\n"
                        "  \"crop_top\": %d,\n"
                        "  \"crop_right\": %d,\n"
                        "  \"crop_bottom\": %d,\n"
                        "  \"rgba_bytes\": %zu,\n"
                        "  \"rgba_fnv1a64\": \"%s\",\n"
                        "  \"framehash\": \"%s\"\n"
                        "}\n",
                        route_state,
                        route_depth,
                        route_parent != NULL ? route_parent : "",
                        path_signature,
                        serial,
                        pkg,
                        activity,
                        full_png,
                        app_bounds.w,
                        app_bounds.h,
                        app_bounds.w,
                        app_bounds.h,
                        app_bounds.x,
                        app_bounds.y,
                        app_bounds.x + app_bounds.w,
                        app_bounds.y + app_bounds.h,
                        rgba_bytes,
                        rgba_hash_hex,
                        hash_hex);
  if (meta_n <= 0 || (size_t)meta_n >= sizeof(meta_doc) ||
      write_file_all(meta_path, meta_doc, (size_t)meta_n) != 0) {
    fprintf(stderr, "[capture-unimaker-truth] failed to write meta: %s\n", meta_path);
    return 1;
  }

  fprintf(stdout,
          "[capture-unimaker-truth] ok route=%s visible=%dx%d framehash=%s out=%s\n",
          route_state,
          app_bounds.w,
          app_bounds.h,
          hash_hex,
          out_dir);
  fprintf(stdout, "[capture-unimaker-truth] outputs: %s %s %s %s\n", rgba_path, meta_path, runtime_hash_path, framehash_path);
  return 0;
}
