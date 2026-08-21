// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Branded type for unique, type-safe Variable IDs.
 */
declare const VariableIdBrand: unique symbol;
export type VariableId = string & { readonly [VariableIdBrand]: true };

export function createVariableId(id: string): VariableId {
    return id as VariableId;
}

/**
 * Supported data types for global variables (PLC-style tag system).
 */
export type VariableType =
    | 'BOOL'
    | 'UINT8'
    | 'INT8'
    | 'UINT16'
    | 'INT16'
    | 'UINT32'
    | 'INT32'
    | 'FLOAT32'
    | 'FLOAT64'
    | 'STRING'
    | 'BYTES';

/**
 * Quality indicator of the variable state.
 */
export type VariableQuality = 'GOOD' | 'STALE' | 'INVALID' | 'DISCONNECTED';

/**
 * Type of source supplying the variable value.
 */
export type VariableSourceType =
    | 'MANUAL'
    | 'CAN_PAYLOAD'
    | 'DECODER'
    | 'CALCULATION'
    | 'SYSTEM';

/**
 * Description of an external or automatic variable source.
 */
export interface VariableSourceDefinition {
    readonly type: VariableSourceType;
    readonly details?: Readonly<Record<string, unknown>>;
}

import { Disposable } from './decoder-registry';
export { Disposable };

/**
 * Static metadata defining a global variable in the registry.
 */
export interface GlobalVariableDefinition {
    readonly id: VariableId;
    readonly name: string;
    readonly type: VariableType;
    readonly length?: number;
    readonly initialValue?: unknown;
    readonly writable: boolean;
    readonly description?: string;
    readonly unit?: string;
    readonly group?: string;
    readonly source?: VariableSourceDefinition;
}

/**
 * Input format for defining or registering a new global variable.
 */
export interface GlobalVariableDefinitionInput {
    readonly id?: VariableId | string;
    readonly name: string;
    readonly type: VariableType;
    readonly length?: number;
    readonly initialValue?: unknown;
    readonly writable?: boolean;
    readonly description?: string;
    readonly unit?: string;
    readonly group?: string;
    readonly source?: VariableSourceDefinition;
}

/**
 * Runtime execution state of a global variable.
 */
export interface GlobalVariableState {
    readonly id: VariableId;
    readonly value: unknown;
    readonly timestampNs: bigint;
    /** Clock domain that gives meaning to timestampNs (for example CAN capture or process monotonic). */
    readonly clockDomain: string;
    readonly quality: VariableQuality;
    readonly source?: string;
    readonly version: number;
}

/**
 * Composite entity combining the static definition and runtime state.
 */
export interface GlobalVariable {
    readonly definition: GlobalVariableDefinition;
    readonly state: GlobalVariableState;
}

/**
 * Event payload emitted when a variable's runtime state changes.
 */
export interface VariableChangeEvent {
    readonly id: VariableId;
    readonly previousState?: GlobalVariableState;
    readonly state: GlobalVariableState;
    readonly definition: GlobalVariableDefinition;
}

/**
 * Event payload emitted when variable definitions are added, updated, or removed.
 */
export interface VariableDefinitionChangeEvent {
    readonly type: 'ADDED' | 'UPDATED' | 'REMOVED';
    readonly definition: GlobalVariableDefinition;
    readonly previousDefinition?: GlobalVariableDefinition;
}

/**
 * Options for writing a variable value.
 */
export interface VariableWriteOptions {
    readonly source?: string;
    readonly timestampNs?: bigint;
    readonly clockDomain?: string;
    readonly quality?: VariableQuality;
    readonly force?: boolean;
}

/**
 * Custom exceptions for the Global Variable system.
 */
export class InvalidVariableDefinitionException extends Error {
    constructor(message: string) {
        super(`[GlobalVariableRegistry] Invalid definition: ${message}`);
        this.name = 'InvalidVariableDefinitionException';
    }
}

export class DuplicateVariableException extends Error {
    constructor(identifier: string) {
        super(`[GlobalVariableRegistry] Variable with name or ID '${identifier}' already exists.`);
        this.name = 'DuplicateVariableException';
    }
}

export class VariableNotFoundException extends Error {
    constructor(identifier: string) {
        super(`[GlobalVariableRegistry] Variable '${identifier}' was not found.`);
        this.name = 'VariableNotFoundException';
    }
}

export class VariableReadOnlyException extends Error {
    constructor(name: string) {
        super(`[GlobalVariableRegistry] Variable '${name}' is read-only and cannot be modified.`);
        this.name = 'VariableReadOnlyException';
    }
}

export class InvalidVariableValueException extends Error {
    constructor(name: string, type: VariableType, value: unknown, reason?: string) {
        const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
        super(`[GlobalVariableRegistry] Invalid value '${valueStr}' for variable '${name}' of type '${type}'${reason ? `: ${reason}` : '.'}`);
        this.name = 'InvalidVariableValueException';
    }
}
