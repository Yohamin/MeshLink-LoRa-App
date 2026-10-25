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
import {
  decryptMessage,
  encryptMessage,
  type CryptoOperationMetrics,
} from "@/lib/crypto";
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
import { gpsSosText, normalizeGps, type NodeGps } from "@/lib/gps";
import { normalizeHealth, type NodeHealth } from "@/lib/health";
import { assertHealthTransport, decodeHealthShare } from "@/lib/health-share";
import { useFieldTests } from "@/hooks/use-field-tests";
import type { MetricArchive, MetricSession } from "@/lib/telemetry";
import type { TrialView } from "@/lib/trial-coordinator";
import type { TestProgress } from "@/lib/test-runner";
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
  sensitive?: boolean;
  sendSignal?: AbortSignal;
  notAfter?: number;
  sos?: boolean;
  requestId?: string;
  testSignal?: AbortSignal;
};

type MeshContextValue = {
  ready: boolean;
  connectionState: ConnectionState;
  connectedDevice: ConnectedDevice | null;
  discoveredDevices: DiscoveredDevice[];
  nodeInfo: NodeInfo | null;
  nodes: MeshNode[];
  status: MeshStatus | null;
  gps: NodeGps | null;
  setNodeGpsEnabled: (enabled: boolean) => Promise<void>;
  health: NodeHealth | null;
  subscribeHealth: (listener: (health: NodeHealth) => void) => () => void;
  setNodeHealthEnabled: (enabled: boolean) => Promise<void>;
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
  metricSessions: MetricSession[];
  metricSessionId: string | null;
  metricError: string | null;
  metricsReady: boolean;
  testProgress: TestProgress | null;
  startTest: (destination: string, scenario: string, intervalMs: number) => Promise<TestProgress | undefined>;
  cancelTest: () => void;
  metricArchive: (id: string) => Promise<MetricArchive>;
  trialState: TrialView;
  setTrialMode: (enabled: boolean) => void;
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
  const [gps, setGps] = useState<NodeGps | null>(null);
  const [health, setHealth] = useState<NodeHealth | null>(null);
  const healthListeners = useRef(new Set<(health: NodeHealth) => void>());
  const subscribeHealth = useCallback((listener: (health: NodeHealth) => void) => {
    healthListeners.current.add(listener);
    return () => { healthListeners.current.delete(listener); };
  }, []);
  const healthRequests = useRef(new Map<string, {
    nodeId: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>());
  const gpsRequests = useRef(new Map<string, {
    nodeId: string;
    resolve: (gps: NodeGps) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>());

  const clearGps = useCallback(() => {
    setGps(null);
    setHealth(null);
    for (const pending of healthRequests.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Se desconectó el nodo mientras configurábamos el sensor."));
    }
    healthRequests.current.clear();
    for (const pending of gpsRequests.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Se desconectó el nodo mientras consultábamos el GPS."));
    }
    gpsRequests.current.clear();
  }, []);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [networkKey, setNetworkKey] = useState(DEMO_NETWORK_KEY);
  const [encryptionEnabled, setEncryptionEnabledState] = useState(true);
  const encryptionEnabledRef = useRef(true);
  encryptionEnabledRef.current = encryptionEnabled;
  const [lastError, setLastError] = useState<string | null>(null);

  const messagesRef = useRef<MeshMessage[]>([]);
  const networkKeyRef = useRef(DEMO_NETWORK_KEY);
  const outgoingQueue = useRef<string[]>([]);
  const incomingMessages = useRef<Promise<void>>(Promise.resolve());
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transmitRef = useRef<(to: string, text: string, requestId: string, signal: AbortSignal) => Promise<void>>(async () => {
    throw new Error("El envío aún no está listo.");
  });
  const transmitTest = useCallback((to: string, text: string, requestId: string, signal: AbortSignal) =>
    transmitRef.current(to, text, requestId, signal), []);
  const fieldTests = useFieldTests(transmitTest);
  const fieldTestsRef = useRef(fieldTests);
  fieldTestsRef.current = fieldTests;
  fieldTests.updateLink({ connected: connectionState === "connected", demo: connectedDevice?.isDemo === true,
    encrypted: encryptionEnabled,
    correlation: nodeInfo?.requestCorrelation === true, nodeId: nodeInfo?.nodeId ?? "",
    idle: !messages.some(m => m.direction === "outgoing" && ["queued", "sent"].includes(m.status) && !m.broadcast) });

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
      const restored = storedMessages.map(m => m.direction === "outgoing" && ["queued", "sent"].includes(m.status)
        ? { ...m, status: "unconfirmed" as const } : m);
      messagesRef.current = restored;
      setMessages(restored);
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
      for (const pending of gpsRequests.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Se cerró la sesión GPS."));
      }
      gpsRequests.current.clear();
      for (const pending of healthRequests.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Se cerró la sesión del sensor."));
      }
      healthRequests.current.clear();
      void meshBleService.stopScan();
    };
  }, []);

  const handlePacket = useCallback(
    async (packet: FirmwarePacket) => {
      fieldTestsRef.current.receive(packet);
      if (packet.type === "info" || packet.type === "ready") {
        setNodeInfo((current) => ({
          nodeId: asString(packet.nodeId, current?.nodeId ?? ""),
          nodeName: asString(packet.nodeName, current?.nodeName ?? "Nodo LoRa"),
          layer: asString(packet.layer, current?.layer),
          radio: asString(packet.radio, current?.radio),
          board: asString(packet.board, current?.board),
          firmwareVersion: asString(packet.firmwareVersion, current?.firmwareVersion),
          gpsSupported: typeof packet.gpsSupported === "boolean" ? packet.gpsSupported : current?.gpsSupported,
          healthSupported: typeof packet.healthSupported === "boolean" ? packet.healthSupported : current?.healthSupported,
          bootId: asString(packet.bootId, current?.bootId),
          requestCorrelation: packet.requestCorrelation === true || current?.requestCorrelation === true,
          snapshotCorrelation: packet.snapshotCorrelation === true || current?.snapshotCorrelation === true,
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

      if (packet.type === "gps") {
        const next = normalizeGps(packet);
        setGps(next);
        const id = asString(packet.requestId);
        const pending = gpsRequests.current.get(id);
        if (pending && pending.nodeId === asString(packet.nodeId)) {
          clearTimeout(pending.timer);
          gpsRequests.current.delete(id);
          pending.resolve(next);
        }
        return;
      }

      if (packet.type === "health") {
        const next = normalizeHealth(packet);
        setHealth(next);
        for (const listener of healthListeners.current) listener(next);
        const id = asString(packet.requestId);
        const pending = healthRequests.current.get(id);
        if (pending && pending.nodeId === asString(packet.nodeId)) {
          clearTimeout(pending.timer);
          healthRequests.current.delete(id);
          pending.resolve();
        }
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
        const requestId = asString(packet.requestId);
        const queuedId = requestId || outgoingQueue.current[0];
        outgoingQueue.current = outgoingQueue.current.filter(id => id !== queuedId);
        if (!queuedId || !messagesRef.current.some(m => m.id === queuedId)) return;
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
        if (!messagesRef.current.some(m => m.firmwareId === ackFor)) return;
        replaceMessages((current) =>
          current.map((message) =>
            message.firmwareId === ackFor
              ? { ...message, status: "delivered" }
              : message,
          ),
        );
        if (!fieldTestsRef.current.running()) void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
        return;
      }

      if (packet.type === "ackTimeout") {
        const msgId = asString(packet.msgId);
        if (!messagesRef.current.some(m => m.firmwareId === msgId)) return;
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
        const requestId = asString(packet.requestId);
        // Unrelated configuration errors must not consume a modern send request.
        const queuedId = requestId || (!packet.bootId ? outgoingQueue.current[0] : undefined);
        outgoingQueue.current = outgoingQueue.current.filter(id => id !== queuedId);
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

      // Preserve receive order across asynchronous key derivation/decryption so
      // a FINISH control cannot overtake the last data message at the receiver.
      const previousIncoming = incomingMessages.current;
      let unlockIncoming: () => void = () => {};
      incomingMessages.current = new Promise<void>(resolve => { unlockIncoming = resolve; });
      await previousIncoming;
      try {

      const from = asString(packet.from, "desconocido");
      const isBroadcast = packet.broadcast === true;
      const encrypted = packet.encrypted === true;
      let text = asString(packet.text);
      let receivedCryptoMetrics: CryptoOperationMetrics | undefined;

      if (encrypted) {
        const nested =
          packet.payload && typeof packet.payload === "object"
            ? (packet.payload as Record<string, unknown>)
            : {};
        const cipherText = asString(nested.data);
        let decryptionMetrics: CryptoOperationMetrics | undefined;
        try {
          text = await decryptMessage(
            cipherText,
            networkKeyRef.current,
            (metrics) => {
              decryptionMetrics = metrics;
            },
          );
        } catch {
          text = "[No se pudo descifrar; comprueba la clave de red]";
        }
        if (decryptionMetrics) {
          receivedCryptoMetrics = decryptionMetrics;
          void fieldTestsRef.current.append("cryptoDecrypt", { msgId: asString(packet.msgId),
            ...decryptionMetrics }).catch(() => {});
          void meshBleService.writeJson({
            cmd: "cryptoMetric",
            phase: "decrypt",
            msgId: asString(packet.msgId),
            securityMode: cipherText.startsWith("M2:")
              ? "AES128"
              : "AES256_LEGACY",
            plaintextSizeBytes: decryptionMetrics.plaintextSizeBytes,
            ciphertextSizeBytes: decryptionMetrics.ciphertextSizeBytes,
            encodedCiphertextSizeBytes:
              decryptionMetrics.encodedCiphertextSizeBytes,
            decryptionTimeUs: decryptionMetrics.operationTimeUs,
            decryptSuccess: decryptionMetrics.success,
          }).catch(() => {
            // Metrics must never interfere with receiving or displaying a message.
          });
        }
      }

      if (!encrypted && decodeHealthShare(text)) text = "[Informe MAX30102 rechazado: recibido sin cifrado]";
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

      if (fieldTestsRef.current.incoming(text, packet, receivedCryptoMetrics ? { ...receivedCryptoMetrics } : undefined)) return;

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
      } finally { unlockIncoming(); }
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
      fieldTestsRef.current.resetLink();
      clearGps();
      setNodeInfo(null);
      setStatus(null);
      setLastError(null);
      setConnectionState("connecting");
      try {
        const device = await meshBleService.connect(
          deviceId,
          (packet) => void handlePacket(packet),
          (reason) => {
            fieldTestsRef.current.resetLink();
            outgoingQueue.current = [];
            replaceMessages(current => current.map(m => m.direction === "outgoing" && ["queued", "sent"].includes(m.status)
              ? { ...m, status: "unconfirmed" } : m));
            clearGps();
            setNodeInfo(null);
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
        fieldTestsRef.current.resetLink();
        setNodeInfo(null);
        setConnectionState("disconnected");
        const message = error instanceof Error ? error.message : String(error);
        setLastError(message);
        throw error;
      }
    },
    [handlePacket, clearGps, replaceMessages],
  );

  const disconnect = useCallback(async () => {
    fieldTestsRef.current.resetLink();
    outgoingQueue.current = [];
    replaceMessages(current => current.map(m => m.direction === "outgoing" && ["queued", "sent"].includes(m.status)
      ? { ...m, status: "unconfirmed" } : m));
    clearGps();
    setNodeInfo(null);
    await meshBleService.disconnect();
    setConnectedDevice(null);
    setConnectionState("disconnected");
  }, [clearGps, replaceMessages]);

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
      if (fieldTestsRef.current.running() && !options.testSignal) {
        throw new Error("Cancela o termina la prueba automática antes de enviar otros mensajes.");
      }
      if (connectionState !== "connected") {
        throw new Error("Conecta tu nodo LoRa antes de enviar.");
      }

      const sensitiveKey = networkKeyRef.current;
      const sensitive = options.sensitive === true || decodeHealthShare(rawText.trim()) !== null;
      const assertSensitiveSend = () => {
        if (options.sendSignal?.aborted) throw new Error("Envío cancelado al cerrar la medición o perder la conexión.");
        if (options.notAfter !== undefined && Date.now() > options.notAfter) throw new Error("La instantánea caducó antes de comenzar el envío; prepara otra.");
        if (sensitive) assertHealthTransport({ encrypted: encryptionEnabledRef.current && encryptionEnabled,
          key: networkKeyRef.current, expectedKey: sensitiveKey, aborted: options.sendSignal?.aborted === true,
          now: Date.now(), notAfter: options.notAfter ?? Date.now() });
      };
      assertSensitiveSend();

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
      const localId = options.requestId ?? Crypto.randomUUID();
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

      if (!options.testSignal) replaceMessages((current) => [...current, outgoing]);
      outgoingQueue.current.push(localId);

      try {
        let encryptionMetrics: CryptoOperationMetrics | undefined;
        const data = encryptionEnabled
          ? await encryptMessage(
              text,
              networkKeyRef.current,
              (metrics) => {
                encryptionMetrics = metrics;
              },
            )
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
        const plaintextSizeBytes = utf8Length(text);
        const securityMetrics = encryptionEnabled && encryptionMetrics
          ? {
              securityMode: "AES128",
              plaintextSizeBytes: encryptionMetrics.plaintextSizeBytes,
              ciphertextSizeBytes: encryptionMetrics.ciphertextSizeBytes,
              encodedCiphertextSizeBytes:
                encryptionMetrics.encodedCiphertextSizeBytes,
              encryptionTimeUs: encryptionMetrics.operationTimeUs,
            }
          : {
              securityMode: "NONE",
              plaintextSizeBytes,
              ciphertextSizeBytes: plaintextSizeBytes,
              encodedCiphertextSizeBytes: plaintextSizeBytes,
              encryptionTimeUs: 0,
            };
        if (options.testSignal?.aborted) throw new Error("Prueba detenida antes del envío.");
        if (fieldTestsRef.current.activeSession) {
          const saved = fieldTestsRef.current.append("cryptoEncrypt", { requestId: localId, ...securityMetrics });
          if (options.testSignal) await saved;
          else void saved.catch(() => {}); // Logging failure must not prevent ordinary/emergency messaging.
        }
        if (options.testSignal?.aborted) throw new Error("Prueba detenida antes del envío.");
        assertSensitiveSend();
        await meshBleService.writeJson({ ...command, securityMetrics, requestId: localId }, assertSensitiveSend);
        if (!options.testSignal) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

  transmitRef.current = (to, text, requestId, signal) => sendMessage(to, text, { requestId, testSignal: signal });

  const requestNodeGps = useCallback(async (enabled?: boolean): Promise<NodeGps> => {
    if (connectionState !== "connected" || !nodeInfo?.gpsSupported) {
      throw new Error("Este nodo no ofrece GPS integrado.");
    }
    const requestId = Crypto.randomUUID();
    return new Promise<NodeGps>((resolve, reject) => {
      const timer = setTimeout(() => {
        gpsRequests.current.delete(requestId);
        reject(new Error("El nodo no respondió al consultar el GPS. Vuelve a intentar."));
      }, 6000);
      gpsRequests.current.set(requestId, { nodeId: nodeInfo.nodeId, resolve, reject, timer });
      void meshBleService.writeJson({
        cmd: enabled === undefined ? "gps" : "setGps", requestId,
        ...(enabled === undefined ? {} : { enabled }),
      }).catch((error) => {
        clearTimeout(timer);
        gpsRequests.current.delete(requestId);
        reject(error);
      });
    });
  }, [connectionState, nodeInfo]);

  const setNodeGpsEnabled = useCallback(async (enabled: boolean) => {
    await requestNodeGps(enabled);
  }, [requestNodeGps]);

  const setNodeHealthEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (connectionState !== "connected" || !nodeInfo?.healthSupported) {
      throw new Error("Este firmware no ofrece soporte MAX30102.");
    }
    const requestId = Crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        healthRequests.current.delete(requestId);
        reject(new Error("El nodo no respondió al configurar el sensor."));
      }, 6000);
      healthRequests.current.set(requestId, { nodeId: nodeInfo.nodeId, resolve, reject, timer });
      void meshBleService.writeJson({ cmd: "setHealth", enabled, requestId }).catch((error) => {
        clearTimeout(timer);
        healthRequests.current.delete(requestId);
        reject(error);
      });
    });
  }, [connectionState, nodeInfo]);

  const sendLocationSos = useCallback(
    async (conversationId: string) => {
      if (connectionState !== "connected") throw new Error("Conecta tu nodo LoRa antes de enviar.");
      if (nodeInfo?.gpsSupported) {
        const position = await requestNodeGps();
        if (position.enabled) {
          await sendMessage(conversationId, gpsSosText(position), { sos: true });
          return;
        }
        // Phone GPS is used only when node GPS is explicitly disabled.
      }
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
    [connectionState, nodeInfo?.gpsSupported, requestNodeGps, sendMessage],
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
    if (fieldTestsRef.current.running()) throw new Error("Detén la prueba antes de cambiar la clave de red.");
    const cleanKey = key.trim();
    if (cleanKey.length < 12) {
      throw new Error("Usa una clave de red de al menos 12 caracteres.");
    }
    await persistNetworkKey(cleanKey);
    networkKeyRef.current = cleanKey;
    setNetworkKey(cleanKey);
  }, []);

  const setEncryptionEnabled = useCallback(async (enabled: boolean) => {
    if (fieldTestsRef.current.running()) throw new Error("Detén la prueba antes de cambiar el cifrado.");
    encryptionEnabledRef.current = enabled;
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
      gps,
      setNodeGpsEnabled,
      health,
      subscribeHealth,
      setNodeHealthEnabled,
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
      metricSessions: fieldTests.sessions,
      metricSessionId: fieldTests.activeSession,
      metricError: fieldTests.error,
      metricsReady: fieldTests.ready,
      testProgress: fieldTests.progress,
      startTest: fieldTests.start,
      cancelTest: fieldTests.cancel,
      metricArchive: fieldTests.archive,
      trialState: fieldTests.view,
      setTrialMode: fieldTests.setMode,
    }),
    [
      ready,
      connectionState,
      connectedDevice,
      discoveredDevices,
      nodeInfo,
      nodes,
      status,
      gps,
      setNodeGpsEnabled,
      health,
      subscribeHealth,
      setNodeHealthEnabled,
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
      fieldTests,
    ],
  );

  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>;
}

export function useMesh(): MeshContextValue {
  const context = useContext(MeshContext);
  if (!context) throw new Error("useMesh debe usarse dentro de MeshProvider.");
  return context;
}
