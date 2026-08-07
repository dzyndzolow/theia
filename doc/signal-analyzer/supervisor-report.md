# Signal Analyzer — Raport superwizora

**Data:** 2026-08-05
**Zakres:** Wszystkie dokumenty Signal Analyzer (`SIGNAL-ANALYZER-*.md` oraz `doc/signal-analyzer/**/*.md`), `CLAUDE.md` i implementacja `packages/can-bus` po SA-001…SA-006.
**Wynik:** Kompilacja, lint i 22 testy jednostkowe przechodzą, ale Faza 0 **nie jest gotowa do integracji ani do zamknięcia**. Wykryto braki w rzeczywistej ścieżce frontend↔backend, semantyce transportu binarnego, wydajności renderowania oraz zgodności dokumentacji ze stanem kodu.

---

## 1. Cel tego dokumentu

Raport superwizora jest **jedynym plikiem sterującym jakością kodu** w projekcie Signal Analyzer.
Każdy wykonawca i każdy kolejny model AI musi go przeczytać przed rozpoczęciem pracy —
zawiera aktualną listę znanych usterek, dług techniczny oraz rekomendacje architektoniczne,
których nie ma w kartach zadań.

Dokument jest **rozwijany** (nigdy nie zastępowany w całości) przy każdej rewizji superwizora.
Nowe wpisy są dopisywane na górze sekcji `## 2. Bieżące ustalenia`, a stare — powyżej `## 3. Historia` — pozostają jako kontekst.

---

## 2. Bieżące ustalenia

### 2.1. Decyzja superwizora — rewizja integracyjna Fazy 0 (2026-08-05)

**Decyzja:** `POPRAWKI WYMAGANE` dla SA-002, SA-003, SA-004, SA-005 i SA-006. Wcześniejsze decyzje `AKCEPTACJA` pozostają ważnym śladem historycznym, ale zostały podważone przez późniejszą, przekrojową rewizję integracji.

**Blokada:** SA-007 i SA-008 nie mogą zostać zarezerwowane, dopóki poprawki opisane w tym raporcie nie otrzymają `AKCEPTACJA`. Samo wpisanie pakietu do aplikacji przykładowej nie może maskować niepołączonego frontendowego klienta RPC.

### 2.2. 🔴 Krytyczne ustalenia

#### C-01. Brak rzeczywistego połączenia frontend↔backend — SA-003 i SA-005 nie realizują DoD

- **Dowód:** `packages/can-bus/src/browser/can-frontend-module.ts` rejestruje wyłącznie widget i widok. Nie tworzy `WebSocketConnectionProvider`/`ServiceConnectionProvider`, `CanRpc` proxy ani klienta z `onBinaryFrames`. `CanWidget.startCapture()` i `stopCapture()` tylko zmieniają lokalny stan i zapisują `console.log`; komendy w `can-view-contribution.ts` są no-op.
- **Skutek:** backendowy `CanSocketServiceImpl` nigdy nie jest uruchamiany z UI, pakiety z `CanRpcServiceImpl` nie docierają do `CanWidget.addBinaryChunk()`, a DoD SA-003 „frontend odbiera zdarzenia” oraz SA-005 „binarny transport danych” są niespełnione.
- **Poprawa:** utworzyć frontendowy proxy przez `WebSocketConnectionProvider.createProxy<CanRpc>(canServicePath, client)`, gdzie `client.onBinaryFrames` wywołuje `CanWidget.addBinaryChunk()`. Podłączyć przyciski i komendy do proxy oraz dodać test integracyjny połączenia RPC z klientem callbacków.
- **Właściciele poprawek:** SA-003 i SA-005.

#### C-02. Format binarny jest nielossless i błędnie raportuje sukces dla pakietów uszkodzonych — SA-005

- **Dowód wykonawczy:** round-trip ramki z `interface: 'can7'` zwraca `interface: 'sim0'`; ucięty pakiet z nagłówkiem `count: 1` zwraca `decoded: 0`, lecz `CanBinaryDecoder.decodeBatch()` zwraca `1`.
- **Źródło:** encoder zawsze zapisuje `interfaceId = 0`; decoder rekonstruuje tylko `sim0` lub syntetyczne `can${id}`. Decoder zwraca liczbę z nagłówka, a nie liczbę faktycznie zdekodowanych ramek, i nie odrzuca uszkodzonego pakietu.
- **Dodatkowe odstępstwa:** nie ma CRC mimo kryterium weryfikacji SA-005; wyliczenie rozmiaru używa nieprzyciętego `f.dlc`, gdy zapis używa `clamp(0, 64)`; parser tworzy nowy obiekt i nową tablicę danych dla każdej ramki, więc nie spełnia deklaracji „zero-allocation”.
- **Poprawa:** zdefiniować wersjonowany nagłówek z identyfikatorem/wykazem interfejsów, CRC i jednoznaczną polityką błędu. Walidować pełną długość przed dekodowaniem, zwracać faktycznie zdekodowaną liczbę albo błąd, zrównoważyć wyliczenie rozmiaru z zapisanym DLC oraz zaprojektować parser zapisujący bezpośrednio do prealokowanego magazynu po stronie UI.
- **Właściciel poprawek:** SA-005.

