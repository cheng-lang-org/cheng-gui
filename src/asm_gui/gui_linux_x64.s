.text
.globl cheng_gui_init
.globl cheng_gui_window_create
.globl cheng_gui_window_show
.globl cheng_gui_label_add
.globl cheng_gui_run
.globl cheng_gui_shutdown

.extern gtk_init
.extern gtk_window_new
.extern gtk_window_set_title
.extern gtk_window_set_default_size
.extern gtk_fixed_new
.extern gtk_container_add
.extern gtk_label_new
.extern gtk_fixed_put
.extern gtk_widget_set_size_request
.extern gtk_widget_show_all
.extern gtk_main
.extern gtk_main_quit

cheng_gui_init:
    pushq %rbp
    movq %rsp, %rbp
    subq $16, %rsp
    movl $0, (%rsp)
    movq $0, 8(%rsp)
    leaq (%rsp), %rdi
    leaq 8(%rsp), %rsi
    call gtk_init@PLT
    addq $16, %rsp
    xorl %eax, %eax
    popq %rbp
    ret

cheng_gui_window_create:
    pushq %rbp
    movq %rsp, %rbp
    pushq %rbx
    subq $24, %rsp
    movq %rdi, (%rsp)
    movl %esi, 8(%rsp)
    movl %edx, 12(%rsp)
    movl $0, %edi
    call gtk_window_new@PLT
    movq %rax, %rbx
    movq %rbx, %rdi
    movq (%rsp), %rsi
    call gtk_window_set_title@PLT
    movq %rbx, %rdi
    movl 8(%rsp), %esi
    movl 12(%rsp), %edx
    call gtk_window_set_default_size@PLT
    call gtk_fixed_new@PLT
    leaq g_container(%rip), %rcx
    movq %rax, (%rcx)
    movq %rbx, %rdi
    movq %rax, %rsi
    call gtk_container_add@PLT
    leaq g_window(%rip), %rcx
    movq %rbx, (%rcx)
    movq %rbx, %rax
    addq $24, %rsp
    popq %rbx
    popq %rbp
    ret

cheng_gui_label_add:
    movl $0, %eax
    pushq %rbp
    movq %rsp, %rbp
    pushq %rbx
    subq $40, %rsp
    movq %rsi, (%rsp)
    movl %edx, 8(%rsp)
    movl %ecx, 12(%rsp)
    movl %r8d, 16(%rsp)
    movl %r9d, 20(%rsp)
    movq (%rsp), %rdi
    call gtk_label_new@PLT
    movq %rax, %rbx
    leaq g_container(%rip), %rdi
    movq (%rdi), %rdi
    movq %rbx, %rsi
    movl 8(%rsp), %edx
    movl 12(%rsp), %ecx
    call gtk_fixed_put@PLT
    movq %rbx, %rdi
    movl 16(%rsp), %esi
    movl 20(%rsp), %edx
    call gtk_widget_set_size_request@PLT
    xorl %eax, %eax
    addq $40, %rsp
    popq %rbx
    popq %rbp
    ret

cheng_gui_window_show:
    call gtk_widget_show_all@PLT
    xorl %eax, %eax
    ret

cheng_gui_run:
    call gtk_main@PLT
    xorl %eax, %eax
    ret

cheng_gui_shutdown:
    call gtk_main_quit@PLT
    ret

.bss
.align 8
g_window: .quad 0
g_container: .quad 0
