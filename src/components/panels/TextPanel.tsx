import { Plus } from 'lucide-react';
import { DEFAULT_STYLE, TEXT_PRESETS, type TextPreset } from '../../lib/defaults';
import { getState, useStore } from '../../lib/store';
import { rgba } from '../../lib/util';
import { Btn, PanelHeader } from '../ui';

function addPreset(p: TextPreset | null) {
  const st = getState();
  const k = Math.min(st.project.width, st.project.height) / 1080;
  const style = { ...DEFAULT_STYLE, ...(p?.style ?? {}) };
  style.fontSize = Math.round(style.fontSize * k);
  st.addTextClip({ text: p ? p.sample : 'Your text', name: p?.name ?? 'Text', style, ...(p?.clip ?? {}) });
}

export function TextPanel() {
  useStore((s) => s.project.width);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Text"
        sub="Added at the playhead. Drag it on the preview to place it."
        right={
          <Btn variant="primary" size="sm" onClick={() => addPreset(null)}>
            <Plus size={13} /> Add text
          </Btn>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        <div className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.map((p) => {
            const s = { ...DEFAULT_STYLE, ...p.style };
            const size = Math.max(13, Math.min(26, s.fontSize / 6.2));
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addPreset(p)}
                className="group flex aspect-[4/3] flex-col overflow-hidden rounded-xl bg-[#1f211d] text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--color-accent)]"
              >
                <span className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,#3b4a44,#191b18_70%)] px-2">
                  <span
                    className="max-w-full text-center leading-tight"
                    style={{
                      fontFamily: `"${s.fontFamily}"`,
                      fontWeight: s.weight,
                      fontStyle: s.italic ? 'italic' : 'normal',
                      fontSize: size,
                      color: s.color,
                      letterSpacing: s.letterSpacing / 6,
                      textTransform: s.uppercase ? 'uppercase' : 'none',
                      WebkitTextStroke: s.strokeWidth ? `${Math.max(1, s.strokeWidth / 7)}px ${s.strokeColor}` : undefined,
                      paintOrder: 'stroke fill',
                      background: s.bgOpacity > 0 ? rgba(s.bgColor, s.bgOpacity) : undefined,
                      padding: s.bgOpacity > 0 ? '3px 7px' : undefined,
                      borderRadius: 5,
                      textShadow: s.shadowBlur || s.shadowY ? `0 ${s.shadowY / 4}px ${s.shadowBlur / 3}px ${rgba(s.shadowColor, 0.8)}` : undefined,
                      transform: p.clip?.rotation ? `rotate(${p.clip.rotation}deg)` : undefined,
                    }}
                  >
                    {p.sample}
                  </span>
                </span>
                <span className="flex items-center justify-between px-2 py-1.5 text-[11.5px] text-muted group-hover:text-fg">
                  {p.name}
                  <Plus size={12} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
