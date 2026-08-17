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
(dom.window.document as unknown as Record<string, unknown>).queryCommandSupported = () => false;
globalScope.Element = dom.window.Element;
globalScope.HTMLElement = dom.window.HTMLElement;
globalScope.HTMLDivElement = dom.window.HTMLDivElement;
globalScope.HTMLInputElement = dom.window.HTMLInputElement;
globalScope.HTMLTableSectionElement = dom.window.HTMLTableSectionElement;
globalScope.Node = dom.window.Node;
globalScope.Event = dom.window.Event;
globalScope.CustomEvent = dom.window.CustomEvent;
globalScope.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { GlobalVariableRegistry } from '@theia/signal-core';
import {
    GLOBAL_VARIABLES_WIDGET_ID,
    GLOBAL_VARIABLES_WIDGET_LABEL,
    VARIABLE_TYPES
} from './global-variables-widget';

describe('GlobalVariablesWidget & System Integration', () => {
    let container: Container;
    let registry: GlobalVariableRegistry;

    beforeEach(() => {
        container = new Container();
        container.bind(GlobalVariableRegistry).toSelf().inSingletonScope();
        registry = container.get(GlobalVariableRegistry);
    });

    afterEach(() => {
        registry.dispose();
    });

    it('should have proper widget identifiers and type specifications', () => {
        expect(GLOBAL_VARIABLES_WIDGET_ID).to.equal('global-variables-widget');
        expect(GLOBAL_VARIABLES_WIDGET_LABEL).to.equal('Global Variables');
        expect(VARIABLE_TYPES).to.include.members([
            'BOOL', 'UINT8', 'INT8', 'UINT16', 'INT16', 'UINT32', 'INT32',
            'FLOAT32', 'FLOAT64', 'STRING', 'BYTES'
        ]);
        expect(VARIABLE_TYPES).to.have.lengthOf(11);
    });

    it('should maintain state synchronization across multiple consumers through the singleton registry', () => {
        const def = registry.define({
            name: 'engine.rpm',
            type: 'UINT16',
            writable: true,
            initialValue: 1500,
            unit: 'RPM'
        });

        expect(registry.read(def.id)?.value).to.equal(1500);

        // Consumer 1 updates value
        registry.write(def.id, 2800, { source: 'CAN_DEC' });

        // Consumer 2 reads updated value
        const state = registry.read(def.id);
        expect(state?.value).to.equal(2800);
        expect(state?.source).to.equal('CAN_DEC');
        expect(state?.version).to.equal(2);
    });

    it('should correctly handle export and import of variable snapshot', () => {
        registry.define({
            name: 'temp.oil',
            type: 'FLOAT32',
            writable: true,
            unit: '°C'
        });
        registry.write('temp.oil', 95.5, { quality: 'GOOD' });

        const snapshotJson = registry.exportSnapshot();
        expect(snapshotJson).to.be.a('string');

        // Restore into new registry
        const freshRegistry = new GlobalVariableRegistry();
        freshRegistry.importSnapshot(snapshotJson);

        const restored = freshRegistry.findByName('temp.oil');
        expect(restored).to.exist;
        expect(restored?.state.value).to.be.closeTo(95.5, 0.01);
        expect(restored?.definition.unit).to.equal('°C');

        freshRegistry.dispose();
    });
});
