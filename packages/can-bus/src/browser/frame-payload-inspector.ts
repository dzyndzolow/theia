// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from '../common/can-protocol';

export interface PayloadSelection {
    readonly startByte: number;
    readonly byteLength: number;
}

/** Read-only HEX, binary and ASCII inspector for the currently selected frame. */
export class FramePayloadInspector {
    readonly node: HTMLDivElement;
    protected readonly title: HTMLHeadingElement;
    protected readonly hex: HTMLDivElement;
    protected readonly ascii: HTMLDivElement;
    protected readonly bits: HTMLDivElement;
    protected readonly listeners = new Set<(selection: PayloadSelection) => void>();
    protected frame: CanFrame | undefined;
    protected selectedByte = 0;

    constructor() {
        this.node = document.createElement('div');
        this.node.className = 'can-payload-inspector';
        this.title = document.createElement('h3');
        this.title.textContent = 'Frame Payload Inspector';
        this.hex = document.createElement('div');
        this.hex.className = 'can-payload-hex';
        this.ascii = document.createElement('div');
        this.ascii.className = 'can-payload-ascii';
        this.bits = document.createElement('div');
        this.bits.className = 'can-payload-bits';
        this.node.append(this.title, this.hex, this.ascii, this.bits);
        this.render();
    }

    public onDidSelect(listener: (selection: PayloadSelection) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    public setFrame(frame: CanFrame | undefined): void {
        this.frame = frame;
        this.selectedByte = 0;
        this.render();
        if (frame && frame.data.length > 0) {
            this.notifySelection();
        }
    }

    protected render(): void {
        this.hex.replaceChildren();
        this.ascii.replaceChildren();
        this.bits.replaceChildren();
        if (!this.frame || this.frame.data.length === 0) {
            this.title.textContent = 'Frame Payload Inspector — select a matrix row';
            return;
        }

        this.title.textContent = `Frame Payload Inspector — 0x${this.frame.id.toString(16).toUpperCase()}`;
        this.frame.data.forEach((value, index) => {
            const byte = document.createElement('button');
            byte.className = `can-payload-byte${index === this.selectedByte ? ' selected' : ''}`;
            byte.type = 'button';
            byte.textContent = value.toString(16).padStart(2, '0').toUpperCase();
            byte.title = `Byte ${index}`;
            byte.onclick = () => {
                this.selectedByte = index;
                this.render();
                this.notifySelection();
            };
            this.hex.appendChild(byte);

            const character = document.createElement('span');
            character.className = `can-payload-character${index === this.selectedByte ? ' selected' : ''}`;
            character.textContent = value >= 32 && value <= 126 ? String.fromCharCode(value) : '.';
            this.ascii.appendChild(character);
        });

        const selectedValue = this.frame.data[this.selectedByte];
        this.bits.textContent = `Byte ${this.selectedByte}: ${selectedValue.toString(2).padStart(8, '0')}`;
    }

    protected notifySelection(): void {
        const selection: PayloadSelection = { startByte: this.selectedByte, byteLength: 1 };
        for (const listener of this.listeners) {
            listener(selection);
        }
    }
}
