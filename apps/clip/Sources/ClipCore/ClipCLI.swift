import Foundation

public struct ClipCommand {
    public let executable: String
    public let arguments: [String]

    public init(executable: String = "clip", arguments: [String]) {
        self.executable = executable
        self.arguments = arguments
    }

    public static func captureFull() -> ClipCommand {
        ClipCommand(arguments: ["capture", "full", "--copy-link"])
    }

    public static func captureWindow() -> ClipCommand {
        ClipCommand(arguments: ["capture", "window", "--copy-link"])
    }

    public static func captureRegion() -> ClipCommand {
        ClipCommand(arguments: ["capture", "region", "--copy-link"])
    }

    public static func shareClipboard() -> ClipCommand {
        ClipCommand(arguments: ["clipboard", "--copy-link"])
    }

    public static func openRecent() -> ClipCommand {
        ClipCommand(arguments: ["open-recent"])
    }
}

public struct ClipRunner {
    public init() {}

    @discardableResult
    public func run(_ command: ClipCommand) throws -> String {
        let process = Process()
        let executablePath = resolveExecutable(command.executable)
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = executablePath == "/usr/bin/env"
            ? [command.executable] + command.arguments
            : command.arguments

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8) ?? ""
        if process.terminationStatus != 0 {
            throw NSError(
                domain: "OpenClip",
                code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: output]
            )
        }
        return output
    }

    private func resolveExecutable(_ executable: String) -> String {
        if executable.contains("/") && FileManager.default.isExecutableFile(atPath: executable) {
            return executable
        }
        if let override = ProcessInfo.processInfo.environment["HASNA_CLIP_CLI"],
           FileManager.default.isExecutableFile(atPath: override) {
            return override
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.bun/bin/\(executable)",
            "\(home)/.local/bin/\(executable)",
            "/opt/homebrew/bin/\(executable)",
            "/usr/local/bin/\(executable)"
        ]
        for candidate in candidates {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return "/usr/bin/env"
    }
}
