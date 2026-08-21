// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { CanSocketServiceImpl, CanSimulatorAdapter, CanHardwareAdapter } from './can-socket-service';
import { CanFrame, CanInterfaceConfig } from '../common/can-protocol';

/** Testable subclass that exposes the protected frame generator. */
class TestableCanSimulatorAdapter extends CanSimulatorAdapter {
    public testGenerateFrame(slot: number, counter: number, elapsedNs: bigint, elapsedSeconds: number): CanFrame {
        return this.generateFrameForSlot(slot, counter, elapsedNs, elapsedSeconds);
    }
}

// Canonical 20 IDs
const EXPECTED_IDS = [
    0x100, 0x101, 0x102, 0x103, 0x104,  // Group A
    0x110, 0x111, 0x112, 0x113, 0x114, 0x115, 0x116,  // Group B
    0x120, 0x121, 0x122, 0x123, 0x124, 0x125,  // Group C
    0x130, 0x131  // UINT16 + INT16
];

describe('CanSimulatorAdapter', () => {
    it('delivers frames at approximately the configured rate', async () => {
        const frames: CanFrame[] = [];
        const adapter = new CanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });
        adapter.start(f => frames.push(f));

        await new Promise<void>(resolve => setTimeout(resolve, 15));
        adapter.stop();

        expect(frames.length).to.be.at.least(1);
    });

    it('generates exactly 20 standard 11-bit IDs', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });

        const ids = new Set<number>();
        for (let slot = 0; slot < 20; slot++) {
            const frame = adapter.testGenerateFrame(slot, 0, 0n, 0);
            ids.add(frame.id);
            expect(frame.extended, `ID 0x${frame.id.toString(16)} should be standard frame`).to.be.false;
        }

        expect(ids.size).to.equal(20);
        for (const expectedId of EXPECTED_IDS) {
            expect(ids.has(expectedId), `should include ID 0x${expectedId.toString(16)}`).to.be.true;
        }
    });

    it('generates no IDs outside the defined set even after many frames', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });

        const ids = new Set<number>();
        for (let slot = 0; slot < 20; slot++) {
            for (let counter = 0; counter < 100; counter++) {
                const frame = adapter.testGenerateFrame(slot, counter, 0n, 0);
                ids.add(frame.id);
            }
        }

        expect(ids.size).to.equal(20);
        for (const id of ids) {
            expect(EXPECTED_IDS).to.include(id, `ID 0x${id.toString(16)} should be in the defined set`);
        }
    });

    it('Group A (0x100-0x104) payloads are constant across counters', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });

        for (let slot = 0; slot < 5; slot++) {
            const frame0 = adapter.testGenerateFrame(slot, 0, 0n, 0);
            const frame1 = adapter.testGenerateFrame(slot, 1, 0n, 0);
            const frame100 = adapter.testGenerateFrame(slot, 100, 0n, 0);
            expect(frame1.data).to.deep.equal(frame0.data, `0x${frame0.id.toString(16)} should not change`);
            expect(frame100.data).to.deep.equal(frame0.data, `0x${frame0.id.toString(16)} should not change after 100 frames`);
        }
    });

    it('Group A payloads match expected constant values', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });

        const expectedPayloads = [
            [0x0A, 0x14, 0x1E, 0x28, 0x32, 0x3C, 0x46, 0x50],  // 0x100: 10,20,30,40,50,60,70,80
            [0x0B, 0x15, 0x1F, 0x29, 0x33, 0x3D, 0x47, 0x51],  // 0x101
            [0x0C, 0x16, 0x20, 0x2A, 0x34, 0x3E, 0x48, 0x52],  // 0x102
            [0x0D, 0x17, 0x21, 0x2B, 0x35, 0x3F, 0x49, 0x53],  // 0x103
            [0x0E, 0x18, 0x22, 0x2C, 0x36, 0x40, 0x4A, 0x54],  // 0x104
        ];

        for (let slot = 0; slot < 5; slot++) {
            const frame = adapter.testGenerateFrame(slot, 0, 0n, 0);
            expect(frame.data).to.deep.equal(expectedPayloads[slot],
                `0x${frame.id.toString(16)} payload mismatch`);
        }
    });

    it('Group B (0x110-0x116) changes only designated bytes', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });

        // Slots 5-11 correspond to 0x110-0x116
        for (let slot = 5; slot <= 11; slot++) {
            const frame0 = adapter.testGenerateFrame(slot, 0, 0n, 0);
            const frame1 = adapter.testGenerateFrame(slot, 1, 0n, 0);

            const changedIndices: number[] = [];
            for (let i = 0; i < 8; i++) {
                if (frame0.data[i] !== frame1.data[i]) {
                    changedIndices.push(i);
                }
            }

            const id = frame0.id;
            // Verify which bytes changed match the spec
            switch (id) {
                case 0x110: expect(changedIndices).to.deep.equal([0]); break;
                case 0x111: expect(changedIndices).to.deep.equal([1]); break;
                case 0x112: expect(changedIndices).to.deep.equal([2, 3]); break;
                case 0x113: expect(changedIndices).to.deep.equal([4]); break;
                case 0x114: expect(changedIndices).to.include(5); expect(changedIndices).to.include(6); break;
                case 0x115: expect(changedIndices).to.deep.equal([7]); break;
                case 0x116: expect(changedIndices).to.include(0); expect(changedIndices).to.include(3); expect(changedIndices).to.include(7); break;
            }

            // Verify constant bytes didn't change
            for (let i = 0; i < 8; i++) {
                if (!changedIndices.includes(i)) {
                    expect(frame1.data[i]).to.equal(frame0.data[i],
                        `0x${id.toString(16)} byte ${i} should be constant`);
                }
            }
        }
    });

    it('Group C (0x120-0x125) changes every frame deterministically', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });

        for (let slot = 12; slot <= 17; slot++) {
            const frame0 = adapter.testGenerateFrame(slot, 0, 0n, 0);
            const frame1 = adapter.testGenerateFrame(slot, 1, 0n, 0);
            const frame2 = adapter.testGenerateFrame(slot, 2, 0n, 0);

            // Each frame should differ from the previous one
            const differs01 = frame0.data.some((b, i) => b !== frame1.data[i]);
            const differs12 = frame1.data.some((b, i) => b !== frame2.data[i]);
            expect(differs01, `0x${frame0.id.toString(16)} should differ between counter 0 and 1`).to.be.true;
            expect(differs12, `0x${frame0.id.toString(16)} should differ between counter 1 and 2`).to.be.true;

            // Patterns should be deterministic - same counter = same data
            const frame0Again = adapter.testGenerateFrame(slot, 0, 0n, 0);
            expect(frame0Again.data).to.deep.equal(frame0.data,
                `0x${frame0.id.toString(16)} should be deterministic`);
        }
    });

    it('0x130 contains correct UINT16 Little Endian incrementing values', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });
        const slot = 18; // 0x130

        const frame0 = adapter.testGenerateFrame(slot, 0, 0n, 0);
        expect(frame0.id).to.equal(0x130);
        expect(frame0.data[0]).to.equal(0x00);  // 0*10 = 0 LE
        expect(frame0.data[1]).to.equal(0x00);
        // Bytes 2-7 should be 0x55
        for (let i = 2; i < 8; i++) {
            expect(frame0.data[i]).to.equal(0x55);
        }

        const frame1 = adapter.testGenerateFrame(slot, 1, 0n, 0);
        expect(frame1.data[0]).to.equal(0x0A);  // 1*10 = 10 LE
        expect(frame1.data[1]).to.equal(0x00);

        const frame100 = adapter.testGenerateFrame(slot, 100, 0n, 0);
        const expected100 = (100 * 10) & 0xFFFF;  // 1000 = 0x03E8
        expect(frame100.data[0]).to.equal(expected100 & 0xFF);
        expect(frame100.data[1]).to.equal((expected100 >> 8) & 0xFF);

        // Wrap test: counter 6554 -> 65540 mod 65536 = 4
        const frameWrap = adapter.testGenerateFrame(slot, 6554, 0n, 0);
        expect(frameWrap.data[0]).to.equal(0x04);
        expect(frameWrap.data[1]).to.equal(0x00);
    });

    it('0x131 contains correct INT16 Little Endian 0.2 Hz sinusoid', () => {
        const adapter = new TestableCanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });
        const slot = 19; // 0x131

        // t=0: sin(0) = 0 -> value = 0
        const frame0 = adapter.testGenerateFrame(slot, 0, 0n, 0);
        expect(frame0.id).to.equal(0x131);
        expect(frame0.data[0]).to.equal(0x00);
        expect(frame0.data[1]).to.equal(0x00);
        // Bytes 2-7 should be 0xAA
        for (let i = 2; i < 8; i++) {
            expect(frame0.data[i]).to.equal(0xAA);
        }

        // t=1.25s: sin(2*pi*0.2*1.25) = sin(pi/2) = 1 -> value = 10000 = 0x2710
        const framePeak = adapter.testGenerateFrame(slot, 0, BigInt(1_250_000_000), 1.25);
        const expectedPeak = 10000;
        expect(framePeak.data[0]).to.equal(expectedPeak & 0xFF);
        expect(framePeak.data[1]).to.equal((expectedPeak >> 8) & 0xFF);

        // t=2.5s: sin(2*pi*0.2*2.5) = sin(pi) = 0 -> value = 0
        const frameZero = adapter.testGenerateFrame(slot, 0, BigInt(2_500_000_000), 2.5);
        expect(frameZero.data[0]).to.equal(0x00);
        expect(frameZero.data[1]).to.equal(0x00);

        // t=3.75s: sin(2*pi*0.2*3.75) = sin(3*pi/2) = -1 -> value = -10000
        const frameNeg = adapter.testGenerateFrame(slot, 0, BigInt(3_750_000_000), 3.75);
        const expectedNeg = -10000;
        const unsignedNeg = expectedNeg < 0 ? (expectedNeg + 65536) : expectedNeg;
        expect(frameNeg.data[0]).to.equal(unsignedNeg & 0xFF);
        expect(frameNeg.data[1]).to.equal((unsignedNeg >> 8) & 0xFF);

        // t=5.0s: sin(2*pi*0.2*5) = sin(2*pi) = 0 -> full period, back to 0
        const framePeriod = adapter.testGenerateFrame(slot, 0, BigInt(5_000_000_000), 5.0);
        expect(framePeriod.data[0]).to.equal(0x00);
        expect(framePeriod.data[1]).to.equal(0x00);
    });

    it('stops producing frames after stop()', async () => {
        const frames: CanFrame[] = [];
        const adapter = new CanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 100 });

        adapter.start(f => frames.push(f));
        await new Promise<void>(resolve => setTimeout(resolve, 15));
        adapter.stop();

        const countAfterStop = frames.length;
        await new Promise<void>(resolve => setTimeout(resolve, 20));

        expect(frames.length).to.equal(countAfterStop);
    });

    it('produces frames with correct timestamp ordering', async () => {
        const frames: CanFrame[] = [];
        const adapter = new CanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 200 });

        adapter.start(f => frames.push(f));
        await new Promise<void>(resolve => setTimeout(resolve, 50));
        adapter.stop();

        for (let i = 1; i < frames.length; i++) {
            expect(frames[i].timestamp).to.be.at.least(frames[i - 1].timestamp);
        }
    });

    it('cleanly stops without leaving a timer running (no leak)', async () => {
        const adapter = new CanSimulatorAdapter();
        const received: CanFrame[] = [];

        adapter.configure({ name: 'test', bitrate: 1000 });
        adapter.start(f => received.push(f));

        await new Promise<void>(resolve => setTimeout(resolve, 5));
        adapter.stop();
        adapter.stop(); // double stop should be idempotent

        const countBefore = received.length;
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        expect(received.length).to.equal(countBefore);
    });
});

