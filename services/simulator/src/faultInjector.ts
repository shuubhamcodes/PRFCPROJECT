import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ level: 'info' });

export type FaultKind =
  | 'cpu_overload'
  | 'node_crash'
  | 'bw_drop'
  | 'dp_spike'
  | 'loss_burst'
  | 'disk_stall'
  | 'virtual_node'
  | 'none';

export type FaultTarget = 'n1' | 'n2' | 'n3' | 'L12' | 'L13' | 'L23' | string;
export type FaultSeverity = 'low' | 'medium' | 'high';

interface FaultConfig {
  kind: FaultKind;
  target: FaultTarget;
  startSec: number;
  durationSec: number;
  severity: FaultSeverity;
}

interface VirtualNodeFaultConfig {
  virtualNodeId: number;
  faultType: 'cpu' | 'bandwidth' | 'latency';
  severity: number;
}

const nodeUrls: Record<string, string> = {
  n1: process.env.EDGE_SERVER_URL || 'http://localhost:4020',
  n2: process.env.CORE_SERVER_URL || 'http://localhost:4025',
  n3: process.env.CLOUD_SERVER_URL || 'http://localhost:4030',
};

export class FaultInjector {
  private config: FaultConfig;
  private faultActive = false;
  private originalState: any = null;

  constructor(config: FaultConfig) {
    this.config = config;
  }

  async injectFault(): Promise<void> {
    if (this.config.kind === 'none' || this.faultActive) {
      return;
    }

    this.faultActive = true;
    const { kind, target, severity } = this.config;

    logger.warn(`🔥 INJECTING FAULT: ${kind} on ${target} (severity: ${severity})`);

    try {
      if (kind === 'virtual_node') {
        await this.injectVirtualNodeFault(target, severity);
      } else if (target.startsWith('L')) {
        await this.injectLinkFault(kind, target, severity);
      } else {
        await this.injectNodeFault(kind, target, severity);
      }
    } catch (error) {
      logger.error(`Failed to inject fault: ${error}`);
    }
  }

  async removeFault(): Promise<void> {
    if (!this.faultActive) {
      return;
    }

    logger.info(`✅ REMOVING FAULT: ${this.config.kind} on ${this.config.target}`);

    try {
      if (this.config.kind === 'virtual_node') {
        await this.removeVirtualNodeFault();
      } else if (this.config.target.startsWith('L')) {
        await this.removeLinkFault();
      } else {
        await this.removeNodeFault();
      }
    } catch (error) {
      logger.error(`Failed to remove fault: ${error}`);
    }

    this.faultActive = false;
    this.originalState = null;
  }

  private async injectNodeFault(kind: FaultKind, target: FaultTarget, severity: FaultSeverity): Promise<void> {
    const nodeUrl = nodeUrls[target];
    if (!nodeUrl) {
      logger.warn(`Unknown node target: ${target}`);
      return;
    }

    switch (kind) {
      case 'cpu_overload': {
        const cpuEvPerSec = severity === 'high' ? 3 : severity === 'medium' ? 5 : 20;
        const faultLatencyMs = severity === 'high' ? 200 : severity === 'medium' ? 150 : 15;
        const faultLossRate = severity === 'high' ? 0.10 : severity === 'medium' ? 0.08 : 0.005;

        await axios.post(`${nodeUrl}/config`, {
          CPU_EV_PER_SEC: cpuEvPerSec,
          FAULT_LATENCY_MS: faultLatencyMs,
          FAULT_LOSS_RATE: faultLossRate
        });
        logger.info(`Set ${target} CPU_EV_PER_SEC=${cpuEvPerSec}, FAULT_LATENCY_MS=${faultLatencyMs}, FAULT_LOSS_RATE=${faultLossRate}`);
        break;
      }

      case 'disk_stall': {
        const ioWaitMs = severity === 'high' ? 100 : severity === 'medium' ? 50 : 20;
        const faultLatencyMs = severity === 'high' ? 30 : severity === 'medium' ? 15 : 10;

        await axios.post(`${nodeUrl}/config`, {
          IO_WAIT_MS: ioWaitMs,
          FAULT_LATENCY_MS: faultLatencyMs
        });
        logger.info(`Set ${target} IO_WAIT_MS=${ioWaitMs}, FAULT_LATENCY_MS=${faultLatencyMs}`);
        break;
      }

      case 'node_crash': {
        const faultLatencyMs = 5000;
        const faultLossRate = 0.95;

        await axios.post(`${nodeUrl}/config`, {
          CPU_EV_PER_SEC: 1,
          FAULT_LATENCY_MS: faultLatencyMs,
          FAULT_LOSS_RATE: faultLossRate
        });
        logger.warn(`Simulating ${target} crash with extreme latency and packet loss`);
        break;
      }

      default:
        logger.warn(`Node fault kind ${kind} not applicable to nodes`);
    }
  }

