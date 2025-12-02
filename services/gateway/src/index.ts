import express, { Request, Response } from 'express';
import { pino } from 'pino';
import dotenv from 'dotenv';
import axios from 'axios';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { EventArraySchema, EventLike, ResourceMetric, inMemoryDB, now } from '@iot-lab/common';
import { PRFCController } from './prfc.js';
import { GraphEngine } from './graphEngine.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const logger = pino({ level: 'error' });

const PORT = parseInt(process.env.PORT || '4000', 10);
const NODE_NAME = process.env.NODE_NAME || 'gateway';
const PRIMARY = process.env.PRIMARY || 'edge';
const TOPOLOGY = process.env.TOPOLOGY || 'n1-n2-n3';
const DEADLINE_MS = parseInt(process.env.DEADLINE_MS || '150', 10);
const ROUTING_MODE = process.env.ROUTING_MODE || 'physical';

const PRFC_WINDOW_SIZE = parseInt(process.env.PRFC_WINDOW_SIZE || '10', 10);
const PRFC_ALPHA = parseFloat(process.env.PRFC_ALPHA || '0.3');
const EWMA_MAX_MS = parseFloat(process.env.EWMA_MAX_MS || '100');
const SLOPE_MIN_MS_PER_S = parseFloat(process.env.SLOPE_MIN_MS_PER_S || '5');
const HOLD_SEC = parseFloat(process.env.HOLD_SEC || '3');
const CPU_MAX = parseFloat(process.env.CPU_MAX || '0.85');
const BUF_MAX_PCT = parseFloat(process.env.BUF_MAX_PCT || '0.8');

const EDGE_SERVER_URL = process.env.EDGE_SERVER_URL || 'http://localhost:4020';
const CORE_SERVER_URL = process.env.CORE_SERVER_URL || 'http://localhost:4025';
const CLOUD_SERVER_URL = process.env.CLOUD_SERVER_URL || 'http://localhost:4030';

const LinkSchema = z.object({
  from: z.string(),
  to: z.string(),
  bwMbps: z.number(),
  dpMs: z.number(),
  jitterMs: z.number(),
  loss: z.number(),
});

type Link = z.infer<typeof LinkSchema>;

const TopologySchema = z.object({
  links: z.record(LinkSchema),
});

const topology = TopologySchema.parse(
  JSON.parse(readFileSync(join(__dirname, '../topology.json'), 'utf-8'))
);

const links = topology.links;

let graphEngine: GraphEngine | null = null;

if (ROUTING_MODE === 'virtual') {
  graphEngine = new GraphEngine();
  const TOPOLOGY_FILE = process.env.TOPOLOGY_FILE || 'usnet-topology.json';
  const topologyPath = join(__dirname, `../${TOPOLOGY_FILE}`);
  console.log(chalk.blue('\n📊 [GATEWAY] Loading virtual topology from: ') + chalk.gray(TOPOLOGY_FILE));
  graphEngine.loadTopology(topologyPath);
  const stats = graphEngine.getTopologyStats();
  console.log(chalk.blue('📊 [GATEWAY] ') + chalk.green(`Loaded ${stats.nodes} nodes, ${stats.links} links`));
  console.log(chalk.blue('📊 [GATEWAY] ') + chalk.green('Virtual routing mode enabled'));
} else {
  console.log(chalk.blue('📊 [GATEWAY] Physical routing mode enabled'));
}

type Mode = 'reactive' | 'warm' | 'cold' | 'predictive';

let currentPrimary: 'edge' | 'cloud' = PRIMARY as 'edge' | 'cloud';
let currentMode: Mode = 'predictive';
let currentTopology: string = TOPOLOGY;

const prfc = new PRFCController(
  PRFC_WINDOW_SIZE,
  PRFC_ALPHA,
  EWMA_MAX_MS,
  SLOPE_MIN_MS_PER_S,
  HOLD_SEC,
  CPU_MAX,
  BUF_MAX_PCT
);

const nodeUrls: Record<string, string> = {
  n1: EDGE_SERVER_URL,
  n2: CORE_SERVER_URL,
  n3: CLOUD_SERVER_URL,
};

const nodeBufferMax: Record<string, number> = {
  n1: 200,
  n2: 1000,
  n3: 5000,
};

function getRoutingMode(): 'physical' | 'virtual' {
  return ROUTING_MODE as 'physical' | 'virtual';
}

