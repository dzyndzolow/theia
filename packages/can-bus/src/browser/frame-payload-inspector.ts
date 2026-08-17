// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from '../common/can-protocol';

export interface PayloadSelection {
    readonly startByte: number;
    readonly byteLength: number;
    readonly startBit?: number; // 0..7 (0 = LSB, 7 = MSB)
    readonly bitLength?: number; // 1..8
    readonly isBitSelection?: boolean;
}

export interface InspectorBindRequest {
    readonly frame: CanFrame;
    readonly selection: PayloadSelection;
}

/** Read-only HEX, binary, and interactive bit inspector for the currently selected frame. */
export class FramePayloadInspector {
    readonly node: HTMLDivElement;
    protected readonly headerRow: HTMLDivElement;
    protected readonly title: HTMLHeadingElement;
    protected readonly bindBtn: HTMLButtonElement;
    protected readonly hex: HTMLDivElement;
    protected readonly ascii: HTMLDivElement;
    protected readonly bitsContainer: HTMLDivElement;
    protected readonly bitsHeader: HTMLDivElement;
    protected readonly bitsGrid: HTMLDivElement;
    protected readonly selectionHint: HTMLDivElement;
    protected readonly selectionControls: HTMLDivElement;
    protected readonly startByteInput: HTMLInputElement;
    protected readonly byteLengthInput: HTMLInputElement;
    protected readonly startBitInput: HTMLInputElement;
    protected readonly bitLengthInput: HTMLInputElement;
    protected readonly bitSelectionCheckbox: HTMLInputElement;

    protected readonly listeners = new Set<(selection: PayloadSelection) => void>();
    protected readonly bindListeners = new Set<(request: InspectorBindRequest) => void>();
    protected frame: CanFrame | undefined;
    protected selectionAnchor = 0;
    protected selectionEnd = 0;
    protected selectedBitIndex = 0;
    protected selectedBitLength = 1;
    protected isBitSelectionActive = false;
    protected selectingWithMouse = false;

    // Cache of byte elements to prevent flickering/lost clicks on live frame updates
    protected byteButtons: HTMLButtonElement[] = [];
    protected asciiSpans: HTMLSpanElement[] = [];
    protected bitButtons: HTMLButtonElement[] = [];

    constructor() {
        this.node = document.createElement('div');
        this.node.className = 'can-payload-inspector';

        this.headerRow = document.createElement('div');
        this.headerRow.className = 'can-payload-header-row';

        this.title = document.createElement('h3');
        this.title.textContent = 'Frame Payload Inspector';

        this.bindBtn = document.createElement('button');
        this.bindBtn.className = 'theia-button primary can-bind-variable-btn';
        this.bindBtn.innerHTML = '<i class="fa fa-link"></i> Bind to Variable';
        this.bindBtn.title = 'Assign the selected byte/bit directly to a Global Variable';
        this.bindBtn.onclick = () => this.handleBindClick();

        this.headerRow.append(this.title, this.bindBtn);

        this.selectionHint = document.createElement('div');
        this.selectionHint.className = 'can-payload-selection-hint';

        this.selectionControls = document.createElement('div');
        this.selectionControls.className = 'can-payload-selection-controls';

        this.startByteInput = this.createSelectionInput('Start byte', '0', () => this.selectRangeFromControls());
        this.byteLengthInput = this.createSelectionInput('Length', '1', () => this.selectRangeFromControls());

        // Bit mode controls
        this.startBitInput = this.createSelectionInput('Start bit (0-7)', '0', () => this.selectBitFromControls());
        this.startBitInput.min = '0';
        this.startBitInput.max = '7';

        this.bitLengthInput = this.createSelectionInput('Bits', '1', () => this.selectBitFromControls());
        this.bitLengthInput.min = '1';
        this.bitLengthInput.max = '8';

        const bitModeLabel = document.createElement('label');
        bitModeLabel.className = 'can-payload-bitmode-label';
        this.bitSelectionCheckbox = document.createElement('input');
        this.bitSelectionCheckbox.type = 'checkbox';
        this.bitSelectionCheckbox.onchange = () => {
            this.isBitSelectionActive = this.bitSelectionCheckbox.checked;
            this.render();
            this.notifySelection();
        };
        bitModeLabel.append(this.bitSelectionCheckbox, document.createTextNode(' Single Bit'));

        this.selectionControls.append(
            this.startByteInput.parentElement!,
            this.byteLengthInput.parentElement!,
            bitModeLabel,
            this.startBitInput.parentElement!,
            this.bitLengthInput.parentElement!
        );

        this.hex = document.createElement('div');
        this.hex.className = 'can-payload-hex';

        this.ascii = document.createElement('div');
        this.ascii.className = 'can-payload-ascii';

        this.bitsContainer = document.createElement('div');
        this.bitsContainer.className = 'can-payload-bits-container';

        this.bitsHeader = document.createElement('div');
        this.bitsHeader.className = 'can-payload-bits-header';

        this.bitsGrid = document.createElement('div');
        this.bitsGrid.className = 'can-payload-bits-grid';

        this.bitsContainer.append(this.bitsHeader, this.bitsGrid);

        this.node.append(
            this.headerRow,
            this.selectionHint,
            this.selectionControls,
            this.hex,
            this.ascii,
            this.bitsContainer
        );

        this.node.onmouseup = () => this.selectingWithMouse = false;
        this.node.onmouseleave = () => this.selectingWithMouse = false;

        this.render();
    }

