# Rekord integracyjny: GLOBAL-VARS (Global Variables Registry & PLC-style Tag Table)

- **Zadanie:** GLOBAL-VARS
- **Wykonawca:** Antigravity (Gemini 3.7 Flash)
- **Status:** ZAAKCEPTOWANE
- **Data rozpoczęcia:** 2026-08-17
- **Data ukończenia:** 2026-08-17

---

## 1. Zakres prac

1. **Warstwa bazowa (`@theia/signal-core`):**
   - Zamrożenie kontraktów w `global-variable-contracts.ts`:
     - Branded type `VariableId`, funkcja pomocnicza `createVariableId`.
     - 11 typów danych: `BOOL`, `UINT8`, `INT8`, `UINT16`, `INT16`, `UINT32`, `INT32`, `FLOAT32`, `FLOAT64`, `STRING`, `BYTES`.
     - Flagi jakości: `GOOD`, `STALE`, `INVALID`, `DISCONNECTED`.
     - Typy źródeł: `MANUAL`, `CAN_PAYLOAD`, `DECODER`, `CALCULATION`, `SYSTEM`.
     - Zdarzenia reaktywne: `VariableChangeEvent`, `VariableDefinitionChangeEvent`.
     - Ścisłe klasy wyjątków: `InvalidVariableDefinitionException`, `DuplicateVariableException`, `VariableNotFoundException`, `VariableReadOnlyException`, `InvalidVariableValueException`.
   - Implementacja centralnego rejestru w pamięci `GlobalVariableRegistry`:
     - Walidacja unikalności nazw, formatu symbolicznego (`a-zA-Z0-9_.-`), typów i limitów długości.
     - Ścisłe sprawdzanie granic i rzutowanie wartości przy operacji zapisu (`write`) z zabezpieczeniem przed uszkodzeniem poprzedniego stanu.
     - Śledzenie monotonicznego licznika wersji (`version`), sygnatury czasowej (`timestampNs`), jakości oraz źródła.
     - Pełna obsługa serializacji, eksportu definicji i snapshotów do formatu JSON oraz importu.
   - Pakiet testów jednostkowych `global-variable-registry.spec.ts` (18 testów jednostkowych).

2. **Warstwa UI (`@theia/can-bus`):**
   - Interaktywny widżet `GlobalVariablesWidget` (`GLOBAL_VARIABLES_WIDGET_ID = 'global-variables-widget'`):
     - Pasek narzędzi z przyciskami: `+ Add Variable`, `Export JSON`, `Import JSON`, `Clear All` oraz filtrowaniem na żywo.
     - Formularz tworzenia nowej zmiennej z wyborem typu, opcjonalnej długości, wartości początkowej, jednostki, grupy i opisu.
     - Tabela w stylu PLC: kolumny **Name**, **Group**, **Type**, **Length**, **Value (Live/Editable)**, **Unit**, **Quality**, **Source**, **Updated**, **Actions**.
     - Edycja wartości in-place z natychmiastową walidacją i sygnalizacją błędu (`input-error`).
     - Aktualizacja przez zdarzenia `onDidVariableChange` z throttlingiem RAF.
   - Wkład widoku `GlobalVariablesViewContribution` z komendą `signal:open-global-variables` i wpisem w menu.
   - Rejestracja w kontenerze DI Theia `can-frontend-module.ts` w `inSingletonScope`.
   - Style CSS oparte o zmienne motywu Theia w `can-widget.css`.
   - Testy jednostkowe integracji `global-variables-widget.spec.ts`.

---

## 2. Pliki zmienione

- **Dodane:**
  - `packages/signal-core/src/common/global-variable-contracts.ts`
  - `packages/signal-core/src/common/global-variable-registry.ts`
  - `packages/signal-core/src/common/global-variable-registry.spec.ts`
  - `packages/signal-core/.eslintrc.js`
  - `packages/can-bus/src/browser/global-variables-widget.ts`
  - `packages/can-bus/src/browser/global-variables-view-contribution.ts`
  - `packages/can-bus/src/browser/global-variables-widget.spec.ts`
  - `doc/signal-analyzer/work/GLOBAL-VARS.md`
- **Zmodyfikowane:**
  - `packages/signal-core/src/common/index.ts`
  - `packages/can-bus/src/browser/can-frontend-module.ts`
  - `packages/can-bus/src/browser/style/can-widget.css`
  - `doc/signal-analyzer/global-variables-next-stage.md`
  - `doc/signal-analyzer/execution.md`
  - `doc/signal-analyzer/README.md`
  - `doc/signal-analyzer/work/README.md`
  - `SIGNAL-ANALYZER-CHANGELOG.md`

---

## 3. Wyniki weryfikacji

- `@theia/signal-core`: 52/52 passing (w tym 18 nowych), kompilacja 0 błędów, eslint 0 błędów.
- `@theia/can-bus`: 79/79 passing (w tym 3 nowe), kompilacja 0 błędów, eslint 0 błędów.
- `examples/browser`: budowa bundla zakończona sukcesem bez błędów.
