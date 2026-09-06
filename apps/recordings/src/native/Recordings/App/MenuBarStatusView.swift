@preconcurrency import Cocoa
import SwiftUI
import RecordingsLib

struct MenuBarStatusLabel: View {
    @ObservedObject var store: RecordingsStore
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: store.engine.captureIsActive ? (store.engine.isPaused ? "play.fill" : "record.circle.fill") : store.isPlaying ? "play.fill" : "mic.fill")
                .symbolRenderingMode(.palette)
                .foregroundStyle(store.engine.captureIsActive && !store.engine.isPaused ? .red : .primary)
            if store.engine.captureIsActive || store.isPlaying {
                Text(Theme.clock(store.isPlaying ? store.playbackTime : store.engine.recordingDuration))
                    .monospacedDigit()
            }
        }.accessibilityLabel(presentation.accessibilityLabel)
    }
    private var presentation: MenuBarPresentation {
        MenuBarPresentation(isRecording: store.engine.isRecording, isWarmingUpCapture: store.engine.isWarmingUpCapture,
            canStartRecording: store.engine.canStartRecording, statusMessage: store.engine.statusMessage, blockedReason: store.engine.blockedReason)
    }
}

struct MenuBarStatusView: View {
    @ObservedObject var store: RecordingsStore
    let openRecordings: () -> Void
    let openSettings: () -> Void
    let openHistory: () -> Void
    let openRecent: () -> Void
    var openBar: (() -> Void)? = nil
    var closeBar: (() -> Void)? = nil
    let barOnly: Bool
    @State private var showsActions = false
    private var width: CGFloat { min(1140, (NSScreen.main?.visibleFrame.width ?? 1200) - 48) }

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 20) {
                Button {
                    if store.engine.captureIsActive { store.engine.stopAndTranscribe() }
                    else { store.beginRecording() }
                } label: {
                    GlassCircle(symbol: store.engine.captureIsActive ? "stop.fill" : "mic.fill", size: 50, red: store.engine.captureIsActive)
                }
                .buttonStyle(.plain).disabled(!presentation.primaryActionEnabled)
                .accessibilityLabel(store.engine.captureIsActive ? "Stop and transcribe" : "Start recording")
                AudioWaveform(level: store.engine.audioLevel, recording: store.engine.captureIsActive && !store.engine.isPaused)
                    .frame(width: 155, height: 46).accessibilityLabel("Microphone level")
                Divider().frame(height: 46)
                VStack(alignment: .leading, spacing: 7) {
                    Text("Live Transcript").font(.system(size: 12)).foregroundStyle(.secondary)
                    Text(transcript).font(.system(size: 17)).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Divider().frame(height: 42)
                GlassIconButton(symbol: store.engine.isPaused ? "play.fill" : "pause.fill", label: store.engine.isPaused ? "Resume recording" : "Pause recording") { store.engine.togglePause() }
                    .disabled(!store.engine.isRecording)
                GlassIconButton(symbol: store.isPlaying ? "pause.fill" : "play.fill", label: "Playback and recent pastes") {
                    if store.hasPlayback && !store.engine.captureIsActive { store.toggleLatestPlayback() }
                    openRecent()
                }
                Divider().frame(height: 42)
                Toggle("Auto-paste", isOn: Binding(get: { store.engine.autoPasteEnabled }, set: { store.engine.autoPasteEnabled = $0 })).toggleStyle(.switch).fixedSize().font(.system(size: 14))
                GlassIconButton(symbol: "ellipsis", label: "More", size: 34) { showsActions.toggle() }
                    .popover(isPresented: $showsActions, arrowEdge: .bottom) {
                        VStack(alignment: .leading, spacing: 14) {
                            if let openBar { Button("Keep bar visible", action: openBar) }
                            if let closeBar { Button("Hide bar", action: closeBar) }
                            Button("Recent pastes", action: openRecent)
                            Button("Recordings", action: openHistory)
                            if !barOnly { Button(action: openRecordings) { Text("Open Hasna Recordings") } }
                            Button(action: openSettings) { Text("Settings") }
                            if store.engine.canCancelIntentDelivery { Button("Cancel processing") { store.engine.cancelIntentProcessing() } }
                            if store.engine.captureIsActive { Button("Discard recording") { store.engine.cancelRecording() } }
                            Divider()
                            Button("Quit Hasna Recordings") { NSApplication.shared.terminate(nil) }
                        }.buttonStyle(.plain).padding(18).frame(width: 210, alignment: .leading)
                    }
            }
            .padding(.horizontal, 20).padding(.vertical, 17)
            .frame(width: width, height: 84)
            .background(FrostedBackground(radius: 20, cool: true))
        }
        .padding(12)
    }

    private var transcript: String {
        if !store.engine.liveTranscriptionText.isEmpty { return store.engine.liveTranscriptionText }
        if store.engine.captureIsActive { return store.engine.isPaused ? "Paused" : "Listening…" }
        if let blocked = store.engine.blockedReason { return blocked }
        if store.engine.isTranscribing { return store.engine.statusMessage }
        return store.engine.recentTranscriptions.first?.displayText ?? "Your words appear here as you speak…"
    }
    private var presentation: MenuBarPresentation {
        MenuBarPresentation(isRecording: store.engine.isRecording, isWarmingUpCapture: store.engine.isWarmingUpCapture,
            canStartRecording: store.engine.canStartRecording, statusMessage: store.engine.statusMessage, blockedReason: store.engine.blockedReason)
    }
}

