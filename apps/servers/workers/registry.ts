import {
  bindingName, ControlError, CONTROL_PATH, errorResponse, hostname, identifier, json,
  LEASE_DURATION_MS, previewKey, readControl, record, secretMatches,
  type PreviewRecord, type RegistryStorage, type StationRecord,
} from "./shared";

/** Durable Object with SQLite-backed storage; all ownership changes are transactions. */
export class PreviewRegistry {
  constructor(
    private readonly state: { storage: RegistryStorage },
    private readonly env: { CONTROL_TOKEN: string },
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname !== CONTROL_PATH ||
          typeof this.env.CONTROL_TOKEN !== "string" || this.env.CONTROL_TOKEN.length < 32 ||
          !await secretMatches(request.headers.get("authorization"), `Bearer ${this.env.CONTROL_TOKEN}`)) {
        throw new ControlError(403, "FORBIDDEN", "Forbidden");
      }
      return json(await this.execute(await readControl(request)));
    } catch (error) { return errorResponse(error); }
  }

  async execute(input: Record<string, unknown>): Promise<unknown> {
    return this.state.storage.transaction(async (storage) => {
      switch (input.action) {
        case "acquire-setup": {
          const operationId = identifier(input.operationId, "operation id");
          const current = await storage.get<{ operationId: string; expiresAt: number }>("setup-lock");
          if (current && current.expiresAt > this.now() && current.operationId !== operationId) {
            throw new ControlError(409, "SETUP_LOCKED", "Another workstation is updating preview infrastructure");
          }
          const next = { operationId, expiresAt: this.now() + 120_000 };
          await storage.put("setup-lock", next);
          return next;
        }
        case "release-setup": {
          const operationId = identifier(input.operationId, "operation id");
          const current = await storage.get<{ operationId: string; expiresAt: number }>("setup-lock");
          if (!current || current.operationId !== operationId || current.expiresAt <= this.now()) {
            throw new ControlError(409, "STALE_SETUP_LOCK", "Infrastructure ownership has changed or expired");
          }
          await storage.put("setup-lock", { operationId, expiresAt: 0 });
          return { released: true };
        }
        case "register-station": {
          const value = record(input.station, "station");
          const station: StationRecord = { id: identifier(value.id, "station id"), binding: bindingName(value.binding) };
          const current = await storage.get<StationRecord>(`station:${station.id}`);
          if (current && current.binding !== station.binding) {
            throw new ControlError(409, "IMMUTABLE_IDENTITY", "Station binding cannot change");
          }
          await storage.put(`station:${station.id}`, station);
          return station;
        }
        case "register-preview": {
          const value = record(input.preview, "preview");
          const key = previewKey(value.key);
          const host = hostname(value.hostname);
          const current = await storage.get<PreviewRecord>(`preview:${key}`);
          if (current) {
            if (current.hostname !== host) throw new ControlError(409, "IMMUTABLE_IDENTITY", "Preview hostname cannot change");
            return current;
          }
          const hostnameOwner = await storage.get<string>(`hostname:${host}`);
          if (hostnameOwner && hostnameOwner !== key) {
            throw new ControlError(409, "HOSTNAME_IN_USE", "Hostname belongs to another preview");
          }
          const preview: PreviewRecord = { key, hostname: host, fence: 0, expiresAt: 0 };
          await storage.put(`preview:${key}`, preview);
          await storage.put(`hostname:${host}`, key);
          return preview;
        }
        case "list": {
          const product = input.product === undefined ? undefined : identifier(input.product, "product");
          const previews = await storage.list<PreviewRecord>({ prefix: product ? `preview:${product}/` : "preview:" });
          return [...previews.values()];
        }
        case "station-status": {
          return this.station(storage, input.stationId);
        }
        case "status": {
          return this.preview(storage, input.key);
        }
        case "claim": {
          const preview = await this.preview(storage, input.key);
          const station = await this.station(storage, input.stationId);
          const instanceId = identifier(input.instanceId, "instance id");
          if (input.takeover !== undefined && typeof input.takeover !== "boolean") {
            throw new ControlError(400, "INVALID_INPUT", "takeover must be a boolean");
          }
          const now = this.now();
          const active = preview.expiresAt > now && !!preview.stationId;
          const sameOwner = preview.stationId === station.id && preview.instanceId === instanceId;
          if (active && !sameOwner && input.takeover !== true) {
            throw new ControlError(409, "ALREADY_CLAIMED", "Preview is active on another instance; use takeover");
          }
          const next: PreviewRecord = {
            ...preview, stationId: station.id, instanceId,
            fence: active && sameOwner ? preview.fence : preview.fence + 1,
            expiresAt: now + LEASE_DURATION_MS,
          };
          await storage.put(`preview:${preview.key}`, next);
          return next;
        }
        case "heartbeat":
        case "release": {
          const preview = await this.preview(storage, input.key);
          const stationId = identifier(input.stationId, "station id");
          const instanceId = identifier(input.instanceId, "instance id");
          if (!Number.isSafeInteger(input.fence) || Number(input.fence) < 1) {
            throw new ControlError(400, "INVALID_INPUT", "fence must be a positive integer");
          }
          if (preview.stationId !== stationId || preview.instanceId !== instanceId || preview.fence !== input.fence ||
              preview.expiresAt <= this.now()) {
            throw new ControlError(409, "STALE_LEASE", "Preview ownership has changed or expired");
          }
          const next: PreviewRecord = input.action === "release"
            ? { key: preview.key, hostname: preview.hostname, fence: preview.fence + 1, expiresAt: 0 }
            : { ...preview, expiresAt: this.now() + LEASE_DURATION_MS };
          await storage.put(`preview:${preview.key}`, next);
          return next;
        }
        default:
          throw new ControlError(400, "UNKNOWN_ACTION", "Unknown control action");
      }
    });
  }

  private async station(storage: RegistryStorage, value: unknown): Promise<StationRecord> {
    const station = await storage.get<StationRecord>(`station:${identifier(value, "station id")}`);
    if (!station) throw new ControlError(404, "UNKNOWN_STATION", "Station is not registered");
    return station;
  }

  private async preview(storage: RegistryStorage, value: unknown): Promise<PreviewRecord> {
    const preview = await storage.get<PreviewRecord>(`preview:${previewKey(value)}`);
    if (!preview) throw new ControlError(404, "UNKNOWN_PREVIEW", "Preview is not registered");
    return preview;
  }
}
