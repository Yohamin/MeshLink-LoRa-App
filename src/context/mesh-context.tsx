import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  BROADCAST_ID,
  DEMO_NETWORK_KEY,
  ENCRYPTED_TEXT_LIMIT,
  PLAIN_TEXT_LIMIT,
} from "@/constants/mesh";
import { decryptMessage, encryptMessage } from "@/lib/crypto";
import {
  clearStoredMessages,
  loadMessages,
  loadNetworkKey,
  loadSettings,
  saveMessages,
  saveNetworkKey as persistNetworkKey,
  saveSettings,
} from "@/lib/storage";
import { utf8Length } from "@/lib/text";
import { meshBleService } from "@/services/mesh-ble";
import type {
  ConnectedDevice,
  ConnectionState,
  ConversationSummary,
  DiscoveredDevice,
  FirmwarePacket,
  MeshMessage,
  MeshNode,
  MeshStatus,
  NodeInfo,
} from "@/types/mesh";

type SendOptions = {
  sos?: boolean;
};

type MeshContextValue = {
  ready: boolean;
  connectionState: ConnectionState;
  connectedDevice: ConnectedDevice | null;
  discoveredDevices: DiscoveredDevice[];
  nodeInfo: NodeInfo | null;
  nodes: MeshNode[];
  status: MeshStatus | null;
  messages: MeshMessage[];
  conversations: ConversationSummary[];
  networkKey: string;
  encryptionEnabled: boolean;
  lastError: string | null;
  maxMessageBytes: number;
  scan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshNetwork: () => Promise<void>;
  sendMessage: (
    conversationId: string,
    text: string,
    options?: SendOptions,
  ) => Promise<void>;
  sendLocationSos: (conversationId: string) => Promise<void>;
  setNodeName: (name: string) => Promise<void>;
  updateNetworkKey: (key: string) => Promise<void>;
  setEncryptionEnabled: (enabled: boolean) => Promise<void>;
  clearHistory: () => Promise<void>;
};

const MeshContext = createContext<MeshContextValue | null>(null);

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeNode(value: unknown): MeshNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  const id = asString(node.id);
  if (!id) return null;
  const state = ["active", "recent", "offline"].includes(asString(node.state))
    ? (asString(node.state) as MeshNode["state"])
    : node.online
      ? "active"
      : "offline";
  return {
    index: asNumber(node.index),
    id,
    name: asString(node.name, id),
    online: Boolean(node.online),
    rssi: asNumber(node.rssi),
    snr: asNumber(node.snr),
    lastSeenMsAgo: asNumber(node.lastSeenMsAgo),
    state,
  };
}

