# CAN Device Lab — Architektura i Podręcznik Integracji

## 1. Wprowadzenie i Przeznaczenie

Moduł **CAN Device Lab** (Faza 4A) w środowisku Theia Signal Analyzer stanowi zintegrowaną, bezpieczną platformę do laboratoryjnego badania, wybudzania i identyfikacji zachowań urządzeń na magistrali CAN (Classical CAN 2.0 oraz CAN FD).

Główne cele systemu:
1. **Prowadzenie bezpiecznych eksperymentów TX**: Ochrona instalacji stołowej i pojazdowej za pomocą deterministycznej polityki `CanSafetyPolicy` (stan `RUNNING`, restrykcyjna allowlista ID, limity FPS i obciążenia magistrali, odcięcie niebezpiecznych usług UDS `0x27/0x2E/0x31/0x34` oraz priorytetowe odcięcie `STOP`).
2. **Odkrywanie sekwencji wybudzających**: Kampanie prób (`CanCampaignEngine`), deterministyczny bank payloadów (`0x00`, `0xFF`, `0xAA`, `0x55`, `0x7F`, `RAMP`, `0x80`), detekcja automatyczna RX-delta z eliminacją local echo oraz manualny feedback operatora.
3. **Analiza przyczynowa i minimalizacja**: Bayesa i okna czasowe w `CanCandidateRanker`, algorytmy delta debugging (minimalizacja śladu do 1-minimalnego podzbioru wybudzającego) oraz bisekcja maksymalnego interwału keep-alive w `CanAdaptiveIdentifyAlgorithms`.
4. **Odkrywanie opcji binarnych i pól liczbowych**: `CanBitDiscovery` (mutacje walking-one/zero, mapowanie bit -> kontrolka) oraz `CanFieldDiscovery` (sweep numeryczny Little/Big Endian z gwarantowanym `safeReturnValue`) i enkoder tekstu ISO-TP (`CanTextPayload`).
5. **Zewnętrzne sensory i import**: Sensory SCPI zasilacza laboratoryjnego ($\Delta I$), piny GPIO, parsery Linux candump, CSV, JSON/JSONL, kompozytor ramek ze zmiennych globalnych (`CanFrameComposer`) oraz generatory sygnałów falowych (`CanWaveGenerator`).
6. **Izolowany runtime Python i archiwizacja**: `CanPythonRunner` z capability API IPC (`subscribe/send/set_variable/emit_feedback/stop`), strażnikiem heartbeat watchdog, kontrolowanym hot-reloadem oraz kompletną archiwizacją `CanExperimentArchive` i audytowym raportem `CanExperimentReportService`.

---

## 2. Architektura Komponentów

```mermaid
graph TD
    UI[Theia UI / Widgets] --> Bridge[CanVariableBridge / RPC]
    Py[Python Runner (IPC)] --> TxSvc[CanTransmitService]
    CampEng[CanCampaignEngine] --> TxSvc
    ReplaySvc[CanAdaptiveReplayService] --> TxSvc

    TxSvc --> Safety[CanSafetyPolicy Gate]
    Safety -->|Fail-closed| Socket[CanSocketService / Hardware]

    Socket --> Sim[CanDeviceLabSimulator DUT]
    Socket --> FbSvc[CanFeedbackService]
    Sensors[SCPI Power / GPIO] --> FbSvc

    TxSvc --> Bus[CanExperimentEventBus / Journal]
    FbSvc --> Bus

    Bus --> Ranker[CanCandidateRanker]
    Ranker --> Archive[CanExperimentArchive & Report]
```

---

## 3. Gwarancje Jakości i Bezpieczeństwa

- **Zasada Fail-Closed**: Wszelkie próby nadawania przy braku autoryzacji, w stanach `DISARMED`, `ARMED` czy `FAULT` są natychmiastowo odrzucane z logowaniem incydentu do dziennika `ExperimentJournal`.
- **Izolacja Sensorów**: Wszelkie zewnętrzne sensory feedbacku (`CanFeedbackSensorProvider`, SCPI, GPIO) działają w trybie strictly read-only i nie posiadają uprawnień TX.
- **Determinizm Replayu**: Symulator DUT (`CanDeviceLabSimulator`) oparty jest na generatorze Mulberry32 PRNG, co zapewnia 100% powtarzalność eksperymentów przy zadanym seedzie.
