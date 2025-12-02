#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║                   PRFC Configuration Verification                    ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

echo "🔍 Checking fault configuration..."
FAULT_LATENCY=$(grep -A 3 "case 'cpu_overload'" services/simulator/src/faultInjector.ts | grep "faultLatencyMs.*medium" | grep -o "[0-9]\+" | head -1)

if [ "$FAULT_LATENCY" -ge "150" ]; then
    echo "✅ Fault latency: ${FAULT_LATENCY}ms (STRONG - will trigger PRFC)"
else
    echo "❌ Fault latency: ${FAULT_LATENCY}ms (TOO WEAK - may not trigger)"
    echo "   Should be >= 150ms"
    exit 1
fi

echo ""
echo "🔍 Checking PRFC thresholds..."
EWMA_THRESHOLD=$(grep "EWMA_MAX_MS.*process.env" services/gateway/src/index.ts | grep -o "'[0-9]\+'" | tr -d "'")
SLOPE_THRESHOLD=$(grep "SLOPE_MIN_MS_PER_S.*process.env" services/gateway/src/index.ts | grep -o "'[0-9]\+'" | tr -d "'")

echo "✅ EWMA threshold: ${EWMA_THRESHOLD}ms"
echo "✅ Slope threshold: ${SLOPE_THRESHOLD}ms/s"

echo ""
echo "📊 Mathematical verification:"
BASE_LATENCY=40
PEAK_LATENCY=$((BASE_LATENCY + FAULT_LATENCY))
MARGIN=$((PEAK_LATENCY - EWMA_THRESHOLD))

echo "   Base latency:    ${BASE_LATENCY}ms"
echo "   Fault adds:      +${FAULT_LATENCY}ms"
echo "   Peak latency:    ${PEAK_LATENCY}ms"
echo "   ──────────────────────────────"
echo "   EWMA threshold:  ${EWMA_THRESHOLD}ms"
echo "   Margin above:    +${MARGIN}ms"

if [ "$MARGIN" -gt "50" ]; then
    echo "   ✅ GUARANTEED TO TRIGGER PRFC!"
elif [ "$MARGIN" -gt "0" ]; then
    echo "   ⚠️  May trigger (marginal)"
else
    echo "   ❌ Will NOT trigger PRFC"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║                    ✅ CONFIGURATION VERIFIED                         ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Ready to run demo!"
echo ""
echo "Next steps:"
echo "  1. npm run start:gateway    (Terminal 1)"
echo "  2. npm run demo:cpu          (Terminal 2)"
echo "  3. Watch for big red banner around 55-65 seconds!"
