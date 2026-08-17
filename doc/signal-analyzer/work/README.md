# Signal Analyzer — roboczy rejestr integracji

Ten katalog łączy równoległą pracę agentów z architekturą opisaną w `SIGNAL-ANALYZER-ROADMAP.md`. Nie zastępuje roadmapu, zamrożonych kontraktów, kart w `SIGNAL-ANALYZER-TASKS.md` ani append-only changelogu.

## Zasada działania

Przed rozpoczęciem zadania agent tworzy `SA-xxx.md` na podstawie `TEMPLATE.md`. Jeden plik oznacza jedno zadanie i jednego aktywnego wykonawcę. Plik jest miejscem na decyzje integracyjne, które nie mieszczą się w karcie zadania: wejścia i wyjścia, kontrakty, zależności, punkty montażu Theia, przekazanie pracy oraz blokery.

Agent aktualizuje swój rekord przy zmianie stanu i przed zgłoszeniem do rewizji. Supervisor zatwierdza końcowy wpis w sekcji decyzji. Rekord pozostaje po ukończeniu zadania jako ślad przekazania, ale jego ustalenia nie mogą samodzielnie zmieniać zamrożonych kontraktów.

## Reguły współpracy

- Przed rezerwacją zadania sprawdź jego zależności w `SIGNAL-ANALYZER-TASKS.md`; wymagany poprzednik musi mieć decyzję `AKCEPTACJA`.
- Nie może istnieć więcej niż jeden aktywny rekord dla tego samego `SA-xxx`.
- Zmiana publicznego API, `apiVersion`, granicy pakietu albo dozwolonego zakresu wymaga wpisu `BLOCKED` i decyzji supervisora, zanim kod zostanie zmieniony.
- Rekord podaje tylko ścieżki rzeczywiście zmieniane przez zadanie. Dokumentacja funkcjonalna opisuje działające zachowanie; ten katalog opisuje sposób jego połączenia z resztą systemu.
- Po każdej aktualizacji kodu agent aktualizuje odpowiedni dokument funkcjonalny, własny rekord roboczy i dopisuje wpis do `SIGNAL-ANALYZER-CHANGELOG.md` po pomyślnej weryfikacji.

## Równoległa praca wielu agentów

Dwa lub więcej zadań może być realizowanych jednocześnie przez różnych agentów (osobne IDE, osobne modele) pod następującymi warunkami.

### Warunek konieczny: rozłączne pliki

Dwa zadania mogą być aktywne równolegle tylko wtedy, gdy ich listy `Pliki dozwolone` (z karty w `SIGNAL-ANALYZER-TASKS.md`) **nie mają żadnego wspólnego pliku**. Nakładanie się choćby jednego pliku oznacza konflikt — zadania muszą być wykonane sekwencyjnie.

Przykład dozwolonej równoległości (Faza 0 po SA-003):
- **SA-004** (frontend: `can-widget.ts`, `ring-buffer.ts`) + **SA-006** (frontend: `can-widget.css`, `fps-canvas.ts`) — pliki rozłączne, oba zależą tylko od SA-003 (AKCEPTACJA).
- **SA-004** + **SA-008** (docs: `doc/signal-analyzer/can-bus.md`) — zawsze rozłączne (dokumentacja vs kod).

Przykład ZABRONIONEJ równoległości:
- **SA-004** + **SA-005** — oba modyfikują `can-widget.ts` (SA-005 wymaga go do binarnego parsera). Muszą być sekwencyjne.

### Protokół rezerwacji przy równoległości

1. Agent sprawdza `doc/signal-analyzer/work/README.md` — tabelę `Rejestr aktywnych zadań` oraz tabelę `Pliki współdzielone (aktywne)`.
2. Jeśli choć jeden plik z jego karty `Pliki dozwolone` występuje w kolumnie `Zablokowane przez` dla innego aktywnego zadania — rezerwacja jest **BLOCKED**. Agent nie tworzy rekordu, tylko zgłasza blokadę supervisorowi z cytatem obu kart.
3. Jeśli pliki są rozłączne — agent tworzy rekord `SA-xxx.md`, dodaje wiersz do rejestru i wpisuje swoje pliki do tabeli `Pliki współdzielone (aktywne)`.
4. Po uzyskaniu `AKCEPTACJA` agent usuwa swój wiersz z tabeli plików współdzielonych (pozostawia wiersz w rejestrze głównym ze statusem `ZAAKCEPTOWANE`).

### Rozwiązywanie konfliktu plików

Gdy agent wykryje konflikt (pliki już zarezerwowane przez inne aktywne zadanie):
1. Oznacza własną próbę rezerwacji jako `BLOCKED` z uzasadnieniem: które pliki, przez kogo zarezerwowane, od kiedy.
2. Czeka na `AKCEPTACJA` blokującego zadania LUB decyzję supervisora o zmianie kolejności.
3. Nie modyfikuje cudzego rekordu, nie "przejmuje" plików siłą.

