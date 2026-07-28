# CAN Bus Analyzer — Theia Extension

## Pełne wymagania projektowe (Requirements) i podsumowanie stanu

**Data:** 2026-07-28  
**Repozytorium:** `dzyndzolow/theia` (fork Eclipse Theia)  
**Autor:** dzyndzolow

---

## 1. Cel projektu (Product Vision)

Stworzenie w pełni funkcjonalnego **analizatora magistrali CAN Bus** jako natywnego rozszerzenia (Theia Extension) dla środowiska Eclipse Theia. Narzędzie ma umożliwiać przechwytywanie, dekodowanie, wizualizację graficzną i analizę ramek CAN w czasie rzeczywistym, z możliwością rozbudowy o kolejne protokoły i funkcje analityczne.

### 1.1. MVP (Minimum Viable Product) — faza 1

- [ ] Przechwytywanie ramek CAN z interfejsu sprzętowego (SocketCAN na Linux, adapter USB-CAN przez serialport na Windows)
- [ ] Wyświetlanie ramek w tabeli (ID, typ, DLC, dane, timestamp, interfejs)
- [ ] Wykres aktywności CAN w czasie rzeczywistym
- [ ] Podstawowe statystyki: liczba ramek, FPS, błędy, obciążenie magistrali
- [ ] Kontrolki Start/Stop/Clear
- [ ] Obsługa CAN 2.0A (11-bit ID) i CAN 2.0B (29-bit ID)
- [ ] Obsługa CAN FD (do 64 bajtów danych)

### 1.2. Faza 2 — rozszerzenia planowane

- [ ] Filtrowanie ramek po ID, typie, interfejsie
- [ ] Eksport danych do CSV/JSON
- [ ] Dekodowanie sygnałów wg plików DBC
- [ ] Wysyłanie ramek CAN (transmit)
- [ ] Logowanie do pliku z możliwością odtwarzania
- [ ] Obsługa wielu interfejsów jednocześnie
- [ ] Analiza statystyczna (histogramy ID, rozkład DLC, heatmapa)
- [ ] Wykrywanie anomalii (np. nagły wzrost ruchu)
- [ ] Wsparcie dla CANopen / J1939 (warstwy wyższe)

---

## 2. Wymagania funkcjonalne (Functional Requirements)

### FR-01: Przechwytywanie ramek CAN
- System musi łączyć się z fizycznym interfejsem CAN poprzez:
  - **Linux:** SocketCAN (`socketcan` npm package) — interfejsy `can0`, `vcan0` itp.
  - **Windows:** adapter USB-CAN przez `serialport` npm package (np. PCAN-USB, Kvaser, ZLG)
- Użytkownik wybiera interfejs i bitrate z listy konfiguracyjnej.
- Ramki są odczytywane asynchronicznie i przekazywane do frontendu.

### FR-02: Wyświetlanie ramek w tabeli
- Kolumny: `Timestamp (ms)`, `ID (hex)`, `Type (STD/EXT/RTR)`, `DLC`, `Data (hex)`, `Interface`
- Ostatnie 50 ramek widocznych, przewijane.
- Ramki posortowane od najnowszej.
- Kolorowanie wierszy: standardowe ID (zielony), extended ID (niebieski), RTR (pomarańczowy), błąd (czerwony).

### FR-03: Wykres aktywności CAN
- Wykres liniowy/słupkowy FPS (ramek na sekundę) w czasie.
- Oś X: czas (ostatnie ~30-60 sekund).
- Oś Y: liczba ramek/sekundę.
- Automatyczne skalowanie.
- Legenda z nazwą interfejsu.

### FR-04: Statystyki w czasie rzeczywistym
- **Total Frames** — całkowita liczba odebranych ramek od startu.
- **FPS** — średnia liczba ramek na sekundę.
- **Errors** — liczba błędów (CRC, stuff, form).
- **Bus Load** — procentowe obciążenie magistrali (szacowane z bitrate i liczby ramek).
- **Status** — Capturing / Idle (z kolorowym wskaźnikiem).

### FR-05: Kontrolki
- **Start** — rozpoczyna przechwytywanie z wybranego interfejsu.
- **Stop** — zatrzymuje przechwytywanie.
- **Clear** — czyści tabelę, wykres i statystyki.
- Skrót klawiszowy: `Ctrl+Shift+C` — toggle widgetu CAN.

