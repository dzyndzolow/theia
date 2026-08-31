# Signal Analyzer — Raport superwizora

**Ostatnia rewizja:** 2026-08-28
**Zakres:** Aktualny `master`, `@theia/can-bus`, `@theia/signal-core`, Global Variables, CAN ID Matrix, Frame Payload Inspector, Typed Field Decoder, CAN Value Plot oraz koncepcja narzędzi AI.
**Wynik:** Koncepcja „Git dla danych CAN” została zaakceptowana. Obecna funkcjonalność przechodzi compile, lint, testy i pełny build Browser; właściciel zamknął bramkę stabilizacyjną statusem `UKOŃCZONE` 2026-08-21.
**Wynik bieżącej rewizji:** warstwa sprzętowa SA-HW-001 oraz bramka SA-421 otrzymują `POPRAWKI WYMAGANE`; nie wolno traktować atrap ESP32/PCAN/SLCAN jako obsługi fizycznych urządzeń ani włączać aktywnego TX na ich podstawie.

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

### 2.0.7. Bramka stabilności przed Git i następny etap HIL (2026-08-31)

**Decyzja:** baza hosta CAN Device Lab jest stabilna i może zostać zapisana w Git.
Nie zatwierdza to fizycznych providerów: ESP32-S3, PCAN-compatible i CANable 2.0
pozostają nieweryfikowane do czasu wykonania planu
`can-hardware-device-test-plan.md` na izolowanym stanowisku.

Dowody przed integracją:

- `@theia/can-bus`: compile OK, lint OK, 179/179 testów;
- `@theia/signal-core`: compile OK, lint OK, 58/58 testów;
- `examples/browser`: Browser build 0 błędów, Node build 0 błędów, bundle OK;
- `git diff --check`: brak błędów whitespace; występują wyłącznie informacyjne
  ostrzeżenia o przyszłej normalizacji LF/CRLF;
- skan drzewa roboczego nie wykazał aktywnego klucza API ani prywatnego klucza;
  `.theia/settings.json` usuwa wcześniej śledzone dane uwierzytelniające. Sekret
  obecny w historii musi zostać obrócony; historia nie jest przepisywana bez
  osobnej decyzji właściciela.

Następny etap jest sprzętowy, nie kolejną demonstracją symulatora. Kolejność:

1. ESP32-S3 USB capture-only i zgodność RX z interfejsem referencyjnym;
2. device-side policy/ARM/TX_RESULT oraz zmierzony E-STOP;
3. identyczny conformance trace po TCP z AUTH i pojedynczym control lease;
4. rzeczywisty backend dla posiadanego PCAN-compatible i jego fingerprint;
5. rzeczywisty SLCAN/`gs_usb` dla CANable 2.0;
6. fault injection, 8 h RX, 1 h TX i raport `BENCH_VERIFIED` per fingerprint.

### 2.0.6. Doraźna naprawa krytycznych błędów bezpieczeństwa TX (2026-08-28)

#### Decyzja po poprawkach

**Wynik:** krytyczne obejście polityki TX i pozorne potwierdzanie transmisji zostały
usunięte. Warstwa hosta jest obecnie fail-closed. Nie oznacza to jeszcze akceptacji
SA-HW-001 dla fizycznego sprzętu: rzeczywiste ESP32-S3, PCAN i CANable pozostają
`NIEDOSTĘPNE / POPRAWKI WYMAGANE`, dopóki nie powstaną sterowniki, pełny handshake
i testy na stanowisku. Fizyczny TX ESP32 jest celowo blokowany do czasu wdrożenia
response-correlated `SET_TX_POLICY` + `ARM_TX` i weryfikacji `armToken`.

Naprawiono natychmiast:

- `CanRpcService.sendFrame()` nie wywołuje już bezpośrednio mostka sprzętowego,
  nie zwraca sukcesu przy braku adaptera i nie tworzy fałszywego echa dla sprzętu;
