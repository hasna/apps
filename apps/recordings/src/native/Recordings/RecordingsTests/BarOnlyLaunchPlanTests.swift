import Foundation
import Testing
@testable import RecordingsLib

/// Regression coverage for the bar-only successor lane (task 4ee4ebbf-9a10-4181-8e43-9307d56e684b).
///
/// These lock the launch-plan control flow behind the terminated hasna/apps#269 lineage's P1
/// classes:
///
/// - Cycle-1 P1: real launches of the installed bar never passed `--bar-only`, so the bar
///   binary was behaviorally identical to the full app. Fixed by making bar builds bar-only by
///   construction (`#if RECORDINGS_BAR_ONLY` compile-time default); the argument is now only a
///   self-describing launch record.
/// - Cycle-2 P1: the windowless branch keyed on `declaresMainWindow`, which excludes EVERY
///   runtime smoke, so the FULL build's smoke failed deterministically. Fixed by splitting the
///   conditions: `declaresWindow` (window creation may happen) excludes only the helper and bar
///   launches, while `declaresMainWindow` (auto-open / reopen) additionally excludes runtime
///   smoke so the smoke controls window creation deterministically.
struct BarOnlyLaunchPlanTests {
    @Test("a bare launch follows the build variant")
    func bareLaunchFollowsBuildVariant() {
        let plan = PermissionRequestLaunchPlan(arguments: [])
        #if RECORDINGS_BAR_ONLY
        #expect(plan.isBarOnly, "a bar build must be bar-only by construction on a bare launch")
        #expect(!plan.declaresWindow)
        #expect(!plan.declaresMainWindow)
        #else
        #expect(!plan.isBarOnly, "a full build must launch with the workspace window")
        #expect(plan.declaresWindow)
        #expect(plan.declaresMainWindow)
        #endif
        #expect(plan.declaresMenuBar)
        #expect(plan.installsGlobalHandlers)
    }

    @Test("the explicit bar argument makes any launch bar-only on a full build")
    func explicitBarArgument() {
        #if !RECORDINGS_BAR_ONLY
        let plan = PermissionRequestLaunchPlan(arguments: ["--bar-only"])
        #expect(plan.isBarOnly)
        #expect(!plan.declaresWindow)
        #expect(!plan.declaresMainWindow)
        // The menu bar is still declared: the bar keeps the record controls, live
        // transcription, paste delivery, and settings surfaces.
        #expect(plan.declaresMenuBar)
        #endif
    }

    @Test("a full build's normal-mode runtime smoke keeps exercising the workspace window")
    func fullBuildRuntimeSmokePlan() {
        let plan = PermissionRequestLaunchPlan(arguments: [
            "--runtime-smoke", "normal",
            "--runtime-smoke-output", "/tmp/smoke.json",
        ])
        #if RECORDINGS_BAR_ONLY
        // On a bar build even the smoke is bar-only: the windowless branch keys on the
        // build variant, not on the smoke mode.
        #expect(plan.isBarOnly)
        #expect(!plan.declaresWindow)
        #else
        // The cycle-2 P1 regression: a full build's smoke must still be able to create
        // the workspace window, or every full build's smoke fails deterministically.
        #expect(!plan.isBarOnly)
        #expect(plan.declaresWindow, "the full-build smoke must exercise the workspace window")
        #endif
        // declaresMainWindow excludes runtime smoke in BOTH variants so the smoke controls
        // window creation deterministically (no init auto-open, no reopen handler).
        #expect(!plan.declaresMainWindow)
        #expect(plan.isRuntimeSmoke)
        #expect(plan.declaresMenuBar, "the smoke must observe the live menu bar surface")
    }

    @Test("a bar plan keeps the menu bar and global handlers but never declares a window")
    func barPlanKeepsMenuBarAndGlobalHandlers() {
        let plan = PermissionRequestLaunchPlan(arguments: ["--bar-only"])
        #expect(plan.installsGlobalHandlers)
        #expect(plan.declaresMenuBar)
        #expect(plan.isBarOnly)
        #expect(!plan.declaresWindow)
        #expect(!plan.declaresMainWindow)
    }

    @Test("declaresMainWindow excludes runtime smoke, helper, and bar launches")
    func declaresMainWindowExcludesRuntimeSmoke() {
        for arguments in [
            ["--runtime-smoke", "normal"],
            ["--runtime-smoke", "permission-helper"],
            ["--request-permissions"],
            ["--bar-only"],
        ] {
            let plan = PermissionRequestLaunchPlan(arguments: arguments)
            #expect(!plan.declaresMainWindow)
        }
        let plain = PermissionRequestLaunchPlan(arguments: [])
        #if !RECORDINGS_BAR_ONLY
        #expect(plain.declaresMainWindow)
        #endif
    }
}
