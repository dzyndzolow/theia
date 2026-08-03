# Theia Signal Analyzer — Architektura Finalna „KIM3" (Kimi K3)

**Autor syntezy:** Kimi K3 (Moonshot AI)
**Wersja:** 3.0-FINAL
**Data:** 2026-08-03
**Status:** Rekomendowana architektura docelowa — synteza wszystkich dotychczasowych koncepcji

---

## 1. Geneza i metoda syntezy

Niniejszy dokument jest końcową syntezą sześciu źródeł koncepcyjnych w repozytorium:

| Źródło | Wkład do syntezy | Co odrzucam i dlaczego |
|---|---|---|
| `CAN-BUS-ANALYZER-SUMMARY.md` | Działający punkt startowy (35% MVP), wymagania FR/NFR, typy ramek | Monolityczny widget z tablicą w pamięci przeglądarki — nie skaluje się poza ~5000 ramek/s |
| `THEIA_SIGNAL_ANALYZER_ARCHITECTURE.md` | Hybrid core + extensions, workflow capture→raw→select→decode→compare→persist | Zbyt ogólny — brak modelu wydajnościowego i kontraktu dekodera |
| `New_concept.md` (3 koncepty) | Stacked decoders (DAG), ChannelGroup, libsigrokdecode bridge, decode-on-demand, Semantic AI Aggregator, Virtual Math Channels, DTW, Plugin System, Multi-Domain Clocking | Luźna forma zbiorcza — wymagała konsolidacji |
| `THEIA_SIGNAL_ANALYZER_CONSOLIDATED_MODEL.md` | 6 warstw, stabilny kontrakt dekodera, tabela decyzji | Brak modelu błędów i mechanizmów operacyjnych |
| `THEIA_SIGNAL_ANALYZER_OWN_CONCEPT.md` | PagedSampleStore (mmap+LRU), GAP/RESYNC, sandboxing, Undo/Redo, AnnotationIndex, apiVersion, Export/Import framework, Plugin dependency resolver, DecoderTestHarness | Rekomendacja Rust/C++ + gRPC mikroserwisów — przerost formy, oderwana od realiów repo |
| `THEIA_NEXTGEN_SIGNAL_ANALYZER_ARCHITECTURE.md` | Integracja z Theia DI, plan migracji can-bus, SampleBlock header, Min-Max LOD | Błąd techniczny: `SharedArrayBuffer` nie działa między procesem backendu Node.js a rendererem — SAB działa tylko w obrębie jednego procesu (renderer ↔ jego workery) |

**Trzy kluczowe korekty KIM3 względem poprzedników:**

1. **Theia-Native Execution Model** — całość realizowana jako zwykłe rozszerzenia Theia (TypeScript, Inversify, JSON-RPC), a nie równoległy stos Rust/gRPC/Python-microservices. Natywny addon N-API jest *opcjonalną* optymalizacją hot-path, nie fundamentem.
2. **Poprawiony model pamięci** — backend→frontend: strumieniowanie binarne z backpressure; `SharedArrayBuffer`: wyłącznie renderer↔WebWorker (dekodery, LOD decymacja). Zero-copy tam, gdzie fizycznie możliwe, bez ideologii.
3. **AI jako Theia AI Agent** — repo zawiera już ekosystem `@theia/ai-core`, `@theia/ai-chat`, `@theia/ai-ide`. Asystent analizy sygnałów rejestruje się jako agent Theia AI z tool-use, zamiast budować osobny serwis Python.

---

## 2. Zasada nadrzędna: Data-Centric Platform

System nie jest „aplikacją z dekoderami", tylko **platformą zorientowaną na dane**.
Surowe próbki **rezydują** we współdzielonej, indeksowanej czasowo warstwie pamięci,
a wszyscy konsumenci — wykresy, dekodery, AI, comparator, eksport — czytają
z tego samego źródła równolegle, bez kaskadowego kopiowania.

---

## 3. Architektura warstw (7 warstw) z mapowaniem na Theia

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ L7 │ CONSUMERS: Waveform(WebGL) │ Hex/Bit View │ Protocol Table │ XY Plot   │
│    │             AI Agent │ Comparator │ Export │ Statistics               │
├─────────────────────────────────────────────────────────────────────────────┤
│ L6 │ INTELLIGENCE: SemanticAggregator │ AnomalyDetector │ QueryTranslator   │
│    │      (Theia AI Agent, tool-use na AnnotationIndex)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ L5 │ SEMANTICS: słowniki .dbc/.svd/JSON │ Virtual Math Channels            │
├─────────────────────────────────────────────────────────────────────────────┤
│ L4 │ DECODE DAG ENGINE: DecoderProvider registry │ topological sort │       │
│    │      decode-on-demand │ GAP/RESYNC │ sandboxed workers                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ L3 │ CORE DATA ENGINE: SampleStore (Ring + Paged) │ IntervalTree index │    │
│    │      AnnotationIndex │ GlobalTimeline │ Undo/Redo (SessionCommand)     │
├─────────────────────────────────────────────────────────────────────────────┤
│ L2 │ TRANSPORT: Theia JSON-RPC (komendy/zdarzenia) + binary stream (dane)   │
├─────────────────────────────────────────────────────────────────────────────┤
│ L1 │ HAL (backend Node.js): SocketCAN │ serialport USB-CAN │ pliki VCD/CSV/ │
│    │      PCAP │ sigrok │ symulator │ CaptureMode: LIVE|RECORDED|REPLAY    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### L1 — HAL (Hardware Abstraction Layer), backend Node.js
- Izolacja źródeł: SocketCAN (Linux), `serialport` USB-CAN (Windows), pliki, symulator.
- Normalizacja do `SampleBlock` (stały chunk ~64 KB, `startTimeNs: bigint`, `sampleRate`).
- `CaptureMode: LIVE | RECORDED | REPLAY`, ring buffer z backpressure dla live.

