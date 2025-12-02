import { pino } from 'pino';
import dotenv from 'dotenv';
import axios from 'axios';
import { EventLike, now } from '@iot-lab/common';
import { randomUUID } from 'crypto';
import { FaultInjector, FaultKind, FaultTarget, FaultSeverity } from './faultInjector.js';
import { CSVReplayEngine } from './csvReplay.js';

dotenv.config();

const logger = pino({ level: 'info' });

const GATEWAY_INGEST = process.env.GATEWAY_INGEST || 'http://localhost:4000/ingest';
const MACHINES = parseInt(process.env.MACHINES || '10', 10);
const EPS = parseFloat(process.env.EPS || '5');
const DURATION_SEC = parseInt(process.env.DURATION_SEC || '300', 10);
const PLACEMENT = (process.env.PLACEMENT || 'edge') as 'edge' | 'fog' | 'cloud';
const ROUTING_MODE = process.env.ROUTING_MODE || 'physical';

const FAULT_KIND = (process.env.FAULT_KIND || 'none') as FaultKind;
const FAULT_TARGET = (process.env.FAULT_TARGET || 'n1') as FaultTarget;
const FAULT_START_SEC = parseInt(process.env.FAULT_START_SEC || '120', 10);
const FAULT_DURATION_SEC = parseInt(process.env.FAULT_DURATION_SEC || '60', 10);
const FAULT_SEVERITY = (process.env.FAULT_SEVERITY || 'medium') as FaultSeverity;

const DATASET_SOURCE = (process.env.DATASET_SOURCE || 'synthetic') as 'synthetic' | 'csv';
const CSV_PATH = process.env.CSV_PATH || './data/replay.csv';

const deviceIds = Array.from({ length: MACHINES }, (_, i) => `device-${i + 1}`);

const placementNoise: Record<string, { tempRange: number; pressureRange: number; vibRange: number; currentRange: number }> = {
  edge: { tempRange: 2, pressureRange: 0.05, vibRange: 0.05, currentRange: 0.1 },
  fog: { tempRange: 5, pressureRange: 0.1, vibRange: 0.1, currentRange: 0.2 },
  cloud: { tempRange: 10, pressureRange: 0.2, vibRange: 0.2, currentRange: 0.4 },
};

function jitter(base: number, range: number): number {
  return base + (Math.random() * 2 - 1) * range;
}

const edgeNodeDistribution: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
let edgeNodeCounter = 0;

function getNextEdgeNode(): number {
  const node = edgeNodeDistribution[edgeNodeCounter % edgeNodeDistribution.length];
  edgeNodeCounter++;
  return node;
}

function generateSyntheticEvent(deviceId: string): EventLike {
  const noise = placementNoise[PLACEMENT];

  const event: EventLike = {
    id: randomUUID(),
    deviceId,
    ts: now(),
    metrics: {
      temperature: jitter(70, noise.tempRange),
      pressure: jitter(1.2, noise.pressureRange),
      vibration: jitter(0.55, noise.vibRange),
      motorCurrent: jitter(3.15, noise.currentRange),
    },
    deadlineMs: 150,
  };

  if (ROUTING_MODE === 'virtual') {
    (event as any).virtualEdgeNode = getNextEdgeNode();
  }

  return event;
}

let csvEngine: CSVReplayEngine | null = null;

function getEvents(): EventLike[] {
  if (DATASET_SOURCE === 'csv') {
    if (!csvEngine) {
      throw new Error('CSV engine not initialized');
    }
    return csvEngine.getNextEvents(MACHINES);
  }

  return deviceIds.map(deviceId => generateSyntheticEvent(deviceId));
}

let totalSent = 0;
let totalAcked = 0;
let totalErrors = 0;
const edgeNodeStats: Record<number, number> = {};

for (let i = 1; i <= 8; i++) {
  edgeNodeStats[i] = 0;
}

async function sendBatch(): Promise<void> {
  const events = getEvents();

  if (ROUTING_MODE === 'virtual') {
    events.forEach(event => {
      const virtualNode = (event as any).virtualEdgeNode;
      if (virtualNode) {
        edgeNodeStats[virtualNode] = (edgeNodeStats[virtualNode] || 0) + 1;
      }
    });
  }

  try {
    const response = await axios.post(GATEWAY_INGEST, events, { timeout: 5000 });
    totalSent += events.length;
    totalAcked += response.data.accepted || 0;
  } catch (error) {
    totalErrors++;
    logger.error(`Failed to send batch: ${error}`);
  }
}

