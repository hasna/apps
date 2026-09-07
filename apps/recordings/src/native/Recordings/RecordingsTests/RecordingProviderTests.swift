import AVFoundation
import Foundation
import Testing
@testable import RecordingsLib

private final class ProviderTestRecorder: PCMRecordingSource, @unchecked Sendable {
    private let lock = NSLock()
    private var callback: (@Sendable (Data) -> Void)?
    private(set) var stopped = false
    func attach(_ callback: @escaping @Sendable (Data) -> Void) { lock.withLock { self.callback = callback } }
    func emit(_ data: Data) { lock.withLock { callback }?(data) }
    func start() throws {}
    func stop() { lock.withLock { stopped = true } }
}

private final class ProviderTestSession: RecordingTranscriptionSession, @unchecked Sendable {
    private let lock = NSLock()
    private var audio = Data()
    private var request: RecordingTranscriptionRequest?
    private var partial: (@Sendable (String) -> Void)?
    private var cancelled = false
    private var gate: CheckedContinuation<RecordingProviderResult, Never>?
    let delayFinish: Bool

    init(delayFinish: Bool = false) { self.delayFinish = delayFinish }
    var snapshot: (Data, RecordingTranscriptionRequest?, Bool) { lock.withLock { (audio, request, cancelled) } }
    func configure(_ partial: @escaping @Sendable (String) -> Void) { lock.withLock { self.partial = partial } }
    func emitPartial(_ text: String) { lock.withLock { partial }?(text) }
    func appendPCM(_ data: Data) { lock.withLock { if !cancelled { audio.append(data) } } }
    func finish(_ request: RecordingTranscriptionRequest) async throws -> RecordingProviderResult {
        if delayFinish {
            return await withCheckedContinuation { continuation in
                lock.withLock { self.request = request; gate = continuation }
            }
        }
        lock.withLock { self.request = request }
        return RecordingProviderResult(rawText: "spoken words", processedText: "Spoken words.")
    }
    func cancel() { lock.withLock { cancelled = true } }
    func resolve() {
        let continuation = lock.withLock { let value = gate; gate = nil; return value }
        continuation?.resume(returning: RecordingProviderResult(rawText: "late result"))
    }
}

private struct ProviderTestAdapter: RecordingTranscriptionProvider {
    let session: ProviderTestSession
    func makeSession(configuration: RecordingProviderSessionConfiguration, onPartialTranscript: @escaping @Sendable (String) -> Void) throws -> any RecordingTranscriptionSession {
        #expect(configuration.sampleRate == 24_000)
        #expect(configuration.channels == 1)
        #expect(configuration.bitsPerSample == 16)
        session.configure(onPartialTranscript)
        return session
    }
}

@MainActor
struct RecordingProviderTests {
    private func engine(_ session: ProviderTestSession, recorder: ProviderTestRecorder, suite: String = "recordings-provider-tests-\(UUID().uuidString)") throws -> RecordingEngine {
        let configuration = try RecordingEngineConfiguration(isolatedHomePath: makeIsolatedTestHome("provider"), preferencesSuiteName: suite)
        let engine = RecordingEngine(configuration: configuration, transcriptionProvider: ProviderTestAdapter(session: session))
        engine.autoPasteEnabled = false
        engine.microphoneAuthorization = { .authorized }
        engine.accessibilityTrustCheck = { false }
        engine.frontmostAppSnapshot = { nil }
        engine.focusedWindowTitleLookup = { _ in nil }
        engine.openAIAPIKeyProvider = { Issue.record("Isolated provider consulted legacy credentials"); return "" }
        engine.commandCLI = { _, _, _ in Issue.record("Isolated provider launched legacy CLI"); return "ERROR: forbidden" }
        engine.recorderFactory = { callback in recorder.attach(callback); return recorder }
        return engine
    }

