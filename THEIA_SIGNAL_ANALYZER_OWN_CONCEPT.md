# Theia Signal Analyzer — własna koncepcja architektury

Ten dokument jest konsolidacją dwóch wcześniejszych konceptów i opinii recenzencyjnej.
Nie jest to po prostu „lista pomysłów”, tylko spójny model, w którym każdy element
ma zdefiniowaną rolę i zależności.

## 1. Główna zasada: Data-Centric Platform, nie „aplikacja z dekoderami”

System nie jest kolekcją funkcji, tylko **platformą zorientowaną na dane**.
Surowe próbki rezydują we współdzielonej warstwie pamięci, a wszyscy konsumenci
(AI, wykresy, dekodery, analizatory, comparator) czytają z tego samego źródła równolegle.

To jest fundamentalna różnica względem klasycznego edytora: dane nie „płyną” od A do B —
**rezydują**, a moduły podłączają się do wspólnej, indeksowanej w czasie warstwy.

## 2. Warstwy architektury (skonsolidowane)

### Warstwa 1 — Hardware & Ingestion (HAL)
Izolacja źródeł danych:
- Saleae, FTDI, sigrok, SocketCAN, pliki VCD/CSV/PCAP.
- HAL przekształca surowy strumień sterownika na ustandaryzowane bloki próbek
  (`SampleBlock`) o stałym rozmiarze (np. 64 KB) z precyzyjnym znacznikiem czasu
  (`timestamp offset + sample rate`).

HAL nie zna dekoderów ani UI — tylko normalizuje wejście.

**Wymaganie z opinii:** musi obsługiwać `CaptureMode: LIVE | RECORDED | REPLAY`
z backpressure i ring buffer dla live capture.

### Warstwa 2 — Core Data Engine (Zero-Copy Shared Store + PagedStore)
Centralna pamięć systemu:
- Próbki cyfrowe i analogowe trafiają do `SharedArrayBuffer` (Electron/JS)
  lub współdzielonej pamięci (Rust/C++ core).
- Indeksowanie czasowe przez **Chunked Interval Tree** — lookup zakresu
  $[t_{start}, t_{stop}]$ w $O(\log N)$.
- **Zero-Copy Read**: AI, wykresy i dekodery czytają z tych samych wskaźników,
  bez kopiowania danych.

**Wymaganie z opinii:** dla dużych plików (`1h CAN-FD @ 8 Mbps`, `100 MS/s analog`)
potrzebny jest **PagedSampleStore** — memory-mapped files z LRU cache.
Indeks czasowy powinien wskazywać na offsety w pliku, nie tylko w RAM.

### Warstwa 3 — Dynamic Pipeline & Stacked Decoders (DAG)
Silnik dekodujący zarządza **skierowanym grafem acyklicznym (DAG)** dekoderów:
- Dekoder poziomu 0 (np. UART) emituje `AnnotationStream`.
- Dekoder poziomu 1 (np. Modbus RTU) konsumuje adnotacje UART, nie surowe próbki.
- **Decode-on-Demand**: przetwarzanie uruchamia się tylko dla widocznego okna
  czasowego + marginesu buforowego, nie dla całego trace'a.

**Wymaganie z opinii:** błędy w strumieniu adnotacji muszą być first-class citizen.
Dekodery wyższego poziomu muszą obsługiwać `GAP` i `RESYNC` adnotacje.
`AnnotationStreamError` nie może zatrzymywać całego pipeline'a.

### Warstwa 4 — Knowledge & Semantic Layer
Dekodowanie protokołu to połowa sukcesu. Druga to **semantyka**:
- Słowniki mapowania: `.dbc` (CAN), `.svd` (rejestry procesora), JSON dla niestandardowych.
- `ProtocolAnnotation` → warstwa słownika dodaje: jednostka, skala, zakres, znaczenie pola.
- AI analizuje dane **wzbogacone o słownik**, nie surowe bajty — drastycznie rośnie precyzja.

### Warstwa 5 — Visualization & Interaction
Wielu konsumentów renderujących równolegle:
- WebGL/WebGPU waveform renderer z LOD (Level of Detail) i decymacją (Min/Max bucket).
- Hex / ASCII / bit / numeric view.
- XY plot.
- Annotation overlay (etykiety, ramki, kolory).
- Viewport Controller synchronizuje zoom/panorama między widokami
  (Waveform ↔ Table ↔ Chart).

**Wymaganie z opinii:** fallback na `Canvas2DRenderer` dla środowisk bez GPU.
`SharedArrayBuffer` wymaga cross-origin isolation (COOP/COEP) — opcjonalne.

