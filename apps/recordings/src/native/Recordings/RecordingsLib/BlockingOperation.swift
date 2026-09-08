import Dispatch

/// Bridge synchronous, potentially blocking APIs without occupying a cooperative worker.
/// The caller still owns cancellation and generation checks: submitted work drains to its
/// existing API deadline and returns its exact result even if its awaiting task is cancelled.
/// Operations must not depend on Swift task-local values or task cancellation state.
enum BlockingOperation {
    private static let queue = DispatchQueue(
        label: "md.recordings.blocking-operations",
        attributes: .concurrent
    )
    static func run<Value: Sendable>(
        qos: DispatchQoS.QoSClass = .userInitiated,
        _ operation: @escaping @Sendable () -> Value
    ) async -> Value {
        await withCheckedContinuation { continuation in
            queue.async(qos: DispatchQoS(qosClass: qos, relativePriority: 0)) {
                continuation.resume(returning: operation())
            }
        }
    }

    static func runThrowing<Value: Sendable>(
        qos: DispatchQoS.QoSClass = .userInitiated,
        _ operation: @escaping @Sendable () throws -> Value
    ) async throws -> Value {
        try await run(qos: qos) { Result(catching: operation) }.get()
    }
}
