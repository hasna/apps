import SwiftUI

struct SubscriptionRowView: View {
  let subscription: SubscriptionPlan

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 1) {
        Text(subscription.displayName)
          .font(.system(size: 12))
          .lineLimit(1)
          .truncationMode(.middle)
        Text("\(subscription.agentLabel) / \(subscription.reset_policy) reset")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 1) {
        Text(fmtCost(subscription.monthly_fee_usd))
          .font(.system(size: 12, weight: .medium).monospacedDigit())
        Text("included \(fmtCost(subscription.included_usage_usd))")
          .font(.system(size: 10).monospacedDigit())
          .foregroundStyle(.secondary)
      }
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 1000 { return String(format: "$%.0f", usd) }
    if usd >= 0.01 { return String(format: "$%.2f", usd) }
    if usd > 0 { return String(format: "$%.1f¢", usd * 100) }
    return "$0.00"
  }
}
