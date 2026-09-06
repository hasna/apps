import SwiftUI

struct ServiceConnectionView: View {
    let home: String
    @State private var apiURL = ServiceAPIConfiguration.configuredURL()
    @State private var apiKey = ""
    @State private var status: String?
    @State private var checking = false

    private var environmentManaged: Bool {
        ["HASNA_RECORDINGS_API_URL", "HASNA_RECORDINGS_CLIENT_STORE", "RECORDINGS_CLIENT_STORE"]
            .contains { !(ProcessInfo.processInfo.environment[$0] ?? "").isEmpty }
    }

    var body: some View {
        Section("Recordings API") {
            TextField("API URL", text: $apiURL)
                .textFieldStyle(.roundedBorder)
                .disabled(environmentManaged)
            SecureField("API key", text: $apiKey)
                .textFieldStyle(.roundedBorder)
                .disabled(environmentManaged)
            Text(environmentManaged
                 ? "Connection managed by the launch environment."
                 : "The URL is configurable. Saved API keys stay in Keychain and are used only for this endpoint.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                if !environmentManaged {
                    Button("Save Connection", action: save)
                        .disabled(checking || apiURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Button("Test Connection", action: testConnection)
                    .disabled(checking)
                if checking { ProgressView().controlSize(.small) }
            }
            if let status { Text(status).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func save() {
        do {
            try ServiceAPIConfiguration.save(url: apiURL, apiKey: apiKey)
            apiURL = ServiceAPIConfiguration.configuredURL()
            apiKey = ""
            status = "Connection saved."
        } catch {
            status = error.localizedDescription
        }
    }

    private func testConnection() {
        if !environmentManaged {
            do {
                try ServiceAPIConfiguration.save(url: apiURL, apiKey: apiKey)
                apiKey = ""
            } catch {
                status = error.localizedDescription
                return
            }
        }
        checking = true
        status = nil
        Task {
            let result = await Task.detached {
                do {
                    _ = try RecordingsCLI.list(limit: 1, home: home)
                    return "Connected. Recordings are available."
                } catch {
                    return (error as? RecordingsCLI.Failure)?.message ?? error.localizedDescription
                }
            }.value
            status = result
            checking = false
        }
    }
}
