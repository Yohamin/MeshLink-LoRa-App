import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useMesh } from "./mesh-context";
import { HealthJournal, type HealthArchive, type HealthSession } from "@/lib/health-journal";
import { createHealthShare, encodeHealthShare, healthShareRequestsHelp, type DeclaredCondition, type HealthShare } from "@/lib/health-share";

export type HealthProposal = { sessionId: string; nodeId: string; bootId: string; report: HealthShare; createdAt: number };
type Value = {
  sessions: HealthSession[]; activeId: string | null; ready: boolean; error: string | null;
  start: (label: string) => Promise<void>; stop: (reason?: string) => Promise<void>;
  archive: (id: string) => Promise<HealthArchive>; remove: (id: string) => Promise<void>;
  proposal: (declared: DeclaredCondition) => HealthProposal;
  share: (proposal: HealthProposal, destination: string) => Promise<void>;
};
const Context = createContext<Value | null>(null);
export function HealthMeasurementsProvider({ children }: React.PropsWithChildren) {
  const mesh = useMesh(), current = useRef(mesh); current.current = mesh;
  const mounted = useRef(true), foreground = useRef(AppState.currentState === "active");
  const [, update] = useState(0), [operationError, setOperationError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null), starting = useRef(false), lifecycle = useRef(0);
  const journalRef = useRef<HealthJournal | null>(null);
  if (!journalRef.current) journalRef.current = new HealthJournal(AsyncStorage, () => {
    if (!journalRef.current?.activeId) inFlight.current?.abort();
    if (mounted.current) update(n => n + 1);
  });
  const journal = journalRef.current;
  const stop = async (reason = "manual") => {
    ++lifecycle.current;
    inFlight.current?.abort();
    await journal.stop(reason);
  };
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => {
    mounted.current = true;
    void journal.init().catch(e => setOperationError(String(e)));
    const unsubscribe = mesh.subscribeHealth(h => {
      if (foreground.current && journal.activeId) void journal.capture(h).catch(e => {
        inFlight.current?.abort(); setOperationError(e instanceof Error ? e.message : String(e));
      });
    });
    const subscription = AppState.addEventListener("change", state => {
      foreground.current = state === "active";
      if (!foreground.current) void stopRef.current("app_background").catch(e => setOperationError(String(e)));
    });
    return () => { mounted.current = false; unsubscribe(); subscription.remove(); inFlight.current?.abort(); };
  }, [journal, mesh.subscribeHealth]);
  useEffect(() => {
    if (!journal.activeId) return;
    const session = journal.sessions.find(s => s.id === journal.activeId);
    if (mesh.connectionState !== "connected" || mesh.nodeInfo?.nodeId !== session?.nodeId ||
        mesh.nodeInfo?.bootId !== session?.bootId || mesh.trialState.active || mesh.health?.enabled === false) {
      void stopRef.current("link_or_sensor_changed").catch(e => setOperationError(String(e)));
    }
  }, [journal, mesh.connectionState, mesh.nodeInfo, mesh.trialState.active, mesh.health?.enabled]);
  const start = async (label: string) => {
    if (starting.current) throw new Error("Ya se está abriendo una sesión.");
    const m = current.current, h = m.health, n = m.nodeInfo, epoch = lifecycle.current;
    if (!foreground.current || m.connectionState !== "connected" || m.connectedDevice?.isDemo || m.trialState.active ||
        !n?.healthSupported || !n.bootId || !h?.enabled || h.bootId !== n.bootId || h.nodeId !== n.nodeId ||
        h.uptimeMs < 0 || Date.now() - h.receivedAt > 2500) {
      throw new Error("Conecta la V4 con firmware 5.6, activa el sensor y espera un estado reciente. No registres durante un ensayo de red.");
    }
    starting.current = true; setOperationError(null);
    try {
      await journal.start({ id: Crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
        label: label || "Medición MAX30102", nodeId: n.nodeId, bootId: n.bootId, board: n.board ?? "",
        firmwareVersion: n.firmwareVersion ?? "", appVersion: Constants.expoConfig?.version ?? "unknown",
        diagnosticRevision: h.diagnosticRevision, startedAt: Date.now() });
      const after = current.current;
      if (epoch !== lifecycle.current || !foreground.current || after.connectionState !== "connected" ||
          after.nodeInfo?.bootId !== n.bootId || after.nodeInfo?.nodeId !== n.nodeId) await journal.stop("start_interrupted");
    } finally { starting.current = false; }
  };
  const proposal = (declared: DeclaredCondition): HealthProposal => {
    const m = current.current, s = journal.sessions.find(s => s.id === journal.activeId);
    if (!s || !foreground.current || m.connectionState !== "connected" || m.nodeInfo?.nodeId !== s.nodeId || m.nodeInfo?.bootId !== s.bootId ||
      m.health?.nodeId !== s.nodeId || m.health?.bootId !== s.bootId) {
      throw new Error("Inicia una sesión local antes de compartir una instantánea.");
    }
    const report = createHealthShare(m.health, declared, s.id);
    encodeHealthShare(report);
    return { sessionId: s.id, nodeId: s.nodeId, bootId: s.bootId, report, createdAt: Date.now() };
  };
  const share = async (p: HealthProposal, destination: string) => {
    const m = current.current;
    if (inFlight.current) throw new Error("Espera a que finalice el envío actual.");
    if (!foreground.current || journal.activeId !== p.sessionId || m.nodeInfo?.nodeId !== p.nodeId ||
      m.nodeInfo?.bootId !== p.bootId || m.health?.nodeId !== p.nodeId || m.health?.bootId !== p.bootId ||
      Date.now() < p.createdAt || Date.now() - p.createdAt > 30000 ||
      !destination || destination === p.nodeId || m.trialState.active) throw new Error("La confirmación caducó o cambió la sesión. Prepara otra instantánea.");
    const signal = new AbortController(); inFlight.current = signal;
    const requestId = Crypto.randomUUID(), wire = encodeHealthShare(p.report);
    const log = (outcome: "attempt" | "submitted" | "failed") => journal.logShare({ at: Date.now(), type: "share", destination,
      report: p.report, outcome, requestId }, p.sessionId);
    try {
      await log("attempt");
      if (signal.signal.aborted || journal.activeId !== p.sessionId) throw new Error("Envío cancelado al finalizar la sesión.");
      await current.current.sendMessage(destination, wire, { sensitive: true, sendSignal: signal.signal,
        notAfter: p.createdAt + 30000, sos: healthShareRequestsHelp(p.report), requestId });
      await log("submitted"); // BLE submission is NOT a receipt from the other phone.
    } catch (e) {
      await log("failed").catch(() => {}); throw e;
    } finally { inFlight.current = null; }
  };
  return <Context.Provider value={{ sessions: journal.sessions, activeId: journal.activeId, ready: journal.ready,
    error: journal.error ?? operationError, start, stop, proposal, share,
    archive: id => journal.archive(id), remove: id => journal.remove(id) }}>{children}</Context.Provider>;
}
export function useHealthMeasurements() {
  const value = useContext(Context); if (!value) throw new Error("Falta HealthMeasurementsProvider."); return value;
}
