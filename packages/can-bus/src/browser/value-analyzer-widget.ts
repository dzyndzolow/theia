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
import { ApplicationShell, BaseWidget, Message, Widget } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';
import { CanRpcClient } from './can-rpc-client';
import { CanWidget } from './can-widget';
import {
    extractSamplesFromChunk,
    requiredBytesForType,
    VALUE_FIELD_TYPES,
    validateFieldConfig,
    ValueFieldConfig,
    ValueFieldType,
    ValueSampleStore,
    ValueSignalConfig
} from './value-signal-extractor';
import { computeAutoWindow, VALUE_WINDOW_MAX_MS, VALUE_WINDOW_MIN_MS, ValuePlotRenderer } from './value-plot-renderer';

export const VALUE_ANALYZER_WIDGET_ID = 'can-value-analyzer-widget';
export const VALUE_ANALYZER_WIDGET_LABEL = 'CAN Value Analyzer';

/** Options accepted by the widget factory. */
export interface ValueAnalyzerOptions {
    id?: string;
    /** Initial signal configuration (CAN ID, field layout, decoding). */
    config?: Partial<ValueSignalConfig>;
    /** Initial fixed time window in milliseconds; ignored when autoWindow is enabled. */
    windowMs?: number;
}

/** Fixed time window choices (ms) selectable by the user, 1 ms ... 100 s. */
export const VALUE_WINDOW_CHOICES_MS: readonly number[] = Object.freeze([
    1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 10_000, 100_000
]);

const DEFAULT_WINDOW_MS = 100;
const RENDER_INTERVAL_MS = 50;

@injectable()
export class ValueAnalyzerWidget extends BaseWidget {

    static readonly ID = VALUE_ANALYZER_WIDGET_ID;
    static readonly LABEL = VALUE_ANALYZER_WIDGET_LABEL;

    @inject(CanRpcClient)
    protected readonly canRpcClient!: CanRpcClient;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    protected readonly store = new ValueSampleStore(8192);

    // Signal configuration (mutable through the toolbar controls)
    protected signalId = 0;
    protected signalExtended = false;
    protected signalInterfaces: string[] = [];
    protected field: ValueFieldConfig = { startByte: 0, byteLength: 1, type: 'UINT8', littleEndian: true, divisor: 1 };

    // Capture state
    protected isCapturing = false;
    protected isPaused = false;
    protected lastSampleTime: number | undefined;
    protected lastMatchTime: number | undefined;
    protected periodEstimateMs: number | undefined;
    protected autoWindow = true;
    protected windowMs = DEFAULT_WINDOW_MS;

    // DOM
    protected canvasContainer!: HTMLDivElement;
    protected canvas!: HTMLCanvasElement;
    protected renderer!: ValuePlotRenderer;
    protected startBtn!: HTMLButtonElement;
    protected stopBtn!: HTMLButtonElement;
    protected pauseBtn!: HTMLButtonElement;
    protected idInput!: HTMLInputElement;
    protected extendedCheck!: HTMLInputElement;
    protected interfaceSelect!: HTMLSelectElement;
    protected startByteInput!: HTMLInputElement;
    protected byteLengthInput!: HTMLInputElement;
    protected typeSelect!: HTMLSelectElement;
    protected endianSelect!: HTMLSelectElement;
    protected divisorInput!: HTMLInputElement;
    protected autoWindowCheck!: HTMLInputElement;
    protected windowSelect!: HTMLSelectElement;
    protected customWindowInput!: HTMLInputElement;
    protected customWindowUnit!: HTMLSpanElement;
    protected statusEl!: HTMLSpanElement;

    protected rafId: number | undefined;
    protected dirty = false;
    protected lastRenderTime = 0;

    @postConstruct()
    protected init(): void {
        this.id = ValueAnalyzerWidget.ID;
        this.title.label = ValueAnalyzerWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-line-chart can-bus-icon';
        this.addClass('can-bus-widget');
        this.addClass('can-value-analyzer-widget');

        this.buildUI();
        this.renderer = new ValuePlotRenderer(this.canvas);

        this.toDispose.push(this.canRpcClient.onBinaryFrames(chunk => this.addBinaryChunk(chunk)));
        this.toDispose.push(this.shell.onDidAddWidget(() => this.updateInterfaceChoices()));
        this.toDispose.push(this.shell.onDidRemoveWidget(() => this.updateInterfaceChoices()));
        this.toDispose.push(Disposable.create(() => {
            if (this.rafId !== undefined) {
                cancelAnimationFrame(this.rafId);
                this.rafId = undefined;
            }
        }));
    }

