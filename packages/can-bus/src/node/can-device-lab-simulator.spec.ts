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
import { CanDeviceLabSimulator } from './can-device-lab-simulator';
import { DutFixtureConfig, DeterministicRandom } from '../common/can-device-lab-fixture';
import { CanFrame } from '../common/can-protocol';

describe('SA-409: CanDeviceLabSimulator & Fixture', () => {
    describe('DeterministicRandom', () => {
        it('should generate reproducible sequences from the same seed', () => {
            const rng1 = new DeterministicRandom(12345);
            const rng2 = new DeterministicRandom(12345);

            for (let i = 0; i < 50; i++) {
                expect(rng1.nextFloat()).to.equal(rng2.nextFloat());
                expect(rng1.nextInt(0, 100)).to.equal(rng2.nextInt(0, 100));
            }
        });
    });

    describe('Single-frame wake-up & Keep-alive', () => {
        const fixture: DutFixtureConfig = {
            name: 'TestECU',
            seed: 42,
            wakeUpFrame: {
                id: 0x100,
                dataPattern: [0x55, 0xAA, undefined, undefined, undefined, undefined, undefined, undefined]
            },
            keepAlive: {
                id: 0x105,
                requiredIntervalMs: 100,
                sleepTimeoutMs: 300
            },
            statusFrameId: 0x200,
            statusFrameIntervalMs: 50,
            indicators: [
                {
                    name: 'check_engine',
                    id: 0x110,
                    byteIndex: 0,
                    bitMask: 0x01,
                    activeState: true
                }
            ],
            numericFields: [
                {
                    name: 'speed_kmh',
                    id: 0x120,
                    startByte: 0,
                    byteLength: 2,
                    endianness: 'little',
                    scale: 0.1,
                    offset: 0
                }
            ]
        };

        it('should wake up only on matching wakeUpFrame', () => {
            const sim = new CanDeviceLabSimulator(fixture);
            expect(sim.getStateSnapshot().isAwake).to.be.false;

            // Send non-matching frame
            const wrongFrame: CanFrame = {
                id: 0x101,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
                timestamp: 10,
                interface: 'vcan0'
            };
            sim.processFrame(wrongFrame, 10);
            expect(sim.getStateSnapshot().isAwake).to.be.false;

            // Send matching wake-up frame
            const wakeFrame: CanFrame = {
                id: 0x100,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0x55, 0xAA, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06],
                timestamp: 20,
                interface: 'vcan0'
            };
            const responses = sim.processFrame(wakeFrame, 20);
            expect(sim.getStateSnapshot().isAwake).to.be.true;
            expect(sim.getStateSnapshot().wakeCount).to.equal(1);
            expect(responses).to.have.lengthOf(1);
            expect(responses[0].id).to.equal(0x200);
        });

        it('should fall asleep when keep-alive timeout expires', () => {
            const sim = new CanDeviceLabSimulator(fixture);
            // Wake up
            sim.processFrame({
                id: 0x100,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0x55, 0xAA, 0, 0, 0, 0, 0, 0],
                timestamp: 0,
                interface: 'vcan0'
            }, 0);
            expect(sim.getStateSnapshot().isAwake).to.be.true;

            // Send keep-alive at 100ms
            sim.processFrame({
                id: 0x105,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0, 0, 0, 0, 0, 0, 0, 0],
                timestamp: 100,
                interface: 'vcan0'
            }, 100);

            // Tick at 200ms -> should still be awake (time since keep-alive = 100ms <= 300ms)
            sim.tick(200);
            expect(sim.getStateSnapshot().isAwake).to.be.true;

            // Tick at 450ms -> should fall asleep (time since keep-alive = 350ms > 300ms)
            sim.tick(450);
            expect(sim.getStateSnapshot().isAwake).to.be.false;
        });

        it('should update indicators and numeric values when awake', () => {
            const sim = new CanDeviceLabSimulator(fixture);
            // Wake up
            sim.processFrame({
                id: 0x100,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0x55, 0xAA, 0, 0, 0, 0, 0, 0],
                timestamp: 0,
                interface: 'vcan0'
            }, 0);

            // Turn on check engine lamp (id 0x110, byte 0 bit 0 = 1)
            sim.processFrame({
                id: 0x110,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0x01, 0, 0, 0, 0, 0, 0, 0],
                timestamp: 10,
                interface: 'vcan0'
            }, 10);
            expect(sim.getStateSnapshot().indicators['check_engine']).to.be.true;

            // Set speed to 120.5 km/h (raw value = 1205 = 0x04B5, little endian [0xB5, 0x04])
            sim.processFrame({
                id: 0x120,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0xB5, 0x04, 0, 0, 0, 0, 0, 0],
                timestamp: 20,
                interface: 'vcan0'
            }, 20);
            expect(sim.getStateSnapshot().numericValues['speed_kmh']).to.be.closeTo(120.5, 0.01);
        });

        it('should cleanly reset all states on powerCycle()', () => {
            const sim = new CanDeviceLabSimulator(fixture);
            sim.processFrame({
                id: 0x100,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0x55, 0xAA, 0, 0, 0, 0, 0, 0],
                timestamp: 0,
                interface: 'vcan0'
            }, 0);
            expect(sim.getStateSnapshot().isAwake).to.be.true;

            sim.powerCycle();
            const snap = sim.getStateSnapshot();
            expect(snap.isAwake).to.be.false;
            expect(snap.wakeCount).to.equal(0);
            expect(snap.indicators['check_engine']).to.be.false;
            expect(snap.numericValues['speed_kmh']).to.equal(0);
        });
    });

    describe('Multi-frame sequence wake-up', () => {
        const seqFixture: DutFixtureConfig = {
            name: 'SequenceECU',
            seed: 99,
            wakeUpSequence: {
                frames: [
                    { id: 0x201, dataPattern: [0x01] },
                    { id: 0x202, dataPattern: [0x02] },
                    { id: 0x203, dataPattern: [0x03] }
                ],
                maxIntervalMs: 50
            }
        };

        it('should wake up only on ordered sequence within maxInterval', () => {
            const sim = new CanDeviceLabSimulator(seqFixture);

            // Step 1
            sim.processFrame({ id: 0x201, extended: false, rtr: false, dlc: 1, data: [0x01], timestamp: 10, interface: 'vcan0' }, 10);
            expect(sim.getStateSnapshot().isAwake).to.be.false;

            // Step 2
            sim.processFrame({ id: 0x202, extended: false, rtr: false, dlc: 1, data: [0x02], timestamp: 30, interface: 'vcan0' }, 30);
            expect(sim.getStateSnapshot().isAwake).to.be.false;

            // Step 3
            sim.processFrame({ id: 0x203, extended: false, rtr: false, dlc: 1, data: [0x03], timestamp: 50, interface: 'vcan0' }, 50);
            expect(sim.getStateSnapshot().isAwake).to.be.true;
        });

        it('should reset sequence if interval exceeded', () => {
            const sim = new CanDeviceLabSimulator(seqFixture);

            // Step 1 at 10ms
            sim.processFrame({ id: 0x201, extended: false, rtr: false, dlc: 1, data: [0x01], timestamp: 10, interface: 'vcan0' }, 10);
            // Step 2 at 100ms (gap 90ms > 50ms maxInterval)
            sim.processFrame({ id: 0x202, extended: false, rtr: false, dlc: 1, data: [0x02], timestamp: 100, interface: 'vcan0' }, 100);
            // Step 3 at 120ms
            sim.processFrame({ id: 0x203, extended: false, rtr: false, dlc: 1, data: [0x03], timestamp: 120, interface: 'vcan0' }, 120);

            expect(sim.getStateSnapshot().isAwake).to.be.false;
        });
    });
});
