# Pakiet `@theia/signal-core` — Kontrakty i Magazyn Danych (L2)

Pakiet `@theia/signal-core` jest rdzeniową biblioteką platformy Theia Signal Analyzer. Został zaprojektowany bez żadnych zależności od warstw prezentacji i środowiska wykonawczego (brak kodu DOM, Reacta czy Electrona), co zapewnia pełną przenośność oraz wysoką wydajność.

## 1. Architektura i odpowiedzialność

- **Warunek czystości:** Pakiet zawiera wyłącznie czyste typy TypeScript, struktury buforowe oraz logikę kontroli sesji.
- **Wydajność alokacji:** Zoptymalizowane struktury buforowe redukują obciążenie Garbage Collectora przy milionach ramek/s.
- **Niemutowalność:** Wszystkie kontrakty systemowe posługują się słowem kluczowym `readonly` oraz Branded Types (`DecoderId`, `SignalId`, `ChannelId`, `SessionId`).

## 2. Zamrożone kontrakty systemowe (§3 Roadmap)

### `SampleBlock`
Podstawowa jednostka transportu binarnych surowych próbek sygnałowych.
```ts
export interface SampleBlock {
    readonly blockId: number;
    readonly channelId: ChannelId | string;
    readonly sampleRate: number;
    readonly startTimeNs: bigint;
    readonly sampleCount: number;
    readonly dataType: 'BIT_PACKED' | 'UINT8' | 'UINT16' | 'FLOAT32';
    readonly data: ArrayBuffer;
}
```

### `ProtocolAnnotation`
Niemutowalna reprezentacja zdekodowanej adnotacji protokołu z obsługą hierarchii DAG.
```ts
export interface ProtocolAnnotation {
    readonly id: string;
    readonly parentId: string | null;  // hierarchia DAG
    readonly level: number;            // 0 = surowe, 1+ = kolejne warstwy
    readonly startTimeNs: bigint;
    readonly endTimeNs: bigint;
    readonly type: string;             // np. "annotation:can", "GAP", "RESYNC"
    readonly summary: string;
    readonly payload: Readonly<Record<string, unknown>> | null;
}
```

### `DecoderProvider`
Interfejs rejestracji i wykonywania dekoderów w potoku strumieniowym z obsługą backpressure.
```ts
export interface DecoderProvider {
    readonly id: DecoderId | string;
    readonly displayName: string;
    readonly apiVersion: string;
    readonly inputType: string;
    readonly outputType: string;
    readonly channelRoles: readonly ChannelRole[];
    decode(
        input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
        options: Readonly<Record<string, unknown>>
    ): AsyncIterable<ProtocolAnnotation>;
}
```

## 3. Struktury przechowywania danych

### `RingSampleStore`
Płaski bufor kołowy zapewniający bezalokacyjny dostęp swobodny $O(1)$ oraz szybkie wyszukiwanie po czasie w $O(\log N)$.
- Metody: `addBlock()`, `getBlock()`, `findBlockIndexAtTime()`, `clear()`.

### `ChunkedIntervalTree<T>`
Drzewo przedziałów o organizacji blokowej (`CHUNK_SIZE = 1024`), eliminujące fragmentację sterty w V8 przy ponad 10 milionach węzłów.
- Umożliwia wyszukiwanie zakresowe w czasie $O(\log N + K)$ przy opóźnieniach poniżej 1 ms.

## 4. Zarządzanie cyklem życia sesji (`CaptureSession`)

Struktura sterująca stany przechwytywania danych:

```
┌─────────┐     start()      ┌───────────┐
│ STOPPED │ ───────────────> │ CAPTURING │
└─────────┘                  └───────────┘
     ▲                           │     ▲
     │          stop()           │     │ resume()
     ├───────────────────────────┤     │
     │                           ▼     │
     │   stop()              ┌───────────┐
     └────────────────────── │  PAUSED   │
                             └───────────┘
```

Próba wykonania niedozwolonego przejścia (np. `STOPPED` -> `PAUSED`) rzuca wyrazisty wyjątek `InvalidStateException`.

## 5. Przepływ danych w systemie (Diagram Mermaid)

```mermaid
sequenceDocument
sequenceDiagram
    autonumber
    participant HAL as Ingestion HAL (can-bus / serial)
    participant Store as RingSampleStore / ChunkedIntervalTree
    participant Session as CaptureSession (State Machine)
    participant DAG as DecoderRegistry (DAG Pipeline)
    participant UI as Konsumenci UI / Waveform / Table

    HAL->>Session: Sprawdzenie stanu (CAPTURING)
    alt Brak stanu CAPTURING
        HAL--xSession: Odmowa przetworzenia (InvalidStateException)
    else Stan CAPTURING aktywny
        HAL->>Store: addBlock(SampleBlock) / insert(Annotation)
        Store->>DAG: AsyncIterable<ProtocolAnnotation> / SampleWindow
        DAG->>DAG: decode(input, options)
        DAG-->>UI: Strumień zdekodowanych zdarzeń ProtocolAnnotation
    end
```

## 6. Jak używać `@theia/signal-core`

```ts
import { CaptureSession, SignalChannel, RingSampleStore, canFrameToAnnotation } from '@theia/signal-core';

// 1. Utworzenie sesji przechwytywania
const session = new CaptureSession('session-can-1');

// 2. Dodanie kanału sygnałowego
const channel = new SignalChannel({ id: 'ch-can0', name: 'CAN Bus 0', sampleRate: 500000 });
session.addChannel(channel);

// 3. Uruchomienie maszyny stanów
session.start(); // Przejście do CAPTURING
```
