// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from '../common/can-protocol';
import { PayloadSelection } from './frame-payload-inspector';

export type FieldType =
    | 'BIT'
    | 'BOOL'
    | 'UINT'
    | 'INT'
    | 'UINT8'
    | 'INT8'
    | 'UINT16'
    | 'INT16'
    | 'UINT32'
    | 'INT32'
    | 'FLOAT32'
    | 'FLOAT64'
    | 'ASCII';

export interface BindRequestEvent {
    readonly frame: CanFrame;
    readonly selection: PayloadSelection;
    readonly type: FieldType;
    readonly littleEndian: boolean;
    readonly divisor: number;
    readonly decodedValue: unknown;
}

/** Converts a selected range of bytes or bits of a CAN payload to a primitive value. */
export class TypedFieldDecoder {
    readonly node: HTMLDivElement;
    protected readonly typeSelect: HTMLSelectElement;
    protected readonly endianSelect: HTMLSelectElement;
    protected readonly divisorInput: HTMLInputElement;
    protected readonly result: HTMLOutputElement;
    protected frame: CanFrame | undefined;
    protected selection: PayloadSelection = { startByte: 0, byteLength: 1 };
    protected readonly changeListeners = new Set<() => void>();

    /** Register a listener called whenever type, endian, or selection changes. */
    public onSelectionChanged(listener: () => void): { dispose(): void } {
        this.changeListeners.add(listener);
        return { dispose: () => this.changeListeners.delete(listener) };
    }

