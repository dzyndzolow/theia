# SA-HW-001 — rekord integracji

## Własność

- **Zadanie:** SA-HW-001 (Hardware Communication Layer: ESP32-S3 TCAN v1, PCAN-Basic, SLCAN)
- **Wykonawca/model:** Antigravity (Gemini 3.7 Flash)
- **Status:** POPRAWKI WYMAGANE — HOST STABILNY, HARDWARE NIEZWERYFIKOWANY
- **Data rezerwacji:** 2026-08-28
- **Karta zadania i faza:** Hardware Integration (Etapy 1–5: TCAN v1, Registry, ESP32 USB/TCP, PCAN-Basic, SLCAN, Bridging)

## Granice zadania

- **Cel z karty:** Przygotowanie bezpiecznej warstwy hosta i kontraktów pod fizyczne urządzenia CAN. Rzeczywiste sterowniki, pełny handshake/auth firmware i kwalifikacja HIL pozostają następnym etapem; obecnych fixture'ów nie wolno przedstawiać jako obsługi urządzeń fizycznych.
- **Zmiany w kodzie:**
  - `packages/can-bus/src/common/can-device.ts` (nowy)
  - `packages/can-bus/src/common/esp32-can-device-protocol.ts` (nowy)
  - `packages/can-bus/src/common/esp32-can-device-protocol.spec.ts` (nowy)
  - `packages/can-bus/src/node/device/can-device-registry.ts` (nowy)
  - `packages/can-bus/src/node/device/esp32-can-session.ts` (nowy)
  - `packages/can-bus/src/node/device/esp32-can-tcp-transport.ts` (nowy)
  - `packages/can-bus/src/node/device/esp32-can-usb-transport.ts` (nowy)
  - `packages/can-bus/src/node/device/esp32-can-device-provider.ts` (nowy)
  - `packages/can-bus/src/node/device/pcan-basic-provider.ts` (nowy)
  - `packages/can-bus/src/node/device/slcan-device-provider.ts` (nowy)
  - `packages/can-bus/src/node/device/can-device-adapter.ts` (nowy)
  - `packages/can-bus/src/node/device/can-hardware-integration.spec.ts` (nowy)
  - `packages/can-bus/src/common/index.ts`
  - `packages/can-bus/src/node/index.ts`
  - `packages/can-bus/src/node/can-backend-module.ts`
- **Zmiany w dokumentacji:** `doc/signal-analyzer/work/SA-HW-001.md`, `doc/signal-analyzer/work/README.md`
- **Pliki planowane:** Wskazane w zmianach w kodzie.

## Kontrakt integracji

- **Wejścia i ich właściciele:** Strumienie bajtowe TCP, porty szeregowe USB CDC, API PCAN-Basic.
- **Wyjścia i ich konsumenci:** Zdekodowane ramki `CanFrame`, `RawCanBatch`, zdarzenia statusu kontrolera przekazywane do `CanSocketService`, `CanTransmitService` i Theia UI.
- **Zależności wymagające AKCEPTACJI:** SA-421, SA-410, SA-406, SA-002 (spełnione).
- **Punkty montażu Theia / DI / RPC / worker:** DI tokens `CanDeviceRegistry`, `CanDeviceProvider` w `can-backend-module.ts`.
- **Wpływ na zamrożone kontrakty i `apiVersion`:** Brak zmian łamiących.
- **Ryzyka współdzielenia plików lub konfliktów:** Brak.

## Plan weryfikacji

- **Testy i komendy:** `yarn --cwd packages/can-bus test`, `yarn --cwd packages/can-bus lint`, `npx lerna run compile --scope @theia/can-bus`
- **Benchmark lub pomiar, jeśli wymagany:** Round-trip kodowania TCAN v1, framing COBS, weryfikacja sum CRC32C, rozróżnianie endpointów i obsługa reconnect.
- **Ścieżka integracyjna do ręcznego sprawdzenia:** `doc/signal-analyzer/can-hardware-device-test-plan.md`; jako pierwszy ESP32-S3 USB capture-only na izolowanym stole.

## Przekazanie i wynik

- **Faktycznie zmienione pliki:** Wskazane w zmianach w kodzie (12 nowych plików, 3 zaktualizowane).
- **Wyniki weryfikacji 2026-08-31:** `@theia/can-bus` compile/lint OK, 179/179 testów; `@theia/signal-core` compile/lint OK, 58/58 testów; pełny build Browser/Node i bundle OK. Są to testy hosta i symulatora, nie dowód działania fizycznego urządzenia.
- **Zaktualizowana dokumentacja funkcjonalna:** `doc/signal-analyzer/work/SA-HW-001.md`
- **Changelog:** wpis w `SIGNAL-ANALYZER-CHANGELOG.md` z 2026-08-28
- **Znane ograniczenia / zadania następcze:** Produkcyjne discovery celowo nie reklamuje fikcyjnego sprzętu. ESP32 TCP/TX pozostaje niedostępny bez response-correlated HELLO/AUTH/policy/ARM. PCAN i CANable wymagają rzeczywistych sterowników. Następny etap to kwalifikacja HIL opisana w `can-hardware-device-test-plan.md`.

## Decyzja supervisora

- **Decyzja:** częściowa akceptacja stabilnej i fail-closed bazy hosta; brak akceptacji urządzeń fizycznych.
- **Uzasadnienie:** bramki automatyczne są zielone, usunięto obejścia polityki TX i fałszywe discovery, ale testy nie korzystają z rzeczywistych driverów ani firmware.
- **Warunki przekazania do następnego zadania:** wykonać HIL-0…HIL-5, zaczynając od ESP32-S3 USB capture-only; do commitu nie dołączać danych stanowiska ani sekretów.
