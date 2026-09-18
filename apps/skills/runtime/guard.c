/* Credential-free child boundary for one reviewed skill. Linux seccomp filters
 * survive exec and descendant creation, so runtime networking cannot bypass the
 * supervisor's deny-egress policy. The task supplies the memory cgroup and a
 * read-only root filesystem; only its private /tmp work directory is writable. */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <grp.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <linux/sched.h>
#include <stddef.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
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
/* Lowering RLIMIT_NOFILE does not close already open descriptors above it. */
static int close_inherited(void) {
#ifdef SYS_close_range
 if (syscall(SYS_close_range, 3U, ~0U, 0) == 0) return 0;
 if (errno != ENOSYS && errno != EINVAL) return -1;
#endif
 DIR *directory = opendir("/proc/self/fd");
 if (!directory) return -1;
 int own_fd = dirfd(directory), result = 0;
 struct dirent *entry;
 for (;;) {
  errno = 0;
  entry = readdir(directory);
  if (!entry) { if (errno) result = -1; break; }
  char *end = NULL;
  long fd = strtol(entry->d_name, &end, 10);
  if (!*entry->d_name || *end || fd < 3 || fd > INT_MAX || fd == own_fd) continue;
  if (close((int)fd) && errno != EBADF) { result = -1; break; }
 }
 if (closedir(directory)) result = -1;
 return result;
}
static int execute(int pure, char **command) {
 if (bounds(RLIMIT_CORE, 0) || bounds(RLIMIT_FSIZE, pure ? 16384 : 2000000) || bounds(RLIMIT_CPU, pure ? 5 : 60) || bounds(RLIMIT_NOFILE, 128)) return 125;
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
  /* clone3's flags are behind a pointer that seccomp cannot inspect. ENOSYS
   * permits libc's ordinary clone fallback, including Bun worker threads. */
#ifdef SYS_clone3
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, pure ? SECCOMP_RET_ERRNO | ENOSYS : SECCOMP_RET_ALLOW),
#endif
  /* Blocking unshare/setns alone would leave clone-created user/PID namespaces
   * able to escape the monitor's process group. Ordinary forks/threads remain. */
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 4),
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
  BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K,
   CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWNS |
   CLONE_NEWCGROUP | CLONE_NEWUTS | CLONE_NEWIPC, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, pure ? SECCOMP_RET_ERRNO | EPERM : SECCOMP_RET_ALLOW),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  /* Pure descendants cannot leave the one group owned by the monitor. */
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_setsid, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, pure ? SECCOMP_RET_ERRNO | EPERM : SECCOMP_RET_ALLOW),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_setpgid, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, pure ? SECCOMP_RET_ERRNO | EPERM : SECCOMP_RET_ALLOW),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
 };
 struct sock_fprog program = { (unsigned short)(sizeof(filter) / sizeof(filter[0])), filter };
 if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) return 125;
 if (strcmp(command[0], "--self-test") == 0) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  return fd == -1 && errno == EPERM && getuid() == 65534 ? 0 : 1;
 }
 execv(command[0], command);
 perror("skills runtime exec"); return 126;
}

static volatile sig_atomic_t stopped = 0;
static void stop(int signal_number) { stopped = signal_number; }

/* The monitor has no callback token or inherited descriptors. It retains uid0
 * only so its uid65534 child cannot kill it before descendant cleanup. It never
 * executes bundle code. Keeping the group leader unreaped until kill prevents
 * reuse of its PID/group number from targeting an unrelated process. */
static int pure_run(char **command) {
 sigset_t blocked, previous;
 sigemptyset(&blocked);
 sigaddset(&blocked, SIGTERM); sigaddset(&blocked, SIGINT);
 sigaddset(&blocked, SIGHUP); sigaddset(&blocked, SIGALRM);
 if (sigprocmask(SIG_BLOCK, &blocked, &previous)) return 125;
 struct sigaction action = {0};
 action.sa_handler = stop;
 sigemptyset(&action.sa_mask);
 if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL) ||
     sigaction(SIGHUP, &action, NULL) || sigaction(SIGALRM, &action, NULL)) return 125;
 struct sigaction child_action = {0};
 child_action.sa_handler = SIG_DFL;
 sigemptyset(&child_action.sa_mask);
 /* An inherited SIG_IGN/SA_NOCLDWAIT would release the leader PID too early. */
 if (sigaction(SIGCHLD, &child_action, NULL)) return 125;
 sigdelset(&previous, SIGTERM); sigdelset(&previous, SIGINT);
 sigdelset(&previous, SIGHUP); sigdelset(&previous, SIGALRM);
 pid_t supervisor = getppid();
 if (prctl(PR_SET_PDEATHSIG, SIGTERM) || prctl(PR_SET_CHILD_SUBREAPER, 1) ||
     prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) return 125;
 if (getppid() != supervisor) return 125;
 struct timespec started;
 if (clock_gettime(CLOCK_MONOTONIC, &started)) return 125;
 pid_t child = fork();
 if (child < 0) return 125;
 if (!child) {
  if (setpgid(0, 0)) _exit(125);
  action.sa_handler = SIG_DFL;
  if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL) ||
      sigaction(SIGHUP, &action, NULL) || sigaction(SIGALRM, &action, NULL) ||
      sigprocmask(SIG_SETMASK, &previous, NULL)) _exit(125);
  _exit(execute(1, command));
 }
 /* Either side can win the setup race, but only this exact child is targeted. */
 if (setpgid(child, child) && errno != EACCES && errno != ESRCH) {
  kill(child, SIGKILL);
  while (waitpid(child, NULL, 0) < 0 && errno == EINTR) {}
  return 125;
 }
 alarm(5);
 if (sigprocmask(SIG_SETMASK, &previous, NULL)) stopped = SIGTERM;
 siginfo_t info = {0};
 int status = 0, failed = 0;
 while (!stopped) {
  /* Never block after testing stopped: a signal between that test and waitid
   * would otherwise be lost as a wake-up. WNOHANG plus a monotonic deadline
   * bounds even that race, while WNOWAIT still reserves the leader's PID. */
  memset(&info, 0, sizeof(info));
  if (waitid(P_PID, (id_t)child, &info, WEXITED | WNOWAIT | WNOHANG)) {
   if (errno != EINTR) { failed = 1; break; }
  } else if (info.si_pid == child) break;
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now)) { failed = 1; break; }
  long long elapsed = (long long)(now.tv_sec - started.tv_sec) * 1000000000LL + now.tv_nsec - started.tv_nsec;
  if (elapsed >= 5000000000LL) { stopped = SIGALRM; break; }
  struct timespec pause = {0, 10000000};
  nanosleep(&pause, NULL);
 }
 /* Child may already have exited, but its unreaped PID still owns this group. */
 kill(-child, SIGKILL);
 while (waitpid(child, &status, 0) < 0) { if (errno != EINTR) { failed = 1; break; } }
 /* Subreaper adoption makes every remaining descendant an owned direct child. */
 while (waitpid(-1, NULL, 0) >= 0 || errno == EINTR) {}
 alarm(0);
 if (stopped) return 124;
 if (failed) return 125;
 if (WIFEXITED(status)) return WEXITSTATUS(status);
 return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 125;
}

int main(int argc, char **argv) {
 if (argc < 2 || getuid() != 0) return 125;
 int pure = strcmp(argv[1], "--pure") == 0;
 if (argc < (pure ? 3 : 2) || close_inherited()) return 125;
 return pure ? pure_run(&argv[2]) : execute(0, &argv[1]);
}
