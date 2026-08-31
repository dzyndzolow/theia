// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget } from '@theia/core/lib/browser';
import { CanRpcClient } from './can-rpc-client';
import { CanFrame } from '../common/can-protocol';
import { CanWaveGenerator, WaveShape } from '../common/can-wave-generator';
import { CanFrameComposer, FrameCompositionTemplate } from '../common/can-frame-composer';
import { GlobalVariableRegistry } from '@theia/signal-core';

export const CAN_GENERATOR_WIDGET_ID = 'can-generator-widget';
export const CAN_GENERATOR_WIDGET_LABEL = 'CAN Frame & Wave Generator';

type GeneratorTab = 'TRANSMITTER' | 'WAVE_GENERATOR' | 'FRAME_COMPOSER' | 'CAMPAIGN';

@injectable()
export class CanGeneratorWidget extends BaseWidget {

    @inject(CanRpcClient)
    protected readonly canRpcClient!: CanRpcClient;

    @inject(GlobalVariableRegistry)
    protected readonly globalVariableRegistry!: GlobalVariableRegistry;

    protected selectedInterface: string = 'demo';
    protected isArmed: boolean = false;
    protected activeTab: GeneratorTab = 'TRANSMITTER';

    // Transmitter State
    protected txCanId: number = 0x123;
    protected txExtended: boolean = false;
    protected txRtr: boolean = false;
    protected txDlc: number = 8;
    protected txData: number[] = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
    protected txIntervalMs: number = 50;
    protected periodicTimer?: ReturnType<typeof setInterval>;
    protected totalTxCount: number = 0;
    protected txFps: number = 0;
    protected lastTxTime: number = 0;
    protected txInWindow: number = 0;
    protected txInFlight: boolean = false;
    protected fpsTimer?: ReturnType<typeof setInterval>;

    // Wave Generator State
    protected waveShape: WaveShape = 'SINE';
    protected waveCanId: number = 0x200;
    protected waveTargetByte: number = 0;
    protected waveDataType: 'UINT8' | 'UINT16_LE' | 'INT8' = 'UINT8';
    protected waveFrequencyHz: number = 1.0;
    protected waveAmplitude: number = 100;
    protected waveOffset: number = 128;
    protected waveStepMs: number = 20;
    protected waveTimer?: ReturnType<typeof setInterval>;
    protected waveStartTime: number = 0;
    protected currentWaveVal: number = 0;

    // Composer State
    protected composerCanId: number = 0x300;
    protected composerVarName: string = 'EngineSpeed';
    protected composerTargetByte: number = 2;
    protected composerTimer?: ReturnType<typeof setInterval>;

    // DOM References
    protected containerEl!: HTMLDivElement;
    protected interfaceSelectEl!: HTMLSelectElement;
    protected armButtonEl!: HTMLButtonElement;
    protected emergencyStopBtnEl!: HTMLButtonElement;
    protected statusBadgeEl!: HTMLSpanElement;
    protected tabContentEl!: HTMLDivElement;
    protected waveCanvasEl?: HTMLCanvasElement;
    protected waveValueBadgeEl?: HTMLSpanElement;

    @postConstruct()
    protected init(): void {
        this.id = CAN_GENERATOR_WIDGET_ID;
        this.title.label = CAN_GENERATOR_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-paper-plane can-generator-icon';
        this.addClass('can-generator-widget');

        this.fpsTimer = setInterval(() => {
            this.txFps = this.txInWindow;
            this.txInWindow = 0;
            this.updateStatusBar();
        }, 1000);

        this.toDispose.push(this.canRpcClient.onDidChangeInterfaces(() => this.updateInterfaceChoices()));
        this.buildUI();
        this.updateInterfaceChoices();
    }

    override dispose(): void {
        this.stopAllTransmissions();
        this.canRpcClient.disarmTransmit().catch(() => undefined);
        if (this.fpsTimer) {
            clearInterval(this.fpsTimer);
        }
        super.dispose();
    }

