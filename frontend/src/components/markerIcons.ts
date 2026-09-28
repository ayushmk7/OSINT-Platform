// Data-driven icon registry: one canvas draw fn per `display.icon` key in the source contract.
//
// Same rules as the hand-tuned legacy glyphs in globeMarkers.ts:
//   * every glyph fits a ~22px optical box on the 32px grid (CX = CY = 16), so no layer
//     out-weighs another;
//   * one 2px line weight for outlines, small solid cores, shape does the talking;
//   * glyphs paint ONLY in the colour they are handed — the rasterizer adds the dark halo;
//   * directional glyphs (plane, helicopter, ship, rocket) point north so they can be rotated.
export type IconDrawFn = (ctx: CanvasRenderingContext2D, color: string) => void;

export const ICON_GRID = 32;
const CX = ICON_GRID / 2;
const CY = ICON_GRID / 2;
export const ICON_STROKE = 2;

function pen(ctx: CanvasRenderingContext2D, color: string, width = ICON_STROKE): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function poly(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, fill = true): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) ctx.fill();
  else ctx.stroke();
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
}

/** A horizontal sine-ish wave from x0 to x1 at height y. */
function wave(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, amp = 2): void {
  const seg = (x1 - x0) / 4;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  for (let i = 0; i < 4; i++) {
    const xa = x0 + seg * i;
    ctx.quadraticCurveTo(xa + seg / 2, y + (i % 2 === 0 ? -amp : amp) * 2, xa + seg, y);
  }
  ctx.stroke();
}

// ---- transport -----------------------------------------------------------------------------

export function drawDot(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  dot(ctx, CX, CY, 5);
}

export function drawPlane(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath(); // fuselage
  ctx.moveTo(CX, 4);
  ctx.quadraticCurveTo(CX + 1.8, 5.5, CX + 1.6, 9);
  ctx.lineTo(CX + 1.4, 22);
  ctx.lineTo(CX, 26);
  ctx.lineTo(CX - 1.4, 22);
  ctx.lineTo(CX - 1.6, 9);
  ctx.quadraticCurveTo(CX - 1.8, 5.5, CX, 4);
  ctx.closePath();
  ctx.fill();
  poly(ctx, [
    [CX, 11],
    [CX + 11, 17.5],
    [CX + 11, 19],
    [CX, 15.5],
    [CX - 11, 19],
    [CX - 11, 17.5]
  ]);
  poly(ctx, [
    [CX, 22],
    [CX + 4.5, 25.5],
    [CX + 4.5, 26.5],
    [CX, 25],
    [CX - 4.5, 26.5],
    [CX - 4.5, 25.5]
  ]);
}

export function drawHelicopter(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath(); // cabin, nose north
  ctx.ellipse(CX, 13, 3.6, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  line(ctx, [
    [CX, 18],
    [CX, 27]
  ]); // tail boom
  line(ctx, [
    [CX - 3, 27],
    [CX + 3, 27]
  ]); // tail rotor
  ctx.lineWidth = 1.5;
  line(ctx, [
    [CX - 10, 5],
    [CX + 10, 21]
  ]); // main rotor
  line(ctx, [
    [CX + 10, 5],
    [CX - 10, 21]
  ]);
}

export function drawShip(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath();
  ctx.moveTo(CX, 5);
  ctx.quadraticCurveTo(CX + 6, 10, CX + 6, 15);
  ctx.lineTo(CX + 6, 26);
  ctx.lineTo(CX - 6, 26);
  ctx.lineTo(CX - 6, 15);
  ctx.quadraticCurveTo(CX - 6, 10, CX, 5);
  ctx.closePath();
  ctx.stroke();
  ctx.fillRect(CX - 2.5, 16, 5, 5);
}

// ---- space ---------------------------------------------------------------------------------

export function drawSatellite(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.fillRect(CX - 3, CY - 3, 6, 6); // bus
  rect(ctx, 4, CY - 4, 7, 8); // solar wings
  rect(ctx, 21, CY - 4, 7, 8);
  ctx.lineWidth = 1.5;
  line(ctx, [
    [11, CY],
    [CX - 3, CY]
  ]);
  line(ctx, [
    [CX + 3, CY],
    [21, CY]
  ]);
  line(ctx, [
    [CX, CY - 3],
    [CX, CY - 8]
  ]); // antenna
  dot(ctx, CX, CY - 9, 1.5);
}

export function drawRocket(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath(); // body, nose north
  ctx.moveTo(CX, 3.5);
  ctx.quadraticCurveTo(CX + 5, 8, CX + 4, 20);
  ctx.lineTo(CX - 4, 20);
  ctx.quadraticCurveTo(CX - 5, 8, CX, 3.5);
  ctx.closePath();
  ctx.stroke();
  dot(ctx, CX, 11, 1.8); // window
  poly(ctx, [
    [CX - 4, 15],
    [CX - 8, 23],
    [CX - 4, 21]
  ]); // fins
  poly(ctx, [
    [CX + 4, 15],
    [CX + 8, 23],
    [CX + 4, 21]
  ]);
  poly(ctx, [
    [CX - 2.5, 22],
    [CX + 2.5, 22],
    [CX, 28]
  ]); // flame
}

export function drawIss(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  line(ctx, [
    [4, CY],
    [28, CY]
  ]); // truss
  for (const x of [5, 10, 19, 24]) {
    ctx.fillRect(x, CY - 9, 3, 7); // four solar arrays
    ctx.fillRect(x, CY + 2, 3, 7);
  }
  ctx.fillRect(CX - 2, CY - 4, 4, 8); // habitable modules
}

// ---- hazards / weather ---------------------------------------------------------------------

export function drawQuake(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color, 1.5);
  ctx.globalAlpha = 0.45;
  ring(ctx, CX, CY, 10);
  ctx.globalAlpha = 0.85;
  ring(ctx, CX, CY, 6);
  ctx.globalAlpha = 1.0;
  dot(ctx, CX, CY, 2.75);
}

