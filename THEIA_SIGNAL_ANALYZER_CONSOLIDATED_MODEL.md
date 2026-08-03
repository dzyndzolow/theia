# Theia Signal Analyzer — konsolidacja modelu architektonicznego

Ten dokument jest autorską konsolidacją trzech wcześniejszych konceptów (`New_concept.md`).
Celem jest jeden spójny model, a nie zbiór luźnych pomysłów.

## 1. Zasada nadrzędna: Data-Centric Platform

System nie jest „aplikacją z dekoderami”, tylko **platformą zorientowaną na dane**.
Surowe próbki rezydują w jednej, współdzielonej warstwie pamięci, a wszyscy konsumenci
(AI, wykresy, dekodery, analizatory, comparator) czytają z tego samego źródła równolegle.

Kluczowa różnica względem klasycznego edytora: dane nie „płyną” od A do B — **rezydują**,
a moduły podłączają się do wspólnej, indeksowanej w czasie warstwy.

## 2. Warstwy architektury

### Warstwa 1 — Hardware & Ingestion (HAL)
Izolacja źródeł danych:
- Saleae, FTDI, sigrok, SocketCAN, pliki VCD/CSV/PCAP.
- HAL przekształca surowy strumień sterownika na ustandaryzowane bloki próbek
  (`SampleBlock`) o stałym rozmiarze (np. 64 KB) z precyzyjnym znacznikiem czasu
  (`timestamp offset + sample rate`).

HAL nie zna dekoderów ani UI — tylko normalizuje wejście.

### Warstwa 2 — Core Data Engine (Zero-Copy Shared Store)
Centralna pamięć systemu:
- Próbki cyfrowe i analogowe trafiają do `SharedArrayBuffer` (Electron/JS)
  lub współdzielonej pamięci (Rust/C++ core).
- Indeksowanie czasowe przez **Chunked Interval Tree** — lookup zakresu
  $[t_{start}, t_{stop}]$ w $O(\log N)$.
- **Zero-Copy Read**: AI, wykresy i dekodery czytają z tych samych wskaźników,
  bez kopiowania danych.

To jest fundament „multimedialnego kombajnu” — jeden magazyn, wielu konsumentów.

### Warstwa 3 — Dynamic Pipeline & Stacked Decoders (DAG)
Silnik dekodujący zarządza **skierowanym grafem acyklicznym (DAG)** dekoderów:
- Dekoder poziomu 0 (np. UART) emituje `AnnotationStream`.
- Dekoder poziomu 1 (np. Modbus RTU) konsumuje adnotacje UART, nie surowe próbki.
- **Decode-on-Demand**: przetwarzanie uruchamia się tylko dla widocznego okna
  czasowego + marginesu buforowego, nie dla całego trace'a.

To rozwiązuje problem wydajności przy milionach ramek — nie dekodujemy „z góry na całość”.

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

### Warstwa 6 — Analysis & Intelligence
- **Semantic AI Aggregator**: kompresja 10k ramek w streszczenie strukturalne
  dla LLM (limit tokenów). AI dociąga szczegóły na żądanie.
- **AI Anomaly Detector**: analiza strumienia adnotacji — błędy czasowe (jitter),
  logiczne, anomalie wartości.
- **Virtual Math Channels**: kanały wyliczane ($CH_1 - CH_2$, $\log(CH_1)$, duty cycle, jitter).
- **Session Comparator** z Dynamic Time Warping (DTW) — porównywanie po
  wzorcach adnotacji, nie po bezwzględnym czasie.

## 3. Kontrakt dekodera (stabilny, warstwowy)

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
  type: string;      // np. "START", "ADDRESS", "DATA_BYTE", "ERROR"
  displayValue: string;
  payload?: Record<string, unknown>;
}

