import SwiftUI

struct UsageSnapshotRowView: View {
  let snapshot: UsageSnapshot

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 1) {
        Text(snapshot.displayAgent)
          .font(.system(size: 12))
          .lineLimit(1)
        Text(snapshot.displayMetric)
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 1) {
        Text(snapshot.displayValue)
          .font(.system(size: 12, weight: .medium).monospacedDigit())
          .foregroundStyle(snapshot.unit == "percent" && snapshot.value >= 80 ? .orange : .primary)
        Text(snapshot.machine_id ?? snapshot.date ?? "")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
  }
}