- ARM/DISARM jest egzekwowany w backendzie: wymaga aktywnego capture, jawnej
  niepustej allowlisty, ogranicza FPS do 1000, bus load do 70% i czas ARM do
  15 minut; profil generatora używa 250 FPS, 50% i 10 minut;
- jedna ścieżka `CanTransmitService` waliduje stan, interfejs, ID, format 11/29-bit,
  DLC, dokładną długość danych, wartości bajtów, RTR, usługi diagnostyczne,
  bus load i kroczący limit FPS odporny na równoległe wywołania;
- utrata ostatniego klienta, stop capture, zmiana interfejsu, błąd wysłania i
  E-STOP rozbrajają TX; E-STOP najpierw odcina host TX i wysyła sprzętowe
  `EMERGENCY_STOP`, a następnie zamyka capture;
- timery generatora nie nakładają już asynchronicznych wysłań; przy zajętej
  ścieżce próbka jest pomijana, a odrzucenie backendu powoduje fail-closed DISARM;
- backend dopuszcza tylko znane interfejsy wirtualne i maksymalnie osiem aktywnych
  capture; przepełniony batch stosuje O(1) drop-newest zamiast kosztownego
  `Array.shift()` dla każdej kolejnej ramki;
- usunięto z produkcyjnego discovery fikcyjne COM3, COM4, PCAN_USBBUS1, seriale,
  firmware i deklaracje izolacji. Są dostępne wyłącznie po jawnym włączeniu
  fixture'ów testowych. Ręczny TCP jest opisany jako `Unverified` z capabilities
  `UNKNOWN`;
- konfiguracja capture nie tworzy już polityki `ALLOW_ALL_11BIT_BENCH_ONLY`,
  100% bus load ani godzinnego ARM;
- numery message type i bity flag TCAN odpowiadają specyfikacji v1; `RX_BATCH`
  i `TX_BATCH` mają osobne 32-bajtowe prefiksy, `armToken` ma 64 bity, a parser
  strumieniowy sprawdza CRC nagłówka przed długością i ma ograniczony bufor z
  resynchronizacją;
- SLCAN waliduje cały wiersz, zakres ID, DLC, dokładną liczbę cyfr i wartości
  bajtów; `parseInt()` nie może już zaakceptować poprawnego prefiksu z błędnym
  ogonem.

Weryfikacja po poprawkach:

- `yarn workspace @theia/can-bus compile` — OK;
- `yarn workspace @theia/can-bus lint` — OK;
- `yarn workspace @theia/can-bus test` — **179/179 OK**;
- benchmark TCAN, Node v24.18.1, 20 000 ramek, batch 2500, encode + decode:
  mediana **17,81 ms**, p90 **22,25 ms**, min. 15,45 ms, max. 22,37 ms;
- pełny build Browser i Node — 0 błędów; końcowe bundle zatrzymane wyłącznie przez
  `EBUSY` na `conpty.node`, zablokowanym przez uruchomioną instancję Theia. Nie
  zatrzymano procesu użytkownika i nie uznano tego za dowód gotowości bundle.

Pozostałe warunki przed akceptacją urządzeń fizycznych:

1. pełny HELLO/capabilities/AUTH/control lease z weryfikacją tożsamości i
   odpowiedzi na każde polecenie oraz timeoutami;
2. rzeczywiste USB CDC/COBS i TCP z backpressure, a także sterowniki PCAN-Basic
   i CANable/SLCAN; brak biblioteki lub urządzenia ma nadal kończyć się fail-closed;
3. device-side policy, ARM token, `TX_RESULT_BATCH`, bus-off/heartbeat fault i
   potwierdzone sprzętowo E-STOP <= 20 ms przy pełnych kolejkach;
4. golden vectors współdzielone z firmware, fuzzing, testy fragmentacji oraz
   długie soak testy USB/TCP na izolowanym stanowisku.

