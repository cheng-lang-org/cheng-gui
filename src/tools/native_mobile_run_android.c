#define _POSIX_C_SOURCE 200809L

#include "native_mobile_run_android.h"

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

static bool starts_with(const char *s, const char *prefix) {
  if (s == NULL || prefix == NULL) return false;
  size_t n = strlen(prefix);
  return strncmp(s, prefix, n) == 0;
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

static int run_simple(char *const argv[], int timeout_sec, char **out) {
  int rc = run_capture(argv, out, timeout_sec);
  return rc;
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

static void usage(void) {
  fprintf(stdout,
          "Usage:\n"
          "  mobile_run_android <entry.cheng> [--name:<appName>] [--out:<dir>] [--assets:<dir>] [--native-obj:<obj>] [--serial:<id>]\n"
          "                     [--app-arg:<k=v>]... [--app-args-json:<abs_path>] [--runtime-state-out:<abs_path>] [--runtime-state-wait-ms:<ms>]\n");
}

int native_mobile_run_android(const char *scripts_dir, int argc, char **argv, int arg_start) {
  (void)scripts_dir;
  for (int i = arg_start; i < argc; ++i) {
    if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
      usage();
      return 0;
    }
  }

  const char *entry = NULL;
  const char *native_obj = NULL;
  const char *app_args_json_path = NULL;
  const char *runtime_state_out = NULL;
  const char *serial_override = NULL;
  int wait_ms = 3000;
  StringList app_args;
  memset(&app_args, 0, sizeof(app_args));

  for (int i = arg_start; i < argc; ++i) {
    const char *arg = argv[i];
    if (!starts_with(arg, "--")) {
      if (entry == NULL) entry = arg;
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
  }

  if (entry == NULL) {
    fprintf(stderr, "[mobile-run-android] missing entry source\n");
    strlist_free(&app_args);
    return 2;
  }
  if (native_obj == NULL || !file_exists(native_obj)) {
    fprintf(stderr, "[mobile-run-android] missing native object: %s\n", native_obj ? native_obj : "");
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
  fprintf(stdout, "[mobile-export] mode=native-obj entry=%s native_obj=%s\n", entry, native_obj);

  char *force_stop[] = {adb, "-s", serial, "shell", "am", "force-stop", (char *)pkg, NULL};
  (void)run_simple(force_stop, 10, NULL);
  char *rm_state[] = {adb, "-s", serial, "shell", "run-as", (char *)pkg, "rm", "-f", "files/cheng_runtime_state.json", NULL};
  (void)run_simple(rm_state, 10, NULL);

  fprintf(stdout,
          "[run-android] cmd: %s -s %s shell am start -n %s --es cheng_app_args_kv <...> --es cheng_app_args_json <...> --es cheng_app_args_json_b64 <...>\n",
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
  size_t cmd_len = strlen("am start -n  --es cheng_app_args_kv  --es cheng_app_args_json  --es cheng_app_args_json_b64 ") +
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
           "am start -n %s --es cheng_app_args_kv %s --es cheng_app_args_json %s --es cheng_app_args_json_b64 %s",
           q_activity,
           q_kv,
           q_json,
           q_json_b64);

  char *start_argv[] = {adb, "-s", serial, "shell", remote_cmd, NULL};
  char *start_out = NULL;
  int start_rc = run_simple(start_argv, 20, &start_out);
  free(remote_cmd);
  free(q_activity);
  free(q_kv);
  free(q_json);
  free(q_json_b64);
  if (start_rc != 0) {
    fprintf(stderr, "[mobile-run-android] launch failed rc=%d\n%s\n", start_rc, start_out ? start_out : "");
    free(start_out);
    free(json_b64);
    free(json);
    free(kv);
    strlist_free(&app_args);
    return 1;
  }
  if (start_out != NULL) fputs(start_out, stdout);
  free(start_out);

  int poll_times = wait_ms / 250;
  if (poll_times < 1) poll_times = 1;
  char *state_text = NULL;
  for (int i = 0; i < poll_times; ++i) {
    char *cat_argv[] = {adb, "-s", serial, "shell", "run-as", (char *)pkg, "cat", "files/cheng_runtime_state.json", NULL};
    char *out = NULL;
    int rc = run_simple(cat_argv, 5, &out);
    if (rc == 0 && out != NULL && out[0] != '\0') {
      state_text = out;
      break;
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

  free(state_text);
  free(json_b64);
  free(json);
  free(kv);
  strlist_free(&app_args);
  fprintf(stdout, "mobile_run_android ok\n");
  return 0;
}