    protected buildUI(): void {
        this.node.textContent = '';
        this.containerEl = document.createElement('div');
        this.containerEl.className = 'can-gen-container';
        this.node.appendChild(this.containerEl);

        // 1. Top Control Bar (Safety, Interface, Emergency Stop)
        const topBar = document.createElement('div');
        topBar.className = 'can-gen-topbar';

        // Interface select
        const ifaceGroup = document.createElement('div');
        ifaceGroup.className = 'can-gen-control-group';
        const ifaceLabel = document.createElement('label');
        ifaceLabel.textContent = 'TX Target: ';
        this.interfaceSelectEl = document.createElement('select');
        this.interfaceSelectEl.className = 'theia-select';
        this.interfaceSelectEl.onchange = () => this.selectInterface(this.interfaceSelectEl.value);
        ifaceGroup.appendChild(ifaceLabel);
        ifaceGroup.appendChild(this.interfaceSelectEl);
        topBar.appendChild(ifaceGroup);

        // Arming Toggle Button
        this.armButtonEl = document.createElement('button');
        this.armButtonEl.className = 'theia-button can-gen-arm-btn disarmed';
        this.armButtonEl.textContent = '🛡️ DISARMED (Fail-Closed)';
        this.armButtonEl.onclick = () => this.toggleArm();
        topBar.appendChild(this.armButtonEl);

        // Emergency Stop Button
        this.emergencyStopBtnEl = document.createElement('button');
        this.emergencyStopBtnEl.className = 'theia-button can-gen-stop-btn';
        this.emergencyStopBtnEl.textContent = '🚨 EMERGENCY STOP (STOP)';
        this.emergencyStopBtnEl.onclick = () => this.emergencyStop();
        topBar.appendChild(this.emergencyStopBtnEl);

        // Status Badge
        this.statusBadgeEl = document.createElement('span');
        this.statusBadgeEl.className = 'can-gen-status-badge';
        topBar.appendChild(this.statusBadgeEl);
        this.updateStatusBar();

        this.containerEl.appendChild(topBar);

        // 2. Navigation Tabs
        const navBar = document.createElement('div');
        navBar.className = 'can-gen-nav-tabs';

        const tabs: { id: GeneratorTab; label: string; icon: string }[] = [
            { id: 'TRANSMITTER', label: 'Manual & Periodic TX', icon: 'fa-paper-plane' },
            { id: 'WAVE_GENERATOR', label: 'Math Waveform Generator', icon: 'fa-line-chart' },
            { id: 'FRAME_COMPOSER', label: 'Global Var Composer', icon: 'fa-cubes' },
            { id: 'CAMPAIGN', label: 'Device Lab Campaigns', icon: 'fa-flask' }
        ];

        for (const t of tabs) {
            const tabBtn = document.createElement('button');
            tabBtn.className = `can-gen-tab-btn ${this.activeTab === t.id ? 'active' : ''}`;
            tabBtn.innerHTML = `<i class="fa ${t.icon}"></i> ${t.label}`;
            tabBtn.onclick = () => {
                this.activeTab = t.id;
                for (const btn of Array.from(navBar.children)) {
                    btn.classList.remove('active');
                }
                tabBtn.classList.add('active');
                this.renderTabContent();
            };
            navBar.appendChild(tabBtn);
        }
        this.containerEl.appendChild(navBar);

        // 3. Tab Content Area
        this.tabContentEl = document.createElement('div');
        this.tabContentEl.className = 'can-gen-tab-content';
        this.containerEl.appendChild(this.tabContentEl);

        this.renderTabContent();
    }

    protected renderTabContent(): void {
        this.tabContentEl.textContent = '';
        switch (this.activeTab) {
            case 'TRANSMITTER':
                this.renderTransmitterTab();
                break;
            case 'WAVE_GENERATOR':
                this.renderWaveGeneratorTab();
                break;
            case 'FRAME_COMPOSER':
                this.renderComposerTab();
                break;
            case 'CAMPAIGN':
                this.renderCampaignTab();
                break;
        }
    }

