# Plan stabilizacji obecnej funkcjonalności

**Data decyzji:** 2026-08-20

**Status:** `UKOŃCZONE — IMPLEMENTACJA I WERYFIKACJA STAB-01…STAB-09 ZAKOŃCZONE`

**Zakres:** `@theia/can-bus`, `@theia/signal-core`, Global Variables, CAN ID Matrix, Frame Payload Inspector, Typed Field Decoder i CAN Value Plot

## 1. Cel

Celem tej bramki jest uzyskanie stabilnej, testowalnej i zgodnej z regułami repozytorium wersji obecnej funkcjonalności. Stabilizacja nie dodaje jeszcze `CAN Analysis Repository`, `CAN Commit`, `CAN Diff` ani narzędzi agentów AI. Nowe etapy mogą korzystać wyłącznie z ustabilizowanych kontraktów czasu, próbek, zmiennych i powiązań CAN.

Obecny `CAN ID Matrix` pozostaje funkcjonalnie bez zmian. Dopuszczalne są tylko poprawki błędów, testowalności, cyklu życia i dokumentacji.

## 2. Zweryfikowany punkt wyjścia

Rewizja supervisora potwierdziła:

- `npm run compile --workspace @theia/can-bus` — OK,
- `npm test --workspace @theia/can-bus` — 82 testy przechodzą,
- `npm run compile --workspace @theia/signal-core` — OK,
- `npm test --workspace @theia/signal-core` — 52 testy przechodzą,
- `npm run build --workspace @theia/example-browser` — browser i node bundle, 0 błędów,
- działająca Theia odpowiada na porcie 3000 kodem HTTP 200.

Nieprzechodzące bramki:

- lint `@theia/can-bus`: 11 błędów,
- lint `@theia/signal-core`: 32 błędy,
- brak dedykowanych testów zachowania `ValueAnalyzerWidget`, wieloseryjnego renderera, potwierdzania zakresu INT/UINT i eksportu CSV,
- brak dostępnej przeglądarki automatyzowanej podczas rewizji; pełny test wizualny pozostaje obowiązkowym punktem odbioru.

## 3. Zadania stabilizacyjne

### STAB-01 — zerowy lint i poprawne zależności pakietów (P0)

Zakres:

- usunąć wszystkie błędy lint w `@theia/can-bus` i `@theia/signal-core`,
- dodać deklarowaną zależność `@theia/core` do `packages/signal-core/package.json`, ponieważ `capture-session.ts` importuje `Emitter` i `Event`,
- poprawić nagłówek pliku, `no-shadow`, nadmiarowe puste linie i pozostałe błędy bez wyłączania reguł globalnych,
- przypadki `null` wymagane przez zamrożony kontrakt rozwiązać spójnie: decyzją kontraktową i lokalnym, uzasadnionym wyjątkiem albo migracją z podbiciem `apiVersion`; nie stosować przypadkowych wyłączeń.

Kryterium odbioru:

```powershell
npm run lint --workspace @theia/can-bus
npm run lint --workspace @theia/signal-core
```

Oba polecenia kończą się kodem 0, bez obniżenia rygoru konfiguracji.

### STAB-02 — poprawność zakresów bitowych i dekodowania (P0)

Problem: obliczenia `(1 << bitLength)` są niepoprawne dla 32 bitów i ryzykowne dla bitu znaku. Implementacja powinna używać `BigInt` albo jawnych operacji unsigned bez przesunięcia o 32.

Zakres testów:

- `UINT` i `INT` dla 1, 8, 16, 31 i 32 bitów,
- dodatnia i ujemna wartość graniczna,
- zakres przechodzący przez granicę bajtów,
- little-endian i big-endian,
- dzielnik,
- odrzucenie zakresu wychodzącego poza payload.

Kryterium odbioru: brak utraty bitów, poprawna ekstensja znaku i wspólny wynik w `TypedFieldDecoder` oraz `CanVariableBridge`.

### STAB-03 — jeden kontrakt czasu (P0)

Przed zapisem i porównywaniem sesji należy usunąć mieszanie trzech domen czasu: czasu od startu przechwytywania, `process.hrtime` i `Date.now()`.

Docelowy kontrakt próbki powinien zawierać:

- `sequence` — monotoniczny numer w obrębie sesji,
- `timestampNs` — monotoniczny czas sesji używany do wykresów, kolejności i diffów,
- opcjonalny `wallTimeUtc` — czas kalendarzowy tylko do prezentacji i korelacji zewnętrznej,
- `clockDomain` albo identyfikator źródła zegara.

`CAN Value Plot` powinien używać czasu dostarczonego przez próbkę/rejestr, a nie zastępować go czasem odbioru, chyba że jawnie oznaczy próbkę jako `reception-time`.

