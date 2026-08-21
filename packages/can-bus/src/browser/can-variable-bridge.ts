// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { GlobalVariableRegistry, VariableId } from '@theia/signal-core';
import { CanRpcClient } from './can-rpc-client';
import { CanBinaryDecoder, CanFrame } from '../common/can-protocol';

export type CanBindingFieldType = 'BIT' | 'BOOL' | 'UINT' | 'INT' | 'UINT8' | 'INT8' | 'UINT16' | 'INT16' | 'UINT32' | 'INT32' | 'FLOAT32' | 'FLOAT64' | 'ASCII';

export interface CanVariableBinding {
    readonly id: string;
    readonly variableId: VariableId;
    readonly canId: number;
    readonly extended: boolean;
    readonly interfaceName?: string;
    readonly startByte: number;
    readonly byteLength: number;
    readonly startBit?: number; // 0..7
    readonly bitLength?: number; // 1..32 for numeric bit fields
    readonly isBit?: boolean;
    readonly type: CanBindingFieldType;
    readonly littleEndian: boolean;
    readonly divisor: number;
}

export interface CanVariableBridgeDiagnostics {
    readonly malformedChunkCount: number;
    readonly lastError?: string;
}

/**
 * Service bridging incoming CAN frames directly to Global Variables.
 * Extracts designated bytes or single bits and writes them to GlobalVariableRegistry.
 */
@injectable()
export class CanVariableBridge implements Disposable {

    @inject(GlobalVariableRegistry)
    protected readonly registry!: GlobalVariableRegistry;

    @inject(CanRpcClient)
    protected readonly rpcClient!: CanRpcClient;

    protected readonly bindings = new Map<string, CanVariableBinding>();
    protected readonly canIdToBindings = new Map<number, Set<CanVariableBinding>>();
    protected readonly disposables: Disposable[] = [];
    protected readonly errorEmitter = new Emitter<Error>();
    protected malformedChunkCount = 0;
    protected lastError: string | undefined;
    private bindingCounter = 0;

    public readonly onDidError: Event<Error> = this.errorEmitter.event;

    @postConstruct()
    protected init(): void {
        this.disposables.push(
            this.rpcClient.onBinaryFrames(chunk => this.processBinaryChunk(chunk))
        );
    }

