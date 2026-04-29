import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

// SCAFFOLD — apps/mobile/cashier (Cashier App)
// Android tablet billing — voice-first, barcode camera, counter-side workflow.

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Cashier App</Text>
      <Text style={styles.tag}>SCAFFOLD</Text>
      <Text style={styles.body}>Android tablet billing — voice-first, barcode camera, counter-side workflow.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A4338", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  tag:   { color: "#FF7A4A", fontSize: 12, fontWeight: "600", letterSpacing: 2, marginBottom: 16 },
  body:  { color: "#E5F4F0", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
