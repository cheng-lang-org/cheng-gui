#include <stdint.h>

int32_t cwCliEntry(void);
void __cheng_setCmdLine(int32_t argc, void* argv);

int main(int argc, char** argv) {
    __cheng_setCmdLine((int32_t)argc, (void*)argv);
    return (int)cwCliEntry();
}
