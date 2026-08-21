// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { GlobalVariableRegistry } from '@theia/signal-core';
import {
    GLOBAL_VARIABLE_MAP_FORMAT,
    GLOBAL_VARIABLE_MAP_SCHEMA_VERSION,
    createGlobalVariableMap,
    parseGlobalVariableMap
} from './variable-map';
import type { CanVariableBinding } from './can-variable-bridge';

describe('Global Variable Map format', () => {
    it('exports a versioned snapshot with CAN bindings', () => {
        const registry = new GlobalVariableRegistry();
        const def = registry.define({ name: 'engine.rpm', type: 'UINT16', writable: true });
        const binding: CanVariableBinding = {
            id: 'binding-1', variableId: def.id, canId: 0x123, extended: false,
            startByte: 2, byteLength: 2, startBit: 0, bitLength: 16, isBit: false,
            type: 'UINT', littleEndian: true, divisor: 10
        };

        const document = createGlobalVariableMap(registry, [binding], '2026-08-20T00:00:00.000Z');
        expect(document.format).to.equal(GLOBAL_VARIABLE_MAP_FORMAT);
        expect(document.schemaVersion).to.equal(GLOBAL_VARIABLE_MAP_SCHEMA_VERSION);
        expect(document.variables).to.have.lengthOf(1);
        expect(document.canBindings[0].canId).to.equal(0x123);
        registry.dispose();
    });

    it('migrates a legacy raw snapshot array without inventing bindings', () => {
        const document = parseGlobalVariableMap(JSON.stringify([
            { definition: { name: 'legacy.value', type: 'UINT8' }, state: { value: 4 } }
        ]));
        expect(document.schemaVersion).to.equal(GLOBAL_VARIABLE_MAP_SCHEMA_VERSION);
        expect(document.canBindings).to.have.lengthOf(0);
        expect(document.variables).to.have.lengthOf(1);
    });

    it('rejects unknown schema versions and incomplete map documents', () => {
        expect(() => parseGlobalVariableMap(JSON.stringify({
            format: GLOBAL_VARIABLE_MAP_FORMAT, schemaVersion: 99, variables: [], canBindings: []
        }))).to.throw();
        expect(() => parseGlobalVariableMap(JSON.stringify({
            format: GLOBAL_VARIABLE_MAP_FORMAT, schemaVersion: GLOBAL_VARIABLE_MAP_SCHEMA_VERSION
        }))).to.throw();
    });
});