interface VirtualPathSelection {
  paths: Array<{
    pathId: number;
    nodeIds: number[];
    loadPercentage: number;
    score: number;
  }>;
  distribution: Record<number, number>;
}

function selectVirtualPath(): VirtualPathSelection | null {
  if (!graphEngine) {
    logger.warn('GraphEngine not initialized, cannot select virtual path');
    return null;
  }

  const edgeNodes = graphEngine.getNodesByTier('edge');
  const cloudNodes = graphEngine.getNodesByTier('cloud');

  if (edgeNodes.length === 0 || cloudNodes.length === 0) {
    logger.warn('No edge or cloud nodes available');
    return null;
  }

  const randomEdge = edgeNodes[Math.floor(Math.random() * edgeNodes.length)];
  const randomCloud = cloudNodes[Math.floor(Math.random() * cloudNodes.length)];

  const paths = graphEngine.findKShortestPaths(randomEdge.id, randomCloud.id, 5);

  if (paths.length === 0) {
    return null;
  }

  const validPaths = paths.filter(path => graphEngine!.isValidPath(path.nodeIds));

  if (validPaths.length === 0) {
    return null;
  }

  validPaths.sort((a, b) => b.score - a.score);

  const top3 = validPaths.slice(0, 3);
  const loadDistribution = [50, 30, 20];

  const result: VirtualPathSelection = {
    paths: top3.map((path, idx) => ({
      pathId: idx,
      nodeIds: path.nodeIds,
      loadPercentage: loadDistribution[idx] || 0,
      score: path.score
    })),
    distribution: {}
  };

  top3.forEach((path, idx) => {
    result.distribution[idx] = loadDistribution[idx] || 0;
  });

  return result;
}

interface PhysicalNode {
  id: string;
  url: string;
  tier: 'edge' | 'core' | 'cloud';
  virtualNodeId: number;
}

function mapVirtualToPhysical(virtualNodeId: number): PhysicalNode | null {
  if (!graphEngine) {
    logger.warn('GraphEngine not initialized');
    return null;
  }

  const node = graphEngine.getNode(virtualNodeId);
  if (!node) {
    logger.warn(`Virtual node ${virtualNodeId} not found`);
    return null;
  }

  let physicalId: string;
  let url: string;

  if (virtualNodeId >= 1 && virtualNodeId <= 8) {
    physicalId = 'n1';
    url = EDGE_SERVER_URL;
  } else if (
    (virtualNodeId >= 9 && virtualNodeId <= 18) ||
    virtualNodeId === 22
  ) {
    physicalId = 'n2';
    url = CORE_SERVER_URL;
  } else if (
    (virtualNodeId >= 19 && virtualNodeId <= 21) ||
    (virtualNodeId >= 23 && virtualNodeId <= 24)
  ) {
    physicalId = 'n3';
    url = CLOUD_SERVER_URL;
  } else {
    logger.warn(`Virtual node ${virtualNodeId} has no physical mapping`);
    return null;
  }

  return {
    id: physicalId,
    url: url,
    tier: node.tier,
    virtualNodeId: virtualNodeId
  };
}

function getActivePath(): string[] {
  if (currentTopology === 'n1-n3') {
    return ['n1', 'n3'];
  }
  return ['n1', 'n2', 'n3'];
}

function getBackupPath(): string[] {
  if (currentTopology === 'n1-n3') {
    return ['n1', 'n2', 'n3'];
  }
  return ['n1', 'n3'];
}

function getLinksForPath(path: string[]): Link[] {
  const pathLinks: Link[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    const linkKey = `L${from[1]}${to[1]}`;
    const link = links[linkKey];
    if (!link) {
      logger.warn(`Link ${linkKey} not found in topology`);
      continue;
    }
    pathLinks.push(link);
  }
  return pathLinks;
}

function uniformJitter(jitterMs: number): number {
  return (Math.random() * 2 - 1) * jitterMs;
}

function computeLinkDelay(link: Link, batchSize: number, bytesPerEvent: number = 256): number {
  const transmissionTimeMs = (bytesPerEvent * batchSize * 8) / (link.bwMbps * 1e6) * 1000;
  const propagationDelayMs = link.dpMs + uniformJitter(link.jitterMs);
  return transmissionTimeMs + propagationDelayMs;
}

function simulateLoss(events: EventLike[], lossRate: number): EventLike[] {
  return events.filter(() => Math.random() > lossRate);
}

