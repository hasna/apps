import SwiftUI
import RecordingsLib

struct RecordWorkspaceView: View {
    @ObservedObject var store: RecordingsStore
    private var engine: RecordingEngine { store.engine }
    private var busy: Bool { !engine.canStartRecording && !engine.captureIsActive }
    private var symbol: String {
        if engine.captureIsActive { return engine.isPaused ? "play.fill" : "stop.fill" }
        if busy { return "ellipsis" }
        return store.hasPlayback ? (store.isPlaying ? "pause.fill" : "play.fill") : "mic.fill"
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 104)
            Button {
                if engine.isPaused { engine.togglePause() }
                else if engine.captureIsActive { engine.stopAndTranscribe() }
                else if store.hasPlayback { store.toggleLatestPlayback() }
                else { store.beginRecording() }
            } label: {
                GlassCircle(symbol: symbol, size: 136,
                            red: engine.captureIsActive && !engine.isPaused,
                            progress: store.hasPlayback && !engine.captureIsActive ? store.playbackProgress : nil)
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityLabel(engine.captureIsActive ? (engine.isPaused ? "Resume recording" : "Stop and transcribe") : (store.hasPlayback ? "Play recording" : "Start recording"))
            .keyboardShortcut(.defaultAction)
            .contextMenu {
                if engine.captureIsActive {
                    Button(engine.isPaused ? "Resume recording" : "Pause recording") { engine.togglePause() }.disabled(!engine.isRecording)
                    Button("Discard recording") { engine.cancelRecording() }
                } else if store.hasPlayback {
                    Button("New recording") { store.clearPlayback(); store.beginRecording() }
                }
            }
            Text(Theme.clock(store.hasPlayback && !engine.captureIsActive ? store.playbackTime : engine.recordingDuration))
                .font(.system(size: 22, weight: .regular)).monospacedDigit()
                .foregroundStyle(.secondary).shadow(color: .white.opacity(0.85), radius: 0, y: 1)
                .padding(.top, 28)
            if busy {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text(engine.statusMessage).lineLimit(1)
                    if engine.canCancelIntentDelivery {
                        Button { engine.cancelIntentProcessing() } label: { Image(systemName: "xmark.circle") }
                            .buttonStyle(.plain).accessibilityLabel("Cancel processing")
                    }
                }
                    .font(.system(size: 11)).foregroundStyle(.secondary).padding(.top, 13)
            } else if let blocked = engine.blockedReason {
                Text(blocked).font(.system(size: 10)).foregroundStyle(.orange).lineLimit(2)
                    .multilineTextAlignment(.center).padding(.horizontal, 20).padding(.top, 8)
            } else if case .failed(let message) = engine.flowPhase {
                Text(message).font(.system(size: 10)).foregroundStyle(.orange).lineLimit(2)
                    .multilineTextAlignment(.center).padding(.horizontal, 20).padding(.top, 8)
            } else if engine.canCancelIntentDelivery {
                Button("Cancel") { engine.cancelIntentProcessing() }.font(.caption)
            }
            Spacer(minLength: 0)
        }
        .frame(width: 304, height: 374)
    }
}