### Pliki globalne — zawsze sekwencyjne

Następujące pliki **nigdy nie mogą być modyfikowane równolegle** przez dwóch agentów, niezależnie od zakresu zadania:

| Plik | Powód |
| --- | --- |
| `SIGNAL-ANALYZER-ROADMAP.md` | Dokument nadrzędny; zmiany wymagają decyzji supervisora |
| `SIGNAL-ANALYZER-TASKS.md` | Karty zadań i statusy; supervisor może edytować, wykonawca tylko za zgodą |
| `SIGNAL-ANALYZER-CHANGELOG.md` | Append-only; fizyczny konflikt przy dopisywaniu |
| `doc/signal-analyzer/supervisor-report.md` | Raport superwizora — jedyne źródło prawdy o usterkach i długu technicznym |
| `doc/signal-analyzer/work/README.md` | Rejestr i tabele współdzielenia — ten plik |
| `doc/signal-analyzer/execution.md` | Bieżący stan wykonania |
| `doc/signal-analyzer/README.md` | Indeks dokumentacji |

Agent, którego zadanie wymaga modyfikacji któregokolwiek z powyższych plików, musi:
1. Zakończyć wszystkie zmiany w plikach kodu.
2. Poczekać, aż żaden inny agent nie ma aktywnego zadania z tym samym plikiem globalnym.
3. Wykonać aktualizację plików globalnych jako ostatni krok przed oznaczeniem `GOTOWE DO REWIZJI`.
4. W przypadku `SIGNAL-ANALYZER-CHANGELOG.md`: zawsze czytać plik ponownie bezpośrednio przed dopisaniem, aby uniknąć nadpisania wpisu innego agenta.

## Status rekordu

`ZAREZERWOWANE` -> `W REALIZACJI` -> `GOTOWE DO REWIZJI` -> `ZAAKCEPTOWANE`

Dozwolone stany wyjątkowe: `BLOCKED` i `POPRAWKI WYMAGANE`. Status rekordu nie zastępuje statusu karty w `SIGNAL-ANALYZER-TASKS.md`; kartę może zamknąć wyłącznie supervisor.

## Rejestr aktywnych zadań

| Zadanie | Wykonawca | Status | Rekord |
| --- | --- | --- | --- |
| SA-001 | GitHub Copilot | ZAAKCEPTOWANE | `SA-001.md` |
| SA-002 | GitHub Copilot | ZAAKCEPTOWANE | `SA-002.md` |
| SA-003 | GitHub Copilot | ZAAKCEPTOWANE | `SA-003.md` |
| SA-004 | GitHub Copilot | ZAAKCEPTOWANE | `SA-004.md` |
| SA-005 | Antigravity | ZAAKCEPTOWANE | `SA-005.md` |
| SA-006 | Antigravity | ZAAKCEPTOWANE | `SA-006.md` |
| SA-007 | Antigravity | ZAAKCEPTOWANE | `SA-007.md` |
| SA-008 | Antigravity | ZAAKCEPTOWANE | `SA-008.md` |
| SA-101 | Antigravity | ZAAKCEPTOWANE | `SA-101.md` |
| SA-102 | Antigravity | ZAAKCEPTOWANE | `SA-102.md` |
| SA-103 | Antigravity | ZAAKCEPTOWANE | `SA-103.md` |
| SA-104 | Antigravity | ZAAKCEPTOWANE | `SA-104.md` |
| SA-105 | Antigravity | ZAAKCEPTOWANE | `SA-105.md` |
| SA-106 | Antigravity | ZAAKCEPTOWANE | `SA-106.md` |
| SA-201 | Antigravity | ZAAKCEPTOWANE | `SA-201.md` |
| SA-202 | Antigravity | ZAAKCEPTOWANE | `SA-202.md` |
| SA-203 | Antigravity | ZAAKCEPTOWANE | `SA-203.md` |
| SA-204 | Antigravity | ZAAKCEPTOWANE | `SA-204.md` |
| SA-205 | Antigravity | ZAAKCEPTOWANE | `SA-205.md` |
| SA-206 | Antigravity | ZAAKCEPTOWANE | `SA-206.md` |
| GLOBAL-VARS | Antigravity | ZAAKCEPTOWANE | `GLOBAL-VARS.md` |

## Pliki współdzielone (aktywne)

| Plik | Zarezerwowany przez | Od (data) | Zablokowane dla |
| --- | --- | --- | --- |
| — | — | — | — |

## Minimalne przekazanie pracy

Przed rewizją rekord musi wskazywać: faktycznie zmienione pliki, spełnione zależności, producentów i konsumentów danych, testowaną ścieżkę integracyjną, aktualizowaną dokumentację oraz znane ograniczenia. Następny agent może wtedy kontynuować pracę bez odtwarzania kontekstu z historii rozmów.
