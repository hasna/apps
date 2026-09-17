# Updater product policy: admission foundation

The runtime remains the existing legacy updater. This first slice does not enable
another product, an ARM64-only installation, a feed, a new bootstrap, or a release.
It keeps the installed identity and protected paths unchanged. Constructing a
policy for pure metadata validation does not authorize that policy at runtime.

`UpdateProductPolicy` collects immutable identity, derived protected paths,
architecture expectations and the existing release-v4 provenance layout.
`RecordingsUpdateConstants.productPolicy` selects only `.legacy`.
`requireRuntimeSupport()` rejects every other policy, including a policy that
changes just one legacy field. There is no environment, argument, JSON or feed
selector for a runtime product policy.

## Admission sites in this slice

| Site | Binding |
| --- | --- |
| `Updater/Protocol/UpdateProtocol.swift` | Existing protected-path constants delegate to the immutable legacy policy. |
| `Updater/Protocol/ReleaseEnvelope.swift` | Runtime support and envelope architectures use that policy; the signed wire format is unchanged. |
| `Updater/Broker/BrokerMain.swift` | Runtime support is required before root trust reads, recovery or XPC registration. |
| `Updater/Protocol/CandidateMetadataPolicy.swift` | Pure metadata admission binds the expectation's identity and architectures to a supplied validated policy, then retains all candidate/provenance equality checks. |
| `Updater/Broker/CodeValidation.swift` | Runtime support is required before protected-component/candidate I/O; bundle-relative metadata paths and expected provenance layout come from the same policy. |

The pure validator can exercise fictional isolated ARM64 policies. Runtime code
cannot use them while remaining installation and recovery guards are legacy-only.
Legacy release-v4 provenance still requires the exact existing field set and the
measured companion digest; no second provenance layout is accepted.

## Remaining integration boundaries

These sites must be threaded and tested together before enabling another policy:

| Site | Remaining fixed contract |
| --- | --- |
| `Broker/PeerIdentity.swift` | Root trust policy, client signing admission and policy serialization. |
| `Broker/BrokerMain.swift` | Candidate bundle name, bootstrap executable inventory and lifecycle. |
| `Broker/{ApplicationNamespace,AtomicActivation,InstallJournal,InstallRecovery,MonotonicState}.swift` | Durable path/journal bindings, launch barrier, rollback and exact cohort recovery. They currently receive unchanged legacy constants. |
| `Broker/VerifierRunner.swift`, `VerifierLauncher/*` | No-login verifier account, executable, sandbox, descriptor and privilege boundary. |
| `BootstrapPreflight/*`, `Client/*`, `Signer/*` | Bootstrap/client admission and envelope validation must agree on the selected runtime policy. |
| `scripts/macos_artifact.ts` | Canonical ZIP root, bundle/code layout, provenance, architecture and install destinations. |
| `packaging/macos/{build_release_pkg.sh,managed_bootstrap.sh,release_lifecycle.ts,scripts/*}` | Protected root cohort, Installer certificate, launchd paths, bootstrap markers and compatible-cohort schema. |
| `src/native/Recordings/build.sh` and packaging resources | Product-specific signed helper construction and immutable release publication. |

A later consumer must use a published package containing the complete integration,
not patch or copy updater source into its own repository. Preserve the current
legacy policy as a second consumer in cross-policy tests.

The existing updater supports app-only updates within one immutable root/key
cohort. It does not maintain root helpers or rotate keys. Its transactional
rollback/recovery is not post-launch health rollback. Feed discovery, coordinated
app shutdown, product channel selection and initial distribution remain separate
work. This document is the call-site inventory for that follow-up, not a claim
that any of it is implemented.
