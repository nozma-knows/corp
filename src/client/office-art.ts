import type Phaser from 'phaser';
import {
  COLUMNS,
  ROWS,
  TILE,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  ROOMS,
  FURNITURE,
  isWall,
  HOMES,
  type OfficePersonId,
} from '../shared/office-layout.js';

const palettes: Record<
  OfficePersonId,
  { shirt: string; dark: string; hair: string; skin: string }
> = {
  owner: { shirt: '#69c9ca', dark: '#307984', hair: '#34333e', skin: '#e7b98e' },
  operator: { shirt: '#7d9d64', dark: '#4c6b48', hair: '#593e35', skin: '#ebba90' },
  treasury: { shirt: '#d2b76c', dark: '#9d8147', hair: '#bcbfc6', skin: '#dcb598' },
  researcher: { shirt: '#719ebb', dark: '#487184', hair: '#363239', skin: '#be8769' },
  creator: { shirt: '#cc859d', dark: '#995c7c', hair: '#573d55', skin: '#dfae86' },
  reviewer: { shirt: '#aa90c4', dark: '#77608f', hair: '#d4b97c', skin: '#f0cca0' },
};
function canvas(width: number, height: number) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  const context = image.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable');
  context.imageSmoothingEnabled = false;
  return { image, context };
}
function rect(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}
function register(scene: Phaser.Scene, key: string, image: HTMLCanvasElement) {
  return scene.textures.addCanvas(key, image)!;
}
/** Original pixel art is generated locally; the office loads no third-party artwork. */
export function drawOffice(scene: Phaser.Scene) {
  const { image, context: ctx } = canvas(WORLD_WIDTH, WORLD_HEIGHT);
  rect(ctx, '#e0d8c5', 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLUMNS; col++) {
      const x = col * TILE,
        y = row * TILE;
      rect(ctx, (row + Math.floor(col / 2)) % 2 ? '#ded4bc' : '#e6ddc8', x, y, TILE, TILE);
      rect(ctx, '#d0c5aa', x, y + TILE - 1, TILE, 1);
      rect(ctx, '#d4c9b0', x + (row % 2 ? 16 : 0), y, 1, TILE);
    }
  for (const room of ROOMS) {
    rect(ctx, room.color, room.x * TILE, room.y * TILE, room.width * TILE, room.height * TILE);
    ctx.globalAlpha = 0.12;
    for (let y = room.y + 1; y < room.y + room.height; y++)
      for (let x = room.x + 1; x < room.x + room.width; x++) {
        rect(ctx, room.accent, x * TILE, y * TILE, TILE, 1);
        rect(ctx, room.accent, x * TILE, y * TILE, 1, TILE);
      }
    ctx.globalAlpha = 1;
    // Wide door thresholds make the connected floor plan easy to read.
    rect(ctx, '#b6c2af', room.doorX * TILE, room.doorY * TILE, TILE * 2, TILE);
    rect(ctx, '#f0eee3', room.doorX * TILE, room.doorY * TILE + 3, TILE * 2, 3);
  }
  // A quiet patterned rug anchors the shared meeting area.
  rect(ctx, '#b9c9b8', 13 * TILE, 10 * TILE, 6 * TILE, 5 * TILE);
  rect(ctx, '#c7d4c4', 13 * TILE + 5, 10 * TILE + 5, 6 * TILE - 10, 5 * TILE - 10);
  rect(ctx, '#b6c7b2', 13 * TILE + 10, 10 * TILE + 10, 6 * TILE - 20, 5 * TILE - 20);
  // Desk chairs are intentionally walkable avatar seats.
  for (const home of Object.values(HOMES)) {
    rect(ctx, '#5d6966', home.x * TILE + 8, home.y * TILE + 4, 18, 19);
    rect(ctx, '#81918a', home.x * TILE + 9, home.y * TILE + 4, 16, 5);
    rect(ctx, '#475351', home.x * TILE + 9, home.y * TILE + 23, 3, 5);
    rect(ctx, '#475351', home.x * TILE + 22, home.y * TILE + 23, 3, 5);
  }
  register(scene, 'office-floor', image);
  scene.add.image(0, 0, 'office-floor').setOrigin(0).setDepth(-100);
  const wall = canvas(TILE, TILE + 14);
  rect(wall.context, '#62776d', 0, 10, TILE, TILE + 4);
  rect(wall.context, '#b1c0b4', 0, 0, TILE, 10);
  rect(wall.context, '#d7dfd4', 0, 0, TILE, 4);
  rect(wall.context, '#8d9f93', 0, 10, TILE, 3);
  rect(wall.context, '#53665d', 0, TILE + 8, TILE, 6);
  register(scene, 'office-wall', wall.image);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLUMNS; x++) {
      if (isWall(x, y))
        scene.add
          .image(x * TILE, (y + 1) * TILE, 'office-wall')
          .setOrigin(0, 1)
          .setDepth((y + 1) * TILE - 3);
    }
  for (const room of ROOMS) {
    scene.add
      .text((room.x + 1) * TILE, (room.y + 1) * TILE + 3, room.title, {
        fontFamily: 'monospace',
        fontSize: '12px',
        fontStyle: 'bold',
        color: room.accent,
        backgroundColor: room.color,
        padding: { x: 6, y: 4 },
      })
      .setDepth(1000);
  }
  scene.add
    .text(15.9 * TILE, 9.7 * TILE, 'TEAM TABLE', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#577259',
    })
    .setOrigin(0.5)
    .setDepth(1000);
  scene.add
    .text(16 * TILE, 6.5 * TILE, 'COFFEE & CATCH-UPS', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#877c66',
    })
    .setOrigin(0.5)
    .setDepth(1000);
  for (const [index, item] of FURNITURE.entries()) {
    const w = item.width * TILE,
      h = item.height * TILE;
    const { image: prop, context: p } = canvas(w, h + 20);
    const top = 8,
      bottom = h + 12;
    rect(p, '#00000018', 4, bottom - 4, w - 4, 12);
    if (item.kind === 'desk' || item.kind === 'table' || item.kind === 'coffee') {
      rect(p, '#795b42', 6, top + 14, w - 12, h - 8);
      rect(p, '#ac8257', 2, top, w - 4, h - 10);
      rect(p, '#d1ad79', 2, top, w - 4, h - 17);
      rect(p, '#e3c392', 3, top, w - 6, 3);
      rect(p, '#654b3b', 7, bottom - 12, 5, 12);
      rect(p, '#654b3b', w - 12, bottom - 12, 5, 12);
      if (item.kind === 'desk') {
        rect(p, '#4a5b60', 10, 10, 28, 20);
        rect(p, '#98c0c9', 13, 12, 22, 14);
        rect(p, '#c6e1dd', 14, 13, 19, 2);
        rect(p, '#4a5b60', 22, 30, 4, 5);
        rect(p, '#667471', 16, 34, 17, 3);
        rect(p, '#dcded4', 12, 38, 28, 6);
        rect(p, '#f8f3df', w - 25, 20, 15, 20);
        rect(p, '#bcbda5', w - 23, 24, 11, 1);
        rect(p, '#bcbda5', w - 23, 28, 9, 1);
      } else if (item.kind === 'coffee') {
        rect(p, '#364c46', 10, 6, 23, 28);
        rect(p, '#a4b9a7', 13, 10, 17, 8);
        rect(p, '#b98151', 17, 23, 9, 7);
        rect(p, '#eee8dc', 44, 26, 9, 10);
        rect(p, '#eee8dc', 58, 26, 9, 10);
        rect(p, '#82996c', w - 35, 15, 18, 15);
        rect(p, '#5f744e', w - 28, 11, 11, 12);
      } else {
        rect(p, '#e9e2cf', 14, 16, 17, 14);
        rect(p, '#9cac8d', 18, 19, 10, 2);
        rect(p, '#5e7163', 39, 31, 15, 11);
        rect(p, '#8ea998', 41, 32, 11, 7);
        rect(p, '#f3eee4', 17, 36, 7, 9);
        rect(p, '#ba9665', 18, 37, 5, 2);
      }
    } else if (item.kind === 'plant') {
      rect(p, '#aa7e58', 10, 30, 14, 17);
      rect(p, '#d4a87b', 8, 28, 18, 5);
      rect(p, '#698c57', 5, 13, 23, 16);
      rect(p, '#476944', 11, 5, 12, 27);
      rect(p, '#86a66b', 5, 12, 11, 9);
      rect(p, '#719a5d', 20, 17, 8, 12);
    } else if (item.kind === 'sofa') {
      rect(p, '#607568', 3, 9, w - 6, 32);
      rect(p, '#8ba18a', 4, 7, w - 8, 18);
      rect(p, '#9ab29a', 12, 22, w - 24, 15);
      rect(p, '#6a8370', 7, 15, 8, 25);
      rect(p, '#6a8370', w - 15, 15, 8, 25);
      rect(p, '#c8bf9b', w - 33, 16, 16, 15);
    } else if (item.kind === 'board') {
      rect(p, '#687c75', 0, 3, w, 38);
      rect(p, '#f4f2e5', 4, 6, w - 8, 29);
      for (let i = 0; i < 4; i++) {
        rect(p, ['#d4b67d', '#94bbae', '#ad9cbc', '#e0a98e'][i], 13 + i * 28, 12, 17, 12);
        rect(p, '#9faaa0', 13 + i * 28, 29, 20, 2);
      }
    } else if (item.kind === 'vault') {
      rect(p, '#6b7d7b', 4, 4, w - 8, h + 6);
      rect(p, '#9fac9f', 6, 4, w - 12, h - 3);
      rect(p, '#c0c7b6', 10, 11, w - 20, h - 14);
      rect(p, '#85938a', 27, 23, 12, 12);
      rect(p, '#596a63', 31, 26, 4, 6);
      rect(p, '#708179', w - 12, 19, 3, 24);
    } else {
      rect(p, '#8b694d', 2, 1, w - 4, h + 9);
      rect(p, '#b58e65', 4, 2, w - 8, h + 3);
      for (let shelf = 0; shelf < 3; shelf++) {
        for (let i = 0; i < 4; i++)
          rect(
            p,
            ['#738e7d', '#bf9570', '#95a8ba', '#cbb981'][i],
            6 + i * 5,
            6 + shelf * 20,
            4,
            14,
          );
        rect(p, '#77593f', 4, 21 + shelf * 20, w - 8, 3);
      }
    }
    const key = `office-prop-${index}`;
    register(scene, key, prop);
    scene.add
      .image(item.x * TILE, (item.y + item.height) * TILE + 6, key)
      .setOrigin(0, 1)
      .setDepth((item.y + item.height) * TILE - 2);
  }
}

