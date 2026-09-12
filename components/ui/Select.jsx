"use client";

import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.js";

function extractOptions(children) {
  return Children.toArray(children)
    .filter((c) => isValidElement(c) && c.type === "option")
    .map((c) => ({
      value: String(c.props.value ?? (typeof c.props.children === "string" ? c.props.children : "")),
      label: c.props.children,
      disabled: !!c.props.disabled,
    }));
}

const PANEL_MAX_HEIGHT = 240;

/**
 * Custom-styled, single-select replacement for a native <select>. A native
 * select's OPEN options popup is rendered by the OS/browser chrome — CSS
 * can only reach it in a narrow, cross-browser-inconsistent way (see
 * app/globals.css's color-scheme/option{} rules, kept as a belt-and-
 * suspenders fallback for anything unexpected here), which is why the
 * popup kept showing up unstyled with a plain default scrollbar regardless
 * of the app's own theme. This renders its own listbox instead — portaled
 * to document.body so it's never clipped by a modal's or table's own
 * overflow:hidden/auto container, sized to the app's real design tokens,
 * and using the app's own themed-scrollbar utility for long lists.
 *
 * Keeps a real, visually-hidden native <select> underneath as the actual
 * form control: react-hook-form's register() (used throughout this app's
 * forms) attaches to a real DOM node's ref/value/change event, and this
 * preserves that without any call site needing to change — every existing
 * `<Select {...register("field")}><option>...</option></Select>` and
 * `<Select value={x} onChange={handler}>...</Select>` usage keeps working
 * exactly as before. Single-select only (no call site in this app passes
 * `multiple`).
 */
const Select = forwardRef(function Select(
  {
    className,
    error,
    label,
    hint,
    children,
    value,
    defaultValue,
    onChange,
    onBlur,
    name,
    disabled,
    id,
    "aria-label": ariaLabelProp,
    ...rest
  },
  forwardedRef,
) {
  const options = useMemo(() => extractOptions(children), [children]);
  const generatedId = useId();
  const triggerId = id || generatedId;
  const errorId = error ? `${triggerId}-error` : undefined;
  const hintId = hint && !error ? `${triggerId}-hint` : undefined;

  const hiddenRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const isControlled = value !== undefined;

  const [uncontrolledValue, setUncontrolledValue] = useState(
    () => String(value ?? defaultValue ?? options[0]?.value ?? ""),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelStyle, setPanelStyle] = useState(null);

  const currentValue = isControlled ? String(value) : uncontrolledValue;
  const selectedIndex = options.findIndex((o) => o.value === currentValue);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const setRefs = (node) => {
    hiddenRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  // Uncontrolled (register()) usage — the hidden native select is the real
  // source of truth (react-hook-form sets its .value directly via the ref
  // for defaultValues/reset/setValue), so mirror it rather than keeping a
  // second, possibly-stale copy. useLayoutEffect so this resolves before
  // paint — no flash of the wrong placeholder on mount.
  useLayoutEffect(() => {
    if (isControlled) return;
    const el = hiddenRef.current;
    if (!el) return;
    setUncontrolledValue(el.value);
    const onNativeChange = () => setUncontrolledValue(el.value);
    el.addEventListener("change", onNativeChange);
    return () => el.removeEventListener("change", onNativeChange);
  }, [isControlled]);

  const updatePanelStyle = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < PANEL_MAX_HEIGHT && rect.top > spaceBelow;
    setPanelStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      maxHeight: PANEL_MAX_HEIGHT,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  };

  const openPanel = () => {
    if (disabled || options.length === 0) return;
    updatePanelStyle();
    setActiveIndex(Math.max(selectedIndex, 0));
    setOpen(true);
  };

  const closePanel = () => setOpen(false);

  const commit = (opt) => {
    if (!opt || opt.disabled) return;
    const el = hiddenRef.current;
    if (el && el.value !== opt.value) {
      // The standard way to programmatically drive a native form element
      // from custom UI so both React's onChange (a directly-passed prop)
      // and react-hook-form's register()-attached listener see it: set
      // the value through the native setter (React's own instrumented
      // setter on a controlled element would otherwise swallow this),
      // then dispatch a real "change" event, which bubbles to whatever
      // listener is attached, exactly as a real user interaction would.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      ).set;
      nativeSetter.call(el, opt.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closePanel();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePanelStyle();
    const onDocPointerDown = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      closePanel();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        closePanel();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const moveActive = (delta) => {
    if (options.length === 0) return;
    setActiveIndex((i) => {
      let next = i;
      for (let step = 0; step < options.length; step++) {
        next = (next + delta + options.length) % options.length;
        if (!options[next].disabled) return next;
      }
      return i;
    });
  };

  const onTriggerKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = options.findIndex((o) => !o.disabled);
      if (first >= 0) setActiveIndex(first);
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].disabled) {
          setActiveIndex(i);
          break;
        }
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(options[activeIndex]);
    } else if (e.key === "Tab") {
      closePanel();
    }
  };

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label htmlFor={triggerId} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      )}

      {/* Real, visually-hidden native <select> — the actual form control;
          register()/ref/value/onChange all attach here. Never shown. */}
      <select
        ref={setRefs}
        name={name}
        value={isControlled ? value : undefined}
        defaultValue={isControlled ? undefined : defaultValue}
        onChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        {...rest}
      >
        {children}
      </select>

      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabelProp}
        aria-describedby={errorId || hintId || undefined}
        onClick={(e) => {
          // A real, trusted Enter/Space keypress on a focused <button>
          // fires its own native "activate" click right after the keydown
          // — a MouseEvent with detail === 0 (a real mouse click always has
          // detail >= 1). onTriggerKeyDown below already fully handles
          // Enter/Space (open the panel, or commit the highlighted
          // option), so this click is a second, redundant firing of the
          // same interaction; without this guard it re-toggled the panel
          // right after keydown had just committed a selection and closed
          // it, making Enter look like it did nothing.
          if (e.detail === 0) return;
          open ? closePanel() : openPanel();
        }}
        onKeyDown={onTriggerKeyDown}
        onBlur={onBlur}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-line bg-elev px-3 text-left text-sm text-ink transition-colors hover:border-ink/40 focus-ring disabled:opacity-50",
          error && "border-danger",
        )}
      >
        <span className="truncate">{selectedOption?.label ?? ""}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("h-4 w-4 flex-none text-stone transition-transform", open && "rotate-180")}
        />
      </button>

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-stone">{hint}</p>}

      {open &&
        panelStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={panelRef}
            role="listbox"
            aria-labelledby={triggerId}
            style={panelStyle}
            className="themed-scrollbar z-[300] overflow-y-auto rounded-lg border border-line bg-elev py-1 shadow-soft"
          >
            {options.map((opt, i) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === currentValue}
                aria-disabled={opt.disabled || undefined}
                onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
                onClick={() => commit(opt)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm",
                  opt.disabled && "cursor-not-allowed text-stone/50",
                  !opt.disabled && i === activeIndex && "bg-accent/10 text-accent",
                  !opt.disabled && i !== activeIndex && "text-ink",
                  opt.value === currentValue && "font-medium",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === currentValue && <Check aria-hidden="true" className="h-3.5 w-3.5 flex-none" />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
});
Select.displayName = "Select";
export default Select;
