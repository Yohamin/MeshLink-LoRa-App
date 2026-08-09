import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { STORAGE_KEYS } from "@/constants/mesh";
import type { MeshMessage } from "@/types/mesh";

export type StoredSettings = {
  encryptionEnabled: boolean;
};

export async function loadMessages(): Promise<MeshMessage[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.messages);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MeshMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveMessages(messages: MeshMessage[]): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEYS.messages,
    JSON.stringify(messages.slice(-500)),
  );
}

export async function clearStoredMessages(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.messages);
}

export async function loadSettings(): Promise<StoredSettings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.settings);
  if (!raw) return { encryptionEnabled: true };
  try {
    return { encryptionEnabled: JSON.parse(raw).encryptionEnabled !== false };
  } catch {
    return { encryptionEnabled: true };
  }
}

export async function saveSettings(settings: StoredSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

export async function loadNetworkKey(): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(STORAGE_KEYS.networkKey) ?? null;
  }
  return SecureStore.getItemAsync(STORAGE_KEYS.networkKey);
}

export async function saveNetworkKey(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(STORAGE_KEYS.networkKey, key);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEYS.networkKey, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

