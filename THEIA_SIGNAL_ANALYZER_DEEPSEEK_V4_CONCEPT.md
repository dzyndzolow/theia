# Theia Signal Analyzer — Autorska Architektura DeepSeek V4 Pro

**Autor:** GitHub Copilot (DeepSeek V4 Pro)
**Wersja:** 1.0
**Data:** 2026-08-03
**Status:** Samodzielna analiza i koncepcja — bez kopiowania poprzednich

---

## 0. Co mówię NIE — błędy poprzednich koncepcji

Zanim napiszę co TAK, powiem czemu mówię NIE w poprzednich dokumentach:

| Błąd | Gdzie występuje | Dlaczego to błąd |
|------|----------------|-------------------|
| **Monolityczny widget z tablicą w JS** | `can-widget.ts` — `frames: CanFrame[]`, `addFrame()` pushuje do tablicy, `updateFrameTable()` przerysowuje całe DOM | Przy 5000 ramek/s GC zabija przeglądarkę. DOM to nie baza danych. |
| **SharedArrayBuffer backend↔renderer** | `THEIA_NEXTGEN` — sugeruje SAB między procesem Node a rendererem | SAB działa TYLKO w obrębie jednego procesu (renderer + jego workery). Backend Node.js to OSOBNY proces. Nie da się. |
| **Rust/gRPC/Python mikroserwisy** | `OWN_CONCEPT` — "Core logic: Rust lub C++", "AI Layer: Python jako mikroserwis" | Theia to monorepo TypeScript + Inversify. Dokładanie drugiego stosu technologicznego to przepis na porażkę — nikt tego nie utrzyma. |
| **Dekoder jako czarna skrzynka samples→result** | Wczesne wersje konceptów | Bez warstwowości (UART→Modbus→AppProtocol) każdy nowy protokół to osobny monolit. |
| **Brak modelu błędów w pipeline** | `CONSOLIDATED` | Jeden błąd CRC zatrzymuje cały pipeline? Nie do przyjęcia. |
| **AI jako "osobny moduł"** | Wszystkie koncepcje poza KIM3 | Theia ma już `@theia/ai-core` z `LanguageModel`, `ToolInvocationRegistry`, `AgentService`. Nie buduj drugiego systemu AI obok. |
| **Zbyt dużo warstw na starcie** | 6-7 warstw we wszystkich koncepcjach | Architektura warstwowa jest dobra, ale implementacja wszystkich naraz = nigdy nie wyjdzie poza dokument. |

---

## 1. Moja zasada numer 1: Ewolucja, nie architektura

Największy problem wszystkich poprzednich koncepcji: **próbują zaprojektować cały system z góry.**

Moje podejście: **zaprojektuj kontrakty (interfejsy), zaimplementuj minimalnie, iteruj.**

System rośnie tak:

```
Faza 0: can-bus MVP (już działa) → dodajemy backend → działa live capture
Faza 1: wydzielamy @theia/signal-core z kontraktami → can-bus używa kontraktów
Faza 2: dodajemy drugi protokół (UART) → weryfikujemy czy kontrakty działają
Faza 3: AI Agent → używa AnnotationIndex do wyszukiwania
Faza 4+: Comparator, DTW, Plugin SDK
```

Każda faza to **działający produkt**, nie dokument.

---

## 2. Kontrakty — jedyna rzecz którą projektuję z góry

Reszta może ewoluować. Kontrakty NIE MOGĄ. Jeśli kontrakt dekodera się zmieni, wszystkie dekodery do przepisania. Dlatego poniższe interfejsy są **zamrożone od dnia 1** i wersjonowane (`apiVersion`).

### 2.1. Kontrakt próbki (Sample)

