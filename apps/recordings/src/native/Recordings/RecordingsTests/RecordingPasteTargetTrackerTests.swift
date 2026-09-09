import Foundation
import Testing
@testable import RecordingsLib

@MainActor struct RecordingPasteTargetTrackerTests {
    private let a = PasteApplicationObservation(pid: 801, bundleIdentifier: "example.editor", launchDate: Date(timeIntervalSince1970: 100), name: "Editor")
    private let b = PasteApplicationObservation(pid: 802, bundleIdentifier: "example.notes", launchDate: Date(timeIntervalSince1970: 200), name: "Notes")
    private let own = PasteApplicationObservation(pid: 900, bundleIdentifier: "example.recorder", launchDate: Date(timeIntervalSince1970: 300))

    @Test func remembersObservedExternalAcrossRecorderActivationAndFreezesValue() throws {
        var frontmost = a
        let tracker = RecordingPasteTargetTracker(currentPID: own.pid, frontmost: { frontmost }, lookup: { pid in pid == a.pid ? a : b })
        frontmost = own; tracker.observe(own)
        let frozen = try #require(tracker.snapshot())
        #expect(frozen.processIdentifier == a.pid)
        #expect(frozen.bundleIdentifier == a.bundleIdentifier)
        #expect(frozen.launchDate == a.launchDate)
        frontmost = b; tracker.observe(b)
        #expect(tracker.snapshot()?.processIdentifier == b.pid)
        #expect(frozen.processIdentifier == a.pid, "Later focus cannot mutate a capture's value")
    }
    @Test func refusesUnobservedSelfNonregularIncompleteAndTerminatedApps() {
        let tracker = RecordingPasteTargetTracker(currentPID: own.pid, frontmost: { own }, lookup: { _ in a })
        #expect(tracker.snapshot() == nil)
        for invalid in [PasteApplicationObservation(pid: 803, bundleIdentifier: "example.helper", launchDate: Date(), isRegular: false),
                        PasteApplicationObservation(pid: 804, bundleIdentifier: nil, launchDate: Date()),
                        PasteApplicationObservation(pid: 805, bundleIdentifier: "example.unknown", launchDate: nil),
                        PasteApplicationObservation(pid: 806, bundleIdentifier: "example.dead", launchDate: Date(), isTerminated: true)] {
            tracker.observe(invalid); #expect(tracker.snapshot() == nil)
        }
    }
    @Test func refusesPIDReuseAndDoesNotRecoverAnOlderApp() throws {
        var live = b
        let tracker = RecordingPasteTargetTracker(currentPID: own.pid, frontmost: { own }, lookup: { _ in live })
        tracker.observe(a); tracker.observe(b)
        #expect(tracker.snapshot()?.processIdentifier == b.pid)
        live.launchDate = Date(timeIntervalSince1970: 201)
        #expect(tracker.snapshot() == nil)
        live = b
        #expect(tracker.snapshot() == nil, "Revalidation failure consumes the remembered destination")
        tracker.observe(b)
        var oldIncarnation = b; oldIncarnation.launchDate = Date(timeIntervalSince1970: 199)
        tracker.terminated(oldIncarnation)
        #expect(tracker.snapshot() != nil)
        tracker.terminated(b)
        #expect(tracker.snapshot() == nil)
    }
}