#### C-03. Weryfikacja benchmarku SA-005 nie sprawdza deklarowanego DoD

- **Dowód:** test nazywa się „under 50ms”, ale asercja wymaga `elapsed < 500`; mierzy `Date.now()` zamiast dokładniejszego `performance.now()` i nie testuje pełnej ścieżki socket→batch→RPC→widget.
- **Skutek:** wpisy w changelogu i rekordzie SA-005 „20k < 50ms” nie są poparte testem.
- **Poprawa:** zmienić próg na `< 50 ms`, mierzyć monotonicznym zegarem, testować CRC/liczbę/interfejsy oraz dodać test kanału RPC z binarnym callbackiem.
- **Właściciel poprawek:** SA-005.

#### C-04. Symulator miesza bitrate magistrali z szybkością generacji ramek — SA-002

- **Dowód:** `CanSimulatorAdapter.configure()` interpretuje `CanInterfaceConfig.bitrate` (udokumentowane jako bps) jako fps i przy `500000` wymusza `5000` ramek/s.
- **Skutek:** konfiguracja magistrali nie ma semantyki zgodnej z kontraktem, a zadeklarowane testy jittera nie są zamockowane ani nie mierzą odchyłki 2 ms.
- **Poprawa:** wprowadzić osobną, jawną konfigurację symulatora `frameRate`; zachować `bitrate` dla CAN. Testy czasu oprzeć o kontrolowany zegar/timer, dodać testy zakresów i raportowania błędu. Nie twierdzić, że SocketCAN/serialport działa, dopóki adaptery platformowe nie istnieją.
- **Właściciel poprawek:** SA-002.

### 2.3. 🟠 Istotne problemy jakości i wydajności

#### Q-01. UI nie jest throttlowane do 20 FPS i narusza zakaz `innerHTML` — SA-004

- `requestAnimationFrame` bez bramki czasu renderuje do ~60 FPS, nie ~20 FPS.
- `updateStatsDisplay()` przepisuje cały panel przez `innerHTML`; nagłówek tabeli i prealokowane wiersze też powstają przez `innerHTML`.
- `RingBuffer.last().reverse()`, `data.map(...).join(...)` i `FpsCanvasRenderer.samples.shift()/push()` alokują na ścieżce renderowania.
- **Poprawa:** dodać monotoniczną bramkę 50 ms, prealokować elementy statystyk i tworzyć strukturę tabeli przez API DOM, dodać iterację ring-buffer bez tablicy pośredniej oraz stałopozycyjny bufor próbek canvasu.
- **Właściciele poprawek:** SA-004 i SA-006.

#### Q-02. Motyw Theia nie jest konsekwentnie stosowany — SA-006

- CSS i Canvas2D używają twardych kolorów (`#4CAF50`, `#2196F3`, `rgba(...)`, fallbacki kolorów), mimo zakazu z karty SA-006.
- Canvas nie może użyć `var(--theia-...)` bezpośrednio jako `CanvasRenderingContext2D` style; renderer powinien odczytać wartości z `getComputedStyle(this.canvas)` lub otrzymać paletę od widgetu.
- Testy canvasu nie sprawdzają rzeczywistego `devicePixelRatio`, kolorów ani geometrii rysowania; używają tylko minimalnego mocka bez asercji.
- **Poprawa:** dodać dostawcę kolorów motywu, zastąpić stałe, rozszerzyć testy High-DPI i test manualny po SA-007.
- **Właściciel poprawek:** SA-006.

#### Q-03. Kontrakt zamknięcia połączenia jest źle opisany i testowany — SA-003

- `RpcConnectionHandler` przekazuje `RpcProxy<CanRpcClient>`, dla którego `onDidCloseConnection` jest `Event<void>` dostarczanym przez Theia. `CanRpcClient` deklaruje go jako opcjonalną metodę `() => void`, a testy nie uruchamiają prawdziwego zdarzenia zamknięcia.
- **Poprawa:** usunąć `onDidCloseConnection` z własnego interfejsu klienta, korzystać z typu `RpcProxy<CanRpcClient>` w warstwie połączenia i dodać test z `RpcProxyFactory`/kanałem testowym.
- **Właściciel poprawek:** SA-003.

