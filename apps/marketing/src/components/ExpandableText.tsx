import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

interface ExpandableTextProps {
  /** Shown on the trigger when collapsed */
  collapsedLabel: string
  /** Shown on the trigger when open; defaults to a short hide label */
  expandedLabel?: string
  children: ReactNode
  className?: string
}

export default function ExpandableText({
  collapsedLabel,
  expandedLabel = 'Hide details',
  children,
  className = '',
}: ExpandableTextProps) {
  const reactId = useId()
  const panelId = `expand-panel-${reactId.replace(/:/g, '')}`
  const [open, setOpen] = useState(false)

  return (
    <div className={className}>
      <button
        type="button"
        className="focus-ring flex w-full items-center justify-between gap-3 border-t border-temple-accent/30 bg-temple-accent/5 px-4 py-3.5 text-left transition hover:bg-temple-accent/10 sm:px-5"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-temple-accent underline-offset-2 hover:underline sm:text-[13px]">
          {open ? expandedLabel : collapsedLabel}
        </span>
        <ChevronDown
          className={`shrink-0 text-temple-accent transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          size={20}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-temple-charcoal/70 bg-temple-ink/50 px-4 pb-6 pt-5 sm:px-6">
          {children}
        </div>
      ) : null}
    </div>
  )
}
