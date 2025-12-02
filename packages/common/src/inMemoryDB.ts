import { LatencyRecord, ResourceMetric, Incident } from './types.js';

export interface InMemoryDB {
  latencyRecords: LatencyRecord[];
  resourceMetrics: ResourceMetric[];
  incidents: Incident[];
}

export const inMemoryDB: InMemoryDB = {
  latencyRecords: [],
  resourceMetrics: [],
  incidents: [],
};
