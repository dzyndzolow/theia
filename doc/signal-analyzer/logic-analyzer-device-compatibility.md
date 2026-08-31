# Logic Analyzer — zgodność urządzeń rynkowych

**Stan analizy:** 2026-08-24

**Status implementacji:** PERSPEKTYWA ROZWOJU — integracje sprzętowe wstrzymane

**Zasada:** wpis na liście zgodności nie oznacza wsparcia, dopóki test fizycznego urządzenia nie przejdzie macierzy akceptacyjnej.

## 1. Podsumowanie

| Rodzina | Integracja | Stan | Najważniejsze ograniczenie |
| --- | --- | --- | --- |
| Sigrok | `sigrok-bridge` jako oddzielny proces | planowana | GPLv3+, różny poziom jakości sterowników |
| DSLogic Plus | upstream Sigrok dla starszej rewizji lub vendor bridge | wykonalna | nowsze PID wymagają kodu DSView |
| DSLogic U2Basic | vendor bridge DSView | wykonalna | brak wsparcia upstream libsigrok |
| ALIENTEK DL32 | bezpośredni bridge libusb po spike'u | warunkowo wykonalna | brak potwierdzenia zgodności otwartego kodu z DL32 |
| Nasz hardware | natywny provider | projektowany | wymagany prototyp i benchmark elektryczny |

## 2. Sigrok

