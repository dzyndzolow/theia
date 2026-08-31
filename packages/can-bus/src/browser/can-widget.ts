// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/can-widget.css';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, Message, Widget } from '@theia/core/lib/browser';
import { CanFrame, CanStatistics, CanBusWidget, CanBinaryDecoder } from '../common/can-protocol';
import { RingBuffer } from './ring-buffer';
import { FpsCanvasRenderer } from './fps-canvas';
import { CanInterfaceReservation } from './can-interface-reservation';
import { CanRpcClient } from './can-rpc-client';

const MAX_FRAMES = 1000;
const TABLE_ROWS = 50;

@injectable()
export class CanWidget extends BaseWidget {

    static readonly ID = CanBusWidget.ID;
    static readonly LABEL = CanBusWidget.LABEL;

    @inject(CanRpcClient)
    protected readonly canRpcClient!: CanRpcClient;

    @inject(CanInterfaceReservation)
    protected readonly interfaceReservation!: CanInterfaceReservation;

    protected initRpc(): void {
        // All widgets share a single RPC connection (one channel per path per WebSocket connection).
        this.toDispose.push(this.canRpcClient.onBinaryFrames(chunk => this.addBinaryChunk(chunk)));
    }

    protected frames = new RingBuffer<CanFrame>(MAX_FRAMES);
    protected statistics: CanStatistics = {
        totalFrames: 0,
        framesPerSecond: 0,
        errors: 0,
        busLoad: 0,
        startTime: Date.now()
    };
    protected isCapturing = false;

    // DOM elements
    protected toolbarEl!: HTMLDivElement;
    protected statsEl!: HTMLDivElement;
    protected chartContainer!: HTMLDivElement;
    protected frameTableEl!: HTMLTableElement;
    protected canvasEl!: HTMLCanvasElement;
    protected fpsRenderer!: FpsCanvasRenderer;

    // DOM elements for stats (no innerHTML on hot updates)
    protected statusValEl!: HTMLSpanElement;
    protected totalFramesValEl!: HTMLSpanElement;
    protected fpsValEl!: HTMLSpanElement;
    protected errorsValEl!: HTMLSpanElement;
    protected busLoadValEl!: HTMLSpanElement;
    protected interfaceSelectEl!: HTMLSelectElement;
    public selectedInterface: string | undefined;

    // Recycled DOM row pool (object pooling — no allocations per frame)
    protected rowPool: HTMLTableRowElement[] = [];
    protected tbodyEl!: HTMLTableSectionElement;
    protected rafId: number | undefined;
    protected dirty = false;
    protected lastRenderTime = 0;

    @postConstruct()
    protected init(): void {
        this.initRpc();
        this.id = CanBusWidget.ID;
        this.title.label = CanBusWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-microchip can-bus-icon';
        this.addClass('can-bus-widget');
        this.scrollOptions = undefined;
        this.buildUI();
        this.toDispose.push(this.interfaceReservation.onDidChange(() => this.updateInterfaceChoices()));
        this.toDispose.push(this.canRpcClient.onDidChangeInterfaces(() => this.updateInterfaceChoices()));
        this.onDidDispose(() => this.interfaceReservation.release(this.id));
    }

