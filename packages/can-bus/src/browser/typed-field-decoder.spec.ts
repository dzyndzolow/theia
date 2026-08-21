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
globalScope.HTMLSelectElement = dom.window.HTMLSelectElement;

import { expect } from 'chai';
import { TypedFieldDecoder } from './typed-field-decoder';

describe('TypedFieldDecoder', () => {
    it('decodes a selected 32-bit signed field with scaling', () => {
        const decoder = new TypedFieldDecoder();
        decoder.setFrame({
            id: 1,
            extended: false,
            rtr: false,
            data: [0x80, 0x00, 0x00, 0x00],
            dlc: 4,
            timestamp: 1,
            interface: 'Demo'
        });
        decoder.setSelection({ startByte: 0, byteLength: 4 });
        const selects = decoder.node.querySelectorAll<HTMLSelectElement>('select');
        selects[0].value = 'INT';
        selects[0].onchange?.(new Event('change'));
        const divisor = decoder.node.querySelector<HTMLInputElement>('input')!;
        divisor.value = '2';
        divisor.oninput?.(new Event('input'));

        const decoded = decoder.getDecodedValue();
        expect(decoded.valid).to.be.true;
        expect(decoded.raw).to.equal(128n);
        expect(decoded.scaled).to.contain('64');
        decoder.dispose();
    });
});