    constructor() {
        this.node = document.createElement('div');
        this.node.className = 'can-typed-field-decoder';

        const title = document.createElement('h3');
        title.textContent = 'Typed Field Decoder';

        const controlsRow = document.createElement('div');
        controlsRow.className = 'can-typed-field-controls';

        this.typeSelect = document.createElement('select');
        this.typeSelect.className = 'theia-select';
        const types: FieldType[] = [
            'BIT', 'BOOL', 'UINT', 'INT', 'UINT8', 'INT8', 'UINT16', 'INT16',
            'UINT32', 'INT32', 'FLOAT32', 'FLOAT64', 'ASCII'
        ];
        for (const type of types) {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type === 'BIT'
                ? 'BIT (0/1 single bit)'
                : type === 'BOOL'
                    ? 'BOOL (TRUE/FALSE bit)'
                    : type === 'UINT' || type === 'INT'
                        ? `${type} (selected bytes)`
                        : type;
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

        const divisorLabel = document.createElement('label');
        divisorLabel.className = 'can-typed-field-divisor-label';
        divisorLabel.textContent = 'Divisor ';
        this.divisorInput = document.createElement('input');
        this.divisorInput.className = 'theia-input can-typed-field-divisor';
        this.divisorInput.type = 'number';
        this.divisorInput.min = '0.000000000001';
        this.divisorInput.step = 'any';
        this.divisorInput.value = '1';
        this.divisorInput.title = 'The decoded numeric value is divided by this number.';
        divisorLabel.appendChild(this.divisorInput);

        controlsRow.append(this.typeSelect, this.endianSelect, divisorLabel);

        this.result = document.createElement('output');
        this.result.className = 'can-typed-field-value';

        this.typeSelect.onchange = () => {
            this.normalizeSelectionLength();
            this.render();
            this.fireChanged();
        };
        this.endianSelect.onchange = () => { this.render(); this.fireChanged(); };
        this.divisorInput.oninput = () => { this.render(); this.fireChanged(); };

        this.node.append(title, controlsRow, this.result);
        this.render();
    }

    public setFrame(frame: CanFrame | undefined): void {
        this.frame = frame;
        this.render();
    }

    public setSelection(selection: PayloadSelection): void {
        this.selection = selection;
        if (selection.isBitSelection) {
            if (this.typeSelect.value !== 'BIT' && this.typeSelect.value !== 'BOOL') {
                this.typeSelect.value = 'BOOL';
            }
        }
        this.normalizeSelectionLength();
        this.render();
    }

    public getType(): FieldType {
        return this.typeSelect.value as FieldType;
    }

    public isLittleEndian(): boolean {
        return this.endianSelect.value === 'little';
    }

    public getDivisor(): number {
        return Number(this.divisorInput.value);
    }

    public getSelection(): PayloadSelection {
        return this.selection;
    }

    protected fireChanged(): void {
        for (const l of this.changeListeners) { l(); }
    }

    public getDecodedValue(): { raw: unknown; scaled: string; range: string; valid: boolean; hexRaw: string } {
        if (!this.frame || this.frame.data.length === 0) {
            return { raw: '', scaled: '', range: '', valid: false, hexRaw: '' };
        }
        const type = this.typeSelect.value as FieldType;
        const startByte = this.selection.startByte;
        const selectedLength = this.selection.byteLength;

        if (startByte >= this.frame.data.length) {
            return { raw: '', scaled: '', range: '', valid: false, hexRaw: '' };
        }

        // Bit or Bool Decoding
        if (type === 'BIT' || type === 'BOOL' || this.selection.isBitSelection) {
            const byteVal = this.frame.data[startByte];
            const startBit = this.selection.startBit ?? 0;
            const bitVal = (byteVal >> startBit) & 1;
            const bitRange = `Byte ${startByte}, Bit ${startBit}`;
            const bitHexRaw = `0x${byteVal.toString(16).padStart(2, '0').toUpperCase()} (b${startBit})`;

            if (type === 'BOOL') {
                const boolVal = bitVal === 1;
                return {
                    raw: boolVal,
                    scaled: boolVal ? 'TRUE (1)' : 'FALSE (0)',
                    range: bitRange,
                    valid: true,
                    hexRaw: bitHexRaw
                };
            }
            return {
                raw: bitVal,
                scaled: String(bitVal),
                range: bitRange,
                valid: true,
                hexRaw: bitHexRaw
            };
        }

        const requiredBytes = TypedFieldDecoder.requiredBytes(type);
        const range = selectedLength === 1 ? `Byte ${startByte}` : `Bytes ${startByte}-${startByte + selectedLength - 1}`;

        if (startByte + selectedLength > this.frame.data.length) {
            return { raw: '', scaled: '', range, valid: false, hexRaw: '' };
        }
        if (requiredBytes !== undefined && selectedLength !== requiredBytes) {
            return { raw: '', scaled: '', range, valid: false, hexRaw: '' };
        }
        if ((type === 'UINT' || type === 'INT') && selectedLength > 8) {
            return { raw: '', scaled: '', range, valid: false, hexRaw: '' };
        }
        const divisor = Number(this.divisorInput.value);
        if (!Number.isFinite(divisor) || divisor <= 0) {
            return { raw: '', scaled: '', range, valid: false, hexRaw: '' };
        }
        const source = new Uint8Array(this.frame.data.slice(startByte, startByte + selectedLength));
        const hexRaw = Array.from(source).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
        const value = TypedFieldDecoder.decode(source, type, this.endianSelect.value === 'little');
        if (typeof value === 'string') {
            return { raw: value, scaled: value, range, valid: true, hexRaw: `0x${hexRaw}` };
        }
        const raw = value;
        const scaled = Number(value) / divisor;
        return {
            raw,
            scaled: divisor === 1 ? String(raw) : `${raw} / ${divisor} = ${scaled}`,
            range,
            valid: true,
            hexRaw: `0x${hexRaw}`
        };
    }

    protected render(): void {
        if (!this.frame || this.frame.data.length === 0) {
            this.result.textContent = 'Select a frame and byte/bit range';
            return;
        }

        const type = this.typeSelect.value as FieldType;
        const startByte = this.selection.startByte;
        const selectedLength = this.selection.byteLength;
        const requiredBytes = TypedFieldDecoder.requiredBytes(type);

        if (type !== 'BIT' && type !== 'BOOL') {
            if (startByte + selectedLength > this.frame.data.length) {
                this.result.textContent = 'Selected field exceeds frame payload';
                return;
            }
            if (requiredBytes !== undefined && selectedLength !== requiredBytes) {
                this.result.textContent = `${type} requires a selection of exactly ${requiredBytes} bytes`;
                return;
            }
            if ((type === 'UINT' || type === 'INT') && selectedLength > 8) {
                this.result.textContent = `${type} supports selections from 1 to 8 bytes`;
                return;
            }
        }

        const divisor = Number(this.divisorInput.value);
        if (!Number.isFinite(divisor) || divisor <= 0) {
            this.result.textContent = 'Divisor must be a positive number';
            return;
        }

        const decoded = this.getDecodedValue();
        if (!decoded.valid) {
            this.result.textContent = 'Cannot decode the selected field';
            return;
        }

        const canId = this.frame.id.toString(16).toUpperCase().padStart(this.frame.extended ? 8 : 3, '0');
        const byteOrder = this.isLittleEndian() ? 'Little endian' : 'Big endian';
        this.result.textContent = [
            `CAN ID: 0x${canId}`,
            `Field: ${decoded.range} | ${type} | ${byteOrder}`,
            `Raw HEX: ${decoded.hexRaw}`,
            `Decoded Value: ${decoded.scaled}`
        ].join('\n');
    }

    protected static requiredBytes(type: FieldType): number | undefined {
        switch (type) {
            case 'BIT': case 'BOOL': return 1;
            case 'UINT8': case 'INT8': return 1;
            case 'UINT16': case 'INT16': return 2;
            case 'UINT32': case 'INT32': case 'FLOAT32': return 4;
            case 'FLOAT64': return 8;
            case 'UINT': case 'INT': case 'ASCII': return undefined;
        }
    }

    protected static decode(bytes: Uint8Array, type: FieldType, littleEndian: boolean): number | bigint | string {
        if (type === 'ASCII') {
            return String.fromCharCode(...bytes);
        }
        if (type === 'UINT' || type === 'INT') {
            let value = 0n;
            for (let index = 0; index < bytes.length; index++) {
                const byte = bytes[littleEndian ? bytes.length - 1 - index : index];
                value = (value << 8n) | BigInt(byte);
            }
            if (type === 'INT' && (value & (1n << BigInt(bytes.length * 8 - 1))) !== 0n) {
                return value - (1n << BigInt(bytes.length * 8));
            }
            return value;
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        switch (type) {
            case 'BIT':
            case 'UINT8': return view.getUint8(0);
            case 'BOOL': return view.getUint8(0) !== 0 ? 1 : 0;
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

    protected normalizeSelectionLength(): void {
        const required = TypedFieldDecoder.requiredBytes(this.typeSelect.value as FieldType);
        if (required !== undefined && this.typeSelect.value !== 'BIT' && this.typeSelect.value !== 'BOOL') {
            this.selection = { ...this.selection, byteLength: required };
        }
    }
}
