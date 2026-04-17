import SwiftUI

struct SessionRowView: View {
  let session: SessionStat

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(session.agent.uppercased())
            .font(.caption2)
            .fontWeight(.bold)
            .foregroundStyle(.secondary)

          Text(session.shortId)
            .font(.caption2)
            .fontDesign(.monospaced)
            .foregroundStyle(.secondary)
        }

        Text(session.displayProject)
          .font(.system(size: 12, weight: .medium))
          .lineLimit(1)
          .truncationMode(.middle)

        Text(session.startedAtLabel)
          .font(.caption2)
          .foregroundStyle(.tertiary)
      }

      Spacer(minLength: 8)

      VStack(alignment: .trailing, spacing: 3) {
        Text(fmtCost(session.total_cost_usd))
          .font(.system(size: 12, weight: .semibold).monospacedDigit())

        Text("\(session.request_count) req")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 0.01 { return String(format: "$%.2f", usd) }
    if usd > 0 { return String(format: "$%.1f¢", usd * 100) }
    return "$0.00"
  }
}
