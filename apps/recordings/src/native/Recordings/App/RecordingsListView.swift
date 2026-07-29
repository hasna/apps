import SwiftUI
import RecordingsLib

/// The recordings library list: a quiet search field, then a flat scannable column of
/// transcripts. The first words of each transcript are the primary line; date, duration
/// and mode sit beneath in one muted caption. Selection is a soft rounded highlight —
/// no row dividers, no badges, no icons.
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
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("Search", text: $store.searchText)
                .textFieldStyle(.plain)
                .font(.system(.body, design: .rounded))
                .accessibilityLabel("Search transcripts")
            if !store.searchText.isEmpty {
                Button { store.searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
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
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(error).font(.callout).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Retry") { store.loadLibrary() }
                }
                .padding(24)
            }
        } else if store.visibleRecordings.isEmpty {
            centered {
                VStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .font(.title2).foregroundStyle(.quaternary)
                        .accessibilityHidden(true)
                    Text(emptyMessage).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Record") { store.pane = .record }.buttonStyle(.borderless)
                }
                .padding(24)
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(store.visibleRecordings) { rec in
                        RecordingRow(rec: rec, selected: store.selection == rec.id)
                            .contentShape(Rectangle())
                            .onTapGesture { store.selection = rec.id }
                            .contextMenu {
                                Button("Copy") {
                                    let pb = NSPasteboard.general
                                    pb.clearContents(); pb.setString(rec.displayText, forType: .string)
                                }
                                Button("Paste into front app") { store.engine.pasteIntoFrontApp(rec.displayText) }
                                Divider()
                                Button("Delete", role: .destructive) { store.delete(id: rec.id) }
                            }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
        }
    }

    private var emptyMessage: String {
        if !store.searchText.isEmpty { return "No matches for “\(store.searchText)”" }
        switch store.filter {
        case .mode(let m): return "No \(m) recordings yet"
        case .thisMachine: return "No recordings on this Mac yet"
        case .machine(let m): return "No recordings from \(m) yet"
        case .all, .project, .noProject: return "No recordings yet"
        }
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
        VStack(alignment: .leading, spacing: 3) {
            Text(rec.snippet)
                .font(.system(.body, design: .rounded).weight(.medium))
                .lineLimit(2)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if selected {
                RoundedRectangle(cornerRadius: Theme.cornerSmall, style: .continuous)
                    .fill(Theme.accent.opacity(0.12))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var subtitle: String {
        var parts: [String] = []
        if let date = rec.createdDate { parts.append(date.relativeDescription) }
        if rec.durationMs > 0 { parts.append(rec.durationLabel) }
        if rec.isEnhanced { parts.append("Enhanced") }
        return parts.joined(separator: " · ")
    }
}
