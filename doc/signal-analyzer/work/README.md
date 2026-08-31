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

### Protokół rezerwacji przy równoległości

1. Agent sprawdza `doc/signal-analyzer/work/README.md` — tabelę `Rejestr aktywnych zadań` oraz tabelę `Pliki współdzielone (aktywne)`.
2. Jeśli choć jeden plik z jego karty `Pliki dozwolone` występuje w kolumnie `Zablokowane przez` dla innego aktywnego zadania — rezerwacja jest **BLOCKED**.
3. Jeśli pliki są rozłączne — agent tworzy rekord `SA-xxx.md`, dodaje wiersz do rejestru i wpisuje swoje pliki do tabeli `Pliki współdzielone (aktywne)`.
4. Po uzyskaniu `AKCEPTACJA` agent usuwa swój wiersz z tabeli plików współdzielonych (pozostawia wiersz w rejestrze głównym ze statusem `ZAAKCEPTOWANE`).

### Pliki globalne — zawsze sekwencyjne

Następujące pliki **nigdy nie mogą być modyfikowane równolegle** przez dwóch agentów, niezależnie od zakresu zadania:
- `SIGNAL-ANALYZER-ROADMAP.md`
- `SIGNAL-ANALYZER-TASKS.md`
- `SIGNAL-ANALYZER-CHANGELOG.md`
- `doc/signal-analyzer/supervisor-report.md`
- `doc/signal-analyzer/work/README.md`
- `doc/signal-analyzer/execution.md`
- `doc/signal-analyzer/README.md`

## Status rekordu

`ZAREZERWOWANE` -> `W REALIZACJI` -> `GOTOWE DO REWIZJI` -> `ZAAKCEPTOWANE`

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
| SA-406 | Antigravity | GOTOWE DO REWIZJI | `SA-406.md` |
| SA-409 | Antigravity | GOTOWE DO REWIZJI | `SA-409.md` |
| SA-410 | Antigravity | GOTOWE DO REWIZJI | `SA-410.md` |
| SA-411 | Antigravity | GOTOWE DO REWIZJI | `SA-411.md` |
| SA-412 | Antigravity | GOTOWE DO REWIZJI | `SA-412.md` |
| SA-413 | Antigravity | GOTOWE DO REWIZJI | `SA-413.md` |
| SA-414 | Antigravity | GOTOWE DO REWIZJI | `SA-414.md` |
| SA-415 | Antigravity | GOTOWE DO REWIZJI | `SA-415.md` |
| SA-416 | Antigravity | GOTOWE DO REWIZJI | `SA-416.md` |
| SA-417 | Antigravity | GOTOWE DO REWIZJI | `SA-417.md` |
| SA-418 | Antigravity | GOTOWE DO REWIZJI | `SA-418.md` |
| SA-419 | Antigravity | GOTOWE DO REWIZJI | `SA-419.md` |
| SA-420 | Antigravity | GOTOWE DO REWIZJI | `SA-420.md` |
| SA-422 | Antigravity | GOTOWE DO REWIZJI | `SA-422.md` |
| SA-423 | Antigravity | GOTOWE DO REWIZJI | `SA-417.md` |
| SA-421 | Antigravity | GOTOWE DO REWIZJI | `SA-421.md` |
| SA-424 | Antigravity | GOTOWE DO REWIZJI | `SA-424.md` |
| SA-HW-001 | Antigravity + Codex | POPRAWKI WYMAGANE — HOST STABILNY, HARDWARE NIEZWERYFIKOWANY | `SA-HW-001.md` |
| SA-610 | Codex (GPT-5) | GOTOWE DO REWIZJI — WSTRZYMANE OPERACYJNIE | `SA-610.md` |
| SA-701 | Codex (GPT-5) | PERSPEKTYWA WSTRZYMANA | `SA-701.md` |
| GLOBAL-VARS | Antigravity | ZAAKCEPTOWANE | `GLOBAL-VARS.md` |

## Pliki współdzielone (aktywne)

| Plik | Zarezerwowany przez | Od (data) | Zablokowane dla |
| --- | --- | --- | --- |
| `packages/can-bus/src/node/can-device-lab-simulator.ts` | Antigravity (SA-409) | 2026-08-28 | inne zadania |
| `packages/can-bus/src/common/can-device-lab-fixture.ts` | Antigravity (SA-409) | 2026-08-28 | inne zadania |
| `packages/can-bus/src/common/can-experiment-protocol.ts` | Antigravity (SA-410) | 2026-08-28 | inne zadania |
| `packages/can-bus/src/common/can-safety-policy.ts` | Antigravity (SA-410) | 2026-08-28 | inne zadania |
| `packages/can-bus/src/common/can-experiment-event-bus.ts` | Antigravity (SA-410) | 2026-08-28 | inne zadania |

## Minimalne przekazanie pracy

Przed rewizją rekord musi wskazywać: faktycznie zmienione pliki, spełnione zależności, producentów i konsumentów danych, testowaną ścieżkę integracyjną, aktualizowaną dokumentację oraz znane ograniczenia.