### Warstwa 6 — Analysis & Intelligence
- **Semantic AI Aggregator**: kompresja 10k ramek w streszczenie strukturalne
  dla LLM (limit tokenów). AI dociąga szczegóły na żądanie.
- **AI Anomaly Detector**: analiza strumienia adnotacji — błędy czasowe (jitter),
  logiczne, anomalie wartości.
- **Virtual Math Channels**: kanały wyliczane ($CH_1 - CH_2$, $\log(CH_1)$, duty cycle, jitter).
- **Session Comparator** z Dynamic Time Warping (DTW) — porównywanie po
  wzorcach adnotacji, nie po bezwzględnym czasie.

**Wymaganie z opinii:** rozdziel `AIContextProvider` na:
- `SemanticAggregator` (podsumowanie),
- `AnomalyDetector` (statystyczny / ML),
- `QueryTranslator` (natural language → query do AnnotationIndex).

## 3. Kontrakt dekodera (stabilny, warstwowy, z walidacją)

Zanim powstanie pierwszy provider, kontrakt musi być ustalony — zmiana później
oznacza przepisanie wszystkich dekoderów.

```ts
export interface ChannelGroupSpec {
  id: string;
  name: string;
  roles: {
    roleName: string; // np. "CLK", "SDA", "TX", "MOSI"
    required: boolean;
    channelId?: string;
  }[];
}

export interface ProtocolAnnotation {
  id: string;
  startTime: number; // nanosekundy / ticki
  endTime: number;
  type: string;      // np. "START", "ADDRESS", "DATA_BYTE", "ERROR", "GAP", "RESYNC"
  displayValue: string;
  payload?: Record<string, unknown>;
}

export interface DecoderProvider {
  id: string;
  displayName: string;
  apiVersion: string;  // np. "1.2" — wersjonowanie kontraktu
  inputType: string;   // "raw-digital" | "raw-analog" | "annotation:<decoder_id>"
  outputType: string;  // np. "annotation:i2c", "annotation:modbus"
  channelRequirements?: ChannelGroupSpec;
  decode(
    input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
    options: Record<string, unknown>
  ): AsyncIterable<ProtocolAnnotation>;
}
```

Dzięki `inputType`/`outputType` silnik DAG sam buduje łańcuchy (topological sort),
zamiast ręcznego okablowywania każdej kombinacji protokołów.

**Wymaganie z opinii:** `apiVersion` dla backward compatibility.
Migrator schematów dla plików sesji przy zmianie wersji.

## 4. Mechanizmy operacyjne (z opinii)

### Sandboxing dekoderów
Dekodery działają w izolowanych workerach:
- Python subprocess (libsigrokdecode) przez IPC,
- WASM sandbox dla nowych dekoderów.
Core waliduje każdą `ProtocolAnnotation` przed wpuszczeniem do bufora
(sprawdza `endTime >= startTime`, limity pamięci, timeout, circuit breaker).

### Undo/Redo (Command Pattern)
Wszystkie mutacje sesji to `SessionCommand`:
- zaznaczenie regionu,
- zmiana przypisania kanałów,
- dodanie dekodera.
`ImmutableSessionState` — każda zmiana tworzy nowy snapshot (structural sharing).

### AnnotationIndex (wyszukiwarka)
Przy milionach ramek użytkownik musi móc wyszukiwać:
- „Znajdź wszystkie ramki CAN z ID 0x7DF, gdzie data[0] == 0x02
  i wystąpiły między 12.3s a 45.6s”.
`AnnotationIndex` — inverted index po `type`, `displayValue`, `payload`, czas.
Regex/wildcard search. W core, nie w UI.

### Export/Import framework
`ExportProvider` i `ImportProvider` jako first-class extension points:
- eksport: VCD, CSV, PCAP/PCAPNG, JSON, Markdown report,
- import: Saleae, sigrok, Tektronix, Keysight.

### Plugin dependency resolver
`PluginRegistry` z rozwiązywaniem zależności:
- topological sort,
- wykrywanie cykli,
- wersjonowanie semver.

## 5. Model danych (core, rozszerzony)

- `CaptureSession` — jedna sesja przechwytu, z metadanymi źródła i `CaptureMode`.
- `SignalChannel` — pojedynczy strumień (cyfrowy lub analogowy).
  - `source: 'hardware' | 'math' | 'derived'` — kanały wirtualne w core.
- `ChannelGroup` — grupa zsynchronizowanych kanałów (SPI, parallel bus).
- `TraceRegion` — zakres czasowy z adnotacją użytkownika/dekodera.
- `ProtocolAnnotation` — jednostka wyjścia dekodera, typowana, z `GAP`/`RESYNC`.
- `DecodeResult` — wynik dekodowania regionu, strumieniowy.
- `ComparisonSnapshot` — migawka do porównania sesji.
- `VirtualChannel` — kanał wyliczany matematycznie, traktowany jak fizyczny.
- `GlobalTimeline` — wspólny clock dla wielu domen, z `clock_offset` i `drift_factor`.
- `AnnotationIndex` — inverted index dla wyszukiwania.
- `SessionCommand` — komenda mutacji sesji dla undo/redo.

