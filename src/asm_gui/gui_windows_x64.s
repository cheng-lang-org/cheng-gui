.intel_syntax noprefix

.text
.globl cheng_gui_init
.globl cheng_gui_window_create
.globl cheng_gui_window_show
.globl cheng_gui_label_add
.globl cheng_gui_run
.globl cheng_gui_shutdown

.extern GetModuleHandleA
.extern RegisterClassExA
.extern LoadCursorA
.extern CreateWindowExA
.extern ShowWindow
.extern UpdateWindow
.extern GetMessageA
.extern TranslateMessage
.extern DispatchMessageA
.extern DefWindowProcA
.extern PostQuitMessage

cheng_gui_init:
    sub rsp, 40
    xor ecx, ecx
    call GetModuleHandleA
    mov qword ptr [rip + g_instance], rax
    mov qword ptr [rip + wndclass + 24], rax
    xor ecx, ecx
    mov edx, 32512
    call LoadCursorA
    mov qword ptr [rip + wndclass + 40], rax
    lea rcx, [rip + wndclass]
    call RegisterClassExA
    test eax, eax
    jne cheng_gui_init_ok
    mov eax, -1
    add rsp, 40
    ret
cheng_gui_init_ok:
    xor eax, eax
    add rsp, 40
    ret

cheng_gui_window_create:
    mov r10, rcx
    movsxd r11, edx
    movsxd rax, r8d
    sub rsp, 104
    mov qword ptr [rsp + 32], 0x80000000
    mov qword ptr [rsp + 40], 0x80000000
    mov qword ptr [rsp + 48], r11
    mov qword ptr [rsp + 56], rax
    mov qword ptr [rsp + 64], 0
    mov qword ptr [rsp + 72], 0
    mov rax, qword ptr [rip + g_instance]
    mov qword ptr [rsp + 80], rax
    mov qword ptr [rsp + 88], 0
    mov rcx, 0
    lea rdx, [rip + class_name]
    mov r8, r10
    mov r9d, 0x10CF0000
    call CreateWindowExA
    mov qword ptr [rip + g_window], rax
    add rsp, 104
    ret

cheng_gui_label_add:
    movsxd r10, dword ptr [rsp + 40]
    movsxd r11, dword ptr [rsp + 48]
    movsxd r8, r8d
    movsxd r9, r9d
    push r12
    mov r12, rdx
    mov rax, rcx
    sub rsp, 112
    mov qword ptr [rsp + 32], r8
    mov qword ptr [rsp + 40], r9
    mov qword ptr [rsp + 48], r10
    mov qword ptr [rsp + 56], r11
    mov qword ptr [rsp + 64], rax
    mov qword ptr [rsp + 72], 0
    mov rdx, qword ptr [rip + g_instance]
    mov qword ptr [rsp + 80], rdx
    mov qword ptr [rsp + 88], 0
    mov rcx, 0
    lea rdx, [rip + static_class]
    mov r8, r12
    mov r9d, 0x50000000
    call CreateWindowExA
    xor eax, eax
    add rsp, 112
    pop r12
    ret

cheng_gui_window_show:
    sub rsp, 40
    mov qword ptr [rsp + 32], rcx
    mov edx, 1
    call ShowWindow
    mov rcx, qword ptr [rsp + 32]
    call UpdateWindow
    xor eax, eax
    add rsp, 40
    ret

cheng_gui_run:
    sub rsp, 88
cheng_gui_run_loop:
    lea rcx, [rsp + 32]
    xor edx, edx
    xor r8d, r8d
    xor r9d, r9d
    call GetMessageA
    test eax, eax
    jle cheng_gui_run_done
    lea rcx, [rsp + 32]
    call TranslateMessage
    lea rcx, [rsp + 32]
    call DispatchMessageA
    jmp cheng_gui_run_loop
cheng_gui_run_done:
    xor eax, eax
    add rsp, 88
    ret

cheng_gui_shutdown:
    sub rsp, 40
    xor ecx, ecx
    call PostQuitMessage
    add rsp, 40
    ret

cheng_gui_wndproc:
    cmp edx, 2
    jne cheng_gui_wndproc_def
    sub rsp, 40
    xor ecx, ecx
    call PostQuitMessage
    add rsp, 40
    xor eax, eax
    ret
cheng_gui_wndproc_def:
    sub rsp, 40
    call DefWindowProcA
    add rsp, 40
    ret

.data
.p2align 3
g_instance: .quad 0
g_window: .quad 0
class_name: .asciz "ChengAsmGuiWindow"
static_class: .asciz "STATIC"
wndclass:
    .long 80
    .long 3
    .quad cheng_gui_wndproc
    .long 0
    .long 0
    .quad 0
    .quad 0
    .quad 0
    .quad 6
    .quad 0
    .quad class_name
    .quad 0
