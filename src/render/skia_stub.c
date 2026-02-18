#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  include <sys/time.h>
#endif

typedef struct {
  void *surface;
  int pixelWidth;
  int pixelHeight;
  double logicalWidth;
  double logicalHeight;
  double dpiScale;
  char colorSpace[64];
  int commandCount;
  int rectCount;
  int textCount;
  uint64_t frameStartMs;
  int frameSerial;
} ChengSkiaRenderState;

typedef struct {
  double gpuTimeMs;
  int commandCount;
  int rectCount;
  int textCount;
} SkiaFrameStatsC;

static int chengSkiaClampDimension(int value) {
  if (value < 1) {
    return 1;
  }
  if (value > 8192) {
    return 8192;
  }
  return value;
}

static void chengSkiaCopyColorSpace(ChengSkiaRenderState *state,
                                    const char *colorSpace) {
  if (state == NULL) {
    return;
  }
  if (colorSpace == NULL || colorSpace[0] == '\0') {
    strcpy(state->colorSpace, "sRGB");
  } else {
    size_t len = strlen(colorSpace);
    if (len >= sizeof(state->colorSpace)) {
      len = sizeof(state->colorSpace) - 1;
    }
    memcpy(state->colorSpace, colorSpace, len);
    state->colorSpace[len] = '\0';
  }
}

static uint64_t chengSkiaNowMs(void) {
#ifdef _WIN32
  return (uint64_t)GetTickCount64();
#else
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)(tv.tv_usec / 1000);
#endif
}

static ChengSkiaRenderState *chengSkiaStateFrom(void *handle) {
  return (ChengSkiaRenderState *)handle;
}

void *chengSkiaRenderCreate(void *surface,
                            int width,
                            int height,
                            double dpiScale,
                            const char *colorSpace) {
  ChengSkiaRenderState *state =
      (ChengSkiaRenderState *)calloc(1, sizeof(ChengSkiaRenderState));
  if (state == NULL) {
    return NULL;
  }
  state->surface = surface;
  state->pixelWidth = chengSkiaClampDimension(width);
  state->pixelHeight = chengSkiaClampDimension(height);
  state->logicalWidth = (double)state->pixelWidth;
  state->logicalHeight = (double)state->pixelHeight;
  state->dpiScale = dpiScale > 0.0 ? dpiScale : 1.0;
  chengSkiaCopyColorSpace(state, colorSpace);
  state->frameStartMs = 0;
  state->frameSerial = 0;
  return state;
}

void chengSkiaRenderDestroy(void *handle) {
  ChengSkiaRenderState *state = chengSkiaStateFrom(handle);
  if (state == NULL) {
    return;
  }
  free(state);
}

void chengSkiaRenderResize(void *handle, int width, int height) {
  ChengSkiaRenderState *state = chengSkiaStateFrom(handle);
  if (state == NULL) {
    return;
  }
  state->pixelWidth = chengSkiaClampDimension(width);
  state->pixelHeight = chengSkiaClampDimension(height);
}

void chengSkiaRenderBegin(void *handle,
                          double logicalWidth,
                          double logicalHeight,
                          double dpiScale,
                          const char *colorSpace) {
  ChengSkiaRenderState *state = chengSkiaStateFrom(handle);
  if (state == NULL) {
    return;
  }
  state->logicalWidth = logicalWidth;
  state->logicalHeight = logicalHeight;
  state->dpiScale = dpiScale > 0.0 ? dpiScale : 1.0;
  chengSkiaCopyColorSpace(state, colorSpace);
  state->commandCount = 0;
  state->rectCount = 0;
  state->textCount = 0;
  state->frameStartMs = chengSkiaNowMs();
}

void chengSkiaRenderDrawRect(void *handle,
                             double x,
                             double y,
                             double w,
                             double h,
                             uint32_t color,
                             double opacity) {
  ChengSkiaRenderState *state = chengSkiaStateFrom(handle);
  if (state == NULL) {
    return;
  }
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  (void)color;
  (void)opacity;
  state->commandCount += 1;
  state->rectCount += 1;
}

void chengSkiaRenderDrawText(void *handle,
                             double x,
                             double y,
                             double w,
                             double h,
                             uint32_t color,
                             double fontSize,
                             double opacity,
                             const char *text) {
  ChengSkiaRenderState *state = chengSkiaStateFrom(handle);
  if (state == NULL) {
    return;
  }
  (void)x;
  (void)y;
  (void)w;
  (void)h;
  (void)color;
  (void)fontSize;
  (void)opacity;
  (void)text;
  state->commandCount += 1;
  state->textCount += 1;
}

void chengSkiaRenderEnd(void *handle, SkiaFrameStatsC *outStats) {
  ChengSkiaRenderState *state = chengSkiaStateFrom(handle);
  if (state == NULL) {
    return;
  }
  uint64_t nowMs = chengSkiaNowMs();
  double elapsed = 0.0;
  if (state->frameStartMs != 0 && nowMs >= state->frameStartMs) {
    elapsed = (double)(nowMs - state->frameStartMs);
  }
  state->frameSerial += 1;
  if (outStats != NULL) {
    outStats->gpuTimeMs = elapsed;
    outStats->commandCount = state->commandCount;
    outStats->rectCount = state->rectCount;
    outStats->textCount = state->textCount;
  }
  state->commandCount = 0;
  state->rectCount = 0;
  state->textCount = 0;
  state->frameStartMs = 0;
}

