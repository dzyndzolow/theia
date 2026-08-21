// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    createVariableId,
    Disposable,
    DuplicateVariableException,
    GlobalVariable,
    GlobalVariableDefinition,
    GlobalVariableDefinitionInput,
    GlobalVariableState,
    InvalidVariableDefinitionException,
    InvalidVariableValueException,
    VariableChangeEvent,
    VariableDefinitionChangeEvent,
    VariableId,
    VariableNotFoundException,
    VariableQuality,
    VariableReadOnlyException,
    VariableType,
    VariableWriteOptions
} from './global-variable-contracts';

export type VariableChangeListener = (event: VariableChangeEvent) => void;
export type VariableDefinitionChangeListener = (event: VariableDefinitionChangeEvent) => void;

interface SnapshotItem {
    readonly definition: GlobalVariableDefinitionInput;
    readonly state?: {
        readonly value?: unknown;
        readonly timestampNs?: string | number;
        readonly clockDomain?: string;
        readonly source?: string;
        readonly quality?: VariableQuality;
    };
}

/**
 * Validates identifier/symbolic name syntax (e.g., "engine.speed", "sensor_1", "io.digital.in0").
 */
const SYMBOLIC_NAME_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

/**
 * Central Global Variable Registry providing single source of truth, validation,
 * execution state tracking, versioning, and reactive notifications.
 */
export class GlobalVariableRegistry implements Disposable {
    private readonly variables = new Map<VariableId, GlobalVariable>();
    private readonly nameToIdMap = new Map<string, VariableId>();

    private readonly changeListeners = new Set<VariableChangeListener>();
    private readonly definitionListeners = new Set<VariableDefinitionChangeListener>();

    private idCounter = 0;

    /**
     * Subscribes to runtime variable state changes.
     */
    public onDidVariableChange(listener: VariableChangeListener): Disposable {
        this.changeListeners.add(listener);
        return {
            dispose: () => this.changeListeners.delete(listener)
        };
    }

    /**
     * Subscribes to variable definition lifecycle events (added, updated, removed).
     */
    public onDidDefinitionChange(listener: VariableDefinitionChangeListener): Disposable {
        this.definitionListeners.add(listener);
        return {
            dispose: () => this.definitionListeners.delete(listener)
        };
    }

    /**
     * Defines and registers a new global variable with an optional initial state.
     */
    public define(
        definition: GlobalVariableDefinitionInput
    ): GlobalVariableDefinition {
        this.validateDefinition(definition);

        const nameKey = definition.name.trim();
        if (this.nameToIdMap.has(nameKey)) {
            throw new DuplicateVariableException(nameKey);
        }

        const id = (definition.id ? createVariableId(String(definition.id)) : this.generateId(nameKey));
        if (this.variables.has(id)) {
            throw new DuplicateVariableException(String(id));
        }

        const normalizedDefinition: GlobalVariableDefinition = {
            id,
            name: nameKey,
            type: definition.type,
            length: definition.length !== undefined ? Number(definition.length) : undefined,
            initialValue: definition.initialValue,
            writable: definition.writable !== false,
            description: definition.description,
            unit: definition.unit,
            group: definition.group,
            source: definition.source
        };

        const initialVal = definition.initialValue !== undefined
            ? this.validateAndCoerceValue(normalizedDefinition, definition.initialValue)
            : this.getDefaultInitialValue(normalizedDefinition.type);

        const initialTimestamp = typeof process !== 'undefined' && process.hrtime
            ? process.hrtime.bigint()
            : BigInt(Date.now()) * 1000000n;
        const initialClockDomain = typeof process !== 'undefined' && typeof process.hrtime.bigint === 'function'
            ? 'process-monotonic'
            : 'wall-clock';

        const initialState: GlobalVariableState = {
            id,
            value: initialVal,
            timestampNs: initialTimestamp,
            clockDomain: initialClockDomain,
            quality: 'GOOD',
            source: normalizedDefinition.source?.type ?? 'MANUAL',
            version: 1
        };

        const variable: GlobalVariable = {
            definition: normalizedDefinition,
            state: initialState
        };

        this.variables.set(id, variable);
        this.nameToIdMap.set(nameKey, id);

        this.emitDefinitionChange({
            type: 'ADDED',
            definition: normalizedDefinition
        });

        return normalizedDefinition;
    }

