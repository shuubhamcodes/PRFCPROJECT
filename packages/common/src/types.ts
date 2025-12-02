import { z } from 'zod';

export const EventLikeSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  ts: z.number(),
  metrics: z.object({
    temperature: z.number(),
    pressure: z.number(),
    vibration: z.number(),
    motorCurrent: z.number(),
  }),
  deadlineMs: z.number(),
});

export type EventLike = z.infer<typeof EventLikeSchema>;

export const EventArraySchema = z.array(EventLikeSchema);

export interface LatencyRecord {
  eventId: string;
  deviceId: string;
  enqueuedAt: number;
  processedAt: number;
  latencyMs: number;
  deadlineMet: boolean;
  processingNode: string;
}

export type IncidentKind = 'deadline_miss' | 'failover' | 'node_down' | 'node_recover';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  id: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  ts: number;
  details: Record<string, unknown>;
}

export interface NetworkProfile {
  name: string;
  bwMbps: number;
  dpMs: number;
  jitterMs: number;
  loss: number;
}

export interface NodeCapabilities {
  name: string;
  cpuEvPerSec: number;
  ramGB: number;
  bufferMax: number;
  ioWaitMs: number;
}

export interface ResourceMetric {
  nodeId: string;
  ts: number;
  cpuUtilization: number;
  ramUtilization: number;
  bufferUtilization: number;
  queueDepth: number;
}
