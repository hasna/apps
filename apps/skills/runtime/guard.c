/* Credential-free child boundary for one reviewed skill. Linux seccomp filters
 * survive exec and descendant creation, so runtime networking cannot bypass the
 * supervisor's deny-egress policy. The task supplies the memory cgroup and a
 * read-only root filesystem; only its private /tmp work directory is writable. */
#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>
#if defined(__x86_64__)
#define SKILLS_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define SKILLS_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported runtime architecture
#endif
#define DENY(n) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (n), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
static int bounds(int resource, rlim_t limit) {
 struct rlimit value = {limit, limit}; return setrlimit(resource, &value);
}
int main(int argc, char **argv) {
 if (argc < 2 || getuid() != 0) return 125;
 if (bounds(RLIMIT_CORE, 0) || bounds(RLIMIT_FSIZE, 2000000) || bounds(RLIMIT_CPU, 60) || bounds(RLIMIT_NOFILE, 128)) return 125;
 if (setgroups(0, NULL) || setgid(65534) || setuid(65534)) return 125;
 if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) return 125;
 struct sock_filter filter[] = {
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SKILLS_ARCH, 1, 0),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
  /* x32 uses the same audit architecture with a different syscall-number bit. */
  BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000U, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
  DENY(SYS_socket), DENY(SYS_socketpair), DENY(SYS_connect),
  DENY(SYS_bind), DENY(SYS_listen), DENY(SYS_accept), DENY(SYS_accept4),
  DENY(SYS_sendto), DENY(SYS_sendmsg), DENY(SYS_sendmmsg),
  DENY(SYS_ptrace), DENY(SYS_process_vm_readv), DENY(SYS_process_vm_writev),
  DENY(SYS_mount), DENY(SYS_umount2), DENY(SYS_pivot_root),
  DENY(SYS_setns), DENY(SYS_unshare), DENY(SYS_bpf),
  DENY(SYS_keyctl), DENY(SYS_perf_event_open),
  /* io_uring networking must not bypass the ordinary socket syscall filter. */
  DENY(SYS_io_uring_setup),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
 };
 struct sock_fprog program = { (unsigned short)(sizeof(filter) / sizeof(filter[0])), filter };
 if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) return 125;
 if (strcmp(argv[1], "--self-test") == 0) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  return fd == -1 && errno == EPERM && getuid() == 65534 ? 0 : 1;
 }
 for (int fd = 3; fd < 128; fd++) close(fd);
 execv(argv[1], &argv[1]);
 perror("skills runtime exec"); return 126;
}