    /**
     * Updates metadata of an existing variable definition.
     */
    public updateDefinition(
        idOrName: VariableId | string,
        updates: Partial<Omit<GlobalVariableDefinition, 'id'>>
    ): GlobalVariableDefinition {
        const variable = this.resolveVariable(idOrName);
        const prevDefinition = variable.definition;

        let targetName = prevDefinition.name;
        if (updates.name !== undefined) {
            const newName = updates.name.trim();
            if (newName !== prevDefinition.name) {
                if (this.nameToIdMap.has(newName)) {
                    throw new DuplicateVariableException(newName);
                }
                this.validateName(newName);
                this.nameToIdMap.delete(prevDefinition.name);
                this.nameToIdMap.set(newName, prevDefinition.id);
                targetName = newName;
            }
        }

        const newType = updates.type ?? prevDefinition.type;
        const newLength = updates.length !== undefined ? updates.length : prevDefinition.length;

        const updatedDefinition: GlobalVariableDefinition = {
            ...prevDefinition,
            ...updates,
            id: prevDefinition.id,
            name: targetName,
            type: newType,
            length: newLength
        };

        this.validateDefinition(updatedDefinition);

        // If type changed or length changed, re-validate current state value
        let newState = variable.state;
        try {
            const revalidatedValue = this.validateAndCoerceValue(updatedDefinition, variable.state.value);
            newState = {
                ...variable.state,
                value: revalidatedValue
            };
        } catch {
            const fallbackValue = updatedDefinition.initialValue !== undefined
                ? this.validateAndCoerceValue(updatedDefinition, updatedDefinition.initialValue)
                : this.getDefaultInitialValue(updatedDefinition.type);

            newState = {
                ...variable.state,
                value: fallbackValue,
                quality: 'INVALID',
                version: variable.state.version + 1
            };
        }

        const updatedVariable: GlobalVariable = {
            definition: updatedDefinition,
            state: newState
        };

        this.variables.set(prevDefinition.id, updatedVariable);

        this.emitDefinitionChange({
            type: 'UPDATED',
            definition: updatedDefinition,
            previousDefinition: prevDefinition
        });

        if (newState !== variable.state) {
            this.emitVariableChange({
                id: prevDefinition.id,
                previousState: variable.state,
                state: newState,
                definition: updatedDefinition
            });
        }

        return updatedDefinition;
    }

    /**
     * Removes a variable from the registry.
     */
    public remove(idOrName: VariableId | string): boolean {
        const id = this.resolveId(idOrName);
        if (!id) {
            return false;
        }

        const variable = this.variables.get(id);
        if (!variable) {
            return false;
        }

        this.variables.delete(id);
        this.nameToIdMap.delete(variable.definition.name);

        this.emitDefinitionChange({
            type: 'REMOVED',
            definition: variable.definition
        });

        return true;
    }

    /**
     * Retrieves the composite variable entity (definition + state).
     */
    public get(idOrName: VariableId | string): GlobalVariable | undefined {
        const id = this.resolveId(idOrName);
        return id ? this.variables.get(id) : undefined;
    }

    /**
     * Reads the current runtime execution state of a variable.
     */
    public read(idOrName: VariableId | string): GlobalVariableState | undefined {
        return this.get(idOrName)?.state;
    }

    /**
     * Writes a new value into the variable, strictly enforcing type constraints,
     * boundaries, and permissions.
     */
    public write(
        idOrName: VariableId | string,
        value: unknown,
        options: VariableWriteOptions = {}
    ): GlobalVariableState {
        const variable = this.resolveVariable(idOrName);
        const { definition, state: previousState } = variable;

        if (!definition.writable && !options.force) {
            throw new VariableReadOnlyException(definition.name);
        }

        const validatedValue = this.validateAndCoerceValue(definition, value);

        const timestampNs = options.timestampNs !== undefined
            ? options.timestampNs
            : (typeof process !== 'undefined' && process.hrtime
                ? process.hrtime.bigint()
                : BigInt(Date.now()) * 1000000n);
        const clockDomain = options.clockDomain
            ?? (options.timestampNs !== undefined
                ? 'external'
                : (typeof process !== 'undefined' && typeof process.hrtime.bigint === 'function' ? 'process-monotonic' : 'wall-clock'));

        const nextQuality: VariableQuality = options.quality ?? 'GOOD';
        const nextSource = options.source ?? previousState.source;
        const nextVersion = previousState.version + 1;

        const nextState: GlobalVariableState = {
            id: definition.id,
            value: validatedValue,
            timestampNs,
            clockDomain,
            quality: nextQuality,
            source: nextSource,
            version: nextVersion
        };

        const updatedVariable: GlobalVariable = {
            definition,
            state: nextState
        };

        this.variables.set(definition.id, updatedVariable);

        this.emitVariableChange({
            id: definition.id,
            previousState,
            state: nextState,
            definition
        });

        return nextState;
    }

