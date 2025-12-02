import { randomUUID } from 'crypto';
import { Incident, inMemoryDB, now } from '@iot-lab/common';

interface BatchLatency {
  ts: number;
  latencyMs: number;
}

interface NodeHealth {
  cpu: number;
  bufferPct: number;
}

interface PathMetrics {
  nodeIds: number[];
  ewma: number;
  slope: number;
  loadPercentage: number;
  status: 'healthy' | 'degraded' | 'recovering';
  lastFailureTime: number;
  lastRecoveryTime: number;
  latencyWindow: BatchLatency[];
}

interface TransitionStep {
  timestamp: number;
  distribution: Record<number, number>;
}

interface TransitionSchedule {
  steps: TransitionStep[];
  durationMs: number;
  startTime: number;
}

export class PRFCController {
  private latencyWindow: BatchLatency[] = [];
  private ewma: number = 0;
  private slope: number = 0;
  private nodeHealth: Record<string, NodeHealth> = {};
  private triggerStartTime: number | null = null;
  private failoverInProgress: boolean = false;
  private impactedBatchTime: number | null = null;
  private paths: Map<number, PathMetrics> = new Map();
  private readonly RECOVERY_HOLD_TIME_MS = 20000;
  private readonly STABILITY_TIME_MS = 15000;
  private readonly TRANSITION_DURATION_MS = 7000;
  private optimalDistribution: Record<number, number> = {};

  constructor(
    private windowSize: number,
    private alpha: number,
    private ewmaMaxMs: number,
    private slopeMinMsPerS: number,
    private holdSec: number,
    private cpuMax: number,
    private bufMaxPct: number
  ) {}

  addBatchLatency(latencyMs: number, pathId?: number): void {
    const batch: BatchLatency = { ts: now(), latencyMs };
    this.latencyWindow.push(batch);

    if (this.latencyWindow.length > this.windowSize) {
      this.latencyWindow.shift();
    }

    this.updateEWMA(latencyMs);
    this.updateSlope();

    if (pathId !== undefined && this.paths.has(pathId)) {
      this.updatePathMetrics(pathId, latencyMs);
    }
  }

  private updateEWMA(latencyMs: number): void {
    if (this.ewma === 0) {
      this.ewma = latencyMs;
    } else {
      this.ewma = this.alpha * latencyMs + (1 - this.alpha) * this.ewma;
    }
  }

