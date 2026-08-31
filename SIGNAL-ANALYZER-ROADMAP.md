# Theia Signal Analyzer — ROADMAP (dokument nadrzędny)

**Wersja:** 1.5
**Data bazowa:** 2026-08-04
**Aktualizacja 1.1:** 2026-08-24 — dodano Logic Analyzer, backend C++, urządzenia rynkowe i własny hardware.
**Aktualizacja 1.2:** 2026-08-24 — Logic Analyzer przeniesiono do perspektywy; aktywny etap to Industrial Protocol Analyzer.
**Aktualizacja 1.3:** 2026-08-24 — główny protokół Siemens doprecyzowano jako PROFINET; S7comm przesunięto do backlogu.
**Aktualizacja 1.4:** 2026-08-28 — dodano CAN Device Lab: bezpieczny nadajnik, kampanie wybudzania, feedback i adaptacyjne zawężanie, odkrywanie funkcji, import protokołów, kompozytor odpowiedzi, generatory oraz skrypty Python. To najbliższy etap implementacyjny; Industrial Protocol Analyzer pozostaje zachowanym planem, ale jest wstrzymany operacyjnie do kolejnej decyzji właściciela.
**Aktualizacja 1.5:** 2026-08-28 — po przeglądzie sugestii subagentów dodano wczesny symulator śpiącego DUT, automatyczny feedback RX-delta, rozszerzalne sensory/SCPI, próby kontrolne i tasowany replay, strojenie keep-alive, import KCD/ARXML/CSV/JSONL oraz reprodukowalny pakiet eksperymentu z seedem i raportem.
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
| SA-410 | Kontrakt aktywnej sesji CAN i granice bezpieczeństwa zdefiniowane |
| SA-414 | Wybudzanie, feedback i adaptacyjne zawężanie działają E2E |
| Koniec Fazy 4A | SA-421 zakończone — bramka CAN Device Lab |
| Koniec Fazy 5 | SA-505 zakończone |
| Koniec Fazy 6 | SA-604 zakończone |
| SA-611 | Kontrakty capture/packet/flow/transaction zdefiniowane |
| Koniec Fazy 6A | SA-619 zakończone — bramka Industrial Protocol Analyzer |
| SA-702 | Kontrakty urządzeń i wysokowydajnego raw chunk zdefiniowane |
| Koniec Fazy 7 | SA-708 zakończone |
| SA-801 | Granica procesu i Bridge API zdefiniowane |
| SA-806 | Decyzja integracyjna dla fizycznego ALIENTEK DL32 |
| Koniec Fazy 8 | SA-808 zakończone |
| SA-901 | SADP v1 i conformance kit zamrożone |
| SA-906 | EVT własnego hardware gotowe do kwalifikacji |
| Koniec Fazy 9 | SA-909 zakończone |

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

### Faza 4A — CAN Device Lab: nadajnik i inżynieria urządzeń (AKTYWNA — NAJBLIŻSZA DO REALIZACJI, P0/P1)

Decyzją właściciela z 2026-08-28 najbliższym etapem jest praca warsztatowa z urządzeniem na izolowanym stole: najpierw bezpieczne wybudzenie, następnie identyfikacja ramek i sekwencji, odkrywanie funkcji oraz budowanie ruchu zwrotnego. Nie wykonujemy brute force całej przestrzeni danych. Każdy eksperyment jest powtarzalną kampanią z pełnym dziennikiem TX/RX, czasu i feedbacku. Szczegóły: `doc/signal-analyzer/can-device-lab.md`.

