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
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, Message } from '@theia/core/lib/browser';
import { CanFrame, CanStatistics, CanBusWidget } from '../common/can-protocol';

@injectable()
export class CanWidget extends BaseWidget {

    static override readonly ID = CanBusWidget.ID;
    static override readonly LABEL = CanBusWidget.LABEL;

    protected frames: CanFrame[] = [];
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

    @postConstruct()
    protected init(): void {
        this.id = CanBusWidget.ID;
        this.title.label = CanBusWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-microchip can-bus-icon';
        this.addClass('can-bus-widget');
        this.scrollOptions = undefined;
        this.buildUI();
    }

    protected buildUI(): void {
        // Toolbar
        this.toolbarEl = document.createElement('div');
        this.toolbarEl.className = 'can-toolbar';

        const startBtn = this.createButton('▶ Start', () => this.startCapture());
        const stopBtn = this.createButton('⏹ Stop', () => this.stopCapture());
        const clearBtn = this.createButton('🗑 Clear', () => this.clearData());
        const interfaceLabel = document.createElement('span');
        interfaceLabel.className = 'can-interface-label';
        interfaceLabel.textContent = 'Interface: any';

        this.toolbarEl.appendChild(startBtn);
        this.toolbarEl.appendChild(stopBtn);
        this.toolbarEl.appendChild(clearBtn);
        this.toolbarEl.appendChild(interfaceLabel);

        // Stats bar
        this.statsEl = document.createElement('div');
        this.statsEl.className = 'can-stats';
        this.updateStatsDisplay();

        // Chart area (canvas placeholder)
        this.chartContainer = document.createElement('div');
        this.chartContainer.className = 'can-chart-container';
        this.canvasEl = document.createElement('canvas');
        this.canvasEl.className = 'can-chart-canvas';
        this.canvasEl.width = 800;
        this.canvasEl.height = 200;
        this.chartContainer.appendChild(this.canvasEl);

        // Frame table
        this.frameTableEl = document.createElement('table');
        this.frameTableEl.className = 'can-frame-table';
        this.frameTableEl.innerHTML = `
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>ID (hex)</th>
                    <th>Type</th>
                    <th>DLC</th>
                    <th>Data</th>
                    <th>Interface</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        this.node.appendChild(this.toolbarEl);
        this.node.appendChild(this.statsEl);
        this.node.appendChild(this.chartContainer);
        this.node.appendChild(this.frameTableEl);
    }

    protected createButton(text: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'can-btn theia-button';
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        return btn;
    }

    startCapture(): void {
        this.isCapturing = true;
        this.statistics.startTime = Date.now();
        this.updateStatsDisplay();
        // TODO: connect to backend CAN service
        console.log('[CAN] Capture started');
    }

    stopCapture(): void {
        this.isCapturing = false;
        this.updateStatsDisplay();
        // TODO: disconnect from backend CAN service
        console.log('[CAN] Capture stopped');
    }

    clearData(): void {
        this.frames = [];
        this.statistics = {
            totalFrames: 0,
            framesPerSecond: 0,
            errors: 0,
            busLoad: 0,
            startTime: Date.now()
        };
        this.updateStatsDisplay();
        this.updateFrameTable();
        this.drawChart();
    }

    addFrame(frame: CanFrame): void {
        this.frames.push(frame);
        if (this.frames.length > 1000) {
            this.frames.shift(); // keep last 1000 frames
        }
        this.statistics.totalFrames++;
        const elapsed = (Date.now() - this.statistics.startTime) / 1000;
        this.statistics.framesPerSecond = elapsed > 0
            ? Math.round(this.statistics.totalFrames / elapsed)
            : 0;
        this.updateStatsDisplay();
        this.updateFrameTable();
        this.drawChart();
    }

    protected updateStatsDisplay(): void {
        const s = this.statistics;
        this.statsEl.innerHTML = `
            <span class="can-stat">
                <strong>Status:</strong>
                <span class="${this.isCapturing ? 'status-active' : 'status-idle'}">
                    ${this.isCapturing ? '● Capturing' : '○ Idle'}
                </span>
            </span>
            <span class="can-stat"><strong>Frames:</strong> ${s.totalFrames}</span>
            <span class="can-stat"><strong>FPS:</strong> ${s.framesPerSecond}</span>
            <span class="can-stat"><strong>Errors:</strong> ${s.errors}</span>
            <span class="can-stat"><strong>Bus Load:</strong> ${s.busLoad.toFixed(1)}%</span>
        `;
    }

    protected updateFrameTable(): void {
        const tbody = this.frameTableEl.querySelector('tbody')!;
        // Show last 50 frames
        const recent = this.frames.slice(-50).reverse();
        tbody.innerHTML = recent.map(f => `
            <tr>
                <td>${f.timestamp.toFixed(3)}</td>
                <td class="can-id">0x${f.id.toString(16).toUpperCase().padStart(f.extended ? 8 : 3, '0')}</td>
                <td>${f.extended ? 'EXT' : 'STD'}${f.rtr ? ' RTR' : ''}</td>
                <td>${f.dlc}</td>
                <td class="can-data">${f.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}</td>
                <td>${f.interface}</td>
            </tr>
        `).join('');
    }

    protected drawChart(): void {
        const canvas = this.canvasEl;
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Draw grid
        ctx.strokeStyle = 'var(--theia-editorWidget-border, #333)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < 5; i++) {
            const y = (h / 5) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Draw FPS line from recent frames
        const recentFrames = this.frames.slice(-200);
        if (recentFrames.length < 2) { return; }

        const maxFps = Math.max(10, this.statistics.framesPerSecond * 1.5);
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const stepX = w / recentFrames.length;
        recentFrames.forEach((frame, i) => {
            // Approximate instantaneous rate from timestamps
            const x = i * stepX;
            const y = h - (h * 0.1) - ((h * 0.8) / 2); // placeholder: flat line for now
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Title
        ctx.fillStyle = 'var(--theia-foreground, #ccc)';
        ctx.font = '10px sans-serif';
        ctx.fillText('CAN Bus Activity (placeholder)', 10, 15);
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.update();
    }

    protected override onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        this.canvasEl.width = this.chartContainer.clientWidth || 800;
        this.drawChart();
    }
}
