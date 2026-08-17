// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/can-widget.css';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell, BaseWidget } from '@theia/core/lib/browser';
import { CanFrame, CanBinaryDecoder } from '../common/can-protocol';
import { FramePayloadInspector, PayloadSelection } from './frame-payload-inspector';
import { MatrixMessageExplorer } from './matrix-message-explorer';
import { TypedFieldDecoder } from './typed-field-decoder';
import { CanRpcClient } from './can-rpc-client';
import { CanWidget } from './can-widget';
import { CanInterfaceReservation } from './can-interface-reservation';
import { CAN_MATRIX_WORKER_SOURCE, CanMatrixWorkerResponse, CanMatrixWorkerUpdate } from './can-matrix-worker';
import { GlobalVariableRegistry, VariableId, VariableType } from '@theia/signal-core';
import { CanVariableBridge, CanBindingFieldType } from './can-variable-bridge';

export const CAN_MATRIX_WIDGET_ID = 'can-matrix-widget';
export const CAN_MATRIX_WIDGET_LABEL = 'CAN ID Matrix';

export interface CanMatrixRow {
    key: string;
    id: number;
    hexId: string;
    extended: boolean;
    rtr: boolean;
    dlc: number;
    data: number[];
    prevData: number[];
    changedMask: boolean[];
    changeCounts: number[];      // per-byte change counters
    lastChangedMs: number[];     // per-byte last-change timestamps
    count: number;
    lastTimestamp: number;
    deltaMs: number;
    freqHz: number;
    interface: string;
    rowLastChangedMs: number;    // row-level last change time
}

@injectable()
export class CanMatrixWidget extends BaseWidget {

    static readonly ID = CAN_MATRIX_WIDGET_ID;
    static readonly LABEL = CAN_MATRIX_WIDGET_LABEL;

    @inject(CanRpcClient)
    protected readonly canRpcClient!: CanRpcClient;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(CanInterfaceReservation)
    protected readonly interfaceReservation!: CanInterfaceReservation;

    @inject(GlobalVariableRegistry)
    protected readonly registry!: GlobalVariableRegistry;

    @inject(CanVariableBridge)
    protected readonly canVariableBridge!: CanVariableBridge;

    protected readonly explorer = new MatrixMessageExplorer();
    protected matrixMap = new Map<string, CanMatrixRow>();
    protected isPaused = false;
    protected isCapturing = true;
    protected filterText = '';
    protected selectedSourceId: string | undefined;

    // DOM Elements
    protected toolbarEl!: HTMLDivElement;
    protected filterInputEl!: HTMLInputElement;
    protected sourceSelectEl!: HTMLSelectElement;
    protected countValEl!: HTMLSpanElement;
    protected tableEl!: HTMLTableElement;
    protected tbodyEl!: HTMLTableSectionElement;
    protected rowElementsMap = new Map<string, HTMLTableRowElement>();
    protected readonly payloadInspector = new FramePayloadInspector();
    protected readonly typedFieldDecoder = new TypedFieldDecoder();
    protected selectedKey: string | undefined;
    protected highlightChangedBytes = true;
    protected matrixWorker: Worker | undefined;
    protected matrixWorkerUrl: string | undefined;

    protected rafId: number | undefined;
    protected dirty = false;

    @postConstruct()
    protected init(): void {
        this.id = CanMatrixWidget.ID;
        this.title.label = CanMatrixWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-th-list can-bus-icon';
        this.addClass('can-bus-widget');
        this.addClass('can-matrix-widget');

        this.initRpc();
        this.buildUI();
        this.startMatrixWorker();
        this.payloadInspector.onDidSelect(selection => {
            this.typedFieldDecoder.setSelection(selection);
            this.payloadInspector.setSelection(this.typedFieldDecoder.getSelection());
        });
        this.typedFieldDecoder.onSelectionChanged(() => {
            this.payloadInspector.setSelection(this.typedFieldDecoder.getSelection());
        });
        this.payloadInspector.onDidRequestBind(request => {
            const type = this.typedFieldDecoder.getType();
            const littleEndian = this.typedFieldDecoder.isLittleEndian();
            const divisor = this.typedFieldDecoder.getDivisor();
            const decoded = this.typedFieldDecoder.getDecodedValue();
            this.openBindDialog({
                frame: request.frame,
                selection: request.selection,
                type,
                littleEndian,
                divisor,
                decodedValue: decoded.raw
            });
        });

        this.toDispose.push(this.interfaceReservation.onDidChange(() => this.updateSourceChoices()));
        this.toDispose.push(this.shell.onDidAddWidget(() => this.updateSourceChoices()));
        this.toDispose.push(this.shell.onDidRemoveWidget(() => this.updateSourceChoices()));
        this.toDispose.push({ dispose: () => this.stopMatrixWorker() });
    }