function logStats(elapsedSec: number): void {
  const dropped = totalSent - totalAcked;
  const dropRate = totalSent > 0 ? ((dropped / totalSent) * 100).toFixed(1) : '0.0';
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const timeStr = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;

  const statusIcon = totalErrors > 0 ? '❌' : parseFloat(dropRate) > 50 ? '⚠️' : parseFloat(dropRate) > 0 ? '⚡' : '✅';
  let statsMsg = `${statusIcon} [${timeStr.padEnd(5)}] Sent: ${totalSent.toString().padEnd(4)} | Acked: ${totalAcked.toString().padEnd(4)} | Dropped: ${dropped.toString().padEnd(3)} (${dropRate.padStart(4)}%) | Errors: ${totalErrors}`;

  if (ROUTING_MODE === 'virtual' && totalSent > 0) {
    const edgeDistribution = Object.entries(edgeNodeStats)
      .map(([node, count]) => `n${node}:${((count / totalSent) * 100).toFixed(0)}%`)
      .join(' ');
    statsMsg += ` | 🌐 ${edgeDistribution}`;
  }

  console.log(statsMsg);
}

async function run() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 IoT Simulator Starting');
  console.log('='.repeat(70));
  console.log(`📡 Gateway: ${GATEWAY_INGEST}`);
  console.log(`🔀 Routing Mode: ${ROUTING_MODE === 'virtual' ? '🌐 Virtual' : '🔌 Physical'}`);
  console.log(`🤖 Machines: ${MACHINES} | ⚡ EPS: ${EPS} | ⏱️  Duration: ${DURATION_SEC}s`);
  console.log(`📍 Placement: ${PLACEMENT}`);
  if (ROUTING_MODE === 'virtual') {
    console.log(`🌐 Virtual Network: USNet Topology (24 nodes, 28 links)`);
    console.log(`   └─ Edge(1-8) → Core(9-18) → Cloud(19-24)`);
  }
  console.log(`📊 Dataset: ${DATASET_SOURCE}${DATASET_SOURCE === 'csv' ? ` (${CSV_PATH})` : ''}`);
  if (FAULT_KIND !== 'none') {
    console.log(`⚠️  Fault Scenario: ${FAULT_KIND.toUpperCase()} on ${FAULT_TARGET}`);
    console.log(`   └─ Start: ${FAULT_START_SEC}s | Duration: ${FAULT_DURATION_SEC}s | Severity: ${FAULT_SEVERITY}`);
  } else {
    console.log(`✅ No faults configured - Normal operation`);
  }
  console.log('='.repeat(70) + '\n');

  if (DATASET_SOURCE === 'csv') {
    try {
      csvEngine = new CSVReplayEngine(CSV_PATH);
    } catch (error) {
      logger.error('Failed to initialize CSV engine, falling back to synthetic');
    }
  }

  const faultInjector = new FaultInjector({
    kind: FAULT_KIND,
    target: FAULT_TARGET,
    startSec: FAULT_START_SEC,
    durationSec: FAULT_DURATION_SEC,
    severity: FAULT_SEVERITY,
  });

  const startTime = Date.now();
  const intervalMs = 1000 / EPS;
  let lastLogSec = 0;
  let faultInjected = false;
  let faultRemoved = false;

  const sendInterval = setInterval(async () => {
    await sendBatch();
  }, intervalMs);

  const monitorInterval = setInterval(async () => {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

    if (elapsedSec > lastLogSec) {
      const timeToFault = FAULT_START_SEC - elapsedSec;
      if (FAULT_KIND !== 'none' && !faultInjected && timeToFault > 0 && timeToFault <= 10) {
        const countdownIcon = timeToFault <= 3 ? '🔴' : timeToFault <= 5 ? '🟡' : '🟢';
        console.log(`${countdownIcon} [${elapsedSec}s] Fault injection in ${timeToFault}s...`);
      } else {
        logStats(elapsedSec);
      }
      lastLogSec = elapsedSec;
    }

    if (!faultInjected && faultInjector.shouldActivate(elapsedSec)) {
      console.log('\n' + '🔥'.repeat(35));
      console.log(`🔥 INJECTING FAULT: ${FAULT_KIND.toUpperCase()} on ${FAULT_TARGET} (${FAULT_SEVERITY})`);
      console.log('🔥'.repeat(35) + '\n');
      await faultInjector.injectFault();
      faultInjected = true;
    }

    if (faultInjected && !faultRemoved && faultInjector.hasEnded(elapsedSec)) {
      console.log('\n' + '✅'.repeat(35));
      console.log(`✅ REMOVING FAULT: ${FAULT_KIND.toUpperCase()} on ${FAULT_TARGET}`);
      console.log('✅'.repeat(35) + '\n');
      await faultInjector.removeFault();
      faultRemoved = true;
    }

    if (elapsedSec >= DURATION_SEC) {
      clearInterval(sendInterval);
      clearInterval(monitorInterval);

      if (faultInjected && !faultRemoved) {
        await faultInjector.removeFault();
      }

      console.log('\n' + '='.repeat(70));
      console.log('🎉 Simulation Complete');
      console.log('='.repeat(70));
      logStats(elapsedSec);
      console.log('='.repeat(70) + '\n');

      process.exit(0);
    }
  }, 1000);
}

run().catch((error) => {
  logger.error('Simulator crashed:', error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('Simulator shutting down...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Simulator shutting down...');
  process.exit(0);
});