app.post('/ingest', async (req: Request, res: Response) => {
  const validation = EventArraySchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: 'Invalid event array', details: validation.error });
  }

  let events = validation.data;
  const batchStartTime = now();

  const routingMode = getRoutingMode();

  if (routingMode === 'virtual') {
    if (!graphEngine) {
      return res.status(500).json({ error: 'GraphEngine not initialized for virtual routing' });
    }

    // CHECK FOR PRFC REBALANCING
    const degradedPathIds = prfc.detectDegradedPaths();
    if (degradedPathIds.length > 0) {
      const edgeNodes = graphEngine.getNodesByTier('edge');
      const cloudNodes = graphEngine.getNodesByTier('cloud');
      const randomEdge = edgeNodes[Math.floor(Math.random() * edgeNodes.length)];
      const randomCloud = cloudNodes[Math.floor(Math.random() * cloudNodes.length)];

      const newDistribution = prfc.rebalancePaths(graphEngine, randomEdge.id, randomCloud.id);

      if (newDistribution) {
        console.log('\n' + chalk.red('█'.repeat(80)));
        console.log(chalk.red.bold('  🚨 PRFC DETECTED DEGRADED PATHS - TRIGGERING REBALANCE!'));
        console.log(chalk.red('█'.repeat(80)));
        console.log(chalk.yellow(`  ⚠️  Degraded Paths: ${degradedPathIds.join(', ')}`));
        console.log(chalk.yellow(`  📊 EWMA: ${prfc.getState().ewma.toFixed(1)}ms (threshold: ${EWMA_MAX_MS}ms)`));
        console.log(chalk.yellow(`  📈 Slope: ${prfc.getState().slope.toFixed(2)}ms/s (threshold: ${SLOPE_MIN_MS_PER_S}ms/s)`));
        console.log(chalk.cyan(`  🔄 New Load Distribution: ${JSON.stringify(newDistribution)}`));
        console.log(chalk.red('█'.repeat(80) + '\n'));
      }
    }

    const pathSelection = selectVirtualPath();
    if (!pathSelection) {
      return res.status(500).json({ error: 'Failed to select virtual path' });
    }

    const random = Math.random() * 100;
    let cumulativeWeight = 0;
    let selectedPath = pathSelection.paths[0];

    for (const path of pathSelection.paths) {
      cumulativeWeight += path.loadPercentage;
      if (random < cumulativeWeight) {
        selectedPath = path;
        break;
      }
    }

    const firstVirtualNode = selectedPath.nodeIds[0];
    const physicalNode = mapVirtualToPhysical(firstVirtualNode);

    if (!physicalNode) {
      return res.status(500).json({ error: 'Failed to map virtual to physical node' });
    }

    const expectedLatency = graphEngine.estimatePathLatency(selectedPath.nodeIds);

    // Pure virtual simulation - no physical servers needed
    await new Promise(resolve => setTimeout(resolve, expectedLatency));

    const endToEndLatency = now() - batchStartTime;
    prfc.addBatchLatency(endToEndLatency, selectedPath.pathId);

    // Check PRFC state for monitoring
    const prfcState = prfc.getState();
    const ewmaStatus = prfcState.ewma > 100 ? chalk.red('⚠️  HIGH') : prfcState.ewma > 70 ? chalk.yellow('⚡ WARN') : chalk.green('✓ OK');
    const slopeIcon = prfcState.slope > 5 ? '📈' : prfcState.slope > 2 ? '📊' : '━';

    console.log(
      chalk.cyan('🔀 [ROUTE]') + ' ' +
      chalk.white(`Path ${selectedPath.pathId}`) + chalk.gray(` [${selectedPath.nodeIds.join('→')}]`) + ' → ' +
      chalk.blue(physicalNode.id) + ' │ ' +
      chalk.white(`${events.length} events`) + ' │ ' +
      chalk.yellow(`${endToEndLatency.toFixed(0)}ms`) + '\n' +
      '        ' +
      chalk.magenta('PRFC:') + ` EWMA=${prfcState.ewma.toFixed(1)}ms ${ewmaStatus} │ ${slopeIcon} Slope=${prfcState.slope.toFixed(2)}ms/s`
    );

    // Simulate processing with slight random loss
    const processedEvents = events.length - Math.floor(Math.random() * 0.01 * events.length);

    // Store in memory DB for analytics
    events.forEach(event => {
      inMemoryDB.latencyRecords.push({
        eventId: event.id,
        deviceId: event.deviceId,
        enqueuedAt: event.ts,
        processedAt: now(),
        latencyMs: endToEndLatency,
        deadlineMet: endToEndLatency <= event.deadlineMs,
        processingNode: `virtual-path-${selectedPath.pathId}`,
      });
    });

    res.json({
      accepted: processedEvents,
      dropped: events.length - processedEvents,
      virtualPath: selectedPath.nodeIds.join('->'),
      physicalNode: physicalNode.id,
      pathId: selectedPath.pathId,
      endToEndLatencyMs: endToEndLatency.toFixed(2),
      expectedLatencyMs: expectedLatency.toFixed(2),
    });

  } else {
    if (currentMode === 'predictive') {
      const failoverCheck = prfc.checkFailoverTrigger();

      if (failoverCheck.triggered) {
        const currentPath = getActivePath().join('->');
        const backupPath = getBackupPath().join('->');

        console.log('\n' + chalk.red('▓'.repeat(70)));
        console.log(chalk.red.bold('  🚨 PRFC PREDICTIVE FAILOVER TRIGGERED!'));
        console.log(chalk.red('▓'.repeat(70)));
        console.log(chalk.yellow(`  📊 Reason: ${failoverCheck.reason}`));
        console.log(chalk.yellow(`  📈 EWMA: ${failoverCheck.details.ewma?.toFixed(1)}ms (threshold: ${EWMA_MAX_MS}ms)`));
        console.log(chalk.yellow(`  📊 Slope: ${failoverCheck.details.slope?.toFixed(2)}ms/s (threshold: ${SLOPE_MIN_MS_PER_S}ms/s)`));
        console.log(chalk.yellow(`  🔄 Action: Switching path ${currentPath} → ${backupPath}`));
        console.log(chalk.red('▓'.repeat(70) + '\n'));

        currentTopology = currentTopology === 'n1-n3' ? 'n1-n2-n3' : 'n1-n3';

        await prfc.executeFailover(
          currentMode,
          currentPath,
          backupPath,
          failoverCheck.details
        );

        console.log(chalk.green('✅ [PRFC] Failover complete: ') + chalk.white(`${currentPath} → ${backupPath}\n`));
      }
    }

    const activePath = getActivePath();
    const pathLinks = getLinksForPath(activePath);

    if (pathLinks.length === 0) {
      return res.status(500).json({ error: 'No valid links for path' });
    }

    let totalDelay = 0;
    let survivingEvents = events;

    for (const link of pathLinks) {
      const linkDelay = computeLinkDelay(link, survivingEvents.length);
      totalDelay += linkDelay;

      survivingEvents = simulateLoss(survivingEvents, link.loss);

      logger.info(
        `Link ${link.from}->${link.to}: delay=${linkDelay.toFixed(2)}ms, survivors=${survivingEvents.length}/${events.length}`
      );
    }

    if (survivingEvents.length === 0) {
      return res.json({
        accepted: 0,
        dropped: events.length,
        reason: 'All events lost in transmission',
        path: activePath.join('->'),
        totalDelayMs: totalDelay.toFixed(2),
      });
    }

    try {
      const firstNode = activePath[0];
      const firstNodeUrl = nodeUrls[firstNode];

      if (!firstNodeUrl) {
        throw new Error(`Unknown node: ${firstNode}`);
      }

      const response = await axios.post(`${firstNodeUrl}/ingest`, survivingEvents, { timeout: 10000 });
      const endToEndLatency = now() - batchStartTime;

      prfc.addBatchLatency(endToEndLatency);

      logger.info(
        `Forwarded ${survivingEvents.length} events to ${firstNode} (path: ${activePath.join('->')}), e2e latency=${endToEndLatency.toFixed(2)}ms`
      );

      res.json({
        accepted: response.data.accepted || survivingEvents.length,
        dropped: events.length - (response.data.accepted || survivingEvents.length),
        path: activePath.join('->'),
        endToEndLatencyMs: endToEndLatency.toFixed(2),
        result: response.data,
      });
    } catch (error) {
      logger.error(`Failed to forward to ${activePath[0]}:`, error);
      res.status(500).json({ error: 'Forwarding failed' });
    }
  }
});

