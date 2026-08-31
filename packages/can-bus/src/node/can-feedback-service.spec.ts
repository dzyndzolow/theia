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
import { CanFeedbackServiceImpl } from './can-feedback-service';
import { CanExperimentEventBus } from '../common/can-experiment-event-bus';
import { CanFrame } from '../common/can-protocol';

describe('SA-412: CanFeedbackService', () => {
    let feedbackService: CanFeedbackServiceImpl;
    let eventBus: CanExperimentEventBus;

    beforeEach(() => {
        feedbackService = new CanFeedbackServiceImpl();
        eventBus = new CanExperimentEventBus();
        feedbackService.setEventBus(eventBus, 'session-fb-test');
    });

    afterEach(() => {
        feedbackService.dispose();
        eventBus.dispose();
    });

    it('should record manual feedback and publish to EventBus', () => {
        const fbEvent = feedbackService.recordManualFeedback({
            kind: 'POSITIVE',
            feedbackType: 'WAKE',
            confidence: 0.9,
            comment: 'Cluster backlight turned on'
        });

        expect(fbEvent.kind).to.equal('POSITIVE');
        expect(fbEvent.feedbackType).to.equal('WAKE');
        expect(fbEvent.source).to.equal('HUMAN');
        expect(fbEvent.comment).to.equal('Cluster backlight turned on');

        const journal = eventBus.getJournal();
        expect(journal.size()).to.equal(1);
        expect(journal.getAll()[0].type).to.equal('FEEDBACK');
    });

    it('should collect baseline traffic and detect new ID as automatic RX_DELTA', () => {
        feedbackService.startBaseline();

        // Baseline has traffic on 0x100 and 0x101
        const frame100: CanFrame = { id: 0x100, extended: false, rtr: false, dlc: 8, data: [1, 2, 3, 4, 5, 6, 7, 8], timestamp: 10, interface: 'vcan0' };
        const frame101: CanFrame = { id: 0x101, extended: false, rtr: false, dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], timestamp: 15, interface: 'vcan0' };

        feedbackService.processRxFrame(frame100, false);
        feedbackService.processRxFrame(frame101, false);

        feedbackService.freezeBaseline();
        const baselineStats = feedbackService.getBaselineStats();
        expect(baselineStats.has(0x100)).to.be.true;
        expect(baselineStats.has(0x101)).to.be.true;
        expect(baselineStats.has(0x200)).to.be.false;

        // Active frame on existing ID 0x100 -> no delta feedback
        const fbOld = feedbackService.processRxFrame(frame100, false);
        expect(fbOld).to.be.undefined;

        // Driver echo on new ID 0x200 -> MUST BE IGNORED
        const frame200: CanFrame = { id: 0x200, extended: false, rtr: false, dlc: 8, data: [0x55, 0xAA, 0, 0, 0, 0, 0, 0], timestamp: 25, interface: 'vcan0' };
        const fbEcho = feedbackService.processRxFrame(frame200, true);
        expect(fbEcho).to.be.undefined;

        // Genuine DUT response on new ID 0x200 -> RX_DELTA POSITIVE feedback emitted
        const fbNew = feedbackService.processRxFrame(frame200, false);
        expect(fbNew).to.not.be.undefined;
        expect(fbNew?.source).to.equal('RX_DELTA');
        expect(fbNew?.kind).to.equal('POSITIVE');
        expect(fbNew?.feedbackType).to.equal('CAN_ACTIVITY');

        const journal = eventBus.getJournal();
        expect(journal.size()).to.equal(1);
    });
});
