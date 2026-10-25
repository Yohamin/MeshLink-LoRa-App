import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ConnectionPill } from "@/components/connection-pill";
import { Screen } from "@/components/screen";
import { Colors } from "@/constants/colors";
import { useMesh } from "@/context/mesh-context";

function Metric({ label, value, suffix = "" }: { label: string; value: number | string; suffix?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}{suffix}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export default function NetworkScreen() {
  const { connectionState, nodeInfo, status, refreshNetwork } = useMesh();
  const metrics = status?.metrics ?? {};

  return (
    <Screen scroll>
      <Text style={styles.eyebrow}>ESTADO DE LA RADIO</Text>
      <Text style={styles.title}>Red</Text>
      <ConnectionPill />
      <TouchableOpacity style={styles.protocolCard} onPress={() => router.push("/health-measurements")} accessibilityRole="button">
        <Ionicons name="pulse-outline" size={24} color={Colors.primary} />
        <View style={styles.protocolCopy}><Text style={styles.protocolTitle}>Apoyo en emergencias</Text>
          <Text style={styles.protocolText}>MAX30102 · Estado declarado, mediciones e informes para coordinar ayuda.</Text></View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.protocolCard} onPress={() => router.push("/field-tests")} accessibilityRole="button">
        <Ionicons name="flask-outline" size={24} color={Colors.primary} />
        <View style={styles.protocolCopy}><Text style={styles.protocolTitle}>Ensayos · emisor y receptor</Text>
          <Text style={styles.protocolText}>100 mensajes · historial · exportación CSV / JSON</Text></View>
      </TouchableOpacity>

      {connectionState !== "connected" ? (
        <TouchableOpacity style={styles.connectCard} onPress={() => router.push("/connect")}>
          <Ionicons name="radio-outline" size={38} color={Colors.primary} />
          <Text style={styles.connectTitle}>Sin telemetría de radio</Text>
          <Text style={styles.connectText}>Conecta el nodo Heltec para ver el diagnóstico de la malla en tiempo real.</Text>
          <Text style={styles.connectAction}>Conectar nodo</Text>
        </TouchableOpacity>
      ) : (
        <>
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View>
                <Text style={styles.heroLabel}>NODO LOCAL</Text>
                <Text style={styles.heroName}>{nodeInfo?.nodeName ?? "Nodo LoRa"}</Text>
                <Text style={styles.heroId}>{nodeInfo?.nodeId}</Text>
              </View>
              <TouchableOpacity style={styles.refresh} onPress={() => void refreshNetwork()}>
                <Ionicons name="refresh" size={20} color={Colors.white} />
              </TouchableOpacity>
            </View>
            <View style={styles.heroMetrics}>
              <Metric label="RSSI" value={status?.lastRssi.toFixed(0) ?? "—"} suffix=" dBm" />
              <Metric label="SNR" value={status?.lastSnr.toFixed(1) ?? "—"} suffix=" dB" />
              <Metric label="EN LÍNEA" value={status?.onlineNodes ?? 0} />
            </View>
          </View>

          <Text style={styles.sectionTitle}>ENTREGA</Text>
          <View style={styles.grid}>
            <Metric label="PDR ACK" value={asDisplay(metrics.pdrAck)} suffix="%" />
            <Metric label="LATENCIA PROM." value={asDisplay(metrics.avgLatencyMs)} suffix=" ms" />
            <Metric label="ACK VENCIDOS" value={asDisplay(metrics.ackTimeouts)} />
            <Metric label="ENTREGADOS" value={asDisplay(metrics.messagesWithAck)} />
          </View>

          <Text style={styles.sectionTitle}>TRÁFICO DE RADIO</Text>
          <View style={styles.grid}>
            <Metric label="PAQUETES TX" value={asDisplay(metrics.txPackets)} />
            <Metric label="PAQUETES RX" value={asDisplay(metrics.rxPackets)} />
            <Metric label="REENVIADOS" value={asDisplay(metrics.forwardedMessages)} />
            <Metric label="DUPLICADOS" value={asDisplay(metrics.duplicates)} />
          </View>

          <View style={styles.protocolCard}>
            <Ionicons name="information-circle" size={22} color={Colors.info} />
            <View style={styles.protocolCopy}>
              <Text style={styles.protocolTitle}>Capa de firmware {nodeInfo?.layer ?? "5.1"}</Text>
              <Text style={styles.protocolText}>{nodeInfo?.radio ?? "SX1262 · RadioLib"} · 915 MHz · SF7</Text>
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}

function asDisplay(value: number | undefined): string {
  if (value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const styles = StyleSheet.create({
  eyebrow: { color: Colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: Colors.ink, fontSize: 28, fontWeight: "900", marginBottom: 8 },
  connectCard: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 20, marginTop: 28, padding: 30 },
  connectTitle: { color: Colors.ink, fontSize: 18, fontWeight: "900", marginTop: 12 },
  connectText: { color: Colors.muted, lineHeight: 20, marginTop: 7, textAlign: "center" },
  connectAction: { color: Colors.primary, fontWeight: "900", marginTop: 18 },
  hero: { backgroundColor: Colors.primary, borderRadius: 20, marginTop: 18, padding: 18 },
  heroTop: { flexDirection: "row", justifyContent: "space-between" },
  heroLabel: { color: "#B7D7CF", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  heroName: { color: Colors.white, fontSize: 22, fontWeight: "900", marginTop: 4 },
  heroId: { color: "#B7D7CF", fontSize: 11, marginTop: 3 },
  refresh: { alignItems: "center", borderColor: "#39776F", borderRadius: 20, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  heroMetrics: { borderTopColor: "#39776F", borderTopWidth: 1, flexDirection: "row", marginTop: 18, paddingTop: 15 },
  metric: { flex: 1, padding: 7 },
  metricValue: { color: Colors.ink, fontSize: 18, fontWeight: "900" },
  metricLabel: { color: Colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 0.6, marginTop: 3 },
  sectionTitle: { color: Colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: 22 },
  grid: { backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", flexWrap: "wrap", marginTop: 8, padding: 8 },
  protocolCard: { alignItems: "center", backgroundColor: "#E7F4F8", borderRadius: 15, flexDirection: "row", marginBottom: 28, marginTop: 16, padding: 14 },
  protocolCopy: { marginLeft: 10 },
  protocolTitle: { color: Colors.info, fontSize: 13, fontWeight: "900" },
  protocolText: { color: Colors.info, fontSize: 11, marginTop: 2 },
});
