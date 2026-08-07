# Theia Signal Analyzer — ROADMAP (dokument nadrzędny)

**Wersja:** 1.0
**Data:** 2026-08-04
**Status:** JEDYNY wiążący dokument projektu. Zastępuje i unieważnia wszystkie wcześniejsze dokumenty koncepcyjne (usunięte).

---

## 0. Zasady pracy agentów AI (obowiązkowe, nadrzędne względem wszystkiego)

Projekt jest wielomiesięczny i rozwijany przy udziale agentów AI. Poniższe reguły są **bezwzględne**.

### 0.1. Changelog — append-only

- **Jeden plik:** `SIGNAL-ANALYZER-CHANGELOG.md` w root repo. (Root `CHANGELOG.md` należy do upstream Theia — **zakaz dotykania**.)
- Agent **nigdy nie modyfikuje ani nie usuwa** istniejących wpisów. Dozwolone jest wyłącznie **dopisanie nowego wpisu na końcu pliku**.
- Każde zakończone zadanie (lub sesja pracy) = jeden wpis w formacie:

```
### YYYY-MM-DD | <agent/model> | <ID zadań, np. SA-102> | STATUS: DONE|FAILED|BLOCKED
- Zakres: <co zrobiono, 1-3 zdania>
- Dodane: <nowe pliki, ścieżki względne repo, lub „—”>
- Zmodyfikowane: <zmienione istniejące pliki, lub „—”>
- Usunięte: <usunięte pliki, lub „—”>
- Weryfikacja: <dokładna komenda: npx lerna run compile --scope ... / npm run test — i wynik>
- Uwagi: <blokery, decyzje, odstępstwa; opcjonalne>
```

- Wpis dopisujemy **po** zweryfikowaniu zmiany (kompilacja/test). Nieudana praca też jest logowana (`STATUS: FAILED`/`BLOCKED` + opis blokera) — to jedyny dozwolony sposób zgłoszenia problemu supervisorowi.
- Pełny, konkretny podział zadań na karty robocze dla agentów-wykonawców oraz protokół rewizji supervisora: patrz `SIGNAL-ANALYZER-TASKS.md`.

### 0.2. Dokumentacja na bieżąco

- Katalog: `doc/signal-analyzer/`. Każda funkcjonalność ma swój plik: **opis + jak używać**.
- Dokumentację **wolno modyfikować** — ale wyłącznie w zakresie bieżącej zmiany (np. zmiana kontraktu dekodera → aktualizacja `doc/signal-analyzer/decoders.md` w tym samym zadaniu).
- Zmiana kodu bez aktualizacji dokumentacji = zadanie niedokończone.
- Indeks w `doc/signal-analyzer/README.md` aktualizowany przy dodaniu nowego pliku.

### 0.2.1. Roboczy rejestr integracji zadań

- Katalog `doc/signal-analyzer/work/` służy do koordynacji pracy wielu agentów; zasady i szablon są w `doc/signal-analyzer/work/README.md` oraz `TEMPLATE.md`.
- Przed rozpoczęciem implementacji wykonawca tworzy rekord `SA-xxx.md`, opisujący granice zadania, zależności, producentów i konsumentów danych, punkty montażu oraz plan przekazania pracy.
- Rekord roboczy nie może zmieniać roadmapu, zamrożonych kontraktów ani `apiVersion`. Konflikt zakresu lub potrzeba zmiany kontraktu oznacza `BLOCKED` i wymaga decyzji supervisora.
- Po akceptacji rekord pozostaje jako ślad integracji. Nie zastępuje on dokumentacji funkcjonalnej, która nadal opisuje działające zachowanie i sposób użycia.

### 0.2.2. Zachowanie historii planu

- `SIGNAL-ANALYZER-ROADMAP.md` i `SIGNAL-ANALYZER-TASKS.md` są dokumentami rozwijanymi podczas implementacji. Wolno je doprecyzować, rozszerzać i poprawiać na podstawie zweryfikowanych faktów z kodu.
- Nie wolno usuwać kart `SA-xxx`, zaakceptowanych decyzji, sekcji roadmapu ani historycznych ustaleń. Gdy decyzja zostaje zastąpiona, zachowaj jej treść i dodaj oznaczenie `ZASTAPIONE` z datą, powodem, decyzją właściciela/supervisora oraz wskazaniem następcy.
- Korekta zakresu karty wymaga uzasadnienia w jej rekordzie `doc/signal-analyzer/work/SA-xxx.md` i wpisu append-only w `SIGNAL-ANALYZER-CHANGELOG.md` po pomyślnej weryfikacji.
- Szczegółowy stan wykonania, zalecenia oraz najbliższe kroki utrzymuj w `doc/signal-analyzer/execution.md`. Dokument ten nie zastępuje roadmapu, kart ani changelogu.

