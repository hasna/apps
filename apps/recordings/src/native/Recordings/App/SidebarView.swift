import SwiftUI
import RecordingsLib

/// Narrow violet sidebar, reduced to the essentials: Record, then the library filters
/// (all recordings, modes, machines). White text over the gradient; the selected row
/// gets a translucent white highlight (Liquid Glass refracts the violet beneath).
struct SidebarView: View {
    @ObservedObject var store: RecordingsStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                recordRow
                librarySection
                if !store.machines.isEmpty { machinesSection }
                Spacer(minLength: 8)
            }
            .padding(14)
            .padding(.top, 24)
        }
        .scrollContentBackground(.hidden)
        .foregroundStyle(.white)
        .tint(.white)
    }

    // MARK: - Record

    private var recordRow: some View {
        Button {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { store.pane = .record }
        } label: {
            rowLabel(icon: "mic.fill", label: "Record",
                     selected: store.pane == .record, accentDot: store.engine.isRecording)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(store.engine.isRecording ? "Record, recording in progress" : "Record")
    }

    // MARK: - Library

    private var librarySection: some View {
        section(title: "Library") {
            filterRow(.all, icon: "waveform", label: "All Recordings")
            if store.count(for: .mode("enhanced")) > 0 {
                filterRow(.mode("enhanced"), icon: "wand.and.stars", label: "Enhanced")
            }
            if store.count(for: .mode("raw")) > 0 {
                filterRow(.mode("raw"), icon: "text.quote", label: "Raw")
            }
        }
    }

    // MARK: - Machines

    private var machinesSection: some View {
        section(title: "Machines") {
            if store.count(for: .thisMachine) > 0 {
                filterRow(.thisMachine, icon: "desktopcomputer", label: "This Mac")
            }
            ForEach(otherMachines, id: \.self) { machine in
                filterRow(.machine(machine), icon: "desktopcomputer", label: machine)
            }
        }
    }

    private var otherMachines: [String] {
        store.machines.filter { $0 != store.localMachineID }
    }

    // MARK: - Building blocks

    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.55))
                .padding(.leading, 9)
            content()
        }
    }

    private func filterRow(_ target: LibraryFilter, icon: String, label: String) -> some View {
        let selected = store.pane == .library && store.filter == target
        return Button {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                store.filter = target
                store.pane = .library
                if !store.visibleRecordings.contains(where: { $0.id == store.selection }) {
                    store.selection = store.visibleRecordings.first?.id
                }
            }
        } label: {
            rowLabel(icon: icon, label: label, selected: selected, accentDot: false)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue("\(store.count(for: target)) recordings")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func rowLabel(icon: String, label: String, selected: Bool, accentDot: Bool) -> some View {
        HStack(spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 16)
                .accessibilityHidden(true)
            Text(label).font(.system(.subheadline, design: .rounded)).lineLimit(1)
            Spacer(minLength: 4)
            if accentDot {
                Circle().fill(Theme.recordRed).frame(width: 7, height: 7)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(.white.opacity(selected ? 1 : 0.82))
        .padding(.horizontal, 9).padding(.vertical, 7)
        .contentShape(Rectangle())
        .background {
            if selected {
                RoundedRectangle(cornerRadius: Theme.cornerSmall, style: .continuous)
                    .fill(.white.opacity(0.22))
            }
        }
    }
}
