import type { Scene } from '../types';

interface TensionTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Scene }>;
}

export default function TensionTooltip({ active, payload }: TensionTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  const shiftColor =
    d.value_shift === 'static'
      ? 'rgba(200,160,100,0.35)'
      : d.value_shift === 'positive_to_negative'
        ? '#c86858'
        : '#68a878';

  const shiftLabel =
    d.value_shift === 'static' ? 'Static' : d.value_shift === 'positive_to_negative' ? '↘ Turns' : '↗ Turns';

  return (
    <div
      style={{
        background: '#252019',
        border: '1px solid rgba(200,160,100,0.25)',
        borderRadius: '6px',
        padding: '10px 14px',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        fontSize: '11px',
        lineHeight: 1.6,
        maxWidth: '220px',
      }}
    >
      <div style={{ color: '#d4c5a9', fontWeight: 600, marginBottom: '4px' }}>
        Scene {d.number}: {d.title}
      </div>
      <div style={{ color: 'rgba(200,160,100,0.6)' }}>{d.summary}</div>
      <div style={{ marginTop: '6px', display: 'flex', gap: '12px' }}>
        <span style={{ color: '#c89868' }}>Tension: {(d.tension * 100).toFixed(0)}%</span>
        <span style={{ color: shiftColor }}>{shiftLabel}</span>
      </div>
    </div>
  );
}
