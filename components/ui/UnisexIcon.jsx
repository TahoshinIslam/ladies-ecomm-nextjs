export default function UnisexIcon({ className = "", ...props }) {
  return (
    <svg
      viewBox="0 0 240 160"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <filter id="unisex-invert">
          <feColorMatrix
            type="matrix"
            values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
          />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0 0 0 1 1" />
            <feFuncG type="discrete" tableValues="0 0 0 1 1" />
            <feFuncB type="discrete" tableValues="0 0 0 1 1" />
          </feComponentTransfer>
        </filter>
        <mask id="unisex-man-mask">
          <image
            href="/images/man-icon.webp"
            width="160"
            height="160"
            preserveAspectRatio="xMidYMid meet"
            transform="translate(115,0) scale(-1,1)"
            filter="url(#unisex-invert)"
          />
        </mask>
        <mask id="unisex-woman-mask">
          <image
            href="/images/img2.webp"
            x="130"
            width="160"
            height="160"
            preserveAspectRatio="xMidYMid meet"
            filter="url(#unisex-invert)"
          />
        </mask>
      </defs>
      <rect x="-40" width="180" height="160" fill="currentColor" mask="url(#unisex-man-mask)" />
      <rect x="130" width="180" height="160" fill="currentColor" mask="url(#unisex-woman-mask)" />
    </svg>
  );
}