app.get('/config', (req: Request, res: Response) => {
  res.json({
    primary: currentPrimary,
    mode: currentMode,
    path: getActivePath().join('->'),
  });
});

const ConfigUpdateSchema = z.object({
  PRIMARY: z.enum(['edge', 'cloud']).optional(),
  MODE: z.enum(['reactive', 'warm', 'cold', 'predictive']).optional(),
});

app.post('/config', (req: Request, res: Response) => {
  const validation = ConfigUpdateSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: 'Invalid config', details: validation.error });
  }

  const updates = validation.data;

  if (updates.PRIMARY) {
    currentPrimary = updates.PRIMARY;
    logger.info(`PRIMARY updated to ${currentPrimary}`);
  }

  if (updates.MODE) {
    currentMode = updates.MODE;
    logger.info(`MODE updated to ${currentMode}`);
  }

  res.json({
    primary: currentPrimary,
    mode: currentMode,
    path: getActivePath().join('->'),
  });
});

app.get('/prfc/state', (req: Request, res: Response) => {
  const prfcState = prfc.getState();

  res.json({
    ...prfcState,
    activePath: getActivePath().join('->'),
    backupPath: getBackupPath().join('->'),
    mode: currentMode,
  });
});

app.get('/stats', (req: Request, res: Response) => {
  res.json({
    latencyRecords: inMemoryDB.latencyRecords.length,
    resourceMetrics: inMemoryDB.resourceMetrics.length,
    incidents: inMemoryDB.incidents.length,
  });
});