    /**
     * Returns an immutable list of all registered variables.
     */
    public list(): readonly GlobalVariable[] {
        return Array.from(this.variables.values());
    }

    /**
     * Finds a variable by its symbolic name.
     */
    public findByName(name: string): GlobalVariable | undefined {
        const id = this.nameToIdMap.get(name.trim());
        return id ? this.variables.get(id) : undefined;
    }

    /**
     * Clears all registered variables and notifies listeners.
     */
    public clear(): void {
        const allVars = Array.from(this.variables.values());
        this.variables.clear();
        this.nameToIdMap.clear();

        for (const v of allVars) {
            this.emitDefinitionChange({
                type: 'REMOVED',
                definition: v.definition
            });
        }
    }

    /**
     * Serializes all variable definitions to a JSON string.
     */
    public exportDefinitions(): string {
        const defs = this.list().map(v => v.definition);
        return JSON.stringify(defs, undefined, 2);
    }

    /**
     * Imports variable definitions from a JSON string.
     */
    public importDefinitions(
        jsonString: string,
        options: { overwriteExisting?: boolean } = {}
    ): GlobalVariableDefinition[] {
        const parsed = JSON.parse(jsonString);
        if (!Array.isArray(parsed)) {
            throw new InvalidVariableDefinitionException('Import JSON must be an array of definitions.');
        }

        const imported: GlobalVariableDefinition[] = [];
        for (const item of parsed) {
            const existing = this.findByName(item.name) || (item.id ? this.get(item.id) : undefined);
            if (existing) {
                if (options.overwriteExisting) {
                    this.updateDefinition(existing.definition.id, item);
                    imported.push(this.get(existing.definition.id)!.definition);
                }
            } else {
                const def = this.define(item);
                imported.push(def);
            }
        }
        return imported;
    }

    /**
     * Serializes complete snapshot (definitions and current values).
     */
    public exportSnapshot(): string {
        const snapshot = this.list().map(v => ({
            definition: v.definition,
            state: {
                ...v.state,
                value: this.serializeValue(v.state.value),
                timestampNs: v.state.timestampNs.toString()
            }
        }));
        return JSON.stringify(snapshot, undefined, 2);
    }

    /**
     * Restores complete snapshot.
     */
    public importSnapshot(jsonString: string, options: { overwriteExisting?: boolean } = {}): void {
        const parsed = this.parseSnapshot(jsonString);
        this.validateSnapshot(parsed, options);

        const variablesBackup = new Map(this.variables);
        const namesBackup = new Map(this.nameToIdMap);
        const idCounterBackup = this.idCounter;
        try {
            this.applySnapshot(parsed, options);
        } catch (error) {
            this.variables.clear();
            for (const [id, variable] of variablesBackup) {
                this.variables.set(id, variable);
            }
            this.nameToIdMap.clear();
            for (const [name, id] of namesBackup) {
                this.nameToIdMap.set(name, id);
            }
            this.idCounter = idCounterBackup;
            throw error;
        }
    }

    private validateSnapshot(parsed: readonly SnapshotItem[], options: { overwriteExisting?: boolean }): void {
        const validation = new GlobalVariableRegistry();
        try {
            for (const variable of this.list()) {
                validation.define(variable.definition);
                validation.write(variable.definition.id, this.serializeValue(variable.state.value), {
                    source: variable.state.source,
                    quality: variable.state.quality,
                    timestampNs: variable.state.timestampNs,
                    clockDomain: variable.state.clockDomain,
                    force: true
                });
            }
            validation.applySnapshot(parsed, options);
        } finally {
            validation.dispose();
        }
    }

    private applySnapshot(parsed: readonly SnapshotItem[], options: { overwriteExisting?: boolean }): void {
        for (const item of parsed) {
            const existing = this.findByName(item.definition.name) || (item.definition.id ? this.get(item.definition.id) : undefined);
            let defId: VariableId;
            if (existing) {
                if (options.overwriteExisting) {
                    this.updateDefinition(existing.definition.id, item.definition);
                    defId = existing.definition.id;
                } else {
                    continue;
                }
            } else {
                const created = this.define(item.definition);
                defId = created.id;
            }

            if (item.state && item.state.value !== undefined) {
                const ts = item.state.timestampNs ? BigInt(item.state.timestampNs) : undefined;
                this.write(defId, item.state.value, {
                    source: item.state.source,
                    quality: item.state.quality,
                    timestampNs: ts,
                    clockDomain: item.state.clockDomain ?? 'external',
                    force: true
                });
            }
        }
    }

