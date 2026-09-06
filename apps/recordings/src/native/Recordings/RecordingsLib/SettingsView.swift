import SwiftUI
@preconcurrency import KeyboardShortcuts

public struct SettingsView: View {
    @ObservedObject public var engine: RecordingEngine
    @ObservedObject public var shortcuts: VoiceShortcuts
    @ObservedObject public var preferences: ProjectStore
    @State private var openAIAPIKey = ""
    @State private var providerStatus = ""

    public init(engine: RecordingEngine, shortcuts: VoiceShortcuts, preferences: ProjectStore) {
        self.engine = engine
        self.shortcuts = shortcuts
        self.preferences = preferences
    }

    public var body: some View {
        TabView {
            generalTab.tabItem { Label("General", systemImage: "gear") }
            shortcutsTab.tabItem { Label("Voice Shortcuts", systemImage: "text.badge.star") }
        }
        .frame(width: 520, height: 500)
        .alert("Settings Error", isPresented: Binding(
            get: { preferences.persistenceError != nil },
            set: { if !$0 { preferences.clearPersistenceError() } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(preferences.persistenceError ?? "The settings could not be saved.")
        }
    }

    // MARK: - General

    private var generalTab: some View {
        Form {
            ServiceConnectionView(home: engine.home)
            Section("OpenAI") {
                SecureField("API key", text: $openAIAPIKey)
                    .textFieldStyle(.roundedBorder)
                Button("Save OpenAI Key") {
                    do {
                        try OpenAIAPIKeyStore.save(key: openAIAPIKey, homePath: engine.home)
                        openAIAPIKey = ""
                        providerStatus = "OpenAI key saved in Keychain."
                    } catch {
                        providerStatus = error.localizedDescription
                    }
                }
                .disabled(openAIAPIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Connect Saved Key") {
                    do {
                        providerStatus = (try OpenAIAPIKeyStore.loadKeychain(allowInteraction: true))?.isEmpty == false
                            ? "OpenAI key available from Keychain."
                            : "No saved OpenAI key found in Keychain."
                    } catch { providerStatus = error.localizedDescription }
                }
                Text(providerStatus).foregroundStyle(.secondary)
                    .onAppear {
                        providerStatus = OpenAIAPIKeyStore.load(homePath: engine.home).isEmpty
                            ? "Add an OpenAI key for transcription."
                            : "OpenAI key available for transcription."
                    }
                Picker("Language", selection: $engine.transcriptionLanguage) {
                    Text("English").tag("en")
                    Text("Auto Detect").tag("auto")
                }
                Text("Used for live transcription and the final paste. New keys are stored in macOS Keychain.")
                    .foregroundStyle(.secondary)
            }

            Section("Intent") {
                Toggle("Detect questions and edit commands", isOn: $engine.intentDetectionEnabled)
                Text("When on, Recordings infers whether you dictated, asked a question, or asked it to edit the selected text. Anything uncertain is typed out literally. When off, every recording is typed out.")
                    .foregroundStyle(.secondary)
            }

            Section("Recording Shortcut") {
                HStack {
                    Text("Shortcut")
                    Spacer()
                    // Re-evaluate on change, not just log: a chord the system already
                    // reserves has to be reported the moment it is picked, not at next launch.
                    KeyboardShortcuts.Recorder(for: .toggleRecording) { _ in
                        engine.refreshTriggerDiagnostics()
                    }
                    Button("Reset to F5") {
                        KeyboardShortcuts.setShortcut(.init(.f5), for: .toggleRecording)
                        engine.refreshTriggerDiagnostics()
                    }
                }
                // No .onChange here: `RecordingEngine.useFnKey`'s own didSet re-arms the
                // monitor and logs the resolved trigger, so it also covers a change made
                // from the CLI or anywhere else — a view-local hook would not.
                Toggle("Use fn/Globe as recording key", isOn: $engine.useFnKey)
                Text("Hold to record, release to transcribe and paste. fn needs Accessibility; the hotkey above needs no permission.")
                    .foregroundStyle(.secondary)
                // A trigger that is switched on but cannot arm must say so next to its own
                // switch. Silence here is what made 51 recorded hotkey presses look like a
                // working trigger while nothing was delivered.
                //
                // Scoped to the trigger sources, and the button keyed to each reason's own
                // remedy. Rendering the composed `engine.blockedReason` here instead meant a
                // secure-input paste failure showed "transcript copied, press Cmd-V" under
                // Recording Shortcut beside an "Open Accessibility Settings" button — wrong
                // remedy, wrong section, wrong cause. A hotkey collision took that button too,
                // and the Accessibility pane does nothing for a chord clash either.
                ForEach(engine.blockedReasonEntries.filter(\.isTriggerHealth)) { entry in
                    Label(entry.message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    // `switch`, not `==`. This file's engine forbids `==` against an enum case in
                    // three separate comments for the same reason: it answers `false` for every
                    // case added later, so a fourth remedy carrying a button would silently render
                    // none. Exhaustive here means adding one forces the decision.
                    switch entry.remedy {
                    case .openAccessibilitySettings:
                        Button("Open Accessibility Settings") {
                            engine.openAccessibilitySettings()
                        }
                    case .chooseAnotherShortcut, .messageOnly:
                        EmptyView()
                    }
                }
            }

            // Delivery reasons are not trigger health, but they are the ONLY message telling the
            // owner their transcript is still recoverable — so they need a surface here, not just
            // a wordless warning triangle in the menu bar and a caption behind a click. Scoping
            // the trigger section was right; dropping these entirely was not.
            if !engine.blockedReasonEntries.filter({ !$0.isTriggerHealth }).isEmpty {
                Section("Last Delivery") {
                    ForEach(engine.blockedReasonEntries.filter { !$0.isTriggerHealth }) { entry in
                        Label(entry.message, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }
            }

            Section("Permissions") {
                HStack {
                    Text("Microphone")
                    Spacer()
                    Text(engine.microphonePermissionLabel)
                        .foregroundStyle(.secondary)
                }
                Button("Request Microphone") {
                    engine.requestMicrophonePermission()
                }
                HStack {
                    Text("Accessibility")
                    Spacer()
                    Text(engine.accessibilityPermissionLabel)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Button("Request Accessibility") {
                        engine.requestAccessibilityPermission()
                    }
                    Button("Open Accessibility Settings") {
                        engine.openAccessibilitySettings()
                    }
                }
            }

            Section("Transcription Cleanup") {
                Picker("Mode", selection: $preferences.settings.postProcessingMode) {
                    ForEach(PostProcessingMode.allCases) { mode in
                        Text(mode.label).tag(mode.rawValue)
                    }
                }
                .pickerStyle(.segmented)
                .onChange(of: preferences.settings.postProcessingMode) {
                    try? preferences.save()
                }
                TextEditor(text: $preferences.settings.globalSystemPrompt)
                    .frame(height: 80)
                    .onChange(of: preferences.settings.globalSystemPrompt) {
                        try? preferences.save()
                    }
                Text("Instructions for post-transcription cleanup and formatting.")
                    .foregroundStyle(.secondary)
            }
            .disabled(!preferences.canMutateProjects)
        }
        .formStyle(.grouped).padding()
    }

    // MARK: - Voice Shortcuts

    @State private var newTrigger = ""
    @State private var newContent = ""

    private var shortcutsTab: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                TextField("Trigger phrase", text: $newTrigger).textFieldStyle(.roundedBorder)
                TextField("Text to insert", text: $newContent).textFieldStyle(.roundedBorder)
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
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "text.badge.star").font(.largeTitle).foregroundStyle(.quaternary)
                    Text("No voice shortcuts yet").foregroundStyle(.secondary)
                }
                Spacer()
            } else {
                List {
                    ForEach(shortcuts.shortcuts) { s in
                        VStack(alignment: .leading) {
                            Text(s.trigger).bold()
                            Text(s.content).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    .onDelete(perform: shortcuts.remove)
                }
            }
        }
    }
}
