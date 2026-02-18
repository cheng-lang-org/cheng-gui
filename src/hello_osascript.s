.text
.global _main
.extern _system

_main:
    stp x29, x30, [sp, -16]!
    mov x29, sp

    adrp x0, cmd@PAGE
    add x0, x0, cmd@PAGEOFF
    bl _system

    mov w0, #0
    ldp x29, x30, [sp], 16
    ret

.data
cmd:
    .ascii "osascript -e 'display dialog \""
    .byte 0xE4,0xBD,0xA0,0xE5,0xA5,0xBD
    .ascii "\"'"
    .byte 0
