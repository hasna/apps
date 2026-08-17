import Foundation
import Testing
@testable import RecordingsLib

struct BarOnlyLaunchPlanTests {
    @Test("bar-only launch keeps global handlers and the menu bar but never declares a main window")
    func barOnlyLaunchPlan() {
        let plan = PermissionRequestLaunchPlan(arguments: [
            "Recordings",
            "--bar-only",
        ])

        #expect(!plan.isHelper)
        #expect(plan.isBarOnly)
        #expect(plan.installsGlobalHandlers)
        #expect(!plan.declaresMainWindow)
        #expect(plan.declaresMenuBar)
        #expect(!plan.terminatesAfterHandling)
        #expect(!plan.requestsAccessibilityPrompt)
    }

    @Test("bar-only runtime smoke still renders the menu-bar surface without a window")
    func barOnlyRuntimeSmokePlan() {
        let plan = PermissionRequestLaunchPlan(arguments: [
            "Recordings",
            "--bar-only",
            "--runtime-smoke", "normal",
            "--runtime-smoke-output", "/tmp/bar-result.json",
            "--runtime-smoke-ack", "/tmp/bar-result.ack",
            "--runtime-smoke-completion", "/tmp/bar-result.completion.json",
        ])

        #expect(plan.isRuntimeSmoke)
        #expect(plan.isBarOnly)
        #expect(!plan.installsGlobalHandlers)
        #expect(!plan.declaresMainWindow)
        #expect(plan.declaresMenuBar)
        #expect(!plan.requestsAccessibilityPrompt)
    }

    @Test("permission-helper gating wins over the bar-only flag")
    func barOnlyHelperPlan() {
        let plan = PermissionRequestLaunchPlan(arguments: [
            "Recordings",
            "--bar-only",
            "--request-permissions",
        ])

        #expect(plan.isHelper)
        #expect(plan.isBarOnly)
        #expect(!plan.installsGlobalHandlers)
        #expect(!plan.declaresMainWindow)
        #expect(!plan.declaresMenuBar)
        #expect(plan.terminatesAfterHandling)
        #expect(plan.requestsAccessibilityPrompt)
    }

    @Test("regular launch is unchanged: main window declared, bar-only false")
    func regularLaunchUnchanged() {
        let plan = PermissionRequestLaunchPlan(arguments: ["Recordings"])

        #expect(!plan.isBarOnly)
        #expect(plan.installsGlobalHandlers)
        #expect(plan.declaresMainWindow)
        #expect(plan.declaresMenuBar)
    }
}
