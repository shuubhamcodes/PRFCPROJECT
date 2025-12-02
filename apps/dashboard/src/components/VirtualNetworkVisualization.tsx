import React from 'react';
import { Server, Activity, Cloud, Zap } from 'lucide-react';

interface VirtualNode {
  id: number;
  tier: 'edge' | 'core' | 'cloud';
  quality: string;
  physicalMap: string;
  utilization: number;
}

interface VirtualLink {
  from: number;
  to: number;
  latency: number;
  bandwidth: number;
  utilization: number;
}

interface VirtualNetworkVisualizationProps {
  nodes: VirtualNode[];
  links: VirtualLink[];
  activePaths?: any[];
}

export function VirtualNetworkVisualization({ nodes, links, activePaths = [] }: VirtualNetworkVisualizationProps) {
  const edgeNodes = nodes.filter(n => n.tier === 'edge').sort((a, b) => a.id - b.id);
  const coreNodes = nodes.filter(n => n.tier === 'core').sort((a, b) => a.id - b.id);
  const cloudNodes = nodes.filter(n => n.tier === 'cloud').sort((a, b) => a.id - b.id);

  const getNodeColor = (quality: string) => {
    switch (quality) {
      case 'high':
      case 'premium':
        return 'bg-green-100 border-green-500 text-green-700';
      case 'medium':
      case 'standard':
        return 'bg-blue-100 border-blue-500 text-blue-700';
      case 'low':
      case 'budget':
        return 'bg-yellow-100 border-yellow-500 text-yellow-700';
      default:
        return 'bg-gray-100 border-gray-500 text-gray-700';
    }
  };

  const getNodeIcon = (tier: string) => {
    switch (tier) {
      case 'edge': return <Server className="w-4 h-4" />;
      case 'core': return <Activity className="w-4 h-4" />;
      case 'cloud': return <Cloud className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  };

  const isLinkActive = (from: number, to: number) => {
    if (!activePaths || activePaths.length === 0) return false;

    return activePaths.some((path: any) => {
      const nodeIds = path.nodeIds || [];
      for (let i = 0; i < nodeIds.length - 1; i++) {
        if ((nodeIds[i] === from && nodeIds[i + 1] === to) ||
            (nodeIds[i] === to && nodeIds[i + 1] === from)) {
          return true;
        }
      }
      return false;
    });
  };

  const getNodePosition = (nodeId: number, index: number, total: number, tier: string) => {
    const tierY = tier === 'edge' ? 15 : tier === 'core' ? 50 : 85;
    const spacing = 80 / (total + 1);
    const x = 10 + spacing * (index + 1);
    return { x, y: tierY };
  };

  const renderNode = (node: VirtualNode, index: number, tierArray: VirtualNode[]) => {
    const pos = getNodePosition(node.id, index, tierArray.length, node.tier);
    const colorClass = getNodeColor(node.quality);

    return (
      <div
        key={node.id}
        className="absolute"
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
      >
        <div className={`w-12 h-12 rounded-full border-2 ${colorClass} flex items-center justify-center shadow-lg hover:scale-110 transition-all cursor-pointer`}>
          {getNodeIcon(node.tier)}
        </div>
        <div className="text-center mt-1">
          <div className="text-xs font-bold">{node.id}</div>
          <div className="text-xs text-gray-500">{node.quality}</div>
        </div>
      </div>
    );
  };

  const renderLinks = () => {
    return links.map((link, index) => {
      const fromNode = nodes.find(n => n.id === link.from);
      const toNode = nodes.find(n => n.id === link.to);

      if (!fromNode || !toNode) return null;

      const fromIndex = nodes.filter(n => n.tier === fromNode.tier).findIndex(n => n.id === fromNode.id);
      const toIndex = nodes.filter(n => n.tier === toNode.tier).findIndex(n => n.id === toNode.id);
      const fromTotal = nodes.filter(n => n.tier === fromNode.tier).length;
      const toTotal = nodes.filter(n => n.tier === toNode.tier).length;

      const fromPos = getNodePosition(link.from, fromIndex, fromTotal, fromNode.tier);
      const toPos = getNodePosition(link.to, toIndex, toTotal, toNode.tier);

      const isActive = isLinkActive(link.from, link.to);
      const strokeColor = isActive ? '#3b82f6' : '#e5e7eb';
      const strokeWidth = isActive ? 2 : 1;

      return (
        <line
          key={`${link.from}-${link.to}-${index}`}
          x1={`${fromPos.x}%`}
          y1={`${fromPos.y}%`}
          x2={`${toPos.x}%`}
          y2={`${toPos.y}%`}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          opacity={isActive ? 0.8 : 0.3}
        />
      );
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Zap className="w-5 h-5 text-purple-600" />
          <h2 className="text-xl font-bold text-gray-800">Virtual Network Topology (24 Nodes)</h2>
        </div>
        <div className="text-sm text-gray-600">
          {edgeNodes.length} Edge · {coreNodes.length} Core · {cloudNodes.length} Cloud
        </div>
      </div>

      <div className="relative bg-gradient-to-b from-gray-50 to-gray-100 rounded-lg" style={{ height: '500px' }}>
        <svg className="absolute inset-0 w-full h-full">
          {renderLinks()}
        </svg>

        <div className="absolute top-2 left-4 text-xs font-semibold text-gray-600 bg-green-100 px-2 py-1 rounded">
          EDGE TIER
        </div>
        <div className="absolute top-1/2 left-4 -translate-y-1/2 text-xs font-semibold text-gray-600 bg-blue-100 px-2 py-1 rounded">
          CORE TIER
        </div>
        <div className="absolute bottom-2 left-4 text-xs font-semibold text-gray-600 bg-purple-100 px-2 py-1 rounded">
          CLOUD TIER
        </div>

        {edgeNodes.map((node, index) => renderNode(node, index, edgeNodes))}
        {coreNodes.map((node, index) => renderNode(node, index, coreNodes))}
        {cloudNodes.map((node, index) => renderNode(node, index, cloudNodes))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-green-100 border-2 border-green-500"></div>
          <span>High Quality</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-blue-100 border-2 border-blue-500"></div>
          <span>Medium Quality</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-yellow-100 border-2 border-yellow-500"></div>
          <span>Low Quality</span>
        </div>
      </div>

      {activePaths && activePaths.length > 0 && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <div className="font-semibold text-sm text-blue-800 mb-2">Active Paths ({activePaths.length}):</div>
          <div className="space-y-1">
            {activePaths.slice(0, 3).map((path: any, idx: number) => (
              <div key={idx} className="text-xs text-blue-700">
                Path {idx}: {path.nodeIds?.join(' → ') || 'N/A'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
