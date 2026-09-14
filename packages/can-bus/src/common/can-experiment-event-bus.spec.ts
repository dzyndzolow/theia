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
import { CanExperimentEventBus, ExperimentJournal } from './can-experiment-event-bus';
import { StateChangeEvent, FeedbackEvent, ExperimentEvent, GapEvent } from './can-experiment-protocol';

describe('SA-410: CanExperimentEventBus & ExperimentJournal', () => {
    let bus: CanExperimentEventBus;

    beforeEach(() => {
        bus = new CanExperimentEventBus();
    });

    afterEach(() => {
        bus.dispose();
    });

    it('should append events to journal and notify listeners monotonically', () => {
        const received: ExperimentEvent[] = [];
        bus.onEvent(e => received.push(e));

        const stateEvt: StateChangeEvent = {
            eventId: 'evt-1',
            sessionId: 'ses-1',
            timestampMonotonicNs: 1000n,
            wallClockIso: '2026-08-28T09:00:00.000Z',
            type: 'STATE_CHANGE',
            previousState: 'DISARMED',
            newState: 'ARMED',
            reason: 'User armed session'
        };

        const feedbackEvt: FeedbackEvent = {
            eventId: 'evt-2',
            sessionId: 'ses-1',
            timestampMonotonicNs: 2000n,
            wallClockIso: '2026-08-28T09:00:00.001Z',
            type: 'FEEDBACK',
            kind: 'POSITIVE',
            feedbackType: 'WAKE',
            source: 'HUMAN'
        };

        bus.publish(stateEvt);
        bus.publish(feedbackEvt);

        expect(received).to.have.lengthOf(2);
        expect(received[0].type).to.equal('STATE_CHANGE');
        expect(received[1].type).to.equal('FEEDBACK');

        const journal = bus.getJournal();
        expect(journal.size()).to.equal(2);
        expect(journal.filterByType('FEEDBACK')).to.have.lengthOf(1);
    });

    it('should throw error on non-monotonic timestamp append', () => {
        const journal = new ExperimentJournal();
        journal.append({
            eventId: 'evt-1',
            sessionId: 'ses-1',
            timestampMonotonicNs: 5000n,
            wallClockIso: '2026-08-28T09:00:00.000Z',
            type: 'STATE_CHANGE',
            previousState: 'DISARMED',
            newState: 'ARMED',
            reason: 'test'
        });

        expect(() => {
            journal.append({
                eventId: 'evt-2',
                sessionId: 'ses-1',
                timestampMonotonicNs: 4000n, // Non-monotonic
                wallClockIso: '2026-08-28T09:00:00.000Z',
                type: 'STATE_CHANGE',
                previousState: 'ARMED',
                newState: 'RUNNING',
                reason: 'test'
            });
        }).to.throw(/Non-monotonic/);
    });

    it('should correctly query time ranges', () => {
        const journal = new ExperimentJournal();
        for (let i = 1; i <= 5; i++) {
            journal.append({
                eventId: `evt-${i}`,
                sessionId: 'ses-1',
                timestampMonotonicNs: BigInt(i * 1000),
                wallClockIso: '2026-08-28T09:00:00.000Z',
                type: 'STATE_CHANGE',
                previousState: 'DISARMED',
                newState: 'ARMED',
                reason: `step ${i}`
            });
        }

        const subset = journal.queryTimeRange(2000n, 4000n);
        expect(subset).to.have.lengthOf(3);
        expect(subset.map(e => e.eventId)).to.deep.equal(['evt-2', 'evt-3', 'evt-4']);
    });

    it('aggregates interleaved gaps by stable eventId and emits onEvent only on creation', () => {
        const eventsFired: ExperimentEvent[] = [];
        bus.onEvent(e => eventsFired.push(e));

        // Gap A - first occurrence
        bus.recordGap({
            eventId: 'gap:phase-a',
            sessionId: 'ses-1',
            timestampMonotonicNs: 1000n,
            wallClockIso: '2026-08-28T09:00:00.000Z',
            type: 'GAP',
            droppedCount: 5,
            reason: 'Loss in phase A'
        });

        // Gap B - first occurrence (interleaved)
        bus.recordGap({
            eventId: 'gap:phase-b',
            sessionId: 'ses-1',
            timestampMonotonicNs: 1100n,
            wallClockIso: '2026-08-28T09:00:00.100Z',
            type: 'GAP',
            droppedCount: 2,
            reason: 'Loss in phase B'
        });

        // Gap A - second occurrence (interleaved after Gap B)
        bus.recordGap({
            eventId: 'gap:phase-a',
            sessionId: 'ses-1',
            timestampMonotonicNs: 1200n,
            wallClockIso: '2026-08-28T09:00:00.200Z',
            type: 'GAP',
            droppedCount: 3,
            reason: 'Loss in phase A'
        });

        // Gap B - second occurrence
        bus.recordGap({
            eventId: 'gap:phase-b',
            sessionId: 'ses-1',
            timestampMonotonicNs: 1300n,
            wallClockIso: '2026-08-28T09:00:00.300Z',
            type: 'GAP',
            droppedCount: 7,
            reason: 'Loss in phase B'
        });

        // Check that only 2 events were fired to listeners (1 for A, 1 for B)
        expect(eventsFired).to.have.lengthOf(2);
        expect(eventsFired[0].eventId).to.equal('gap:phase-a');
        expect(eventsFired[1].eventId).to.equal('gap:phase-b');

        // Check journal aggregation
        const journal = bus.getJournal();
        expect(journal.getGapEventCount()).to.equal(2);

        const allGaps = journal.filterByType<GapEvent>('GAP');
        expect(allGaps).to.have.lengthOf(2);

        const foundA = allGaps.find(g => g.eventId === 'gap:phase-a');
        const foundB = allGaps.find(g => g.eventId === 'gap:phase-b');

        expect(foundA).to.not.be.undefined;
        expect(foundA!.droppedCount).to.equal(8); // 5 + 3
        expect(foundA!.timestampMonotonicNs).to.equal(1200n);

        expect(foundB).to.not.be.undefined;
        expect(foundB!.droppedCount).to.equal(9); // 2 + 7
        expect(foundB!.timestampMonotonicNs).to.equal(1300n);
    });
});