export interface DecoderProvider {
  id: string;
  displayName: string;
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

## 4. Kluczowe decyzje architektoniczne (uzasadnione)

| Decyzja | Uzasadnienie |
|---|---|
| **Stacked decoders (DAG)** | Bez tego liczba dekoderów rośnie liniowo z kombinacjami protokołów; z tym — liniowo z liczbą warstw. |
| **ChannelGroup w core** | SPI, I2C, parallel bus — wszystkie są multi-kanałowe. Synchronizacja to robota core'a, nie każdego dekodera. |
| **Decode-on-Demand** | Miliony ramek zamroziłyby UI przy „zdekoduj wszystko”. |
| **Zero-Copy Shared Store** | Wielu konsumentów (AI, wykresy, analizatory) bez dublowania obliczeń i pamięci. |
| **Semantic AI Aggregator** | LLM nie przyjmie 1M ramek; agregator daje skondensowany kontekst. |
| **DTW w Comparatorze** | Trigger rzadko w tym samym nanosekundzie — porównywanie po wzorcach, nie po $t$. |
| **Most libsigrokdecode** | 150+ battle-tested dekoderów zamiast reimplementacji specyfikacji CAN/JTAG/USB od zera. |
| **Słowniki metadanych** | „Bajt 0x04 = temperatura silnika” — druga połowa analizy, nie opcja. |
| **Plugin System (WASM/Python)** | Nowy dekoder ≠ recompile core; piaskownice izolują awarie. |
| **Multi-Domain Clocking** | Logic Analyzer + Oscyloskop + logi UART — wspólny `GlobalTimeline` z `clock_offset` i `drift_factor`. |

## 5. Model danych (core)

- `CaptureSession` — jedna sesja przechwytu, z metadanymi źródła.
- `SignalChannel` — pojedynczy strumień (cyfrowy lub analogowy).
- `ChannelGroup` — grupa zsynchronizowanych kanałów (SPI, parallel bus).
- `TraceRegion` — zakres czasowy z adnotacją użytkownika/dekodera.
- `ProtocolAnnotation` — jednostka wyjścia dekodera, typowana.
- `DecodeResult` — wynik dekodowania regionu, strumieniowy.
- `ComparisonSnapshot` — migawka do porównania sesji.
- `VirtualChannel` — kanał wyliczany matematycznie.
- `GlobalTimeline` — wspólny clock dla wielu domen.

## 6. Roadmap wdrożenia (skonsolidowany)

### Faza 1 — Fundamenty danych
- `SharedArrayBuffer` / pamięć mapowana.
- Chunked Interval Tree ($O(\log N)$ lookup).
- HAL: uniwersalny interfejs źródeł.
- `SignalChannel`, `ChannelGroup`, `CaptureSession`.

### Faza 2 — Silnik przetwarzania
- Kontrakt `DecoderProvider` (warstwowy, z `inputType`/`outputType`).
- DAG Engine (topological sort, automatyczne łańcuchy).
- Decode-on-Demand (lazy, oknami).
- Most libsigrokdecode (adapter Python IPC).

### Faza 3 — Wizualizacja
- WebGL/WebGPU waveform renderer z LOD.
- Hex / ASCII / bit / numeric view.
- XY plot.
- Annotation overlay.
- Viewport Controller (synchronizacja zoomu między panelami).

### Faza 4 — Inteligencja
- Słowniki metadanych (.dbc, .svd, JSON).
- Virtual Math Channels.
- Semantic AI Aggregator (kompresja dla LLM).
- AI Anomaly Detector.

### Faza 5 — Ekosystem i narzędzia
- Session Comparator z DTW.
- Universal Trigger Engine (sprzętowy + programowy na adnotacjach).
- Public Plugin API + SDK.
- Export/Import (VCD, CSV, PCAP).

## 7. Rekomendowany stack technologiczny

- **Core logic**: Rust lub C++ (pamięć, obliczenia, integracja libsigrok).
- **Core ↔ UI**: `SharedArrayBuffer` (dane) + gRPC/WebSocket (komendy).
- **Frontend**: TypeScript + React + WebGL/WebGPU.
- **AI Layer**: Python (PyTorch/TensorFlow) jako mikroserwis przez gRPC.
- **Dekodery**: Python (libsigrokdecode) + WASM dla nowych dekoderów.

## 8. Dlaczego ten model jest „rozwojowy”

- **Modułowość**: nowy renderer (WebGL → WebGPU) = wymiana tylko warstwy 5.
- **Skalowalność**: Zero-Copy + Decode-on-Demand — 1 MB i 1 GB działają tak samo.
- **Ekosystem**: most sigrok + Plugin API = nie piszesz każdego protokołu sam.
- **Gotowość na AI**: separacja surowe dane → adnotacje → semantyka sprawia,
  że AI jest kolejnym konsumentem, a nie doklejonym modułem.

## 9. Wniosek końcowy

Najdroższy błąd przy celu „prawie wszystkie protokoły” to zbudowanie dekodera
jako czarnej skrzynki próbki-in/wynik-out bez warstwowości. Działa to dla 2-3
protokołów, potem każdy kolejny wymaga coraz więcej roboty.

Ten model unika tego błędu przez:
- warstwowy kontrakt dekodera (DAG),
- współdzielony magazyn danych (Zero-Copy),
- decode-on-demand,
- słowniki semantyczne,
- AI jako konsumenta adnotacji, nie bajtów.
