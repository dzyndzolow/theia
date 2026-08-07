// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from '../common/can-protocol';
import { PayloadSelection } from './frame-payload-inspector';

type FieldType = 'UINT8' | 'INT8' | 'UINT16' | 'INT16' | 'UINT32' | 'INT32' | 'FLOAT32' | 'FLOAT64' | 'ASCII';

/** Converts a selected, read-only range of a CAN payload to a primitive value. */
export class TypedFieldDecoder {
    readonly node: HTMLDivElement;
    protected readonly typeSelect: HTMLSelectElement;
    protected readonly endianSelect: HTMLSelectElement;
    protected readonly result: HTMLOutputElement;
    protected frame: CanFrame | undefined;
    protected selection: PayloadSelection = { startByte: 0, byteLength: 1 };

    constructor() {
        this.node = document.createElement('div');
        this.node.className = 'can-typed-field-decoder';
        const title = document.createElement('h3');
        title.textContent = 'Typed Field Decoder';
        this.typeSelect = document.createElement('select');
        this.typeSelect.className = 'theia-select';
        for (const type of ['UINT8', 'INT8', 'UINT16', 'INT16', 'UINT32', 'INT32', 'FLOAT32', 'FLOAT64', 'ASCII'] as FieldType[]) {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            this.typeSelect.appendChild(option);
        }
        this.endianSelect = document.createElement('select');
        this.endianSelect.className = 'theia-select';
        for (const [value, label] of [['little', 'Little endian'], ['big', 'Big endian']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.endianSelect.appendChild(option);
        }
        this.result = document.createElement('output');
        this.result.className = 'can-typed-field-value';
        this.typeSelect.onchange = () => this.render();
        this.endianSelect.onchange = () => this.render();
        this.node.append(title, this.typeSelect, this.endianSelect, this.result);
        this.render();
    }

    public setFrame(frame: CanFrame | undefined): void {
        this.frame = frame;
        this.render();
    }

    public setSelection(selection: PayloadSelection): void {
        this.selection = selection;
        this.render();
    }

    protected render(): void {
        if (!this.frame || this.frame.data.length === 0) {
            this.result.textContent = 'Select a frame and byte';
            return;
        }
        const type = this.typeSelect.value as FieldType;
        const requiredBytes = TypedFieldDecoder.requiredBytes(type);
        const startByte = this.selection.startByte;
        if (startByte + requiredBytes > this.frame.data.length) {
            this.result.textContent = `${type} needs ${requiredBytes} bytes from byte ${startByte}`;
            return;
        }
        const source = new Uint8Array(this.frame.data.slice(startByte, startByte + requiredBytes));
        const value = TypedFieldDecoder.decode(source, type, this.endianSelect.value === 'little');
        this.result.textContent = `Byte ${startByte} · ${type}: ${String(value)}`;
    }

    protected static requiredBytes(type: FieldType): number {
        switch (type) {
            case 'UINT16': case 'INT16': return 2;
            case 'UINT32': case 'INT32': case 'FLOAT32': return 4;
            case 'FLOAT64': return 8;
            default: return 1;
        }
    }

    protected static decode(bytes: Uint8Array, type: FieldType, littleEndian: boolean): number | string {
        if (type === 'ASCII') {
            return String.fromCharCode(...bytes);
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        switch (type) {
            case 'UINT8': return view.getUint8(0);
            case 'INT8': return view.getInt8(0);
            case 'UINT16': return view.getUint16(0, littleEndian);
            case 'INT16': return view.getInt16(0, littleEndian);
            case 'UINT32': return view.getUint32(0, littleEndian);
            case 'INT32': return view.getInt32(0, littleEndian);
            case 'FLOAT32': return view.getFloat32(0, littleEndian);
            case 'FLOAT64': return view.getFloat64(0, littleEndian);
            default: return '';
        }
    }
}
