import { Platform } from "react-native";
import { StorageAccessFramework } from "expo-file-system/legacy";

export async function exportMetricFile(name: string, contents: string, mime: string) {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (Platform.OS !== "android") throw new Error("La exportación de archivos está preparada para Android y web.");
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) throw new Error("No se seleccionó una carpeta; el historial sigue guardado en la app.");
  const uri = await StorageAccessFramework.createFileAsync(permission.directoryUri, name, mime);
  await StorageAccessFramework.writeAsStringAsync(uri, contents);
}
