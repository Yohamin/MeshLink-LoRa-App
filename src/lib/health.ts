export type NodeHealth = {
  nodeId: string;
  bootId: string;
  uptimeMs: number;
  diagnosticRevision: number;
  diagnostics: Record<string, number>;
  lastFault: string;
  lastI2cOperation: string;
  supported: boolean;
  enabled: boolean;
  present: boolean;
  contact: boolean;
  heartRateValid: boolean;
  spo2Valid: boolean;
  state: string;
  heartRateBpm: number | null;
  spo2Percent: number | null;
  ageMs: number;
  sampleAgeMs: number;
  receivedAt: number;
  red: number | null;
  infrared: number | null;
  windowSamples: number;
  samplesReceived: number;
  fifoResets: number;
  i2cErrors: number;
};

export function normalizeHealth(packet: Record<string, unknown>, now = Date.now()): NodeHealth {
  const number = (key: string, fallback = -1) =>
    typeof packet[key] === "number" && Number.isFinite(packet[key])
      ? packet[key] as number : fallback;
  const supported = packet.supported === true;
  const enabled = packet.enabled === true;
  const present = packet.present === true;
  const contact = packet.contact === true;
  const ageMs = number("ageMs");
  const sampleAgeMs = number("sampleAgeMs");
  const usable = supported && enabled && present && contact && packet.experimental === true
    && packet.state === "reading" && ageMs >= 0 && ageMs <= 2500
    && sampleAgeMs >= 0 && sampleAgeMs <= 500;
  const heart = number("heartRateBpm");
  const oxygen = number("spo2Percent");
  const raw = (key: string) => {
    const value = number(key);
    return supported && enabled && present && sampleAgeMs >= 0 && sampleAgeMs <= 500
      && value >= 0 && value <= 262143 ? value : null;
  };
  return {
    nodeId: typeof packet.nodeId === "string" ? packet.nodeId.slice(0, 64) : "",
    bootId: typeof packet.bootId === "string" ? packet.bootId.slice(0, 32) : "",
    uptimeMs: number("uptimeMs"), diagnosticRevision: number("diagnosticRevision", 0),
    lastFault: typeof packet.lastFault === "string" ? packet.lastFault.slice(0, 64) : "",
    lastI2cOperation: typeof packet.lastI2cOperation === "string" ? packet.lastI2cOperation.slice(0, 32) : "",
    diagnostics: Object.fromEntries([
      "configAttempts", "configFailures", "ambientOverflows", "fifoOverflows", "sampleTimeouts",
      "sampleGaps", "powerEvents", "fifoResetsVerified", "fifoResetFailures", "recoveryLimitHits",
      "lastFaultAt", "lastI2cRegister", "lastI2cCode", "lastI2cExpected", "lastI2cReceived",
      "partId", "modeRegister", "configRegister", "fifoConfigRegister", "statusRegister",
      "fifoWrite", "fifoOverflow", "fifoRead", "resetWrite", "resetOverflow", "resetRead",
      "pausedMode", "resumedMode", "sdaPin", "sclPin",
    ].filter(key => typeof packet[key] === "number" && Number.isFinite(packet[key]))
      .map(key => [key, number(key)])),
    supported, enabled, present, contact,
    heartRateValid: usable && packet.heartRateValid === true && heart >= 20 && heart <= 300,
    spo2Valid: usable && packet.spo2Valid === true && oxygen >= 0 && oxygen <= 100,
    state: typeof packet.state === "string" ? packet.state.slice(0, 64) : "unknown",
    heartRateBpm: usable && packet.heartRateValid === true && heart >= 20 && heart <= 300 ? heart : null,
    spo2Percent: usable && packet.spo2Valid === true && oxygen >= 0 && oxygen <= 100 ? oxygen : null,
    ageMs, sampleAgeMs, receivedAt: now,
    red: raw("red"), infrared: raw("infrared"),
    windowSamples: Math.min(100, Math.max(0, Math.floor(number("windowSamples", 0)))),
    samplesReceived: Math.max(0, number("samplesReceived", 0)),
    fifoResets: Math.max(0, number("fifoResets", 0)),
    i2cErrors: Math.max(0, number("i2cErrors", 0)),
  };
}

export function healthIsFresh(health: NodeHealth | null, now = Date.now()): boolean {
  if (!health || now < health.receivedAt) return false;
  const elapsed = now - health.receivedAt;
  return health.supported && health.enabled && health.present && health.contact
    && health.state === "reading" && health.ageMs >= 0 && health.ageMs + elapsed <= 2500
    && health.sampleAgeMs >= 0 && health.sampleAgeMs + elapsed <= 2500
    && (health.heartRateBpm !== null || health.spo2Percent !== null);
}

export function healthStatusText(health: NodeHealth | null, now = Date.now()): string {
  if (!health) return "Esperando estado del sensor";
  if (!health.enabled) return "Sensor desactivado";
  if (now < health.receivedAt || now - health.receivedAt > 3500) return "Sin actualización reciente del nodo";
  if (health.state === "starting") return "Iniciando sensor";
  const faults: Record<string, string> = {
    ambient_overflow: "Saturación de luz; medición interrumpida", fifo_overflow: "Desbordamiento FIFO",
    no_samples: "Sensor responde, pero no entrega muestras", sample_gap: "Muestras interrumpidas",
    power_event: "El sensor se reinició", config_error: "Configuración no verificada",
    fifo_reset_failed: "Falló la verificación del FIFO", fifo_recovery_failed: "Fallo FIFO persistente",
    i2c_error: "Falló la comunicación I²C", library_init_error: "Falló la inicialización",
  };
  if (faults[health.state]) return faults[health.state];
  if (!health.present) return "Sensor no detectado / revisar conexión I²C";
  if (health.state === "signal_reset") return "Muestras interrumpidas; reiniciando medición";
  if (!health.contact) return "Señal sin contacto suficiente; revisa la colocación";
  if (health.state === "warming") return `Recogiendo muestras: ${health.windowSamples}/100`;
  return healthIsFresh(health, now) ? "Estimación experimental reciente" : "Sin estimación reciente válida; mantén el dedo inmóvil";
}

// Technical availability only: never classify a person's condition from numbers.
export function healthSupportReading(health: NodeHealth | null, now = Date.now()) {
  const fresh = healthIsFresh(health, now);
  const heart = fresh && health ? health.heartRateBpm : null;
  const oxygen = fresh && health ? health.spo2Percent : null;
  const quality = heart !== null && oxygen !== null ? "available" : fresh ? "partial" : "unavailable";
  return { heart, oxygen, quality,
    measuredAt: fresh && health ? health.receivedAt - health.ageMs : null,
    label: quality === "available" ? "Lecturas recientes disponibles" : quality === "partial"
      ? "Medición parcial: un valor no está disponible" : "Medición no disponible; repetir",
    guidance: quality === "unavailable"
      ? "Revisa la conexión y la colocación del dedo; mantenlo inmóvil. Puedes comunicar que necesitas ayuda sin una lectura válida."
      : "La calidad indica disponibilidad técnica, no el estado de salud de la persona.",
  };
}
