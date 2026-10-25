import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { TelemetryJournal, type MetricSession } from "@/lib/telemetry";
import { TrialCoordinator, type TrialView } from "@/lib/trial-coordinator";
import { meshBleService } from "@/services/mesh-ble";

export function useFieldTests(transmit: (to: string, text: string, requestId: string, signal: AbortSignal) => Promise<void>) {
  const [sessions, setSessions] = useState<MetricSession[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<TrialView>({ armed: false, active: false, phase: "idle", received: 0, remoteSaved: false });
  const alive = useRef(true);
  const screenMode = useRef(false);
  const journal = useRef<TelemetryJournal | null>(null);
  if (!journal.current) journal.current = new TelemetryJournal(AsyncStorage, () => {
    if (alive.current) setSessions(journal.current!.sessions.map(s => ({ ...s })));
  });
  const coordinator = useRef<TrialCoordinator | null>(null);
  if (!coordinator.current) coordinator.current = new TrialCoordinator({
    journal: journal.current,
    uuid: () => Crypto.randomUUID(), transmit,
    environment: { appVersion: Constants.expoConfig?.version ?? "1.4.1", appBuild: Constants.expoConfig?.android?.versionCode ?? -1,
      platform: Platform.OS, osVersion: String(Platform.Version) },
    query: (cmd, requestId) => meshBleService.writeJson({ cmd, requestId }),
    change: next => { if (alive.current) setView(next); },
    error: message => { if (alive.current) setError(`Registro de ensayo: ${message}`); },
  });
  useEffect(() => {
    alive.current = true;
    void journal.current!.init().then(() => { if (alive.current) setReady(true); })
      .catch(e => { if (alive.current) setError(String(e)); });
    const subscription = AppState.addEventListener("change", state => coordinator.current!.setArmed(screenMode.current && state === "active"));
    return () => { alive.current = false; coordinator.current!.setArmed(false); subscription.remove(); };
  }, []);
  const setMode = useCallback((enabled: boolean) => {
    screenMode.current = enabled;
    coordinator.current!.setArmed(enabled && (AppState.currentState === "active" || AppState.currentState == null));
  }, []);
  const receive = useCallback((packet: Record<string, unknown>) => {
    coordinator.current!.receive(packet);
    if (["ready", "info"].includes(String(packet.type)) && typeof packet.bootId === "string" && typeof packet.nodeId === "string") {
      setActiveSession(`${packet.demo === true ? "DEMO-" : ""}${packet.nodeId}-${packet.bootId}`);
    }
  }, []);
  return { sessions, activeSession, error, ready, progress: view.progress ?? null, view, setMode, receive,
    incoming: (text: string, packet: Record<string, unknown>, crypto?: Record<string, string | number | boolean>) => coordinator.current!.incoming(text, packet, crypto),
    append: (type: string, data: Record<string, string | number | boolean>) => coordinator.current!.append(type, data),
    resetLink: () => { coordinator.current!.resetLink(); setActiveSession(null); },
    running: () => coordinator.current!.busy(),
    updateLink: (link: Parameters<TrialCoordinator["updateLink"]>[0]) => coordinator.current!.updateLink(link),
    start: (destination: string, scenario: string, intervalMs: number) => {
      if (!ready || error) return Promise.reject(new Error(error ?? "El historial aún no está listo."));
      return coordinator.current!.start(destination, scenario, intervalMs);
    },
    cancel: () => coordinator.current!.cancel(),
    archive: (id: string) => journal.current!.archive(id),
  };
}