    private parseSnapshot(jsonString: string): SnapshotItem[] {
        let parsed: unknown;
        try {
            parsed = JSON.parse(jsonString);
        } catch (error) {
            throw new InvalidVariableDefinitionException(`Import snapshot is not valid JSON: ${String(error)}`);
        }
        if (!Array.isArray(parsed)) {
            throw new InvalidVariableDefinitionException('Import snapshot JSON must be an array.');
        }

        return parsed.map((raw, index) => {
            if (!this.isRecord(raw) || !this.isRecord(raw.definition) || typeof raw.definition.name !== 'string') {
                throw new InvalidVariableDefinitionException(`Snapshot item ${index} has an invalid definition.`);
            }
            if (raw.state !== undefined && !this.isRecord(raw.state)) {
                throw new InvalidVariableDefinitionException(`Snapshot item ${index} has an invalid state.`);
            }
            const state = raw.state as Record<string, unknown> | undefined;
            if (state?.timestampNs !== undefined && typeof state.timestampNs !== 'string' && typeof state.timestampNs !== 'number') {
                throw new InvalidVariableDefinitionException(`Snapshot item ${index} has an invalid timestamp.`);
            }
            if (state?.clockDomain !== undefined && typeof state.clockDomain !== 'string') {
                throw new InvalidVariableDefinitionException(`Snapshot item ${index} has an invalid clock domain.`);
            }
            return {
                definition: raw.definition as unknown as GlobalVariableDefinitionInput,
                state: state as SnapshotItem['state']
            };
        });
    }

