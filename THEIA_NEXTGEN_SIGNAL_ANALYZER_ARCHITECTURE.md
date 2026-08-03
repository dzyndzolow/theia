# Theia NextGen Signal Analyzer — Autorska Architektura Systemu

**Autor:** Antigravity AI Engine (Google DeepMind Agentic Coding Team)  
**Wersja:** 2.0-PROD  
**Data:** 2026-08-03  
**Status:** Rekomendowana Architektura Produkcyjna  

---

## 1. Wstęp i Geneza Architektury

Analiza istniejących dokumentów (`THEIA_SIGNAL_ANALYZER_ARCHITECTURE.md` oraz `THEIA_SIGNAL_ANALYZER_CONSOLIDATED_MODEL.md`), a także przegląd modułu `packages/can-bus`, ujawnia fundamentalne wyzwanie:
Dotychczasowe rozwiązania analityczne w środowiskach IDE częstokroć popełniają jeden z dwóch błędów:
1. **Podejście klasyczne (Monolityczny Widget)** — tak jak w MVP `packages/can-bus`: ciasno sprzężony widget odczytuje ramki przez JSON-RPC, trzyma je w tablicy w pamięci przeglądarki i przerysowuje tabelkę HTML. Działa to przy 500 ramek/s, lecz ulega załamaniu przy 100 000 próbkach/s z analizatora logicznego lub oscyloskopu.
2. **Podejście potokowe (Pipeline-Centric)** — dane są przesyłane z dekodera do wykresu i dalej do tabeli. Przełączanie widoków lub dodawanie kolejnych dekoderów powoduje wielokrotne kopiowanie pamięci (RAM churn) i przytłacza Garbage Collector (GC).

**Autorska Wersja Antigravity (NextGen Architecture)** opiera się na **Trzech Filarach**:
1. **Zero-Copy Shared Memory Fabric** w procesach Electron / Worker Threads.
2. **JIT DAG Decoder Engine** z leniwą ewaluacją i dwupoziomowym buforem adnotacji.
3. **Semantic AI RAG & Context Engine** ze zintegrowaną szyną słowników (.dbc, .svd, PCAP).

---

## 2. Diagram Architektury Systemu (System Topography)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                HARDWARE & INGESTION LAYER                              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌────────────┐  │
│  │ Linux SocketCAN │    │ USB/Serial FTDI  │    │ Saleae / sigrok │    │ File Stream│  │
│  │ (can0, vcan0)   │    │ (UART/SPI/I2C)   │    │ Logic Analyzer  │    │ (VCD/PCAP) │  │
│  └────────┬────────┘    └────────┬─────────┘    └────────┬────────┘    └─────┬──────┘  │
└───────────┼──────────────────────┼───────────────────────┼───────────────────┼────────┘
            │                      │                       │                   │