    // ==========================================
    // TAB 1: Single & Periodic Frame Transmitter
    // ==========================================
    protected renderTransmitterTab(): void {
        const card = document.createElement('div');
        card.className = 'can-gen-card';

        const title = document.createElement('h3');
        title.innerHTML = '📡 Standard / Extended CAN Frame Transmitter';
        card.appendChild(title);

        const formGrid = document.createElement('div');
        formGrid.className = 'can-gen-grid';

        // CAN ID Input
        const idGroup = document.createElement('div');
        idGroup.className = 'can-gen-field';
        const idLabel = document.createElement('label');
        idLabel.textContent = 'CAN ID (Hex):';
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.className = 'theia-input';
        idInput.value = '0x' + this.txCanId.toString(16).toUpperCase();
        idInput.onchange = () => {
            const parsed = this.parseCanId(idInput.value);
            if (parsed !== undefined) {
                this.txCanId = parsed;
                this.txExtended = parsed > 0x7FF;
                this.renderTabContent();
            } else {
                idInput.value = '0x' + this.txCanId.toString(16).toUpperCase();
            }
        };
        idGroup.appendChild(idLabel);
        idGroup.appendChild(idInput);
        formGrid.appendChild(idGroup);

        // Frame format checkboxes
        const formatGroup = document.createElement('div');
        formatGroup.className = 'can-gen-field';
        const extLabel = document.createElement('label');
        extLabel.style.display = 'flex';
        extLabel.style.alignItems = 'center';
        extLabel.style.gap = '6px';
        const extCheck = document.createElement('input');
        extCheck.type = 'checkbox';
        extCheck.checked = this.txExtended;
        extCheck.onchange = () => { this.txExtended = extCheck.checked; };
        extLabel.appendChild(extCheck);
        extLabel.appendChild(document.createTextNode(' Extended (29-bit ID)'));

        const rtrLabel = document.createElement('label');
        rtrLabel.style.display = 'flex';
        rtrLabel.style.alignItems = 'center';
        rtrLabel.style.gap = '6px';
        const rtrCheck = document.createElement('input');
        rtrCheck.type = 'checkbox';
        rtrCheck.checked = this.txRtr;
        rtrCheck.onchange = () => { this.txRtr = rtrCheck.checked; };
        rtrLabel.appendChild(rtrCheck);
        rtrLabel.appendChild(document.createTextNode(' RTR (Remote Request)'));

        formatGroup.appendChild(extLabel);
        formatGroup.appendChild(rtrLabel);
        formGrid.appendChild(formatGroup);

        // DLC selector
        const dlcGroup = document.createElement('div');
        dlcGroup.className = 'can-gen-field';
        const dlcLabel = document.createElement('label');
        dlcLabel.textContent = `DLC: ${this.txDlc} Bytes`;
        const dlcSelect = document.createElement('select');
        dlcSelect.className = 'theia-select';
        for (let i = 0; i <= 8; i++) {
            const opt = document.createElement('option');
            opt.value = i.toString();
            opt.textContent = `${i} Bytes`;
            if (i === this.txDlc) { opt.selected = true; }
            dlcSelect.appendChild(opt);
        }
        dlcSelect.onchange = () => {
            this.txDlc = parseInt(dlcSelect.value, 10);
            dlcLabel.textContent = `DLC: ${this.txDlc} Bytes`;
            this.renderTabContent();
        };
        dlcGroup.appendChild(dlcLabel);
        dlcGroup.appendChild(dlcSelect);
        formGrid.appendChild(dlcGroup);

        // Interval selector
        const intervalGroup = document.createElement('div');
        intervalGroup.className = 'can-gen-field';
        const intLabel = document.createElement('label');
        intLabel.textContent = 'Repeat Period:';
        const intSelect = document.createElement('select');
        intSelect.className = 'theia-select';
        const periods = [10, 20, 50, 100, 200, 500, 1000];
        for (const p of periods) {
            const opt = document.createElement('option');
            opt.value = p.toString();
            opt.textContent = `${p} ms (${Math.round(1000 / p)} Hz)`;
            if (p === this.txIntervalMs) { opt.selected = true; }
            intSelect.appendChild(opt);
        }
        intSelect.onchange = () => {
            this.txIntervalMs = parseInt(intSelect.value, 10);
            if (this.periodicTimer) {
                this.stopPeriodicTransmitter();
                this.startPeriodicTransmitter();
            }
        };
        intervalGroup.appendChild(intLabel);
        intervalGroup.appendChild(intSelect);
        formGrid.appendChild(intervalGroup);

        card.appendChild(formGrid);

        // 8 Byte Hex Input Matrix
        const bytesCard = document.createElement('div');
        bytesCard.className = 'can-gen-bytes-box';
        const bytesTitle = document.createElement('label');
        bytesTitle.textContent = 'Payload Data Bytes (Hex 00..FF):';
        bytesCard.appendChild(bytesTitle);

        const bytesRow = document.createElement('div');
        bytesRow.className = 'can-gen-bytes-row';
        for (let b = 0; b < this.txDlc; b++) {
            const byteBox = document.createElement('div');
            byteBox.className = 'can-gen-byte-cell';
            const bLabel = document.createElement('span');
            bLabel.textContent = `B${b}`;
            const bInput = document.createElement('input');
            bInput.type = 'text';
            bInput.maxLength = 2;
            bInput.className = 'theia-input byte-input';
            const curVal = this.txData[b] !== undefined ? this.txData[b] : 0;
            bInput.value = curVal.toString(16).padStart(2, '0').toUpperCase();
            bInput.onchange = () => {
                const raw = bInput.value.trim();
                if (/^[0-9A-Fa-f]{1,2}$/.test(raw)) {
                    this.txData[b] = Number.parseInt(raw, 16);
                }
                bInput.value = this.txData[b].toString(16).padStart(2, '0').toUpperCase();
            };
            byteBox.appendChild(bLabel);
            byteBox.appendChild(bInput);
            bytesRow.appendChild(byteBox);
        }
        bytesCard.appendChild(bytesRow);

        // Quick Preset Buttons
        const presetRow = document.createElement('div');
        presetRow.className = 'can-gen-presets';
        const presets: { name: string; gen: () => number[] }[] = [
            { name: 'All 0x00', gen: () => [0, 0, 0, 0, 0, 0, 0, 0] },
            { name: 'All 0xFF', gen: () => [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF] },
            { name: 'AA 55 Toggle', gen: () => [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55] },
            { name: '01 02 03 04...', gen: () => [1, 2, 3, 4, 5, 6, 7, 8] }
        ];
        for (const p of presets) {
            const pBtn = document.createElement('button');
            pBtn.className = 'theia-button secondary';
            pBtn.textContent = p.name;
            pBtn.onclick = () => {
                this.txData = p.gen().slice(0, this.txDlc);
                this.renderTabContent();
            };
            presetRow.appendChild(pBtn);
        }
        bytesCard.appendChild(presetRow);
        card.appendChild(bytesCard);

        // Action Buttons Row
        const actionsRow = document.createElement('div');
        actionsRow.className = 'can-gen-actions-row';

        const sendSingleBtn = document.createElement('button');
        sendSingleBtn.className = 'theia-button primary';
        sendSingleBtn.innerHTML = '📤 Send Once (Single Shot)';
        sendSingleBtn.disabled = !this.isArmed;
        sendSingleBtn.onclick = () => this.sendSingleFrame();
        actionsRow.appendChild(sendSingleBtn);

        const periodicBtn = document.createElement('button');
        periodicBtn.className = `theia-button ${this.periodicTimer ? 'danger' : 'primary'}`;
        periodicBtn.innerHTML = this.periodicTimer ? '⏹ Stop Periodic TX' : '▶ Start Periodic TX';
        periodicBtn.disabled = !this.isArmed && !this.periodicTimer;
        periodicBtn.onclick = () => {
            if (this.periodicTimer) {
                this.stopPeriodicTransmitter();
            } else {
                this.startPeriodicTransmitter();
            }
            this.renderTabContent();
        };
        actionsRow.appendChild(periodicBtn);

        card.appendChild(actionsRow);
        this.tabContentEl.appendChild(card);
    }

