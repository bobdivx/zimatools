interface Props {
  pathname?: string;
}

const items = [
  {
    href: "/",
    label: "Accueil",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z" />
      </svg>
    ),
  },
  {
    href: "/gpu",
    label: "GPU",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h4M7 14h2M15 10v4M18 10v4" />
      </svg>
    ),
  },
  {
    href: "/apps",
    label: "Apps",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="4" y="4" width="7" height="7" rx="1.6" />
        <rect x="13" y="4" width="7" height="7" rx="1.6" />
        <rect x="4" y="13" width="7" height="7" rx="1.6" />
        <rect x="13" y="13" width="7" height="7" rx="1.6" />
      </svg>
    ),
  },
  {
    href: "/mcp",
    label: "MCP",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M8 7h8M8 12h8M8 17h5" />
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </svg>
    ),
  },
];

export default function Nav({ pathname = "/" }: Props) {
  return (
    <aside class="zima-sidebar">
      <a href="/" class="zima-logo">
        <span class="zima-logo-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 3 20 8v8l-8 5-8-5V8l8-5Z" stroke="#fff" stroke-width="1.7" />
            <circle cx="12" cy="12" r="2.4" fill="#fff" />
          </svg>
        </span>
        ZimaTools
      </a>
      <nav class="zima-nav">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <a href={item.href} class={active ? "active" : ""}>
              {item.icon}
              {item.label}
            </a>
          );
        })}
      </nav>
      <div class="zima-sidebar-foot">ZimaOS / IceWhale · dashboard NAS</div>
    </aside>
  );
}
