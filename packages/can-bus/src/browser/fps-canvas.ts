// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface FpsMetricSample {
    fps: number;
    busLoad: number;
}

export interface FpsCanvasColors {
    fpsColor?: string;
    busLoadColor?: string;
    gridColor?: string;
}

export class FpsCanvasRenderer {
    protected readonly samples: FpsMetricSample[] = [];
    protected readonly maxSamples = 60;
    protected dpr = 1;
    protected fpsColor = '#4CAF50';
    protected busLoadColor = '#2196F3';
    protected gridColor = 'rgba(128, 128, 128, 0.2)';

    constructor(protected readonly canvas: HTMLCanvasElement) {
        this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    }

    /** Update palette colors dynamically from Theia theme computed styles. */
    setColors(colors: FpsCanvasColors): void {
        if (colors.fpsColor) { this.fpsColor = colors.fpsColor; }
        if (colors.busLoadColor) { this.busLoadColor = colors.busLoadColor; }
        if (colors.gridColor) { this.gridColor = colors.gridColor; }
    }

    /** Resize canvas internal resolution to account for window.devicePixelRatio (High-DPI / Retina). */
    resize(cssWidth: number, cssHeight: number): void {
        this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const w = Math.max(10, Math.floor(cssWidth));
        const h = Math.max(10, Math.floor(cssHeight));
        this.canvas.width = Math.floor(w * this.dpr);
        this.canvas.height = Math.floor(h * this.dpr);
        this.render();
    }

    /** Add a new metric sample and re-render. */
    pushSample(fps: number, busLoad: number): void {
        if (this.samples.length >= this.maxSamples) {
            this.samples.shift();
        }
        this.samples.push({ fps, busLoad });
        this.render();
    }

    /** Clear metric samples. */
    clear(): void {
        this.samples.length = 0;
        this.render();
    }

    /** Render the FPS and Bus Load history onto the High-DPI canvas. */
    render(): void {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) { return; }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const scale = this.dpr;

        ctx.save();
        ctx.scale(scale, scale);

        const cssW = w / scale;
        const cssH = h / scale;

        ctx.clearRect(0, 0, cssW, cssH);

        // Draw horizontal grid lines
        ctx.strokeStyle = this.gridColor;
        ctx.lineWidth = 1;
        const gridLines = 4;
        for (let i = 1; i < gridLines; i++) {
            const y = (cssH / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(cssW, y);
            ctx.stroke();
        }

        if (this.samples.length < 2) {
            ctx.fillStyle = 'rgba(150, 150, 150, 0.7)';
            ctx.font = `${Math.round(11)}px sans-serif`;
            ctx.fillText('CAN Activity Graph (Waiting for data...)', 10, 20);
            ctx.restore();
            return;
        }

        const stepX = cssW / (this.maxSamples - 1);

        // Render FPS line
        ctx.strokeStyle = this.fpsColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const maxFpsScale = 5000;
        this.samples.forEach((sample, i) => {
            const x = i * stepX;
            const normalized = Math.min(1, Math.max(0, sample.fps / maxFpsScale));
            const y = cssH - (normalized * (cssH - 30) + 10);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Render Bus Load line
        ctx.strokeStyle = this.busLoadColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        this.samples.forEach((sample, i) => {
            const x = i * stepX;
            const normalized = Math.min(1, Math.max(0, sample.busLoad / 100));
            const y = cssH - (normalized * (cssH - 30) + 10);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Legend / Header Text
        const lastSample = this.samples[this.samples.length - 1];
        ctx.fillStyle = this.fpsColor;
        ctx.font = '11px sans-serif';
        ctx.fillText(`FPS: ${lastSample.fps}`, 10, 18);

        ctx.fillStyle = this.busLoadColor;
        ctx.fillText(`Bus Load: ${lastSample.busLoad.toFixed(1)}%`, 110, 18);

        ctx.restore();
    }
}
