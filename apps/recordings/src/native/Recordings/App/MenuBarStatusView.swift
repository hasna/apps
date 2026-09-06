@preconcurrency import Cocoa
import SwiftUI
import RecordingsLib

struct MenuBarStatusLabel: View {
    @ObservedObject var store: RecordingsStore

    var body: some View {
        Image(systemName: presentation.iconName)
            .accessibilityLabel(presentation.accessibilityLabel)
    }

    private var presentation: MenuBarPresentation {
        MenuBarPresentation(
            isRecording: store.engine.isRecording,
            isWarmingUpCapture: store.engine.isWarmingUpCapture,
            canStartRecording: store.engine.canStartRecording,
            statusMessage: store.engine.statusMessage,
            blockedReason: store.engine.blockedReason
        )
    }
}

struct MenuBarStatusView: View {
    @ObservedObject var store: RecordingsStore
    let openRecordings: () -> Void
    let openSettings: () -> Void
    /// Bar-only builds have no workspace window to open; the entry point is hidden so
    /// the affordance does not exist where the surface cannot exist.
    let barOnly: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: presentation.iconName)
                    .foregroundStyle(statusColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hasna Recordings")
                        .font(.headline)
                    Text(presentation.statusText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Button(action: toggleRecording) {
                Label(recordButtonTitle, systemImage: recordButtonIcon)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(store.engine.captureIsActive ? .red : .accentColor)
            .disabled(!presentation.primaryActionEnabled)

            Divider()

            if !barOnly {
                Button(action: openRecordings) {
                    Label("Open Hasna Recordings", systemImage: "macwindow")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }

            Button(action: openSettings) {
                Label("Settings", systemImage: "gearshape")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Label("Quit Hasna Recordings", systemImage: "power")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(width: 260)
    }

    private var statusColor: Color {
        if store.engine.captureIsActive { return .red }
        // The popover repeats the menu-bar signal rather than relying on the caption text, which
        // is rendered `.secondary` and reads as an aside.
        return presentation.isBlocked ? .orange : .accentColor
    }

    private var presentation: MenuBarPresentation {
        MenuBarPresentation(
            isRecording: store.engine.isRecording,
            isWarmingUpCapture: store.engine.isWarmingUpCapture,
            canStartRecording: store.engine.canStartRecording,
            statusMessage: store.engine.statusMessage,
            blockedReason: store.engine.blockedReason
        )
    }

    private var recordButtonTitle: String {
        store.engine.captureIsActive ? "Stop and Transcribe" : "Start Recording"
    }

    private var recordButtonIcon: String {
        store.engine.captureIsActive ? "stop.fill" : "mic.fill"
    }

    private func toggleRecording() {
        if store.engine.captureIsActive {
            store.engine.stopAndTranscribe()
        } else {
            store.engine.startRecording()
        }
    }
}