```ts
/** Pojedynczy blok próbek — unit danych w systemie */
export interface SampleBlock {
    /** Unikalny identyfikator bloku */
    readonly blockId: number;
    /** Kanał źródłowy */
    readonly channelId: string;
    /** Częstotliwość próbkowania w Hz */
    readonly sampleRate: number;
    /** Czas startu bloku w nanosekundach od epoch */
    readonly startTimeNs: bigint;
    /** Liczba próbek w bloku */
    readonly sampleCount: number;
    /** Typ danych próbek */
    readonly dataType: 'BIT_PACKED' | 'UINT8' | 'UINT16' | 'FLOAT32';
    /** Surowe dane binarne (ArrayBuffer — zero-copy friendly) */
    readonly data: ArrayBuffer;
}
```

Dlaczego `ArrayBuffer` a nie `number[]`? Bo `ArrayBuffer` jest transferowalny między workerami bez kopiowania. `number[]` w JS to obiekt na stercie — każda ramka CAN to ~200 bajtów narzutu JS na 8 bajtów danych. Przy 10k ramek/s to 2 MB/s śmieci dla GC.

### 2.2. Kontrakt adnotacji (ProtocolAnnotation)

```ts
/** Pojedyncza adnotacja — wynik działania dekodera */
export interface ProtocolAnnotation {
    /** Unikalne ID */
    readonly id: string;
    /** ID adnotacji rodzica w DAG (null dla warstwy 0) */
    readonly parentId: string | null;
    /** Poziom w grafie DAG (0 = surowe próbki, 1+ = kolejne warstwy) */
    readonly level: number;
    /** Czas startu w nanosekundach */
    readonly startTimeNs: bigint;
    /** Czas końca w nanosekundach */
    readonly endTimeNs: bigint;
    /** Typ adnotacji — także "GAP" i "RESYNC" dla błędów */
    readonly type: string;
    /** Czytelna etykieta dla UI */
    readonly summary: string;
    /** Opcjonalne dane semantyczne (pola ramki, wartości) */
    readonly payload: Record<string, unknown> | null;
}
```

Kluczowe: `type: "GAP"` i `type: "RESYNC"` to **first-class** adnotacje. Dekoder warstwy N+1 MUSI je obsłużyć — np. Modbus na UART widzi GAP i restartuje parsowanie ramki.

### 2.3. Kontrakt dekodera (DecoderProvider)

```ts
/** Jeden kanał wymagany przez dekoder */
export interface ChannelRole {
    readonly roleName: string;   // "TX", "RX", "CLK", "SDA", "MOSI", "MISO", "CS"
    readonly required: boolean;
    readonly assignedChannelId?: string;
}

/** Provider dekodera — rejestrowany w DecoderRegistry */
export interface DecoderProvider {
    /** Unikalne ID dekodera */
    readonly id: string;
    /** Nazwa wyświetlana w UI */
    readonly displayName: string;
    /** Wersja API (semver) — dla backward compatibility */
    readonly apiVersion: string;

    /**
     * Co dekoder konsumuje:
     * - "raw-digital" — surowe próbki cyfrowe
     * - "raw-analog" — surowe próbki analogowe
     * - "annotation:can" — adnotacje z dekodera CAN
     * - "annotation:uart" — adnotacje z dekodera UART
     */
    readonly inputType: string;

    /**
     * Co dekoder produkuje:
     * - "annotation:can"
     * - "annotation:uart"
     * - "annotation:modbus"
     * - "annotation:canopen"
     */
    readonly outputType: string;

    /** Wymagane kanały (tylko dla inputType = raw-*) */
    readonly channelRoles: ChannelRole[];

    /**
     * Główna metoda dekodowania.
     * @param input — surowe okno próbek LUB strumień adnotacji z poprzedniej warstwy
     * @param options — opcje konfiguracyjne (bitrate, parity, etc.)
     * @returns strumień adnotacji (async iterable — działa z backpressure)
     */
    decode(
        input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
        options: Record<string, unknown>
    ): AsyncIterable<ProtocolAnnotation>;
}

/** Okno próbek — zakres czasowy + dane */
export interface SampleWindow {
    readonly startTimeNs: bigint;
    readonly endTimeNs: bigint;
    readonly blocks: SampleBlock[];
}
```

