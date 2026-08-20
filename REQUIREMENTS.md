# Wymagania Budowy, Konfiguracji i Uruchomienia Projektu (Build & Configuration Requirements)

Dokument zawiera kompletne zestawienie wymagań środowiskowych, sprzętowych, konfiguracji oraz instrukcji budowania i uruchamiania projektu **Theia Monorepo & CAN Bus Analyzer**.

---

## 1. Wymagania Środowiskowe i Systemowe (System & Environment Requirements)

| Wymaganie | Wersja / Opis | Uwagi |
| --- | --- | --- |
| **System Operacyjny** | Windows 10/11, Linux (Ubuntu/Debian/Arch), macOS | Przetestowane w środowisku Windows oraz Linux |
| **Node.js** | `>= 22` (Zalecane: **Node.js 24.x**) | Wymagany do uruchomienia całego monorepo i aplikacji Theia |
| **Menedżer pakietów** | **npm** (wbudowany w Node.js) | Polecenia projektu uruchamiaj przez `npm`. Obecny skrypt `start-pioarduino.ps1` dodatkowo wywołuje wewnętrznie Yarn Classic. |
| **Python** | Python 3.x | Wymagany przez `node-gyp` do kompilacji natywnych modułów C/C++ |
| **Git** | `>= 2.11.0` | Wymagany do pracy z repozytorium oraz wtyczką Git w Theia |
| **Kompilator C/C++** | **Windows:** Visual Studio Build Tools (C++ Desktop) / Scoop<br>**Linux:** `build-essential`, `g++`, `make`, `pkg-config`<br>**macOS:** Xcode Command Line Tools | Niezbędne do budowania natywnych zależności node-gyp (np. `serialport`, `keytar`, `native-keymap`) |

### Zależności dla systemów Linux (dla kompilacji natywnej):
```bash
sudo apt-get install build-essential g++ make pkg-config libx11-dev libxkbfile-dev libsecret-1-dev
```

---

## 2. Wymagania Sprzętowe i Interfejsowe (CAN Bus Hardware Requirements)

Dla celów rozszerzenia **CAN Bus Analyzer**:
- **Linux**: Obsługa SocketCAN (`vcan0` wirtualny lub fizyczne interfejsy `can0`, `can1`).
- **Windows**: USB-CAN adaptery (np. PCAN-USB, Kvaser, ZLG lub komunikacja po wirtualnym porcie COM za pomocą `serialport`).
- **Symulacja/Mock**: Możliwość generowania ramek testowych w kodzie w przypadku braku fizycznego adaptera.

---

## 3. Zależności Projektowe i Narzędziowe (Tooling & Dependencies)

- **Lerna** (`^9.0.7`): Zarządzanie pakietami w monorepo (`packages/`, `dev-packages/`, `examples/`).
- **TypeScript** (`~5.9.3`): Kompilacja projektów ze spiętymi referencjami (`tsc --build`).
- **esbuild / Webpack**: Bundling aplikacji klienckiej i serwerowej.
- **Mocha & NYC**: Testy jednostkowe oraz raportowanie pokrycia kodu.

---

## 4. Konfiguracja i Struktura Projektu (Project Configuration)

Główne pliki konfiguracyjne w repozytorium:
- `package.json` – Główny plik konfiguracyjny monorepo i skrypty budowania.
- `lerna.json` – Konfiguracja lerna do zarządzania pakietami.
- `tsconfig.json` & `configs/tsconfig.json` – Baza konfiguracji TypeScript.
- `examples/browser/package.json` – Konfiguracja aplikacji w wersji przeglądarkowej.
- `examples/browser/log-config.json` – Ustawienia poziomów logowania.
- `doc/PioArduino.md` – Integracja pioarduino IDE, poprawne uruchamianie i procedura diagnostyczna.
- `CAN-BUS-ANALYZER-SUMMARY.md` – Wymagania i specyfikacja funkcjonalna analizatora CAN Bus.

---

## 5. Instrukcja Krok po Kroku: Budowanie i Uruchamianie

### Krok 1: Instalacja zależności
```bash
npm install
```
*Instaluje wszystkie pakiety oraz automatycznie odpala hooki `theia-patch`, `compute-references` oraz `lerna afterInstall`.*

### Krok 2: Kompilacja i Budowanie Aplikacji
- **Kompilacja samych źródeł TypeScript:**
  ```bash
  npm run compile
  ```
- **Budowanie pakietów + bundling wersji przeglądarkowej (Browser Example):**
  ```bash
  npm run build:browser
  ```
- **Budowanie wszystkich wariantów aplikacji (Browser + Electron):**
  ```bash
  npm run build
  ```

### Krok 3: Pobranie domyślnych wtyczek (Opcjonalnie)
```bash
npm run download:plugins
```

### Krok 4: Uruchomienie Aplikacji
- **Uruchomienie w wersji Browser (port 3000):**
  ```bash
  npm run start:browser
  ```
  Aplikacja dostępna pod adresem: `http://localhost:3000`

- **Uruchomienie wersji Browser z PioArduino (Windows):**
  ```powershell
  cd examples\browser
  npm run start:pioarduino
  ```
  Następnie otwórz w Theia bezpośredni katalog projektu zawierający `platformio.ini`.
  Szczegóły i rozwiązania typowych problemów opisano w [przewodniku PioArduino](doc/PioArduino.md).

- **Uruchomienie w wersji Electron (Desktop):**
  ```bash
  npm run start:electron
  ```

- **Tryb obserwacji ze zmianami na żywo (Watch Mode):**
  ```bash
  npm run watch
  ```

---

## 6. Praca z Konkretnym Pakietem (Package Development Workflow)

Aby zbudować lub przetestować wybrany pakiet z monorepo:
```bash
# Kompilacja konkretnego pakietu
npx lerna run compile --scope @theia/nazwa-pakietu

# Testy konkretnego pakietu
npx lerna run test --scope @theia/nazwa-pakietu
```
