import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Colors } from "@/constants/colors";
import { useMesh } from "@/context/mesh-context";

export function ConnectionPill() {
  const { connectionState, connectedDevice, nodes } = useMesh();
  const connected = connectionState === "connected";

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={connected ? "Nodo LoRa conectado" : "Conectar nodo LoRa"}
      style={[styles.container, connected && styles.connected]}
      onPress={() => router.push("/connect")}
    >
      <View style={[styles.dot, connected && styles.dotConnected]} />
      <Ionicons
        name={connected ? "radio" : "radio-outline"}
        size={15}
        color={connected ? Colors.primary : Colors.muted}
      />
      <Text style={[styles.text, connected && styles.textConnected]}>
        {connected
          ? `${connectedDevice?.isDemo ? "Demostración" : "LoRa"} · ${nodes.filter((node) => node.online).length} cerca`
          : "LoRa sin conexión"}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: Colors.surfaceMuted,
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  connected: { backgroundColor: Colors.accentSoft },
  dot: {
    backgroundColor: Colors.muted,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  dotConnected: { backgroundColor: Colors.accent },
  text: { color: Colors.muted, fontSize: 12, fontWeight: "700" },
  textConnected: { color: Colors.primaryDark },
});
