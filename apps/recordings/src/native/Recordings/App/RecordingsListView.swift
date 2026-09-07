import SwiftUI
import RecordingsLib

struct RecordingsListView: View {
    @ObservedObject var store: RecordingsStore
    var close: () -> Void = {}
    @State private var searching = false

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Button(action: close) { Image(systemName: "chevron.left") }.help("Back to recorder").accessibilityLabel("Back to recorder")
                Text("Recordings").font(.system(size: 13, weight: .semibold))
                Spacer()
                Button { searching.toggle() } label: { Image(systemName: "magnifyingglass") }
                    .help("Search transcripts").accessibilityLabel("Search transcripts")
                Button { store.loadLibrary() } label: { Image(systemName: "arrow.clockwise") }
                    .help("Refresh recordings").accessibilityLabel("Refresh recordings")
            }
            .buttonStyle(GlassButtonStyle()).foregroundStyle(Theme.accent)
            .padding(.horizontal, 2)
            if searching && store.selectedRecording == nil {
                TextField("Search transcripts", text: $store.searchText).textFieldStyle(.plain).padding(7).background(GlassInset()).padding(.horizontal, 12)
            }
            if store.selectedRecording != nil {
                HStack {
                    Button { store.selection = nil } label: { Label("All recordings", systemImage: "chevron.left") }.buttonStyle(GlassButtonStyle())
                    Spacer()
                }
                RecordingDetailView(store: store)
            } else if store.isLoadingLibrary && store.library.isEmpty {
                Spacer(); ProgressView(); Spacer()
            } else if let error = store.loadError, store.library.isEmpty {
                Spacer()
                Text(error.contains("HASNA_RECORDINGS") ? "Connect your Recordings API in Settings to see your history." : error)
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding()
                Button("Retry") { store.loadLibrary() }; Spacer()
            } else if store.visibleRecordings.isEmpty {
                Spacer(); Text(store.searchText.isEmpty ? "No recordings yet" : "No matching recordings").foregroundStyle(.secondary); Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(store.visibleRecordings) { rec in
                            HStack(spacing: 12) {
                                GlassIconButton(symbol: store.playbackRecordingID == rec.id && store.isPlaying ? "pause.fill" : "play.fill", label: "Play recording", size: 28) { store.play(rec) }
                                    .disabled(!store.canPlay(rec) || store.engine.captureIsActive)
                                    .help(store.canPlay(rec) ? "Play recording" : "Audio is not stored on this Mac")
                                Button { store.selection = rec.id } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(rec.snippet).font(.system(size: 13)).lineLimit(1)
                                        Text(rec.createdDate?.recordingDateLabel ?? "Recording").font(.system(size: 11)).foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                                Text(Theme.clock(rec.durationSeconds)).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
                                Menu {
                                    Button("Open transcript") { store.selection = rec.id }
                                    Button("Copy transcript") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(rec.displayText, forType: .string) }
                                    Button("Delete recording", role: .destructive) { store.delete(id: rec.id) }
                                } label: { Image(systemName: "ellipsis").font(.system(size: 13)) }
                                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 28)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .background(GlassInset(radius: 10))
                        }
                    }
                }
            }
        }
        .padding(12)

        .frame(minWidth: 500, minHeight: 354)
        .onAppear { store.loadLibrary() }
        .alert("Recordings Error", isPresented: Binding(get: { store.operationError != nil }, set: { if !$0 { store.operationError = nil } })) {
            Button("OK") { store.operationError = nil }
        } message: { Text(store.operationError ?? "The operation failed.") }
    }
}
