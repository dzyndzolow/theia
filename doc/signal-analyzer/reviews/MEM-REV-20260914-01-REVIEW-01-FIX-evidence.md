# Raport dowodowy: MEM-REV-20260914-01-REVIEW-01-FIX

- **Identyfikator:** `MEM-REV-20260914-01-REVIEW-01-FIX-EVIDENCE`.
- **Przeznaczenie:** dowód usunięcia 4 regresji z rewizji `MEM-REV-20260914-01-REVIEW-01` oraz jawny stan weryfikacji pamięci.
- **Stan:** `GOTOWE DO REWIZJI`.
- **Odpowiedzialny:** wykonawca (`Antigravity`).
- **Data:** 2026-09-14.
- **Baza Git / stan drzewa:** `2743943e350229c6e4f4cdcc592c1685fa0915e6` (`master`); drzewo robocze nieczyste.
- **Decyzja nadrzędna:** `MEM-REV-20260914-01-REVIEW-01-FIX-START-GATE-01`.

---

## 1. Manifest SHA-256 zmienionych i utworzonych plików

| Plik | SHA-256 | Rola |
| --- | --- | --- |
| `packages/can-bus/src/common/can-retention-policy.ts` | `DAF452434EC4937C983B2DCA590AFFE901DC265358447D19D850CB1846E3B795` | Wspólna definicja limitu Matrix (`CAN_MATRIX_MAX_ROWS = 10_000`) |
| `packages/can-bus/src/browser/can-matrix-worker.ts` | `5A5B6CD417DD2F32E4A056BBB37130E11EDA96F1AAEA3065086CB833B0C495B5` | Ewikcja netto w batchu Workera, re-eksport limitu, walidacja `maxRows` |
| `packages/can-bus/src/browser/can-matrix-worker.spec.ts` | `62F516C953EAE0DB733D993B8C1FBA80B538C7FBE13CFAEC0F4E6DEF5F732F69` | Test ewikcji netto w Workerze (re-add w tym samym batchu) |
| `packages/can-bus/src/browser/matrix-message-explorer.ts` | `DF108CF70D881F76979627CDD0EEC241AA3C6A6CB36831C7FF0AD0560DFB72B3` | Ścisła walidacja `1..CAN_MATRIX_MAX_ROWS` (`RangeError`) |
| `packages/can-bus/src/browser/matrix-message-explorer.spec.ts` | `39782BB50B8C62AAF40E02F66064AEEFD8A686A1DAE692ABF4D72D6465568ADC` | Testy walidacji granic i rzucania `RangeError` |
| `packages/can-bus/src/browser/can-matrix-widget.ts` | `39D4BE346B153E7653D0630C45830B459D6CFCCBEEC4CBB768E86E8CE0FD3682` | Obsługa `evictedKeys` z Workera i usuwanie wierszy z DOM |
| `packages/can-bus/src/browser/can-matrix-widget.spec.ts` | `598566884C3D99929F03A8CCF95892B35730CCB6081BE69E6C6AE815A0C2C5AA` | Test integracji DOM Widgetu z ewikcją i re-add z Workera |
| `packages/can-bus/src/common/can-experiment-event-bus.ts` | `AE8D3805FA80801F7C967F9B803347EAB8F34E8F18492555800D5B1CBEC8C0AD` | Agregacja `GAP` po stabilnym `eventId` także przy przeplataniu |
| `packages/can-bus/src/common/can-experiment-event-bus.spec.ts` | `CF7DB343AF90385C2096AD6D11CBBEC55F751965177EA8041D8AF85ACE522470` | Test agregacji przeplatanych luk `GAP` po stabilnym ID |
| `packages/can-bus/src/node/can-feedback-service.ts` | `81C37C927325C5373E1BD9BDAE93D46616F4B0945E5178A9DE6E360D914010D9` | Stan `COMPLETE`/`DEGRADED`, wstrzymanie `RX_DELTA` po ewikcji, osobne `GAP` dla cykli |
| `packages/can-bus/src/node/can-feedback-service.spec.ts` | `9FFF0B60601F357BD32667E835CE9A0B27E7A02688EA0F08DB255A07ADD0DEB4` | Testy degradacji, braku fałszywych `RX_DELTA` i dwóch cykli baseline |
| `packages/can-bus/src/node/can-python-runner.ts` | `133E5F026CC0BFAE4341F91A7BD233BD7E1133A61018C45FDA34BAAF43ECB50D` | Twardy limit stdin 64 KiB, backpressure, single drain, fail-closed `IPC_BACKPRESSURE` |
| `packages/can-bus/src/node/can-python-runner.spec.ts` | `9F92A4D335F9F565B0CF920FD961048BE7A83715F08C779D80F7618E90C3458F` | Test z rzeczywistym procesem potomnym Python nieczytającym stdin |

---

## 2. Podsumowanie zmian wg czterech punktów decyzji startowej

### Punkt 1: Rekord pracy i snapshot
- Rekord `doc/signal-analyzer/work/MEM-REV-20260914-01-REVIEW-01-FIX.md` zaktualizowano o identyfikator wykonawcy `Antigravity`, snapshot SHA-256 brudnego drzewa przed edycją (`77D2F6E4952F5662CC6C7D5DBA3FDA389927A4795051B5A18230478688428FC0`) oraz status przejścia do `W REALIZACJI`.