Dlaczego `AsyncIterable` a nie `Promise<ProtocolAnnotation[]>`? Bo:
- Dekoder może produkować adnotacje stopniowo (strumieniowo)
- Konsument (UI) może zacząć renderować zanim dekoder skończy
- Backpressure: jeśli UI nie nadąża, dekoder zwalnia
- Przy 1M ramek nie alokujemy 1M obiektów naraz w pamięci

### 2.4. Kontrakt wyszukiwarki (AnnotationIndex)

```ts
/** Zapytanie do wyszukiwarki adnotacji */
export interface AnnotationQuery {
    /** Zakres czasowy (opcjonalny) */
    timeRange?: { startNs: bigint; endNs: bigint };
    /** Filtruj po typie adnotacji */
    type?: string;
    /** Filtruj po polach payload (np. { "canId": 0x7DF }) */
    payloadFilter?: Record<string, unknown>;
    /** Szukaj tekstu w summary (regex) */
    textSearch?: string;
    /** Maksymalna liczba wyników */
    limit?: number;
}

/** Wynik wyszukiwania */
export interface AnnotationQueryResult {
    readonly annotations: ProtocolAnnotation[];
    readonly totalCount: number;
    readonly queryTimeMs: number;
}
```

---

## 3. Architektura — 4 warstwy, nie 7

Mniej warstw = mniej kodu = szybciej działa. Oto co NAPRAWDĘ potrzebne:

```
┌──────────────────────────────────────────────────────────────────┐
│ L4 │ KONSUMENCI                                                  │
│    │ Waveform(WebGL) │ Hex/Bit View │ Protocol Table │ AI Agent │
│    │ Comparator │ Export(CSV/JSON/VCD) │ Statistics              │
├──────────────────────────────────────────────────────────────────┤
│ L3 │ SILNIK DEKODOWANIA + SEMANTYKA                             │
│    │ DecoderRegistry (DAG) │ decode-on-demand │ AnnotationIndex  │
│    │ .dbc/.svd słowniki │ Virtual Math Channels                 │
├──────────────────────────────────────────────────────────────────┤
│ L2 │ MAGAZYN DANYCH                                             │
│    │ SampleStore (RingBuffer + PagedFile) │ IntervalTree index  │
│    │ Undo/Redo (Command pattern)                                │
├──────────────────────────────────────────────────────────────────┤
│ L1 │ INGESTION + TRANSPORT                                      │
│    │ HAL: SocketCAN │ serialport │ pliki VCD/CSV/PCAP │ symulator│
│    │ Transport: JSON-RPC (komendy) + binary chunked stream      │
└──────────────────────────────────────────────────────────────────┘
```

**Dlaczego 4 a nie 7?** Bo:
- "Semantyka" i "Silnik dekodowania" to ta sama warstwa — słownik `.dbc` to po prostu kolejny `DecoderProvider` z `inputType: "annotation:can"` i `outputType: "annotation:can-decoded"`
- "Inteligencja" (AI) to konsument — nie potrzebuje własnej warstwy
- "Wizualizacja" to konsument — nie potrzebuje własnej warstwy

---

## 4. Model pamięci — praktyczny, nie ideologiczny

Zero-copy jest super, ale tylko tam gdzie fizycznie działa:

| Ścieżka | Mechanizm | Zero-copy? |
|---------|-----------|------------|
| Backend → Frontend (dane) | Binarny chunked stream przez WebSocket | ❌ (osobne procesy) |
| Backend → Frontend (komendy) | Theia JSON-RPC | ❌ (ale to tylko małe komunikaty) |
| Frontend → WebWorker (dekodery) | `SharedArrayBuffer` + `Atomics` | ✅ |
| Frontend → WebWorker (LOD decymacja) | `SharedArrayBuffer` + `Atomics` | ✅ |
| Frontend → GPU (WebGL) | `bufferSubData` na VBO | ✅ (GPU czyta z RAM) |

