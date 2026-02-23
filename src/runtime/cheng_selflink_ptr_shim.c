#include <stdint.h>

void* load_ptr(void* p, int32_t off) {
    if (p == 0) {
        return 0;
    }
    return *(void**)((char*)p + off);
}

void store_ptr(void* p, int32_t off, void* v) {
    if (p == 0) {
        return;
    }
    *(void**)((char*)p + off) = v;
}
