// src/components/landing/ProblemSolution.tsx
'use client';

import { motion } from 'motion/react';
import { GitBranch, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react';

// Every entry here is a real, documented fix (docs/STORY.md is the internal
// source of truth) — genuine product behavior, described for visitors, not
// implementation detail. Deliberately no file paths or repo references here:
// this reads as a real product's site, not an open portfolio demo.
const CASES = [
  {
    icon: Sparkles,
    problem: '"AI services?" got pitched blockchain tools.',
    cause: 'Two unrelated offerings shared a keyword, so the model treated them as equally relevant.',
    fix: 'A relevance gate drops anything that trails the best match by too much, plus a direct-match-first rule, so it stops making keyword-only pitches.',
  },
  {
    icon: MessagesSquare,
    problem: '"How much is it?" → "I don\'t have that information."',
    cause: 'Follow-up questions were searched word-for-word, so a question like "it" found nothing.',
    fix: 'A follow-up that comes back weak gets rewritten into a standalone question using the conversation so far, then searched again, once.',
  },
  {
    icon: GitBranch,
    problem: 'The lead form popped up on message one, asking for a name it was just given.',
    cause: 'The form fired on any keyword, ignoring what the visitor had already volunteered.',
    fix: 'Contact details typed in conversation are captured silently; the form appears only after a qualifying exchange, and only if there\'s still no way to reach them.',
  },
  {
    icon: ShieldCheck,
    problem: 'One customer could ever see another customer\'s data.',
    cause: 'A real risk with any multi-tenant product if ownership isn\'t checked on every request.',
    fix: 'Every request is checked against the caller\'s own account, with tests that specifically try to access another tenant\'s data and confirm they fail.',
  },
];

export function ProblemSolution() {
  return (
    <section id="problem" className="py-28 px-6">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          className="max-w-2xl mb-16"
        >
          <p className="text-sm font-semibold text-primary mb-3">Built from real conversations</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Chat widgets break in specific, boring ways. Here&apos;s what we fixed.
          </h2>
          <p className="mt-4 text-muted-foreground">
            These are four real failures we hit and fixed, not hypotheticals. Each one still shapes
            how the product behaves today.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-5">
          {CASES.map((c, i) => (
            <motion.div
              key={c.problem}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.08 }}
              className="rounded-2xl border border-border bg-card p-6"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                <c.icon className="h-4.5 w-4.5" />
              </span>
              <p className="font-semibold leading-snug">{c.problem}</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{c.cause}</p>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm leading-relaxed">
                  <span className="font-medium text-primary">Fix: </span>
                  {c.fix}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
