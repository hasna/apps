import Foundation
import SwiftUI
import Combine
import RecordingsLib

/// Observable application state for the full macOS app. Bridges the live `RecordingEngine`,
/// global cleanup preferences, voice shortcuts, and the `recordings` CLI Store.
@MainActor
final class RecordingsStore: ObservableObject {
    let engine: RecordingEngine
    let preferences: ProjectStore
    let voiceShortcuts: VoiceShortcuts

    @Published var library: [Recording] = [] { didSet { updateVisibleRecordings() } }
    @Published var selection: String?
    @Published var searchText: String = "" { didSet { updateVisibleRecordings() } }
    @Published private(set) var visibleRecordings: [Recording] = []
    @Published var isLoadingLibrary = false
    @Published var loadError: String?
    @Published var operationError: String?

    private let home: String
    private var cancellables = Set<AnyCancellable>()
    private var connectionRevision = 0

    init(engine: RecordingEngine = RecordingEngine(),
         preferences: ProjectStore = ProjectStore(),
         voiceShortcuts: VoiceShortcuts = VoiceShortcuts()) {
        self.engine = engine
        self.preferences = preferences
        self.voiceShortcuts = voiceShortcuts
        self.home = FileManager.default.homeDirectoryForCurrentUser.path
        engine.projectStore = nil
        engine.globalRecordingPreferences = preferences
        engine.voiceShortcuts = voiceShortcuts

        // Re-publish the wrapped ObservableObjects so views that observe only this store
        // refresh on live recording changes (timer, live text) and preference edits.
        engine.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)
        engine.$persistedRecordingRevision
            .dropFirst()
            .sink { [weak self] _ in self?.loadLibrary() }
            .store(in: &cancellables)
        preferences.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)
        voiceShortcuts.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: ServiceAPIConfiguration.didChangeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.connectionRevision += 1
                self.library = []
                self.selection = nil
                self.loadError = nil
                self.loadLibrary()
            }
            .store(in: &cancellables)
    }

    // Recording ticks and transcript deltas must not rescan the entire history.
    private func updateVisibleRecordings() {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { visibleRecordings = library; return }
        visibleRecordings = library.filter { recording in
            recording.displayText.localizedCaseInsensitiveContains(q) ||
                recording.tags.contains { $0.localizedCaseInsensitiveContains(q) }
        }
    }

    var selectedRecording: Recording? {
        guard let id = selection else { return nil }
        return library.first { $0.id == id }
    }

    // MARK: - Library loading

    private var reloadRequestedDuringLoad = false

    func loadLibrary() {
        guard !isLoadingLibrary else { reloadRequestedDuringLoad = true; return }
        isLoadingLibrary = true
        let home = home
        let revision = connectionRevision
        Task.detached(priority: .userInitiated) {
            let result: Result<[Recording], Error>
            do {
                let recs = try RecordingsCLI.listAll(home: home)
                result = .success(recs)
            } catch {
                result = .failure(error)
            }
            await MainActor.run {
                self.isLoadingLibrary = false
                // A response from the previous endpoint must not repopulate this library.
                if revision == self.connectionRevision {
                    switch result {
                    case .success(let recs):
                        self.library = recs
                        self.loadError = nil
                        if let selection = self.selection, !recs.contains(where: { $0.id == selection }) {
                            self.selection = nil
                        }
                    case .failure(let error):
                        self.loadError = (error as? RecordingsCLI.Failure)?.message ?? error.localizedDescription
                    }
                }
                if self.reloadRequestedDuringLoad {
                    self.reloadRequestedDuringLoad = false
                    self.loadLibrary()
                }
            }
        }
    }

    func delete(id: String) {
        let home = home
        Task.detached(priority: .userInitiated) {
            let result: Result<Void, Error>
            do {
                try RecordingsCLI.delete(id: id, home: home)
                result = .success(())
            } catch {
                result = .failure(error)
            }
            await MainActor.run {
                switch result {
                case .success:
                    self.library.removeAll { $0.id == id }
                    if self.selection == id { self.selection = nil }
                case .failure(let error):
                    self.operationError = (error as? RecordingsCLI.Failure)?.message ?? error.localizedDescription
                }
            }
        }
    }

}
