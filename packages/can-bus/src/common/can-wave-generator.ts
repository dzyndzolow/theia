// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type WaveShape = 'SINE' | 'TRIANGLE' | 'RAMP' | 'SQUARE_TOGGLE' | 'CONSTANT';

export interface WaveGeneratorConfig {
    readonly shape: WaveShape;
    readonly amplitude: number;
    readonly frequencyHz: number;
    readonly offset?: number;
    readonly phaseRad?: number;
    readonly minLimit?: number;
    readonly maxLimit?: number;
}

export class CanWaveGenerator {
    static evaluateAt(config: WaveGeneratorConfig, timeSec: number): number {
        const offset = config.offset !== undefined ? config.offset : 0;
        const phase = config.phaseRad !== undefined ? config.phaseRad : 0;
        const freq = config.frequencyHz;
        const amp = config.amplitude;

        let rawVal = 0;

        switch (config.shape) {
            case 'CONSTANT':
                rawVal = offset;
                break;

            case 'SINE': {
                const angle = 2 * Math.PI * freq * timeSec + phase;
                rawVal = offset + amp * Math.sin(angle);
                break;
            }

            case 'TRIANGLE': {
                if (freq <= 0) {
                    rawVal = offset;
                } else {
                    const period = 1 / freq;
                    const tNorm = ((timeSec + (phase / (2 * Math.PI * freq))) % period + period) % period;
                    const fraction = tNorm / period;
                    // Triangle going from -1 to 1 and back
                    const tri = fraction < 0.5 ? (fraction * 4 - 1) : ((1 - fraction) * 4 - 1);
                    rawVal = offset + amp * tri;
                }
                break;
            }

            case 'RAMP': {
                if (freq <= 0) {
                    rawVal = offset;
                } else {
                    const period = 1 / freq;
                    const tNorm = ((timeSec + (phase / (2 * Math.PI * freq))) % period + period) % period;
                    const fraction = tNorm / period; // 0 to 1
                    rawVal = offset + amp * fraction;
                }
                break;
            }

            case 'SQUARE_TOGGLE': {
                if (freq <= 0) {
                    rawVal = offset + amp;
                } else {
                    const period = 1 / freq;
                    const tNorm = ((timeSec + (phase / (2 * Math.PI * freq))) % period + period) % period;
                    const isHigh = (tNorm / period) < 0.5;
                    rawVal = offset + (isHigh ? amp : -amp);
                }
                break;
            }
        }

        // Clamp to limits if configured
        if (config.minLimit !== undefined && rawVal < config.minLimit) {
            rawVal = config.minLimit;
        }
        if (config.maxLimit !== undefined && rawVal > config.maxLimit) {
            rawVal = config.maxLimit;
        }

        return rawVal;
    }

    static generateSequence(
        config: WaveGeneratorConfig,
        durationSec: number,
        sampleRateHz: number
    ): number[] {
        const samples: number[] = [];
        const totalSamples = Math.round(durationSec * sampleRateHz);
        const dt = 1 / sampleRateHz;

        for (let i = 0; i < totalSamples; i++) {
            samples.push(this.evaluateAt(config, i * dt));
        }

        return samples;
    }
}
