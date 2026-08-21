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
import { CaptureSession, InvalidStateException } from './capture-session';
import { SignalChannel } from './signal-channel';

describe('SA-104: CaptureSession State Machine & SignalChannel', () => {

    describe('SignalChannel', () => {
        it('should initialize channel with default and custom options', () => {
            const ch1 = new SignalChannel({ id: 'ch1', name: 'Channel 1' });
            expect(ch1.id).to.equal('ch1');
            expect(ch1.name).to.equal('Channel 1');
            expect(ch1.sampleRate).to.equal(1000000);
            expect(ch1.enabled).to.be.true;

            ch1.setSampleRate(500000);
            expect(ch1.sampleRate).to.equal(500000);

            expect(() => ch1.setSampleRate(0)).to.throw('Sample rate must be positive');

            ch1.setEnabled(false);
            expect(ch1.enabled).to.be.false;
        });
    });

    describe('CaptureSession State Machine', () => {
        let session: CaptureSession;

        beforeEach(() => {
            session = new CaptureSession('test-session');
        });

        afterEach(() => {
            session.dispose();
        });

        it('should follow legal state transitions: STOPPED -> CAPTURING -> PAUSED -> CAPTURING -> STOPPED', done => {
            expect(session.state).to.equal('STOPPED');

            let eventCount = 0;
            session.onStateChanged(e => {
                eventCount++;
                if (eventCount === 1) {
                    expect(e.previousState).to.equal('PAUSED');
                    expect(e.currentState).to.equal('STOPPED');
                    done();
                }
            });

            session.start();
            expect(session.state).to.equal('CAPTURING');

            session.pause();
            expect(session.state).to.equal('PAUSED');

            session.resume();
            expect(session.state).to.equal('CAPTURING');

            session.pause();
            session.stop();
            expect(session.state).to.equal('STOPPED');
        });

        it('should block illegal state transitions with InvalidStateException', () => {
            // From STOPPED
            expect(() => session.pause()).to.throw(InvalidStateException);
            expect(() => session.resume()).to.throw(InvalidStateException);
            expect(() => session.stop()).to.throw(InvalidStateException);

            session.start();
            // From CAPTURING
            expect(() => session.start()).to.throw(InvalidStateException);
            expect(() => session.resume()).to.throw(InvalidStateException);

            session.pause();
            // From PAUSED
            expect(() => session.start()).to.throw(InvalidStateException);
            expect(() => session.pause()).to.throw(InvalidStateException);
        });

        it('should manage channels in session correctly', () => {
            const ch1 = new SignalChannel({ id: 'ch1', name: 'CAN High' });
            const ch2 = new SignalChannel({ id: 'ch2', name: 'CAN Low' });

            session.addChannel(ch1);
            session.addChannel(ch2);

            expect(session.getChannels()).to.have.lengthOf(2);
            expect(session.getChannel('ch1')).to.equal(ch1);

            const removed = session.removeChannel('ch1');
            expect(removed).to.be.true;
            expect(session.getChannels()).to.have.lengthOf(1);
            expect(session.getChannel('ch1')).to.be.undefined;
        });

        it('should assign ordered session timestamps and keep replay timestamps unchanged', () => {
            session.start();
            const first = session.recordSample('ch1', 10);
            const second = session.recordSample('ch1', 11);

            expect(first.sequence).to.equal(0);
            expect(second.sequence).to.equal(1);
            expect(second.timestampNs >= first.timestampNs).to.be.true;
            expect(first.clockDomain).to.equal('session-monotonic');

            const replayed: bigint[] = [];
            session.replay([
                { ...first, timestampNs: 100n },
                { ...second, timestampNs: 250n }
            ], sample => replayed.push(sample.timestampNs));
            expect(replayed).to.deep.equal([100n, 250n]);
        });

        it('should exclude paused wall time from subsequent session timestamps', () => {
            session.start();
            const first = session.recordSample('ch1', 1);
            session.pause();
            expect(() => session.recordSample('ch1', 2)).to.throw(InvalidStateException);
            session.resume();
            const second = session.recordSample('ch1', 2);
            expect(second.timestampNs >= first.timestampNs).to.be.true;
        });

        it('should exclude paused wall time when stopping directly from pause', done => {
            let now = 100n;
            const sessionWithClock = session as unknown as { monotonicNowNs: () => bigint };
            sessionWithClock.monotonicNowNs = () => now;
            session.onStateChanged(event => {
                if (event.currentState !== 'STOPPED') {
                    return;
                }
                try {
                    expect(event.timestampNs).to.equal(50n);
                    done();
                } catch (error) {
                    done(error);
                }
            });

            session.start();
            now = 150n;
            session.pause();
            now = 1_000n;
            session.stop();
        });
    });
});