export function MeshProvider({ children }: React.PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [connectedDevice, setConnectedDevice] =
    useState<ConnectedDevice | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<
    DiscoveredDevice[]
  >([]);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [networkKey, setNetworkKey] = useState(DEMO_NETWORK_KEY);
  const [encryptionEnabled, setEncryptionEnabledState] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  const messagesRef = useRef<MeshMessage[]>([]);
  const networkKeyRef = useRef(DEMO_NETWORK_KEY);
  const outgoingQueue = useRef<string[]>([]);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaceMessages = useCallback(
    (updater: (current: MeshMessage[]) => MeshMessage[]) => {
      setMessages((current) => {
        const next = updater(current);
        messagesRef.current = next;
        void saveMessages(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const [storedMessages, storedKey, settings] = await Promise.all([
        loadMessages(),
        loadNetworkKey(),
        loadSettings(),
      ]);
      messagesRef.current = storedMessages;
      setMessages(storedMessages);
      const key = storedKey || DEMO_NETWORK_KEY;
      networkKeyRef.current = key;
      setNetworkKey(key);
      if (!storedKey) await persistNetworkKey(key);
      setEncryptionEnabledState(settings.encryptionEnabled);
      setReady(true);
    })().catch((error) => {
      setLastError(error instanceof Error ? error.message : String(error));
      setReady(true);
    });

    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
      void meshBleService.stopScan();
    };
  }, []);

  const handlePacket = useCallback(
    async (packet: FirmwarePacket) => {
      if (packet.type === "info" || packet.type === "ready") {
        setNodeInfo((current) => ({
          nodeId: asString(packet.nodeId, current?.nodeId ?? ""),
          nodeName: asString(packet.nodeName, current?.nodeName ?? "Nodo LoRa"),
          layer: asString(packet.layer, current?.layer),
          radio: asString(packet.radio, current?.radio),
        }));
        return;
      }

      if (packet.type === "nameUpdated") {
        setNodeInfo((current) =>
          current
            ? { ...current, nodeName: asString(packet.nodeName, current.nodeName) }
            : {
                nodeId: asString(packet.nodeId),
                nodeName: asString(packet.nodeName, "Nodo LoRa"),
              },
        );
        return;
      }

      if (packet.type === "nodes") {
        const rawNodes = Array.isArray(packet.nodes) ? packet.nodes : [];
        setNodes(
          rawNodes
            .map(normalizeNode)
            .filter((node): node is MeshNode => node !== null),
        );
        return;
      }

      if (packet.type === "status") {
        const rawMetrics =
          packet.metrics && typeof packet.metrics === "object"
            ? (packet.metrics as Record<string, unknown>)
            : {};
        const metrics = Object.fromEntries(
          Object.entries(rawMetrics)
            .filter(([, value]) => typeof value === "number")
            .map(([key, value]) => [key, value as number]),
        );
        setStatus({
          onlineNodes: asNumber(packet.onlineNodes),
          expectedNodes: asNumber(packet.expectedNodes),
          lastRssi: asNumber(packet.lastRssi),
          lastSnr: asNumber(packet.lastSnr),
          metrics,
          lastMessage: asString(packet.lastMessage),
        });
        return;
      }

      if (packet.type === "sent") {
        const queuedId = outgoingQueue.current.shift();
        if (!queuedId) return;
        replaceMessages((current) =>
          current.map((message) =>
            message.id === queuedId
              ? {
                  ...message,
                  firmwareId: asString(packet.msgId),
                  status: packet.ok === true ? "sent" : "failed",
                  route: asString(packet.mode),
                }
              : message,
          ),
        );
        return;
      }

      if (packet.type === "ack") {
        const ackFor = asString(packet.ackFor);
        replaceMessages((current) =>
          current.map((message) =>
            message.firmwareId === ackFor
              ? { ...message, status: "delivered" }
              : message,
          ),
        );
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        return;
      }

      if (packet.type === "ackTimeout") {
        const msgId = asString(packet.msgId);
        replaceMessages((current) =>
          current.map((message) =>
            message.firmwareId === msgId
              ? { ...message, status: "unconfirmed" }
              : message,
          ),
        );
        return;
      }

      if (packet.type === "error" || packet.type === "txError") {
        setLastError(asString(packet.message, "El nodo LoRa informó un error."));
        const queuedId = outgoingQueue.current.shift();
        if (queuedId) {
          replaceMessages((current) =>
            current.map((message) =>
              message.id === queuedId
                ? { ...message, status: "failed" }
                : message,
            ),
          );
        }
        return;
      }

      if (packet.type !== "message") return;

      const from = asString(packet.from, "desconocido");
      const isBroadcast = packet.broadcast === true;
      const encrypted = packet.encrypted === true;
      let text = asString(packet.text);

      if (encrypted) {
        const nested =
          packet.payload && typeof packet.payload === "object"
            ? (packet.payload as Record<string, unknown>)
            : {};
        const cipherText = asString(nested.data);
        try {
          text = await decryptMessage(cipherText, networkKeyRef.current);
        } catch {
          text = "[No se pudo descifrar; comprueba la clave de red]";
        }
      }

      const incoming: MeshMessage = {
        id: asString(packet.msgId, Crypto.randomUUID()),
        firmwareId: asString(packet.msgId) || undefined,
        conversationId: isBroadcast ? BROADCAST_ID : from,
        direction: "incoming",
        senderId: from,
        senderName: asString(packet.fromName, from),
        recipientId: asString(packet.to),
        text,
        createdAt: Date.now(),
        status: "delivered",
        sos: packet.sos === true,
        encrypted,
        broadcast: isBroadcast,
        route: asString(packet.route) || undefined,
        rssi: asNumber(packet.rssi),
        snr: asNumber(packet.snr),
      };

      if (
        messagesRef.current.some(
          (message) => message.firmwareId === incoming.firmwareId,
        )
      ) {
        return;
      }
      replaceMessages((current) => [...current, incoming]);
      await Haptics.notificationAsync(
        incoming.sos
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      );
    },
    [replaceMessages],
  );

  const scan = useCallback(async () => {
    setLastError(null);
    const granted = await meshBleService.requestPermissions();
    if (!granted) throw new Error("No se concedió el permiso de Bluetooth.");
    setDiscoveredDevices([]);
    setConnectionState("scanning");
    await meshBleService.startScan(
      (device) =>
        setDiscoveredDevices((current) =>
          current.some((saved) => saved.id === device.id)
            ? current.map((saved) =>
                saved.id === device.id ? device : saved,
              )
            : [...current, device],
        ),
      (message) => {
        setLastError(message);
        setConnectionState("disconnected");
      },
    );
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      void meshBleService.stopScan();
      setConnectionState((current) =>
        current === "scanning" ? "disconnected" : current,
      );
    }, 10_000);
  }, []);

  const stopScan = useCallback(async () => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
    await meshBleService.stopScan();
    setConnectionState((current) =>
      current === "scanning" ? "disconnected" : current,
    );
  }, []);

  const connect = useCallback(
    async (deviceId: string) => {
      setLastError(null);
      setConnectionState("connecting");
      try {
        const device = await meshBleService.connect(
          deviceId,
          (packet) => void handlePacket(packet),
          (reason) => {
            setConnectedDevice(null);
            setConnectionState("disconnected");
            if (reason) setLastError(reason);
          },
        );
        setConnectedDevice(device);
        setConnectionState("connected");
        // Keep GATT writes sequential; concurrent characteristic writes are
        // rejected by some Android BLE stacks.
        await meshBleService.writeJson({ cmd: "info" });
        await meshBleService.writeJson({ cmd: "nodes" });
        await meshBleService.writeJson({ cmd: "status" });
      } catch (error) {
        setConnectionState("disconnected");
        const message = error instanceof Error ? error.message : String(error);
        setLastError(message);
        throw error;
      }
    },
    [handlePacket],
  );

  const disconnect = useCallback(async () => {
    await meshBleService.disconnect();
    setConnectedDevice(null);
    setConnectionState("disconnected");
  }, []);

  const refreshNetwork = useCallback(async () => {
    if (connectionState !== "connected") return;
    await meshBleService.writeJson({ cmd: "nodes" });
    await meshBleService.writeJson({ cmd: "status" });
  }, [connectionState]);

  const sendMessage = useCallback(
    async (
      conversationId: string,
      rawText: string,
      options: SendOptions = {},
    ) => {
      if (connectionState !== "connected") {
        throw new Error("Conecta tu nodo LoRa antes de enviar.");
      }

      const text = rawText.trim();
      if (!text) throw new Error("Escribe un mensaje primero.");
      const limit = encryptionEnabled
        ? ENCRYPTED_TEXT_LIMIT
        : PLAIN_TEXT_LIMIT;
      if (utf8Length(text) > limit) {
        throw new Error(`Este mensaje supera el límite de ${limit} bytes de la radio.`);
      }

      const recipient =
        conversationId === BROADCAST_ID
          ? null
          : nodes.find((node) => node.id === conversationId);
      const localId = Crypto.randomUUID();
      const outgoing: MeshMessage = {
        id: localId,
        conversationId,
        direction: "outgoing",
        senderId: nodeInfo?.nodeId ?? "me",
        senderName: "Tú",
        recipientId: conversationId,
        text,
        createdAt: Date.now(),
        status: "queued",
        sos: options.sos === true,
        encrypted: encryptionEnabled,
        broadcast: conversationId === BROADCAST_ID,
      };

      replaceMessages((current) => [...current, outgoing]);
      outgoingQueue.current.push(localId);

      try {
        const data = encryptionEnabled
          ? await encryptMessage(text, networkKeyRef.current)
          : text;
        const content = encryptionEnabled
          ? { payload: { encrypted: true, data } }
          : { text: data };
        const command =
          conversationId === BROADCAST_ID
            ? { cmd: "broadcast", ...content, sos: options.sos === true }
            : {
                cmd: "send",
                to: recipient?.id ?? conversationId,
                ...content,
                sos: options.sos === true,
              };
        await meshBleService.writeJson(command);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (error) {
        outgoingQueue.current = outgoingQueue.current.filter(
          (id) => id !== localId,
        );
        replaceMessages((current) =>
          current.map((message) =>
            message.id === localId
              ? { ...message, status: "failed" }
              : message,
          ),
        );
        throw error;
      }
    },
    [
      connectionState,
      encryptionEnabled,
      nodeInfo?.nodeId,
      nodes,
      replaceMessages,
    ],
  );

  const sendLocationSos = useCallback(
    async (conversationId: string) => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error("No se concedió el permiso de ubicación.");
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const text = `SOS ${location.coords.latitude.toFixed(5)},${location.coords.longitude.toFixed(5)}`;
      await sendMessage(conversationId, text, { sos: true });
    },
    [sendMessage],
  );

  const setNodeName = useCallback(async (name: string) => {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("El nombre del nodo no puede estar vacío.");
    if (utf8Length(cleanName) > 32) {
      throw new Error("El nombre del nodo no puede superar 32 bytes UTF-8.");
    }
    await meshBleService.writeJson({ cmd: "setName", name: cleanName });
  }, []);

  const updateNetworkKey = useCallback(async (key: string) => {
    const cleanKey = key.trim();
    if (cleanKey.length < 12) {
      throw new Error("Usa una clave de red de al menos 12 caracteres.");
    }
    await persistNetworkKey(cleanKey);
    networkKeyRef.current = cleanKey;
    setNetworkKey(cleanKey);
  }, []);

  const setEncryptionEnabled = useCallback(async (enabled: boolean) => {
    setEncryptionEnabledState(enabled);
    await saveSettings({ encryptionEnabled: enabled });
  }, []);

  const clearHistory = useCallback(async () => {
    messagesRef.current = [];
    setMessages([]);
    await clearStoredMessages();
  }, []);

  const conversations = useMemo<ConversationSummary[]>(() => {
    const latestFor = (conversationId: string) =>
      [...messages]
        .reverse()
        .find((message) => message.conversationId === conversationId);
    const summaries: ConversationSummary[] = [
      {
        id: BROADCAST_ID,
        name: "Difusión de emergencia",
        state: "broadcast",
        latest: latestFor(BROADCAST_ID),
      },
      ...nodes.map((node) => ({
        id: node.id,
        name: node.name,
        state: node.state,
        latest: latestFor(node.id),
        rssi: node.rssi,
        snr: node.snr,
      })),
    ];

    for (const message of messages) {
      if (summaries.some((item) => item.id === message.conversationId)) continue;
      summaries.push({
        id: message.conversationId,
        name: message.senderName || message.conversationId,
        state: "offline",
        latest: latestFor(message.conversationId),
      });
    }
    return summaries.sort(
      (a, b) =>
        (b.latest?.createdAt ?? (b.id === BROADCAST_ID ? 1 : 0)) -
        (a.latest?.createdAt ?? (a.id === BROADCAST_ID ? 1 : 0)),
    );
  }, [messages, nodes]);

  const value = useMemo<MeshContextValue>(
    () => ({
      ready,
      connectionState,
      connectedDevice,
      discoveredDevices,
      nodeInfo,
      nodes,
      status,
      messages,
      conversations,
      networkKey,
      encryptionEnabled,
      lastError,
      maxMessageBytes: encryptionEnabled
        ? ENCRYPTED_TEXT_LIMIT
        : PLAIN_TEXT_LIMIT,
      scan,
      stopScan,
      connect,
      disconnect,
      refreshNetwork,
      sendMessage,
      sendLocationSos,
      setNodeName,
      updateNetworkKey,
      setEncryptionEnabled,
      clearHistory,
    }),
    [
      ready,
      connectionState,
      connectedDevice,
      discoveredDevices,
      nodeInfo,
      nodes,
      status,
      messages,
      conversations,
      networkKey,
      encryptionEnabled,
      lastError,
      scan,
      stopScan,
      connect,
      disconnect,
      refreshNetwork,
      sendMessage,
      sendLocationSos,
      setNodeName,
      updateNetworkKey,
      setEncryptionEnabled,
      clearHistory,
    ],
  );

  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>;
}

export function useMesh(): MeshContextValue {
  const context = useContext(MeshContext);
  if (!context) throw new Error("useMesh debe usarse dentro de MeshProvider.");
  return context;
}
