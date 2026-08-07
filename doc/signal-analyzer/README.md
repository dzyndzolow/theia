# Signal Analyzer — dokumentacja

Dokumentacja funkcjonalności projektu Theia Signal Analyzer (patrz `SIGNAL-ANALYZER-ROADMAP.md` §0.2).

Podział pracy agentów AI i karty zadań: `SIGNAL-ANALYZER-TASKS.md`. Koordynację zależności oraz przekazanie pracy między agentami prowadzi się w `work/`.

**Zasady:** każda funkcjonalność = opis + jak używać. Dokumentację wolno modyfikować wyłącznie w zakresie bieżącej zmiany. Zmiana kodu bez aktualizacji dokumentacji = zadanie niedokończone.

## Indeks

| Dokument | Funkcjonalność | Status |
| --- | --- | --- |
| `supervisor-report.md` | **Raport superwizora** — jedyny plik sterujący jakością; lista usterek, dług techniczny, rytm rewizji | aktywny |
| `can-bus.md` | CAN Bus Analyzer (widget, capture, statystyki, protokół binarny) | aktywny |
| `signal-core.md` | `@theia/signal-core` — Kontrakty systemowe, RingSampleStore, ChunkedIntervalTree, CaptureSession | aktywny |
| `decoders-architecture.md` | Silnik dekoderów — DecoderRegistry, Kahns DAG, WebWorker SAB, Circuit Breaker, CAN & UART | aktywny |
| `execution.md` | Zasady nieusuwania planu, aktualny stan wykonania i kolejne kroki | aktywne |
| `work/README.md` | Rejestr integracji, przekazania i blokery między zadaniami | aktywne |
