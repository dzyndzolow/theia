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
import { CanDeviceRegistry, CanDeviceRegistryImpl } from './can-device-registry';
import { Esp32CanDeviceProvider } from './esp32-can-device-provider';
import { PcanBasicDeviceProvider } from './pcan-basic-provider';
import { SlcanDeviceProvider, SlcanCodec } from './slcan-device-provider';
import { IByteTransport } from './esp32-can-session';
import { CanDeviceHardwareBridge, ICanFrameSink } from './can-device-adapter';
import { TcanCodec, TcanMessageType, TCAN_FLAG_EVENT } from '../../common/esp32-can-device-protocol';
import { CanFrame } from '../../common/can-protocol';

describe('SA-HW-001: Hardware Layer Integration (ESP32-S3, PCAN-Basic, SLCAN, Registry)', () => {
    let registry: CanDeviceRegistry;
    let esp32Provider: Esp32CanDeviceProvider;
    let pcanProvider: PcanBasicDeviceProvider;
    let slcanProvider: SlcanDeviceProvider;

    beforeEach(() => {
        esp32Provider = new Esp32CanDeviceProvider();
        pcanProvider = new PcanBasicDeviceProvider();
        slcanProvider = new SlcanDeviceProvider();
        esp32Provider.enableTestFixtures();
        pcanProvider.enableTestFixtures();
        slcanProvider.enableTestFixtures();

        registry = new CanDeviceRegistryImpl([esp32Provider, pcanProvider, slcanProvider]);
    });

    it('does not advertise fabricated physical devices without explicit test fixtures', async () => {
        const productionRegistry = new CanDeviceRegistryImpl([
            new Esp32CanDeviceProvider(),
            new PcanBasicDeviceProvider(),
            new SlcanDeviceProvider()
        ]);
        expect(await productionRegistry.discoverAllDevices()).to.deep.equal([]);
    });

    it('should discover devices from all providers and merge endpoints for multi-transport hardware', async () => {
        const devices = await registry.discoverAllDevices();

        // Must discover ESP32, PCAN and SLCAN
        expect(devices.length).to.be.at.least(3);

        const esp32Dev = devices.find(d => d.deviceId === 'esp32s3-can-ref01');
        expect(esp32Dev).to.not.be.undefined;
        // ESP32 has both USB and TCP endpoints merged under a single deviceId
        expect(esp32Dev?.endpoints).to.have.lengthOf(2);
        expect(esp32Dev?.endpoints[0].transportType).to.equal('USB_CDC');
        expect(esp32Dev?.endpoints[1].transportType).to.equal('TCP');

        const pcanDev = devices.find(d => d.deviceId === 'pcan-usb-ch1');
        expect(pcanDev).to.not.be.undefined;

        const slcanDev = devices.find(d => d.deviceId === 'canable-slcan-01');
        expect(slcanDev).to.not.be.undefined;
    });

    it('should establish ESP32-S3 session, complete HELLO handshake, and stream RX_BATCH frames', async () => {
        const sentToDevice: Uint8Array[] = [];
        let onDataHandler: ((chunk: Uint8Array) => void) | undefined;

        const mockTransport: IByteTransport = {
            send: (data: Uint8Array) => {
                sentToDevice.push(data);
            },
            onData: (cb: (chunk: Uint8Array) => void) => {
                onDataHandler = cb;
            },
            close: () => { /* no-op */ }
        };

        esp32Provider.registerMockTransport('esp32s3-can:ref01:tcp', mockTransport);

        const session = await registry.connectSession('esp32s3-can:ref01:tcp');
        expect(session.isConnected()).to.be.true;
        expect(sentToDevice.length).to.be.at.least(1); // Sent HELLO

        const receivedFrames: CanFrame[] = [];
        session.onFramesReceived(frames => {
            receivedFrames.push(...frames);
        });

        // Simulate incoming RX_BATCH packet from ESP32
        const testFrames: CanFrame[] = [
            {
                id: 0x350,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88],
                timestamp: 2000,
                interface: 'esp32s3-can:ref01:tcp'
            }
        ];
        const rxBatchPayload = TcanCodec.encodeRxBatch(testFrames);
        const rxBatchMsg = TcanCodec.encodeMessage(TcanMessageType.RX_BATCH, rxBatchPayload, {
            sessionId: 1,
            sequence: 1,
            flags: TCAN_FLAG_EVENT
        });

        onDataHandler!(rxBatchMsg);

        expect(receivedFrames).to.have.lengthOf(1);
        expect(receivedFrames[0].id).to.equal(0x350);
        expect(receivedFrames[0].data[0]).to.equal(0x11);

        await session.close();
    });

    it('should enforce Single Control Lease: reject connecting a second endpoint on the same deviceId', async () => {
        const mockTransport1: IByteTransport = {
            send: () => {},
            onData: () => {},
            close: () => {}
        };
        const mockTransport2: IByteTransport = {
            send: () => {},
            onData: () => {},
            close: () => {}
        };

        esp32Provider.registerMockTransport('esp32s3-can:ref01:tcp', mockTransport1);
        esp32Provider.registerMockTransport('esp32s3-can:ref01:usb', mockTransport2);

        const session1 = await registry.connectSession('esp32s3-can:ref01:tcp');
        expect(session1.isConnected()).to.be.true;

        // Trying to connect endpoint 'esp32s3-can:ref01:usb' on the same physical device must throw BUSY
        let failed = false;
        try {
            await registry.connectSession('esp32s3-can:ref01:usb');
        } catch (err: unknown) {
            failed = true;
            expect(String(err)).to.include('busy: active control lease held');
        }
        expect(failed).to.be.true;

        await session1.close();
    });

    it('should correctly format and parse SLCAN ASCII protocol for CANable 2.0', () => {
        // Standard frame format: t1234DEADBEEF
        const stdFrame: CanFrame = {
            id: 0x123,
            extended: false,
            rtr: false,
            dlc: 4,
            data: [0xDE, 0xAD, 0xBE, 0xEF],
            timestamp: 0,
            interface: 'slcan'
        };
        const formattedStd = SlcanCodec.formatFrame(stdFrame);
        expect(formattedStd).to.equal('t1234DEADBEEF');

        const parsedStd = SlcanCodec.parseFrame('t1234DEADBEEF\r');
        expect(parsedStd).to.not.be.undefined;
        expect(parsedStd?.id).to.equal(0x123);
        expect(parsedStd?.data).to.deep.equal([0xDE, 0xAD, 0xBE, 0xEF]);

        // Extended frame format: T18DA00F13021001
        const extFrame: CanFrame = {
            id: 0x18DA00F1,
            extended: true,
            rtr: false,
            dlc: 3,
            data: [0x02, 0x10, 0x01],
            timestamp: 0,
            interface: 'slcan'
        };
        const formattedExt = SlcanCodec.formatFrame(extFrame);
        expect(formattedExt).to.equal('T18DA00F13021001');

        const parsedExt = SlcanCodec.parseFrame('T18DA00F13021001\r');
        expect(parsedExt).to.not.be.undefined;
        expect(parsedExt?.id).to.equal(0x18DA00F1);
        expect(parsedExt?.extended).to.be.true;
        expect(SlcanCodec.parseFrame('t1231AG')).to.be.undefined;
    });

    it('should bridge hardware session into CanSocketService and CanTransmitService via CanDeviceHardwareBridge', async () => {
        const pcanSession = await registry.connectSession('pcan:usb1');

        const socketReceived: CanFrame[] = [];
        const mockSink: ICanFrameSink = {
            onFrameReceived: (frame: CanFrame) => {
                socketReceived.push(frame);
            }
        };

        const bridge = new CanDeviceHardwareBridge(
            'pcan0',
            pcanSession,
            mockSink
        );

        await bridge.configure({ name: 'pcan0', bitrate: 500000 });
        await bridge.start();

        // Simulate frame arrival on PCAN session
        const testFrame: CanFrame = {
            id: 0x700,
            extended: false,
            rtr: false,
            dlc: 1,
            data: [0x55],
            timestamp: 100,
            interface: 'pcan:usb1'
        };
        pcanProvider.getSession('pcan:usb1')?.simulateRxFrames([testFrame]);

        expect(socketReceived).to.have.lengthOf(1);
        expect(socketReceived[0].id).to.equal(0x700);

        await bridge.stop();
        bridge.dispose();
    });
});
