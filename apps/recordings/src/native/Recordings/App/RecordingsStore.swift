import Foundation
import SwiftUI
import Combine
import AVFoundation
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
    @Published var showMenuBar = UserDefaults.standard.object(forKey: "recordingsShowMenuBar") as? Bool ?? true {
        didSet { UserDefaults.standard.set(showMenuBar, forKey: "recordingsShowMenuBar") }
    }
    @Published var isLoadingLibrary = false
    @Published var loadError: String?
    @Published var operationError: String?

    @Published private(set) var isPlaying = false
    @Published private(set) var playbackTime: Double = 0
    @Published private(set) var playbackProgress: Double = 0
    @Published private(set) var playbackRecordingID: String?
    @Published private(set) var hasPlayback = false
    private var player: AVAudioPlayer?
    private var playbackTimer: Timer?

    func beginRecording() {
        guard !isVisualPreview else { return }
        clearPlayback()
        engine.startRecording()
    }

    func prepareLatestPlayback() {
        guard !engine.captureIsActive, let path = engine.latestAudioPath,
              FileManager.default.fileExists(atPath: path) else { return }
        preparePlayback(path: path, id: nil, play: false)
    }

    func canPlay(_ recording: Recording) -> Bool {
        recording.audioPath.map { FileManager.default.fileExists(atPath: $0) } ?? false
    }

    func play(_ recording: Recording) {
        guard !engine.captureIsActive else { return }
        if playbackRecordingID == recording.id { toggleLatestPlayback(); return }
        guard let path = recording.audioPath else { return }
        preparePlayback(path: path, id: recording.id, play: true)
    }

    private func preparePlayback(path: String, id: String?, play: Bool) {
        clearPlayback()
        do {
            player = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
            player?.prepareToPlay()
            hasPlayback = true
            playbackRecordingID = id
            playbackTime = player?.duration ?? 0
            if play { toggleLatestPlayback() }
        } catch { operationError = "This recording’s audio could not be opened." }
    }

    func toggleLatestPlayback() {
        guard let player else { return }
        if isPlaying {
            player.pause(); isPlaying = false; playbackTimer?.invalidate(); return
        }
        guard player.play() else { operationError = "Audio playback could not start."; return }
        isPlaying = true
        playbackTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let player = self.player else { return }
                self.playbackTime = player.currentTime
                self.playbackProgress = player.duration > 0 ? player.currentTime / player.duration : 0
                if !player.isPlaying { self.clearPlayback() }
            }
        }
    }

    func clearPlayback() {
        playbackTimer?.invalidate(); playbackTimer = nil
        player?.stop(); player = nil
        isPlaying = false; hasPlayback = false
        playbackRecordingID = nil; playbackTime = 0; playbackProgress = 0
        if !engine.captureIsActive { engine.recordingDuration = 0 }
    }

    var isVisualPreview = false
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
            .sink { [weak self] _ in self?.loadLibrary(); self?.prepareLatestPlayback()
                if UserDefaults.standard.bool(forKey: "recordingsNotificationSound") { NSSound(named: "Pop")?.play() } }
            .store(in: &cancellables)
        engine.$isRecording.dropFirst().filter { $0 }
            .sink { [weak self] _ in self?.clearPlayback() }
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
        guard !isVisualPreview else { return }
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
        if isVisualPreview { library.removeAll { $0.id == id }; selection = nil; return }
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
