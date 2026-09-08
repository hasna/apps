# Typed worker timeout fixture validation

The aggregate job [102032597202](https://github.com/hasna/apps/actions/runs/34217490851/job/102032597202) failed in the caller-timeout test: persisted status was `running`, not `succeeded`, after 56.93 ms. The same test passed in the preceding aggregate. Its worker/store/test source was inherited unchanged from main. The failing job did not log the underlying execution exception.

A controlled reproduction with Bun 1.3.14 and actual SQLite delegated the worker’s first 15 ms lease renewal, then blocked only that fixture event loop for 40 ms. The real fenced failure operation rejected the expired lease; `onSettled` fired once while the persisted run remained `running`. The original assertion failed identically (0 pass / 1 fail). This proves a matching lease-expiry mechanism, not the precise scheduler history of the CI incident.

The caller-timeout fixture now holds its action behind an explicit promise and uses the worker’s normal lease. It asserts both the running receipt and absence of settlement before releasing the action, then still requires durable `succeeded` status. The same diagnostic preload passes without invoking its short-lease branch. A separate normal-discovery test places an owned lease in the past through the store’s explicit clock argument, observes the real fenced settlement rejection, and verifies that the callback does not imply persisted success. The existing short-lease renewal and stale-owner fencing case is unchanged. Production code and timeout settings are unchanged.

Both new fixture paths release their action during teardown, allow an independent bounded 500 ms monotonic join, and refuse to close SQLite before settlement. An additional controlled expired-body-deadline run intentionally failed its body assertion while proving that the settlement callback preceded store closure. The body’s 4-second bound and default 5-second test timeout remain unchanged.

Validation from main base `dfffdb8158554a1a08dcd7941b86774547d30d5b`:

- Worker suite: **11 pass, 0 fail, 58 assertions**, including unchanged renewal/fencing coverage.
- Changed worker test and its imported source typecheck: passed.
- Affected build: **1 successful, 1 total** (`@hasna/automations`).
- Full package typecheck: existing `TS2769` at `src/server/postgresql/store.integration.test.ts:359` (three expected rows versus a one-row tuple). Restoring the baseline worker test produced byte-identical diagnostics. That unrelated fixture is unchanged.
- Full repository check was attempted under confinement; names, dependency direction and staged secret checking passed, then manifest checking refused 14 versioned validator invocations with no verdict. This is not a passing full repository check; required CI remains the merge gate.

The actual focused Bun processes ran with an owned home/temp directory inside a macOS sandbox denying network, host executables, non-owned writes and owner-home contents. Host-tool/read/signal controls passed. Package installation used a fresh stripped environment and frozen lockfile with lifecycle scripts disabled. No PostgreSQL service, provider, microphone, clipboard, permission or installed-app operation ran.

Retained diagnostic log digests:

- `before-controlled-3.log`: `ecb375575604e4fa73e98a3f0b9c35fbb703aa6115c9d0baa10573c5af766459`
- `after-controlled.log`: `dfa7ab2a4b58f27c271cdc16ed687d9056027d25857e8609a096e985a94f1994`
- `focused-worker-final.log`: `f8837714353ce99184cecac33716cca4de9e9a25518325388e59e34bba285e72`
- `cleanup-expired-body.log`: `4ca07a8d68e898405a72083cc7cb8b54e4fa04aa62c276c0c7a40b40fc7357b1`
- `typecheck.log`: `44fd6edd7bafaab2e00be0413c93216aa97f530bc9eb31ff90d1536385d60b42`
- `typecheck-baseline.log`: `44fd6edd7bafaab2e00be0413c93216aa97f530bc9eb31ff90d1536385d60b42`
- `typecheck-worker.log`: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `affected-build-3.log`: `2dfa818ccdc39dfbccdbe9fb80addc41a4010a0ae190db38053da5e998b05e0c`
- `root-check-3.log`: `a876ae8bfb0cbe5164dbf1269f87ea8cf5b2ef16a9356073bd2d5f62940a93f8`
