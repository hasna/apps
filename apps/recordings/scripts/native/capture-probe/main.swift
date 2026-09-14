import AppKit
import AVFoundation
import Foundation

// Dispatch supports cancellation from another queue. The work item is private,
// immutable after construction and is never synchronously waited upon.
private final class ProbeWatchdog: @unchecked Sendable {
    private let work = DispatchWorkItem { _exit(2) }

    init() {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 25, execute: work)
    }

    func cancel() { work.cancel() }
}

private struct ProbeResult: Sendable {
    let outcome: String
    let reportSaved: Bool
}

private final class ProbeReport: @unchecked Sendable {
    private let lock = NSLock()
    private var result: ProbeResult?
    private var snapshot: NativePCMRecorderDiagnosticsSnapshot?
    let id = UUID().uuidString
    let selection: NativePCMRecorderTapFormatSelection
    let destination: URL

    init(selection: NativePCMRecorderTapFormatSelection) throws {
        self.selection = selection
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Recordings Capture Probe/reports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        destination = directory.appendingPathComponent("\(id).json")
    }

    func receive(_ value: NativePCMRecorderDiagnosticsSnapshot) {
        lock.withLock { snapshot = value }
    }

    func complete(outcome: String) -> ProbeResult {
        lock.withLock {
            if let result { return result }
            var report: [String: Any] = [
                "schemaVersion": 1, "probeID": id,
                "at": ISO8601DateFormatter().string(from: Date()),
                "outcome": outcome, "selection": selection.rawValue,
                "requestedDurationSeconds": 8,
                "audioSaved": false, "networkUsed": false
            ]
            if let snapshot { report["diagnostics"] = Self.json(snapshot) }
            do {
                let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted])
                try data.write(to: destination, options: [.atomic])
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
                result = ProbeResult(outcome: outcome, reportSaved: true)
            } catch {
                // No paths or device/account details are written to the console.
                FileHandle.standardError.write(Data("Capture probe could not save its numeric report.\n".utf8))
                result = ProbeResult(outcome: outcome, reportSaved: false)
            }
            return result!
        }
    }

    private static func json(_ value: NativePCMRecorderDiagnosticsSnapshot) -> [String: Any] {
        func format(_ v: NativePCMRecorderFormatSummary?) -> Any {
            guard let v else { return NSNull() }
            return ["sampleRateHz": v.sampleRateHz, "channelCount": v.channelCount,
                "isInterleaved": v.isInterleaved, "commonFormat": v.commonFormat] as [String: Any]
        }
        func signal(_ v: NativePCMRecorderSignalSummary) -> [String: Any] {
            ["buffers": v.bufferCount, "bytes": v.byteCount, "frames": v.frameCount,
             "samples": v.sampleCount, "nonzeroSamples": v.nonzeroSampleCount,
             "peak": v.peakAbs, "rms": v.rms]
        }
        return [
            "inputScopeFormat": format(value.inputScopeFormat),
            "outputScopeFormat": format(value.outputScopeFormat),
            "tapFormat": format(value.tapFormat),
            "firstCallbackFormat": format(value.firstCallbackFormat),
            "lastCallbackFormat": format(value.lastCallbackFormat),
            "callbackFormatChanges": value.callbackFormatChangeCount,
            "callbackFormatMismatches": value.callbackFormatMismatchCount,
            "raw": signal(value.raw), "converted": signal(value.converted),
            "conversionEmptyOutputCount": value.conversionEmptyOutputCount,
            "conversionFailureCount": value.conversionFailureCount,
            "lastConversionErrorCode": value.lastConversionErrorCode as Any? ?? NSNull(),
            "engineStartSucceeded": value.engineStartSucceeded as Any? ?? NSNull(),
            "engineRunningAfterStart": value.engineRunningAfterStart as Any? ?? NSNull(),
            "engineRunningAtStop": value.engineRunningAtStop,
            "configurationChanges": value.configurationChangeCount,
            "configurationRunningStates": value.configurationChangeRunningStates
        ]
    }
}