### 2.0.5. Rekomendacje naprawy SA-HW-001 i zależnej partii CAN Device Lab (2026-08-28)

#### Decyzja i zweryfikowany stan

**Decyzja:** `POPRAWKI WYMAGANE`. SA-HW-001 i SA-421 nie spełniają obecnie bramek
wydajności, bezpieczeństwa i jakości. Statusów nie wolno zmienić na `ZAAKCEPTOWANE`
przed przejściem wszystkich kryteriów odbioru z końca tej sekcji.

Stan automatyczny w chwili rewizji:

- `yarn --cwd packages/can-bus compile` — OK;
- `yarn --cwd packages/can-bus lint` — OK;
- `yarn --cwd packages/can-bus test` — 165/165 testów przechodzi;
- benchmark SA-005 rzeczywiście egzekwuje medianę dekodowania 20 000 ramek poniżej
  50 ms; czas wyświetlany przez Mocha obejmuje także przygotowanie danych i warm-up;
- zielone testy SA-HW-001 sprawdzają głównie atrapy i zgodność kodeka z nim samym,
  nie zgodność z firmware ani fizycznymi ESP32-S3, PCAN i CANable.

Dodatkowe testy negatywne wykazały, że aktualny kod:

- akceptuje dodatkowe bajty za pełną ramką TCAN;
- zgłasza `RangeError` dla poprawnego ułamkowego timestampu hosta, np. `0.1 ms`;
- z uciętego batcha deklarującego dwie ramki emituje pierwszą zamiast odrzucić cały
  batch atomowo;
- akceptuje linię SLCAN deklarującą `DLC=8` z jednym bajtem danych;
- ufa `payloadLength` przed potwierdzeniem CRC nagłówka i nie wymusza limitu
  negocjowanego ani bezwzględnego limitu 65 535 bajtów.

#### P0 — zgodność i odporność TCAN v1

1. Zastąpić prywatny wariant protokołu implementacją dokładnie zgodną z
   `esp32-s3-can-device-protocol.md`:
   - te same numery `messageType`;
   - odpowiedź używa tego samego typu oraz flagi `RESPONSE`, a nie typu `*_ACK`;
   - komplet komend co najmniej dla `HELLO`, `AUTH`, `GET_CAPABILITIES`,
     `CONFIGURE_CAN`, capture, policy/ARM, `TX_BATCH`, `TX_RESULT_BATCH`, `CREDIT`,
     `GET_STATUS`, `TIME_SYNC`, heartbeat i `EMERGENCY_STOP`;
   - osobne, wersjonowane struktury `RX_BATCH` i `TX_BATCH`.
2. Parser envelope musi wykonywać walidację w kolejności fail-closed:
   - minimalny nagłówek, magic, wersja, `headerLength` i flagi;
   - CRC nagłówka przed zaufaniem `payloadLength`;
   - kontrola overflow oraz limit `payloadLength <= 65535` i niższy limit
     wynegocjowany;
   - dokładna długość `36 + payloadLength`, bez akceptacji ogona;
   - CRC payloadu przed dispatch;
   - resynchronizacja strumienia bez nieograniczonego wzrostu bufora.
3. `RX_BATCH` ma używać 32-bajtowego prefiksu, `deviceTicks`, `rxSequence`,
   `droppedBefore` i dokładnej walidacji wszystkich rekordów. Jeden błędny rekord
   odrzuca cały batch i tworzy diagnostykę/GAP — nigdy poprawny prefiks danych.
4. `TX_BATCH` wymaga osobnego encodera, `policyGeneration`, aktualnego `armToken`,
   atomowego admission oraz wyniku rozróżniającego kolejkę, peryferium i faktyczny
   status transmisji. Nie wolno używać `encodeRxBatch()` do nadawania.