┌───────────▼──────────────────────▼───────────────────────▼───────────────────▼────────┐
│                              ELECTRON BACKEND PROCESS (Node.js)                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ HAL Ingestion Service (C++ Native Addon / Rust Node-API Binding)                │  │
│  │ - Pakiety próbek normalizowane do Ring Buffer (SampleBlock = 64KB)               │  │
│  └────────────────────────────────────────┬─────────────────────────────────────────┘  │
└───────────────────────────────────────────┼────────────────────────────────────────────┘
                                            │ Zero-Copy SharedArrayBuffer (Atomics)
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                             ELECTRON RENDERER & WORKER THREADS                         │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                      CORE ZERO-COPY SHARED MEMORY STORE                          │  │
│  │  - Raw Digital/Analog Buffers (SharedArrayBuffer)                                │  │
│  │  - Chunked Interval Tree ($O(\log N)$ temporal index)                            │  │
│  │  - Ring Buffer for Real-Time Streaming Ingestion                                 │  │
│  └──────────┬─────────────────────────────┬───────────────────────────┬─────────────┘  │
│             │                             │                           │                │
│  ┌──────────▼──────────────┐   ┌──────────▼───────────────┐   ┌───────▼─────────────┐  │
│  │ WebGL/WebGPU Worker     │   │ JIT DAG Decoder Engine   │   │ Semantic Schemas    │  │
│  │ - Min-Max LOD Decimator │   │ - Decode-on-Demand       │   │ - .dbc, .svd, PCAP  │  │
│  │ - Direct VBO Upload     │   │ - Stacked DAG Decoders   │   │ - Field Map Engine  │  │
│  └──────────┬──────────────┘   └──────────┬───────────────┘   └───────┬─────────────┘  │
│             │                             │                           │                │
│  ┌──────────▼─────────────────────────────▼───────────────────────────▼─────────────┐  │
│  │                            VIEWPORT MASTER CONTROLLER                            │  │
│  │      Synchronizuje Zoom, Pan, Cursor & Temporal Range ($[t_{start}, t_{stop}]$)    │  │
│  └──────────┬─────────────────────────────┬───────────────────────────┬─────────────┘  │
│             │                             │                           │                │
│  ┌──────────▼──────────┐   ┌──────────────▼─────────┐    ┌────────────▼────────────┐  │
│  │ Waveform Panel      │   │ Hex/ASCII/Bit Panel     │    │ Protocol Table & Tree   │  │
│  │ (WebGL/WebGPU View) │   │ (Virtual Scroll View)  │    │ (Decoded Structures)    │  │
│  └─────────────────────┘   └────────────────────────┘    └─────────────────────────┘  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                       AI ASSISTANT & ANOMALY INSPECTOR                           │  │
│  │  - RAG AST Summarizer (Zagęszczony kontekst ramek dla LLM)                        │  │
│  │  - Interactive Query Tool (Odtwarzanie, Wyliczanie DTW, Szukanie Błędów)        │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Szczegółowy Opis Warstw Architektury

### Warstwa 1: Hardware Abstraction Layer (HAL) & Ingestion
- **Cel:** Przekształcenie dowolnego fizycznego lub plikowego źródła danych w bezstratny strumień bloków `SampleBlock`.
- **Mechanizm:**
  - Praca z natywnym addonem Rust/C++ (`node-addon-api`) w procesie backendu Theia.
  - Zamiast przekazywać pojedyncze obiekty JavaScript przez IPC (`process.send` lub JSON-RPC), HAL zapisuje dane bezpośrednio w sekcji `SharedArrayBuffer`, synchronizowanej przez operacje `Atomics.notify()` / `Atomics.wait()`.
  - Blok próbek `SampleBlock`:
    ```typescript
    export interface SampleBlockHeader {
      blockId: number;
      channelId: string;
      sampleRate: number;      // Hz
      startTimeNs: bigint;     // Absolutny czas w nanosekundach
      sampleCount: number;     // Liczba próbek w bloku (np. 65536)
      dataType: 'BIT_PACKED' | 'INT8' | 'INT16' | 'FLOAT32';
    }
    ```

### Warstwa 2: Core Data Engine (Zero-Copy Shared Memory Store)
- **Struktura Pamięci:**
  - **Shared Memory Arena:** Jeden ciągły obszar `SharedArrayBuffer` przydzielany alokatorem kaskadowym (Slab Allocator).
  - **Chunked Interval Tree:** Indeks przestrzenno-czasowy zorganizowany w drzewo przedziałowe o stałym rozmiarze węzłów (chunks). Odpytanie o widoczne okno czasowe $[t_{start}, t_{stop}]$ zwraca wskaźniki do bloków w czasie $O(\log N + K)$.
  - **Brak operacji Garbage Collector:** Wszystkie odczyty przez UI, WebGL i dekodery bazują na widokach `TypedArray` (np. `Uint8Array`, `Float32Array`) utworzonych na istniejącym `SharedArrayBuffer`.

### Warstwa 3: JIT DAG Decoder Engine (Silnik Dekodowania na Żądanie)
- **Model DAG (Directed Acyclic Graph):**
  - Dekodery nie tworzą sztywnych łańcuchów, lecz deklarują typy wejściowe i wyjściowe:
    - np. `UART Decoder`: `raw-digital` → `annotation:uart`
    - `Modbus RTU Decoder`: `annotation:uart` → `annotation:modbus`
    - `Custom Industrial Protocol`: `annotation:modbus` → `annotation:factory-telemetry`
  - Silnik dokonuje sortowania topologicznego i automatycznie buduje potok.
