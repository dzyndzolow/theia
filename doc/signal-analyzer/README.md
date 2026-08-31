# Signal Analyzer — dokumentacja

Dokumentacja funkcjonalności projektu Theia Signal Analyzer (patrz `SIGNAL-ANALYZER-ROADMAP.md` §0.2).

Podział pracy agentów AI i karty zadań: `SIGNAL-ANALYZER-TASKS.md`. Koordynację zależności oraz przekazanie pracy między agentami prowadzi się w `work/`.

**Zasady:** każda funkcjonalność = opis + jak używać. Dokumentację wolno modyfikować wyłącznie w zakresie bieżącej zmiany. Zmiana kodu bez aktualizacji dokumentacji = zadanie niedokończone.

## Indeks

| Dokument | Funkcjonalność | Status |
| --- | --- | --- |
| `supervisor-report.md` | **Raport superwizora** — jedyny plik sterujący jakością; lista usterek, dług techniczny, rytm rewizji | aktywny |
| `stabilization-current-functionality.md` | Bramka jakościowa STAB-01…STAB-09 dla stabilnej wersji obecnych funkcji | aktywny |
| `can-bus.md` | CAN Bus Analyzer (widget, capture, statystyki, protokół binarny) | aktywny |
| `can-device-lab.md` | Aktywny plan nadajnika CAN: symulator DUT, wybudzanie, feedback, zawężanie, funkcje, odpowiedzi, Python i reprodukcja | aktywny; SA-409…SA-424 |
| `esp32-s3-can-integration-plan.md` | Pierwsze fizyczne urządzenie CAN: ESP32-S3 w konfiguracji USB i Ethernet, architektura Theia/firmware oraz plan ESPCAN-001…010 | aktywny plan sprzętowy |
| `esp32-s3-can-device-protocol.md` | TCAN v1: wspólny binarny protokół RX/TX dla USB, TCP i opcjonalnego UDP RX | draft do zamrożenia |
| `can-usb-adapters-integration-plan.md` | CANable 2.0 i PCAN-compatible/klony: SLCAN, SocketCAN, gs_usb, PCAN-Basic, kwalifikacja fixture oraz plan USBCAN-001…010 | aktywny plan adapterów |
| `can-hardware-device-test-plan.md` | Następny etap HIL: rzeczywiste testy ESP32 USB/TCP, PCAN-compatible i CANable na izolowanym stole, dowody i bramki PASS/FAIL | aktywny plan wykonawczy |
| `industrial-protocol-analyzer.md` | Plan Wireshark-like: Modbus RTU, EtherCAT i PROFINET | plan gotowy; wstrzymane operacyjnie |
| `logic-analyzer.md` | Docelowa funkcjonalność Logic Analyzer, Device Library i sposób użycia | perspektywa rozwoju; wstrzymane |
| `logic-analyzer-implementation-plan.md` | Fazy SA-701…SA-909, zależności, kamienie milowe i bramki jakości | perspektywa rozwoju; wstrzymane |
| `logic-analyzer-custom-hardware.md` | Pełna specyfikacja LA-Lite ESP32 i LA-Pro 400 STM32/FPGA | perspektywa hardware |
| `logic-analyzer-device-protocol.md` | SADP v1 dla USB, UART, TCP i lokalnego IPC | perspektywa; niezamrożony |
| `logic-analyzer-native-backend.md` | Backend C++: capture, raw store, LOD, dekodery i Bridge API | perspektywa Logic Analyzer |
| `logic-analyzer-device-compatibility.md` | Sigrok, DSLogic U2Basic/Plus i ALIENTEK DL32 | perspektywa; DL32 eksperymentalny |
| `signal-core.md` | `@theia/signal-core` — Kontrakty systemowe, RingSampleStore, ChunkedIntervalTree, CaptureSession | aktywny |
| `decoders-architecture.md` | Silnik dekoderów — DecoderRegistry, Kahns DAG, WebWorker SAB, Circuit Breaker, CAN & UART | aktywny |
| `global-variables-next-stage.md` | Centralny rejestr i edytowalna tabela globalnych zmiennych w stylu PLC | aktywny |
| `../ai-agent-tools.md` | Docelowy model narzędzi AI, sesji, CAN Commit i CAN Diff | koncepcja zaakceptowana; implementacja po stabilizacji |
| `execution.md` | Zasady nieusuwania planu, aktualny stan wykonania i kolejne kroki | aktywne |
| `work/README.md` | Rejestr integracji, przekazania i blokery między zadaniami | aktywne |
| `supervisor-handoff.md` | Zakres przekazania pełnej bramki STAB-01…STAB-09 do niezależnej oceny | aktywny |
| `runtime-hygiene.md` | Polityka artefaktów `.pioarduino-core` i cache runtime | aktywny |