export function drawAvatar(scene: Phaser.Scene, id: OfficePersonId) {
  const { image, context: ctx } = canvas(16 * 4, 24 * 4),
    palette = palettes[id];
  for (let direction = 0; direction < 4; direction++)
    for (let frame = 0; frame < 4; frame++) {
      ctx.save();
      ctx.translate(frame * 16, direction * 24);
      const bob = frame === 1 || frame === 3 ? -1 : 0;
      rect(ctx, '#2c383d', 5, 17, 3, 5 + (frame === 1 ? -1 : 0));
      rect(ctx, '#2c383d', 8, 17, 3, 5 + (frame === 3 ? -1 : 0));
      rect(ctx, '#354a4d', 4, frame === 1 ? 21 : 22, 4, 2);
      rect(ctx, '#354a4d', 8, frame === 3 ? 21 : 22, 4, 2);
      rect(ctx, palette.dark, 4, 11 + bob, 8, 7);
      rect(ctx, palette.shirt, 4, 11 + bob, 8, 5);
      rect(ctx, palette.skin, 3, 12 + bob + (frame === 1 ? 1 : 0), 2, 5);
      rect(ctx, palette.skin, 11, 12 + bob + (frame === 3 ? 1 : 0), 2, 5);
      rect(ctx, palette.skin, 6, 9 + bob, 4, 3);
      rect(ctx, '#ece7d9', 6, 11 + bob, 4, 1);
      rect(ctx, palette.skin, 4, 3 + bob, 8, 7);
      rect(ctx, palette.hair, 4, 2 + bob, 8, 3);
      rect(ctx, palette.hair, 3, 4 + bob, 2, 4);
      rect(ctx, palette.hair, 11, 4 + bob, 2, 3);
      if (direction === 2) rect(ctx, palette.hair, 4, 4 + bob, 8, 6);
      else {
        const eyes = direction === 1 ? [10] : direction === 3 ? [5] : [5, 10];
        for (const eye of eyes) rect(ctx, '#343643', eye, 6 + bob, 1, 1);
        if (id === 'treasury') {
          rect(ctx, '#68777b', 4, 5 + bob, 3, 3);
          rect(ctx, '#68777b', 9, 5 + bob, 3, 3);
          rect(ctx, '#68777b', 7, 6 + bob, 2, 1);
        }
        rect(ctx, '#b57d61', direction === 3 ? 5 : 8, 9 + bob, 2, 1);
      }
      if (id === 'creator') rect(ctx, '#d9adce', 11, 2 + bob, 3, 3);
      ctx.restore();
    }
  const key = `office-avatar-${id}`,
    texture = register(scene, key, image);
  for (let direction = 0; direction < 4; direction++) {
    for (let frame = 0; frame < 4; frame++)
      texture.add(`${direction}-${frame}`, 0, frame * 16, direction * 24, 16, 24);
    scene.anims.create({
      key: `${key}-walk-${direction}`,
      frames: [1, 2, 3, 2].map((frame) => ({ key, frame: `${direction}-${frame}` })),
      frameRate: 8,
      repeat: -1,
    });
  }
  return key;
}
