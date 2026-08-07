// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Allocates the lowest available positive number for independently closable widgets. */
export class WidgetInstanceNumbers {
    protected readonly allocated = new Set<number>();

    public allocate(): number {
        let candidate = 1;
        while (this.allocated.has(candidate)) {
            candidate++;
        }
        this.allocated.add(candidate);
        return candidate;
    }

    public release(number: number): void {
        this.allocated.delete(number);
    }
}
