export default function KidIcon({ className = "", ...props }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <filter id="kid-icon-invert">
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
        <mask id="kid-icon-mask">
          <image
            href="/images/img.webp"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid meet"
            filter="url(#kid-icon-invert)"
          />
        </mask>
      </defs>
      <rect width="100" height="100" fill="currentColor" mask="url(#kid-icon-mask)" />
    </svg>
  );
}
