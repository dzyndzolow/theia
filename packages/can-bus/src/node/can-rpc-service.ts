// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core/lib/common';
import {
    CanRpc,
    CanRpcClient,
    CanStatistics,
    CanInterfaceConfig,
    CanFrame,
    CanBinaryEncoder,
    CanRpcInterfaceInfo,
    CanTxArmRequest
} from '../common/can-protocol';
import { CanSocketService, ICanSocketService } from './can-socket-service';
import { CanDeviceRegistry } from './device/can-device-registry';
import { Esp32CanDeviceProvider } from './device/esp32-can-device-provider';
import { CanDeviceHardwareBridge } from './device/can-device-adapter';
import { CanTransmitService } from './can-transmit-service';
import { CanExperimentEventBus } from '../common/can-experiment-event-bus';

const BATCH_FLUSH_INTERVAL_MS = 30;
const MAX_PENDING_BATCH_SIZE = 5000;
const MAX_RPC_ALLOWLIST_SIZE = 2048;
const MAX_RPC_TX_FPS = 1000;
const MAX_RPC_BUS_LOAD_PERCENT = 70;
const MAX_RPC_ARM_DURATION_MS = 15 * 60 * 1000;
const MAX_ACTIVE_INTERFACES = 8;
const VIRTUAL_INTERFACES = new Set(['demo', 'demo2', 'sim0']);

