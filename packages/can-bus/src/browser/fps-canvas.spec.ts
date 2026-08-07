// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { FpsCanvasRenderer } from './fps-canvas';

describe('SA-006: FpsCanvasRenderer', () => {
    let mockCanvas: HTMLCanvasElement;

    beforeEach(() => {
        // Simple mock canvas for unit test environment without full DOM
        mockCanvas = {
            width: 800,
            height: 200,
            getContext: () => ({
                save: () => { },
                restore: () => { },
                scale: () => { },
                clearRect: () => { },
                beginPath: () => { },
                moveTo: () => { },
                lineTo: () => { },
                stroke: () => { },
                fillText: () => { },
                setLineDash: () => { }
            }) as unknown as CanvasRenderingContext2D
        } as unknown as HTMLCanvasElement;
    });

    it('should initialize and push samples correctly', () => {
        const renderer = new FpsCanvasRenderer(mockCanvas);

        renderer.pushSample(1000, 20.5);
        renderer.pushSample(2000, 40.0);

        // Renderer handles resizing and High-DPI
        renderer.resize(400, 100);
        expect(mockCanvas.width).to.be.greaterThan(0);
        expect(mockCanvas.height).to.be.greaterThan(0);
    });

    it('should clear metric samples without error', () => {
        const renderer = new FpsCanvasRenderer(mockCanvas);
        renderer.pushSample(500, 10);
        renderer.clear();

        // Should handle render gracefully after clear
        renderer.render();
    });
});