| ID | Zadanie |
| --- | --- |
| SA-409 | Deterministyczny symulator śpiącego DUT na wirtualnym CAN, rozwijany równolegle z kontraktami |
| SA-410 | Kontrakty `CanExperimentSession`, bezpieczeństwo stołowe, uzbrajanie, limity i awaryjny `STOP` |
| SA-406 | Niskopoziomowe TX CAN/CAN FD, logowanie i replay z zachowaniem czasu; istniejąca karta jest fundamentem tej fazy |
| SA-411 | Silnik kampanii i bank wzorców wybudzających dla list/range'ów CAN ID |
| SA-412 | Feedback/oracle: zdarzenia użytkownika i automatyczne różnice RX z dokładnym timestampem |
| SA-422 | Rozszerzalne sensory feedbacku: zasilacz SCPI/serial, GPIO oraz przyszłe audio/vision |
| SA-413 | Ranking okna przyczynowego, lista kandydatów i historia dowodów |
| SA-414 | Adaptacyjne replay/identify/dual/omission oraz minimalizacja ramki lub sekwencji |
| SA-415 | Odkrywanie opcji binarnych: baseline, walking-one/walking-zero i mutacja jednego bitu |
| SA-416 | Odkrywanie pól liczbowych i tekstowych: sweep/ramp, endianowość, znaki, ISO-TP |
| SA-417 | Import DBC oraz deklaratywnych pakietów scenariuszy/protokołów (raw CAN, ISO-TP/UDS) |
| SA-423 | Adaptery KCD/ARXML oraz import sekwencji CSV/JSONL/candump |
| SA-418 | Kompozytor ramek zwrotnych ze stałych, zmiennych użytkownika i wartości przechwyconych |
| SA-419 | Generatory zakresów, harmonogramy, triggery, sekwencje i maszyna stanów urządzenia |
| SA-420 | Izolowany runtime Python z ograniczonym API do TX/RX, zmiennych, feedbacku i adnotacji UI |
| SA-424 | Reprodukowalny pakiet eksperymentu: config, seed, journal, artefakty i raport |
| SA-421 | Bramka E2E: vcan/symulator, fizyczny stół, timing, fault injection, dokumentacja i bezpieczeństwo |

#### 4A.1. Przepływ wybudzania i zawężania

1. **Preflight tylko do odczytu:** wybór fizycznego interfejsu, bitrate, CAN 2.0/CAN FD, 11/29 bit, terminacja i limit obciążenia. Program najpierw nasłuchuje, buduje baseline istniejących ID/częstotliwości/payloadów oraz błędów magistrali; aktywne ID są domyślnie wykluczone ze sweepu, a TX wymaga jawnego uzbrojenia sesji.
2. **Kontrolowany sweep ID:** źródłem kandydatów jest allowlista, jawny zakres, ID zaobserwowane w capture albo importowany profil. Zakres `0x000…0x7FF` jest dozwolony wyłącznie na izolowanym stole po dodatkowym potwierdzeniu; nie skanujemy domyślnie 29-bitowej przestrzeni.
3. **Mały bank ramek wybudzających:** dla każdego ID domyślnie wysyłamy 3–6 deterministycznych payloadów o jawnie wybranym DLC: `00…`, `FF…`, `AA…`, `55…`, `7F…` i opcjonalnie `80…` albo rampę bajtów `00 01 02…`. Walking-one/walking-zero należy do późniejszego odkrywania funkcji, a nie do domyślnego wybudzania. Arbitralne magiczne wartości nie trafiają do presetu ogólnego.
4. **Feedback automatyczny i ręczny:** wbudowany provider RX-delta porównuje baseline z ruchem po próbie: nowe ID, zmianę częstotliwości i zmianę payloadu. Użytkownik rejestruje `POSITIVE`, `NEGATIVE` albo `UNCERTAIN` dla efektów fizycznych. Provider zasilacza laboratoryjnego, GPIO, audio lub vision korzysta z tego samego kontraktu i nie otrzymuje prawa do TX.
5. **Ranking kandydatów:** kandydatami są ramki i krótkie sekwencje z okna przyczynowego. Okno może zostać skalibrowane do czasu reakcji operatora zamiast używać stałej. Wynik uwzględnia opóźnienie, pozytywne powtórzenia, próby negatywne i kontrolne bez TX, typ feedbacku oraz stabilność między power-cycle. UI pokazuje zwykle top 10–20, ale zachowuje pełny dziennik.
6. **Adaptacyjne potwierdzenie:** podejrzane okno jest odtwarzane wolniej; następnie dzielone na grupy A/B aż do wskazania minimalnego zbioru. Dla hipotezy pojedynczej ramki dostępny jest seeded shuffle kolejności i próby `slow-single`, aby ograniczyć fałszywą korelację z sąsiednim ID; tryb sekwencji zachowuje oryginalny porządek. Jeżeli urządzenie wymaga ruchu podtrzymującego, pełny znany baseline jest odtwarzany, a grupy ramek są kolejno pomijane (`omission`). Dla efektów ON/OFF utrzymujemy osobne stosy kandydatów (`dual`). Po znalezieniu keep-alive program bisekcją okresu szuka najrzadszego stabilnego podtrzymania.
7. **Sekwencje:** wynik może być pojedynczą ramką albo uporządkowaną sekwencją z timingiem. Redukcja usuwa zbędne elementy metodą delta-debugging, ale nigdy nie zmienia jednocześnie kolejności i danych; każdy kandydat musi zostać potwierdzony co najmniej w konfigurowalnej liczbie prób.

