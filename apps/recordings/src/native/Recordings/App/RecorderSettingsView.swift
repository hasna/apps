import SwiftUI
import AVFoundation
import RecordingsLib

struct RecorderSettingsView: View {
    @ObservedObject var store: RecordingsStore
    let close: () -> Void
    let advanced: () -> Void
    @State private var showsAudioInput = false
    @AppStorage("recordingsNotificationSound") private var notificationSound = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: close) { Image(systemName: "chevron.left").font(.system(size: 12)) }
                    .buttonStyle(GlassButtonStyle()).accessibilityLabel("Back to recorder")
                Text("Settings").font(.system(size: 13, weight: .semibold))
                Spacer()
            }.frame(height: 18)
            Spacer().frame(height: 18)
            HStack {
                Text("Audio Input")
                Spacer()
                Button { showsAudioInput.toggle() } label: {
                    HStack {
                        Image(systemName: "mic").font(.system(size: 14))
                        Text(AVCaptureDevice.default(for: .audio)?.localizedName ?? "System microphone").lineLimit(1)
                        Spacer(); Image(systemName: "chevron.down").font(.system(size: 12))
                    }.padding(.horizontal, 10).frame(width: 230, height: 30).background(field)
                }.buttonStyle(.plain)
                .popover(isPresented: $showsAudioInput) {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("System default microphone", systemImage: "checkmark")
                        Button("Sound Settings…") {
                            if let url = URL(string: "x-apple.systempreferences:com.apple.Sound-Settings.extension") { NSWorkspace.shared.open(url) }
                        }
                    }.font(.system(size: 13)).padding(12).background(FrostedBackground())
                }

            }
            Spacer().frame(height: 16)
            HStack {
                Text("Audio Quality")
                Spacer()
                HStack { Text("High (24 kHz PCM)"); Spacer() }
                    .padding(.horizontal, 10).frame(width: 230, height: 30).background(field)
                    .help("Uncompressed audio at the native transcription sample rate.")
            }
            Spacer().frame(height: 20)
            settingToggle("Auto-paste transcriptions", isOn: Binding(get: { store.engine.autoPasteEnabled }, set: { store.engine.autoPasteEnabled = $0 }))
            Spacer().frame(height: 18)
            settingToggle("Play notification sound", isOn: $notificationSound)
            Spacer().frame(height: 18)
            settingToggle("Show in menu bar", isOn: $store.showMenuBar)
            Spacer().frame(height: 16)
            HStack {
                Text("Recordings save automatically.").foregroundStyle(.secondary)
                Spacer()
                Button("API & Advanced…", action: advanced).buttonStyle(.plain)
            }.font(.system(size: 11))
            Spacer(minLength: 0)
        }
        .font(.system(size: 13)).toggleStyle(.switch).controlSize(.small)
        .padding(.horizontal, 16).padding(.top, 8)
        .frame(width: 420, height: 314)

    }

    private var field: some View {
        GlassInset()
    }
    private func settingToggle(_ label: String, isOn: Binding<Bool>) -> some View {
        HStack { Text(label); Spacer(); Toggle(label, isOn: isOn).labelsHidden() }.frame(height: 26)
    }
}