### 0.2.3. Raport superwizora (obowiązkowy przy każdej bramce)

- `doc/signal-analyzer/supervisor-report.md` jest **jedynym plikiem sterującym jakością kodu** w projekcie.
- Każdy wykonawca **musi** przeczytać ten raport przed rozpoczęciem pracy — zawiera aktualną listę usterek, dług techniczny i rekomendacje architektoniczne, których nie ma w kartach zadań.
- Raport jest rozwijany (nigdy nie zastępowany w całości) przy każdej bramce rewizji superwizora (§0.6). Nowe ustalenia dopisuje się na górze, stare pozostają jako historia.
- Usterki z raportu mają priorytet wyższy niż nowe zadania — muszą być naprawione przed zamknięciem fazy, w której zostały wykryte.

### 0.3. Git i wersje stabilne

- Agent **nie commituje i nie pushuje** bez wyraźnego polecenia właściciela.
- Agent kończy pracę w stanie „gotowy do commita": skompilowane, przetestowane, changelog dopisany, dokumentacja zaktualizowana.
- O tym, **który etap jest wersją stabilną i kiedy trafia do gita, decyduje wyłącznie właściciel**.
- Propozycje komunikatów commitów: Conventional Commits zgodnie z historią repo (`feat(signal-core): …`).

### 0.5. Równoległa praca agentów

Wiele zadań może być realizowanych jednocześnie przez różnych agentów (osobne sesje/IDE/modele), pod warunkami opisanymi w `doc/signal-analyzer/work/README.md` (sekcja „Równoległa praca wielu agentów") oraz `doc/signal-analyzer/execution.md` (sekcja „Mapa równoległości zadań").

**Zasada nadrzędna:** dwa zadania są równoległe tylko wtedy, gdy ich `Pliki dozwolone` są całkowicie rozłączne ORAZ oba mają spełnione zależności DAG (poprzedniki z `AKCEPTACJA`).

**Pliki globalne** (`SIGNAL-ANALYZER-ROADMAP.md`, `SIGNAL-ANALYZER-TASKS.md`, `SIGNAL-ANALYZER-CHANGELOG.md`, `doc/signal-analyzer/supervisor-report.md`, `doc/signal-analyzer/work/README.md`, `doc/signal-analyzer/execution.md`, `doc/signal-analyzer/README.md`) **nigdy nie są modyfikowane równolegle**. Agent aktualizuje je jako ostatni krok przed zgłoszeniem `GOTOWE DO REWIZJI`.

**Konflikt** (próba rezerwacji zadania, którego pliki już widnieją w tabeli `Pliki współdzielone (aktywne)`) = `BLOCKED`. Agent nie tworzy rekordu, tylko zgłasza supervisorowi: które pliki, przez kogo, od kiedy.

Szczegółowy protokół rezerwacji, tabela plików współdzielonych i mapa równoległości: `doc/signal-analyzer/work/README.md`.

### 0.6. Rytm pracy superwizora

Supervisor **nie** jest wołany po każdym `SA-xxx` — to marnotrawstwo czasu. Rewizje odbywają się wyłącznie na **bramkach**:

| Bramka | Wyzwalacz |
| --- | --- |
| Koniec Fazy 0 | SA-008 zakończone |
| SA-102 | Kontrakty `signal-core` zdefiniowane |
| SA-105 | Migracja can-bus na signal-core |
| SA-205 | Bramka zamrożenia kontraktu (test na 2 protokołach) |
| Koniec Fazy 1 | SA-106 zakończone |
| Koniec Fazy 2 | SA-206 zakończone |
| Koniec Fazy 3 | SA-305 zakończone |
| Koniec Fazy 4 | SA-406 zakończone |
| Koniec Fazy 5 | SA-505 zakończone |
| Koniec Fazy 6 | SA-604 zakończone |