- **JIT & Wing Buffering (Decode-on-Demand):**
  - Dekodowanie nie wykonuje się dla całego pliku 1 GB. Dekodowane jest **tylko aktywne okno Viewportu** powiększone o 20% marginesu z lewej i prawej strony (skrzydła).
  - Zmiana powiększenia (zoom) lub przewinięcie (pan) wyzwala leniwe dekodowanie (Lazy Execution) w tle w odrębnym `WebWorkerze`.
- **Interfejs Dekodera:**
  ```typescript
  export interface ChannelRole {
    roleName: string; // np. "TX", "RX", "SDA", "SCL", "CLK"
    required: boolean;
    assignedChannelId?: string;
  }

  export interface ProtocolAnnotation {
    id: string;
    parentAnnotationId?: string; // Dla hierarchii DAG
    startTimeNs: bigint;
    endTimeNs: bigint;
    level: number;               // Warstwa w grafie DAG (0, 1, 2...)
    type: string;                // np. "START_BIT", "DATA_FRAME", "CRC_ERROR"
    summary: string;             // Krótka etykieta dla UI
    payload?: Record<string, unknown>;
  }

  export interface DecoderProvider {
    readonly id: string;
    readonly displayName: string;
    readonly inputType: string;
    readonly outputType: string;
    readonly channelRoles: ChannelRole[];

    decode(
      input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
      options: Record<string, unknown>
    ): AsyncIterable<ProtocolAnnotation>;
  }
  ```

### Warstwa 4: Semantic Metadata & Schema Engine
- **Cel:** Przekształcenie surowych bajtów i etykiet zdekodowanych z protokołu w pojęcia biznesowe.
- **Obsługiwane słowniki:**
  - **.DBC / .ARXML** — Magistrale CAN, LIN, FlexRay (automotyw).
  - **.SVD / XML** — Rejestry procesorów i mikrokontrolerów (embedded/IoT).
  - **PCAP / Wireshark Dissectors** — Protokoły sieciowe (Ethernet, UDP, CoAP, MQTT).
  - **JSON/YAML Schemas** — Autorskie telemetrie użytkownika.
- **Wirtualne Kanały Matematyczne (Virtual Math Channels):**
  - Wyliczanie w czasie rzeczywistym nowych sygnałów: $CH_{math} = f(CH_1, CH_2, \dots)$.
  - Obsługa operacji: Różnicowych ($CH_1 - CH_2$), FFT (spektrogram), Duty Cycle, Jitter, Bit Error Rate (BER).

### Warstwa 5: High-Performance Renderer & Viewport Synchronization
- **WebGL/WebGPU Waveform Renderer:**
  - Renderer przetwarza próby cyfrowe i analogowe przy użyciu shaderów.
  - **Min-Max LOD Decymacja:** Gdy na 1 piksel widoku przypada 10 000 próbek, WebWorker oblicza tylko wartość minimalną i maksymalną w danym kubełku czasowym (Bucket). GPU rysuje pionowy odcinek reprezentujący obwiednię sygnału. Brak gubienia pików (glitch detection)!
- **Viewport Master Controller:**
  - Centralny kontroler zdarzeń synchronizujący wszystkie widoki.
  - Zmiana czasu kursora lub zoomu w panelu *Waveform* błyskawicznie przesuwa widok tabeli *Hex View*, przewija wiersz w *Protocol Table* i uaktualnia wskaźnik na *XY Plot*.

