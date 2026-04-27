import type { Structure } from '../types';

interface StructurePanelProps {
  structure: Structure;
}

const DRAFT_STAGE_LABEL: Record<Structure['draft_stage'], string> = {
  first_draft: 'First Draft',
  revision: 'Revision',
  polish: 'Polish',
};

export default function StructurePanel({ structure }: StructurePanelProps) {
  const items: Array<{ label: string; value: string | undefined; accent?: boolean }> = [
    { label: 'Dramatic Question', value: structure.dramatic_question },
    { label: 'Protagonist', value: structure.protagonist },
    { label: 'Want', value: structure.protagonist_want },
    { label: 'Central Conflict', value: structure.central_conflict },
    { label: 'Biggest Issue', value: structure.biggest_issue, accent: true },
  ];

  return (
    <div style={{
      background: 'rgba(200,160,100,0.03)',
      border: '1px solid rgba(200,160,100,0.1)',
      borderRadius: '8px',
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.15em',
        color: 'rgba(200,160,100,0.35)', marginBottom: '10px',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontWeight: 600,
      }}>
        Structural Read
      </div>

      {items.map((item, i) => (
        <div key={i} style={{ marginBottom: '6px', fontSize: '11.5px', lineHeight: 1.5 }}>
          <span style={{ color: 'rgba(200,160,100,0.4)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '10px' }}>
            {item.label}:
          </span>{' '}
          <span style={{ color: item.accent ? '#c86858' : '#c8b89a', fontStyle: item.accent ? 'italic' : 'normal' }}>
            {item.value || '—'}
          </span>
        </div>
      ))}

      <div style={{
        marginTop: '10px', paddingTop: '8px',
        borderTop: '1px solid rgba(200,160,100,0.06)',
        display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      }}>
        {structure.skill_level && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '9px',
              textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(200,160,100,0.3)',
            }}>Level:</span>
            <span style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '10px',
              color: '#c89868', background: 'rgba(200,160,100,0.06)',
              padding: '2px 8px', borderRadius: '3px',
            }}>
              {structure.skill_level}
            </span>
          </div>
        )}
        {structure.draft_stage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '9px',
              textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(200,160,100,0.3)',
            }}>Stage:</span>
            <span style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '10px',
              color: '#c89868', background: 'rgba(200,160,100,0.06)',
              padding: '2px 8px', borderRadius: '3px',
            }}>
              {DRAFT_STAGE_LABEL[structure.draft_stage]}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
