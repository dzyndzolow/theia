// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as net from 'net';
import { IByteTransport } from './esp32-can-session';

export class Esp32CanTcpTransport implements IByteTransport {
    private socket?: net.Socket;
    private onDataCallback?: (chunk: Uint8Array) => void;

    constructor(private readonly host: string, private readonly port: number = 9751) {}

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
                resolve();
            });

            this.socket.on('data', (data: Buffer) => {
                if (this.onDataCallback) {
                    this.onDataCallback(new Uint8Array(data.buffer, data.byteOffset, data.length));
                }
            });

            this.socket.on('error', err => {
                reject(err);
            });
        });
    }

    send(data: Uint8Array): void {
        if (this.socket && !this.socket.destroyed) {
            this.socket.write(Buffer.from(data.buffer, data.byteOffset, data.length));
        }
    }

    onData(callback: (chunk: Uint8Array) => void): void {
        this.onDataCallback = callback;
    }

    close(): void {
        if (this.socket) {
            this.socket.destroy();
            this.socket = undefined;
        }
    }
}
