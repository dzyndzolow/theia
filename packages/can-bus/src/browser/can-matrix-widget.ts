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
import { BaseWidget, ApplicationShell } from '@theia/core/lib/browser';
import { CanFrame, CanBinaryDecoder } from '../common/can-protocol';
import { FramePayloadInspector } from './frame-payload-inspector';
import { MatrixMessageExplorer } from './matrix-message-explorer';
import { TypedFieldDecoder } from './typed-field-decoder';
import { CanRpcClient } from './can-rpc-client';
import { CanWidget } from './can-widget';
import { CanInterfaceReservation } from './can-interface-reservation';

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
    count: number;
    lastTimestamp: number;
    deltaMs: number;
    freqHz: number;
    interface: string;
    lastChangedMs: number;
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

    protected readonly explorer = new MatrixMessageExplorer();
    protected matrixMap = new Map<string, CanMatrixRow>();
    protected isPaused = false;
    protected isCapturing = false;
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
        this.payloadInspector.onDidSelect(selection => this.typedFieldDecoder.setSelection(selection));

        this.toDispose.push(this.interfaceReservation.onDidChange(() => this.updateSourceChoices()));
        this.toDispose.push(this.shell.onDidAddWidget(() => this.updateSourceChoices()));
        this.toDispose.push(this.shell.onDidRemoveWidget(() => this.updateSourceChoices()));
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

    public addBinaryChunk(chunk: ArrayBuffer): void {
        if (this.isPaused || !this.isCapturing) { return; }
        CanBinaryDecoder.decodeBatch(chunk, frame => this.processFrame(frame));
        this.scheduleRender();
    }

    public processFrame(frame: CanFrame): void {
        const openAnalyzers = this.getOpenAnalyzers();
        if (this.selectedSourceId) {
            const target = openAnalyzers.find(a => a.id === this.selectedSourceId);
            if (!target || !target.selectedInterface || frame.interface !== target.selectedInterface) {
                return;
            }
        } else {
            const activeInterfaces = new Set(
                openAnalyzers
                    .map(a => a.selectedInterface)
                    .filter((iface): iface is string => !!iface)
            );
            if (activeInterfaces.size > 0 && (!frame.interface || !activeInterfaces.has(frame.interface))) {
                return;
            }
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
                count: message.count,
                lastTimestamp: now,
                deltaMs: 0,
                freqHz: 0,
                interface: frame.interface || 'can0',
                lastChangedMs: now
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
            if (dataChanged) {
                row.lastChangedMs = now;
            }
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
            const target = this.getOpenAnalyzers().find(a => a.id === this.selectedSourceId);
            if (target && target.selectedInterface) {
                this.canRpcClient.startCapture({ name: target.selectedInterface, bitrate: 500000, frameRate: 1000 });
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
        tableContainer.style.overflowY = 'auto';

        this.tableEl = document.createElement('table');
        this.tableEl.className = 'can-frame-table';

        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="width:110px">CAN ID (hex)</th>
                <th style="width:70px">Type</th>
                <th style="width:60px">DLC</th>
                <th style="width:90px">Count</th>
                <th style="width:90px">Freq (Hz)</th>
                <th style="width:90px">Period (ms)</th>
                <th style="width:260px">Data Payload (Hex)</th>
                <th style="width:130px">ASCII</th>
                <th style="width:80px">Interface</th>
            </tr>
        `;
        this.tableEl.appendChild(thead);

        this.tbodyEl = document.createElement('tbody');
        this.tableEl.appendChild(this.tbodyEl);

        tableContainer.appendChild(this.tableEl);
        this.node.appendChild(tableContainer);

        const detailPanel = document.createElement('div');
        detailPanel.className = 'can-frame-detail-panel';
        detailPanel.append(this.payloadInspector.node, this.typedFieldDecoder.node);
        this.node.appendChild(detailPanel);
    }

    public clearMatrix(): void {
        this.matrixMap.clear();
        this.explorer.clear();
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
            this.countValEl.textContent = String(this.explorer.size);
        }

        const sortedRows = Array.from(this.matrixMap.values()).sort((a, b) => a.id - b.id);
        const now = Date.now();

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
                tr.onclick = () => this.selectRow(row!);
                this.tbodyEl.appendChild(tr);
                this.rowElementsMap.set(row.key, tr);
            }
            tr.style.display = '';
            tr.classList.toggle('selected', row.key === this.selectedKey);

            const isRecentlyChanged = now - row.lastChangedMs < 400;
            const dataFormatted = row.data.map((b, idx) => {
                const hex = b.toString(16).padStart(2, '0').toUpperCase();
                if (row.changedMask[idx] && isRecentlyChanged) {
                    return `<span class="can-byte-changed" style="background:#8b0000;color:#fff;padding:0 2px;border-radius:2px;">${hex}</span>`;
                }
                return hex;
            }).join(' ');

            const asciiFormatted = row.data.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');

            tr.innerHTML = `
                <td style="font-family:monospace;font-weight:bold;color:#4ec9b0;">${row.hexId}</td>
                <td><span class="can-tag ${row.extended ? 'ext' : 'std'}">${row.extended ? 'EXT' : 'STD'}</span></td>
                <td>${row.dlc}</td>
                <td>${row.count}</td>
                <td style="color:#dcdcaa;">${row.freqHz} Hz</td>
                <td>${row.deltaMs} ms</td>
                <td style="font-family:monospace;">${dataFormatted}</td>
                <td style="font-family:monospace;color:#ce9178;">${asciiFormatted}</td>
                <td style="color:#569cd6;">${row.interface}</td>
            `;
        }
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
}
