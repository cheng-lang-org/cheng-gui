.text
.global cheng_gui_init
.global cheng_gui_window_create
.global cheng_gui_window_show
.global cheng_gui_label_add
.global cheng_gui_run
.global cheng_gui_shutdown

.extern cheng_mobile_host_init
.extern cheng_mobile_host_open_window
.extern cheng_mobile_host_present
.extern cheng_mobile_host_poll_event
.extern cheng_mobile_host_shutdown
.extern cheng_mobile_host_default_resource_root
.extern cheng_mobile_host_android_width
.extern cheng_mobile_host_android_height
.extern chengGuiNativeDrawTextBgra
.extern malloc
.extern free
.extern memset
.extern usleep

.equ CFG_PLATFORM, 0
.equ CFG_RESROOT, 8
.equ CFG_TITLE, 16
.equ CFG_WIDTH, 24
.equ CFG_HEIGHT, 28
.equ CFG_HIDPI, 32

cheng_gui_init:
    stp x29, x30, [sp, -32]!
    mov x29, sp
    stp x19, x20, [sp, 16]

    adrp x19, g_initialized@PAGE
    add x19, x19, g_initialized@PAGEOFF
    ldr w20, [x19]
    cbnz w20, .android_init_done

    adrp x0, g_cfg@PAGE
    add x0, x0, g_cfg@PAGEOFF
    mov w1, #0
    str w1, [x0, #CFG_PLATFORM]
    bl cheng_mobile_host_default_resource_root
    adrp x1, g_cfg@PAGE
    add x1, x1, g_cfg@PAGEOFF
    str x0, [x1, #CFG_RESROOT]
    adrp x2, g_default_title@PAGE
    add x2, x2, g_default_title@PAGEOFF
    str x2, [x1, #CFG_TITLE]
    mov w3, #960
    str w3, [x1, #CFG_WIDTH]
    mov w3, #540
    str w3, [x1, #CFG_HEIGHT]
    mov w3, #1
    str w3, [x1, #CFG_HIDPI]

    mov x0, x1
    bl cheng_mobile_host_init
    mov w0, #1
    str w0, [x19]

.android_init_done:
    mov w0, #0
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 32
    ret

cheng_gui_window_create:
    stp x29, x30, [sp, -48]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    stp x21, x22, [sp, 32]

    mov x19, x0
    mov w20, w1
    mov w21, w2
    bl cheng_gui_init

    adrp x0, g_cfg@PAGE
    add x0, x0, g_cfg@PAGEOFF
    cbz x19, .android_title_done
    str x19, [x0, #CFG_TITLE]
.android_title_done:
    cmp w20, #0
    ble .android_width_done
    str w20, [x0, #CFG_WIDTH]
.android_width_done:
    cmp w21, #0
    ble .android_height_done
    str w21, [x0, #CFG_HEIGHT]
.android_height_done:
    mov x0, x0
    bl cheng_mobile_host_open_window
    adrp x1, g_window_id@PAGE
    add x1, x1, g_window_id@PAGEOFF
    str w0, [x1]

    adrp x0, g_window_token@PAGE
    add x0, x0, g_window_token@PAGEOFF
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 48
    ret

cheng_gui_window_show:
    stp x29, x30, [sp, -16]!
    mov x29, sp
    bl android_render_label
    mov w0, #0
    ldp x29, x30, [sp], 16
    ret

cheng_gui_label_add:
    stp x29, x30, [sp, -32]!
    mov x29, sp
    stp x19, x20, [sp, 16]

    mov x19, x1
    cbz x19, .android_label_fail
    adrp x0, g_label_text@PAGE
    add x0, x0, g_label_text@PAGEOFF
    str x19, [x0]
    adrp x0, g_label_x@PAGE
    add x0, x0, g_label_x@PAGEOFF
    str w2, [x0]
    adrp x0, g_label_y@PAGE
    add x0, x0, g_label_y@PAGEOFF
    str w3, [x0]
    adrp x0, g_label_w@PAGE
    add x0, x0, g_label_w@PAGEOFF
    str w4, [x0]
    adrp x0, g_label_h@PAGE
    add x0, x0, g_label_h@PAGEOFF
    str w5, [x0]

    bl android_render_label
    mov w0, #0
    b .android_label_done
.android_label_fail:
    mov w0, #-1
.android_label_done:
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 32
    ret

cheng_gui_run:
    stp x29, x30, [sp, -32]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    bl cheng_gui_init

.android_run_loop:
    bl android_render_label
    sub sp, sp, #96
    mov x0, sp
    bl cheng_mobile_host_poll_event
    cbz w0, .android_run_sleep
    ldr w1, [sp]
    add sp, sp, #96
    cmp w1, #3
    beq .android_run_done
    b .android_run_loop
.android_run_sleep:
    add sp, sp, #96
    adrp x0, g_sleep_us@PAGE
    add x0, x0, g_sleep_us@PAGEOFF
    ldr w0, [x0]
    bl usleep
    b .android_run_loop

.android_run_done:
    mov w0, #0
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 32
    ret

cheng_gui_shutdown:
    stp x29, x30, [sp, -32]!
    mov x29, sp
    stp x19, x20, [sp, 16]

    adrp x0, g_pixels@PAGE
    add x0, x0, g_pixels@PAGEOFF
    ldr x1, [x0]
    cbz x1, .android_skip_free
    mov x0, x1
    bl free
    adrp x2, g_pixels@PAGE
    add x2, x2, g_pixels@PAGEOFF
    mov x3, xzr
    str x3, [x2]
.android_skip_free:
    adrp x0, g_exit_text@PAGE
    add x0, x0, g_exit_text@PAGEOFF
    bl cheng_mobile_host_shutdown
    adrp x0, g_initialized@PAGE
    add x0, x0, g_initialized@PAGEOFF
    mov w1, #0
    str w1, [x0]

    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 32
    ret

android_render_label:
    stp x29, x30, [sp, -96]!
    mov x29, sp
    stp x19, x20, [sp, 16]
    stp x21, x22, [sp, 32]
    stp x23, x24, [sp, 48]
    stp x25, x26, [sp, 64]
    stp x27, x28, [sp, 80]

    adrp x19, g_label_text@PAGE
    add x19, x19, g_label_text@PAGEOFF
    ldr x19, [x19]
    cbz x19, .android_render_done

    bl cheng_mobile_host_android_width
    mov w20, w0
    bl cheng_mobile_host_android_height
    mov w21, w0

    cmp w20, #0
    bgt .android_width_ok
    adrp x0, g_cfg@PAGE
    add x0, x0, g_cfg@PAGEOFF
    ldr w20, [x0, #CFG_WIDTH]
.android_width_ok:
    cmp w21, #0
    bgt .android_height_ok
    adrp x0, g_cfg@PAGE
    add x0, x0, g_cfg@PAGEOFF
    ldr w21, [x0, #CFG_HEIGHT]
.android_height_ok:

    uxtw x22, w20
    lsl x23, x22, #2
    uxtw x24, w21
    mul x25, x23, x24

    adrp x0, g_pixels@PAGE
    add x0, x0, g_pixels@PAGEOFF
    ldr x0, [x0]
    cbz x0, .android_alloc_pixels
    adrp x1, g_width@PAGE
    add x1, x1, g_width@PAGEOFF
    ldr w1, [x1]
    cmp w1, w20
    bne .android_alloc_pixels
    adrp x1, g_height@PAGE
    add x1, x1, g_height@PAGEOFF
    ldr w1, [x1]
    cmp w1, w21
    bne .android_alloc_pixels
    b .android_have_pixels

.android_alloc_pixels:
    adrp x1, g_pixels@PAGE
    add x1, x1, g_pixels@PAGEOFF
    ldr x1, [x1]
    cbz x1, .android_skip_free2
    mov x0, x1
    bl free
.android_skip_free2:
    mov x0, x25
    bl malloc
    cbz x0, .android_render_done
    adrp x1, g_pixels@PAGE
    add x1, x1, g_pixels@PAGEOFF
    str x0, [x1]
    adrp x1, g_width@PAGE
    add x1, x1, g_width@PAGEOFF
    str w20, [x1]
    adrp x1, g_height@PAGE
    add x1, x1, g_height@PAGEOFF
    str w21, [x1]
    adrp x1, g_stride@PAGE
    add x1, x1, g_stride@PAGEOFF
    str w23, [x1]

.android_have_pixels:
    adrp x0, g_pixels@PAGE
    add x0, x0, g_pixels@PAGEOFF
    ldr x0, [x0]
    cbz x0, .android_render_done

    mov x1, xzr
    mov x2, x25
    bl memset

    adrp x1, g_label_x@PAGE
    add x1, x1, g_label_x@PAGEOFF
    ldr w26, [x1]
    adrp x1, g_label_y@PAGE
    add x1, x1, g_label_y@PAGEOFF
    ldr w27, [x1]
    adrp x1, g_label_w@PAGE
    add x1, x1, g_label_w@PAGEOFF
    ldr w28, [x1]
    adrp x1, g_label_h@PAGE
    add x1, x1, g_label_h@PAGEOFF
    ldr w22, [x1]

    mov w1, w20
    mov w2, w21
    mov w3, w23
    scvtf d0, w26
    scvtf d1, w27
    scvtf d2, w28
    scvtf d3, w22
    adrp x4, g_text_color@PAGE
    add x4, x4, g_text_color@PAGEOFF
    ldr w4, [x4]
    adrp x5, g_font_size@PAGE
    add x5, x5, g_font_size@PAGEOFF
    ldr d4, [x5]
    mov x5, x19
    bl chengGuiNativeDrawTextBgra

    adrp x0, g_pixels@PAGE
    add x0, x0, g_pixels@PAGEOFF
    ldr x0, [x0]
    mov w1, w20
    mov w2, w21
    mov w3, w23
    bl cheng_mobile_host_present

.android_render_done:
    ldp x27, x28, [sp, 80]
    ldp x25, x26, [sp, 64]
    ldp x23, x24, [sp, 48]
    ldp x21, x22, [sp, 32]
    ldp x19, x20, [sp, 16]
    ldp x29, x30, [sp], 96
    ret

.data
g_default_title: .asciz "Cheng ASM GUI"
g_exit_text: .asciz "exit"
g_text_color: .word 0xFFFFFFFF
g_sleep_us: .word 16000
g_font_size: .double 18.0

.bss
.align 3
g_cfg: .skip 40
g_initialized: .word 0
g_window_token: .quad 1
g_window_id: .word 0
g_pixels: .quad 0
g_stride: .word 0
g_width: .word 0
g_height: .word 0
g_label_text: .quad 0
g_label_x: .word 0
g_label_y: .word 0
g_label_w: .word 0
g_label_h: .word 0
