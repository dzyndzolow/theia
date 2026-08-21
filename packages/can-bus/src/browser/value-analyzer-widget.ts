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
import { BaseWidget, Message, Widget } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';
import { GlobalVariable, GlobalVariableRegistry, VariableId } from '@theia/signal-core';
import { ValueSampleStore } from './value-signal-extractor';
import { VALUE_WINDOW_MAX_MS, VALUE_WINDOW_MIN_MS, ValuePlotRenderer } from './value-plot-renderer';

export const VALUE_ANALYZER_WIDGET_ID = 'can-value-analyzer-widget';
export const VALUE_ANALYZER_WIDGET_LABEL = 'CAN Value Plot';

export interface ValueAnalyzerOptions {
    id?: string;
    windowMs?: number;
}

export const VALUE_WINDOW_CHOICES_MS: readonly number[] = Object.freeze([
    1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 10_000, 100_000
]);

interface PlotSeries {
    readonly id: VariableId;
    readonly store: ValueSampleStore;
    readonly row: HTMLDivElement;
    offset: number;
    lastTime?: number;
    period?: number;
    clockDomain?: string;
}

@injectable()
export class ValueAnalyzerWidget extends BaseWidget {
    static readonly ID = VALUE_ANALYZER_WIDGET_ID;
    static readonly LABEL = VALUE_ANALYZER_WIDGET_LABEL;

    @inject(GlobalVariableRegistry)
    protected readonly registry!: GlobalVariableRegistry;

    protected readonly series = new Map<VariableId, PlotSeries>();
    protected isCapturing = false;
    protected isPaused = false;
    /** Fallback/manual oscilloscope time base used before a period is known. */
    protected windowMs = 250;
    /** Oscilloscope mode uses a fixed time base by default. */
    protected autoWindow = true;
    protected autoScale = true;
    protected yMin = -1;
    protected yMax = 1;
    protected rafId: number | undefined;
    protected scopeRafId: number | undefined;
    protected lastScopeRender = 0;
    protected dirty = true;
    protected variableSelect!: HTMLSelectElement;
    protected seriesList!: HTMLDivElement;
    protected chartContainer!: HTMLDivElement;
    protected canvas!: HTMLCanvasElement;
    protected renderer!: ValuePlotRenderer;
    protected statusEl!: HTMLSpanElement;
    protected windowSelect!: HTMLSelectElement;
    protected customWindowInput!: HTMLInputElement;
    protected autoWindowCheck!: HTMLInputElement;
    protected autoScaleCheck!: HTMLInputElement;
    protected yMinInput!: HTMLInputElement;
    protected yMaxInput!: HTMLInputElement;

    @postConstruct()
    protected init(): void {
        this.id = ValueAnalyzerWidget.ID;
        this.title.label = ValueAnalyzerWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-line-chart can-bus-icon';
        this.addClass('can-bus-widget');
        this.addClass('can-value-analyzer-widget');
        this.buildUI();
        this.refreshVariables();
        this.toDispose.push(this.registry.onDidVariableChange(event => this.onVariableChange(
            event.id,
            event.state.value,
            event.state.timestampNs,
            event.state.clockDomain
        )));
        this.toDispose.push(this.registry.onDidDefinitionChange(() => this.refreshVariables()));
        this.toDispose.push(Disposable.create(() => {
            this.stopScopeLoop();
            if (this.rafId !== undefined) {
                cancelAnimationFrame(this.rafId);
                this.rafId = undefined;
            }
            this.series.clear();
        }));
    }

