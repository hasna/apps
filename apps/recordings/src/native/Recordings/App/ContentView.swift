import SwiftUI
import RecordingsLib

/// The desktop reference is a single control. History lives in its own retained panel.
struct ContentView: View {
    @ObservedObject var store: RecordingsStore
    let openSettings: () -> Void
    let openHistory: () -> Void
    let windowAction: (NSWindow.ButtonType) -> Void

    var body: some View {
        ZStack {
            FrostedBackground(radius: 18)
            RecordWorkspaceView(store: store)
            VStack {
                HStack(spacing: 8) {
                    windowDot(.red, label: "Close", kind: .closeButton)
                    windowDot(.yellow, label: "Minimize", kind: .miniaturizeButton)
                    windowDot(.green, label: "Zoom", kind: .zoomButton)
                    Spacer()
                }.padding(.leading, 17).padding(.top, 16)
                Spacer()
                HStack {
                    Button(action: openHistory) { Image(systemName: "clock").font(.system(size: 20)) }
                        .help("Recordings").accessibilityLabel("Recordings")
                    Spacer()
                    Button(action: openSettings) { Image(systemName: "gearshape").font(.system(size: 20)) }
                        .help("Settings").accessibilityLabel("Settings")
                }
                .buttonStyle(.plain).foregroundStyle(Theme.accent)
                .padding(.horizontal, 34).padding(.bottom, 36)
            }
        }
        .frame(width: 304, height: 374)
        .ignoresSafeArea()
        .onAppear { store.loadLibrary() }
        .alert("Recordings Error", isPresented: Binding(get: { store.operationError != nil }, set: { if !$0 { store.operationError = nil } })) {
            Button("OK", role: .cancel) { store.operationError = nil }
        } message: { Text(store.operationError ?? "The operation failed.") }
    }

    private func windowDot(_ color: Color, label: String, kind: NSWindow.ButtonType) -> some View {
        Button { windowAction(kind) } label: {
            Circle().fill(color.gradient).frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(.white.opacity(0.8), lineWidth: 0.7))
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}