app.get('/api/dashboard/metrics', (req: Request, res: Response) => {
  const prfcState = prfc.getState();
  const recentLatency = inMemoryDB.latencyRecords.slice(-100);
  const recentIncidents = inMemoryDB.incidents.slice(-20);
  const recentMetrics = inMemoryDB.resourceMetrics.slice(-30);

  const totalRequests = inMemoryDB.latencyRecords.length;
  const droppedRequests = inMemoryDB.latencyRecords.filter(r => !r.deadlineMet).length;
  const dropRate = totalRequests > 0 ? (droppedRequests / totalRequests) * 100 : 0;

  const avgLatency = recentLatency.length > 0
    ? recentLatency.reduce((sum, r) => sum + r.latencyMs, 0) / recentLatency.length
    : 0;

  const lastFailover = inMemoryDB.incidents
    .filter(i => i.kind === 'failover')
    .sort((a, b) => b.ts - a.ts)[0];

  const timeSinceFailover = lastFailover ? Math.floor((now() - lastFailover.ts) / 1000) : null;

  const nodeHealth = {
    n1: recentMetrics.filter(m => m.nodeId === 'n1').slice(-1)[0] || { cpuUtilization: 0, bufferUtilization: 0 },
    n2: recentMetrics.filter(m => m.nodeId === 'n2').slice(-1)[0] || { cpuUtilization: 0, bufferUtilization: 0 },
    n3: recentMetrics.filter(m => m.nodeId === 'n3').slice(-1)[0] || { cpuUtilization: 0, bufferUtilization: 0 },
  };

  const response: any = {
    routingMode: getRoutingMode(),
    prfc: {
      ...prfcState,
      activePath: getActivePath(),
      backupPath: getBackupPath(),
      mode: currentMode,
    },
    stats: {
      totalRequests,
      droppedRequests,
      dropRate: dropRate.toFixed(2),
      avgLatency: avgLatency.toFixed(2),
      timeSinceFailover,
    },
    nodes: {
      n1: {
        name: 'Edge Server',
        tier: 'edge',
        cpu: (nodeHealth.n1.cpuUtilization * 100).toFixed(1),
        buffer: (nodeHealth.n1.bufferUtilization * 100).toFixed(1),
        status: nodeHealth.n1.cpuUtilization > 0.85 ? 'degraded' : 'healthy',
      },
      n2: {
        name: 'Core Server',
        tier: 'core',
        cpu: (nodeHealth.n2.cpuUtilization * 100).toFixed(1),
        buffer: (nodeHealth.n2.bufferUtilization * 100).toFixed(1),
        status: nodeHealth.n2.cpuUtilization > 0.85 ? 'degraded' : 'healthy',
      },
      n3: {
        name: 'Cloud Server',
        tier: 'cloud',
        cpu: (nodeHealth.n3.cpuUtilization * 100).toFixed(1),
        buffer: (nodeHealth.n3.bufferUtilization * 100).toFixed(1),
        status: nodeHealth.n3.cpuUtilization > 0.85 ? 'degraded' : 'healthy',
      },
    },
    latencyHistory: recentLatency.map(r => ({
      timestamp: r.processedAt,
      latency: r.latencyMs,
      deadlineMet: r.deadlineMet,
    })),
    events: recentIncidents.map(i => ({
      timestamp: i.ts,
      type: i.kind,
      severity: i.severity,
      message: `${i.kind.replace('_', ' ').toUpperCase()} event`,
      details: i.details,
    })),
  };

  if (graphEngine && getRoutingMode() === 'virtual') {
    const virtualNodes = graphEngine.getAllNodes();
    const virtualLinks = graphEngine.getAllLinks();

    response.virtualTopology = {
      nodes: virtualNodes.map(n => ({
        id: n.id,
        tier: n.tier,
        quality: n.quality,
        physicalMap: n.physical_map,
        utilization: n.current_utilization || 0,
      })),
      links: virtualLinks.map(l => ({
        from: l.u,
        to: l.v,
        latency: l.delay_ms,
        bandwidth: l.bw_mbps,
        utilization: l.current_utilization || 0,
      })),
      activePaths: prfcState.paths || [],
    };
  }

  res.json(response);
});

