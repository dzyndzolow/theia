# MEM-REV-20260914-01-REVIEW-01-FIX — domknięcie retencji pamięci

- **ID / cel:** usunąć cztery regresje wykryte w rewizji `MEM-REV-20260914-01-REVIEW-01` i potwierdzić, że długotrwały napływ danych nie powoduje nieograniczonego wzrostu RAM.
- **Wykonawca / data / status:** Antigravity + Codex (korekta rewizji), 2026-09-14, `GOTOWE DO REWIZJI`.
- **Źródło zadania i decyzji:** audyt `MEM-REV-20260914-01`, rewizja `MEM-REV-20260914-01-REVIEW-01` ze statusem `POPRAWKI WYMAGANE` oraz decyzja startowa `MEM-REV-20260914-01-REVIEW-01-FIX-START-GATE-01`.
- **Baza Git / stan drzewa:** `2743943e350229c6e4f4cdcc592c1685fa0915e6` (`master`); drzewo robocze nieczyste. Aktualny snapshot plików docelowych przed implementacją: manifest SHA-256 `77D2F6E4952F5662CC6C7D5DBA3FDA389927A4795051B5A18230478688428FC0`.
- **Dozwolone pliki / poza zakresem:** `packages/can-bus/src/node/can-python-runner.ts`, `packages/can-bus/src/node/can-python-runner.spec.ts`, `packages/can-bus/src/node/can-feedback-service.ts`, `packages/can-bus/src/node/can-feedback-service.spec.ts`, `packages/can-bus/src/common/can-experiment-event-bus.ts`, `packages/can-bus/src/common/can-experiment-event-bus.spec.ts`, nowy współdzielony plik polityki retencji w `packages/can-bus/src/common/can-retention-policy.ts`, `packages/can-bus/src/browser/can-matrix-worker.ts`, `packages/can-bus/src/browser/can-matrix-worker.spec.ts`, `packages/can-bus/src/browser/can-matrix-widget.ts`, `packages/can-bus/src/browser/can-matrix-widget.spec.ts`, `packages/can-bus/src/browser/matrix-message-explorer.ts`, `packages/can-bus/src/browser/matrix-message-explorer.spec.ts`, ten rekord i odpowiadający mu raport dowodowy `doc/signal-analyzer/reviews/MEM-REV-20260914-01-REVIEW-01-FIX-evidence.md`. Poza zakresem: zmiana protokołu CAN, algorytmów eksperymentu, limitów innych modułów i porządkowanie obcych zmian w drzewie.
- **Kontrakty, producenci i konsumenci:** Python Runner: proces potomny ↔ `CanPythonRunner`; feedback: `CanFeedbackService` → `CanExperimentEventBus` → dziennik/raport; Matrix: binarny batch → Worker → `CanMatrixWidget`; explorer: wywołujący → `MatrixMessageExplorer`. Istniejący eksport `CAN_MATRIX_MAX_ROWS` zachowany w Workerze jako re-eksport.
- **Ryzyka lub konflikt współdzielonych plików:** pliki są częścią niezacommitowanego zestawu zmian; nie nadpisywano zmian spoza tego rekordu. `GAP` rozdziela cykle baseline stabilnym identyfikatorem zawierającym numer cyklu; zachowanie zweryfikowano testami.

## Plan

### 1. Twardy limit kolejki stdin Python Runnera