    public configure(options: ValueAnalyzerOptions): void {
        if (typeof options.windowMs === 'number') {
            this.windowMs = Math.min(Math.max(options.windowMs, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS);
        }
        if (this.windowSelect) { this.windowSelect.value = String(this.windowMs); }
        this.scheduleRender();
    }

    public startCapture(): void {
        this.isCapturing = true;
        this.isPaused = false;
        this.updateStatus();
        this.startScopeLoop();
    }

    public stopCapture(): void {
        this.isCapturing = false;
        this.stopScopeLoop();
        this.updateStatus();
    }

    protected togglePause(): void {
        this.isPaused = !this.isPaused;
        if (this.isPaused) { this.stopScopeLoop(); } else if (this.isCapturing) { this.startScopeLoop(); }
        this.updateStatus();
    }

    protected buildUI(): void {
        this.node.replaceChildren();
        const toolbar = document.createElement('div');
        toolbar.className = 'can-toolbar can-value-toolbar';
        toolbar.append(this.button('Start', () => this.startCapture()), this.button('Stop', () => this.stopCapture()),
            this.button('Pause', () => this.togglePause()),
            this.button('Clear', () => this.clearData()));

        this.variableSelect = document.createElement('select');
        this.variableSelect.className = 'theia-select can-value-variable-select';
        const addButton = this.button('Add plot', () => this.addSelectedVariable());
        toolbar.append(this.variableSelect, addButton);

        this.autoWindowCheck = document.createElement('input');
        this.autoWindowCheck.type = 'checkbox';
        this.autoWindowCheck.checked = this.autoWindow;
        this.autoWindowCheck.onchange = () => {
            this.autoWindow = this.autoWindowCheck.checked;
            this.syncWindowControls();
            this.scheduleRender();
        };
        const autoLabel = document.createElement('label');
        autoLabel.className = 'can-interface-label';
        autoLabel.append(this.autoWindowCheck, document.createTextNode(' Auto window'));
        toolbar.append(autoLabel);

        this.windowSelect = document.createElement('select');
        this.windowSelect.className = 'theia-select';
        for (const ms of VALUE_WINDOW_CHOICES_MS) {
            const option = document.createElement('option');
            option.value = String(ms);
            option.textContent = ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`;
            this.windowSelect.append(option);
        }
        this.windowSelect.value = String(this.windowMs);
        this.windowSelect.onchange = () => { this.windowMs = Number(this.windowSelect.value); this.scheduleRender(); };
        toolbar.append(this.windowSelect);

        this.customWindowInput = document.createElement('input');
        this.customWindowInput.className = 'theia-input can-value-custom-window-input';
        this.customWindowInput.type = 'number';
        this.customWindowInput.min = String(VALUE_WINDOW_MIN_MS / 1000);
        this.customWindowInput.value = String(this.windowMs / 1000);
        this.customWindowInput.disabled = true;
        this.customWindowInput.oninput = () => {
            const seconds = Number(this.customWindowInput.value);
            if (Number.isFinite(seconds) && seconds > 0) { this.windowMs = Math.min(Math.max(seconds * 1000, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS); this.scheduleRender(); }
        };
        toolbar.append(this.customWindowInput, document.createTextNode(' s'));

        this.autoScaleCheck = document.createElement('input');
        this.autoScaleCheck.type = 'checkbox';
        this.autoScaleCheck.checked = this.autoScale;
        this.autoScaleCheck.onchange = () => {
            this.autoScale = this.autoScaleCheck.checked;
            this.syncScaleControls();
            this.scheduleRender();
        };
        const autoScaleLabel = document.createElement('label');
        autoScaleLabel.className = 'can-interface-label';
        autoScaleLabel.append(this.autoScaleCheck, document.createTextNode(' Auto scale Y'));

        this.yMinInput = this.createScaleInput(this.yMin, value => { this.yMin = value; });
        this.yMaxInput = this.createScaleInput(this.yMax, value => { this.yMax = value; });
        toolbar.append(autoScaleLabel, document.createTextNode('Y min '), this.yMinInput,
            document.createTextNode(' Y max '), this.yMaxInput);

        this.statusEl = document.createElement('span');
        this.statusEl.className = 'can-stats-bar can-value-status';
        toolbar.append(this.statusEl);
        this.node.append(toolbar);

        this.seriesList = document.createElement('div');
        this.seriesList.className = 'can-value-series-list';
        this.node.append(this.seriesList);
        this.chartContainer = document.createElement('div');
        this.chartContainer.className = 'can-value-chart-container can-value-multi-chart';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'can-chart-canvas';
        this.chartContainer.append(this.canvas);
        this.renderer = new ValuePlotRenderer(this.canvas);
        this.node.append(this.chartContainer);
        this.syncWindowControls();
        this.syncScaleControls();
        this.updateStatus();
    }

    protected syncWindowControls(): void {
        if (!this.windowSelect || !this.customWindowInput) { return; }
        this.windowSelect.disabled = this.autoWindow;
        this.customWindowInput.disabled = this.autoWindow;
    }

    protected createScaleInput(initial: number, onApply: (value: number) => void): HTMLInputElement {
        const input = document.createElement('input');
        input.className = 'theia-input can-value-scale-input';
        input.type = 'number';
        input.step = 'any';
        input.value = String(initial);
        input.oninput = () => {
            const value = Number(input.value);
            if (Number.isFinite(value)) {
                onApply(value);
                this.scheduleRender();
            }
        };
        return input;
    }

    protected syncScaleControls(): void {
        if (!this.yMinInput || !this.yMaxInput) { return; }
        this.yMinInput.disabled = this.autoScale;
        this.yMaxInput.disabled = this.autoScale;
    }

    protected button(label: string, action: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'theia-button secondary';
        button.textContent = label;
        button.onclick = action;
        return button;
    }

    protected refreshVariables(): void {
        if (!this.variableSelect) { return; }
        const current = this.variableSelect.value;
        this.variableSelect.replaceChildren();
        for (const variable of this.registry.list()) {
            if (!this.isNumeric(variable)) { continue; }
            const option = document.createElement('option');
            option.value = variable.definition.id;
            option.textContent = variable.definition.name;
            this.variableSelect.append(option);
        }
        if (Array.from(this.variableSelect.options).some(option => option.value === current)) { this.variableSelect.value = current; }
        if (this.series.size === 0 && this.variableSelect.value) {
            this.addVariable(this.variableSelect.value as VariableId);
        }
    }

    protected isNumeric(variable: GlobalVariable): boolean {
        return variable.definition.type !== 'STRING' && variable.definition.type !== 'BYTES';
    }

    protected addSelectedVariable(): void {
        const id = this.variableSelect.value as VariableId;
        this.addVariable(id);
    }

    protected addVariable(id: VariableId): void {
        if (!id || this.series.has(id)) { return; }
        const variable = this.registry.get(id);
        if (!variable || !this.isNumeric(variable)) { return; }
        const row = document.createElement('div');
        row.className = 'can-value-series-row';
        const name = document.createElement('span');
        name.textContent = variable.definition.name;
        const plot: PlotSeries = { id, store: new ValueSampleStore(8192), row, offset: 0 };
        const offsetLabel = document.createElement('label');
        offsetLabel.textContent = 'Offset ';
        const offsetInput = document.createElement('input');
        offsetInput.className = 'theia-input can-value-offset-input';
        offsetInput.type = 'number';
        offsetInput.step = 'any';
        offsetInput.value = '0';
        offsetInput.oninput = () => {
            const offset = Number(offsetInput.value);
            if (Number.isFinite(offset)) {
                plot.offset = offset;
                this.scheduleRender();
            }
        };
        offsetLabel.append(offsetInput);
        const remove = this.button('Remove', () => this.removeSeries(id));
        row.append(name, offsetLabel, remove);
        this.seriesList.append(row);
        this.series.set(id, plot);
        this.scheduleRender();
        this.updateStatus();
    }

    protected removeSeries(id: VariableId): void {
        const plot = this.series.get(id);
        if (!plot) { return; }
        plot.row.remove();
        this.series.delete(id);
        this.scheduleRender();
        this.updateStatus();
    }

    protected clearData(): void {
        for (const plot of this.series.values()) {
            plot.store.clear();
            plot.lastTime = undefined;
            plot.period = undefined;
            plot.clockDomain = undefined;
        }
        this.scheduleRender();
    }

    protected onVariableChange(id: VariableId, rawValue: unknown, timestampNs: bigint, clockDomain: string): void {
        if (!this.isCapturing || this.isPaused) { return; }
        const plot = this.series.get(id);
        if (!plot) { return; }
        const value = typeof rawValue === 'boolean' ? (rawValue ? 1 : 0) : Number(rawValue);
        if (!Number.isFinite(value)) { return; }
        if (plot.clockDomain !== undefined && plot.clockDomain !== clockDomain) {
            // Never mix incompatible clocks on one time axis. A new source
            // starts a fresh sweep while preserving the selected variable.
            plot.store.clear();
            plot.lastTime = undefined;
            plot.period = undefined;
        }
        plot.clockDomain = clockDomain;
        const t = Number(timestampNs) / 1_000_000;
        if (!Number.isFinite(t)) { return; }
        if (plot.lastTime !== undefined && t > plot.lastTime) {
            const period = t - plot.lastTime;
            plot.period = plot.period === undefined ? period : plot.period * 0.7 + period * 0.3;
        }
        plot.lastTime = t;
        plot.store.push(t, value);
        this.scheduleRender();
    }

    protected scheduleRender(): void {
        this.dirty = true;
        if (this.rafId !== undefined) { return; }
        this.rafId = requestAnimationFrame(() => { this.rafId = undefined; if (this.dirty) { this.dirty = false; this.renderPlots(); } });
    }

    /** Keep the time window moving like an oscilloscope sweep while running. */
    protected startScopeLoop(): void {
        if (this.scopeRafId !== undefined) { return; }
        const tick = (timestamp: number): void => {
            this.scopeRafId = undefined;
            if (!this.isCapturing || this.isPaused) { return; }
            if (timestamp - this.lastScopeRender >= 50) {
                this.lastScopeRender = timestamp;
                this.renderPlots();
            }
            this.scopeRafId = requestAnimationFrame(tick);
        };
        this.scopeRafId = requestAnimationFrame(tick);
    }

    protected stopScopeLoop(): void {
        if (this.scopeRafId !== undefined) {
            cancelAnimationFrame(this.scopeRafId);
            this.scopeRafId = undefined;
        }
    }

    protected renderPlots(): void {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        // A restored but hidden tab reports a zero-sized container. Rendering
        // then creates a tiny backing buffer which the browser later stretches
        // and blurs. Wait until the tab has a real layout instead.
        if (width < 20 || height < 20) {
            this.dirty = true;
            return;
        }
        const lastTime = Math.max(...Array.from(this.series.values()).map(plot => plot.lastTime ?? 0), 0);
        const periods = Array.from(this.series.values()).map(plot => plot.period).filter((candidate): candidate is number => candidate !== undefined);
        const period = periods.length ? Math.min(...periods) : undefined;
        const windowMs = this.autoWindow && period ? Math.min(Math.max(period * 5, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS) : this.windowMs;
        const style = getComputedStyle(this.node);
        this.renderer.setColors({
            lineColor: style.getPropertyValue('--theia-symbolIcon-keywordForeground').trim() || '#4EC9B0',
            gridColor: style.getPropertyValue('--theia-border').trim() || 'rgba(128,128,128,0.2)',
            textColor: style.getPropertyValue('--theia-descriptionForeground').trim() || 'rgba(150,150,150,0.9)'
        });
        this.renderer.resize(width, height);
        this.renderer.renderMany(Array.from(this.series.values()).map((plot, index) => ({
            name: this.registry.get(plot.id)?.definition.name || String(plot.id),
            store: plot.store,
            offset: plot.offset,
            color: ['#4EC9B0', '#569CD6', '#DCDCAA', '#CE9178', '#C586C0', '#9CDCFE'][index % 6]
        })), windowMs, lastTime, this.autoScale || this.yMin >= this.yMax ? undefined : { min: this.yMin, max: this.yMax });
        this.updateStatus();
    }

    protected updateStatus(): void {
        this.statusEl.textContent = `${this.isCapturing ? 'Capturing' : 'Idle'} | Plots: ${this.series.size}`;
    }

    protected override onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        this.scheduleRender();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.renderWhenVisible();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.renderWhenVisible();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.renderWhenVisible();
    }

    /** Schedule after layout has assigned the restored tab its real bounds. */
    protected renderWhenVisible(): void {
        requestAnimationFrame(() => requestAnimationFrame(() => this.scheduleRender()));
    }
}
