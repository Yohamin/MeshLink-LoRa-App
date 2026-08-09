export const BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
export const BLE_TX_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
export const BLE_RX_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a9";
export const BLE_CHUNK_BYTES = 180;

export const BROADCAST_ID = "broadcast";
export const ENCRYPTED_TEXT_LIMIT = 32;
export const PLAIN_TEXT_LIMIT = 40;
export const DEMO_NETWORK_KEY = "ClaveSecreta123!";

export const STORAGE_KEYS = {
  messages: "@lora-mesh/messages-v1",
  settings: "@lora-mesh/settings-v1",
  networkKey: "lora-mesh.network-key-v1",
} as const;

export const EMERGENCY_PRESETS = [
  { label: "Médico", message: "NECESITO AYUDA MÉDICA" },
  { label: "Rescate", message: "ATRAPADO, NECESITO RESCATE" },
  { label: "A salvo", message: "ESTOY A SALVO" },
] as const;
