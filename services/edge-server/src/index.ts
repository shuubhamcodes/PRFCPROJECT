import express, { Request, Response } from 'express';
import { pino } from 'pino';
import dotenv from 'dotenv';
import axios from 'axios';
import { EventArraySchema, EventLike, inMemoryDB, now } from '@iot-lab/common';

dotenv.config();

const app = express();
app.use(express.json());

const logger = pino({ level: 'info' });

const PORT = parseInt(process.env.PORT || '4020', 10);
const NODE_NAME = process.env.NODE_NAME || 'n1';
let BUFFER_MAX = parseInt(process.env.BUFFER_MAX || '200', 10);
let CPU_EV_PER_SEC = parseInt(process.env.CPU_EV_PER_SEC || '50', 10);
let IO_WAIT_MS = parseInt(process.env.IO_WAIT_MS || '0', 10);
let FAULT_LATENCY_MS = parseInt(process.env.FAULT_LATENCY_MS || '0', 10);
let FAULT_LOSS_RATE = parseFloat(process.env.FAULT_LOSS_RATE || '0');
const NEXT_HOP_URL = process.env.NEXT_HOP_URL || 'http://localhost:4025';

const eventBuffer: EventLike[] = [];
let processedCount = 0;
let cpuUtilization = 0;

async function simulateCPUWork(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    Math.sqrt(Math.random());
  }
}

async function simulateIOWait(ms: number): Promise<void> {
  if (ms > 0) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function processEvents(): Promise<void> {
  while (true) {
    if (eventBuffer.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
      cpuUtilization = 0;
      continue;
    }

    const event = eventBuffer.shift();
    if (!event) continue;

    const cpuTimeMs = 1000 / CPU_EV_PER_SEC;
    cpuUtilization = Math.min(1, eventBuffer.length / BUFFER_MAX);

    await simulateCPUWork(cpuTimeMs);
    await simulateIOWait(IO_WAIT_MS);

    processedCount++;

    const processedAt = now();
    const latency = processedAt - event.ts;
    const deadlineMet = latency <= event.deadlineMs;

    inMemoryDB.latencyRecords.push({
      eventId: event.id,
      deviceId: event.deviceId,
      enqueuedAt: event.ts,
      processedAt,
      latencyMs: latency,
      deadlineMet,
      processingNode: NODE_NAME,
    });
  }
}

processEvents();

app.post('/ingest', async (req: Request, res: Response) => {
  const validation = EventArraySchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: 'Invalid event array', details: validation.error });
  }

  let events = validation.data;

  if (FAULT_LATENCY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, FAULT_LATENCY_MS));
  }

  if (FAULT_LOSS_RATE > 0) {
    events = events.filter(() => Math.random() > FAULT_LOSS_RATE);
    if (events.length === 0) {
      return res.json({
        accepted: 0,
        dropped: validation.data.length,
        bufferDepth: eventBuffer.length,
        reason: 'Fault-induced packet loss',
      });
    }
  }

  if (eventBuffer.length + events.length > BUFFER_MAX) {
    const accepted = BUFFER_MAX - eventBuffer.length;
    const dropped = events.length - accepted;

    eventBuffer.push(...events.slice(0, accepted));

    logger.warn(`Buffer overflow: accepted ${accepted}, dropped ${dropped}`);

    return res.json({
      accepted,
      dropped,
      bufferDepth: eventBuffer.length,
      reason: 'Buffer overflow',
    });
  }

  eventBuffer.push(...events);

  if (NEXT_HOP_URL) {
    try {
      await axios.post(`${NEXT_HOP_URL}/ingest`, events, { timeout: 5000 });
    } catch (error) {
      logger.warn(`Failed to forward to next hop: ${error}`);
    }
  }

  res.json({
    accepted: events.length,
    dropped: 0,
    bufferDepth: eventBuffer.length,
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    node: NODE_NAME,
    cpu: cpuUtilization,
    bufferDepth: eventBuffer.length,
    bufferMax: BUFFER_MAX,
    processed: processedCount,
    cpuEvPerSec: CPU_EV_PER_SEC,
    ioWaitMs: IO_WAIT_MS,
  });
});

app.post('/config', (req: Request, res: Response) => {
  const { CPU_EV_PER_SEC: newCPU, IO_WAIT_MS: newIO, BUFFER_MAX: newBuffer, FAULT_LATENCY_MS: newLatency, FAULT_LOSS_RATE: newLoss } = req.body;

  if (newCPU !== undefined) {
    CPU_EV_PER_SEC = parseInt(String(newCPU), 10);
    logger.info(`CPU_EV_PER_SEC updated to ${CPU_EV_PER_SEC}`);
  }

  if (newIO !== undefined) {
    IO_WAIT_MS = parseInt(String(newIO), 10);
    logger.info(`IO_WAIT_MS updated to ${IO_WAIT_MS}`);
  }

  if (newBuffer !== undefined) {
    BUFFER_MAX = parseInt(String(newBuffer), 10);
    logger.info(`BUFFER_MAX updated to ${BUFFER_MAX}`);
  }

  if (newLatency !== undefined) {
    FAULT_LATENCY_MS = parseInt(String(newLatency), 10);
    logger.info(`FAULT_LATENCY_MS updated to ${FAULT_LATENCY_MS}`);
  }

  if (newLoss !== undefined) {
    FAULT_LOSS_RATE = parseFloat(String(newLoss));
    logger.info(`FAULT_LOSS_RATE updated to ${FAULT_LOSS_RATE}`);
  }

  res.json({
    CPU_EV_PER_SEC,
    IO_WAIT_MS,
    BUFFER_MAX,
    FAULT_LATENCY_MS,
    FAULT_LOSS_RATE,
  });
});

const server = app.listen(PORT, () => {
  logger.info(`${NODE_NAME} started on port ${PORT}`);
  logger.info(`BUFFER_MAX=${BUFFER_MAX}, CPU_EV_PER_SEC=${CPU_EV_PER_SEC}, IO_WAIT_MS=${IO_WAIT_MS}`);
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
