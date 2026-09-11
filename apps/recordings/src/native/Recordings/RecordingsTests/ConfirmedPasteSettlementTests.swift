import Foundation
import Testing
@testable import RecordingsLib

/// Exercises only injected scheduling, payload writes and delivery evidence. No engine,
/// application, Accessibility API or system clipboard is created or accessed.
@MainActor
struct ConfirmedPasteSettlementTests {
    @Test("confirmed delivery becomes ready on the read-back turn without the clipboard grace period",
          arguments: [PasteDeliveryEvidence.confirmedByFocusedValue, .confirmedBySelectedText])
    func confirmedDeliverySettlesImmediately(evidence: PasteDeliveryEvidence) {
        var scheduled: [(TimeInterval, PasteTransactionCoordinator.ScheduledOperation)] = []
        var events: [String] = []
        var clipboard = "previous clipboard"
        let coordinator = PasteTransactionCoordinator(
            schedule: { scheduled.append(($0, $1)) },
            writeAndVerify: {
                clipboard = $0
                return PasteboardWriteResult(verified: true, ownershipChangeCount: 1)
            },
            postPaste: { .posted }
        )
        coordinator.pendingTransactionWillChange = { events.append("pending-change") }

        let accepted = coordinator.submit(
            text: "fixture", generation: 7, delay: 0.5, settlementDelay: 0.6,
            verify: { evidence }, verificationDelay: 0.15
        ) { _, outcome in
            #expect(outcome == .pasted)
            #expect(coordinator.hasPendingTransaction)
            #expect(clipboard == "fixture")
            events.append("confirmed")
        } settlement: { transaction, outcome in
            #expect(outcome == .pasted)
            #expect(coordinator.hasPendingTransaction)
            if RecordingEngine.shouldRestorePreviousClipboard(
                outcome: outcome, stillOwnsPayload: clipboard == transaction.text,
                stillOwnsChangeCount: true
            ) {
                clipboard = "previous clipboard"
            }
            events.append("settled")
        }
        #expect(accepted)
        #expect(scheduled.map(\.0) == [0.5])
        scheduled.removeFirst().1()
        #expect(scheduled.map(\.0) == [0.15], "the target must still get time to consume the keystroke")
        #expect(coordinator.hasPendingTransaction)
        scheduled.removeFirst().1()

        #expect(events == ["pending-change", "confirmed", "settled", "pending-change"])
        #expect(scheduled.isEmpty, "confirmed text must not incur another 600 ms timer")
        #expect(!coordinator.hasPendingTransaction)
        #expect(clipboard == "previous clipboard")
        #expect(RecordingEngine.canBeginRecording(
            isRecording: false, isTranscribing: false, isWarmingUpCapture: false,
            isDeliveryPending: coordinator.hasPendingTransaction
        ))
    }

    @Test("unverified and unobserved delivery retain the full clipboard grace period", arguments: [
        PasteDeliveryEvidence.notObservedFocusedValueUnchanged,
        .unverified(.readBackNotAttempted),
        .unverified(.emptyPayload),
        .unverified(.baselineUnreadable(.elementUnavailable)),
        .unverified(.baselineUnreadable(.valueUnreadable)),
        .unverified(.baselineUnreadable(.valueTooLarge)),
        .unverified(.readBackUnreadable(.elementChanged)),
        .unverified(.changedWithoutMatch),
    ])
    func uncertainDeliveryKeepsGrace(evidence: PasteDeliveryEvidence) {
        var scheduled: [(TimeInterval, PasteTransactionCoordinator.ScheduledOperation)] = []
        var completions: [PasteDeliveryOutcome] = []
        var settlements: [PasteDeliveryOutcome] = []
        let coordinator = PasteTransactionCoordinator(
            schedule: { scheduled.append(($0, $1)) },
            writeAndVerify: { _ in PasteboardWriteResult(verified: true, ownershipChangeCount: 1) },
            postPaste: { .posted }
        )
        #expect(coordinator.submit(
            text: "fixture", generation: 8, delay: 0.15, settlementDelay: 0.6,
            verify: { evidence }, verificationDelay: 0.15
        ) { _, outcome in
            completions.append(outcome)
        } settlement: { _, outcome in
            settlements.append(outcome)
        })
        scheduled.removeFirst().1()
        scheduled.removeFirst().1()
        #expect(completions == [.forDeliveryEvidence(evidence)])
        #expect(settlements.isEmpty)
        #expect(coordinator.hasPendingTransaction)
        #expect(scheduled.map(\.0) == [0.6])
        scheduled.removeFirst().1()
        #expect(settlements == completions)
        #expect(!coordinator.hasPendingTransaction)
    }

    @Test("ownership lost after confirmation never restores over another clipboard write",
          arguments: [ClipboardChange.sameTextNewOwner, .newTextSameCount, .newTextNewOwner])
    func lateClipboardChangesArePreserved(change: ClipboardChange) {
        var scheduled: [PasteTransactionCoordinator.ScheduledOperation] = []
        var clipboard = "previous clipboard"
        var changeCount = 0
        var restores = 0
        let coordinator = PasteTransactionCoordinator(
            schedule: { _, operation in scheduled.append(operation) },
            writeAndVerify: {
                clipboard = $0
                changeCount = 1
                return PasteboardWriteResult(verified: true, ownershipChangeCount: 1)
            },
            postPaste: { .posted }
        )
        #expect(coordinator.submit(
            text: "fixture", generation: 9, delay: 0.15, settlementDelay: 0.6,
            verify: { .confirmedByFocusedValue }, verificationDelay: 0.15
        ) { _, _ in
            // This happens after the confirming read and before settlement runs. A matching
            // string is not ownership when another writer has advanced the change count.
            clipboard = change == .sameTextNewOwner ? "fixture" : "someone else's clipboard"
            changeCount = change == .newTextSameCount ? 1 : 2
        } settlement: { transaction, outcome in
            if RecordingEngine.shouldRestorePreviousClipboard(
                outcome: outcome,
                stillOwnsPayload: changeCount == 1 && clipboard == transaction.text,
                stillOwnsChangeCount: changeCount == 1
            ) {
                restores += 1
                clipboard = "previous clipboard"
            }
        })
        scheduled.removeFirst()()
        scheduled.removeFirst()()
        #expect(restores == 0)
        #expect(clipboard == (change == .sameTextNewOwner ? "fixture" : "someone else's clipboard"))
        #expect(scheduled.isEmpty)
        #expect(!coordinator.hasPendingTransaction)
    }

    enum ClipboardChange: Sendable {
        case sameTextNewOwner, newTextSameCount, newTextNewOwner
    }

    @Test("reentrant submissions wait for restoration and stale callbacks cannot settle a new generation")
    func reentrantAndQueuedTransactionsRemainIsolated() {
        var scheduled: [PasteTransactionCoordinator.ScheduledOperation] = []
        var writes: [String] = []
        var completions: [UInt64] = []
        var settlements: [UInt64] = []
        var reentrantAccepted: [Bool] = []
        let coordinator = PasteTransactionCoordinator(
            schedule: { _, operation in scheduled.append(operation) },
            writeAndVerify: {
                writes.append($0)
                return PasteboardWriteResult(verified: true, ownershipChangeCount: writes.count)
            },
            postPaste: { .posted }
        )
        #expect(coordinator.submit(
            text: "first fixture", generation: 11, delay: 0.15, settlementDelay: 0.6,
            verify: { .confirmedByFocusedValue }, verificationDelay: 0.15
        ) { transaction, _ in
            completions.append(transaction.generation ?? 0)
            reentrantAccepted.append(coordinator.submit(
                text: "completion overlap", generation: 90, delay: 0
            ) { _, _ in })
        } settlement: { transaction, _ in
            settlements.append(transaction.generation ?? 0)
            reentrantAccepted.append(coordinator.submit(
                text: "restoration overlap", generation: 91, delay: 0
            ) { _, _ in })
        })
        let stalePostingHop = scheduled.removeFirst()
        stalePostingHop()
        let staleReadBack = scheduled.removeFirst()
        staleReadBack()
        #expect(reentrantAccepted == [false, false])
        #expect(settlements == [11])
        #expect(scheduled.isEmpty)

        // Model work queued for the next turn: it may proceed only after first restoration.
        #expect(coordinator.submit(
            text: "second fixture", generation: 12, delay: 0.15, settlementDelay: 0.6,
            verify: { .confirmedBySelectedText }, verificationDelay: 0.15
        ) { transaction, _ in
            completions.append(transaction.generation ?? 0)
        } settlement: { transaction, _ in
            settlements.append(transaction.generation ?? 0)
        })
        stalePostingHop()
        staleReadBack()
        #expect(writes == ["first fixture"])
        #expect(coordinator.hasPendingTransaction)
        scheduled.removeFirst()()
        stalePostingHop()
        staleReadBack()
        #expect(writes == ["first fixture", "second fixture"])
        #expect(completions == [11])
        #expect(settlements == [11])
        #expect(coordinator.hasPendingTransaction)
        scheduled.removeFirst()()
        #expect(completions == [11, 12])
        #expect(settlements == [11, 12])
        #expect(scheduled.isEmpty)
        #expect(!coordinator.hasPendingTransaction)
    }
}
