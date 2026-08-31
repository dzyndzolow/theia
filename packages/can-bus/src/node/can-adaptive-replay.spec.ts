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
import { CanAdaptiveIdentifyAlgorithms } from '../common/can-adaptive-identify';
import { CanAdaptiveReplayService, CanAdaptiveReplayServiceImpl } from './can-adaptive-replay';
import { CanTransmitService, CanTransmitRequest } from './can-transmit-service';
import { CanFrame } from '../common/can-protocol';

describe('SA-414: CanAdaptiveIdentify & CanAdaptiveReplay', () => {
    describe('CanAdaptiveIdentifyAlgorithms.minimizeSequence (Delta Debugging)', () => {
        it('should reduce a 10-frame log down to the single essential wake-up frame', async () => {
            const frames: CanFrame[] = [];
            for (let i = 0; i < 10; i++) {
                frames.push({
                    id: 0x100 + i,
                    extended: false,
                    rtr: false,
                    dlc: 8,
                    data: [i, 0, 0, 0, 0, 0, 0, 0],
                    timestamp: i * 10,
                    interface: 'vcan0'
                });
            }

            // Only frame with ID 0x104 triggers DUT wake-up
            const testFn = async (subseq: readonly CanFrame[]) => subseq.some(f => f.id === 0x104);

            const minimized = await CanAdaptiveIdentifyAlgorithms.minimizeSequence(frames, testFn);

            expect(minimized).to.have.lengthOf(1);
            expect(minimized[0].id).to.equal(0x104);
        });

        it('should reduce a multi-frame sequence down to the 2 required sequential frames', async () => {
            const frames: CanFrame[] = [
                { id: 0x100, extended: false, rtr: false, dlc: 8, data: [0], timestamp: 0, interface: 'vcan0' },
                { id: 0x200, extended: false, rtr: false, dlc: 8, data: [1], timestamp: 10, interface: 'vcan0' }, // required 1
                { id: 0x101, extended: false, rtr: false, dlc: 8, data: [0], timestamp: 20, interface: 'vcan0' },
                { id: 0x300, extended: false, rtr: false, dlc: 8, data: [2], timestamp: 30, interface: 'vcan0' }, // required 2
                { id: 0x102, extended: false, rtr: false, dlc: 8, data: [0], timestamp: 40, interface: 'vcan0' }
            ];

            // Requires BOTH 0x200 and 0x300
            const testFn = async (subseq: readonly CanFrame[]) =>
                subseq.some(f => f.id === 0x200) && subseq.some(f => f.id === 0x300);

            const minimized = await CanAdaptiveIdentifyAlgorithms.minimizeSequence(frames, testFn);

            expect(minimized).to.have.lengthOf(2);
            expect(minimized.map(f => f.id)).to.deep.equal([0x200, 0x300]);
        });
    });

    describe('CanAdaptiveIdentifyAlgorithms.bisectKeepAliveInterval', () => {
        it('should find max keep-alive timeout within tolerance threshold', async () => {
            // DUT timeout is 500ms
            const dutTimeoutMs = 500;
            const testFn = async (intervalMs: number) => intervalMs <= dutTimeoutMs;

            const best = await CanAdaptiveIdentifyAlgorithms.bisectKeepAliveInterval(50, 1000, 20, testFn);

            expect(best).to.be.closeTo(500, 25);
            expect(best).to.be.at.most(500);
        });
    });

    describe('CanAdaptiveReplayService', () => {
        let container: Container;
        let replayService: CanAdaptiveReplayService;
        let transmittedRequests: CanTransmitRequest[];

        beforeEach(() => {
            container = new Container();
            transmittedRequests = [];

            const mockTransmit: Partial<CanTransmitService> = {
                transmit: async (req: CanTransmitRequest) => {
                    transmittedRequests.push(req);
                    return true;
                },
                dispose: () => { /* no-op */ }
            };

            container.bind(CanTransmitService).toConstantValue(mockTransmit as CanTransmitService);
            container.bind(CanAdaptiveReplayService).to(CanAdaptiveReplayServiceImpl).inSingletonScope();

            replayService = container.get<CanAdaptiveReplayService>(CanAdaptiveReplayService);
        });

        afterEach(() => {
            replayService.dispose();
        });

        it('should transmit a sequence and produce minimal recipe', async () => {
            const frames: CanFrame[] = [
                { id: 0x100, extended: false, rtr: false, dlc: 8, data: [1], timestamp: 10, interface: 'vcan0' },
                { id: 0x101, extended: false, rtr: false, dlc: 8, data: [2], timestamp: 20, interface: 'vcan0' }
            ];

            const ok = await replayService.transmitSequence(frames, 0);
            expect(ok).to.be.true;
            expect(transmittedRequests).to.have.lengthOf(2);

            const recipe = await replayService.minimizeSequence(frames, async subseq => subseq.some(f => f.id === 0x101));
            expect(recipe.type).to.equal('SINGLE_FRAME');
            expect(recipe.frames).to.have.lengthOf(1);
            expect(recipe.frames[0].id).to.equal(0x101);
        });
    });
});