app.post('/api/test/virtual-routing', (req: Request, res: Response) => {
  if (!graphEngine) {
    return res.status(400).json({
      error: 'Virtual routing not enabled',
      message: 'Set ROUTING_MODE=virtual in .env to use this endpoint'
    });
  }

  const { sourceId, destId, k } = req.body;

  const source = sourceId || 1;
  const dest = destId || 19;
  const pathCount = k || 5;

  logger.info(`[TEST] Computing virtual paths from node ${source} to node ${dest}, k=${pathCount}`);

  const paths = graphEngine.findKShortestPaths(source, dest, pathCount);

  if (paths.length === 0) {
    return res.status(404).json({
      error: 'No paths found',
      source,
      dest,
      k: pathCount
    });
  }

  const validPaths = paths.filter(path => graphEngine!.isValidPath(path.nodeIds));
  validPaths.sort((a, b) => b.score - a.score);

  const top3 = validPaths.slice(0, 3);
  const loadDistribution = [50, 30, 20];

  const result = {
    source,
    dest,
    totalPathsFound: paths.length,
    validPaths: validPaths.length,
    selectedPaths: top3.map((path, idx) => {
      const physicalMapping = path.nodeIds.map(nodeId => {
        const physical = mapVirtualToPhysical(nodeId);
        return {
          virtualNodeId: nodeId,
          physicalNodeId: physical?.id || 'unknown',
          physicalUrl: physical?.url || 'unknown',
          tier: physical?.tier || 'unknown'
        };
      });

      return {
        pathId: idx,
        virtualRoute: path.nodeIds,
        virtualRouteStr: path.nodeIds.join(' -> '),
        physicalMapping,
        physicalRoute: physicalMapping.map(m => m.physicalNodeId),
        physicalRouteStr: physicalMapping.map(m => m.physicalNodeId).join(' -> '),
        score: path.score,
        estimatedLatencyMs: graphEngine!.estimatePathLatency(path.nodeIds),
        loadPercentage: loadDistribution[idx] || 0,
        isValid: graphEngine!.isValidPath(path.nodeIds)
      };
    }),
    loadDistribution: {
      path0: loadDistribution[0],
      path1: loadDistribution[1],
      path2: loadDistribution[2]
    },
    note: 'This is a test endpoint. No actual routing occurs.'
  };

  logger.info(`[TEST] Computed ${validPaths.length} valid paths, selected top 3`);

  res.json(result);
});

app.post('/api/inject-virtual-node-fault', (req: Request, res: Response) => {
  if (!graphEngine) {
    return res.status(400).json({ error: 'Virtual routing not enabled' });
  }

  const { virtualNodeId, latencyMs } = req.body;

  if (!virtualNodeId || !latencyMs) {
    return res.status(400).json({ error: 'Missing virtualNodeId or latencyMs' });
  }

  graphEngine.injectNodeLatencyFault(virtualNodeId, latencyMs);

  res.json({
    success: true,
    virtualNodeId,
    latencyMs,
    message: `Injected ${latencyMs}ms latency fault to virtual node ${virtualNodeId}`
  });
});