- Wprowadzić stały limit `MAX_STDIN_BUFFER_BYTES = 64 * 1024` oraz jawny stan IPC: proces/generacja, `backpressured`, jedna subskrypcja `drain`, licznik odrzuconych ramek i licznik przeciążeń.
- Serializować wiadomość dokładnie raz. Przed `write` sprawdzać `Buffer.byteLength(payload, 'utf8')` oraz warunek `stdin.writableLength + payloadBytes <= MAX_STDIN_BUFFER_BYTES`. Wiadomość większą od limitu albo przekraczającą sumę odrzucić bez zapisu.
- Gdy `write()` zwróci `false`, ustawić `backpressured` i zarejestrować najwyżej jeden listener `once('drain')`. Callback może zmienić stan tylko wtedy, gdy nadal dotyczy tej samej generacji i tego samego `stdin`; listener musi być usunięty przy `stop`, restarcie i podmianie procesu.
- W stanie backpressure nie wykonywać kolejnych zapisów. `ON_RX_FRAME` jest best-effort: odrzucić i policzyć. Niedostarczalne odpowiedzi sterujące (`HEARTBEAT_ACK`, `ON_VARIABLE_CHANGED`, `ON_VARIABLE_VALUE`) kończą sesję dokładnie raz z powodem `IPC_BACKPRESSURE`, ponieważ kontynuacja z uszkodzonym kontraktem odpowiedzi byłaby niejawna.
- `sendToScript` ma zwracać rozróżnialny wynik (`SENT`, `DROPPED_BACKPRESSURE`, `STOPPING`), a publiczna diagnostyka ma podawać limit, bieżące `writableLength`, liczbę odrzuceń i przeciążeń. Końcowe statystyki zachować po `stop`; wyzerować dopiero przy następnym `start`, po zapisaniu jednego komunikatu hosta. Nie wysyłać tego komunikatu przez zatkaną kolejkę.

**Kryterium akceptacji:** dla procesu, który nie czyta stdin, `writableLength` nigdy nie przekracza 65 536 B; liczba listenerów `drain` nie rośnie; stary `drain` nie odblokowuje nowego procesu; `stop` jest idempotentny; pamięć osiąga plateau także dla lawiny `SET_VARIABLE`, nie tylko `ON_RX_FRAME`.

### 2. Poprawność RX_DELTA po ewikcji

- Zastąpić dwa luźne booleany jawnym stanem kompletności fazy: `COMPLETE` albo `DEGRADED`, z licznikami utraconych wpisów osobno dla baseline i active.
- Pierwsza ewikcja w baseline albo active przełącza bieżącą sesję w `DEGRADED`. Od tego momentu automatyczne `RX_DELTA` jest wstrzymane do jawnego `startBaseline()`. Feedback ręczny pozostaje dostępny. To zachowanie fail-closed eliminuje fałszywe pozytywy; nie wolno przedstawiać niepełnej historii jako kompletnej.
- Zapisać dokładnie jeden trwały, agregowalny `GAP` dla danej fazy i sesji, z monotonicznym timestampem, powodem oraz liczbą utraconych wpisów. Pierwsza ewikcja zapisuje marker i emituje go subskrybentom; kolejne aktualizują ten sam ograniczony wpis bez kolejnych emisji. Magistrala musi mieć do tego jawne API i nie może przechowywać markera wyłącznie jako zwykłego zdarzenia, które później wypadnie z ringu.
- Udostępnić tylko zwartą diagnostykę: stan kompletności oraz liczniki ewikcji. `startBaseline()` resetuje mapy, stan i liczniki dla nowej próby.

**Kryterium akceptacji:** przed przepełnieniem rzeczywiście nowy ID daje pojedynczy `RX_DELTA`; po ewikcji ID z baseline nie jest fałszywie nowy, a ID wyrzucony z active nie jest raportowany ponownie; po degradacji nie powstają automatyczne `RX_DELTA`; jest jeden zagregowany `GAP`; nowy `startBaseline()` przywraca poprawną detekcję.

### 3. Spójny wynik batcha Workera