**Dodatkowa rewizja granicy:** przed `AKCEPTACJA` każdego zadania zmieniającego kontrakt, DI, RPC, format binarny lub punkt montażu aplikacji oraz po maksymalnie trzech równoległych zadaniach. W ten sposób kontrola odbywa się zwykle co 1–3 karty na granicach systemu, a pełna rewizja nadal zostaje na końcu fazy.

**Zasada:** przy każdej bramce supervisor aktualizuje `doc/signal-analyzer/supervisor-report.md` i sprawdza checklistę z §3 tego dokumentu. Wykonawca przed rozpoczęciem pracy czyta raport superwizora — zawiera on usterki i dług techniczny, których nie ma w kartach zadań.

### 0.4. Zasady migracyjności wobec upstream Theia

Repo jest forkiem Eclipse Theia — każda zmiana musi pozwalać na bezbolesny merge/upgrade cora.

**Dozwolone:**
- Nowa funkcjonalność **wyłącznie jako własne pakiety** w `packages/` (`@theia/signal-*`, `@theia/can-bus`) — zero ingerencji w kod upstream.
- Rozszerzanie upstream przez: Inversify `rebind`, contribution points, `ContributionProvider`, własne widgety/komendy/preferencje.
- Zależności tylko na **publiczne API** pakietów `@theia/*`.

**Zabronione:**
- Edycja plików pakietów upstream (`packages/core`, `packages/editor`, …). Blokadę rozwiązujemy przez `rebind` w naszym pakiecie.
- Importy omijające publiczne eksporty upstream (patrz `doc/code-organization.md`, `doc/vscode-usage.md`).
- Zmiany w `dev-packages/`, `configs/`, skryptach build, `package.json` pakietów upstream.

**Wyjątki (akceptowalne konflikty przy merge):**
- `examples/browser/package.json` / `examples/electron/package.json` — dodanie naszych pakietów (punkt montażu).
- `.gitignore`, `.theia/settings.json` — konfiguracja lokalna forka.

**Operacyjnie:**
- Merge upstream ma dawać konflikty **tylko** w plikach z listy wyjątków.
- Każdy nowy pakiet: standardowe skrypty `theiaext`, `tsconfig.json` rozszerzający `configs/base.tsconfig.json`, struktura `src/common|browser|node` — dokładnie jak pakiety upstream.
- Publiczne API naszych pakietów w `src/common/` z `apiVersion` (zgodnie z `doc/api-management.md`).
- Styl kodu wg `CLAUDE.md` i `doc/coding-guidelines.md` (4 spacje, single quotes, `undefined`, property injection, kebab-case, `nls.localize`).

---

## 1. Synteza koncepcji — co wnosi każde źródło

| Źródło (usunięte) | Wkład przyjęty do roadmap | Odrzucone |
| --- | --- | --- |
| `CAN-BUS-ANALYZER-SUMMARY.md` | Wymagania FR-01…FR-07 / NFR-01…05, backlog B-01…B-08, stan MVP (~35%) | Tabela DOM przerysowywana per ramka — nie skaluje się |
| `THEIA_SIGNAL_ANALYZER_ARCHITECTURE.md` | Hybrid core+extensions, workflow capture→raw→select→decode→compare→persist, model danych core | Brak kontraktu dekodera i modelu wydajności |
| `New_concept.md` | Stacked decoders (DAG), ChannelGroup, decode-on-demand, Virtual Math Channels, DTW, libsigrokdecode bridge, Multi-Domain Clocking | Luźna forma zbiorcza |
| `THEIA_SIGNAL_ANALYZER_CONSOLIDATED_MODEL.md` | 6 warstw, tabela decyzji architektonicznych, stabilny kontrakt | Brak modelu błędów |
| `THEIA_SIGNAL_ANALYZER_OWN_CONCEPT.md` | PagedSampleStore (mmap+LRU), GAP/RESYNC first-class, sandboxing, Undo/Redo, AnnotationIndex, apiVersion, Export/Import, DecoderTestHarness | Rust/gRPC/Python mikroserwisy — przerost formy |
| `THEIA_NEXTGEN_SIGNAL_ANALYZER_ARCHITECTURE.md` | Integracja z Theia DI, plan migracji can-bus, Min-Max LOD | SAB backend↔renderer — technicznie niemożliwe |
| `THEIA_SIGNAL_ANALYZER_DEEPSEEK_V4_CONCEPT.md` | „Ewolucja, nie architektura", kontrakty zamrożone od dnia 1, AsyncIterable+backpressure, AI jako Theia Agent z tool-use, minimalny stack | — (wkład wchodzi niemal w całości) |
| `THEIA_SIGNAL_ANALYZER_KIM3_FINAL_ARCHITECTURE.md` | Synteza finalna: Theia-native, poprawiony model pamięci (SAB tylko renderer↔worker), zasady migracyjności §0.4 | 7 warstw jako struktura implementacyjna |