struct AudioWaveform: View {
    let level: Double
    let recording: Bool
    var body: some View {
        Canvas { context, size in
            let count = 29
            let step = size.width / CGFloat(count)
            for i in 0..<count {
                let envelope = 0.2 + 0.8 * abs(sin(Double(i) * 1.73))
                let height = recording ? max(4, CGFloat(level * envelope) * size.height) : 4
                let rect = CGRect(x: CGFloat(i) * step, y: (size.height - height) / 2, width: 2.5, height: height)
                context.fill(Path(roundedRect: rect, cornerRadius: 1.25), with: .color(recording && i < 10 ? Theme.recordRed : .gray.opacity(0.55)))
            }
        }
    }
}

struct RecentPastesView: View {
    @ObservedObject var store: RecordingsStore
    let close: () -> Void
    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Text("Recent pastes").font(.system(size: 21, weight: .medium))
                Spacer()
                Button("Clear all") { store.engine.clearRecentPastes() }
                    .buttonStyle(.plain).font(.system(size: 12)).padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(.white.opacity(0.9)))
                Button(action: close) { Image(systemName: "xmark").font(.system(size: 16)) }
                    .buttonStyle(.plain).padding(.leading, 10).accessibilityLabel("Close recent pastes")
            }.padding(.horizontal, 10)
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    Text("App").frame(width: 120, alignment: .leading)
                    Text("Location").frame(width: 140, alignment: .leading)
                    Text("Pasted content").frame(maxWidth: .infinity, alignment: .leading)
                    Text("Time").frame(width: 112, alignment: .leading)
                    Text("Status").frame(width: 100, alignment: .leading)
                    Spacer().frame(width: 24)
                }.font(.system(size: 13)).foregroundStyle(.secondary).padding(14)
                Divider().opacity(0.5)
                if store.engine.recentPastes.isEmpty {
                    Spacer(); Text("Your pastes from this session appear here.").foregroundStyle(.secondary); Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(store.engine.recentPastes) { paste in
                                HStack(spacing: 0) {
                                    HStack(spacing: 10) {
                                        Image(nsImage: appIcon(paste.bundleIdentifier)).resizable().frame(width: 28, height: 28)
                                        Text(paste.appName).lineLimit(1)
                                    }.frame(width: 120, alignment: .leading)
                                    Text(paste.location).foregroundStyle(.secondary).frame(width: 140, alignment: .leading)
                                    Text(paste.text).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                    Text(paste.timestamp.relativeDescription).foregroundStyle(.secondary).frame(width: 112, alignment: .leading)
                                    Label(paste.status, systemImage: paste.verified ? "checkmark.circle.fill" : "questionmark.circle")
                                        .labelStyle(PasteStatusStyle(verified: paste.verified)).frame(width: 100, alignment: .leading)
                                    Menu {
                                        Button("Copy pasted text") {
                                            NSPasteboard.general.clearContents()
                                            NSPasteboard.general.setString(paste.text, forType: .string)
                                        }
                                    } label: { Image(systemName: "ellipsis") }
                                    .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 24)
                                }.font(.system(size: 13)).padding(.horizontal, 14).padding(.vertical, 17)
                                Divider().opacity(0.35)
                            }
                        }
                    }
                }
            }.background(.white.opacity(0.28), in: RoundedRectangle(cornerRadius: 13))
        }.padding(22).background(FrostedBackground(radius: 17, cool: true))
    }
    private func appURL(_ id: String?) -> URL? { id.flatMap { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) } }
    private func appName(_ id: String?) -> String { appURL(id)?.deletingPathExtension().lastPathComponent ?? "Application" }
    private func appIcon(_ id: String?) -> NSImage {
        appURL(id).map { NSWorkspace.shared.icon(forFile: $0.path) } ?? NSImage(systemSymbolName: "app", accessibilityDescription: nil)!
    }
}

private struct PasteStatusStyle: LabelStyle {
    let verified: Bool
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon.foregroundStyle(verified ? .green : .orange).font(.system(size: 21))
            configuration.title.foregroundStyle(.secondary)
        }
    }
}

struct PanelPointer: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.midX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            path.closeSubpath()
        }
    }
}