### L2 — Transport
- **Komendy i zdarzenia:** Theia JSON-RPC (`JsonRpcConnectionHandler`) — zgodnie ze wzorcem `packages/output`, już użytym w can-bus.
- **Dane próbek:** binarny strumień chunked (ArrayBuffer przez kanał WebSocket Theia), z oknem backpressure; **nie** JSON-RPC per ramka (koszt serializacji zabija wydajność przy >10k ramek/s).

### L3 — Core Data Engine
- `SampleStore` — wspólny interfejs nad dwiema implementacjami:
  - `RingSampleStore` (RAM, live capture),
  - `PagedSampleStore` (memory-mapped files + LRU) dla dużych sesji (1h CAN-FD @ 8 Mbps).
- `ChunkedIntervalTree` — lookup zakresu $[t_{start}, t_{stop}]$ w $O(\log N + K)$.
- `AnnotationIndex` — inverted index po `type`, `payload`, czas; w core, nie w UI.
- `GlobalTimeline` — wspólny zegar wielu domen (`clock_offset`, `drift_factor`).
- Undo/Redo: każda mutacja sesji to `SessionCommand` + `ImmutableSessionState`.
- W rendererze: mirror gorącego okna danych w `SharedArrayBuffer`, współdzielony z WebWorkerami (dekodery, LOD) przez `Atomics`.

