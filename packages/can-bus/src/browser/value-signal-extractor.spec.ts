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
import { computeAutoWindow } from './value-plot-renderer';
import {
    extractSignalValue,
    extractSamplesFromChunk,
    requiredBytesForType,
    validateFieldConfig,
    ValueFieldConfig,
    ValueSampleStore,
    ValueSignalConfig
} from './value-signal-extractor';
import { CanBinaryEncoder } from '../common/can-protocol';

describe('ValueSignalExtractor', () => {

    describe('extractSignalValue', () => {

        const base: ValueFieldConfig = { startByte: 0, byteLength: 1, type: 'UINT8', littleEndian: true, divisor: 1 };

        it('decodes a single UINT8 byte', () => {
            expect(extractSignalValue([0x7F], { ...base })).to.equal(127);
        });

        it('decodes a UINT16 little-endian pair (bytes 4-5 style)', () => {
            const data = [0, 0, 0, 0, 0x34, 0x12];
            const config: ValueFieldConfig = { startByte: 4, byteLength: 2, type: 'UINT16', littleEndian: true, divisor: 1 };
            expect(extractSignalValue(data, config)).to.equal(0x1234);
        });

        it('decodes a UINT16 big-endian pair', () => {
            const data = [0, 0, 0, 0, 0x12, 0x34];
            const config: ValueFieldConfig = { startByte: 4, byteLength: 2, type: 'UINT16', littleEndian: false, divisor: 1 };
            expect(extractSignalValue(data, config)).to.equal(0x1234);
        });

        it('decodes a signed INT16 negative value', () => {
            const data = [0xFF, 0xFF];
            const config: ValueFieldConfig = { ...base, byteLength: 2, type: 'INT16' };
            expect(extractSignalValue(data, config)).to.equal(-1);
        });

        it('decodes a flexible UINT across 3 bytes', () => {
            const data = [0x01, 0x02, 0x03];
            const config: ValueFieldConfig = { startByte: 0, byteLength: 3, type: 'UINT', littleEndian: false, divisor: 1 };
            expect(extractSignalValue(data, config)).to.equal(0x010203);
        });

        it('decodes a flexible INT with sign extension', () => {
            const data = [0xFF, 0xFE];
            const config: ValueFieldConfig = { startByte: 0, byteLength: 2, type: 'INT', littleEndian: false, divisor: 1 };
            expect(extractSignalValue(data, config)).to.equal(-2);
        });

        it('decodes FLOAT32', () => {
            const buffer = new ArrayBuffer(4);
            new DataView(buffer).setFloat32(0, 1.5, true);
            const data = Array.from(new Uint8Array(buffer));
            const config: ValueFieldConfig = { startByte: 0, byteLength: 4, type: 'FLOAT32', littleEndian: true, divisor: 1 };
            expect(extractSignalValue(data, config)).to.be.closeTo(1.5, 1e-6);
        });

        it('applies the divisor', () => {
            const data = [0x64];
            const config: ValueFieldConfig = { ...base, divisor: 10 };
            expect(extractSignalValue(data, config)).to.equal(10);
        });

        it('returns undefined when the range is outside the payload', () => {
            expect(extractSignalValue([0x01], { ...base, startByte: 4 })).to.equal(undefined);
            expect(extractSignalValue([0x01], { ...base, byteLength: 2, type: 'UINT16' })).to.equal(undefined);
        });

        it('returns undefined for an invalid divisor', () => {
            expect(extractSignalValue([0x01], { ...base, divisor: 0 })).to.equal(undefined);
            expect(extractSignalValue([0x01], { ...base, divisor: Number.NaN })).to.equal(undefined);
        });

        it('returns undefined when fixed-size type length does not match', () => {
            expect(extractSignalValue([0x01, 0x02], { ...base, byteLength: 1, type: 'UINT16' })).to.equal(undefined);
        });

        it('accepts Uint8Array payloads', () => {
            const payload = new Uint8Array([0, 0, 0, 0, 0x00, 0x2A]);
            const config: ValueFieldConfig = { startByte: 5, byteLength: 1, type: 'UINT8', littleEndian: true, divisor: 1 };
            expect(extractSignalValue(payload, config)).to.equal(42);
        });
    });

    describe('validateFieldConfig', () => {

        it('accepts a valid UINT16 configuration', () => {
            const config: ValueFieldConfig = { startByte: 4, byteLength: 2, type: 'UINT16', littleEndian: true, divisor: 1 };
            expect(validateFieldConfig(config)).to.equal(undefined);
        });

        it('rejects negative start byte', () => {
            const config: ValueFieldConfig = { startByte: -1, byteLength: 1, type: 'UINT8', littleEndian: true, divisor: 1 };
            expect(validateFieldConfig(config)).to.not.equal(undefined);
        });

        it('rejects byte length outside 1-8', () => {
            expect(validateFieldConfig({ startByte: 0, byteLength: 0, type: 'UINT', littleEndian: true, divisor: 1 })).to.not.equal(undefined);
            expect(validateFieldConfig({ startByte: 0, byteLength: 9, type: 'UINT', littleEndian: true, divisor: 1 })).to.not.equal(undefined);
        });

        it('rejects non-positive divisor', () => {
            expect(validateFieldConfig({ startByte: 0, byteLength: 1, type: 'UINT8', littleEndian: true, divisor: 0 })).to.not.equal(undefined);
        });

        it('reports fixed-size type length mismatch', () => {
            const error = validateFieldConfig({ startByte: 0, byteLength: 3, type: 'UINT16', littleEndian: true, divisor: 1 });
            expect(error).to.contain('UINT16');
        });
    });

    describe('requiredBytesForType', () => {
        it('maps fixed-size types to their byte length', () => {
            expect(requiredBytesForType('UINT8')).to.equal(1);
            expect(requiredBytesForType('INT16')).to.equal(2);
            expect(requiredBytesForType('FLOAT32')).to.equal(4);
            expect(requiredBytesForType('FLOAT64')).to.equal(8);
            expect(requiredBytesForType('UINT')).to.equal(undefined);
            expect(requiredBytesForType('INT')).to.equal(undefined);
        });
    });

    describe('ValueSampleStore', () => {

        it('stores samples in chronological order', () => {
            const store = new ValueSampleStore(4);
            store.push(10, 1.5);
            store.push(20, 2.5);
            store.push(30, 3.5);
            expect(store.size).to.equal(3);
            expect(store.timeAt(0)).to.equal(10);
            expect(store.valueAt(2)).to.equal(3.5);
            expect(store.lastTime()).to.equal(30);
        });

        it('overwrites the oldest sample when full', () => {
            const store = new ValueSampleStore(2);
            store.push(1, 10);
            store.push(2, 20);
            store.push(3, 30);
            expect(store.size).to.equal(2);
            expect(store.timeAt(0)).to.equal(2);
            expect(store.valueAt(0)).to.equal(20);
            expect(store.timeAt(1)).to.equal(3);
        });

        it('clears without losing capacity', () => {
            const store = new ValueSampleStore(2);
            store.push(1, 10);
            store.clear();
            expect(store.size).to.equal(0);
            expect(store.lastTime()).to.equal(undefined);
            store.push(5, 50);
            expect(store.timeAt(0)).to.equal(5);
        });

        it('handles large overwrap without allocation errors', () => {
            const store = new ValueSampleStore(16);
            for (let i = 0; i < 1000; i++) {
                store.push(i, i * 0.5);
            }
            expect(store.size).to.equal(16);
            expect(store.timeAt(15)).to.equal(999);
            expect(store.timeAt(0)).to.equal(984);
        });
    });

    describe('extractSamplesFromChunk', () => {

        const signal: ValueSignalConfig = {
            id: 0x123,
            extended: false,
            interfaces: [],
            startByte: 4,
            byteLength: 2,
            type: 'UINT16',
            littleEndian: true,
            divisor: 1
        };

        function encodeBatch(frames: Array<{ id: number; extended: boolean; data: number[]; interface: string }>): ArrayBuffer {
            return CanBinaryEncoder.encodeBatch(frames.map((f, i) => ({
                id: f.id,
                extended: f.extended,
                rtr: false,
                data: f.data,
                dlc: f.data.length,
                timestamp: 1000 + i * 10,
                interface: f.interface
            })));
        }

        function collect(chunk: ArrayBuffer | Uint8Array, config: ValueSignalConfig): Array<{ timeMs: number, value: number }> {
            const samples: Array<{ timeMs: number, value: number }> = [];
            extractSamplesFromChunk(chunk, config, (timeMs, value) => samples.push({ timeMs, value }));
            return samples;
        }

        it('extracts values only from matching frames', () => {
            const chunk = encodeBatch([
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x34, 0x12], interface: 'can0' },
                { id: 0x456, extended: false, data: [0, 0, 0, 0, 0xFF, 0xFF], interface: 'can0' },
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x64, 0x00], interface: 'can0' }
            ]);
            const samples = collect(chunk, signal);
            expect(samples).to.have.length(2);
            expect(samples[0].value).to.equal(0x1234);
            expect(samples[0].timeMs).to.equal(1000);
            expect(samples[1].value).to.equal(100);
        });

        it('filters by extended flag', () => {
            const chunk = encodeBatch([
                { id: 0x123, extended: true, data: [0, 0, 0, 0, 0x01, 0x00], interface: 'can0' },
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x02, 0x00], interface: 'can0' }
            ]);
            expect(collect(chunk, signal)).to.have.length(1);
            expect(collect(chunk, { ...signal, extended: true })[0].value).to.equal(1);
        });

        it('filters by interface name', () => {
            const chunk = encodeBatch([
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x01, 0x00], interface: 'can0' },
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x02, 0x00], interface: 'can1' },
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x03, 0x00], interface: 'vcan0' }
            ]);
            const samples = collect(chunk, { ...signal, interfaces: ['can1'] });
            expect(samples).to.have.length(1);
            expect(samples[0].value).to.equal(2);
            const multi = collect(chunk, { ...signal, interfaces: ['can0', 'vcan0'] });
            expect(multi.map(s => s.value)).to.deep.equal([1, 3]);
            expect(collect(chunk, signal)).to.have.length(3);
        });

        it('rejects corrupted chunks', () => {
            const chunk = new Uint8Array(encodeBatch([
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x34, 0x12], interface: 'can0' }
            ]));
            chunk[12] ^= 0xFF; // corrupt first byte of payload area
            expect(collect(chunk, signal)).to.have.length(0);
        });

        it('skips frames whose payload is too short for the field', () => {
            const chunk = encodeBatch([
                { id: 0x123, extended: false, data: [0x01, 0x02], interface: 'can0' },
                { id: 0x123, extended: false, data: [0, 0, 0, 0, 0x0A, 0x00], interface: 'can0' }
            ]);
            const samples = collect(chunk, signal);
            expect(samples).to.have.length(1);
            expect(samples[0].value).to.equal(10);
        });

        it('rejects empty or undersized buffers', () => {
            expect(collect(new ArrayBuffer(0), signal)).to.have.length(0);
            expect(collect(new ArrayBuffer(11), signal)).to.have.length(0);
        });
    });
});

describe('computeAutoWindow', () => {
    it('falls back to the default window without a period estimate', () => {
        expect(computeAutoWindow(undefined)).to.equal(100);
        expect(computeAutoWindow(undefined, 250)).to.equal(250);
    });

    it('uses five periods clamped to the allowed range', () => {
        expect(computeAutoWindow(20)).to.equal(100);   // 5 x 20ms
        expect(computeAutoWindow(0.1)).to.equal(1);     // clamped to min 1ms
        expect(computeAutoWindow(30_000)).to.equal(100_000); // clamped to max 100s
        expect(computeAutoWindow(50)).to.equal(250);
    });
});
