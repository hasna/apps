import SwiftUI
import RecordingsLib

enum RecorderPage {
    case recorder, history, settings, advanced
    var size: NSSize {
        switch self {
        case .recorder: NSSize(width: 224, height: 244)
        case .history: NSSize(width: 500, height: 390)
        case .settings: NSSize(width: 420, height: 350)
        case .advanced: NSSize(width: 520, height: 540)
        }
    }
}

/// One retained app window and one shared glass/title bar across every destination.
struct ContentView: View {
    @ObservedObject var store: RecordingsStore
    @ObservedObject var state: RecordingsAppState
    let windowAction: (NSWindow.ButtonType) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 7) {
                windowDot(.red, label: "Close", kind: .closeButton)
                windowDot(.yellow, label: "Minimize", kind: .miniaturizeButton)
                windowDot(.green, label: "Zoom", kind: .zoomButton)
                Spacer(minLength: 6)
                Text("Hasna Recordings").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }.padding(.horizontal, 12).frame(height: 36)
            switch state.page {
            case .recorder:
                RecordWorkspaceView(store: store)
                HStack {
                    GlassIconButton(symbol: "clock", label: "Recordings", action: state.openHistory)
                    Spacer()
                    GlassIconButton(symbol: "gearshape", label: "Settings", action: state.openSettings)
                }.padding(.horizontal, 18).padding(.bottom, 14)
            case .history:
                RecordingsListView(store: store, close: state.openRecordings)
            case .settings:
                RecorderSettingsView(store: store, close: state.openRecordings, advanced: state.openAdvancedSettings)
            case .advanced:
                HStack {
                    Button(action: state.openSettings) { Label("Settings", systemImage: "chevron.left") }.buttonStyle(GlassButtonStyle())
                    Spacer()
                }.padding(.horizontal, 16)
                SettingsView(engine: store.engine, shortcuts: store.voiceShortcuts, preferences: store.preferences)
            }
        }
        .font(.system(size: 13))
        .frame(width: state.page.size.width, height: state.page.size.height)
        .background(FrostedBackground())
        .ignoresSafeArea()
        .onAppear { store.loadLibrary() }
        .alert("Recordings Error", isPresented: Binding(get: { store.operationError != nil }, set: { if !$0 { store.operationError = nil } })) {
            Button("OK", role: .cancel) { store.operationError = nil }
        } message: { Text(store.operationError ?? "The operation failed.") }
    }

    private func windowDot(_ color: Color, label: String, kind: NSWindow.ButtonType) -> some View {
        Button { windowAction(kind) } label: {
            Circle().fill(color.gradient).frame(width: 12, height: 12)
                .overlay(Circle().strokeBorder(.white.opacity(0.6), lineWidth: 0.5))
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}