5. `HELLO` przed sesją wysyła `sessionId=0` i `sequence=0`. Host czeka na response,
   sprawdza wersję i `deviceId`, przyjmuje `assignedSessionId`, następnie wykonuje
   capabilities i AUTH/control lease. Sam zapis do transportu nie oznacza sukcesu
   komendy.
6. Dodać wspólne golden vectors C/TypeScript/firmware, fragmentację w każdym
   możliwym offsecie, concatenation, błędne length/CRC/version/type/flags, fuzzing
   envelope/COBS/rekordów oraz test maksymalnego payloadu.

#### P0 — bezpieczeństwo aktywnego TX

1. Usunąć z `CanDeviceHardwareBridge` generowanie polityki
   `ALLOW_ALL_11BIT_BENCH_ONLY`, `maxBusLoadPercent=100` i godzinnego czasu sesji.
   Mostek ma otrzymywać zatwierdzony `CanExperimentSessionConfig` z SA-410 i nie
   może sam rozszerzać allowlisty, czasu, FPS ani obciążenia.
2. Każde configure, przełączenie endpointu/backendu, reconnect, disconnect,
   bus-off, heartbeat timeout, błąd transportu lub utrata control lease musi:
   - natychmiast rozbroić TX;
   - unieważnić token ARM;
   - opróżnić niewysłaną kolejkę;
   - zapisać jawny stan `FAULT`/`DISARMED` i powód w journalu.
3. `EMERGENCY_STOP` ma być idempotentny, korzystać z zarezerwowanej ścieżki
   sterującej i opróżniać kolejkę urządzenia maksymalnie 20 ms po poprawnym
   sparsowaniu. Test obejmuje pełną kolejkę i przeciążony RX.
4. Ethernet z możliwością TX wymaga AUTH przed control lease. Brak sekretu lub
   błąd uwierzytelnienia oznacza wyłącznie tryb bez TX. PING nie odnawia ARM.
5. `configure`, `startCapture` i `transmit` zwracają wynik dopiero po response
   urządzenia/drivera. Samo `socket.write()` lub istnienie sesji nie jest sukcesem.
6. Błędy transportu, discovery, write i close nie mogą być połykane. Każdy błąd
   musi mieć diagnostykę, cleanup i jednoznaczną zmianę stanu.

#### P0 — rzeczywiste backendy urządzeń

1. Usunąć produkcyjne, wpisane na sztywno urządzenia `COM3`, `COM4`,
   `192.168.1.150`, `PCAN_USBBUS1`, fikcyjne seriale i wersje firmware. Provider
   nieposiadający urządzenia ma zwracać pusty wynik discovery, nie urządzenie demo.
2. ESP32-S3:
   - prawdziwe discovery USB po VID/PID/serialu oraz potwierdzonym `deviceId` z
     HELLO;
   - rzeczywiste otwarcie USB CDC, COBS, ograniczony bufor, backpressure,
     hot-unplug i reconnect bez automatycznego ARM;
   - TCP z `TCP_NODELAY`, kontrolą backpressure, timeoutami i obsługą
     `error/close/end`;
   - USB i TCP zgrupowane dopiero po potwierdzonej tożsamości jednego urządzenia.
3. PCAN-compatible:
   - najpierw USBCAN-001: zapisać prawdziwy fingerprint posiadanego adaptera,
     driver/backend, firmware, izolację i terminację bez domysłów;
   - wykonać spike sidecar kontra N-API i dynamicznie ładować PCAN-Basic;
   - discovery kanałów, initialize/uninitialize, event-driven RX, write, status,
     timestamp, bus-off i cleanup muszą wywoływać prawdziwe API;
   - brak biblioteki PCAN nie może blokować startu Theia.
4. CANable 2.0/SLCAN:
   - dynamiczne discovery portów i jawny wybór urządzenia;
   - prawdziwe komendy bitrate, listen-only/open/close, RX i TX;
   - parser strumieniowy odporny na fragmentację, sklejone linie i błędne znaki;
   - ścisłe ID, DLC 0–8 i dokładnie `DLC*2` cyfr payloadu;
   - timestamp firmware tylko po probe, inaczej jawny `HOST_RECEIVE`;
   - reconnect i hot-unplug zawsze kończą się w `DISARMED`.
