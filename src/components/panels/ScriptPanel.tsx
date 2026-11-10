import { Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { API_DOCS, REMOTE_KEY } from '../../lib/api';
import { Btn, cx, Note, PanelHeader, Section, Toggle } from '../ui';

const EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'Title card',
    code: `// Add an animated title at the start
const id = offcut.addText({
  text: 'HOW TO EDIT FASTER',
  start: 0, duration: 2.5, y: -0.1,
  animIn: 'pop',
  style: { fontFamily: 'Anton', weight: 400, fontSize: 150, uppercase: true, strokeWidth: 10 },
});
offcut.setKeyframe(id, 'scale', 0, 1);
offcut.setKeyframe(id, 'scale', 2.5, 1.15);
return id;`,
  },
  {
    name: 'Jump cuts',
    code: `// Split the timeline every 2 seconds
const { duration } = offcut.getState();
for (let t = 2; t < duration; t += 2) offcut.split(t);
return offcut.getProject().clips.length + ' clips';`,
  },
  {
    name: 'Punch-in zooms',
    code: `// Alternate a 115% punch-in on every other video clip
const clips = offcut.getProject().clips
  .filter(c => c.type === 'video')
  .sort((a, b) => a.start - b.start);
clips.forEach((c, i) => offcut.update(c.id, { scale: i % 2 ? 1.15 : 1, fit: 'cover' }));
return clips.length + ' clips updated';`,
  },
  {
    name: 'Dissolve all cuts',
    code: `const p = offcut.getProject();
const vids = p.clips.filter(c => c.type === 'video' || c.type === 'image');
for (const c of vids) {
  const touching = vids.some(o => o.trackId === c.trackId && Math.abs(o.start + o.duration - c.start) < 0.05);
  if (touching) offcut.setTransition(c.id, 'crossfade', 0.4);
}`,
  },
  {
    name: 'Export',
    code: `// Render 1080p and download it
const out = await offcut.export({ resolution: 1080, quality: 'high', download: true });
return \`\${out.width}×\${out.height} \${out.videoCodec} in \${out.seconds.toFixed(1)}s\`;`,
  },
];

export function ScriptPanel() {
  const [code, setCode] = useState(EXAMPLES[0].code);
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState(() => localStorage.getItem(REMOTE_KEY) === '1');

  const run = async () => {
    setBusy(true);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (o: unknown) => Promise<unknown>;
      const result = await new AsyncFunction('offcut', code)(window.offcut);
      let text = 'undefined';
      if (result !== undefined) {
        try {
          text = typeof result === 'string' ? result : JSON.stringify(result, (_k, v) => (v instanceof Blob ? `[Blob ${v.size} bytes]` : v), 2);
        } catch {
          text = String(result);
        }
      }
      setLog((l) => [...l.slice(-30), { ok: true, text: text.length > 4000 ? text.slice(0, 4000) + '…' : text }]);
    } catch (e) {
      setLog((l) => [...l.slice(-30), { ok: false, text: String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Script" sub="Drive the editor with code — from here, the devtools console, or another app." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <Section title="Console">
          <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {EXAMPLES.map((ex) => (
              <button key={ex.name} type="button" onClick={() => setCode(ex.code)} className={cx('shrink-0 rounded-lg px-2.5 py-1 text-[11.5px]', code === ex.code ? 'bg-accent text-accent-ink' : 'bg-ink text-muted hover:text-fg')}>
                {ex.name}
              </button>
            ))}
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            rows={10}
            aria-label="Script"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void run();
              }
            }}
            className="scroll-thin block w-full resize-y whitespace-pre rounded-lg border border-line bg-ink px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-fg focus:border-accent focus:outline-none"
          />
          <div className="flex gap-1.5">
            <Btn variant="primary" className="flex-1" disabled={busy} onClick={run}>
              <Play size={13} fill="currentColor" /> {busy ? 'Running…' : 'Run'} <span className="font-mono text-[10px] opacity-60">⌘↵</span>
            </Btn>
            <Btn variant="ghost" disabled={!log.length} onClick={() => setLog([])} aria-label="Clear output">
              <Trash2 size={13} />
            </Btn>
          </div>
          {log.length > 0 && (
            <div className="scroll-thin max-h-48 space-y-1 overflow-auto rounded-lg bg-ink p-2 font-mono text-[11px] leading-relaxed">
              {log.map((l, i) => (
                <pre key={i} className={cx('whitespace-pre-wrap break-words', l.ok ? 'text-ok' : 'text-danger')}>
                  {l.ok ? '← ' : '✕ '}
                  {l.text}
                </pre>
              ))}
            </div>
          )}
        </Section>
        <Section title="Control from other tools" defaultOpen={false}>
          <Toggle
            label="Allow control from other windows"
            hint="Lets a page that embeds Offcut call the API with postMessage. Off by default; same-origin pages are always allowed."
            value={remote}
            onChange={(v) => {
              setRemote(v);
              localStorage.setItem(REMOTE_KEY, v ? '1' : '0');
            }}
          />
          <pre className="scroll-thin overflow-x-auto rounded-lg bg-ink p-2.5 font-mono text-[10.5px] leading-relaxed text-muted">{`// In a page that embeds Offcut in an <iframe id="ed">
const ed = document.getElementById('ed').contentWindow;
ed.postMessage({ offcut: {
  id: 1, method: 'addText',
  args: [{ text: 'Hello' }]
} }, '*');
onmessage = e => console.log(e.data.offcut);
// → { id: 1, result: 'c_…' }`}</pre>
          <Note>In the browser devtools the same object is available as <span className="font-mono text-fg">window.offcut</span>.</Note>
        </Section>
        <Section title="API reference" defaultOpen={false}>
          <div className="space-y-2">
            {API_DOCS.map((d) => (
              <div key={d.sig}>
                <code className="block break-words font-mono text-[11px] text-fg">{d.sig}</code>
                <span className="text-[11px] leading-snug text-muted">{d.doc}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