    private func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
        for _ in 0..<200 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }

    @Test("PCM streams before stop, pause excludes samples, and the final WAV matches the stream")
    func liveStreamingAndPause() async throws {
        let session = ProviderTestSession()
        let recorder = ProviderTestRecorder()
        let engine = try engine(session, recorder: recorder)
        engine.startRecording()
        let first = Data(repeating: 1, count: 4_800)
        recorder.emit(first)
        #expect(await eventually { engine.isRecording && session.snapshot.0 == first })
        #expect(session.snapshot.1 == nil, "Streaming must precede finish")
        session.emitPartial("spoken")
        #expect(await eventually { engine.liveTranscriptionText == "spoken" })
        engine.togglePause()
        recorder.emit(Data(repeating: 9, count: 4_800))
        engine.togglePause()
        let tail = Data(repeating: 2, count: 1_600)
        recorder.emit(tail)
        engine.stopAndTranscribe()
        #expect(await eventually { !engine.isTranscribing })
        let request = try #require(session.snapshot.1)
        #expect(session.snapshot.0 == first + tail)
        #expect(request.duration == Double(6_400) / 48_000)
        let wav = try Data(contentsOf: request.audioURL)
        #expect(String(data: wav.prefix(4), encoding: .utf8) == "RIFF")
        #expect(Data(wav.dropFirst(44)) == first + tail)
        let transcript = try #require(engine.recentTranscriptions.first)
        #expect(transcript.captureID == request.captureID)
        #expect(transcript.audioURL == request.audioURL)
        #expect(transcript.rawText == "spoken words")
        #expect(transcript.displayText == "Spoken words.")
        #expect(engine.flowPhase == .ready("Transcript ready — auto-paste is off"))
        #expect(engine.persistedRecordingRevision == 0, "An adapter result is not a persistence receipt")
        #expect(recorder.stopped)
    }

    @Test("explicit no-target capture saves transcript and records copy-only non-delivery without AX or a paste")
    func frozenNoTargetReceipt() async throws {
        for copied in [true, false] {
            let session = ProviderTestSession()
            let recorder = ProviderTestRecorder()
            let engine = try engine(session, recorder: recorder)
            engine.autoPasteEnabled = true
            engine.protectedOperationTrust = { Issue.record("No-target delivery must not request Accessibility"); return AccessibilityTrustResult(trusted: false, didPrompt: false) }
            var writes: [String] = []
            engine.pasteFallbackWriter = { text in writes.append(text); return copied }
            engine.startRecording(pasteTarget: .frozen(nil))
            recorder.emit(Data(repeating: 1, count: 4_800))
            #expect(await eventually { engine.isRecording })
            engine.stopAndTranscribe()
            #expect(await eventually { engine.recentPastes.count == 1 })
            let transcript = try #require(engine.recentTranscriptions.first)
            let receipt = try #require(engine.recentPastes.first)
            #expect(receipt.captureID == transcript.captureID)
            #expect(receipt.deliveryStatus == .notDelivered)
            #expect(!receipt.verified)
            #expect(receipt.bundleIdentifier == nil)
            #expect(receipt.appName == "No target app")
            #expect(receipt.location == (copied ? "Clipboard only" : ""))
            #expect(writes == ["Spoken words."])
            #expect(engine.canStartRecording)
        }
    }

    @Test("cancel during provider finalization drops late text and allows another capture")
    func cancellationDropsStaleCompletions() async throws {
        let session = ProviderTestSession(delayFinish: true)
        let recorder = ProviderTestRecorder()
        let engine = try engine(session, recorder: recorder)
        engine.startRecording()
        recorder.emit(Data(repeating: 1, count: 4_800))
        #expect(await eventually { engine.isRecording })
        engine.stopAndTranscribe()
        #expect(await eventually { session.snapshot.1 != nil })
        engine.cancelRecording()
        #expect(session.snapshot.2)
        #expect(engine.canStartRecording)
        session.emitPartial("late partial")
        session.resolve()
        try await Task.sleep(for: .milliseconds(50))
        #expect(engine.liveTranscriptionText.isEmpty)
        #expect(engine.recentTranscriptions.isEmpty)
        #expect(engine.flowPhase == .idle)
    }

    @Test("discard during warm-up cancels the provider without a final request")
    func warmupCancellation() throws {
        let session = ProviderTestSession()
        let recorder = ProviderTestRecorder()
        let engine = try engine(session, recorder: recorder)
        engine.startRecording()
        engine.cancelRecording()
        #expect(session.snapshot.2)
        #expect(session.snapshot.1 == nil)
        #expect(engine.canStartRecording)
        #expect(recorder.stopped)
    }

    @Test("preferences are persistent per candidate suite and never write the legacy defaults")
    func preferencesIsolation() throws {
        let keys = ["useFnKey", "intentDetectionEnabled", "recordingsAutoPaste", "recordingsLanguage"]
        let before = keys.map { UserDefaults.standard.object(forKey: $0) as? NSObject }
        let firstSuite = "recordings-provider-tests-\(UUID().uuidString)"
        let secondSuite = "recordings-provider-tests-\(UUID().uuidString)"
        defer {
            UserDefaults(suiteName: firstSuite)?.removePersistentDomain(forName: firstSuite)
            UserDefaults(suiteName: secondSuite)?.removePersistentDomain(forName: secondSuite)
        }
        let first = try engine(ProviderTestSession(), recorder: ProviderTestRecorder(), suite: firstSuite)
        first.useFnKey = true // Must not install any monitor even when the preference changes.
        first.intentDetectionEnabled = true
        first.transcriptionLanguage = "ro"
        first.autoPasteEnabled = true
        let second = try engine(ProviderTestSession(), recorder: ProviderTestRecorder(), suite: secondSuite)
        #expect(!second.useFnKey)
        #expect(!second.intentDetectionEnabled)
        #expect(second.transcriptionLanguage == "en")
        let reloaded = try engine(ProviderTestSession(), recorder: ProviderTestRecorder(), suite: firstSuite)
        #expect(reloaded.useFnKey)
        #expect(reloaded.intentDetectionEnabled)
        #expect(reloaded.transcriptionLanguage == "ro")
        #expect(keys.map { UserDefaults.standard.object(forKey: $0) as? NSObject } == before)
        #expect(!FileManager.default.fileExists(atPath: "\(first.home)/.hasna/recordings/config.json"))
    }

    @Test("the isolated initializer rejects the installed app's state and defaults")
    func rejectsLiveRoots() throws {
        #expect(throws: RecordingProviderError.self) {
            try RecordingEngineConfiguration(isolatedHomePath: FileManager.default.homeDirectoryForCurrentUser.path, preferencesSuiteName: "candidate")
        }
        #expect(throws: RecordingProviderError.self) {
            try RecordingEngineConfiguration(isolatedHomePath: makeIsolatedTestHome("provider"), preferencesSuiteName: "com.hasna.recordings")
        }
    }

    @Test("public paste receipts distinguish an unverified post from evidence of failure")
    func typedPasteOutcomes() {
        #expect(RecordingEngine.recentPasteDeliveryStatus(for: .pasted) == .confirmed)
        #expect(RecordingEngine.recentPasteDeliveryStatus(for: .deliveredUnverified(.readBackNotAttempted)) == .unconfirmed)
        #expect(RecordingEngine.recentPasteDeliveryStatus(for: .deliveryNotObserved) == .notDelivered)
        #expect(RecordingEngine.recentPasteDeliveryStatus(for: .clipboardWriteFailed) == .notDelivered)
        #expect(RecordingEngine.recentPasteDeliveryStatus(for: .targetUnavailable) == .notDelivered)
    }
}