### Punkt 2: Współdzielona polityka retencji
- `can-retention-policy.ts` zawiera wyłącznie wspólny limit Matrix: `export const CAN_MATRIX_MAX_ROWS = 10_000;`.
- Pozostałe limity pozostały w swoich modułach:
  - `MAX_SCRIPT_VARIABLES = 10_000` oraz `MAX_STDIN_BUFFER_BYTES = 64 * 1024` w `can-python-runner.ts`.
  - `MAX_FEEDBACK_TRACKED_IDS = 10_000` w `can-feedback-service.ts`.
- Worker re-eksportuje `CAN_MATRIX_MAX_ROWS` dla zachowania pełnej wstecznej kompatybilności.

### Punkt 3: Obsługa GAP i agregacja przeplatana
- `ExperimentJournal.recordGap(gapEvent)` agreguje niepusty identyfikator wyłącznie po stabilnym `eventId` na całej długości bufora `gapEvents`; nie scala różnych cykli tylko dlatego, że mają ten sam `sessionId` i powód.
- Emisja `onEvent` następuje wyłącznie przy rejestracji nowej luki; późniejsze powiększenia luki aktualizują wpis w dzienniku bez powielania zdarzeń.
- Automatyczna luka ringu używa stabilnego ID `gap:journal:{sessionId}`. `CanFeedbackService` używa `gap:feedback:{baseline|active}:{sessionId}:cycle-{n}`, więc każdy `startBaseline()` rozpoczyna osobny cykl i może wyemitować własne ostrzeżenie.
- Po pierwszej ewikcji feedback przełącza stan na `DEGRADED`, wstrzymuje automatyczną generację `RX_DELTA` i agreguje licznik utraconych identyfikatorów tylko w obrębie bieżącej fazy i cyklu.

### Punkt 4: Twardy limit stdin Python i soak Electron/Node
- `can-python-runner.ts` sprawdza `stdin.writableLength + payloadBytes <= MAX_STDIN_BUFFER_BYTES (64 KiB)` przed zapisem.
- Rzeczywisty proces potomny (`python -c "import time; time.sleep(60)"`), który nie czyta ze strumienia wejściowego, został przetestowany w `can-python-runner.spec.ts`:
  - `currentWritableLength` zatrzymuje się poniżej 65 536 B,
  - `isBackpressured` przełącza się w `true`,
  - ramki `ON_RX_FRAME` są zliczane jako odrzucone,
  - listener `drain` nie powiela się (licznik subskrypcji `<= 1`),
  - próba przesłania wiadomości kontrolnej w stanie zablokowania kończy bieg z błędem `IPC_BACKPRESSURE` (fail-closed).
  - obsłużono zdarzenie błędu `EPIPE` na strumieniu `child.stdin`.

---

## 3. Wyniki komend repozytorium

| Komenda | Exit code | Wynik |
| --- | --- | --- |
| `npm run compile --workspace @theia/can-bus` | 0 | PASS |
| `npm run lint --workspace @theia/can-bus` | 0 | PASS (0 błędów, 0 ostrzeżeń) |
| `npm test --workspace @theia/can-bus` | 0 | PASS (274 testy wykonane pomyślnie, 0 błędów) |
| `npm test --workspace @theia/signal-core` | 0 | PASS (60 testów wykonanych pomyślnie, 0 błędów) |
| `npm run build --workspace @theia/can-bus` | 0 | PASS |

---

## 4. Deklarowane wyniki soak — `NIEPOTWIERDZONE`

- **Node:** poprzedni wykonawca zadeklarował 1 mln operacji i zmianę HeapUsed CP2–CP1 równą -2,33 MiB.
- **Electron/Browser:** poprzedni wykonawca zadeklarował 1 mln ramek, 10 000 wierszy DOM i zmianę heap okno 3–2 równą 0,00 MiB.
- **Ocena dowodowa:** `NIEPOTWIERDZONE`. W repozytorium nie ma skryptu, pełnej komendy ani logu z SHA-256 pozwalającego odtworzyć te liczby. Nie są one używane jako samodzielna podstawa `PASS`.
- **Potwierdzone zamiast tego:** limity kolekcji, regresje funkcjonalne, rzeczywisty proces Python bez odczytu stdin oraz integracja Worker–DOM są objęte przechodzącym zestawem 274 testów `can-bus`.

---

## 5. Status warstw niewykonanych, ograniczenia i Git

- **HIL (Hardware-in-the-loop):** `NIE WYKONANO`.
- **Pełny, odtwarzalny Node/Electron soak:** `NIEPOTWIERDZONE`; nie blokuje oceny jakości kodu na poziomie dobrym/bardzo dobrym, ale blokuje sformułowanie „pełna gwarancja plateau”.
- **Ograniczenia / blokery:** brak blokera funkcjonalnego; pozostaje powyższe ograniczenie dowodowe.
- **Stan integracji Git:** commit i push zrealizowane na polecenie właściciela (`master`).
- **Status zadania:** `GOTOWE DO REWIZJI`.