  private updateSlope(): void {
    if (this.latencyWindow.length < 2) {
      this.slope = 0;
      return;
    }

    const n = this.latencyWindow.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = this.latencyWindow[i].latencyMs;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) {
      this.slope = 0;
    } else {
      this.slope = (n * sumXY - sumX * sumY) / denominator;
    }
  }

  updateNodeHealth(nodeId: string, cpu: number, bufferDepth: number, bufferMax: number): void {
    const bufferPct = bufferMax > 0 ? bufferDepth / bufferMax : 0;
    this.nodeHealth[nodeId] = { cpu, bufferPct };
  }

  checkFailoverTrigger(): {
    triggered: boolean;
    reason: string;
    details: Record<string, any>;
  } {
    const triggerByLatency = this.ewma > this.ewmaMaxMs && this.slope > this.slopeMinMsPerS;

    let triggerByResource = false;
    let resourceDetails: Record<string, any> = {};

    for (const [nodeId, health] of Object.entries(this.nodeHealth)) {
      if (health.cpu > this.cpuMax || health.bufferPct > this.bufMaxPct) {
        triggerByResource = true;
        resourceDetails[nodeId] = health;
      }
    }

    if (triggerByLatency) {
      if (this.triggerStartTime === null) {
        this.triggerStartTime = now();
      }

      const holdDuration = (now() - this.triggerStartTime) / 1000;

      if (holdDuration >= this.holdSec) {
        return {
          triggered: true,
          reason: 'latency_drift',
          details: {
            ewma: this.ewma,
            slope: this.slope,
            holdDuration,
            ...this.nodeHealth,
          },
        };
      }
    } else {
      this.triggerStartTime = null;
    }

    if (triggerByResource) {
      return {
        triggered: true,
        reason: 'resource_pressure',
        details: {
          ewma: this.ewma,
          slope: this.slope,
          ...resourceDetails,
        },
      };
    }

    return { triggered: false, reason: '', details: {} };
  }

  async executeFailover(
    mode: string,
    currentPath: string,
    backupPath: string,
    triggerDetails: Record<string, any>
  ): Promise<void> {
    if (this.failoverInProgress) {
      return;
    }

    this.failoverInProgress = true;

    if (this.impactedBatchTime === null) {
      this.impactedBatchTime = now();
    }

    let spinUpDelayMs = 0;
    if (mode === 'cold') {
      spinUpDelayMs = 400 + Math.random() * 300;
      await new Promise(resolve => setTimeout(resolve, spinUpDelayMs));
    }

    const failoverCompleteTime = now();
    const mttr = this.impactedBatchTime ? failoverCompleteTime - this.impactedBatchTime : 0;

    const incident: Incident = {
      id: randomUUID(),
      kind: 'failover',
      severity: this.ewma > this.ewmaMaxMs * 1.5 ? 'high' : 'medium',
      ts: failoverCompleteTime,
      details: {
        ...triggerDetails,
        mode,
        path_before: currentPath,
        path_after: backupPath,
        spinUpDelayMs: mode === 'cold' ? spinUpDelayMs : 0,
        mttr,
      },
    };

    inMemoryDB.incidents.push(incident);

    this.latencyWindow = [];
    this.ewma = 0;
    this.slope = 0;
    this.triggerStartTime = null;
    this.impactedBatchTime = null;
    this.failoverInProgress = false;
  }

  markBatchImpacted(): void {
    if (this.impactedBatchTime === null) {
      this.impactedBatchTime = now();
    }
  }

  registerPath(pathId: number, nodeIds: number[], initialLoad: number): void {
    this.paths.set(pathId, {
      nodeIds,
      ewma: 0,
      slope: 0,
      loadPercentage: initialLoad,
      status: 'healthy',
      lastFailureTime: 0,
      lastRecoveryTime: 0,
      latencyWindow: []
    });
    this.optimalDistribution[pathId] = initialLoad;
  }

  private updatePathMetrics(pathId: number, latencyMs: number): void {
    const pathMetrics = this.paths.get(pathId);
    if (!pathMetrics) {
      return;
    }

    const batch: BatchLatency = { ts: now(), latencyMs };
    pathMetrics.latencyWindow.push(batch);

    if (pathMetrics.latencyWindow.length > this.windowSize) {
      pathMetrics.latencyWindow.shift();
    }

    if (pathMetrics.ewma === 0) {
      pathMetrics.ewma = latencyMs;
    } else {
      pathMetrics.ewma = this.alpha * latencyMs + (1 - this.alpha) * pathMetrics.ewma;
    }

    if (pathMetrics.latencyWindow.length >= 2) {
      const n = pathMetrics.latencyWindow.length;
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumX2 = 0;

      for (let i = 0; i < n; i++) {
        const x = i;
        const y = pathMetrics.latencyWindow[i].latencyMs;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
      }

      const denominator = n * sumX2 - sumX * sumX;
      if (denominator === 0) {
        pathMetrics.slope = 0;
      } else {
        pathMetrics.slope = (n * sumXY - sumX * sumY) / denominator;
      }
    }

    if (pathMetrics.ewma > this.ewmaMaxMs && pathMetrics.slope >= this.slopeMinMsPerS) {
      if (pathMetrics.status !== 'degraded') {
        console.log(`\n🔴 [PRFC] Path ${pathId} [${pathMetrics.nodeIds.join('→')}] DEGRADED! EWMA=${pathMetrics.ewma.toFixed(1)}ms, Slope=${pathMetrics.slope.toFixed(2)}ms/s\n`);
      }
      pathMetrics.status = 'degraded';
      pathMetrics.lastFailureTime = now();
    } else if (pathMetrics.status === 'recovering' && pathMetrics.ewma < this.ewmaMaxMs * 0.6) {
      console.log(`\n🟢 [PRFC] Path ${pathId} [${pathMetrics.nodeIds.join('→')}] RECOVERED! EWMA=${pathMetrics.ewma.toFixed(1)}ms\n`);
      pathMetrics.status = 'healthy';
    }
  }

  getPathMetrics(pathId: number): PathMetrics | undefined {
    return this.paths.get(pathId);
  }

  getAllPathMetrics(): Map<number, PathMetrics> {
    return new Map(this.paths);
  }

  updatePathLoad(pathId: number, loadPercentage: number): void {
    const pathMetrics = this.paths.get(pathId);
    if (pathMetrics) {
      pathMetrics.loadPercentage = loadPercentage;
    }
  }

  detectDegradedPaths(): number[] {
    const degradedPathIds: number[] = [];

    for (const [pathId, metrics] of this.paths.entries()) {
      if (metrics.ewma > this.ewmaMaxMs && metrics.slope >= this.slopeMinMsPerS) {
        if (metrics.status !== 'degraded') {
          metrics.status = 'degraded';
          metrics.lastFailureTime = now();
        }
        degradedPathIds.push(pathId);
      }
    }

    return degradedPathIds;
  }

  findCommonNodes(paths: number[][]): number[] {
    if (paths.length === 0) {
      return [];
    }

    if (paths.length === 1) {
      return paths[0];
    }

    const nodeCount = new Map<number, number>();

    for (const path of paths) {
      const uniqueNodes = new Set(path);
      for (const nodeId of uniqueNodes) {
        nodeCount.set(nodeId, (nodeCount.get(nodeId) || 0) + 1);
      }
    }

    const commonNodes: number[] = [];
    const threshold = Math.max(2, Math.ceil(paths.length * 0.5));

    for (const [nodeId, count] of nodeCount.entries()) {
      if (count >= threshold) {
        commonNodes.push(nodeId);
      }
    }

    commonNodes.sort((a, b) => (nodeCount.get(b) || 0) - (nodeCount.get(a) || 0));

    return commonNodes;
  }

  rebalancePaths(graphEngine: any, sourceNode: number, destNode: number): Record<number, number> | null {
    const degradedPathIds = this.detectDegradedPaths();

    if (degradedPathIds.length === 0) {
      return null;
    }

    const degradedPaths: number[][] = [];
    for (const pathId of degradedPathIds) {
      const pathMetrics = this.paths.get(pathId);
      if (pathMetrics) {
        degradedPaths.push(pathMetrics.nodeIds);
      }
    }

    const bottleneckNodes = this.findCommonNodes(degradedPaths);

    console.log(`\n⚠️  [PRFC] Detected ${degradedPathIds.length} degraded paths`);
    console.log(`⚠️  [PRFC] Degraded path IDs: ${degradedPathIds.join(', ')}`);
    console.log(`⚠️  [PRFC] Bottleneck nodes causing failures: [${bottleneckNodes.join(', ')}]`);

    for (const pathId of degradedPathIds) {
      const metrics = this.paths.get(pathId);
      if (metrics) {
        console.log(`    Path ${pathId}: ${metrics.nodeIds.join('→')} | EWMA=${metrics.ewma.toFixed(1)}ms | Slope=${metrics.slope.toFixed(2)}ms/s`);
      }
    }
    console.log();

    const newPaths = graphEngine.findKShortestPaths(
      sourceNode,
      destNode,
      5,
      bottleneckNodes
    );

    if (newPaths.length === 0) {
      console.warn('[PRFC] No alternative paths found, keeping current distribution');
      return null;
    }

    const validPaths = newPaths.filter((path: any) => graphEngine.isValidPath(path.nodeIds));

    if (validPaths.length === 0) {
      console.warn('[PRFC] No valid alternative paths found');
      return null;
    }

    validPaths.sort((a: any, b: any) => b.score - a.score);

    const newDistribution: Record<number, number> = {};
    const healthyPaths: number[] = [];

    for (const [pathId, metrics] of this.paths.entries()) {
      if (degradedPathIds.includes(pathId)) {
        newDistribution[pathId] = 5;
      } else {
        healthyPaths.push(pathId);
      }
    }

    if (healthyPaths.length === 0) {
      console.warn('[PRFC] All paths degraded, cannot rebalance');
      for (const pathId of degradedPathIds) {
        newDistribution[pathId] = 100 / degradedPathIds.length;
      }
      return newDistribution;
    }

    const remainingLoad = 100 - (degradedPathIds.length * 5);
    const totalHealthyLoad = healthyPaths.reduce((sum, pathId) => {
      const metrics = this.paths.get(pathId);
      return sum + (metrics?.loadPercentage || 0);
    }, 0);

    for (const pathId of healthyPaths) {
      const metrics = this.paths.get(pathId);
      if (metrics) {
        if (totalHealthyLoad > 0) {
          newDistribution[pathId] = (metrics.loadPercentage / totalHealthyLoad) * remainingLoad;
        } else {
          newDistribution[pathId] = remainingLoad / healthyPaths.length;
        }
      }
    }

    const totalDistribution = Object.values(newDistribution).reduce((sum, val) => sum + val, 0);
    if (Math.abs(totalDistribution - 100) > 0.01) {
      const scaleFactor = 100 / totalDistribution;
      for (const pathId in newDistribution) {
        newDistribution[pathId] *= scaleFactor;
      }
    }

    for (const pathId in newDistribution) {
      this.updatePathLoad(parseInt(pathId), newDistribution[pathId]);
    }

    console.log('[PRFC] Rebalancing complete:');
    for (const [pathId, load] of Object.entries(newDistribution)) {
      const metrics = this.paths.get(parseInt(pathId));
      console.log(`  Path ${pathId}: ${load.toFixed(1)}% (status: ${metrics?.status || 'unknown'})`);
    }

    return newDistribution;
  }

  detectRecoveredPaths(): number[] {
    const recoveredPathIds: number[] = [];
    const currentTime = now();

    for (const [pathId, metrics] of this.paths.entries()) {
      if (metrics.status === 'degraded') {
        const timeSinceFailure = currentTime - metrics.lastFailureTime;
        const ewmaBelowThreshold = metrics.ewma < this.ewmaMaxMs * 0.8;
        const slopeNearZero = metrics.slope <= 0.5;
        const holdTimeMet = timeSinceFailure > this.RECOVERY_HOLD_TIME_MS;

        if (ewmaBelowThreshold && slopeNearZero && holdTimeMet) {
          metrics.status = 'recovering';
          metrics.lastRecoveryTime = currentTime;
          recoveredPathIds.push(pathId);
          console.log(`[PRFC] Path ${pathId} entering recovery (EWMA: ${metrics.ewma.toFixed(2)}ms, Slope: ${metrics.slope.toFixed(2)})`);
        }
      } else if (metrics.status === 'recovering') {
        const timeSinceRecovery = currentTime - metrics.lastRecoveryTime;
        const ewmaHealthy = metrics.ewma < this.ewmaMaxMs * 0.6;
        const stabilityTimeMet = timeSinceRecovery > this.STABILITY_TIME_MS;

        if (ewmaHealthy && stabilityTimeMet) {
          metrics.status = 'healthy';
          recoveredPathIds.push(pathId);
          console.log(`[PRFC] Path ${pathId} fully recovered to healthy (EWMA: ${metrics.ewma.toFixed(2)}ms)`);
        }
      }
    }

    return recoveredPathIds;
  }

  gradualRevert(): TransitionSchedule | null {
    this.detectRecoveredPaths();

    const currentDistribution: Record<number, number> = {};
    for (const [pathId, metrics] of this.paths.entries()) {
      currentDistribution[pathId] = metrics.loadPercentage;
    }

    const targetDistribution: Record<number, number> = { ...this.optimalDistribution };

    const allDegraded = Array.from(this.paths.values()).every(
      m => m.status === 'degraded'
    );

    if (allDegraded) {
      const pathCount = this.paths.size;
      for (const pathId of this.paths.keys()) {
        targetDistribution[pathId] = 100 / pathCount;
      }
    }

    let needsRevert = false;
    const hasHealthyOrRecovering = Array.from(this.paths.values()).some(
      m => m.status === 'healthy' || m.status === 'recovering'
    );

    for (const pathId in currentDistribution) {
      const diff = Math.abs(currentDistribution[pathId] - targetDistribution[pathId]);
      if (diff > 1) {
        needsRevert = true;
        break;
      }
    }

    if (!needsRevert || !hasHealthyOrRecovering) {
      return null;
    }

    console.log('[PRFC] Starting gradual revert to optimal distribution');
    console.log(`  Current: ${JSON.stringify(currentDistribution)}`);
    console.log(`  Target: ${JSON.stringify(targetDistribution)}`);

    const numSteps = 5;
    const stepDuration = this.TRANSITION_DURATION_MS / numSteps;
    const startTime = now();

    const steps: TransitionStep[] = [];

    for (let i = 1; i <= numSteps; i++) {
      const progress = i / numSteps;
      const stepDistribution: Record<number, number> = {};

      for (const pathId in currentDistribution) {
        const current = currentDistribution[pathId];
        const target = targetDistribution[pathId];
        const interpolated = current + (target - current) * progress;
        stepDistribution[pathId] = interpolated;
      }

      const totalDistribution = Object.values(stepDistribution).reduce((sum, val) => sum + val, 0);
      if (Math.abs(totalDistribution - 100) > 0.01) {
        const scaleFactor = 100 / totalDistribution;
        for (const pathId in stepDistribution) {
          stepDistribution[pathId] *= scaleFactor;
        }
      }

      steps.push({
        timestamp: startTime + (i * stepDuration),
        distribution: stepDistribution
      });
    }

    console.log(`[PRFC] Transition scheduled over ${this.TRANSITION_DURATION_MS}ms with ${numSteps} steps`);

    return {
      steps,
      durationMs: this.TRANSITION_DURATION_MS,
      startTime
    };
  }

  applyTransitionStep(step: TransitionStep): void {
    console.log(`[PRFC] Applying transition step at ${new Date(step.timestamp).toISOString()}`);
    for (const [pathId, load] of Object.entries(step.distribution)) {
      this.updatePathLoad(parseInt(pathId), load);
      console.log(`  Path ${pathId}: ${load.toFixed(1)}%`);
    }
  }

  getState(): {
    ewma: number;
    slope: number;
    windowSize: number;
    thresholds: Record<string, any>;
    nodeHealth: Record<string, NodeHealth>;
    paths?: Array<{
      pathId: number;
      nodeIds: number[];
      ewma: number;
      slope: number;
      loadPercentage: number;
      status: string;
    }>;
  } {
    const pathsArray = Array.from(this.paths.entries()).map(([pathId, metrics]) => ({
      pathId,
      nodeIds: metrics.nodeIds,
      ewma: metrics.ewma,
      slope: metrics.slope,
      loadPercentage: metrics.loadPercentage,
      status: metrics.status
    }));

    return {
      ewma: this.ewma,
      slope: this.slope,
      windowSize: this.latencyWindow.length,
      thresholds: {
        ewmaMaxMs: this.ewmaMaxMs,
        slopeMinMsPerS: this.slopeMinMsPerS,
        holdSec: this.holdSec,
        cpuMax: this.cpuMax,
        bufMaxPct: this.bufMaxPct,
      },
      nodeHealth: this.nodeHealth,
      paths: pathsArray.length > 0 ? pathsArray : undefined,
    };
  }
}
