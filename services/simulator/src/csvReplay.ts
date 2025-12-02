import { readFileSync } from 'fs';
import { EventLike, now } from '@iot-lab/common';
import { randomUUID } from 'crypto';
import { pino } from 'pino';

const logger = pino({ level: 'info' });

export interface CSVRow {
  timestamp?: string;
  deviceId?: string;
  temperature?: number;
  pressure?: number;
  vibration?: number;
  motorCurrent?: number;
}

export class CSVReplayEngine {
  private rows: CSVRow[] = [];
  private currentIndex = 0;
  private defaultDeviceId = 'csv-device-1';

  constructor(csvPath: string) {
    this.loadCSV(csvPath);
  }

  private loadCSV(csvPath: string): void {
    try {
      const content = readFileSync(csvPath, 'utf-8');
      const lines = content.trim().split('\n');

      if (lines.length < 2) {
        logger.warn('CSV file is empty or has no data rows');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: CSVRow = {};

        headers.forEach((header, idx) => {
          const value = values[idx];

          if (header === 'timestamp') {
            row.timestamp = value;
          } else if (header === 'deviceid' || header === 'device_id') {
            row.deviceId = value;
          } else if (header === 'temperature' || header === 'temp') {
            row.temperature = parseFloat(value);
          } else if (header === 'pressure') {
            row.pressure = parseFloat(value);
          } else if (header === 'vibration' || header === 'vib') {
            row.vibration = parseFloat(value);
          } else if (header === 'motorcurrent' || header === 'motor_current' || header === 'current') {
            row.motorCurrent = parseFloat(value);
          }
        });

        this.rows.push(row);
      }

      logger.info(`Loaded ${this.rows.length} rows from ${csvPath}`);
    } catch (error) {
      logger.error(`Failed to load CSV from ${csvPath}:`, error);
      throw error;
    }
  }

  getNextEvents(numDevices: number): EventLike[] {
    if (this.rows.length === 0) {
      logger.warn('No CSV rows available');
      return [];
    }

    const events: EventLike[] = [];

    for (let i = 0; i < numDevices; i++) {
      const row = this.rows[this.currentIndex % this.rows.length];
      this.currentIndex++;

      const event: EventLike = {
        id: randomUUID(),
        deviceId: row.deviceId || `${this.defaultDeviceId}-${i}`,
        ts: now(),
        metrics: {
          temperature: row.temperature ?? 70.0,
          pressure: row.pressure ?? 1.2,
          vibration: row.vibration ?? 0.5,
          motorCurrent: row.motorCurrent ?? 3.0,
        },
        deadlineMs: 100,
      };

      events.push(event);
    }

    return events;
  }

  hasMoreRows(): boolean {
    return this.currentIndex < this.rows.length;
  }

  getTotalRows(): number {
    return this.rows.length;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }
}