## 6. Roadmap wdrożenia (skonsolidowany, z priorytetami)

### Faza 1 — Fundamenty danych (P0)
- `PagedSampleStore` (mmap + LRU) — nie tylko RAM.
- Chunked Interval Tree ($O(\log N)$ lookup).
- HAL z `CaptureMode: LIVE | RECORDED | REPLAY` i backpressure.
- `SignalChannel` z `source: 'hardware' | 'math' | 'derived'`.
- `ChannelGroup`, `CaptureSession`.

### Faza 2 — Silnik przetwarzania (P0)
- Kontrakt `DecoderProvider` z `apiVersion`.
- DAG Engine (topological sort, automatyczne łańcuchy).
- Decode-on-Demand (lazy, oknami).
- **Model błędów**: `GAP`/`RESYNC` w `AnnotationStream`.
- **Sandboxing**: worker process + walidacja wyjścia.
- Most libsigrokdecode (adapter Python IPC).

### Faza 3 — Wizualizacja (P1)
- WebGL/WebGPU waveform renderer z LOD.
- Fallback `Canvas2DRenderer`.
- Hex / ASCII / bit / numeric view.
- XY plot.
- Annotation overlay.
- Viewport Controller (synchronizacja zoomu między panelami).

### Faza 4 — Analiza i UX (P1)
- **AnnotationIndex** (wyszukiwarka semantyczna).
- **Undo/Redo** (Command Pattern, ImmutableSessionState).
- **Export/Import** framework.
- Słowniki metadanych (.dbc, .svd, JSON).
- Virtual Math Channels w core.

### Faza 5 — Inteligencja i ekosystem (P2)
- Semantic AI Aggregator (kompresja dla LLM).
- AI Anomaly Detector.
- Session Comparator z DTW.
- **Plugin dependency resolver**.
- **DecoderTestHarness** (golden traces, regression testing).
- Public Plugin API + SDK.

### Faza 6 — Współpraca i zaawansowane (P3)
- Collaboration / CRDT annotations.
- N-way diff w Comparatorze.
- Protocol Generator / Simulator.
- Multi-Domain Clocking (GlobalTimeline).

## 7. Rekomendowany stack technologiczny

- **Core logic**: Rust lub C++ (pamięć, obliczenia, integracja libsigrok).
- **Core ↔ UI**: `SharedArrayBuffer` (dane) + gRPC/WebSocket (komendy).
- **Frontend**: TypeScript + React + WebGL/WebGPU (fallback Canvas2D).
- **AI Layer**: Python (PyTorch/TensorFlow) jako mikroserwis przez gRPC.
- **Dekodery**: Python (libsigrokdecode) + WASM dla nowych dekoderów.
- **Plugin System**: manifesty funkcjonalności, semver, sandboxing.

## 8. Dlaczego ten model jest „rozwojowy”

- **Modułowość**: nowy renderer (WebGL → WebGPU) = wymiana tylko warstwy 5.
- **Skalowalność**: Zero-Copy + Decode-on-Demand + PagedStore — 1 MB i 1 GB działają tak samo.
- **Ekosystem**: most sigrok + Plugin API = nie piszesz każdego protokołu sam.
- **Gotowość na AI**: separacja surowe dane → adnotacje → semantyka sprawia,
  że AI jest kolejnym konsumentem, a nie doklejonym modułem.
- **Stabilność**: sandboxing + walidacja + fault-tolerant pipeline =
  system nie umiera przy pierwszym błędzie dekodera.

## 9. Wniosek końcowy

Najdroższy błąd przy celu „prawie wszystkie protokoły” to zbudowanie dekodera
jako czarnej skrzynki próbki-in/wynik-out bez warstwowości. Działa to dla 2-3
protokołów, potem każdy kolejny wymaga coraz więcej roboty.

Drugi najdroższy błąd to zbyt szybkie wejście w wizualizację i AI,
zanim data layer i kontrakt dekodera będą odporne na błędy i skalowalne.

Ten model unika obu błędów przez:
- warstwowy kontrakt dekodera (DAG) z wersjonowaniem,
- współdzielony magazyn danych (Zero-Copy + PagedStore),
- decode-on-demand,
- model błędów w strumieniu adnotacji,
- sandboxing i walidację,
- słowniki semantyczne,
- AI jako konsumenta adnotacji, nie bajtów.
