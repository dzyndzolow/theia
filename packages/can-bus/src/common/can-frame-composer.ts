// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from './can-protocol';

export type DynamicFieldType =
    | 'UINT8'
    | 'UINT16_LE'
    | 'UINT16_BE'
    | 'INT16_LE'
    | 'INT16_BE'
    | 'UINT32_LE'
    | 'UINT32_BE';

export interface DynamicFieldBinding {
    readonly variableName: string;
    readonly targetByte: number;
    readonly dataType: DynamicFieldType;
    readonly scale?: number;
    readonly offset?: number;
    readonly fallbackValue?: number;
}

export interface FrameCompositionTemplate {
    readonly id: number;
    readonly extended?: boolean;
    readonly dlc?: number;
    readonly baseData: readonly number[];
    readonly bindings: readonly DynamicFieldBinding[];
}

export class CanFrameComposer {
    static composeFrame(
        template: FrameCompositionTemplate,
        variables: ReadonlyMap<string, number> | Record<string, number>
    ): CanFrame {
        const dlc = template.dlc !== undefined ? template.dlc : 8;
        const payload = [...template.baseData];
        while (payload.length < dlc) {
            payload.push(0);
        }

        const getVar = (name: string): number | undefined => {
            if (variables instanceof Map) {
                return variables.get(name);
            }
            return (variables as Record<string, number>)[name];
        };

        for (const binding of template.bindings) {
            let val = getVar(binding.variableName);
            if (val === undefined) {
                val = binding.fallbackValue !== undefined ? binding.fallbackValue : 0;
            }

            const scale = binding.scale !== undefined && binding.scale !== 0 ? binding.scale : 1.0;
            const offset = binding.offset !== undefined ? binding.offset : 0.0;
            const rawVal = Math.round((val - offset) / scale);

            const startByte = binding.targetByte;

            switch (binding.dataType) {
                case 'UINT8':
                    if (startByte < dlc) {
                        payload[startByte] = rawVal & 0xFF;
                    }
                    break;

                case 'UINT16_LE':
                case 'INT16_LE':
                    if (startByte + 1 < dlc) {
                        payload[startByte] = rawVal & 0xFF;
                        payload[startByte + 1] = (rawVal >> 8) & 0xFF;
                    }
                    break;

                case 'UINT16_BE':
                case 'INT16_BE':
                    if (startByte + 1 < dlc) {
                        payload[startByte] = (rawVal >> 8) & 0xFF;
                        payload[startByte + 1] = rawVal & 0xFF;
                    }
                    break;

                case 'UINT32_LE':
                    if (startByte + 3 < dlc) {
                        payload[startByte] = rawVal & 0xFF;
                        payload[startByte + 1] = (rawVal >> 8) & 0xFF;
                        payload[startByte + 2] = (rawVal >> 16) & 0xFF;
                        payload[startByte + 3] = (rawVal >> 24) & 0xFF;
                    }
                    break;

                case 'UINT32_BE':
                    if (startByte + 3 < dlc) {
                        payload[startByte] = (rawVal >> 24) & 0xFF;
                        payload[startByte + 1] = (rawVal >> 16) & 0xFF;
                        payload[startByte + 2] = (rawVal >> 8) & 0xFF;
                        payload[startByte + 3] = rawVal & 0xFF;
                    }
                    break;
            }
        }

        return {
            id: template.id,
            extended: !!template.extended,
            rtr: false,
            dlc,
            data: payload,
            timestamp: Date.now(),
            interface: 'vcan0'
        };
    }
}
