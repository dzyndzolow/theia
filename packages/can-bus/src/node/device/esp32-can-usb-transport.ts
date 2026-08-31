// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { IByteTransport } from './esp32-can-session';
import { cobsDecode, cobsEncode } from '../../common/esp32-can-device-protocol';

export interface ISerialPortLike {
    write(data: Uint8Array): void;
    on(event: 'data', listener: (chunk: Buffer) => void): void;
    close(callback?: (err?: Error) => void): void;
}

export class Esp32CanUsbTransport implements IByteTransport {
    private onDataCallback?: (chunk: Uint8Array) => void;
    private rawBuffer: number[] = [];

    constructor(private readonly serialPort: ISerialPortLike) {
        this.serialPort.on('data', (chunk: Buffer) => {
            this.handleSerialChunk(chunk);
        });
    }

    send(data: Uint8Array): void {
        const encoded = cobsEncode(data);
        const framed = new Uint8Array(encoded.length + 1);
        framed.set(encoded, 0);
        framed[encoded.length] = 0x00; // 0x00 packet delimiter
        this.serialPort.write(framed);
    }

    onData(callback: (chunk: Uint8Array) => void): void {
        this.onDataCallback = callback;
    }

    private handleSerialChunk(chunk: Buffer): void {
        for (let i = 0; i < chunk.length; i++) {
            const byte = chunk[i];
            if (byte === 0x00) {
                if (this.rawBuffer.length > 0) {
                    try {
                        const packet = new Uint8Array(this.rawBuffer);
                        const decoded = cobsDecode(packet);
                        if (this.onDataCallback) {
                            this.onDataCallback(decoded);
                        }
                    } catch {
                        /* corrupted packet dropped */
                    }
                    this.rawBuffer = [];
                }
            } else {
                this.rawBuffer.push(byte);
            }
        }
    }

    close(): void {
        this.serialPort.close();
    }
}
