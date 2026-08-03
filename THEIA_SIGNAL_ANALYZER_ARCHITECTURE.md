# Theia signal analyzer architecture assumptions

## Goal

Create a signal and protocol analysis workspace inside Theia that can:

- visualize digital and analog signals,
- display raw data in hex / ASCII / bit / numeric views,
- decode protocol regions,
- compare captures,
- store and replay sessions,
- support future extension for new protocol decoders and signal types.

## Recommended strategy

This should not be implemented as a single standalone feature. The most practical model is a hybrid architecture:

- a core product feature set implemented natively in the application,
- protocol-specific decoders and analysis plugins delivered through extensions.

That gives both:

- stable, user-facing core capabilities,
- high flexibility for future protocol families.

## Core product direction

The product should provide a common analysis shell with:

- signal capture / import session management,
- timeline and waveform rendering,
- XY plot support,
- selected-region interpretation,
- compare / diff / replay tools,
- persistence of captured traces and decoded results.

## Functional view

### 1. Raw data visualization

The system must support several raw display modes for selected ranges:

- hex
- ASCII
- bits
- decimal / numeric interpretation

This is the low-level inspection layer.

### 2. Signal interpretation

For selected regions, the tool should be able to:

- interpret data as time-based values,
- convert a selection into a semantic structure,
- present decoded values as text, numbers, state transitions, or structured frames.

This is the bridge between raw bytes and protocol meaning.

### 3. Signal analysis

The target use case is protocol analysis over captured signals, so the tooling must support:

- signal capture or importing previous traces,
- waveform display,
- XY plot for signal relationship visualization,
- annotation and selection over time ranges,
- marking, bookmarking, and export of analysis results.

### 4. Protocol analysis workflow

A typical workflow should look like this:

1. load or capture a signal trace,
2. inspect raw bytes / bits,
3. mark a region,
4. decode it using a protocol decoder,
5. show the semantic result in a structured panel,
6. compare with previous captures or alternate decodings,
7. persist and replay the session.

## Recommended architectural split

### Core layer

The core should contain reusable services and models such as:

- `CaptureSession`
- `SignalChannel`
- `SignalSample`
- `TraceRegion`
- `DecodeResult`
- `ComparisonSnapshot`
- `AnalysisService`

The core is responsible for:

- data storage,
- time / sample indexing,
- region selection,
- rendering shell integration,
- session management,
- comparison pipelines.

### Extension layer

Protocol-specific behavior should be delivered as extension providers, for example:

- `DecoderProvider`
- `VisualizerProvider`
- `ImportProvider`
- `ExportProvider`

Each extension can implement a decoder for a protocol family. The core system should not be hard-coded to one protocol.

## Recommended UI model

The UI should be composed from multiple coordinated panels:

- raw view panel: hex / ASCII / bit / numeric,
- waveform panel: digital and analog signal traces,
- XY plot panel: relationship between two signals,
- decoded structure panel: parsed frames and field values,
- comparison panel: capture-to-capture or region-to-region diff,
- session management panel: trace list, saved states, replay history.

## Practical implementation idea

A sound initial implementation path is:

1. implement the session and trace data model,
2. add a basic waveform renderer,
3. add a raw hex / ASCII / bit view,
4. add region selection and decode hooks,
5. integrate a small protocol decoder as the first provider,
6. add compare and replay capabilities,
7. evolve toward analog signal support after the digital workflow is stable.

## Design principle

The system should treat the signal trace as a first-class data object, and all visualization and decoding operations should operate on that object through stable service contracts.

This makes it easier to support:

- digital-only initial versions,
- later analog support,
- multiple protocols,
- multiple user interfaces.

## Final conclusion

The best architectural direction is:

- native core support for trace management, visualization, selection, session storage, and comparison,
- extension-driven protocol decoders and format-specific analysis modules.

This keeps the solution general enough for future protocol and signal types, while also making the first version usable and practical.
