// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ValueSampleStore } from './value-signal-extractor';

export interface ValuePlotColors {
    lineColor?: string;
    gridColor?: string;
    textColor?: string;
}

export interface ValuePlotSeries {
    readonly name: string;
    readonly store: ValueSampleStore;
    readonly color?: string;
    /** Vertical displacement applied after decoding, in displayed units. */
    readonly offset?: number;
}

/**
 * Time/value margins of the plot area inside the canvas (CSS pixels).
 */
export const VALUE_PLOT_MARGIN = Object.freeze({ left: 56, right: 10, top: 8, bottom: 18 });

/** Minimum and maximum selectable time window in milliseconds. */
export const VALUE_WINDOW_MIN_MS = 1;
export const VALUE_WINDOW_MAX_MS = 100_000;

/** Number of periods an auto-sized window should cover. */
export const VALUE_AUTO_WINDOW_PERIODS = 5;

/**
 * Computes the automatic time window from the observed signal period,
 * clamped to the allowed [1ms, 100s] range. Returns the fallback when no
 * period has been observed yet.
 */
export function computeAutoWindow(periodMs: number | undefined, fallbackMs = 100): number {
    if (periodMs === undefined || !Number.isFinite(periodMs) || periodMs <= 0) {
        return Math.min(Math.max(fallbackMs, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS);
    }
    const window = periodMs * VALUE_AUTO_WINDOW_PERIODS;
    return Math.min(Math.max(window, VALUE_WINDOW_MIN_MS), VALUE_WINDOW_MAX_MS);
}

/**
 * Canvas2D renderer for a single decoded CAN value over time.
 * Draws a zero-order-hold (step) line, grid and axis labels. Colors come
 * from Theia theme CSS variables supplied via `setColors`.
 */
export class ValuePlotRenderer {
    protected dpr = 1;
    protected lineColor = '#4EC9B0';
    protected gridColor = 'rgba(128, 128, 128, 0.2)';
    protected textColor = 'rgba(150, 150, 150, 0.9)';

    constructor(protected readonly canvas: HTMLCanvasElement) {
        this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    }

    /** Update palette colors from Theia theme computed styles. */
    setColors(colors: ValuePlotColors): void {
        if (colors.lineColor) { this.lineColor = colors.lineColor; }
        if (colors.gridColor) { this.gridColor = colors.gridColor; }
        if (colors.textColor) { this.textColor = colors.textColor; }
    }

    /** Resize canvas backing store for High-DPI output. */
    resize(cssWidth: number, cssHeight: number): void {
        this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const w = Math.max(10, Math.floor(cssWidth));
        const h = Math.max(10, Math.floor(cssHeight));
        this.canvas.width = Math.floor(w * this.dpr);
        this.canvas.height = Math.floor(h * this.dpr);
    }

    /**
     * Render samples from `store` covering the trailing `windowMs` ending at `now`.
     * The y range is auto-scaled from visible samples with 10% padding.
     */
    render(store: ValueSampleStore, windowMs: number, now: number): void {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) { return; }

        const scale = this.dpr;
        const cssW = this.canvas.width / scale;
        const cssH = this.canvas.height / scale;

        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        const plotX = VALUE_PLOT_MARGIN.left;
        const plotY = VALUE_PLOT_MARGIN.top;
        const plotW = Math.max(1, cssW - VALUE_PLOT_MARGIN.left - VALUE_PLOT_MARGIN.right);
        const plotH = Math.max(1, cssH - VALUE_PLOT_MARGIN.top - VALUE_PLOT_MARGIN.bottom);
        const windowStart = now - windowMs;

        this.drawGrid(ctx, plotX, plotY, plotW, plotH, windowStart, now, store);

        if (store.size < 1) {
            ctx.fillStyle = this.textColor;
            ctx.font = '11px sans-serif';
            ctx.fillText('Waiting for matching frames...', plotX + 8, plotY + 16);
            ctx.restore();
            return;
        }

        // Visible range in y
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < store.size; i++) {
            const t = store.timeAt(i);
            if (t < windowStart) { continue; }
            const v = store.valueAt(i);
            if (!Number.isFinite(v)) { continue; }
            if (v < min) { min = v; }
            if (v > max) { max = v; }
        }
        if (min === Number.POSITIVE_INFINITY) {
            min = 0;
            max = 1;
        }
        if (min === max) {
            min -= 0.5;
            max += 0.5;
        }
        const pad = (max - min) * 0.1;
        min -= pad;
        max += pad;

        const toX = (t: number): number => plotX + ((t - windowStart) / windowMs) * plotW;
        const toY = (v: number): number => plotY + plotH - ((v - min) / (max - min)) * plotH;

        // Step (zero-order-hold) line through all visible samples
        ctx.strokeStyle = this.lineColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        let prevY = 0;
        for (let i = 0; i < store.size; i++) {
            const t = store.timeAt(i);
            if (t < windowStart) { continue; }
            const v = store.valueAt(i);
            if (!Number.isFinite(v)) { continue; }
            const x = toX(t);
            const y = toY(v);
            if (!started) {
                ctx.moveTo(plotX, y);
                ctx.lineTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, prevY);
                ctx.lineTo(x, y);
            }
            prevY = y;
        }
        if (started) {
            ctx.lineTo(plotX + plotW, prevY);
        }
        ctx.stroke();

        ctx.restore();
    }

    /** Render multiple variables on one shared time/value plot. */
    renderMany(
        series: readonly ValuePlotSeries[],
        windowMs: number,
        now: number,
        fixedRange?: { readonly min: number; readonly max: number }
    ): void {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) { return; }
        const scale = this.dpr;
        const cssW = this.canvas.width / scale;
        const cssH = this.canvas.height / scale;
        const plotX = VALUE_PLOT_MARGIN.left;
        const plotY = VALUE_PLOT_MARGIN.top;
        const plotW = Math.max(1, cssW - VALUE_PLOT_MARGIN.left - VALUE_PLOT_MARGIN.right);
        const plotH = Math.max(1, cssH - VALUE_PLOT_MARGIN.top - VALUE_PLOT_MARGIN.bottom);
        const windowStart = now - windowMs;

        let min = fixedRange?.min ?? Number.POSITIVE_INFINITY;
        let max = fixedRange?.max ?? Number.NEGATIVE_INFINITY;
        let hasSamples = false;
        for (const item of series) {
            for (let i = 0; i < item.store.size; i++) {
                if (item.store.timeAt(i) < windowStart) { continue; }
                const value = item.store.valueAt(i) + (item.offset ?? 0);
                if (!Number.isFinite(value)) { continue; }
                hasSamples = true;
                if (!fixedRange) {
                    min = Math.min(min, value);
                    max = Math.max(max, value);
                }
            }
        }
        if (!hasSamples) { min = 0; max = 1; }
        if (min === max) { min -= 0.5; max += 0.5; }
        if (!fixedRange) {
            const padding = (max - min) * 0.1;
            min -= padding;
            max += padding;
        }

        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        this.drawGridRange(ctx, plotX, plotY, plotW, plotH, windowStart, now, min, max);

        const toX = (time: number): number => plotX + ((time - windowStart) / windowMs) * plotW;
        const toY = (value: number): number => plotY + plotH - ((value - min) / (max - min)) * plotH;
        series.forEach((item, index) => {
            ctx.strokeStyle = item.color || this.seriesColor(index);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            let previousY = 0;
            for (let i = 0; i < item.store.size; i++) {
                const time = item.store.timeAt(i);
                if (time < windowStart) { continue; }
                const value = item.store.valueAt(i) + (item.offset ?? 0);
                if (!Number.isFinite(value)) { continue; }
                const x = toX(time);
                const y = toY(value);
                if (!started) {
                    ctx.moveTo(plotX, y);
                    ctx.lineTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, previousY);
                    ctx.lineTo(x, y);
                }
                previousY = y;
            }
            if (started) { ctx.lineTo(plotX + plotW, previousY); }
            ctx.stroke();
        });

        ctx.font = '11px sans-serif';
        let legendX = plotX;
        for (const [index, item] of series.entries()) {
            ctx.fillStyle = item.color || this.seriesColor(index);
            ctx.fillRect(legendX, plotY, 8, 8);
            ctx.fillText(item.name, legendX + 11, plotY + 8);
            legendX += Math.max(55, ctx.measureText(item.name).width + 28);
        }
        if (!hasSamples) {
            ctx.fillStyle = this.textColor;
            ctx.fillText(series.length ? 'Waiting for variable updates...' : 'Select a variable to plot', plotX + 8, plotY + 24);
        }
        ctx.restore();
    }

    protected drawGridRange(ctx: CanvasRenderingContext2D, plotX: number, plotY: number, plotW: number, plotH: number,
        windowStart: number, now: number, min: number, max: number): void {
        ctx.strokeStyle = this.gridColor;
        ctx.fillStyle = this.textColor;
        ctx.font = '10px sans-serif';
        for (let i = 0; i <= 4; i++) {
            const y = plotY + (plotH / 4) * i;
            ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
            ctx.fillText(this.formatValue(max - ((max - min) / 4) * i), 4, y + 3);
        }
        const duration = now - windowStart;
        for (let i = 0; i <= 5; i++) {
            const x = plotX + (plotW / 5) * i;
            ctx.beginPath(); ctx.moveTo(x, plotY); ctx.lineTo(x, plotY + plotH); ctx.stroke();
            ctx.fillText(this.formatTime(duration - (duration / 5) * i), Math.max(2, x - 14), plotY + plotH + 12);
        }
    }

    protected seriesColor(index: number): string {
        return ['#4EC9B0', '#569CD6', '#DCDCAA', '#CE9178', '#C586C0', '#9CDCFE'][index % 6];
    }

    protected drawGrid(
        ctx: CanvasRenderingContext2D,
        plotX: number,
        plotY: number,
        plotW: number,
        plotH: number,
        windowStart: number,
        now: number,
        store: ValueSampleStore
    ): void {
        ctx.strokeStyle = this.gridColor;
        ctx.fillStyle = this.textColor;
        ctx.font = '10px sans-serif';
        ctx.lineWidth = 1;

        // Horizontal grid lines with value labels derived from the visible y range
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < store.size; i++) {
            const t = store.timeAt(i);
            if (t < windowStart) { continue; }
            const v = store.valueAt(i);
            if (!Number.isFinite(v)) { continue; }
            if (v < min) { min = v; }
            if (v > max) { max = v; }
        }
        if (min === Number.POSITIVE_INFINITY) { min = 0; max = 1; }
        if (min === max) { min -= 0.5; max += 0.5; }

        const rows = 4;
        for (let i = 0; i <= rows; i++) {
            const y = plotY + (plotH / rows) * i;
            ctx.beginPath();
            ctx.moveTo(plotX, y);
            ctx.lineTo(plotX + plotW, y);
            ctx.stroke();
            const value = max - ((max - min) / rows) * i;
            ctx.fillText(this.formatValue(value), 4, y + 3);
        }

        // Vertical grid lines with relative time labels (ms before now)
        const cols = 5;
        const windowMs = now - windowStart;
        for (let i = 0; i <= cols; i++) {
            const x = plotX + (plotW / cols) * i;
            ctx.beginPath();
            ctx.moveTo(x, plotY);
            ctx.lineTo(x, plotY + plotH);
            ctx.stroke();
            const ago = windowMs - (windowMs / cols) * i;
            ctx.fillText(this.formatTime(ago), Math.max(2, x - 14), plotY + plotH + 12);
        }
    }

    protected formatValue(value: number): string {
        if (Math.abs(value) >= 1000) { return value.toFixed(0); }
        if (Math.abs(value) >= 10) { return value.toFixed(1); }
        return value.toFixed(2);
    }

    protected formatTime(agoMs: number): string {
        if (agoMs <= 0) { return 'now'; }
        if (agoMs < 1) { return `${(agoMs * 1000).toFixed(0)}us`; }
        if (agoMs < 10) { return `${agoMs.toFixed(1)}ms`; }
        return `${agoMs.toFixed(0)}ms`;
    }
}