### Warstwa 6: AI Assistant Bridge (Semantic RAG & Anomaly Engine)
- **Problem LLM:** Model językowy nie przetworzy 1 000 000 surowych bajtów ze względu na limit tokenów i czas odpowiedzi.
- **Rozwiązanie Antigravity — Dynamic RAG AST Summarizer:**
  1. AI odbiera zagęszczone drzewo składniowe ramek adnotacji (np. "W oknie czasowym t=10s..12s przesłano 500 ramek Modbus, z czego 3 zawierały błąd CRC").
  2. Model AI ma dostęp do **Tool-Use API** wewnątrz Theia:
     - `get_exact_range(t_start, t_stop)` — dociąga precyzyjne ramki z wybranego przedziału.
     - `compare_sessions_dtw(sessionA, sessionB)` — uruchamia algorytm Dynamic Time Warping do porównywania sygnałów niezależnie od dryfu zegara.
     - `explain_anomaly(annotation_id)` — analizuje anomalie zgłoszone przez detektor regułowy.

---

## 4. Model Integracji z Eclipse Theia

Architektura opiera się na standardowych wzorcach Theia Extension:

```typescript
// packages/signal-analyzer/src/browser/signal-analyzer-frontend-module.ts
import { ContainerModule } from '@theia/core/shared/inversify';
import { WidgetFactory, OpenHandler } from '@theia/core/lib/browser';
import { SignalAnalyzerWidget } from './signal-analyzer-widget';
import { SignalAnalyzerContribution } from './signal-analyzer-contribution';
import { SignalCoreService } from '../common/signal-core-service';

export default new ContainerModule(bind => {
  bind(SignalCoreService).toSelf().inSingletonScope();
  bind(SignalAnalyzerWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: SignalAnalyzerWidget.ID,
    createWidget: () => ctx.container.get(SignalAnalyzerWidget)
  }));
  bind(SignalAnalyzerContribution).toSelf().inSingletonScope();
  bind(OpenHandler).toService(SignalAnalyzerContribution);
});
```

### Migracja Pakietu `@theia/can-bus`
Istniejący pakiet `packages/can-bus` zostaje przekształcony w natywną wtyczkę protokołu dla Signal Analyzera:
1. Podłącza się pod `DecoderProvider` rejestrując `inputType: 'raw-can'` oraz `outputType: 'annotation:can'`.
2. Zastosowuje słownik `.dbc` poprzez warstwę metadanych `Semantic Metadata Engine`.
3. Renderuje dedykowaną tabelę ramek wewnątrz uniwersalnego kontenera `SignalAnalyzerWidget`.

---

## 5. Strategia Bezpieczeństwa, Rozszerzalności i Performance Benchmarks

| Cecha | Zastosowane Rozwiązanie | Korzyść |
|---|---|---|
| **Wydajność Próbkowania** | Zero-Copy `SharedArrayBuffer` + Web Workers | Obsługa > 10 000 000 próbek/s bez lagów UI |
| **Izolacja Dekoderów** | WebAssembly (WASM) / Python IPC Sidecar | Awaria dekodera nie wysypuje IDE Theia |
| **Pamięć i GC** | Slab Allocator + TypedArrays | Zero podskoków Garbage Collectora |
| **Renderowanie** | WebGL / WebGPU z Min-Max LOD Shader | Płynne 60 FPS przy zoomowaniu milionów punktów |
| **Skalowalność Protokołów** | DAG Engine z `inputType`/`outputType` | Dodanie protokołu B nad A wymaga tylko 1 klasy |
| **Integracja z AI** | Aggregated AST RAG + Tool API | AI rozumie kontekst bez przekraczania tokenów |

---

## 6. Podsumowanie i Rekomendowany Plan Działań

Ta autorska architektura łagodzi dotychczasowe ograniczenia prostego widgetu CAN i łączy zalety platformy Data-Centric z architekturą Eclipse Theia.

### Etapy Wdrożenia:
1. **Faza 1 (Core Engine):** Utworzenie `@theia/signal-analyzer-core` z buforem `SharedArrayBuffer` i indeksowaniem `Chunked Interval Tree`.
2. **Faza 2 (Decoder DAG & WebGL):** Wdrożenie silnika JIT DAG oraz WebGL renderera dla ścieżek sygnałowych.
3. **Faza 3 (Wtyczka CAN & Metadata):** Przeniesienie `@theia/can-bus` do nowej architektura z obsługą `.dbc`.
4. **Faza 4 (AI Inspector):** Podłączenie asystenta AI do interfejsu RAG AST dla automatycznej diagnostyki anomalii.
