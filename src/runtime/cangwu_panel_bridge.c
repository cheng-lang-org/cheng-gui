#include <stdint.h>
#include <stdio.h>

int32_t cangwu_panel_bridge_render_snapshot(const char* snapshot) {
  if (snapshot == NULL) {
    return 1;
  }
  (void)snapshot;
  return 0;
}

int32_t cangwu_panel_bridge_noop(void) {
  return 0;
}
