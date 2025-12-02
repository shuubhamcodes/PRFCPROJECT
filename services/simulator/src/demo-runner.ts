import { pino } from 'pino';
import axios from 'axios';
import { EventLike, now } from '@iot-lab/common';
import { randomUUID } from 'crypto';
import { FaultInjector, FaultKind, FaultTarget, FaultSeverity } from './faultInjector.js';
import chalk from 'chalk';

const MACHINE_NAMES = [
  'CNC-Mill-A1',
  'Lathe-B2',
  'Welder-C3',
  'Press-D4',
  'Conveyor-E5',
  'Robot-Arm-F6',
  'Sensor-Hub-G7',
  'PLC-Unit-H8',
  'Pump-Station-I9',
  'Valve-Control-J10'
];

const logger = pino({ level: 'error' });

interface DemoPreset {
  name: string;
  faultKind: FaultKind;
  faultTarget: FaultTarget;
  faultStartSec: number;
  faultDurationSec: number;
  faultSeverity: FaultSeverity;
  durationSec: number;
  mode?: string;
  description: string;
}

const PRESETS: Record<string, DemoPreset> = {
  none: {
    name: 'none',
    faultKind: 'none',
    faultTarget: 'n1',
    faultStartSec: 0,
    faultDurationSec: 0,
    faultSeverity: 'medium',
    durationSec: 120,
    description: 'Baseline - No faults',
  },
  cpu_overload: {
    name: 'cpu_overload',
    faultKind: 'cpu_overload',
    faultTarget: 'n1',
    faultStartSec: 60,
    faultDurationSec: 40,
    faultSeverity: 'high',
    durationSec: 120,
    description: 'CPU overload on Edge node (n1)',
  },
  bw_drop: {
    name: 'bw_drop',
    faultKind: 'bw_drop',
    faultTarget: 'L12',
    faultStartSec: 60,
    faultDurationSec: 40,
    faultSeverity: 'high',
    durationSec: 120,
    description: 'Bandwidth drop on Link L12',
  },
  dp_spike: {
    name: 'dp_spike',
    faultKind: 'dp_spike',
    faultTarget: 'L23',
    faultStartSec: 60,
    faultDurationSec: 40,
    faultSeverity: 'high',
    durationSec: 120,
    description: 'Delay spike on Link L23',
  },
  loss_burst: {
    name: 'loss_burst',
    faultKind: 'loss_burst',
    faultTarget: 'L13',
    faultStartSec: 60,
    faultDurationSec: 40,
    faultSeverity: 'high',
    durationSec: 120,
    description: 'Loss burst on Link L13',
  },
  node_crash: {
    name: 'node_crash',
    faultKind: 'node_crash',
    faultTarget: 'n1',
    faultStartSec: 60,
    faultDurationSec: 40,
    faultSeverity: 'high',
    durationSec: 120,
    mode: 'reactive',
    description: 'Node crash on Edge node (n1) - Reactive mode',
  },
  disk_stall: {
    name: 'disk_stall',
    faultKind: 'disk_stall',
    faultTarget: 'n1',
    faultStartSec: 60,
    faultDurationSec: 40,
    faultSeverity: 'high',
    durationSec: 120,
    description: 'Disk stall on Edge node (n1)',
  },
};

const GATEWAY_INGEST = process.env.GATEWAY_INGEST || 'http://localhost:4000/ingest';
const GATEWAY_CONFIG = process.env.GATEWAY_CONFIG || 'http://localhost:4000/config';
const GATEWAY_PRFC = process.env.GATEWAY_PRFC || 'http://localhost:4000/prfc/state';
const MACHINES = 10;
const EPS = 5;
const PLACEMENT = 'edge';

const deviceIds = Array.from({ length: MACHINES }, (_, i) => MACHINE_NAMES[i] || `device-${i + 1}`);

function jitter(base: number, range: number): number {
  return base + (Math.random() * 2 - 1) * range;
}

function generateSyntheticEvent(deviceId: string): EventLike {
  return {
    id: randomUUID(),
    deviceId,
    ts: now(),
    metrics: {
      temperature: jitter(70, 2),
      pressure: jitter(1.2, 0.05),
      vibration: jitter(0.55, 0.05),
      motorCurrent: jitter(3.15, 0.1),
    },
    deadlineMs: 150,
  };
}

function getEvents(): EventLike[] {
  return deviceIds.map(deviceId => generateSyntheticEvent(deviceId));
}