### L4 — Decode DAG Engine
- Rejestr `DecoderProvider`, automatyczne łańcuchy przez sortowanie topologiczne po `inputType`/`outputType`.
- **Decode-on-demand:** tylko viewport + 20% marginesu („skrzydła"), w WebWorkerze.
- **Model błędów first-class:** adnotacje `GAP`/`RESYNC`; błąd dekodera nie zatrzymuje pipeline'u (timeout, circuit breaker, walidacja każdej adnotacji: `endTime >= startTime`, limity pamięci).
- **Sandboxing:** WebWorker (TS/WASM) na froncie; opcjonalny Python sidecar (libsigrokdecode) w backendzie przez IPC.

### L5 — Semantics
- Słowniki `.dbc` / `.svd` / JSON: `ProtocolAnnotation` + jednostka, skala, zakres, znaczenie.
- `VirtualChannel` ($CH_1 - CH_2$, duty cycle, jitter, FFT) — traktowane przez dekodery identycznie jak kanały sprzętowe (`source: 'hardware' | 'math' | 'derived'`).

### L6 — Intelligence (Theia AI Agent)
Trzy rozdzielone komponenty (nie jeden „AI moduł"):
- `SemanticAggregator` — kompresja 10k ramek → streszczenie strukturalne (limit tokenów LLM).
- `AnomalyDetector` — reguły/statystyka na strumieniu adnotacji (jitter, błędy logiczne).
- `QueryTranslator` — język naturalny → zapytanie do `AnnotationIndex`.
Agent rejestrowany w `@theia/ai-core` z tool-use: `get_exact_range(t0,t1)`, `compare_sessions_dtw(a,b)`, `explain_anomaly(id)`.

### L7 — Consumers / UI
- Panele jako dockowalne widgety Theia, synchronizowane przez `ViewportController` (zoom/pan/kursor: Waveform ↔ Hex ↔ Table ↔ XY).
- Renderer WebGL z Min-Max LOD (obwiednia sygnału na kubełek — brak gubienia pików); fallback `Canvas2DRenderer` bez GPU.

---

## 4. Finalny kontrakt dekodera (zamrożony przed Fazą 2)

```ts
export interface ChannelRole {
  roleName: string;                 // "CLK", "SDA", "TX", "MOSI"
  required: boolean;
  assignedChannelId?: string;
}

export interface ProtocolAnnotation {
  id: string;
  parentAnnotationId?: string;      // hierarchia DAG
  level: number;                    // warstwa w grafie (0, 1, 2…)
  startTimeNs: bigint;
  endTimeNs: bigint;
  type: string;                     // "START" | "DATA_FRAME" | "CRC_ERROR" | "GAP" | "RESYNC" | …
  summary: string;                  // krótka etykieta UI
  payload?: Record<string, unknown>;
}

export interface DecoderProvider {
  readonly id: string;
  readonly displayName: string;
  readonly apiVersion: string;      // semver — backward compatibility kontraktu
  readonly inputType: string;       // "raw-digital" | "raw-analog" | "annotation:<decoderId>"
  readonly outputType: string;      // np. "annotation:can", "annotation:modbus"
  readonly channelRoles: ChannelRole[];
  decode(
    input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
    options: Record<string, unknown>
  ): AsyncIterable<ProtocolAnnotation>;
}
```

Reguły: zmiana kontraktu = bump `apiVersion` + migrator; dekoder nigdy nie pisze do `SampleStore` — tylko emituje adnotacje; silnik sam buduje potok (topological sort, wykrywanie cykli).

## 5. Model danych core

`CaptureSession` (z `CaptureMode`), `SignalChannel` (z `source`), `ChannelGroup`,
`TraceRegion`, `ProtocolAnnotation`, `DecodeResult` (strumieniowy),
`ComparisonSnapshot`, `VirtualChannel`, `GlobalTimeline`, `AnnotationIndex`,
`SessionCommand`.

## 6. Roadmap (P0 → P3)

- **Faza 0 (P0) — Stabilizacja:** dokończenie backendu can-bus (B-01…B-04 z backlogu), binarny transport zamiast per-frame RPC; wydzielenie pakietu `@theia/signal-core` z kontraktami (L4) i modelem danych (L3). *Nie wyrzucamy 35% pracy — can-bus staje się poligonem wzorców.*
- **Faza 1 (P0) — Core Data Engine:** `SampleStore` (Ring + Paged), `ChunkedIntervalTree`, HAL z backpressure, `ChannelGroup`, `GlobalTimeline`.
- **Faza 2 (P0) — Decode DAG Engine:** kontrakt z §4, sortowanie topologiczne, decode-on-demand w WebWorkerze (SAB), GAP/RESYNC, walidacja + circuit breaker; migracja can-bus do `DecoderProvider` (`raw-can` → `annotation:can`).
- **Faza 3 (P1) — Wizualizacja:** `ViewportController`, WebGL waveform + Min-Max LOD (+ fallback Canvas2D), Hex/ASCII/Bit view, annotation overlay, tabela protokołów.
- **Faza 4 (P1) — Semantyka i operacje:** słowniki `.dbc`, `AnnotationIndex` + wyszukiwarka, Undo/Redo, Export/Import (CSV/JSON/VCD), `VirtualChannel`.
- **Faza 5 (P2) — Inteligencja i porównania:** Theia AI Agent (Aggregator/Anomaly/Query), Comparator z DTW, most libsigrokdecode (Python sidecar, 150+ dekoderów), `DecoderTestHarness` (golden traces).
- **Faza 6 (P3) — Ekosystem:** Public Plugin API + SDK, plugin dependency resolver (semver), trigger engine, współpraca (CRDT), symulator protokołów.

## 7. Stack technologiczny (Theia-native)

| Warstwa | Technologia |
|---|---|
| Backend | Node.js ≥22, TypeScript ~5.9.3, Theia backend module; opcjonalny N-API addon tylko dla ingestion hot-path |
| Transport | Theia JSON-RPC + binarny chunked stream z backpressure |
| Frontend | Theia widgets (BaseWidget), Inversify DI, React 18 tam gdzie sensowne |
| Renderowanie | WebGL/WebGPU + Min-Max LOD; fallback Canvas2D |
| Dekodery | WebWorker (TS/WASM); Python sidecar (libsigrokdecode) opcjonalnie |
| AI | `@theia/ai-core` agent + tool-use (bez zewnętrznego mikroserwisu) |
| Dane | Ring (RAM) + Paged (mmap); SAB tylko renderer↔worker |

## 8. Benchmarki jako Definition of Done

- ≥ 100 000 próbek/s (analog) i ≥ 20 000 ramek/s (CAN) bez utraty danych i bez zamrożenia UI (aktualizacje ≤ 20 FPS throttled).
- Sesja 1 GB otwiera się i nawiguje < 2 s (PagedStore + LOD).
- Dekodowanie viewportu 1 M adnotacji < 300 ms w workerze.
- Awaria dowolnego dekodera nie wpływa na pozostałe (circuit breaker).

## 9. Wniosek końcowy

Poprzednie koncepcje podzieliły się na dwa błędy skrajne: monolityczny widget (can-bus MVP) i rozproszony stos mikroserwisów (Rust/gRPC/Python). **KIM3** bierze architekturę warstwową i kontrakt DAG z konceptów pośrednich, mechanizmy operacyjne z `OWN_CONCEPT`, integrację Theia z `NEXTGEN` — i koryguje oba błędy: całość ląduje w natywnym modelu wykonawczym Theia, z poprawionym modelem pamięci międzyprocesowej i z AI jako agentem istniejącego już ekosystemu `@theia/ai-*`. Droga wdrożenia zaczyna się od tego, co już działa — pakietu can-bus — a nie od czystej kartki.