**Trzy korekty obowiązujące cały projekt:**
1. **Theia-Native** — wszystko jako rozszerzenia Theia (TS, Inversify, JSON-RPC). N-API addon opcjonalnie, tylko hot-path.
2. **Model pamięci** — backend→frontend: binarny chunked stream z backpressure; `SharedArrayBuffer` wyłącznie renderer↔WebWorker.
3. **AI = Theia Agent** — rejestracja w `@theia/ai-core` z tool-use; żadnego osobnego serwisu AI.

**Zasada wykonawcza (z DeepSeek):** każda faza to **działający produkt**, nie dokument. Kontrakty projektujemy z góry, implementację iterujemy.

---

## 2. Architektura docelowa (4 warstwy logiczne)

```
┌──────────────────────────────────────────────────────────────────┐
│ L4 │ KONSUMENCI: Waveform(WebGL) │ Hex/Bit View │ Protocol Table │
│    │  XY Plot │ AI Agent │ Comparator │ Export │ Statistics      │
├──────────────────────────────────────────────────────────────────┤
│ L3 │ SILNIK DEKODOWANIA + SEMANTYKA: DecoderRegistry (DAG) │     │
│    │  decode-on-demand │ AnnotationIndex │ .dbc/.svd │ Math Ch.  │
├──────────────────────────────────────────────────────────────────┤
│ L2 │ MAGAZYN DANYCH: SampleStore (Ring + Paged) │ IntervalTree │ │
│    │  GlobalTimeline │ Undo/Redo (SessionCommand)               │
├──────────────────────────────────────────────────────────────────┤
│ L1 │ INGESTION + TRANSPORT: HAL (SocketCAN│serialport│pliki│sym) │
│    │  JSON-RPC (komendy) + binarny chunked stream (dane)        │
└──────────────────────────────────────────────────────────────────┘
```

(Słownik `.dbc` to po prostu `DecoderProvider` z `inputType: "annotation:can"`; AI i wizualizacja to konsumenci — stąd 4 warstwy zamiast 7.)

**Docelowe pakiety (wszystkie nowe, własne):**
- `@theia/signal-core` — kontrakty (§3), model danych L2, rejestry. Bez UI, bez HAL.
- `@theia/can-bus` — istniejący; staje się poligonem wzorców (pierwszy HAL + pierwszy DecoderProvider).
- `@theia/signal-ui` — widgety L4 (Faza 3+).
- `@theia/signal-ai` — agent L4 (Faza 5+).

---

## 3. Kontrakty zamrożone (zmiana = bump apiVersion + migrator)

```ts
export interface SampleBlock {
    readonly blockId: number;
    readonly channelId: string;
    readonly sampleRate: number;
    readonly startTimeNs: bigint;
    readonly sampleCount: number;
    readonly dataType: 'BIT_PACKED' | 'UINT8' | 'UINT16' | 'FLOAT32';
    readonly data: ArrayBuffer;        // transferable, zero-copy friendly
}

export interface ProtocolAnnotation {
    readonly id: string;
    readonly parentId: string | null;  // hierarchia DAG
    readonly level: number;            // 0 = surowe, 1+ = kolejne warstwy
    readonly startTimeNs: bigint;
    readonly endTimeNs: bigint;
    readonly type: string;             // także "GAP" | "RESYNC" — first-class
    readonly summary: string;
    readonly payload: Record<string, unknown> | null;
}

export interface ChannelRole {
    readonly roleName: string;         // "CLK","SDA","TX","MOSI"…
    readonly required: boolean;
    assignedChannelId?: string;
}

export interface SampleWindow {
    readonly startTimeNs: bigint;
    readonly endTimeNs: bigint;
    readonly blocks: SampleBlock[];
}

export interface DecoderProvider {
    readonly id: string;
    readonly displayName: string;
    readonly apiVersion: string;       // semver
    readonly inputType: string;        // "raw-digital" | "raw-analog" | "annotation:<id>"
    readonly outputType: string;       // np. "annotation:can"
    readonly channelRoles: ChannelRole[];
    decode(
        input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
        options: Record<string, unknown>
    ): AsyncIterable<ProtocolAnnotation>;   // strumieniowo + backpressure
}

export interface AnnotationQuery {
    timeRange?: { startNs: bigint; endNs: bigint };
    type?: string;
    payloadFilter?: Record<string, unknown>;
    textSearch?: string;
    limit?: number;
}
```