let totalSent = 0;
let totalAcked = 0;
let totalErrors = 0;
let latencySum = 0;
let latencyCount = 0;

async function sendBatch(): Promise<void> {
  const events = getEvents();
  const sendTime = Date.now();

  try {
    const response = await axios.post(GATEWAY_INGEST, events, { timeout: 5000 });
    const latency = Date.now() - sendTime;

    totalSent += events.length;
    totalAcked += response.data.accepted || 0;
    latencySum += latency;
    latencyCount++;
  } catch (error) {
    totalErrors++;
  }
}

function printHelp(): void {
  console.log(chalk.cyan('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║         IoT Resilience Demo Runner - Fault Presets        ║'));
  console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝\n'));

  console.log(chalk.white('Usage:'));
  console.log(chalk.yellow('  pnpm --filter simulator demo <fault_type>\n'));

  console.log(chalk.white('Available fault types:\n'));

  Object.entries(PRESETS).forEach(([key, preset]) => {
    console.log(chalk.green(`  ${key.padEnd(15)}`) + chalk.gray(` - ${preset.description}`));
  });

  console.log(chalk.white('\nExamples:'));
  console.log(chalk.yellow('  pnpm --filter simulator demo none'));
  console.log(chalk.yellow('  pnpm --filter simulator demo cpu_overload'));
  console.log(chalk.yellow('  pnpm --filter simulator demo bw_drop\n'));
}

