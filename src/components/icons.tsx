import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'home'
  | 'history'
  | 'stats'
  | 'exercises'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'more'
  | 'trash'
  | 'edit'
  | 'settings'
  | 'search'
  | 'repeat'
  | 'scale'
  | 'arrowUp'
  | 'arrowDown'
  | 'export'
  | 'import'
  | 'clock'
  | 'play'
  | 'flag';

const P: Record<IconName, ReactNode> = {
  home: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  history: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01" strokeWidth="2.4" />
    </>
  ),
  stats: (
    <>
      <path d="M4 20.5h16" />
      <rect x="5" y="11" width="3.2" height="6.5" rx="1.2" />
      <rect x="10.4" y="5" width="3.2" height="12.5" rx="1.2" />
      <rect x="15.8" y="8.5" width="3.2" height="9" rx="1.2" />
    </>
  ),
  exercises: (
    <>
      <path d="M7.5 12h9" />
      <rect x="4.5" y="7" width="3" height="10" rx="1.3" />
      <rect x="16.5" y="7" width="3" height="10" rx="1.3" />
      <path d="M2.5 10v4M21.5 10v4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="2.6" />,
  trash: <path d="M4.5 7h15M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M6.5 7l.8 11.7c.1 1 .9 1.8 1.9 1.8h5.6c1 0 1.8-.8 1.9-1.8L17.5 7" />,
  edit: <path d="M14.5 5.5l4 4M4.5 19.5l1-4.2L15.8 5a1.9 1.9 0 0 1 2.7 0l.5.5c.7.7.7 1.9 0 2.7L8.7 18.5z" />,
  settings: (
    <>
      <path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" />
      <circle cx="15" cy="7.5" r="2.2" />
      <circle cx="9" cy="16.5" r="2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  repeat: <path d="M17 3.5l2.5 2.5L17 8.5M19.5 6H9a5 5 0 0 0-5 5v.5M7 20.5L4.5 18 7 15.5M4.5 18H15a5 5 0 0 0 5-5v-.5" />,
  scale: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M8.5 9.5a5 5 0 0 1 7 0M12 9.5l1.4-2" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  export: <path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M5 12.5v5.5c0 1.4 1.1 2.5 2.5 2.5h9c1.4 0 2.5-1.1 2.5-2.5v-5.5" />,
  import: <path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5M5 12.5v5.5c0 1.4 1.1 2.5 2.5 2.5h9c1.4 0 2.5-1.1 2.5-2.5v-5.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  flag: <path d="M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11" />,
};

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 22, strokeWidth = 1.75, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {P[name]}
    </svg>
  );
}
