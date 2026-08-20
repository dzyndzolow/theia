# Integracja narzędzi dla agentów AI

## Cel kolejnego etapu

Udostępnić agentom AI funkcje analizatora CAN i narzędzia Theii przez ustrukturyzowaną warstwę narzędzi. Agent powinien móc analizować dane tak samo jak użytkownik, bez odczytywania DOM-u i bez obsługi interfejsu „na ślepo”.

Docelowo agent otrzymuje pełny dostęp operacyjny do narzędzi analizatora, z możliwością włączenia ograniczeń uprawnień dla operacji wpływających na sprzęt.

## Zakres dostępu agenta

### Sesja CAN i ramki

- rozpoczęcie, zatrzymanie, wstrzymanie i wyczyszczenie przechwytywania,
- odczyt statusu interfejsów, statystyk, FPS, liczby błędów i obciążenia magistrali,
- filtrowanie ramek po CAN ID, typie STD/EXT, interfejsie, RTR i zakresie czasu,
- pobieranie pojedynczych ramek, ostatnich ramek oraz zagregowanych informacji o ruchu,
- wyszukiwanie zmian i powtarzalnych wzorców w payloadzie.

### Payload i dekodowanie

- wybór zakresu bajtów oraz zakresu bitów,
- jawne potwierdzanie końca zakresu dla pól `INT` i `UINT`,
- dekodowanie typów `BOOL`, `INT`, `UINT`, `FLOAT32`, `FLOAT64` i wartości z dzielnikiem,
- wybór kolejności bajtów little-endian/big-endian,
- odczyt surowego HEX, ASCII, binarnej reprezentacji bitów i wartości zdekodowanej,
- tworzenie oraz usuwanie powiązań pomiędzy ramką CAN a zmienną globalną.

### Global Variables

- lista zmiennych, definicji typów, jednostek, grup i bieżących wartości,
- tworzenie, modyfikacja i usuwanie zmiennych,
- odczyt historii zmian wartości,
- eksport i import mapy zmiennych w JSON oraz szybki eksport CSV,
- walidacja konfliktów nazw, typów, zakresów i powiązań.

### CAN Value Plot

- tworzenie i usuwanie serii zmiennych,
- pobieranie próbek i danych z wykresu,
- wybór podstawy czasu oraz okna automatycznego,
- ustawianie offsetu, zakresu osi Y i skalowania automatycznego,
- porównywanie wielu zmiennych na jednej podstawie czasu,
- przygotowanie danych do analizy okresu, amplitudy, trendu i korelacji.

## Bufor danych i szybki dostęp dla AI

Sam odczyt bieżącej wartości nie wystarczy do analizy wykonywanej przez agenta. Potrzebny jest wspólny bufor próbek, który umożliwi jednocześnie podgląd na żywo, szybki eksport i późniejsze odtworzenie sesji.

### Założenia

- bufor pierścieniowy w pamięci przechowuje najnowsze ramki i próbki zmiennych,
- starsze dane mogą być okresowo zapisywane do plików segmentowych bez blokowania odbioru CAN,
- agent może pobrać próbki od znacznika czasu, numeru sekwencji albo określonego zakresu,
- eksport „na żądanie” działa szybko i zwraca JSONL dla agenta oraz CSV dla użytkownika,
- każda próbka zawiera znacznik czasu, CAN ID, typ STD/EXT, interfejs, DLC, payload, numer sesji i opcjonalne wartości zdekodowane,
- eksport może działać jako jednorazowy snapshot albo jako strumień nowych próbek.

Preferowanym formatem roboczym dla agenta powinien być JSONL, ponieważ pozwala dopisywać rekordy i przetwarzać duże sesje partiami. CSV pozostaje szybkim formatem wymiany i kontroli przez użytkownika.

## Nagrywanie i porównywanie sesji

System powinien umożliwiać nagranie kilku minut pracy jako nazwanej sesji, a następnie wykonanie kolejnego nagrania w tych samych warunkach i automatyczne porównanie obu przebiegów.

### Operacje sesji

- rozpoczęcie i zakończenie nagrania,
- zapis konfiguracji filtrów, interfejsu, mapy zmiennych i aktywnych dekoderów,
- oznaczanie sesji jako `baseline`, `repeat`, `test` lub własnym tagiem,
- dodawanie notatek i znaczników czasu podczas nagrania,
- zamrożenie snapshotu bez przerywania bieżącego przechwytywania,
- eksport manifestu, próbek i raportu porównania.

### Zakres porównania

Porównywarka powinna wykrywać między innymi:

