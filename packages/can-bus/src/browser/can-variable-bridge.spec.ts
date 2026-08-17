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
import { Container } from '@theia/core/shared/inversify';
import { GlobalVariableRegistry } from '@theia/signal-core';
import { CanVariableBridge } from './can-variable-bridge';
import { CanRpcClient } from './can-rpc-client';
import { CanFrame } from '../common/can-protocol';

describe('CanVariableBridge', () => {
    let container: Container;
    let registry: GlobalVariableRegistry;
    let bridge: CanVariableBridge;

    beforeEach(() => {
        container = new Container();
        container.bind(GlobalVariableRegistry).toSelf().inSingletonScope();
        container.bind(CanRpcClient).toConstantValue({
            onBinaryFrames: () => ({ dispose: () => { /* noop */ } })
        } as unknown as CanRpcClient);
        container.bind(CanVariableBridge).toSelf().inSingletonScope();

        registry = container.get(GlobalVariableRegistry);
        bridge = container.get(CanVariableBridge);
    });

    afterEach(() => {
        bridge.dispose();
    });

    it('should add, retrieve, and remove variable bindings', () => {
        const v1 = registry.define({ name: 'engine.switch', type: 'BOOL', writable: true });
        const binding = bridge.addBinding({
            variableId: v1.id,
            canId: 0x111,
            extended: false,
            startByte: 3,
            byteLength: 1,
            startBit: 2,
            bitLength: 1,
            isBit: true,
            type: 'BOOL',
            littleEndian: true,
            divisor: 1
        });

        expect(binding.id).to.be.a('string');
        expect(bridge.getBindings()).to.have.lengthOf(1);
        expect(bridge.getBindingsForCanId(0x111)).to.have.lengthOf(1);
        expect(bridge.getBindingsForCanId(0x222)).to.have.lengthOf(0);

        const removed = bridge.removeBinding(binding.id);
        expect(removed).to.be.true;
        expect(bridge.getBindings()).to.have.lengthOf(0);
    });

    it('should extract single bit (BOOL) from CAN frame and update registry', () => {
        const v = registry.define({ name: 'relay.state', type: 'BOOL', writable: true });
        bridge.addBinding({
            variableId: v.id,
            canId: 0x111,
            extended: false,
            startByte: 3,
            byteLength: 1,
            startBit: 2, // Bit 2 of byte 3
            bitLength: 1,
            isBit: true,
            type: 'BOOL',
            littleEndian: true,
            divisor: 1
        });

        // Frame with byte 3 = 0x04 (0b00000100 -> bit 2 is 1)
        const frame1: CanFrame = {
            id: 0x111,
            extended: false,
            rtr: false,
            dlc: 8,
            data: [0, 0, 0, 0x04, 0, 0, 0, 0],
            timestamp: 1000,
            interface: 'demo'
        };
        bridge.processFrame(frame1);

        let state = registry.read(v.id);
        expect(state?.value).to.be.true;
        expect(state?.quality).to.equal('GOOD');
        expect(state?.source).to.equal('CAN 0x111.bit2');

        // Frame with byte 3 = 0x00 (0b00000000 -> bit 2 is 0)
        const frame2: CanFrame = {
            id: 0x111,
            extended: false,
            rtr: false,
            dlc: 8,
            data: [0, 0, 0, 0x00, 0, 0, 0, 0],
            timestamp: 1050,
            interface: 'demo'
        };
        bridge.processFrame(frame2);

        state = registry.read(v.id);
        expect(state?.value).to.be.false;
    });

    it('should extract numeric byte field with divisor and little-endian ordering', () => {
        const v = registry.define({ name: 'engine.rpm', type: 'FLOAT32', writable: true });
        bridge.addBinding({
            variableId: v.id,
            canId: 0x130,
            extended: false,
            startByte: 4,
            byteLength: 2,
            type: 'UINT16',
            littleEndian: true,
            divisor: 4
        });

        // Frame with bytes 4-5 = 0x04, 0x01 -> 0x0104 = 260 -> 260 / 4 = 65
        const frame: CanFrame = {
            id: 0x130,
            extended: false,
            rtr: false,
            dlc: 8,
            data: [0, 0, 0, 0, 0x04, 0x01, 0, 0],
            timestamp: 2000,
            interface: 'demo'
        };
        bridge.processFrame(frame);

        const state = registry.read(v.id);
        expect(state?.value).to.equal(65);
        expect(state?.quality).to.equal('GOOD');
    });
});