#### 4A.2. Odkrywanie funkcji po wybudzeniu

- **Bity i kontrolki:** zaczynamy od ramki bazowej, zmieniamy jeden bit na próbę i wracamy do baseline. Dostępne są walking-one, walking-zero, maska bitów stałych oraz kontrolowane kombinacje dopiero po wynikach testów pojedynczych bitów. To jest domyślne podejście; czysty random jest opcjonalny i wyraźnie oznaczony jako ryzykowny.
- **Wartości liczbowe:** testujemy ograniczone, monotoniczne sweepy dla hipotez 8/16/32-bit, signed/unsigned, Intel/Motorola, scale/offset. Zakres, krok, tempo narastania i wartość bezpiecznego powrotu są obowiązkowe. Wyniki korelujemy z feedbackiem, np. ruchem wskazówki prędkości lub temperatury.
- **Tekst i ekrany:** tryb tekstowy buduje payload z ASCII/UTF-8, paddingiem i terminatorem, ale obsługuje też transport wieloramkowy ISO-TP. Nie zakładamy, że ekran przyjmie tekst w pojedynczej 8-bajtowej ramce; scenariusz może wymagać licznika, CRC, flow-control albo wcześniejszej sekwencji sesji.
- **Baseline i keep-alive:** ruch, który utrzymuje urządzenie aktywne, jest osobną warstwą kampanii i nie jest mutowany razem z badaną ramką. Program okresowo odtwarza znaną poprawną próbę kontrolną, aby odróżnić brak efektu od zaśnięcia lub błędu urządzenia.

#### 4A.3. Import, odpowiedzi i automatyzacja

- Format natywny to wersjonowany, deklaratywny pakiet scenariusza JSON/YAML: interfejs, tryb CAN, ID/DLC, ramki, sekwencje, timing, triggery, oczekiwane odpowiedzi, zmienne i limity bezpieczeństwa. Parser nie wykonuje kodu z pliku. Ślady CSV/JSONL/candump są importowane jako dane/replay, nie jako kod.
- DBC dostarcza definicje wiadomości i sygnałów do kodowania/dekodowania; KCD i kontrolowany podzbiór ARXML korzystają z rejestru adapterów. ISO-TP jest warstwą transportową, a UDS — osobnym profilem scenariusza; „import ISO” nie jest traktowany jako jeden nieokreślony format pliku. TesterPresent działa wyłącznie dla jawnego TX/RX ID i profilu diagnostycznego. AUTOSAR/OSEK NM wymaga znanej konfiguracji/DBC/ARXML — nie jest uniwersalnym magicznym payloadem. ODX/PDX i formaty producentów pozostają backlogiem.
- Kompozytor ramki przyjmuje stałe, zmienne użytkownika, ostatnią lub czasowo dopasowaną wartość z odebranej ramki, wyrażenia o ograniczonym AST oraz funkcje counter/CRC. Każde źródło ma typ, endianowość, zakres, ważność czasową i fallback.
- Generatory zmieniają pola w zakresie i tempie; obejmują ramp/triangle/sine/square/toggle/step-list i bounded random. Mogą działać okresowo, po RX, po feedbacku lub jako stan scenariusza. Pętle przyczynowe RX→TX mają limit głębokości/częstotliwości i wykrywanie samowzbudzenia.
- Python jest ostatnią, zaawansowaną warstwą. Skrypt działa w osobnym procesie z jawnym capability API, limitem czasu/CPU/kolejki i natychmiastowym `STOP`; kontrolowany hot-reload jest możliwy tylko po zatrzymaniu planowania i ponownej walidacji. Skrypt nie uzyskuje bezpośredniego dostępu do DI, socketu ani procesu frontendowego.
- Każdy eksperyment można zapisać jako wersjonowany pakiet `config + seed + journal + zaimportowane definicje + skrypty/hash + raport`. Ponowne uruchomienie na tym samym symulatorze ma dać identyczną kolejność decyzji i ramek; odstępstwa sprzętowe są jawnie raportowane.

