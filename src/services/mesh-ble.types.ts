import type {
  ConnectedDevice,
  DiscoveredDevice,
  FirmwarePacket,
} from "@/types/mesh";

export type PacketHandler = (packet: FirmwarePacket) => void;
export type DisconnectHandler = (reason?: string) => void;

export interface MeshBleAdapter {
  requestPermissions(): Promise<boolean>;
  startScan(
    onDevice: (device: DiscoveredDevice) => void,
    onError: (message: string) => void,
  ): Promise<void>;
  stopScan(): Promise<void>;
  connect(
    deviceId: string,
    onPacket: PacketHandler,
    onDisconnect: DisconnectHandler,
  ): Promise<ConnectedDevice>;
  disconnect(): Promise<void>;
  writeJson(payload: object): Promise<void>;
}

