import { Ionicons } from "@expo/vector-icons";
import { decodeHealthShare } from "@/lib/health-share";
import { router } from "expo-router";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { ConnectionPill } from "@/components/connection-pill";
import { Screen } from "@/components/screen";
import { Colors } from "@/constants/colors";
import { BROADCAST_ID } from "@/constants/mesh";
import { useMesh } from "@/context/mesh-context";
import { formatRelativeTime } from "@/lib/text";
import type { ConversationSummary } from "@/types/mesh";

function ConversationRow({ item }: { item: ConversationSummary }) {
  const isBroadcast = item.id === BROADCAST_ID;
  const preview = item.latest && decodeHealthShare(item.latest.text) ? "Informe de apoyo · MAX30102" :
    item.latest?.text ?? (isBroadcast ? "Llega a todos los nodos cercanos" : "Aún no hay mensajes");

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() =>
        router.push({ pathname: "/chat/[id]", params: { id: item.id } })
      }
    >
      <View style={[styles.avatar, isBroadcast && styles.broadcastAvatar]}>
        <Ionicons
          name={isBroadcast ? "megaphone" : "person"}
          size={22}
          color={isBroadcast ? Colors.danger : Colors.primary}
        />
        {!isBroadcast && (
          <View
            style={[
              styles.presence,
              item.state === "active" && styles.active,
              item.state === "recent" && styles.recent,
            ]}
          />
        )}
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.name}
          </Text>
          {item.latest && (
            <Text style={styles.time}>
              {formatRelativeTime(item.latest.createdAt)}
            </Text>
          )}
        </View>
        <View style={styles.previewRow}>
          {item.latest?.direction === "outgoing" && (
            <Ionicons
              name={item.latest.status === "delivered" ? "checkmark-done" : "checkmark"}
              color={item.latest.status === "failed" ? Colors.danger : Colors.muted}
              size={15}
            />
          )}
          {item.latest?.sos && <Text style={styles.sosLabel}>SOS</Text>}
          <Text style={styles.preview} numberOfLines={1}>
            {preview}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={17} color={Colors.muted} />
    </TouchableOpacity>
  );
}

export default function ChatsScreen() {
  const { conversations, connectionState } = useMesh();

  return (
    <Screen>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.eyebrow}>MENSAJERÍA SIN RED</Text>
          <Text style={styles.title}>MeshLink</Text>
        </View>
        <TouchableOpacity
          style={styles.connectIcon}
          onPress={() => router.push("/connect")}
        >
          <Ionicons
            name={connectionState === "connected" ? "bluetooth" : "bluetooth-outline"}
            size={24}
            color={Colors.primary}
          />
        </TouchableOpacity>
      </View>
      <ConnectionPill />

      {connectionState !== "connected" && (
        <TouchableOpacity style={styles.offlineCard} onPress={() => router.push("/connect")}>
          <View style={styles.offlineIcon}>
            <Ionicons name="radio-outline" size={25} color={Colors.warning} />
          </View>
          <View style={styles.offlineCopy}>
            <Text style={styles.offlineTitle}>Conecta tu radio</Text>
            <Text style={styles.offlineText}>
              Conecta un nodo LoRa para enviar mensajes. El historial permanece en este teléfono.
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color={Colors.warning} />
        </TouchableOpacity>
      )}

      <Text style={styles.sectionTitle}>CONVERSACIONES</Text>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ConversationRow item={item} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: Colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: Colors.ink, fontSize: 31, fontWeight: "900", letterSpacing: -0.7 },
  connectIcon: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  offlineCard: {
    alignItems: "center",
    backgroundColor: Colors.warningSoft,
    borderRadius: 16,
    flexDirection: "row",
    marginTop: 18,
    padding: 14,
  },
  offlineIcon: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 13,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  offlineCopy: { flex: 1, marginHorizontal: 12 },
  offlineTitle: { color: Colors.warning, fontSize: 14, fontWeight: "900" },
  offlineText: { color: Colors.warning, fontSize: 12, lineHeight: 17, marginTop: 2 },
  sectionTitle: { color: Colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginTop: 22 },
  list: { paddingBottom: 24, paddingTop: 8 },
  row: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: Colors.accentSoft,
    borderRadius: 25,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  broadcastAvatar: { backgroundColor: Colors.dangerSoft },
  presence: {
    backgroundColor: Colors.muted,
    borderColor: Colors.surface,
    borderRadius: 7,
    borderWidth: 2,
    bottom: 0,
    height: 13,
    position: "absolute",
    right: 0,
    width: 13,
  },
  active: { backgroundColor: Colors.accent },
  recent: { backgroundColor: "#E7A52B" },
  rowCopy: { flex: 1, marginLeft: 12 },
  rowHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  rowTitle: { color: Colors.ink, flex: 1, fontSize: 15, fontWeight: "800" },
  time: { color: Colors.muted, fontSize: 11, marginLeft: 8 },
  previewRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 5 },
  preview: { color: Colors.muted, flex: 1, fontSize: 13 },
  sosLabel: { color: Colors.danger, fontSize: 10, fontWeight: "900" },
});
