const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>,
  ext: <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />,
  up: <path d="M7 17L17 7M9 7h8v8" />,
  down: <path d="M7 7l10 10M17 9v8H9" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  home: <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  wallet: <><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M16 12.5h2M3.5 9.5h17" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  chev: <path d="M9 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-3.5M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14.5 3.5M20 19v-4h-4" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, color = "currentColor", strokeWidth = 1.75 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      {PATHS[name]}
    </svg>
  );
}

const HELM_VENTS: [number, number][] = [[38, 38], [42, 38], [38, 43], [42, 43], [38, 48]];

/**
 * Great-helm mark: a knight's closed helm seen head-on, the neon visor slit is the one "watching" detail.
 * `ground` is the colour behind the mark; the centre ridge and vents are cut out in it.
 */
export function Mark({ size = 28, ground = "#0E0C09", title }: { size?: number; ground?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" style={{ flexShrink: 0 }}>
      <path d="M14 18C14 9 22 5 32 5s18 4 18 13v24c0 9-8 14-18 17-10-3-18-8-18-17Z" fill="#F4F1EA" />
      <rect x="18" y="25" width="28" height="5" rx="2.5" fill="#CCFF00" />
      <rect x="30.5" y="30" width="3" height="22" rx="1.5" fill={ground} />
      {HELM_VENTS.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill={ground} />)}
    </svg>
  );
}
