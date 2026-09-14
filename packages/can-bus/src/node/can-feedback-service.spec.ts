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
import { GapEvent } from '../common/can-experiment-protocol';

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

    it('bounds baselineMap and activeMap to MAX_TRACKED_IDS with LRU eviction', () => {
        const { MAX_FEEDBACK_TRACKED_IDS } = require('./can-feedback-service');
        const emittedGapIds: string[] = [];
        eventBus.onEvent(event => {
            if (event.type === 'GAP') {
                emittedGapIds.push(event.eventId);
            }
        });
        feedbackService.startBaseline();

        // Feed MAX_FEEDBACK_TRACKED_IDS + 50 distinct IDs during baseline
        for (let i = 0; i < MAX_FEEDBACK_TRACKED_IDS + 50; i++) {
            feedbackService.processRxFrame({
                id: i,
                extended: false,
                rtr: false,
                dlc: 1,
                data: [0],
                timestamp: 1000 + i,
                interface: 'vcan0'
            }, false);
        }

        expect(feedbackService.getTrackedCounts().baseline).to.equal(MAX_FEEDBACK_TRACKED_IDS);
        const baselineStats = feedbackService.getBaselineStats();
        expect(baselineStats.size).to.equal(MAX_FEEDBACK_TRACKED_IDS);
        // Earliest IDs (0..49) should have been evicted
        expect(baselineStats.has(0)).to.be.false;
        expect(baselineStats.has(49)).to.be.false;
        // Latest IDs should exist
        expect(baselineStats.has(MAX_FEEDBACK_TRACKED_IDS + 49)).to.be.true;

        feedbackService.freezeBaseline();

        // Feed MAX_FEEDBACK_TRACKED_IDS + 50 distinct IDs during active phase
        for (let i = 0; i < MAX_FEEDBACK_TRACKED_IDS + 50; i++) {
            feedbackService.processRxFrame({
                id: 100_000 + i,
                extended: true,
                rtr: false,
                dlc: 1,
                data: [1],
                timestamp: 2000 + i,
                interface: 'vcan0'
            }, false);
        }

        expect(feedbackService.getTrackedCounts().active).to.equal(MAX_FEEDBACK_TRACKED_IDS);

        const diag = feedbackService.getDiagnostics!();
        expect(diag.completeness).to.equal('DEGRADED');
        expect(diag.baselineDroppedCount).to.equal(50);
        expect(diag.activeDroppedCount).to.equal(50);

        // Crucial regression test: evicted baseline ID 0 must NOT trigger false RX_DELTA when re-appearing
        const fbEvicted = feedbackService.processRxFrame({
            id: 0,
            extended: false,
            rtr: false,
            dlc: 1,
            data: [0],
            timestamp: 3000,
            interface: 'vcan0'
        }, false);
        expect(fbEvicted).to.be.undefined;

        // Evicted active ID 100_000 must NOT trigger a second RX_DELTA
        const fbEvictedActive = feedbackService.processRxFrame({
            id: 100_000,
            extended: true,
            rtr: false,
            dlc: 1,
            data: [1],
            timestamp: 3001,
            interface: 'vcan0'
        }, false);
        expect(fbEvictedActive).to.be.undefined;

        // Verify that GAP events were recorded with stable eventIds and aggregated dropped counts
        const journal = eventBus.getJournal();
        const gaps = journal.filterByType<GapEvent>('GAP');
        expect(gaps).to.have.lengthOf(2);

        const baselineGap = gaps.find(g => g.eventId === 'gap:feedback:baseline:session-fb-test:cycle-1');
        const activeGap = gaps.find(g => g.eventId === 'gap:feedback:active:session-fb-test:cycle-1');

        expect(baselineGap).to.not.be.undefined;
        expect(baselineGap!.droppedCount).to.equal(50);

        expect(activeGap).to.not.be.undefined;
        expect(activeGap!.droppedCount).to.equal(52);

        // Reset via startBaseline restores COMPLETE state and 0 dropped counts
        feedbackService.startBaseline();
        const resetDiag = feedbackService.getDiagnostics!();
        expect(resetDiag.completeness).to.equal('COMPLETE');
        expect(resetDiag.baselineDroppedCount).to.equal(0);
        expect(resetDiag.activeDroppedCount).to.equal(0);

        // A new baseline attempt in the same session must create and emit a new GAP,
        // rather than silently merging its loss into the previous attempt.
        for (let i = 0; i < MAX_FEEDBACK_TRACKED_IDS + 1; i++) {
            feedbackService.processRxFrame({
                id: 200_000 + i,
                extended: true,
                rtr: false,
                dlc: 1,
                data: [2],
                timestamp: 4000 + i,
                interface: 'vcan0'
            }, false);
        }

        const secondCycleGapId = 'gap:feedback:baseline:session-fb-test:cycle-2';
        const gapsAfterRestart = journal.filterByType<GapEvent>('GAP');
        expect(gapsAfterRestart).to.have.lengthOf(3);
        expect(gapsAfterRestart.find(g => g.eventId === secondCycleGapId)?.droppedCount).to.equal(1);
        expect(emittedGapIds).to.deep.equal([
            'gap:feedback:baseline:session-fb-test:cycle-1',
            'gap:feedback:active:session-fb-test:cycle-1',
            secondCycleGapId
        ]);
    });
});
