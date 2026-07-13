// Type-level smoke for the published SDK surface of @hasnaxyz/sandboxes.
import SandboxesClientDefault, {
  SandboxesClient,
  SandboxesApiError,
  type Allocation,
  type AllocationState,
  type AdapterId,
  type Checkpoint,
  type WhoAmI,
  type SandboxesClientOptions,
} from "@hasnaxyz/sandboxes"

const options: SandboxesClientOptions = { apiUrl: "https://sandboxes.hasna.xyz/v1", apiKey: "k" }
const client: SandboxesClient = new SandboxesClientDefault(options)
void client

const state: AllocationState = "active"
const adapter: AdapterId = "e2b"
void state
void adapter

async function usage(): Promise<void> {
  const { allocation }: { allocation: Allocation } = await client.allocate({
    adapter: "fake",
    spec: {} as never,
  })
  void allocation.tenant_id
  const list: { checkpoints: Checkpoint[]; count: number } = await client.listCheckpoints("sbx_x")
  void list.count
  const who: WhoAmI = await client.whoami()
  void who.tenant_id
  try {
    await client.getSandbox("sbx_missing")
  } catch (error) {
    if (error instanceof SandboxesApiError) void error.code
  }
}
void usage