export function drawVolcano(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  poly(ctx, [
    [5, 26],
    [12.5, 14],
    [19.5, 14],
    [27, 26]
  ]);
  ctx.lineWidth = 1.75;
  line(ctx, [
    [CX, 11],
    [CX, 5]
  ]); // eruption
  line(ctx, [
    [CX - 3.5, 11.5],
    [CX - 6.5, 6.5]
  ]);
  line(ctx, [
    [CX + 3.5, 11.5],
    [CX + 6.5, 6.5]
  ]);
}

export function drawFire(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath(); // outer flame
  ctx.moveTo(CX, 4);
  ctx.bezierCurveTo(CX + 3, 9, CX + 9, 12, CX + 8, 19);
  ctx.bezierCurveTo(CX + 7.5, 24, CX + 4, 27, CX, 27);
  ctx.bezierCurveTo(CX - 4, 27, CX - 7.5, 24, CX - 8, 19);
  ctx.bezierCurveTo(CX - 8.5, 14, CX - 4, 12, CX - 3, 8);
  ctx.bezierCurveTo(CX - 1, 11, CX - 1, 12, CX, 13);
  ctx.bezierCurveTo(CX + 1, 10, CX + 0.5, 7, CX, 4);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath(); // inner core
  ctx.moveTo(CX, 16);
  ctx.bezierCurveTo(CX + 4, 19, CX + 4, 24, CX, 24.5);
  ctx.bezierCurveTo(CX - 4, 24, CX - 3.5, 20, CX, 16);
  ctx.fill();
}

export function drawStorm(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ring(ctx, CX, CY, 3.5);
  ctx.beginPath(); // two spiral arms
  ctx.arc(CX, CY, 9, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CX, CY, 9, Math.PI * 0.05, Math.PI * 0.6);
  ctx.stroke();
  line(ctx, [
    [CX - 3.5, CY],
    [CX - 9, CY - 1]
  ]);
  line(ctx, [
    [CX + 3.5, CY],
    [CX + 9, CY + 1]
  ]);
}

export function drawLightning(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  poly(ctx, [
    [CX + 3, 3],
    [CX - 7, 18],
    [CX - 0.5, 18],
    [CX - 3, 29],
    [CX + 7.5, 13],
    [CX + 1, 13]
  ]);
}

export function drawFlood(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  wave(ctx, 5, 27, 10, 1.4);
  wave(ctx, 5, 27, 16.5, 1.4);
  wave(ctx, 5, 27, 23, 1.4);
}

export function drawTsunami(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath(); // curling crest
  ctx.moveTo(4, 24);
  ctx.bezierCurveTo(8, 23, 10, 8, 19, 7);
  ctx.bezierCurveTo(25, 6.5, 27.5, 11, 25, 14);
  ctx.bezierCurveTo(23, 16, 19.5, 14, 20.5, 11.5);
  ctx.stroke();
  wave(ctx, 4, 28, 26.5, 1);
}

export function drawRadiation(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  const innerR = 3.2;
  const outerR = 9.5;
  const bladeArc = Math.PI / 3;
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(CX, CY, outerR, angle - bladeArc / 2, angle + bladeArc / 2);
    ctx.arc(CX, CY, innerR, angle + bladeArc / 2, angle - bladeArc / 2, true);
    ctx.closePath();
    ctx.fill();
  }
  dot(ctx, CX, CY, 1.8);
}

export function drawNuclear(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color, 1.6);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); // three electron orbits
    ctx.ellipse(CX, CY, 11, 4.2, (i * Math.PI) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  dot(ctx, CX, CY, 2.4);
}