5. Capabilities muszą dopuszczać `UNKNOWN` i wynikać wyłącznie z probe/drivera
   oraz kwalifikacji konkretnego fingerprintu. Nie wolno zakładać izolacji, CAN FD,
   timestampu sprzętowego, liczby filtrów ani semantyki on-bus TX z nazwy produktu.

#### P1 — wydajność, backpressure i długie testy

1. Dodać benchmark parsera/encodera TCAN dla co najmniej 20 000 ramek CAN/s,
   obejmujący CRC, envelope, batch i mapowanie timestampów. Raport zawiera sprzęt,
   wersję Node, rozmiar batcha, medianę i p99.
2. Przeprowadzić 10 minut RX przy 100% obciążenia Classical CAN 1 Mbit/s bez
   cichej utraty. Każda utrata ma `GAP_EVENT`, liczniki i zachowaną ciągłość
   `rxSequence`.
3. Wszystkie kolejki USB/TCP/PCAN/SLCAN, registry→ingestion i IPC mają być
   ograniczone. Wymagane są credit/backpressure, kontrolowana polityka drop i
   zarezerwowana przepustowość dla STOP/status/error.
4. Batcher ma kończyć paczkę po limicie ramek, payloadu lub czasu — domyślnie
   1 ms — i nie może serializować pojedynczych ramek do JSON na hot path.
5. SA-413 wymaga indeksu czasowego lub przetwarzania strumieniowego. Obecne
   `feedbackEvents × txEvents.filter()` jest niedopuszczalne. Test miliona zdarzeń
   musi działać poza głównym wątkiem i wykazać brak długiej blokady UI.
6. Przed końcową akceptacją wykonać: 8 h RX, 1 h kontrolowanego TX, 100 reconnectów
   i 100 cykli start/stop bez wzrostu buforów, uchwytów i timerów.

#### P1 — runtime Python i niezakończone zadania SA-417…SA-424

1. Runtime Python nie jest izolowany przez samo `spawn`. Wymagane są: minimalna
   allowlista środowiska zamiast pełnego `process.env`, limity CPU/czasu/pamięci
   i kolejki, kontrolowany katalog roboczy, walidacja każdego komunikatu IPC oraz
   wymuszony kill po grace period.
2. Zaimplementować brakujące `subscribe`, `schedule` i `annotate`. Hot-reload
   zatrzymuje scheduler, usuwa subskrypcje, czeka na zakończenie starego procesu,
   ponownie waliduje konfigurację i dopiero potem uruchamia nowy proces.
3. SA-417/423 musi dostarczyć DBC, JSON/YAML z migracją, profile ISO-TP/UDS,
   KCD, ograniczony ARXML i prawidłowy round-trip CSV/JSONL/candump.
4. SA-418 musi obsłużyć typed bitfield bindings, maski, zakres, TTL, konflikty,
   RX last/time-matched, ograniczony AST, counters/CRC oraz fallbacki
   `SKIP/STOP/USE_DEFAULT/USE_LAST_VALID`.
5. SA-419 wymaga triggerów czas/RX/feedback, schedulera z kompensacją dryfu,
   maszyny stanów, safe-return, limitu głębokości RX→TX i circuit breakera.
6. SA-424 wymaga atomowego zapisu/otwarcia, manifestu i migratora, GAP, hashy
   importów/skryptów, odrzucania uszkodzonego archiwum oraz deterministycznego
   replay po restarcie aplikacji.
7. SA-421 pozostaje zamknięte do czasu akceptacji wszystkich zależności oraz
   pełnego E2E na SA-409 i izolowanym stole z fault injection.

#### P1 — porządek zadań i dokumentacji

