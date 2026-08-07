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
import { CanFrame, CanInterfaceConfig, CanStatistics, CanBinaryDecoder } from '../common/can-protocol';
import { Emitter } from '@theia/core/lib/common';

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
        await service.startCapture({ name: 'can0', bitrate: 500000 });
        expect(started).to.be.true;
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
    });

    it('cleans up DisposableCollection on dispose', () => {
        const service = new CanRpcServiceImpl(mockSocket);
        service.setClient({ onDidCloseConnection: () => undefined });
        expect(() => service.dispose()).to.not.throw();
    });

    it('does not stop other clients when one client disconnects', () => {
        const service = new CanRpcServiceImpl(mockSocket);
        let firstClosed = false;

        const firstClient = { onDidCloseConnection: () => { firstClosed = true; } };
        const secondClient = { onDidCloseConnection: () => undefined };

        service.setClient(firstClient);
        service.setClient(secondClient);

        // Simulate first client disconnecting
        if (firstClient.onDidCloseConnection) {
            firstClient.onDidCloseConnection();
        }

        // Second client should still be registered
        expect((service as any).clients.has(secondClient)).to.be.true;
        expect((service as any).clients.has(firstClient)).to.be.false;
        expect(firstClosed).to.be.true;
    });

    it('clears all clients and interfaces on full dispose', () => {
        const service = new CanRpcServiceImpl(mockSocket);
        service.setClient({});
        service.setClient({});
        service.startCapture({ name: 'demo', bitrate: 100 });
        service.dispose();
        expect((service as any).clients.size).to.equal(0);
        expect((service as any).activeInterfaces.size).to.equal(0);
    });

    it('flushes binary chunks to client onBinaryFrames callback', async () => {
        let receivedChunk: ArrayBuffer | undefined;

        const service = new CanRpcServiceImpl(mockSocket);
        service.setClient({
            onBinaryFrames: (chunk: ArrayBuffer) => {
                receivedChunk = chunk;
            }
        });

        await service.startCapture({ name: 'can0', bitrate: 500000 });
        mockFrameEmitter.fire({
            id: 0x123, extended: false, rtr: false, dlc: 2, data: [1, 2], timestamp: 10, interface: 'can0'
        });

        await service.stopCapture();
        expect(receivedChunk).to.be.instanceOf(ArrayBuffer);
    });

    it('tracks droppedFrames when no client onBinaryFrames handler is attached', async () => {
        const service = new CanRpcServiceImpl(mockSocket);
        await service.startCapture({ name: 'can0', bitrate: 500000 });

        mockFrameEmitter.fire({
            id: 0x123, extended: false, rtr: false, dlc: 2, data: [1, 2], timestamp: 10, interface: 'can0'
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

        // Two concurrent captures (demo + demo2) must both reach the client.
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
});
