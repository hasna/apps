import Foundation

/// One machine known to this install. Machine attribution is informational only:
/// notes carry a `machine` frontmatter field and the UI shows friendly names for it.
/// (The old rsync/ssh FleetSync engine and its CLI/fallback discovery were removed —
/// real sync arrives via the hosted/self-hosted protocol.)
public struct FleetMachine: Identifiable, Sendable {
    public var id: String
    public var slug: String?
    public var platform: String
    public var friendlyName: String?
    public var status: String?
    public var online: Bool?
    public var updatedAt: Date?
    public var lastSeenAt: Date?
    public var recentActivityAt: Date?

    public init(
        id: String,
        platform: String = "macos",
        friendlyName: String? = nil,
        updatedAt: Date? = nil,
        slug: String? = nil,
        status: String? = nil,
        online: Bool? = nil,
        lastSeenAt: Date? = nil,
        recentActivityAt: Date? = nil
    ) {
        self.id = id
        self.slug = slug?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.platform = platform
        self.friendlyName = friendlyName?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.status = status?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.online = online
        self.updatedAt = updatedAt
        self.lastSeenAt = lastSeenAt
        self.recentActivityAt = recentActivityAt
    }

    public var displayName: String {
        if let friendlyName, !friendlyName.isEmpty { return friendlyName }
        if let slug, !slug.isEmpty { return slug }
        return id
    }
}

/// Reads the optional machine manifest at `~/.hasna/machines/machines.json`
/// (JSON: `{ "machines": [ {id, platform, friendlyName, slug, ...} ] }`). This is the
/// only discovery source: it supplies friendly names/slugs for the machines dropdown;
/// machines seen in note frontmatter get rows regardless. Missing file → empty list.
public enum FleetManifest {

    public static func defaultManifestURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hasna", isDirectory: true)
            .appendingPathComponent("machines", isDirectory: true)
            .appendingPathComponent("machines.json")
    }

    private static func string(_ entry: [String: Any], _ keys: [String]) -> String? {
        for key in keys {
            if let value = entry[key], !String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return nil
    }

    private static func bool(_ value: Any?) -> Bool? {
        if let value = value as? Bool { return value }
        guard let raw = value.map({ String(describing: $0).lowercased() }) else { return nil }
        if ["true", "1", "yes", "online"].contains(raw) { return true }
        if ["false", "0", "no", "offline"].contains(raw) { return false }
        return nil
    }

    private static func date(_ entry: [String: Any], _ keys: [String]) -> Date? {
        for key in keys {
            if let raw = string(entry, [key]), let parsed = MarkdownStore.parseDate(raw) { return parsed }
        }
        return nil
    }

    /// Parse a `machines.json` or open-machines-shaped payload. Tolerates extra keys and
    /// entries missing `platform` (defaults to "macos").
    public static func parse(jsonData: Data) -> [FleetMachine] {
        guard let parsed = try? JSONSerialization.jsonObject(with: jsonData) else {
            return []
        }
        let arr: [[String: Any]]
        if let direct = parsed as? [[String: Any]] {
            arr = direct
        } else if let root = parsed as? [String: Any] {
            arr = (root["machines"] as? [[String: Any]])
                ?? (root["items"] as? [[String: Any]])
                ?? (root["data"] as? [[String: Any]])
                ?? []
        } else {
            arr = []
        }
        return arr.compactMap { entry in
            guard let id = string(entry, ["id", "slug", "machineId", "name", "hostname"]), !id.isEmpty else {
                return nil
            }
            let platform = string(entry, ["platform", "os"]) ?? "macos"
            let friendlyName = string(entry, ["friendlyName", "displayName", "label", "title"])
            let online = bool(entry["online"] ?? entry["isOnline"] ?? entry["reachable"])
            let status = string(entry, ["status", "state", "availability"])
                ?? (online == true ? "online" : (online == false ? "offline" : nil))
            return FleetMachine(
                id: id,
                platform: platform,
                friendlyName: friendlyName,
                updatedAt: date(entry, ["updatedAt", "lastUpdated", "modifiedAt"]),
                slug: string(entry, ["slug"]),
                status: status,
                online: online,
                lastSeenAt: date(entry, ["lastSeenAt", "lastHeartbeatAt", "heartbeatAt", "seenAt"]),
                recentActivityAt: date(entry, ["recentActivityAt", "lastActivityAt", "activityAt"])
            )
        }
    }

    /// Load the manifest file. Missing or unparseable file yields an empty list —
    /// machine rows then come purely from note frontmatter.
    public static func load(manifestURL: URL? = nil) -> [FleetMachine] {
        let url = manifestURL ?? defaultManifestURL()
        guard let data = try? Data(contentsOf: url) else { return [] }
        return parse(jsonData: data)
    }
}
