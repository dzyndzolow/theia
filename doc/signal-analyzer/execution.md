# Signal Analyzer - stan wykonania i nastepny krok

Ten dokument jest zywym rejestrem wykonania. Uzupelnia `SIGNAL-ANALYZER-ROADMAP.md`, `SIGNAL-ANALYZER-TASKS.md`, rekordy w `work/` i append-only `SIGNAL-ANALYZER-CHANGELOG.md`; nie zastępuje zadnego z nich.

**Uwaga:** przed rozpoczeciem pracy kazdy wykonawca musi przeczytac `supervisor-report.md` — zawiera aktualna liste usterek, dlug techniczny i rekomendacje architektoniczne, ktorych nie ma w kartach zadan.

## Zasada zachowania planu

- Roadmap i karty zadan sa rozwijane w miare poznawania kodu. Mozna je doprecyzowac, rozszerzyc o nowe zadanie, dodac zaleznosc, prog weryfikacji albo poprawic bledne zalozenie wykryte podczas implementacji.
- Nie wolno usuwac kart `SA-xxx`, zaakceptowanych decyzji, sekcji roadmapu ani wpisow historycznych tylko po to, aby uproscic dokument. Dotychczasowa tresc jest kontekstem dla kolejnych wykonawcow.
- Gdy ustalenie przestaje obowiazywac, zachowaj je i oznacz jako `ZASTAPIONE`, podaj date, powod, decyzje wlasciciela albo supervisora oraz link do nastepcy. Nowa decyzja musi byc dopisana obok lub ponizej starej.
- Kazda korekta zakresu zadania wymaga uzasadnienia w rekordzie `doc/signal-analyzer/work/SA-xxx.md` i wpisu w `SIGNAL-ANALYZER-CHANGELOG.md` po weryfikacji. Nie wykonuj masowego przepisywania ani czyszczenia dokumentow.
- `SIGNAL-ANALYZER-CHANGELOG.md` pozostaje append-only. Nie edytuj glownego `CHANGELOG.md`, ktory nalezy do upstream Theia.

## Aktywny stan