describe('CanSocketServiceImpl', () => {
    it('emits status change events on start/stop', () => {
        const service = new CanSocketServiceImpl();
        const statuses: boolean[] = [];
        service.onStatusChanged(s => statuses.push(s));

        const mockAdapter: CanHardwareAdapter = {
            start: () => undefined,
            stop: () => undefined,
            configure: () => undefined
        };
        service.setAdapter(mockAdapter);

        const config: CanInterfaceConfig = { name: 'test', bitrate: 100 };
        service.start(config);
        expect(service.isCapturing).to.be.true;
        expect(statuses).to.deep.equal([true]);

        service.stop();
        expect(service.isCapturing).to.be.false;
        expect(statuses).to.deep.equal([true, false]);
    });

    it('resets statistics on start', () => {
        const service = new CanSocketServiceImpl();
        const stats = service.getStatistics();
        expect(stats.totalFrames).to.equal(0);
        expect(stats.framesPerSecond).to.equal(0);
    });

    it('does not start if already capturing', () => {
        const service = new CanSocketServiceImpl();
        const mockAdapter: CanHardwareAdapter = {
            start: () => undefined,
            stop: () => undefined,
            configure: () => undefined
        };
        service.setAdapter(mockAdapter);

        const config: CanInterfaceConfig = { name: 'test', bitrate: 100 };
        service.start(config);
        service.start(config); // second start should be no-op
        expect(service.isCapturing).to.be.true;

        service.stop();
    });

    it('forwards frames from adapter to onFrameReceived', async () => {
        const service = new CanSocketServiceImpl();
        const received: CanFrame[] = [];
        service.onFrameReceived(f => received.push(f));

        const adapter = new CanSimulatorAdapter();
        service.setAdapter(adapter);

        const config: CanInterfaceConfig = { name: 'test', bitrate: 1000 };
        service.start(config);

        await new Promise<void>(resolve => setTimeout(resolve, 10));
        service.stop();

        expect(received.length).to.be.at.least(1);
        expect(received[0].interface).to.equal('test');
    });

    it('runs separate demo generators concurrently', async () => {
        const service = new CanSocketServiceImpl();
        const interfaces = new Set<string>();
        service.onFrameReceived(frame => interfaces.add(frame.interface));

        service.start({ name: 'demo', bitrate: 100 });
        service.start({ name: 'demo2', bitrate: 100 });
        await new Promise<void>(resolve => setTimeout(resolve, 30));
        service.stop();

        expect(interfaces.has('demo')).to.equal(true);
        expect(interfaces.has('demo2')).to.equal(true);
    });

    it('cleans up stats interval on stop (no leak)', () => {
        const service = new CanSocketServiceImpl();
        const mockAdapter: CanHardwareAdapter = {
            start: () => undefined,
            stop: () => undefined,
            configure: () => undefined
        };
        service.setAdapter(mockAdapter);

        service.start({ name: 'test', bitrate: 100 });
        service.stop();
        service.stop();
        expect(service.isCapturing).to.be.false;
    });
});
