.text
.global _cheng_gui_init
.global _cheng_gui_window_create
.global _cheng_gui_window_show
.global _cheng_gui_label_add
.global _cheng_gui_run
.global _cheng_gui_shutdown

.extern _objc_getClass
.extern _sel_registerName
.extern _objc_msgSend

_cheng_gui_init:
    stp x29, x30, [sp, -48]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    stp x21, x22, [sp, 32]

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

    // store g_app
    adrp x21, g_app@PAGE
    add x21, x21, g_app@PAGEOFF
    str x20, [x21]

    // [NSApp setActivationPolicy:0]
    adrp x0, sel_setActivationPolicy@PAGE
    add x0, x0, sel_setActivationPolicy@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, #0
    bl _objc_msgSend

    mov w0, #0
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 48
    ret

_cheng_gui_window_create:
    // x0 = title, w1 = width, w2 = height
    stp x29, x30, [sp, -64]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    stp x21, x22, [sp, 32]
    stp x23, x24, [sp, 48]

    mov x21, x0
    mov w22, w1
    mov w23, w2

    // NSWindow alloc
    adrp x0, cls_NSWindow@PAGE
    add x0, x0, cls_NSWindow@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_alloc@PAGE
    add x0, x0, sel_alloc@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    bl _objc_msgSend
    mov x20, x0

    // initWithContentRect:styleMask:backing:defer:
    adrp x0, sel_initWithContentRect@PAGE
    add x0, x0, sel_initWithContentRect@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    fmov d0, xzr
    fmov d1, xzr
    scvtf d2, w22
    scvtf d3, w23
    mov x2, #15
    mov x3, #2
    mov x4, #0
    bl _objc_msgSend
    mov x20, x0

    // NSString *title = [NSString stringWithUTF8String:]
    adrp x0, cls_NSString@PAGE
    add x0, x0, cls_NSString@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_stringWithUTF8String@PAGE
    add x0, x0, sel_stringWithUTF8String@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    mov x2, x21
    bl _objc_msgSend
    mov x22, x0

    // [window setTitle:]
    adrp x0, sel_setTitle@PAGE
    add x0, x0, sel_setTitle@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, x22
    bl _objc_msgSend

    // store g_window
    adrp x24, g_window@PAGE
    add x24, x24, g_window@PAGEOFF
    str x20, [x24]

    mov x0, x20
    ldp x23, x24, [sp, 48]
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 64
    ret

_cheng_gui_label_add:
    // x0 = window, x1 = text, w2 = x, w3 = y, w4 = w, w5 = h
    stp x29, x30, [sp, -64]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    stp x21, x22, [sp, 32]
    stp x23, x24, [sp, 48]

    mov x19, x0
    mov x21, x1
    mov w22, w2
    mov w23, w3
    mov w24, w4

    // NSString *s = [NSString stringWithUTF8String:]
    adrp x0, cls_NSString@PAGE
    add x0, x0, cls_NSString@PAGEOFF
    bl _objc_getClass
    mov x20, x0
    adrp x0, sel_stringWithUTF8String@PAGE
    add x0, x0, sel_stringWithUTF8String@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, x21
    bl _objc_msgSend
    mov x21, x0

    // NSTextField *label = [NSTextField labelWithString:]
    adrp x0, cls_NSTextField@PAGE
    add x0, x0, cls_NSTextField@PAGEOFF
    bl _objc_getClass
    mov x20, x0
    adrp x0, sel_labelWithString@PAGE
    add x0, x0, sel_labelWithString@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, x21
    bl _objc_msgSend
    mov x22, x0

    // [label setFrame:]
    adrp x0, sel_setFrame@PAGE
    add x0, x0, sel_setFrame@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x22
    scvtf d0, w22
    scvtf d1, w23
    scvtf d2, w24
    scvtf d3, w5
    bl _objc_msgSend

    // contentView
    adrp x0, sel_contentView@PAGE
    add x0, x0, sel_contentView@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    bl _objc_msgSend
    mov x23, x0

    // [contentView addSubview:label]
    adrp x0, sel_addSubview@PAGE
    add x0, x0, sel_addSubview@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x23
    mov x2, x22
    bl _objc_msgSend

    mov w0, #0
    ldp x23, x24, [sp, 48]
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 64
    ret

_cheng_gui_window_show:
    // x0 = window
    stp x29, x30, [sp, -32]!
    mov x29, sp
    stp x19, x20, [sp, 16]

    mov x19, x0

    // [window makeKeyAndOrderFront:nil]
    adrp x0, sel_makeKeyAndOrderFront@PAGE
    add x0, x0, sel_makeKeyAndOrderFront@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    mov x2, xzr
    bl _objc_msgSend

    // [NSApp activateIgnoringOtherApps:YES]
    adrp x20, g_app@PAGE
    add x20, x20, g_app@PAGEOFF
    ldr x20, [x20]
    adrp x0, sel_activateIgnoringOtherApps@PAGE
    add x0, x0, sel_activateIgnoringOtherApps@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, #1
    bl _objc_msgSend

    mov w0, #0
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 32
    ret

_cheng_gui_run:
    stp x29, x30, [sp, -16]!
    mov x29, sp

    adrp x0, g_app@PAGE
    add x0, x0, g_app@PAGEOFF
    ldr x0, [x0]
    adrp x1, sel_run@PAGE
    add x1, x1, sel_run@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    adrp x0, g_app@PAGE
    add x0, x0, g_app@PAGEOFF
    ldr x0, [x0]
    bl _objc_msgSend

    mov w0, #0
    ldp x29, x30, [sp], 16
    ret

_cheng_gui_shutdown:
    stp x29, x30, [sp, -16]!
    mov x29, sp

    adrp x0, g_app@PAGE
    add x0, x0, g_app@PAGEOFF
    ldr x0, [x0]
    adrp x1, sel_terminate@PAGE
    add x1, x1, sel_terminate@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    adrp x0, g_app@PAGE
    add x0, x0, g_app@PAGEOFF
    ldr x0, [x0]
    mov x2, xzr
    bl _objc_msgSend

    ldp x29, x30, [sp], 16
    ret

.data
cls_NSApplication: .asciz "NSApplication"
cls_NSWindow: .asciz "NSWindow"
cls_NSString: .asciz "NSString"
cls_NSTextField: .asciz "NSTextField"
sel_sharedApplication: .asciz "sharedApplication"
sel_setActivationPolicy: .asciz "setActivationPolicy:"
sel_activateIgnoringOtherApps: .asciz "activateIgnoringOtherApps:"
sel_alloc: .asciz "alloc"
sel_initWithContentRect: .asciz "initWithContentRect:styleMask:backing:defer:"
sel_setTitle: .asciz "setTitle:"
sel_stringWithUTF8String: .asciz "stringWithUTF8String:"
sel_labelWithString: .asciz "labelWithString:"
sel_setFrame: .asciz "setFrame:"
sel_contentView: .asciz "contentView"
sel_addSubview: .asciz "addSubview:"
sel_makeKeyAndOrderFront: .asciz "makeKeyAndOrderFront:"
sel_run: .asciz "run"
sel_terminate: .asciz "terminate:"

.bss
.align 3
g_app: .quad 0
g_window: .quad 0