| Zadanie | Stan | Co zostalo ustalone | Nastepny krok |
| --- | --- | --- | --- |
| SA-001 | ZAAKCEPTOWANE | Dodano backendowy entry point, tokeny DI oraz brakujaca konfiguracje kompilacji i lintu pakietu `@theia/can-bus`. Kompilacja, lint oraz ladowanie modulu i kontenera DI przeszly. | Zadanie zamkniete. |
| SA-002 | ZAAKCEPTOWANE | Symulator CAN obsługa `frameRate` (fps) oddzielona od `bitrate` (bps). (C-04). | Zadanie zamkniete. |
| SA-003 | ZAAKCEPTOWANE | RPC proxy tworzone w browserze przez `WebSocketConnectionProvider.createProxy<CanRpc>` z rejestracją klienta `onBinaryFrames` (C-01, Q-03). | Zadanie zamkniete. |
| SA-004 | ZAAKCEPTOWANE | Usunięcie innerHTML z `updateStatsDisplay()` i tabeli DOM, 20 FPS RAF throttling z czasem (Q-01). | Zadanie zamkniete. |
| SA-005 | ZAAKCEPTOWANE | Odporny transport binarny z bezstratnym kodowaniem nazw interfejsów, CRC32, ścisłą walidacją oraz śledzeniem `droppedFrames` i testem < 50ms (C-02, C-03, Q-04). | Zadanie zamkniete. |
| SA-006 | ZAAKCEPTOWANE | Stylizacja CSS widżetu na zmiennych Theia oraz komponent `FpsCanvasRenderer` z paletą kolorów motywu z `getComputedStyle` (Q-02). Kompilacja, lint, testy (23/23 passing). | Zadanie zamkniete. SA-007 i SA-008 moga byc rezerwowane. |
| SA-007 | ZAAKCEPTOWANE | Rejestracja `@theia/can-bus` w `examples/browser/package.json` oraz pomyślne wygenerowanie wpisów `src-gen/frontend` i `src-gen/backend` bez błędów budowania (0 errors). | SA-008 moze byc zarezerwowane. |
| SA-008 | ZAAKCEPTOWANE | Stworzenie dokumentacji technicznej `can-bus.md` z diagramami Mermaid przepływu danych binarnych oraz aktualizacja indeksu `README.md`. | Koniec Fazy 0. Gotowe do Fazy 1 (SA-101). |
| SA-101 | ZAAKCEPTOWANE | Stworzenie szkieletu `@theia/signal-core` z restrykcyjnymi opcjami TypeScript, zintegrowanego z kompilacją Lerna. | SA-102 może być zarezerwowane. |
| SA-102 | ZAAKCEPTOWANE | Implementacja zamrożonych kontraktów systemowych (`SampleBlock`, `ProtocolAnnotation`, `DecoderProvider`, `AnnotationQuery`, itp.) z `readonly` oraz Branded Types bez typu `any`. (3/3 testy passing, 100% coverage). | SA-103 może być zarezerwowane. |
| SA-103 | ZAAKCEPTOWANE | Implementacja `RingSampleStore` i `ChunkedIntervalTree` z podziałem blokowym i benchmarkami DoD < 10ms dla 100k elementów. (10/10 testy passing, 98.5% coverage). | SA-104 może być zarezerwowane. |
| SA-104 | ZAAKCEPTOWANE | Implementacja maszyny stanów `CaptureSession` (`STOPPED` -> `CAPTURING` -> `PAUSED` -> `STOPPED`) z obsługą `InvalidStateException` oraz modelu `SignalChannel`. (14/14 testy passing, 100% lines coverage dla modułu stanu, 99.05% dla pakietu). | SA-105 może być zarezerwowane. |
| SA-105 | ZAAKCEPTOWANE | Integracja pakietu `@theia/can-bus` z `@theia/signal-core` poprzez adaptery typów `canFrameToAnnotation` / `annotationToCanFrame`. (24/24 testy can-bus passing, 96.95% coverage; 14/14 testy signal-core passing, 99.05% coverage). | SA-106 może być zarezerwowane. |
| SA-106 | ZAAKCEPTOWANE | Stworzenie dokumentacji technicznej `signal-core.md` z opisem kontraktów, buforów, maszyny stanów oraz diagramem sekwencji Mermaid. | Koniec Fazy 1. Gotowe do Fazy 2 (SA-201). |
| SA-201 | ZAAKCEPTOWANE | Implementacja `DecoderRegistry` i sortowania topologicznego w oparciu o Algorytm Kahna $O(V+E)$ bez wywołań rekurencyjnych z notyfikacjami zdarzeniowymi. (22/22 testy passing, 98.1% coverage, 100 węzłów DAG bez stack overflow). | SA-202 może być zarezerwowane. |
| SA-202 | ZAAKCEPTOWANE | Implementacja `WorkerDecoderEngine` oraz `decoder-worker.ts` z obsługą Transferable Objects, opcjonalnym SharedArrayBuffer + Atomics oraz zapobieganiem Zombie Workers (`terminate()`). (26/26 testy passing, 95.74% coverage). | SA-203 może być zarezerwowane. |
| SA-203 | ZAAKCEPTOWANE | Implementacja `DecoderCircuitBreaker` (CLOSED, OPEN, HALF_OPEN) i `AnnotationValidator` do tworzenia adnotacji błędu (`GAP`, `RESYNC`, `DECODER_FAULT`). (32/32 testy passing, 95.42% coverage). | SA-204 może być zarezerwowane. |
| SA-204 | ZAAKCEPTOWANE | Implementacja `CanDecoderProvider` w `@theia/can-bus` z pełną obsługą kontraktu `DecoderProvider` z `@theia/signal-core`, zero-copy DataView/BigInt oraz generatorami asynchronicznymi. (26/26 testy passing, 96.69% coverage). | SA-205 może być zarezerwowane. |
| SA-205 | ZAAKCEPTOWANE | Implementacja `UartDecoderProvider` w `@theia/signal-core` z opcjami baudrate/parity/stopBits i weryfikacją błędów framingu. (34/34 testy passing, 95.09% coverage). | Zadanie zamknięte. |
| SA-206 | ZAAKCEPTOWANE | Stworzenie dokumentacji technicznej Fazy 2 `decoders-architecture.md` opisującej algorytm Kahna, cykl życia WebWorkera, zero-copy, Circuit Breaker i dekodery CAN/UART z diagramami Mermaid. | Koniec Fazy 2. Faza 3 (SA-301+) gotowa do realizacji. |
| CAN-FIX | ZAAKCEPTOWANE | Naprawa błędu `stopCapture` dla nieprzypisanych widżetów oraz dodanie rozwijanego menu `Source:` w `CanMatrixWidget` pozwalającego wybierać dane z dowolnego otwartego `CAN Bus Analyzer`. (37/37 testy passing). | Gotowe do Fazy 3 (SA-301). |
| CAN-PLOT | GOTOWE DO REWIZJI | Widżet **CAN Value Analyzer** w `@theia/can-bus`: izolacja pola ładunku (np. bajty 4–5) ramki o danym CAN ID i wykres wartości w czasie. Otwierany przyciskiem **Plot Value** w CAN ID Matrix, prekonfigurowany z wiersza Matrixa + Payload Inspector + Typed Field Decoder. Podstawa czasu 1 ms–1 s oraz tryb auto (5 × estymowany okres). Zero-allocation: pierścień `Float64Array`, parsowanie koperty binarnej bez obiektów ramek. (76/76 testy passing, 26 nowych). | Oczekuje na rewizję supervisora; potem Faza 3 (SA-301). |

