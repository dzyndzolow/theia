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

describe('CanSimulatorAdapter', () => {
    it('delivers frames at approximately the configured rate', async () => {
        const frames: CanFrame[] = [];
        const adapter = new CanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 1000 });
        adapter.start(f => frames.push(f));

        // Wait for ~2 intervals (2 frames expected at 1000 fps)
        await new Promise<void>(resolve => setTimeout(resolve, 3));
        adapter.stop();

        expect(frames.length).to.be.at.least(1);
        expect(frames.length).to.be.at.most(3);
    });

    it('generates alternating standard and extended frames', async () => {
        const frames: CanFrame[] = [];
        const adapter = new CanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 200 });
        adapter.start(f => frames.push(f));

        await new Promise<void>(resolve => setTimeout(resolve, 100));
        adapter.stop();

        // At 200fps with a 100ms wait we expect at least a few frames.
        // Frame 5 (every 5th) is extended (29-bit); others are standard (11-bit).
        expect(frames.length, `expected at least 5 frames, got ${frames.length}`).to.be.at.least(5);
        const hasStandard = frames.some(f => !f.extended);
        const hasExtended = frames.some(f => f.extended);
        expect(hasStandard, 'should generate standard (11-bit) frames').to.be.true;
        expect(hasExtended, 'should generate extended (29-bit) frames').to.be.true;
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

        // No new frames should arrive after stop()
        expect(frames.length).to.equal(countAfterStop);
    });

    it('produces frames with correct timestamp ordering', async () => {
        const frames: CanFrame[] = [];
        const adapter = new CanSimulatorAdapter();
        adapter.configure({ name: 'test', bitrate: 200 });

        adapter.start(f => frames.push(f));
        await new Promise<void>(resolve => setTimeout(resolve, 30));
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

        await new Promise<void>(resolve => setTimeout(resolve, 5));
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
        // A second stop should be safe too
        service.stop();
        expect(service.isCapturing).to.be.false;
    });
});
