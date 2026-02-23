#include <stdint.h>
#include <string.h>

static inline const char* cheng_recover_cstr(const char* s) {
    uintptr_t raw = (uintptr_t)s;
    if (raw == 0u) {
        return (const char*)0;
    }
    if ((raw >> 32) == 0u) {
        uintptr_t high = ((uintptr_t)&raw) & 0xffffffff00000000ULL;
        raw = high | raw;
    }
    return (const char*)raw;
}

int32_t cheng_strlen(char* s) {
    const char* raw = cheng_recover_cstr((const char*)s);
    if (raw == 0 || (uintptr_t)raw < 4096u) {
        return 0;
    }
    return (int32_t)strlen(raw);
}
