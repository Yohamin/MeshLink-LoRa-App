export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatRelativeTime(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

export function signalLabel(rssi?: number): string {
  if (rssi === undefined || rssi === 0) return "Desconocida";
  if (rssi >= -70) return "Fuerte";
  if (rssi >= -90) return "Buena";
  if (rssi >= -110) return "Débil";
  return "Muy débil";
}

export function shortNodeId(nodeId: string): string {
  if (nodeId.length <= 12) return nodeId;
  return `${nodeId.slice(0, 5)}…${nodeId.slice(-5)}`;
}
