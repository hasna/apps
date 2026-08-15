import { runInNewContext } from "node:vm"
import {
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  withAuthenticatedE2bGuestBrokerDuplexSdkSession,
} from "../../dist/index.js"

const limits = {
  request_timeout_ms: 1_000,
  session_timeout_ms: 5_000,
  receive_timeout_ms: 1_000,
  max_request_frame_bytes: 1024 * 1024,
  max_response_frame_bytes: 1024 * 1024,
  max_response_frames: 4,
  max_response_bytes: 1024 * 1024,
}
const attestation = {
  path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  byte_length: E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  mode: 0o500,
  owner: "root",
  group: "root",
}
const sessionBinding = `sha256:${"11".repeat(32)}`
const macKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)

async function observeContractBreach(rawSetup) {
  const unhandled = []
  const onUnhandled = (reason, promise) => {
    if (promise === rawSetup) unhandled.push(reason)
  }
  process.on("unhandledRejection", onUnhandled)
  try {
    let errorCode
    try {
      await withAuthenticatedE2bGuestBrokerDuplexSdkSession(
        { run: () => rawSetup },
        { async destroyAndProveAbsent() {} },
        attestation,
        limits,
        sessionBinding,
        macKey,
        async () => {},
      )
    } catch (reason) {
      errorCode = reason?.code
    }
    await new Promise((resolve) => setImmediate(resolve))
    return { errorCode, unhandledRejections: unhandled.length }
  } finally {
    process.off("unhandledRejection", onUnhandled)
  }
}

const ownConstructorFailure = new Error("TCB own-constructor Promise rejection")
const ownConstructorPromise = Promise.reject(ownConstructorFailure)
let constructorGetterCalls = 0
Object.defineProperty(ownConstructorPromise, "constructor", {
  configurable: false,
  get() {
    constructorGetterCalls += 1
    return Promise
  },
})
const ownConstructor = await observeContractBreach(ownConstructorPromise)

const crossRealmPromise = runInNewContext("Promise.reject(reason)", {
  reason: new Error("TCB cross-realm Promise rejection"),
})
const crossRealm = await observeContractBreach(crossRealmPromise)

process.stdout.write(JSON.stringify({
  cross_realm: {
    error_code: crossRealm.errorCode,
    unhandled_rejections: crossRealm.unhandledRejections,
  },
  own_constructor_getter: {
    error_code: ownConstructor.errorCode,
    getter_calls: constructorGetterCalls,
    unhandled_rejections: ownConstructor.unhandledRejections,
  },
}))