    /** Apply factory options after widget creation. */
    public configure(options: ValueAnalyzerOptions): void {
        const config = options.config;
        if (config) {
            if (typeof config.id === 'number') { this.signalId = config.id; }
            if (typeof config.extended === 'boolean') { this.signalExtended = config.extended; }
            if (Array.isArray(config.interfaces)) { this.signalInterfaces = [...config.interfaces]; }
            if (typeof config.startByte === 'number') { this.field = { ...this.field, startByte: config.startByte }; }
            if (typeof config.byteLength === 'number') { this.field = { ...this.field, byteLength: config.byteLength }; }
            if (config.type && VALUE_FIELD_TYPES.includes(config.type)) { this.field = { ...this.field, type: config.type }; }
            if (typeof config.littleEndian === 'boolean') { this.field = { ...this.field, littleEndian: config.littleEndian }; }
            if (typeof config.divisor === 'number' && config.divisor > 0) { this.field = { ...this.field, divisor: config.divisor }; }
            // Suggest a sensible fixed-size type matching the selection length
            if (config.type === undefined) {
                this.field = { ...this.field, type: this.suggestTypeForLength(this.field.byteLength) };
            }
        }
        if (typeof options.windowMs === 'number') {
            this.windowMs = Math.min(Math.max(options.windowMs, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS);
        }
        this.syncControlsFromState();
        this.updateInterfaceChoices();
        this.scheduleRender();
    }

    public startCapture(): void {
        this.isCapturing = true;
        this.isPaused = false;
        this.updateStatus();
    }

    public stopCapture(): void {
        this.isCapturing = false;
        this.updateStatus();
        this.scheduleRender();
    }

    public clearData(): void {
        this.store.clear();
        this.lastSampleTime = undefined;
        this.lastMatchTime = undefined;
        this.periodEstimateMs = undefined;
        this.scheduleRender();
    }

    /**
     * Decode a binary batch without allocating per-frame objects; extract the
     * tracked signal value directly from matching frames.
     */
    public addBinaryChunk(chunk: ArrayBuffer): void {
        if (!this.isCapturing || this.isPaused) { return; }
        const config: ValueSignalConfig = {
            id: this.signalId,
            extended: this.signalExtended,
            interfaces: this.signalInterfaces,
            startByte: this.field.startByte,
            byteLength: this.field.byteLength,
            type: this.field.type,
            littleEndian: this.field.littleEndian,
            divisor: this.field.divisor
        };
        extractSamplesFromChunk(chunk, config, (timeMs, value) => {
            const t = timeMs > 0 ? timeMs : Date.now();
            this.pushSample(t, value);
        });
        this.scheduleRender();
    }

    protected pushSample(t: number, value: number): void {
        this.store.push(t, value);
        if (this.lastMatchTime !== undefined && t > this.lastMatchTime) {
            const delta = t - this.lastMatchTime;
            this.periodEstimateMs = this.periodEstimateMs === undefined
                ? delta
                : this.periodEstimateMs * 0.7 + delta * 0.3;
        }
        this.lastMatchTime = t;
        this.lastSampleTime = t;
        this.dirty = true;
    }

    protected buildUI(): void {
        this.node.replaceChildren();

        const toolbar = document.createElement('div');
        toolbar.className = 'can-toolbar can-value-toolbar';

        this.startBtn = this.createButton('▶ Start', () => this.startCapture());
        this.stopBtn = this.createButton('⏹ Stop', () => this.stopCapture());
        this.pauseBtn = this.createButton('⏸ Pause', () => this.togglePause());
        const clearBtn = this.createButton('🗑 Clear', () => this.clearData());
        toolbar.append(this.startBtn, this.stopBtn, this.pauseBtn, clearBtn);

        // Signal selector: CAN ID + extended flag + interface filter
        const idLabel = this.createLabel('ID');
        this.idInput = document.createElement('input');
        this.idInput.className = 'theia-input can-value-id-input';
        this.idInput.type = 'text';
        this.idInput.placeholder = 'e.g. 0x123 or 291';
        this.idInput.onchange = () => this.applyIdInput();
        idLabel.appendChild(this.idInput);

        const extLabel = this.createLabel('');
        this.extendedCheck = document.createElement('input');
        this.extendedCheck.type = 'checkbox';
        this.extendedCheck.onchange = () => { this.signalExtended = this.extendedCheck.checked; this.clearData(); };
        extLabel.textContent = 'Ext';
        extLabel.prepend(this.extendedCheck);

        this.interfaceSelect = document.createElement('select');
        this.interfaceSelect.className = 'theia-select';
        this.interfaceSelect.onchange = () => this.applyInterfaceChoice();

        toolbar.append(idLabel, extLabel, this.interfaceSelect);

        // Field decoder controls
        this.startByteInput = this.createNumberInput('Byte', 0, 63, 0, () => this.applyFieldInputs());
        this.byteLengthInput = this.createNumberInput('Len', 1, 8, 1, () => this.applyFieldInputs());

        this.typeSelect = document.createElement('select');
        this.typeSelect.className = 'theia-select';
        for (const type of VALUE_FIELD_TYPES) {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type === 'UINT' || type === 'INT' ? `${type} (1-8 B)` : type;
            this.typeSelect.appendChild(option);
        }
        this.typeSelect.onchange = () => {
            const type = this.typeSelect.value as ValueFieldType;
            const required = requiredBytesForType(type);
            if (required !== undefined) {
                this.field = { ...this.field, type, byteLength: required };
                this.byteLengthInput.value = String(required);
            } else {
                this.field = { ...this.field, type };
            }
            this.clearData();
        };

        this.endianSelect = document.createElement('select');
        this.endianSelect.className = 'theia-select';
        for (const [value, label] of [['little', 'LE'], ['big', 'BE']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.endianSelect.appendChild(option);
        }
        this.endianSelect.onchange = () => {
            this.field = { ...this.field, littleEndian: this.endianSelect.value === 'little' };
            this.clearData();
        };

        const divisorLabel = this.createLabel('Div');
        this.divisorInput = document.createElement('input');
        this.divisorInput.className = 'theia-input can-value-divisor-input';
        this.divisorInput.type = 'number';
        this.divisorInput.min = '0.000000000001';
        this.divisorInput.step = 'any';
        this.divisorInput.value = '1';
        this.divisorInput.onchange = () => this.applyFieldInputs();
        divisorLabel.appendChild(this.divisorInput);

        toolbar.append(this.startByteInput.parentElement!, this.byteLengthInput.parentElement!,
            this.typeSelect, this.endianSelect, divisorLabel);

        // Time base controls
        const autoLabel = this.createLabel('');
        this.autoWindowCheck = document.createElement('input');
        this.autoWindowCheck.type = 'checkbox';
        this.autoWindowCheck.checked = this.autoWindow;
        this.autoWindowCheck.title = 'Window covers ~5 periods of the tracked signal';
        this.autoWindowCheck.onchange = () => {
            this.autoWindow = this.autoWindowCheck.checked;
            this.windowSelect.disabled = this.autoWindow;
            this.customWindowInput.disabled = this.autoWindow;
            this.dirty = true;
            this.scheduleRender();
        };
        autoLabel.textContent = 'Auto window';
        autoLabel.prepend(this.autoWindowCheck);

        this.windowSelect = document.createElement('select');
        this.windowSelect.className = 'theia-select';
        this.windowSelect.disabled = this.autoWindow;
        for (const ms of VALUE_WINDOW_CHOICES_MS) {
            const option = document.createElement('option');
            option.value = String(ms);
            option.textContent = ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`;
            this.windowSelect.appendChild(option);
        }
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom';
        this.windowSelect.appendChild(customOption);
        this.windowSelect.value = String(this.windowMs);
        this.windowSelect.onchange = () => {
            const custom = this.windowSelect.value === 'custom';
            this.customWindowInput.hidden = !custom;
            this.customWindowUnit.hidden = !custom;
            if (custom) {
                this.applyCustomWindow();
                return;
            }
            const parsed = Number(this.windowSelect.value);
            if (Number.isFinite(parsed)) {
                this.windowMs = Math.min(Math.max(parsed, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS);
                this.customWindowInput.value = String(this.windowMs / 1000);
                this.dirty = true;
                this.scheduleRender();
            }
        };

        this.customWindowInput = document.createElement('input');
        this.customWindowInput.className = 'theia-input can-value-custom-window-input';
        this.customWindowInput.type = 'number';
        this.customWindowInput.min = String(VALUE_WINDOW_MIN_MS / 1000);
        this.customWindowInput.max = String(VALUE_WINDOW_MAX_MS / 1000);
        this.customWindowInput.step = 'any';
        this.customWindowInput.value = String(this.windowMs / 1000);
        this.customWindowInput.title = 'Custom time window in seconds';
        this.customWindowInput.hidden = true;
        this.customWindowInput.disabled = this.autoWindow;
        this.customWindowInput.oninput = () => this.applyCustomWindow();
        this.customWindowUnit = document.createElement('span');
        this.customWindowUnit.className = 'can-value-custom-window-unit';
        this.customWindowUnit.textContent = 's';
        this.customWindowUnit.hidden = true;

        this.statusEl = document.createElement('span');
        this.statusEl.className = 'can-stats-bar can-value-status';
        this.statusEl.textContent = '○ Idle';

        toolbar.append(autoLabel, this.windowSelect, this.customWindowInput, this.customWindowUnit, this.statusEl);
        this.node.appendChild(toolbar);

        this.canvasContainer = document.createElement('div');
        this.canvasContainer.className = 'can-value-chart-container';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'can-chart-canvas';
        this.canvasContainer.appendChild(this.canvas);
        this.node.appendChild(this.canvasContainer);

        this.updateStatus();
    }

    protected createButton(label: string, onclick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'theia-button secondary';
        button.textContent = label;
        button.onclick = onclick;
        return button;
    }

    protected createLabel(text: string): HTMLLabelElement {
        const label = document.createElement('label');
        label.className = 'can-interface-label';
        label.textContent = text;
        return label;
    }

    protected createNumberInput(text: string, min: number, max: number, initial: number, onApply: () => void): HTMLInputElement {
        const label = document.createElement('label');
        label.className = 'can-interface-label';
        label.textContent = `${text} `;
        const input = document.createElement('input');
        input.className = 'theia-input can-value-byte-input';
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.step = '1';
        input.value = String(initial);
        input.onchange = onApply;
        label.appendChild(input);
        // The widget reads `parentElement` to attach the labelled input.
        return input;
    }

    protected togglePause(): void {
        this.isPaused = !this.isPaused;
        this.updateStatus();
        this.scheduleRender();
    }

    protected applyIdInput(): void {
        const text = this.idInput.value.trim().toLowerCase();
        if (text.length === 0) { return; }
        const parsed = text.startsWith('0x') ? parseInt(text, 16) : parseInt(text, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0x1FFFFFFF) {
            this.syncControlsFromState();
            return;
        }
        if (parsed !== this.signalId) {
            this.signalId = parsed;
            this.clearData();
        }
        this.syncControlsFromState();
    }

    protected applyInterfaceChoice(): void {
        this.signalInterfaces = this.interfaceSelect.value ? [this.interfaceSelect.value] : [];
        this.clearData();
    }

    protected applyFieldInputs(): void {
        const candidate: ValueFieldConfig = {
            startByte: Math.trunc(Number(this.startByteInput.value) || 0),
            byteLength: Math.trunc(Number(this.byteLengthInput.value) || 1),
            type: this.typeSelect.value as ValueFieldType,
            littleEndian: this.endianSelect.value === 'little',
            divisor: Number(this.divisorInput.value)
        };
        const error = validateFieldConfig(candidate);
        if (error) {
            this.syncControlsFromState();
            return;
        }
        this.field = candidate;
        this.clearData();
    }

    protected syncControlsFromState(): void {
        this.idInput.value = this.signalExtended
            ? `0x${this.signalId.toString(16).toUpperCase().padStart(8, '0')}`
            : `0x${this.signalId.toString(16).toUpperCase().padStart(3, '0')}`;
        this.extendedCheck.checked = this.signalExtended;
        this.startByteInput.value = String(this.field.startByte);
        this.byteLengthInput.value = String(this.field.byteLength);
        this.typeSelect.value = this.field.type;
        this.endianSelect.value = this.field.littleEndian ? 'little' : 'big';
        this.divisorInput.value = String(this.field.divisor);
        const fixedWindow = VALUE_WINDOW_CHOICES_MS.includes(this.windowMs);
        this.windowSelect.value = fixedWindow ? String(this.windowMs) : 'custom';
        this.customWindowInput.value = String(this.windowMs / 1000);
        this.customWindowInput.hidden = fixedWindow;
        this.customWindowUnit.hidden = fixedWindow;
    }

    protected applyCustomWindow(): void {
        const seconds = Number(this.customWindowInput.value);
        if (!Number.isFinite(seconds) || seconds <= 0) { return; }
        this.windowMs = Math.min(Math.max(seconds * 1000, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS);
        this.dirty = true;
        this.scheduleRender();
    }

    protected suggestTypeForLength(byteLength: number): ValueFieldType {
        switch (byteLength) {
            case 1: return 'UINT8';
            case 2: return 'UINT16';
            case 4: return 'UINT32';
            case 8: return 'FLOAT64';
            default: return 'UINT';
        }
    }

    protected updateInterfaceChoices(): void {
        const select = this.interfaceSelect;
        const current = this.signalInterfaces.length === 1 ? this.signalInterfaces[0] : '';
        select.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All interfaces';
        select.appendChild(all);
        for (const iface of this.getActiveInterfaces()) {
            const option = document.createElement('option');
            option.value = iface;
            option.textContent = iface;
            select.appendChild(option);
        }
        select.value = current;
        if (select.value !== current) {
            // The previously selected interface is no longer offered.
            this.signalInterfaces = [];
            select.value = '';
        }
    }

    protected getActiveInterfaces(): string[] {
        const interfaces = new Set<string>();
        const areas: ApplicationShell.Area[] = ['main', 'bottom', 'left', 'right', 'secondaryWindow'];
        for (const area of areas) {
            try {
                for (const widget of this.shell.getWidgets(area)) {
                    if (widget instanceof CanWidget && widget.selectedInterface) {
                        interfaces.add(widget.selectedInterface);
                    }
                }
            } catch {
                // Ignore layout areas that are unavailable in this shell.
            }
        }
        return Array.from(interfaces).sort();
    }

    protected updateStatus(): void {
        let text: string;
        if (this.isPaused) {
            text = '⏸ Paused';
        } else if (this.isCapturing) {
            text = '● Capturing';
        } else {
            text = '○ Idle';
        }
        const period = this.periodEstimateMs;
        if (period !== undefined && period > 0) {
            text += ` | Period ≈ ${period < 10 ? period.toFixed(2) : period.toFixed(0)} ms (${(1000 / period).toFixed(1)} Hz)`;
        }
        text += ` | Samples: ${this.store.size}`;
        this.statusEl.textContent = text;
        this.statusEl.className = `can-stats-bar can-value-status ${this.isCapturing && !this.isPaused ? 'status-active' : 'status-idle'}`;
    }

    protected scheduleRender(): void {
        if (this.rafId !== undefined || !this.dirty) { return; }
        this.rafId = requestAnimationFrame(timestamp => {
            this.rafId = undefined;
            this.dirty = false;
            if (timestamp - this.lastRenderTime < RENDER_INTERVAL_MS - 5) {
                return;
            }
            this.lastRenderTime = timestamp;
            this.renderPlot();
        });
    }

    protected renderPlot(): void {
        const now = this.lastSampleTime ?? Date.now();
        const windowMs = this.autoWindow
            ? computeAutoWindow(this.periodEstimateMs, this.windowMs)
            : this.windowMs;
        this.applyThemeColors();
        this.renderer.render(this.store, windowMs, now);
        this.updateStatus();
    }

    protected applyThemeColors(): void {
        const style = getComputedStyle(this.node);
        const lineColor = style.getPropertyValue('--theia-symbolIcon-keywordForeground').trim() || '#4EC9B0';
        const gridColor = style.getPropertyValue('--theia-border').trim() || 'rgba(128,128,128,0.2)';
        const textColor = style.getPropertyValue('--theia-descriptionForeground').trim() || 'rgba(150,150,150,0.9)';
        this.renderer.setColors({ lineColor, gridColor, textColor });
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.update();
    }

    protected override onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        const width = this.canvasContainer.clientWidth || 800;
        const height = this.canvasContainer.clientHeight || 300;
        this.renderer.resize(width, height);
        this.renderPlot();
    }
}
