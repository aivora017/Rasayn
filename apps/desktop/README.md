# @pharmacare/desktop

Tauri 2 desktop POS. Keyboard-first. LAN-local SQLite.

## Prereqs on your Windows box
- Rust stable: `winget install Rustlang.Rustup` → `rustup default stable`
- WebView2 Runtime (preinstalled on Win11; installer ships for Win7/8/10)
- MS Build Tools (Desktop C++)

## Dev
```
npm install        # from monorepo root
cd apps/desktop
npm run tauri dev  # spins Vite + Rust
```

## Frontend-only (headless, for CI)
```
npm run build      # vite build → dist/
npm run test       # vitest (jsdom)
```

## Bundle (Windows installer)
```
npm run tauri build --target x86_64-pc-windows-msvc
```

## Keyboard shortcuts
- F1 Billing · F2 Inventory · F3 Reports
- F6 Add line · F9 Save bill