#### Q-04. Kolejka batchująca zrzuca ramki bez obserwowalności — SA-005

- Gdy osiągnie `MAX_PENDING_BATCH_SIZE`, `onFrame()` milcząco odrzuca nowe ramki. Gdy klient nie ma `onBinaryFrames`, `flushBatch()` bez raportu usuwa cały batch.
- **Poprawa:** wyraźnie udokumentować politykę drop-oldest/drop-newest, liczyć odrzucone ramki w `CanStatistics` lub osobnym telemetrii oraz przekazać stan klientowi.
- **Właściciel poprawek:** SA-005.

### 2.4. 🟡 Niespójności dokumentacji i planu

- SA-005 jest oznaczone jako `ZAAKCEPTOWANE`, a rekord i changelog twierdzą „zero-allocation”, „bezstratny” i „20k < 50ms” — wszystkie trzy twierdzenia są obecnie nieudowodnione lub fałszywe.
- SA-003 jest oznaczone jako `ZAAKCEPTOWANE`, choć nie istnieje klient RPC w przeglądarce.
- SA-006 pozostaje `GOTOWE DO REWIZJI`; nie może zostać zaakceptowane przed Q-01/Q-02.
- `execution.md` nadal zawiera historyczne kroki SA-002 jako „następne”, mimo że SA-002…SA-006 istnieją; należy utrzymywać wyłącznie bieżący następny krok plus historię w changelogu/rekordach.

### 2.5. Zalecana kolejność dalszego działania

1. **Nie rozpoczynać SA-007 ani SA-008.** Są blokowane przez C-01…C-04.
2. Otworzyć poprawki SA-002, SA-003, SA-004, SA-005 i SA-006 według właścicieli powyżej; ze względu na wspólne pliki wykonywać je sekwencyjnie w kolejności: SA-002 → SA-003 → SA-004/SA-006 → SA-005.
3. Po poprawkach uruchomić pełny pakiet `@theia/can-bus` (compile/lint/test) oraz test integracyjny z prawdziwym proxy frontendowym.
4. Dopiero wtedy SA-007 rejestruje pakiet w `examples/browser/package.json`, buduje aplikację przez `npm run build:browser` i wykonuje ręczny test capture→table→chart.
5. SA-008 opisuje wyłącznie zweryfikowane zachowanie po SA-007.

### 2.6. Częstotliwość kontroli superwizora (skorygowana)

Pełna rewizja na końcu fazy pozostaje obowiązkowa, ale sama częstotliwość „10 bramek na 34 zadania” jest zbyt rzadka dla zadań zmieniających granice procesów lub kontrakty.

| Rodzaj kontroli | Kiedy | Przykłady |
| --- | --- | --- |
| **Rewizja granicy** | przed `AKCEPTACJA` każdego zadania zmieniającego protokół, DI, RPC, format binarny, API publiczne lub punkt montażu aplikacji | SA-002, SA-003, SA-005, SA-007, SA-102, SA-105, SA-205 |
| **Rewizja partii równoległej** | po maks. 3 zadaniach lub po jednej sesji/dniu pracy równoległej — zależnie co nastąpi wcześniej | SA-004 + SA-005 + SA-006 |
| **Rewizja fazy** | po ostatnim zadaniu fazy, przed stabilizacją | SA-008, SA-106, SA-206, SA-305, SA-406, SA-505, SA-604 |
| **Rewizja awaryjna** | od razu przy `BLOCKED`, regresji testu, zmianie kontraktu albo naruszeniu plików wspólnych | każdy etap |

**Rytm praktyczny:** zwykle 1–3 karty między kontrolami, nigdy tylko „na końcu fazy” dla transportu lub interfejsów. Supervisor nie pisze kodu produktowego, lecz aktualizuje ten raport, statusy kart i decyzje o integracji.

### 2.7. ✅ Zweryfikowane pozytywy

- `@theia/can-bus` przechodzi niezależnie `compile`, `lint` i 22 testy jednostkowe.
- Token `CanSocketService` w metadanych Inversify jest poprawnie rozwiązywany; cykliczny import nie uszkodził dekoratora `@inject`.
- `RingBuffer.push()` ma złożoność O(1), a tablica zapasowa nie jest realokowana.
- MsgPack Theia obsługuje binarne wartości, więc `ArrayBuffer` może zostać przekazany przez RPC; brakuje jednak klienta browserowego i testu rzeczywistej ścieżki.

