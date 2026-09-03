export const fadeIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3, ease: "easeOut" },
};

export const slideUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
};

export const staggerContainer = {
  animate: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

export const staggerItem = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export const cardHover = {
  rest: { y: 0, scale: 1 },
  hover: { y: -4, scale: 1.01, transition: { duration: 0.2, ease: "easeOut" } },
};

export const imageZoom = {
  rest: { scale: 1 },
  hover: { scale: 1.08, transition: { duration: 0.4, ease: "easeOut" } },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.2 },
};