    protected getOpenAnalyzers(): CanWidget[] {
        const analyzers: CanWidget[] = [];
        const areas: ApplicationShell.Area[] = ['main', 'bottom', 'left', 'right', 'secondaryWindow'];
        for (const area of areas) {
            try {
                const widgets = this.shell.getWidgets(area);
                for (const w of widgets) {
                    if (w instanceof CanWidget && !analyzers.includes(w)) {
                        analyzers.push(w);
                    }
                }
            } catch {
                // Ignore if layout area is unavailable
            }
        }
        return analyzers;
    }

    protected updateSourceChoices(): void {
        if (!this.sourceSelectEl) {
            return;
        }
        const openAnalyzers = this.getOpenAnalyzers();
        const currentVal = this.selectedSourceId;

        while (this.sourceSelectEl.firstChild) {
            this.sourceSelectEl.removeChild(this.sourceSelectEl.firstChild);
        }

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = openAnalyzers.length > 0 ? '-- All Active Analyzers --' : '-- No Open Analyzers --';
        this.sourceSelectEl.appendChild(defaultOpt);

        for (const analyzer of openAnalyzers) {
            const opt = document.createElement('option');
            opt.value = analyzer.id;
            const iface = analyzer.selectedInterface || 'No interface';
            opt.textContent = `${analyzer.title.label} (${iface})`;
            this.sourceSelectEl.appendChild(opt);
        }

        if (currentVal && openAnalyzers.some(a => a.id === currentVal)) {
            this.sourceSelectEl.value = currentVal;
        } else {
            this.selectedSourceId = undefined;
            this.sourceSelectEl.value = '';
        }
    }

    protected selectSource(sourceId: string | undefined): void {
        if (this.selectedSourceId === sourceId) {
            return;
        }
        this.selectedSourceId = sourceId;
        this.clearMatrix();
    }

    protected initRpc(): void {
        // All widgets share a single RPC connection (one channel per path per WebSocket connection).
        this.toDispose.push(this.canRpcClient.onBinaryFrames(chunk => this.addBinaryChunk(chunk)));
    }