### 2.8. Ustalenia z wcześniejszej rewizji — nadal obowiązujące

#### 2.1.1. `can-widget.ts` — `statsEl.innerHTML` łamie zakaz `innerHTML` (SA-004 DoD)

- **Plik:** `packages/can-bus/src/browser/can-widget.ts`, metoda `updateStatsDisplay()`
- **Problem:** `this.statsEl.innerHTML = ...` używa `innerHTML`, co jest wprost zabronione w karcie SA-004 (`Zakazane: Manipulacja innerHTML`). Chociaż dane pochodzą z własnych statystyk (brak XSS), każde wywołanie `innerHTML` przy 5000 fps wymusza parse HTML i niszczy/rekonstruuje poddrzewo DOM.
- **Poprawa:** zastąpić `this.statsEl` pięcioma pre-allocated `<span>` z `data-stat` i aktualizować tylko `textContent`.
- **Priorytet:** wysoki (narusza DoD)

#### 2.1.2. `can-rpc-service.ts` — pokrycie testami spadło do 77% po dodaniu batchowania

- **Plik:** `packages/can-bus/src/node/can-rpc-service.ts`
- **Problem:** SA-005 dodał logikę batchowania (`onFrame`, `startBatching`, `stopBatching`, `flushBatch` — linie 40-41, 81-82, 92-95), ale testy SA-003 nie zostały rozszerzone. Nowa logika nie ma pokrycia.
- **Poprawa:** dodać testy: cykl życia timera batchującego, flush przy pustym batchu, limit `MAX_PENDING_BATCH_SIZE`, flush przy `stopCapture`.
- **Priorytet:** średni (logika działa, ale brak testów)

#### 2.1.3. `RingBuffer.last()` — alokuje nową tablicę przy każdym wywołaniu

- **Plik:** `packages/can-bus/src/browser/ring-buffer.ts`, metoda `last()`
- **Problem:** `const result: T[] = []; result.push(...)` tworzy nową tablicę referencji. Karta SA-004 wymaga "zero alokacji na ścieżce renderowania". W praktyce `last()` jest wołane tylko z `scheduleRender` (~20 FPS, nie z `addFrame` 5000 FPS), więc wpływ wydajnościowy jest pomijalny.
- **Poprawa:** dodać komentarz wyjaśniający, że `last()` jest poza hot-path, oraz doprecyzować DoD: "zero alokacji dotyczy ścieżki `addFrame → RingBuffer.push`, nie `updateFrameTable`".
- **Priorytet:** niski (akceptowalne na tym etapie)

#### 2.1.4. `addFrame()` — rozbieżność `totalFrames` vs `frames.size`

- **Plik:** `packages/can-bus/src/browser/can-widget.ts`, metoda `addFrame()`
- **Problem:** `this.statistics.totalFrames++` jest inkrementowany przy każdym wywołaniu, ale `RingBuffer` ma capacity 1000 i nadpisuje najstarsze wpisy. `totalFrames` zlicza wszystkie ramki od początku sesji, a `frames.size` to tylko bufor widoczny — to świadomy wybór, ale nieudokumentowany.
- **Poprawa:** dodać komentarz `// totalFrames counts all frames ever received, not just those in the visible ring buffer`.
- **Priorytet:** niski (dokumentacyjny)

#### 2.1.5. `can-rpc-service.ts` — odpowiedzialność przekroczona (middleware w serwisie RPC)

- **Plik:** `packages/can-bus/src/node/can-rpc-service.ts`
- **Problem:** `CanRpcServiceImpl` subskrybuje `onFrameReceived` w konstruktorze i prowadzi własny batch timer — to logika middleware (należąca do SA-005), a nie proxy RPC (SA-003). Nie powoduje to błędów kompilacji, ale utrudnia testowanie i narusza zasadę pojedynczej odpowiedzialności.
- **Poprawa:** przy SA-101 (signal-core) rozważyć wydzielenie `CanBatchRelay` jako osobnej klasy.
- **Priorytet:** niski (refaktoryzacja, nie blokuje Fazy 0)

### 2.2. 🟡 Uwagi nieblokujące

- **`can-protocol.ts` urósł do ~200 linii** z mieszaną odpowiedzialnością (typy domenowe + enkoder binarny + dekoder binarny + kontrakty RPC). Przy SA-101 (pakiet `@theia/signal-core`) rozważyć wydzielenie `can-binary.ts` dla enkodera/dekodera.
- **`can-widget.ts`** — `addBinaryChunk` został dodany równolegle z SA-004 i SA-005. Potwierdza to poprawność sekwencyjności: SA-005 musiał czekać na SA-004 (współdzielą `can-widget.ts`).
- **`can-backend-module.ts`** — 47% pokrycia testami. Dopuszczalne dla kontenera DI (sam w sobie nie zawiera logiki biznesowej).

