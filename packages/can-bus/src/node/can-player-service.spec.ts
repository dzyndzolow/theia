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
import { CanPlayerService, CanPlayerServiceImpl } from './can-player-service';
import { CanTransmitService, CanTransmitRequest } from './can-transmit-service';
import { CanFrame } from '../common/can-protocol';

describe('SA-406: CanPlayerService (Replay Engine)', () => {
    let container: Container;
    let playerService: CanPlayerService;
    let transmittedRequests: CanTransmitRequest[];

    const testFrames: CanFrame[] = [
        { id: 0x100, extended: false, rtr: false, dlc: 8, data: [1, 2, 3, 4, 5, 6, 7, 8], timestamp: 10, interface: 'vcan0' },
        { id: 0x101, extended: false, rtr: false, dlc: 8, data: [8, 7, 6, 5, 4, 3, 2, 1], timestamp: 20, interface: 'vcan0' },
        { id: 0x102, extended: false, rtr: false, dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], timestamp: 30, interface: 'vcan0' }
    ];

    beforeEach(() => {
        container = new Container();
        transmittedRequests = [];

        const mockTransmitService: Partial<CanTransmitService> = {
            transmit: async (req: CanTransmitRequest) => {
                transmittedRequests.push(req);
                return true;
            },
            dispose: () => { /* no-op */ }
        };

        container.bind(CanTransmitService).toConstantValue(mockTransmitService as CanTransmitService);
        container.bind(CanPlayerService).to(CanPlayerServiceImpl).inSingletonScope();

        playerService = container.get<CanPlayerService>(CanPlayerService);
        playerService.setTransmitService(mockTransmitService as CanTransmitService);
    });

    afterEach(() => {
        playerService.dispose();
    });

    it('should replay loaded frames in chronological order and transition state', async () => {
        playerService.loadFrames(testFrames);
        expect(playerService.getState()).to.equal('STOPPED');

        playerService.play({ speedFactor: 10.0 }); // 10x speed for fast test
        expect(playerService.getState()).to.equal('PLAYING');

        // Wait for replay to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(transmittedRequests).to.have.lengthOf(3);
        expect(transmittedRequests[0].frame.id).to.equal(0x100);
        expect(transmittedRequests[1].frame.id).to.equal(0x101);
        expect(transmittedRequests[2].frame.id).to.equal(0x102);
        expect(playerService.getState()).to.equal('STOPPED');
    });

    it('should cleanly pause and resume replay', async () => {
        playerService.loadFrames(testFrames);
        playerService.play({ speedFactor: 1.0 });

        playerService.pause();
        expect(playerService.getState()).to.equal('PAUSED');

        playerService.resume();
        expect(playerService.getState()).to.equal('PLAYING');

        playerService.stop();
        expect(playerService.getState()).to.equal('STOPPED');
    });
});
