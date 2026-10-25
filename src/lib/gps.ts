export type NodeGps = {
  supported: boolean;
  enabled: boolean;
  hasFix: boolean;
  latitude: number | null;
  longitude: number | null;
  satellites: number;
  ageMs: number;
  receivedAt: number;
  bytesReceived: number;
  validSentences: number;
  badSentences: number;
};

export function normalizeGps(packet: Record<string, unknown>, now = Date.now()): NodeGps {
  const number = (key: string, fallback = 0) =>
    typeof packet[key] === "number" && Number.isFinite(packet[key])
      ? packet[key] as number : fallback;
  const latitude = number("latitude", NaN);
  const longitude = number("longitude", NaN);
  const ageMs = number("ageMs", -1);
  const hasFix = packet.supported === true && packet.enabled === true && packet.hasFix === true
    && ageMs >= 0 && ageMs <= 10_000
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return {
    supported: packet.supported === true,
    enabled: packet.enabled === true,
    hasFix,
    latitude: hasFix ? latitude : null,
    longitude: hasFix ? longitude : null,
    satellites: Math.max(0, Math.floor(number("satellites"))),
    ageMs,
    receivedAt: now,
    bytesReceived: number("bytesReceived"),
    validSentences: number("validSentences"),
    badSentences: number("badSentences"),
  };
}

export function gpsIsFresh(gps: NodeGps | null, now = Date.now()): boolean {
  return !!gps && gps.supported && gps.enabled && gps.hasFix
    && now >= gps.receivedAt && gps.ageMs + now - gps.receivedAt <= 10_000;
}

export function gpsSosText(gps: NodeGps, now = Date.now()): string {
  if (!gpsIsFresh(gps, now) || gps.latitude === null || gps.longitude === null) {
    throw new Error("El GPS del nodo no tiene una posición reciente. Espera una fijación al aire libre.");
  }
  // Max 24 ASCII bytes, including the signs, below the 32-byte AES limit.
  return `SOS ${gps.latitude.toFixed(5)},${gps.longitude.toFixed(5)}`;
}