  private async removeNodeFault(): Promise<void> {
    const nodeUrl = nodeUrls[this.config.target];
    if (!nodeUrl) {
      return;
    }

    await axios.post(`${nodeUrl}/config`, {
      CPU_EV_PER_SEC: 50,
      IO_WAIT_MS: 0,
      FAULT_LATENCY_MS: 0,
      FAULT_LOSS_RATE: 0
    });
    logger.info(`Restored ${this.config.target} to default config`);
  }

  private async injectLinkFault(kind: FaultKind, target: FaultTarget, severity: FaultSeverity): Promise<void> {
    logger.warn(`Link fault injection (${kind} on ${target}) requires topology manipulation - not yet implemented`);
  }

  private async removeLinkFault(): Promise<void> {
    logger.info(`Link fault removal requires topology restoration - not yet implemented`);
  }

  private mapVirtualToPhysicalNode(virtualNodeId: number): { physicalNode: string; url: string } | null {
    let physicalNode: string;
    let url: string;

    if (virtualNodeId >= 1 && virtualNodeId <= 8) {
      physicalNode = 'n1';
      url = nodeUrls.n1;
    } else if (
      (virtualNodeId >= 9 && virtualNodeId <= 18) ||
      virtualNodeId === 22
    ) {
      physicalNode = 'n2';
      url = nodeUrls.n2;
    } else if (
      (virtualNodeId >= 19 && virtualNodeId <= 21) ||
      (virtualNodeId >= 23 && virtualNodeId <= 24)
    ) {
      physicalNode = 'n3';
      url = nodeUrls.n3;
    } else {
      logger.warn(`Virtual node ${virtualNodeId} has no physical mapping`);
      return null;
    }

    return { physicalNode, url };
  }

  private async injectVirtualNodeFault(target: string, severity: FaultSeverity): Promise<void> {
    const virtualNodeId = parseInt(target, 10);

    if (isNaN(virtualNodeId) || virtualNodeId < 1 || virtualNodeId > 24) {
      logger.error(`Invalid virtual node ID: ${target}. Must be 1-24.`);
      return;
    }

    const mapping = this.mapVirtualToPhysicalNode(virtualNodeId);
    if (!mapping) {
      return;
    }

    const { physicalNode, url } = mapping;

    logger.info(`Virtual node ${virtualNodeId} maps to physical node ${physicalNode}`);

    const severityValue = severity === 'high' ? 0.9 : severity === 'medium' ? 0.6 : 0.3;

    const cpuEvPerSec = severity === 'high' ? 5 : severity === 'medium' ? 10 : 20;
    const faultLatencyMs = severity === 'high' ? 250 : severity === 'medium' ? 50 : 25;
    const faultLossRate = severity === 'high' ? 0.05 : severity === 'medium' ? 0.02 : 0.01;

    try {
      await axios.post(`${url}/config`, {
        CPU_EV_PER_SEC: cpuEvPerSec,
        FAULT_LATENCY_MS: faultLatencyMs,
        FAULT_LOSS_RATE: faultLossRate
      });

      logger.warn(
        `Applied virtual node fault: VNode ${virtualNodeId} -> PNode ${physicalNode} ` +
        `(CPU=${cpuEvPerSec}ev/s, Latency=${faultLatencyMs}ms, Loss=${(faultLossRate * 100).toFixed(1)}%)`
      );

      const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:4000';
      await axios.post(`${gatewayUrl}/api/inject-virtual-node-fault`, {
        virtualNodeId,
        latencyMs: faultLatencyMs
      });

      logger.warn(`Injected ${faultLatencyMs}ms latency into virtual topology for node ${virtualNodeId}`);

      this.originalState = {
        virtualNodeId,
        physicalNode,
        url
      };
    } catch (error) {
      logger.error(`Failed to inject virtual node fault: ${error}`);
    }
  }

  private async removeVirtualNodeFault(): Promise<void> {
    if (!this.originalState || !this.originalState.url) {
      logger.warn('No virtual node fault state to restore');
      return;
    }

    const { virtualNodeId, physicalNode, url } = this.originalState;

    try {
      const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:4000';
      await axios.post(`${gatewayUrl}/api/remove-virtual-node-fault`, {
        virtualNodeId
      });

      logger.info(`Removed latency fault from virtual topology for node ${virtualNodeId}`);

      await axios.post(`${url}/config`, {
        CPU_EV_PER_SEC: 50,
        IO_WAIT_MS: 0,
        FAULT_LATENCY_MS: 0,
        FAULT_LOSS_RATE: 0
      });

      logger.info(
        `Removed virtual node fault: VNode ${virtualNodeId} (PNode ${physicalNode}) restored to normal`
      );
    } catch (error) {
      logger.error(`Failed to remove virtual node fault: ${error}`);
    }
  }

  shouldActivate(elapsedSec: number): boolean {
    return !this.faultActive &&
           elapsedSec >= this.config.startSec &&
           elapsedSec < this.config.startSec + this.config.durationSec;
  }

  hasEnded(elapsedSec: number): boolean {
    return elapsedSec >= this.config.startSec + this.config.durationSec;
  }
}
