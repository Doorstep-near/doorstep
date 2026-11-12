import { clsx } from "clsx";
import QRCode from "qrcode";
import { useMemo } from "react";

/** Builds a single SVG path from the QR modules (no innerHTML, no canvas). */
function qrPath(value: string): { size: number; d: string } {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  let d = "";
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (data[y * size + x]) {
        const start = x;
        while (x < size && data[y * size + x]) x++;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      } else x++;
    }
  }
  return { size, d };
}

export interface QrCodeProps {
  value: string;
  /** Accessible description, e.g. "QR code of the deposit address". */
  label: string;
  size?: number;
  className?: string;
}

/** Always dark-on-white (scanners need contrast), even in dark mode. */
export function QrCode({ value, label, size = 200, className }: QrCodeProps) {
  const qr = useMemo(() => qrPath(value), [value]);
  const quiet = 2;
  const box = qr.size + quiet * 2;
  return (
    <div className={clsx("inline-flex rounded-xl bg-white p-3 shadow-card ring-1 ring-black/5", className)}>
      <svg role="img" aria-label={label} width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} shapeRendering="crispEdges">
        <rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
        <path d={qr.d} fill="#0E1726" />
      </svg>
    </div>
  );
}
