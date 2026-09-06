import SwiftUI
import RecordingsLib

/// The recordings library list: a search field, then a flat list of transcripts on the white
/// canvas, separated by hairline dividers. Selecting a row shows it in the detail pane.
struct RecordingsListView: View {
    @ObservedObject var store: RecordingsStore

    var body: some View {
        VStack(spacing: 0) {
            searchRow
            Divider().opacity(0.5)
            list
        }
    }

    private var searchRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search transcripts", text: $store.searchText)
                .textFieldStyle(.plain)
                .font(.system(.body, design: .rounded))
            if !store.searchText.isEmpty {
                Button { store.searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    @ViewBuilder
    private var list: some View {
        if store.isLoadingLibrary && store.library.isEmpty {
            centered { ProgressView() }
        } else if let error = store.loadError, store.library.isEmpty {
            centered {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.orange)
                    Text(error.contains("HASNA_RECORDINGS") ? "Connect your Recordings API in Settings to see your history." : error).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Button("Retry") { store.loadLibrary() }
                }
                .padding(24)
            }
        } else if store.visibleRecordings.isEmpty {
            centered {
                VStack(spacing: 8) {
                    Image(systemName: "waveform").font(.largeTitle).foregroundStyle(.quaternary)
                    Text(emptyMessage).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Text("Your transcripts will appear here.").font(.caption).foregroundStyle(.tertiary)
                }
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(store.visibleRecordings) { rec in
                        Button { store.selection = rec.id } label: {
                            RecordingRow(rec: rec, selected: store.selection == rec.id)
                                .contentShape(Rectangle())
                        }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Copy") {
                                    let pb = NSPasteboard.general
                                    pb.clearContents(); pb.setString(rec.displayText, forType: .string)
                                }
                                Button("Paste into front app") { store.engine.pasteIntoFrontApp(rec.displayText) }
                                Divider()
                                Button("Delete", role: .destructive) { store.delete(id: rec.id) }
                            }
                        Divider().opacity(0.35).padding(.leading, 16)
                    }
                }
            }
        }
    }

    private var emptyMessage: String {
        if !store.searchText.isEmpty { return "No matches for “\(store.searchText)”" }
        return "No recordings yet"
    }

    @ViewBuilder
    private func centered<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack { Spacer(); content(); Spacer() }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct RecordingRow: View {
    let rec: Recording
    let selected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(rec.snippet)
                .font(.system(.headline, design: .rounded)).lineLimit(2)
            HStack(spacing: 6) {
                if let date = rec.createdDate {
                    Text(date.relativeDescription).font(.caption2).foregroundStyle(.secondary)
                }
                if rec.durationMs > 0 {
                    Text("·").font(.caption2).foregroundStyle(.secondary)
                    Text(rec.durationLabel).font(.caption2).foregroundStyle(.secondary)
                }
                if rec.isEnhanced {
                    Text("·").font(.caption2).foregroundStyle(.secondary)
                    Label("Enhanced", systemImage: "wand.and.stars")
                        .labelStyle(.titleAndIcon).font(.caption2).foregroundStyle(Theme.accent.opacity(0.9))
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { if selected { Theme.accent.opacity(0.12) } }
    }
}