export function drawBiohazard(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    ring(ctx, CX + Math.cos(a) * 5.5, CY + Math.sin(a) * 5.5, 5);
  }
  dot(ctx, CX, CY, 2);
}

// ---- infrastructure ------------------------------------------------------------------------

export function drawFactory(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  poly(ctx, [
    [5, 26],
    [5, 14],
    [11, 18],
    [11, 14],
    [17, 18],
    [17, 14],
    [21, 16.5],
    [21, 6],
    [25, 6],
    [25, 26]
  ]);
}

export function drawPower(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color, 1.75);
  // transmission pylon: tapered lattice with two cross-arms
  line(ctx, [
    [CX - 7, 28],
    [CX - 1.5, 4],
    [CX + 1.5, 4],
    [CX + 7, 28]
  ]);
  line(ctx, [
    [CX - 9, 9],
    [CX + 9, 9]
  ]);
  line(ctx, [
    [CX - 7, 15],
    [CX + 7, 15]
  ]);
  line(ctx, [
    [CX - 4.5, 17.5],
    [CX + 5.5, 27]
  ]);
  line(ctx, [
    [CX + 4.5, 17.5],
    [CX - 5.5, 27]
  ]);
}

export function drawCable(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath(); // cable path between two landing stations
  ctx.moveTo(7, 22);
  ctx.bezierCurveTo(12, 6, 20, 26, 25, 10);
  ctx.stroke();
  dot(ctx, 7, 22, 3);
  dot(ctx, 25, 10, 3);
}

export function drawTower(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(CX - 0.6, 4, 1.2, 5);
  poly(ctx, [
    [CX - 6, 9],
    [CX + 6, 9],
    [CX + 4, 14],
    [CX - 4, 14]
  ]);
  ctx.fillRect(CX - 1.75, 14, 3.5, 10);
  ctx.fillRect(CX - 6, 24, 12, 2);
}

export function drawAntenna(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  line(ctx, [
    [CX, 12],
    [CX - 5, 27]
  ]);
  line(ctx, [
    [CX, 12],
    [CX + 5, 27]
  ]);
  line(ctx, [
    [CX - 3, 21],
    [CX + 3, 21]
  ]);
  dot(ctx, CX, 11, 2.2);
  ctx.lineWidth = 1.6;
  for (const r of [5, 9]) {
    ctx.beginPath();
    ctx.arc(CX, 11, r, -Math.PI * 0.2, Math.PI * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CX, 11, r, Math.PI * 0.8, Math.PI * 1.2);
    ctx.stroke();
  }
}

export function drawPort(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ring(ctx, CX, 7, 2.5); // anchor ring
  line(ctx, [
    [CX, 9.5],
    [CX, 27]
  ]);
  line(ctx, [
    [CX - 5, 13],
    [CX + 5, 13]
  ]);
  ctx.beginPath();
  ctx.arc(CX, 17, 10, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
}

export function drawAirport(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color, 1.6);
  ring(ctx, CX, CY, 11);
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(Math.PI / 4);
  ctx.scale(0.62, 0.62);
  ctx.translate(-CX, -CY);
  drawPlane(ctx, color);
  ctx.restore();
}

// ---- security / conflict -------------------------------------------------------------------

