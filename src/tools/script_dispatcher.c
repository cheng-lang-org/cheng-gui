#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "native_verify_android_claude_1to1_gate.h"
#include "native_r2c_compile_react_project.h"
#include "native_verify_android_fullroute_visual_pixel.h"
#include "native_mobile_run_android.h"
#include "native_mobile_run_ios.h"
#include "native_mobile_run_harmony.h"
#include "native_capture_android_unimaker_truth.h"
#include "native_verify_r2c_equivalence_android_native.h"
#include "native_verify_r2c_equivalence_ios_native.h"
#include "native_verify_r2c_equivalence_harmony_native.h"
#include "native_verify_r2c_equivalence_all_native.h"
#include "native_verify_production_closed_loop.h"

#ifndef CHENG_GUI_SCRIPTS_DIR_DEFAULT
#define CHENG_GUI_SCRIPTS_DIR_DEFAULT ""
#endif

static const char *kNativeCommands[] = {
    "capture_android_unimaker_truth",
    "mobile_run_android",
    "mobile_run_ios",
    "mobile_run_harmony",
    "r2c_compile_react_project",
    "verify_android_claude_1to1_gate",
    "verify_android_fullroute_visual_pixel",
    "verify_production_closed_loop",
    "verify_r2c_equivalence_all_native",
    "verify_r2c_equivalence_android_native",
    "verify_r2c_equivalence_harmony_native",
    "verify_r2c_equivalence_ios_native",
};

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

static int list_commands(const char *scripts_dir) {
  (void)scripts_dir;
  for (size_t i = 0; i < sizeof(kNativeCommands) / sizeof(kNativeCommands[0]); ++i) {
    printf("%s\n", kNativeCommands[i]);
  }
  return 0;
}

static const char *basename_ptr(const char *path) {
  const char *slash = strrchr(path, '/');
  if (slash == NULL) return path;
  return slash + 1;
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
  if (!is_safe_command(command)) {
    fprintf(stderr, "[cheng_gui_scripts] invalid command token: %s\n", command ? command : "");
    return 2;
  }

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
  if (strcmp(command, "mobile_run_ios") == 0) {
    return native_mobile_run_ios(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "mobile_run_harmony") == 0) {
    return native_mobile_run_harmony(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "capture_android_unimaker_truth") == 0) {
    return native_capture_android_unimaker_truth(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "verify_r2c_equivalence_android_native") == 0) {
    return native_verify_r2c_equivalence_android_native(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "verify_r2c_equivalence_ios_native") == 0) {
    return native_verify_r2c_equivalence_ios_native(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "verify_r2c_equivalence_harmony_native") == 0) {
    return native_verify_r2c_equivalence_harmony_native(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "verify_r2c_equivalence_all_native") == 0) {
    return native_verify_r2c_equivalence_all_native(scripts_dir, argc, argv, arg_start);
  }
  if (strcmp(command, "verify_production_closed_loop") == 0) {
    return native_verify_production_closed_loop(scripts_dir, argc, argv, arg_start);
  }

  fprintf(stderr, "[cheng_gui_scripts] unknown command: %s\n", command);
  fprintf(stderr, "[cheng_gui_scripts] use --list to show native commands\n");
  return 2;
}