#### 4A.4. Niezmienniki bezpieczeństwa

- Wyłącznie izolowany stół, odłączony od pojazdu/maszyny; elementy wykonawcze mechanicznie unieruchomione, zasilacz laboratoryjny z ograniczeniem prądu i fizycznie dostępne odcięcie zasilania.
- Domyślnie `DISARMED`; jawne potwierdzenie interfejsu, zakresu ID, maksymalnego FPS/bus-load i czasu kampanii przed każdym startem. Zmiana interfejsu lub profilu rozbraja sesję.
- `STOP` przerywa nowe planowanie i czyści kolejkę TX w budżecie określonym przez SA-410; bus-off, wzrost błędów, przekroczenie obciążenia albo utrata heartbeat automatycznie zatrzymują kampanię.
- Preflight pokazuje, czy na stole istnieje drugi aktywny kontroler zdolny do ACK. Opcjonalny „ACK helper” wymaga osobnego fizycznego interfejsu w normal mode. Po bus-off nie ma bezwarunkowego auto-restartu: recovery wymaga cooldownu, poprawnego stanu kontrolera i ponownego uzbrojenia albo jawnej polityki profilu.
- Każda próba zapisuje planowany i rzeczywisty czas, ID/flags/DLC/data, źródło wartości, status lokalnego wysłania/echo sterownika, RX i feedback. Lokalnego echo nie wolno przedstawiać jako potwierdzenia reakcji urządzenia.
- Remote/error frames, diagnostyczne usługi zapisu/resetu/programowania oraz security access są domyślnie zabronione i wymagają osobnego, jawnego profilu oraz decyzji właściciela.

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

### Faza 6A — Industrial Protocol Analyzer (PLAN GOTOWY — WSTRZYMANE OPERACYJNIE, P0/P1)

> **ZASTĄPIONE OPERACYJNIE 2026-08-28 decyzją właściciela:** był to kierunek aktywny od 2026-08-24. Plan i karty pozostają ważne, ale następna implementacja dotyczy Fazy 4A CAN Device Lab. SA-611…SA-619 nie rozpoczynają się bez ponownego polecenia właściciela.

Narzędzie pozostaje zaplanowanym pasywnym analizatorem komunikacji przemysłowej w stylu Wireshark. Szczegóły: `doc/signal-analyzer/industrial-protocol-analyzer.md`.

| ID | Zadanie |
| --- | --- |
| SA-610 | Dokument produktu, granice bezpieczeństwa i plan protokołów |
| SA-611 | Kontrakty `CaptureRecord`, `PacketBatch`, flow i transaction |
| SA-612 | Paged capture store, PCAP/PCAPNG, simulator i golden traces |
| SA-613 | Widget: frame table, protocol tree, hex, filtry i wiele sesji |
| SA-614 | Modbus RTU: framing, CRC16, funkcje i request/response |
| SA-615 | Live capture: dumpcap/Npcap/libpcap i serial/RS-485 |
| SA-616 | EtherCAT: datagramy, WKC, cykle, jitter i podstawowe DC |
| SA-617 | PROFINET: DCP, RT/IO, LLDP, PNIO-CM, GSDML i diagnostyka cyklu |
| SA-618 | Process values, statystyki, korelacja, anonimizacja i eksport |
| SA-619 | Bramka E2E, wydajności, fuzzingu, bezpieczeństwa i licencji |

