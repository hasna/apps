import AVFoundation
import Foundation
import Testing
@testable import RecordingsLib

private final class StopTargetRecorder: PCMRecordingSource, @unchecked Sendable {
    private let lock = NSLock()
    private var callback: (@Sendable (Data) -> Void)?
    func attach(_ callback: @escaping @Sendable (Data) -> Void) { lock.withLock { self.callback = callback } }
    func emit() { lock.withLock { callback }?(Data(repeating: 0, count: 4_800)) }
    func start() throws {}
    func stop() {}
}

/// Hold completion after Stop so another foreground app and a duplicate Stop
/// can be observed before the real provider-to-delivery path resumes.
private final class StopTargetSession: RecordingTranscriptionSession, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<RecordingProviderResult, Error>?
    private var completion: Result<RecordingProviderResult, Error>?
    private var entered = false
    var finishEntered: Bool { lock.withLock { entered } }
    func appendPCM(_ data: Data) {}
    func finish(_ request: RecordingTranscriptionRequest) async throws -> RecordingProviderResult {
        try await withCheckedThrowingContinuation { pending in
            let result = lock.withLock { () -> Result<RecordingProviderResult, Error>? in
                entered = true
                if let completion { return completion }
                continuation = pending
                return nil
            }
            if let result { pending.resume(with: result) }
        }
    }
    func resolve() { complete(.success(RecordingProviderResult(rawText: "Fictional stop target fixture."))) }
    func cancel() { complete(.failure(CancellationError())) }
    private func complete(_ result: Result<RecordingProviderResult, Error>) {
        let pending = lock.withLock { () -> CheckedContinuation<RecordingProviderResult, Error>? in
            guard completion == nil else { return nil }
            completion = result
            defer { continuation = nil }
            return continuation
        }
        pending?.resume(with: result)
    }
}

private struct StopTargetProvider: RecordingTranscriptionProvider {
    let session: StopTargetSession
    func makeSession(configuration: RecordingProviderSessionConfiguration,
                     onPartialTranscript: @escaping @Sendable (String) -> Void) throws -> any RecordingTranscriptionSession { session }
}

@MainActor struct RecordingStopPasteTargetTests {
    private let nest = PasteApplicationObservation(pid: 91_001, bundleIdentifier: "example.nest", launchDate: Date(timeIntervalSince1970: 100))
    private let chrome = PasteApplicationObservation(pid: 91_002, bundleIdentifier: "example.chrome", launchDate: Date(timeIntervalSince1970: 200))
    private let other = PasteApplicationObservation(pid: 91_003, bundleIdentifier: "example.other", launchDate: Date(timeIntervalSince1970: 300))

