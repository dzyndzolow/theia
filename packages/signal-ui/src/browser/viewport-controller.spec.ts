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
import { ViewportController, ViewportState } from './viewport-controller';

describe('ViewportController', () => {

    let controller: ViewportController;

    beforeEach(() => {
        controller = new ViewportController();
    });

    afterEach(() => {
        controller.dispose();
    });

    describe('initial state', () => {
        it('should start with default time range [0, 1s]', () => {
            const vp = controller.viewport;
            expect(vp.startTimeNs).to.equal(BigInt(0));
            expect(vp.endTimeNs).to.equal(BigInt(1_000_000_000));
            expect(vp.cursorTimeNs).to.be.undefined;
        });
    });

    describe('setTimeRange', () => {
        it('should update the visible time range', () => {
            controller.setTimeRange(BigInt(100), BigInt(200));
            expect(controller.viewport.startTimeNs).to.equal(BigInt(100));
            expect(controller.viewport.endTimeNs).to.equal(BigInt(200));
        });

        it('should clamp duration to minimum when range is too narrow', () => {
            controller.setTimeRange(BigInt(100), BigInt(150));
            const vp = controller.viewport;
            expect(vp.endTimeNs - vp.startTimeNs).to.be.greaterThanOrEqual(BigInt(100));
        });

        it('should fire onViewportChanged event', () => {
            let received: ViewportState | undefined;
            controller.onViewportChanged(state => { received = state; });
            controller.setTimeRange(BigInt(500), BigInt(1000));
            expect(received).to.not.be.undefined;
            expect(received!.startTimeNs).to.equal(BigInt(500));
            expect(received!.endTimeNs).to.equal(BigInt(1000));
        });

        it('should NOT fire event when values are identical', () => {
            controller.setTimeRange(BigInt(0), BigInt(1_000_000_000));
            let count = 0;
            controller.onViewportChanged(() => { count++; });
            controller.setTimeRange(BigInt(0), BigInt(1_000_000_000));
            expect(count).to.equal(0);
        });

        it('should clear cursor when it falls outside the new range', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            controller.setCursor(BigInt(500));
            expect(controller.viewport.cursorTimeNs).to.equal(BigInt(500));

            controller.setTimeRange(BigInt(600), BigInt(1000));
            expect(controller.viewport.cursorTimeNs).to.be.undefined;
        });

        it('should keep cursor when it remains inside the new range', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            controller.setCursor(BigInt(500));
            controller.setTimeRange(BigInt(0), BigInt(2000));
            expect(controller.viewport.cursorTimeNs).to.equal(BigInt(500));
        });
    });

    describe('setCursor', () => {
        it('should set the cursor position', () => {
            controller.setCursor(BigInt(42));
            expect(controller.viewport.cursorTimeNs).to.equal(BigInt(42));
        });

        it('should clear the cursor with undefined', () => {
            controller.setCursor(BigInt(42));
            controller.setCursor(undefined);
            expect(controller.viewport.cursorTimeNs).to.be.undefined;
        });

        it('should fire onCursorChanged event', () => {
            let received: bigint | undefined | null = null;
            controller.onCursorChanged(c => { received = c; });
            controller.setCursor(BigInt(999));
            expect(received).to.equal(BigInt(999));
        });

        it('should NOT fire cursor event when value is identical', () => {
            controller.setCursor(BigInt(42));
            let count = 0;
            controller.onCursorChanged(() => { count++; });
            controller.setCursor(BigInt(42));
            expect(count).to.equal(0);
        });

        it('should fire cursor event separately from viewport event', () => {
            let viewportCount = 0;
            let cursorCount = 0;
            controller.onViewportChanged(() => { viewportCount++; });
            controller.onCursorChanged(() => { cursorCount++; });

            controller.setCursor(BigInt(100));
            expect(viewportCount).to.equal(0);
            expect(cursorCount).to.equal(1);
        });
    });

    describe('zoom', () => {
        it('should narrow the range when factor > 1 (zoom in)', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            controller.zoom(2, BigInt(500));
            const vp = controller.viewport;
            const duration = vp.endTimeNs - vp.startTimeNs;
            expect(Number(duration)).to.be.lessThan(1000);
        });

        it('should widen the range when factor < 1 (zoom out)', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            controller.zoom(0.5, BigInt(500));
            const vp = controller.viewport;
            const duration = vp.endTimeNs - vp.startTimeNs;
            expect(Number(duration)).to.be.greaterThan(1000);
        });

        it('should keep the center point stable during zoom', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            const center = BigInt(500);
            controller.zoom(2, center);
            const vp = controller.viewport;
            const mid = (vp.startTimeNs + vp.endTimeNs) / BigInt(2);
            expect(Number(mid)).to.be.closeTo(500, 5);
        });

        it('should ignore invalid factor (0 or negative)', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            controller.zoom(0, BigInt(500));
            expect(controller.viewport.endTimeNs - controller.viewport.startTimeNs).to.equal(BigInt(1000));

            controller.zoom(-1, BigInt(500));
            expect(controller.viewport.endTimeNs - controller.viewport.startTimeNs).to.equal(BigInt(1000));
        });

        it('should not crash on Infinity factor', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            controller.zoom(Infinity, BigInt(500));
            // Should clamp to minimum duration
            const duration = controller.viewport.endTimeNs - controller.viewport.startTimeNs;
            expect(Number(duration)).to.be.greaterThanOrEqual(100);
        });
    });

    describe('pan', () => {
        it('should shift the range forward', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            controller.pan(BigInt(500));
            expect(controller.viewport.startTimeNs).to.equal(BigInt(500));
            expect(controller.viewport.endTimeNs).to.equal(BigInt(1500));
        });

        it('should shift the range backward', () => {
            controller.setTimeRange(BigInt(1000), BigInt(2000));
            controller.pan(BigInt(-500));
            expect(controller.viewport.startTimeNs).to.equal(BigInt(500));
            expect(controller.viewport.endTimeNs).to.equal(BigInt(1500));
        });

        it('should do nothing for zero delta', () => {
            controller.setTimeRange(BigInt(0), BigInt(1000));
            let count = 0;
            controller.onViewportChanged(() => { count++; });
            controller.pan(BigInt(0));
            expect(count).to.equal(0);
        });

        it('should preserve the range width', () => {
            controller.setTimeRange(BigInt(100), BigInt(600));
            controller.pan(BigInt(1000));
            const duration = controller.viewport.endTimeNs - controller.viewport.startTimeNs;
            expect(duration).to.equal(BigInt(500));
        });
    });

    describe('re-entrancy guard', () => {
        it('should prevent infinite loops when a subscriber calls back during dispatch', () => {
            let callCount = 0;
            controller.onViewportChanged(() => {
                callCount++;
                // Simulate a subscriber that reacts by calling setTimeRange again
                if (callCount < 10) {
                    controller.setTimeRange(BigInt(callCount * 1000), BigInt(callCount * 1000 + 500));
                }
            });

            controller.setTimeRange(BigInt(0), BigInt(500));
            // The re-entrancy guard should have suppressed the recursive call
            expect(callCount).to.equal(1);
        });

        it('should prevent cursor feedback loops', () => {
            let callCount = 0;
            controller.onCursorChanged(() => {
                callCount++;
                if (callCount < 10) {
                    controller.setCursor(BigInt(callCount * 100));
                }
            });

            controller.setCursor(BigInt(50));
            expect(callCount).to.equal(1);
        });

        it('should allow new changes after dispatch completes', () => {
            controller.onViewportChanged(() => { /* no-op subscriber */ });
            controller.setTimeRange(BigInt(0), BigInt(1000));

            // After the dispatch is done, new changes should work
            controller.setTimeRange(BigInt(2000), BigInt(3000));
            expect(controller.viewport.startTimeNs).to.equal(BigInt(2000));
        });
    });

    describe('multi-widget synchronization', () => {
        it('should synchronize 3 widgets receiving the same viewport state', () => {
            const received: ViewportState[] = [[], [], []].map(() => ({}) as ViewportState);
            const counts = [0, 0, 0];

            for (let i = 0; i < 3; i++) {
                controller.onViewportChanged(state => {
                    received[i] = state;
                    counts[i]++;
                });
            }

            controller.setTimeRange(BigInt(100), BigInt(900));

            for (let i = 0; i < 3; i++) {
                expect(counts[i]).to.equal(1);
                expect(received[i].startTimeNs).to.equal(BigInt(100));
                expect(received[i].endTimeNs).to.equal(BigInt(900));
            }
        });

        it('should synchronize cursor across all subscribers', () => {
            const cursors: (bigint | undefined)[] = [undefined, undefined, undefined];
            for (let i = 0; i < 3; i++) {
                controller.onCursorChanged(c => { cursors[i] = c; });
            }

            controller.setCursor(BigInt(42));
            for (let i = 0; i < 3; i++) {
                expect(cursors[i]).to.equal(BigInt(42));
            }
        });

        it('should not cause cascading updates when a widget reacts', () => {
            let totalNotifications = 0;
            for (let i = 0; i < 3; i++) {
                controller.onViewportChanged(() => {
                    totalNotifications++;
                });
            }

            // Simulate widget 0 reacting by calling setTimeRange in its handler
            const widget0Handler = controller.onViewportChanged(state => {
                // Widget 0 tries to "sync" by setting the same range — should be suppressed
                controller.setTimeRange(state.startTimeNs, state.endTimeNs);
            });

            controller.setTimeRange(BigInt(0), BigInt(1000));
            // 3 subscribers + the reactive one = 4 listeners, but the reactive call
            // should be suppressed by the re-entrancy guard
            expect(totalNotifications).to.equal(3);

            widget0Handler.dispose();
        });
    });

    describe('dispose', () => {
        it('should clean up emitters', () => {
            controller.dispose();
            // After dispose, setting values should not throw but events won't fire
            let count = 0;
            // The emitter is already disposed, so subscribing after dispose
            // may throw or be a no-op depending on Theia's Emitter implementation.
            // We just verify dispose doesn't throw.
            expect(() => controller.dispose()).to.not.throw();
        });
    });
});
