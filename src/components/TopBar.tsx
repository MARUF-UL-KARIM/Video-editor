import { CloudOff, Download, FilePlus2, FolderOpen, HardDriveDownload, Keyboard, Lock, MoreHorizontal, Redo2, Save, ShieldCheck, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { restoreMedia } from '../lib/media';
import { sanitizeProject } from '../lib/persist';
import { getState, useStore } from '../lib/store';
import { downloadBlob } from '../lib/util';
import { Btn, cx, IconBtn, Progress } from './ui';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#ff6a3d" />
      <path d="M9 8h8.5L23 13.5V24H9z" fill="#1c0c05" />
      <path d="M17.5 8v5.5H23" fill="none" stroke="#ff6a3d" strokeWidth="1.6" />
      <path d="M13 15.2v5.6l4.8-2.8z" fill="#ff6a3d" />
    </svg>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className="oc-rise flex max-h-[88dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-3xl border border-line-strong bg-panel shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg">
            <X size={17} />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['S  or  Ctrl+B', 'Split at playhead'],
  ['Q / W', 'Trim clip start / end to playhead'],
  ['Delete', 'Delete selection'],
  ['Shift+Delete', 'Ripple delete (close the gap)'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste clips'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['← / →', 'Step one frame (Shift: one second)'],
  ['Home / End', 'Jump to start / end'],
  ['+ / −', 'Zoom timeline'],
  ['Ctrl+Scroll', 'Zoom timeline at cursor'],
  ['Ctrl+A / Esc', 'Select all / deselect'],
  ['Ctrl+E', 'Export'],
];

/** Pull every bundled engine file (background-removal model, WASM runtimes, lazy chunks) into the offline cache. */
async function makeOffline() {
  const st = getState();
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    st.toast('Offline cache is not active yet — reload the page once and try again', 'error');
    return;
  }
  try {
    const list: { heavy: { url: string; size: number }[] } = await (await fetch('/precache.json', { cache: 'no-store' })).json();
    const total = list.heavy.reduce((m, f) => m + f.size, 0) || 1;
    let done = 0;
    for (const f of list.heavy) {
      getState().setJob('offline', `Saving for offline use (${Math.round(total / 1e6)} MB)`, done / total);
      const res = await fetch(f.url);
      await res.arrayBuffer();
      done += f.size;
    }
    getState().toast('Editor, background removal and audio tools are now available offline', 'ok');
  } catch {
    getState().toast('Could not finish saving for offline use — check your connection', 'error');
  } finally {
    getState().clearJob('offline');
  }
}

let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as typeof installPrompt;
  });
}