| GLOBAL-VARS | ZAAKCEPTOWANE | Centralny rejestr globalnych zmiennych w stylu PLC: kontrakty, rejestr `GlobalVariableRegistry` z walidacją 11 typów, wersjonowaniem, snapshotami JSON oraz widżet `GlobalVariablesWidget` z edytowalną tabelą i importem/eksportem. (52/52 testy signal-core, 79/79 testy can-bus passing). | Zadanie zakończone. |

## Kolejnosc pracy teraz

1. Faza 0 (`@theia/can-bus`, SA-001..SA-008), Faza 1 (`@theia/signal-core`, SA-101..SA-106) oraz Faza 2 (SA-201..SA-206) zostały w pełni ukończone, przetestowane i udokumentowane.
2. Naprawiono usterkę niepoprawnego wywoływania stopCapture oraz zaimplementowano dynamiczny wybór źródła analizatora w widżecie CAN ID Matrix.
3. Dodano widżet CAN Value Analyzer (rekord CAN-PLOT, GOTOWE DO REWIZJI) — wykres wartości pojedynczego pola ramki w czasie, otwierany z CAN ID Matrix.
4. Następne zadanie: Faza 3 — SA-301 (`@theia/signal-ui` i `ViewportController`), po akceptacji CAN-PLOT.
5. Pełny plan i dowody są w `supervisor-report.md`; nie zastępuj go streszczeniami w rekordach zadań.

## Rekomendacja dla kolejnego modelu

Rozpocznij od **SA-002**, nie od SA-003 ani od przebudowy SA-001.

1. Przeczytaj karte SA-002, ten dokument, `doc/signal-analyzer/work/README.md` i `TEMPLATE.md`, a potem utworz `work/SA-002.md` oraz zarezerwuj zadanie w rejestrze.
2. Zachowaj tokeny `CanSocketService` i `CanRpcService` z `src/node/can-backend-module.ts`. SA-002 moze dodac tylko binding `CanSocketServiceImpl`; nie dodawaj jeszcze RPC, klienta frontendowego, binarnego transportu ani wpisu do aplikacji przykladowej.
3. Najpierw zaprojektuj testowalny adapter sprzetowy oraz deterministyczny symulator. Test start/stop powinien korzystac z zamokowanego uplywu czasu i sprawdzac zwolnienie timera; nie stosuj busy-wait ani bibliotek natywnych.
4. Przed przekazaniem pracy uruchom co najmniej testy SA-002, `npx lerna run compile --scope @theia/can-bus` i `npx lerna run lint --scope @theia/can-bus`. Zapisz wyniki w rekordzie i dopisz changelog dopiero po pomyslnej weryfikacji.
5. Jesli implementacja ujawni brak zakresu, konflikt kontraktu albo koniecznosc zmiany tokenow, oznacz rekord jako `BLOCKED`. Rozwijaj odpowiednia karte lub roadmap zgodnie z zasadami tego dokumentu, ale nie usuwaj dotychczasowej tresci.

