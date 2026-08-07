// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
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
import { Container } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import { CanRpcClient } from './can-rpc-client';
import { CanRpc, canServicePath } from '../common/can-protocol';

interface MockProvider {
    calls: string[];
    proxy: CanRpc & { client?: { onBinaryFrames?: (chunk: ArrayBuffer) => void } };
}

function createClient(): { client: CanRpcClient; provider: MockProvider } {
    const provider: MockProvider = {
        calls: [],
        proxy: {
            startCapture: async () => undefined,
            stopCapture: async () => undefined,
            getStatistics: async () => ({ totalFrames: 0, framesPerSecond: 0, errors: 0, busLoad: 0, startTime: Date.now() })
        }
    };
    const container = new Container();
    container.bind(WebSocketConnectionProvider).toConstantValue({
        createProxy: (path: string, target: object) => {
            provider.calls.push(path);
            provider.proxy.client = target;
            return provider.proxy;
        }
    } as never);
    container.bind(CanRpcClient).toSelf().inSingletonScope();
    return { client: container.get(CanRpcClient), provider };
}

describe('CanRpcClient', () => {

    it('creates exactly one proxy for the CAN service path, shared by all callers', async () => {
        const { client, provider } = createClient();

        await client.startCapture({ name: 'demo', bitrate: 500000, frameRate: 1000 });
        await client.stopCapture();
        await client.getStatistics();

        expect(provider.calls.length).to.equal(1);
        expect(provider.calls[0]).to.equal(canServicePath);
    });

    it('forwards binary frames to all subscribers', async () => {
        const { client, provider } = createClient();

        const received: number[] = [];
        client.onBinaryFrames(c => received.push(c.byteLength));

        await client.getStatistics(); // trigger lazy proxy creation
        const chunk = new ArrayBuffer(4);
        provider.proxy.client!.onBinaryFrames!(chunk);

        expect(received).to.deep.equal([4]);
    });
});
