import SwiftUI
import RecordingsLib

struct RecordingsListView: View {
    @ObservedObject var store: RecordingsStore
    var close: () -> Void = {}
    @State private var searching = false

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Text("Recordings").font(.system(size: 20, weight: .medium))
                Spacer()
                Button { searching.toggle() } label: { Image(systemName: "magnifyingglass") }
                    .help("Search transcripts").accessibilityLabel("Search transcripts")
                Button { store.loadLibrary() } label: { Image(systemName: "arrow.clockwise") }
                    .help("Refresh recordings").accessibilityLabel("Refresh recordings")
                Button(action: close) { Image(systemName: "xmark") }.help("Close recordings").accessibilityLabel("Close recordings")
            }
            .buttonStyle(.plain).foregroundStyle(Theme.accent)
            .padding(.horizontal, 14).padding(.top, 10)
            if searching {
                TextField("Search transcripts", text: $store.searchText).textFieldStyle(.roundedBorder).padding(.horizontal, 12)
            }
            if store.isLoadingLibrary && store.library.isEmpty {
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
                            HStack(spacing: 20) {
                                GlassIconButton(symbol: store.playbackRecordingID == rec.id && store.isPlaying ? "pause.fill" : "play.fill", label: "Play recording", size: 44) { store.play(rec) }
                                    .disabled(!store.canPlay(rec) || store.engine.captureIsActive)
                                    .help(store.canPlay(rec) ? "Play recording" : "Audio is not stored on this Mac")
                                Button { store.selection = rec.id } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(rec.snippet).font(.system(size: 16)).lineLimit(1)
                                        Text(rec.createdDate?.recordingDateLabel ?? "Recording").font(.system(size: 13)).foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                                Text(Theme.clock(rec.durationSeconds)).font(.system(size: 14)).monospacedDigit().foregroundStyle(.secondary)
                                Menu {
                                    Button("Open transcript") { store.selection = rec.id }
                                    Button("Copy transcript") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(rec.displayText, forType: .string) }
                                    Button("Delete recording", role: .destructive) { store.delete(id: rec.id) }
                                } label: { Image(systemName: "ellipsis").font(.system(size: 18)) }
                                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 28)
                            }
                            .padding(.horizontal, 15).padding(.vertical, 11)
                            .background(.white.opacity(0.25), in: RoundedRectangle(cornerRadius: 18))
                        }
                    }
                }
            }
        }
        .padding(15)
        .background(FrostedBackground())
        .frame(minWidth: 610, minHeight: 430)
        .onAppear { store.loadLibrary() }
        .sheet(isPresented: Binding(get: { store.selectedRecording != nil }, set: { if !$0 { store.selection = nil } })) {
            VStack(spacing: 0) {
                HStack { Spacer(); Button("Done") { store.selection = nil }.keyboardShortcut(.cancelAction) }.padding(14)
                RecordingDetailView(store: store)
            }.frame(width: 610, height: 460).background(FrostedBackground())
        }
        .alert("Recordings Error", isPresented: Binding(get: { store.operationError != nil }, set: { if !$0 { store.operationError = nil } })) {
            Button("OK") { store.operationError = nil }
        } message: { Text(store.operationError ?? "The operation failed.") }
    }
}
