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

    adrp x0, cls_UIApplication@PAGE
    add x0, x0, cls_UIApplication@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_sharedApplication@PAGE
    add x0, x0, sel_sharedApplication@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    bl _objc_msgSend
    mov x20, x0

    adrp x21, g_app@PAGE
    add x21, x21, g_app@PAGEOFF
    str x20, [x21]

    mov w0, #0
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 48
    ret

_cheng_gui_window_create:
    stp x29, x30, [sp, -80]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    stp x21, x22, [sp, 32]
    stp x23, x24, [sp, 48]
    stp x25, x26, [sp, 64]

    mov w22, w1
    mov w23, w2

    adrp x0, cls_UIWindow@PAGE
    add x0, x0, cls_UIWindow@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_alloc@PAGE
    add x0, x0, sel_alloc@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    bl _objc_msgSend
    mov x20, x0

    adrp x0, sel_initWithFrame@PAGE
    add x0, x0, sel_initWithFrame@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    fmov d0, xzr
    fmov d1, xzr
    scvtf d2, w22
    scvtf d3, w23
    bl _objc_msgSend
    mov x20, x0

    adrp x0, cls_UIViewController@PAGE
    add x0, x0, cls_UIViewController@PAGEOFF
    bl _objc_getClass
    mov x21, x0
    adrp x0, sel_alloc@PAGE
    add x0, x0, sel_alloc@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x21
    bl _objc_msgSend
    mov x21, x0

    adrp x0, sel_init@PAGE
    add x0, x0, sel_init@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x21
    bl _objc_msgSend
    mov x21, x0

    adrp x0, sel_setRootViewController@PAGE
    add x0, x0, sel_setRootViewController@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, x21
    bl _objc_msgSend

    adrp x0, sel_view@PAGE
    add x0, x0, sel_view@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x21
    bl _objc_msgSend
    mov x22, x0

    adrp x23, g_root_view@PAGE
    add x23, x23, g_root_view@PAGEOFF
    str x22, [x23]

    adrp x0, sel_makeKeyAndVisible@PAGE
    add x0, x0, sel_makeKeyAndVisible@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    bl _objc_msgSend

    adrp x24, g_window@PAGE
    add x24, x24, g_window@PAGEOFF
    str x20, [x24]

    mov x0, x20
    ldp x25, x26, [sp, 64]
    ldp x23, x24, [sp, 48]
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 80
    ret

_cheng_gui_label_add:
    stp x29, x30, [sp, -80]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    stp x21, x22, [sp, 32]
    stp x23, x24, [sp, 48]
    stp x25, x26, [sp, 64]

    mov x21, x1
    mov w22, w2
    mov w23, w3
    mov w24, w4
    mov w25, w5

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
    mov x26, x0

    adrp x0, cls_UILabel@PAGE
    add x0, x0, cls_UILabel@PAGEOFF
    bl _objc_getClass
    mov x19, x0
    adrp x0, sel_alloc@PAGE
    add x0, x0, sel_alloc@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x19
    bl _objc_msgSend
    mov x20, x0

    adrp x0, sel_initWithFrame@PAGE
    add x0, x0, sel_initWithFrame@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    scvtf d0, w22
    scvtf d1, w23
    scvtf d2, w24
    scvtf d3, w25
    bl _objc_msgSend
    mov x20, x0

    adrp x0, sel_setText@PAGE
    add x0, x0, sel_setText@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x20
    mov x2, x26
    bl _objc_msgSend

    adrp x0, g_root_view@PAGE
    add x0, x0, g_root_view@PAGEOFF
    ldr x22, [x0]
    adrp x0, sel_addSubview@PAGE
    add x0, x0, sel_addSubview@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x22
    mov x2, x20
    bl _objc_msgSend

    mov w0, #0
    ldp x25, x26, [sp, 64]
    ldp x23, x24, [sp, 48]
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 80
    ret

_cheng_gui_window_show:
    stp x29, x30, [sp, -16]!
    mov x29, sp
    mov x2, x0
    adrp x0, sel_makeKeyAndVisible@PAGE
    add x0, x0, sel_makeKeyAndVisible@PAGEOFF
    bl _sel_registerName
    mov x1, x0
    mov x0, x2
    bl _objc_msgSend
    mov w0, #0
    ldp x29, x30, [sp], 16
    ret

_cheng_gui_run:
    mov w0, #0
    ret

_cheng_gui_shutdown:
    ret

.data
cls_UIApplication: .asciz "UIApplication"
cls_UIWindow: .asciz "UIWindow"
cls_UIViewController: .asciz "UIViewController"
cls_UILabel: .asciz "UILabel"
cls_NSString: .asciz "NSString"
sel_sharedApplication: .asciz "sharedApplication"
sel_alloc: .asciz "alloc"
sel_init: .asciz "init"
sel_initWithFrame: .asciz "initWithFrame:"
sel_setRootViewController: .asciz "setRootViewController:"
sel_view: .asciz "view"
sel_makeKeyAndVisible: .asciz "makeKeyAndVisible"
sel_stringWithUTF8String: .asciz "stringWithUTF8String:"
sel_setText: .asciz "setText:"
sel_addSubview: .asciz "addSubview:"

.bss
.align 3
g_app: .quad 0
g_window: .quad 0
g_root_view: .quad 0
