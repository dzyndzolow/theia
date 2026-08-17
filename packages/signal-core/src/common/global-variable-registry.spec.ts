// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { GlobalVariableRegistry } from './global-variable-registry';
import {
    createVariableId,
    DuplicateVariableException,
    InvalidVariableDefinitionException,
    InvalidVariableValueException,
    VariableChangeEvent,
    VariableDefinitionChangeEvent,
    VariableNotFoundException,
    VariableReadOnlyException
} from './global-variable-contracts';

describe('GlobalVariableRegistry (PLC-style Tag System)', () => {
    let registry: GlobalVariableRegistry;

    beforeEach(() => {
        registry = new GlobalVariableRegistry();
    });

    afterEach(() => {
        registry.dispose();
    });

    describe('Definition Management', () => {
        it('should define a variable with default values and auto-generated ID', () => {
            const def = registry.define({
                name: 'engine.rpm',
                type: 'UINT16',
                writable: true,
                unit: 'RPM',
                group: 'Engine'
            });

            expect(def.id).to.be.a('string').and.not.be.empty;
            expect(def.name).to.equal('engine.rpm');
            expect(def.type).to.equal('UINT16');
            expect(def.writable).to.be.true;

            const variable = registry.get(def.id);
            expect(variable).to.exist;
            expect(variable?.state.value).to.equal(0);
            expect(variable?.state.version).to.equal(1);
            expect(variable?.state.quality).to.equal('GOOD');
        });

        it('should reject invalid variable names', () => {
            expect(() => registry.define({ name: '', type: 'BOOL' }))
                .to.throw(InvalidVariableDefinitionException);
            expect(() => registry.define({ name: 'invalid name with spaces', type: 'BOOL' }))
                .to.throw(InvalidVariableDefinitionException);
            expect(() => registry.define({ name: 'name#with$symbols!', type: 'BOOL' }))
                .to.throw(InvalidVariableDefinitionException);
        });

        it('should reject duplicate variable names and duplicate IDs', () => {
            registry.define({ name: 'sensor.temp', type: 'FLOAT32' });
            expect(() => registry.define({ name: 'sensor.temp', type: 'FLOAT64' }))
                .to.throw(DuplicateVariableException);

            expect(() => registry.define({ id: createVariableId('my_custom_id'), name: 'sensor.press1', type: 'UINT32' })).to.not.throw();
            expect(() => registry.define({ id: createVariableId('my_custom_id'), name: 'sensor.press2', type: 'UINT32' }))
                .to.throw(DuplicateVariableException);
        });

        it('should validate string and bytes length requirements', () => {
            expect(() => registry.define({ name: 'serial.number', type: 'STRING', length: -5 }))
                .to.throw(InvalidVariableDefinitionException);
            expect(() => registry.define({ name: 'serial.number', type: 'STRING', length: 0 }))
                .to.throw(InvalidVariableDefinitionException);
            expect(() => registry.define({ name: 'serial.number', type: 'STRING', length: 3.14 }))
                .to.throw(InvalidVariableDefinitionException);
        });

        it('should update definition metadata and handle type changes', () => {
            const def = registry.define({ name: 'counter', type: 'UINT8', initialValue: 42 });
            const updated = registry.updateDefinition(def.id, { description: 'Main counter', unit: 'items' });

            expect(updated.description).to.equal('Main counter');
            expect(updated.unit).to.equal('items');

            // Renaming
            const renamed = registry.updateDefinition(def.id, { name: 'counter_renamed' });
            expect(renamed.name).to.equal('counter_renamed');
            expect(registry.findByName('counter_renamed')).to.exist;
            expect(registry.findByName('counter')).to.be.undefined;
        });

        it('should throw VariableNotFoundException when reading or updating non-existent variable', () => {
            expect(() => registry.updateDefinition('unknown_var', { description: 'test' }))
                .to.throw(VariableNotFoundException);
            expect(() => registry.write('unknown_var', 123))
                .to.throw(VariableNotFoundException);
        });

        it('should remove variable and clean up lookups', () => {
            const def = registry.define({ name: 'temp.var', type: 'BOOL' });
            expect(registry.remove(def.id)).to.be.true;
            expect(registry.get(def.id)).to.be.undefined;
            expect(registry.findByName('temp.var')).to.be.undefined;
            expect(registry.remove('non_existing_id')).to.be.false;
        });
    });

    describe('Type Validation & Value Constraints on Write', () => {
        it('should correctly handle BOOL type', () => {
            const def = registry.define({ name: 'sys.running', type: 'BOOL' });
            registry.write(def.id, true);
            expect(registry.read(def.id)?.value).to.be.true;

            registry.write(def.id, false);
            expect(registry.read(def.id)?.value).to.be.false;

            // Coercion from truthy/falsy strings/numbers
            registry.write(def.id, 1);
            expect(registry.read(def.id)?.value).to.be.true;
            registry.write(def.id, '0');
            expect(registry.read(def.id)?.value).to.be.false;

            expect(() => registry.write(def.id, 'invalid_bool')).to.throw(InvalidVariableValueException);
        });

        it('should enforce bounds on integer types (UINT8, INT8, UINT16, INT16, UINT32, INT32)', () => {
            const u8 = registry.define({ name: 'u8', type: 'UINT8' });
            registry.write(u8.id, 255);
            expect(registry.read(u8.id)?.value).to.equal(255);
            expect(() => registry.write(u8.id, -1)).to.throw(InvalidVariableValueException);
            expect(() => registry.write(u8.id, 256)).to.throw(InvalidVariableValueException);
            expect(() => registry.write(u8.id, 3.5)).to.throw(InvalidVariableValueException);
            // Verify previous state preserved
            expect(registry.read(u8.id)?.value).to.equal(255);

            const i8 = registry.define({ name: 'i8', type: 'INT8' });
            registry.write(i8.id, -128);
            registry.write(i8.id, 127);
            expect(() => registry.write(i8.id, -129)).to.throw(InvalidVariableValueException);
            expect(() => registry.write(i8.id, 128)).to.throw(InvalidVariableValueException);

            const u16 = registry.define({ name: 'u16', type: 'UINT16' });
            registry.write(u16.id, 65535);
            expect(() => registry.write(u16.id, 65536)).to.throw(InvalidVariableValueException);
            expect(() => registry.write(u16.id, -1)).to.throw(InvalidVariableValueException);

            const i16 = registry.define({ name: 'i16', type: 'INT16' });
            registry.write(i16.id, -32768);
            registry.write(i16.id, 32767);
            expect(() => registry.write(i16.id, 32768)).to.throw(InvalidVariableValueException);

            const u32 = registry.define({ name: 'u32', type: 'UINT32' });
            registry.write(u32.id, 4294967295);
            expect(() => registry.write(u32.id, 4294967296)).to.throw(InvalidVariableValueException);

            const i32 = registry.define({ name: 'i32', type: 'INT32' });
            registry.write(i32.id, -2147483648);
            registry.write(i32.id, 2147483647);
            expect(() => registry.write(i32.id, 2147483648)).to.throw(InvalidVariableValueException);
        });

        it('should validate FLOAT32 and FLOAT64 and reject non-finite numbers', () => {
            const f32 = registry.define({ name: 'f32', type: 'FLOAT32' });
            registry.write(f32.id, 3.14159);
            expect(registry.read(f32.id)?.value).to.be.closeTo(3.14159, 0.0001);

            const f64 = registry.define({ name: 'f64', type: 'FLOAT64' });
            registry.write(f64.id, 1.7976931348623157e+308);
            expect(registry.read(f64.id)?.value).to.equal(1.7976931348623157e+308);

            expect(() => registry.write(f64.id, Infinity)).to.throw(InvalidVariableValueException);
            expect(() => registry.write(f64.id, NaN)).to.throw(InvalidVariableValueException);
            expect(() => registry.write(f64.id, 'not_a_number')).to.throw(InvalidVariableValueException);
        });

        it('should validate STRING with optional length limit', () => {
            const strLimited = registry.define({ name: 'vin', type: 'STRING', length: 17 });
            registry.write(strLimited.id, 'WAUZZZ8V1GA123456');
            expect(registry.read(strLimited.id)?.value).to.equal('WAUZZZ8V1GA123456');

            expect(() => registry.write(strLimited.id, 'TOO_LONG_STRING_EXCEEDING_SEVENTEEN_CHARS'))
                .to.throw(InvalidVariableValueException);

            const strUnlimited = registry.define({ name: 'log', type: 'STRING' });
            registry.write(strUnlimited.id, 'Any arbitrary long string can fit here');
            expect(registry.read(strUnlimited.id)?.value).to.equal('Any arbitrary long string can fit here');
        });

        it('should validate BYTES with ArrayBuffer, Uint8Array, number array, and HEX string', () => {
            const bytesVar = registry.define({ name: 'payload', type: 'BYTES', length: 8 });

            // Uint8Array
            registry.write(bytesVar.id, new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]));
            let readBytes = registry.read(bytesVar.id)?.value as Uint8Array;
            expect(readBytes).to.be.instanceOf(Uint8Array);
            expect(Array.from(readBytes)).to.deep.equal([0xDE, 0xAD, 0xBE, 0xEF]);

            // Hex string
            registry.write(bytesVar.id, '0x0102030405060708');
            readBytes = registry.read(bytesVar.id)?.value as Uint8Array;
            expect(Array.from(readBytes)).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);

            // Byte array
            registry.write(bytesVar.id, [10, 20, 30]);
            readBytes = registry.read(bytesVar.id)?.value as Uint8Array;
            expect(Array.from(readBytes)).to.deep.equal([10, 20, 30]);

            // Length overflow
            expect(() => registry.write(bytesVar.id, new Uint8Array(9)))
                .to.throw(InvalidVariableValueException);

            // Invalid hex string
            expect(() => registry.write(bytesVar.id, 'INVALID_HEX_STRING_G'))
                .to.throw(InvalidVariableValueException);
        });

        it('should prevent write to read-only variables unless forced', () => {
            const roVar = registry.define({ name: 'firmware.version', type: 'STRING', writable: false, initialValue: 'v1.0.0' });
            expect(() => registry.write(roVar.id, 'v2.0.0')).to.throw(VariableReadOnlyException);
            expect(registry.read(roVar.id)?.value).to.equal('v1.0.0');

            // Force write from system
            registry.write(roVar.id, 'v2.0.0', { force: true, source: 'SYSTEM' });
            expect(registry.read(roVar.id)?.value).to.equal('v2.0.0');
        });
    });

    describe('Execution State, Versioning & Events', () => {
        it('should increment version monotonically and track quality and source', () => {
            const v = registry.define({ name: 'status', type: 'UINT8', initialValue: 0 });
            expect(registry.read(v.id)?.version).to.equal(1);

            const state2 = registry.write(v.id, 10, { source: 'CAN_BUS', quality: 'GOOD' });
            expect(state2.version).to.equal(2);
            expect(state2.source).to.equal('CAN_BUS');
            expect(state2.quality).to.equal('GOOD');

            const state3 = registry.write(v.id, 20, { quality: 'STALE' });
            expect(state3.version).to.equal(3);
            expect(state3.quality).to.equal('STALE');
        });

        it('should emit onDidVariableChange exactly once per accepted write', () => {
            const v = registry.define({ name: 'speed', type: 'FLOAT32' });
            const events: VariableChangeEvent[] = [];

            const sub = registry.onDidVariableChange(e => events.push(e));

            registry.write(v.id, 55.5);
            registry.write(v.id, 60.0);

            // Illegal write should not emit event
            expect(() => registry.write(v.id, NaN)).to.throw();

            expect(events).to.have.lengthOf(2);
            expect(events[0].state.value).to.be.closeTo(55.5, 0.001);
            expect(events[1].state.value).to.be.closeTo(60.0, 0.001);

            sub.dispose();
            registry.write(v.id, 70.0);
            expect(events).to.have.lengthOf(2);
        });

        it('should emit onDidDefinitionChange on define, update, and remove', () => {
            const defEvents: VariableDefinitionChangeEvent[] = [];
            registry.onDidDefinitionChange(e => defEvents.push(e));

            const def = registry.define({ name: 'pressure', type: 'FLOAT32' });
            registry.updateDefinition(def.id, { unit: 'bar' });
            registry.remove(def.id);

            expect(defEvents).to.have.lengthOf(3);
            expect(defEvents[0].type).to.equal('ADDED');
            expect(defEvents[1].type).to.equal('UPDATED');
            expect(defEvents[2].type).to.equal('REMOVED');
        });
    });

    describe('Serialization, Import & Export', () => {
        it('should export and import definitions seamlessly', () => {
            registry.define({ name: 'var1', type: 'UINT8', unit: 'mA' });
            registry.define({ name: 'var2', type: 'STRING', length: 32 });

            const json = registry.exportDefinitions();
            expect(json).to.be.a('string');

            const secondaryRegistry = new GlobalVariableRegistry();
            const imported = secondaryRegistry.importDefinitions(json);

            expect(imported).to.have.lengthOf(2);
            expect(secondaryRegistry.findByName('var1')?.definition.unit).to.equal('mA');
            expect(secondaryRegistry.findByName('var2')?.definition.length).to.equal(32);

            secondaryRegistry.dispose();
        });

        it('should export snapshot and restore state and values completely', () => {
            const v1 = registry.define({ name: 'temp', type: 'FLOAT32' });
            registry.write(v1.id, 75.3, { quality: 'GOOD', source: 'CAN_FRAME' });

            const snapshot = registry.exportSnapshot();

            const targetRegistry = new GlobalVariableRegistry();
            targetRegistry.importSnapshot(snapshot);

            const restored = targetRegistry.findByName('temp');
            expect(restored).to.exist;
            expect(restored?.state.value).to.be.closeTo(75.3, 0.001);
            expect(restored?.state.source).to.equal('CAN_FRAME');
            expect(restored?.state.quality).to.equal('GOOD');

            targetRegistry.dispose();
        });
    });
});
