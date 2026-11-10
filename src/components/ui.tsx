import { ChevronDown } from 'lucide-react';
import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Slider(p: {
  label?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  def?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  left?: ReactNode;
  disabled?: boolean;
}) {
  const pct = ((Math.min(p.max, Math.max(p.min, p.value)) - p.min) / (p.max - p.min)) * 100;
  const changed = p.def !== undefined && Math.abs(p.value - p.def) > 1e-6;
  return (
    <div className={cx('group', p.disabled && 'pointer-events-none opacity-40')}>
      {(p.label !== undefined || p.left) && (
        <div className="flex h-5 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            {p.left}
            <span className="truncate">{p.label}</span>
          </div>
          <button
            type="button"
            title={p.def !== undefined ? 'Reset' : undefined}
            onClick={() => p.def !== undefined && p.onChange(p.def)}
            className={cx('rounded px-1 font-mono text-[11px] tabular-nums', changed ? 'text-fg hover:text-accent' : 'text-faint')}
          >
            {p.format ? p.format(p.value) : Math.round(p.value * 100) / 100}
          </button>
        </div>
      )}
      <input
        type="range"
        className="oc-range block"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={p.value}
        style={{ '--p': `${pct}%` } as CSSProperties}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onDoubleClick={() => p.def !== undefined && p.onChange(p.def)}
        aria-label={typeof p.label === 'string' ? p.label : undefined}
      />
    </div>
  );
}

export function Section(p: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(p.defaultOpen ?? true);
  return (
    <section className="border-b border-line">
      <div className="flex items-center pr-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1.5 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted hover:text-fg">
          <ChevronDown size={13} className={cx('transition-transform', !open && '-rotate-90')} />
          {p.title}
        </button>
        {p.right}
      </div>
      {open && <div className="space-y-2.5 px-3 pb-3.5">{p.children}</div>}
    </section>
  );
}

export function Toggle(p: { label: ReactNode; hint?: ReactNode; value: boolean; onChange: (v: boolean) => void; busy?: boolean; disabled?: boolean }) {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-3 py-0.5', p.disabled && 'pointer-events-none opacity-40')}>
      <span className="min-w-0">
        <span className="block text-[12.5px] text-fg">{p.label}</span>
        {p.hint && <span className="block text-[11px] leading-snug text-faint">{p.hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={p.value}
        onClick={() => p.onChange(!p.value)}
        className={cx('relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors', p.value ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all', p.value ? 'left-[16px]' : 'left-[2px]', p.busy && 'oc-pulse')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>(p: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('flex rounded-lg bg-ink p-0.5', p.className)}>
      {p.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => p.onChange(o.value)}
          className={cx('flex min-h-7 flex-1 items-center justify-center gap-1 rounded-md px-2 text-[12px] transition-colors', p.value === o.value ? 'bg-hover text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>(p: { value: T; onChange: (v: T) => void; children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cx('relative', p.className)}>
      <select
        aria-label={p.label}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value as T)}
        className="h-8 w-full cursor-pointer appearance-none rounded-lg border border-line bg-ink pl-2.5 pr-7 text-[12.5px] text-fg hover:border-line-strong"
      >
        {p.children}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Field(p: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-3', p.className)}>
      <span className="shrink-0 text-[12px] text-muted">{p.label}</span>
      <div className="flex min-w-0 items-center gap-1.5">{p.children}</div>
    </div>
  );
}

export function Color(p: { value: string; onChange: (v: string) => void; label?: string }) {
  return <input type="color" aria-label={p.label ?? 'Colour'} className="oc-color" value={p.value} onChange={(e) => p.onChange(e.target.value)} />;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; active?: boolean };

export function Btn({ variant = 'soft', size = 'md', active, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40',
        size === 'sm' && 'h-7 px-2.5 text-[12px]',
        size === 'md' && 'h-8 px-3 text-[12.5px]',
        size === 'lg' && 'h-10 px-4 text-[13.5px]',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-soft',
        variant === 'soft' && (active ? 'bg-hover text-fg shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'bg-raised text-fg shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-hover'),
        variant === 'ghost' && (active ? 'bg-hover text-accent' : 'text-muted hover:bg-hover hover:text-fg'),
        variant === 'danger' && 'bg-raised text-danger shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-hover',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconBtn({ active, className, children, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent',
        active ? 'bg-hover text-accent' : 'text-muted hover:bg-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cx('h-1 overflow-hidden rounded-full bg-line', className)}>
      {value === null ? <div className="oc-indeterminate h-full w-1/3 rounded-full bg-accent" /> : <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />}
    </div>
  );
}

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('rounded-lg border border-line bg-ink/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted', className)}>{children}</p>;
}

export function PanelHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
        {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
