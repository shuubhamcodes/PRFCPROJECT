import fs from 'fs';
import path from 'path';

// ============================================================================
// TypeScript Interfaces
// ============================================================================

export interface Node {
  id: number;
  tier: 'edge' | 'core' | 'cloud';
  physical_map: string;
  cpu_ev_sec?: number;
  buffer_kb?: number;
  bw_mbps?: number;
  storage?: string;
  quality: string;
  current_utilization?: number;
}

export interface Link {
  u: number;
  v: number;
  bw_mbps: number;
  delay_ms: number;
  jitter_ms: number;
  loss_rate: number;
  current_utilization?: number;
}

export interface Path {
  nodeIds: number[];
  latency: number;
  capacity: number;
  score: number;
  status: 'active' | 'degraded' | 'failed';
}

interface TopologyData {
  nodes: Node[];
  links: Link[];
}

interface AdjacencyEntry {
  neighbor: number;
  link: Link;
}

// ============================================================================
// Graph Engine Class
// ============================================================================

export class GraphEngine {
  private nodes: Map<number, Node> = new Map();
  private links: Link[] = [];
  private adjacencyList: Map<number, AdjacencyEntry[]> = new Map();
  private topologyFile: string = '';

  constructor() {}

  /**
   * Loads the topology from a JSON file
   * @param filePath - Path to the topology JSON file
   */
  loadTopology(filePath: string): void {
    try {
      this.topologyFile = filePath;

      // Read and parse the topology file
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);

      console.log(`[GraphEngine] Loading topology from: ${absolutePath}`);

      const fileContent = fs.readFileSync(absolutePath, 'utf-8');
      const topologyData: TopologyData = JSON.parse(fileContent);

      // Validate topology data
      if (!topologyData.nodes || !Array.isArray(topologyData.nodes)) {
        throw new Error('Invalid topology: missing or invalid nodes array');
      }

      if (!topologyData.links || !Array.isArray(topologyData.links)) {
        throw new Error('Invalid topology: missing or invalid links array');
      }

      // Store nodes in map for quick lookup
      this.nodes.clear();
      topologyData.nodes.forEach(node => {
        this.nodes.set(node.id, { ...node, current_utilization: 0 });
      });

      // Store links with initial utilization
      this.links = topologyData.links.map(link => ({
        ...link,
        current_utilization: 0
      }));

      console.log(`[GraphEngine] Loaded ${this.nodes.size} nodes and ${this.links.length} links`);

      // Build the graph structure
      this.buildGraph();

    } catch (error) {
      console.error('[GraphEngine] Error loading topology:', error);
      throw error;
    }
  }

  /**
   * Builds an adjacency list representation of the graph
   * Creates bidirectional edges for undirected graph
   */
  buildGraph(): void {
    try {
      console.log('[GraphEngine] Building adjacency list...');

      // Initialize adjacency list for all nodes
      this.adjacencyList.clear();
      this.nodes.forEach((_, nodeId) => {
        this.adjacencyList.set(nodeId, []);
      });

      // Add edges (bidirectional)
      this.links.forEach(link => {
        // Validate that nodes exist
        if (!this.nodes.has(link.u)) {
          console.warn(`[GraphEngine] Warning: Node ${link.u} in link does not exist`);
          return;
        }
        if (!this.nodes.has(link.v)) {
          console.warn(`[GraphEngine] Warning: Node ${link.v} in link does not exist`);
          return;
        }

        // Add u -> v
        this.adjacencyList.get(link.u)!.push({
          neighbor: link.v,
          link: link
        });

        // Add v -> u (bidirectional)
        this.adjacencyList.get(link.v)!.push({
          neighbor: link.u,
          link: link
        });
      });

      // Log adjacency list statistics
      let totalEdges = 0;
      this.adjacencyList.forEach((neighbors, nodeId) => {
        totalEdges += neighbors.length;
      });

      console.log(`[GraphEngine] Adjacency list built: ${this.adjacencyList.size} nodes, ${totalEdges} directed edges`);

      // Verify connectivity
      this.verifyConnectivity();

    } catch (error) {
      console.error('[GraphEngine] Error building graph:', error);
      throw error;
    }
  }

  /**
   * Verifies that the graph is connected (at least one path exists from any edge to any cloud node)
   */
  private verifyConnectivity(): void {
    const edgeNodes = Array.from(this.nodes.values()).filter(n => n.tier === 'edge');
    const cloudNodes = Array.from(this.nodes.values()).filter(n => n.tier === 'cloud');

    if (edgeNodes.length === 0 || cloudNodes.length === 0) {
      console.warn('[GraphEngine] Warning: No edge or cloud nodes found');
      return;
    }

    // Test connectivity from first edge node to first cloud node
    const testPath = this.findShortestPath(edgeNodes[0].id, cloudNodes[0].id);

    if (testPath) {
      console.log(`[GraphEngine] Connectivity verified: Path exists from edge node ${edgeNodes[0].id} to cloud node ${cloudNodes[0].id}`);
    } else {
      console.warn('[GraphEngine] Warning: Graph may not be fully connected');
    }
  }

  /**
   * Finds the shortest path between two nodes using Dijkstra's algorithm
   * @param src - Source node ID
   * @param dst - Destination node ID
   * @param excludeNodes - Optional set of nodes to exclude from the path
   * @returns Array of node IDs representing the path, or null if no path exists
   */
  findShortestPath(src: number, dst: number, excludeNodes?: Set<number>): number[] | null {
    // Validate source and destination nodes
    if (!this.nodes.has(src)) {
      console.error(`[GraphEngine] Source node ${src} does not exist`);
      return null;
    }
    if (!this.nodes.has(dst)) {
      console.error(`[GraphEngine] Destination node ${dst} does not exist`);
      return null;
    }

    // Initialize distances and previous nodes
    const distances = new Map<number, number>();
    const previous = new Map<number, number | null>();
    const visited = new Set<number>();

    // Initialize all distances to infinity
    this.nodes.forEach((_, nodeId) => {
      distances.set(nodeId, Infinity);
      previous.set(nodeId, null);
    });
    distances.set(src, 0);

    // Priority queue implementation (min-heap)
    // Store as [distance, nodeId]
    const priorityQueue: [number, number][] = [[0, src]];

    while (priorityQueue.length > 0) {
      // Extract node with minimum distance
      priorityQueue.sort((a, b) => a[0] - b[0]);
      const [currentDist, currentNode] = priorityQueue.shift()!;

      // Skip if already visited
      if (visited.has(currentNode)) {
        continue;
      }

      // Mark as visited
      visited.add(currentNode);

      // If we reached the destination, we can stop
      if (currentNode === dst) {
        break;
      }

      // Skip if this node should be excluded
      if (excludeNodes && excludeNodes.has(currentNode) && currentNode !== src && currentNode !== dst) {
        continue;
      }

      // Get neighbors
      const neighbors = this.adjacencyList.get(currentNode) || [];

      // Relax edges
      for (const { neighbor, link } of neighbors) {
        // Skip excluded nodes
        if (excludeNodes && excludeNodes.has(neighbor) && neighbor !== dst) {
          continue;
        }

        if (!visited.has(neighbor)) {
          const newDist = currentDist + link.delay_ms;
          const oldDist = distances.get(neighbor) || Infinity;

          if (newDist < oldDist) {
            distances.set(neighbor, newDist);
            previous.set(neighbor, currentNode);
            priorityQueue.push([newDist, neighbor]);
          }
        }
      }
    }

    // Reconstruct path
    if (distances.get(dst) === Infinity) {
      return null; // No path found
    }

    const path: number[] = [];
    let current: number | null = dst;

    while (current !== null) {
      path.unshift(current);
      current = previous.get(current) || null;
    }

    return path;
  }

  /**
   * Finds k-shortest paths using node-disjoint path algorithm
   * More robust than Yen's algorithm - avoids adjacency list manipulation
   * @param src - Source node ID
   * @param dst - Destination node ID
   * @param k - Number of paths to find
   * @param excludeNodes - Optional array of node IDs to exclude from paths
   * @returns Array of paths
   */
  findKShortestPaths(
    src: number,
    dst: number,
    k: number,
    excludeNodes?: number[]
  ): Path[] {
    console.log(`[GraphEngine] Finding ${k} shortest paths from ${src} to ${dst}`);

    // Validate inputs
    if (!this.nodes.has(src) || !this.nodes.has(dst)) {
      console.error(`[GraphEngine] Invalid source or destination node`);
      return [];
    }

    if (k <= 0) {
      return [];
    }

    // Convert excludeNodes array to Set for efficient lookup
    const initialExcludeSet = excludeNodes ? new Set(excludeNodes) : new Set<number>();

    // Store found paths
    const foundPaths: number[][] = [];

    // Set to track all intermediate nodes used in previous paths
    const usedIntermediateNodes = new Set<number>();

    // Find k paths
    for (let i = 0; i < k; i++) {
      // Create exclude set for this iteration
      const currentExcludeSet = new Set<number>(initialExcludeSet);

      // Add previously used intermediate nodes to exclude set
      // (but NOT src or dst)
      usedIntermediateNodes.forEach(nodeId => {
        if (nodeId !== src && nodeId !== dst) {
          currentExcludeSet.add(nodeId);
        }
      });

      // Find shortest path with current exclusions
      const path = this.findShortestPath(src, dst, currentExcludeSet);

      if (!path) {
        // No more paths available
        break;
      }

      // Add this path
      foundPaths.push(path);

      // Add intermediate nodes from this path to used set
      // (exclude src and dst themselves)
      for (let j = 1; j < path.length - 1; j++) {
        usedIntermediateNodes.add(path[j]);
      }
    }

    if (foundPaths.length === 0) {
      console.log(`[GraphEngine] No path found from ${src} to ${dst}`);
      return [];
    }

    // Convert to Path objects with full metrics
    const paths: Path[] = foundPaths.map(pathNodes => {
      const latency = this.estimatePathLatency(pathNodes);
      const capacity = this.estimatePathCapacity(pathNodes);
      const score = this.scorePath(pathNodes);

      return {
        nodeIds: pathNodes,
        latency,
        capacity,
        score,
        status: 'active'
      };
    });

    console.log(`[GraphEngine] Found ${paths.length} paths`);
    return paths;
  }

  /**
   * Calculates the total cost (delay) of a path
   * @param path - Array of node IDs
   * @returns Total cost in milliseconds
   */
  private calculatePathCost(path: number[]): number {
    let totalCost = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const link = this.getLink(path[i], path[i + 1]);
      if (link) {
        totalCost += link.delay_ms;
      } else {
        return Infinity; // Invalid path
      }
    }

    return totalCost;
  }

  /**
   * Calculates the total latency of a path
   * @param path - Array of node IDs
   * @returns Total latency in milliseconds
   */
  estimatePathLatency(path: number[]): number {
    if (path.length < 2) {
      return 0;
    }

    let totalLatency = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const link = this.getLink(path[i], path[i + 1]);
      if (link) {
        totalLatency += link.delay_ms;
      }
    }

    return totalLatency;
  }

  /**
   * Finds the minimum capacity along a path (bottleneck)
   * @param path - Array of node IDs
   * @returns Minimum capacity value
   */
  estimatePathCapacity(path: number[]): number {
    if (path.length < 2) {
      return 0;
    }

    let minCapacity = Infinity;

    for (let i = 0; i < path.length - 1; i++) {
      const link = this.getLink(path[i], path[i + 1]);
      if (link) {
        // Consider available bandwidth (accounting for current utilization)
        const availableBw = link.bw_mbps * (1 - (link.current_utilization || 0));
        minCapacity = Math.min(minCapacity, availableBw);
      }
    }

    return minCapacity === Infinity ? 0 : minCapacity;
  }

  /**
   * Scores a path based on multiple criteria
   * @param path - Array of node IDs
   * @returns Numeric score (higher is better)
   */
  scorePath(path: number[]): number {
    if (path.length < 2) {
      return 0;
    }

    const latency = this.estimatePathLatency(path);
    const capacity = this.estimatePathCapacity(path);
    const hopCount = path.length - 1;

    // Calculate average utilization across the path
    let totalUtilization = 0;
    let linkCount = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const link = this.getLink(path[i], path[i + 1]);
      if (link) {
        totalUtilization += link.current_utilization || 0;
        linkCount++;
      }
    }

    const avgUtilization = linkCount > 0 ? totalUtilization / linkCount : 0;

    // Scoring formula (higher is better):
    // - Lower latency is better
    // - Higher capacity is better
    // - Fewer hops is better
    // - Lower utilization is better

    const latencyScore = latency > 0 ? 1000 / latency : 0;
    const capacityScore = capacity * 10;
    const hopScore = hopCount > 0 ? 100 / hopCount : 0;
    const utilizationScore = (1 - avgUtilization) * 100;

    const totalScore = latencyScore + capacityScore + hopScore + utilizationScore;

    return totalScore;
  }

  /**
   * Validates that a path respects tier hierarchy (edge -> core -> cloud)
   * @param path - Array of node IDs
   * @returns True if path is valid, false otherwise
   */
  isValidPath(path: number[]): boolean {
    if (path.length < 2) {
      return false;
    }

    const tierOrder: Record<string, number> = {
      'edge': 1,
      'core': 2,
      'cloud': 3
    };

    let currentTierLevel = 0;

    for (const nodeId of path) {
      const node = this.nodes.get(nodeId);
      if (!node) {
        return false; // Node doesn't exist
      }

      const nodeTierLevel = tierOrder[node.tier];

      // Tier level should never decrease (can stay same or increase)
      if (nodeTierLevel < currentTierLevel) {
        return false;
      }

      currentTierLevel = nodeTierLevel;
    }

    // Verify that path starts at edge and ends at cloud
    const firstNode = this.nodes.get(path[0]);
    const lastNode = this.nodes.get(path[path.length - 1]);

    if (!firstNode || !lastNode) {
      return false;
    }

    // Path should start at edge and end at cloud
    if (firstNode.tier !== 'edge' || lastNode.tier !== 'cloud') {
      return false;
    }

    return true;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get topology statistics
   * @returns Object containing node and link counts
   */
  getTopologyStats(): { nodes: number; links: number } {
    return {
      nodes: this.nodes.size,
      links: this.links.length
    };
  }

  /**
   * Gets a node by ID
   */
  getNode(nodeId: number): Node | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Gets all nodes of a specific tier
   */
  getNodesByTier(tier: 'edge' | 'core' | 'cloud'): Node[] {
    return Array.from(this.nodes.values()).filter(n => n.tier === tier);
  }

  /**
   * Gets neighbors of a node
   */
  getNeighbors(nodeId: number): AdjacencyEntry[] {
    return this.adjacencyList.get(nodeId) || [];
  }

  /**
   * Gets the link between two nodes
   */
  getLink(u: number, v: number): Link | undefined {
    const neighbors = this.adjacencyList.get(u);
    if (!neighbors) return undefined;

    const entry = neighbors.find(n => n.neighbor === v);
    return entry?.link;
  }

  /**
   * Updates node utilization
   */
  updateNodeUtilization(nodeId: number, utilization: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.current_utilization = utilization;
    }
  }

  /**
   * Updates link utilization
   */
  updateLinkUtilization(u: number, v: number, utilization: number): void {
    const link = this.getLink(u, v);
    if (link) {
      link.current_utilization = utilization;
    }
  }

  /**
   * Gets all nodes
   */
  getAllNodes(): Node[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Gets all links
   */
  getAllLinks(): Link[] {
    return this.links;
  }

  /**
   * Injects fault latency to all links connected to a virtual node
   */
  injectNodeLatencyFault(nodeId: number, additionalLatencyMs: number): void {
    console.log(`\n🔥 [GraphEngine] Injecting ${additionalLatencyMs}ms latency fault to node ${nodeId} and all connected links\n`);

    for (const link of this.links) {
      if (link.u === nodeId || link.v === nodeId) {
        (link as any).base_delay_ms = (link as any).base_delay_ms || link.delay_ms;
        link.delay_ms = (link as any).base_delay_ms + additionalLatencyMs;
        console.log(`   Link [${link.u}→${link.v}]: ${(link as any).base_delay_ms}ms → ${link.delay_ms}ms`);
      }
    }
  }

  /**
   * Removes fault latency from a virtual node
   */
  removeNodeLatencyFault(nodeId: number): void {
    console.log(`\n✅ [GraphEngine] Removing latency fault from node ${nodeId}\n`);

    for (const link of this.links) {
      if (link.u === nodeId || link.v === nodeId) {
        if ((link as any).base_delay_ms !== undefined) {
          link.delay_ms = (link as any).base_delay_ms;
          console.log(`   Link [${link.u}→${link.v}]: restored to ${link.delay_ms}ms`);
        }
      }
    }
  }

  /**
   * Gets graph statistics
   */
  getStats(): {
    nodes: number;
    links: number;
    edgeNodes: number;
    coreNodes: number;
    cloudNodes: number;
  } {
    const edgeNodes = this.getNodesByTier('edge').length;
    const coreNodes = this.getNodesByTier('core').length;
    const cloudNodes = this.getNodesByTier('cloud').length;

    return {
      nodes: this.nodes.size,
      links: this.links.length,
      edgeNodes,
      coreNodes,
      cloudNodes
    };
  }
}
