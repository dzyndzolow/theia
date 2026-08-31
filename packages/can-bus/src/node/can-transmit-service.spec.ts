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
import { CanTransmitServiceImpl, CanTransmitAdapter } from './can-transmit-service';
import { CanExperimentSessionConfig, TxFrameEvent } from '../common/can-experiment-protocol';
import { CanExperimentEventBus } from '../common/can-experiment-event-bus';
import { CanFrame } from '../common/can-protocol';

describe('SA-406: CanTransmitService', () => {
    let transmitService: CanTransmitServiceImpl;
    let eventBus: CanExperimentEventBus;
    let sentFrames: CanFrame[];
    let mockAdapter: CanTransmitAdapter;

    const sessionConfig: CanExperimentSessionConfig = {
        sessionId: 'session-tx-test',
        interfaceName: 'vcan0',
        bitrate: 500000,
        mode: 'CAN_2_0',
        idMode: 'STANDARD_11BIT',
        allowedIds: [0x100, 0x101],
        maxFps: 100,
        maxBusLoadPercent: 80,
        maxDurationMs: 10000
    };

    const validFrame: CanFrame = {
        id: 0x100,
        extended: false,
        rtr: false,
        dlc: 8,
        data: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
        timestamp: 10,
        interface: 'vcan0'
    };

    beforeEach(() => {
        transmitService = new CanTransmitServiceImpl();
        eventBus = new CanExperimentEventBus();
        sentFrames = [];
        mockAdapter = {
            sendFrame: (frame: CanFrame) => {
                sentFrames.push(frame);
                return true;
            }
        };

        transmitService.setSessionConfig(sessionConfig, eventBus);
        transmitService.setAdapter(mockAdapter);
    });

    afterEach(() => {
        transmitService.dispose();
        eventBus.dispose();
    });

    it('should refuse to transmit when state is DISARMED or ARMED', async () => {
        transmitService.setState('DISARMED');
        const resDisarmed = await transmitService.transmit({
            frame: validFrame,
            sourceKind: 'LITERAL'
        });
        expect(resDisarmed).to.be.false;
        expect(sentFrames).to.have.lengthOf(0);

        transmitService.setState('ARMED');
        const resArmed = await transmitService.transmit({
            frame: validFrame,
            sourceKind: 'LITERAL'
        });
        expect(resArmed).to.be.false;
        expect(sentFrames).to.have.lengthOf(0);
    });

    it('should successfully transmit frame and publish audit event when RUNNING', async () => {
        transmitService.setState('RUNNING');
        const res = await transmitService.transmit({
            frame: validFrame,
            sourceKind: 'LITERAL',
            campaignId: 'camp-1',
            trialId: 'trial-1',
            sequenceIndex: 0
        });

        expect(res).to.be.true;
        expect(sentFrames).to.have.lengthOf(1);
        expect(sentFrames[0].id).to.equal(0x100);

        const journal = eventBus.getJournal();
        expect(journal.size()).to.equal(1);
        const txEvt = journal.getAll()[0] as TxFrameEvent;
        expect(txEvt.type).to.equal('TX_FRAME');
        expect(txEvt.status).to.equal('SENT');
        expect(txEvt.campaignId).to.equal('camp-1');
    });

    it('should reject frame if not on allowlist and record error event in Journal', async () => {
        transmitService.setState('RUNNING');
        const invalidFrame: CanFrame = { ...validFrame, id: 0x999 };
        const res = await transmitService.transmit({
            frame: invalidFrame,
            sourceKind: 'LITERAL'
        });

        expect(res).to.be.false;
        expect(sentFrames).to.have.lengthOf(0);

        const journal = eventBus.getJournal();
        expect(journal.size()).to.equal(1);
        const txEvt = journal.getAll()[0] as TxFrameEvent;
        expect(txEvt.status).to.equal('ADAPTER_ERROR');
    });

    it('should immediately stop and reject transmission when stop() is called', async () => {
        transmitService.setState('RUNNING');
        transmitService.stop();

        const res = await transmitService.transmit({
            frame: validFrame,
            sourceKind: 'LITERAL'
        });

        expect(res).to.be.false;
        expect(sentFrames).to.have.lengthOf(0);
    });

    it('should enforce the rolling FPS limit before parallel callers reach the adapter', async () => {
        transmitService.setSessionConfig({ ...sessionConfig, maxFps: 2 }, eventBus);
        transmitService.setAdapter(mockAdapter);
        transmitService.setState('RUNNING');

        const results = await Promise.all([
            transmitService.transmit({ frame: validFrame, sourceKind: 'LITERAL' }),
            transmitService.transmit({ frame: validFrame, sourceKind: 'LITERAL' }),
            transmitService.transmit({ frame: validFrame, sourceKind: 'LITERAL' })
        ]);

        expect(results.filter(Boolean)).to.have.lengthOf(2);
        expect(sentFrames).to.have.lengthOf(2);
    });
});
