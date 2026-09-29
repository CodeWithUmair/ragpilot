// src/components/landing/ProblemSolution.tsx
'use client';

import { motion } from 'motion/react';
import { GitBranch, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react';

// Every entry here is a real, documented fix from docs/STORY.md — not
// marketing copy. The `code` reference points at the actual file, so a
// technical visitor (or an interviewer) can go verify it.
const CASES = [
  {
    icon: Sparkles,
    problem: '"AI services?" got pitched blockchain tools.',
    cause: 'Chunks sharing a keyword ("services") ranked close together, so the model treated them as equally relevant.',
    fix: 'A relative-score gate drops anything trailing the best match by more than a margin, plus a direct-match-first prompt rule — no more keyword-only pitches.',
    code: 'rag/retrieval.py, rag/prompts.py',
  },
  {
    icon: MessagesSquare,
    problem: '"How much is it?" → "I don\'t have that information."',
    cause: 'Follow-up questions were embedded verbatim, so retrieval searched for "it" and found nothing.',
    fix: 'A LangGraph node rewrites weak follow-ups into a standalone query using the conversation, then retrieves again — bounded to one retry.',
    code: 'rag/graph.py — rewrite → retrieve loop',
  },
  {
    icon: GitBranch,
    problem: 'The lead form popped up on message one, asking for a name it was just given.',
    cause: 'Tangled conditionals fired the form on any keyword, ignoring what the visitor had already volunteered.',
    fix: 'Contact details typed in conversation are captured silently; the form appears only after a qualifying exchange, and only if there\'s still no way to reach them.',
    code: 'rag/graph.py — recall + capture_lead',
  },
  {
    icon: ShieldCheck,
    problem: 'A signed-in user could list, or write into, another tenant\'s knowledge base.',
    cause: 'Two routes were missing ownership checks — found during the port from the original codebase.',
    fix: 'Every chatbot-scoped route checks the caller owns it, with an integration test that tries every cross-tenant access from a second account.',
    code: 'tests/integration/test_api.py::test_tenant_isolation',
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
          <p className="text-sm font-semibold text-primary mb-3">Not a wrapper around a prompt</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Real RAG chatbots break in specific, boring ways. Here&apos;s what broke, and what actually fixed it.
          </h2>
          <p className="mt-4 text-muted-foreground">
            This started as a straight-line pipeline. Real conversations exposed exactly these four
            failures — each one is a genuine bug, not a hypothetical, with the fix still live in the code.
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
                  <span className="font-medium text-primary">Fix — </span>
                  {c.fix}
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">{c.code}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
