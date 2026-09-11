import Darwin
import Foundation
import Testing

/// Test-only observation of the original pipes, independent of transient pre-exec copies.
enum PipeClosureFixture {
    static func now() -> UInt64 {
        var value = timespec()
        precondition(clock_gettime(CLOCK_MONOTONIC, &value) == 0)
        return UInt64(value.tv_sec) * 1_000_000_000 + UInt64(value.tv_nsec)
    }

    static func request(pid: pid_t, deadlineFile: URL) throws -> UInt64 {
        let deadline = now() + 3_000_000_000
        try String(deadline).write(to: deadlineFile, atomically: true, encoding: .utf8)
        try #require(Darwin.kill(pid, SIGUSR1) == 0)
        return deadline
    }

    static func marker(at file: URL) -> String? {
        guard let value = try? String(contentsOf: file, encoding: .utf8), !value.isEmpty else { return nil }
        return value
    }

    static func waitForMarker(at file: URL, deadline: UInt64) -> String? {
        while now() < deadline {
            if let value = marker(at: file), now() < deadline { return value }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return nil
    }

    // Shared by both silent-holder fixtures and the deterministic observer controls.
    // Success is published atomically only when both EPIPE observations are before the
    // same parent-supplied deadline. Retry the observation, never the command or test.
    static let observerSource = #"""
    #include <errno.h>
    #include <fcntl.h>
    #include <limits.h>
    #include <stdint.h>
    #include <stdio.h>
    #include <time.h>
    #include <unistd.h>

    static uint64_t monotonic_ns(void) {
        struct timespec value;
        if (clock_gettime(CLOCK_MONOTONIC, &value)) _exit(70);
        return (uint64_t)value.tv_sec * 1000000000ULL + (uint64_t)value.tv_nsec;
    }

    static int observePipeClosure(const char *deadlinePath, const char *markerPath,
        const char *detailsPath, const char *connectedPath, void (*owners)(FILE *, int)) {
        unsigned long long deadline;
        FILE *request = fopen(deadlinePath, "r");
        if (!request) return 71;
        int parsed = fscanf(request, "%llu", &deadline);
        fclose(request);
        if (parsed != 1) return 72;
        for (int fd = STDOUT_FILENO; fd <= STDERR_FILENO; fd++) {
            int flags = fcntl(fd, F_GETFL);
            if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) return 73;
        }
        ssize_t results[2] = {0, 0}, first[2] = {0, 0};
        int errors[2] = {0, 0}, firstErrors[2] = {0, 0}, broken[2] = {0, 0};
        unsigned attempts = 0;
        uint64_t observedAt = 0;
        int invalid = 0;
        while (monotonic_ns() < deadline) {
            for (int i = 0; i < 2; i++) {
                if (broken[i]) continue;
                errno = 0;
                results[i] = write(STDOUT_FILENO + i, "x", 1);
                errors[i] = errno;
                broken[i] = results[i] == -1 && errors[i] == EPIPE;
                if (results[i] != 1 && !broken[i] &&
                    !(results[i] == -1 && (errors[i] == EINTR || errors[i] == EAGAIN))) invalid = 1;
            }
            observedAt = monotonic_ns();
            if (attempts++ == 0) {
                for (int i = 0; i < 2; i++) { first[i] = results[i]; firstErrors[i] = errors[i]; }
                if (connectedPath && !broken[0] && !broken[1] && !invalid) {
                    FILE *connected = fopen(connectedPath, "w");
                    if (!connected) return 74;
                    fputs("connected", connected);
                    fclose(connected);
                }
            }
            if (invalid || (broken[0] && broken[1]) || observedAt >= deadline) break;
            uint64_t remaining = deadline - observedAt;
            struct timespec delay = {0, (long)(remaining < 10000000 ? remaining : 10000000)};
            nanosleep(&delay, NULL);
        }
        int success = !invalid && broken[0] && broken[1] && observedAt < deadline;
        FILE *details = detailsPath ? fopen(detailsPath, "w") : NULL;
        if (details) {
            fprintf(details, "first_stdout=%ld,errno=%d; first_stderr=%ld,errno=%d; stdout=%ld,errno=%d; stderr=%ld,errno=%d; attempts=%u; observed_ns=%llu; deadline_ns=%llu",
                (long)first[0], firstErrors[0], (long)first[1], firstErrors[1],
                (long)results[0], errors[0], (long)results[1], errors[1], attempts,
                (unsigned long long)observedAt, deadline);
            if (!success && owners) { owners(details, STDOUT_FILENO); owners(details, STDERR_FILENO); }
            fclose(details);
        }
        char pending[PATH_MAX];
        int length = snprintf(pending, sizeof(pending), "%s.pending", markerPath);
        if (length < 0 || length >= (int)sizeof(pending)) return 75;
        FILE *marker = fopen(pending, "w");
        if (!marker) return 76;
        fputs(success ? "both-epipe" : invalid ? "probe-error" : "still-connected", marker);
        if (fclose(marker) || rename(pending, markerPath)) return 77;
        return 0;
    }
    """#
}

extension CLIRunnerTests {
    @Test("pipe closure observer distinguishes transient readers from one persistent reader", arguments: [false, true])
    func pipeClosureObserverControls(persistentReader: Bool) throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("recordings-pipe-observer-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("observer.c")
        let executable = root.appendingPathComponent("observer")
        let ready = root.appendingPathComponent("ready")
        let deadlineFile = root.appendingPathComponent("deadline")
        let marker = root.appendingPathComponent("result")
        let details = root.appendingPathComponent("details")
        let connected = root.appendingPathComponent("connected")
        try """
        #include <signal.h>
        \(PipeClosureFixture.observerSource)
        static volatile sig_atomic_t requested = 0;
        static void requestProbe(int signo) { (void)signo; requested = 1; }
        int main(int argc, char **argv) {
            if (argc != 6) return 64;
            signal(SIGPIPE, SIG_IGN);
            signal(SIGUSR1, requestProbe);
            FILE *ready = fopen(argv[1], "w");
            if (!ready) return 65;
            fputs("ready", ready);
            fclose(ready);
            while (!requested) {
                struct timespec delay = {0, 1000000};
                nanosleep(&delay, NULL);
            }
            return observePipeClosure(argv[2], argv[3], argv[4], argv[5], NULL);
        }
        """.write(to: source, atomically: true, encoding: .utf8)
        let compile = Process()
        compile.executableURL = URL(fileURLWithPath: "/usr/bin/cc")
        compile.arguments = ["-Wall", "-Wextra", "-Werror", "-o", executable.path, source.path]
        try compile.run()
        compile.waitUntilExit()
        try #require(compile.terminationStatus == 0)

        let output = Pipe(), error = Pipe()
        var leases: [Int32] = []
        defer {
            for descriptor in leases where descriptor >= 0 { _ = Darwin.close(descriptor) }
            for handle in [output.fileHandleForReading, output.fileHandleForWriting,
                           error.fileHandleForReading, error.fileHandleForWriting] { try? handle.close() }
        }
        for pipe in [output, error] {
            let descriptor = Darwin.fcntl(pipe.fileHandleForReading.fileDescriptor, F_DUPFD_CLOEXEC, 3)
            try #require(descriptor >= 0)
            leases.append(descriptor)
        }
        let child = Process()
        child.executableURL = executable
        child.arguments = [ready.path, deadlineFile.path, marker.path, details.path, connected.path]
        child.standardOutput = output
        child.standardError = error
        try child.run()
        defer {
            if child.isRunning { _ = Darwin.kill(child.processIdentifier, SIGKILL) }
            child.waitUntilExit()
        }
        try output.fileHandleForReading.close()
        try error.fileHandleForReading.close()
        try output.fileHandleForWriting.close()
        try error.fileHandleForWriting.close()
        try #require(PipeClosureFixture.waitForMarker(at: ready, deadline: PipeClosureFixture.now() + 3_000_000_000) == "ready")
        let deadline = try PipeClosureFixture.request(pid: child.processIdentifier, deadlineFile: deadlineFile)
        // The observer must actually see retained readers before this test releases
        // either lease. No delay or scheduling assumption substitutes for that handshake.
        try #require(PipeClosureFixture.waitForMarker(at: connected, deadline: deadline) == "connected")
        try #require(Darwin.close(leases[0]) == 0)
        leases[0] = -1
        if !persistentReader {
            try #require(Darwin.close(leases[1]) == 0)
            leases[1] = -1
            #expect(PipeClosureFixture.waitForMarker(at: marker, deadline: deadline) == "both-epipe")
        }
        // This extra second is only for reaping/reporting the negative control after
        // its original deadline expires. It cannot admit a late successful observation.
        while child.isRunning && PipeClosureFixture.now() < deadline + 1_000_000_000 {
            Thread.sleep(forTimeInterval: 0.01)
        }
        try #require(!child.isRunning)
        child.waitUntilExit()
        #expect(child.terminationStatus == 0)
        let observations = try String(contentsOf: details, encoding: .utf8)
        #expect(observations.contains("first_stdout=1,errno=0; first_stderr=1,errno=0"))
        if persistentReader {
            #expect(PipeClosureFixture.now() >= deadline)
            #expect(PipeClosureFixture.marker(at: marker) == "still-connected")
            #expect(observations.contains("stdout=-1,errno=\(EPIPE); stderr=1,errno=0"))
            try #require(Darwin.close(leases[1]) == 0)
            leases[1] = -1
            #expect(PipeClosureFixture.marker(at: marker) == "still-connected")
        } else {
            #expect(observations.contains("stdout=-1,errno=\(EPIPE); stderr=-1,errno=\(EPIPE)"))
        }
    }
}