- ramki obecne tylko w jednej sesji,
- różnice liczby wystąpień i częstotliwości ramek,
- zmiany okresu, opóźnienia, kolejności i jittera,
- różnice payloadu z podaniem konkretnych bajtów i bitów,
- zmiany wartości zmiennych, amplitudy, offsetu i trendu,
- brakujące, dodatkowe lub przesunięte zdarzenia,
- różnice tolerowane w określonym przedziale czasu lub wartości.

Wyrównanie sesji powinno być konfigurowalne: po CAN ID i numerze wystąpienia, po znaczniku czasu, po zdarzeniu startowym albo po wybranej zmiennej synchronizującej.

## Rozszerzony CAN ID Matrix — historia zmian

Obecny `CAN ID Matrix` pozostaje bez zmian i nadal służy do bieżącego podglądu ruchu. Obok niego powinno powstać osobne narzędzie, roboczo nazwane `CAN ID Matrix History` albo `CAN Session Diff`.

Funkcjonalnie powinno przypominać historię commitów, ale zamiast zmian w kodzie prezentować zmiany w ruchu CAN:

- lista zapisanych sesji i snapshotów,
- wybór sesji bazowej oraz sesji powtórzonej,
- automatyczny raport różnic ramek, payloadu, częstotliwości i czasów,
- historia zmian tej samej ramki w kolejnych snapshotach,
- oś czasu z pojawieniem się, zanikiem i zmianą wartości,
- komentarze, tagi i status analizy,
- możliwość otwarcia konkretnej różnicy w `Frame Payload Inspector`,
- eksport raportu do JSON/JSONL, CSV i czytelnego podsumowania Markdown.

To narzędzie nie powinno modyfikować działania bieżącego matrixu. Ma korzystać z tego samego źródła danych, ale posiadać własny model sesji, historii i porównań.

## Model „Git dla danych CAN”

Kierunek funkcjonalny należy traktować jako wersjonowanie obserwacji z magistrali, podobne do historii commitów w GitHub. Nie wersjonujemy kodu programu. Wersjonujemy stan i zachowanie systemu zaobserwowane podczas kolejnych nagrań.

### Słowa kluczowe i znaczenie

| Pojęcie | Znaczenie w analizie CAN |
| --- | --- |
| **CAN Analysis Repository** | Kontener wszystkich sesji, snapshotów, konfiguracji i raportów dla danego projektu lub urządzenia. |
| **Working Tree / Live Session** | Bieżący, niezapisany strumień ramek i zmian zmiennych. Odpowiada aktualnemu stanowi roboczemu. |
| **Session** | Ciągły zapis przechwytywania, np. kilka minut pracy urządzenia. |
| **Snapshot** | Lekki punkt kontrolny stanu wykonany w określonym momencie, bez konieczności kończenia sesji. |
| **CAN Commit** | Niezmienny zapis wybranego stanu lub zakończonej sesji wraz z metadanymi, konfiguracją filtrów i mapą zmiennych. |
| **Parent Commit** | Poprzedni zapis, względem którego wyliczamy zmiany. |
| **Commit Message** | Krótki opis celu nagrania, np. `baseline po zmianie firmware` albo `repeat po wymianie czujnika`. |
| **Tag** | Nazwa opisująca rolę zapisu, np. `baseline`, `before-fix`, `after-fix`, `production`, `test-01`. |
| **Branch / Experiment Line** | Oddzielna linia powtórzeń lub eksperymentów, np. wersja firmware A i wersja firmware B. |
| **CAN Diff** | Porównanie dwóch commitów, sesji lub snapshotów: ramek, payloadu, bitów, wartości i czasów. |
| **History / Log** | Chronologiczna lista commitów i snapshotów z możliwością przejścia do konkretnej zmiany. |
| **Checkout / Replay** | Otworzenie wybranego zapisu do analizy lub odtworzenie jego danych na wykresie. |
| **Annotate / Note** | Komentarz przypisany do sesji, ramki, zmiennej albo momentu na osi czasu. |

### Oczekiwany przepływ pracy

1. Agent lub użytkownik otwiera `CAN Analysis Repository`.
2. System obserwuje `Working Tree` i pokazuje bieżące ramki oraz zmiany.
3. Rozpoczynamy `Session` i rejestrujemy dane przez określony czas.
4. Kończymy nagranie i tworzymy `CAN Commit` z opisem oraz tagiem.
5. Wykonujemy zmianę w urządzeniu, firmware albo konfiguracji.
6. Nagrywamy kolejną sesję i zapisujemy drugi `CAN Commit`.
7. `CAN Diff` porównuje oba zapisy i wskazuje konkretne różnice.
8. Agent dodaje `Commit Message`, `Tag` lub `Note`, a wynik pozostaje w `History / Log`.

Przykład historii:

```text
CAN Analysis Repository: Battery-Emulator
|
|-- a13f02  baseline przed zmianą firmware       [baseline]
|-- b48291  powtórzenie po zmianie filtra         [after-fix]
|-- c91d77  test przy obciążeniu 80%              [test-01]
|
`-- CAN Diff: a13f02..b48291
    - CAN ID 0x130: okres 100 ms -> 120 ms
    - Byte 4: zmiana zakresu wartości
    - zmienna BatteryVoltage: +0.18 V offsetu
    - CAN ID 0x221: brak w 3 z 5 oczekiwanych wystąpień
```

Każdy `CAN Commit` powinien być niezmienny. Korekta opisu, tagów lub notatek może być dozwolona, ale dane źródłowe i wynik porównania muszą zachować identyfikator oraz integralność. Dzięki temu agent może odpowiadać nie tylko „co jest teraz”, ale również „co zmieniło się od poprzedniego znanego stanu”.

## Snapshots i zmiany w czasie

Snapshot powinien być lekkim, jednoznacznym obrazem stanu w wybranym momencie. Oprócz pełnego nagrania potrzebujemy więc:

- ręcznego i automatycznego wykonywania snapshotów,
- porównania dwóch snapshotów oraz snapshotu z bieżącym stanem,
- osi czasu zmian dla CAN ID, bajtów, bitów i zmiennych,
- filtrowania zmian tylko do wybranych ramek lub zmiennych,
- szybkiego przejścia z różnicy do dekodera i wykresu,
- przechowywania minimalnych metadanych: czas, źródło, filtr, konfiguracja dekodera i identyfikator sesji.

Proponowana struktura plików sesji:

```text
.can-sessions/
  <session-id>/
    manifest.json
    samples-0001.jsonl
    snapshots.jsonl
    report.json
```

Format i lokalizacja powinny pozostać wymienne, aby w przyszłości można było użyć bazy danych lub zewnętrznego magazynu bez zmiany narzędzi agenta.

## Zasady architektury

1. Warstwa narzędzi agenta korzysta ze wspólnych serwisów Theii, przede wszystkim rejestru zmiennych, mostu CAN, źródła ramek i store'a próbek.
2. Narzędzia zwracają dane strukturalne z jednoznacznymi typami, jednostkami, znacznikami czasu i informacją o źródle.
3. Operacje odczytu są rozdzielone od operacji zmieniających stan.
4. Subskrypcje zdarzeń umożliwiają agentowi obserwowanie nowych ramek i zmian zmiennych bez ciągłego odpytywania.
5. Interfejs użytkownika i agent korzystają z tej samej logiki domenowej, aby wyniki analizy były identyczne.

## Uprawnienia i bezpieczeństwo

Docelowy tryb „pełny dostęp” obejmuje wszystkie funkcje analizatora, ale uprawnienia muszą być konfigurowalne. Operacje wpływające na sprzęt powinny mieć osobne potwierdzenie lub tryb bezpieczny:

- start/stop fizycznego interfejsu CAN,
- wysyłanie ramek,
- upload firmware przez PioArduino,
- reset urządzenia i operacje na porcie szeregowym.

Domyślny tryb dla analizy powinien być read/write w zakresie ramek, payloadu, zmiennych i wykresów, bez automatycznego uploadu firmware ani wysyłania ramek do magistrali.

## Plan realizacji

1. Zdefiniować schematy narzędzi, próbek, snapshotów i wspólny model sesji analitycznej.
2. Udostępnić narzędzia odczytu: status, filtrowanie ramek, payload i zmienne.
3. Dodać bufor pierścieniowy oraz szybki eksport JSONL/CSV z kursorem czasu lub sekwencji.
4. Dodać nagrywanie sesji, snapshoty i zapis segmentów danych bez blokowania odbioru CAN.
5. Zaimplementować `CAN Session Diff` z porównaniem sesji i historią zmian ramek.
6. Dodać narzędzia konfiguracji: zakresy, bindy, mapę zmiennych i serie wykresu.
7. Dodać strumieniowanie zdarzeń dla ramek i zmian zmiennych.
8. Dodać tryby uprawnień oraz potwierdzenia operacji sprzętowych.
9. Przygotować testy kontraktowe narzędzi, testy dużych sesji i scenariusze analizy wykonywanej przez agenta.

## Kryterium ukończenia

Agent, korzystając wyłącznie z udostępnionych narzędzi, potrafi znaleźć interesujące ramki, pobrać próbki na żywo, nagrać sesję, wykonać powtórzenie, wskazać różnice w `CAN Session Diff`, wybrać zakres bajtów lub bitów, zdekodować wartość, utworzyć zmienną, obserwować jej zmiany i zestawić kilka zmiennych na jednym wykresie — bez ręcznej obsługi widgetów Theii.