Po SA-619 kolejne protokoły otrzymują osobne karty. Pierwszy backlog obejmuje Modbus TCP, Siemens S7comm/ISO-on-TCP i — po potwierdzeniu nazwy/specyfikacji — VARAN.

### Faza 7 — Logic Analyzer jako produkt (PERSPEKTYWA — WSTRZYMANE)

Faza zachowana jako perspektywa rozwoju. Decyzją właściciela 2026-08-24 nie jest aktywna i wraca do realizacji wyłącznie na jego polecenie. Istniejący CAN Analyzer pozostaje osobnym, niezmienionym narzędziem. Szczegóły: `doc/signal-analyzer/logic-analyzer-implementation-plan.md`.

| ID | Zadanie |
| --- | --- |
| SA-701 | Dokumentacja produktu, hardware, protokołu, backendu i zgodności |
| SA-702 | Additive `DeviceProvider`, capabilities, `RawCaptureChunk`, clock domains i GAP |
| SA-703 | Pakiet `@theia/logic-analyzer`, komenda i wieloinstancyjny widget |
| SA-704 | Simulator 16D+2A, VCD/SR i golden traces |
| SA-705 | Cyfrowy/analogowy waveform, LOD i wirtualizacja kanałów |
| SA-706 | Capture, capabilities-driven konfiguracja, triggery, kursory i pomiary |
| SA-707 | Dekodery, protocol overlay, tabela zdarzeń i eksport |
| SA-708 | Bramka produktu na simulatorze/plikach bez fizycznego sprzętu |

### Faza 8 — Backend natywny i sprzęt rynkowy (PERSPEKTYWA — WSTRZYMANE)

| ID | Zadanie |
| --- | --- |
| SA-801 | `signal-native-host` C++20, lokalny IPC i Bridge API |
| SA-802 | Paged raw store, cyfrowy/analogowy LOD i query engine |
| SA-803 | USB bulk, UART/COBS oraz TCP/mDNS/TLS hook |
| SA-804 | Opcjonalny `sigrok-bridge` GPL dla hardware i formatów Sigrok |
| SA-805 | DSLogic bridge: U2Basic/Plus, buffer/stream/trigger |
| SA-806 | ALIENTEK DL32 feasibility spike i warunkowy driver GPL |
| SA-807 | Wiele urządzeń, global timeline, synchronizacja i budgets |
| SA-808 | Bramka 80/160 MB/s, security, fault injection, packaging i licencje |

### Faza 9 — Własny hardware (PERSPEKTYWA — WSTRZYMANE)

> **ZASTĄPIONE 2026-08-24:** wcześniejsze założenie rozpoczynania własnego LA po stabilizacji CAN nie wyznacza już kolejnego etapu. Parametry sprzętu pozostają materiałem projektowym; przed ich implementacją wymagane jest ponowne polecenie właściciela i rewizja.

| ID | Zadanie |
| --- | --- |
| SA-901 | SADP v1: emulator, parser C/C++, golden frames i conformance kit |
| SA-902 | LA-Lite ESP32: USB/UART/TCP, bufor, trigger, RLE |
| SA-903 | STM32H7: USB HS, Ethernet, UART, bootloader i FPGA control |
| SA-904 | FPGA: 4×400, 8×200, 16×100, opcjonalnie 32×50 MS/s |
| SA-905 | Mixed-signal analog front-end, ADC i kalibracja |
| SA-906 | EVT PCB LA-Pro 400 i bring-up |
| SA-907 | Hardware sync, kalibracja, signed update i test produkcyjny |
| SA-908 | Sterownik Sigrok naszego urządzenia |
| SA-909 | DVT/PVT, hardware-in-loop, dokumentacja i bramka wydania |

---

## 5. Benchmarki jako Definition of Done

