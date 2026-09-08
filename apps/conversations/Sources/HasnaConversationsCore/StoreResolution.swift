// The native shell uses the bundled TypeScript client's shared credential chain.
// It never parses credential files, copies keys, or chooses a local database.
import Foundation
import Darwin

public enum StoreResolution: Equatable, CustomDebugStringConvertible {
    /// Configuration resolved through the shared API client. This is not a live
    /// authentication or readiness claim; backend health is checked separately.
    case cloud(env: [String: String])
    case unresolved(reason: String)

    public var debugDescription: String {
        switch self {
        case .cloud: return "cloud(shared account configuration)"
        case .unresolved(let reason): return "unresolved(\(reason))"
        }
    }
}

private let configurationFailure = "Shared account configuration could not be resolved. Configure Conversations through the CLI using saved account credentials, then reopen the app. No local database was opened."
private let preflightReceipt = Data("{\"version\":1,\"transport\":\"cloud-http\"}\n".utf8)

/// Fixed code, evaluated by the same Bun executable in the same bundled payload
/// directory as the backend. No caller paths or credential values become code.
private let preflightSource = #"""
try {
  const { getStore } = await import("./src/lib/store/index.ts");
  if (getStore().transport !== "cloud-http") process.exit(1);
  process.stdout.write('{"version":1,"transport":"cloud-http"}\n');
} catch { process.exit(1); }
"""#

/// Read a tiny, exact receipt while draining output without unbounded allocation.
/// Raw subprocess output is never returned, logged, or written to disk. A failed,
/// hung, malformed, or noisy preflight cannot authorize backend startup.
private func preflight(bunPath: String, appDirectory: URL, environment: [String: String], timeout: TimeInterval) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: bunPath)
    process.currentDirectoryURL = appDirectory
    process.arguments = ["--no-env-file", "--eval", preflightSource]
    process.environment = environment
    process.standardInput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    let output = Pipe()
    process.standardOutput = output
    let fd = output.fileHandleForReading.fileDescriptor
    guard fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK) != -1 else { return false }
    do { try process.run() } catch { return false }
    try? output.fileHandleForWriting.close()
    defer { try? output.fileHandleForReading.close() }

    let deadline = ProcessInfo.processInfo.systemUptime + max(0.01, min(timeout, 30))
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 512)
    var failed = false
    while true {
        let count = Darwin.read(fd, &buffer, buffer.count)
        if count > 0 {
            // A receipt is fixed and tiny: reject extra output immediately.
            if data.count + count > preflightReceipt.count { failed = true; break }
            data.append(contentsOf: buffer.prefix(count))
            continue
        }
        if count == 0 { break }
        if errno != EAGAIN && errno != EINTR { failed = true; break }
        if !process.isRunning { break }
        if ProcessInfo.processInfo.systemUptime >= deadline { failed = true; break }
        var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        _ = poll(&descriptor, 1, 10)
    }
    if process.isRunning {
        // EOF while still running also cannot prove successful completion.
        if ProcessInfo.processInfo.systemUptime < deadline && !failed {
            while process.isRunning && ProcessInfo.processInfo.systemUptime < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
        }
        if process.isRunning { failed = true; kill(process.processIdentifier, SIGKILL) }
    }
    process.waitUntilExit()
    return !failed && process.terminationReason == .exit && process.terminationStatus == 0 && data == preflightReceipt
}

/// Resolve configuration through the bundled client's ordinary getStore() path.
/// Preserve the environment exactly: changing it would change credential tier
/// selection, including saved file and Keychain pointer completion. Both child
/// processes disable Bun's implicit dotenv loading.
public func resolveStore(
    bunPath: String,
    appDirectory: URL,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    timeout: TimeInterval = 15
) -> StoreResolution {
    let retired = StoreEnvContract.dbPathKeys.filter {
        !(environment[$0] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    if !retired.isEmpty {
        return .unresolved(reason: "Remove retired database selectors: \(retired.joined(separator: ", ")). Conversations uses shared account credentials. Preserve existing databases for explicit migration.")
    }
    guard FileManager.default.fileExists(atPath: appDirectory.appendingPathComponent("src/lib/store/index.ts").path),
          preflight(bunPath: bunPath, appDirectory: appDirectory, environment: environment, timeout: timeout)
    else { return .unresolved(reason: configurationFailure) }
    return .cloud(env: environment)
}