Reguły: dekoder nigdy nie pisze do `SampleStore` (tylko emituje adnotacje); silnik buduje potok (topological sort, wykrywanie cykli); błąd dekodera nie zatrzymuje pipeline'u (timeout, circuit breaker, walidacja `endTime >= startTime`).

---

## 4. Roadmap wykonawczy

Priorytety: **P0** = krytyczne, **P1** = ważne, **P2/P3** = rozszerzenia. Każde zadanie ma ID `SA-xxx` do cytowania w changelogu.

### Faza 0 — CAN end-to-end na istniejącym MVP (P0)

Cel: live capture CAN działa w Theia browser app; UI nie zamula przy 5000 ramek/s.

| ID | Zadanie | DoD |
| --- | --- | --- |
| SA-001 | Backend: `can-backend-module.ts` (DI bindings) | kompiluje, moduł ładowany |
| SA-002 | Backend: `can-socket-service.ts` (SocketCAN Linux / serialport Windows) + symulator ramek do dev | ramki płyną z symulatora bez sprzętu |
| SA-003 | Backend: `can-rpc-service.ts` (JSON-RPC + zdarzenia, wzorzec `packages/output`) | frontend odbiera zdarzenia |
| SA-004 | Frontend: `can-widget.ts` — RingBuffer (ArrayBuffer) zamiast `CanFrame[]`, `requestAnimationFrame` throttle 20 FPS, tabela renderuje ostatnie 50 | 5000 ramek/s bez zamrożenia UI |
| SA-005 | Binarny transport danych (ArrayBuffer chunked), nie JSON per ramka | ≥20 000 ramek/s bez utraty |
| SA-006 | CSS widgetu + wykres FPS (canvas, bez ECharts na razie) | FR-03, FR-04 spełnione |
| SA-007 | Rejestracja `@theia/can-bus` w `examples/browser/package.json` + test integracyjny | `npm run start:browser` pokazuje widget |
| SA-008 | Docs: `doc/signal-analyzer/can-bus.md` (opis + jak używać) | — |

### Faza 1 — `@theia/signal-core`: kontrakty i magazyn danych (P0)

| ID | Zadanie | DoD |
| --- | --- | --- |
| SA-101 | Nowy pakiet `@theia/signal-core` (struktura jak pakiety upstream, `theiaext`) | `npx lerna run compile --scope @theia/signal-core` OK |
| SA-102 | Kontrakty §3 w `src/common/` z `apiVersion` | eksport publiczny, test jednostkowy typów |
| SA-103 | `RingSampleStore` + `ChunkedIntervalTree` (lookup $O(\log N + K)$) | testy: 1M próbek, zakresowe query |
| SA-104 | `CaptureSession`, `SignalChannel`, `ChannelGroup`, `GlobalTimeline` | testy jednostkowe |
| SA-105 | can-bus migruje na kontrakty signal-core (emituje `SampleBlock`) | Faza 0 nadal działa |
| SA-106 | Docs: `doc/signal-analyzer/signal-core.md` | — |

### Faza 2 — Decode DAG Engine + drugi protokół (P0)

| ID | Zadanie | DoD |
| --- | --- | --- |
| SA-201 | `DecoderRegistry` + topological sort + wykrywanie cykli | testy DAG |
| SA-202 | Decode-on-demand w WebWorkerze (viewport + 20% marginesu), SAB renderer↔worker | 1M adnotacji viewport < 300 ms |
| SA-203 | GAP/RESYNC first-class + walidacja adnotacji + circuit breaker | awaria dekodera A nie wpływa na B (test) |
| SA-204 | CAN jako `DecoderProvider` (`raw-can` → `annotation:can`) | migracja bez regresji Fazy 0 |
| SA-205 | Dekoder UART (najprostszy) — **test kontraktu na 2. protokole** | jeśli kontrakt działa → ZAMRAZAMY; jeśli nie → poprawka (tylko 2 dekodery) |
| SA-206 | Docs: `doc/signal-analyzer/decoders.md` | — |
| SA-207 | Lekki harness regresyjny golden-trace dla CAN i UART (bez CI hooka) — chroni logikę dekoderów do czasu pełnego `DecoderTestHarness` w Fazie 5 | świadoma regresja w dekoderze daje czerwony test z diffem pól |