1. Nie kontynuować SA-HW-001 jako jednego zadania zbiorczego. Utworzyć karty
   `ESPCAN-001…010` i `USBCAN-001…010` albo formalną kartę nadrzędną wskazującą
   te etapy, dozwolone pliki, zależności i osobne bramki.
2. Rekord `GOTOWE DO REWIZJI` nie oznacza `AKCEPTACJA`. Usunąć z rekordów
   stwierdzenia „zależności spełnione”, dopóki decyzja supervisora nie ma dokładnie
   wartości `AKCEPTACJA`.
3. SA-417 i SA-423 muszą mieć osobne rekordy i dowody odbioru. Rejestr nie może
   kierować obu zadań do jednego pliku, jeżeli karty mają różne zakresy i zależność
   sekwencyjną.
4. Po przejściu rewizji usunąć nieaktualne rezerwacje plików; przed nią nie
   oznaczać Fazy 4A jako całkowicie zrealizowanej.

#### Bramka ponownej akceptacji

Akceptacja może zostać nadana dopiero po dostarczeniu kompletu dowodów:

- compile, lint i pełny test pakietu są zielone;
- golden vectors TCAN są identyczne w TypeScript, emulatorze i firmware;
- obowiązkowe przypadki codec/fault/fragmentation/fuzz przechodzą, w tym co
  najmniej 10 minut fuzzingu parsera;
- 20 000 ramek/s, 10 minut pełnego RX oraz testy długotrwałe spełniają budżety
  bez cichej utraty i bez nieograniczonego wzrostu pamięci;
- ESP32 USB i TCP przechodzą ten sam conformance suite na fizycznym urządzeniu;
- posiadany PCAN-compatible oraz CANable 2.0 przechodzą kwalifikację rzeczywistego
  fingerprintu: discovery, open/configure/RX/TX/STOP/status/hot-unplug/bus-off/close;
- kontrolowany TX działa wyłącznie na izolowanym stole, z małą allowlistą,
  prawidłowym ARM i potwierdzonym STOP;
- fault injection obejmuje błędne ramki, pełne kolejki, zerwanie każdego transportu,
  utratę sensora, bus-off, heartbeat timeout i restart backendu;
- SA-406 oraz SA-409…SA-424 mają osobne pozytywne decyzje supervisora zgodne z
  grafem zależności; dopiero wtedy może zostać uruchomiona bramka SA-421;
- dokumentacja funkcjonalna opisuje zachowanie faktycznie potwierdzone testem,
  a nie plan lub atrapę.

### 2.0.4. Weryfikacja atomowości i wydajności transportu CAN (2026-08-21)

Usunięto regresję w `CanVariableBridge`: bez bindingów paczki nie są dekodowane,
a dla aktywnych bindingów CRC32 jest liczone tylko raz. `CanBinaryDecoder`
waliduje CRC i kompletny układ wszystkich ramek przed wywołaniem pierwszego
konsumenta, więc wadliwy chunk nie może już częściowo zmienić Global Variables.
Naprawiono również timestamp przejścia `PAUSED -> STOPPED` w `CaptureSession`.

Weryfikacja: compile i lint obu pakietów OK; `can-bus` 95/95 testów;
`signal-core` 58/58 testów; test dekodowania 20 000 ramek ma rzeczywisty próg
50 ms; pełny build `@theia/example-browser` zakończony z 0 błędów;
`git diff --check` OK. Lokalny pomiar bez instrumentacji coverage: mediana
walidowanego dekodowania 3,38 ms, a ścieżka bez bindingów 0,0004 ms dla paczki
20 000 ramek. Decyzją właściciela końcowy status techniczny to `UKOŃCZONE`.

### 2.0. Decyzja superwizora — bramka stabilizacyjna obecnej funkcjonalności (2026-08-20)

