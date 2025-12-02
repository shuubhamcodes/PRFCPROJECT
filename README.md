# IoT Resilience PRFC Lab

TypeScript monorepo for IoT resilience testing with PRFC (Predictive Request Flow Control).

## Structure

```
iot-resiliencePRFC-lab/
├── packages/
│   └── common/              # Shared utilities and types
├── services/
│   ├── edge-server/         # Edge computing service
│   ├── core-server/         # Core processing service
│   ├── cloud-server/        # Cloud integration (Supabase)
│   ├── gateway/             # PRFC host gateway
│   ├── simulator/           # IoT device simulator
│   └── ai-summarizer/       # AI summarization service
└── apps/
    └── dashboard/           # Vite + React + Tailwind dashboard
```

## Requirements

- Node.js 18+
- pnpm

## Setup

```bash
pnpm install
```

## Commands

```bash
pnpm dev        # Run all services in parallel
pnpm build      # Build all packages
pnpm typecheck  # Type-check all packages
```

## Technologies

- TypeScript (ES2022, NodeNext, strict mode)
- Express, Axios, Zod, Pino, WebSockets
- Supabase (cloud-server)
- Vite + React + Tailwind + Recharts (dashboard)

## Package Details

### packages/common
Shared utilities and types used across all services.

### services/edge-server
Edge computing service with Express and WebSocket support.

### services/core-server
Core processing service handling main business logic.

### services/cloud-server
Cloud integration service using Supabase for data persistence.

### services/gateway
Gateway service hosting PRFC (Predictive Request Flow Control).

### services/simulator
IoT device simulator for testing.

### services/ai-summarizer
AI-powered summarization service.

### apps/dashboard
Web dashboard built with Vite, React, TypeScript, Tailwind CSS, and Recharts.