### Faza 3 — Wizualizacja (P1)

| ID | Zadanie |
| --- | --- |
| SA-301 | Pakiet `@theia/signal-ui`, `ViewportController` (sync zoom/pan/kursor między panelami) |
| SA-302 | WebGL waveform + Min-Max LOD (bez gubienia pików) + fallback Canvas2D |
| SA-303 | Hex/ASCII/Bit view + annotation overlay |
| SA-304 | Tabela protokołów (wirtualizowana) |
| SA-305 | Filtry ramek (ID/typ/interfejs), kolorowanie wierszy (FR z Fazy 2 can-bus) |

### Faza 4 — Semantyka i operacje (P1)

| ID | Zadanie |
| --- | --- |
| SA-401 | Słowniki `.dbc` jako DecoderProvider (`annotation:can` → `annotation:can-decoded`) |
| SA-402 | `AnnotationIndex` (inverted index w core) + wyszukiwarka (AnnotationQuery) |
| SA-403 | Undo/Redo (`SessionCommand` + immutable state) |
| SA-404 | Export/Import CSV/JSON/VCD |
| SA-405 | `VirtualChannel` (math: $CH_1-CH_2$, duty cycle, jitter) |
| SA-406 | Transmit CAN, logowanie do pliku + replay (`CaptureMode: REPLAY`) |

### Faza 5 — Inteligencja i porównania (P2)

| ID | Zadanie |
| --- | --- |
| SA-501 | Pakiet `@theia/signal-ai`: Theia Agent z toolami `search_annotations`, `get_time_range`, `get_statistics`, `compare_sessions` |
| SA-502 | `SemanticAggregator` (kompresja sesji → limit tokenów LLM) + `AnomalyDetector` (reguły/statystyka) |
| SA-503 | Comparator z DTW (porównywanie po wzorcach, nie po $t$) |
| SA-504 | Most libsigrokdecode (Python sidecar, opcjonalny) — **dopiero po zamrożeniu kontraktu** |
| SA-505 | `DecoderTestHarness` (golden traces) |

### Faza 6 — Ekosystem (P3)

| ID | Zadanie |
| --- | --- |
| SA-601 | Public Plugin API + SDK, plugin dependency resolver (semver) |
| SA-602 | Trigger engine, symulator protokołów |
| SA-603 | Współpraca (CRDT), Multi-Domain Clocking UI |
| SA-604 | Opcjonalny N-API addon dla ingestion hot-path |

---

## 5. Benchmarki jako Definition of Done

- ≥ 100 000 próbek/s (analog) i ≥ 20 000 ramek/s (CAN) bez utraty danych; UI ≤ 20 FPS throttled, bez zamrożenia.
- Sesja 1 GB otwiera się i nawiguje < 2 s (PagedStore + LOD).
- Dekodowanie viewportu 1 M adnotacji < 300 ms w workerze.
- Awaria dowolnego dekodera nie wpływa na pozostałe (circuit breaker).

---

## 6. Stack technologiczny

| Warstwa | Technologia |
| --- | --- |
| Backend | Node.js ≥22, TypeScript ~5.9.3, Theia backend module |
| Transport | Theia JSON-RPC + binarny chunked stream z backpressure |
| Frontend | Theia BaseWidget, Inversify DI, React 18 gdzie sensowne |
| Renderowanie | WebGL + Min-Max LOD; fallback Canvas2D |
| Dekodery | TypeScript WebWorker (WASM opcjonalnie); Python sidecar dopiero w Fazie 5 |
| AI | `@theia/ai-core` agent + tool-use |
| Dane | ArrayBuffer; SAB tylko renderer↔worker; Ring (RAM) + Paged (mmap) |

**Zakazane bez decyzji właściciela:** Rust/C++ (poza opcjonalnym N-API w Fazie 6), gRPC, mikroserwis Python, ECharts/inne ciężkie liby UI (decyzja per przypadek).