### FR-06: Obsługa typów ramek
- CAN 2.0A: 11-bitowy identyfikator (0x000–0x7FF)
- CAN 2.0B: 29-bitowy identyfikator (0x00000000–0x1FFFFFFF)
- RTR (Remote Transmission Request)
- CAN FD: do 64 bajtów danych, zmienna prędkość danych
- Error frames (zgłaszane jako zdarzenia błędów)

### FR-07: Komunikacja frontend-backend
- JSON-RPC przez Theia `MessagingService` lub dedykowany `JsonRpcServer`.
- Backend emituje zdarzenia: `frame-received`, `statistics-updated`, `can-error`, `status-changed`.
- Frontend subskrybuje zdarzenia i aktualizuje UI.

---

## 3. Wymagania niefunkcjonalne (Non-Functional Requirements)

### NFR-01: Wydajność
- System musi obsługiwać co najmniej **5000 ramek/sekundę** bez utraty danych.
- UI nie może się zacinać — aktualizacje tabeli/wykresu throttlowane do ~20 FPS.
- Bufor ramek: ostatnie 1000 ramek w pamięci przeglądarki.

### NFR-02: Niezawodność
- Błędy połączenia CAN nie mogą crashować aplikacji.
- Automatyczna próba ponownego połączenia po utracie interfejsu.
- Logowanie błędów do konsoli Theia.

### NFR-03: Wieloplatformowość
- Backend: Linux (SocketCAN) + Windows (serialport USB-CAN).
- Frontend: dowolna przeglądarka (Chromium, Firefox) przez Theia browser app.
- Kod wspólny (common/) niezależny od platformy.

### NFR-04: Rozszerzalność
- Architektura modułowa: łatwe dodawanie nowych dekoderów protokołów (DBC, CANopen, J1939).
- System pluginów do analizy danych (np. nowe typy wykresów).
- Separacja warstwy sprzętowej (CAN adapter) od logiki analizy.

### NFR-05: Użyteczność
- Widget dockowalny w dolnej części okna Theia.
- Intuicyjny interfejs: Start/Stop/Clear jako przyciski.
- Czytelna tabela z kolorowaniem.
- Wykres czytelny przy różnych rozdzielczościach.

---

## 4. Architektura techniczna

### 4.1. Diagram warstw

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND (Browser)              │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ CanWidget │  │  Chart   │  │  FrameTable  │  │
│  │ (toolbar, │  │ (canvas/ │  │  (HTML table)│  │
│  │  stats)   │  │ ECharts) │  │              │  │
│  └─────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│        │             │               │          │
│  ┌─────┴─────────────┴───────────────┴───────┐  │
│  │         CanViewContribution               │  │
│  │    (commands, menus, keybindings)         │  │
│  └──────────────────┬───────────────────────┘  │
│                     │ JSON-RPC                  │
├─────────────────────┼───────────────────────────┤
│                  BACKEND (Node.js)              │
│  ┌──────────────────┴───────────────────────┐  │
│  │           CanRpcService                  │  │
│  │      (JSON-RPC server, event emitter)    │  │
│  └──────────────────┬───────────────────────┘  │
│                     │                          │
│  ┌──────────────────┴───────────────────────┐  │
│  │          CanSocketService                │  │
│  │   (socketcan / serialport abstraction)   │  │
│  └──────────────────┬───────────────────────┘  │
│                     │                          │
│  ┌──────────────────┴───────────────────────┐  │
│  │       Hardware Abstraction Layer          │  │
│  │  ┌──────────┐  ┌────────────────────┐    │  │
│  │  │ SocketCAN│  │  Serial-USB-CAN    │    │  │
│  │  │ (Linux)  │  │  (Windows/Mac)     │    │  │
│  │  └──────────┘  └────────────────────┘    │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 4.2. Struktura katalogów

```
packages/can-bus/
├── package.json                          ← theiaExtensions: frontend + backend
├── tsconfig.json                         ← TypeScript config
├── src/
│   ├── common/
│   │   └── can-protocol.ts               ← Współdzielone typy i stałe
│   ├── browser/
│   │   ├── can-frontend-module.ts        ← DI bindings (Inversify ContainerModule)
│   │   ├── can-view-contribution.ts      ← AbstractViewContribution (komendy, menu, keybinding)
│   │   ├── can-widget.ts                 ← BaseWidget (główny UI)
│   │   └── style/
│   │       └── can-widget.css            ← Style CSS widgetu
│   └── node/
│       ├── can-backend-module.ts         ← DI bindings backendu
│       ├── can-socket-service.ts         ← Abstrakcja sprzętu CAN
│       └── can-rpc-service.ts            ← JSON-RPC serwis
```

