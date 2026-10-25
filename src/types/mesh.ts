export type ConnectionState =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected";

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "unconfirmed"
  | "failed";

export type MeshNodeState = "active" | "recent" | "offline";

export type MeshNode = {
  index: number;
  id: string;
  name: string;
  online: boolean;
  rssi: number;
  snr: number;
  lastSeenMsAgo: number;
  state: MeshNodeState;
};

export type DiscoveredDevice = {
  id: string;
  name: string;
  rssi: number | null;
  isDemo?: boolean;
};

export type ConnectedDevice = {
  id: string;
  name: string;
  isDemo?: boolean;
};

export type MeshMessage = {
  id: string;
  firmwareId?: string;
  conversationId: string;
  direction: "incoming" | "outgoing";
  senderId: string;
  senderName: string;
  recipientId: string;
  text: string;
  createdAt: number;
  status: MessageStatus;
  sos: boolean;
  encrypted: boolean;
  broadcast: boolean;
  route?: string;
  rssi?: number;
  snr?: number;
};

export type NodeInfo = {
  nodeId: string;
  nodeName: string;
  layer?: string;
  radio?: string;
  board?: string;
  firmwareVersion?: string;
  gpsSupported?: boolean;
  healthSupported?: boolean;
  bootId?: string;
  requestCorrelation?: boolean;
  snapshotCorrelation?: boolean;
};

export type MeshMetrics = Record<string, number>;

export type MeshStatus = {
  onlineNodes: number;
  expectedNodes: number;
  lastRssi: number;
  lastSnr: number;
  metrics: MeshMetrics;
  lastMessage?: string;
};

export type FirmwarePacket = {
  type: string;
  [key: string]: unknown;
};

export type ConversationSummary = {
  id: string;
  name: string;
  state: MeshNodeState | "broadcast";
  latest?: MeshMessage;
  rssi?: number;
  snr?: number;
};
