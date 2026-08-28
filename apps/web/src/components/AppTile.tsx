import { initials, isIconUrl } from "../lib/api";

export interface AppInfo {
  id: string;
  name: string;
  title: string;
  image: string;
  state: string;
  running: boolean;
  status: string;
  ports: string;
  icon?: string | null;
  runtime?: string | null;
  gpu?: boolean;
  gpuClient?: string;
  gpuPriority?: number;
}

interface Props {
  app: AppInfo;
  holder?: boolean;
  selectable?: boolean;
  showMeta?: boolean;
  onSelect?: (app: AppInfo) => void;
}

export default function AppTile({ app, holder, selectable, showMeta, onSelect }: Props) {
  const body = (
    <>
      <div class="app-icon">
        {isIconUrl(app.icon) ? (
          <img src={app.icon!} alt="" />
        ) : (
          <span>{initials(app.title || app.name)}</span>
        )}
      </div>
      <div>
        <div class="font-semibold leading-tight">{app.title || app.name}</div>
        <div class="text-xs opacity-50 mt-1 truncate">{app.name}</div>
      </div>
      <div class="mt-auto flex flex-wrap gap-1">
        <span class={app.running ? "zima-pill zima-pill-run" : "zima-pill zima-pill-stop"}>
          {app.running ? "en cours" : "arrete"}
        </span>
        {app.gpu && <span class="zima-pill zima-pill-gpu">GPU</span>}
        {holder && <span class="zima-pill zima-pill-hold">lease</span>}
      </div>
      {showMeta && (
        <div class="text-[11px] opacity-50 leading-snug">
          <div class="truncate">{app.image}</div>
          {app.ports && <div class="truncate mt-0.5">{app.ports}</div>}
        </div>
      )}
    </>
  );

  if (selectable) {
    return (
      <button
        type="button"
        class={`app-tile selectable ${holder ? "holder" : ""}`}
        onClick={() => onSelect?.(app)}
      >
        {body}
      </button>
    );
  }

  return <div class={`app-tile ${holder ? "holder" : ""}`}>{body}</div>;
}
