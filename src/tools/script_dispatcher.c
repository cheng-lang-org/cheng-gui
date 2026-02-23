#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "native_verify_android_claude_1to1_gate.h"
#include "native_r2c_compile_react_project.h"
#include "native_verify_android_fullroute_visual_pixel.h"
#include "native_mobile_run_android.h"

#ifndef CHENG_GUI_SCRIPTS_DIR_DEFAULT
#define CHENG_GUI_SCRIPTS_DIR_DEFAULT ""
#endif

typedef struct {
  char *name;
} Entry;

static bool has_suffix(const char *value, const char *suffix) {
  size_t n = strlen(value);
  size_t m = strlen(suffix);
  if (n < m) return false;
  return strcmp(value + (n - m), suffix) == 0;
}

static bool is_safe_command(const char *value) {
  if (value == NULL || value[0] == '\0') return false;
  if (strstr(value, "..") != NULL) return false;
  for (const char *p = value; *p != '\0'; ++p) {
    unsigned char ch = (unsigned char)*p;
    if (isalnum(ch) || ch == '_' || ch == '-' || ch == '.') continue;
    return false;
  }
  return true;
}

static int cmp_entry_name(const void *a, const void *b) {
  const Entry *ea = (const Entry *)a;
  const Entry *eb = (const Entry *)b;
  return strcmp(ea->name, eb->name);
}

static int append_entry(Entry **items, size_t *len, size_t *cap, const char *name) {
  if (*len >= *cap) {
    size_t next = (*cap == 0u) ? 32u : (*cap * 2u);
    Entry *resized = (Entry *)realloc(*items, next * sizeof(Entry));
    if (resized == NULL) return -1;
    *items = resized;
    *cap = next;
  }
  (*items)[*len].name = strdup(name);
  if ((*items)[*len].name == NULL) return -1;
  *len += 1u;
  return 0;
}

static bool entry_exists(const Entry *items, size_t len, const char *name) {
  for (size_t i = 0; i < len; ++i) {
    if (strcmp(items[i].name, name) == 0) return true;
  }
  return false;
}

static int list_commands(const char *scripts_dir) {
  DIR *dir = opendir(scripts_dir);
  if (dir == NULL) {
    fprintf(stderr, "[cheng_gui_scripts] cannot open scripts dir: %s (%s)\n", scripts_dir, strerror(errno));
    return 1;
  }

  Entry *items = NULL;
  size_t len = 0;
  size_t cap = 0;

  struct dirent *ent = NULL;
  while ((ent = readdir(dir)) != NULL) {
    const char *name = ent->d_name;
    if (name[0] == '.') continue;
    if (!has_suffix(name, ".sh") && !has_suffix(name, ".py")) continue;
    char base[PATH_MAX];
    snprintf(base, sizeof(base), "%s", name);
    if (has_suffix(base, ".sh")) base[strlen(base) - 3u] = '\0';
    if (has_suffix(base, ".py")) base[strlen(base) - 3u] = '\0';
    if (base[0] == '\0') continue;
    if (entry_exists(items, len, base)) continue;
    if (append_entry(&items, &len, &cap, base) != 0) {
      fprintf(stderr, "[cheng_gui_scripts] out of memory\n");
      closedir(dir);
      for (size_t i = 0; i < len; ++i) free(items[i].name);
      free(items);
      return 1;
    }
  }
  closedir(dir);

  const char *native_only[] = {"mobile_run_android"};
  for (size_t i = 0; i < sizeof(native_only) / sizeof(native_only[0]); ++i) {
    if (!entry_exists(items, len, native_only[i])) {
      if (append_entry(&items, &len, &cap, native_only[i]) != 0) {
        fprintf(stderr, "[cheng_gui_scripts] out of memory\n");
        for (size_t j = 0; j < len; ++j) free(items[j].name);
        free(items);
        return 1;
      }
    }
  }

  qsort(items, len, sizeof(Entry), cmp_entry_name);
  for (size_t i = 0; i < len; ++i) {
    printf("%s\n", items[i].name);
    free(items[i].name);
  }
  free(items);
  return 0;
}

static bool file_exists(const char *path) {
  struct stat st;
  return (stat(path, &st) == 0) && S_ISREG(st.st_mode);
}

static bool is_executable(const char *path) {
  return access(path, X_OK) == 0;
}

static int join_path(char *out, size_t cap, const char *a, const char *b) {
  int n = snprintf(out, cap, "%s/%s", a, b);
  if (n < 0 || (size_t)n >= cap) return -1;
  return 0;
}

static const char *basename_ptr(const char *path) {
  const char *slash = strrchr(path, '/');
  if (slash == NULL) return path;
  return slash + 1;
}

