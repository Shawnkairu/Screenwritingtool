import type { Scene } from '../types';

interface SceneCardProps {
  scene: Scene;
  isSelected: boolean;
  onClick: () => void;
}

export default function SceneCard({ scene, isSelected, onClick }: SceneCardProps) {
  const shiftColor =
    scene.value_shift === 'static'
      ? 'rgba(200,160,100,0.25)'
      : scene.value_shift === 'positive_to_negative'
        ? '#c86858'
        : '#68a878';

  const shiftIcon =
    scene.value_shift === 'static' ? '—' : scene.value_shift === 'positive_to_negative' ? '↘' : '↗';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px',
        borderLeft: `3px solid ${isSelected ? 'rgba(200,160,100,0.5)' : 'rgba(200,160,100,0.08)'}`,
        background: isSelected ? 'rgba(200,160,100,0.05)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.2s',
        marginBottom: '2px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
        <span style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '10px',
          color: 'rgba(200,160,100,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          Scene {scene.number}
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: shiftColor, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
            {shiftIcon} {scene.value_shift === 'static' ? 'static' : 'turns'}
          </span>
          <div style={{ width: '32px', height: '4px', borderRadius: '2px', background: 'rgba(200,160,100,0.08)', overflow: 'hidden' }}>
            <div style={{
              width: `${scene.tension * 100}%`, height: '100%', borderRadius: '2px',
              background: `hsl(${30 + (1 - scene.tension) * 10}, ${50 + scene.tension * 30}%, ${45 + scene.tension * 15}%)`,
            }} />
          </div>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: isSelected ? '#d4c5a9' : '#b8a88a', fontWeight: isSelected ? 500 : 400 }}>
        {scene.title}
      </div>

      {isSelected && (
        <>
          <div style={{ fontSize: '11px', color: 'rgba(200,160,100,0.5)', marginTop: '4px', lineHeight: 1.5 }}>
            {scene.summary}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
            {scene.characters?.map((ch, ci) => (
              <span key={ci} style={{
                fontSize: '9px', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                color: 'rgba(200,160,100,0.4)', background: 'rgba(200,160,100,0.06)',
                padding: '2px 6px', borderRadius: '3px',
              }}>
                {ch}
              </span>
            ))}
            {scene.has_subtext && (
              <span style={{
                fontSize: '9px', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                color: '#68a878', background: 'rgba(104,168,120,0.08)',
                padding: '2px 6px', borderRadius: '3px',
              }}>
                subtext
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