### 4.3. Stos technologiczny

| Warstwa | Technologia |
|---------|-------------|
| Framework IDE | Eclipse Theia 1.73.0 |
| Język | TypeScript ~5.9.3 |
| DI Container | InversifyJS (przez `@theia/core`) |
| Frontend UI | Theia BaseWidget + HTML5 Canvas |
| Wykresy | ECharts 5.x (planowane) |
| Backend CAN (Linux) | `socketcan` npm package |
| Backend CAN (Windows) | `serialport` npm package |
| Komunikacja FE↔BE | Theia JSON-RPC (`MessagingService`) |
| Node.js | >= 22 |

---

## 5. Zrealizowane pliki (stan na 2026-07-28)

### 5.1. `packages/can-bus/package.json`
- Nazwa: `@theia/can-bus` v1.73.0
- Deklaruje `theiaExtensions`: `can-frontend-module` + `can-backend-module`
- Skrypty: `build`, `compile`, `clean`, `lint`, `test`, `watch` (przez `theiaext`)

### 5.2. `src/common/can-protocol.ts`
Zdefiniowane interfejsy TypeScript:
- `CanFrame` — pełna reprezentacja ramki CAN (id, extended, rtr, data, dlc, timestamp, interface)
- `CanInterfaceConfig` — konfiguracja interfejsu (name, bitrate, fd)
- `CanFilter` — filtr ramek (id, mask, extended, standard, dataOnly)
- `CanStatistics` — statystyki sesji (totalFrames, framesPerSecond, errors, busLoad, startTime)
- `CanServiceEvents` — nazwy zdarzeń (FRAME_RECEIVED, STATISTICS_UPDATED, ERROR, STATUS_CHANGED)
- `CanBusWidget` — stałe ID i LABEL widgetu

### 5.3. `src/browser/can-frontend-module.ts`
- `ContainerModule` z bindami Inversify:
  - `CanWidget` → self
  - `WidgetFactory` → dynamicznie tworzy CanWidget
  - `CanViewContribution` → view contribution
  - `OpenHandler` → CanViewContribution

### 5.4. `src/browser/can-view-contribution.ts`
- `CanViewContribution extends AbstractViewContribution<CanBusWidget>`
- Rejestruje komendy: `can-bus:toggle`, `can-bus:start-capture`, `can-bus:stop-capture`, `can-bus:clear`
- Skrót klawiszowy: `Ctrl+Shift+C`
- Domyślna lokalizacja widgetu: `area: 'bottom'`
- Rejestruje menu w `view/can-bus-submenu`

### 5.5. `src/browser/can-widget.ts`
- `CanWidget extends BaseWidget`
- **Toolbar**: przyciski Start ▶, Stop ⏹, Clear 🗑 + etykieta interfejsu
- **Stats bar**: Status (Capturing/Idle), Frames, FPS, Errors, Bus Load
- **Chart container**: HTML5 Canvas do wykresu aktywności (placeholder grid + title)
- **Frame table**: tabela HTML z kolumnami Timestamp, ID (hex), Type, DLC, Data (hex), Interface
- **Metody**:
  - `startCapture()` — ustawia flagę, resetuje timestamp
  - `stopCapture()` — zatrzymuje przechwytywanie
  - `clearData()` — czyści ramki i statystyki
  - `addFrame(frame)` — dodaje ramkę, aktualizuje statystyki i UI (max 1000 ramek w buforze)
  - `updateStatsDisplay()` — renderuje HTML paska statystyk
  - `updateFrameTable()` — renderuje ostatnie 50 ramek w tabeli
  - `drawChart()` — rysuje siatkę i placeholder wykresu na canvas

### 5.6. `src/browser/style/can-widget.css`
- Katalog utworzony, plik CSS do uzupełnienia.

---

## 6. Co pozostało do zrobienia (Backlog)

### Priorytet 1 — Krytyczne (MVP)

| ID | Zadanie | Plik(i) | Szacowany czas |
|----|---------|---------|----------------|
| B-01 | Backend: `can-backend-module.ts` — DI bindings | `src/node/can-backend-module.ts` | 0.5h |
| B-02 | Backend: `can-socket-service.ts` — obsługa socketcan/serialport | `src/node/can-socket-service.ts` | 4h |
| B-03 | Backend: `can-rpc-service.ts` — JSON-RPC, emiter zdarzeń | `src/node/can-rpc-service.ts` | 2h |
| B-04 | Frontend: podpięcie `CanWidget` pod RPC backendu | `src/browser/can-widget.ts` | 2h |
| B-05 | Frontend: integracja ECharts (wykres FPS w czasie) | `src/browser/can-widget.ts` | 3h |
| B-06 | CSS: ostylowanie widgetu | `src/browser/style/can-widget.css` | 1h |
| B-07 | Rejestracja `@theia/can-bus` w `examples/browser/package.json` | `examples/browser/package.json` | 0.25h |
| B-08 | Test integracyjny: uruchomienie Theia z rozszerzeniem | — | 1h |