@injectable()
export class CanRpcServiceImpl implements CanRpc {
    protected readonly toDispose = new DisposableCollection();
    protected readonly clients = new Set<CanRpcClient>();
    protected pendingBatch: CanFrame[] = [];
    protected batchTimer: ReturnType<typeof setInterval> | undefined;
    protected droppedFramesCount = 0;
    protected readonly activeInterfaces = new Set<string>();
    protected readonly activeConfigs = new Map<string, CanInterfaceConfig>();
    protected readonly hardwareBridges = new Map<string, CanDeviceHardwareBridge>();
    protected readonly txEventBus = new CanExperimentEventBus();
    protected armedInterface: string | undefined;
    protected armExpiryTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        @inject(CanSocketService) protected readonly socketService: ICanSocketService,
        @inject(CanDeviceRegistry) @optional() protected readonly deviceRegistry?: CanDeviceRegistry,
        @inject(Esp32CanDeviceProvider) @optional() protected readonly esp32Provider?: Esp32CanDeviceProvider,
        @inject(CanTransmitService) @optional() protected readonly transmitService?: CanTransmitService
    ) {
        this.toDispose.push(this.socketService.onFrameReceived(frame => this.onFrame(frame)));
    }

    protected onFrame(frame: CanFrame): void {
        if (this.pendingBatch.length < MAX_PENDING_BATCH_SIZE) {
            this.pendingBatch.push(frame);
        } else {
            // Drop-newest keeps the hot path O(1).  shift() made sustained
            // overload O(n) per frame and could amplify a CAN flood into an
            // event-loop denial of service.
            this.droppedFramesCount++;
        }
    }

    setClient(client: CanRpcClient): void {
        this.clients.add(client);
        const originalClose = client.onDidCloseConnection;
        client.onDidCloseConnection = () => {
            this.removeClient(client);
            if (originalClose) {
                try {
                    originalClose();
                } catch (e) {
                    console.warn('Error in client onDidCloseConnection:', e);
                }
            }
        };
    }

    removeClient(client: CanRpcClient): void {
        this.clients.delete(client);
        if (this.clients.size === 0) {
            this.stopBatching();
            this.stopAllInterfaces();
        }
    }

    async getAvailableInterfaces(): Promise<CanRpcInterfaceInfo[]> {
        const result: CanRpcInterfaceInfo[] = [
            {
                id: 'demo',
                displayName: 'Demo (Generator)',
                category: 'VIRTUAL',
                isHardware: false
            },
            {
                id: 'demo2',
                displayName: 'Demo 2 (Generator)',
                category: 'VIRTUAL',
                isHardware: false
            },
            {
                id: 'sim0',
                displayName: 'Simulator sim0 (Fast Bench)',
                category: 'VIRTUAL',
                isHardware: false
            }
        ];

        if (this.deviceRegistry) {
            try {
                const devices = await this.deviceRegistry.discoverAllDevices();
                for (const dev of devices) {
                    let category: 'ESP32' | 'PCAN' | 'SLCAN' | 'OTHER' = 'OTHER';
                    if (dev.deviceId.startsWith('esp32')) {
                        category = 'ESP32';
                    } else if (dev.deviceId.startsWith('pcan')) {
                        category = 'PCAN';
                    } else if (dev.deviceId.startsWith('canable')) {
                        category = 'SLCAN';
                    }

                    for (const ep of dev.endpoints) {
                        result.push({
                            id: ep.endpointId,
                            displayName: `${dev.name} — ${ep.displayName}`,
                            category,
                            isHardware: true,
                            transport: ep.transportType
                        });
                    }
                }
            } catch (err) {
                console.warn('Error discovering devices in CanRpcServiceImpl:', err);
            }
        }

        return result;
    }

    async registerTcpDevice(host: string, port = 9751): Promise<CanRpcInterfaceInfo> {
        if (!this.esp32Provider) {
            throw new Error('ESP32 device provider is not configured on backend');
        }
        if (typeof host !== 'string') {
            throw new Error('ESP32 host name must be a string.');
        }
        const normalizedHost = host.trim();
        if (normalizedHost.length === 0 || normalizedHost.length > 253 || /[\s\x00-\x1F\x7F]/.test(normalizedHost)) {
            throw new Error('ESP32 host name is empty or invalid.');
        }
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(`ESP32 TCP port '${port}' is outside 1..65535.`);
        }
        const endpoint = this.esp32Provider.registerTcpEndpoint(normalizedHost, port);
        return {
            id: endpoint.endpointId,
            displayName: `ESP32-S3 TCP (${normalizedHost}:${port})`,
            category: 'ESP32',
            isHardware: true,
            transport: 'TCP'
        };
    }

    async startCapture(config: CanInterfaceConfig): Promise<void> {
        if (!config || typeof config.name !== 'string' || !config.name
            || config.name.length > 256 || /[\x00-\x1F\x7F]/.test(config.name)
            || !Number.isSafeInteger(config.bitrate) || config.bitrate <= 0 || config.bitrate > 10_000_000
            || config.frameRate !== undefined
            && (!Number.isInteger(config.frameRate) || config.frameRate < 10 || config.frameRate > 5000)) {
            throw new Error('CAN interface name and positive integer bitrate are required.');
        }
        if (this.activeInterfaces.has(config.name)) {
            return;
        }
        if (this.activeInterfaces.size >= MAX_ACTIVE_INTERFACES) {
            throw new Error(`At most ${MAX_ACTIVE_INTERFACES} CAN interfaces may capture concurrently.`);
        }
        const isHardware = this.isHardwareInterface(config.name);
        if (!isHardware && !VIRTUAL_INTERFACES.has(config.name)) {
            throw new Error(`Unknown virtual CAN interface '${config.name}'.`);
        }

        // Check if config.name corresponds to a physical hardware endpoint
        if (isHardware) {
            if (!this.deviceRegistry) {
                throw new Error('CAN hardware registry is unavailable.');
            }
            let bridge: CanDeviceHardwareBridge | undefined;
            try {
                const session = await this.deviceRegistry.connectSession(config.name);
                bridge = new CanDeviceHardwareBridge(
                    config.name,
                    session,
                    {
                        onFrameReceived: (f: CanFrame) => this.onFrame(f)
                    }
                );
                await bridge.configure(config);
                await bridge.start();
                this.hardwareBridges.set(config.name, bridge);
            } catch (err) {
                bridge?.dispose();
                console.error(`Failed to start hardware capture on ${config.name}:`, err);
                throw err;
            }
        } else {
            // Virtual / simulator interface
            this.socketService.start(config);
        }

        if (this.activeInterfaces.size === 0) {
            this.pendingBatch = [];
            this.droppedFramesCount = 0;
        }
        this.activeInterfaces.add(config.name);
        this.activeConfigs.set(config.name, { ...config });
        this.startBatching();
    }

    async stopCapture(interfaceName?: string): Promise<void> {
        if (interfaceName) {
            if (this.armedInterface === interfaceName) {
                this.disarmTransmitNow();
            }
            this.activeInterfaces.delete(interfaceName);
            this.activeConfigs.delete(interfaceName);
            if (this.hardwareBridges.has(interfaceName)) {
                const bridge = this.hardwareBridges.get(interfaceName)!;
                this.hardwareBridges.delete(interfaceName);
                await bridge.stop();
                bridge.dispose();
            } else {
                this.socketService.stop(interfaceName);
            }
        } else if (interfaceName === undefined) {
            this.disarmTransmitNow();
            this.activeInterfaces.clear();
            this.activeConfigs.clear();
            for (const bridge of this.hardwareBridges.values()) {
                await bridge.stop();
                bridge.dispose();
            }
            this.hardwareBridges.clear();
            this.socketService.stop();
        }
        if (this.activeInterfaces.size === 0) {
            this.flushBatch();
            this.stopBatching();
        }
    }

    async getStatistics(): Promise<CanStatistics> {
        const stats = this.socketService.getStatistics();
        return {
            ...stats,
            droppedFrames: this.droppedFramesCount
        };
    }

    async armTransmit(request: CanTxArmRequest): Promise<void> {
        if (!this.transmitService) {
            throw new Error('CAN transmit service is unavailable; TX remains disarmed.');
        }
        if (!request || typeof request.interfaceName !== 'string') {
            throw new Error('ARM request and interface name are required.');
        }
        const interfaceName = request.interfaceName.trim();
        const captureConfig = this.activeConfigs.get(interfaceName);
        if (!captureConfig || !this.activeInterfaces.has(interfaceName)) {
            throw new Error(`CAN interface '${interfaceName}' must be actively capturing before ARM.`);
        }
        if (!Array.isArray(request.allowedIds) || request.allowedIds.length === 0
            || request.allowedIds.length > MAX_RPC_ALLOWLIST_SIZE) {
            throw new Error(`ARM requires 1..${MAX_RPC_ALLOWLIST_SIZE} explicit CAN identifiers.`);
        }
        const allowedIds = [...new Set(request.allowedIds)];
        if (allowedIds.some(id => !Number.isInteger(id) || id < 0 || id > 0x1FFFFFFF)) {
            throw new Error('ARM allowlist contains an invalid CAN identifier.');
        }
        if (!Number.isInteger(request.maxFps) || request.maxFps < 1 || request.maxFps > MAX_RPC_TX_FPS) {
            throw new Error(`ARM maxFps must be an integer in 1..${MAX_RPC_TX_FPS}.`);
        }
        if (!Number.isFinite(request.maxBusLoadPercent) || request.maxBusLoadPercent <= 0
            || request.maxBusLoadPercent > MAX_RPC_BUS_LOAD_PERCENT) {
            throw new Error(`ARM bus-load limit must be in (0, ${MAX_RPC_BUS_LOAD_PERCENT}].`);
        }
        if (!Number.isInteger(request.maxDurationMs) || request.maxDurationMs < 1000
            || request.maxDurationMs > MAX_RPC_ARM_DURATION_MS) {
            throw new Error(`ARM duration must be in 1000..${MAX_RPC_ARM_DURATION_MS} ms.`);
        }

        await this.disarmTransmit();
        const bridge = this.hardwareBridges.get(interfaceName);
        if (this.isHardwareInterface(interfaceName)) {
            if (!bridge) {
                throw new Error(`Hardware interface '${interfaceName}' has no connected transmit adapter.`);
            }
            this.transmitService.setAdapter(bridge);
        } else {
            // Explicit simulator adapter: unlike a hardware interface this is
            // intentionally looped back into the analyzer after policy checks.
            this.transmitService.setAdapter({
                sendFrame: frame => {
                    if (!this.activeInterfaces.has(interfaceName)) {
                        return false;
                    }
                    this.onFrame({
                        ...frame,
                        interface: interfaceName,
                        timestamp: frame.timestamp > 0 ? frame.timestamp : Date.now()
                    });
                    return true;
                }
            });
        }

        this.transmitService.setSessionConfig({
            sessionId: `rpc-${process.hrtime.bigint()}`,
            interfaceName,
            bitrate: captureConfig.bitrate,
            mode: captureConfig.fd ? 'CAN_FD' : 'CAN_2_0',
            idMode: request.allowExtendedIds || allowedIds.some(id => id > 0x7FF) ? 'MIXED' : 'STANDARD_11BIT',
            allowedIds,
            maxFps: request.maxFps,
            maxBusLoadPercent: request.maxBusLoadPercent,
            maxDurationMs: request.maxDurationMs,
            allowRemoteFrames: false,
            allowErrorFrames: false,
            allowDiagnosticServices: false
        }, this.txEventBus);
        this.transmitService.setState('ARMED');
        this.transmitService.setState('RUNNING');
        this.armedInterface = interfaceName;
        this.armExpiryTimer = setTimeout(() => {
            this.disarmTransmit().catch(err => console.error('Automatic CAN DISARM failed:', err));
        }, request.maxDurationMs);
        this.armExpiryTimer.unref?.();
    }

    async disarmTransmit(): Promise<void> {
        this.disarmTransmitNow();
    }

    protected disarmTransmitNow(): void {
        if (this.armExpiryTimer !== undefined) {
            clearTimeout(this.armExpiryTimer);
            this.armExpiryTimer = undefined;
        }
        this.armedInterface = undefined;
        this.transmitService?.setState('DISARMED');
    }

    async sendFrame(frame: CanFrame): Promise<boolean> {
        if (!frame || !this.transmitService || !this.armedInterface
            || frame.interface !== this.armedInterface
            || !this.activeInterfaces.has(this.armedInterface)) {
            return false;
        }
        const stats = this.socketService.getStatistics();
        this.transmitService.updateMetrics({
            currentFps: 0,
            estimatedBusLoadPercent: stats.busLoad,
            consecutiveErrors: stats.errors,
            isBusOff: false
        });
        return this.transmitService.transmit({ frame, sourceKind: 'LITERAL' });
    }

    async emergencyStop(): Promise<void> {
        await this.disarmTransmit();
        await Promise.allSettled([...this.hardwareBridges.values()].map(bridge => bridge.emergencyStop()));
        await this.stopCapture();
    }

    protected isHardwareInterface(interfaceName: string): boolean {
        return interfaceName.startsWith('esp32s3-can:')
            || interfaceName.startsWith('pcan:')
            || interfaceName.startsWith('canable:');
    }

    protected startBatching(): void {
        if (this.batchTimer !== undefined) { return; }
        this.batchTimer = setInterval(() => this.flushBatch(), BATCH_FLUSH_INTERVAL_MS);
    }

    protected stopBatching(): void {
        if (this.batchTimer !== undefined) {
            clearInterval(this.batchTimer);
            this.batchTimer = undefined;
        }
    }

    protected flushBatch(): void {
        if (this.pendingBatch.length === 0) { return; }
        if (this.clients.size === 0) {
            this.droppedFramesCount += this.pendingBatch.length;
            this.pendingBatch = [];
            return;
        }

        const batch = this.pendingBatch;
        this.pendingBatch = [];
        const chunk = CanBinaryEncoder.encodeBatch(batch);
        for (const client of this.clients) {
            try {
                client.onBinaryFrames?.(chunk);
            } catch (e) {
                console.warn('Error broadcasting binary chunk to CAN client:', e);
            }
        }
    }

    protected stopAllInterfaces(): void {
        // Apply the local cutoff synchronously.  Hardware E-STOP/close then
        // continues asynchronously, but no further host TX or simulator RX is
        // possible after this method returns.
        this.disarmTransmitNow();
        this.socketService.stop();
        this.activeInterfaces.clear();
        this.activeConfigs.clear();
        this.emergencyStop().catch(err => console.error('Failed to stop CAN interfaces:', err));
    }

    dispose(): void {
        this.stopBatching();
        this.stopAllInterfaces();
        this.txEventBus.dispose();
        this.toDispose.dispose();
    }
}