**Backend trzyma dane w `PagedSampleStore`:**
- Live capture: `RingBuffer` w RAM (ostatnie N GB)
- Duże pliki: memory-mapped file + LRU cache stron
- Indeks: `ChunkedIntervalTree` — lookup $[t_1, t_2]$ w $O(\log N)$

**Frontend dostaje tylko widoczne okno:**
- `ViewportController` wysyła `[t_start, t_stop]` do backendu
- Backend zwraca `SampleBlock[]` dla tego zakresu (binary stream)
- Frontend kopiuje do `SharedArrayBuffer` → worker dekoduje → worker LOD → GPU renderuje
- Przy przewijaniu/zoomowaniu: nowe okno, nowy request

---

## 5. AI Agent — natywny, nie doklejony

Theia ma `@theia/ai-core` z:
- `LanguageModel` — dowolny provider (OpenAI, Anthropic, Ollama, etc.)
- `ToolInvocationRegistry` — rejestracja tooli
- `AgentService` — zarządzanie agentami
- `PromptService` — szablony promptów

**Mój AI Agent dla Signal Analyzer to zwykły Theia Agent z 4 toolami:**

```ts
@injectable()
export class SignalAnalyzerAgent implements Agent {
    id = 'signal-analyzer';
    name = 'Signal Analyzer Assistant';

    tools = [
        {
            name: 'search_annotations',
            description: 'Search decoded protocol annotations by type, payload, time range, or text',
            parameters: { /* JSON Schema dla AnnotationQuery */ },
            handler: (args) => this.annotationIndex.search(JSON.parse(args))
        },
        {
            name: 'get_time_range',
            description: 'Get detailed annotations and raw samples for a specific time range',
            parameters: { /* JSON Schema */ },
            handler: (args) => this.sampleStore.queryRange(JSON.parse(args))
        },
        {
            name: 'get_statistics',
            description: 'Get current session statistics (frame count, FPS, bus load, errors)',
            parameters: { /* JSON Schema */ },
            handler: () => this.statisticsService.getSnapshot()
        },
        {
            name: 'compare_sessions',
            description: 'Compare two capture sessions using Dynamic Time Warping',
            parameters: { /* JSON Schema */ },
            handler: (args) => this.comparator.compare(JSON.parse(args))
        }
    ];
}
```

**Jak to działa w praktyce:**
1. Użytkownik: "Dlaczego na magistrali CAN pojawiły się błędy między 12.3s a 12.5s?"
2. Agent woła `get_time_range(12.3, 12.5)` → dostaje adnotacje
3. Agent widzi: 3 ramki z CRC_ERROR, wszystkie od ID 0x7DF
4. Agent woła `search_annotations({payloadFilter: {canId: 0x7DF}})` → dostaje wszystkie ramki od tego ID
5. Agent odpowiada: "W oknie 12.3-12.5s wykryto 3 błędy CRC od węzła 0x7DF. Wcześniej (11.8-12.3s) ten sam węzeł wysłał 47 poprawnych ramek. Prawdopodobna przyczyna: fizyczny problem z transceiverem lub zakłócenia na magistrali."

Bez osobnego serwisu Python. Bez gRPC. Bez mikroserwisów. Czysty Theia Agent.

---

## 6. Dlaczego NIE libsigrokdecode (na starcie)

Wszystkie koncepcje mówią "most do libsigrokdecode = 150+ dekoderów za darmo". To prawda, ALE:

- libsigrokdecode to Python. Wymaga osobnego procesu Pythona + IPC.
- Każdy dekoder trzeba opakować w adapter.
- Debugowanie przez IPC to koszmar.
- Theia i tak nie ma wbudowanego Pythona — użytkownik musi go sam zainstalować.

**Moja decyzja:** Najpierw 3-4 dekodery natywne w TypeScript/WASM (CAN, UART, I2C, SPI). Jak kontrakt się sprawdzi, DOPIERO wtedy most do libsigrokdecode jako plugin. Nie odwrotnie.

---

## 7. Minimalna implementacja — co MUSI być w Fazie 0

Nie 6 warstw. Nie 7 faz. TYLKO to:

