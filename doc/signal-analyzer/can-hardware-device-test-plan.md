# Fizyczna kwalifikacja urządzeń CAN — plan następnego etapu

**Status:** następny aktywny etap po stabilizacji hosta 2026-08-31
**Zakres:** ESP32-S3 Isolated CAN przez USB i TCP, posiadany PCAN-compatible oraz CANable 2.0
**Bramka:** wynik sprzętowy wymagany przed oznaczeniem któregokolwiek providera jako produkcyjny
**Bezpieczeństwo:** wyłącznie izolowany stół; nigdy pojazd, maszyna ani instalacja produkcyjna

## 1. Cel i stan wejściowy

Zielone testy TypeScript potwierdzają stabilność kodeków, symulatora, UI i hostowej
polityki bezpieczeństwa. Nie potwierdzają działania sterownika, firmware, izolacji,
timestampów ani rzeczywistego nadania na magistrali. Produkcyjne discovery pozostaje
puste, a fizyczny TX ESP32 jest fail-closed do czasu wdrożenia i potwierdzenia pełnego
`HELLO -> CAPABILITIES -> AUTH -> SET_TX_POLICY -> ARM_TX -> TX_RESULT`.

Etap kończy się osobnym wynikiem dla każdego fingerprintu urządzenia:

- `BENCH_VERIFIED` — wszystkie obowiązkowe testy PASS;
- `CAPTURE_ONLY` — RX jest stabilny, ale TX/safety nie przeszedł;
- `DEGRADED` — zmienił się firmware, driver lub zachowanie;
- `BLOCKED` — urządzenie albo backend nie spełnia wymagań bezpieczeństwa.

## 2. Stanowisko i wyposażenie

Minimalne stanowisko:

1. badane urządzenie oraz niezależny, wcześniej sprawdzony drugi interfejs CAN;
2. izolowana magistrala z dwoma terminatorami 120 Ω, po wyłączeniu około 60 Ω między
   CAN-H i CAN-L;
3. zasilacz laboratoryjny z ograniczeniem prądu i fizycznym wyłącznikiem;
4. oscyloskop lub analizator stanów logicznych do pomiaru E-STOP i jitteru;
5. generator ruchu CAN albo drugi kontroler zdolny do ACK;
6. host Windows dla PCAN-Basic oraz — jeśli dostępny — host Linux/SocketCAN do
   niezależnego porównania śladu;
7. odłączone elementy wykonawcze DUT i brak połączenia z prawdziwym pojazdem.

Przed włączeniem TX operator zapisuje bitrate, terminację, masy, limit prądu,
allowlistę ID, maksymalny FPS, maksymalny bus load i limit czasu ARM.

## 3. Inwentaryzacja fixture

Dla każdego egzemplarza trzeba zapisać bez zgadywania:

```text
fixtureId:
device family:
PCB/hardware revision:
USB VID/PID/serial/path:
Ethernet MAC/IP (jeżeli dotyczy):
firmware version + build hash:
driver/API/backend version:
CAN controller/transceiver:
galvanic isolation: YES / NO / UNKNOWN:
termination: internal / external / UNKNOWN:
supported bitrate/modes from probe:
host OS + Node/Theia commit:
```

Zmiana firmware, drivera, PCB albo identyfikacji USB unieważnia wcześniejszy wynik
`BENCH_VERIFIED` do czasu ponownego przejścia skróconej kwalifikacji.

## 4. Kolejność wykonania

### HIL-0 — preflight bez magistrali

- sprawdzić start w `DISARMED` i bez fikcyjnych capabilities;
- potwierdzić stabilny fingerprint po reconnect i zmianie portu COM/adresu IP;
- zweryfikować wersję firmware/drivera oraz źródło deklaracji izolacji;
- potwierdzić, że brak biblioteki, auth lub urządzenia daje jawny błąd, a nie sukces;
- dla ESP32 przejść golden vectors TCAN wspólne dla firmware i TypeScript.

**PASS:** brak TX, brak fałszywego urządzenia i kompletna, powtarzalna tożsamość.

### HIL-1 — pasywny RX

- rozpocząć w listen-only przy 125, 250, 500 kbit/s oraz 1 Mbit/s, jeżeli sprzęt
  deklaruje dany bitrate;
- odebrać standardowe i rozszerzone ID, DLC 0–8 oraz kontrolowany RTR;
- porównać liczbę, kolejność, payload i timestampy z interfejsem referencyjnym;
- wymusić fragmentację transportu, burst i wolny frontend;
- wykonać 10 minut przy 100% obciążenia oraz 8 godzin przy obciążeniu typowym;
- każda strata musi mieć `GAP_EVENT` i zgodny licznik, nigdy cichą lukę.

**PASS:** brak niewyjaśnionej utraty, brak zamrożenia UI/backendu, poprawny cleanup.

### HIL-2 — ograniczony TX

- użyć jednego testowego ID z allowlisty i rozpocząć od 1 FPS;
- potwierdzić ramkę na niezależnym interfejsie, nie przez local echo badanego drivera;
- sprawdzić standard/extended, DLC 0 i 8 oraz dokładny payload;
- zwiększać tempo stopniowo do limitu profilu, mierząc bus load i błędy;
- ID poza allowlistą, zły DLC, niepoprawny token i niebezpieczny UDS muszą zostać
  odrzucone przed wywołaniem drivera;
