#ifndef CHENG_GUI_NATIVE_R2C_REPORT_VALIDATE_H
#define CHENG_GUI_NATIVE_R2C_REPORT_VALIDATE_H

#include <stdbool.h>
#include <stddef.h>

typedef struct {
  int code;
  bool timed_out;
} NativeRunResult;

bool nr_file_exists(const char *path);
bool nr_dir_exists(const char *path);
int nr_path_join(char *out, size_t cap, const char *a, const char *b);
int nr_ensure_dir(const char *path);
void nr_basename_copy(const char *path, char *out, size_t out_cap);
int nr_enforce_no_compat_mounts(const char *repo_root, char *err, size_t err_cap);
int nr_enforce_no_legacy_gui_imports(const char *repo_root, char *err, size_t err_cap);

NativeRunResult nr_run_command(char *const argv[], const char *log_path, int timeout_sec);

int nr_validate_compile_report(const char *report_path,
                               const char *truth_manifest_key,
                               const char *project_root,
                               char *err,
                               size_t err_cap);

#endif
