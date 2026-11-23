import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets");

function readAsset(name: string): Buffer {
  return fs.readFileSync(path.join(assetsDir, name));
}

export const ICON_512 = readAsset("zimatools-512.png");
export const ICON_192 = readAsset("zimatools-192.png");
export const ICON_180 = readAsset("zimatools-180.png");
export const ICON_SVG = readAsset("zimatools.svg");
export const ICON_ICO = readAsset("favicon.ico");

export function iconsJson(base: string): Array<{ src: string; mimeType: string; sizes: string[] }> {
  return [
    { src: `${base}/icons/zimatools-512.png`, mimeType: "image/png", sizes: ["512x512"] },
    { src: `${base}/icons/zimatools-192.png`, mimeType: "image/png", sizes: ["192x192"] },
    { src: `${base}/icons/zimatools.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
  ];
}
