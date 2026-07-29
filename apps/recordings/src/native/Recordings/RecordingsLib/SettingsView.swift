import SwiftUI
@preconcurrency import KeyboardShortcuts

/// App settings in the native macOS Settings idiom: a tabbed window of grouped
/// forms. This view is presentation only — every control reads and writes the
/// same stored values, under the same keys, as before.
///
/// `projectStore` survives here purely as the settings persistence layer
/// (`settings.postProcessingMode`, `settings.globalSystemPrompt`, `save()`);
/// the retired projects feature has no UI in Settings.
public struct SettingsView: View {
    @ObservedObject public var engine: RecordingEngine
    @ObservedObject public var shortcuts: VoiceShortcuts
    @ObservedObject public var projectStore: ProjectStore
    @AppStorage("openAIAPIKey") private var openAIAPIKey = ""

    @State private var newTrigger = ""
    @State private var newContent = ""

    public init(engine: RecordingEngine, shortcuts: VoiceShortcuts, projectStore: ProjectStore) {
        self.engine = engine
        self.shortcuts = shortcuts
        self.projectStore = projectStore
    }

    public var body: some View {
        TabView {
            generalTab.tabItem { Label("General", systemImage: "gear") }
            shortcutsTab.tabItem { Label("Voice Shortcuts", systemImage: "text.badge.star") }
        }
        .frame(width: 520, height: 500)
        .alert("Settings Error", isPresented: Binding(
            get: { projectStore.persistenceError != nil },
            set: { if !$0 { projectStore.clearPersistenceError() } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(projectStore.persistenceError ?? "The settings could not be saved.")
        }
    }

    // MARK: - General

    private var generalTab: some View {
        Form {
            // Transcription owns everything about turning speech into text.
            // Future realtime accuracy controls — context prompt, keywords,
            // expected languages, latency/accuracy — belong in this section.
            Section("Transcription") {
                SecureField("OpenAI API Key", text: $openAIAPIKey)
                    .onChange(of: openAIAPIKey) {
                        // Keep the CLI config in sync — final transcription shells out to it.
                        try? OpenAIAPIKeyStore.save(key: openAIAPIKey, homePath: engine.home)
                    }
                Picker("Language", selection: $engine.transcriptionLanguage) {
                    Text("English").tag("en")
                    Text("Auto Detect").tag("auto")
                }
                Toggle("Detect questions and edit commands", isOn: $engine.intentDetectionEnabled)
                footnote("When on, Recordings infers whether you dictated, asked a question, or asked for an edit; anything uncertain is typed out literally. Stored in ~/.hasna/recordings/config.json.")
            }

            Section("Cleanup") {
                Picker("Mode", selection: $projectStore.settings.postProcessingMode) {
                    ForEach(PostProcessingMode.allCases) { mode in
                        Text(mode.label).tag(mode.rawValue)
                    }
                }
                .pickerStyle(.segmented)
                .onChange(of: projectStore.settings.postProcessingMode) {
                    try? projectStore.save()
                }
                TextEditor(text: $projectStore.settings.globalSystemPrompt)
                    .frame(height: 72)
                    .accessibilityLabel("Cleanup instructions")
                    .onChange(of: projectStore.settings.globalSystemPrompt) {
                        try? projectStore.save()
                    }
                footnote("Instructions for post-transcription cleanup and formatting.")
            }

            Section("Recording") {
                LabeledContent("Shortcut") {
                    HStack(spacing: 8) {
                        KeyboardShortcuts.Recorder(for: .toggleRecording) { _ in
                            engine.updateStatus()
                        }
                        Button("Reset to F5") {
                            KeyboardShortcuts.setShortcut(.init(.f5), for: .toggleRecording)
                            engine.updateStatus()
                        }
                    }
                }
                Toggle("Use fn/Globe as recording key", isOn: $engine.useFnKey)
                footnote("Hold to record, release to transcribe and paste.")
            }

            Section("Permissions") {
                LabeledContent("Microphone") {
                    HStack(spacing: 8) {
                        Text(engine.microphonePermissionLabel).foregroundStyle(.secondary)
                        Button("Request…") { engine.requestMicrophonePermission() }
                            .accessibilityLabel("Request microphone access")
                    }
                }
                LabeledContent("Accessibility") {
                    HStack(spacing: 8) {
                        Text(engine.accessibilityPermissionLabel).foregroundStyle(.secondary)
                        Button("Request…") { engine.requestAccessibilityPermission() }
                            .accessibilityLabel("Request accessibility access")
                        Button("Open Settings…") { engine.openAccessibilitySettings() }
                            .accessibilityLabel("Open Accessibility settings")
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    // MARK: - Voice Shortcuts

    private var shortcutsTab: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                TextField("Trigger phrase", text: $newTrigger)
                    .textFieldStyle(.roundedBorder)
                TextField("Text to insert", text: $newContent)
                    .textFieldStyle(.roundedBorder)
                Button("Add") {
                    guard !newTrigger.isEmpty, !newContent.isEmpty else { return }
                    shortcuts.add(trigger: newTrigger, content: newContent)
                    newTrigger = ""; newContent = ""
                }
                .disabled(newTrigger.isEmpty || newContent.isEmpty)
            }
            .padding()

            Divider()

            if shortcuts.shortcuts.isEmpty {
                ContentUnavailableView(
                    "No Voice Shortcuts",
                    systemImage: "text.badge.star",
                    description: Text("Add a trigger phrase and the text it inserts when spoken.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(shortcuts.shortcuts) { s in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.trigger).bold()
                            Text(s.content).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    .onDelete(perform: shortcuts.remove)
                }
            }
        }
    }

    // MARK: - Furniture

    private func footnote(_ text: String) -> some View {
        Text(text).font(.callout).foregroundStyle(.secondary)
    }
}
