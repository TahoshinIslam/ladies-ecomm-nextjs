export default function WomanIcon({ className = "", ...props }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <filter id="woman-icon-invert">
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
        <mask id="woman-icon-mask">
          <image
            href="/images/img2.webp"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid meet"
            filter="url(#woman-icon-invert)"
          />
        </mask>
      </defs>
      <rect width="100" height="100" fill="currentColor" mask="url(#woman-icon-mask)" />
    </svg>
  );
}