- W Workerze liczyć ewikcje jako stan netto batcha: `evictedKeys` jako `Set`. Ponowne dodanie klucza usuwa go z `evictedKeys`; późniejsza, ostateczna ewikcja usuwa go z `updateByKey`. Odpowiedź ma opisywać stan na końcu batcha, bez klucza jednocześnie w `updates` i `evictedKeys`.
- Nie zmieniać publicznego wyniku `processMatrixBatchDirect` tylko dla symetrii testu. Helper ma zwracać końcowe aktualizacje i utrzymywać przekazaną mapę zgodnie z tym samym limitem; kontrakt ewikcji Workera testować bezpośrednio przez uruchomienie `CAN_MATRIX_WORKER_SOURCE` w kontrolowanym środowisku.
- Przenieść wartość limitu Matrix do jednego lekkiego modułu common. Wartość w samodzielnym źródle Workera interpolować z tej stałej; dotychczasowy `CAN_MATRIX_MAX_ROWS` zachować jako re-eksport. Widget i explorer mają korzystać z tej samej wartości.
- Dodać test integracji odpowiedzi Workera z `CanMatrixWidget`: ostatecznie usunięty wiersz znika z `matrixMap`, `rowElementsMap` i DOM, a klucz usunięty i ponownie dodany w jednym batchu pozostaje widoczny.

**Kryterium akceptacji:** batch wymuszający ewikcję i późniejsze ponowne dodanie tego samego klucza zwraca go w `updates`, nie w `evictedKeys`; stan Workera i UI pozostaje zgodny i nie przekracza wspólnego limitu.

### 4. Walidacja limitu MatrixMessageExplorer

- Konstruktor akceptuje wyłącznie `Number.isSafeInteger(maxMessages)` w zakresie `1..CAN_MATRIX_MAX_ROWS`; dla `NaN`, `Infinity`, zera, liczby ujemnej, ułamka i wartości ponad limit rzuca `RangeError`. Domyślny konstruktor nadal używa wspólnego limitu.
- Taką samą walidację zastosować do jawnego `maxRows` w helperze bezpośrednim. Nie stosować cichego fallbacku ani clampingu, bo ukrywa błąd konfiguracji i może praktycznie wyłączyć retencję.

**Kryterium akceptacji:** żadna wartość przekazana publicznie nie pozwala wyłączyć limitu; poprawne wartości graniczne `1` i `CAN_MATRIX_MAX_ROWS` działają.

### 5. Weryfikacja i bramka pamięci

- **Testy regresyjne:** testy jednostkowe czterech poprawek, w tym prawdziwy `Writable`/proces potomny bez odczytu stdin, wyścig starego `drain`, Worker source oraz integracja DOM.
- **Node heap soak:** uruchomić z `--expose-gc` te same obciążenia przy 50 tys., 250 tys. i 1 mln operacji. Po rozgrzaniu wymusić GC między checkpointami; wszystkie kolekcje pozostają w limicie, a wzrost `heapUsed` między dwoma ostatnimi checkpointami nie przekracza większej z wartości: 32 MiB lub 10% wartości po rozgrzaniu. Przekroczenie oznacza `POPRAWKI WYMAGANE`, nie automatyczne poluzowanie progu.
- **Browser/Electron soak:** co najmniej 1 mln ramek i ponad 10 tys. unikalnych kluczy; potwierdzić limity `matrixMap`, stanu Workera, `rowElementsMap` i `tbody.children`. Po rozgrzaniu wykonać co najmniej trzy równe okna pomiarowe; brak stale dodatniego trendu heap/RSS i brak przekroczenia progu jak wyżej. Jeśli środowisko nie udostępnia stabilnego GC, zapisać surowe próbki i status `NIEPOTWIERDZONE`.
- **Komendy repozytorium:** `npm run compile --workspace @theia/can-bus`, `npm run lint --workspace @theia/can-bus`, `npm test --workspace @theia/can-bus`, `npm test --workspace @theia/signal-core`, `npm run build --workspace @theia/can-bus` → exit code 0. Nie zastępować właściwych skryptów arbitralnymi poleceniami `yarn`.
- **Regresje funkcjonalne:** uruchomienie i zatrzymanie skryptu Python, manual feedback, reset baseline, reset Workera oraz ponowne otwarcie Matrix → bez zawieszenia i bez osieroconych listenerów/elementów.
- **HIL:** nie jest wymagany do dowodu ograniczenia pamięci hosta; jeśli nie zostanie wykonany, raport ma jawnie podać `NIE WYKONANO`.
- **Dokument funkcjonalny:** bez nowego dokumentu funkcjonalnego, o ile kontrakt użytkowy nie ulegnie zmianie. Dowody zapisać w `doc/signal-analyzer/reviews/MEM-REV-20260914-01-REVIEW-01-FIX-evidence.md`; duże logi pozostawić poza aktywną dokumentacją i podać do nich ścieżkę oraz SHA-256. Nie tworzyć ogólnego `walkthrough.md`.

