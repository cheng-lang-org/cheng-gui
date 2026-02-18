#include "gui_api.h"

void cheng_mobile_app_main(void) {
  if (cheng_gui_init() != 0) {
    return;
  }
  void *window = cheng_gui_window_create("Cheng ASM GUI", 960, 540);
  if (!window) {
    cheng_gui_shutdown();
    return;
  }
  cheng_gui_label_add(window, "Cheng ASM GUI", 24, 24, 360, 32);
  cheng_gui_window_show(window);
  cheng_gui_run();
  cheng_gui_shutdown();
}