### Faza 0 (2 tygodnie) — CAN Bus Analyzer działa end-to-end

1. **Backend `can-socket-service.ts`** — łączy się z SocketCAN/serialport, emituje `SampleBlock` przez JSON-RPC
2. **Backend `can-rpc-service.ts`** — JSON-RPC server (wzorzec z `packages/output`)
3. **Frontend `can-widget.ts`** — ale NIE przerysowuje DOM per ramka. Zamiast tego:
   - Ramki lecą do `RingBuffer` (ArrayBuffer, nie `CanFrame[]`)
   - `requestAnimationFrame` throttluje UI do 20 FPS
   - Tabela renderuje ostatnie 50 ramek z bufora (nie wszystkie)
4. **Binarny transport** — `SampleBlock.data` jako `ArrayBuffer` przez WebSocket (nie JSON per ramka!)

### Faza 1 (2 tygodnie) — Wydzielenie `@theia/signal-core`

1. Przeniesienie kontraktów (`SampleBlock`, `ProtocolAnnotation`, `DecoderProvider`) do `@theia/signal-core`
2. `SampleStore` z `RingBuffer` i `IntervalTree`
3. Can-bus rejestruje się jako pierwszy `DecoderProvider`

### Faza 2 (2 tygodnie) — Drugi protokół

1. Dekoder UART (najprostszy protokół)
2. Weryfikacja kontraktu — czy DAG działa?
3. Jeśli TAK → kontrakt zamrożony. Jeśli NIE → poprawiamy kontrakt (tylko 2 dekodery do poprawy, nie 150)

---

## 8. Stack technologiczny — minimalistyczny

| Co | Czym | Dlaczego |
|----|------|----------|
| Backend | Node.js + TypeScript | Już jest w Theia |
| Transport | JSON-RPC (komendy) + WebSocket binary (dane) | Infrastruktura Theia |
| Frontend | Theia BaseWidget + Inversify DI | Standard Theia |
| Renderowanie | WebGL + Canvas2D fallback | Działa wszędzie |
| Dekodery | TypeScript (WebWorker) | Zero zależności |
| AI | `@theia/ai-core` Agent | Już jest |
| Dane | `ArrayBuffer` + `SharedArrayBuffer` | Transferable, zero-copy gdzie możliwe |

**Czego NIE używamy:**
- ❌ Rust/C++ (chyba że jako N-API addon dla hot-path ingestion — Faza 5+)
- ❌ gRPC (JSON-RPC Theia wystarczy)
- ❌ Python mikroserwis (AI to Theia Agent)
- ❌ libsigrokdecode (najpierw własne dekodery, potem most)

---

## 9. Podsumowanie — DLACZEGO ta koncepcja jest lepsza

| Kryterium | Inne koncepcje | DeepSeek V4 Pro |
|-----------|---------------|-----------------|
| **Zaczyna od działającego kodu?** | ❌ (większość) | ✅ (can-bus MVP) |
| **Ile nowych technologii?** | Rust, gRPC, Python, WASM, SAB... | 0 — tylko TS + Theia |
| **Kontrakt dekodera zamrożony?** | ✅ (ale za późno) | ✅ (od dnia 1, z apiVersion) |
| **Model błędów?** | ❌ (większość) | ✅ (GAP/RESYNC first-class) |
| **AI integracja?** | Osobny mikroserwis | Theia Agent (już działa) |
| **Ile warstw?** | 6-7 | 4 |
| **Minimalna faza 0?** | "Core Data Engine" | CAN end-to-end |
| **Ryzyko niedowiezienia?** | Wysokie (za dużo naraz) | Niskie (małe kroki) |

**Zasada której nie złamałem ani razu:** Każda faza to działający produkt. Nie ma fazy "zaprojektujmy wszystko". Jest faza "zróbmy CAN end-to-end", potem "dodajmy UART i sprawdźmy kontrakt", potem "dodajmy AI".

To nie jest najbardziej ambitna architektura. To jest **jedyna która ma szansę powstać.**
