// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';

export interface ViewportState {
    readonly startTimeNs: bigint;
    readonly endTimeNs: bigint;
    readonly cursorTimeNs: bigint | undefined;
}

export interface ViewportResizeEvent {
    readonly width: number;
    readonly height: number;
}

const DEFAULT_VIEWPORT: ViewportState = {
    startTimeNs: BigInt(0),
    endTimeNs: BigInt(1_000_000_000),
    cursorTimeNs: undefined
};

const MIN_DURATION_NS = BigInt(100);
const RESIZE_DEBOUNCE_MS = 50;

/**
 * Central coordinator for the visible time range and cursor position
 * across all signal-analyzer widgets in a single workspace.
 *
 * Widgets subscribe via `onViewportChanged` / `onCursorChanged` and receive
 * updates when any other participant calls `setTimeRange`, `setCursor`,
 * `zoom` or `pan`.  A re-entrancy guard prevents infinite event loops when
 * a subscriber reacts to a notification by calling back into the controller.
 */
@injectable()
export class ViewportController implements Disposable {

    private state: ViewportState = { ...DEFAULT_VIEWPORT };

    private readonly onViewportChangedEmitter = new Emitter<ViewportState>();
    readonly onViewportChanged: Event<ViewportState> = this.onViewportChangedEmitter.event;

    private readonly onCursorChangedEmitter = new Emitter<bigint | undefined>();
    readonly onCursorChanged: Event<bigint | undefined> = this.onCursorChangedEmitter.event;

    private readonly onResizeEmitter = new Emitter<ViewportResizeEvent>();
    readonly onResize: Event<ViewportResizeEvent> = this.onResizeEmitter.event;

    private readonly toDispose = new DisposableCollection();
    private resizeObserver: ResizeObserver | undefined;
    private resizeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    private lastResizeWidth = 0;
    private lastResizeHeight = 0;

    /**
     * Re-entrancy guard.  While `true`, calls to `setTimeRange` / `setCursor`
     * are silently ignored so that a subscriber reacting to a notification
     * cannot trigger another notification cycle.
     */
    private dispatching = false;

    constructor() {
        this.toDispose.push(this.onViewportChangedEmitter);
        this.toDispose.push(this.onCursorChangedEmitter);
        this.toDispose.push(this.onResizeEmitter);
    }

    get viewport(): ViewportState {
        return this.state;
    }

    /**
     * Replace the visible time range.  Clamps `endTimeNs` so that it is
     * strictly greater than `startTimeNs` by at least `MIN_DURATION_NS`.
     * Preserves the current cursor if it still falls inside the new range.
     */
    setTimeRange(startNs: bigint, endNs: bigint): void {
        if (this.dispatching) {
            return;
        }
        const duration = endNs - startNs;
        if (duration < MIN_DURATION_NS) {
            endNs = startNs + MIN_DURATION_NS;
        }
        if (startNs === this.state.startTimeNs && endNs === this.state.endTimeNs) {
            return;
        }
        const cursor = this.state.cursorTimeNs;
        const newCursor = (cursor !== undefined && cursor >= startNs && cursor <= endNs)
            ? cursor
            : undefined;
        this.applyState({ startTimeNs: startNs, endTimeNs: endNs, cursorTimeNs: newCursor });
    }

    setCursor(timeNs: bigint | undefined): void {
        if (this.dispatching) {
            return;
        }
        if (timeNs === this.state.cursorTimeNs) {
            return;
        }
        this.applyState({ ...this.state, cursorTimeNs: timeNs });
    }

    /**
     * Zoom by `factor` around `centerTimeNs`.
     * factor > 1 → zoom in (narrower range), factor < 1 → zoom out.
     */
    zoom(factor: number, centerTimeNs: bigint): void {
        if (factor <= 0 || !Number.isFinite(factor)) {
            return;
        }
        const { startTimeNs, endTimeNs } = this.state;
        const currentDuration = endTimeNs - startTimeNs;
        const newDuration = BigInt(Math.max(Number(MIN_DURATION_NS), Math.round(Number(currentDuration) / factor)));
        const centerOffset = centerTimeNs - startTimeNs;
        const ratio = Number(currentDuration) > 0
            ? Number(centerOffset) / Number(currentDuration)
            : 0.5;
        const newStart = centerTimeNs - BigInt(Math.round(Number(newDuration) * ratio));
        const newEnd = newStart + newDuration;
        this.setTimeRange(newStart, newEnd);
    }

    /**
     * Shift the visible range by `deltaNs` without changing its width.
     */
    pan(deltaNs: bigint): void {
        if (deltaNs === BigInt(0)) {
            return;
        }
        this.setTimeRange(
            this.state.startTimeNs + deltaNs,
            this.state.endTimeNs + deltaNs
        );
    }

    /**
     * Attach a ResizeObserver to the given DOM element.  Resize events are
     * debounced by `RESIZE_DEBOUNCE_MS` and only emitted when the dimensions
     * actually changed.
     *
     * Returns a Disposable that disconnects the observer.
     */
    observeResize(element: HTMLElement): Disposable {
        if (typeof ResizeObserver === 'undefined') {
            return Disposable.NULL;
        }
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                const w = Math.round(width);
                const h = Math.round(height);
                if (w === this.lastResizeWidth && h === this.lastResizeHeight) {
                    continue;
                }
                this.lastResizeWidth = w;
                this.lastResizeHeight = h;
                if (this.resizeDebounceTimer) {
                    clearTimeout(this.resizeDebounceTimer);
                }
                this.resizeDebounceTimer = setTimeout(() => {
                    this.resizeDebounceTimer = undefined;
                    this.onResizeEmitter.fire({ width: w, height: h });
                }, RESIZE_DEBOUNCE_MS);
            }
        });
        observer.observe(element);
        const disposable = Disposable.create(() => {
            observer.disconnect();
            if (this.resizeDebounceTimer) {
                clearTimeout(this.resizeDebounceTimer);
                this.resizeDebounceTimer = undefined;
            }
        });
        this.toDispose.push(disposable);
        return disposable;
    }

    private applyState(next: ViewportState): void {
        const prevViewport = this.state;
        const prevCursor = prevViewport.cursorTimeNs;
        this.state = next;

        this.dispatching = true;
        try {
            if (next.startTimeNs !== prevViewport.startTimeNs || next.endTimeNs !== prevViewport.endTimeNs) {
                this.onViewportChangedEmitter.fire(next);
            }
            if (next.cursorTimeNs !== prevCursor) {
                this.onCursorChangedEmitter.fire(next.cursorTimeNs);
            }
        } finally {
            this.dispatching = false;
        }
    }

    dispose(): void {
        this.toDispose.dispose();
    }
}
