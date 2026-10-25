import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { Colors } from "@/constants/colors";
import { MeshProvider } from "@/context/mesh-context";
import { HealthMeasurementsProvider } from "@/context/health-measurements-context";

export default function RootLayout() {
  return (
    <MeshProvider>
      <HealthMeasurementsProvider>
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
        <Stack.Screen name="field-tests" options={{ title: "Ensayos y métricas" }} />
        <Stack.Screen name="health-measurements" options={{ title: "Apoyo en emergencias" }} />
      </Stack>
      </HealthMeasurementsProvider>
    </MeshProvider>
  );
}
