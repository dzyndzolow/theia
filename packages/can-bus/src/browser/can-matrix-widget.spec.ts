// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { JSDOM } from 'jsdom';

require.extensions['.css'] = () => {};

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
const globalScope = global as unknown as Record<string, unknown>;
globalScope.window = dom.window;
globalScope.document = dom.window.document;
globalScope.Element = dom.window.Element;
globalScope.HTMLElement = dom.window.HTMLElement;
globalScope.HTMLDivElement = dom.window.HTMLDivElement;
globalScope.HTMLInputElement = dom.window.HTMLInputElement;
globalScope.HTMLSelectElement = dom.window.HTMLSelectElement;
globalScope.HTMLTableElement = dom.window.HTMLTableElement;
globalScope.HTMLTableRowElement = dom.window.HTMLTableRowElement;
globalScope.HTMLTableSectionElement = dom.window.HTMLTableSectionElement;
globalScope.DragEvent = dom.window.DragEvent || class DragEvent {};
globalScope.MouseEvent = dom.window.MouseEvent;
(dom.window.document as unknown as { queryCommandSupported: (cmd: string) => boolean }).queryCommandSupported = () => false;
let nextRafId = 1;
globalScope.requestAnimationFrame = (callback: () => void) => {
    const id = nextRafId++;
    queueMicrotask(callback);
    return id;
};
globalScope.cancelAnimationFrame = () => {};

import { expect } from 'chai';
import { CanMatrixWidget, CanMatrixRow } from './can-matrix-widget';
import { CanMatrixWorkerResponse, CanMatrixWorkerUpdate } from './can-matrix-worker';

class TestableCanMatrixWidget extends CanMatrixWidget {
    constructor() {
        super();
        const self = this as unknown as Record<string, unknown>;
        self.canRpcClient = {
            startCapture: () => {},
            stopCapture: () => {},
            onBinaryFrames: () => ({ dispose: () => {} }),
            onStatusChanged: () => ({ dispose: () => {} }),
            onFrameReceived: () => ({ dispose: () => {} })
        };
        self.shell = {
            onDidAddWidget: () => ({ dispose: () => {} }),
            onDidRemoveWidget: () => ({ dispose: () => {} }),
            getWidgets: () => []
        };
        self.interfaceReservation = {
            getActiveInterfaces: () => new Set<string>(),
            onDidChange: () => ({ dispose: () => {} })
        };
        self.registry = {};
        self.canVariableBridge = {};
        // Stub startMatrixWorker to avoid Blob URL / Worker in JSDOM
        self.startMatrixWorker = () => {};
        (self.init as () => void)();
    }

    public applyWorkerUpdatesForTest(response: CanMatrixWorkerResponse): void {
        this.applyWorkerUpdates(response);
        this.rafId = undefined;
        this.renderMatrix();
    }

    public getMatrixMap(): Map<string, CanMatrixRow> {
        return this.matrixMap;
    }

    public getRowElementsMap(): Map<string, HTMLTableRowElement> {
        return this.rowElementsMap;
    }

    public getTableBody(): HTMLTableSectionElement {
        return this.tbodyEl;
    }
}

function makeUpdate(id: number): CanMatrixWorkerUpdate {
    return {
        key: `demo:standard:${id}:1`,
        id,
        extended: false,
        rtr: false,
        dlc: 1,
        data: [0x42],
        prevData: [0x42],
        changedMask: [false],
        changeCounts: [0],
        lastChangedMs: [0],
        count: 1,
        lastTimestamp: 1000,
        deltaMs: 0,
        freqHz: 0,
        interface: 'demo',
        rowLastChangedMs: 0
    };
}

describe('CanMatrixWidget Worker Integration & DOM Eviction', () => {
    let widget: TestableCanMatrixWidget;

    beforeEach(() => {
        widget = new TestableCanMatrixWidget();
    });

    afterEach(() => {
        widget.dispose();
    });

    it('renders updates to matrixMap, rowElementsMap and DOM table', () => {
        const row1 = makeUpdate(1);
        const row2 = makeUpdate(2);

        widget.applyWorkerUpdatesForTest({
            type: 'UPDATES',
            updates: [row1, row2]
        });

        const matrixMap = widget.getMatrixMap();
        const rowElements = widget.getRowElementsMap();
        const tbody = widget.getTableBody();

        expect(matrixMap.size).to.equal(2);
        expect(rowElements.size).to.equal(2);
        expect(tbody.children.length).to.equal(2);
        expect(matrixMap.has(row1.key)).to.be.true;
        expect(matrixMap.has(row2.key)).to.be.true;
    });

    it('removes permanently evicted keys from matrixMap, rowElementsMap and DOM', () => {
        const row1 = makeUpdate(1);
        const row2 = makeUpdate(2);
        const row3 = makeUpdate(3);

        widget.applyWorkerUpdatesForTest({
            type: 'UPDATES',
            updates: [row1, row2]
        });

        expect(widget.getMatrixMap().size).to.equal(2);
        expect(widget.getTableBody().children.length).to.equal(2);

        // Next worker response permanently evicts row 1 and introduces row 3
        widget.applyWorkerUpdatesForTest({
            type: 'UPDATES',
            updates: [row3],
            evictedKeys: [row1.key]
        });

        const matrixMap = widget.getMatrixMap();
        const rowElements = widget.getRowElementsMap();
        const tbody = widget.getTableBody();

        expect(matrixMap.has(row1.key)).to.be.false;
        expect(rowElements.has(row1.key)).to.be.false;
        expect(matrixMap.has(row2.key)).to.be.true;
        expect(matrixMap.has(row3.key)).to.be.true;
        expect(matrixMap.size).to.equal(2);
        expect(tbody.children.length).to.equal(2);
    });

    it('preserves a row that was evicted and re-added in the same batch (not in evictedKeys)', () => {
        const row1 = makeUpdate(1);
        const row2 = makeUpdate(2);

        widget.applyWorkerUpdatesForTest({
            type: 'UPDATES',
            updates: [row1, row2]
        });

        // Worker net eviction contract: row 1 was evicted by another frame earlier in the batch,
        // but row 1 arrived again before batch end.
        // Worker removed row 1 from evictedKeys and included row 1 in updates.
        // Row 2 was evicted permanently.
        widget.applyWorkerUpdatesForTest({
            type: 'UPDATES',
            updates: [{ ...row1, count: 2 }],
            evictedKeys: [row2.key]
        });

        const matrixMap = widget.getMatrixMap();
        const rowElements = widget.getRowElementsMap();
        const tbody = widget.getTableBody();

        expect(matrixMap.has(row1.key)).to.be.true;
        expect(rowElements.has(row1.key)).to.be.true;
        expect(matrixMap.has(row2.key)).to.be.false;
        expect(rowElements.has(row2.key)).to.be.false;
        expect(matrixMap.size).to.equal(1);
        expect(tbody.children.length).to.equal(1);
    });
});
