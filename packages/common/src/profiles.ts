import { NetworkProfile, NodeCapabilities } from './types.js';

export const networkProfiles: Record<string, NetworkProfile> = {
  edge: {
    name: 'edge',
    bwMbps: 10,
    dpMs: 5,
    jitterMs: 2,
    loss: 0.01,
  },
  fog: {
    name: 'fog',
    bwMbps: 50,
    dpMs: 15,
    jitterMs: 5,
    loss: 0.005,
  },
  cloud: {
    name: 'cloud',
    bwMbps: 100,
    dpMs: 50,
    jitterMs: 10,
    loss: 0.002,
  },
};

export const nodeCaps: Record<string, NodeCapabilities> = {
  n1: {
    name: 'n1',
    cpuEvPerSec: 100,
    ramGB: 2,
    bufferMax: 50,
    ioWaitMs: 10,
  },
  n2: {
    name: 'n2',
    cpuEvPerSec: 200,
    ramGB: 4,
    bufferMax: 100,
    ioWaitMs: 8,
  },
  n3: {
    name: 'n3',
    cpuEvPerSec: 500,
    ramGB: 8,
    bufferMax: 200,
    ioWaitMs: 5,
  },
};
