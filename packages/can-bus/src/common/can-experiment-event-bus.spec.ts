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
import { StateChangeEvent, FeedbackEvent, ExperimentEvent } from './can-experiment-protocol';

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
});
