# Signal Analyzer — Zadania dla agentów AI i protokół rewizji supervisora

**Powiązane:** `SIGNAL-ANALYZER-ROADMAP.md` (architektura, kontrakty, fazy), `SIGNAL-ANALYZER-CHANGELOG.md` (append-only log), `doc/signal-analyzer/` (dokumentacja funkcjonalna).

---

## 1. Role

### 1.1. Agent-Wykonawca (Executor)

Dowolny model AI (np. inny agent/model niż supervisor) realizujący **jedną kartę zadania** (SA-xxx) z tego dokumentu. Wykonawca:
- Implementuje **wyłącznie** zakres opisany w karcie zadania — nie rozszerza go „przy okazji".
- Nie modyfikuje plików spoza `Pliki dozwolone` karty bez zgody supervisora.
- Weryfikuje pracę lokalnie (kompilacja/lint/test) przed zgłoszeniem do rewizji. Wymagane jest pokrycie testami dla nowych struktur danych, algorytmów i parserów.
- Dopisuje wpis w `SIGNAL-ANALYZER-CHANGELOG.md` (format §0.1 roadmap) — **zawsze z listą Dodane/Zmodyfikowane/Usunięte**.
- Aktualizuje dokumentację w `doc/signal-analyzer/` w zakresie zmiany (włączając w to diagramy Mermaid tam, gdzie architektura staje się złożona).
- **Nie commituje, nie pushuje, nie decyduje o wersji stabilnej.**
- Kończy pracę statusem `GOTOWE DO REWIZJI` (lub `BLOCKED` z opisem) — nie oznacza zadania jako ukończonego samodzielnie.

### 1.2. Supervisor (ja / rola nadrzędna)

