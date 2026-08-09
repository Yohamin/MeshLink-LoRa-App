import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ConnectionPill } from "@/components/connection-pill";
import { Screen } from "@/components/screen";
import { Colors } from "@/constants/colors";
import { useMesh } from "@/context/mesh-context";
import { shortNodeId, signalLabel } from "@/lib/text";

const NODE_STATE_LABELS = {
  active: "ACTIVO",
  recent: "RECIENTE",
  offline: "SIN CONEXIÓN",
} as const;

export default function NodesScreen() {
  const { nodes, refreshNetwork, connectionState } = useMesh();

  return (
    <Screen scroll>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>DIRECTORIO DE MALLA</Text>
          <Text style={styles.title}>Nodos cercanos</Text>
        </View>
        <TouchableOpacity
          style={styles.refresh}
          onPress={() => void refreshNetwork()}
          disabled={connectionState !== "connected"}
        >
          <Ionicons name="refresh" size={21} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      <ConnectionPill />

      <View style={styles.summary}>
        <View>
          <Text style={styles.summaryNumber}>
            {nodes.filter((node) => node.online).length}
          </Text>
          <Text style={styles.summaryLabel}>ALCANZABLES</Text>
        </View>
        <View style={styles.divider} />
        <View>
          <Text style={styles.summaryNumber}>{nodes.length}</Text>
          <Text style={styles.summaryLabel}>DETECTADOS</Text>
        </View>
        <View style={styles.summaryIcon}>
          <Ionicons name="git-network" size={30} color={Colors.primary} />
        </View>
      </View>

      {nodes.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="scan-outline" size={50} color={Colors.muted} />
          <Text style={styles.emptyTitle}>No se detectaron nodos de malla</Text>
          <Text style={styles.emptyText}>
            Conecta tu radio local. Los anuncios de vecinos pueden tardar hasta 23 segundos.
          </Text>
        </View>
      ) : (
        nodes.map((node) => (
          <TouchableOpacity
            key={node.id}
            style={styles.card}
            onPress={() =>
              router.push({ pathname: "/chat/[id]", params: { id: node.id } })
            }
          >
            <View style={styles.nodeHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{node.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.nodeCopy}>
                <Text style={styles.nodeName}>{node.name}</Text>
                <Text style={styles.nodeId}>{shortNodeId(node.id)}</Text>
              </View>
              <View style={[styles.state, node.state === "active" && styles.stateActive]}>
                <Text style={[styles.stateText, node.state === "active" && styles.stateTextActive]}>
                  {NODE_STATE_LABELS[node.state]}
                </Text>
              </View>
            </View>
            <View style={styles.signalRow}>
              <View style={styles.signalItem}>
                <Ionicons name="cellular" size={18} color={Colors.primary} />
                <View>
                  <Text style={styles.signalValue}>{node.rssi.toFixed(0)} dBm</Text>
                  <Text style={styles.signalLabel}>{signalLabel(node.rssi)}</Text>
                </View>
              </View>
              <View style={styles.signalItem}>
                <Ionicons name="analytics" size={18} color={Colors.info} />
                <View>
                  <Text style={styles.signalValue}>{node.snr.toFixed(1)} dB</Text>
                  <Text style={styles.signalLabel}>Relación señal/ruido</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: Colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: Colors.ink, fontSize: 28, fontWeight: "900" },
  refresh: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  summary: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 20,
    flexDirection: "row",
    marginTop: 18,
    padding: 18,
  },
  summaryNumber: { color: Colors.white, fontSize: 27, fontWeight: "900" },
  summaryLabel: { color: "#B7D7CF", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  divider: { backgroundColor: "#39776F", height: 38, marginHorizontal: 20, width: 1 },
  summaryIcon: { marginLeft: "auto" },
  empty: { alignItems: "center", paddingHorizontal: 30, paddingVertical: 70 },
  emptyTitle: { color: Colors.ink, fontSize: 17, fontWeight: "800", marginTop: 12 },
  emptyText: { color: Colors.muted, lineHeight: 20, marginTop: 7, textAlign: "center" },
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: 17,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  nodeHeader: { alignItems: "center", flexDirection: "row" },
  avatar: {
    alignItems: "center",
    backgroundColor: Colors.accentSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatarText: { color: Colors.primary, fontSize: 18, fontWeight: "900" },
  nodeCopy: { flex: 1, marginLeft: 11 },
  nodeName: { color: Colors.ink, fontSize: 15, fontWeight: "800" },
  nodeId: { color: Colors.muted, fontSize: 11, marginTop: 3 },
  state: { backgroundColor: Colors.surfaceMuted, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5 },
  stateActive: { backgroundColor: Colors.accentSoft },
  stateText: { color: Colors.muted, fontSize: 9, fontWeight: "900" },
  stateTextActive: { color: Colors.primary },
  signalRow: { borderTopColor: Colors.border, borderTopWidth: 1, flexDirection: "row", gap: 22, marginTop: 13, paddingTop: 12 },
  signalItem: { alignItems: "center", flexDirection: "row", gap: 7 },
  signalValue: { color: Colors.ink, fontSize: 12, fontWeight: "800" },
  signalLabel: { color: Colors.muted, fontSize: 9, marginTop: 1 },
});
