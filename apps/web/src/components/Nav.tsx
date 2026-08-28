interface Props {
  pathname?: string;
}

export default function Nav({ pathname = "/" }: Props) {
  const items = [
    { href: "/", label: "Accueil" },
    { href: "/gpu", label: "GPU" },
    { href: "/docker", label: "Docker" },
  ];

  return (
    <div class="navbar bg-base-100 shadow">
      <div class="flex-1">
        <a href="/" class="btn btn-ghost text-xl">
          ZimaTools
        </a>
      </div>
      <div class="flex-none">
        <ul class="menu menu-horizontal px-1">
          {items.map((item) => (
            <li>
              <a href={item.href} class={pathname === item.href ? "active" : ""}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
