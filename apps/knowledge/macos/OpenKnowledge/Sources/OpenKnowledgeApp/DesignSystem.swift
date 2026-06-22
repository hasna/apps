import SwiftUI

enum OKDesign {
    static let accent = Color(red: 5.0 / 255.0, green: 150.0 / 255.0, blue: 105.0 / 255.0)
    static let linkAccent = Color(red: 4.0 / 255.0, green: 120.0 / 255.0, blue: 87.0 / 255.0)
    static let warning = Color(red: 180.0 / 255.0, green: 83.0 / 255.0, blue: 9.0 / 255.0)
    static let danger = Color(red: 185.0 / 255.0, green: 28.0 / 255.0, blue: 28.0 / 255.0)
    static let surface = Color(nsColor: .controlBackgroundColor)
    static let secondarySurface = Color(nsColor: .windowBackgroundColor)
    static let separator = Color(nsColor: .separatorColor)

    static let cardRadius: CGFloat = 8
    static let controlRadius: CGFloat = 7
    static let contentMaxWidth: CGFloat = 1180
}

struct OKCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: OKDesign.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: OKDesign.cardRadius, style: .continuous)
                    .stroke(OKDesign.separator.opacity(0.55), lineWidth: 1)
            )
    }
}

struct StatusPill: View {
    let label: String
    let systemImage: String
    let tone: Tone

    enum Tone: Equatable {
        case ok
        case neutral
        case warning
        case danger

        var color: Color {
            switch self {
            case .ok: return OKDesign.accent
            case .neutral: return .secondary
            case .warning: return OKDesign.warning
            case .danger: return OKDesign.danger
            }
        }
    }

    var body: some View {
        Label(label, systemImage: systemImage)
            .font(.caption.weight(.medium))
            .foregroundStyle(tone.color)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(tone.color.opacity(0.12), in: Capsule())
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    let detail: String
    let systemImage: String

    var body: some View {
        OKCard {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: systemImage)
                    .font(.title3)
                    .foregroundStyle(OKDesign.accent)
                    .frame(width: 26, height: 26)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(value)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(minWidth: 160)
    }
}

struct SectionHeader: View {
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title2.weight(.semibold))
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct KeyValueRow: View {
    let key: String
    let value: String

    var body: some View {
        GridRow {
            Text(key)
                .foregroundStyle(.secondary)
            Text(value.isEmpty ? "Not set" : value)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.callout)
    }
}

extension View {
    func okPagePadding() -> some View {
        self
            .padding(.horizontal, 22)
            .padding(.vertical, 18)
            .frame(maxWidth: OKDesign.contentMaxWidth, alignment: .topLeading)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
