// SCAFFOLD — Apple Vision Pro entry. Implement per ADR-0063.

import SwiftUI

@main
struct PharmaCareApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.volumetric)
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("PharmaCare").font(.largeTitle).bold()
            Text("SCAFFOLD").font(.caption).foregroundStyle(.secondary)
            Text("Spatial pharmacy OS for Apple Vision Pro").multilineTextAlignment(.center)
        }
        .padding(40)
    }
}
