import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors } from "@/constants/colors";
import { BROADCAST_ID, EMERGENCY_PRESETS } from "@/constants/mesh";
import { useMesh } from "@/context/mesh-context";
import { formatTime, utf8Length } from "@/lib/text";
import type { MeshMessage } from "@/types/mesh";

function DeliveryIcon({ message }: { message: MeshMessage }) {
  if (message.direction === "incoming") return null;
  const color =
    message.status === "delivered"
      ? Colors.info
      : message.status === "failed"
        ? Colors.danger
        : message.status === "unconfirmed"
          ? Colors.warning
          : Colors.muted;
  const name =
    message.status === "delivered"
      ? "checkmark-done"
      : message.status === "queued"
        ? "time-outline"
        : message.status === "failed"
          ? "alert-circle"
          : message.status === "unconfirmed"
            ? "help-circle"
            : "checkmark";
  return <Ionicons name={name} size={14} color={color} />;
}

function MessageBubble({ message }: { message: MeshMessage }) {
  const outgoing = message.direction === "outgoing";
  return (
    <View style={[styles.messageRow, outgoing && styles.messageRowOutgoing]}>
      <View
        style={[
          styles.bubble,
          outgoing ? styles.outgoingBubble : styles.incomingBubble,
          message.sos && styles.sosBubble,
        ]}
      >
        {!outgoing && <Text style={styles.sender}>{message.senderName}</Text>}
        {message.sos && (
          <View style={styles.sosHeader}>
            <Ionicons name="warning" size={14} color={Colors.danger} />
            <Text style={styles.sosHeaderText}>EMERGENCIA</Text>
          </View>
        )}
        <Text style={styles.messageText}>{message.text}</Text>
        <View style={styles.metaRow}>
          {message.encrypted && (
            <Ionicons name="lock-closed" size={10} color={Colors.muted} />
          )}
          <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
          <DeliveryIcon message={message} />
        </View>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id ?? BROADCAST_ID;
  const {
    conversations,
    connectionState,
    messages,
    maxMessageBytes,
    encryptionEnabled,
    sendMessage,
    sendLocationSos,
  } = useMesh();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const listRef = useRef<FlatList<MeshMessage>>(null);

  const conversation = conversations.find((item) => item.id === conversationId);
  const conversationMessages = useMemo(
    () => messages.filter((message) => message.conversationId === conversationId),
    [conversationId, messages],
  );
  const byteCount = utf8Length(text.trim());
  const tooLong = byteCount > maxMessageBytes;
  const isBroadcast = conversationId === BROADCAST_ID;

  const performSend = async (message: string, sos = false) => {
    if (sending) return;
    setSending(true);
    try {
      await sendMessage(conversationId, message, { sos });
      setText("");
      if (sos) setShowEmergency(false);
    } catch (error) {
      Alert.alert("No se pudo enviar", error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  const sendLocation = async () => {
    setSending(true);
    try {
      await sendLocationSos(conversationId);
      setShowEmergency(false);
    } catch (error) {
      Alert.alert("No se pudo enviar la ubicación", error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <Stack.Screen
        options={{
          title: conversation?.name ?? conversationId,
          headerRight: () => (
            <View style={[styles.headerStatus, connectionState === "connected" && styles.headerStatusOnline]}>
              <Text style={styles.headerStatusText}>
                {connectionState === "connected" ? "RADIO" : "SIN CONEXIÓN"}
              </Text>
            </View>
          ),
        }}
      />
      <SafeAreaView edges={["bottom"]} style={styles.safe}>
        {isBroadcast && (
          <View style={styles.broadcastNotice}>
            <Ionicons name="megaphone" size={17} color={Colors.danger} />
            <Text style={styles.broadcastText}>
              La difusión llega a los nodos dentro del alcance directo de radio y no tiene confirmación de entrega.
            </Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          data={conversationMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name={isBroadcast ? "megaphone" : "chatbubble-ellipses"} size={34} color={Colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Inicia una conversación sin red</Text>
              <Text style={styles.emptyText}>Mantén los mensajes breves. La entrega puede tardar varios segundos a través de la malla.</Text>
            </View>
          }
        />

        {showEmergency && (
          <View style={styles.emergencyPanel}>
            <View style={styles.emergencyTitleRow}>
              <Ionicons name="warning" size={18} color={Colors.danger} />
              <Text style={styles.emergencyTitle}>Enviar SOS prioritario</Text>
              <TouchableOpacity style={styles.closeEmergency} onPress={() => setShowEmergency(false)}>
                <Ionicons name="close" size={20} color={Colors.muted} />
              </TouchableOpacity>
            </View>
            <View style={styles.presetRow}>
              {EMERGENCY_PRESETS.map((preset) => (
                <TouchableOpacity key={preset.label} style={styles.preset} onPress={() => void performSend(preset.message, true)}>
                  <Text style={styles.presetText}>{preset.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.locationPreset} onPress={() => void sendLocation()}>
                <Ionicons name="location" size={16} color={Colors.white} />
                <Text style={styles.locationPresetText}>Ubicación</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.emergencyNote}>El firmware actual marca los paquetes SOS, pero todavía no interrumpe los mensajes que ya se están transmitiendo.</Text>
          </View>
        )}

        <View style={styles.composerArea}>
          <View style={styles.securityRow}>
            <Ionicons name={encryptionEnabled ? "lock-closed" : "lock-open"} size={11} color={Colors.muted} />
            <Text style={styles.securityText}>{encryptionEnabled ? "AES-256-GCM" : "SIN CIFRAR"}</Text>
            <Text style={[styles.counter, tooLong && styles.counterError]}>{byteCount}/{maxMessageBytes} bytes</Text>
          </View>
          <View style={styles.composerRow}>
            <TouchableOpacity
              accessibilityLabel="Mensajes de emergencia"
              style={[styles.sosButton, showEmergency && styles.sosButtonActive]}
              onPress={() => setShowEmergency((current) => !current)}
            >
              <Text style={styles.sosButtonText}>SOS</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={isBroadcast ? "Difunde un mensaje breve" : "Mensaje"}
              placeholderTextColor={Colors.muted}
              multiline
              maxLength={80}
              editable={!sending}
            />
            <TouchableOpacity
              accessibilityLabel="Enviar mensaje"
              style={[styles.sendButton, (!text.trim() || tooLong || sending) && styles.sendDisabled]}
              disabled={!text.trim() || tooLong || sending}
              onPress={() => void performSend(text)}
            >
              <Ionicons name="send" size={20} color={Colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { backgroundColor: Colors.background, flex: 1 },
  headerStatus: { backgroundColor: "#6E827C", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4 },
  headerStatusOnline: { backgroundColor: Colors.accent },
  headerStatusText: { color: Colors.white, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  broadcastNotice: { alignItems: "center", backgroundColor: Colors.dangerSoft, flexDirection: "row", gap: 8, paddingHorizontal: 15, paddingVertical: 10 },
  broadcastText: { color: Colors.danger, flex: 1, fontSize: 11, lineHeight: 15 },
  messageList: { flexGrow: 1, padding: 12, paddingBottom: 18 },
  messageRow: { alignItems: "flex-start", marginVertical: 3 },
  messageRowOutgoing: { alignItems: "flex-end" },
  bubble: { borderRadius: 14, maxWidth: "84%", minWidth: 88, paddingHorizontal: 11, paddingVertical: 8 },
  incomingBubble: { backgroundColor: Colors.incoming, borderBottomLeftRadius: 3 },
  outgoingBubble: { backgroundColor: Colors.outgoing, borderBottomRightRadius: 3 },
  sosBubble: { borderColor: Colors.danger, borderWidth: 1 },
  sender: { color: Colors.primary, fontSize: 11, fontWeight: "900", marginBottom: 3 },
  sosHeader: { alignItems: "center", flexDirection: "row", gap: 4, marginBottom: 4 },
  sosHeaderText: { color: Colors.danger, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  messageText: { color: Colors.ink, fontSize: 15, lineHeight: 20 },
  metaRow: { alignItems: "center", alignSelf: "flex-end", flexDirection: "row", gap: 3, marginTop: 4 },
  time: { color: Colors.muted, fontSize: 9 },
  empty: { alignItems: "center", flex: 1, justifyContent: "center", padding: 38 },
  emptyIcon: { alignItems: "center", backgroundColor: Colors.accentSoft, borderRadius: 35, height: 70, justifyContent: "center", width: 70 },
  emptyTitle: { color: Colors.ink, fontSize: 17, fontWeight: "900", marginTop: 14 },
  emptyText: { color: Colors.muted, lineHeight: 19, marginTop: 6, textAlign: "center" },
  emergencyPanel: { backgroundColor: Colors.dangerSoft, borderTopColor: "#F5B8BD", borderTopWidth: 1, padding: 12 },
  emergencyTitleRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  emergencyTitle: { color: Colors.danger, fontSize: 13, fontWeight: "900" },
  closeEmergency: { marginLeft: "auto" },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  preset: { backgroundColor: Colors.surface, borderColor: "#F1A4AA", borderRadius: 99, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  presetText: { color: Colors.danger, fontSize: 11, fontWeight: "900" },
  locationPreset: { alignItems: "center", backgroundColor: Colors.danger, borderRadius: 99, flexDirection: "row", gap: 4, paddingHorizontal: 12, paddingVertical: 8 },
  locationPresetText: { color: Colors.white, fontSize: 11, fontWeight: "900" },
  emergencyNote: { color: Colors.danger, fontSize: 9, lineHeight: 13, marginTop: 9 },
  composerArea: { backgroundColor: Colors.surface, borderTopColor: Colors.border, borderTopWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  securityRow: { alignItems: "center", flexDirection: "row", gap: 4, marginBottom: 5, paddingHorizontal: 58 },
  securityText: { color: Colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  counter: { color: Colors.muted, fontSize: 9, marginLeft: "auto" },
  counterError: { color: Colors.danger, fontWeight: "900" },
  composerRow: { alignItems: "flex-end", flexDirection: "row", gap: 7 },
  sosButton: { alignItems: "center", borderColor: Colors.danger, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 48 },
  sosButtonActive: { backgroundColor: Colors.dangerSoft },
  sosButtonText: { color: Colors.danger, fontSize: 11, fontWeight: "900" },
  input: { backgroundColor: Colors.background, borderColor: Colors.border, borderRadius: 22, borderWidth: 1, color: Colors.ink, flex: 1, fontSize: 15, maxHeight: 104, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10 },
  sendButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  sendDisabled: { backgroundColor: "#9CB5AE" },
});
