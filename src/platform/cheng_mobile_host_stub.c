#include <stddef.h>

typedef struct ChengMobileConfig {
  int platform;
  const char *resourceRoot;
  const char *title;
  int width;
  int height;
  int highDpi;
} ChengMobileConfig;

int cheng_mobile_host_init(const ChengMobileConfig *cfg) {
  (void)cfg;
  return 0;
}

int cheng_mobile_host_open_window(const ChengMobileConfig *cfg) {
  (void)cfg;
  return 0;
}

int cheng_mobile_host_poll_event(void *outEvent) {
  (void)outEvent;
  return 0;
}

void cheng_mobile_host_present(const void *pixels, int width, int height, int strideBytes) {
  (void)pixels;
  (void)width;
  (void)height;
  (void)strideBytes;
}

void cheng_mobile_host_shutdown(const char *reason) {
  (void)reason;
}

const char *cheng_mobile_host_default_resource_root(void) {
  return "";
}