## Obszary wymagajace uwagi

- Nie rozszerzaj SA-001 o socket, RPC, transport binarny ani zmiany wydajnosciowe widgetu. Te granice naleza odpowiednio do SA-002, SA-003, SA-005 i SA-004.
- Tokeny `CanSocketService` i `CanRpcService` sa punktem przekazania miedzy zadaniami. Ich zmiana wymaga decyzji supervisora i aktualizacji rekordow zadan zależnych.
- Jesli kod ujawni blokujacy blad w istniejacym pakiecie, napraw tylko minimum potrzebne do przejscia wymaganej weryfikacji, udokumentuj powod i dodaj plik do dozwolonego zakresu karty. Nie obchodz problemu przez obnizanie rygoru TypeScript, wylaczanie lintu ani usuwanie tresci planu.

## Mapa rownoleglosci zadan (Faza 0 — stan po SA-003)

Ponizej pokazano, ktore zadania moga byc wykonywane jednoczesnie przez roznych agentow po zakonczeniu SA-003. Decyzja opiera sie na wylacznie na rozlacznych `Plikach dozwolonych` i spelnionych zaleznosciach DAG.

```
SA-003 (AKCEPTACJA)
    |
    +-- SA-004 (can-widget.ts, ring-buffer.ts)  ----+
    |                                                |-- ROWNOLEGLE (rozne pliki)
    +-- SA-006 (can-widget.css, fps-canvas.ts)  -----+
    |
    +-- SA-004 (can-widget.ts) -- SEKWENCYJNIE --> SA-005 (can-widget.ts + can-rpc-service.ts)
    |
    +-- SA-007 (examples/browser/package.json) -- ROWNOLEGLE z SA-004/SA-006 (rozne pliki)
    |
    +-- SA-008 (doc/signal-analyzer/can-bus.md) -- ROWNOLEGLE z kazdym (dokumentacja)
```

**Wniosek:** po zakonczeniu SA-003 mozna rownolegle uruchomic **SA-004 + SA-006 + SA-007 + SA-008** (cztery zadania jednoczesnie). SA-005 musi poczekac na SA-004 (wspoldzieli `can-widget.ts`).

## Ograniczenia rownoleglosci — podsumowanie

- **Mozliwe:** zadania z calkowicie rozlacznymi `Plikami dozwolonymi`, spelnionymi zaleznosciami DAG i roznymi pakietami.
- **Niemozliwe:** zadania dotykajace tego samego pliku zrodlowego, plikow globalnych (roadmap, tasks, changelog, work/README, execution.md, doc/README) oraz zadania, gdzie jedno wymaga API drugiego przed jego akceptacja.
- **Zawsze sekwencyjne:** pliki globalne (patrz `doc/signal-analyzer/work/README.md` — tabela plikow globalnych). Agent modyfikuje je jako ostatni krok przed `GOTOWE DO REWIZJI`, po upewnieniu sie, ze zaden inny agent nie robi tego samego.
- **BLOCKED przy konflikcie:** jesli agent wykryje, ze plik z jego karty jest juz w tabeli `Pliki wspoldzielone (aktywne)`, nie rezerwuje zadania — zglasza `BLOCKED` supervisorowi.

## Szablon wpisu po kroku wykonawczym

Po istotnym kroku dopisz krotko:

- **Data i zadanie:**
- **Fakt potwierdzony przez kod lub test:**
- **Decyzja albo zalecenie:**
- **Nastepny krok i zaleznosc:**
- **Ryzyko lub powod obserwacji:**

Ten sam fakt powinien trafic do rekordu zadania, a po pomyslnej weryfikacji takze do changelogu.
