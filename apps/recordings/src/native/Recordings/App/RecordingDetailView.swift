import SwiftUI
import AVFoundation
import RecordingsLib

/// Detail pane for a selected recording. The transcript is the content and gets the room:
/// a quiet date header with a slim action row (play / copy / paste / delete), then the
/// transcript at a readable measure, and one muted metadata line at the foot. No boxes.
struct RecordingDetailView: View {
    @ObservedObject var store: RecordingsStore
    @State private var player: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var copied = false

    var body: some View {
        if let rec = store.selectedRecording {
            detail(rec)
        } else {
            VStack(spacing: 10) {
                Image(systemName: "waveform")
                    .font(.system(size: 32)).foregroundStyle(.quaternary)
                    .accessibilityHidden(true)
                Text("Select a recording").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func detail(_ rec: Recording) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Text(rec.createdDate.map { dateLabel($0) } ?? "Recording")
                    .font(.system(.title3, design: .rounded).weight(.semibold))
                Spacer()
                toolbar(rec)
            }
            .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 10)
            Divider().opacity(0.4)

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text(rec.displayText.isEmpty ? "No transcript" : rec.displayText)
                        .font(.system(.title3, design: .rounded))
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .foregroundStyle(rec.displayText.isEmpty ? .secondary : .primary)

                    if rec.isEnhanced, !rec.rawText.isEmpty, rec.rawText != rec.displayText {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Raw transcript")
                                .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                            Text(rec.rawText)
                                .font(.callout).foregroundStyle(.secondary)
                                .lineSpacing(3)
                                .textSelection(.enabled)
                        }
                    }
                }
                .frame(maxWidth: 680, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.vertical, 16)
            }

            metadata(rec)
                .padding(.horizontal, 20).padding(.vertical, 10)
        }
        .onChange(of: store.selection) { _, _ in stopPlayback() }
        .onDisappear { stopPlayback() }
    }

    private func toolbar(_ rec: Recording) -> some View {
        HStack(spacing: 4) {
            if hasAudio(rec) {
                iconButton(isPlaying ? "stop.circle" : "play.circle", help: isPlaying ? "Stop" : "Play audio") {
                    togglePlayback(rec)
                }
            }
            iconButton(copied ? "checkmark" : "doc.on.doc", help: "Copy transcript") {
                let pb = NSPasteboard.general
                pb.clearContents(); pb.setString(rec.displayText, forType: .string)
                withAnimation { copied = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { withAnimation { copied = false } }
            }
            iconButton("arrow.up.right.square", help: "Paste into front app") {
                store.engine.pasteIntoFrontApp(rec.displayText)
            }
            iconButton("trash", help: "Delete") { store.delete(id: rec.id) }
        }
        .foregroundStyle(.secondary)
    }

    private func iconButton(_ name: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: name).frame(width: 24, height: 24) }
            .buttonStyle(.plain)
            .help(help)
            .accessibilityLabel(help)
    }

    private func metadata(_ rec: Recording) -> some View {
        var parts: [String] = []
        if rec.durationMs > 0 { parts.append(rec.durationLabel) }
        if let model = rec.modelUsed { parts.append(model) }
        if let lang = rec.language, !lang.isEmpty { parts.append(lang) }
        if let machine = rec.machineId, !machine.isEmpty { parts.append(machine) }
        if !rec.tags.isEmpty { parts.append(rec.tags.joined(separator: ", ")) }
        return Text(parts.joined(separator: "  ·  "))
            .font(.caption).foregroundStyle(.tertiary).lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("Recording details: \(parts.joined(separator: ", "))")
    }

    private func dateLabel(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateStyle = .medium; f.timeStyle = .short
        return f.string(from: date)
    }

    // MARK: - Audio playback

    private func hasAudio(_ rec: Recording) -> Bool {
        guard let path = rec.audioPath, !path.isEmpty else { return false }
        return FileManager.default.fileExists(atPath: path)
    }

    private func togglePlayback(_ rec: Recording) {
        if isPlaying { stopPlayback(); return }
        guard let path = rec.audioPath else { return }
        do {
            let p = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
            p.play()
            player = p
            isPlaying = true
            // Reset the button when playback ends.
            DispatchQueue.main.asyncAfter(deadline: .now() + p.duration + 0.1) {
                if player === p { stopPlayback() }
            }
        } catch {
            isPlaying = false
        }
    }

    private func stopPlayback() {
        player?.stop()
        player = nil
        isPlaying = false
    }
}
