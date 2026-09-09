import Dispatch
import Foundation
import Testing
@testable import RecordingsLib

@Suite("Blocking operation scheduling")
struct BlockingOperationTests {
    private final class Observation: @unchecked Sendable {
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let peer = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var result = (entered: false, peerBeforeRelease: false)

        func record(entered: Bool, peerBeforeRelease: Bool) {
            lock.lock()
            result = (entered, peerBeforeRelease)
            lock.unlock()
        }

        func snapshot() -> (entered: Bool, peerBeforeRelease: Bool) {
            lock.lock()
            defer { lock.unlock() }
            return result
        }
    }

    @Test("blocking work leaves executor progress available and drains after cancellation", arguments: [false, true], [false, true])
    func peerProgressWhileBlocked(cancel: Bool, delayedSubmission: Bool) async {
        let observation = Observation()
        // A single buffered handoff gives the operation its already-created Task handle
        // without blocking a cooperative worker or capturing an uninitialized variable.
        let handoff = AsyncStream<Task<(Int, Bool), Never>>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let work = Task.detached {
            var handles = handoff.stream.makeAsyncIterator()
            guard let ownTask = await handles.next() else {
                preconditionFailure("Fixture task handle was not supplied")
            }
            // Admission is deliberately slower than the former two-second entry timer.
            // Only progress while the synchronous operation is held is under observation.
            if delayedSubmission { try? await Task.sleep(for: .seconds(3)) }
            let value = await BlockingOperation.run {
                observation.entered.signal()
                // Start the observation inside the operation, after entry. This independent
                // thread always releases the gate, even when the peer misses its deadline.
                Thread.detachNewThread {
                    defer { observation.release.signal() }
                    let entered = observation.entered.wait(timeout: .now()) == .success
                    if cancel { ownTask.cancel() }
                    if entered {
                        Task.detached { observation.peer.signal() }
                    }
                    let progressed = entered && observation.peer.wait(timeout: .now() + .seconds(1)) == .success
                    observation.record(entered: entered, peerBeforeRelease: progressed)
                }
                observation.release.wait()
                return 7
            }
            return (value, Task.isCancelled)
        }
        handoff.continuation.yield(work)
        handoff.continuation.finish()
        let (value, wasCancelled) = await work.value
        let observed = observation.snapshot()
        #expect(observed.entered)
        #expect(observed.peerBeforeRelease)
        #expect(value == 7)
        #expect(wasCancelled == cancel)
    }

    private enum FixtureFailure: Error { case expected }

    @Test("throwing blocking work preserves its exact error")
    func preservesError() async {
        do {
            let _: Int = try await BlockingOperation.runThrowing(qos: .utility) {
                throw FixtureFailure.expected
            }
            Issue.record("Blocking operation discarded its error")
        } catch FixtureFailure.expected {
        } catch {
            Issue.record("Blocking operation replaced its error: \(error)")
        }
    }
}
