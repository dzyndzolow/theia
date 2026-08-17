# Globalne zmienne programu (Global Variable Registry & Tag Table)

Status: **ZREALIZOWANE** (2026-08-17)

## Cel

Zaimplementowano centralny rejestr zmiennych (Global Variable Registry) na wzór tabeli zmiennych w sterownikach PLC. Użytkownik i moduły systemu mogą dynamicznie tworzyć zapisywalną listę zmiennych, określać ich nazwy, typy i długości, a następnie odczytywać lub zapisywać ich wartości z dowolnego widżetu i modułu programu.

Definicja zmiennej ma być oddzielona od jej aktualnej wartości. Pozwoli to w przyszłości przypisywać do jednej zmiennej różne źródła: wartość ręczną, pole ramki CAN, wynik dekodera, obliczenie albo dane z innego protokołu.

## Planowany model

### Definicja zmiennej

- trwały identyfikator niezależny od nazwy;
- unikalna nazwa symboliczna, np. `engine.speed`;
- typ danych: co najmniej `BOOL`, `UINT8`, `INT8`, `UINT16`, `INT16`, `UINT32`, `INT32`, `FLOAT32`, `FLOAT64`, `STRING` i `BYTES`;
- długość dla typów o zmiennym rozmiarze (`STRING`, `BYTES`, później tablice);
- opcjonalna wartość początkowa;
- możliwość zapisu (`writable`);
- opcjonalny opis, jednostka i grupa;
- opcjonalna definicja źródła wartości.

### Stan wykonawczy

- aktualna wartość zgodna z zadeklarowanym typem;
- czas ostatniej aktualizacji;
- jakość wartości (`GOOD`, `STALE`, `INVALID`, `DISCONNECTED`);
- źródło ostatniej zmiany;
- licznik wersji umożliwiający bezpieczne wykrywanie kolejnych aktualizacji.

## Centralny Global Variable Registry

Rejestr powinien udostępniać jedno wspólne API:

- `define` — utworzenie definicji;
- `updateDefinition` — zmiana metadanych z walidacją istniejących odwołań;
- `remove` — usunięcie zmiennej;
- `read` — odczyt aktualnego stanu;
- `write` — zapis wartości z kontrolą typu, długości i uprawnień;
- `list` — pobranie definicji i stanów;
- `onDidChange` — zdarzenie aktualizacji bez aktywnego odpytywania;
- import oraz eksport tabeli zmiennych.

Registry ma być jedynym źródłem prawdy. Widoki i analizatory nie powinny utrzymywać własnych, rozbieżnych kopii wartości.

## Interfejs użytkownika

Planowany widok **Global Variables** powinien zawierać edytowalną tabelę:

| Pole | Zachowanie |
| --- | --- |
| Name | unikalna nazwa symboliczna |
| Type | wybór typu z listy |
| Length | aktywne dla typów o zmiennej długości |
| Value | aktualna wartość; edytowalna dla zmiennych zapisywalnych |
| Quality | aktualny stan jakości |
| Updated | czas ostatniej aktualizacji |
| Source | ręczne, CAN, dekoder, obliczenie itd. |

Lista ma pozwalać na dodawanie, usuwanie, filtrowanie i grupowanie zmiennych oraz zachowywać konfigurację po ponownym uruchomieniu programu.

## Proponowana kolejność implementacji

1. Zamrożenie kontraktów typów, definicji, stanu, jakości i zdarzeń.
2. Implementacja testowanego rejestru w pamięci z pełną walidacją.
3. Trwały zapis definicji oraz ustalenie, czy zapisywać również ostatnie wartości.
4. Udostępnienie wspólnego rejestru frontendowi i backendowi przez pojedynczą usługę/RPC.
5. Widok **Global Variables** z edycją tabeli.
6. Integracja Frame Payload Inspector i dekoderów CAN jako źródeł zmiennych.
7. Udostępnienie zmiennych analizatorom, wykresom, regułom i przyszłym modułom obliczeniowym.

## Kryteria akceptacji pierwszej wersji

- można dynamicznie utworzyć, zmienić i usunąć zmienną;
- nazwy są unikalne, a niepoprawne typy i długości są odrzucane czytelnym błędem;
- zapis niezgodnej wartości nie zmienia poprzedniego poprawnego stanu;
- ta sama wartość jest widoczna we wszystkich otwartych widokach i modułach;
- subskrybenci otrzymują dokładnie jedno zdarzenie dla zaakceptowanej zmiany;
- definicje są odtwarzane po ponownym uruchomieniu;
- testy obejmują wszystkie typy, wartości graniczne, zmianę definicji, zapis równoległy i trwałość;
- aktualizacja wartości nie może blokować płynności CAN ID Matrix ani analizatorów.

## Decyzje do podjęcia przed implementacją

- zakres nazw: globalny dla całej aplikacji czy osobny dla workspace;
- trwałość bieżących wartości: tylko definicje czy definicje razem z ostatnim stanem;
- zasady zmiany typu lub długości zmiennej, która ma aktywne odwołania;
- pierwsza wersja źródeł automatycznych: wyłącznie CAN czy od razu ogólny kontrakt `VariableSource`;
- kontrola konfliktów zapisu między UI, dekoderem i innymi modułami.