function star(ctx: CanvasRenderingContext2D, points: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const x = CX + Math.cos(a) * r;
    const y = CY + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawMilitary(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  star(ctx, 5, 11, 4.4);
  ctx.stroke();
  dot(ctx, CX, CY + 0.5, 2.4);
}

export function drawConflict(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  // crossed swords: two blades + hilt guards
  line(ctx, [
    [6, 6],
    [24, 24]
  ]);
  line(ctx, [
    [26, 6],
    [8, 24]
  ]);
  line(ctx, [
    [19, 25],
    [25, 19]
  ]);
  line(ctx, [
    [13, 25],
    [7, 19]
  ]);
}

export function drawExplosion(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  star(ctx, 8, 12, 5.5);
  ctx.fill();
}

export function drawAlert(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  poly(
    ctx,
    [
      [CX, 4.5],
      [27.5, 26],
      [4.5, 26]
    ],
    false
  );
  line(ctx, [
    [CX, 12],
    [CX, 19]
  ]);
  dot(ctx, CX, 22.5, 1.4);
}

export function drawShield(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath();
  ctx.moveTo(CX, 4);
  ctx.lineTo(CX + 10, 8);
  ctx.quadraticCurveTo(CX + 10, 22, CX, 28);
  ctx.quadraticCurveTo(CX - 10, 22, CX - 10, 8);
  ctx.closePath();
  ctx.stroke();
  line(ctx, [
    [CX - 4.5, 16],
    [CX - 1, 19.5],
    [CX + 5, 12]
  ]);
}

export function drawBug(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color, 1.6);
  ctx.beginPath();
  ctx.ellipse(CX, 18, 5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  dot(ctx, CX, 9.5, 3);
  for (const y of [14, 18, 22]) {
    line(ctx, [
      [CX - 5, y],
      [CX - 10, y - 2]
    ]);
    line(ctx, [
      [CX + 5, y],
      [CX + 10, y - 2]
    ]);
  }
  line(ctx, [
    [CX - 1.5, 7],
    [CX - 4, 3.5]
  ]);
  line(ctx, [
    [CX + 1.5, 7],
    [CX + 4, 3.5]
  ]);
}

// ---- misc ----------------------------------------------------------------------------------

export function drawNews(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath();
  ctx.roundRect(5, 6, 22, 20, 2.5);
  ctx.stroke();
  ctx.fillRect(9, 10, 6, 6); // photo block
  ctx.lineWidth = 1.6;
  line(ctx, [
    [18, 11],
    [23, 11]
  ]);
  line(ctx, [
    [18, 15],
    [23, 15]
  ]);
  line(ctx, [
    [9, 20],
    [23, 20]
  ]);
}

export function drawBuoy(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  poly(ctx, [
    [CX, 5],
    [CX + 5.5, 20],
    [CX - 5.5, 20]
  ]);
  line(ctx, [
    [CX - 8, 20],
    [CX + 8, 20]
  ]);
  wave(ctx, 5, 27, 25.5, 1);
}

export function drawBalloon(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath(); // envelope
  ctx.moveTo(CX, 21);
  ctx.bezierCurveTo(CX - 12, 13, CX - 7, 3, CX, 3);
  ctx.bezierCurveTo(CX + 7, 3, CX + 12, 13, CX, 21);
  ctx.closePath();
  ctx.stroke();
  ctx.lineWidth = 1.4;
  line(ctx, [
    [CX, 21],
    [CX, 25]
  ]);
  ctx.fillRect(CX - 2.5, 25, 5, 3.5); // payload / basket
}

export function drawCamera(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath();
  ctx.roundRect(4, 10, 24, 15, 2.5);
  ctx.stroke();
  poly(ctx, [
    [11, 10],
    [13, 6.5],
    [19, 6.5],
    [21, 10]
  ]);
  ring(ctx, CX, 17.5, 4.5);
  dot(ctx, CX, 17.5, 1.6);
}

export function drawPin(ctx: CanvasRenderingContext2D, color: string): void {
  pen(ctx, color);
  ctx.beginPath(); // teardrop, tip at the anchor point below centre
  ctx.moveTo(CX, 28);
  ctx.bezierCurveTo(CX - 4, 22, CX - 9, 17, CX - 9, 12);
  ctx.arc(CX, 12, 9, Math.PI, 0);
  ctx.bezierCurveTo(CX + 9, 17, CX + 4, 22, CX, 28);
  ctx.closePath();
  ctx.stroke();
  dot(ctx, CX, 12, 3.2);
}

/** Every icon key of the source contract → its draw fn. */
export const ICON_REGISTRY = {
  dot: drawDot,
  plane: drawPlane,
  helicopter: drawHelicopter,
  ship: drawShip,
  satellite: drawSatellite,
  rocket: drawRocket,
  iss: drawIss,
  quake: drawQuake,
  volcano: drawVolcano,
  fire: drawFire,
  storm: drawStorm,
  lightning: drawLightning,
  flood: drawFlood,
  tsunami: drawTsunami,
  radiation: drawRadiation,
  nuclear: drawNuclear,
  biohazard: drawBiohazard,
  factory: drawFactory,
  power: drawPower,
  cable: drawCable,
  tower: drawTower,
  antenna: drawAntenna,
  port: drawPort,
  airport: drawAirport,
  military: drawMilitary,
  conflict: drawConflict,
  explosion: drawExplosion,
  alert: drawAlert,
  news: drawNews,
  shield: drawShield,
  bug: drawBug,
  buoy: drawBuoy,
  balloon: drawBalloon,
  camera: drawCamera,
  pin: drawPin
} satisfies Record<string, IconDrawFn>;

export type IconKey = keyof typeof ICON_REGISTRY;

/** Contract order. */
export const ICON_KEYS = Object.keys(ICON_REGISTRY) as IconKey[];

/** Icons whose silhouette has a nose and may be rotated to heading. */
export const DIRECTIONAL_ICONS: ReadonlySet<string> = new Set([
  'plane',
  'helicopter',
  'ship',
  'rocket'
]);

export function iconDrawFn(icon: string): IconDrawFn {
  return (ICON_REGISTRY as Record<string, IconDrawFn>)[icon] ?? drawDot;
}