- statusy `queued`, `driver accepted`, `on-bus` i `DUT response` pozostają rozdzielone.

**PASS:** na magistrali pojawiają się wyłącznie dozwolone ramki, bez burstu po
opóźnieniu i bez przedstawiania echo jako ACK.

### HIL-3 — STOP, bus-off i fault injection

- wypełnić hostową i urządzeniową kolejkę TX, następnie wywołać E-STOP;
- zmierzyć czas od poprawnego odebrania komendy do braku nowych TX; dla ESP32 cel
  wynosi maksymalnie 20 ms;
- odłączyć USB, Ethernet, CAN-H/CAN-L, zasilanie DUT i heartbeat w osobnych próbach;
- wymusić error-passive i bus-off na bezpiecznym fixture;
- po każdym błędzie potwierdzić `DISARMED/FAULT`, pustą kolejkę i brak automatycznego
  wznowienia po reconnect;
- wykonać 100 cykli start/stop i 100 reconnectów bez wycieku uchwytów lub timerów.

**PASS:** żadna ramka nie jest planowana po cutoff, a ponowny TX wymaga nowego ARM.

### HIL-4 — ESP32 USB kontra TCP

- uruchomić ten sam zapisany scenariusz przez USB CDC i TCP;
- porównać RX, `deviceTicks`, TX order, GAP i statusy po mapowaniu zegara;
- sprawdzić pojedynczy control lease: USB owner blokuje TCP i odwrotnie;
- zerwanie transportu właściciela rozbraja urządzenie;
- TCP wymaga auth przed TX; brak/niepoprawny sekret może co najwyżej dać jawny
  capture-only, jeżeli firmware ma taki zatwierdzony profil;
- opcjonalny UDP testować wyłącznie dla RX: loss, duplicate, reorder i fallback.

**PASS:** semantyka sesji jest taka sama; różnią się tylko zmierzone opóźnienia.

### HIL-5 — PCAN-compatible i CANable 2.0

Najpierw kwalifikowany jest posiadany, działający `PCAN-COMPAT-01`, następnie
CANable 2.0. Przed testami trzeba zastąpić obecne fixture'y testowe rzeczywistym
discovery i sterownikiem:

- PCAN: dynamiczny PCAN-Basic/SocketCAN, initialize, event-driven RX, write,
  status, bus-off, reset i uninitialize;
- CANable: rzeczywisty port SLCAN albo jawnie rozpoznany `gs_usb`, komendy bitrate,
  open/close, parser strumieniowy, hot-unplug i timestamp capability;
- brak opcjonalnego sterownika nie może blokować uruchomienia Theia;
- izolacja i CAN FD pozostają `UNKNOWN/false`, dopóki dokładny fingerprint nie
  przejdzie pomiaru.

Każdy adapter przechodzi HIL-0…HIL-3 osobno. Wyniku jednego klona nie przenosi się
na inny egzemplarz tylko na podstawie nazwy handlowej.

## 5. Macierz obowiązkowa

| Fixture | Transport/backend | RX | TX | E-STOP/fault | Soak | Wymagany wynik |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ESP32-S3 CAN | USB CDC/TCAN | tak | tak | tak | 8 h RX / 1 h TX | `BENCH_VERIFIED` |
| ESP32-S3 CAN | TCP/TCAN | tak | tak + AUTH | tak | 8 h RX / 1 h TX | `BENCH_VERIFIED` |
| PCAN-COMPAT-01 | PCAN-Basic lub SocketCAN | tak | tak | tak | 8 h RX / 1 h TX | `BENCH_VERIFIED` |
| CANable 2.0 | SLCAN | tak | tak | tak | 8 h RX / 1 h TX | min. `CAPTURE_ONLY`, docelowo `BENCH_VERIFIED` |
| CANable 2.0 | `gs_usb` opcjonalnie | tak | tak | tak | 8 h RX / 1 h TX | osobny wynik firmware |

## 6. Artefakty dowodowe

Każde uruchomienie zapisuje katalog:

```text
artifacts/hardware-validation/<YYYY-MM-DD>/<fixtureId>/<runId>/
  manifest.json
  host.log
  device.log
  can-reference.log
  experiment.json
  report.md
  timing.csv
  scope/                    # zrzuty E-STOP/jitter, jeśli wymagane
```

`manifest.json` zawiera fingerprint, wersje, commit Git, topologię, bitrate,
terminację, limity safety i hash każdego artefaktu. Sekretów parowania, kluczy API,
pełnych danych klienta ani niezanonimizowanych śladów pojazdu nie zapisuje się.

## 7. Warunek zakończenia etapu

Urządzenie może pojawić się w produkcyjnym discovery i otrzymać TX dopiero gdy:

1. dokładny fingerprint ma komplet dowodów HIL i wynik `BENCH_VERIFIED`;
2. wszystkie testy hosta, conformance firmware i pełny build nadal są zielone;
3. reconnect, bus-off i utrata heartbeat zawsze kończą się bez TX;
4. E-STOP spełnia budżet na pełnej kolejce;
5. supervisor zatwierdzi raport bez otwartych błędów krytycznych lub wysokich.

Pierwszy wykonywany przypadek to **ESP32-S3 przez USB w trybie capture-only**.
Aktywny TX zostaje włączony dopiero po pozytywnym HIL-0/HIL-1 i niezależnym
potwierdzeniu fizycznego odcięcia magistrali.
