import type { FirmwarePacket } from "@/types/mesh";
import type {
  DisconnectHandler,
  MeshBleAdapter,
  PacketHandler,
} from "./mesh-ble.types";

const DEMO_ID = "demo-lora-node";

class WebDemoMeshBleService implements MeshBleAdapter {
  private connected = false;
  private onPacket: PacketHandler | null = null;
  private onDisconnect: DisconnectHandler | null = null;

  async requestPermissions(): Promise<boolean> {
    return true;
  }

  async startScan(onDevice: Parameters<MeshBleAdapter["startScan"]>[0]) {
    setTimeout(
      () =>
        onDevice({
          id: DEMO_ID,
          name: "LoRaMesh-Nodo Demo",
          rssi: -58,
          isDemo: true,
        }),
      350,
    );
  }

  async stopScan() {}

  async connect(
    _deviceId: string,
    onPacket: PacketHandler,
    onDisconnect: DisconnectHandler,
  ) {
    this.connected = true;
    this.onPacket = onPacket;
    this.onDisconnect = onDisconnect;

    setTimeout(() => {
      this.emit({
        type: "info",
        nodeId: "N-DEMO00000001",
        nodeName: "Nodo Demo",
        layer: "5.1",
        radio: "SX1262-RadioLib",
      });
      this.emitDemoNodes();
      this.emit({
        type: "status",
        onlineNodes: 2,
        expectedNodes: 2,
        lastRssi: -68,
        lastSnr: 8.5,
        metrics: {
          txPackets: 12,
          rxPackets: 18,
          messagesSent: 5,
          messagesReceived: 4,
          pdrAck: 80,
          avgLatencyMs: 1240,
          forwardedMessages: 2,
        },
      });
    }, 200);

    return { id: DEMO_ID, name: "LoRaMesh-Nodo Demo", isDemo: true };
  }

  private emitDemoNodes() {
    this.emit({
      type: "nodes",
      nodes: [
        {
          index: 0,
          id: "N-CAFE00000002",
          name: "Equipo de rescate",
          online: true,
          rssi: -68,
          snr: 8.5,
          lastSeenMsAgo: 3200,
          state: "active",
        },
        {
          index: 1,
          id: "N-CAFE00000003",
          name: "Refugio Norte",
          online: true,
          rssi: -92,
          snr: 2.1,
          lastSeenMsAgo: 17500,
          state: "active",
        },
      ],
    });
  }

  async disconnect() {
    this.connected = false;
    this.onDisconnect?.();
  }

  async writeJson(payload: Record<string, unknown>) {
    if (!this.connected) throw new Error("El nodo de demostración está desconectado.");

    if (["info", "status", "nodes"].includes(String(payload.cmd))) {
      if (payload.cmd === "nodes") this.emitDemoNodes();
      return;
    }

    if (payload.cmd === "setName") {
      setTimeout(
        () =>
          this.emit({
            type: "nameUpdated",
            nodeId: "N-DEMO00000001",
            nodeName: String(payload.name),
          }),
        150,
      );
      return;
    }

    if (payload.cmd === "send" || payload.cmd === "broadcast") {
      const to =
        payload.cmd === "broadcast" ? "broadcast" : String(payload.to);
      const msgId = `DEMO-${Date.now().toString(16).toUpperCase()}`;
      setTimeout(
        () =>
          this.emit({
            type: "sent",
            ok: true,
            mode: to === "broadcast" ? "broadcast" : "auto",
            msgId,
            from: "N-DEMO00000001",
            to,
            bytes: 142,
            encrypted: Boolean(payload.payload),
          }),
        250,
      );
      if (to !== "broadcast") {
        setTimeout(
          () =>
            this.emit({
              type: "ack",
              from: to,
              to: "N-DEMO00000001",
              ackFor: msgId,
              latencyMs: 880,
              pdrAck: 100,
            }),
          1150,
        );
      }
    }
  }

  private emit(packet: FirmwarePacket) {
    this.onPacket?.(packet);
  }
}

export const meshBleService: MeshBleAdapter = new WebDemoMeshBleService();
