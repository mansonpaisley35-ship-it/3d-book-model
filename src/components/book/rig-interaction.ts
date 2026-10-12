/** Input and default endpaper artwork ported from the supplied reference. */
export function sideFor(name: string, s: number, N: number, dirHint: 1 | -1): 1 | -1 | 0 {
  if (name === "leafFront" || name === "leafBack") return dirHint;
  if (s >= N - 0.5) return -1;
  if (s <= -0.5) return 1;
  if (name === "textBlock" || name === "rightPage") return 1;
  if (name === "textBlockLeft" || name === "leftPage") return -1;
  if (name === "frontBoard" || name === "pastedownFront") return -1;
  if (name === "backBoard" || name === "pastedownBack") return 1;
  return 0;
}

export function drawEndpaper(g: CanvasRenderingContext2D, variant: string, ink = "#17142c") {
  g.fillStyle = ink;
  g.fillRect(0, 0, 480, 680);
  let sd = 12345 + variant.length * 77;
  const rn = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + rn() * 0.05})`;
    g.fillRect(rn() * 480, rn() * 680, 1.5, 1.5);
  }
  const ring = (x: number, y: number, r: number) => {
    g.lineWidth = Math.max(2, r * 0.07);
    for (const [rr, a] of [[r, 0.9], [r * 0.72, 0.55], [r * 0.4, 0.35]]) {
      if (rr === undefined || a === undefined) continue;
      g.strokeStyle = `rgba(205,210,225,${a})`;
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = "rgba(205,210,225,0.5)";
    g.beginPath(); g.arc(x, y, r * 0.12, 0, Math.PI * 2); g.fill();
  };
  if (variant === "fr" || variant === "bl") ring(240, 330, 130);
  else if (variant === "fl") ring(110, 120, 38);
  else if (variant === "br") ring(370, 120, 38);
}