static int resolve_script(const char *scripts_dir, const char *command, char *out_path, size_t out_cap) {
  if (!is_safe_command(command)) return -1;

  if (has_suffix(command, ".sh") || has_suffix(command, ".py")) {
    if (join_path(out_path, out_cap, scripts_dir, command) != 0) return -1;
    return file_exists(out_path) ? 0 : -1;
  }

  char candidate[PATH_MAX];
  if (snprintf(candidate, sizeof(candidate), "%s.sh", command) >= (int)sizeof(candidate)) return -1;
  if (join_path(out_path, out_cap, scripts_dir, candidate) == 0 && file_exists(out_path)) return 0;

  if (snprintf(candidate, sizeof(candidate), "%s.py", command) >= (int)sizeof(candidate)) return -1;
  if (join_path(out_path, out_cap, scripts_dir, candidate) == 0 && file_exists(out_path)) return 0;

  if (join_path(out_path, out_cap, scripts_dir, command) == 0 && file_exists(out_path)) return 0;
  return -1;
}

static void print_help(const char *prog, const char *scripts_dir) {
  fprintf(stderr,
          "Usage:\n"
          "  %s <command> [args...]\n"
          "  %s --list\n"
          "  %s --help\n\n"
          "Env:\n"
          "  CHENG_GUI_SCRIPTS_DIR  Override scripts directory (default: %s)\n\n"
          "Examples:\n"
          "  %s verify_production_closed_loop\n"
          "  %s verify_android_claude_1to1_gate --project /abs/path --entry /app/main.tsx\n",
          prog, prog, prog, scripts_dir, prog, prog);
}

static int exec_script(const char *script, int argc, char **argv, int arg_start) {
  bool is_sh = has_suffix(script, ".sh");
  bool is_py = has_suffix(script, ".py");

  int extra = (is_sh || is_py) ? 2 : 1;
  int out_argc = extra + (argc - arg_start);
  char **cmd = (char **)calloc((size_t)out_argc + 1u, sizeof(char *));
  if (cmd == NULL) {
    fprintf(stderr, "[cheng_gui_scripts] out of memory\n");
    return 1;
  }

  int idx = 0;
  if (is_sh) {
    cmd[idx++] = "bash";
    cmd[idx++] = (char *)script;
  } else if (is_py) {
    cmd[idx++] = "python3";
    cmd[idx++] = (char *)script;
  } else {
    cmd[idx++] = (char *)script;
  }

  for (int i = arg_start; i < argc; ++i) cmd[idx++] = argv[i];
  cmd[idx] = NULL;

  if (!is_sh && !is_py && !is_executable(script)) {
    fprintf(stderr, "[cheng_gui_scripts] target is not executable: %s\n", script);
    free(cmd);
    return 1;
  }

  execvp(cmd[0], cmd);
  fprintf(stderr, "[cheng_gui_scripts] exec failed: %s (%s)\n", cmd[0], strerror(errno));
  free(cmd);
  return 1;
}

int main(int argc, char **argv) {
  const char *scripts_dir = getenv("CHENG_GUI_SCRIPTS_DIR");
  if (scripts_dir == NULL || scripts_dir[0] == '\0') scripts_dir = CHENG_GUI_SCRIPTS_DIR_DEFAULT;
  if (scripts_dir == NULL || scripts_dir[0] == '\0') {
    fprintf(stderr, "[cheng_gui_scripts] missing scripts dir (set CHENG_GUI_SCRIPTS_DIR)\n");
    return 2;
  }

  const char *prog = basename_ptr(argv[0]);
  bool direct_mode = (strcmp(prog, "cheng_gui_scripts") != 0 && strcmp(prog, "cheng-gui-scripts") != 0);

  if (!direct_mode) {
    if (argc <= 1) {
      print_help(prog, scripts_dir);
      return 2;
    }
    if (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
      print_help(prog, scripts_dir);
      return 0;
    }
    if (strcmp(argv[1], "--list") == 0) return list_commands(scripts_dir);
  }

  const char *command = direct_mode ? prog : argv[1];
  int arg_start = direct_mode ? 1 : 2;

  if (strcmp(command, "verify_android_claude_1to1_gate") == 0) {
    return native_verify_android_claude_1to1_gate(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "r2c_compile_react_project") == 0) {
    return native_r2c_compile_react_project(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "verify_android_fullroute_visual_pixel") == 0) {
    return native_verify_android_fullroute_visual_pixel(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "mobile_run_android") == 0) {
    return native_mobile_run_android(scripts_dir, argc, argv, arg_start);
  }

  char script_path[PATH_MAX];
  if (resolve_script(scripts_dir, command, script_path, sizeof(script_path)) != 0) {
    fprintf(stderr, "[cheng_gui_scripts] unknown command: %s\n", command);
    fprintf(stderr, "[cheng_gui_scripts] use --list to show available commands\n");
    return 2;
  }
  return exec_script(script_path, argc, argv, arg_start);
}