    // ==========================================
    // TAB 2: Mathematical Waveform Generator
    // ==========================================
    protected renderWaveGeneratorTab(): void {
        const card = document.createElement('div');
        card.className = 'can-gen-card';

        const title = document.createElement('h3');
        title.innerHTML = '🌊 CAN Waveform Signal Synthesizer (Sine, Triangle, Ramp, Square)';
        card.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'can-gen-grid';

        // Wave shape
        const shapeGroup = document.createElement('div');
        shapeGroup.className = 'can-gen-field';
        const shapeLabel = document.createElement('label');
        shapeLabel.textContent = 'Wave Shape:';
        const shapeSelect = document.createElement('select');
        shapeSelect.className = 'theia-select';
        const shapes: { id: WaveShape; label: string }[] = [
            { id: 'SINE', label: 'Sinusoid (Sine Wave)' },
            { id: 'TRIANGLE', label: 'Triangle Wave' },
            { id: 'RAMP', label: 'Sawtooth / Ramp' },
            { id: 'SQUARE_TOGGLE', label: 'Square / Binary Toggle' },
            { id: 'CONSTANT', label: 'Constant DC' }
        ];
        for (const s of shapes) {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.label;
            if (s.id === this.waveShape) { opt.selected = true; }
            shapeSelect.appendChild(opt);
        }
        shapeSelect.onchange = () => {
            this.waveShape = shapeSelect.value as WaveShape;
            this.drawWavePreview();
        };
        shapeGroup.appendChild(shapeLabel);
        shapeGroup.appendChild(shapeSelect);
        grid.appendChild(shapeGroup);

        // Frequency
        const freqGroup = document.createElement('div');
        freqGroup.className = 'can-gen-field';
        const freqLabel = document.createElement('label');
        freqLabel.textContent = `Frequency: ${this.waveFrequencyHz.toFixed(1)} Hz`;
        const freqInput = document.createElement('input');
        freqInput.type = 'range';
        freqInput.min = '0.1';
        freqInput.max = '10.0';
        freqInput.step = '0.1';
        freqInput.value = this.waveFrequencyHz.toString();
        freqInput.oninput = () => {
            this.waveFrequencyHz = parseFloat(freqInput.value);
            freqLabel.textContent = `Frequency: ${this.waveFrequencyHz.toFixed(1)} Hz`;
            this.drawWavePreview();
        };
        freqGroup.appendChild(freqLabel);
        freqGroup.appendChild(freqInput);
        grid.appendChild(freqGroup);

        // Target CAN ID & Target Byte
        const targetIdGroup = document.createElement('div');
        targetIdGroup.className = 'can-gen-field';
        const tidLabel = document.createElement('label');
        tidLabel.textContent = 'CAN ID & Byte Offset:';
        const tidRow = document.createElement('div');
        tidRow.style.display = 'flex';
        tidRow.style.gap = '8px';
        const tidInput = document.createElement('input');
        tidInput.type = 'text';
        tidInput.className = 'theia-input';
        tidInput.value = '0x' + this.waveCanId.toString(16).toUpperCase();
        tidInput.onchange = () => {
            const parsed = this.parseCanId(tidInput.value);
            if (parsed !== undefined) {
                this.waveCanId = parsed;
            } else {
                tidInput.value = '0x' + this.waveCanId.toString(16).toUpperCase();
            }
        };
        const byteSelect = document.createElement('select');
        byteSelect.className = 'theia-select';
        for (let b = 0; b < 8; b++) {
            const opt = document.createElement('option');
            opt.value = b.toString();
            opt.textContent = `Byte ${b}`;
            if (b === this.waveTargetByte) { opt.selected = true; }
            byteSelect.appendChild(opt);
        }
        byteSelect.onchange = () => { this.waveTargetByte = parseInt(byteSelect.value, 10); };
        tidRow.appendChild(tidInput);
        tidRow.appendChild(byteSelect);
        targetIdGroup.appendChild(tidLabel);
        targetIdGroup.appendChild(tidRow);
        grid.appendChild(targetIdGroup);

        // Amplitude & Offset
        const ampGroup = document.createElement('div');
        ampGroup.className = 'can-gen-field';
        const ampLabel = document.createElement('label');
        ampLabel.textContent = `Amplitude: ${this.waveAmplitude}, Offset: ${this.waveOffset}`;
        const ampRow = document.createElement('div');
        ampRow.style.display = 'flex';
        ampRow.style.gap = '8px';
        const ampIn = document.createElement('input');
        ampIn.type = 'number';
        ampIn.className = 'theia-input';
        ampIn.value = this.waveAmplitude.toString();
        ampIn.onchange = () => {
            this.waveAmplitude = parseInt(ampIn.value, 10) || 50;
            ampLabel.textContent = `Amplitude: ${this.waveAmplitude}, Offset: ${this.waveOffset}`;
            this.drawWavePreview();
        };
        const offIn = document.createElement('input');
        offIn.type = 'number';
        offIn.className = 'theia-input';
        offIn.value = this.waveOffset.toString();
        offIn.onchange = () => {
            this.waveOffset = parseInt(offIn.value, 10) || 128;
            ampLabel.textContent = `Amplitude: ${this.waveAmplitude}, Offset: ${this.waveOffset}`;
            this.drawWavePreview();
        };
        ampRow.appendChild(ampIn);
        ampRow.appendChild(offIn);
        ampGroup.appendChild(ampLabel);
        ampGroup.appendChild(ampRow);
        grid.appendChild(ampGroup);

        card.appendChild(grid);

        // Canvas Waveform Preview
        const previewBox = document.createElement('div');
        previewBox.className = 'can-gen-preview-box';
        const previewHeader = document.createElement('div');
        previewHeader.style.display = 'flex';
        previewHeader.style.justifyContent = 'space-between';
        previewHeader.style.alignItems = 'center';
        previewHeader.style.marginBottom = '6px';
        const pLabel = document.createElement('span');
        pLabel.textContent = 'Real-time Waveform Output Preview:';
        this.waveValueBadgeEl = document.createElement('span');
        this.waveValueBadgeEl.className = 'theia-badge';
        this.waveValueBadgeEl.textContent = this.formatWaveValue(this.currentWaveVal);
        previewHeader.appendChild(pLabel);
        previewHeader.appendChild(this.waveValueBadgeEl);
        previewBox.appendChild(previewHeader);

        this.waveCanvasEl = document.createElement('canvas');
        this.waveCanvasEl.width = 600;
        this.waveCanvasEl.height = 120;
        this.waveCanvasEl.className = 'can-gen-canvas';
        previewBox.appendChild(this.waveCanvasEl);
        card.appendChild(previewBox);
        this.drawWavePreview();

        // Waveform Start / Stop Actions
        const actionsRow = document.createElement('div');
        actionsRow.className = 'can-gen-actions-row';

        const waveBtn = document.createElement('button');
        waveBtn.className = `theia-button ${this.waveTimer ? 'danger' : 'primary'}`;
        waveBtn.innerHTML = this.waveTimer ? '⏹ Stop Wave Generator' : '▶ Start Waveform Generator';
        waveBtn.disabled = !this.isArmed && !this.waveTimer;
        waveBtn.onclick = () => {
            if (this.waveTimer) {
                this.stopWaveGenerator();
            } else {
                this.startWaveGenerator();
            }
            this.renderTabContent();
        };
        actionsRow.appendChild(waveBtn);
        card.appendChild(actionsRow);

        this.tabContentEl.appendChild(card);
    }