Kryterium odbioru: deterministyczny test kolejności, pauzy/wznowienia i replay daje te same odstępy czasowe niezależnie od szybkości wykonania testu.

### STAB-04 — testy obecnego interfejsu i renderera (P1)

Wymagane testy:

- `CAN Value Plot` otwiera się z jedną serią, gdy istnieje zmienna numeryczna,
- można dodać kilka zmiennych do jednego wykresu i usunąć serię,
- domyślne ustawienia to 250 ms, Auto window i Auto scale Y,
- podstawa czasu, offset i ręczny zakres Y zmieniają parametry renderera,
- ukryta/przywrócona zakładka nie tworzy małego rozmytego bufora canvas,
- `renderMany` skaluje wiele serii, respektuje offset i zakres ręczny,
- potwierdzenie INT/UINT następuje dopiero po drugim kliknięciu,
- typy inne niż INT/UINT zachowują wybór kliknięciem/przeciągnięciem,
- eksport CSV ma poprawne nagłówki i escaping przecinków, cudzysłowów oraz nowych linii,
- `Export CSV` jest dostępny tylko w Global Variables.

Minimalna bramka pokrycia dla nowych modułów: 80% linii logiki nie-UI; zachowanie DOM może korzystać z testów komponentowych z kontrolowanym canvasem.

### STAB-05 — wersjonowana i atomowa mapa zmiennych (P1)

`Export Map` powinien mieć jawny `schemaVersion` i rozdzielać:

- definicje zmiennych,
- bieżące stany,
- powiązania CAN: ID, STD/EXT, interfejs, bajty/bity, typ, endianowość i dzielnik,
- konfigurację dekoderów potrzebną do odtworzenia znaczenia danych.

CSV pozostaje szybkim eksportem kontrolnym i nie musi być formatem pełnego round-trip.

Import JSON musi najpierw zwalidować cały dokument, a dopiero potem atomowo zastosować zmianę. Błąd pojedynczego rekordu nie może pozostawić częściowo zaimportowanej mapy. Należy dodać testy wersji schematu, konfliktu ID/nazwy, rollbacku oraz migracji poprzedniego formatu.

### STAB-06 — cykl życia i obserwowalność błędów (P1)

Zakres:

- wszystkie listenery, RAF, timery, Workery i Object URL muszą być zwalniane przy zamknięciu widgetu,
- uszkodzone pakiety i nieudane zapisy zmiennych nie mogą być bezgłośnie połykane,
- błędy powinny zwiększać licznik diagnostyczny i być dostępne dla UI oraz przyszłych narzędzi agenta,
- dodać test wielokrotnego otwierania/zamykania widżetów bez wzrostu liczby subskrypcji,
- dodać test przerwania importu, renderowania i przechwytywania podczas dispose.

### STAB-07 — granica względem upstream Theia (P1)

Zmiana `packages/core/src/browser/shell/view-contribution.ts` dodająca `toggleCommandLabel` narusza przyjętą zasadę minimalnych zmian w upstreamie Theia. Należy:

1. preferencyjnie przenieść własną etykietę komendy do rozszerzenia `@theia/can-bus`, albo
2. jeśli rozszerzenie API core jest rzeczywiście potrzebne, opisać je w ADR, dodać test kompatybilności i przygotować zmianę nadającą się do upstreamu.

Kryterium odbioru: brak nieudokumentowanej modyfikacji core wyłącznie dla jednego widgetu.

### STAB-08 — zgodność dokumentacji i rejestrów (P2)

Należy zaktualizować:

- `doc/signal-analyzer/can-bus.md` do aktualnego modelu Global Variables → wiele serii na jednym wykresie,
- `doc/signal-analyzer/execution.md` do bieżącego statusu i liczby testów,
- `SIGNAL-ANALYZER-CHANGELOG.md` wpisem opisującym migrację z analizatora pojedynczego pola do Value Plot zmiennych,
- raport supervisora po przejściu całej bramki.

Stare ustalenia pozostają w historii i są oznaczane jako `ZASTĄPIONE`; nie wolno ich usuwać.

### STAB-09 — higiena plików runtime (P2)

Ustalić i udokumentować politykę dla `.pioarduino-core/appstate.json` oraz `.pioarduino-core/.cache/`. Cache HTTP i identyfikatory lokalnej instalacji nie powinny regularnie brudzić drzewa roboczego ani trafiać do commitów funkcjonalnych.

## 4. Kolejność wykonania

```text
STAB-01 lint/dependencies
    |
    +--> STAB-02 bit ranges
    +--> STAB-03 time contract
    |
    +--> STAB-04 UI/renderer tests
    +--> STAB-05 variable-map schema
    +--> STAB-06 lifecycle/diagnostics
    +--> STAB-07 upstream boundary
              |
              `--> STAB-08 docs + STAB-09 runtime hygiene
                           |
                           `--> FINAL STABILITY GATE
```

