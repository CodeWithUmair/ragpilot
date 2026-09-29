// src/components/landing/LiveDemo.tsx
'use client';

import { motion } from 'motion/react';
import { MessageCircleQuestion } from 'lucide-react';

export function LiveDemo({ demoAvailable }: { demoAvailable: boolean }) {
  return (
    <section id="try-it" className="py-28 px-6">
      <div className="mx-auto max-w-2xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-6">
            <MessageCircleQuestion className="h-5 w-5" />
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            This isn&apos;t a mockup — it&apos;s the real widget.
          </h2>
          {demoAvailable ? (
            <p className="mt-4 text-muted-foreground text-lg">
              The chat bubble in the bottom-right corner is a live, rate-limited RagPilot instance
              trained on this project&apos;s own docs. Ask it something — it&apos;ll cite where the
              answer came from, same as it would on your site.
            </p>
          ) : (
            <p className="mt-4 text-muted-foreground text-lg">
              The public demo bot is being trained right now — in the meantime, sign up and point
              RagPilot at your own site to see the same thing on your own content.
            </p>
          )}
        </motion.div>

        {demoAvailable && (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-10 flex justify-end"
          >
            <motion.div
              animate={{ x: [0, 8, 0], y: [0, 8, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="text-sm text-muted-foreground font-medium mr-2"
            >
              ↘ down here
            </motion.div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
