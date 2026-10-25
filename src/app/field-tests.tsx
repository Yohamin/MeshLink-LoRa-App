import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Screen } from "@/components/screen";
import { Colors } from "@/constants/colors";
import { useMesh } from "@/context/mesh-context";
import { archiveCsv, summarizeTest, type MetricArchive } from "@/lib/telemetry";
import { exportMetricFile } from "@/lib/metric-export";

const number = (value: number | null, unit = "") => value === null ? "—" : `${value.toFixed(2)}${unit}`;
export default function FieldTestsScreen() {
  const { nodes, nodeInfo, connectionState, metricSessions, metricSessionId, metricError, metricsReady,
    testProgress, startTest, cancelTest, metricArchive, trialState, setTrialMode, connectedDevice } = useMesh();
  const [destination, setDestination] = useState("");
  const [scenario, setScenario] = useState("");
  const [interval, setInterval] = useState("5");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(20);
  const [archive, setArchive] = useState<MetricArchive | null>(null);
  const running = trialState.active;
  useFocusEffect(useCallback(() => {
    setTrialMode(true);
    return () => setTrialMode(false);
  }, [setTrialMode]));
  const reportError = (e: unknown) => Alert.alert("Pruebas y métricas", e instanceof Error ? e.message : String(e));
  const execute = async () => {
    try { await startTest(destination.trim(), scenario, Number(interval) * 1000); }
    catch (e) { reportError(e); }
  };
  const confirm = () => Alert.alert("¿Enviar 100 mensajes de prueba?",
    `Destino: ${destination}\nEscenario: ${scenario}\nPausa tras cada ACK/timeout: ${interval} s.\n\nMantén la app visible y la pantalla encendida. El destino también debe registrar la prueba. Utiliza parámetros RF autorizados y evita probar en una red de emergencia en uso.`,
    [{ text: "Volver", style: "cancel" }, { text: "Iniciar", onPress: () => void execute() }]);
  const openSession = async (id: string) => {
    setBusy(true);
    try { setArchive(await metricArchive(id)); } catch (e) { reportError(e); } finally { setBusy(false); }
  };
  const exportFile = async (format: "csv" | "json") => {
    if (!archive) return;
    setBusy(true);
    try {
      // Reload: the selected session may have received new snapshots since opening.
      const latest = await metricArchive(archive.session.id);
      setArchive(latest);
      const runIds = [...new Set(latest.records.filter(r => ["trialOpen", "testStart", "testRx"].includes(r.type)).map(r => String(r.data.runId)))];
      const content = format === "csv" ? archiveCsv(latest) : JSON.stringify({ ...latest,
        exportedAt: new Date().toISOString(), tests: runIds.map(id => summarizeTest(latest.records, id)),
        coverage: "Trial-scoped BLE only; no offline replay; receiver readiness and final saved receipt required; ACK latency is round trip",
      }, null, 2);
      await exportMetricFile(`MeshLink-${latest.session.id}-${Date.now()}.${format}`, content,
        format === "csv" ? "text/csv" : "application/json");
      Alert.alert("Exportación finalizada", "El historial original permanece en la app.");
    } catch (e) { reportError(e); } finally { setBusy(false); }
  };
  const runIds = archive ? [...new Set(archive.records.filter(r => ["trialOpen", "testStart", "testRx"].includes(r.type)).map(r => String(r.data.runId)))] : [];
  return <Screen scroll>
    <Text style={styles.title}>Ensayos</Text>
    <Text style={styles.copy}>Cada encendido crea una sesión; reconectar el mismo arranque conserva su historial. Los archivos se guardan en este teléfono, no en la memoria flash del nodo.</Text>
    <Text style={styles.copy}>Ambos teléfonos deben tener Ensayos abierto y sus nodos conectados. El registro detallado empieza al solicitar/aceptar el ensayo y termina con su cierre; no se registra telemetría continuamente fuera del ensayo. No se recupera detalle sin BLE ni se guardan claves, conversaciones, GPS o MAX30102 aquí.</Text>
    {!!metricError && <Text accessibilityRole="alert" style={styles.error}>{metricError} No continúes la prueba sin resolverlo.</Text>}
    {connectedDevice?.isDemo ? <Text style={styles.copy}>DEMO: no hay un segundo teléfono/nodo real. Los ensayos coordinados requieren BLE y ambos extremos preparados.</Text> : connectionState === "connected" && !nodeInfo?.snapshotCorrelation && <Text style={styles.error}>Actualiza el firmware a 5.5 para confirmar las instantáneas de inicio y final.</Text>}
    <View style={styles.card}>
      <Text style={styles.heading}>{trialState.armed && connectionState === "connected" && nodeInfo?.snapshotCorrelation && metricsReady && !metricError ? "● Preparado para recibir un ensayo" : "Esperando conexión / preparación"}</Text>
      <Text style={styles.copy}>Al permanecer en esta pantalla autorizas recibir una solicitud de ensayo de otro nodo de la red. Si estás disponible, este teléfono abre su archivo y confirma la preparación antes de que el emisor envíe los 100 mensajes.</Text>
      {trialState.runId && <Text accessibilityLiveRegion="polite" style={styles.copy}>Ensayo {trialState.runId} · {trialState.role === "receiver" ? "Receptor" : "Emisor"}{"\n"}
        Nodo remoto: {trialState.peer}{"\n"}
        Estado: {({ idle: "esperando", preparing: "preparando y confirmando registros", sending: "enviando", receiving: "registrando recepción", closing: "guardando y confirmando cierre", completed: "finalizado", interrupted: "incompleto / detenido" })[trialState.phase]}{"\n"}
        {trialState.role === "receiver" ? `Recibidos únicos: ${trialState.received}/100` : `Registro final del receptor: ${trialState.remoteSaved ? "confirmado" : "aún no confirmado"}`}{"\n"}{trialState.reason ?? ""}</Text>}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>Elegir nodo y solicitar ensayo · 100 mensajes</Text>
      <Text style={styles.copy}>Usa el cifrado configurado en Ajustes. Envía T:identificador:001/100 hasta 100/100. Solo un mensaje pendiente, sin reintentos automáticos. Un timeout significa sin confirmación, no demuestra pérdida en destino.</Text>
      <Text style={styles.label}>ESCENARIO</Text>
      <TextInput accessibilityLabel="Escenario de prueba" style={styles.input} value={scenario} onChangeText={setScenario} editable={!running} maxLength={120} placeholder="Ej.: Sótano, 50 m, repetidor al medio" />
      <Text style={styles.label}>DESTINO (NO BROADCAST)</Text>
      {nodes.filter(n => n.id !== nodeInfo?.nodeId).map(n => <TouchableOpacity key={n.id} disabled={running}
        accessibilityRole="radio" accessibilityState={{ selected: destination === n.id }} onPress={() => setDestination(n.id)}
        style={[styles.choice, destination === n.id && styles.selected]}>
        <Text style={styles.copy}>{destination === n.id ? "● " : "○ "}{n.name} · {n.id}</Text>
      </TouchableOpacity>)}
      <TextInput accessibilityLabel="ID del nodo destino" style={styles.input} value={destination} onChangeText={setDestination} editable={!running} placeholder="N-..." autoCapitalize="characters" maxLength={64} />
      <Text style={styles.label}>PAUSA DESPUÉS DE CADA RESULTADO (2–60 SEGUNDOS)</Text>
      <TextInput accessibilityLabel="Pausa entre mensajes en segundos" style={styles.input} value={interval} onChangeText={setInterval} editable={!running} keyboardType="number-pad" maxLength={2} />
      <Text style={styles.copy}>La pausa no sustituye la configuración reglamentaria de radio. Mantén la app visible; al bloquear la pantalla, salir o perder BLE se detiene y no se reanuda sola.</Text>
      {running ? <TouchableOpacity style={styles.stop} onPress={() => cancelTest()} accessibilityRole="button"><Text style={styles.buttonText}>Detener prueba</Text></TouchableOpacity> :
        <TouchableOpacity accessibilityRole="button" disabled={!metricsReady || !!metricError || !metricSessionId || !nodeInfo?.snapshotCorrelation || !scenario.trim() || !destination.trim() || busy}
          style={[styles.button, (!metricSessionId || !scenario.trim() || !destination.trim() || !!metricError) && styles.disabled]} onPress={confirm}><Text style={styles.buttonText}>Solicitar ensayo al nodo elegido</Text></TouchableOpacity>}
      {testProgress && <Text accessibilityLiveRegion="polite" style={styles.copy}>Prueba {testProgress.runId}: {testProgress.phase === "running" ? "en curso" : testProgress.phase === "completed" ? "finalizada" : "detenida"}{"\n"}
        Intentos: {testProgress.attempted}/100 · ACK: {testProgress.ack} · Timeouts: {testProgress.timeouts} · TX fallidos: {testProgress.txFailed}{"\n"}{testProgress.reason ?? ""}</Text>}
    </View>
    <Text style={styles.heading}>Historial persistente · {metricSessions.length} sesiones</Text>
    <Text style={styles.copy}>No se borran al reiniciar el nodo, cerrar la app ni limpiar chats. Desinstalar/borrar datos del teléfono sí puede eliminarlas: exporta después de cada ensayo. Un cierre forzado puede perder operaciones aún no confirmadas en almacenamiento.</Text>
    {[...metricSessions].reverse().slice(0, limit).map(s => <TouchableOpacity accessibilityRole="button" disabled={busy || running} key={s.id} style={styles.card} onPress={() => void openSession(s.id)}>
      <Text style={styles.heading}>{s.demo ? "DEMO · " : ""}{s.nodeId}{s.id === metricSessionId ? " · actual" : ""}</Text>
      <Text style={styles.copy}>{new Date(s.firstSeenAt).toLocaleString()} · {s.records} registros{"\n"}Arranque: {s.bootId}{"\n"}{s.board} · FW {s.firmwareVersion}</Text>
      <Text style={styles.link}>Ver resumen y exportar</Text>
    </TouchableOpacity>)}
    {metricSessions.length > limit && <TouchableOpacity onPress={() => setLimit(limit + 20)}><Text style={styles.link}>Mostrar más sesiones</Text></TouchableOpacity>}
    {archive && <View style={styles.card}>
      <Text style={styles.heading}>Sesión seleccionada · {archive.session.nodeId}</Text>
      <Text style={styles.copy}>{archive.records.length} eventos. Captura iniciada con {number(archive.session.firstUptimeMs / 1000, " s")} de actividad del nodo. Las métricas acumuladas no son valores exclusivos de una prueba.</Text>
      {runIds.map(id => {
        const s = summarizeTest(archive.records, id);
        const start = archive.records.find(r => ["trialOpen", "testStart"].includes(r.type) && r.data.runId === id);
        const end = archive.records.findLast(r => r.type === "testEnd" && r.data.runId === id);
        const close = archive.records.findLast(r => r.type === "trialClose" && r.data.runId === id);
        return <View key={id} style={styles.report}>
          <Text style={styles.heading}>Ensayo {id} · {s.role === "receiver" ? "Receptor" : "Emisor"}</Text>
          <Text style={styles.copy}>Cierre: {close ? close.data.complete === true ? "completo" : "incompleto" : "sin cierre confirmado"}{"\n"}
            {s.role === "receiver" ? `TX informados por el origen: ${s.senderRadioSent ?? "—"}\nPDR recepción: ${number(s.pdrReception, " %")}` : `Guardado final del receptor: ${s.receiverConfirmed ? "confirmado" : "sin confirmar"}\nRecibidos reportados por receptor: ${s.remoteReceived ?? "—"}`}</Text>
          <Text style={styles.copy}>{String(start?.data.scenario ?? "Recepción de prueba remota")}{"\n"}
            {start && s.role !== "receiver" ? `Estado de los envíos: ${String(end?.data.phase ?? "sin cierre registrado / revisar interrupción")}\nIntentos: ${s.attempted} · TX confirmados: ${s.radioSent} · Fallidos/rechazados: ${s.txFailed}\nACK: ${s.ack} · Timeouts: ${s.timeouts} · Sin observación: ${s.unobserved}\nPDR ACK (ACK/TX correctos): ${number(s.pdrAck, " %")}\nACK/intentos: ${number(s.ackPerAttempt, " %")}\nLatencia ACK promedio: ${number(s.avgAckLatencyMs, " ms")}\n` : ""}
            Recibidos únicos de esta prueba: {s.received}{"\n"}Fallos de descifrado del par: {s.decryptFailures}{"\n"}RSSI RX promedio: {number(s.avgRxRssi, " dBm")}{"\n"}SNR RX promedio: {number(s.avgRxSnr, " dB")}</Text>
        </View>;
      })}
      <Text style={styles.copy}>La latencia es de confirmación (ida y vuelta), no latencia unidireccional. El PDR de recepción requiere contrastar los archivos de origen y destino. Los valores RSSI/SNR aquí son de los mensajes de prueba recibidos, no de los ACK.</Text>
      <TouchableOpacity disabled={busy || running} style={styles.button} onPress={() => void exportFile("csv")}><Text style={styles.buttonText}>Guardar CSV</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy || running} style={styles.button} onPress={() => void exportFile("json")}><Text style={styles.buttonText}>Guardar JSON completo</Text></TouchableOpacity>
    </View>}
  </Screen>;
}
const styles = StyleSheet.create({
  title: { color: Colors.ink, fontSize: 25, fontWeight: "900", marginBottom: 10 },
  heading: { color: Colors.ink, fontSize: 15, fontWeight: "800", marginTop: 5 },
  copy: { color: Colors.muted, fontSize: 12, lineHeight: 19, marginVertical: 6 },
  error: { color: "#A02020", fontSize: 13, lineHeight: 20, marginVertical: 10 },
  card: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 14, padding: 15, marginVertical: 10 },
  label: { color: Colors.ink, fontSize: 10, fontWeight: "800", marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: Colors.background, borderColor: Colors.border, borderWidth: 1, padding: 12, borderRadius: 9, color: Colors.ink },
  choice: { padding: 8, borderColor: Colors.border, borderWidth: 1, borderRadius: 9, marginBottom: 5 },
  selected: { borderColor: Colors.primary, backgroundColor: "#E7F4EF" },
  button: { backgroundColor: Colors.primary, padding: 14, borderRadius: 10, alignItems: "center", marginTop: 12 },
  stop: { backgroundColor: "#A02020", padding: 14, borderRadius: 10, alignItems: "center", marginTop: 12 },
  buttonText: { color: Colors.white, fontWeight: "800" },
  disabled: { opacity: 0.4 }, link: { color: Colors.primary, fontWeight: "800", marginVertical: 8 },
  report: { borderTopColor: Colors.border, borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
});
