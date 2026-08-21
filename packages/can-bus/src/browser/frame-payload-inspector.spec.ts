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
globalScope.Element = dom.window.Element;
globalScope.HTMLElement = dom.window.HTMLElement;
globalScope.HTMLDivElement = dom.window.HTMLDivElement;
globalScope.HTMLInputElement = dom.window.HTMLInputElement;
globalScope.HTMLButtonElement = dom.window.HTMLButtonElement;

import { expect } from 'chai';
import { FramePayloadInspector } from './frame-payload-inspector';

describe('FramePayloadInspector', () => {
    const frame = {
        id: 0x110,
        extended: false,
        rtr: false,
        data: [0x10, 0x20, 0x30, 0x40],
        dlc: 4,
        timestamp: 10,
        interface: 'Demo'
    };

    it('requires a second click to confirm an INT/UINT byte range', () => {
        const inspector = new FramePayloadInspector();
        inspector.setFrame(frame);
        inspector.setRangeConfirmationMode(true);
        const selections: Array<{ startByte: number; byteLength: number }> = [];
        inspector.onDidSelect(selection => selections.push(selection));
        const buttons = () => Array.from(inspector.node.querySelectorAll<HTMLButtonElement>('.can-payload-byte'));
        const pointer = { button: 0, preventDefault: () => undefined } as unknown as PointerEvent;

        buttons()[1].onpointerdown?.(pointer);
        expect(selections).to.have.lengthOf(0);
        expect(inspector.getSelection()).to.include({ startByte: 1, byteLength: 1 });

        buttons()[3].onpointerdown?.(pointer);
        expect(selections).to.have.lengthOf(1);
        expect(selections[0]).to.deep.include({ startByte: 1, byteLength: 3 });
        inspector.dispose();
    });

    it('keeps normal byte selection immediate and releases DOM listeners on dispose', () => {
        const inspector = new FramePayloadInspector();
        inspector.setFrame(frame);
        const selections: unknown[] = [];
        inspector.onDidSelect(selection => selections.push(selection));
        const button = inspector.node.querySelector<HTMLButtonElement>('.can-payload-byte')!;
        button.onpointerdown?.({ button: 0, preventDefault: () => undefined } as unknown as PointerEvent);
        expect(selections).to.have.lengthOf(1);
        inspector.dispose();
        expect(inspector.node.childElementCount).to.equal(0);
        expect(() => inspector.setFrame(frame)).not.to.throw();
    });
});
