import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Screen } from "@/components/screen";
import { Colors } from "@/constants/colors";
import { BROADCAST_ID, DEMO_NETWORK_KEY } from "@/constants/mesh";
import { useMesh } from "@/context/mesh-context";
import { useHealthMeasurements } from "@/context/health-measurements-context";
import { healthStatusText, healthSupportReading } from "@/lib/health";
import { HEALTH_MAX_RECORDS, healthArchiveCsv, type HealthArchive } from "@/lib/health-journal";
import { declaredChoices, declaredLabels, decodeHealthShare, formatHealthShare, type DeclaredCondition } from "@/lib/health-share";
import { exportMetricFile } from "@/lib/metric-export";

export default function HealthMeasurementsScreen() {
  const mesh = useMesh(), measurement = useHealthMeasurements();
  const [label, setLabel] = useState(""), [destination, setDestination] = useState(BROADCAST_ID);
  const [declared, setDeclared] = useState<DeclaredCondition>("N"), [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<HealthArchive | null>(null), [limit, setLimit] = useState(15);
  const [now, setNow] = useState(Date.now());
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const stop = useRef(measurement.stop); stop.current = measurement.stop;
  useFocusEffect(useCallback(() => () => { void stop.current("screen_left").catch(() => {}); }, []));
  const fail = (e: unknown) => Alert.alert("Apoyo en emergencias", e instanceof Error ? e.message : String(e));
  const action = async (job: () => Promise<unknown>) => {
    if (busy) return; setBusy(true);
    try { await job(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const start = () => Alert.alert("¿Guardar una sesión de medición?",
    "Usa un alias o código de participante y su consentimiento. Se guardarán estimaciones, Rojo/IR, estados y errores en este teléfono, sin cifrado adicional en reposo. No hay diagnóstico ni envío automático. Salir de esta pantalla, perder BLE o bloquear el teléfono finaliza el registro; no se reanuda solo.",
    [{ text: "Cancelar", style: "cancel" }, { text: "Guardar sesión", onPress: () => void action(() => measurement.start(label)) }]);
  const share = () => {
    try {
      const proposal = measurement.proposal(declared), target = destination.trim();
      if (!target) throw new Error("Selecciona un destino.");
      Alert.alert(target === BROADCAST_ID ? "¿Difundir informe de apoyo por broadcast?" : "¿Enviar informe de apoyo?",
        `${formatHealthShare(proposal.report)}\n\nDestino: ${target === BROADCAST_ID ? "Todos los nodos en alcance directo, SIN ACK" : target}\n${target === BROADCAST_ID ? "Cualquiera con la clave de red podrá descifrarla. " : "El destino debe tener la misma clave. "}Se guardará también en los chats del emisor y receptor, sin cifrado adicional en reposo. No espera ni garantiza atención de una persona. Confirmación válida 30 segundos.`,
        [{ text: "Cancelar", style: "cancel" }, { text: "Compartir", onPress: () => void action(async () => {
          await measurement.share(proposal, target);
          Alert.alert("Entregado al transporte BLE", "Comprueba el estado en Chats. Esto no confirma recepción en el teléfono remoto ni lectura por una persona; broadcast no tiene ACK.");
        }) }]);
    } catch (e) { fail(e); }
  };
  const exportFile = (format: "csv" | "json") => void action(async () => {
    if (!archive) return;
    const latest = await measurement.archive(archive.session.id); setArchive(latest);
    await exportMetricFile(`MeshLink-MAX-${latest.session.id}.${format}`,
      format === "csv" ? healthArchiveCsv(latest) : JSON.stringify(latest, null, 2),
      format === "csv" ? "text/csv" : "application/json");
    Alert.alert("Exportado", "El archivo contiene datos sensibles y no está cifrado. Compártelo solo con autorización. La sesión original sigue en la app.");
  });
  const h = mesh.health, reading = healthSupportReading(h, now), active = measurement.sessions.find(s => s.id === measurement.activeId);
  const secure = mesh.encryptionEnabled && mesh.networkKey !== DEMO_NETWORK_KEY && mesh.networkKey.trim().length >= 12;
  const shareDisabled = busy || !active || !secure || mesh.connectionState !== "connected" || !!measurement.error;
  const received = mesh.messages.filter(m => m.direction === "incoming" && decodeHealthShare(m.text)).slice(-10).reverse();
  return <Screen scroll>
    <Text style={styles.title}>Apoyo en emergencias</Text>
    <Text style={styles.copy}>Comparte cómo se siente la persona y sus mediciones para coordinar ayuda.</Text>
    <Text style={styles.warning}>Uso orientativo · MAX30102 experimental. No sustituye una evaluación médica. Si necesitas ayuda, comunícalo sin esperar al sensor.</Text>
    {!!measurement.error && <Text accessibilityRole="alert" style={styles.error}>{measurement.error} Registro detenido; intenta exportar los datos disponibles. Tras resolver almacenamiento, reinicia la app.</Text>}
    <View style={styles.card}>
      <Text style={styles.heading}>1. ¿Cómo se siente la persona?</Text>
      <Text style={styles.copy}>Estado declarado por la persona o por quien la asiste. No lo calcula el sensor.</Text>
      {declaredChoices.map(c => <TouchableOpacity key={c}
        style={[styles.choice, declared === c && styles.selected, c === "A" && declared === c && styles.helpSelected]}
        accessibilityRole="radio" accessibilityState={{ selected: declared === c }} disabled={busy}
        onPress={() => setDeclared(c)}><Text style={styles.copy}>{declaredLabels[c]}{c === "A" ? " · SOS" : ""}</Text></TouchableOpacity>)}
      <Text style={styles.small}>Seleccionar una opción no envía nada. «Necesito ayuda» marca como SOS el informe que revises y confirmes; no activa asistencia automática.</Text>
      {(declared === "A" || declared === "M") && <Text style={styles.notice}>Comunica la situación y contacta a alguien que pueda ayudar. No esperes una medición para pedir ayuda.</Text>}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>2. Mediciones de apoyo</Text>
      <Text style={styles.small}>Nodo: {mesh.nodeInfo?.nodeName ?? "Sin conexión"}</Text>
      <View style={styles.row}><Text style={styles.copy}>Leer sensor del nodo</Text><Switch value={h?.enabled === true}
        disabled={busy || mesh.connectionState !== "connected" || !mesh.nodeInfo?.healthSupported || !h}
        onValueChange={enabled => void action(() => mesh.setNodeHealthEnabled(enabled))} /></View>
      <Text style={styles.value}>Pulso estimado: {reading.heart ?? "—"} lpm</Text>
      <Text style={styles.value}>SpO₂ estimada: {reading.oxygen ?? "—"} %</Text>
      <Text style={styles.notice}>Calidad de medición: {reading.label}</Text>
      <Text style={styles.copy}>{reading.guidance}</Text>
      <Text style={styles.small}>{reading.measuredAt === null ? "Sin hora de medición válida reciente." : `Hora de medición en este teléfono: ${new Date(reading.measuredAt).toLocaleTimeString()}`}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showDiagnostics }} onPress={() => setShowDiagnostics(v => !v)}>
        <Text style={styles.link}>{showDiagnostics ? "Ocultar" : "Ver"} detalles técnicos del sensor</Text>
      </TouchableOpacity>
      {showDiagnostics && <>
        <Text style={styles.copy}>{healthStatusText(h, now)}</Text>
        <Text style={styles.small}>Últimos datos técnicos recibidos · Rojo: {h?.red ?? "—"} · IR: {h?.infrared ?? "—"}{"\n"}Muestras: {h?.samplesReceived ?? 0} · FIFO: {h?.fifoResets ?? 0} · I²C: {h?.i2cErrors ?? 0}</Text>
        <Text style={styles.small}>Guardar requiere V4 con firmware 5.6. V3 puede recibir informes; no adquiere MAX30102. No hay clasificación ni alarmas médicas automáticas.</Text>
      </>}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>3. Guardar el registro</Text>
      <TextInput accessibilityLabel="Alias de sesión" style={styles.input} placeholder="Código o alias del participante (opcional)" maxLength={60}
        editable={!active && !busy} value={label} onChangeText={setLabel} />
      <Text style={styles.copy}>Se guardan las instantáneas recibidas por BLE (~1/s), incluidos valores inválidos como ausentes, no como cero. No es la señal completa de 25 Hz. Máximo {HEALTH_MAX_RECORDS} registros por sesión. Mantén esta pantalla visible.</Text>
      <Text style={styles.small}>Inicia el registro para compartir desde este apartado, incluso si no hay lectura válida. Debes tener el sensor activado y un estado reciente del nodo. Finalizar el registro no apaga el sensor.</Text>
      {active ? <><Text accessibilityLiveRegion="polite" style={styles.copy}>Guardando: {active.records} registros · {active.id}</Text>
        <TouchableOpacity style={styles.stop} onPress={() => void measurement.stop().catch(fail)}><Text style={styles.white}>Finalizar registro / cancelar envío pendiente</Text></TouchableOpacity></> :
        <TouchableOpacity style={styles.button} disabled={busy || !measurement.ready || !!measurement.error} onPress={start}><Text style={styles.white}>Iniciar registro con consentimiento</Text></TouchableOpacity>}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>4. Comunicar y coordinar ayuda</Text>
      <Text style={styles.copy}>Estado a compartir: {declaredLabels[declared]} (declarado).</Text>
      <Text style={styles.copy}>Solo envío manual. No se envía la sesión completa, Rojo/IR ni GPS. La hora es la indicada por el emisor, sin sincronización entre teléfonos.</Text>
      <Text style={styles.small}>Si falta una medición, el informe lo indicará; eso no impide compartir el estado declarado. Si no puedes registrar, puedes enviar un SOS de texto desde Chats.</Text>
      <TouchableOpacity style={[styles.choice, destination === BROADCAST_ID && styles.selected]} onPress={() => setDestination(BROADCAST_ID)}><Text style={styles.copy}>Broadcast · todos en alcance directo, sin ACK</Text></TouchableOpacity>
      {mesh.nodes.filter(n => n.id !== mesh.nodeInfo?.nodeId).map(n => <TouchableOpacity key={n.id} style={[styles.choice, destination === n.id && styles.selected]}
        onPress={() => setDestination(n.id)}><Text style={styles.copy}>{n.name} · {n.id}</Text></TouchableOpacity>)}
      <TextInput accessibilityLabel="Nodo destinatario" style={styles.input} value={destination} onChangeText={setDestination} maxLength={64} autoCapitalize="none" />
      {!secure && <Text style={styles.error}>Antes de compartir, activa el cifrado y configura una clave propia de al menos 12 caracteres en ambos teléfonos.</Text>}
      {!active && <Text style={styles.small}>Para habilitar el envío, inicia el registro en el paso 3.</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: shareDisabled }}
        style={[declared === "A" ? styles.stop : styles.button, shareDisabled && styles.disabled]} disabled={shareDisabled} onPress={share}>
        <Text style={styles.white}>{declared === "A" ? "Revisar solicitud de ayuda (SOS)" : "Revisar informe y destinatario"}</Text></TouchableOpacity>
    </View>
    <Text style={styles.heading}>Historial local · {measurement.sessions.length}</Text>
    <Text style={styles.small}>No se borra al limpiar chats. Desinstalar o borrar datos de la app puede eliminarlo. Exportaciones sin cifrar; datos privados del participante.</Text>
    {[...measurement.sessions].reverse().slice(0, limit).map(s => <TouchableOpacity key={s.id} style={styles.card} disabled={busy}
      onPress={() => void action(async () => setArchive(await measurement.archive(s.id)))}>
      <Text style={styles.heading}>{s.label}</Text><Text style={styles.copy}>{new Date(s.startedAt).toLocaleString()} · {s.records} registros{"\n"}{s.nodeId} · {s.endedAt === null ? "En curso" : `Finalizada: ${s.endReason}`}</Text>
      <Text style={styles.link}>Ver sesión y exportar</Text></TouchableOpacity>)}
    {measurement.sessions.length > limit && <TouchableOpacity onPress={() => setLimit(limit + 15)}><Text style={styles.link}>Mostrar más</Text></TouchableOpacity>}
    {archive && <View style={styles.card}><Text style={styles.heading}>Sesión {archive.session.id}</Text>
      <Text style={styles.copy}>{archive.session.label} · {archive.records.filter(r => r.type === "sample").length} instantáneas{"\n"}{archive.coverage}</Text>
      <TouchableOpacity style={styles.button} disabled={busy} onPress={() => Alert.alert("¿Exportar datos sensibles sin cifrar?", "El archivo contiene mediciones fisiológicas y el alias del participante.", [
        { text: "Cancelar", style: "cancel" }, { text: "CSV", onPress: () => exportFile("csv") }, { text: "JSON", onPress: () => exportFile("json") }])}><Text style={styles.white}>Exportar CSV o JSON</Text></TouchableOpacity>
      <TouchableOpacity style={styles.stop} disabled={busy || archive.session.id === measurement.activeId} onPress={() => Alert.alert("¿Borrar esta sesión local?", "No se borrarán archivos exportados ni informes enviados a los chats u otros teléfonos.", [
        { text: "Cancelar", style: "cancel" }, { text: "Borrar", style: "destructive", onPress: () => void action(async () => { await measurement.remove(archive.session.id); setArchive(null); }) }])}><Text style={styles.white}>Borrar sesión</Text></TouchableOpacity>
    </View>}
    <Text style={styles.heading}>Informes recibidos · últimos 10 en chats</Text>
    {received.length === 0 && <Text style={styles.copy}>Aquí verás los informes de apoyo que recibas por LoRa.</Text>}
    {received.map(m => <View key={m.id} style={styles.card}><Text style={styles.heading}>{m.senderName}</Text>
      <Text style={styles.copy}>{formatHealthShare(decodeHealthShare(m.text)!)}</Text>
      <Text style={styles.small}>Contacta a la persona para conocer su situación actual. Un informe recibido no confirma atención.</Text>
      <Text style={styles.small}>Recibido en este teléfono: {new Date(m.createdAt).toLocaleString()}. Informe remoto, no lectura local ni identidad certificada.</Text></View>)}
    <Text style={styles.small}>Los informes recibidos siguen la retención del historial de chats (últimos 500 mensajes globales). La sesión completa solo está en el teléfono que la registró.</Text>
  </Screen>;
}
const styles = StyleSheet.create({
  title: { fontSize: 27, fontWeight: "800", color: Colors.ink, marginBottom: 12 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 10, marginVertical: 8 },
  heading: { fontSize: 18, fontWeight: "700", color: Colors.ink, marginTop: 8 },
  copy: { color: Colors.ink, fontSize: 14, lineHeight: 21 }, small: { color: Colors.muted, fontSize: 12, lineHeight: 18 },
  value: { color: Colors.ink, fontSize: 22, fontWeight: "700" }, warning: { backgroundColor: Colors.warningSoft, padding: 12, borderRadius: 10, color: Colors.warning, lineHeight: 21 },
  error: { color: Colors.danger, backgroundColor: Colors.dangerSoft, padding: 10, borderRadius: 8 },
  input: { borderColor: Colors.border, borderWidth: 1, borderRadius: 10, padding: 12, color: Colors.ink },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  button: { padding: 14, borderRadius: 10, backgroundColor: Colors.primary, alignItems: "center", marginTop: 6 },
  stop: { padding: 14, borderRadius: 10, backgroundColor: Colors.danger, alignItems: "center", marginTop: 6 },
  white: { color: Colors.white, fontWeight: "700" }, choice: { padding: 10, borderRadius: 8, borderColor: Colors.border, borderWidth: 1 },
  selected: { backgroundColor: Colors.accentSoft, borderColor: Colors.primary }, link: { color: Colors.primary, fontWeight: "700" },
  helpSelected: { backgroundColor: Colors.dangerSoft, borderColor: Colors.danger },
  notice: { color: Colors.ink, backgroundColor: Colors.surfaceMuted, padding: 10, borderRadius: 8, lineHeight: 21 },
  disabled: { opacity: 0.45 },
});
