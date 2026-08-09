import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors } from "@/constants/colors";
import { useMesh } from "@/context/mesh-context";

export default function ConnectScreen() {
  const {
    connectionState,
    connectedDevice,
    discoveredDevices,
    lastError,
    scan,
    stopScan,
    connect,
    disconnect,
  } = useMesh();

  useEffect(() => {
    if (!connectedDevice) void scan().catch(() => undefined);
    return () => {
      void stopScan();
    };
  }, [connectedDevice, scan, stopScan]);

  const handleConnect = async (id: string) => {
    try {
      await connect(id);
      router.back();
    } catch (error) {
      Alert.alert(
        "Error de conexión",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  if (connectedDevice) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.connectedCard}>
          <View style={styles.radioIcon}>
            <Ionicons name="radio" size={38} color={Colors.primary} />
          </View>
          <Text style={styles.connectedLabel}>CONECTADO</Text>
          <Text style={styles.deviceName}>{connectedDevice.name}</Text>
          <Text style={styles.deviceId}>{connectedDevice.id}</Text>
          {connectedDevice.isDemo && (
            <Text style={styles.demoNote}>
              El modo de demostración simula eventos del firmware para probar la interfaz.
            </Text>
          )}
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={() => void disconnect()}
          >
            <Text style={styles.disconnectText}>Desconectar nodo</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.scanHeader}>
        <View>
          <Text style={styles.title}>Nodos LoRa cercanos</Text>
          <Text style={styles.subtitle}>Buscando dispositivos LoRaMesh por Bluetooth</Text>
        </View>
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => void scan()}
          disabled={connectionState === "scanning"}
        >
          {connectionState === "scanning" ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Ionicons name="refresh" size={20} color={Colors.white} />
          )}
        </TouchableOpacity>
      </View>

      {lastError && <Text style={styles.error}>{lastError}</Text>}

      <FlatList
        data={discoveredDevices}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bluetooth" size={54} color={Colors.primary} />
            <Text style={styles.emptyTitle}>
              {connectionState === "scanning" ? "Buscando…" : "No se encontraron nodos"}
            </Text>
            <Text style={styles.emptyText}>
              Enciende el nodo Heltec y mantenlo cerca de tu teléfono.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.deviceCard}
            onPress={() => void handleConnect(item.id)}
            disabled={connectionState === "connecting"}
          >
            <View style={styles.deviceIcon}>
              <Ionicons name="hardware-chip" size={24} color={Colors.primary} />
            </View>
            <View style={styles.deviceCopy}>
              <Text style={styles.listDeviceName}>{item.name}</Text>
              <Text style={styles.deviceId} numberOfLines={1}>
                {item.isDemo ? "Adaptador de demostración del navegador" : item.id}
              </Text>
            </View>
            <View style={styles.rssiBadge}>
              <Text style={styles.rssiText}>
                {item.rssi === null ? "—" : `${item.rssi} dBm`}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: Colors.background, flex: 1 },
  scanHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 18,
  },
  title: { color: Colors.ink, fontSize: 24, fontWeight: "800" },
  subtitle: { color: Colors.muted, fontSize: 13, marginTop: 4 },
  scanButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 24,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  error: {
    backgroundColor: Colors.dangerSoft,
    color: Colors.danger,
    marginHorizontal: 18,
    padding: 12,
    borderRadius: 10,
  },
  list: { flexGrow: 1, padding: 18, paddingTop: 8 },
  empty: { alignItems: "center", flex: 1, justifyContent: "center", padding: 32 },
  emptyTitle: { color: Colors.ink, fontSize: 18, fontWeight: "800", marginTop: 14 },
  emptyText: { color: Colors.muted, lineHeight: 20, marginTop: 7, textAlign: "center" },
  deviceCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 10,
    padding: 14,
  },
  deviceIcon: {
    alignItems: "center",
    backgroundColor: Colors.accentSoft,
    borderRadius: 13,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  deviceCopy: { flex: 1, marginLeft: 12 },
  listDeviceName: { color: Colors.ink, fontSize: 15, fontWeight: "800" },
  deviceName: { color: Colors.ink, fontSize: 22, fontWeight: "800", marginTop: 8 },
  deviceId: { color: Colors.muted, fontSize: 12, marginTop: 4 },
  rssiBadge: { backgroundColor: Colors.surfaceMuted, borderRadius: 99, padding: 8 },
  rssiText: { color: Colors.muted, fontSize: 11, fontWeight: "700" },
  connectedCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 22,
    margin: 18,
    padding: 28,
  },
  radioIcon: {
    alignItems: "center",
    backgroundColor: Colors.accentSoft,
    borderRadius: 40,
    height: 80,
    justifyContent: "center",
    width: 80,
  },
  connectedLabel: { color: Colors.primary, fontSize: 11, fontWeight: "900", marginTop: 18 },
  demoNote: {
    backgroundColor: Colors.warningSoft,
    borderRadius: 10,
    color: Colors.warning,
    lineHeight: 18,
    marginTop: 18,
    padding: 12,
    textAlign: "center",
  },
  disconnectButton: {
    borderColor: Colors.danger,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  disconnectText: { color: Colors.danger, fontWeight: "800" },
});
