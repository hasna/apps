import SwiftUI

struct FleetMachineRowView: View {
  let machine: FleetMachine
  let currentMachine: String

  private var isCurrent: Bool {
    machine.machine_id == currentMachine
  }

  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      Image(systemName: isCurrent ? "desktopcomputer" : "server.rack")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(isCurrent ? .blue : .secondary)
        .frame(width: 18)

      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(machine.displayName)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)

          if isCurrent {
            Text("THIS MAC")
              .font(.system(size: 8, weight: .bold))
              .foregroundStyle(.blue)
              .padding(.horizontal, 5)
              .padding(.vertical, 2)
              .background(.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
          }
        }

        Text("\(machine.sessions) sessions / \(machine.requests) requests")
          .font(.caption2.monospacedDigit())
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 8)

      Text(fmtCost(machine.total_cost_usd))
        .font(.system(size: 12, weight: .semibold).monospacedDigit())
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 1000 { return String(format: "$%.0f", usd) }
    if usd >= 0.01 { return String(format: "$%.2f", usd) }
    if usd > 0 { return String(format: "$%.1f¢", usd * 100) }
    return "$0.00"
  }
}
