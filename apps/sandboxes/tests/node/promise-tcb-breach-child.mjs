import { runInNewContext } from "node:vm"
import { withE2bGuestBrokerSdkSession } from "../../dist/adapters/managed/index.js"

async function observeContractBreach(rawSetup) {
  const unhandled = []
  const onUnhandled = (reason, promise) => {
    if (promise === rawSetup) unhandled.push(reason)
  }
  process.on("unhandledRejection", onUnhandled)
  try {
    let errorCode
    try {
      await withE2bGuestBrokerSdkSession({ run: () => rawSetup }, async () => {})
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
