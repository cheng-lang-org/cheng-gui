#ifndef CHENG_GUI_ASM_API_H
#define CHENG_GUI_ASM_API_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    CHENG_GUI_OK = 0,
    CHENG_GUI_ERR_FAIL = -1,
    CHENG_GUI_ERR_UNSUPPORTED = -38
};

int32_t cheng_gui_init(void);
void *cheng_gui_window_create(const char *title, int32_t width, int32_t height);
int32_t cheng_gui_window_show(void *window);
int32_t cheng_gui_label_add(void *window, const char *text,
                            int32_t x, int32_t y, int32_t w, int32_t h);
int32_t cheng_gui_run(void);
void cheng_gui_shutdown(void);

#ifdef __cplusplus
}
#endif

#endif
