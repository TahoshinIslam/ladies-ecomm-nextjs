export default function ManIcon({ className = "", ...props }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <filter id="man-icon-invert">
          <feColorMatrix
            type="matrix"
            values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
          />
        </filter>
        <mask id="man-icon-mask">
          <image
            href="/images/man-icon.webp"
            width="100"
            height="100"
            preserveAspectRatio="xMidYMid meet"
            filter="url(#man-icon-invert)"
          />
        </mask>
      </defs>
      <rect width="100" height="100" fill="currentColor" mask="url(#man-icon-mask)" />
    </svg>
  );
}