    protected buildUI(): void {
        // Toolbar
        this.toolbarEl = document.createElement('div');
        this.toolbarEl.className = 'can-toolbar';

        const startBtn = this.createButton('▶ Start', () => this.startCapture());
        const stopBtn = this.createButton('⏹ Stop', () => this.stopCapture());
        const clearBtn = this.createButton('🗑 Clear', () => this.clearData());

        const interfaceLabel = document.createElement('label');
        interfaceLabel.className = 'can-interface-label';
        interfaceLabel.textContent = 'Interface: ';
        this.interfaceSelectEl = document.createElement('select');
        this.interfaceSelectEl.className = 'theia-select';
        this.interfaceSelectEl.onchange = () => this.selectInterface(this.interfaceSelectEl.value || undefined);
        interfaceLabel.appendChild(this.interfaceSelectEl);
        this.updateInterfaceChoices();

        this.toolbarEl.appendChild(startBtn);
        this.toolbarEl.appendChild(stopBtn);
        this.toolbarEl.appendChild(clearBtn);
        this.toolbarEl.appendChild(interfaceLabel);

        // Stats bar with pre-allocated spans (no innerHTML calls on hot path)
        this.statsEl = document.createElement('div');
        this.statsEl.className = 'can-stats';

        this.statusValEl = document.createElement('span');
        this.totalFramesValEl = document.createElement('span');
        this.fpsValEl = document.createElement('span');
        this.errorsValEl = document.createElement('span');
        this.busLoadValEl = document.createElement('span');

        this.statsEl.appendChild(this.createStatWrapper('Status:', this.statusValEl));
        this.statsEl.appendChild(this.createStatWrapper('Frames:', this.totalFramesValEl));
        this.statsEl.appendChild(this.createStatWrapper('FPS:', this.fpsValEl));
        this.statsEl.appendChild(this.createStatWrapper('Errors:', this.errorsValEl));
        this.statsEl.appendChild(this.createStatWrapper('Bus Load:', this.busLoadValEl));

        this.updateStatsDisplay();

        // Chart area
        this.chartContainer = document.createElement('div');
        this.chartContainer.className = 'can-chart-container';
        this.canvasEl = document.createElement('canvas');
        this.canvasEl.className = 'can-chart-canvas';
        this.chartContainer.appendChild(this.canvasEl);
        this.fpsRenderer = new FpsCanvasRenderer(this.canvasEl);

        // Frame table with recyclable row pool constructed via DOM API
        this.frameTableEl = document.createElement('table');
        this.frameTableEl.className = 'can-frame-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const headers = ['Timestamp', 'ID (hex)', 'Type', 'DLC', 'Data', 'Interface'];
        headers.forEach(hText => {
            const th = document.createElement('th');
            th.textContent = hText;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        this.frameTableEl.appendChild(thead);

        this.tbodyEl = document.createElement('tbody');
        this.frameTableEl.appendChild(this.tbodyEl);

        // Pre-allocate row pool
        for (let i = 0; i < TABLE_ROWS; i++) {
            const row = document.createElement('tr');
            for (let c = 0; c < 6; c++) {
                const td = document.createElement('td');
                if (c === 1) { td.className = 'can-id'; }
                if (c === 4) { td.className = 'can-data'; }
                row.appendChild(td);
            }
            this.tbodyEl.appendChild(row);
            this.rowPool.push(row);
        }

        this.node.appendChild(this.toolbarEl);
        this.node.appendChild(this.statsEl);
        this.node.appendChild(this.chartContainer);
        this.node.appendChild(this.frameTableEl);
    }

    protected createStatWrapper(label: string, valueEl: HTMLSpanElement): HTMLSpanElement {
        const span = document.createElement('span');
        span.className = 'can-stat';
        const strong = document.createElement('strong');
        strong.textContent = label + ' ';
        span.appendChild(strong);
        span.appendChild(valueEl);
        return span;
    }

    protected createButton(text: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'can-btn theia-button';
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        return btn;
    }

    async startCapture(): Promise<void> {
        if (!this.selectedInterface) {
            return;
        }
        this.isCapturing = true;
        this.statistics.startTime = Date.now();
        this.updateStatsDisplay();
        await this.canRpcClient.startCapture({ name: this.selectedInterface, bitrate: 500000, frameRate: 1000 });
    }

    async stopCapture(): Promise<void> {
        this.isCapturing = false;
        this.updateStatsDisplay();
        if (this.selectedInterface) {
            await this.canRpcClient.stopCapture(this.selectedInterface);
        }
    }

    clearData(): void {
        this.frames.clear();
        this.statistics = {
            totalFrames: 0,
            framesPerSecond: 0,
            errors: 0,
            busLoad: 0,
            startTime: Date.now()
        };
        this.fpsRenderer.clear();
        this.updateStatsDisplay();
        this.scheduleRender();
    }

    protected async selectInterface(interfaceName: string | undefined): Promise<void> {
        if (interfaceName === '__ADD_TCP__') {
            const host = window.prompt('Enter ESP32-S3 IP or hostname (e.g. 192.168.1.150):', '192.168.1.150');
            if (host && host.trim()) {
                const portStr = window.prompt('Enter TCP port (default 9751):', '9751');
                const port = portStr ? parseInt(portStr.trim(), 10) : 9751;
                try {
                    const newIface = await this.canRpcClient.registerTcpDevice(host.trim(), isNaN(port) ? 9751 : port);
                    interfaceName = newIface.id;
                } catch (err) {
                    console.error('Failed to register TCP device:', err);
                    this.updateInterfaceChoices();
                    return;
                }
            } else {
                this.updateInterfaceChoices();
                return;
            }
        }

        if (interfaceName === this.selectedInterface) {
            return;
        }
        if (interfaceName && !this.interfaceReservation.reserve(this.id, interfaceName)) {
            this.updateInterfaceChoices();
            return;
        }
        if (!interfaceName) {
            this.interfaceReservation.release(this.id);
        }
        this.selectedInterface = interfaceName;
        this.updateInterfaceChoices();
    }

    protected async updateInterfaceChoices(): Promise<void> {
        if (!this.interfaceSelectEl) {
            return;
        }
        const previous = this.selectedInterface || '';
        this.interfaceSelectEl.replaceChildren();

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Choose interface…';
        this.interfaceSelectEl.appendChild(placeholder);

        try {
            const ifaces = await this.canRpcClient.getAvailableInterfaces();
            const groups: { [key: string]: HTMLOptGroupElement } = {
                VIRTUAL: document.createElement('optgroup'),
                ESP32: document.createElement('optgroup'),
                PCAN: document.createElement('optgroup'),
                SLCAN: document.createElement('optgroup'),
                OTHER: document.createElement('optgroup')
            };

            groups.VIRTUAL.label = 'Virtual / Simulators';
            groups.ESP32.label = 'ESP32-S3 Hardware';
            groups.PCAN.label = 'PCAN Adapters';
            groups.SLCAN.label = 'CANable / SLCAN Adapters';
            groups.OTHER.label = 'Other Hardware';

            for (const iface of ifaces) {
                const opt = document.createElement('option');
                opt.value = iface.id;
                opt.textContent = iface.displayName;
                opt.disabled = this.interfaceReservation.isReservedByOther(this.id, iface.id);

                const grp = groups[iface.category] || groups.OTHER;
                grp.appendChild(opt);
            }

            for (const g of Object.values(groups)) {
                if (g.children.length > 0) {
                    this.interfaceSelectEl.appendChild(g);
                }
            }
        } catch {
            // Fallback for offline/mock mode
            for (const interfaceName of ['demo', 'demo2', 'sim0']) {
                const option = document.createElement('option');
                option.value = interfaceName;
                option.textContent = interfaceName;
                option.disabled = this.interfaceReservation.isReservedByOther(this.id, interfaceName);
                this.interfaceSelectEl.appendChild(option);
            }
        }

        // Add special action option to configure new TCP endpoint
        const addTcpOpt = document.createElement('option');
        addTcpOpt.value = '__ADD_TCP__';
        addTcpOpt.textContent = '➕ Add TCP Device (IP:Port)…';
        this.interfaceSelectEl.appendChild(addTcpOpt);

        this.interfaceSelectEl.value = previous;
    }

    addFrame(frame: CanFrame): void {
        // The shared RPC stream carries all active interfaces; keep only this widget's selection.
        if (frame.interface !== this.selectedInterface) {
            return;
        }
        this.frames.push(frame);
        this.statistics.totalFrames++;
        const elapsed = (Date.now() - this.statistics.startTime) / 1000;
        this.statistics.framesPerSecond = elapsed > 0
            ? Math.round(this.statistics.totalFrames / elapsed)
            : 0;
        this.statistics.busLoad = Math.min(100, (this.statistics.framesPerSecond / 5000) * 100);
        this.scheduleRender();
    }

    /** Receive binary chunk containing multiple packed frames and parse zero-allocation. */
    addBinaryChunk(chunk: ArrayBuffer): void {
        if (!this.isCapturing) {
            return;
        }
        CanBinaryDecoder.decodeBatch(chunk, frame => this.addFrame(frame));
    }

    /** Throttle rendering to ~20 FPS (50ms interval) via requestAnimationFrame with a dirty flag. */
    protected scheduleRender(): void {
        if (this.dirty) { return; }
        this.dirty = true;
        this.rafId = requestAnimationFrame(timestamp => {
            this.dirty = false;
            this.rafId = undefined;

            if (timestamp - this.lastRenderTime < 45) {
                return;
            }
            this.lastRenderTime = timestamp;

            this.updateStatsDisplay();
            this.updateFrameTable();
            this.drawChart();
        });
    }

    protected override onAfterDetach(msg: Message): void {
        if (this.rafId !== undefined) {
            cancelAnimationFrame(this.rafId);
            this.rafId = undefined;
        }
        super.onAfterDetach(msg);
    }

    protected updateStatsDisplay(): void {
        const s = this.statistics;
        this.statusValEl.textContent = this.isCapturing ? '● Capturing' : '○ Idle';
        this.statusValEl.className = this.isCapturing ? 'status-active' : 'status-idle';

        // totalFrames counts all frames ever received, not just those in the visible ring buffer
        this.totalFramesValEl.textContent = String(s.totalFrames);
        this.fpsValEl.textContent = String(s.framesPerSecond);
        this.errorsValEl.textContent = String(s.errors);
        this.busLoadValEl.textContent = `${s.busLoad.toFixed(1)}%`;
    }

    protected updateFrameTable(): void {
        const recent = this.frames.last(TABLE_ROWS).reverse();
        for (let i = 0; i < TABLE_ROWS; i++) {
            const row = this.rowPool[i];
            const cells = row.children;
            if (i < recent.length) {
                const f = recent[i];
                cells[0].textContent = f.timestamp.toFixed(3);
                (cells[1] as HTMLElement).textContent = '0x' + f.id.toString(16).toUpperCase().padStart(f.extended ? 8 : 3, '0');
                cells[2].textContent = (f.extended ? 'EXT' : 'STD') + (f.rtr ? ' RTR' : '');
                cells[3].textContent = String(f.dlc);
                (cells[4] as HTMLElement).textContent = f.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
                cells[5].textContent = f.interface;
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    }

    protected drawChart(): void {
        const computedStyle = getComputedStyle(this.node);
        const fpsColor = computedStyle.getPropertyValue('--theia-symbolIcon-keywordForeground').trim() || '#4CAF50';
        const busLoadColor = computedStyle.getPropertyValue('--theia-symbolIcon-stringForeground').trim() || '#2196F3';
        const gridColor = computedStyle.getPropertyValue('--theia-border').trim() || 'rgba(128,128,128,0.2)';

        this.fpsRenderer.setColors({ fpsColor, busLoadColor, gridColor });
        this.fpsRenderer.pushSample(this.statistics.framesPerSecond, this.statistics.busLoad);
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.update();
    }

    protected override onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        const w = this.chartContainer.clientWidth || 800;
        const h = this.chartContainer.clientHeight || 160;
        this.fpsRenderer.resize(w, h);
    }
}

