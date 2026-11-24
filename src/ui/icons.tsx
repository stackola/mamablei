import type { ReactNode } from 'react';

const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
    {children}
  </svg>
);

export const icons: Record<string, ReactNode> = {
  select: (
    <I>
      <path d="M6 3l12 9-5.5 1L10 19z" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  rect: (
    <I>
      <rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  circle: (
    <I>
      <circle cx="12" cy="12" r="8" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  ellipse: (
    <I>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  triangle: (
    <I>
      <path d="M12 4l8.5 15h-17z" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  hexagon: (
    <I>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  arch: (
    <I>
      <path d="M6 20V11a6 6 0 0 1 12 0v9z" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  halfcircle: (
    <I>
      <path d="M3 16a9 9 0 0 1 18 0z" fill="currentColor" fillOpacity={0.15} />
    </I>
  ),
  polygon: (
    <I>
      <path d="M5 18l2-11 7-3 6 7-4 8z" fill="currentColor" fillOpacity={0.15} />
      <circle cx="5" cy="18" r="1.3" fill="currentColor" />
      <circle cx="7" cy="7" r="1.3" fill="currentColor" />
      <circle cx="14" cy="4" r="1.3" fill="currentColor" />
    </I>
  ),
  line: (
    <I>
      <path d="M4 20L20 4" strokeWidth={3} />
    </I>
  ),
  fill: (
    <I>
      <path d="M5 11l6-6 7 7-6 6z" fill="currentColor" fillOpacity={0.15} />
      <path d="M11 5L8 2" />
      <path d="M19 15c0 0 2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 2-3.5 2-3.5z" fill="currentColor" />
    </I>
  ),
  more: (
    <I>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" />
    </I>
  ),
  alignLeft: (
    <I>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="12" height="4" />
      <rect x="7" y="14" width="7" height="4" />
    </I>
  ),
  alignHCenter: (
    <I>
      <path d="M12 3v18" />
      <rect x="5" y="6" width="14" height="4" />
      <rect x="8" y="14" width="8" height="4" />
    </I>
  ),
  alignRight: (
    <I>
      <path d="M20 3v18" />
      <rect x="5" y="6" width="12" height="4" />
      <rect x="10" y="14" width="7" height="4" />
    </I>
  ),
  alignTop: (
    <I>
      <path d="M3 4h18" />
      <rect x="6" y="7" width="4" height="12" />
      <rect x="14" y="7" width="4" height="7" />
    </I>
  ),
  alignVCenter: (
    <I>
      <path d="M3 12h18" />
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="8" width="4" height="8" />
    </I>
  ),
  alignBottom: (
    <I>
      <path d="M3 20h18" />
      <rect x="6" y="5" width="4" height="12" />
      <rect x="14" y="10" width="4" height="7" />
    </I>
  ),
  packH: (
    <I>
      <rect x="3" y="7" width="5" height="10" />
      <rect x="10" y="7" width="5" height="10" />
      <rect x="17" y="7" width="4" height="10" />
    </I>
  ),
  packV: (
    <I>
      <rect x="7" y="3" width="10" height="5" />
      <rect x="7" y="10" width="10" height="5" />
      <rect x="7" y="17" width="10" height="4" />
    </I>
  ),
  distH: (
    <I>
      <path d="M3 4v16M21 4v16" />
      <rect x="9" y="8" width="6" height="8" />
    </I>
  ),
  distV: (
    <I>
      <path d="M4 3h16M4 21h16" />
      <rect x="8" y="9" width="8" height="6" />
    </I>
  ),
};
