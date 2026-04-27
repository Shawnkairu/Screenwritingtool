import type { Character, Relationship } from '../types';

interface CharacterWebProps {
  characters: Character[];
  relationships: Relationship[];
}

const REL_COLORS: Record<string, string> = {
  conflict: '#c86858',
  tension: '#c89858',
  allied: '#68a878',
  romantic: '#b878a8',
  power: '#8888c8',
  neutral: 'rgba(200,160,100,0.2)',
};

export default function CharacterWeb({ characters, relationships }: CharacterWebProps) {
  const width = 380;
  const height = 260;
  const cx = width / 2;
  const cy = height / 2;

  if (!characters?.length) return null;

  const nodes = characters.map((c, i) => {
    const angle = (i / characters.length) * Math.PI * 2 - Math.PI / 2;
    const radius = Math.min(width, height) * 0.32;
    return { ...c, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.name, n]));

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      {relationships?.map((r, i) => {
        const from = nodeMap[r.from];
        const to = nodeMap[r.to];
        if (!from || !to) return null;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        const color = REL_COLORS[r.type] ?? REL_COLORS.neutral;
        return (
          <g key={`rel-${i}`}>
            <line
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={color}
              strokeWidth={1 + r.intensity * 2}
              opacity={0.5 + r.intensity * 0.3}
              strokeDasharray={r.type === 'tension' ? '4 3' : 'none'}
            />
            <text
              x={midX} y={midY - 6}
              fill={color} fontSize="8.5"
              fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
              textAnchor="middle" opacity={0.7}
            >
              {r.label}
            </text>
          </g>
        );
      })}
      {nodes.map((n, i) => (
        <g key={`char-${i}`}>
          <circle
            cx={n.x} cy={n.y} r={20}
            fill="rgba(200,160,100,0.06)"
            stroke="rgba(200,160,100,0.25)"
            strokeWidth={1.5}
          />
          <text
            x={n.x} y={n.y + 1}
            fill="#d4c5a9" fontSize="9.5"
            fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
            fontWeight="500" textAnchor="middle" dominantBaseline="middle"
          >
            {n.name.length > 7 ? n.name.slice(0, 6) + '…' : n.name}
          </text>
          <text
            x={n.x} y={n.y + 34}
            fill="rgba(200,160,100,0.4)" fontSize="7.5"
            fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
            textAnchor="middle"
          >
            {n.want && n.want !== 'undefined' ? `wants: ${n.want.slice(0, 22)}` : 'want: ?'}
          </text>
        </g>
      ))}
    </svg>
  );
}
