// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const globalScope = global as unknown as Record<string, unknown>;
globalScope.window = dom.window;
globalScope.document = dom.window.document;
globalScope.HTMLCanvasElement = dom.window.HTMLCanvasElement;
Object.defineProperty(dom.window, 'devicePixelRatio', { configurable: true, value: 2 });

import { expect } from 'chai';
import { ValuePlotRenderer } from './value-plot-renderer';
import { ValueSampleStore } from './value-signal-extractor';

describe('ValuePlotRenderer', () => {
    it('renders multiple series with offset and fixed y range on a HiDPI canvas', () => {
        const calls: string[] = [];
        const context = {
            save: () => calls.push('save'),
            restore: () => calls.push('restore'),
            setTransform: () => undefined,
            clearRect: () => calls.push('clear'),
            beginPath: () => undefined,
            moveTo: () => undefined,
            lineTo: () => undefined,
            stroke: () => calls.push('stroke'),
            fillText: () => undefined,
            fillRect: () => undefined,
            measureText: () => ({ width: 20 }),
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            font: ''
        } as unknown as CanvasRenderingContext2D;
        (dom.window.HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => context;

        const canvas = document.createElement('canvas');
        const renderer = new ValuePlotRenderer(canvas);
        renderer.resize(400, 200);
        expect(canvas.width).to.equal(800);
        expect(canvas.height).to.equal(400);

        const first = new ValueSampleStore(8);
        first.push(100, 2);
        first.push(200, 3);
        const second = new ValueSampleStore(8);
        second.push(100, -2);
        second.push(200, -1);
        renderer.renderMany([
            { name: 'first', store: first, offset: 1 },
            { name: 'second', store: second, offset: -1 }
        ], 250, 250, { min: -5, max: 5 });
        expect(calls).to.include.members(['save', 'clear', 'stroke', 'restore']);
    });
});
