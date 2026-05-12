import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

interface FAQItem {
  question: string
  answer: string
}

interface FAQAccordionProps {
  items: FAQItem[]
}

export default function FAQAccordion({ items }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const open = openIndex === index
        return (
          <article key={item.question} className="hover-lift-card rounded-xl border border-temple-charcoal bg-temple-charcoal/30">
            <button
              type="button"
              className="focus-ring flex w-full items-center justify-between gap-3 rounded-xl px-5 py-4 text-left"
              onClick={() => setOpenIndex(open ? null : index)}
              aria-expanded={open}
            >
              <span className="hover-highlight text-sm font-semibold">{item.question}</span>
              <ChevronDown className={open ? 'rotate-180 text-temple-gold' : 'text-temple-snow/60'} size={18} />
            </button>
            {open ? <p className="px-5 pb-5 text-sm leading-6 text-temple-snow/80">{item.answer}</p> : null}
          </article>
        )
      })}
    </div>
  )
}