async function checkGatewayHealth(): Promise<boolean> {
  try {
    await axios.get(GATEWAY_CONFIG, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

async function getPRFCState(): Promise<any> {
  try {
    const response = await axios.get(GATEWAY_PRFC, { timeout: 2000 });
    return response.data;
  } catch (error) {
    return null;
  }
}

async function getGatewayStats(): Promise<any> {
  try {
    const response = await axios.get('http://localhost:4000/stats', { timeout: 2000 });
    return response.data;
  } catch (error) {
    return null;
  }
}

async function runDemo(preset: DemoPreset): Promise<void> {
  console.log(chalk.cyan('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan(`║  DEMO: ${preset.name.toUpperCase().padEnd(50)} ║`));
  console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝\n'));

  console.log(chalk.white(`Description: ${preset.description}`));
  console.log(chalk.white(`Duration: ${preset.durationSec}s | Fault @ ${preset.faultStartSec}s for ${preset.faultDurationSec}s\n`));

  const isHealthy = await checkGatewayHealth();
  if (!isHealthy) {
    console.log(chalk.red('❌ Gateway not responding. Please start gateway first:'));
    console.log(chalk.yellow('   pnpm --filter gateway dev\n'));
    process.exit(1);
  }

  if (preset.mode) {
    try {
      await axios.post(GATEWAY_CONFIG, { MODE: preset.mode });
      console.log(chalk.blue(`[CONFIG] Set mode to ${preset.mode}\n`));
    } catch (error) {
      console.log(chalk.yellow(`[WARN] Could not set mode: ${error}\n`));
    }
  }

  const faultInjector = new FaultInjector({
    kind: preset.faultKind,
    target: preset.faultTarget,
    startSec: preset.faultStartSec,
    durationSec: preset.faultDurationSec,
    severity: preset.faultSeverity,
  });

  const startTime = Date.now();
  const intervalMs = 1000 / EPS;
  let faultInjected = false;
  let faultRemoved = false;
  let lastIncidentCount = 0;
  let mttr = 0;

  console.log(chalk.cyan('\n' + '═'.repeat(70)));
  console.log(chalk.cyan('  🏭 INDUSTRIAL IoT MONITORING - PRODUCTION LINE ACTIVE'));
  console.log(chalk.cyan('═'.repeat(70)));
  console.log(chalk.white(`  📍 Monitoring: ${MACHINES} industrial machines`));
  console.log(chalk.white(`  📊 Event Rate: ${EPS} events/sec per machine`));
  console.log(chalk.white(`  🎯 SLA Target: <150ms latency, >99% delivery`));
  console.log(chalk.cyan('═'.repeat(70) + '\n'));

  console.log(chalk.green('✅ Phase 1: NORMAL OPERATION') + chalk.gray(' (Establishing baseline...)\n'));

  const sendInterval = setInterval(async () => {
    await sendBatch();
  }, intervalMs);

  const monitorInterval = setInterval(async () => {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

    if (!faultInjected && faultInjector.shouldActivate(elapsedSec)) {
      console.log('\n' + chalk.red('━'.repeat(70)));
      console.log(chalk.red.bold('  ⚠️  PHASE 2: FAULT INJECTION INITIATED'));
      console.log(chalk.red('━'.repeat(70)));
      console.log(chalk.yellow(`  🔥 Fault Type: ${preset.faultKind.toUpperCase().replace('_', ' ')}`));
      console.log(chalk.yellow(`  🎯 Target: ${preset.faultTarget} (${preset.faultSeverity} severity)`));
      console.log(chalk.yellow(`  ⏱️  Duration: ${preset.faultDurationSec} seconds`));
      console.log(chalk.yellow(`  📈 Expected Impact: Increased latency, potential packet loss`));
      console.log(chalk.red('━'.repeat(70) + '\n'));
      await faultInjector.injectFault();
      faultInjected = true;
    }

    if (faultInjected && !faultRemoved && faultInjector.hasEnded(elapsedSec)) {
      console.log('\n' + chalk.green('━'.repeat(70)));
      console.log(chalk.green.bold('  ✅ PHASE 3: RECOVERY MODE'));
      console.log(chalk.green('━'.repeat(70)));
      console.log(chalk.white('  🔧 Removing fault condition...'));
      console.log(chalk.white('  📊 Monitoring system recovery...'));
      console.log(chalk.green('━'.repeat(70) + '\n'));
      await faultInjector.removeFault();
      faultRemoved = true;
    }

    if (elapsedSec % 10 === 0 && elapsedSec > 0) {
      const prfcState = await getPRFCState();
      const stats = await getGatewayStats();

      const avgLatency = latencyCount > 0 ? (latencySum / latencyCount).toFixed(2) : '0';
      const dropped = totalSent - totalAcked;
      const dropRate = totalSent > 0 ? ((dropped / totalSent) * 100).toFixed(1) : '0.0';

      const deliveryPct = totalSent > 0 ? ((totalAcked / totalSent) * 100).toFixed(1) : '100.0';
      const deliveryIcon = parseFloat(deliveryPct) >= 99 ? '✅' : parseFloat(deliveryPct) >= 95 ? '⚠️' : '❌';
      const latencyIcon = parseFloat(avgLatency) <= 150 ? '✅' : parseFloat(avgLatency) <= 300 ? '⚠️' : '❌';

      if (prfcState) {
        const ewma = prfcState.ewma.toFixed(1);
        const slope = prfcState.slope.toFixed(2);
        const ewmaStatus = parseFloat(ewma) > 100 ? chalk.red('HIGH') : parseFloat(ewma) > 70 ? chalk.yellow('WARN') : chalk.green('OK');
        const slopeStatus = parseFloat(slope) > 5 ? chalk.red('↗️ RISING') : parseFloat(slope) > 2 ? chalk.yellow('↗️ UP') : chalk.green('→ STABLE');

        console.log(
          chalk.cyan(`⏱️  [${elapsedSec}s]`) + ' │ ' +
          chalk.white(`Machines: ${totalSent} events`) + ' │ ' +
          deliveryIcon + chalk.white(` ${deliveryPct}% delivered`) + ' │ ' +
          latencyIcon + chalk.white(` ${avgLatency}ms avg`) + '\n' +
          '        │ ' +
          chalk.magenta('PRFC:') + ` EWMA=${ewma}ms ${ewmaStatus} │ Slope=${slope}ms/s ${slopeStatus} │ Path=${prfcState.activePath}`
        );
      } else {
        console.log(
          chalk.cyan(`⏱️  [${elapsedSec}s]`) + ' │ ' +
          chalk.white(`Events: ${totalSent}`) + ' │ ' +
          deliveryIcon + chalk.white(` ${deliveryPct}% delivered`) + ' │ ' +
          latencyIcon + chalk.white(` ${avgLatency}ms latency`)
        );
      }

      if (stats && stats.incidents > lastIncidentCount) {
        console.log('\n' + chalk.red('▓'.repeat(70)));
        console.log(chalk.red.bold('  🚨 PRFC PREDICTIVE FAILOVER ACTIVATED!'));
        console.log(chalk.red('▓'.repeat(70)));
        console.log(chalk.yellow(`  📊 Detected: Latency degradation before SLA breach`));
        console.log(chalk.yellow(`  🔄 Action: Switching to alternate path`));
        console.log(chalk.yellow(`  🎯 Goal: Maintain <150ms latency & 99% delivery`));
        console.log(chalk.red('▓'.repeat(70) + '\n'));
        lastIncidentCount = stats.incidents;
      }
    }

    if (elapsedSec >= preset.durationSec) {
      clearInterval(sendInterval);
      clearInterval(monitorInterval);

      if (faultInjected && !faultRemoved) {
        await faultInjector.removeFault();
      }

      const avgLatency = latencyCount > 0 ? (latencySum / latencyCount).toFixed(2) : '0';
      const dropped = totalSent - totalAcked;
      const dropRate = totalSent > 0 ? ((dropped / totalSent) * 100).toFixed(1) : '0.0';
      const deliveryRate = totalSent > 0 ? ((totalAcked / totalSent) * 100).toFixed(1) : '0.0';

      console.log('\n' + chalk.cyan('╔' + '═'.repeat(68) + '╗'));
      console.log(chalk.cyan('║') + chalk.bold.white('               🏭 INDUSTRIAL IoT DEMO - FINAL REPORT               ') + chalk.cyan('║'));
      console.log(chalk.cyan('╚' + '═'.repeat(68) + '╝\n'));

      console.log(chalk.white.bold('  📋 TEST CONFIGURATION'));
      console.log(chalk.gray('  ─'.repeat(34)));
      console.log(chalk.white(`  Fault Type:           ${preset.faultKind.toUpperCase().replace('_', ' ')}`));
      console.log(chalk.white(`  Target:               ${preset.faultTarget}`));
      console.log(chalk.white(`  Test Duration:        ${preset.durationSec}s`));
      console.log(chalk.white(`  Machines Monitored:   ${MACHINES} industrial devices\n`));

      console.log(chalk.white.bold('  📊 PERFORMANCE METRICS'));
      console.log(chalk.gray('  ─'.repeat(34)));
      console.log(chalk.white(`  Total Events Sent:    ${totalSent} events`));
      console.log(chalk.white(`  Total Acknowledged:   ${totalAcked} events`));
      console.log(chalk.white(`  Events Dropped:       ${dropped} events (${dropRate}%)`));

      const deliveryStatus = parseFloat(deliveryRate) >= 99 ? chalk.green('✅ EXCELLENT') : parseFloat(deliveryRate) >= 95 ? chalk.yellow('⚠️  ACCEPTABLE') : chalk.red('❌ POOR');
      console.log(chalk.white(`  Delivery Rate:        ${deliveryRate}% `) + deliveryStatus);

      const latencyStatus = parseFloat(avgLatency) <= 150 ? chalk.green('✅ WITHIN SLA') : parseFloat(avgLatency) <= 300 ? chalk.yellow('⚠️  DEGRADED') : chalk.red('❌ BREACH');
      console.log(chalk.white(`  Avg Latency:          ${avgLatency}ms `) + latencyStatus);
      console.log(chalk.white(`  Network Errors:       ${totalErrors}\n`));

      const stats = await getGatewayStats();
      if (stats && stats.incidents > 0) {
        console.log(chalk.white.bold('  🔄 PRFC RESILIENCE'));
        console.log(chalk.gray('  ─'.repeat(34)));
        console.log(chalk.yellow(`  Failover Events:      ${stats.incidents}`));
        console.log(chalk.green(`  Protection Status:    ACTIVE`));
        if (mttr > 0) {
          console.log(chalk.green(`  MTTR:                 ${mttr.toFixed(2)}s`));
        }
        console.log(chalk.white(`  Predictive Action:    Path rerouting activated\n`));
      } else {
        console.log(chalk.white.bold('  🔄 PRFC RESILIENCE'));
        console.log(chalk.gray('  ─'.repeat(34)));
        console.log(chalk.green(`  Failover Events:      0 (No incidents detected)`));
        console.log(chalk.green(`  Protection Status:    MONITORING\n`));
      }

      console.log(chalk.cyan('╚' + '═'.repeat(68) + '╝\n'));

      process.exit(0);
    }
  }, 1000);
}

async function main() {
  const faultType = process.argv[2];

  if (!faultType) {
    printHelp();
    process.exit(0);
  }

  const preset = PRESETS[faultType];

  if (!preset) {
    console.log(chalk.red(`\n❌ Unknown fault type: ${faultType}\n`));
    printHelp();
    process.exit(1);
  }

  await runDemo(preset);
}

main().catch((error) => {
  console.error(chalk.red('Demo crashed:'), error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n👋 Demo interrupted\n'));
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Demo interrupted\n'));
  process.exit(0);
});