    /**
     * Decode and aggregate binary batches outside the renderer. The transfer is
     * a copy because the same incoming RPC buffer is shared with other widgets.
     */
    protected startMatrixWorker(): void {
        if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
            return;
        }
        try {
            const blob = new Blob([CAN_MATRIX_WORKER_SOURCE], { type: 'text/javascript' });
            this.matrixWorkerUrl = URL.createObjectURL(blob);
            this.matrixWorker = new Worker(this.matrixWorkerUrl);
            this.matrixWorker.onmessage = event => this.applyWorkerUpdates(event.data as CanMatrixWorkerResponse);
            this.matrixWorker.onerror = () => this.stopMatrixWorker();
        } catch {
            // The synchronous fallback below keeps the matrix functional when a browser CSP blocks Blob workers.
            this.stopMatrixWorker();
        }
    }

    protected stopMatrixWorker(): void {
        if (this.matrixWorker) {
            this.matrixWorker.terminate();
            this.matrixWorker = undefined;
        }
        if (this.matrixWorkerUrl) {
            URL.revokeObjectURL(this.matrixWorkerUrl);
            this.matrixWorkerUrl = undefined;
        }
    }

    public addBinaryChunk(chunk: ArrayBuffer): void {
        if (this.isPaused || !this.isCapturing) { return; }
        if (this.matrixWorker) {
            try {
                const workerChunk = chunk.slice(0);
                this.matrixWorker.postMessage({ type: 'PROCESS_BATCH', chunk: workerChunk }, [workerChunk]);
                return;
            } catch {
                this.stopMatrixWorker();
            }
        }
        CanBinaryDecoder.decodeBatch(chunk, frame => this.processFrame(frame));
        this.scheduleRender();
    }

    protected acceptsFrame(frame: Pick<CanFrame, 'interface'>): boolean {
        const openAnalyzers = this.getOpenAnalyzers();
        if (this.selectedSourceId) {
            const target = openAnalyzers.find(a => a.id === this.selectedSourceId);
            if (!target || !target.selectedInterface || frame.interface !== target.selectedInterface) {
                return false;
            }
        } else {
            const activeInterfaces = new Set(
                openAnalyzers
                    .map(a => a.selectedInterface)
                    .filter((iface): iface is string => !!iface)
            );
            if (activeInterfaces.size > 0 && (!frame.interface || !activeInterfaces.has(frame.interface))) {
                return false;
            }
        }
        return true;
    }

    /** Applies pre-aggregated row updates received from the worker. */
    protected applyWorkerUpdates(response: CanMatrixWorkerResponse): void {
        if (response.type !== 'UPDATES') {
            return;
        }
        for (const update of response.updates) {
            if (!this.acceptsFrame(update)) {
                continue;
            }
            this.applyWorkerUpdate(update);
        }
        this.scheduleRender();
    }

    protected applyWorkerUpdate(update: CanMatrixWorkerUpdate): void {
        const row = this.matrixMap.get(update.key);
        if (!row) {
            this.matrixMap.set(update.key, {
                ...update,
                hexId: '0x' + update.id.toString(16).toUpperCase().padStart(update.extended ? 8 : 3, '0')
            });
        } else {
            row.data = update.data;
            row.prevData = update.prevData;
            row.changedMask = update.changedMask;
            row.changeCounts = update.changeCounts;
            row.lastChangedMs = update.lastChangedMs;
            row.count = update.count;
            row.lastTimestamp = update.lastTimestamp;
            row.deltaMs = update.deltaMs;
            row.freqHz = update.freqHz;
            row.rowLastChangedMs = update.rowLastChangedMs;
            row.dlc = update.dlc;
            row.rtr = update.rtr;
            row.interface = update.interface;
        }
        if (update.key === this.selectedKey) {
            const selected = this.matrixMap.get(update.key)!;
            const selectedFrame: CanFrame = {
                id: selected.id,
                extended: selected.extended,
                rtr: selected.rtr,
                data: selected.data,
                dlc: selected.dlc,
                timestamp: selected.lastTimestamp,
                interface: selected.interface
            };
            this.payloadInspector.setFrame(selectedFrame, true);
            this.typedFieldDecoder.setFrame(selectedFrame);
        }
        this.dirty = true;
    }

    public processFrame(frame: CanFrame): void {
        if (!this.acceptsFrame(frame)) {
            return;
        }

        const now = Date.now();
        const message = this.explorer.addFrame(frame, now);
        let row = this.matrixMap.get(message.key);

        if (!row) {
            row = {
                key: message.key,
                id: frame.id,
                hexId: '0x' + frame.id.toString(16).toUpperCase().padStart(frame.extended ? 8 : 3, '0'),
                extended: frame.extended,
                rtr: frame.rtr,
                dlc: frame.dlc,
                data: [...frame.data],
                prevData: [...frame.data],
                changedMask: new Array(frame.data.length).fill(false),
                changeCounts: new Array(frame.data.length).fill(0),
                lastChangedMs: new Array(frame.data.length).fill(0),
                count: message.count,
                lastTimestamp: now,
                deltaMs: 0,
                freqHz: 0,
                interface: frame.interface || 'can0',
                rowLastChangedMs: 0
            };
            this.matrixMap.set(message.key, row);
        } else {
            row.count = message.count;
            row.deltaMs = now - row.lastTimestamp;
            row.freqHz = Math.round(message.frequencyHz);
            row.lastTimestamp = now;
            row.dlc = frame.dlc;
            row.interface = frame.interface || row.interface;

            row.prevData = [...row.data];
            row.data = [...frame.data];

            let dataChanged = false;
            row.changedMask = row.data.map((byte, idx) => {
                const changed = row!.prevData[idx] !== byte;
                if (changed) { dataChanged = true; }
                return changed;
            });
            // Update per-byte change counts and timestamps
            for (let i = 0; i < row.changedMask.length; i++) {
                if (row.changedMask[i]) {
                    row.changeCounts[i]++;
                    row.lastChangedMs[i] = now;
                }
            }
            if (dataChanged) {
                row.rowLastChangedMs = now;
            }
        }
        if (message.key === this.selectedKey) {
            this.payloadInspector.setFrame(frame, true);
            this.typedFieldDecoder.setFrame(frame);
        }
        this.dirty = true;
    }

    protected buildUI(): void {
        this.node.innerHTML = '';

        // Toolbar
        this.toolbarEl = document.createElement('div');
        this.toolbarEl.className = 'can-toolbar';

        const startBtn = document.createElement('button');
        startBtn.className = 'theia-button secondary';
        startBtn.innerHTML = '▶ Start';
        startBtn.onclick = () => {
            this.isCapturing = true;
            const openAnalyzers = this.getOpenAnalyzers();
            const target = openAnalyzers.find(a => a.id === this.selectedSourceId);
            if (target && target.selectedInterface) {
                this.canRpcClient.startCapture({ name: target.selectedInterface, bitrate: 500000, frameRate: 1000 });
            } else if (openAnalyzers.length > 0) {
                for (const a of openAnalyzers) {
                    if (a.selectedInterface) {
                        this.canRpcClient.startCapture({ name: a.selectedInterface, bitrate: 500000, frameRate: 1000 });
                    }
                }
            } else {
                this.canRpcClient.startCapture({ name: 'demo', bitrate: 500000, frameRate: 1000 });
            }
        };

        const stopBtn = document.createElement('button');
        stopBtn.className = 'theia-button secondary';
        stopBtn.innerHTML = '⏹ Stop';
        stopBtn.onclick = () => {
            this.isCapturing = false;
        };

        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'theia-button secondary';
        pauseBtn.innerHTML = '<i class="fa fa-pause"></i> Pause';
        pauseBtn.onclick = () => {
            this.isPaused = !this.isPaused;
            pauseBtn.innerHTML = this.isPaused
                ? '<i class="fa fa-play"></i> Resume'
                : '<i class="fa fa-pause"></i> Pause';
        };

        const clearBtn = document.createElement('button');
        clearBtn.className = 'theia-button secondary';
        clearBtn.innerHTML = '<i class="fa fa-trash"></i> Clear Matrix';
        clearBtn.onclick = () => this.clearMatrix();

        const exportBtn = document.createElement('button');
        exportBtn.className = 'theia-button secondary';
        exportBtn.innerHTML = '<i class="fa fa-download"></i> Export CSV';
        exportBtn.onclick = () => this.exportCsv();

        this.filterInputEl = document.createElement('input');
        this.filterInputEl.type = 'text';
        this.filterInputEl.placeholder = 'Filter by ID (e.g. 102 or 0x102)...';
        this.filterInputEl.className = 'theia-input';
        this.filterInputEl.style.width = '200px';
        this.filterInputEl.oninput = () => {
            this.filterText = this.filterInputEl.value.trim().toLowerCase();
            this.dirty = true;
            this.scheduleRender();
        };

        const sourceLabel = document.createElement('label');
        sourceLabel.className = 'can-interface-label';
        sourceLabel.textContent = 'Source: ';
        this.sourceSelectEl = document.createElement('select');
        this.sourceSelectEl.className = 'theia-select';
        this.sourceSelectEl.onchange = () => this.selectSource(this.sourceSelectEl.value || undefined);
        sourceLabel.appendChild(this.sourceSelectEl);
        this.updateSourceChoices();

        const statsSpan = document.createElement('span');
        statsSpan.className = 'can-stats-bar';
        statsSpan.innerHTML = 'Unique IDs: ';
        this.countValEl = document.createElement('span');
        this.countValEl.textContent = '0';
        statsSpan.appendChild(this.countValEl);

        this.toolbarEl.appendChild(startBtn);
        this.toolbarEl.appendChild(stopBtn);
        this.toolbarEl.appendChild(pauseBtn);
        this.toolbarEl.appendChild(clearBtn);
        this.toolbarEl.appendChild(exportBtn);
        this.toolbarEl.appendChild(sourceLabel);
        this.toolbarEl.appendChild(this.filterInputEl);
        this.toolbarEl.appendChild(statsSpan);

        this.node.appendChild(this.toolbarEl);

        // Table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'can-table-container';
        tableContainer.style.flex = '1';
        tableContainer.style.minHeight = '0';
        tableContainer.style.overflow = 'auto';
        tableContainer.style.position = 'relative';
        tableContainer.style.isolation = 'isolate';

        this.tableEl = document.createElement('table');
        this.tableEl.className = 'can-frame-table';

        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="width:100px">CAN ID (hex)</th>
                <th style="width:55px">Type</th>
                <th style="width:45px">DLC</th>
                <th style="width:75px">Count</th>
                <th style="width:75px">Freq (Hz)</th>
                <th style="width:78px">Period (ms)</th>
                <th style="width:235px">Data Payload (Hex) <label class="can-payload-change-toggle"
                    title="Compare each payload with the preceding frame of this CAN ID"><input type="checkbox" checked> Highlight changes</label></th>
                <th style="width:105px">ASCII</th>
                <th style="width:190px" title="Each payload byte decoded as an unsigned 8-bit number">UINT8</th>
                <th style="width:205px" title="Each payload byte decoded as a signed 8-bit number">INT8</th>
                <th style="width:70px">Interface</th>
            </tr>
        `;
        this.tableEl.appendChild(thead);
        const changeToggle = thead.querySelector('.can-payload-change-toggle input') as HTMLInputElement;
        changeToggle.onchange = () => {
            this.highlightChangedBytes = changeToggle.checked;
            this.dirty = true;
            this.scheduleRender();
        };

        this.tbodyEl = document.createElement('tbody');
        this.tbodyEl.onpointerdown = event => {
            if (event.button !== 0) { return; }
            const target = event.target;
            if (!(target instanceof Element)) { return; }
            const tableRow = target.closest<HTMLTableRowElement>('tr[data-id]');
            if (!tableRow || !this.tbodyEl.contains(tableRow)) { return; }
            const key = tableRow.dataset.id;
            const row = key ? this.matrixMap.get(key) : undefined;
            if (row) {
                this.selectRow(row);
            }
        };
        this.tableEl.appendChild(this.tbodyEl);

        tableContainer.appendChild(this.tableEl);
        this.node.appendChild(tableContainer);

        const detailResizer = document.createElement('div');
        detailResizer.className = 'can-frame-detail-resizer';
        detailResizer.title = 'Drag vertically to resize Frame Payload Inspector';
        detailResizer.setAttribute('role', 'separator');
        detailResizer.setAttribute('aria-orientation', 'horizontal');

        const detailPanel = document.createElement('div');
        detailPanel.className = 'can-frame-detail-panel';
        let resizeStartY = 0;
        let resizeStartHeight = 0;
        detailResizer.onpointerdown = event => {
            resizeStartY = event.clientY;
            resizeStartHeight = detailPanel.getBoundingClientRect().height;
            detailResizer.setPointerCapture(event.pointerId);
            detailResizer.classList.add('dragging');
            event.preventDefault();
        };
        detailResizer.onpointermove = event => {
            if (!detailResizer.hasPointerCapture(event.pointerId)) { return; }
            const maxHeight = Math.max(96, this.node.clientHeight - 140);
            const requestedHeight = resizeStartHeight + resizeStartY - event.clientY;
            detailPanel.style.height = `${Math.max(96, Math.min(requestedHeight, maxHeight))}px`;
        };
        const finishResize = (event: PointerEvent): void => {
            if (detailResizer.hasPointerCapture(event.pointerId)) {
                detailResizer.releasePointerCapture(event.pointerId);
            }
            detailResizer.classList.remove('dragging');
        };
        detailResizer.onpointerup = finishResize;
        detailResizer.onpointercancel = finishResize;

        detailPanel.append(this.payloadInspector.node, this.typedFieldDecoder.node);
        this.node.append(detailResizer, detailPanel);
    }

    public clearMatrix(): void {
        this.matrixMap.clear();
        this.explorer.clear();
        this.matrixWorker?.postMessage({ type: 'RESET' });
        this.rowElementsMap.clear();
        this.tbodyEl.innerHTML = '';
        if (this.countValEl) {
            this.countValEl.textContent = '0';
        }
        this.selectedKey = undefined;
        this.payloadInspector.setFrame(undefined);
        this.typedFieldDecoder.setFrame(undefined);
        this.dirty = true;
    }

    public exportCsv(): void {
        const rows: string[] = ['CAN_ID_HEX,Type,DLC,Count,Freq_Hz,Period_ms,Data_Hex,Interface'];
        for (const row of this.matrixMap.values()) {
            const hexData = row.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            rows.push(`${row.hexId},${row.extended ? 'EXT' : 'STD'},${row.dlc},${row.count},${row.freqHz},${row.deltaMs},"${hexData}",${row.interface}`);
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `can_matrix_export_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    protected scheduleRender(): void {
        if (this.rafId !== undefined || !this.dirty) { return; }
        this.rafId = requestAnimationFrame(() => {
            this.rafId = undefined;
            this.renderMatrix();
        });
    }

    protected renderMatrix(): void {
        this.dirty = false;
        if (this.countValEl) {
            this.countValEl.textContent = String(this.matrixMap.size);
        }

        const now = Date.now();
        const sortedRows = Array.from(this.matrixMap.values()).sort((a, b) => a.id - b.id);
        for (const row of sortedRows) {
            if (this.filterText) {
                const matchesId = row.hexId.toLowerCase().includes(this.filterText) || String(row.id).includes(this.filterText);
                if (!matchesId) {
                    const existingRowEl = this.rowElementsMap.get(row.key);
                    if (existingRowEl) {
                        existingRowEl.style.display = 'none';
                    }
                    continue;
                }
            }

            let tr = this.rowElementsMap.get(row.key);
            if (!tr) {
                tr = document.createElement('tr');
                tr.setAttribute('data-id', row.key);
                this.tbodyEl.appendChild(tr);
                this.rowElementsMap.set(row.key, tr);
            }
            tr.style.display = '';
            tr.classList.toggle('selected', row.key === this.selectedKey);

            const dataFormatted = row.data.map((b, idx) => {
                const hex = b.toString(16).padStart(2, '0').toUpperCase();
                const lastChanged = row.lastChangedMs[idx];
                const msSinceChange = lastChanged > 0 ? now - lastChanged : Infinity;
                // Fade out after 1000ms, highlight only if recently changed
                const isRecentlyChanged = this.highlightChangedBytes && row.changedMask[idx] && msSinceChange < 1000;

                if (isRecentlyChanged) {
                    const previous = row.prevData[idx];
                    const previousHex = previous === undefined ? '--' : previous.toString(16).padStart(2, '0').toUpperCase();
                    const changeCount = row.changeCounts[idx];
                    const intensityClass = this.getByteIntensityClass(changeCount);
                    const fadeOpacity = this.getByteFadeOpacity(msSinceChange);
                    const title = `Changed from ${previousHex} to ${hex} (${changeCount} changes)`;
                    return `<span class="can-byte-changed can-byte-intensity-${intensityClass}"`
                        + ` style="--byte-highlight-opacity: ${fadeOpacity};" title="${title}">${hex}</span>`;
                }
                return `<span class="can-byte">${hex}</span>`;
            }).join(' ');

            const asciiFormatted = row.data.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
            const uint8Formatted = row.data.map(b => `<span>${b}</span>`).join('');
            const int8Formatted = row.data
                .map(b => `<span>${b < 0x80 ? b : b - 0x100}</span>`)
                .join('');

            tr.innerHTML = `
                <td style="font-family:monospace;font-weight:bold;color:#4ec9b0;">${row.hexId}</td>
                <td><span class="can-tag ${row.extended ? 'ext' : 'std'}">${row.extended ? 'EXT' : 'STD'}</span></td>
                <td>${row.dlc}</td>
                <td>${row.count}</td>
                <td style="color:#dcdcaa;">${row.freqHz} Hz</td>
                <td>${row.deltaMs} ms</td>
                <td style="font-family:monospace;">${dataFormatted}</td>
                <td style="font-family:monospace;color:#ce9178;">${asciiFormatted}</td>
                <td class="can-decoded-byte-values can-decoded-uint8">${uint8Formatted}</td>
                <td class="can-decoded-byte-values can-decoded-int8">${int8Formatted}</td>
                <td style="color:#569cd6;">${row.interface}</td>
            `;
        }
    }

    /** Returns intensity class based on change count: low (1-3), medium (4-9), high (10+) */
    protected getByteIntensityClass(changeCount: number): string {
        if (changeCount >= 10) { return 'high'; }
        if (changeCount >= 4) { return 'medium'; }
        return 'low';
    }

    /** Returns fade opacity (1.0 -> 0.0) over 1000ms */
    protected getByteFadeOpacity(msSinceChange: number): number {
        if (msSinceChange <= 200) { return 1.0; }
        if (msSinceChange >= 1000) { return 0; }
        return 1.0 - ((msSinceChange - 200) / 800);
    }

    protected selectRow(row: CanMatrixRow): void {
        this.selectedKey = row.key;
        const frame: CanFrame = {
            id: row.id,
            extended: row.extended,
            rtr: row.rtr,
            data: row.data,
            dlc: row.dlc,
            timestamp: row.lastTimestamp,
            interface: row.interface
        };
        this.payloadInspector.setFrame(frame);
        this.typedFieldDecoder.setFrame(frame);
        this.dirty = true;
        this.scheduleRender();
    }

    protected openBindDialog(event: {
        frame: CanFrame;
        selection: PayloadSelection;
        type: string;
        littleEndian: boolean;
        divisor: number;
        decodedValue: unknown;
    }): void {
        const { frame, selection, type, littleEndian, divisor } = event;
        const hexId = frame.id.toString(16).toUpperCase().padStart(frame.extended ? 8 : 3, '0');
        const isBit = Boolean(selection.isBitSelection || type === 'BIT' || type === 'BOOL');
        const startByte = selection.startByte;
        const startBit = selection.startBit ?? 0;
        const bitLength = selection.bitLength ?? 1;
        const byteLength = selection.byteLength;

        const overlay = document.createElement('div');
        overlay.className = 'can-bind-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'can-bind-modal';

        const header = document.createElement('div');
        header.className = 'can-bind-modal-header';
        header.innerHTML = '<h4><i class="fa fa-link"></i> Bind CAN Field to Global Variable</h4>';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'can-close-btn';
        closeBtn.textContent = '×';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);

        const infoBar = document.createElement('div');
        infoBar.className = 'can-bind-info-bar';
        const fieldDesc = isBit ? `Byte ${startByte}, Bit ${startBit}` : (byteLength > 1 ? `Bytes ${startByte}..${startByte + byteLength - 1}` : `Byte ${startByte}`);
        infoBar.innerHTML = `<span><strong>CAN ID:</strong> 0x${hexId}</span> <span><strong>Field:</strong> ${fieldDesc}</span> <span><strong>Type:</strong> ${type}</span>`;

        // Mode switch
        const modeRow = document.createElement('div');
        modeRow.className = 'can-bind-mode-row';

        const radioNew = document.createElement('input');
        radioNew.type = 'radio';
        radioNew.name = `bind-mode-${Date.now()}`;
        radioNew.id = 'bind-mode-new';
        radioNew.checked = true;

        const labelNew = document.createElement('label');
        labelNew.htmlFor = 'bind-mode-new';
        labelNew.textContent = ' Create New Variable';

        const radioExist = document.createElement('input');
        radioExist.type = 'radio';
        radioExist.name = radioNew.name;
        radioExist.id = 'bind-mode-exist';

        const labelExist = document.createElement('label');
        labelExist.htmlFor = 'bind-mode-exist';
        labelExist.textContent = ' Bind to Existing Variable';

        modeRow.append(radioNew, labelNew, radioExist, labelExist);

        // New Variable Form
        const newForm = document.createElement('div');
        newForm.className = 'can-bind-section';

        const defaultName = isBit
            ? `can_0x${hexId}_b${startByte}_bit${startBit}`
            : (byteLength > 1 ? `can_0x${hexId}_b${startByte}_${startByte + byteLength - 1}` : `can_0x${hexId}_b${startByte}`);

        const nameInput = document.createElement('input');
        nameInput.className = 'theia-input';
        nameInput.value = defaultName;
        nameInput.placeholder = 'Variable Name (e.g. engine.oil_temp)';

        const typeSelect = document.createElement('select');
        typeSelect.className = 'theia-select';
        const varTypes: readonly string[] = ['BOOL', 'UINT8', 'INT8', 'UINT16', 'INT16', 'UINT32', 'INT32', 'FLOAT32', 'FLOAT64', 'STRING', 'BYTES'];
        for (const vt of varTypes) {
            const opt = document.createElement('option');
            opt.value = vt;
            opt.textContent = vt;
            if (isBit && vt === 'BOOL') {
                opt.selected = true;
            } else if (!isBit && vt === type) {
                opt.selected = true;
            } else if (!isBit && (type === 'UINT' || type === 'INT') && vt === 'UINT32') {
                opt.selected = true;
            }
            typeSelect.appendChild(opt);
        }

        const unitInput = document.createElement('input');
        unitInput.className = 'theia-input';
        unitInput.placeholder = 'Unit (e.g. RPM, °C, flag)';

        const groupInput = document.createElement('input');
        groupInput.className = 'theia-input';
        groupInput.value = `CAN_0x${hexId}`;
        groupInput.placeholder = 'Group';

        newForm.append(
            this.createFormField('Variable Name:', nameInput),
            this.createFormField('Variable Type:', typeSelect),
            this.createFormField('Unit:', unitInput),
            this.createFormField('Group:', groupInput)
        );

        // Existing Variable Select
        const existForm = document.createElement('div');
        existForm.className = 'can-bind-section';
        existForm.style.display = 'none';

        const existSelect = document.createElement('select');
        existSelect.className = 'theia-select';
        const existingVars = this.registry.list();
        if (existingVars.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- No existing variables found --';
            existSelect.appendChild(opt);
        } else {
            for (const v of existingVars) {
                const opt = document.createElement('option');
                opt.value = v.definition.id;
                opt.textContent = `${v.definition.name} (${v.definition.type})`;
                existSelect.appendChild(opt);
            }
        }
        existForm.append(this.createFormField('Select Variable:', existSelect));

        radioNew.onchange = () => {
            newForm.style.display = 'block';
            existForm.style.display = 'none';
        };
        radioExist.onchange = () => {
            newForm.style.display = 'none';
            existForm.style.display = 'block';
        };

        // Active Bindings for this CAN ID
        const activeBindings = this.canVariableBridge.getBindingsForCanId(frame.id);
        const bindingsList = document.createElement('div');
        bindingsList.className = 'can-active-bindings-list';
        if (activeBindings.length > 0) {
            const activeTitle = document.createElement('h5');
            activeTitle.textContent = `Active Bindings for CAN 0x${hexId} (${activeBindings.length}):`;
            bindingsList.appendChild(activeTitle);
            for (const b of activeBindings) {
                const boundVar = this.registry.get(b.variableId);
                const item = document.createElement('div');
                item.className = 'can-binding-item';
                const bitTxt = b.isBit ? `b${b.startByte}.bit${b.startBit}` : `b${b.startByte} (${b.type})`;
                item.innerHTML = `<span><strong>${boundVar?.definition.name ?? b.variableId}</strong> ➔ ${bitTxt}</span>`;
                const removeBtn = document.createElement('button');
                removeBtn.className = 'theia-button secondary icon-only';
                removeBtn.title = 'Remove binding';
                removeBtn.innerHTML = '<i class="fa fa-trash"></i>';
                removeBtn.onclick = () => {
                    this.canVariableBridge.removeBinding(b.id);
                    item.remove();
                };
                item.appendChild(removeBtn);
                bindingsList.appendChild(item);
            }
        }

        // Actions
        const btnRow = document.createElement('div');
        btnRow.className = 'can-bind-modal-actions';

        const submitBtn = document.createElement('button');
        submitBtn.className = 'theia-button primary';
        submitBtn.innerHTML = '<i class="fa fa-check"></i> Create Binding';
        submitBtn.onclick = () => {
            try {
                let targetVarId: VariableId;
                if (radioNew.checked) {
                    const name = nameInput.value.trim();
                    if (!name) {
                        alert('Please enter a variable name.');
                        return;
                    }
                    const vType = typeSelect.value as VariableType;
                    const created = this.registry.define({
                        name,
                        type: vType,
                        writable: true,
                        unit: unitInput.value.trim() || undefined,
                        group: groupInput.value.trim() || undefined,
                        description: `Bound from CAN ID 0x${hexId} [${fieldDesc}]`,
                        source: { type: 'CAN_PAYLOAD', details: { canId: frame.id, field: fieldDesc } }
                    });
                    targetVarId = created.id;
                } else {
                    targetVarId = existSelect.value as VariableId;
                    if (!targetVarId) {
                        alert('Please select an existing variable.');
                        return;
                    }
                }

                this.canVariableBridge.addBinding({
                    variableId: targetVarId,
                    canId: frame.id,
                    extended: frame.extended,
                    interfaceName: frame.interface,
                    startByte,
                    byteLength,
                    startBit,
                    bitLength,
                    isBit,
                    type: isBit ? 'BOOL' : (type as CanBindingFieldType),
                    littleEndian,
                    divisor
                });

                overlay.remove();
            } catch (err: unknown) {
                alert((err as Error).message);
            }
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'theia-button secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => overlay.remove();

        btnRow.append(submitBtn, cancelBtn);

        modal.append(header, infoBar, modeRow, newForm, existForm, bindingsList, btnRow);
        overlay.appendChild(modal);
        this.node.appendChild(overlay);
    }

    protected createFormField(label: string, element: HTMLElement): HTMLElement {
        const row = document.createElement('div');
        row.className = 'can-bind-form-row';
        const lbl = document.createElement('label');
        lbl.textContent = label;
        row.append(lbl, element);
        return row;
    }
}
