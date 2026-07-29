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
            canStartRecording: store.engine.canStartRecording,
            statusMessage: store.engine.statusMessage
        )
    }
}

/// Glanceable menu-bar surface: one status line, one primary button, three plain rows.
/// The popover hangs off the app's own status item, so it carries no icon or app-name
/// header — the status text and the button are the whole story.
struct MenuBarStatusView: View {
    @ObservedObject var store: RecordingsStore
    let openRecordings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(presentation.statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel(presentation.accessibilityLabel)

            Button(action: toggleRecording) {
                Label(recordButtonTitle, systemImage: recordButtonIcon)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(store.engine.isRecording ? .red : .accentColor)
            .disabled(!presentation.primaryActionEnabled)

            Divider()

            Button(action: openRecordings) {
                rowLabel("Open Recordings")
            }
            .buttonStyle(.plain)

            SettingsLink {
                rowLabel("Settings…")
            }
            .buttonStyle(.plain)

            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                rowLabel("Quit")
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .frame(width: 240)
    }

    /// Full-width, comfortably tappable text row.
    private func rowLabel(_ title: String) -> some View {
        Text(title)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
            .contentShape(.rect)
    }

    private var presentation: MenuBarPresentation {
        MenuBarPresentation(
            isRecording: store.engine.isRecording,
            canStartRecording: store.engine.canStartRecording,
            statusMessage: store.engine.statusMessage
        )
    }

    private var recordButtonTitle: String {
        store.engine.isRecording ? "Stop & Transcribe" : "Record"
    }

    private var recordButtonIcon: String {
        store.engine.isRecording ? "stop.fill" : "mic.fill"
    }

    private func toggleRecording() {
        if store.engine.isRecording {
            store.engine.stopAndTranscribe()
        } else {
            store.engine.startRecording()
        }
    }
}