    protected drawWavePreview(): void {
        if (!this.waveCanvasEl) { return; }
        const ctx = this.waveCanvasEl.getContext('2d');
        if (!ctx) { return; }

        const w = this.waveCanvasEl.width;
        const h = this.waveCanvasEl.height;
        ctx.clearRect(0, 0, w, h);

        // Background & grid
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 50) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y < h; y += 30) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Draw waveform curve
        ctx.strokeStyle = '#4fc1ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();

        const duration = 2.0; // 2 seconds window
        const cfg = {
            shape: this.waveShape,
            amplitude: this.waveAmplitude,
            frequencyHz: this.waveFrequencyHz,
            offset: this.waveOffset,
            minLimit: 0,
            maxLimit: 255
        };

        for (let px = 0; px < w; px++) {
            const t = (px / w) * duration;
            const val = CanWaveGenerator.evaluateAt(cfg, t);
            const py = h - (val / 255) * h;
            if (px === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
    }

    // ==========================================
    // TAB 3: Global Variable Frame Composer
    // ==========================================
    protected renderComposerTab(): void {
        const card = document.createElement('div');
        card.className = 'can-gen-card';

        const title = document.createElement('h3');
        title.innerHTML = '🧩 Frame Composer with Dynamic Global Variables';
        card.appendChild(title);

        const desc = document.createElement('p');
        desc.style.color = '#cccccc';
        desc.textContent = 'Maps live global variables (e.g. from Python runners or scripts) into specified byte offsets in the CAN frame payload.';
        card.appendChild(desc);

        const grid = document.createElement('div');
        grid.className = 'can-gen-grid';

        const idGroup = document.createElement('div');
        idGroup.className = 'can-gen-field';
        const idLabel = document.createElement('label');
        idLabel.textContent = 'Target CAN ID:';
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.className = 'theia-input';
        idInput.value = '0x' + this.composerCanId.toString(16).toUpperCase();
        idInput.onchange = () => {
            const parsed = this.parseCanId(idInput.value);
            if (parsed !== undefined) {
                this.composerCanId = parsed;
            } else {
                idInput.value = '0x' + this.composerCanId.toString(16).toUpperCase();
            }
        };
        idGroup.appendChild(idLabel);
        idGroup.appendChild(idInput);
        grid.appendChild(idGroup);

        const varGroup = document.createElement('div');
        varGroup.className = 'can-gen-field';
        const varLabel = document.createElement('label');
        varLabel.textContent = 'Bound Variable:';
        const varSelect = document.createElement('select');
        varSelect.className = 'theia-select';
        const allVars = this.globalVariableRegistry.list();
        const varNames = allVars.length > 0 ? allVars.map(v => v.definition.name) : ['EngineSpeed', 'VehicleSpeed', 'CoolantTemp', 'BatteryVoltage'];
        for (const name of varNames) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === this.composerVarName) { opt.selected = true; }
            varSelect.appendChild(opt);
        }
        varSelect.onchange = () => { this.composerVarName = varSelect.value; };
        varGroup.appendChild(varLabel);
        varGroup.appendChild(varSelect);
        grid.appendChild(varGroup);

        card.appendChild(grid);

        // Preview Composed Frame
        const previewBox = document.createElement('div');
        previewBox.className = 'can-gen-bytes-box';
        const pLabel = document.createElement('label');
        pLabel.textContent = 'Composed Frame Preview:';
        previewBox.appendChild(pLabel);

        const tmpl: FrameCompositionTemplate = {
            id: this.composerCanId,
            dlc: 8,
            baseData: [0, 0, 0, 0, 0, 0, 0, 0],
            bindings: [{
                variableName: this.composerVarName,
                targetByte: this.composerTargetByte,
                dataType: 'UINT16_LE',
                scale: 1.0,
                offset: 0.0,
                fallbackValue: 1500
            }]
        };
        const composed = CanFrameComposer.composeFrame(tmpl, new Map([[this.composerVarName, 3200]]));
        const hexStr = composed.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

        const hexBadge = document.createElement('div');
        hexBadge.style.fontFamily = 'monospace';
        hexBadge.style.fontSize = '14px';
        hexBadge.style.padding = '8px';
        hexBadge.style.background = '#252526';
        hexBadge.style.borderRadius = '4px';
        hexBadge.textContent = `ID: 0x${this.composerCanId.toString(16).toUpperCase()} | DLC: 8 | Data: [ ${hexStr} ]`;
        previewBox.appendChild(hexBadge);
        card.appendChild(previewBox);

        // Actions
        const actionsRow = document.createElement('div');
        actionsRow.className = 'can-gen-actions-row';
        const startCompBtn = document.createElement('button');
        startCompBtn.className = `theia-button ${this.composerTimer ? 'danger' : 'primary'}`;
        startCompBtn.innerHTML = this.composerTimer ? '⏹ Stop Composed TX' : '▶ Start Composed Stream (100ms)';
        startCompBtn.disabled = !this.isArmed && !this.composerTimer;
        startCompBtn.onclick = () => {
            if (this.composerTimer) {
                this.stopComposerStream();
            } else {
                this.startComposerStream();
            }
            this.renderTabContent();
        };
        actionsRow.appendChild(startCompBtn);
        card.appendChild(actionsRow);

        this.tabContentEl.appendChild(card);
    }

    // ==========================================
    // TAB 4: Device Lab Wake-Up Campaign
    // ==========================================
    protected renderCampaignTab(): void {
        const card = document.createElement('div');
        card.className = 'can-gen-card';

        const title = document.createElement('h3');
        title.innerHTML = '🔬 Device Lab Automated Discovery & Wake-up Campaigns';
        card.appendChild(title);

        const desc = document.createElement('p');
        desc.style.color = '#cccccc';
        desc.textContent = 'Sends rapid, structured wake-up pattern sweeps to wake asleep ECUs and identify responsive CAN nodes.';
        card.appendChild(desc);

        const actionsRow = document.createElement('div');
        actionsRow.className = 'can-gen-actions-row';

        const runCampBtn = document.createElement('button');
        runCampBtn.className = 'theia-button primary';
        runCampBtn.innerHTML = '🚀 Execute 10-Trial Wake-up Sweep';
        runCampBtn.disabled = !this.isArmed;
        runCampBtn.onclick = () => {
            this.runWakeupSweep();
        };
        actionsRow.appendChild(runCampBtn);
        card.appendChild(actionsRow);

        this.tabContentEl.appendChild(card);
    }

    // ==========================================
    // Execution & Transmission Logic
    // ==========================================

    protected async sendSingleFrame(): Promise<void> {
        if (!this.isArmed) { return; }
        const frame: CanFrame = {
            id: this.txCanId,
            extended: this.txExtended,
            rtr: this.txRtr,
            dlc: this.txDlc,
            data: this.txData.slice(0, this.txDlc),
            timestamp: Date.now(),
            interface: this.selectedInterface
        };
        await this.transmitFrame(frame);
    }

    protected startPeriodicTransmitter(): void {
        if (!this.isArmed) { return; }
        this.stopPeriodicTransmitter();
        this.periodicTimer = setInterval(() => {
            this.sendSingleFrame().catch(err => console.error('Periodic CAN transmission failed:', err));
        }, this.txIntervalMs);
    }

    protected stopPeriodicTransmitter(): void {
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = undefined;
        }
    }

    protected startWaveGenerator(): void {
        if (!this.isArmed) { return; }
        this.stopWaveGenerator();
        this.waveStartTime = Date.now();

        this.waveTimer = setInterval(() => {
            this.sendWaveFrame().catch(err => console.error('CAN wave transmission failed:', err));
        }, this.waveStepMs);
    }

    protected async sendWaveFrame(): Promise<void> {
        if (!this.isArmed) { return; }
        const elapsedSec = (Date.now() - this.waveStartTime) / 1000;
        const cfg = {
            shape: this.waveShape,
            amplitude: this.waveAmplitude,
            frequencyHz: this.waveFrequencyHz,
            offset: this.waveOffset,
            minLimit: 0,
            maxLimit: 255
        };
        this.currentWaveVal = CanWaveGenerator.evaluateAt(cfg, elapsedSec);

        if (this.waveValueBadgeEl) {
            this.waveValueBadgeEl.textContent = this.formatWaveValue(this.currentWaveVal);
        }

        const payload = [0, 0, 0, 0, 0, 0, 0, 0];
        payload[this.waveTargetByte] = Math.round(this.currentWaveVal) & 0xFF;
        await this.transmitFrame({
            id: this.waveCanId,
            extended: this.waveCanId > 0x7FF,
            rtr: false,
            dlc: 8,
            data: payload,
            timestamp: Date.now(),
            interface: this.selectedInterface
        });
    }

    protected stopWaveGenerator(): void {
        if (this.waveTimer) {
            clearInterval(this.waveTimer);
            this.waveTimer = undefined;
        }
    }

    protected startComposerStream(): void {
        if (!this.isArmed) { return; }
        this.stopComposerStream();

        let step = 0;
        this.composerTimer = setInterval(() => {
            this.sendComposerFrame(++step).catch(err => console.error('CAN composer transmission failed:', err));
        }, 100);
    }

    protected async sendComposerFrame(step: number): Promise<void> {
        if (!this.isArmed) { return; }
        const liveVars = new Map<string, number>();
        const simulatedSpeed = 800 + Math.sin(step * 0.1) * 600;
        liveVars.set(this.composerVarName, simulatedSpeed);

        const tmpl: FrameCompositionTemplate = {
            id: this.composerCanId,
            dlc: 8,
            baseData: [0, 0, 0, 0, 0, 0, 0, 0],
            bindings: [{
                variableName: this.composerVarName,
                targetByte: this.composerTargetByte,
                dataType: 'UINT16_LE',
                scale: 1.0,
                offset: 0.0
            }]
        };
        const frame = CanFrameComposer.composeFrame(tmpl, liveVars);
        frame.interface = this.selectedInterface;
        frame.timestamp = Date.now();
        await this.transmitFrame(frame);
    }

    protected stopComposerStream(): void {
        if (this.composerTimer) {
            clearInterval(this.composerTimer);
            this.composerTimer = undefined;
        }
    }

    protected async runWakeupSweep(): Promise<void> {
        if (!this.isArmed) { return; }
        const patterns = [0x00, 0xFF, 0xAA, 0x55];
        for (let i = 0; i < 10; i++) {
            const p = patterns[i % patterns.length];
            const frame: CanFrame = {
                id: 0x100 + i,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [p, p, p, p, p, p, p, p],
                timestamp: Date.now(),
                interface: this.selectedInterface
            };
            await this.transmitFrame(frame);
            if (!this.isArmed) { break; }
            await new Promise(r => setTimeout(r, 40));
        }
    }

    protected stopAllTransmissions(): void {
        this.stopPeriodicTransmitter();
        this.stopWaveGenerator();
        this.stopComposerStream();
    }

    protected async toggleArm(): Promise<void> {
        if (this.isArmed) {
            await this.failClosedDisarm();
            return;
        }
        this.armButtonEl.disabled = true;
        try {
            if (this.txRtr) {
                throw new Error('RTR transmission is disabled by the bench safety profile.');
            }
            await this.canRpcClient.armTransmit({
                interfaceName: this.selectedInterface,
                allowedIds: this.collectArmAllowlist(),
                allowExtendedIds: this.txExtended || this.waveCanId > 0x7FF || this.composerCanId > 0x7FF,
                maxFps: 250,
                maxBusLoadPercent: 50,
                maxDurationMs: 10 * 60 * 1000
            });
            this.isArmed = true;
            this.armButtonEl.className = 'theia-button can-gen-arm-btn armed';
            this.armButtonEl.textContent = '⚡ ARMED (TX Allowed)';
        } catch (err) {
            this.isArmed = false;
            this.stopAllTransmissions();
            this.armButtonEl.className = 'theia-button can-gen-arm-btn disarmed';
            this.armButtonEl.textContent = 'ARM FAILED — start capture / check policy';
            console.error('CAN ARM rejected:', err);
        } finally {
            this.armButtonEl.disabled = false;
        }
        this.updateStatusBar();
        this.renderTabContent();
    }

    protected async emergencyStop(): Promise<void> {
        this.isArmed = false;
        this.stopAllTransmissions();
        try {
            await this.canRpcClient.emergencyStop();
        } finally {
            this.armButtonEl.className = 'theia-button can-gen-arm-btn disarmed';
            this.armButtonEl.textContent = '🛡️ DISARMED (Fail-Closed)';
            this.updateStatusBar();
            this.renderTabContent();
        }
    }

    protected updateStatusBar(): void {
        if (!this.statusBadgeEl) { return; }
        const activeCount = (this.periodicTimer ? 1 : 0) + (this.waveTimer ? 1 : 0) + (this.composerTimer ? 1 : 0);
        this.statusBadgeEl.textContent = `Sent: ${this.totalTxCount} frames | Rate: ${this.txFps} FPS | Active TX: ${activeCount}`;
    }

    protected async selectInterface(ifaceId: string): Promise<void> {
        if (this.isArmed) {
            await this.failClosedDisarm();
        }
        if (ifaceId === '__ADD_TCP__') {
            const host = window.prompt('Enter ESP32-S3 IP or hostname (e.g. 192.168.1.150):', '192.168.1.150');
            if (host && host.trim()) {
                const portStr = window.prompt('Enter TCP port (default 9751):', '9751');
                const port = portStr ? Number(portStr.trim()) : 9751;
                try {
                    const newIface = await this.canRpcClient.registerTcpDevice(host.trim(), port);
                    ifaceId = newIface.id;
                } catch (err) {
                    console.error('Failed to register TCP device:', err);
                    this.updateInterfaceChoices();
                    return;
                }
            } else {
                this.updateInterfaceChoices();
                return;
            }
        }
        this.selectedInterface = ifaceId;
        this.updateInterfaceChoices();
    }

    protected collectArmAllowlist(): number[] {
        return [...new Set([
            this.txCanId,
            this.waveCanId,
            this.composerCanId,
            ...Array.from({ length: 10 }, (_, index) => 0x100 + index)
        ])];
    }

    protected parseCanId(value: string): number | undefined {
        const raw = value.trim();
        if (!/^(?:0x)?[0-9A-Fa-f]{1,8}$/.test(raw)) {
            return undefined;
        }
        const parsed = Number.parseInt(raw.replace(/^0x/i, ''), 16);
        return parsed <= 0x1FFFFFFF ? parsed : undefined;
    }

    protected async transmitFrame(frame: CanFrame): Promise<boolean> {
        if (!this.isArmed || this.txInFlight) {
            return false;
        }
        this.txInFlight = true;
        try {
            const sent = await this.canRpcClient.sendFrame(frame);
            if (!sent) {
                await this.failClosedDisarm();
                return false;
            }
            this.totalTxCount++;
            this.txInWindow++;
            this.updateStatusBar();
            return true;
        } catch (err) {
            console.error('CAN transmission failed:', err);
            await this.failClosedDisarm();
            return false;
        } finally {
            this.txInFlight = false;
        }
    }

    protected async failClosedDisarm(): Promise<void> {
        this.isArmed = false;
        this.stopAllTransmissions();
        try {
            await this.canRpcClient.disarmTransmit();
        } catch (err) {
            console.error('CAN DISARM request failed:', err);
        }
        if (this.armButtonEl) {
            this.armButtonEl.className = 'theia-button can-gen-arm-btn disarmed';
            this.armButtonEl.textContent = '🛡️ DISARMED (Fail-Closed)';
        }
        this.updateStatusBar();
        this.renderTabContent();
    }

    protected async updateInterfaceChoices(): Promise<void> {
        if (!this.interfaceSelectEl) { return; }
        const previous = this.selectedInterface;
        this.interfaceSelectEl.replaceChildren();

        try {
            const ifaces = await this.canRpcClient.getAvailableInterfaces();
            for (const iface of ifaces) {
                const opt = document.createElement('option');
                opt.value = iface.id;
                opt.textContent = `${iface.displayName} (${iface.id})`;
                if (iface.id === previous) { opt.selected = true; }
                this.interfaceSelectEl.appendChild(opt);
            }
        } catch {
            for (const name of ['demo', 'demo2', 'sim0']) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                if (name === previous) { opt.selected = true; }
                this.interfaceSelectEl.appendChild(opt);
            }
        }

        const addTcpOpt = document.createElement('option');
        addTcpOpt.value = '__ADD_TCP__';
        addTcpOpt.textContent = '➕ Add TCP Device (IP:Port)…';
        this.interfaceSelectEl.appendChild(addTcpOpt);

        if (previous) {
            this.interfaceSelectEl.value = previous;
        }
    }

    protected formatWaveValue(val: number): string {
        const hex = (Math.round(val) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        return `Current Val: ${val.toFixed(1)} (0x${hex})`;
    }
}