STAB-02, STAB-04 i STAB-07 mogą być realizowane równolegle tylko wtedy, gdy ich listy plików są rozłączne i zostały zarezerwowane zgodnie z `work/README.md`. STAB-03 musi poprzedzać zapis sesji, replay i przyszły `CAN Diff`.

## 4.1. Postęp wdrożenia — 2026-08-20

- `STAB-01` — wykonane: lint bez błędów przy pełnym przebiegu bez cache, deklaracja `@theia/core` w `signal-core`, aktualizacja lockfile i uporządkowanie testów.
- `STAB-02` — wykonane: `CanVariableBridge` używa `BigInt` dla zakresów do 32 bitów; dodano testy `UINT`/`INT`, endianowości, zakresu przez granicę bajtu, dzielnika i odrzucania niepełnego payloadu.
- `STAB-03` — wykonane: stan zmiennej zawiera `clockDomain`, most CAN przekazuje czas ramki, `CAN Value Plot` korzysta z timestampu próbki zamiast `Date.now()`, a `CaptureSession` definiuje czas sesji i replay.
- Użytkownik potwierdził stabilność bieżącego interfejsu w Browserze; ręczna bramka dla obecnej funkcjonalności jest zamknięta.
- Punkt kontrolny przed domknięciem pozostałych zadań: `can-bus` 84 testy,
  `signal-core` 53 testy, lint bez cache i compile obu pakietów zakończone powodzeniem.
- Ten punkt został zastąpiony wpisem 4.2 po wdrożeniu kontraktu sesji/replay,
  testów UI, mapy atomowej, lifecycle, granicy upstream oraz higieny runtime.

### 4.2. Przekazanie do oceny supervisora — 2026-08-20

Wdrożono wszystkie poprawki wykonawcze z tej bramki:

- `STAB-03`: `CaptureSession` udostępnia `sequence`, monotoniczny `timestampNs`,
  `clockDomain`, metadane `wallTimeUtc`, obsługę pauzy bez doliczania czasu oraz
  replay, który zachowuje odstępy czasowe niezależnie od szybkości konsumenta.
- `STAB-04`: dodano testy DOM potwierdzenia zakresu po drugim kliknięciu,
  dekodera 32-bitowego oraz wieloseryjnego renderera z offsetem, ręcznym zakresem
  Y i HiDPI; automatyczny wybór pierwszej zmiennej numerycznej oraz ustawienia
  250 ms/Auto window/Auto scale Y są utrzymywane przez widget.
- `STAB-05`: mapa zmiennych ma `schemaVersion`, migrację starego snapshotu,
  walidację całego dokumentu i rollback importu; zawiera również powiązania CAN.
- `STAB-06`: dispose zwalnia listenery, pętle RAF i struktury inspektora, a
  uszkodzone chunki CAN są raportowane przez licznik diagnostyczny.
- `STAB-07`: usunięto jednowidgetową zmianę API core; etykieta własnej komendy
  jest rejestrowana w rozszerzeniu CAN.
- `STAB-08/09`: zaktualizowano dokumentację, changelog i politykę artefaktów
  `.pioarduino-core`; nowy cache HTTP jest ignorowany przez Git.

Wynik tej partii oznaczono jako `GOTOWE DO OCENY SUPERVISORA`, a nie jako
`STABLE / ZAAKCEPTOWANE`, ponieważ końcowa decyzja jakościowa należy do kolejnej
rewizji supervisora.

## 5. Końcowa bramka stabilności

Wersja może otrzymać status `STABLE / ZAAKCEPTOWANE` dopiero po spełnieniu wszystkich warunków:

1. Compile, lint i testy obu pakietów kończą się kodem 0.
2. Pełny build `@theia/example-browser` kończy się bez błędów.
3. Wszystkie testy STAB-02…STAB-06 przechodzą.
4. Dokumentacja opisuje aktualny, a nie historyczny interfejs.
5. Nie ma otwartych błędów P0/P1 z tej bramki.
6. Ręczny test Browser potwierdza:
   - Demo/Demo 2 i CAN ID Matrix,
   - wybór bajtów/bitów oraz bind do zmiennej,
   - eksport/import mapy,
   - wiele zmiennych na jednym CAN Value Plot,
   - offset, Auto window, 250 ms, Auto scale Y,
   - zamknięcie, restart i przywrócenie zakładek bez rozmycia lub wycieku listenerów.
7. `git diff --check` jest czysty, a status repozytorium nie zawiera przypadkowych artefaktów runtime.

Po przejściu bramki supervisor aktualizuje `supervisor-report.md`, oznacza stabilizację jako `ZAAKCEPTOWANE` i dopiero wtedy odblokowuje SA-301 oraz implementację magazynu sesji dla agentów AI.