**Decyzja funkcjonalna:** `AKCEPTACJA WARUNKOWA`. Aktualna wersja działa stabilnie w dotychczasowych testach i może służyć do dalszych prób manualnych.

**Decyzja jakościowa:** `POPRAWKI WYMAGANE`. Nie nadawać jeszcze statusu `STABLE / ZAAKCEPTOWANE` i nie rozpoczynać SA-301 ani implementacji magazynu sesji AI przed zamknięciem zadań P0/P1.

**Dowody pozytywne:**

- `@theia/can-bus`: compile OK, 82/82 testy przechodzą,
- `@theia/signal-core`: compile OK, 52/52 testy przechodzą,
- `@theia/example-browser`: pełny build browser/node, 0 błędów,
- uruchomiona Theia odpowiada na porcie 3000 kodem HTTP 200.

**Otwarte bramki:**

- lint: 11 błędów w `@theia/can-bus` i 32 w `@theia/signal-core`,
- brak deklarowanej zależności `@theia/core` w `@theia/signal-core`,
- niepoprawna maska dla 32-bitowych zakresów w `CanVariableBridge`,
- niespójne domeny czasu między ramką, registry i CAN Value Plot,
- brak dedykowanych testów przebudowanego widgetu/rendererów oraz nowych interakcji,
- eksport mapy nie obejmuje pełnego round-trip powiązań CAN i nie jest atomowy,
- dokumentacja i `execution.md` opisują częściowo poprzedni wariant CAN Value Analyzer,
- test wizualny Browser nie został wykonany podczas tej rewizji z powodu braku dostępnego połączenia z przeglądarką.

**Plan obowiązujący:** `doc/signal-analyzer/stabilization-current-functionality.md`, zadania STAB-01…STAB-09.

**Koncepcja AI:** `doc/ai-agent-tools.md` jest zaakceptowanym kierunkiem docelowym. Agent ma korzystać ze wspólnych serwisów i ustrukturyzowanych narzędzi, nie z DOM-u widgetów. Implementacja pozostaje zablokowana do czasu ustabilizowania kontraktu czasu, mapy zmiennych i magazynu próbek.

**Status starszych ustaleń:** sekcje 2.1…2.8 z rewizji 2026-08-05 pozostają historycznym śladem. Usterki oznaczone później jako naprawione w `execution.md` i changelogu są `ZASTĄPIONE` niniejszą rewizją; nie należy ponownie otwierać ich bez nowego dowodu regresji.

### 2.0.1. Punkt kontrolny wdrożenia poprawek jakości (2026-08-20)

> Status tego punktu: `ZASTĄPIONY` przez sekcję 2.0.3 poniżej; zachowano go
> jako historyczny zapis częściowej weryfikacji.

### 2.0.3. Przekazanie pełnej bramki do oceny (2026-08-20)

Wykonawca wdrożył pozostałe zalecenia STAB-03…STAB-09:

- CaptureSession ma uporządkowane próbki, monotoniczny czas sesyjny, domenę
  zegara, pauzę bez doliczania czasu i replay zachowujący timestampy;
- dodano testy DOM Frame Payload Inspector, Typed Field Decoder oraz rendererów
  wieloseryjnych z offsetem, ręcznym Y i HiDPI;
- mapa zmiennych jest wersjonowana, walidowana przed importem i atomowa, a
  powiązania CAN są eksportowane razem z definicjami i stanami;
- dispose i diagnostyka błędnych chunków zostały pokryte kodem i testami;
- usunięto jednowidgetową modyfikację API `@theia/core`, zaktualizowano dokumenty
  i opisano higienę `.pioarduino-core`.

Status wykonawczy: `GOTOWE DO OCENY SUPERVISORA`. Status `STABLE / ZAAKCEPTOWANE`
pozostaje celowo nieustawiony do czasu niezależnej rewizji supervisora.

Wdrożono pierwszą partię STAB-01 i STAB-02:

