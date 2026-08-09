import { Platform, PermissionsAndroid } from "react-native";
import {
  BleManager,
  Device,
  State,
  type Subscription,
} from "react-native-ble-plx";

import {
  BLE_CHUNK_BYTES,
  BLE_RX_UUID,
  BLE_SERVICE_UUID,
  BLE_TX_UUID,
} from "@/constants/mesh";
import type {
  ConnectedDevice,
  DiscoveredDevice,
  FirmwarePacket,
} from "@/types/mesh";
import type {
  DisconnectHandler,
  MeshBleAdapter,
  PacketHandler,
} from "./mesh-ble.types";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

class NativeMeshBleService implements MeshBleAdapter {
  private manager = new BleManager();
  private device: Device | null = null;
  private monitorSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== "android") return true;

    const apiLevel = Number(Platform.Version);
    if (apiLevel >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  private async waitUntilPoweredOn(): Promise<void> {
    if ((await this.manager.state()) === State.PoweredOn) return;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.remove();
        reject(new Error("Bluetooth no está disponible o está apagado."));
      }, 8_000);
      const subscription = this.manager.onStateChange((state) => {
        if (state === State.PoweredOn) {
          clearTimeout(timeout);
          subscription.remove();
          resolve();
        }
      }, true);
    });
  }

  async startScan(
    onDevice: (device: DiscoveredDevice) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    await this.waitUntilPoweredOn();
    await this.manager.stopDeviceScan();
    await this.manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        onError(error.message);
        return;
      }

      const name = device?.name ?? device?.localName ?? "";
      if (!device || !name.startsWith("LoRaMesh-")) return;
      onDevice({ id: device.id, name, rssi: device.rssi });
    });
  }

  async stopScan(): Promise<void> {
    await this.manager.stopDeviceScan();
  }

  async connect(
    deviceId: string,
    onPacket: PacketHandler,
    onDisconnect: DisconnectHandler,
  ): Promise<ConnectedDevice> {
    await this.stopScan();
    const connected = await this.manager.connectToDevice(deviceId, {
      timeout: 12_000,
    });
    await connected.discoverAllServicesAndCharacteristics();

    if (Platform.OS === "android") {
      try {
        await connected.requestMTU(185);
      } catch {
        // Some Android devices negotiate the MTU automatically.
      }
    }

    this.device = connected;
    let notificationBuffer = "";

    this.monitorSubscription?.remove();
    this.monitorSubscription = connected.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_RX_UUID,
      (error, characteristic) => {
        if (error) {
          onDisconnect(error.message);
          return;
        }
        if (!characteristic?.value) return;

        notificationBuffer += base64ToUtf8(characteristic.value);
        let newline = notificationBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = notificationBuffer.slice(0, newline).trim();
          notificationBuffer = notificationBuffer.slice(newline + 1);
          if (line) {
            try {
              onPacket(JSON.parse(line) as FirmwarePacket);
            } catch {
              // Ignore a malformed notification and continue with later frames.
            }
          }
          newline = notificationBuffer.indexOf("\n");
        }
      },
    );

    this.disconnectSubscription?.remove();
    this.disconnectSubscription = this.manager.onDeviceDisconnected(
      connected.id,
      (error) => {
        this.device = null;
        onDisconnect(error?.message);
      },
    );

    return {
      id: connected.id,
      name: connected.name ?? connected.localName ?? "Nodo de malla LoRa",
    };
  }

  async disconnect(): Promise<void> {
    this.monitorSubscription?.remove();
    this.monitorSubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;

    if (this.device) {
      const isConnected = await this.device.isConnected();
      if (isConnected) await this.device.cancelConnection();
    }
    this.device = null;
  }

  async writeJson(payload: object): Promise<void> {
    if (!this.device) throw new Error("No hay ningún nodo LoRa conectado.");

    const commandBytes = new TextEncoder().encode(
      `${JSON.stringify(payload)}\n`,
    );
    for (
      let offset = 0;
      offset < commandBytes.length;
      offset += BLE_CHUNK_BYTES
    ) {
      const chunk = commandBytes.slice(offset, offset + BLE_CHUNK_BYTES);
      await this.device.writeCharacteristicWithResponseForService(
        BLE_SERVICE_UUID,
        BLE_TX_UUID,
        bytesToBase64(chunk),
      );
    }
  }
}

export const meshBleService: MeshBleAdapter = new NativeMeshBleService();