app.post('/api/remove-virtual-node-fault', (req: Request, res: Response) => {
  if (!graphEngine) {
    return res.status(400).json({ error: 'Virtual routing not enabled' });
  }

  const { virtualNodeId } = req.body;

  if (!virtualNodeId) {
    return res.status(400).json({ error: 'Missing virtualNodeId' });
  }

  graphEngine.removeNodeLatencyFault(virtualNodeId);

  res.json({
    success: true,
    virtualNodeId,
    message: `Removed latency fault from virtual node ${virtualNodeId}`
  });
});

async function pollNodeHealth() {
  const nodes = [
    { id: 'n1', url: EDGE_SERVER_URL },
    { id: 'n2', url: CORE_SERVER_URL },
    { id: 'n3', url: CLOUD_SERVER_URL },
  ];

  for (const node of nodes) {
    try {
      const response = await axios.get(`${node.url}/health`, { timeout: 2000 });
      const health = response.data;

      const metric: ResourceMetric = {
        nodeId: node.id,
        ts: now(),
        cpuUtilization: health.cpu || 0,
        ramUtilization: 0,
        bufferUtilization: health.bufferDepth || 0,
        queueDepth: health.bufferDepth || 0,
      };

      inMemoryDB.resourceMetrics.push(metric);

      prfc.updateNodeHealth(
        node.id,
        health.cpu || 0,
        health.bufferDepth || 0,
        nodeBufferMax[node.id] || 1000
      );
    } catch (error) {
      logger.warn(`Failed to poll ${node.id} health:`, error);
    }
  }
}

setInterval(pollNodeHealth, 2000);

const server = app.listen(PORT, () => {
  console.log('\\n' + chalk.cyan('╔' + '═'.repeat(68) + '╗'));
  console.log(chalk.cyan('║') + chalk.bold.white('           🌐 IoT RESILIENCE GATEWAY - PRFC ENABLED              ') + chalk.cyan('║'));
  console.log(chalk.cyan('╚' + '═'.repeat(68) + '╝'));

  console.log(chalk.white.bold('\\n  🚀 SERVER CONFIGURATION'));
  console.log(chalk.gray('  ─'.repeat(34)));
  console.log(chalk.white('  Port:              ') + chalk.cyan(`:${PORT}`));
  console.log(chalk.white('  Mode:              ') + chalk.green(currentMode.toUpperCase()));
  console.log(chalk.white('  Routing:           ') + chalk.magenta(ROUTING_MODE === 'virtual' ? 'VIRTUAL (24-node USNet)' : 'PHYSICAL'));
  console.log(chalk.white('  Primary Path:      ') + chalk.yellow(getActivePath().join(' → ')));

  console.log(chalk.white.bold('\\n  📊 PRFC THRESHOLDS'));
  console.log(chalk.gray('  ─'.repeat(34)));
  console.log(chalk.white('  EWMA Threshold:    ') + chalk.yellow(`${EWMA_MAX_MS}ms`) + chalk.gray(' (latency trigger)'));
  console.log(chalk.white('  Slope Threshold:   ') + chalk.yellow(`${SLOPE_MIN_MS_PER_S}ms/s`) + chalk.gray(' (degradation rate)'));
  console.log(chalk.white('  Hold Time:         ') + chalk.yellow(`${HOLD_SEC}s`) + chalk.gray(' (confirmation period)'));
  console.log(chalk.white('  CPU Max:           ') + chalk.yellow(`${(CPU_MAX * 100).toFixed(0)}%`) + chalk.gray(' (resource limit)'));
  console.log(chalk.white('  Buffer Max:        ') + chalk.yellow(`${(BUF_MAX_PCT * 100).toFixed(0)}%`) + chalk.gray(' (queue limit)'));

  console.log(chalk.white.bold('\\n  🔍 MONITORING'));
  console.log(chalk.gray('  ─'.repeat(34)));
  console.log(chalk.green('  ✓ PRFC Controller:  ACTIVE'));
  console.log(chalk.green('  ✓ Health Polling:   ENABLED (2s interval)'));
  console.log(chalk.green('  ✓ Predictive Mode:  READY'));

  console.log(chalk.cyan('\\n╚' + '═'.repeat(68) + '╝\\n'));

  pollNodeHealth();
});

process.on('SIGTERM', () => {
  logger.info(`${NODE_NAME} shutting down...`);
  server.close(() => {
    logger.info(`${NODE_NAME} stopped`);
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info(`${NODE_NAME} shutting down...`);
  server.close(() => {
    logger.info(`${NODE_NAME} stopped`);
    process.exit(0);
  });
});
