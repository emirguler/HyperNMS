import dagre from 'dagre';

export function getLayoutedElements(nodes, edges, direction = 'TB') {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 120, edgesep: 40 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 170, height: 130 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const n = g.node(node.id);
    return {
      ...node,
      position: { x: n.x - 85, y: n.y - 65 },
    };
  });

  return { nodes: layoutedNodes, edges };
}
