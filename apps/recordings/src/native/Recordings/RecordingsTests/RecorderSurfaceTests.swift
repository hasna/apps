import Foundation
import Testing
@testable import RecordingsLib

struct CaptureMonitorTests {
    @Test func pauseExcludesAudioAndDuration() {
        let monitor = CaptureMonitor()
        let chunk = Data(repeating: 64, count: 4_800)
        #expect(monitor.admit(chunk))
        monitor.setPaused(true)
        #expect(!monitor.admit(chunk))
        #expect(monitor.snapshot().duration == 0.1)
        monitor.setPaused(false)
        #expect(monitor.admit(chunk))
        #expect(monitor.snapshot().duration == 0.2)
    }

    @Test func meterReflectsActualPCM() {
        let monitor = CaptureMonitor()
        #expect(monitor.admit(Data(repeating: 0, count: 4_800)))
        #expect(monitor.snapshot().level == 0)
        #expect(monitor.admit(Data(repeating: 64, count: 4_800)))
        #expect(monitor.snapshot().level > 0.5)
    }
}

@MainActor
struct RecorderSurfaceDeliveryTests {
    @Test func discardingPausedCaptureRestoresIdleControls() {
        let engine = RecordingEngine(homePath: makeIsolatedTestHome("discard-paused"), installsGlobalHandlers: false)
        engine.configureVisualPreview()
        engine.togglePause()
        engine.cancelRecording()
        #expect(!engine.isPaused)
        #expect(engine.recordingDuration == 0)
        #expect(engine.audioLevel == 0)
    }

    @Test func disabledAutoPasteNeverReachesPasteBoundary() async {
        let engine = RecordingEngine(homePath: makeIsolatedTestHome("auto-paste-off"))
        engine.autoPasteEnabled = false
        defer { engine.autoPasteEnabled = true }
        var pasted = false
        engine.pasteInterceptorForTesting = { _, _, _ in pasted = true }
        let generation = engine.beginPipelineForTesting()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            engine.finishWithText("Blue sky", rawTranscript: "Blue sky", targetAppBundleIdentifier: nil,
                targetAppPid: nil, selectionToken: nil, canonicalProjectId: nil, activeProjectId: nil,
                activeProjectName: nil,
                processingConfiguration: RecordingProcessingConfiguration(transcriptionPrompt: "", transcriberPrompt: "",
                    postProcessingMode: "off", transcriptionLanguage: "en", transcriptionModel: "test", transcriberModel: "test",
                    enhancementModel: "test", intentModel: "test", intentDetectionEnabled: false,
                    enhanceTriggersJSON: "[]", keywordTransformsJSON: "{}"),
                pipelineTrace: nil, pipelineGeneration: generation, deliveryCompleted: { continuation.resume() })
        }
        #expect(!pasted)
        #expect(engine.recentTranscriptions.first?.displayText == "Blue sky")
        #expect(engine.statusMessage == "Transcript ready — auto-paste is off")
    }
}
