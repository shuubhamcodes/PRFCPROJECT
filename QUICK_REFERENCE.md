# 🎯 PRFC Quick Reference Card

## One-Time Setup
```bash
npm install -g pnpm
export PATH="/tmp/.npm-global/bin:$PATH"
pnpm install
pnpm run build
```

## Start Services (4 Terminals)

```bash
# Terminal 1
pnpm run start:edge

# Terminal 2
pnpm run start:core

# Terminal 3
pnpm run start:cloud

# Terminal 4
pnpm run start:gateway
```

## Run Demos (Terminal 5)

```bash
# Normal operation (no faults)
pnpm run demo:normal

# CPU overload on core server
pnpm run demo:cpu

# Virtual node fault (node 9)
pnpm run demo:virtual-node

# Test virtual routing (no traffic)
pnpm run test:virtual-routing
```

## Health Checks

```bash
# Check all services
pnpm run health

# Monitor PRFC continuously
pnpm run monitor:prfc

# View PRFC state
curl http://localhost:4000/prfc/state | jq
```

## Expected Behavior

### Normal Operation
- ✅ EWMA: 40-80ms
- ✅ Slope: -1 to +1
- ✅ Drop rate: 0%
- ✅ All paths: healthy

### During CPU Fault
- t=30s: Fault injected on n2
- t=33s: PRFC detects degradation
- t=33s: Rebalances to 85/5/5/5
- t=90s: Fault removed
- t=110s: Path enters recovery
- t=125s: Path fully healthy
- t=132s: Gradual revert complete (50/30/20)

### During Virtual Node Fault
- Fault on virtual node 9 (maps to n2)
- PRFC identifies node 9 as bottleneck
- Alternative paths avoid node 9
- System continues with <1% loss

## Key Metrics

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| EWMA | 40-80ms | 80-100ms | >100ms |
| Slope | -1 to +1 | +1 to +5 | >+5 |
| Drop Rate | 0% | 0-1% | >1% |
| Path Status | healthy | recovering | degraded |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port in use | `lsof -ti:4000 \| xargs kill -9` |
| No detection | Lower thresholds in .env |
| No recovery | Wait 20s hold time |
| Not virtual | Set `ROUTING_MODE=virtual` |

## Configuration (.env)

```bash
ROUTING_MODE=virtual        # Use 24-node topology
K_PATHS=5                   # Find 5 candidate paths
ACTIVE_PATHS=3              # Use 3 paths simultaneously
PRFC_EWMA_THRESHOLD=100     # 100ms latency limit
PRFC_SLOPE_THRESHOLD=5      # 5ms/batch trend limit
RECOVERY_HOLD_TIME=20000    # 20s before recovery
STABILITY_TIME=15000        # 15s stability required
TRANSITION_DURATION=7000    # 7s gradual revert
```

## Success Indicators

✅ Build completes without errors
✅ All 4 services start successfully
✅ Gateway shows "Virtual routing mode enabled"
✅ Simulator shows even edge distribution (12.5% per node)
✅ PRFC detects faults in <5 seconds
✅ Rebalancing completes immediately
✅ <1% message loss during faults
✅ Smooth recovery and revert

## Ports

- 4000: Gateway (PRFC)
- 4020: Edge Server (n1)
- 4025: Core Server (n2)
- 4030: Cloud Server (n3)
- 5173: Dashboard (optional)

## Common Commands

```bash
# Kill all services
pkill -f "node.*edge-server"
pkill -f "node.*core-server"
pkill -f "node.*cloud-server"
pkill -f "node.*gateway"

# View logs
tail -f gateway.log
tail -f simulator.log

# Check specific port
lsof -i :4000

# Test connectivity
curl http://localhost:4000/config
curl http://localhost:4020/health
```

## Demo Timeline (demo:cpu)

```
0s    ▶ Start simulation
30s   🔥 Inject CPU fault on n2
33s   ⚠️  PRFC detects degradation
33s   🔄 Rebalance to 85/5/5/5
90s   ✅ Remove fault
110s  🔄 Enter recovery
125s  ✅ Fully healthy
132s  🔄 Revert complete (50/30/20)
```

---

**For detailed explanations, see RUN_GUIDE.md**
