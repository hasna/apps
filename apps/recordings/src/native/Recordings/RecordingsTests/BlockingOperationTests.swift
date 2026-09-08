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

    @Test("blocking work leaves executor progress available and drains after cancellation", arguments: [false, true])
    func peerProgressWhileBlocked(cancel: Bool) async {
        let observation = Observation()
        let work = Task.detached {
            let value = await BlockingOperation.run {
                observation.entered.signal()
                observation.release.wait()
                return 7
            }
            return (value, Task.isCancelled)
        }
        // The rescue thread is independent of Swift's cooperative pool. A broken adapter
        // therefore fails an assertion instead of stranding the test awaiting its own gate.
        Thread.detachNewThread {
            let entered = observation.entered.wait(timeout: .now() + .seconds(2)) == .success
            if cancel { work.cancel() }
            if entered {
                Task.detached { observation.peer.signal() }
            }
            let progressed = entered && observation.peer.wait(timeout: .now() + .seconds(1)) == .success
            observation.record(entered: entered, peerBeforeRelease: progressed)
            observation.release.signal()
        }
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
