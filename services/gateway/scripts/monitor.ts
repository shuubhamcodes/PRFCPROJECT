import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';

interface PRFCState {
  ewma: number;
  slope: number;
  windowSize: number;
  thresholds: {
    ewmaMaxMs: number;
    slopeMinMsPerS: number;
    holdSec: number;
    cpuMax: number;
    bufMaxPct: number;
  };
  nodeHealth: Record<string, { cpu: number; bufferPct: number }>;
  activePath: string;
  backupPath: string;
  mode: string;
}

interface Stats {
  latencyRecords: number;
  resourceMetrics: number;
  incidents: number;
}

let lastIncidentCount = 0;

function formatPath(path: string): string {
  if (path === 'n1->n2->n3') return 'A';
  if (path === 'n1->n3') return 'B';
  return path;
}

function formatNodeHealth(nodeHealth: Record<string, { cpu: number; bufferPct: number }>): string {
  const entries = Object.entries(nodeHealth).map(([nodeId, health]) => {
    const cpu = (health.cpu * 100).toFixed(1);
    const buf = (health.bufferPct * 100).toFixed(1);
    return `${nodeId}(cpu:${cpu}%,buf:${buf}%)`;
  });
  return entries.join(' ');
}

async function monitor() {
  try {
    const [prfcResponse, statsResponse] = await Promise.all([
      axios.get<PRFCState>(`${GATEWAY_URL}/prfc/state`),
      axios.get<Stats>(`${GATEWAY_URL}/stats`),
    ]);

    const state = prfcResponse.data;
    const stats = statsResponse.data;

    const timestamp = new Date().toISOString().substring(11, 19);
    const pathLabel = formatPath(state.activePath);
    const ewma = state.ewma.toFixed(2);
    const slope = state.slope.toFixed(3);
    const nodeHealth = formatNodeHealth(state.nodeHealth);

    console.log(
      `[${timestamp}] Path:${pathLabel} MODE:${state.mode} EWMA:${ewma}ms SLOPE:${slope}ms/s ${nodeHealth}`
    );

    if (stats.incidents > lastIncidentCount) {
      const newIncidents = stats.incidents - lastIncidentCount;
      console.log(
        `\n🚨 FAILOVER TRIGGERED! ${newIncidents} new incident(s) logged. Check /stats for details.\n`
      );
      lastIncidentCount = stats.incidents;
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[ERROR] Failed to connect to gateway: ${error.message}`);
    } else {
      console.error(`[ERROR] ${error}`);
    }
  }
}

console.log('🔍 PRFC Monitor Started');
console.log(`Gateway: ${GATEWAY_URL}`);
console.log('Polling every 2 seconds...\n');

monitor();
setInterval(monitor, 2000);

process.on('SIGINT', () => {
  console.log('\n\n👋 Monitor stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Monitor stopped');
  process.exit(0);
});