- ≥ 100 000 próbek/s (analog) i ≥ 20 000 ramek/s (CAN) bez utraty danych; UI ≤ 20 FPS throttled, bez zamrożenia.
- Sesja 1 GB otwiera się i nawiguje < 2 s (PagedStore + LOD).
- Dekodowanie viewportu 1 M adnotacji < 300 ms w workerze.
- Awaria dowolnego dekodera nie wpływa na pozostałe (circuit breaker).
- Logic Analyzer: ≥80 MB/s agregatu z dwóch urządzeń przez 10 min bez niewyjaśnionego `GAP`; cel rozszerzony ≥160 MB/s na odpowiednim hoście.
- Cached LOD viewport dla 16 kanałów: p95 < 100 ms; pełny raw nie trafia do renderera.
- `STOP` rozpoczyna draining w < 250 ms również przy pełnych kolejkach danych.
- Sesja 100 GB otwiera pierwszy viewport bez skanowania całego pliku.
- Industrial Protocol Analyzer: EtherCAT i PROFINET 100 Mb/s, każdy przez 60 min bez niewyjaśnionego dropu przy prawidłowym TAP/mirror i dysku.
- PCAPNG 10 GB pokazuje pierwszy ekran bez pełnego skanu w < 2 s na hoście referencyjnym.
- Tabela 1 mln rekordów pozostaje wirtualizowana, a cached filter/query ma p95 < 100 ms dla widocznego zakresu.
- Industrial Protocol Analyzer pozostaje pasywny. Aktywny TX jest dozwolony wyłącznie w CAN Device Lab po uzbrojeniu izolowanej sesji stołowej.
- CAN Device Lab: awaryjny `STOP` nie dopuszcza nowych ramek po upływie budżetu SA-410; bus-off i przekroczenie limitu obciążenia kończą kampanię automatycznie.
- Każdą znalezioną ramkę lub sekwencję potwierdzają powtarzalne próby pozytywne i kontrolne negatywne; wynik zawiera pełny ślad TX/RX/feedback i nie jest oparty wyłącznie na „ostatnich N” ramkach.
- Symulator SA-409 obejmuje co najmniej: pojedynczą ramkę wake, sekwencję, opóźnioną reakcję, keep-alive, trwały stan ON/OFF, spontaniczne RX i kontrolowany fałszywy sygnał. Seeded replay musi być deterministyczny w CI.
- Eksportowany pakiet eksperymentu odtworzony z tym samym seedem na SA-409 daje identyczny plan TX, ranking i decyzje algorytmu; próby sham/no-TX nie mogą systematycznie awansować kandydata.

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
| CAN TX i kampanie | backend Node.js + SocketCAN/adapter Windows, monotoniczny scheduler, append-only event journal; Python tylko jako izolowany runner SA-420 |
| Backend Logic Analyzer | oddzielny proces C++20/CMake; libusb, async I/O, mmap store, LOD |
| Urządzenia własne | SADP przez USB bulk, UART/COBS i TCP/IP; ESP32 oraz STM32H7+FPGA |
| Bridge'e GPL | osobne opcjonalne procesy Sigrok, DSLogic i ALIENTEK po przeglądzie licencji |
| Industrial capture | PCAP/PCAPNG, opcjonalny dumpcap/tshark bridge, serial/RS-485; C++ sidecar wyłącznie po profilu |

> **ZASTĄPIONE 2026-08-24 decyzją właściciela, wyłącznie dla Logic Analyzer:** wcześniejszy zakaz C++ poza N-API nie obowiązuje dla wysokowydajnego capture/store/LOD/decoderów i bridge'y sprzętowych. Obowiązuje izolowany proces C++ opisany w `doc/signal-analyzer/logic-analyzer-native-backend.md`. N-API nie jest domyślną granicą sterownika. Rust, gRPC, nieizolowany mikroserwis Python i ciężkie biblioteki UI nadal wymagają osobnej decyzji.

> **AKTUALIZACJA 2026-08-24:** zgoda na izolowany backend C++ obejmuje również capture/index/reassembly Industrial Protocol Analyzer, ale tylko gdy profil wykaże przekroczenie budżetu implementacji Node/worker. Pierwszy vertical slice PCAP/Modbus RTU pozostaje przenośny i działa bez natywnej binarki.
