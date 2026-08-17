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

    @Test("full-build normal runtime smoke stays non-bar so the smoke keeps exercising the window")
    func fullBuildRuntimeSmokePlan() {
        // Regression for the review finding that RecordingsAppState keyed the smoke window
        // path on declaresMainWindow, which excludes runtime-smoke mode: every normal smoke
        // of the FULL build finished window-less and the retained-window assertions failed.
        // The App layer therefore keys window creation on isBarOnly, not declaresMainWindow,
        // and this plan-level invariant is what makes that safe: a full build's smoke is
        // never bar-only, while a bar build's smoke always is.
        let plan = PermissionRequestLaunchPlan(arguments: [
            "Recordings",
            "--runtime-smoke", "normal",
            "--runtime-smoke-output", "/tmp/full-result.json",
            "--runtime-smoke-ack", "/tmp/full-result.ack",
            "--runtime-smoke-completion", "/tmp/full-result.completion.json",
        ])

        #expect(plan.isRuntimeSmoke)
        #if RECORDINGS_BAR_ONLY
        #expect(plan.isBarOnly)
        #else
        #expect(!plan.isBarOnly)
        #endif
        #expect(!plan.declaresMainWindow)
        #expect(plan.declaresMenuBar)
        #expect(!plan.installsGlobalHandlers)
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

    @Test("bare launch follows the build variant: bar builds are bar-only by construction")
    func bareLaunchFollowsBuildVariant() {
        // Regression for the review finding that a real launch never passed --bar-only: the
        // bar build must be bar-only at compile time (build.sh passes -Xswiftc
        // -DRECORDINGS_BAR_ONLY for RECORDINGS_VARIANT=bar), so no launch path can re-create
        // the workspace window. A full build keeps the argument-driven behavior.
        let plan = PermissionRequestLaunchPlan(arguments: ["Recordings"])

        #expect(plan.installsGlobalHandlers)
        #expect(plan.declaresMenuBar)
        #if RECORDINGS_BAR_ONLY
        #expect(plan.isBarOnly)
        #expect(!plan.declaresMainWindow)
        #expect(!plan.terminatesAfterHandling)
        #expect(!plan.requestsAccessibilityPrompt)
        #else
        #expect(!plan.isBarOnly)
        #expect(plan.declaresMainWindow)
        #endif
    }

    @Test("bar build with explicit --bar-only is identical to the bare bar launch")
    func barBuildExplicitArgumentIsConsistent() {
        let plan = PermissionRequestLaunchPlan(arguments: ["Recordings", "--bar-only"])

        #expect(plan.isBarOnly)
        #expect(plan.installsGlobalHandlers)
        #expect(!plan.declaresMainWindow)
        #expect(plan.declaresMenuBar)
    }
}
