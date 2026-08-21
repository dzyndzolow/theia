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
import { CanBinaryEncoder, CanFrame } from '../common/can-protocol';

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

    it('should decode the complete 32-bit unsigned and signed bit ranges', () => {
        const unsigned = registry.define({ name: 'counter.u32', type: 'UINT32', writable: true });
        const signed = registry.define({ name: 'counter.i32', type: 'INT32', writable: true });
        bridge.addBinding({
            variableId: unsigned.id,
            canId: 0x200,
            extended: false,
            startByte: 0,
            byteLength: 4,
            startBit: 0,
            bitLength: 32,
            type: 'UINT',
            littleEndian: true,
            divisor: 1
        });
        bridge.addBinding({
            variableId: signed.id,
            canId: 0x201,
            extended: false,
            startByte: 0,
            byteLength: 4,
            startBit: 0,
            bitLength: 32,
            type: 'INT',
            littleEndian: true,
            divisor: 1
        });

        const frame = (id: number, data: number[]): CanFrame => ({
            id, extended: false, rtr: false, dlc: 4, data, timestamp: 3000, interface: 'demo'
        });
        bridge.processFrame(frame(0x200, [0x78, 0x56, 0x34, 0x12]));
        bridge.processFrame(frame(0x201, [0x00, 0x00, 0x00, 0x80]));

        expect(registry.read(unsigned.id)?.value).to.equal(0x12345678);
        expect(registry.read(signed.id)?.value).to.equal(-0x80000000);
        expect(registry.read(unsigned.id)?.timestampNs).to.equal(3000000000n);
        expect(registry.read(unsigned.id)?.clockDomain).to.equal('can-capture');
    });

    it('should decode bit lengths 1, 8, 16, 31 and 32 with cross-byte validation', () => {
        const cases = [
            { bits: 1, data: [0x01], expected: 1 },
            { bits: 8, data: [0xAB], expected: 0xAB },
            { bits: 16, data: [0x34, 0x12], expected: 0x1234 },
            { bits: 31, data: [0xFF, 0xFF, 0xFF, 0x7F], expected: 0x7FFFFFFF },
            { bits: 32, data: [0x78, 0x56, 0x34, 0x12], expected: 0x12345678 }
        ] as const;

        for (const [index, testCase] of cases.entries()) {
            const variable = registry.define({ name: `ranges.u${testCase.bits}.${index}`, type: 'UINT32', writable: true });
            bridge.addBinding({
                variableId: variable.id,
                canId: 0x300 + index,
                extended: false,
                startByte: 0,
                byteLength: testCase.data.length,
                startBit: 0,
                bitLength: testCase.bits,
                type: 'UINT',
                littleEndian: true,
                divisor: 1
            });
            bridge.processFrame({
                id: 0x300 + index, extended: false, rtr: false,
                dlc: testCase.data.length, data: [...testCase.data], timestamp: 4000, interface: 'demo'
            });
            expect(registry.read(variable.id)?.value).to.equal(testCase.expected);
        }

        const signedCases = [
            { bits: 8, data: [0x80], expected: -128 },
            { bits: 16, data: [0x00, 0x80], expected: -32768 },
            { bits: 31, data: [0x00, 0x00, 0x00, 0x40], expected: -0x40000000 },
            { bits: 32, data: [0x00, 0x00, 0x00, 0x80], expected: -0x80000000 }
        ] as const;
        for (const [index, testCase] of signedCases.entries()) {
            const variable = registry.define({ name: `ranges.i${testCase.bits}.${index}`, type: 'INT32', writable: true });
            bridge.addBinding({
                variableId: variable.id,
                canId: 0x320 + index,
                extended: false,
                startByte: 0,
                byteLength: testCase.data.length,
                startBit: 0,
                bitLength: testCase.bits,
                type: 'INT',
                littleEndian: true,
                divisor: 1
            });
            bridge.processFrame({
                id: 0x320 + index, extended: false, rtr: false,
                dlc: testCase.data.length, data: [...testCase.data], timestamp: 4000, interface: 'demo'
            });
            expect(registry.read(variable.id)?.value).to.equal(testCase.expected);
        }

        const crossByte = registry.define({ name: 'ranges.cross-byte', type: 'UINT16', writable: true });
        bridge.addBinding({
            variableId: crossByte.id,
            canId: 0x310,
            extended: false,
            startByte: 0,
            byteLength: 2,
            startBit: 4,
            bitLength: 8,
            type: 'UINT',
            littleEndian: true,
            divisor: 2
        });
        bridge.processFrame({
            id: 0x310, extended: false, rtr: false, dlc: 2, data: [0xA5, 0x3C], timestamp: 4000, interface: 'demo'
        });
        expect(registry.read(crossByte.id)?.value).to.equal(0xCA / 2);

        const bigEndian = registry.define({ name: 'ranges.big-endian', type: 'UINT16', writable: true });
        bridge.addBinding({
            variableId: bigEndian.id,
            canId: 0x311,
            extended: false,
            startByte: 0,
            byteLength: 2,
            startBit: 0,
            bitLength: 16,
            type: 'UINT',
            littleEndian: false,
            divisor: 1
        });
        bridge.processFrame({
            id: 0x311, extended: false, rtr: false, dlc: 2, data: [0x12, 0x34], timestamp: 4000, interface: 'demo'
        });
        expect(registry.read(bigEndian.id)?.value).to.equal(0x1234);

        const outside = registry.define({ name: 'ranges.outside', type: 'UINT16', writable: true });
        bridge.addBinding({
            variableId: outside.id,
            canId: 0x312,
            extended: false,
            startByte: 0,
            byteLength: 1,
            startBit: 4,
            bitLength: 8,
            type: 'UINT',
            littleEndian: true,
            divisor: 1
        });
        bridge.processFrame({
            id: 0x312, extended: false, rtr: false, dlc: 1, data: [0xFF], timestamp: 4000, interface: 'demo'
        });
        expect(registry.read(outside.id)?.version).to.equal(1);
    });

    it('should replace bindings atomically and expose malformed chunk diagnostics', () => {
        const variable = registry.define({ name: 'diagnostics.value', type: 'UINT8', writable: true });
        const binding = bridge.addBinding({
            variableId: variable.id,
            canId: 0x400,
            extended: false,
            startByte: 0,
            byteLength: 1,
            type: 'UINT8',
            littleEndian: true,
            divisor: 1
        });
        expect(() => bridge.replaceBindings([{
            ...binding,
            variableId: 'missing-variable' as typeof variable.id
        }])).to.throw('unknown variable');
        expect(bridge.getBindings()).to.have.lengthOf(1);

        bridge.processBinaryChunk(new Uint8Array([0x00]).buffer);
        expect(bridge.getDiagnostics().malformedChunkCount).to.equal(1);
        expect(bridge.getDiagnostics().lastError).to.be.a('string');
    });

    it('should skip binary decoding while no variables are bound', () => {
        bridge.processBinaryChunk(new Uint8Array([0x00]).buffer);

        expect(bridge.getDiagnostics().malformedChunkCount).to.equal(0);
    });

    it('should not write a valid prefix from a malformed binary chunk', () => {
        const variable = registry.define({ name: 'diagnostics.atomic', type: 'UINT8', writable: true });
        bridge.addBinding({
            variableId: variable.id,
            canId: 0x401,
            extended: false,
            startByte: 0,
            byteLength: 1,
            type: 'UINT8',
            littleEndian: true,
            divisor: 1
        });
        const buffer = CanBinaryEncoder.encodeBatch([{
            id: 0x401,
            extended: false,
            rtr: false,
            dlc: 1,
            data: [42],
            timestamp: 5000,
            interface: 'demo'
        }]);
        new DataView(buffer).setUint32(4, 2, true);

        bridge.processBinaryChunk(buffer);

        expect(registry.read(variable.id)?.value).to.equal(0);
        expect(registry.read(variable.id)?.version).to.equal(1);
        expect(bridge.getDiagnostics().malformedChunkCount).to.equal(1);
    });
});