- Nie implementuje kodu funkcjonalnego produktu (chyba że naprawia drobny błąd rewizyjny).
- Weryfikuje pracę wykonawcy wg checklisty §3, zwracając szczególną uwagę na zagadnienia wydajności (złożoność obliczeniowa $O(n)$) oraz zarządzania pamięcią (wycieki, GC pauses).
- Wydaje jedną z decyzji: **AKCEPTACJA**, **POPRAWKI WYMAGANE** (z listą konkretnych uwag), **ODRZUCONE** (z uzasadnieniem i alternatywą).
- Aktualizuje/doprecyzowuje kolejne karty zadań na podstawie tego, co faktycznie wyszło z poprzedniej fazy (zasada „ewolucja, nie architektura z góry" z roadmap §1).
- Rekomenduje właścicielowi, które zadania/fazy są gotowe do oznaczenia jako wersja stabilna i trafienia do gita.

---

## 2. Protokół pracy (workflow)

1. Właściciel lub supervisor wskazuje wykonawcy kartę zadania (ID `SA-xxx`) z §4.
2. Wykonawca implementuje, weryfikuje lokalnie, aktualizuje changelog + dokumentację, zgłasza „gotowe do rewizji" z podsumowaniem (co zrobił, wynik weryfikacji, ewentualne odstępstwa od karty i dlaczego).
3. Supervisor wykonuje rewizję wg checklisty §3, wydaje decyzję i zapisuje ją jako komentarz do zgłoszenia.
4. Przy `POPRAWKI WYMAGANE` — wykonawca poprawia i dopisuje **kolejny** wpis w changelogu (nie nadpisuje poprzedniego).
5. Przy `AKCEPTACJA` — zadanie oznaczane jako ukończone w §4 (supervisor aktualizuje status w tym pliku, to jedyny plik roboczy, który supervisor może swobodnie edytować).
6. Po ukończeniu całej fazy: supervisor przygotowuje krótkie podsumowanie fazy + rekomendację „gotowe do wersji stabilnej".

---

## 3. Checklista rewizji supervisora

Dla każdego zgłoszenia sprawdzam po kolei:

1. **Zgodność z kartą zadania** — czy zrobiono dokładnie to, co w `Zakres`, nic mniej/więcej.
2. **Zgodność z kontraktami** — czy interfejsy zostały zachowane, czy poprawnie użyto wzorców architektonicznych (DI, State Machine, Observable, RPC).
3. **Migracyjność** — czy nie naruszono plików core upstreamu bez jasnej zgody (np. wstrzykiwanie logiki poprzez rebindy).
4. **Wydajność i pamięć** — czy struktury danych są optymalne? Czy zapobiegnięto memory leakom (czyszczenie listenerów, unikanie niekontrolowanego rozrostu tablic)? Czy zminimalizowano presję na Garbage Collector (zero-allocation, Object Pooling)?
5. **Styl i konwencje** — 4 spacje, property injection + `@postConstruct()`, `bindRootContributionProvider`, niezmienność (immutability) dla stanów współdzielonych.
6. **Weryfikacja** — czy podano dokładną komendę, czy testy przechodzą i pokrywają warunki brzegowe (edge cases, NaN, timeouty).
7. **Changelog i Dokumentacja** — append-only log, poprawny Markdown, diagramy.
8. **Bezpieczeństwo i Niezawodność** — brak cichego połykania wyjątków (swallowing exceptions), zabezpieczenia przed prompt injection w warstwie AI, limity buforów.

---

## 4. Karty zadań

Format karty: **Status**, **Cel**, **Pliki dozwolone**, **Wymagania implementacyjne**, **Definition of Done**, **Weryfikacja**, **Zakazane**.

Zadania zostały uszczegółowione pod kątem ścisłych wymagań optymalizacyjnych i architektonicznych (Gemini 3.1 Pro expansion).

Statusy: `DO ZROBIENIA` | `W REALIZACJI` | `W REWIZJI` | `POPRAWKI WYMAGANE` | `UKOŃCZONE`.

---

### Faza 0 — CAN end-to-end na istniejącym MVP (P0)

#### SA-001 — Backend: DI bindings

- **Status:** UKOŃCZONE
- **Cel:** Utworzyć moduł backendowy analogiczny do `src/browser/can-frontend-module.ts`, żeby pakiet `@theia/can-bus` ładował się po stronie Node, oraz ustanowić stabilne identyfikatory DI (`Symbol`) dla usług implementowanych w SA-002 i SA-003.
- **Pliki dozwolone:** `packages/can-bus/src/node/can-backend-module.ts` (nowy), `packages/can-bus/tsconfig.json` (nowy), `packages/can-bus/.eslintrc.js` (nowy), `packages/can-bus/src/browser/can-view-contribution.ts`, `packages/can-bus/src/browser/can-widget.ts`, `packages/can-bus/package.json`.
- **Wymagania implementacyjne:**
  - Utworzyć eksportowany `ContainerModule` i unikalne identyfikatory `Symbol` dla `CanSocketService` oraz `CanRpcService`.
  - Nie wprowadzać atrap usług ani logiki biznesowej: implementacje nie istnieją jeszcze w tym kroku. SA-002 wiąże `CanSocketServiceImpl` przez `bind(...).toSelf().inSingletonScope()`, a SA-003 wiąże `CanRpcServiceImpl` i `RpcConnectionHandler`; obie karty mogą wtedy modyfikować ten moduł.
  - Po pojawieniu się zależności usług stosować property injection `@inject`, bez cyklicznych zależności w konstruktorach.
  - Usunąć wyłącznie obecne błędy ścisłej kompilacji w istniejącym UI, jeżeli blokują weryfikację SA-001; bez zmiany zachowania lub realizacji zakresu SA-004.
- **Definition of Done:** Moduł kompiluje się i ładuje w procesie głównym bez błędów `No matching bindings found`; tokeny `Symbol` są dostępne dla SA-002 i SA-003.
- **Weryfikacja:** `npx lerna run compile --scope @theia/can-bus`, `npm run start:browser` + analiza logów startowych Node.
- **Zakazane:** Pisanie logiki biznesowej w pliku modułu DI. Używanie ciągów znaków (string) jako identyfikatorów wiązań wstrzykiwania zależności zamiast `Symbol`.

#### SA-002 — Backend: `can-socket-service.ts`

- **Status:** UKOŃCZONE
- **Cel:** Stworzyć serwis strumieniujący ramki `CanFrame`, wyposażony w symulator i obsługę sprzętu (za odpowiednią warstwą abstrakcji), realizujący backpressure.
- **Pliki dozwolone:** `packages/can-bus/src/node/can-socket-service.ts` (nowy), `packages/can-bus/src/node/can-backend-module.ts`, `packages/can-bus/src/node/index.ts`, `packages/can-bus/package.json`.
- **Wymagania implementacyjne:**
  - Związać `CanSocketServiceImpl` w `can-backend-module.ts` przez token `CanSocketService` ustanowiony w SA-001, używając `bind(...).toSelf().inSingletonScope()` i bez globalnego singletonu poza kontenerem Theia.
  - Interfejs sprzętowy oddzielony od warstwy usługowej (wzorzec Adapter).
  - Wbudowany symulator działający na precyzyjnym liczniku (`setTimeout`/`setInterval` kompensowany timerem `hrtime.bigint()` dla dokładnego modelowania czasów nanosekundowych).
  - Deterministyczny symulator: wsparcie dla 100 do 5000 ramek/s, rozróżnienie ramek 11-bitowych i 29-bitowych.
  - Prawidłowe zarządzanie cyklem życia: zwalnianie timerów podczas `stop()` w celu zapobiegania memory leakom.
- **Definition of Done:** Symulator produkuje ramki bez jittera czasowego wyższego niż 2ms względem założeń. Testy obejmują start/stop bez wycieków zasobów.
- **Weryfikacja:** Test jednostkowy asynchroniczny `can-socket-service.spec.ts` sprawdzający dokładność dystrybucji ramek w czasie używając zamokowanego (mock) upływu czasu.
- **Zakazane:** Dodawanie bibliotek C/C++ (np. `socketcan`) bezpośrednio na ten moment bez zgody. Aktywne oczekiwanie (busy wait) pętli `while(true)` blokujące event loop Node.js.

#### SA-003 — Backend: `can-rpc-service.ts`

- **Status:** UKOŃCZONE
- **Cel:** Dwukierunkowa komunikacja RPC i Eventy z dbałością o zamykanie subskrypcji przy dyskonektach klienta WebSocket.
- **Pliki dozwolone:** `packages/can-bus/src/node/can-rpc-service.ts` (nowy), `packages/can-bus/src/node/can-backend-module.ts`, `packages/can-bus/src/common/can-protocol.ts`.
- **Wymagania implementacyjne:**
  - Związać `CanRpcServiceImpl` przez token `CanRpcService` i zarejestrować `RpcConnectionHandler` w `can-backend-module.ts`, korzystając z wzorca `ConnectionContainerModule.create(...)` i `client.onDidCloseConnection` z `packages/ai-mcp-server`.
  - Proxy dla zdarzeń przesyłające `FRAME_RECEIVED`, z jawnym usuwaniem listenerów (użycie `Disposable.create()` i rejestracji w obiekcie `DisposableCollection` połączenia) kiedy klient wywołuje `onConnectionClosed`.
  - Dodać `// TODO(SA-005): batch/binary transport` z limitem zapobiegającym przepełnieniu bufora WebSocket jeśli sieć jest wolna (prymitywne backpressure na etapie Fazy 0: np. dropowanie starych ramek w serwisie, jeśli kolejka nienazwana na froncie rośnie zbyt szybko).
- **Definition of Done:** Zdarzenia są odbierane przez klienta, a rozłączenie klienta w 100% czyści listenery w Node.js (potwierdzone testem memory leak).
- **Weryfikacja:** Test jednostkowy potwierdzający wywoływanie `dispose()` na subskrypcjach podczas zamykania połączenia symulowanego.
- **Zakazane:** Trzymanie globalnych referencji (array, map) subskrypcji klientów niezwiązanych z ich cyklem życia.

#### SA-004 — Frontend: RingBuffer w `can-widget.ts`

- **Status:** UKOŃCZONE
- **Cel:** Zero-allocation RingBuffer i wysokowydajne renderowanie tabeli do ~20 FPS bez narzutu ze strony silnika V8 Garbage Collector.
- **Pliki dozwolone:** `packages/can-bus/src/browser/can-widget.ts`, `packages/can-bus/src/browser/ring-buffer.ts`.
- **Wymagania implementacyjne:**
  - `RingBuffer<T>` operujący na uprzednio zaalokowanej tablicy (`new Array(MAX_SIZE)` lub `TypedArray`). Nadpisywanie starych elementów w logice zawijania indeksu, **bez tworzenia nowych referencji**.
  - Zastosowanie wzorca Object Pooling dla wierszy tabeli (np. tworzenie dokładnie 50 węzłów DOM i recykling ich zawartości `textContent` zamiast tworzenia/usuwania elementów).
  - Pętla aktualizacji bazująca na `requestAnimationFrame`.
- **Definition of Done:** Zero alokacji na ścieżce odbierania i renderowania ramek po początkowym buforowaniu. Test wydajności Chrome DevTools wskazuje czas renderowania < 5ms na klatkę.
- **Weryfikacja:** Analiza wydajności z włączonymi narzędziami deweloperskimi i opcją nagrywania (Timeline/Performance) w trybie symulatora 5000 fps.
- **Zakazane:** Stosowanie `Array.prototype.push()` lub `Array.prototype.shift()`. Manipulacja `innerHTML`.

#### SA-005 — Binarny transport danych

- **Status:** UKOŃCZONE
- **Cel:** 20k+ ramek/sekundę poprzez binarny transport (chunking) i zminimalizowanie serializacji po stronie Node.js.
- **Pliki dozwolone:** `packages/can-bus/src/node/can-rpc-service.ts`, `packages/can-bus/src/browser/can-widget.ts`, `packages/can-bus/src/common/can-protocol.ts`.
- **Wymagania implementacyjne:**
  - Zaprojektować i zaimplementować strukturalny nagłówek binarny, uwzględniając endianness (konsekwentne stosowanie DataView dla Little Endian / Big Endian, w zależności od wybranego standardu).
  - Batching paczek co ok. 30ms po stronie serwera przed wysłaniem.
  - Zero-allocation parser po stronie klienta (zapis bezpośrednio z odbieranego `ArrayBuffer` do cyklicznego `TypedArray` reprezentującego RingBuffer).
- **Definition of Done:** Bezstratny przesył >20 000 ramek/s. Brak nagłego wzrostu zużycia CPU serwera spowodowanego wywołaniami `JSON.stringify`.
- **Weryfikacja:** Integracyjny benchmark weryfikujący zgodność liczby i CRC przesyłanych i odbieranych ramek binarnych.
- **Zakazane:** Dekodowanie całych `ArrayBuffer` do pośrednich tablic obiektów JS przez `JSON.parse`.

#### SA-006 — CSS widgetu + wykres FPS

- **Status:** UKOŃCZONE
- **Cel:** Minimalistyczny, zgodny estetycznie wykres statystyk używając natywnego API Canvas2D (High-DPI support).
- **Pliki dozwolone:** `packages/can-bus/src/browser/style/can-widget.css`, `packages/can-bus/src/browser/can-widget.ts`, `packages/can-bus/src/browser/fps-canvas.ts`.
- **Wymagania implementacyjne:**
  - Zmienne CSS Theia (zgodność z motywami Jasny/Ciemny/Wysoki Kontrast).
  - Obsługa wyświetlaczy Retina/High-DPI dla wykresu Canvas (zastosowanie `window.devicePixelRatio` do skalowania wewnętrznego bufora canvasu).
  - Wykres liniowy rysujący przesuwający się bufor w czasie rzeczywistym.
- **Definition of Done:** Wykres płynnie prezentuje Bus Load i FPS z wyraźną, nierozmazaną linią renderowaną na monitorach o wysokiej gęstości pikseli.
- **Weryfikacja:** Wizualna inspekcja zmiany szerokości, trybu koloru i powiększenia DPI przeglądarki.
- **Zakazane:** Import bibliotek do wykresów (Chart.js, itp.). Aktualizowanie stylów motywu z użyciem wartości na sztywno, zamiast zmiennych z rejestru.

#### SA-007 — Rejestracja `@theia/can-bus` w aplikacji przykładowej

- **Status:** UKOŃCZONE
- **Cel:** Kompilacja, bundlowanie i udostępnienie pakietu jako pełnoprawnego rozszerzenia Theia.
- **Pliki dozwolone:** `examples/browser/package.json`.
- **Wymagania implementacyjne:**
  - Dodanie `"@theia/can-bus": "0.1.0"`. Upewnienie się, że w przypadku ewentualnych dodanych bibliotek natywnych (w przyszłości) proces webpack/esbuild będzie posiadał wpisy dla `externals` (zabezpieczenie na przyszłość).
- **Definition of Done:** Możliwość uruchomienia polecenia z menu komend.
- **Weryfikacja:** Uruchomienie kompilacji Theia i działający w przeglądarce projekt.
- **Zakazane:** Wszelkie zmiany innych plików poza punktem montażowym.

#### SA-008 — Dokumentacja `can-bus`

- **Status:** UKOŃCZONE
- **Cel:** Kompleksowy dokument techniczno-użytkowy oparty na wykresach Mermaid (komunikacja binarna).
- **Pliki dozwolone:** `doc/signal-analyzer/can-bus.md`, `doc/signal-analyzer/README.md`.
- **Wymagania implementacyjne:**
  - Utworzenie bloku z językiem graficznym `mermaid` dokumentującego architekturę SocketService -> RpcService -> Transport Binarny -> Frontend.
- **Definition of Done:** Diagram poprawnie renderuje się na GitHub, a tekst dokładnie pokrywa najnowsze funkcje (np. opcje symulatora).
- **Weryfikacja:** Pogląd Mermaid w markdown, weryfikacja składni (unikanie błędów typu znak specjalny bez ucieczki w etykiecie węzła).
- **Zakazane:** Publikacja pustych nagłówków sekcji bez zaimplementowanej w kodzie treści.

---

### Faza 1 — `@theia/signal-core`: kontrakty i magazyn danych (P0)

#### SA-101 — Szkielet pakietu `@theia/signal-core`

- **Status:** UKOŃCZONE
- **Cel:** Restrykcyjna konfiguracja pakietu rdzeniowego (core), nie zanieczyszczona zależnościami platformowymi.
- **Pliki dozwolone:** `packages/signal-core/package.json`, `packages/signal-core/tsconfig.json`, `packages/signal-core/src/common/index.ts`.
- **Wymagania implementacyjne:**
  - Rozszerzenie `configs/base.tsconfig.json` z dodatkowymi ostrymi flagami: `noImplicitAny`, `strictNullChecks`, jeśli bazowy ich domyślnie wprost nie włącza, chociaż zalecane jest utrzymanie standardów projektu bez overridingu.
  - Zastosowanie modułów w CommonJS, ES2023 dla kompilacji Lerna, zgodnie z głównym repozytorium Theia.
- **Definition of Done:** Pakiet jest zintegrowany ze zrzutami (lockfiles), lintingiem Lerna, oraz testami (pomimo ich początkowego braku z wynikiem pozytywnym pusto).
- **Weryfikacja:** `npx lerna run compile --scope @theia/signal-core`.
- **Zakazane:** Zależności typu `react`, `electron`, kod DOM.

#### SA-102 — Kontrakty systemowe (§3 roadmap)

- **Status:** UKOŃCZONE
- **Cel:** Skrupulatna definicja typów w TypeScript, z uwzględnieniem niemutowalności.
- **Pliki dozwolone:** `packages/signal-core/src/common/contracts.ts`, `packages/signal-core/src/common/index.ts`, `packages/signal-core/src/common/contracts.spec.ts`.
- **Wymagania implementacyjne:**
  - Wprowadzić słowa kluczowe `readonly` we wszystkich zdefiniowanych strukturach, gwarantując niezmienność na etapie kompilatora (np. `readonly startTimeNs: bigint;`).
  - Rozważyć użycie tzw. "Branded Types" dla unikalnych identyfikatorów (`type DecoderId = string & { readonly _brand: unique symbol };`), zwiększających bezpieczeństwo.
- **Definition of Done:** Interfejsy ściśle egzekwują wzorce z dokumentacji.
- **Weryfikacja:** Narzędzia statyczne TypeScript, brak błędów.
- **Zakazane:** Stosowanie typu `any`.

#### SA-103 — `RingSampleStore` + `ChunkedIntervalTree`

- **Status:** UKOŃCZONE
- **Cel:** Wydajny dostęp swobodny (random access) w czasie $O(1)$ i wyszukiwanie zakresowe (interval search) w $O(\log N + K)$ uwzględniające optymalizację cache (Cache Locality).
- **Pliki dozwolone:** `packages/signal-core/src/common/ring-sample-store.ts`, `packages/signal-core/src/common/chunked-interval-tree.ts`, testy.
- **Wymagania implementacyjne:**
  - Rozkład pamięci: W ostateczności `RingSampleStore` musi przechowywać dane w płaskiej strukturze liniowej typu `SharedArrayBuffer` lub zestawu połączonych `ArrayBuffer` z zarządzaną przez siebie paginacją.
  - `ChunkedIntervalTree`: rozbicie drzewa przedziałów na bloki (np. po 1024 elementy) wewnątrz każdego chunk, by uniknąć fragmentacji pamięci i pogorszenia się rozrzutu na stercie w V8.
- **Definition of Done:** Benchmarki (jest to wymóg DOD) dla metody wyszukiwania muszą osiągać opóźnienia bliskie zeru niezależnie od obecności 10 milionów węzłów.
- **Weryfikacja:** Wykonywanie polecenia testowego z analizą czasu operacji (przy użyciu `performance.now()`).
- **Zakazane:** Zwykła implementacja drzewa binarnego przydzielającego nowe obiekty JS per przedział.

#### SA-104 — Model sesji i kanałów (`CaptureSession`, State Machine)

- **Status:** UKOŃCZONE
- **Cel:** Solidne i stabilne zarządzanie cyklem życia (lifecycle) przechwytywania.
- **Pliki dozwolone:** `packages/signal-core/src/common/capture-session.ts`, `packages/signal-core/src/common/signal-channel.ts`, testy.
- **Wymagania implementacyjne:**
  - Implementacja wzorca State Machine (Maszyna Stanów) z przejściami: `STOPPED` -> `CAPTURING` -> `PAUSED` -> `STOPPED`. Niedozwolone przejścia rzucają wyrazisty `InvalidStateException`.
  - Posiadanie tzw. "debounce" na emiterach globalnych zdarzeń sesji, ograniczając lawinowe notyfikacje o zmianach.
- **Definition of Done:** Kod testowy przechodzi przez wszystkie dozwolone ścieżki stanów, a próby nielegalnych zmian są skutecznie blokowane.
- **Weryfikacja:** 100% Code Coverage dla modułu stanu.
- **Zakazane:** Manipulowanie polem stanu wewnątrz klas z zewnątrz bez przechodzenia przez kontroler stanów.

#### SA-105 — Migracja `@theia/can-bus` na kontrakty `signal-core`

- **Status:** UKOŃCZONE
- **Cel:** Połączenie obu modułów poprzez Wzorzec Adaptera, minimalizujące wstrząsy.
- **Pliki dozwolone:** `packages/can-bus/package.json`, `packages/can-bus/src/node/can-socket-service.ts`, `packages/can-bus/src/browser/can-widget.ts`.
- **Wymagania implementacyjne:**
  - Usunięcie starych definicji i utworzenie Adapterów zamieniających strumień `SampleBlock` w formacie bit-packed spowrotem na potrzeby dotychczasowego widgetu do czasu jego wymiany.
- **Definition of Done:** Stary widget w przeglądarce działa jak przed migracją, korzystając już z nowych bloków pod spodem.
- **Weryfikacja:** Testy regresyjne.
- **Zakazane:** Użycie polecenia `@ts-ignore` w celu obejścia różnicy starych i nowych kontraktów interfejsu.

#### SA-106 — Dokumentacja `signal-core`

- **Status:** UKOŃCZONE
- **Cel:** Dokumentacja wygenerowana na podstawie solidnych opisów JSDoc oraz plik Markdown architektury.
- **Pliki dozwolone:** `doc/signal-analyzer/signal-core.md`, komentarze JSDoc w kodzie.
- **Wymagania implementacyjne:**
  - Wyjaśnić precyzyjnie w `signal-core.md`, dlaczego i w jakich przypadkach stosowane są typy generyczne na kanałach, a także zilustrować wzorzec zarządzania pamięcią bufora.
- **Definition of Done:** Wysoce profesjonalny i czytelny przewodnik techniczny gotowy do publikacji zewnętrznej.
- **Zakazane:** Generowanie dokumentacji polegającej wyłącznie na autogenerowanym tekście bez opisów koncepcyjnych.

---

### Faza 2 — Decode DAG Engine + drugi protokół (P0)

#### SA-201 — Silnik dekodowania `DecoderRegistry` + Topological Sort

- **Status:** UKOŃCZONE
- **Cel:** Orchestracja dekodowania spełniająca wymogi minimalnej złożoności $O(V+E)$.
- **Pliki dozwolone:** `packages/signal-core/src/common/decoder-registry.ts`, `packages/signal-core/src/common/decoder-dag.ts`, testy.
- **Wymagania implementacyjne:**
  - Wdrożenie ścisłego Algorytmu Kahna do sortowania topologicznego wierzchołków dekoderów. Algorytm ten jest wymogiem i gwarantuje stabilność złożoności dla wykrywania cykli.
  - Zastosowanie wzorca Obserwatora pozwalającego na dynamiczną re-ewaluację potoku po zarejestrowaniu nowego dekodera (Pluginu), generującego nowy DAG.
- **Definition of Done:** 100 węzłów (dekoderów) w DAG poprawnie i błyskawicznie rozwiązuje swoje kolejności, bez awarii stosu (stack overflow).
- **Weryfikacja:** Dynamiczne dodawanie wtyczek do grafu i weryfikacja wyrzucanego wyniku.
- **Zakazane:** Używanie głębokich funkcji rekurencyjnych (zamiast iteracji w Kahnie), które przy potężnych DAG mogą wyczerpać stos w JS.

#### SA-202 — Decode-on-demand w WebWorkerze + SAB

- **Status:** UKOŃCZONE
- **Cel:** Bezpieczne i ekstremalnie szybkie przetwarzanie na uboczu bez ryzyka zjawiska wyścigu (race conditions).
- **Pliki dozwolone:** `packages/signal-core/src/browser/worker/decoder-worker.ts`, `packages/signal-core/src/browser/worker-decoder-engine.ts`.
- **Wymagania implementacyjne:**
  - Optymalizacja narzutu serializacji komend `postMessage`.
  - Zarządzanie cyklem życia workera, aby zapobiec „Zombie Workers” (zabicie procesu potomnego po zamknięciu sesji `terminate()`).
  - Jeśli SharedArrayBuffer jest wspierany (COOP/COEP headers są wymagane w aplikacji bazowej w produkcji), wdraża wzorzec Atomics do synchronizacji blokad; jako fallback używa Transferable Objects (oddanie praw własności z głównego wątku do workera, aby zyskać na wydajności kopiowania, uwaga na unieważnienie obiektu powracającego).
- **Definition of Done:** Skuteczne przekazywanie obciążenia procesora, gładkie skalowanie viewportu okna z obciążeniem asynchronicznym.
- **Weryfikacja:** Profilowanie na wykresach osi czasu Theia i upewnienie się, że `Self Time` w Main Thread dla zadań dekodowania zredukowało się do <1%.
- **Zakazane:** Blokowanie głównego wątku pętlą obarczoną backpressure zwrotnym (brak limitu komunikatów workera wrzucanych na kolejkę główną).

#### SA-203 — GAP/RESYNC first-class + Circuit Breaker dekoderów

- **Status:** UKOŃCZONE
- **Cel:** Wdrożenie odporności na błędy (Resiliency) dla potoków przetwarzania bez globalnego przerwania pracy.
- **Pliki dozwolone:** `packages/signal-core/src/common/annotation-validator.ts`, `packages/signal-core/src/common/decoder-circuit-breaker.ts`, testy.
- **Wymagania implementacyjne:**
  - Implementacja stanów Half-Open, Open, Closed. Jeśli błędy dekodera trwają, przełącz na `Open` (Trip). Po upływie timeoutu, wypróbuj `Half-Open` wysyłając niewielką partię okna.
  - Generowanie precyzyjnie adnotacji błędu zawierających przyczynę (stack trace limitowany z powodu pamięci), po to aby użytkownik analizatora natychmiast otrzymał zwrotny feedback w wizualizacji (na osi).
- **Definition of Done:** Stabilny silnik potrafiący wyzdrowieć po błędzie formatu trzeciego dekodera bez zniszczenia adnotacji produkowanej przez podstawowy dekoder w DAG.
- **Weryfikacja:** Test z usterką.
- **Zakazane:** Ignorowanie (swallowing) wyjątków; nielimitowane akumulowanie logów błędów w konsoli powodujące spadki płynności.

#### SA-204 — Dekoder CAN jako `DecoderProvider`

- **Status:** UKOŃCZONE
- **Cel:** Transformacja do bezstanowej lub hermetycznie-stanowej (wspierającej generatory) logiki dekodera protokołu z użyciem operacji BigInt na polach 64-bitowych ramek.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-decoder-provider.ts`, testy.
- **Wymagania implementacyjne:**
  - Ze względu na zaawansowany payload (do 8 bajtów = 64 bity dla standardu, więcej w FD), ostrożne zarządzanie bitem shift (`<<`, `>>`) wymusza konsekwentne stosowanie BigInt bądź obsługi DataView.
  - Dekoder jako iterator asynchroniczny reagujący na sygnały wstrzymania (pause).
- **Definition of Done:** Przekształcenie wejścia bit-packed na ustandaryzowaną adnotację z uwzględnieniem poprawności bitów sterujących (IDE, RTR).
- **Weryfikacja:** Testy z surowymi pakietami HEX i sprawdzaniem oczekiwanego formatu wyjścia.
- **Zakazane:** Alokowanie dziesiątek zagnieżdżonych struktur mapowych na każdą odczytaną iterację ramki.

#### SA-205 — Dekoder UART (weryfikacja kontraktu na 2. protokole)

- **Status:** UKOŃCZONE
- **Cel:** Proof-of-concept dla sygnałów na wejściu cyfrowym.
- **Pliki dozwolone:** `packages/signal-core/src/common/decoders/uart-decoder-provider.ts`, testy.
- **Wymagania implementacyjne:**
  - Logika detekcji bitu startowego na bazie próbkowania (Oversampling) sygnału np. na połówce szerokości bitu.
  - Wyliczanie synchronizacji czasowej względem predefiniowanego Baud Rate (przesunięcia w oparciu o różnicę `startTimeNs` i `sampleRate`).
- **Definition of Done:** Wyświetla przetłumaczone znaki ASCII dla poprawnych przebiegów czasowych pinów TX/RX.
- **Weryfikacja:** Przeprowadzenie analizy na wirtualnych przebiegach cyfrowych reprezentujących znak np. 'A' (hex 0x41) dla UART 8N1.
- **Zakazane:** Brak walidacji bitu stopu (brak wykrywania błędu ramkowania `Framing Error`).

#### SA-206 — Dokumentacja techniczna dla Fazy 2

- **Status:** UKOŃCZONE
- **Cel:** Przewodnik dla programistów zewnętrznych (Third Party) i wewnętrznych.
- **Pliki dozwolone:** `doc/signal-analyzer/decoders.md`, `doc/signal-analyzer/README.md`.
- **Wymagania implementacyjne:**
  - Wymagane użycie bloków kodowych w Markdown dokumentujących szablon i zachowanie dekodera pod kątem kontraktu Generatorów, uwzględniając diagram klas w Mermaid.
- **Definition of Done:** Jasny poradnik krok po kroku.

#### SA-207 — Lekki harness regresyjny dekoderów (CAN + UART, golden trace)

- **Status:** DO ZROBIENIA
- **Cel:** Natychmiastowa ochrona przed regresją logiki dekoderów CAN i UART zaraz po zamrożeniu kontraktu (SA-205), zanim powstanie pełny `DecoderTestHarness` (SA-505, Faza 5). Zadanie dodane decyzją właściciela po sesji planistycznej (patrz §4a).
- **Pliki dozwolone:** `packages/signal-core/src/common/test-harness/golden-trace-runner.ts` (nowy), `packages/can-bus/src/common/__tests__/can-decoder.golden.spec.ts`, `packages/signal-core/src/common/decoders/__tests__/uart-decoder.golden.spec.ts`, zasoby `test-resources/signal-analyzer/golden-traces/{can,uart}/`.
- **Wymagania implementacyjne:**
  - Zapisać dla dekodera CAN (SA-204) i UART (SA-205) minimum 3 surowe przebiegi wejściowe wraz z oczekiwaną, zserializowaną listą `ProtocolAnnotation` jako zasoby "golden trace" w `test-resources/`.
  - Test porównuje wygenerowane adnotacje ze wzorcem pole po polu (bez hashowania kryptograficznego ani hooka CI — to zakres SA-505).
  - Uruchamiane przez istniejący `npm run test` (Mocha) danego pakietu, bez nowego runnera.
- **Definition of Done:** Świadomie wprowadzona regresja (np. błędny offset bitu w dekoderze UART) powoduje czerwony test z czytelnym diffem pól adnotacji.
- **Weryfikacja:** `npx lerna run test --scope @theia/can-bus`, `npx lerna run test --scope @theia/signal-core`.
- **Zakazane:** Duplikowanie architektury `DecoderTestHarness` z SA-505 (bez generatora CLI, hashowania ani hooków CI) — to zadanie ma pozostać minimalne; pełna wersja powstaje w SA-505.

---

### Faza 3 — Wizualizacja (P1)

#### SA-301 — Pakiet `@theia/signal-ui` i `ViewportController`

- **Status:** DO ZROBIENIA
- **Cel:** Centralny koordynator widoku z zaawansowanym throttlingiem i obustronnym wiązaniem danych.
- **Pliki dozwolone:** `packages/signal-ui/package.json`, `packages/signal-ui/tsconfig.json`, `packages/signal-ui/src/browser/viewport-controller.ts`, `packages/signal-ui/src/browser/index.ts`.
- **Wymagania implementacyjne:**
  - Ochrona przed cyklicznymi nieskończonymi wywołaniami zdarzeń (infinite event loops) podczas np. wzajemnego powiadamiania się okien o przesunięciu `cursorTimeNs`.
  - Integracja `ResizeObserver` z debounce dla responsywności UI okien podrzędnych względem krawędzi kontrolera.
- **Definition of Done:** Natychmiastowa reakcja i synchronizacja 3 różnych widżetów wyświetlających te same osie czasowe.
- **Zakazane:** Użycie wzorca globalnych Singletonów (bez kontekstu DI Kontenera Theia), które łamałyby funkcjonowanie na poziomie wielu przestrzeni roboczych (multi-workspace/multi-window).

#### SA-302 — WebGL Waveform Renderer z Min-Max LOD

- **Status:** DO ZROBIENIA
- **Cel:** Rendering akcelerowany z potężnymi możliwościami przy skrajnych zagęszczeniach pikseli i utratach kontekstu.
- **Pliki dozwolone:** `packages/signal-ui/src/browser/waveform/webgl-waveform-renderer.ts`, `packages/signal-ui/src/browser/waveform/min-max-lod.ts`, `packages/signal-ui/src/browser/waveform/canvas2d-fallback.ts`.
- **Wymagania implementacyjne:**
  - Implementacja buforowania dla utraty kontekstu: nasłuchiwanie zdarzeń `webglcontextlost` i `webglcontextrestored`, zapewniające płynną reinstalację buforów wierzchołków i shaderów bez usterki dla użytkownika, w przypadku przełączenia GPU, trybu uśpienia urządzenia czy odłączenia ekranu zewnętrznego.
  - Wykorzystanie techniki renderowania instancjonowanego (Instanced Rendering) dla wskaźników zjawisk i adnotacji (by uniknąć tysięcy draw calls).
- **Definition of Done:** Środowisko radzi sobie z wyświetleniem 20 sygnałów o milionach próbek na zoomie "Wszystko", podsumowując zakres LOD jako szary blok (poziom najniższych i najwyższych wychyleń na piksel w $O(1)$) bez zamrożenia karty przeglądarki.
- **Weryfikacja:** Profiling WebGL Draw Calls w narzędziu przeglądarki.
- **Zakazane:** Konstrukcja shaderów w JS w sposób generujący zjawiska injection oraz utrata wszystkich wykresów po wybudzeniu systemu ze snu (brak odzysku utraconego kontekstu GL).

#### SA-303 — Hex / ASCII / Bit View z nakładką adnotacji

- **Status:** DO ZROBIENIA
- **Cel:** Precyzyjny silnik renderowania surowej tabeli heksadecymalnej w sposób oszczędny względem DOM.
- **Pliki dozwolone:** `packages/signal-ui/src/browser/hexview/hex-widget.ts`, `packages/signal-ui/src/browser/hexview/annotation-overlay.ts`.
- **Wymagania implementacyjne:**
  - Zastosowanie natywnego API `IntersectionObserver` do leniwego renderowania (lazy rendering) fragmentów tabeli bitów, niewidocznych na ekranie, optymalizując do granic możliwości obciążenie CSS Paint i warstw Composite.
  - Overlay adnotacji renderowany jako absolutnie pozycjonowany nałożony obszar, aby nie komplikować natywnej pętli układu tabeli (Table Layout).
- **Definition of Done:** Możliwość szybkiego scrollowania 100MB pliku (widok bazy HEX) z nakładającymi się w pełni warstwami kolorów.

#### SA-304 — Wirtualizowana Tabela Protokołów

- **Status:** DO ZROBIENIA
- **Cel:** Elastyczne wyświetlanie gigantycznych wolumenów (Miliony rzędów), obsługujące dynamiczne wysokości zawartości ładunku tekstu i Auto-Scroll.
- **Pliki dozwolone:** `packages/signal-ui/src/browser/protocol-table/protocol-table-widget.ts`, `packages/signal-ui/src/browser/protocol-table/table-virtualizer.ts`.
- **Wymagania implementacyjne:**
  - Optymalizacja wyliczania dynamicznych wysokości (Dynamic Row Heights) dla złożonych, rozwiniętych adnotacji z ładunkiem obiektu JSON. Wykorzystanie cache offsetów do zmniejszenia kosztu algorytmu pomiaru wirtualizacji.
  - Tryb "Tail/Follow": Jeśli kursor jest przyklejony do dolnej osi w trakcie odczytu rzeczywistego (Live), wymuszać automatyczny przewijak ze spowalnianiem dla wyższych częstotliwości, aby dało się odczytać dane okiem (tzw. paczkowanie).
  - Źródło danych adnotacji na start: liniowe/naiwne przeszukiwanie bufora viewportu (SA-202 i tak ogranicza dane do okna widoku + 20% marginesu) pod kontraktem `AnnotationQuery`. Decyzja właściciela (patrz §4a): SA-402 (Faza 4) podmieni silnik na `AnnotationIndex` bez zmiany API tabeli — implementować przez interfejs, nie przez bezpośrednie odwołanie do struktury bufora.
- **Definition of Done:** Przewijanie suwakiem 500k rzędów działa płynnie (bez "przeskakiwania") - bufor krawędziowy kompensuje render przedwczesny. Benchmark naiwnego przeszukiwania viewportu < 50 ms na realistyczne okno (inaczej: eskalacja do supervisora, patrz §4a).
- **Zakazane:** Pełne ponowne obliczanie offsetów dla całej tabeli od index 0 do miliona w przypadku zmiany widoczności jednego elementu.

#### SA-305 — Filtrowanie i kolorowanie wierszy

- **Status:** DO ZROBIENIA
- **Cel:** Bezpieczne mechanizmy filtrowania i RegEx w izolacji, chroniące wątek tabelaryczny.
- **Pliki dozwolone:** `packages/signal-ui/src/browser/protocol-table/table-filter-panel.ts`, `packages/signal-ui/src/browser/protocol-table/color-rules.ts`.
- **Wymagania implementacyjne:**
  - Wszystkie wyrażenia filtrowania operujące na olbrzymim wolumenie tabelarycznym MUSZĄ być delegowane do workera przeglądarki. Wątek główny odbiera zwrotnie tylko mapę widoczności i id rekordów.
  - Ewaluator uodporniony na ReDoS (Regular expression Denial of Service) ze strzeżonym czasem wykonywania (timeout guard).
- **Definition of Done:** Nawet bardzo złożone regex na potężnej tabeli nie blokują wizualizacji kursora, a filtrowane wiersze pojawiają się asynchronicznie natychmiast po przetworzeniu.
- **Zakazane:** Stosowanie blokującego metody filtrującej `Array.prototype.filter()` w trybie synchronicznym (Main Thread) dla baz wielomilionowych.

---

### Faza 4 — Semantyka i operacje (P1)

#### SA-401 — Słowniki `.dbc` jako `DecoderProvider`

- **Status:** DO ZROBIENIA
- **Cel:** Kompletny parser metadanych CAN zdolny do obsługi standardów branżowych, uwzględniający operacje nieliniowe multipleksowane.
- **Pliki dozwolone:** `packages/can-bus/src/common/dbc-parser.ts`, `packages/can-bus/src/common/dbc-decoder-provider.ts`, testy.
- **Wymagania implementacyjne:**
  - Przestrzeganie specyfikacji ułożenia Little Endian (Intel) i Big Endian (Motorola) podczas demultipleksacji. Rozszerzenie o obsługę Multiplekserów (zmiana znaczenia sygnału w zależności od wartości innego sygnału - standard motoryzacyjny).
  - Skuteczne radzenie sobie z konwersją formatów typów zmiennoprzecinkowych przy dekodowaniu z narzutem czynnika Scale i Offset na precyzjach dziesiętnych.
- **Definition of Done:** Pokrywa w 100% testy na bazie wzorca J1939 lub innego popularnego modelu słownikowego `dbc` wraz z poprawnym tłumaczeniem (prędkość, obroty koła na minute, itp).

#### SA-402 — `AnnotationIndex` (Inverted Index) + Wyszukiwarka `AnnotationQuery`

- **Status:** DO ZROBIENIA
- **Cel:** Własna baza indeksowania dopasowana do natury sygnałów i struktury czasowo-tekstowej, gwarantująca $O(1)$ dla stałych szukanych kluczy tekstowych.
- **Pliki dozwolone:** `packages/signal-core/src/common/annotation-index.ts`, `packages/signal-core/src/common/annotation-query-engine.ts`, testy.
- **Wymagania implementacyjne:**
  - Budowa zoptymalizowanego Suffix Tree (Drzewa Sufiksowego) lub Trie dla błyskawicznego predykcyjnego wyszukiwania przedrostków tekstu i symboli atrybutów.
  - Wysoce zagęszczone struktury mapowania ID -> znacznik czasowy uwzględniające ograniczenia Garbage Collectora na stercie (heap limitations).
- **Definition of Done:** Możliwość wyszukiwania na bieżąco w polu "Znajdź" (debounce 100ms) ze sprawnym podświetlaniem wyników w potężnym buforze miliona obiektów.

#### SA-403 — Mechanizm Undo/Redo (`SessionCommand`)

- **Status:** DO ZROBIENIA
- **Cel:** Izolacja komend stanu sesji i ograniczenie użycia zasobów bez konieczności całkowitego kopiiowania stanu wielkich tablic.
- **Pliki dozwolone:** `packages/signal-core/src/common/undo-redo-manager.ts`, `packages/signal-core/src/common/session-command.ts`.
- **Wymagania implementacyjne:**
  - Ściśle określony i dający się modyfikować Memory Limit dla Historii Cofania (np. maks. 50 poleceń lub określony ułamek megabajtów). Najstarsze mutacje są zwalniane do czyszczenia (ring buffer dla poleceń).
  - Podejście Delta (przechowywanie tyko przyrostu zmutowanych bloków parametrów dekodera/stanu i ich odwrotności do rekonstrukcji) zamiast wzorca migawki Deep Copy pełnej konfiguracji całego systemu.
- **Definition of Done:** Testowa sekwencja 10 zmian offsetu czasu, odłączeń kanału i zmian zoom, dająca się płynnie i bezbłędnie przeskoczyć w przód i tył.
- **Zakazane:** Tworzenie głębokich klonów `JSON.parse(JSON.stringify())` z wielkimi strukturami danych z logiką powrotu do przeszłości.

#### SA-404 — Eksport / Import danych (CSV, JSON, VCD)

- **Status:** DO ZROBIENIA
- **Cel:** Solidna, strumieniowa kompatybilność z ekosystemami pobocznymi wspierana poprzez Backpressure Node.js API (Drain).
- **Pliki dozwolone:** `packages/signal-core/src/common/export-import-service.ts`, `packages/signal-core/src/node/file-serializer.ts`.
- **Wymagania implementacyjne:**
  - Użycie interfejsów Strumieniowych Transform (Node.js Streams / Web Streams API z uwzględnieniem kompatybilności przeglądarkowej z systemem plików lokalnym i FileSystem Access API).
  - Obserwowanie zdarzeń buforu `drain` przy odczycie/zapisie gigabajtowych logów, eliminacja dławienia pamięci głównej. Złożoność zużycia RAMu równa stałej $O(1)$.
- **Definition of Done:** Proces generacji 5 GB pliku wyjścia CSV oraz jego odczyt nie podnosi bazowego RAM procesu (Heap) wyżej niż przydzielone okno buforowe.

#### SA-405 — Wirtualne kanały matematyczne (`VirtualChannel`)

- **Status:** DO ZROBIENIA
- **Cel:** Bezpieczne i wydajne przeliczanie wyrażeń w obrębie silnika parsera abstrakcyjnego drzewa składniowego (AST).
- **Pliki dozwolone:** `packages/signal-core/src/common/virtual-channel-evaluator.ts`, `packages/signal-core/src/common/virtual-channel.ts`.
- **Wymagania implementacyjne:**
  - Użycie certyfikowanego i bezpiecznego parsera AST dla interpretacji wzorów matematycznych. Usunięcie jakiejkolwiek możliwości podpięcia nieskończonych pętli przez wyrażenia (`no loops allowed in AST mapping`).
  - Cache'owanie wyliczonych (zmemoizowanych) partii buforów, dopóki sygnały bazowe przed wyrażeniem nie zmutują.
- **Definition of Done:** Obliczanie i nakładanie na wizualizację nowego kanału operującego na jitterze różnicowym dwóch głównych (C1 - C2), podążającym na żywo, dające identyczny wynik wzorcowy, testy przeciw błędnej składni i wyciekom.
- **Zakazane:** Stosowanie eval() i funkcji globalnego wykonawcy bez piaskownicy.

#### SA-406 — Nadawanie CAN, logowanie i odtwarzanie (Replay Mode)

- **Status:** DO ZROBIENIA
- **Zależności:** SA-409 i SA-410 `AKCEPTACJA`; zaakceptowane SA-002 i SA-105.
- **Cel:** niskopoziomowe TX Classical CAN/CAN FD, logowanie i replay z gwarancją zachowania proporcjonalnych odstępów czasowych oraz egzekwowaniem polityki SA-410.
- **Pliki dozwolone:** `packages/can-bus/src/node/can-recorder-service.ts`, `packages/can-bus/src/node/can-player-service.ts`, nowy `packages/can-bus/src/node/can-transmit-service.ts`, istniejące `can-socket-service.ts`/`can-rpc-service.ts` i ich testy wyłącznie w zakresie TX, `packages/can-bus/src/common/can-protocol.ts`.
- **Wymagania implementacyjne:**
  - Jedno walidowane API nadania dla standard/extended, Classical CAN/CAN FD, z lokalnymi statusami queued/sent/driver-echo/error i bez przedstawiania echo jako ACK urządzenia.
  - Każda ścieżka manual/send/replay podlega stanowi `ARM`, allowliście, limitom i priorytetowemu `STOP` z SA-410; RPC ani replay nie mogą ominąć policy gate.
  - Jawna diagnostyka braku ACK/error-passive/bus-off; opcjonalny ACK helper wymaga drugiego fizycznego interfejsu i osobnej capability. Recovery po bus-off ma cooldown, kontrolę stanu i ponowne uzbrojenie zamiast bezwarunkowej pętli restartów.
  - Silnik odtwarzania wdrożony jako mikrokontroler czasowy: nie polega na ogólnym `setTimeout` w węzłach pętli puszczonych luzem, lecz na pętli kompensującej nanosekundowy dryf systemowego ticku procesora.
  - Rozróżnianie logowania biernego (sniffing/Promiscuous mode) oraz czynnego z asercją logowania parametrów sprzętowych magistrali (np. Acknowledge, nakładanie się ramek przy próbie jednoczesnego zapisu).
- **Definition of Done:** testy vcan/symulatora potwierdzają walidację i kolejność; ślad na hardware mierzony analizatorem stanów logicznych potwierdza stabilność timingów z dopuszczalnym dryfem nie większym niż ułamek milisekundy od logów VCD odniesienia; bus-off, błąd adaptera i `STOP` kończą TX bez obejścia przez replay.

---

### Faza 4A — CAN Device Lab: nadajnik i inżynieria urządzeń (AKTYWNA, P0/P1)

Faza realizuje decyzję właściciela z 2026-08-28. Szczegółowy workflow i algorytmy opisuje `doc/signal-analyzer/can-device-lab.md`. Pierwszy vertical slice kończy się na SA-414; SA-415+ nie blokują sprawdzenia wybudzania E2E.

#### SA-409 — Deterministyczny symulator śpiącego DUT

- **Status:** DO ZROBIENIA
- **Zależności:** SA-002 i SA-105 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/node/can-device-lab-simulator.ts`, `packages/can-bus/src/common/can-device-lab-fixture.ts`, fixtures i testy; bez zmian kontraktów SA-410.
- **Cel:** dostarczyć wirtualne urządzenie, które zasypia i reaguje na pojedynczą ramkę, sekwencję, keep-alive, bit kontrolki, pole liczbowe oraz raw/ISO-TP text.
- **Wymagania:** konfigurowalne opóźnienie/jitter, power-cycle, seed, spontaniczne RX, fałszywy sygnał, ON/OFF i error injection; deterministyczny zegar testowy; brak zależności od UI.
- **Definition of Done:** fixture działa na wirtualnym CAN/symulowanym adapterze w CI, a ten sam seed daje identyczne RX/state. SA-409 może być realizowane równolegle z SA-410 i staje się wspólną bazą testów SA-406/SA-411…SA-424.

#### SA-410 — Kontrakty aktywnej sesji CAN i bezpieczeństwo stołowe

- **Status:** DO ZROBIENIA
- **Zależności:** SA-002 i SA-105 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-experiment-protocol.ts`, `packages/can-bus/src/common/can-experiment-event-bus.ts`, `packages/can-bus/src/common/can-safety-policy.ts`, `packages/can-bus/src/common/index.ts`, odpowiadające testy.
- **Cel:** zdefiniować `CanExperimentSession`, stany `DISARMED…FAULT`, capabilities adaptera, allowlistę ID, limity FPS/bus-load/czasu, powody auto-stop, contribution points i append-only model zdarzeń TX/RX/feedback/state.
- **Wymagania:** zmiana interfejsu/profilu rozbraja sesję; remote/error frames i ryzykowne usługi diagnostyczne są zabronione domyślnie; czas monotoniczny jest obowiązkowy; lokalne echo nie jest ACK urządzenia; feedback provider i importer nie mają capability TX; UI nie zawiera schedulera ani korelacji.
- **Definition of Done:** testy kontraktu i maszyny stanów dowodzą, że bez `ARM` nie powstaje zlecenie TX, wszystkie limity fail-closed, a `STOP` ma pierwszeństwo przed kolejką danych. Kontrakt przechodzi rewizję supervisora przed implementacją TX.

#### SA-411 — Silnik kampanii i bank ramek wybudzających

- **Status:** DO ZROBIENIA
- **Zależności:** SA-406 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-campaign.ts`, `packages/can-bus/src/node/can-campaign-engine.ts`, `packages/can-bus/src/browser/can-device-lab-widget.ts`, `packages/can-bus/src/browser/can-device-lab-view-contribution.ts`, moduły DI i testy w zakresie tej funkcji.
- **Cel:** realizować kampanie po observed IDs, allowliście, jawnym range lub profilu z małym bankiem `00`, `FF`, `AA`, `55`, `7F` i opcjonalnym `80`/rampą bajtów.
- **Wymagania:** jawne DLC/11/29-bit/CAN FD; domyślne wykluczenie ID aktywnych w baseline RX; bloki ID z pauzą feedbacku; konfigurowalne repeat/delay/dwell; ETA/FPS/bus-load przed `ARM`; brak randomu i arbitralnych magicznych payloadów w presetach domyślnych; deadline nie jest nadrabiany nieograniczonym burstem.
- **Definition of Done:** deterministyczna kampania na vcan/symulatorze emituje dokładnie oczekiwaną kolejność i timing, respektuje limit obciążenia i zatrzymuje się po `STOP`, bus-off lub błędzie adaptera.

#### SA-412 — Feedback manualny i automatyczny RX-delta

- **Status:** DO ZROBIENIA
- **Zależności:** SA-411 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-feedback.ts`, `packages/can-bus/src/browser/can-feedback-panel.ts`, `packages/can-bus/src/node/can-feedback-service.ts`, testy.
- **Cel:** rejestrować `POSITIVE/NEGATIVE/UNCERTAIN`, typ, confidence i monotoniczny timestamp oraz automatycznie wykrywać względem baseline nowe ID, zmianę częstotliwości i istotną zmianę payloadu RX.
- **Wymagania:** skróty klawiaturowe nie mogą kolidować z `STOP`; local echo/własny TX jest wykluczony z RX-delta; zdarzenie trafia do tego samego journalu co TX/RX; provider nie może ominąć polityki bezpieczeństwa ani wysłać ramki.
- **Definition of Done:** test z kontrolowanym zegarem przypisuje feedback do właściwej sesji i czasu także przy opóźnionym UI; symulator budzi się i emituje nowe ID wykrywane bez przycisku człowieka; local echo i naturalny baseline nie dają trafienia.

#### SA-422 — Zewnętrzne feedback providers: SCPI/serial, GPIO, audio i vision

- **Status:** DO ZROBIENIA
- **Zależności:** SA-412 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-feedback-provider.ts`, `packages/can-bus/src/node/can-scpi-feedback-provider.ts`, `packages/can-bus/src/node/can-gpio-feedback-provider.ts`, plugin fixtures/mocks i testy; audio/vision jako contribution API i backlog adapterów.
- **Cel:** dołączyć sensory przez wspólny contribution point, w szczególności surowy pomiar napięcia/prądu i próg `ΔI` z profilu zasilacza laboratoryjnego.
- **Wymagania:** adapter komend per urządzenie zamiast założenia jednego dialektu SCPI; provider publikuje raw sample i feedback z monotonicznym czasem, ma reconnect/backpressure i nigdy nie posiada capability TX.
- **Definition of Done:** mock SCPI/serial i GPIO generują zsynchronizowany feedback, disconnect nie zatrzymuje kampanii ani nie tworzy fałszywego pozytywu, a nieznany zasilacz failuje jawnie. Audio/vision mogą zostać dodane bez zmiany kontraktu korelacji.

#### SA-413 — Okno przyczynowe i ranking kandydatów

- **Status:** DO ZROBIENIA
- **Zależności:** SA-412 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-candidate-ranker.ts`, `packages/can-bus/src/browser/can-candidate-panel.ts`, testy i benchmark.
- **Cel:** budować kandydatów z `[feedbackTime-maxLatency, feedbackTime-minLatency]` i ranking ramek/sekwencji na podstawie odległości czasowej, prób pozytywnych/negatywnych/sham, typu i niezależności źródła oraz powtarzalności.
- **Wymagania:** kalibracja czasu reakcji operatora proponuje okno bez stałej zaszytej w kodzie; top 10–20 jest tylko limitem prezentacji; pełny zbiór dowodów zostaje w journalu. Wynik pokazuje liczby prób i niepewność.
- **Definition of Done:** golden timeline z różnymi prędkościami TX wskazuje ten sam logiczny zestaw kandydatów; 1 mln zdarzeń jest przetwarzane strumieniowo/indeksowo bez blokowania głównego wątku.

#### SA-414 — Adaptacyjne identify, dual, omission i minimalizacja sekwencji

- **Status:** DO ZROBIENIA
- **Zależności:** SA-413 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-adaptive-identify.ts`, `packages/can-bus/src/node/can-adaptive-replay.ts`, `packages/can-bus/src/browser/can-identify-panel.ts`, testy.
- **Cel:** wolniej powtarzać okno, dzielić kandydatów A/B, wykonywać seeded shuffle/slow-single i sham dla pojedynczych ramek, obsługiwać ON/OFF, omission, minimalizację sekwencji oraz strojenie okresu keep-alive bisekcją.
- **Wymagania:** algorytm nie zakłada pojedynczej ramki; shuffle jest zabroniony w trybie sekwencji; każda iteracja ma reset/baseline i limit prób; po braku efektu w obu połówkach przechodzi do hipotezy sekwencji zamiast arbitralnie odrzucać dane.
- **Definition of Done:** fixture zawiera osobno pojedynczą ramkę, opóźnioną reakcję, fałszywy sygnał, trwały stan ON/OFF, wymagany keep-alive i dwuramkową sekwencję. Wszystkie są zawężane do prawidłowego minimum; keep-alive ma zmierzony okres graniczny i roboczy margines. To bramka pierwszego vertical slice.

#### SA-415 — Odkrywanie opcji binarnych

- **Status:** DO ZROBIENIA
- **Zależności:** SA-414 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-bit-discovery.ts`, `packages/can-bus/src/browser/can-bit-discovery-panel.ts`, testy.
- **Cel:** mutować pojedynczy bit względem znanego baseline, walking-one/walking-zero, ograniczony licznik binarny pola, maski bitów stałych/badanych i opcjonalne małe kombinacje.
- **Wymagania:** po każdej próbie jawny baseline/reset; bit ma mapę feedbacku, stan aktywny, confidence i zależności; random jest osobnym trybem z limitem maski i liczby prób.
- **Definition of Done:** symulator licznika z kilkoma kontrolkami daje poprawną mapę bitów bez zmian w polach nieobjętych maską; opóźniony feedback nadal koreluje się poprawnie.

#### SA-416 — Odkrywanie pól liczbowych i tekstowych

- **Status:** DO ZROBIENIA
- **Zależności:** SA-414 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-field-discovery.ts`, `packages/can-bus/src/common/can-text-payload.ts`, `packages/can-bus/src/browser/can-field-discovery-panel.ts`, testy.
- **Cel:** bounded sweep/ramp dla hipotez szerokości, signed/unsigned i endianowości oraz bezpieczne próby ASCII/UTF-8 i wieloramkowego tekstu ISO-TP.
- **Wymagania:** obowiązkowe min/max/step/rate/safe-return; brak nieograniczonego fuzzingu tekstu; wynik rozróżnia wartość, licznik, CRC/checksum i brak korelacji.
- **Definition of Done:** fixture wskazówki rozpoznaje właściwą endianowość i monotoniczne pole, a fixture ekranu przyjmuje komunikat raw i ISO-TP z zachowaniem flow-control/timingu.

#### SA-417 — Import DBC i pakietów scenariuszy/protokołów

- **Status:** DO ZROBIENIA
- **Zależności:** SA-401 oraz SA-414 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-scenario-schema.ts`, `packages/can-bus/src/common/can-scenario-importer.ts`, `packages/can-bus/src/common/isotp-profile.ts`, `packages/can-bus/src/common/uds-scenario-profile.ts`, testy i fixtures.
- **Cel:** wersjonowany JSON/YAML bez kodu oraz adaptery DBC, ISO-TP i ograniczonego profilu UDS.
- **Wymagania:** schema validation, migrator wersji, preview całego TX i polityki bezpieczeństwa; ISO-TP jest transportem, UDS scenariuszem; TesterPresent wymaga konkretnego TX/RX ID i jawnego profilu; AUTOSAR/OSEK NM wymaga dostarczonego layoutu/timingu, nie magicznego payloadu; ODX/PDX pozostają backlogiem.
- **Definition of Done:** poprawny profil daje deterministyczny plan, niepoprawny fail-closed z lokalizacją błędu, a import nie może uzbroić ani uruchomić sesji.

#### SA-423 — Adaptery KCD/ARXML i import sekwencji CSV/JSONL/candump

- **Status:** DO ZROBIENIA
- **Zależności:** SA-417 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/kcd-importer.ts`, `packages/can-bus/src/common/arxml-can-importer.ts`, `packages/can-bus/src/common/can-sequence-log-importer.ts`, schemas, fixtures i testy.
- **Cel:** rozszerzyć rejestr importerów o KCD, jawnie ograniczony podzbiór ARXML CAN frame/PDU/signal mappings oraz logi CSV/JSONL/candump.
- **Wymagania:** raport nieobsługiwanych elementów ARXML zamiast cichej utraty semantyki; log wymaga jednoznacznego timestamp/interface/ID/flags/DLC/data i domeny czasu; importowane dane nie uzbrajają TX.
- **Definition of Done:** golden fixtures KCD i obsługiwanego ARXML kodują identyczne sygnały co model natywny; nieobsługiwany ARXML daje raport; CSV/JSONL/candump round-trip zachowuje kolejność, payload i timing albo jawnie oznacza brak precyzji.

#### SA-418 — Kompozytor ramek zwrotnych i typed bindings

- **Status:** DO ZROBIENIA
- **Zależności:** SA-417 i GLOBAL-VARS `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-frame-composer.ts`, `packages/can-bus/src/common/can-value-binding.ts`, `packages/can-bus/src/browser/can-frame-composer-panel.ts`, testy.
- **Cel:** składać ramkę ze stałych, zmiennych użytkownika, ostatnich/czasowo dopasowanych danych RX, ograniczonego AST, liczników i CRC/checksum.
- **Wymagania:** każde binding ma typ, maskę, endianowość, zakres, TTL i fallback `SKIP/STOP/USE_DEFAULT/USE_LAST_VALID`; brak `eval`; atomowe składanie pełnego payloadu przed TX.
- **Definition of Done:** testy wielokrotnego nadpisania bitfieldów wykrywają konflikt, przeterminowana zmienna wykonuje właściwy fallback, a wynik DBC i ręcznego bindingu jest identyczny bajtowo.

#### SA-419 — Generatory, triggery i maszyna stanów urządzenia

- **Status:** DO ZROBIENIA
- **Zależności:** SA-418 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-value-generator.ts`, `packages/can-bus/src/common/can-scenario-state-machine.ts`, `packages/can-bus/src/node/can-scenario-runner.ts`, testy.
- **Cel:** increment/decrement, sweep, triangle, sine, square/toggle, step-list i bounded random, uruchamiane czasem, RX, feedbackiem lub stanem scenariusza.
- **Wymagania:** kompensacja driftu, limity czasu/liczby/rate, safe-return, deduplikacja echo, limit głębokości RX→TX i circuit breaker samowzbudzenia.
- **Definition of Done:** długotrwały sweep nie akumuluje driftu ponad ustalony budżet, a celowo zapętlony fixture RX→TX zatrzymuje się bez zalania magistrali.

#### SA-420 — Izolowany runtime Python

- **Status:** DO ZROBIENIA
- **Zależności:** SA-419 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-script-protocol.ts`, `packages/can-bus/src/node/can-python-runner.ts`, `packages/can-bus/src/browser/can-script-panel.ts`, testy i bezpieczne przykłady.
- **Cel:** uruchamiać skrypt w osobnym procesie z capability API `subscribe/send/schedule/variables/feedback/annotate/stop`.
- **Wymagania:** każda ramka przechodzi tę samą walidację i journal co UI; limity procesu/CPU/czasu/pamięci/kolejki; brak dostępu do DI i adaptera; kill na `STOP` lub utratę heartbeat; hot-reload jako kontrolowany restart dopiero po zatrzymaniu planowania, dispose subskrypcji i ponownej walidacji.
- **Definition of Done:** skrypt prawidłowy steruje fixture, a skrypt nieskończony, zalewający TX, wysyłający poza allowlistę lub tracący heartbeat zostaje przerwany bez naruszenia procesu Theia.

#### SA-424 — Reprodukowalny pakiet eksperymentu i raport

- **Status:** DO ZROBIENIA
- **Zależności:** SA-415, SA-416, SA-422, SA-423 i SA-420 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/can-bus/src/common/can-experiment-archive.ts`, `packages/can-bus/src/node/can-experiment-report-service.ts`, `packages/can-bus/src/browser/can-experiment-report-panel.ts`, schema/migrator, testy i fixtures.
- **Cel:** atomowo zapisywać i odtwarzać `config + seeds + journal + GAP + import hashes + script hashes + ranking + notatki + raport`.
- **Wymagania:** wersjonowany manifest i migrator; append-only journal; anonimizacja nie zmienia czasu/kolejności; replay rozróżnia deterministyczny plan od jitteru i błędów fizycznego DUT.
- **Definition of Done:** eksport z pełnej sesji otwiera się po ponownym uruchomieniu aplikacji, a replay na SA-409 z tym samym seedem daje identyczny plan TX, ranking i decyzje korelacji; uszkodzone archiwum jest odrzucane atomowo.

#### SA-421 — Bramka produktu CAN Device Lab

- **Status:** DO ZROBIENIA
- **Zależności:** SA-424 `AKCEPTACJA`.
- **Pliki dozwolone:** integracyjne testy/fuzz fixtures `packages/can-bus/src/**`, `doc/signal-analyzer/can-device-lab.md`, `doc/signal-analyzer/can-bus.md`, rekord pracy i raporty bramki.
- **Cel:** potwierdzić E2E na vcan/SA-409 i izolowanym stole, timing, recovery, safety, feedback manual/RX-delta/sensor, import, kompozycję, generatory, Python i reprodukcję.
- **Definition of Done:** spełnione kryteria §14 dokumentu produktu; fault injection obejmuje bus-off, utratę adaptera/sensora, przepełnienie kolejki, spóźniony i fałszywy feedback, pętlę RX→TX oraz niekończący się skrypt; pełna dokumentacja użytkownika i decyzja supervisora.

---

### Faza 5 — Inteligencja i porównania (P2)

#### SA-501 — Pakiet `@theia/signal-ai` i integracja agenta AI

- **Status:** DO ZROBIENIA
- **Cel:** Rejestracja bota dialogowego rozszerzającego ekosystem i uodpornionego na kradzież lub halucynacje po stronie LLM.
- **Pliki dozwolone:** `packages/signal-ai/package.json`, `packages/signal-ai/src/browser/signal-ai-agent.ts`, `packages/signal-ai/src/browser/signal-ai-tools.ts`.
- **Wymagania implementacyjne:**
  - Utworzenie szczelnej warstwy kontroli (Validation Boundary) zapobiegającej Prompt Injection i wykonaniu destrukcyjnych akcji przez Model Językowy (odrzucanie "narzędzia skasuj wszystkie logi lub usuń projekt").
  - Aktywny monitor zużycia limitu tokenów (Token Tracker) po to aby asystent odrzucał zlecenia zbytniego rozdrabniania się na zbyt gigantyczne okna czasowe i rekomendował zastosowanie innego skryptu zmniejszającego granulację.
- **Definition of Done:** Agent wywołuje zarejestrowane narzędzia i generuje wiarygodne merytorycznie wyniki tekstowe bez fałszywych wniosków wymyślonych przez halucynację AI (z włączonym trybem surowych metryk powiązania Grounding/RAG z adnotacjami).

#### SA-502 — `SemanticAggregator` + `AnomalyDetector`

- **Status:** DO ZROBIENIA
- **Cel:** Wytrenowanie detekcji na danych w locie, korzystając ze zoptymalizowanych matematycznych algorytmów bez przechowywania historii (Streaming Algorithms).
- **Pliki dozwolone:** `packages/signal-ai/src/common/semantic-aggregator.ts`, `packages/signal-ai/src/common/anomaly-detector.ts`.
- **Wymagania implementacyjne:**
  - Zaimplementować ciągłe obliczanie statystyk Z-score używając np. Algorytmu Welforda dla wariancji z jednym przejściem przez tablice (One-pass running variance $O(1)$ memory).
  - Generowanie zagregowanych wektorów adnotacji (przesuwanie w oknach czasowych) z kategoryzacją do skomasowanych, tokeno-oszczędnych deskryptorów dla Agentów NLP.
- **Definition of Done:** Detekcja nagłego przesunięcia średniej (Time-shift anomaly, Frequency anomaly) wyłapuje różnicę minimalną 5 sigma względem wzorca zachowań i emituje metadane, zachowując minimalny stan pamięci wirtualnej przy wielogodzinnym działaniu.

#### SA-503 — Porównywanie sesji z algorytmem DTW (Dynamic Time Warping)

- **Status:** DO ZROBIENIA
- **Cel:** Analiza wzorców elastyczna i wysoce tolerancyjna, uodporniona przed eksplozją zapotrzebowania na pamięć $O(N^2)$ (zabezpieczenie korytarza).
- **Pliki dozwolone:** `packages/signal-core/src/common/dtw-comparator.ts`, `packages/signal-ui/src/browser/comparator-widget.ts`.
- **Wymagania implementacyjne:**
  - Algorytm macierzowy DTW (Dynamic Time Warping) musi zastosować ucięcie pasma, np. ograniczenie pasma poszukiwań "Sakoe-Chiba Band" lub heurystykę FastDTW. Celem jest obniżenie klasycznego problemu ujemnego wpływu kwadratowej pojemności pamięci podczas macierzowych obliczeń dystansu na korzyść asymptotyki kwaziliniowej.
- **Definition of Done:** Skrypt przetwarza w mniej niż 2 sekundy macierz dystansu wzorców tysięcy punktów, płynnie renderując na siatce połączone krzywymi pasma pokrycia zidentyfikowanych podobieństw rozciągniętych i skróconych śladów fal.
- **Zakazane:** Stosowanie podstawowej implementacji klasycznego DTW ładującej setki megabajtów wyliczanej dwuwymiarowej tablicy matrycy do RAM na długich próbkach, co kończy się zderzeniem z OOM (Out Of Memory Exception).

#### SA-504 — Most `libsigrokdecode` (Python sidecar, opcjonalny)

- **Status:** DO ZROBIENIA
- **Cel:** Proces wieloplatformowy umożliwiający posługiwanie się gigantycznym ekosystemem sprzętowo-software'owym Sigrok bez ryzyk zablokowania bazowej aplikacji.
- **Pliki dozwolone:** `packages/signal-core/src/node/sigrok-bridge.ts`, `scripts/sigrok-sidecar.py`.
- **Wymagania implementacyjne:**
  - Wdrożenie procedur Bezpiecznego i Łagodnego Zamknięcia (Graceful Shutdown) i czyszczenia (SIGTERM, SIGKILL z poziomu Theia backendu po zamknięciu wątku), z gwarancją niepozostawiania zjawisk zombie w powłoce systemowej u użytkownika.
  - Implementacja kolejkowania zdarzeń wzdłuż IPC JSON (inter-process communication) ograniczająca zapotrzebowanie parsera Pythona na zbyt częste strzały we/wy (I/O multiplexing).
- **Definition of Done:** Wykrycie i dodanie kilkuset dekoderów wspieranych przez Sigrok bez zawieszenia programu głównego; błyskawiczne zabicie ubocznych procesów po wyjściu aplikacji ze środowiskiem (Electron i Browser exit).

#### SA-505 — Harness testowy dekoderów (`DecoderTestHarness`)

- **Status:** DO ZROBIENIA
- **Cel:** Wytworzenie rygorystycznych weryfikacji powstrzymujących regresje logiki dekodowania w procesach ciągłej integracji CI/CD projektu theia.
- **Pliki dozwolone:** `packages/signal-core/src/common/test-harness/decoder-test-harness.ts`, odpowiednie pliki testowe.
- **Wymagania implementacyjne:**
  - Generator powiązany z procesami skryptowymi CI (dodany hook do `npm run test`) służący z automatycznego komparowania struktury adnotacji testowanej wersji z surowym, kryptograficznie skróconym zapisem hash wyników w "Golden Traces" osadzonych jako zasoby (resources) podfolderu.
  - Rozszerza bazę golden trace założoną w SA-207 (Faza 2, CAN+UART) o wszystkie pozostałe dekodery zarejestrowane w `DecoderRegistry`; nie zaczyna od zera.
- **Definition of Done:** Bezobsługowy proces odpalany wywołaniami linii poleceń asertuje odchyłki wyników. W wypadku porażki wyrzuca w raporcie precyzyjne odniesienie różnicy (np. `diff payload bytes`).

---

### Faza 6 — Ekosystem (P3)

#### SA-601 — Publiczne Plugin API + SDK oraz Resolver Zależności

- **Status:** DO ZROBIENIA
- **Cel:** Piaskownica oraz jasne definicje publicznego dostępu na miarę wzorca theiaext do celów rozbudowy trzecich stron.
- **Pliki dozwolone:** `packages/signal-core/src/common/plugin-api/` (katalog), `packages/signal-core/src/common/plugin-resolver.ts`.
- **Wymagania implementacyjne:**
  - Wdrożenie koncepcji barier architektonicznych z odpowiednio izolowanymi warstwami, z opcją na izolowanie obcego (niezaufanego) kodu dekoderów zewnętrznych developerów w dodatkowych kontenerach (Worker, lub wtyczka theia-plugin ext-host), dając im dostęp tylko do API oznaczonych adnotacją `@public` za pośrednictwem Theia Plugin API.
  - Rozwiązywanie konfliktów rygorystycznie używając klasycznego SemVer w trakcie ładowania (loading resolution).
- **Definition of Done:** Załadowana wtyczka-złośliwa z zewnętrznego manifestu powodująca wewnątrz pętlę nieskończoną, kończy na crashu jedynie swojego procesu podrzędnego i zwraca błąd z `PluginResolver`, nie zakłócając stabilności całej platformy aplikacji i samego IDE.

#### SA-602 — Silnik wyzwalaczy (Trigger Engine) i symulator protokołów

- **Status:** DO ZROBIENIA
- **Cel:** Konstrukcja ociężałej maszyny stanów na bazie zaawansowanych wyzwalaczy reagujących w potoku o najwyższym priorytecie i minimalnym rzucaniu warunkowym.
- **Pliki dozwolone:** `packages/signal-core/src/common/trigger-engine.ts`, `packages/signal-core/src/common/protocol-simulator.ts`.
- **Wymagania implementacyjne:**
  - Bufor pre-trigger oraz bufor post-trigger operujący bezalokacyjnie jako krąg logicznych przesunięć znaczników zrzutu sesji sprzętu, wyzwalający się na krawędzi sygnałów natychmiast lub z wprowadzonym w symulatorze dodatkowym parametrem losowego jitteru symulującego szumy rzeczywistych ścieżek prądowych.
- **Definition of Done:** Możliwość ustawienia wyzwalacza zatrzymującego maszynę pomiarową na "Tylko w trybie anomalii długości paczki trwającej > 10ms", na tle symulowanych dziesiątek tysięcy poprawnych ramek.

#### SA-603 — Współpraca w czasie rzeczywistym (CRDT) i Multi-Domain Clocking UI

- **Status:** DO ZROBIENIA
- **Cel:** Implementacja stabilnej struktury do operacji asynchronicznych podczas rozłączeń w trybie wspólnym (offline reconciliation).
- **Pliki dozwolone:** `packages/signal-ui/src/browser/collaboration/crdt-session-sync.ts`, `packages/signal-ui/src/browser/multi-domain-clock-widget.ts`.
- **Wymagania implementacyjne:**
  - Adaptacja silnika Automerge lub Yjs z silnymi gwarancjami spójności przy wielokrotnym edytowaniu opisu, dodawaniu adnotacji ręcznych z użyciem kanałów Theia komunikacji w backendzie do dystrybucji zmian pomiędzy użytkownikami.
  - Automatyczne rozwiązywanie problemów związanych z czasem rozłączeń do rozejścia na różne platformy, zapewniające gładkie fuzjowanie (merging) w tle za pomocą wektorowych zegarów Lampa-Porta lub struktury drzewa ułamków logarytmicznych u używanych bibliotek.
- **Definition of Done:** Dwa węzły podłączone przez WebSockets modyfikujące te same adnotacje w czasie rozłączeń sieci, odzyskujące bezkonfliktowo ostateczną synchroniczność po ponownym re-connect (potwierdzone w teście End-to-End narzędziami Cypress lub Playwright w oddzielnym theia setupie wizualnym).

#### SA-604 — Natywny N-API Addon dla szybkiego przechwytywania (Ingestion Hot-Path)

- **Status:** DO ZROBIENIA
- **Cel:** Najwyższa forma ekstremalnej optymalizacji (C++ Native) połączona płynnym mostem V8.
- **Pliki dozwolone:** `packages/signal-core/src/node/native/`, `packages/signal-core/binding.gyp`.
- **Wymagania implementacyjne:**
  - Ręczne wiązanie, uwzględniające specyfikę zarządzania cyklem życia Garbage Collectora między stertą V8 a pamięcią niezarządzaną (Unmanaged memory mmap). Błędy w wyzwoleniu tych pętli prowadzą do uciążliwych błędów Segfault (Segmentation Faults - ubicie procesu bazowego IDE). Trzeba stosować bezpieczne bufory `Napi::Buffer<uint8_t>::New()` z odpowiednimi finalizatorami `std::free`.
- **Definition of Done:** Natywny Add-On przyspiesza operację przetwarzania gigantycznych obciążeń transferów interfejsu PCAP (z kart fizycznych ethernet) czy SocketCAN do bezpośrednich ArrayBufferów o 65% w relacji do czystego silnika Node.js na testowanym procesorze serwerowym oraz nie pozwala silnikowi na błędy wycieków po włączeniu i wyłączeniu analizatora kilkaset razy w teście zmęczeniowym.
- **Zakazane:** Brak kompatybilności wstecznej (Fallback): w razie nieudanej pre-kompilacji modułu C++ lub na nowym systemie bez `node-gyp` moduł MUSI bezproblemowo zniżać się (downgrade/fallback) do czystego interpretera JavaScript bez awarii ładowania całego systemu Signal Analyzera.

---

### Faza 6A — Industrial Protocol Analyzer (PLAN GOTOWY — WSTRZYMANE OPERACYJNIE, P0/P1)

> **ZASTĄPIONE OPERACYJNIE 2026-08-28 decyzją właściciela:** kierunek był aktywny od 2026-08-24. Plan pozostaje ważny, lecz najbliższa implementacja to CAN Device Lab. SA-611…SA-619 nie rozpoczynają się bez ponownego polecenia właściciela.

Pełne wymagania: `doc/signal-analyzer/industrial-protocol-analyzer.md`. Pierwsza wersja jest pasywna; jakiekolwiek wysyłanie ramek lub zapis do PLC pozostaje poza zakresem.

#### SA-610 — Plan produktu i granice protokołów przemysłowych

- **Status:** GOTOWE DO REWIZJI — WSTRZYMANE OPERACYJNIE
- **Zależności:** stabilna baza CAN/signal-core; decyzja właściciela z 2026-08-24.
- **Pliki dozwolone:** dokumentacja `industrial-protocol-analyzer.md`, globalne pliki planu/rejestru oraz rekord `work/SA-610.md`.
- **Cel:** ustalić bezpieczny, pasywny produkt Wireshark-like oraz kolejność Modbus RTU → EtherCAT → PROFINET.
- **Definition of Done:** rozdzielone rodziny protokołów i źródła capture, zdefiniowana architektura/store/UI, karty SA-611…SA-619 i jawnie wstrzymany Logic Analyzer.

#### SA-611 — Kontrakty capture, packet, flow i transaction

- **Status:** DO ZROBIENIA
- **Zależności:** SA-610 `AKCEPTACJA`; rewizja granicy względem zamrożonego `signal-core`.
- **Pliki dozwolone:** additive common/test files w nowym `packages/industrial-protocol-analyzer/`; publiczne dodatki `signal-core` tylko po decyzji supervisora.
- **Cel:** `CaptureRecord`, `PacketBatch`, `CaptureSource`, `FlowKey`, `IndustrialTransaction`, GAP/truncation i binarne batchowanie bez używania `SampleBlock` jako pakietu.
- **Definition of Done:** round-trip Ethernet/serial, bigint timestamp/record ID, truncated/GAP, zero-copy arena i walidacja overflow; kontrakt zamrożony po rewizji.

#### SA-612 — Paged capture store, PCAP/PCAPNG i simulator

- **Status:** DO ZROBIENIA
- **Zależności:** SA-611 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/industrial-protocol-analyzer/src/node/{store,pcap,simulator}/**`, fixtures i testy.
- **Cel:** stronicowy store i indeks, import PCAP/PCAPNG, deterministyczne traces Ethernet/serial oraz golden captures.
- **Definition of Done:** plik 10 GB pokazuje pierwszy zakres bez pełnego wczytania; parser odrzuca uszkodzenie atomowo; seed simulatora jest powtarzalny.

#### SA-613 — Widget Industrial Protocol Analyzer

- **Status:** DO ZROBIENIA
- **Zależności:** SA-611 i SA-612 `AKCEPTACJA`; audyt istniejącego `ViewportController` tylko jeśli zostanie użyty.
- **Pliki dozwolone:** `packages/industrial-protocol-analyzer/src/browser/**`, frontend module, style i testy UI; punkty montażu examples po rewizji.
- **Cel:** `Analyzer → New Industrial Protocol Analyzer`, wiele instancji, sources/flows, wirtualizowana tabela, protocol tree, hex/ASCII i filtry.
- **Definition of Done:** 1 mln rekordów nie tworzy 1 mln DOM; wybór pola podświetla dokładny zakres bajtów; dispose/focus/layout nie generują warningów.

#### SA-614 — Decoder Modbus RTU

- **Status:** DO ZROBIENIA
- **Zależności:** SA-611 i SA-612 `AKCEPTACJA`.
- **Pliki dozwolone:** decoder/reassembly Modbus w nowym pakiecie, golden traces i testy; bez funkcji aktywnego mastera.
- **Cel:** framing czasowy, address/function/PDU, CRC16, request/response, wyjątki i podstawowe funkcje 01/02/03/04/05/06/0F/10/17.
- **Definition of Done:** granice 3,5 znaku, wszystkie golden CRC i wyjątki, orphan/timeout, nieznane funkcje bez crash; brak zapisu na port.

#### SA-615 — Live capture sieci i serial

- **Status:** DO ZROBIENIA
- **Zależności:** SA-611 i SA-612 `AKCEPTACJA`; przegląd uprawnień/licencji.
- **Pliki dozwolone:** node providers/launcher dla dumpcap/Npcap/libpcap/serial, telemetry, tests i dokumentacja instalacji.
- **Cel:** bezpieczne wykrywanie interfejsów, ring PCAPNG, serial monitor, drop counters, stop/disconnect i fallback offline.
- **Definition of Done:** brak praw/sterownika nie psuje aplikacji; capture ma jawny snaplen/drop/GAP; proces potomny i uchwyty znikają po 100 cyklach start/stop.

#### SA-616 — Decoder EtherCAT

- **Status:** DO ZROBIENIA
- **Zależności:** SA-611, SA-612 i SA-615 `AKCEPTACJA`; golden trace z legalnego źródła.
- **Pliki dozwolone:** EtherCAT decoder/test/fixtures i opcjonalny importer ESI po przeglądzie.
- **Cel:** EtherType 0x88A4, frame/datagram headers, commands/addressing, WKC, cykle, jitter i podstawowe Distributed Clocks.
- **Definition of Done:** wiele datagramów, VLAN/truncation/WKC anomalies, p95/p99 cyklu oraz 60 min 100 Mb/s bez niewyjaśnionego dropu przy prawidłowym TAP.

#### SA-617 — Decoder PROFINET

- **Status:** DO ZROBIENIA
- **Zależności:** SA-611, SA-612 i SA-615 `AKCEPTACJA`; legalne golden captures PROFINET i podstawowy plik GSDML.
- **Pliki dozwolone:** decodery/testy/fixtures PROFINET DCP/RT/IO, LLDP i PNIO-CM oraz importer GSDML; S7comm poza kartą.
- **Cel:** EtherType 0x8892, DCP, FrameID/cyclic IO, IOxS, cycle/jitter, LLDP, AR/CR przez DCE-RPC, alarmy i mapowanie moduł/submoduł.
- **Definition of Done:** DCP/RT/PNIO-CM oraz VLAN/truncation przechodzą golden tests; startup tworzy model urządzeń, GSDML opisuje process data, brak cyklu/DataStatus generuje diagnostykę; decoder niczego nie wysyła.

#### SA-618 — Korelacja, process values, statystyki i eksport

- **Status:** DO ZROBIENIA
- **Zależności:** SA-614, SA-616 i SA-617 `AKCEPTACJA`.
- **Pliki dozwolone:** query/correlation/statistics/export w nowym pakiecie, additive Global Variables adapter po rewizji i testy.
- **Cel:** wspólny model transakcji, wartości procesowe, cycle/error dashboards, filtry, anonimizacja oraz PCAPNG/CSV/JSON/session export.
- **Definition of Done:** request/response/timeouts dla trzech rodzin, eksport zachowuje GAP/timestamp domain, konfiguracja typów nie zmienia surowych danych.

#### SA-619 — Bramka produktu przemysłowego

- **Status:** DO ZROBIENIA
- **Zależności:** SA-613…SA-618 `AKCEPTACJA`.
- **Pliki dozwolone:** E2E/performance/fuzz/security/package docs nowych komponentów i dokumentacja użytkowa.
- **Cel:** zamknąć import/live/decode/filter/export na Windows/Linux, przegląd GPL/Npcap, fault injection i responsywność UI.
- **Definition of Done:** wszystkie bramki z dokumentu produktu, zero aktywnej transmisji, pełny raport benchmarków/licencji i decyzja supervisora o stable.

---

### Faza 7 — Logic Analyzer jako produkt (PERSPEKTYWA — WSTRZYMANE)

Pełne wymagania i kolejność pozostają w `doc/signal-analyzer/logic-analyzer-implementation-plan.md`. Decyzją właściciela 2026-08-24 faza wraca wyłącznie na jego polecenie i nie może blokować SA-610…SA-619.

**Status nadrzędny:** `WSTRZYMANE — PERSPEKTYWA`. Historyczne statusy `DO ZROBIENIA` w kartach SA-702…SA-909 oznaczają zakres niezrealizowany, ale nie upoważniają do rozpoczęcia pracy.

#### SA-701 — Dokumentacja i decyzje graniczne Logic Analyzer

- **Status:** GOTOWE DO REWIZJI — PERSPEKTYWA WSTRZYMANA
- **Zależności:** SA-206 zaakceptowane; decyzja właściciela o Logic Analyzer, C++ i hardware.
- **Pliki dozwolone:** `doc/signal-analyzer/logic-analyzer*.md`, `doc/signal-analyzer/README.md`, `doc/signal-analyzer/work/SA-701.md`, `SIGNAL-ANALYZER-ROADMAP.md`, `SIGNAL-ANALYZER-TASKS.md`, append-only `SIGNAL-ANALYZER-CHANGELOG.md`.
- **Cel:** Zamknąć architekturę produktu, SADP, własnego hardware, native host i integracji urządzeń rynkowych przed zmianą kodu.
- **Definition of Done:** komplet dokumentów jest zindeksowany, karty SA-702…SA-909 istnieją, `git diff --check` przechodzi, brak zmian kodu.

#### SA-702 — Kontrakty urządzeń i wysokowydajnych chunków

- **Status:** DO ZROBIENIA
- **Zależności:** SA-701 `AKCEPTACJA`; rewizja faktycznego stanu SA-301.
- **Pliki dozwolone:** additive pliki w `packages/signal-core/src/common/` lub `packages/logic-analyzer/src/common/` zatwierdzone w rekordzie, testy, `doc/signal-analyzer/logic-analyzer.md`.
- **Cel:** `DeviceProvider`, `DeviceCapabilities`, `CapturePlan`, `RawCaptureChunk`, telemetry, lease i rational sample rate bez zmiany semantyki `SampleBlock`.
- **Definition of Done:** round-trip 32 kanałów i 1 GS/s bez utraty precyzji, atomiczna walidacja konfiguracji, jawny GAP/overflow, rewizja granicy API.

#### SA-703 — Pakiet `@theia/logic-analyzer`, menu i widget

- **Status:** DO ZROBIENIA
- **Zależności:** SA-702 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/logic-analyzer/**`, własny contribution wspólnego menu, punkty montażu `examples/browser|electron/package.json`, lockfile.
- **Cel:** `Analyzer → New Logic Analyzer`, transient multi-instance widget, Device Library i poprawny lifecycle/focus.
- **Definition of Done:** CAN i co najmniej dwa widgety Logic działają razem; compile/lint/test, build Browser/Electron i test przywrócenia layoutu.

#### SA-704 — Simulator mixed-signal i import plików

- **Status:** DO ZROBIENIA
- **Zależności:** SA-702 `AKCEPTACJA`.
- **Pliki dozwolone:** provider simulator/file w `packages/logic-analyzer/src/common|node/`, fixtures i testy.
- **Cel:** deterministyczne 16D+2A, UART/I2C/SPI/CAN, trigger/GAP/RAW/RLE/EDGE oraz VCD/SR.
- **Definition of Done:** seed jest powtarzalny, różne sample rates zachowują oś czasu, plik 1 GB nie jest ładowany w całości do RAM.

#### SA-705 — Waveform cyfrowy/analogowy i LOD UI

- **Status:** DO ZROBIENIA
- **Zależności:** SA-703 i SA-704 `AKCEPTACJA`; SA-301 zweryfikowane, nieimplementowane ponownie.
- **Pliki dozwolone:** nowe pliki rendererów/widgetów w `packages/logic-analyzer/src/browser/` i publiczne rozszerzenia `packages/signal-ui/` po rewizji.
- **Cel:** WebGL2 + Canvas2D, edge-preserving digital LOD, analog min/max i wirtualizacja kanałów.
- **Definition of Done:** 32 kanały bez pełnego raw w rendererze; cached viewport p95 <100 ms; High-DPI i motywy przechodzą testy.

#### SA-706 — Capture, trigger, kursory i pomiary

- **Status:** DO ZROBIENIA
- **Zależności:** SA-705 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/logic-analyzer/src/common|browser/` dotyczące capture/trigger/measurements, testy.
- **Cel:** capabilities-driven buffer/stream/roll, progi, pre/post-trigger, kursory i pomiary.
- **Definition of Done:** UI nie wysyła nieobsługiwanej konfiguracji, pokazuje effective config, jednostki ns–h są poprawne, GAP/overflow widoczne.

#### SA-707 — Dekodery, tabela zdarzeń i eksport

- **Status:** DO ZROBIENIA
- **Zależności:** SA-706 oraz SA-205 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/logic-analyzer/src/browser|node/`, additive decoder adapters w zatwierdzonych plikach, testy/fixtures.
- **Cel:** UART/I2C/SPI/CAN overlays, wirtualizowana tabela, C++/TS/Python adapter wyników, eksport CSV/VCD/SR/native.
- **Definition of Done:** golden trace jest identyczny między backendami; 1 M adnotacji nie tworzy 1 M DOM; awaria decodera nie zatrzymuje capture.

#### SA-708 — Bramka produktu bez fizycznego hardware

- **Status:** DO ZROBIENIA
- **Zależności:** SA-707 `AKCEPTACJA`.
- **Pliki dozwolone:** testy E2E, dokumenty `logic-analyzer*.md`, punkty montażu aplikacji wyłącznie jeśli wymagane.
- **Cel:** kompletny workflow simulator/file na Browser/Electron przed ryzykiem sterowników.
- **Definition of Done:** capture/decode/view/export E2E, 24 h soak bez wzrostu pamięci, focus/accessibility/themes, supervisor zamyka Fazę 7.

---

### Faza 8 — Backend natywny i sprzęt rynkowy (PERSPEKTYWA — WSTRZYMANE)

#### SA-801 — `signal-native-host` C++20 i Bridge API

- **Status:** DO ZROBIENIA
- **Zależności:** SA-701 i SA-702 `AKCEPTACJA`.
- **Pliki dozwolone:** nowy `packages/signal-native/**`, package-local CMake i testy; bez zmian w upstream Theia.
- **Cel:** izolowany proces, lokalny IPC, handshake, lifecycle, heartbeat i emulator provider.
- **Definition of Done:** 1000 start/stop bez zombie/handle leak; crash C++ nie zabija Theia; brak binarki daje czytelny fallback.

#### SA-802 — Raw store, LOD i query engine C++

- **Status:** DO ZROBIENIA
- **Zależności:** SA-801 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/signal-native/native/src/{capture,store,lod}/**`, include/test/fuzz związane z zakresem.
- **Cel:** prealokowane chunks, append-only mmap store, recovery, digital edge LOD i analog min/max.
- **Definition of Done:** sesja 100 GB otwiera viewport bez pełnego skanu; recovery po kill; cached p95 <100 ms.

#### SA-803 — Transporty USB, UART i TCP

- **Status:** DO ZROBIENIA
- **Zależności:** SA-801 oraz SA-901 `AKCEPTACJA`.
- **Pliki dozwolone:** `packages/signal-native/native/src/transport/**`, SADP adapters/tests.
- **Cel:** libusb async bulk, UART/COBS, TCP/mDNS/TLS hook i credits/backpressure.
- **Definition of Done:** ten sam conformance trace przechodzi trzema transportami; sequence/CRC/GAP i control priority działają pod obciążeniem.

#### SA-804 — Sigrok bridge GPL

- **Status:** DO ZROBIENIA
- **Zależności:** SA-801, SA-803 i SA-205 `AKCEPTACJA`; zaakceptowany model licencyjny.
- **Pliki dozwolone:** osobny opcjonalny pakiet/bridge Sigrok, launcher provider i dokumentacja licencji.
- **Cel:** hardware, digital/analog, `.sr` i opcjonalny libsigrokdecode bez linkowania GPL do Theia.
- **Definition of Done:** dwa różne źródła Sigrok działają bez zmiany UI; graceful shutdown i user-supplied binary są przetestowane.

#### SA-805 — DSLogic U2Basic/Plus bridge

- **Status:** DO ZROBIENIA
- **Zależności:** SA-803 `AKCEPTACJA`; fizyczne U2Basic i Plus.
- **Pliki dozwolone:** osobny optional vendor bridge, provider/manifest i HIL tests.
- **Cel:** znane VID/PID, buffer/stream, próg, trigger, external clock i jawne wymagania firmware.
- **Definition of Done:** macierz trybów obu modeli przechodzi HIL; brak firmware jest raportowany bez awarii Theia.

#### SA-806 — ALIENTEK DL32 feasibility i warunkowy driver

- **Status:** DO ZROBIENIA
- **Zależności:** SA-803 `AKCEPTACJA`; fizyczny DL32; przegląd GPL/firmware.
- **Pliki dozwolone:** spike/test reports, opcjonalny `alientek-bridge` dopiero po decyzji `GO`, provider i HIL tests.
- **Cel:** potwierdzić VID/PID, endpointy, komendy, format 32 kanałów i prawdziwą macierz 1 GS/s.
- **Definition of Done:** udokumentowana decyzja `GO`, `VENDOR SDK REQUIRED` albo `IMPORT ONLY`; po `GO` golden signal jest zgodny z ATK-Logic.

#### SA-807 — Wiele urządzeń i synchronizacja

- **Status:** DO ZROBIENIA
- **Zależności:** SA-802 i co najmniej jeden z SA-804/805/806 `AKCEPTACJA`.
- **Pliki dozwolone:** scheduler/sync/telemetry w `packages/signal-native/**`, broker/provider UI w `packages/logic-analyzer/**`.
- **Cel:** budgets, niezależne procesy, software/network/hardware/shared-clock sync i USB topology.
- **Definition of Done:** dwa urządzenia około 80 MB/s przez 10 min, 0 niewyjaśnionych GAP, odłączenie jednego nie wpływa na drugie.

#### SA-808 — Bramka wydajności, bezpieczeństwa i dystrybucji

- **Status:** DO ZROBIENIA
- **Zależności:** SA-807 `AKCEPTACJA`.
- **Pliki dozwolone:** CI/test/fuzz/package docs dla nowych pakietów, bez globalnej przebudowy upstream.
- **Cel:** ASan/UBSan, fuzz, SBOM, podpis binarek, fault injection, 80 MB/s obowiązkowo i 160 MB/s jako cel.
- **Definition of Done:** raport benchmarków zawiera hardware/topologię; pełny dysk/crash/disconnect nie uszkadza sesji; macierz licencji zaakceptowana.

---

### Faza 9 — Własny hardware (PERSPEKTYWA — WSTRZYMANE)

#### SA-901 — SADP v1 emulator i conformance kit

- **Status:** DO ZROBIENIA
- **Zależności:** SA-701 i SA-702 `AKCEPTACJA`.
- **Pliki dozwolone:** nowe repozytorium/katalog firmware uzgodniony w rekordzie, `packages/signal-native` parser/test vectors, dokument SADP.
- **Cel:** referencyjny parser C/C++, emulator, CLI, golden frames i fuzz corpus.
- **Definition of Done:** RAW/RLE/EDGE, fragmentacja, złe CRC, GAP, credits i trzy transporty mają wspólne test vectors; SADP v1 zamrożony.

#### SA-902 — LA-Lite ESP32

- **Status:** DO ZROBIENIA
- **Zależności:** SA-901 `AKCEPTACJA`.
- **Pliki dozwolone:** dedykowany firmware ESP32 i HIL tests, dokumentacja wariantu Lite.
- **Cel:** USB/UART/TCP, discovery, bufor, trigger, RLE, telemetry i update.
- **Definition of Done:** uczciwa macierz osiągniętych szybkości z 1 h soak; brak deklaracji 400 MS/s dla ESP32-S3.

#### SA-903 — STM32H7 control i transport

- **Status:** DO ZROBIENIA
- **Zależności:** SA-901 `AKCEPTACJA`.
- **Pliki dozwolone:** dedykowany firmware STM32, board config i HIL tests.
- **Cel:** USB HS ULPI, Ethernet, UART, SADP, DMA, bootloader A/B i FPGA control.
- **Definition of Done:** benchmark transportu bez FPGA, STOP priority, reconnect, signed update i recovery.

#### SA-904 — FPGA sampler 400 MS/s

- **Status:** DO ZROBIENIA
- **Zależności:** SA-901 i SA-903 `AKCEPTACJA`; wybór FPGA po spike'u timing/IO.
- **Pliki dozwolone:** dedykowany HDL, constraints, simulation/formal tests i firmware interface.
- **Cel:** 64-bit ticks, 4×400, 8×200, 16×100 i opcjonalnie 32×50 MS/s, trigger, RLE i RAM.
- **Definition of Done:** timing closure i hardware pattern test każdej reklamowanej macierzy; overflow nigdy nie jest cichy.

#### SA-905 — Kanały analogowe i kalibracja mixed-signal

- **Status:** DO ZROBIENIA
- **Zależności:** SA-904 `AKCEPTACJA`; wybrany ADC/AFE.
- **Pliki dozwolone:** analog HDL/firmware/calibration, host adapter i HIL tests.
- **Cel:** 2 kanały 12–16 bit, docelowo 1–20 MS/s, wspólne ticks i wersjonowana kalibracja.
- **Definition of Done:** offset/gain/time skew w określonej tolerancji; jednoczesny digital+analog trace ma poprawną oś czasu.

#### SA-906 — EVT PCB LA-Pro 400

- **Status:** DO ZROBIENIA
- **Zależności:** SA-904 i projekt SA-905 gotowy; review schematu/SI/PI.
- **Pliki dozwolone:** dedykowane źródła hardware, BOM, gerber/assembly i bring-up docs poza kodem upstream.
- **Cel:** cyfrowy front-end, FPGA/RAM, STM32, USB/Ethernet/UART, sync i analog na prototypie.
- **Definition of Done:** bring-up checklist, bezpieczne limity wejść, wszystkie bloki wykrywane; brak decyzji produkcyjnej przed DVT.

#### SA-907 — Synchronizacja, kalibracja i update produkcyjny

- **Status:** DO ZROBIENIA
- **Zależności:** SA-906 `AKCEPTACJA`.
- **Pliki dozwolone:** hardware/firmware/test production i host calibration tools nowych komponentów.
- **Cel:** SYNC/TRIG/CLOCK IN/OUT, offset/drift, serializacja, signed update i self-test.
- **Definition of Done:** dwa EVT zachowują zadany błąd synchronizacji; rollback i recovery przechodzą fault injection.

#### SA-908 — Sterownik Sigrok własnego urządzenia

- **Status:** DO ZROBIENIA
- **Zależności:** SA-903 i SA-904 `AKCEPTACJA`; zamrożony SADP v1.
- **Pliki dozwolone:** osobny driver/fork/upstream patch Sigrok, firmware compatibility tests i dokumentacja.
- **Cel:** użycie urządzenia przez sigrok-cli/PulseView bez naszej aplikacji.
- **Definition of Done:** scan/configure/capture/trigger/export na Windows/Linux; upstreamability/licencja udokumentowane.

#### SA-909 — DVT/PVT i bramka wydania własnego hardware

- **Status:** DO ZROBIENIA
- **Zależności:** SA-907 i SA-908 `AKCEPTACJA`.
- **Pliki dozwolone:** raporty kwalifikacji, instrukcje, dokumenty hardware i test fixtures.
- **Cel:** funkcjonalne, wydajnościowe, termiczne, ESD, soak, produkcyjne i wielourządzeniowe zatwierdzenie.
- **Definition of Done:** pełna macierz USB/UART/TCP i Windows/Linux, safety/calibration/recovery docs, decyzja właściciela o wersji stabilnej.

---

## 4a. DAG zależności między zadaniami

Graf pokazuje twarde zależności (poprzednik musi mieć decyzję `AKCEPTACJA`, zanim następnik zacznie implementację). Zależności wewnątrz jednej fazy, niewymienione poniżej, mogą być realizowane równolegle.

```mermaid
graph TD
    SA001[SA-001 DI bindings] --> SA002[SA-002 socket-service]
    SA001 --> SA003[SA-003 rpc-service]
    SA002 --> SA003
    SA003 --> SA004[SA-004 RingBuffer widget]
    SA003 --> SA005[SA-005 binarny transport]
    SA004 --> SA005
    SA004 --> SA006[SA-006 CSS + FPS]
    SA005 --> SA007[SA-007 rejestracja w examples/browser]
    SA006 --> SA007
    SA007 --> SA008[SA-008 docs can-bus]

    SA101[SA-101 szkielet signal-core] --> SA102[SA-102 kontrakty]
    SA102 --> SA103[SA-103 RingSampleStore + IntervalTree]
    SA102 --> SA104[SA-104 CaptureSession/State Machine]
    SA008 --> SA105[SA-105 migracja can-bus na signal-core]
    SA103 --> SA105
    SA105 --> SA106[SA-106 docs signal-core]

    SA102 --> SA201[SA-201 DecoderRegistry + topo sort]
    SA201 --> SA202[SA-202 decode-on-demand worker + SAB]
    SA103 --> SA202
    SA201 --> SA203[SA-203 GAP/RESYNC + circuit breaker]
    SA105 --> SA204[SA-204 CAN jako DecoderProvider]
    SA201 --> SA204
    SA204 --> SA205{{SA-205 UART - BRAMKA ZAMROŻENIA KONTRAKTU}}
    SA203 --> SA205
    SA205 --> SA206[SA-206 docs decoders]
    SA205 --> SA207[SA-207 lekki harness golden-trace CAN+UART]
    SA203 --> SA207

    SA205 -.kontrakt zamrożony.-> SA301[SA-301 ViewportController]
    SA104 --> SA301
    SA301 --> SA302[SA-302 WebGL waveform]
    SA103 --> SA302
    SA301 --> SA303[SA-303 Hex/Bit view]
    SA202 --> SA304[SA-304 tabela protokołów]
    SA301 --> SA304
    SA304 --> SA305[SA-305 filtry/kolorowanie]

    SA204 --> SA401[SA-401 .dbc DecoderProvider]
    SA102 --> SA402[SA-402 AnnotationIndex + AnnotationQuery]
    SA203 --> SA402
    SA104 --> SA403[SA-403 Undo/Redo]
    SA103 --> SA404[SA-404 Export/Import]
    SA103 --> SA405[SA-405 VirtualChannel]
    SA002 --> SA409[SA-409 sleeping DUT simulator]
    SA105 --> SA409
    SA002 --> SA410{{SA-410 safety/session contract gate}}
    SA105 --> SA410
    SA002 --> SA406[SA-406 replay/transmit CAN]
    SA105 --> SA406
    SA409 --> SA406
    SA410 --> SA406
    SA406 --> SA411[SA-411 wake campaign engine]
    SA411 --> SA412[SA-412 human + RX-delta feedback]
    SA412 --> SA422[SA-422 SCPI/GPIO feedback providers]
    SA412 --> SA413[SA-413 causal-window ranking]
    SA413 --> SA414{{SA-414 adaptive wake-up E2E gate}}
    SA414 --> SA415[SA-415 binary option discovery]
    SA414 --> SA416[SA-416 numeric/text discovery]
    SA401 --> SA417[SA-417 DBC/scenario import]
    SA414 --> SA417
    SA417 --> SA423[SA-423 KCD/ARXML/log import]
    SA417 --> SA418[SA-418 response frame composer]
    SA418 --> SA419[SA-419 generators/state machine]
    SA419 --> SA420[SA-420 isolated Python runtime]
    SA415 --> SA424[SA-424 reproducible experiment package]
    SA416 --> SA424
    SA422 --> SA424
    SA423 --> SA424
    SA420 --> SA424
    SA424 --> SA421{{SA-421 CAN Device Lab product gate}}

    SA402 --> SA501[SA-501 signal-ai + tool-use]
    SA501 --> SA502[SA-502 SemanticAggregator/AnomalyDetector]
    SA402 --> SA502
    SA103 --> SA503[SA-503 DTW comparator]
    SA301 --> SA503
    SA205 -.dopiero po zamrożeniu.-> SA504[SA-504 libsigrokdecode bridge]
    SA201 --> SA505[SA-505 DecoderTestHarness]
    SA207 --> SA505

    SA205 --> SA601[SA-601 Plugin API/SDK]
    SA201 --> SA601
    SA002 --> SA602[SA-602 Trigger engine/symulator]
    SA103 --> SA602
    SA104 --> SA603[SA-603 CRDT collab]
    SA301 --> SA603
    SA002 --> SA604[SA-604 N-API addon]
    SA005 --> SA604

    SA206 --> SA610[SA-610 Industrial Protocol Analyzer plan]
    SA610 -.po ponownej komendzie właściciela.-> SA611{{SA-611 capture/packet contract gate}}
    SA611 --> SA612[SA-612 store + PCAP + simulator]
    SA612 --> SA613[SA-613 industrial analyzer widget]
    SA611 --> SA614[SA-614 Modbus RTU]
    SA612 --> SA614
    SA611 --> SA615[SA-615 live network + serial capture]
    SA612 --> SA615
    SA611 --> SA616[SA-616 EtherCAT]
    SA612 --> SA616
    SA615 --> SA616
    SA611 --> SA617[SA-617 PROFINET DCP RT IO]
    SA612 --> SA617
    SA615 --> SA617
    SA614 --> SA618[SA-618 correlation + values + export]
    SA616 --> SA618
    SA617 --> SA618
    SA613 --> SA619{{SA-619 industrial product gate}}
    SA615 --> SA619
    SA618 --> SA619
    SA619 -.po komendzie właściciela.-> SA702

    SA206 --> SA701[SA-701 dokumentacja Logic Analyzer]
    SA701 --> SA702[SA-702 kontrakty urządzeń i chunków]
    SA701 --> SA801[SA-801 signal-native-host C++20]
    SA701 --> SA901[SA-901 SADP v1 emulator]

    SA702 --> SA703[SA-703 pakiet logic-analyzer]
    SA702 --> SA704[SA-704 simulator mixed-signal]
    SA703 --> SA705[SA-705 waveform + LOD UI]
    SA704 --> SA705
    SA301 --> SA705
    SA705 --> SA706[SA-706 capture + trigger + pomiary]
    SA706 --> SA707[SA-707 dekodery + tabela + eksport]
    SA205 --> SA707
    SA707 --> SA708{{SA-708 bramka produktu}}

    SA702 --> SA801
    SA801 --> SA802[SA-802 raw store + LOD C++]
    SA801 --> SA803[SA-803 USB + UART + TCP]
    SA901 --> SA803
    SA803 --> SA804[SA-804 Sigrok bridge GPL]
    SA803 --> SA805[SA-805 DSLogic bridge]
    SA803 --> SA806[SA-806 ALIENTEK DL32 spike]
    SA802 --> SA807[SA-807 wiele urządzeń + synchronizacja]
    SA804 --> SA807
    SA805 --> SA807
    SA806 --> SA807
    SA807 --> SA808{{SA-808 bramka native}}

    SA702 --> SA901
    SA901 --> SA902[SA-902 LA-Lite ESP32]
    SA901 --> SA903[SA-903 STM32H7 control]
    SA903 --> SA904[SA-904 FPGA 400 MS/s]
    SA904 --> SA905[SA-905 analog + kalibracja]
    SA904 --> SA906[SA-906 EVT PCB]
    SA905 --> SA906
    SA906 --> SA907[SA-907 sync + update]
    SA903 --> SA908[SA-908 driver Sigrok]
    SA904 --> SA908
    SA907 --> SA909{{SA-909 DVT/PVT}}
    SA908 --> SA909
```

**Krytyczne bramki (gate) — nie pomijać:**

- **SA-205 = bramka zamrożenia kontraktu.** Zgodnie z roadmap §1/§4 (Faza 2): dopiero po tym, jak dekoder UART (2. protokół) potwierdzi, że kontrakt `DecoderProvider`/`ProtocolAnnotation` działa bez zmian, kontrakt zostaje ZAMROŻONY. Faza 3 (wizualizacja) i SA-504 (libsigrokdecode) nie mogą realnie ruszyć przed tą decyzją — jeśli SA-205 wykaże potrzebę zmiany kontraktu, to `apiVersion` bump + migrator, a Faza 3 startuje później niż w tabeli §4.
- **SA-105 wymaga całej Fazy 0 (SA-001…SA-008)** — migracja can-bus na kontrakty `signal-core` przepina istniejący, działający widget; regresja Fazy 0 jest niedopuszczalna (DoD SA-105).
- **SA-410 = bramka bezpieczeństwa aktywnego CAN.** Żaden kod nadajnika SA-406 ani kampanii nie może ruszyć przed akceptacją stanów sesji, allowlist, limitów i semantyki `STOP`/auto-stop. Aktywne TX jest dozwolone wyłącznie w CAN Device Lab na izolowanym stole.
- **SA-409 jest równoległym warunkiem testowalności.** Powstaje obok SA-410, ale musi być zaakceptowany przed SA-406. Kolejne zadania nie tworzą własnych, niezgodnych symulatorów DUT.
- **SA-414 = bramka pierwszego vertical slice.** Wybudzanie jest użyteczne dopiero, gdy manual/RX-delta, kalibrowane okno, sham/seeded replay potrafią odróżnić pojedynczą ramkę od sekwencji, zachować keep-alive przez omission i znaleźć jego stabilny okres. Po SA-414 właściciel może przetestować produkt przed budową późniejszych narzędzi.
- **SA-421 = bramka produktu CAN Device Lab.** Wymaga symulatora i fizycznego stołu, fault injection, deterministycznego journalu, zewnętrznego providera feedbacku, pełnej ścieżki import→composer→generator→Python, reprodukowalnego pakietu SA-424 oraz udokumentowanego awaryjnego zatrzymania.
- **SA-611 = bramka kontraktu pakietowego.** `CaptureRecord`/`PacketBatch` nie mogą zmieniać znaczenia `SampleBlock`; dopiero ich akceptacja odblokowuje store, UI i dekodery przemysłowe.
- **SA-619 = bramka bezpieczeństwa produktu.** Do jej zamknięcia analizator pozostaje pasywny. Funkcje aktywnego mastera, zapisu PLC lub wstrzykiwania ramek wymagają nowej karty i osobnej decyzji właściciela.
- **SA-611…SA-619 są wstrzymane operacyjnie od 2026-08-28.** Plan Industrial Protocol Analyzer pozostaje ważny, ale wraca do wykonania dopiero po osobnym poleceniu właściciela; nie konkuruje o pliki globalne z aktywną Fazą 4A.
- **SA-702…SA-909 są wstrzymane.** Krawędź z SA-619 jest warunkowa: Logic Analyzer wraca dopiero po osobnym poleceniu właściciela, niezależnie od spełnienia technicznych zależności.

**Decyzje właściciela (zatwierdzone 2026-08-04, wg rekomendacji z sesji planistycznej):**

1. **SA-304** rusza z naiwnym/liniowym przeszukiwaniem bufora viewportu pod kontraktem `AnnotationQuery` (SA-202 i tak ogranicza dane do okna widoku + 20% marginesu). SA-402 (Faza 4) podmienia silnik na `AnnotationIndex` bez zmiany API tabeli. Kryterium rewizji: jeśli benchmark SA-304 przekroczy 50 ms na realistyczne okno, kolejność zostaje zrewidowana. Karta SA-304 zaktualizowana o ten wymóg i próg benchmarku.
2. **SA-505 pozostaje w Fazie 5** (pełny CI harness, wiele dekoderów, hash kryptograficzny), ale dodano nowe zadanie **SA-207** (Faza 2, zaraz po SA-205) — lekki harness golden-trace tylko dla CAN i UART, bez hooka CI ani hashowania. SA-505 rozszerza tę bazę zamiast zaczynać od zera.

## 4b. Wzorce z istniejącego kodu Theia (zweryfikowane ścieżki)

| Wzorzec | Zastosuj w | Plik referencyjny |
| --- | --- | --- |
| `ContainerModule` + `RpcConnectionHandler` + `bindRootContributionProvider` w module backendowym | SA-001, SA-003 | `packages/core/src/node/messaging/messaging-backend-module.ts` |
| `ConnectionContainerModule.create(...)` z czyszczeniem per-połączenie (`client.onDidCloseConnection`) | SA-003 (dispose subskrypcji przy rozłączeniu klienta) | `packages/ai-mcp-server/src/node/mcp-backend-module.ts` |
| `bindContributionProvider` (scoped do kontenera połączenia) vs `bindRootContributionProvider` (root) | SA-001, SA-101 (wybór właściwego wiązania) | `packages/core/src/common/contribution-provider.ts` |
| `DisposableCollection` do zbiorczego zwalniania listenerów połączenia | SA-003 (test memory-leak na dispose) | `packages/core/src/node/messaging/websocket-frontend-connection-service.ts` |
| Rejestracja `Agent`/`ChatAgent` przez `bindRootContributionProvider(bind, ChatAgent)` + `bind(Agent).toService(...)` | SA-501 | `packages/ai-chat/src/browser/ai-chat-frontend-module.ts` |
| Konkretne agenty i narzędzia (tool-use) z `@theia/ai-core` gotowe do wzorowania (np. `ExploreAgent`, `TodoWriteTool`) | SA-501, SA-601 | `packages/ai-ide/src/browser/frontend-module.ts` |
| Istniejący frontend-module pakietu `can-bus` (wzorzec do rozszerzenia o `node/`) | SA-001 (analogia backend/frontend) | `packages/can-bus/src/browser/can-frontend-module.ts` |

---

## 5. Szablon zgłoszenia wykonawcy do rewizji

```text
Zadanie: SA-xxx
Status: GOTOWE DO REWIZJI | BLOCKED
Zrobione: <krótki opis>
Odstępstwa od karty: <jeśli są, z uzasadnieniem - np. odkryta pułapka wydajnościowa>
Weryfikacja: <komenda + wynik profili czasowych jeśli zastosowano>
Changelog: <link/cytat wpisu dopisanego do SIGNAL-ANALYZER-CHANGELOG.md>
Dokumentacja: <plik(i) zaktualizowane, ze ścieżkami diagramów>
```

## 6. Szablon decyzji supervisora

```text
Zadanie: SA-xxx
Decyzja: AKCEPTACJA | POPRAWKI WYMAGANE | ODRZUCONE
Uzasadnienie: <checklist §3 — co sprawdzono z naciskiem na Złożoność Algorytmiczną i Czystość Pamięciową>
Uwagi/poprawki: <lista konkretnych punktów technicznych z propozycją zmiany, jeśli POPRAWKI WYMAGANE>
Rekomendacja dla właściciela: <np. „gotowe do wersji stabilnej” / „poczekać do końca fazy”>
```
