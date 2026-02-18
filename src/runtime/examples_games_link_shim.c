#include <stdint.h>

// Backend/runtime compatibility shim:
// some stage1 outputs reference `addr` directly on Darwin.
int64_t addr(int64_t value) {
  return value;
}

int chengGuiNativeDrawTextBgra(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  double x,
  double y,
  double w,
  double h,
  uint32_t color,
  double fontSize,
  const char *text
);

int chengGuiNativeDrawTextSimple(
  void *pixels,
  int width,
  int height,
  int strideBytes,
  int x,
  int y,
  uint32_t color,
  int fontSize,
  const char *text
) {
  double finalFont = (fontSize > 0) ? (double)fontSize : 12.0;
  return chengGuiNativeDrawTextBgra(
    pixels,
    width,
    height,
    strideBytes,
    (double)x,
    (double)y,
    0.0,
    0.0,
    color,
    finalFont,
    text
  );
}
