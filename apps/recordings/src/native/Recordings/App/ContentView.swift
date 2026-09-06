import SwiftUI
import RecordingsLib

/// One window for recording and history; a transcript opens only when selected.
struct ContentView: View {
    @ObservedObject var store: RecordingsStore
    let openSettings: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Hasna Recordings").font(.title2.weight(.semibold))
                    Text("Record, transcribe, and find your words.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: openSettings) {
                    Image(systemName: "gearshape").frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .help("Settings")
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 24).padding(.top, 24)

            RecordWorkspaceView(store: store)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Text("Recordings").font(.headline)
                Text("\(store.library.count)").foregroundStyle(.secondary)
                Spacer()
                Button { store.loadLibrary() } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain).help("Refresh recordings")
                .accessibilityLabel("Refresh recordings")
            }
            .padding(.horizontal, 24).padding(.vertical, 12)
            Divider().opacity(0.5)
            RecordingsListView(store: store)
        }
        .background(Theme.canvas(colorScheme))
        .frame(minWidth: 580, minHeight: 640)
        .onAppear { store.loadLibrary() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            store.loadLibrary()
        }
        .sheet(isPresented: Binding(
            get: { store.selectedRecording != nil },
            set: { if !$0 { store.selection = nil } }
        )) {
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Done") { store.selection = nil }
                        .keyboardShortcut(.cancelAction)
                }
                .padding(12)
                RecordingDetailView(store: store)
            }
            .frame(width: 620, height: 480)
        }
        .alert("Recordings Error", isPresented: Binding(
            get: { store.operationError != nil },
            set: { if !$0 { store.operationError = nil } }
        )) {
            Button("OK", role: .cancel) { store.operationError = nil }
        } message: {
            Text(store.operationError ?? "The operation failed.")
        }
    }
}