    private serializeValue(value: unknown): unknown {
        if (value instanceof Uint8Array) {
            return Array.from(value);
        }
        if (value instanceof ArrayBuffer) {
            return Array.from(new Uint8Array(value));
        }
        return value;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    public dispose(): void {
        this.changeListeners.clear();
        this.definitionListeners.clear();
        this.variables.clear();
        this.nameToIdMap.clear();
    }

    // --- Private Helper Methods ---

    private resolveId(idOrName: VariableId | string): VariableId | undefined {
        const raw = String(idOrName).trim();
        if (this.variables.has(raw as VariableId)) {
            return raw as VariableId;
        }
        return this.nameToIdMap.get(raw);
    }

    private resolveVariable(idOrName: VariableId | string): GlobalVariable {
        const id = this.resolveId(idOrName);
        if (!id) {
            throw new VariableNotFoundException(String(idOrName));
        }
        const variable = this.variables.get(id);
        if (!variable) {
            throw new VariableNotFoundException(String(idOrName));
        }
        return variable;
    }

    private generateId(name: string): VariableId {
        this.idCounter++;
        const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        return createVariableId(`var_${sanitized}_${this.idCounter}`);
    }

    private validateName(name: string): void {
        if (!name || name.trim().length === 0) {
            throw new InvalidVariableDefinitionException('Variable name cannot be empty.');
        }
        if (!SYMBOLIC_NAME_REGEX.test(name.trim())) {
            throw new InvalidVariableDefinitionException(
                `Variable name '${name}' contains invalid characters. Use alphanumeric characters, '_', '-' or '.'.`
            );
        }
    }

    private validateDefinition(def: {
        readonly name: string;
        readonly type: VariableType;
        readonly length?: number;
    }): void {
        this.validateName(def.name);

        if (!def.type) {
            throw new InvalidVariableDefinitionException('Variable type must be specified.');
        }

        const validTypes: VariableType[] = [
            'BOOL', 'UINT8', 'INT8', 'UINT16', 'INT16', 'UINT32', 'INT32',
            'FLOAT32', 'FLOAT64', 'STRING', 'BYTES'
        ];
        if (!validTypes.includes(def.type)) {
            throw new InvalidVariableDefinitionException(`Unsupported variable type '${def.type}'.`);
        }

        if (def.length !== undefined) {
            if (typeof def.length !== 'number' || def.length <= 0 || !Number.isInteger(def.length)) {
                throw new InvalidVariableDefinitionException(`Variable length must be a positive integer, got ${def.length}.`);
            }
        }
    }

    public getDefaultInitialValue(type: VariableType): unknown {
        switch (type) {
            case 'BOOL':
                return false;
            case 'UINT8':
            case 'INT8':
            case 'UINT16':
            case 'INT16':
            case 'UINT32':
            case 'INT32':
            case 'FLOAT32':
            case 'FLOAT64':
                return 0;
            case 'STRING':
                return '';
            case 'BYTES':
                return new Uint8Array(0);
        }
    }

    public validateAndCoerceValue(definition: GlobalVariableDefinition, rawValue: unknown): unknown {
        const { name, type, length } = definition;

        switch (type) {
            case 'BOOL': {
                if (typeof rawValue === 'boolean') {
                    return rawValue;
                }
                if (rawValue === 0 || rawValue === '0' || rawValue === 'false' || rawValue === 'FALSE') {
                    return false;
                }
                if (rawValue === 1 || rawValue === '1' || rawValue === 'true' || rawValue === 'TRUE') {
                    return true;
                }
                throw new InvalidVariableValueException(name, type, rawValue, 'Expected boolean');
            }

            case 'UINT8': {
                const n = Number(rawValue);
                if (!Number.isInteger(n) || n < 0 || n > 255) {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected integer between 0 and 255');
                }
                return n;
            }

            case 'INT8': {
                const n = Number(rawValue);
                if (!Number.isInteger(n) || n < -128 || n > 127) {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected integer between -128 and 127');
                }
                return n;
            }

            case 'UINT16': {
                const n = Number(rawValue);
                if (!Number.isInteger(n) || n < 0 || n > 65535) {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected integer between 0 and 65535');
                }
                return n;
            }

            case 'INT16': {
                const n = Number(rawValue);
                if (!Number.isInteger(n) || n < -32768 || n > 32767) {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected integer between -32768 and 32767');
                }
                return n;
            }

            case 'UINT32': {
                const n = Number(rawValue);
                if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected integer between 0 and 4294967295');
                }
                return n;
            }

            case 'INT32': {
                const n = Number(rawValue);
                if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected integer between -2147483648 and 2147483647');
                }
                return n;
            }

            case 'FLOAT32':
            case 'FLOAT64': {
                const n = Number(rawValue);
                if (typeof rawValue !== 'number' && typeof rawValue !== 'string') {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected numeric value');
                }
                if (!Number.isFinite(n)) {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected finite number');
                }
                return type === 'FLOAT32' ? Math.fround(n) : n;
            }

            case 'STRING': {
                const str = typeof rawValue === 'string' ? rawValue : String(rawValue);
                if (length !== undefined && str.length > length) {
                    throw new InvalidVariableValueException(name, type, rawValue, `String length exceeds maximum of ${length}`);
                }
                return str;
            }

            case 'BYTES': {
                let bytes: Uint8Array;
                if (rawValue instanceof Uint8Array) {
                    bytes = rawValue;
                } else if (rawValue instanceof ArrayBuffer) {
                    bytes = new Uint8Array(rawValue);
                } else if (Array.isArray(rawValue) && rawValue.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) {
                    bytes = new Uint8Array(rawValue);
                } else if (typeof rawValue === 'string') {
                    const cleaned = rawValue.replace(/\s+/g, '').replace(/^0x/i, '');
                    if (cleaned.length % 2 !== 0 || /[^0-9a-fA-F]/.test(cleaned)) {
                        throw new InvalidVariableValueException(name, type, rawValue, 'Invalid hex byte string format');
                    }
                    bytes = new Uint8Array(cleaned.length / 2);
                    for (let i = 0; i < cleaned.length; i += 2) {
                        bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
                    }
                } else {
                    throw new InvalidVariableValueException(name, type, rawValue, 'Expected Uint8Array, ArrayBuffer, byte array or hex string');
                }

                if (length !== undefined && bytes.byteLength > length) {
                    throw new InvalidVariableValueException(name, type, rawValue, `Byte length ${bytes.byteLength} exceeds maximum of ${length}`);
                }
                return bytes;
            }
        }
    }

    private emitVariableChange(event: VariableChangeEvent): void {
        for (const listener of this.changeListeners) {
            try {
                listener(event);
            } catch (err) {
                console.error('[GlobalVariableRegistry] Error in variable change listener:', err);
            }
        }
    }

    private emitDefinitionChange(event: VariableDefinitionChangeEvent): void {
        for (const listener of this.definitionListeners) {
            try {
                listener(event);
            } catch (err) {
                console.error('[GlobalVariableRegistry] Error in definition change listener:', err);
            }
        }
    }
}
