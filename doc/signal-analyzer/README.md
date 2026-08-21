# Signal Analyzer — dokumentacja

Dokumentacja funkcjonalności projektu Theia Signal Analyzer (patrz `SIGNAL-ANALYZER-ROADMAP.md` §0.2).

Podział pracy agentów AI i karty zadań: `SIGNAL-ANALYZER-TASKS.md`. Koordynację zależności oraz przekazanie pracy między agentami prowadzi się w `work/`.

**Zasady:** każda funkcjonalność = opis + jak używać. Dokumentację wolno modyfikować wyłącznie w zakresie bieżącej zmiany. Zmiana kodu bez aktualizacji dokumentacji = zadanie niedokończone.

## Indeks

| Dokument | Funkcjonalność | Status |
| --- | --- | --- |
| `supervisor-report.md` | **Raport superwizora** — jedyny plik sterujący jakością; lista usterek, dług techniczny, rytm rewizji | aktywny |
| `stabilization-current-functionality.md` | Bramka jakościowa STAB-01…STAB-09 dla stabilnej wersji obecnych funkcji | aktywny |
| `can-bus.md` | CAN Bus Analyzer (widget, capture, statystyki, protokół binarny) | aktywny |
| `signal-core.md` | `@theia/signal-core` — Kontrakty systemowe, RingSampleStore, ChunkedIntervalTree, CaptureSession | aktywny |
| `decoders-architecture.md` | Silnik dekoderów — DecoderRegistry, Kahns DAG, WebWorker SAB, Circuit Breaker, CAN & UART | aktywny |
| `global-variables-next-stage.md` | Centralny rejestr i edytowalna tabela globalnych zmiennych w stylu PLC | aktywny |
| `../ai-agent-tools.md` | Docelowy model narzędzi AI, sesji, CAN Commit i CAN Diff | koncepcja zaakceptowana; implementacja po stabilizacji |
| `execution.md` | Zasady nieusuwania planu, aktualny stan wykonania i kolejne kroki | aktywne |
| `work/README.md` | Rejestr integracji, przekazania i blokery między zadaniami | aktywne |
| `supervisor-handoff.md` | Zakres przekazania pełnej bramki STAB-01…STAB-09 do niezależnej oceny | aktywny |
| `runtime-hygiene.md` | Polityka artefaktów `.pioarduino-core` i cache runtime | aktywny |