export function TopBar({ compact }: { compact: boolean }) {
  const name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const job = useStore((s) => s.jobs[0]);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<'keys' | 'about' | null>(null);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', up);
    const keys = () => setModal('keys');
    window.addEventListener('offcut:shortcuts', keys);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', up);
      window.removeEventListener('offcut:shortcuts', keys);
    };
  }, []);

  const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] hover:bg-hover';
  return (
    <header className="relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
      <div className="flex items-center gap-2 pr-1">
        <Logo />
        {!compact && <span className="font-display text-[15px] tracking-tight">Offcut</span>}
      </div>
      <input
        value={name}
        aria-label="Project name"
        onChange={(e) => getState().patchProject({ name: e.target.value })}
        className={cx('h-8 min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[13px] text-fg hover:border-line focus:border-accent focus:outline-none', compact ? 'w-28 flex-1' : 'w-52')}
      />
      <div className="flex min-w-0 flex-1 items-center justify-center">
        {job ? (
          <div className="flex min-w-0 max-w-[280px] flex-1 flex-col gap-1">
            <span className="truncate text-center text-[11px] text-muted">
              {job.label}
              {job.progress !== null ? ` ${Math.round(job.progress * 100)}%` : ''}
            </span>
            <Progress value={job.progress} />
          </div>
        ) : (
          !compact && (
            <button type="button" onClick={() => setModal('about')} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted hover:border-line-strong hover:text-fg">
              <Lock size={11} className="text-ok" />
              {online ? 'On-device · autosaved locally' : 'Offline · everything still works'}
            </button>
          )
        )}
      </div>
      <IconBtn label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => getState().undo()}>
        <Undo2 size={16} />
      </IconBtn>
      <IconBtn label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => getState().redo()}>
        <Redo2 size={16} />
      </IconBtn>
      <div className="relative">
        <IconBtn label="Project menu" active={menu} onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={17} />
        </IconBtn>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-line-strong bg-raised py-1 shadow-2xl" onClick={() => setMenu(false)}>
              <button
                type="button"
                className={item}
                onClick={() => {
                  if (!getState().project.clips.length || confirm('Start a new project? The current timeline will be cleared.')) getState().newProject();
                }}
              >
                <FilePlus2 size={14} className="text-muted" /> New project
              </button>
              <button type="button" className={item} onClick={() => downloadBlob(new Blob([JSON.stringify(getState().project)], { type: 'application/json' }), `${getState().project.name || 'project'}.offcut.json`)}>
                <Save size={14} className="text-muted" /> Save project file…
              </button>
              <button type="button" className={item} onClick={() => file.current?.click()}>
                <FolderOpen size={14} className="text-muted" /> Open project file…
              </button>
              <div className="my-1 h-px bg-line" />
              <button type="button" className={item} onClick={() => setModal('keys')}>
                <Keyboard size={14} className="text-muted" /> Keyboard shortcuts
              </button>
              {installPrompt && (
                <button type="button" className={item} onClick={() => installPrompt?.prompt()}>
                  <HardDriveDownload size={14} className="text-muted" /> Install as app
                </button>
              )}
              <button type="button" className={item} onClick={() => void makeOffline()}>
                <CloudOff size={14} className="text-muted" /> Make available offline
              </button>
              <button type="button" className={item} onClick={() => setModal('about')}>
                <ShieldCheck size={14} className="text-muted" /> Privacy & how it works
              </button>
            </div>
          </>
        )}
      </div>
      <Btn variant="primary" className="ml-0.5" onClick={() => useStore.setState({ exportOpen: true })}>
        <Download size={15} /> Export
      </Btn>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const p = sanitizeProject(JSON.parse(await f.text()));
            if (!Array.isArray(p.tracks) || !Array.isArray(p.clips)) throw new Error('bad file');
            getState().loadProject(p);
            await restoreMedia(p, false);
            getState().toast('Project opened. Re-import any clips marked offline to relink them.', 'ok');
          } catch {
            getState().toast('That file is not an Offcut project', 'error');
          }
        }}
      />

      {modal === 'keys' && (
        <Modal title="Keyboard shortcuts" onClose={() => setModal(null)}>
          <div className="divide-y divide-line">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2">
                <span className="text-[12.5px] text-muted">{d}</span>
                <kbd className="shrink-0 rounded-md border border-line-strong bg-ink px-2 py-0.5 font-mono text-[11px] text-fg">{k}</kbd>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'about' && (
        <Modal title="Private by construction" onClose={() => setModal(null)}>
          <div className="space-y-3 text-[12.5px] leading-relaxed text-muted">
            <p>
              Offcut is a static web app. There is no server behind it, no account and no analytics. Your clips are opened with the browser’s file APIs, decoded and encoded by your own device (WebCodecs + WebGL), and the project is autosaved to this browser’s IndexedDB.
            </p>
            <ul className="space-y-2">
              {[
                ['Editing, effects, export', 'Work offline after your first visit. Install it from your browser menu to use it like a desktop or phone app.'],
                ['Background removal', 'A segmentation model that ships with the app itself — no third-party download. It is cached the first time you use it, or right away via “Make available offline”.'],
                ['Noise reduction & voice clean-up', 'Computed locally with Web Audio and a spectral gate.'],
                ['Auto captions & text to speech', 'Open models (Whisper, Kokoro). The model files are fetched once from Hugging Face, cached, then run offline. Your audio and scripts are never sent.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-2.5">
                  <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" />
                  <span>
                    <span className="block font-medium text-fg">{t}</span>
                    {d}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-faint">Clearing this site’s data in your browser deletes the autosaved project and cached models. Keep your original files, and use “Save project file” for a portable copy of the timeline.</p>
          </div>
        </Modal>
      )}
    </header>
  );
}