### Priorytet 2 — Ważne

| ID | Zadanie |
|----|---------|
| F-01 | Filtrowanie ramek po CAN ID, typie, interfejsie |
| F-02 | Eksport danych do CSV |
| F-03 | Eksport danych do JSON |
| F-04 | Konfiguracja interfejsu CAN (wybór z listy, bitrate) |
| F-05 | Obsługa CAN FD (do 64 bajtów) |
| F-06 | Kolorowanie wierszy tabeli wg typu ramki |

### Priorytet 3 — Rozszerzenia

| ID | Zadanie |
|----|---------|
| E-01 | Dekodowanie sygnałów DBC |
| E-02 | Wysyłanie ramek CAN (transmit) |
| E-03 | Logowanie do pliku + odtwarzanie |
| E-04 | Wiele interfejsów jednocześnie |
| E-05 | Analiza statystyczna (histogramy, heatmapa) |
| E-06 | Wykrywanie anomalii |
| E-07 | CANopen / J1939 |
| E-08 | GitHub: dokończyć autoryzację, push do `dzyndzolow/theia` |

---

## 7. Instrukcja developerska

### 7.1. Budowanie rozszerzenia

```powershell
cd d:\prywtny\stool\theia\packages\can-bus
npm run compile
```

### 7.2. Uruchomienie Theia z rozszerzeniem

```powershell
cd d:\prywtny\stool\theia
npm run start:browser
```

Theia będzie dostępna pod: `http://127.0.0.1:3000`

### 7.3. Tryb watch (automatyczna rekompilacja)

```powershell
cd d:\prywtny\stool\theia
npm run watch:browser
```

### 7.4. Git — konfiguracja remote

```powershell
git remote set-url origin https://github.com/dzyndzolow/theia.git
git add packages/can-bus/ CAN-BUS-ANALYZER-SUMMARY.md
git commit -m "Add CAN bus analyzer extension with full requirements"
git push -u origin master
```

### 7.5. Instalacja zależności CAN (back-end)

```powershell
# Linux (SocketCAN)
cd packages/can-bus && npm install socketcan

# Windows (USB-CAN adapter)
cd packages/can-bus && npm install serialport
```

---

## 8. Podsumowanie stanu prac

| Obszar | Postęp | Status |
|--------|--------|--------|
| Architektura i decyzje projektowe | 100% | ✅ |
| Protokół CAN (typy, interfejsy) | 100% | ✅ |
| Frontend — szkielet widgetu | 90% | ✅ (brak CSS i ECharts) |
| Frontend — DI / komendy / menu | 100% | ✅ |
| Backend — moduły | 0% | ❌ (do zrobienia) |
| Integracja FE↔BE | 0% | ❌ (do zrobienia) |
| Wykresy (ECharts) | 0% | ❌ (placeholder canvas) |
| Style CSS | 0% | ❌ (plik pusty) |
| Rejestracja w aplikacji | 0% | ❌ |
| GitHub — autoryzacja | 50% | ⏳ (kod 8999-65ED) |
| GitHub — push | 0% | ❌ |

**Ogólny postęp: ~35%** (szkielet frontendu gotowy, backend i integracja przed nami)

---

## 9. Notatki techniczne

- Wzorzec architektoniczny: wzorowany na `packages/output` (sprawdzony pattern Theia).
- Widget używa natywnego HTML5 Canvas do wykresu — do zastąpienia przez ECharts dla lepszej interaktywności.
- Komunikacja FE↔BE: Theia `JsonRpcServer` / `MessagingService` (nie WebSocket bezpośrednio — używać infrastruktury Theia).
- Bufor ramek: 1000 ostatnich w pamięci, tabela pokazuje 50 ostatnich.
- Throttling UI: aktualizacje tabeli i wykresu powinny być ograniczone do ~20 FPS dla wydajności.
- CAN FD: protokół już wspiera (pole `data` do 64 bajtów), ale backend musi to obsłużyć.
