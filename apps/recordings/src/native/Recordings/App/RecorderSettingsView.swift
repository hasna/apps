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
                Text("Settings").font(.system(size: 20, weight: .regular))
                Spacer()
                Button(action: close) { Image(systemName: "xmark").font(.system(size: 16)) }
                    .buttonStyle(.plain).accessibilityLabel("Close settings")
            }.frame(height: 24)
            Spacer().frame(height: 41)
            HStack {
                Text("Audio Input")
                Spacer()
                Button { showsAudioInput.toggle() } label: {
                    HStack {
                        Image(systemName: "mic").font(.system(size: 21))
                        Text(AVCaptureDevice.default(for: .audio)?.localizedName ?? "System microphone").lineLimit(1)
                        Spacer(); Image(systemName: "chevron.down").font(.system(size: 12))
                    }.padding(.horizontal, 15).frame(width: 324, height: 44).background(field)
                }.buttonStyle(.plain)
                .popover(isPresented: $showsAudioInput) {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("System default microphone", systemImage: "checkmark")
                        Button("Sound Settings…") {
                            if let url = URL(string: "x-apple.systempreferences:com.apple.Sound-Settings.extension") { NSWorkspace.shared.open(url) }
                        }
                    }.padding(18)
                }

            }
            Spacer().frame(height: 26)
            HStack {
                Text("Audio Quality")
                Spacer()
                HStack { Text("High (24 kHz PCM)"); Spacer() }
                    .padding(.horizontal, 15).frame(width: 324, height: 44).background(field)
                    .help("Uncompressed audio at the native transcription sample rate.")
            }
            Spacer().frame(height: 34)
            settingToggle("Auto-paste transcriptions", isOn: Binding(get: { store.engine.autoPasteEnabled }, set: { store.engine.autoPasteEnabled = $0 }))
            Spacer().frame(height: 24)
            settingToggle("Play notification sound", isOn: $notificationSound)
            Spacer().frame(height: 24)
            settingToggle("Show in menu bar", isOn: $store.showMenuBar)
            Spacer().frame(height: 17)
            HStack {
                Text("Recordings save automatically.").foregroundStyle(.secondary)
                Spacer()
                Button("API & Advanced…", action: advanced).buttonStyle(.plain)
            }.font(.system(size: 11))
            Spacer(minLength: 0)
        }
        .font(.system(size: 15)).toggleStyle(.switch)
        .padding(.horizontal, 28).padding(.top, 25)
        .frame(width: 534, height: 434)
        .background(FrostedBackground(radius: 19))
    }

    private var field: some View {
        RoundedRectangle(cornerRadius: 10).fill(.white.opacity(0.45))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(.gray.opacity(0.22), lineWidth: 1))
    }
    private func settingToggle(_ label: String, isOn: Binding<Bool>) -> some View {
        HStack { Text(label); Spacer(); Toggle(label, isOn: isOn).labelsHidden() }.frame(height: 30)
    }
}