    public dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        this.bindings.clear();
        this.canIdToBindings.clear();
        this.errorEmitter.dispose();
    }

    /**
     * Registers a new binding from a CAN ID and payload field/bit to a Global Variable.
     */
    public addBinding(bindingInput: Omit<CanVariableBinding, 'id'>): CanVariableBinding {
        this.bindingCounter++;
        const id = `bind_${bindingInput.canId}_${bindingInput.startByte}_${bindingInput.startBit ?? 0}_${this.bindingCounter}`;
        const binding: CanVariableBinding = {
            ...bindingInput,
            id,
            startBit: bindingInput.startBit !== undefined ? bindingInput.startBit : 0,
            bitLength: bindingInput.bitLength !== undefined ? bindingInput.bitLength : 1,
            isBit: bindingInput.isBit || bindingInput.type === 'BIT' || bindingInput.type === 'BOOL'
        };

        this.validateBindings([binding]);

        this.bindings.set(id, binding);

        let set = this.canIdToBindings.get(binding.canId);
        if (!set) {
            set = new Set();
            this.canIdToBindings.set(binding.canId, set);
        }
        set.add(binding);

        return binding;
    }

    /**
     * Removes a binding by ID.
     */
    public removeBinding(id: string): boolean {
        const binding = this.bindings.get(id);
        if (!binding) {
            return false;
        }
        this.bindings.delete(id);
        const set = this.canIdToBindings.get(binding.canId);
        if (set) {
            set.delete(binding);
            if (set.size === 0) {
                this.canIdToBindings.delete(binding.canId);
            }
        }
        return true;
    }

    /**
     * Retrieves all active bindings.
     */
    public getBindings(): readonly CanVariableBinding[] {
        return Array.from(this.bindings.values());
    }

    /**
     * Retrieves bindings for a given CAN ID.
     */
    public getBindingsForCanId(canId: number): readonly CanVariableBinding[] {
        const set = this.canIdToBindings.get(canId);
        return set ? Array.from(set) : [];
    }

    public getDiagnostics(): CanVariableBridgeDiagnostics {
        return {
            malformedChunkCount: this.malformedChunkCount,
            lastError: this.lastError
        };
    }

    /** Validates every binding before a map import mutates the bridge. */
    public validateBindings(
        bindings: readonly CanVariableBinding[],
        additionalVariableIds: ReadonlySet<string> = new Set()
    ): void {
        const validTypes: readonly CanBindingFieldType[] = [
            'BIT', 'BOOL', 'UINT', 'INT', 'UINT8', 'INT8', 'UINT16', 'INT16',
            'UINT32', 'INT32', 'FLOAT32', 'FLOAT64', 'ASCII'
        ];
        for (const [index, binding] of bindings.entries()) {
            if (!binding || typeof binding !== 'object') {
                throw new Error(`CAN binding ${index} is not an object.`);
            }
            if (!this.registry.get(binding.variableId) && !additionalVariableIds.has(String(binding.variableId))) {
                throw new Error(`CAN binding ${index} references unknown variable '${String(binding.variableId)}'.`);
            }
            if (!Number.isInteger(binding.canId) || binding.canId < 0 || binding.canId > 0x1FFFFFFF) {
                throw new Error(`CAN binding ${index} has an invalid CAN ID.`);
            }
            if (typeof binding.extended !== 'boolean' || typeof binding.littleEndian !== 'boolean') {
                throw new Error(`CAN binding ${index} has invalid boolean flags.`);
            }
            if (!Number.isInteger(binding.startByte) || binding.startByte < 0) {
                throw new Error(`CAN binding ${index} has an invalid start byte.`);
            }
            if (!Number.isInteger(binding.byteLength) || binding.byteLength < 1 || binding.byteLength > 64) {
                throw new Error(`CAN binding ${index} has an invalid byte length.`);
            }
            if (binding.startBit !== undefined && (!Number.isInteger(binding.startBit) || binding.startBit < 0 || binding.startBit > 7)) {
                throw new Error(`CAN binding ${index} has an invalid start bit.`);
            }
            if (binding.bitLength !== undefined && (!Number.isInteger(binding.bitLength) || binding.bitLength < 1 || binding.bitLength > 32)) {
                throw new Error(`CAN binding ${index} has an invalid bit length.`);
            }
            if (!validTypes.includes(binding.type) || !Number.isFinite(binding.divisor) || binding.divisor <= 0) {
                throw new Error(`CAN binding ${index} has an invalid type or divisor.`);
            }
        }
    }

    /** Replaces all bindings after the complete incoming map has been validated. */
    public replaceBindings(bindings: readonly CanVariableBinding[]): void {
        this.validateBindings(bindings);
        this.bindings.clear();
        this.canIdToBindings.clear();
        this.bindingCounter = 0;
        for (const binding of bindings) {
            const { id: _ignoredId, ...input } = binding;
            this.addBinding(input);
        }
    }

    /**
     * Processes incoming binary chunk of CAN frames.
     */
    public processBinaryChunk(chunk: ArrayBuffer): void {
        if (this.bindings.size === 0) {
            return;
        }

        try {
            const result = CanBinaryDecoder.decodeBatchDetailed(chunk, frame => this.processFrame(frame));
            if (!result.valid) {
                throw new Error(result.error ?? `CAN binary chunk decoded ${result.decodedCount} of ${result.advertisedCount} advertised frames.`);
            }
        } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.malformedChunkCount++;
            this.lastError = failure.message;
            this.errorEmitter.fire(failure);
        }
    }

    /**
     * Processes a single decoded CAN frame and updates bound variables.
     */
    public processFrame(frame: CanFrame): void {
        const bindings = this.canIdToBindings.get(frame.id);
        if (!bindings || bindings.size === 0) {
            return;
        }

        for (const binding of bindings) {
            if (binding.extended !== frame.extended) {
                continue;
            }
            if (binding.interfaceName && frame.interface && binding.interfaceName !== frame.interface) {
                continue;
            }

            this.evaluateAndWrite(binding, frame);
        }
    }

    /**
     * Extracts bit/byte value from frame payload and updates GlobalVariableRegistry.
     */
    protected evaluateAndWrite(binding: CanVariableBinding, frame: CanFrame): void {
        const { startByte, byteLength, startBit, bitLength, isBit, type, littleEndian, divisor, variableId } = binding;
        const data = frame.data;

        if (!Number.isInteger(startByte) || startByte < 0 || startByte >= data.length) {
            return;
        }

        let extractedValue: unknown;

        if (isBit || type === 'BIT' || type === 'BOOL') {
            // Single bit extraction
            const byteVal = data[startByte];
            const bit = (byteVal >> (startBit ?? 0)) & 1;
            extractedValue = bit === 1;
        } else if (startBit !== undefined && bitLength !== undefined && bitLength > 1 && bitLength <= 32) {
            const numericValue = this.decodeBitField(data, startByte, startBit, bitLength, type === 'INT', littleEndian);
            if (numericValue === undefined) {
                return;
            }
            extractedValue = divisor !== 1 && divisor > 0 ? numericValue / divisor : numericValue;
        } else {
            // Standard byte-level decoding
            if (!Number.isInteger(byteLength) || byteLength < 1 || startByte + byteLength > data.length) {
                return;
            }
            const actualLength = Math.min(byteLength, data.length - startByte);
            const slice = new Uint8Array(data.slice(startByte, startByte + actualLength));

            if (type === 'ASCII') {
                extractedValue = String.fromCharCode(...slice);
            } else {
                const val = this.decodeNumeric(slice, type, littleEndian);
                if (val !== undefined) {
                    extractedValue = (divisor !== 1 && divisor > 0 && typeof val === 'number')
                        ? val / divisor
                        : (typeof val === 'bigint' && divisor !== 1 && divisor > 0 ? Number(val) / divisor : val);
                }
            }
        }

        if (extractedValue !== undefined) {
            const hexId = frame.id.toString(16).toUpperCase();
            const bitSuffix = isBit ? `.bit${startBit ?? 0}` : (byteLength > 1 ? `[${startByte}..${startByte + byteLength - 1}]` : `[b${startByte}]`);
            const sourceLabel = `CAN 0x${hexId}${bitSuffix}`;

            try {
                this.registry.write(variableId, extractedValue, {
                    source: sourceLabel,
                    timestampNs: BigInt(Math.max(0, Math.floor(frame.timestamp * 1_000_000))),
                    clockDomain: 'can-capture',
                    quality: 'GOOD',
                    force: true
                });
            } catch (err) {
                // If value type conversion failed, mark invalid
                console.warn(`[CanVariableBridge] Failed to write variable ${variableId}:`, err);
            }
        }
    }

    /**
     * Extracts a signed or unsigned bit field without JavaScript 32-bit shift
     * coercion. For little endian, bit zero is the least significant bit of
     * the first byte. For big endian, the selected field is read from the most
     * significant side of the selected byte range.
     */
    protected decodeBitField(
        data: readonly number[],
        startByte: number,
        startBit: number,
        bitLength: number,
        signed: boolean,
        littleEndian: boolean
    ): number | undefined {
        if (!Number.isInteger(startBit) || startBit < 0 || startBit > 7 || !Number.isInteger(bitLength) || bitLength < 1 || bitLength > 32) {
            return undefined;
        }
        const byteCount = Math.ceil((startBit + bitLength) / 8);
        const endByte = startByte + byteCount;
        if (endByte > data.length) {
            return undefined;
        }

        let raw = 0n;
        for (let i = startByte; i < endByte; i++) {
            const byte = BigInt(data[i] & 0xFF);
            raw = littleEndian
                ? raw | (byte << BigInt((i - startByte) * 8))
                : (raw << 8n) | byte;
        }

        const shift = littleEndian ? startBit : byteCount * 8 - startBit - bitLength;
        const mask = (1n << BigInt(bitLength)) - 1n;
        let value = (raw >> BigInt(shift)) & mask;
        if (signed && (value & (1n << BigInt(bitLength - 1))) !== 0n) {
            value -= 1n << BigInt(bitLength);
        }
        return Number(value);
    }

    protected decodeNumeric(bytes: Uint8Array, type: string, littleEndian: boolean): number | bigint | undefined {
        if (bytes.length === 0) {
            return undefined;
        }

        if (type === 'UINT' || type === 'INT') {
            let val = 0n;
            for (let i = 0; i < bytes.length; i++) {
                const b = bytes[littleEndian ? bytes.length - 1 - i : i];
                val = (val << 8n) | BigInt(b);
            }
            if (type === 'INT' && (val & (1n << BigInt(bytes.length * 8 - 1))) !== 0n) {
                return Number(val - (1n << BigInt(bytes.length * 8)));
            }
            return Number(val);
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        try {
            switch (type) {
                case 'UINT8': return view.getUint8(0);
                case 'INT8': return view.getInt8(0);
                case 'UINT16': return bytes.length >= 2 ? view.getUint16(0, littleEndian) : undefined;
                case 'INT16': return bytes.length >= 2 ? view.getInt16(0, littleEndian) : undefined;
                case 'UINT32': return bytes.length >= 4 ? view.getUint32(0, littleEndian) : undefined;
                case 'INT32': return bytes.length >= 4 ? view.getInt32(0, littleEndian) : undefined;
                case 'FLOAT32': return bytes.length >= 4 ? view.getFloat32(0, littleEndian) : undefined;
                case 'FLOAT64': return bytes.length >= 8 ? view.getFloat64(0, littleEndian) : undefined;
            }
        } catch {
            return undefined;
        }
        return undefined;
    }
}
