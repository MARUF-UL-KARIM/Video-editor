import { AnimatePresence, motion } from 'framer-motion';
import { Captions, ChevronDown, Code2, Film, Mic, Palette, SlidersHorizontal, Type, Upload, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ExportDialog } from './components/ExportDialog';
import { Inspector } from './components/Inspector';
import { CaptionsPanel } from './components/panels/CaptionsPanel';
import { LooksPanel, TransitionsPanel } from './components/panels/EffectsPanels';
import { MediaPanel } from './components/panels/MediaPanel';
import { ScriptPanel } from './components/panels/ScriptPanel';
import { TextPanel } from './components/panels/TextPanel';
import { VoicePanel } from './components/panels/VoicePanel';
import { Preview, Transport } from './components/Preview';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { cx } from './components/ui';
import { installApi } from './lib/api';
import { engine } from './lib/engine';
import { importFiles } from './lib/media';
import { initPersistence } from './lib/persist';
import { getState, projectDuration, useStore } from './lib/store';
import type { PanelId } from './types';

const TABS: { id: Exclude<PanelId, null | 'inspector'>; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'captions', label: 'Captions', icon: Captions },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'looks', label: 'Looks', icon: Palette },
  { id: 'transitions', label: 'Transitions', icon: Zap },
  { id: 'script', label: 'Script', icon: Code2 },
];

