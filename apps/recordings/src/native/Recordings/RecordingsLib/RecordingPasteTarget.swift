import AppKit
import Foundation

/// An observed app process, not a bundle-ID request to launch or find another instance.
public struct RecordingPasteTarget: Equatable, Sendable {
    public let processIdentifier: pid_t
    public let bundleIdentifier: String
    public let launchDate: Date
    public let applicationName: String

    init?(observation: PasteApplicationObservation, currentPID: pid_t) {
        guard observation.pid > 0, observation.pid != currentPID,
              observation.isRegular, !observation.isTerminated,
              let bundle = observation.bundleIdentifier, !bundle.isEmpty,
              let launchDate = observation.launchDate else { return nil }
        processIdentifier = observation.pid
        bundleIdentifier = bundle
        self.launchDate = launchDate
        applicationName = observation.name ?? "Application"
    }

    func matches(_ observation: PasteApplicationObservation) -> Bool {
        observation.pid == processIdentifier && observation.bundleIdentifier == bundleIdentifier
            && observation.launchDate == launchDate && observation.isRegular && !observation.isTerminated
    }
}

/// Omission preserves the recorder's existing frontmost-app behavior. A frozen nil
/// explicitly means no destination; it never adopts another app at delivery time.
public enum RecordingPasteTargetSelection: Equatable, Sendable {
    case frontmostApplication
    case frozen(RecordingPasteTarget?)
}

struct PasteApplicationObservation: Sendable {
    var pid: pid_t
    var bundleIdentifier: String?
    var launchDate: Date?
    var name: String?
    var isRegular: Bool
    var isTerminated: Bool

    init(_ app: NSRunningApplication) {
        pid = app.processIdentifier; bundleIdentifier = app.bundleIdentifier
        launchDate = app.launchDate; name = app.localizedName
        isRegular = app.activationPolicy == .regular; isTerminated = app.isTerminated
    }
    init(pid: pid_t, bundleIdentifier: String?, launchDate: Date?, name: String? = nil,
         isRegular: Bool = true, isTerminated: Bool = false) {
        self.pid = pid; self.bundleIdentifier = bundleIdentifier; self.launchDate = launchDate
        self.name = name; self.isRegular = isRegular; self.isTerminated = isTerminated
    }
}

/// Keep one tracker for the host application's lifetime, before presenting its UI.
/// Observes workspace activation only; never installs input handlers, queries AX,
/// activates apps, reads their documents, or accesses the clipboard.
@MainActor public final class RecordingPasteTargetTracker {
    private let currentPID: pid_t
    private let frontmost: () -> PasteApplicationObservation?
    private let lookup: (pid_t) -> PasteApplicationObservation?
    private var lastExternal: RecordingPasteTarget?
    private var observers: [NSObjectProtocol] = []
    private var center: NotificationCenter?

    public convenience init() {
        self.init(currentPID: ProcessInfo.processInfo.processIdentifier,
                  frontmost: { NSWorkspace.shared.frontmostApplication.map(PasteApplicationObservation.init) },
                  lookup: { NSRunningApplication(processIdentifier: $0).map(PasteApplicationObservation.init) })
        let center = NSWorkspace.shared.notificationCenter
        self.center = center
        observers.append(center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            let observation = PasteApplicationObservation(app)
            MainActor.assumeIsolated { self?.observe(observation) }
        })
        observers.append(center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            let observation = PasteApplicationObservation(app)
            MainActor.assumeIsolated { self?.terminated(observation) }
        })
    }

    init(currentPID: pid_t, frontmost: @escaping () -> PasteApplicationObservation?,
         lookup: @escaping (pid_t) -> PasteApplicationObservation?) {
        self.currentPID = currentPID; self.frontmost = frontmost; self.lookup = lookup
        if let app = frontmost() { observe(app) }
    }

    isolated deinit { for observer in observers { center?.removeObserver(observer) } }

    func observe(_ app: PasteApplicationObservation) {
        guard let target = RecordingPasteTarget(observation: app, currentPID: currentPID) else { return }
        lastExternal = target
    }

    func terminated(_ app: PasteApplicationObservation) {
        guard let target = lastExternal, app.pid == target.processIdentifier,
              app.bundleIdentifier == target.bundleIdentifier, app.launchDate == target.launchDate else { return }
        lastExternal = nil
    }

    /// Revalidate now, then pass this value to startRecording as `.frozen(value)`.
    /// A terminated or replaced process clears the remembered destination; older
    /// apps are not searched as a substitute.
    public func snapshot() -> RecordingPasteTarget? {
        if let app = frontmost() { observe(app) }
        guard let target = lastExternal else { return nil }
        guard let live = lookup(target.processIdentifier), target.matches(live) else {
            lastExternal = nil; return nil
        }
        return target
    }
}
