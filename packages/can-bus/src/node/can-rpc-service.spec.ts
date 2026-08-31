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
import { CanRpcServiceImpl } from './can-rpc-service';
import { CanSocketServiceImpl, ICanSocketService } from './can-socket-service';
import { CanFrame, CanInterfaceConfig, CanStatistics, CanBinaryDecoder, CanRpcClient } from '../common/can-protocol';
import { Emitter } from '@theia/core/lib/common';
import { CanTransmitServiceImpl } from './can-transmit-service';

class TestableCanRpcService extends CanRpcServiceImpl {
    public hasClient(client: CanRpcClient): boolean {
        return this.clients.has(client);
    }

    public get activeInterfaceCount(): number {
        return this.activeInterfaces.size;
    }

    public get clientCount(): number {
        return this.clients.size;
    }
}

describe('CanRpcServiceImpl', () => {
    let mockSocket: ICanSocketService;
    let mockFrameEmitter: Emitter<CanFrame>;

    beforeEach(() => {
        mockFrameEmitter = new Emitter<CanFrame>();
        const statsEmitter = new Emitter<CanStatistics>();
        const errorEmitter = new Emitter<Error>();
        const statusEmitter = new Emitter<boolean>();

        mockSocket = {
            onFrameReceived: mockFrameEmitter.event,
            onStatisticsUpdated: statsEmitter.event,
            onError: errorEmitter.event,
            onStatusChanged: statusEmitter.event,
            isCapturing: false,
            start: () => undefined,
            stop: () => undefined,
            getStatistics: () => ({
                totalFrames: 42, framesPerSecond: 100, errors: 0, busLoad: 5, startTime: Date.now()
            })
        };
    });

    it('delegates startCapture to socket service', async () => {
        let started = false;
        mockSocket.start = (_config: CanInterfaceConfig) => { started = true; };

        const service = new CanRpcServiceImpl(mockSocket);
        await service.startCapture({ name: 'demo', bitrate: 500000 });
        expect(started).to.be.true;
    });

    it('rejects unknown virtual interface names instead of allocating unbounded simulators', async () => {
        const service = new CanRpcServiceImpl(mockSocket);
        let rejected = false;
        try {
            await service.startCapture({ name: 'attacker-created-interface', bitrate: 500000 });
        } catch {
            rejected = true;
        }
        expect(rejected).to.be.true;
    });

    it('delegates stopCapture to socket service', async () => {
        let stopped = false;
        mockSocket.stop = () => { stopped = true; };

        const service = new CanRpcServiceImpl(mockSocket);
        await service.stopCapture();
        expect(stopped).to.be.true;
    });

    it('delegates getStatistics to socket service', async () => {
        const service = new CanRpcServiceImpl(mockSocket);
        const stats = await service.getStatistics();
        expect(stats.totalFrames).to.equal(42);
        expect(stats.framesPerSecond).to.equal(100);
        expect(stats.errors).to.equal(0);
        expect(stats.busLoad).to.equal(5);
        expect(stats.droppedFrames).to.equal(0);
    });

    it('registers and unregisters clients via setClient and removeClient', () => {
        const service = new TestableCanRpcService(mockSocket);
        const client1: CanRpcClient = {};
        const client2: CanRpcClient = {};

        service.setClient(client1);
        expect(service.hasClient(client1)).to.be.true;
        expect(service.clientCount).to.equal(1);

        service.setClient(client2);
        expect(service.hasClient(client2)).to.be.true;
        expect(service.clientCount).to.equal(2);

        service.removeClient(client1);
        expect(service.hasClient(client1)).to.be.false;
        expect(service.clientCount).to.equal(1);

        service.removeClient(client2);
        expect(service.hasClient(client2)).to.be.false;
        expect(service.clientCount).to.equal(0);
    });

    it('automatically unregisters client when onDidCloseConnection fires', () => {
        const service = new TestableCanRpcService(mockSocket);
        let closeCallback: (() => void) | undefined;
        const client: CanRpcClient = {
            onDidCloseConnection: () => {
                if (closeCallback) { closeCallback(); }
            }
        };

        service.setClient(client);
        expect(service.hasClient(client)).to.be.true;

        if (client.onDidCloseConnection) {
            client.onDidCloseConnection();
        }

        expect(service.hasClient(client)).to.be.false;
        expect(service.clientCount).to.equal(0);
    });

    it('stops capture and batching when the last client disconnects', async () => {
        let stopCalled = false;
        mockSocket.stop = () => { stopCalled = true; };

        const service = new TestableCanRpcService(mockSocket);
        const client: CanRpcClient = {};

        service.setClient(client);
        await service.startCapture({ name: 'demo', bitrate: 500000 });
        expect(service.activeInterfaceCount).to.equal(1);

        service.removeClient(client);
        expect(stopCalled).to.be.true;
        expect(service.activeInterfaceCount).to.equal(0);
    });

    it('flushes binary chunks to client onBinaryFrames callback', async () => {
        let receivedChunk: ArrayBuffer | undefined;

        const service = new CanRpcServiceImpl(mockSocket);
        service.setClient({
            onBinaryFrames: (chunk: ArrayBuffer) => {
                receivedChunk = chunk;
            }
        });

        await service.startCapture({ name: 'demo', bitrate: 500000 });
        mockFrameEmitter.fire({
            id: 0x123, extended: false, rtr: false, dlc: 2, data: [1, 2], timestamp: 10, interface: 'demo'
        });

        await new Promise<void>(resolve => setTimeout(resolve, 80));
        await service.stopCapture();
        expect(receivedChunk).to.be.instanceOf(ArrayBuffer);
    });

    it('tracks droppedFrames when no client onBinaryFrames handler is attached', async () => {
        const service = new CanRpcServiceImpl(mockSocket);
        await service.startCapture({ name: 'demo', bitrate: 500000 });

        mockFrameEmitter.fire({
            id: 0x123, extended: false, rtr: false, dlc: 2, data: [1, 2], timestamp: 10, interface: 'demo'
        });

        await service.stopCapture();
        const stats = await service.getStatistics();
        expect(stats.droppedFrames).to.equal(1);
    });

    it('streams frames from all active interfaces to its RPC client', async () => {
        const socket = new CanSocketServiceImpl();
        const service = new CanRpcServiceImpl(socket);
        const receivedChunks: ArrayBuffer[] = [];
        service.setClient({ onBinaryFrames: chunk => receivedChunks.push(chunk) });

        await service.startCapture({ name: 'demo', bitrate: 100, frameRate: 100 });
        await service.startCapture({ name: 'demo2', bitrate: 100, frameRate: 100 });
        await new Promise<void>(resolve => setTimeout(resolve, 80));

        const interfaces = new Set<string>();
        for (const chunk of receivedChunks) {
            CanBinaryDecoder.decodeBatch(chunk, frame => interfaces.add(frame.interface));
        }

        await service.stopCapture();
        expect(interfaces.has('demo')).to.equal(true);
        expect(interfaces.has('demo2')).to.equal(true);
    });

    it('stops only the given interface on stopCapture', async () => {
        const socket = new CanSocketServiceImpl();
        const service = new CanRpcServiceImpl(socket);
        const interfacesAfterStop = new Set<string>();
        service.setClient({
            onBinaryFrames: chunk => {
                CanBinaryDecoder.decodeBatch(chunk, frame => interfacesAfterStop.add(frame.interface));
            }
        });

        await service.startCapture({ name: 'demo', bitrate: 100, frameRate: 100 });
        await service.startCapture({ name: 'demo2', bitrate: 100, frameRate: 100 });
        await service.stopCapture('demo');
        interfacesAfterStop.clear();
        await new Promise<void>(resolve => setTimeout(resolve, 80));

        expect(interfacesAfterStop.has('demo')).to.equal(false);
        expect(interfacesAfterStop.has('demo2')).to.equal(true);

        await service.stopCapture();
    });

    it('does not stop running interfaces when stopCapture is called with empty string', async () => {
        const socket = new CanSocketServiceImpl();
        const service = new CanRpcServiceImpl(socket);
        const interfaces = new Set<string>();
        service.setClient({
            onBinaryFrames: chunk => {
                CanBinaryDecoder.decodeBatch(chunk, frame => interfaces.add(frame.interface));
            }
        });

        await service.startCapture({ name: 'demo', bitrate: 100, frameRate: 100 });
        await service.stopCapture('');
        interfaces.clear();
        await new Promise<void>(resolve => setTimeout(resolve, 80));

        expect(interfaces.has('demo')).to.equal(true);
        await service.stopCapture();
    });

    it('returns virtual and hardware interfaces from getAvailableInterfaces', async () => {
        const service = new CanRpcServiceImpl(mockSocket);
        const ifaces = await service.getAvailableInterfaces();
        expect(ifaces.length).to.be.at.least(3);
        expect(ifaces.some(i => i.id === 'demo')).to.be.true;
        expect(ifaces.some(i => i.id === 'demo2')).to.be.true;
        expect(ifaces.some(i => i.id === 'sim0')).to.be.true;
    });

    it('transmits frame and echoes it to binary clients via sendFrame', async () => {
        const transmitService = new CanTransmitServiceImpl();
        const service = new CanRpcServiceImpl(mockSocket, undefined, undefined, transmitService);
        const receivedFrames: CanFrame[] = [];
        service.setClient({
            onBinaryFrames: chunk => {
                CanBinaryDecoder.decodeBatch(chunk, f => receivedFrames.push(f));
            }
        });

        await service.startCapture({ name: 'demo', bitrate: 500000 });
        await service.armTransmit({
            interfaceName: 'demo',
            allowedIds: [0x321],
            allowExtendedIds: false,
            maxFps: 100,
            maxBusLoadPercent: 50,
            maxDurationMs: 10_000
        });
        const sent = await service.sendFrame({
            id: 0x321,
            extended: false,
            rtr: false,
            dlc: 4,
            data: [10, 20, 30, 40],
            timestamp: 100,
            interface: 'demo'
        });

        expect(sent).to.be.true;
        await new Promise(r => setTimeout(r, 80));
        await service.stopCapture();

        expect(receivedFrames.some(f => f.id === 0x321)).to.be.true;
    });

    it('fails closed before ARM and rejects a frame outside the armed allowlist', async () => {
        const transmitService = new CanTransmitServiceImpl();
        const service = new CanRpcServiceImpl(mockSocket, undefined, undefined, transmitService);
        const frame: CanFrame = {
            id: 0x321,
            extended: false,
            rtr: false,
            dlc: 1,
            data: [0x55],
            timestamp: 100,
            interface: 'demo'
        };

        await service.startCapture({ name: 'demo', bitrate: 500000 });
        expect(await service.sendFrame(frame)).to.be.false;
        await service.armTransmit({
            interfaceName: 'demo',
            allowedIds: [0x123],
            allowExtendedIds: false,
            maxFps: 100,
            maxBusLoadPercent: 50,
            maxDurationMs: 10_000
        });
        expect(await service.sendFrame(frame)).to.be.false;
        await service.stopCapture();
    });

    it('stops capture and flushes batches upon emergencyStop', async () => {
        let stopCalled = false;
        mockSocket.stop = () => { stopCalled = true; };

        const service = new CanRpcServiceImpl(mockSocket);
        await service.startCapture({ name: 'demo', bitrate: 500000 });
        await service.emergencyStop();

        expect(stopCalled).to.be.true;
    });
});
