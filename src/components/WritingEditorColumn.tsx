import { useRef, type CSSProperties } from 'react';
import {
  formatScreenplayLine,
  formatScreenplayText,
  getScreenplayElement,
  type ScreenplayElement,
} from '../utils/screenplayFormat';

type CheckIn = { sceneNumber: number; actBreak: boolean };

type Props = {
  draft: string;
  onDraftChange: (value: string) => void;
  checkIn: CheckIn | null;
  onDismissCheckIn: () => void;
  onUseCheckInPrompt: (prompt: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  hasAnalysis: boolean;
};

function getNextInsertion(type: ScreenplayElement): string {
  if (type === 'character' || type === 'parenthetical') {
    return '\n            ';
  }
  if (type === 'scene-heading' || type === 'transition' || type === 'centered') {
    return '\n\n';
  }
  return '\n';
}

export default function WritingEditorColumn({
  draft,
  onDraftChange,
  checkIn,
  onDismissCheckIn,
  onUseCheckInPrompt,
  onAnalyze,
  isAnalyzing,
  hasAnalysis,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const btnBase: CSSProperties = {
    borderRadius: '999px',
    padding: '8px 14px',
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    flexShrink: 0,
    cursor: 'pointer',
  };

  return (
    <div className="fd-editor-column">
      <div className="fd-editor-toolbar">
        <div className="fd-editor-actions">
          <button
            type="button"
            onClick={onAnalyze}
            disabled={isAnalyzing || !draft.trim()}
            style={{
              ...btnBase,
              background:
                !isAnalyzing && draft.trim() ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: !isAnalyzing && draft.trim() ? '#f1f1f1' : 'rgba(255,255,255,0.28)',
              cursor: !isAnalyzing && draft.trim() ? 'pointer' : 'default',
            }}
          >
            {isAnalyzing ? 'Analyzing…' : hasAnalysis ? 'Refresh notes' : 'Analyze draft'}
          </button>
        </div>
      </div>

      <div className="fd-ruler">
        <div className="fd-ruler-labels">
          <span>Script</span>
          <span>IN</span>
        </div>
        <div className="fd-ruler-track" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="fd-ruler-segment">
              <span className="fd-ruler-number">{index + 1}</span>
              <div className="fd-ruler-ticks">
                {Array.from({ length: 10 }, (_, tick) => (
                  <span key={tick} className={tick === 0 ? 'major' : ''} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="fd-editor-stage">
        <div className="fd-page-scroll">
          <div className="fd-page-paper">
            <div className="fd-page-header">
              <span>Draft page</span>
            </div>

            <textarea
              ref={textareaRef}
              className="fd-page-textarea"
              value={draft}
              onChange={(e) => {
                onDraftChange(e.target.value);
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text/plain');
                if (!text) return;
                e.preventDefault();
                const formatted = formatScreenplayText(text);
                const ta = e.currentTarget;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const value = draft;
                const prefix = value.slice(0, start);
                const suffix = value.slice(end);
                const normalizedPrefix = prefix && !prefix.endsWith('\n') ? `${prefix}\n` : prefix;
                const newValue = normalizedPrefix + formatted + suffix;
                onDraftChange(newValue);
                const nextPos = normalizedPrefix.length + formatted.length;
                requestAnimationFrame(() => {
                  ta.focus();
                  ta.selectionStart = ta.selectionEnd = nextPos;
                });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return;
                const el = e.currentTarget;
                const start = el.selectionStart;
                const end = el.selectionEnd;
                if (start !== end) return;

                const value = draft;
                const before = value.slice(0, start);
                const after = value.slice(end);
                const lastNl = before.lastIndexOf('\n');
                const lineStart = lastNl + 1;
                const line = before.slice(lineStart);
                const formattedLine = formatScreenplayLine(line);
                const element = getScreenplayElement(line);
                const insertion = getNextInsertion(element);

                if (formattedLine === line && insertion === '\n') return;

                e.preventDefault();
                const newBefore = before.slice(0, lineStart) + formattedLine + insertion;
                onDraftChange(newBefore + after);
                requestAnimationFrame(() => {
                  el.focus();
                  el.selectionStart = el.selectionEnd = newBefore.length;
                });
              }}
              spellCheck={false}
              placeholder={`OVER BLACK.\n\nSUPER: "2076"\n\nFADE IN:\n\nINT. APARTMENT - NIGHT\n\nA ceiling fan wobbles over unpaid bills.\n\n            MAYA\n      I said I'd finish it.\n\n          (quietly)\n      I just didn't say when.`}
            />
          </div>
        </div>
      </div>

      {checkIn && (
        <div className="fd-checkin">
          <div className="fd-checkin-copy">
            <strong>
              {checkIn.actBreak
                ? `Scene ${checkIn.sceneNumber} landed on an act break.`
                : `Scene ${checkIn.sceneNumber} just opened.`}
            </strong>
            <span>Pause for a structural note, or keep writing and come back later.</span>
          </div>
          <div className="fd-checkin-actions">
            <button
              type="button"
              onClick={() => {
                const prompt = checkIn.actBreak
                  ? `[Act break check-in — I'm at scene ${checkIn.sceneNumber}. Before I draft the next movement:] `
                  : `[Scene check-in — I just opened scene ${checkIn.sceneNumber}. Before I continue:] `;
                onUseCheckInPrompt(prompt);
                onDismissCheckIn();
              }}
              style={{
                ...btnBase,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.16)',
                color: '#f2f2f2',
              }}
            >
              Ask instructor
            </button>
            <button
              type="button"
              onClick={onDismissCheckIn}
              style={{
                ...btnBase,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              Keep writing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
