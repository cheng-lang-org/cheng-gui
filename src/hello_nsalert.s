.text
.global _main
.extern _objc_getClass
.extern _sel_registerName
.extern _objc_msgSend

_main:
    stp x29, x30, [sp, -16]!
    mov x29, sp

    // NSApplication sharedApplication
    adrp x0, cls_NSApplication@PAGE
    add x0, x0, cls_NSApplication@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_sharedApplication@PAGE
    add x0, x0, sel_sharedApplication@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    bl _objc_msgSend
    mov x20, x0

    // [NSApp setActivationPolicy:]
    adrp x0, sel_setActivationPolicy@PAGE
    add x0, x0, sel_setActivationPolicy@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, #0
    bl _objc_msgSend

    // [NSApp activateIgnoringOtherApps:]
    adrp x0, sel_activateIgnoringOtherApps@PAGE
    add x0, x0, sel_activateIgnoringOtherApps@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, #1
    bl _objc_msgSend

    // NSString *s = [NSString stringWithUTF8String:]
    adrp x0, cls_NSString@PAGE
    add x0, x0, cls_NSString@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_stringWithUTF8String@PAGE
    add x0, x0, sel_stringWithUTF8String@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    adrp x2, str_nihao@PAGE
    add x2, x2, str_nihao@PAGEOFF
    bl _objc_msgSend
    mov x21, x0

    // NSAlert *a = [NSAlert new]
    adrp x0, cls_NSAlert@PAGE
    add x0, x0, cls_NSAlert@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_new@PAGE
    add x0, x0, sel_new@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    bl _objc_msgSend
    mov x22, x0

    // [a setMessageText:s]
    adrp x0, sel_setMessageText@PAGE
    add x0, x0, sel_setMessageText@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x22
    mov x2, x21
    bl _objc_msgSend

    // [a runModal]
    adrp x0, sel_runModal@PAGE
    add x0, x0, sel_runModal@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x22
    bl _objc_msgSend

    mov w0, #0
    ldp x29, x30, [sp], 16
    ret

.data
cls_NSApplication: .asciz "NSApplication"
cls_NSAlert: .asciz "NSAlert"
cls_NSString: .asciz "NSString"
sel_sharedApplication: .asciz "sharedApplication"
sel_setActivationPolicy: .asciz "setActivationPolicy:"
sel_activateIgnoringOtherApps: .asciz "activateIgnoringOtherApps:"
sel_stringWithUTF8String: .asciz "stringWithUTF8String:"
sel_new: .asciz "new"
sel_setMessageText: .asciz "setMessageText:"
sel_runModal: .asciz "runModal"
str_nihao:
    .byte 0xE4,0xBD,0xA0,0xE5,0xA5,0xBD,0x00
