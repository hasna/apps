import { describe, expect, it, mock } from "bun:test";
import {
  HostedConnectorsClient,
  type HostedApiContract,
  type HostedApprovalRequiredRun,
  type HostedApiErrorPayload,
  type HostedBillingStatus,
  type HostedConnectAccountResponse,
  type HostedConnectorSummary,
  type HostedRunPollingStatus,
  type HostedRun,
} from "./index";
import { platformConnectorsFixtures } from "./fixtures/platform-connectors";

describe("platform-connectors hosted contract fixtures", () => {
  it("keeps fixture shapes assignable to hosted SDK types", () => {
    const connectors: readonly HostedConnectorSummary[] = platformConnectorsFixtures.connectors;
    const contract: HostedApiContract = platformConnectorsFixtures.contract;
    const account: HostedConnectAccountResponse = platformConnectorsFixtures.accountCreated;
    const run: HostedRun = platformConnectorsFixtures.runQueued;
    const runStatus: HostedRunPollingStatus = platformConnectorsFixtures.runStatus;
    const approvalRequired: HostedApprovalRequiredRun = platformConnectorsFixtures.approvalRequiredRun;
    const billing: HostedBillingStatus = platformConnectorsFixtures.billingStatus;
    const error: HostedApiErrorPayload = platformConnectorsFixtures.error;

    expect(contract.basePath).toBe("/api/v1");
    expect(connectors[0].name).toBe("github");
    expect(account.account.connectorSlug).toBe("github");
    expect(run.status).toBe("queued");
    expect(runStatus.recommendedPollAfterMs).toBe(2000);
    expect(approvalRequired.approval.resourceId).toBe("github:repos");
    expect(billing.creditBalance?.availableCredits).toBe(4);
    expect(error.code).toBe("OPERATION_DENIED");
  });

  it("parses platform-style fixtures through HostedConnectorsClient methods", async () => {
    const fetchImpl = mock(async (input: string | URL | Request) => {
      const path = String(input).replace("https://connectors.example/api/v1", "");
      if (path === "/contract") return Response.json(platformConnectorsFixtures.contract);
      if (path === "/connectors") return Response.json(platformConnectorsFixtures.connectors);
      if (path === "/connectors/github") return Response.json(platformConnectorsFixtures.connectorDetail);
      if (path === "/accounts") return Response.json(platformConnectorsFixtures.accountCreated, { status: 201 });
      if (path === "/runs") return Response.json(platformConnectorsFixtures.runQueued, { status: 202 });
      if (/^\/runs\/[^/]+\/status$/.test(path)) return Response.json(platformConnectorsFixtures.runStatus);
      if (path.endsWith("/logs")) return Response.json(platformConnectorsFixtures.logs);
      if (path.endsWith("/artifacts")) return Response.json(platformConnectorsFixtures.artifacts);
      if (path === "/billing/status") return Response.json(platformConnectorsFixtures.billingStatus);
      return Response.json(platformConnectorsFixtures.error, {
        status: 403,
        headers: { "x-request-id": "req_fixture" },
      });
    });
    const hosted = new HostedConnectorsClient({
      apiUrl: "https://connectors.example",
      apiKey: "pcs_key_test",
      fetchImpl,
    });

    await expect(hosted.getContract()).resolves.toEqual(platformConnectorsFixtures.contract);
    await expect(hosted.listConnectors()).resolves.toEqual(platformConnectorsFixtures.connectors);
    await expect(hosted.getConnector("connect-github")).resolves.toEqual(platformConnectorsFixtures.connectorDetail);
    await expect(hosted.connectAccount({ connectorSlug: "github", credentials: {} })).resolves.toEqual(platformConnectorsFixtures.accountCreated);
    await expect(hosted.submitRun({ connectorSlug: "github", operationName: "repos" })).resolves.toEqual(platformConnectorsFixtures.runQueued);
    await expect(hosted.getRunStatus(platformConnectorsFixtures.runQueued.id)).resolves.toEqual(platformConnectorsFixtures.runStatus);
    await expect(hosted.listRunLogs(platformConnectorsFixtures.runQueued.id)).resolves.toEqual(platformConnectorsFixtures.logs);
    await expect(hosted.listRunArtifacts(platformConnectorsFixtures.runQueued.id)).resolves.toEqual(platformConnectorsFixtures.artifacts);
    await expect(hosted.getBillingStatus()).resolves.toEqual(platformConnectorsFixtures.billingStatus);
    await expect(hosted.getPolicy()).rejects.toMatchObject({
      status: 403,
      code: "OPERATION_DENIED",
      requestId: "req_fixture",
    });
  });
});