### 2.3. ✅ Rzeczy zrobione dobrze

- **RingBuffer** — czysta implementacja, pre-allocated array, O(1) push, brak realokacji.
- **CanBinaryEncoder/Decoder** — well-structured, magic number validation, prawidłowy endianness (LE), test throughput (20k ramek < 50ms).
- **FpsCanvasRenderer** — poprawny High-DPI (`devicePixelRatio`), fallback canvas 2D, czyszczenie stanu.
- **Testy SA-005** — pokrywają roundtrip, pusty batch, odrzucanie złego magic number, throughput.
- **Równoległość** — SA-004/SA-005/SA-006 współistnieją bez konfliktów.

---

## 3. Rytm pracy superwizora (kiedy czytać ten raport)

Supervisor **nie** jest wołany po każdym `SA-xxx`. Punkty kontrolne:

| Bramka | Wyzwalacz | Zakres rewizji |
| --- | --- | --- |
| **Koniec Fazy 0** | SA-008 zakończone | Kompilacja, lint, testy, `npm run start:browser`, spójność widget↔backend, zamknięcie usterek z §2.1 |
| **SA-102** | Kontrakty `signal-core` zdefiniowane | Zgodność z roadmap §3, `readonly`, `apiVersion`, testy typów |
| **SA-105** | Migracja can-bus na signal-core | Regresja Fazy 0 — widget nadal działa po migracji? |
| **SA-205** | Bramka zamrożenia kontraktu | Test na 2 protokołach (CAN + UART); `DecoderProvider` działa bez zmian? |
| **Koniec Fazy 1** | SA-106 zakończone | Kompletność `@theia/signal-core`, testy struktur danych, benchmarki |
| **Koniec Fazy 2** | SA-206 zakończone | Pełny DAG decoderów, circuit breaker, worker, testy regresji (SA-207) |
| **Koniec Fazy 3** | SA-305 zakończone | Wizualizacja — WebGL, Min-Max LOD, wydajność |
| **Koniec Fazy 4** | SA-406 zakończone | Semantyka — .dbc, AnnotationIndex, Undo/Redo, Export/Import |
| **Koniec Fazy 5** | SA-505 zakończone | AI + porównania — agent, anomalie, DTW, libsigrokdecode |
| **Koniec Fazy 6** | SA-604 zakończone | Ekosystem — Plugin API, trigger engine, CRDT, N-API |

**Zasada:** ~10 rewizji na ~34 zadania. Nowy raport superwizora powstaje w każdej z tych bramek i jest dopisywany do tego pliku.

---

## 4. Checklista rewizji superwizora (powtarzalna)

Przy każdej bramce z §3 sprawdzam:

1. **Zgodność z kartami zadań** — czy zrobiono dokładnie zakres, nic mniej/więcej.
2. **Zgodność z roadmap §3** — kontrakty zachowane, `apiVersion` niezmienione bez decyzji.
3. **Migracyjność** — zero zmian w upstreamie Theia.
4. **Wydajność i pamięć** — benchmarki DoD spełnione, brak wycieków (listenery, timery, ArrayBuffer).
5. **Styl i konwencje** — 4 spacje, `undefined` > `null`, property injection, `bindRootContributionProvider`.
6. **Weryfikacja** — `npx lerna run compile --scope ...`, `npx lerna run lint --scope ...`, `npx lerna run test --scope ...` — wszystkie OK.
7. **Changelog i dokumentacja** — append-only, aktualny `execution.md`, indeks `README.md`.
8. **Bezpieczeństwo** — brak `innerHTML` z danymi zewnętrznymi, brak swallow exceptions, limity buforów.

---

## 5. Historia (archiwum)

> Poprzednie wpisy superwizora będą dopisywane tutaj przy kolejnych bramkach.
> Nie usuwać — każdy wpis to kontekst dla następnych rewizji.

### 2026-08-05 — Faza 0 po SA-006 (pierwsza rewizja)

- **Zakres:** SA-001…SA-006
- **Wynik:** 22/22 testów ✅, kompilacja ✅, lint ✅
- **Usterki:** 5 (szczegóły w §2.1)
- **Decyzja:** Faza 0 może być kontynuowana. SA-007 i SA-008 nie są blokowane.
