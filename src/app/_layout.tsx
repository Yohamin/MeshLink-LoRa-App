import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { Colors } from "@/constants/colors";
import { MeshProvider } from "@/context/mesh-context";

export default function RootLayout() {
  return (
    <MeshProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: Colors.white,
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="connect"
          options={{ title: "Conectar nodo LoRa", presentation: "modal" }}
        />
        <Stack.Screen name="chat/[id]" options={{ title: "Conversación" }} />
      </Stack>
    </MeshProvider>
  );
}
