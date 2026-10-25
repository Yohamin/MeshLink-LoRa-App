import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ConnectionPill } from "@/components/connection-pill";
import { Screen } from "@/components/screen";
import { Colors } from "@/constants/colors";
import { DEMO_NETWORK_KEY, ENCRYPTION_LABEL } from "@/constants/mesh";
import { useMesh } from "@/context/mesh-context";
import { networkKeyId, testEncryptionRoundTrip } from "@/lib/crypto";
import { shortNodeId } from "@/lib/text";
import { gpsIsFresh } from "@/lib/gps";
import { healthIsFresh, healthStatusText } from "@/lib/health";

export default function SettingsScreen() {
  const {
    connectedDevice,
    nodeInfo,
    gps,
    connectionState,
    setNodeGpsEnabled,
    health,
    setNodeHealthEnabled,
    networkKey,
    encryptionEnabled,
    setNodeName,
    updateNetworkKey,
    setEncryptionEnabled,
    clearHistory,
  } = useMesh();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [activeKeyId, setActiveKeyId] = useState("Comprobando...");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleGps = async (enabled: boolean) => {
    setGpsBusy(true);
    try { await setNodeGpsEnabled(enabled); }
    catch (error) { Alert.alert("GPS del nodo", error instanceof Error ? error.message : String(error)); }
    finally { setGpsBusy(false); }
  };
  const toggleHealth = async (enabled: boolean) => {
    setHealthBusy(true);
    try { await setNodeHealthEnabled(enabled); }
    catch (error) { Alert.alert("MAX30102", error instanceof Error ? error.message : String(error)); }
    finally { setHealthBusy(false); }
  };
  const healthLive = healthIsFresh(health, now);

  useEffect(() => setName(nodeInfo?.nodeName ?? ""), [nodeInfo?.nodeName]);
  useEffect(() => setKey(networkKey), [networkKey]);
  useEffect(() => {
    let active = true;
    void networkKeyId(networkKey).then((value) => {
      if (active) setActiveKeyId(value);
    });
    return () => {
      active = false;
    };
  }, [networkKey]);

  const saveName = async () => {
    try {
      await setNodeName(name);
      Alert.alert("Guardado", "El nombre del nodo se envió al ESP32.");
    } catch (error) {
      Alert.alert("No se pudo guardar", error instanceof Error ? error.message : String(error));
    }
  };

  const saveKey = async () => {
    try {
      const cleanKey = key.trim();
      if (cleanKey.length < 12) {
        throw new Error("Usa una clave de red de al menos 12 caracteres.");
      }
      const selfTestPassed = await testEncryptionRoundTrip(cleanKey);
      if (!selfTestPassed) throw new Error("La prueba local de AES falló.");
      await updateNetworkKey(cleanKey);
      const keyId = await networkKeyId(cleanKey);
      Alert.alert(
        "Clave de red actualizada",
        `La prueba local de AES fue correcta. ID de clave activa: ${keyId}. Compara este ID en todos los teléfonos.`,
      );
    } catch (error) {
      Alert.alert("No se pudo guardar", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Screen scroll>
      <Text style={styles.eyebrow}>DISPOSITIVO Y PRIVACIDAD</Text>
      <Text style={styles.title}>Ajustes</Text>
      <ConnectionPill />
      <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push("/health-measurements")}>
        <Text style={styles.identityName}>Apoyo en emergencias · MAX30102</Text>
        <Text style={styles.identityId}>Comunicar el estado de la persona, guardar mediciones y compartir informes por LoRa.</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>RADIO LOCAL</Text>
      <View style={styles.card}>
        <View style={styles.identityRow}>
          <View style={styles.iconCircle}><Ionicons name="hardware-chip" size={22} color={Colors.primary} /></View>
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{nodeInfo?.nodeName ?? connectedDevice?.name ?? "Sin conexión"}</Text>
            <Text style={styles.identityId}>{nodeInfo?.nodeId ? shortNodeId(nodeInfo.nodeId) : "Conecta un nodo para editar su identidad"}</Text>
            {nodeInfo?.board && <Text style={styles.identityId}>{nodeInfo.board} · FW {nodeInfo.firmwareVersion}</Text>}
          </View>
        </View>
        <Text style={styles.label}>NOMBRE DEL NODO · MÁX. 32 BYTES</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Equipo de rescate"
          placeholderTextColor={Colors.muted}
          editable={Boolean(connectedDevice)}
        />
        <TouchableOpacity style={[styles.primaryButton, !connectedDevice && styles.disabled]} onPress={() => void saveName()} disabled={!connectedDevice}>
          <Text style={styles.primaryButtonText}>Guardar nombre del nodo</Text>
        </TouchableOpacity>
      </View>

      {nodeInfo?.gpsSupported && (
        <>
          <Text style={styles.sectionTitle}>GPS DEL NODO V4</Text>
          <View style={styles.card}>
            <View style={styles.identityRow}>
              <View style={styles.gpsCopy}>
                <Text style={styles.identityName}>Usar GPS del módulo</Text>
                <Text style={styles.identityId}>{gpsIsFresh(gps, now) ? "Posición reciente disponible" : gps?.enabled ? "Buscando satélites / sin posición reciente" : "Apagado o esperando estado"}</Text>
              </View>
              <Switch value={gps?.enabled === true} disabled={gpsBusy || connectionState !== "connected" || !gps}
                onValueChange={(enabled) => void toggleGps(enabled)} />
            </View>
            <Text style={styles.identityId}>Satélites: {gps?.satellites ?? 0} · Sentencias NMEA: {gps?.validSentences ?? 0}</Text>
            <Text style={styles.identityId}>Al pulsar «Ubicación» se utiliza el GPS del nodo. No se difunden coordenadas automáticamente. Si lo apagas, se utiliza la ubicación del teléfono.</Text>
          </View>
        </>
      )}

      {nodeInfo?.healthSupported && (
        <>
          <Text style={styles.sectionTitle}>MAX30102 · EXPERIMENTAL</Text>
          <View style={styles.card}>
            <View style={styles.identityRow}>
              <View style={styles.gpsCopy}>
                <Text style={styles.identityName}>Leer sensor del nodo</Text>
                <Text style={styles.identityId}>{healthStatusText(health, now)}</Text>
              </View>
              <Switch value={health?.enabled === true}
                disabled={healthBusy || connectionState !== "connected" || !health}
                onValueChange={(enabled) => void toggleHealth(enabled)} />
            </View>
            <Text style={styles.identityName}>Pulso estimado: {healthLive && health?.heartRateBpm !== null ? health?.heartRateBpm : "—"} lpm</Text>
            <Text style={styles.identityName}>SpO₂ estimada: {healthLive && health?.spo2Percent !== null ? health?.spo2Percent : "—"} %</Text>
            <Text style={styles.identityId}>Rojo: {health?.red ?? "—"} · IR: {health?.infrared ?? "—"}</Text>
            <Text style={styles.identityId}>Muestras: {health?.samplesReceived ?? 0} · Reinicios FIFO: {health?.fifoResets ?? 0} · Errores I²C: {health?.i2cErrors ?? 0}</Text>
            <Text style={styles.identityId}>Mediciones orientativas de apoyo en emergencias. No sustituyen una evaluación médica. No esperes al sensor para pedir ayuda. Se desactiva al reiniciar el nodo.</Text>
            <Text style={styles.identityId}>Consulta por BLE sin nueva autenticación. Para registrar o compartir abre «Apoyo en emergencias» y confirma cada envío. Activa el sensor solo después de comprobar alimentación y conexiones.</Text>
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>SEGURIDAD DE MENSAJES</Text>
      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>Cifrado autenticado</Text>
            <Text style={styles.settingText}>Cifrado {ENCRYPTION_LABEL} y detección de alteraciones</Text>
          </View>
          <Switch
            value={encryptionEnabled}
            onValueChange={(value) => void setEncryptionEnabled(value).catch(error =>
              Alert.alert("Cifrado", error instanceof Error ? error.message : String(error)))}
            trackColor={{ false: Colors.border, true: "#7EE0A0" }}
            thumbColor={encryptionEnabled ? Colors.primary : Colors.muted}
          />
        </View>
        <Text style={styles.label}>CLAVE DE RED COMPARTIDA</Text>
        <View style={styles.keyRow}>
          <TextInput
            style={[styles.input, styles.keyInput]}
            value={key}
            onChangeText={setKey}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.eye} onPress={() => setShowKey((current) => !current)}>
            <Ionicons name={showKey ? "eye-off" : "eye"} size={20} color={Colors.muted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.keyId}>ID DE CLAVE ACTIVA · {activeKeyId}</Text>
        {networkKey === DEMO_NETWORK_KEY && (
          <View style={styles.warning}>
            <Ionicons name="warning" size={18} color={Colors.warning} />
            <Text style={styles.warningText}>La clave de prototipo está activa. Cámbiala antes de usar el sistema en campo.</Text>
          </View>
        )}
        <TouchableOpacity style={styles.primaryButton} onPress={() => void saveKey()}>
          <Text style={styles.primaryButtonText}>Actualizar clave de red</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>DATOS LOCALES</Text>
      <TouchableOpacity
        style={styles.dangerButton}
        onPress={() =>
          Alert.alert("¿Borrar el historial de mensajes?", "Esto elimina las conversaciones guardadas en este teléfono.", [
            { text: "Cancelar", style: "cancel" },
            { text: "Borrar", style: "destructive", onPress: () => void clearHistory() },
          ])
        }
      >
        <Ionicons name="trash-outline" size={19} color={Colors.danger} />
        <Text style={styles.dangerText}>Borrar historial de mensajes</Text>
      </TouchableOpacity>
      <Text style={styles.version}>
        Prototipo MeshLink · App {Constants.expoConfig?.version ?? "1.3.0"} · Protocolo de firmware 5.1
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: Colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: Colors.ink, fontSize: 28, fontWeight: "900", marginBottom: 8 },
  sectionTitle: { color: Colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: 22 },
  card: { backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: 17, borderWidth: 1, marginTop: 8, padding: 15 },
  identityRow: { alignItems: "center", flexDirection: "row", marginBottom: 16 },
  iconCircle: { alignItems: "center", backgroundColor: Colors.accentSoft, borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  identityCopy: { marginLeft: 10 },
  gpsCopy: { flex: 1, paddingRight: 8 },
  identityName: { color: Colors.ink, fontSize: 15, fontWeight: "900" },
  identityId: { color: Colors.muted, fontSize: 11, marginTop: 2 },
  label: { color: Colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 0.8, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: Colors.background, borderColor: Colors.border, borderRadius: 11, borderWidth: 1, color: Colors.ink, fontSize: 14, minHeight: 46, paddingHorizontal: 12 },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 11, marginTop: 10, paddingVertical: 13 },
  primaryButtonText: { color: Colors.white, fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.4 },
  settingRow: { alignItems: "center", flexDirection: "row", marginBottom: 14 },
  settingCopy: { flex: 1 },
  settingTitle: { color: Colors.ink, fontSize: 14, fontWeight: "900" },
  settingText: { color: Colors.muted, fontSize: 11, marginTop: 3 },
  keyRow: { alignItems: "center", flexDirection: "row" },
  keyInput: { flex: 1, paddingRight: 46 },
  keyId: { color: Colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.6, marginTop: 9 },
  eye: { alignItems: "center", height: 46, justifyContent: "center", marginLeft: -46, width: 46 },
  warning: { alignItems: "center", backgroundColor: Colors.warningSoft, borderRadius: 10, flexDirection: "row", gap: 8, marginTop: 10, padding: 10 },
  warningText: { color: Colors.warning, flex: 1, fontSize: 11, lineHeight: 16 },
  dangerButton: { alignItems: "center", backgroundColor: Colors.dangerSoft, borderRadius: 13, flexDirection: "row", gap: 8, marginBottom: 14, marginTop: 8, padding: 14 },
  dangerText: { color: Colors.danger, fontSize: 13, fontWeight: "900" },
  version: { color: Colors.muted, fontSize: 10, marginBottom: 28, textAlign: "center" },
});