- lint `can-bus` i `signal-core` przechodzi w pełnym przebiegu bez cache;
- `@theia/core` jest zadeklarowane w `@theia/signal-core`, a lockfile jest zsynchronizowany;
- `CanVariableBridge` dekoduje zakresy 2–32 bitów z użyciem `BigInt`, bez przepełnienia przesunięcia 32-bitowego;
- dodano test wartości granicznych `UINT32` i `INT32`;
- `can-bus`: 83 testy przechodzą; `signal-core`: 52 testy przechodzą;
- compile obu pakietów, build `@theia/example-browser` i `git diff --check` przechodzą.

W tamtym punkcie pozostawały otwarte STAB-03–STAB-09. Ręczna bramka Browsera
dla bieżącej funkcjonalności została potwierdzona przez użytkownika. Późniejsza
sekcja 2.0.3 opisuje ich wdrożenie; decyzja `STABLE` nadal należy do supervisora.

### 2.0.2. Potwierdzenie użytkownika i kolejna partia P0 (2026-08-20)

Użytkownik potwierdził stabilność bieżącej funkcjonalności w Browserze. W tej partii zamknięto STAB-02: dekodowanie pól `UINT`/`INT` do 32 bitów używa `BigInt`, obsługuje endianowość, przejście przez granicę bajtu, dzielnik i odrzuca zakres wychodzący poza payload. Rozszerzono testy do 84 przypadków `can-bus`.

Rozpoczęto STAB-03. `GlobalVariableState` ma jawne `clockDomain`, most CAN
zapisuje timestamp ramki jako `timestampNs`, a `CAN Value Plot` używa czasu
próbki. Pełne ujednolicenie czasu sesji i replay zostało domknięte w 2.0.3.

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
| **SA-410** | Kontrakty aktywnej sesji CAN zdefiniowane | Fail-closed safety, `ARM/STOP`, event bus/journal, contribution points, allowlista, limity i semantyka lokalnego echo; zgodność z równoległym SA-409 |
| **SA-414** | Pierwszy vertical slice CAN Device Lab | Kampania, manual/RX-delta, kalibracja, sham/seeded replay, identify/dual/omission, keep-alive i sekwencje E2E na SA-409 |
| **Koniec Fazy 4A** | SA-421 zakończone | SA-409 + izolowany stół, timing, fault injection, zewnętrzne sensory, import, composer, generatory, Python i reprodukowalny pakiet SA-424 |
| **Koniec Fazy 5** | SA-505 zakończone | AI + porównania — agent, anomalie, DTW, libsigrokdecode |
| **Koniec Fazy 6** | SA-604 zakończone | Ekosystem — Plugin API, trigger engine, CRDT, N-API |

**Aktualizacja planu 2026-08-28:** aktywna Faza 4A dodaje trzy bramki. Industrial Protocol Analyzer pozostaje wstrzymany operacyjnie, więc jego bramki nie uruchamiają rewizji do ponownej decyzji właściciela. Nowy raport superwizora powstaje w każdej aktywnej bramce i jest dopisywany do tego pliku.

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
8. **Bezpieczeństwo** — brak `innerHTML` z danymi zewnętrznymi, brak swallow exceptions, limity buforów; dla aktywnego CAN dodatkowo fail-closed `ARM/STOP`, limity TX/bus-load, bus-off auto-stop i pełny journal.

---

## 5. Historia (archiwum)

> Poprzednie wpisy superwizora będą dopisywane tutaj przy kolejnych bramkach.
> Nie usuwać — każdy wpis to kontekst dla następnych rewizji.

### 2026-08-05 — Faza 0 po SA-006 (pierwsza rewizja)

- **Zakres:** SA-001…SA-006
- **Wynik:** 22/22 testów ✅, kompilacja ✅, lint ✅
- **Usterki:** 5 (szczegóły w §2.1)
- **Decyzja:** Faza 0 może być kontynuowana. SA-007 i SA-008 nie są blokowane.