Sigrok jest warstwą zgodności z wieloma analizatorami, oscyloskopami i urządzeniami pomiarowymi. Oficjalna lista obejmuje setki urządzeń, w tym analizatory 8-, 16- i 32-kanałowe. Źródło: [Supported hardware](https://sigrok.org/wiki/Supported_hardware).

`libsigrok` i `libsigrokdecode` są GPLv3+. Nie są linkowane do procesu Theia. Opcjonalny `sigrok-bridge`:

- jest osobnym procesem z własnym cyklem życia;
- komunikuje się przez udokumentowany binarny IPC;
- ma osobny pakiet źródłowy, informacje licencyjne i artefakty;
- może być zastąpiony zewnętrznym `sigrok-cli` w trybie zgodności;
- wymaga przeglądu licencyjnego przed dystrybucją binarną.

Format wejściowy Sigrok obsługuje logiczne słowa do 32 bitów oraz analog; nie wymusza rozbijania 32-kanałowych próbek przed zapisem. Źródło: [Formats and structures](https://sigrok.org/wiki/Formats_and_structures).

## 3. DSLogic U2Basic i Plus

Kod producenta DSView definiuje następujące tryby:

| Model | Buffer | Stream | Pamięć |
| --- | --- | --- | --- |
| U2Basic | 16 × 100 MS/s | 16 × 20, 12 × 25, 6 × 50, 3 × 100 MS/s | 64 Mbit |
| Plus | 16 × 100, 8 × 200, 4 × 400 MS/s | 16 × 20, 12 × 25, 6 × 50, 3 × 100 MS/s | 256 Mbit |

Źródła: [profile DSView](https://github.com/DreamSourceLab/DSView/blob/master/libsigrok4DSL/hardware/DSL/dsl.h), [DSLogic Plus Datasheet](https://www.dreamsourcelab.com/doc/DSLogic_Plus_Datasheet.pdf).

Rozpoznawane identyfikatory producenta:

- Plus: `2A0E:0020`, nowsze `2A0E:0030`, `2A0E:0034`;
- U2Basic: `2A0E:0029`, nowsze `2A0E:0031`, `2A0E:0035`.

Upstream Sigrok oznacza U2Basic i nowsze rewizje Pango jako nieobsługiwane. Dedykowany bridge musi więc korzystać ze zweryfikowanego kodu DSView albo z przyszłej wersji upstream po włączeniu odpowiednich zmian. Źródło: [DreamSourceLab DSLogic — models](https://sigrok.org/wiki/DreamSourceLab_DSLogic).

Oba modele są logic-only. Kanały analogowe muszą pochodzić z innego urządzenia.

## 4. ALIENTEK DL32

### 4.1. Fakty potwierdzone

Producent opisuje DL32 jako analizator cyfrowy 32-kanałowy z USB 3.0 i maksymalnym próbkowaniem 1 GS/s. Na oficjalnej stronie dostępna jest paczka programu. Źródło: [ALIENTEK DL32](https://en.alientek.com/Product_Details/58.html).

ALIENTEK udostępnia repozytorium aplikacji `atk-logic` na GPLv3+. Kod używa `libusb-1.0` oraz własnego forka `libsigrokdecode`. Źródło: [alientek-openedv/atk-logic](https://github.com/alientek-openedv/atk-logic).

W otwartym kodzie znajdują się elementy wystarczające do przygotowania prototypu sterownika:

- USB VID/PID: `1A86:FFCC`;
- interfejs libusb `0`;
- bulk OUT `0x02`, bulk IN `0x81`;
- asynchroniczne kolejki transferów;
- bloki USB wyrównane do 2048 bajtów;
- framing poleceń z nagłówkiem, końcem i CRC32;
- polecenia konfiguracji, triggera, stopu, PWM i aktualizacji firmware;
- konwersja układu danych przesyłanych z FPGA.

### 4.2. Czego nie wolno jeszcze założyć

Publiczne repozytorium i README wskazują przede wszystkim DL16, a widoczny kod UI ogranicza wybór kanałów do 16. Nie ma publicznego SDK ani oficjalnego sterownika Sigrok oznaczonego jako DL32. Nie ma zatem dowodu, że:

- DL32 używa tego samego VID/PID i identycznych komend;
- układ danych 32-kanałowych jest taki sam jak w DL16;
- tryb 1 GS/s obejmuje wszystkie 32 kanały;
- 1 GS/s jest trybem strumieniowym, a nie wyłącznie buforowym;
- firmware i bitstream można legalnie redystrybuować niezależnie od aplikacji.

Dlatego status DL32 to `EXPERIMENTAL — hardware validation required`.

### 4.3. Plan integracji DL32

1. Podłączyć fizyczny egzemplarz i zapisać deskryptory USB, VID/PID, endpointy oraz numer rewizji.
2. Uruchomić oficjalne ATK-Logic i sporządzić macierz trybów kanały × częstotliwość × buffer/stream.
3. Zbudować oryginalne `atk-logic` z konkretnego commita i potwierdzić, czy rozpoznaje urządzenie.
4. Uruchomić minimalny program libusb: enumerate → open → get device data → stop, bez akwizycji.
5. Zaimplementować `alientek-bridge` jako osobny proces GPL; nie kopiować kodu do pakietu TypeScript.
6. Dodać konfigurację i trigger, następnie odbiór małego bufora 1–10 MHz.
7. Zweryfikować mapowanie bitów 32 kanałów wzorcem z generatora.
8. Stopniowo przejść przez 100, 250, 500 i 1000 MS/s oraz sprawdzić CRC, sekwencje i przepełnienia.
9. Dopiero po testach zmienić status urządzenia w bibliotece na `Ready`.

Fallbackiem jest import CSV/pliku zapisanego przez program producenta. Nie zapewnia on przechwytywania na żywo.

## 5. Macierz akceptacyjna sterownika

Każdy nowy model musi przejść:

- wykrywanie wielu egzemplarzy i rozróżnienie numerów seryjnych;
- 100 cykli connect/start/stop/disconnect bez wycieku i procesu zombie;
- wszystkie reklamowane kombinacje kanałów i częstotliwości;
- trigger natychmiastowy, zbocze, poziom oraz pre/post-trigger;
- 10 minut strumienia bez `GAP` przy obsługiwanej szybkości;
- zgodność mapowania kanałów wzorcem sprzętowym;
- poprawne odłączenie w trakcie akwizycji;
- współpracę z drugim urządzeniem na innym kontrolerze USB;
- Windows i Linux; macOS dopiero gdy biblioteka producenta/protokół na to pozwala;
- informację o licencji, firmware i sterowniku systemowym w `Device Library`.

## 6. Ryzyko licencyjne

Kod DSView, ATK-Logic, libsigrok i libsigrokdecode jest GPLv3+. Granica procesu ogranicza sprzężenie techniczne, ale sama nie jest automatyczną gwarancją braku obowiązków licencyjnych. Przed wydaniem produktu trzeba:

- zatwierdzić sposób dystrybucji z osobą odpowiedzialną za licencje;
- dołączyć źródła, licencje i informacje o modyfikacjach, jeśli są wymagane;
- nie redystrybuować firmware/bitstreamów bez ustalenia praw;
- pozwolić korzystać z bridge'a dostarczonego przez użytkownika, jeżeli bundling nie zostanie zatwierdzony.