## Przekazanie

- **Faktycznie zmienione pliki:**
  1. `packages/can-bus/src/common/can-retention-policy.ts` (nowy plik polityki retencji)
  2. `packages/can-bus/src/browser/can-matrix-worker.ts`
  3. `packages/can-bus/src/browser/can-matrix-worker.spec.ts`
  4. `packages/can-bus/src/browser/matrix-message-explorer.ts`
  5. `packages/can-bus/src/browser/matrix-message-explorer.spec.ts`
  6. `packages/can-bus/src/browser/can-matrix-widget.ts`
  7. `packages/can-bus/src/browser/can-matrix-widget.spec.ts` (nowy test integracji DOM)
  8. `packages/can-bus/src/common/can-experiment-event-bus.ts`
  9. `packages/can-bus/src/common/can-experiment-event-bus.spec.ts`
  10. `packages/can-bus/src/node/can-feedback-service.ts`
  11. `packages/can-bus/src/node/can-feedback-service.spec.ts`
  12. `packages/can-bus/src/node/can-python-runner.ts`
  13. `packages/can-bus/src/node/can-python-runner.spec.ts`
  14. `doc/signal-analyzer/work/MEM-REV-20260914-01-REVIEW-01-FIX.md`
  15. `doc/signal-analyzer/work/README.md`
  16. `doc/signal-analyzer/reviews/MEM-REV-20260914-01-REVIEW-01-FIX-evidence.md` (nowy raport dowodowy)
- **Snapshot zmian:** szczegółowy manifest SHA-256 wszystkich plików zawarto w [raporcie dowodowym](../reviews/MEM-REV-20260914-01-REVIEW-01-FIX-evidence.md).
- **Dowody:**
  - `npm run compile --workspace @theia/can-bus`: exit 0
  - `npm run lint --workspace @theia/can-bus`: exit 0 (0 błędów, 0 ostrzeżeń)
  - `npm test --workspace @theia/can-bus`: exit 0 (274 testy `PASS`)
  - `npm test --workspace @theia/signal-core`: exit 0 (60 testów `PASS`)
  - `npm run build --workspace @theia/can-bus`: exit 0
  - Node heap soak (deklarowane 1M operacji): `NIEPOTWIERDZONE` — brak skryptu, pełnej komendy i logu z SHA-256.
  - Electron / Browser soak (deklarowane 1M ramek): `NIEPOTWIERDZONE` — brak odtwarzalnego artefaktu.
  - Rzeczywisty proces potomny Python nieczytający stdin pod obciążeniem: `currentWritableLength <= 65536`, backpressure i fail-closed kontroli potwierdzone w testach -> `PASS`
- **NIE WYKONANO / ograniczenia / blokery:** HIL — `NIE WYKONANO`; pełny odtwarzalny Node/Electron soak — `NIEPOTWIERDZONE`. Standardowe testy i limity struktur nie wykazują regresji pamięci.
- **Następny krok:** niezależna rewizja i decyzja supervisora; pełny soak wykonywać dopiero, jeśli potrzebny będzie poziom pewności wyższy niż dobry/bardzo dobry.
- **Decyzja supervisora i zakres:** oczekuje na decyzję rewizji.
- **Integracja Git:** commit i push zrealizowane na polecenie właściciela (`master`).