function useCompact() {
  const q = '(max-width: 860px)';
  const [c, setC] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setC(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return c;
}

function PanelBody({ id, onImport }: { id: PanelId; onImport: () => void }) {
  switch (id) {
    case 'media':
      return <MediaPanel onImport={onImport} />;
    case 'text':
      return <TextPanel />;
    case 'captions':
      return <CaptionsPanel />;
    case 'voice':
      return <VoicePanel />;
    case 'looks':
      return <LooksPanel />;
    case 'transitions':
      return <TransitionsPanel />;
    case 'script':
      return <ScriptPanel />;
    case 'inspector':
      return <Inspector />;
    default:
      return null;
  }
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[90] flex flex-col items-center gap-1.5 px-3">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            role="status"
            className={cx('max-w-[92vw] rounded-xl border px-3.5 py-2 text-[12.5px] shadow-2xl sm:max-w-md', t.kind === 'error' ? 'border-danger/50 bg-[#2a1414] text-[#ffc9c9]' : t.kind === 'ok' ? 'border-ok/40 bg-[#14231a] text-[#c9f3d0]' : 'border-line-strong bg-raised text-fg')}
          >
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || (tag === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes((el as HTMLInputElement).type));
}

export default function App() {
  const compact = useCompact();
  const loaded = useStore((s) => s.loaded);
  const panel = useStore((s) => s.panel);
  const exportOpen = useStore((s) => s.exportOpen);
  const hasSelection = useStore((s) => s.selection.length > 0);
  const [sheet, setSheet] = useState<PanelId>(null);
  const [dragging, setDragging] = useState(false);
  const [tlH, setTlH] = useState(() => Math.round(Math.min(360, Math.max(240, window.innerHeight * 0.36))));
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const onImport = useCallback(() => fileInput.current?.click(), []);

  const takeFiles = useCallback(async (files: FileList | File[]) => {
    const empty = getState().project.clips.length === 0;
    const added = await importFiles([...files], empty);
    if (added.length && !empty) getState().toast(`Imported ${added.length} file${added.length > 1 ? 's' : ''} — tap one in Media to add it`, 'ok');
  }, []);

  useEffect(() => {
    installApi();
    void initPersistence();
    if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const st = getState();
      if (st.exportOpen) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const fps = st.project.fps;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let handled = true;
      if (k === ' ') engine.toggle();
      else if (mod && k === 'z') (e.shiftKey ? st.redo() : st.undo());
      else if (mod && k === 'y') st.redo();
      else if (mod && k === 'b') st.splitAtPlayhead();
      else if (mod && k === 'd') st.duplicateSelected();
      else if (mod && k === 'c') st.copy();
      else if (mod && k === 'v') st.paste();
      else if (mod && k === 'a') st.select(st.project.clips.map((c) => c.id));
      else if (mod && k === 'e') useStore.setState({ exportOpen: true });
      else if (mod) handled = false;
      else if (k === 's') st.splitAtPlayhead();
      else if (k === 'q') st.trimToPlayhead('start');
      else if (k === 'w') st.trimToPlayhead('end');
      else if (k === 'Delete' || k === 'Backspace') st.removeClips(st.selection, e.shiftKey);
      else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        engine.pause();
        const dir = k === 'ArrowLeft' ? -1 : 1;
        engine.seek(e.shiftKey ? st.time + dir : Math.round(st.time * fps + dir) / fps);
      } else if (k === 'Home') engine.seek(0);
      else if (k === 'End') engine.seek(projectDuration(st.project));
      else if (k === '=' || k === '+') st.setZoom(st.zoom * 1.3);
      else if (k === '-' || k === '_') st.setZoom(st.zoom / 1.3);
      else if (k === 'Escape') st.select([]);
      else if (k === '?') window.dispatchEvent(new Event('offcut:shortcuts'));
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = tlH;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setTlH(Math.round(Math.min(window.innerHeight * 0.7, Math.max(150, h0 + (y0 - ev.clientY)))));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const desktopPanel = panel && panel !== 'inspector' ? panel : 'media';

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-ink text-fg"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        dragDepth.current = 0;
        setDragging(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void takeFiles(e.dataTransfer.files);
      }}
    >
      <TopBar compact={compact} />

      {compact ? (
        <>
          <div className="flex min-h-0 flex-[0_0_41%] flex-col">
            <Preview />
            <Transport compact />
          </div>
          <div className="min-h-0 flex-1 border-t border-line">
            <Timeline compact onImport={onImport} />
          </div>
          <nav className="scroll-thin flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-t border-line bg-panel px-1 pb-[env(safe-area-inset-bottom)]" aria-label="Tools">
            <button type="button" onClick={() => setSheet('inspector')} className={cx('relative flex min-w-[58px] flex-1 flex-col items-center gap-0.5 py-2 text-[10px]', hasSelection ? 'text-accent' : 'text-faint')}>
              <SlidersHorizontal size={19} />
              Edit
              {hasSelection && <span className="absolute right-3 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setSheet(t.id)} className="flex min-w-[58px] flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted active:text-fg">
                <t.icon size={19} />
                {t.label}
              </button>
            ))}
          </nav>
          <AnimatePresence>
            {sheet && (
              <motion.div
                key="sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                className="fixed inset-x-0 bottom-0 z-50 flex h-[57dvh] flex-col overflow-hidden rounded-t-2xl border-t border-line-strong bg-panel pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
              >
                <button type="button" aria-label="Close panel" onClick={() => setSheet(null)} className="flex h-7 w-full shrink-0 items-center justify-center text-faint">
                  <ChevronDown size={18} />
                </button>
                <div className="min-h-0 flex-1">
                  <PanelBody id={sheet} onImport={onImport} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <nav className="flex w-[64px] shrink-0 flex-col items-center gap-0.5 border-r border-line bg-panel py-2" aria-label="Tools">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => getState().setPanel(t.id)}
                  className={cx('relative flex w-[54px] flex-col items-center gap-1 rounded-xl py-2 text-[10px] transition-colors', desktopPanel === t.id ? 'bg-hover text-fg' : 'text-muted hover:bg-raised hover:text-fg')}
                >
                  {desktopPanel === t.id && <span className="absolute -left-[5px] top-2.5 h-6 w-[3px] rounded-r bg-accent" />}
                  <t.icon size={18} strokeWidth={desktopPanel === t.id ? 2.2 : 1.8} />
                  {t.label}
                </button>
              ))}
            </nav>
            <aside className="w-[292px] shrink-0 border-r border-line bg-panel xl:w-[320px]">
              <PanelBody id={desktopPanel} onImport={onImport} />
            </aside>
            <main className="flex min-w-0 flex-1 flex-col">
              <Preview />
              <Transport compact={false} />
            </main>
            <aside className="w-[288px] shrink-0 border-l border-line bg-panel xl:w-[316px]">
              <Inspector />
            </aside>
          </div>
          <div className="relative shrink-0 border-t border-line" style={{ height: tlH }}>
            <div onPointerDown={startResize} className="absolute inset-x-0 -top-1 z-30 h-2 cursor-row-resize hover:bg-accent/40" style={{ touchAction: 'none' }} aria-hidden />
            <Timeline compact={false} onImport={onImport} />
          </div>
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="video/*,audio/*,image/*,.mkv,.mov,.m4a,.flac"
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = '';
          if (files.length) void takeFiles(files);
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent px-12 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-ink">
              <Upload size={26} />
            </span>
            <span className="text-[18px] font-semibold tracking-tight">Drop to import</span>
            <span className="text-[12.5px] text-muted">Files are opened locally — they never leave this device.</span>
          </div>
        </div>
      )}
      {exportOpen && <ExportDialog />}
      <Toasts />
      {!loaded && <div className="fixed inset-0 z-[100] bg-ink" />}
    </div>
  );
}
