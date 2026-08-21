// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { GlobalVariableRegistry } from '@theia/signal-core';
import type { CanVariableBinding } from './can-variable-bridge';

export const GLOBAL_VARIABLE_MAP_FORMAT = 'theia-global-variable-map';
export const GLOBAL_VARIABLE_MAP_SCHEMA_VERSION = 1;

export interface GlobalVariableMapDocument {
    readonly format: typeof GLOBAL_VARIABLE_MAP_FORMAT;
    readonly schemaVersion: typeof GLOBAL_VARIABLE_MAP_SCHEMA_VERSION;
    readonly exportedAtUtc: string;
    readonly variables: readonly unknown[];
    readonly canBindings: readonly CanVariableBinding[];
}

/** Creates the versioned JSON map used for Global Variables + CAN bindings. */
export function createGlobalVariableMap(
    registry: GlobalVariableRegistry,
    bindings: readonly CanVariableBinding[],
    exportedAtUtc = new Date().toISOString()
): GlobalVariableMapDocument {
    const variables: unknown = JSON.parse(registry.exportSnapshot());
    if (!Array.isArray(variables)) {
        throw new Error('Global Variable Registry returned an invalid snapshot.');
    }
    return {
        format: GLOBAL_VARIABLE_MAP_FORMAT,
        schemaVersion: GLOBAL_VARIABLE_MAP_SCHEMA_VERSION,
        exportedAtUtc,
        variables,
        canBindings: bindings.map(binding => ({ ...binding }))
    };
}

/**
 * Parses the current map format and migrates the former raw snapshot-array
 * export into a map without CAN bindings.
 */
export function parseGlobalVariableMap(json: string): GlobalVariableMapDocument {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch (error) {
        throw new Error(`Invalid variable map JSON: ${String(error)}`);
    }

    if (Array.isArray(raw)) {
        return {
            format: GLOBAL_VARIABLE_MAP_FORMAT,
            schemaVersion: GLOBAL_VARIABLE_MAP_SCHEMA_VERSION,
            exportedAtUtc: new Date(0).toISOString(),
            variables: raw,
            canBindings: []
        };
    }
    if (!isRecord(raw) || raw.format !== GLOBAL_VARIABLE_MAP_FORMAT || raw.schemaVersion !== GLOBAL_VARIABLE_MAP_SCHEMA_VERSION) {
        throw new Error(`Unsupported variable map format or schema version. Expected ${GLOBAL_VARIABLE_MAP_FORMAT} v${GLOBAL_VARIABLE_MAP_SCHEMA_VERSION}.`);
    }
    if (!Array.isArray(raw.variables) || !Array.isArray(raw.canBindings)) {
        throw new Error('Variable map must contain variables and canBindings arrays.');
    }
    if (typeof raw.exportedAtUtc !== 'string') {
        throw new Error('Variable map exportedAtUtc must be a string.');
    }
    return {
        format: GLOBAL_VARIABLE_MAP_FORMAT,
        schemaVersion: GLOBAL_VARIABLE_MAP_SCHEMA_VERSION,
        exportedAtUtc: raw.exportedAtUtc,
        variables: raw.variables,
        canBindings: raw.canBindings as CanVariableBinding[]
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