@MainActor
private final class ProbeDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private let message = NSTextField(wrappingLabelWithString:
        "Check the microphone for 8 seconds. Audio stays in memory and is discarded; only signal measurements are saved.")
    private let selection = NSPopUpButton()
    private let startButton = NSButton(title: "Start microphone check", target: nil, action: nil)
    private let stopButton = NSButton(title: "Stop", target: nil, action: nil)
    private var recorder: NativePCMRecorder?
    private var report: ProbeReport?
    private var starting = false
    private var terminationPending = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let appMenu = NSMenu()
        let appItem = NSMenuItem()
        let menu = NSMenu()
        menu.addItem(withTitle: "Quit Microphone Check", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = menu
        appMenu.addItem(appItem)
        NSApp.mainMenu = appMenu

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 215),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Recordings Microphone Check"
        window.isReleasedWhenClosed = false
        window.delegate = self
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        message.font = .systemFont(ofSize: 13)
        selection.addItems(withTitles: ["Current capture format", "Output-bus capture format"])
        selection.setAccessibilityLabel("Capture format")
        startButton.target = self
        startButton.action = #selector(start)
        stopButton.target = self
        stopButton.action = #selector(stop)
        stopButton.isEnabled = false
        let buttons = NSStackView(views: [startButton, stopButton])
        buttons.spacing = 8
        for view in [message, selection, buttons] { stack.addArrangedSubview(view) }
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24)
        ])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func start() {
        guard recorder == nil, !starting else { return }
        starting = true
        startButton.isEnabled = false
        selection.isEnabled = false
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            begin()
        case .notDetermined:
            message.stringValue = "Allow microphone access for this separate check."
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] allowed in
                Task { @MainActor in
                    guard let self else { return }
                    if allowed { self.begin() } else { self.permissionDenied() }
                }
            }
        default:
            permissionDenied()
        }
    }

    private func permissionDenied() {
        starting = false
        message.stringValue = "Microphone access was not granted. No check was run."
        startButton.isEnabled = true
        selection.isEnabled = true
    }

    private func begin() {
        let choice: NativePCMRecorderTapFormatSelection = selection.indexOfSelectedItem == 0 ? .inputScope : .outputScope
        let newReport: ProbeReport
        do { newReport = try ProbeReport(selection: choice) } catch {
            starting = false
            message.stringValue = "Could not create a separate diagnostic report."
            startButton.isEnabled = true
            selection.isEnabled = true
            return
        }
        let capture = NativePCMRecorder(
            onPCM: { _ in },
            diagnostics: .init(enabled: true, sink: { newReport.receive($0) }),
            tapFormatSelection: choice
        )
        report = newReport
        recorder = capture
        message.stringValue = "Starting microphone…"
        // The watchdog is independent of capture startup/stop and the UI thread.
        let watchdog = ProbeWatchdog()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result: ProbeResult
            do {
                try capture.start()
                Task { @MainActor in
                    self?.starting = false
                    self?.stopButton.isEnabled = true
                    self?.message.stringValue = "Listening for 8 seconds. Speak normally."
                }
                Thread.sleep(forTimeInterval: 8)
                capture.stop()
                result = newReport.complete(outcome: "completed")
            } catch {
                capture.stop()
                result = newReport.complete(outcome: "capture_start_failed")
            }
            watchdog.cancel()
            Task { @MainActor in self?.didFinish(newReport, result: result) }
        }
    }

    @objc private func stop() {
        guard let recorder else { return }
        stopButton.isEnabled = false
        message.stringValue = "Stopping microphone…"
        DispatchQueue.global(qos: .userInitiated).async { recorder.stop() }
    }

    private func didFinish(_ completed: ProbeReport, result: ProbeResult) {
        guard report?.id == completed.id else { return }
        recorder = nil
        starting = false
        stopButton.isEnabled = false
        startButton.isEnabled = true
        selection.isEnabled = true
        if result.outcome != "completed" {
            message.stringValue = "The microphone could not start. " +
                (result.reportSaved ? "A numeric diagnostic report was saved." : "The diagnostic report could not be saved.")
        } else if result.reportSaved {
            message.stringValue = "Check finished. The microphone has been released. Only numeric measurements were saved."
        } else {
            message.stringValue = "Check finished and the microphone was released, but its diagnostic report could not be saved."
        }
        if terminationPending { NSApp.reply(toApplicationShouldTerminate: true) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard recorder != nil else { return .terminateNow }
        terminationPending = true
        stop()
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
private enum CaptureProbeMain {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = ProbeDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { application.run() }
    }
}
