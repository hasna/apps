import SwiftUI

struct SparklineView: View {
  let entries: [DailyEntry]

  private var dailyTotals: [(date: String, cost: Double)] {
    var map: [String: Double] = [:]
    for e in entries { map[e.date, default: 0] += e.cost_usd }
    return map.keys.sorted().map { (date: $0, cost: map[$0]!) }
  }

  var body: some View {
    VStack(spacing: 2) {
      Canvas { ctx, size in
        let totals = dailyTotals
        guard totals.count > 1 else { return }
        let maxVal = totals.map(\.cost).max() ?? 1
        let barWidth = size.width / CGFloat(totals.count)
        let gap: CGFloat = 1
        for (i, entry) in totals.enumerated() {
          let height = maxVal > 0 ? CGFloat(entry.cost / maxVal) * size.height : 2
          let x = CGFloat(i) * barWidth + gap / 2
          let rect = CGRect(x: x, y: size.height - height, width: barWidth - gap, height: max(height, 2))
          ctx.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(.accentColor.opacity(0.8)))
        }
      }
      .frame(height: 36)

      if let first = dailyTotals.first?.date, let last = dailyTotals.last?.date {
        HStack {
          Text(formatDate(first)).font(.system(size: 9)).foregroundStyle(.tertiary)
          Spacer()
          Text(formatDate(last)).font(.system(size: 9)).foregroundStyle(.tertiary)
        }
      }
    }
  }

  private func formatDate(_ d: String) -> String {
    let parts = d.split(separator: "-")
    guard parts.count == 3 else { return d }
    return "\(parts[1])/\(parts[2])"
  }
}