    @MainActor private final class Fixture {
        let engine: RecordingEngine
        let recorder = StopTargetRecorder()
        let session = StopTargetSession()
        let home = makeIsolatedTestHome("stop-target")
        var live: [pid_t: PasteApplicationObservation]
        var frontmost: PasteApplicationObservation
        var deliveries = 0
        init(start: PasteApplicationObservation, others: [PasteApplicationObservation]) throws {
            live = Dictionary(uniqueKeysWithValues: ([start] + others).map { ($0.pid, $0) })
            frontmost = start
            let configuration = try RecordingEngineConfiguration(isolatedHomePath: home,
                preferencesSuiteName: "example.stop-target.\(UUID().uuidString)")
            engine = RecordingEngine(configuration: configuration, transcriptionProvider: StopTargetProvider(session: session))
            engine.autoPasteEnabled = true
            engine.microphoneAuthorization = { .authorized }
            engine.accessibilityTrustCheck = { false }
            engine.protectedOperationTrust = { Issue.record("Fixture reached real paste trust"); return .init(trusted: false, didPrompt: false) }
            engine.selectionCapture = { _ in Issue.record("Isolated provider queried Accessibility"); return nil }
            engine.focusedWindowTitleLookup = { _ in nil }
            engine.openAIAPIKeyProvider = { Issue.record("Fixture read legacy credentials"); return "" }
            engine.commandCLI = { _, _, _ in Issue.record("Fixture launched legacy CLI"); return "ERROR: forbidden" }
            engine.recorderFactory = { [recorder] callback in recorder.attach(callback); return recorder }
            engine.frontmostAppSnapshot = { [weak self] in self.map { .init(pid: $0.frontmost.pid, bundleIdentifier: $0.frontmost.bundleIdentifier, launchDate: $0.frontmost.launchDate) } }
            engine.pasteTargetApplicationLookup = { [weak self] pid in self?.live[pid] }
            engine.pasteInterceptorForTesting = { [weak self] _, _, _ in self?.deliveries += 1 }
        }
        func target(_ observation: PasteApplicationObservation) throws -> RecordingPasteTarget {
            try #require(RecordingPasteTarget(observation: observation, currentPID: ProcessInfo.processInfo.processIdentifier))
        }
        func start() async throws {
            engine.startRecording(pasteTarget: .frozen(try target(frontmost)))
            recorder.emit()
            try await wait { self.engine.isRecording }
        }
        func wait(_ condition: @MainActor () -> Bool) async throws {
            let deadline = ContinuousClock.now + .seconds(10)
            while !condition(), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(5)) }
            try #require(condition(), "Fixture state did not arrive before its safety deadline")
        }
        func selected(bundle: String?, pid: pid_t?) -> PasteTargetCandidate? {
            engine.resolvePasteTarget(candidates: live.values.map {
                .init(pid: $0.pid, bundleIdentifier: $0.bundleIdentifier, isRegularApp: $0.isRegular, launchDate: $0.launchDate)
            }, targetBundleIdentifier: bundle, targetPid: pid, frontmostPid: frontmost.pid,
            pipelineGeneration: engine.recordingGeneration)
        }
        func assertDelivered(to target: PasteApplicationObservation?) async throws {
            session.resolve()
            try await wait { self.deliveries == 1 }
            // The existing production log precedes the no-I/O paste interceptor;
            // this checks the actual provider completion's target arguments too.
            let log = try String(contentsOfFile: home + "/.hasna/recordings/Recordings.log", encoding: .utf8)
            let requests = log.split(separator: "\n").filter { $0.contains("paste requested") }
            #expect(requests.count == 1)
            #expect(requests.first?.contains("target=\(target?.bundleIdentifier ?? "nil") pid=\(target.map { String($0.pid) } ?? "nil") ") == true)
        }
        func cancel() { engine.cancelRecording(); session.cancel() }
    }

    @Test("Stop freezes the new target through provider completion and duplicate Stops")
    func stopReplacesStartTarget() async throws {
        let fixture = try Fixture(start: nest, others: [chrome, other]); defer { fixture.cancel() }
        try await fixture.start()
        fixture.frontmost = chrome
        fixture.engine.stopAndTranscribe(pasteTarget: .frozen(try fixture.target(chrome)))
        try await fixture.wait { fixture.session.finishEntered }
        fixture.frontmost = other
        fixture.engine.stopAndTranscribe(pasteTarget: .frozen(try fixture.target(other)))
        #expect(fixture.selected(bundle: chrome.bundleIdentifier, pid: chrome.pid)?.pid == chrome.pid)
        #expect(fixture.selected(bundle: nest.bundleIdentifier, pid: nest.pid) == nil)
        #expect(fixture.selected(bundle: other.bundleIdentifier, pid: other.pid) == nil)
        try await fixture.assertDelivered(to: chrome)
    }

    @Test("Omitting Stop's override preserves the Start target")
    func defaultRemainsStartFrozen() async throws {
        let fixture = try Fixture(start: nest, others: [chrome, other]); defer { fixture.cancel() }
        try await fixture.start()
        fixture.frontmost = chrome
        fixture.engine.stopAndTranscribe()
        #expect(fixture.selected(bundle: nest.bundleIdentifier, pid: nest.pid)?.pid == nest.pid)
        try await fixture.assertDelivered(to: nest)
    }

    @Test("An explicit frontmost Stop resolves once and never adopts finish-time focus")
    func explicitFrontmostIsFrozen() async throws {
        let fixture = try Fixture(start: nest, others: [chrome, other]); defer { fixture.cancel() }
        try await fixture.start()
        fixture.frontmost = chrome
        fixture.engine.stopAndTranscribe(pasteTarget: .frontmostApplication)
        fixture.frontmost = other
        #expect(fixture.selected(bundle: chrome.bundleIdentifier, pid: chrome.pid)?.pid == chrome.pid)
        try await fixture.assertDelivered(to: chrome)
    }

    @Test("Nil, terminated and replaced Stop targets never fall back", arguments: ["nil", "terminated", "reused", "nonregular"])
    func unavailableStopTarget(kind: String) async throws {
        let fixture = try Fixture(start: nest, others: [chrome, other]); defer { fixture.cancel() }
        try await fixture.start()
        let requested = kind == "nil" ? nil : try fixture.target(chrome)
        if kind == "terminated" { fixture.live.removeValue(forKey: chrome.pid) }
        if kind == "reused" { fixture.live[chrome.pid]?.launchDate = Date(timeIntervalSince1970: 201) }
        if kind == "nonregular" { fixture.live[chrome.pid]?.isRegular = false }
        fixture.engine.stopAndTranscribe(pasteTarget: .frozen(requested))
        fixture.frontmost = other
        #expect(fixture.selected(bundle: nil, pid: nil) == nil)
        #expect(fixture.selected(bundle: nest.bundleIdentifier, pid: nest.pid) == nil)
        #expect(fixture.selected(bundle: other.bundleIdentifier, pid: other.pid) == nil)
        try await fixture.assertDelivered(to: nil)
    }

    @Test("Idle, cancelled and warm-up Stops cannot retarget", arguments: ["idle", "cancelled", "warming"])
    func inactiveStopDoesNotRetarget(state: String) async throws {
        let fixture = try Fixture(start: nest, others: [chrome, other]); defer { fixture.cancel() }
        if state == "cancelled" { try await fixture.start(); fixture.engine.cancelRecording() }
        if state == "warming" { fixture.engine.startRecording(pasteTarget: .frozen(try fixture.target(nest))) }
        let generation = fixture.engine.recordingGeneration
        fixture.engine.stopAndTranscribe(pasteTarget: .frozen(try fixture.target(chrome)))
        #expect(fixture.deliveries == 0)
        #expect(!fixture.session.finishEntered)
        #expect(fixture.engine.resolvePasteTarget(candidates: [.init(pid: chrome.pid, bundleIdentifier: chrome.bundleIdentifier,
            isRegularApp: true, launchDate: chrome.launchDate)], targetBundleIdentifier: chrome.bundleIdentifier,
            targetPid: chrome.pid, frontmostPid: chrome.pid, pipelineGeneration: generation) == nil)
    }

    @Test("A new target discards only the previous application's AX selection context")
    func retargetedSelectionContext() async throws {
        let processing = RecordingProcessingConfiguration(transcriptionPrompt: "fixture", transcriberPrompt: "fixture",
            postProcessingMode: "none", transcriptionLanguage: "en", transcriptionModel: "fixture", transcriberModel: "fixture",
            enhancementModel: "fixture", intentModel: "fixture", intentDetectionEnabled: true, enhanceTriggersJSON: "[]", keywordTransformsJSON: "{}")
        let context = RecordingStartResolvedContext(selectionToken: .unsafeTestToken(selectedText: "Fictional old selection"),
            canonicalProjectId: "fixture-project", displayProjectId: "fixture-display", activeProjectName: "Fictional project", processing: processing)
        let capture = RecordingCaptureConfiguration(targetAppBundleIdentifier: nest.bundleIdentifier, targetAppPid: nest.pid,
            startContext: Task { context })
        let target = try #require(RecordingPasteTarget(observation: chrome, currentPID: ProcessInfo.processInfo.processIdentifier))
        let changed = await capture.retargeted(to: target, preservesSelection: false).resolvedStartContext()
        #expect(changed.selectionToken == nil)
        #expect(changed.processing == processing)
        #expect(changed.canonicalProjectId == context.canonicalProjectId)
        #expect(changed.displayProjectId == context.displayProjectId)
        let unchanged = await capture.resolvedStartContext()
        #expect(unchanged.selectionToken?.selectedText == "Fictional old selection")
    }
}
