import AVFoundation
import Foundation
import Testing
@testable import RecordingsLib

private struct TargetNoopProvider: RecordingTranscriptionProvider {
    func makeSession(configuration: RecordingProviderSessionConfiguration, onPartialTranscript: @escaping @Sendable (String) -> Void) throws -> any RecordingTranscriptionSession {
        throw RecordingProviderError.noAudio
    }
}
@MainActor struct RecordingFrozenPasteTargetTests {
    private let a = PasteApplicationObservation(pid: 90101, bundleIdentifier: "example.editor", launchDate: Date(timeIntervalSince1970: 100), name: "Editor")
    private let b = PasteApplicationObservation(pid: 90102, bundleIdentifier: "example.notes", launchDate: Date(timeIntervalSince1970: 200), name: "Notes")
    private func engine() throws -> RecordingEngine {
        let configuration = try RecordingEngineConfiguration(isolatedHomePath: makeIsolatedTestHome("frozen-target"), preferencesSuiteName: "example.frozen-tests.\(UUID().uuidString)")
        let engine = RecordingEngine(configuration: configuration, transcriptionProvider: TargetNoopProvider())
        engine.microphoneAuthorization = { .denied }
        engine.accessibilityTrustCheck = { false }
        engine.protectedOperationTrust = { AccessibilityTrustResult(trusted: true, didPrompt: false) }
        engine.focusedWindowTitleLookup = { _ in nil }
        engine.selectionCapture = { _ in Issue.record("No Accessibility reads allowed"); return nil }
        engine.frontmostAppSnapshot = { FrontmostAppSnapshot(pid: ProcessInfo.processInfo.processIdentifier, bundleIdentifier: "example.recorder", launchDate: Date()) }
        engine.pasteTargetApplicationLookup = { pid in pid == a.pid ? a : b }
        return engine
    }
    private func candidates(_ apps: [PasteApplicationObservation]) -> [PasteTargetCandidate] {
        apps.map { PasteTargetCandidate(pid: $0.pid, bundleIdentifier: $0.bundleIdentifier, isRegularApp: $0.isRegular, launchDate: $0.launchDate) }
    }
    @Test func explicitObservedTargetSurvivesSelfFocusAndLaterAppFocus() throws {
        let engine = try engine()
        let target = try #require(RecordingPasteTarget(observation: a, currentPID: ProcessInfo.processInfo.processIdentifier))
        engine.startRecording(pasteTarget: .frozen(target))
        let generation = engine.recordingGeneration
        #expect(engine.resolvePasteTarget(candidates: candidates([a, b]), targetBundleIdentifier: a.bundleIdentifier, targetPid: a.pid, frontmostPid: b.pid, pipelineGeneration: generation)?.pid == a.pid)
        var reused = a; reused.launchDate = Date(timeIntervalSince1970: 101)
        #expect(engine.resolvePasteTarget(candidates: candidates([reused, b]), targetBundleIdentifier: a.bundleIdentifier, targetPid: a.pid, frontmostPid: b.pid, pipelineGeneration: generation) == nil)
        #expect(engine.resolvePasteTarget(candidates: candidates([b]), targetBundleIdentifier: a.bundleIdentifier, targetPid: a.pid, frontmostPid: b.pid, pipelineGeneration: generation) == nil)
        var helper = a; helper.isRegular = false
        #expect(engine.resolvePasteTarget(candidates: candidates([helper]), targetBundleIdentifier: a.bundleIdentifier, targetPid: a.pid, frontmostPid: a.pid, pipelineGeneration: generation) == nil)
    }
    @Test func explicitNilAndInvalidAtStartNeverAdoptTheFinishTimeApp() throws {
        for target in [nil, RecordingPasteTarget(observation: a, currentPID: ProcessInfo.processInfo.processIdentifier)] {
            let engine = try engine(); engine.pasteTargetApplicationLookup = { _ in nil }
            engine.startRecording(pasteTarget: .frozen(target))
            #expect(engine.resolvePasteTarget(candidates: candidates([b]), targetBundleIdentifier: nil, targetPid: nil, frontmostPid: b.pid, pipelineGeneration: engine.recordingGeneration) == nil)
        }
        let legacy = try engine(); legacy.startRecording()
        #expect(legacy.resolvePasteTarget(candidates: candidates([b]), targetBundleIdentifier: nil, targetPid: nil, frontmostPid: b.pid, pipelineGeneration: legacy.recordingGeneration)?.pid == b.pid, "Omitting explicit selection preserves the legacy default")
    }
}
