// src/app/embed/layout.tsx
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'transparent' }}>
      <style>{`
        html, body {
          background: transparent !important;
          background-color: transparent !important;
          /* next-themes stamps an inline color-scheme:dark on <html> when the
             visitor's OS is dark. Under a dark color-scheme the browser paints
             the iframe's canvas opaque dark, so transparent bg alone isn't
             enough — the chat window/bubble end up sitting on a black box on
             the host page. Force a neutral scheme so the canvas is see-through.
             An !important author rule outranks next-themes' normal inline style. */
          color-scheme: normal !important;
          margin: 0;
          padding: 0;
        }
      `}</style>
      {children}
    </div>
  );
}