    public onDidSelect(listener: (selection: PayloadSelection) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    public onDidRequestBind(listener: (request: InspectorBindRequest) => void): { dispose(): void } {
        this.bindListeners.add(listener);
        return { dispose: () => this.bindListeners.delete(listener) };
    }

    protected handleBindClick(): void {
        if (!this.frame) {
            return;
        }
        const request: InspectorBindRequest = {
            frame: this.frame,
            selection: this.getSelection()
        };
        for (const listener of this.bindListeners) {
            listener(request);
        }
    }

    public setFrame(frame: CanFrame | undefined, preserveSelection = false): void {
        this.frame = frame;
        if (!preserveSelection) {
            this.selectionAnchor = 0;
            this.selectionEnd = 0;
            this.selectedBitIndex = 0;
            this.selectedBitLength = 1;
            this.isBitSelectionActive = false;
        }
        this.render();
        if (!preserveSelection && frame && frame.data.length > 0) {
            this.notifySelection();
        }
    }

    /** Updates the visual range without emitting another selection event. */
    public setSelection(selection: PayloadSelection): void {
        this.selectionAnchor = Math.max(0, selection.startByte);
        this.selectionEnd = this.selectionAnchor + Math.max(1, selection.byteLength) - 1;
        if (selection.startBit !== undefined) {
            this.selectedBitIndex = selection.startBit;
        }
        if (selection.bitLength !== undefined) {
            this.selectedBitLength = selection.bitLength;
        }
        if (selection.isBitSelection !== undefined) {
            this.isBitSelectionActive = selection.isBitSelection;
        }
        this.render();
    }

    public getSelection(): PayloadSelection {
        const startByte = Math.min(this.selectionAnchor, this.selectionEnd);
        const byteLength = Math.abs(this.selectionEnd - this.selectionAnchor) + 1;
        return {
            startByte,
            byteLength,
            startBit: this.selectedBitIndex,
            bitLength: this.selectedBitLength,
            isBitSelection: this.isBitSelectionActive
        };
    }

    protected render(): void {
        if (!this.frame || this.frame.data.length === 0) {
            this.title.textContent = 'Frame Payload Inspector — select a matrix row';
            this.bindBtn.disabled = true;
            this.selectionHint.textContent = '';
            this.bitsHeader.textContent = '';
            this.hex.replaceChildren();
            this.ascii.replaceChildren();
            this.bitsGrid.replaceChildren();
            this.byteButtons = [];
            this.asciiSpans = [];
            this.bitButtons = [];
            this.syncSelectionControls({ startByte: 0, byteLength: 1 });
            return;
        }

        this.bindBtn.disabled = false;
        this.title.textContent = `Frame Payload Inspector — 0x${this.frame.id.toString(16).toUpperCase()}`;
        const selection = this.getSelection();
        this.syncSelectionControls(selection);
        this.selectionHint.textContent = 'Click a byte or drag across HEX bytes. Click a bit below for single-bit tracking.';

        const dataLen = this.frame.data.length;

        // Rebuild or reuse byte elements
        if (this.byteButtons.length !== dataLen) {
            this.hex.replaceChildren();
            this.ascii.replaceChildren();
            this.byteButtons = [];
            this.asciiSpans = [];

            for (let i = 0; i < dataLen; i++) {
                const byteBtn = document.createElement('button');
                byteBtn.className = 'can-payload-byte';
                byteBtn.type = 'button';

                // Robust click and drag handlers
                byteBtn.onpointerdown = event => {
                    if (event.button !== 0) {
                        return;
                    }
                    event.preventDefault();
                    this.selectingWithMouse = true;
                    this.selectionAnchor = i;
                    this.selectionEnd = i;
                    this.isBitSelectionActive = false;
                    this.bitSelectionCheckbox.checked = false;
                    this.render();
                    this.notifySelection();
                };

                byteBtn.onpointerenter = () => {
                    if (!this.selectingWithMouse) {
                        return;
                    }
                    this.selectionEnd = i;
                    this.render();
                    this.notifySelection();
                };

                this.hex.appendChild(byteBtn);
                this.byteButtons.push(byteBtn);

                const asciiSpan = document.createElement('span');
                asciiSpan.className = 'can-payload-character';
                this.ascii.appendChild(asciiSpan);
                this.asciiSpans.push(asciiSpan);
            }
        }

        // Update values and selected classes for bytes
        this.frame.data.forEach((value, index) => {
            const isSelected = index >= selection.startByte && index < selection.startByte + selection.byteLength;
            const byteBtn = this.byteButtons[index];
            if (byteBtn) {
                byteBtn.textContent = value.toString(16).padStart(2, '0').toUpperCase();
                byteBtn.title = `Byte ${index} (0x${value.toString(16).toUpperCase().padStart(2, '0')})`;
                byteBtn.classList.toggle('selected', isSelected);
            }

            const asciiSpan = this.asciiSpans[index];
            if (asciiSpan) {
                asciiSpan.textContent = value >= 32 && value <= 126 ? String.fromCharCode(value) : '.';
                asciiSpan.classList.toggle('selected', isSelected);
            }
        });

        // Render Bits for the selected byte
        const targetByteIndex = Math.min(dataLen - 1, selection.startByte);
        const targetByteValue = this.frame.data[targetByteIndex] ?? 0;
        const binaryStr = targetByteValue.toString(2).padStart(8, '0');

        this.bitsHeader.textContent = `Byte ${targetByteIndex} Bits (Binary: 0b${binaryStr}):`;

        // Rebuild or reuse bit buttons (8 bits: 7 down to 0)
        if (this.bitButtons.length !== 8) {
            this.bitsGrid.replaceChildren();
            this.bitButtons = [];

            for (let bit = 7; bit >= 0; bit--) {
                const bitBtn = document.createElement('button');
                bitBtn.type = 'button';
                bitBtn.className = 'can-payload-bit-btn';

                bitBtn.onclick = () => {
                    this.isBitSelectionActive = true;
                    this.selectedBitIndex = bit;
                    this.selectedBitLength = 1;
                    this.bitSelectionCheckbox.checked = true;
                    this.render();
                    this.notifySelection();
                };

                this.bitsGrid.appendChild(bitBtn);
                this.bitButtons.push(bitBtn);
            }
        }

        // Update values and classes on bit buttons
        for (let i = 0; i < 8; i++) {
            const bit = 7 - i;
            const bitVal = (targetByteValue >> bit) & 1;
            const isBitSelected = this.isBitSelectionActive &&
                bit <= this.selectedBitIndex &&
                bit > this.selectedBitIndex - this.selectedBitLength;

            const bitBtn = this.bitButtons[i];
            if (bitBtn) {
                bitBtn.className = `can-payload-bit-btn${bitVal === 1 ? ' bit-one' : ' bit-zero'}${isBitSelected ? ' selected' : ''}`;
                bitBtn.innerHTML = `<span class="bit-idx">b${bit}</span><span class="bit-val">${bitVal}</span>`;
                bitBtn.title = `Byte ${targetByteIndex}, Bit ${bit} = ${bitVal} (${bitVal === 1 ? 'TRUE/ON' : 'FALSE/OFF'})`;
            }
        }
    }

    protected createSelectionInput(labelText: string, initialValue: string, onInputCallback: () => void): HTMLInputElement {
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement('input');
        input.className = 'theia-input';
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.value = initialValue;
        input.oninput = onInputCallback;
        label.appendChild(input);
        return input;
    }

    protected syncSelectionControls(selection: PayloadSelection): void {
        const frameLength = this.frame?.data.length ?? 0;
        this.startByteInput.disabled = frameLength === 0;
        this.byteLengthInput.disabled = frameLength === 0;
        this.startBitInput.disabled = frameLength === 0 || !this.isBitSelectionActive;
        this.bitLengthInput.disabled = frameLength === 0 || !this.isBitSelectionActive;
        this.bitSelectionCheckbox.disabled = frameLength === 0;

        this.startByteInput.max = String(Math.max(0, frameLength - 1));
        this.byteLengthInput.max = String(Math.max(1, frameLength - selection.startByte));
        this.startByteInput.value = String(selection.startByte);
        this.byteLengthInput.value = String(selection.byteLength);

        this.bitSelectionCheckbox.checked = this.isBitSelectionActive;
        this.startBitInput.value = String(this.selectedBitIndex);
        this.bitLengthInput.value = String(this.selectedBitLength);
    }

    protected selectRangeFromControls(): void {
        if (!this.frame || this.frame.data.length === 0) {
            return;
        }
        const startByte = Math.max(0, Math.min(this.frame.data.length - 1, Math.trunc(Number(this.startByteInput.value) || 0)));
        const byteLength = Math.max(1, Math.min(this.frame.data.length - startByte, Math.trunc(Number(this.byteLengthInput.value) || 1)));
        this.selectionAnchor = startByte;
        this.selectionEnd = startByte + byteLength - 1;
        this.isBitSelectionActive = false;
        this.bitSelectionCheckbox.checked = false;
        this.render();
        this.notifySelection();
    }

    protected selectBitFromControls(): void {
        this.selectedBitIndex = Math.max(0, Math.min(7, Math.trunc(Number(this.startBitInput.value) || 0)));
        this.selectedBitLength = Math.max(1, Math.min(8, Math.trunc(Number(this.bitLengthInput.value) || 1)));
        this.isBitSelectionActive = true;
        this.bitSelectionCheckbox.checked = true;
        this.render();
        this.notifySelection();
    }

    protected notifySelection(): void {
        const selection = this.getSelection();
        for (const listener of this.listeners) {
            listener(selection);
        }
    }
}
