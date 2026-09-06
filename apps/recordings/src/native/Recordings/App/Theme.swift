import SwiftUI
import AppKit
import RecordingsLib

enum Theme {
    static let accent = Color(red: 0.19, green: 0.20, blue: 0.22)
    static let recordRed = Color(red: 1, green: 0.24, blue: 0.25)
    static let cornerLarge: CGFloat = 22
    static let cornerMedium: CGFloat = 14
    static let cornerSmall: CGFloat = 9
    static func canvas(_ scheme: ColorScheme) -> Color { Color(NSColor.windowBackgroundColor) }
    static func clock(_ seconds: Double) -> String {
        let total = max(0, Int(seconds))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

/// One native blur behind each window. The animated controls use cheap gradients rather
/// than creating new Liquid Glass rendering surfaces on every microphone tick.
struct FrostedBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var radius: CGFloat = 20
    var cool = false
    var body: some View {
        ZStack {
            if ChromeSurface.forReducedTransparency(reduceTransparency) == .opaque {
                Color(NSColor.windowBackgroundColor)
            } else {
                Color(red: cool ? 0.92 : 0.84, green: cool ? 0.93 : 0.83, blue: cool ? 0.96 : 0.81)
                NativeFrost().opacity(cool ? 0.14 : 0.3)
                LinearGradient(colors: [.white.opacity(0.45), .white.opacity(0.10), .white.opacity(0.20)], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(.white.opacity(0.78), lineWidth: 1))
    }
}

private struct NativeFrost: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }
    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

struct GlassCircle: View {
    let symbol: String
    var size: CGFloat = 44
    var red = false
    var progress: Double? = nil
    var body: some View {
        ZStack {
            Circle().fill(.white.opacity(0.20)).padding(-7)
            Circle()
                .fill(LinearGradient(colors: red
                    ? [Color(red: 1, green: 0.38, blue: 0.38), Color(red: 0.94, green: 0.18, blue: 0.19)]
                    : [.white.opacity(0.58), .white.opacity(0.06), .white.opacity(0.25)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .shadow(color: red ? .red.opacity(0.26) : .black.opacity(0.10), radius: red ? 22 : 9, y: 4)
            Circle().strokeBorder(.white.opacity(red ? 0.8 : 0.95), lineWidth: 1.2)
            Circle().strokeBorder(.black.opacity(red ? 0.05 : 0.07), lineWidth: 1).padding(-2)
            if let progress {
                Circle().trim(from: 0, to: min(1, max(0, progress)))
                    .stroke(.gray.opacity(0.72), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .rotationEffect(.degrees(-90)).padding(-5)
            }
            Image(systemName: symbol)
                .font(.system(size: size * (symbol == "mic.fill" ? 0.34 : size > 100 ? 0.34 : 0.46), weight: .regular))
                .foregroundStyle(red ? .white : Theme.accent)
                .shadow(color: .white.opacity(0.85), radius: 0, y: 1)
        }
        .frame(width: size, height: size)
    }
}

struct GlassIconButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = 40
    let action: () -> Void
    var body: some View {
        Button(action: action) { GlassCircle(symbol: symbol, size: size) }
            .buttonStyle(.plain).help(label).accessibilityLabel(label)
    }
}

extension View {
    func glassSurface(cornerRadius: CGFloat, tint: Color? = nil, interactive: Bool = false) -> some View {
        background(FrostedBackground(radius: cornerRadius))
    }
}

extension Date {
    var relativeDescription: String {
        let f = RelativeDateTimeFormatter(); f.unitsStyle = .abbreviated
        return f.localizedString(for: self, relativeTo: Date())
    }
    var recordingDateLabel: String {
        let time = formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDateInToday(self) { return "Today, \(time)" }
        if Calendar.current.isDateInYesterday(self) { return "Yesterday, \(time)" }
        return formatted(.dateTime.month(.abbreviated).day().year())
    }
}
