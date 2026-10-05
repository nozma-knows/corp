import Phaser from 'phaser';
import type { DashboardState } from '../shared/contracts.js';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  TILE,
  HOMES,
  MEETING_SEATS,
  COFFEE_SPOT,
  findPath,
  walkable,
  type Cell,
  type OfficePersonId,
} from '../shared/office-layout.js';
import { drawOffice, drawAvatar } from './office-art.js';
import { officeCue, type OfficeCue } from './office-activity.js';

export interface OfficeView {
  sync(state: DashboardState, step: number): void;
  motion(): void;
  zoom(amount: number): void;
  home(): void;
  preview(): void;
  move(direction: Cell): void;
  destroy(): void;
}
interface Actor {
  id: OfficePersonId;
  body: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  direction: number;
  path: Cell[];
  enabled: boolean;
}
const point = (cell: Cell) => ({ x: (cell.x + 0.5) * TILE, y: (cell.y + 0.5) * TILE });
const cellAt = (x: number, y: number): Cell => ({
  x: Math.floor(x / TILE),
  y: Math.floor(y / TILE),
});

class CompanyOffice extends Phaser.Scene {
  ready = false;
  private actors = new Map<OfficePersonId, Actor>();
  private snapshot: DashboardState;
  private selectedStep: number;
  private cue: OfficeCue | null = null;
  private cueKey = '';
  private pair: OfficePersonId[] = [];
  private speech?: Phaser.GameObjects.Text;
  private destination?: Phaser.GameObjects.Arc;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private frozen = false;
  private factor: number;
  private manualZoom = false;
  private meetingAt = 0;
  private previewUntil = 0;
  private ambientAt = 0;
  private ambientIndex = 0;
  private ambientPerson?: OfficePersonId;
  private ambientReturnAt = 0;
  private announcement = '';
  readonly media = matchMedia('(prefers-reduced-motion: reduce)');
  constructor(
    private root: HTMLElement,
    state: DashboardState,
    step: number,
    private inspect: (id: OfficePersonId) => void,
  ) {
    super({ key: 'CompanyOffice' });
    this.snapshot = state;
    this.selectedStep = step;
    this.factor = root.clientWidth < 500 ? 1.65 : 1;
  }
  create() {
    drawOffice(this);
    this.destination = this.add
      .circle(0, 0, 9)
      .setStrokeStyle(2, 0x3b9ca4)
      .setDepth(0)
      .setVisible(false);
    for (const [id, home] of Object.entries(HOMES) as [OfficePersonId, Cell][]) {
      const texture = drawAvatar(this, id),
        location = point(home);
      const shadow = this.add.ellipse(0, 0, 26, 9, 0x394c43, 0.18);
      const sprite = this.add
        .sprite(0, 0, texture, '0-0')
        .setScale(2)
        .setOrigin(0.5, 1)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(location.x, location.y + 7, '', {
          fontFamily: 'Arial, sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#354d42',
          backgroundColor: '#fffdf0',
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5, 0)
        .setDepth(2000)
        .setInteractive({ useHandCursor: true });
      const badge = this.add.circle(14, -42, 4, 0x92b675).setStrokeStyle(1, 0xffffff);
      const body = this.add
        .container(location.x, location.y, [shadow, sprite, badge])
        .setDepth(location.y);
      const actor: Actor = {
        id,
        body,
        sprite,
        label,
        badge,
        ...location,
        direction: 0,
        path: [],
        enabled: true,
      };
      this.actors.set(id, actor);
      for (const object of [sprite, label]) {
        object.setData('officePerson', id);
        object.on(
          'pointerdown',
          (
            _pointer: Phaser.Input.Pointer,
            _x: number,
            _y: number,
            event: Phaser.Types.Input.EventData,
          ) => {
            event.stopPropagation();
            this.inspect(id);
          },
        );
      }
    }
    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.some((object) => object.getData('officePerson'))) return;
        this.root.focus({ preventScroll: true });
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.walkOwner(cellAt(world.x, world.y));
      },
    );
    this.speech = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '12px',
        color: '#354d42',
        backgroundColor: '#fffef7',
        wordWrap: { width: 205 },
        padding: { x: 10, y: 8 },
        lineSpacing: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(3000)
      .setVisible(false);
    this.cameras.main.setBackgroundColor('#e0d8c5').setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.ready = true;
    this.root.querySelector('.office-loading')?.remove();
    this.resizeView();
    this.sync(this.snapshot, this.selectedStep);
    this.root.dataset.ready = 'true';
    this.root.dataset.people = String(this.actors.size);
    this.root.dataset.renderer = this.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas';
    this.ambientAt = this.time.now + 4000;
  }
  resizeView() {
    if (!this.ready) return;
    if (!this.manualZoom) this.factor = this.root.clientWidth < 500 ? 1.65 : 1;
    const camera = this.cameras.main,
      width = this.scale.width,
      height = this.scale.height;
    if (this.factor <= 1.01) camera.removeBounds();
    else camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    camera
      .setSize(width, height)
      .setZoom(Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * this.factor)
      .setRoundPixels(true);
    this.centerView();
    this.root.dataset.zoom = this.factor.toFixed(2);
  }
  private centerView() {
    if (this.factor <= 1.01) this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    else {
      const owner = this.actors.get('owner');
      if (owner) this.cameras.main.centerOn(owner.x, owner.y);
    }
  }
  private announce(text: string) {
    if (text === this.announcement) return;
    this.announcement = text;
    const status = document.querySelector<HTMLElement>('#office-world-status');
    if (status) status.textContent = text;
    this.root.dataset.activity = text;
  }
  private displayName(id: OfficePersonId) {
    return id === 'owner'
      ? 'You'
      : (this.snapshot.inspector.workers.find((w) => w.id === id)?.name ?? id);
  }
  sync(state: DashboardState, step: number) {
    this.snapshot = state;
    this.selectedStep = step;
    if (!this.ready) return;
    for (const actor of this.actors.values()) {
      const worker = state.inspector.workers.find((w) => w.id === actor.id);
      actor.enabled = actor.id === 'owner' || !!worker?.enabled;
      actor.label.setText(this.displayName(actor.id));
      actor.sprite.setAlpha(actor.enabled ? 1 : 0.4);
      const working =
        state.model_tasks?.[0]?.status === 'running' &&
        state.model_tasks[0].active_worker === actor.id;
      actor.badge.setFillStyle(
        !actor.enabled ? 0xa1a59e : working ? 0x3fa789 : actor.id === 'owner' ? 0x61c2ca : 0x9ca98c,
      );
      if (!actor.enabled) {
        actor.path = [];
        this.stand(actor);
      }
    }
    this.setMotionStatus();
    const nextCue = officeCue(state, step);
    const status = document.querySelector<HTMLElement>('#office-world-status');
    if (status && this.announcement) status.textContent = this.announcement;
    if (
      this.previewUntil &&
      nextCue?.mode !== 'live' &&
      !state.company.paused &&
      this.pair.every((id) => this.actors.get(id)?.enabled)
    )
      return;
    if (this.previewUntil) {
      this.previewUntil = 0;
      this.cueKey = '';
    }
    const key = `${nextCue?.id ?? 'idle'}:${state.company.paused}:${state.inspector.workers.map((worker) => worker.enabled).join(',')}`;
    if (key === this.cueKey) return;
    this.cueKey = key;
    this.cue = nextCue;
    this.resetGathering();
    if (!nextCue || nextCue.mode === 'blocked' || state.company.paused) {
      this.root.dataset.phase = nextCue?.mode === 'blocked' ? 'blocked' : 'at-desks';
      this.announce(
        state.company.paused
          ? 'Company paused · employee motion is paused.'
          : nextCue?.mode === 'blocked'
            ? `Blocked task · ${this.displayName(nextCue.sender)}`
            : 'Office open · no team task running.',
      );
      return;
    }
    const pair = [nextCue.sender, nextCue.recipient].filter(
      (id, index, list) => list.indexOf(id) === index,
    );
    if (pair.some((id) => !this.actors.get(id)?.enabled)) {
      this.announce('This handoff involves a disabled employee.');
      return;
    }
    this.gather(pair);
    this.announce(
      `${nextCue.mode === 'live' ? 'Live task' : 'Recorded handoff'} · ${this.displayName(nextCue.sender)} → ${this.displayName(nextCue.recipient)}`,
    );
  }
  private resetGathering() {
    this.speech?.setVisible(false);
    this.meetingAt = 0;
    for (const id of this.pair) if (id !== 'owner') this.route(id, HOMES[id]);
    this.pair = [];
  }
  private gather(ids: OfficePersonId[]) {
    if (this.ambientPerson && !ids.includes(this.ambientPerson))
      this.route(this.ambientPerson, HOMES[this.ambientPerson]);
    this.ambientPerson = undefined;
    this.pair = ids;
    this.meetingAt = 0;
    this.speech?.setVisible(false);
    ids.forEach((id, index) => this.route(id, MEETING_SEATS[index]));
    this.root.dataset.phase = this.reduced ? 'meeting' : 'walking';
  }
  private route(id: OfficePersonId, target: Cell) {
    const actor = this.actors.get(id);
    if (!actor?.enabled || !walkable(target)) return;
    const start = cellAt(actor.x, actor.y),
      path = findPath(start, target);
    if (!path.length && (start.x !== target.x || start.y !== target.y)) return;
    if (this.reduced) {
      const end = point(target);
      actor.x = end.x;
      actor.y = end.y;
      actor.path = [];
      this.place(actor);
      this.stand(actor);
    } else {
      const centered = point(start);
      actor.path =
        Math.hypot(actor.x - centered.x, actor.y - centered.y) > 0.1 ? [start, ...path] : path;
    }
  }
  private stand(actor: Actor) {
    actor.sprite.stop();
    actor.sprite.setFrame(`${actor.direction}-0`);
  }
  private place(actor: Actor) {
    actor.body.setPosition(actor.x, actor.y).setDepth(actor.y);
    actor.label.setPosition(actor.x, actor.y + 7);
    if (actor.id === 'owner') {
      this.root.dataset.ownerX = actor.x.toFixed(1);
      this.root.dataset.ownerY = actor.y.toFixed(1);
    }
  }
  private walkOwner(target: Cell) {
    if (!walkable(target)) {
      this.announce('Choose an open floor tile to walk there.');
      return;
    }
    if (this.frozen && !this.reduced) {
      this.announce('Resume office motion to walk around.');
      return;
    }
    this.pair = this.pair.filter((id) => id !== 'owner');
    this.route('owner', target);
    const location = point(target);
    this.destination?.setPosition(location.x, location.y).setVisible(!this.reduced);
  }
  move(direction: Cell) {
    const owner = this.actors.get('owner');
    if (!owner) return;
    const current = cellAt(owner.x, owner.y);
    this.walkOwner({ x: current.x + direction.x, y: current.y + direction.y });
  }
  zoom(amount: number) {
    this.manualZoom = true;
    this.factor = Phaser.Math.Clamp(this.factor + amount, 1, 2.5);
    this.resizeView();
  }
  home() {
    this.manualZoom = true;
    this.factor = 1;
    this.resizeView();
  }
  toggleMotion() {
    this.frozen = !this.frozen;
    for (const actor of this.actors.values()) if (this.frozen) this.stand(actor);
    this.setMotionStatus();
  }
  setReduced(value: boolean) {
    this.reduced = value;
    if (value)
      for (const actor of this.actors.values()) {
        actor.path = [];
        this.stand(actor);
      }
    this.cueKey = '';
    this.sync(this.snapshot, this.selectedStep);
    this.setMotionStatus();
  }
  private setMotionStatus() {
    this.root.dataset.motion = this.reduced ? 'reduced' : this.frozen ? 'paused' : 'on';
    const control = document.querySelector<HTMLButtonElement>('[data-action="office-motion"]');
    if (control) {
      control.textContent = this.reduced
        ? 'Reduced motion'
        : this.frozen
          ? 'Resume motion'
          : 'Pause motion';
      control.disabled = this.reduced;
      control.setAttribute('aria-pressed', String(this.frozen || this.reduced));
    }
  }
  preview() {
    if (
      !this.ready ||
      this.snapshot.company.paused ||
      this.snapshot.model_tasks?.[0]?.status === 'running' ||
      !this.actors.get('operator')?.enabled ||
      !this.actors.get('researcher')?.enabled
    )
      return;
    this.resetGathering();
    this.previewUntil = this.time.now + 16000;
    this.cue = {
      id: 'preview',
      sender: 'operator',
      recipient: 'researcher',
      message: 'Office preview · team meeting',
      mode: 'recorded',
    };
    this.gather(['operator', 'researcher']);
    this.announce('Office preview · Operator and Scout walk to the team table.');
  }
  update(time: number, delta: number) {
    if (!this.ready || document.hidden) return;
    const canMove = !this.reduced && !this.frozen;
    for (const actor of this.actors.values()) {
      const automatic = actor.id !== 'owner';
      if (!canMove || (automatic && (this.snapshot.company.paused || !actor.enabled))) {
        this.stand(actor);
        continue;
      }
      const next = actor.path[0];
      if (!next) {
        this.stand(actor);
        continue;
      }
      const target = point(next),
        dx = target.x - actor.x,
        dy = target.y - actor.y,
        distance = Math.hypot(dx, dy);
      const movement = (Math.min(50, delta) / 1000) * 112;
      actor.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2;
      actor.sprite.play(`office-avatar-${actor.id}-walk-${actor.direction}`, true);
      if (distance <= movement) {
        actor.x = target.x;
        actor.y = target.y;
        actor.path.shift();
      } else {
        actor.x += (dx / distance) * movement;
        actor.y += (dy / distance) * movement;
      }
      this.place(actor);
    }
    const owner = this.actors.get('owner')!;
    this.destination?.setVisible(owner.path.length > 0 && !this.reduced);
    this.place(owner);
    this.centerView();
    const arrived =
      this.pair.length > 0 && this.pair.every((id) => !this.actors.get(id)!.path.length);
    if (arrived && this.cue) {
      if (!this.meetingAt) {
        this.meetingAt = time || 1;
        this.root.dataset.phase = 'meeting';
        if (this.previewUntil)
          this.announce('Office preview · Operator and Scout are meeting at the team table.');
        this.pair.forEach((id, index) => {
          const actor = this.actors.get(id)!;
          actor.direction = index === 0 ? 1 : 3;
          this.stand(actor);
        });
        const message =
          this.cue.message.length > 115 ? this.cue.message.slice(0, 112) + '…' : this.cue.message;
        this.speech?.setText(message).setVisible(true);
      }
      const speaker = this.actors.get(this.cue.sender)!;
      this.speech?.setPosition(speaker.x, speaker.y - 54);
      if (this.cue.mode === 'live' && time - this.meetingAt > 6000 && canMove) {
        this.resetGathering();
        this.root.dataset.phase = 'at-desks';
        this.announce(
          `Live task · ${this.displayName(this.snapshot.model_tasks?.[0]?.active_worker ?? 'operator')} is working.`,
        );
      }
    }
    if (this.previewUntil && time > this.previewUntil && canMove) {
      this.previewUntil = 0;
      this.cueKey = '';
      this.sync(this.snapshot, this.selectedStep);
    }
    // Ambient coffee walks are visual atmosphere, never fabricated task messages.
    if (
      canMove &&
      !this.snapshot.company.paused &&
      !this.pair.length &&
      !this.snapshot.model_tasks?.some((task) => task.status === 'running')
    ) {
      if (this.ambientPerson && time > this.ambientReturnAt) {
        this.route(this.ambientPerson, HOMES[this.ambientPerson]);
        this.ambientPerson = undefined;
        this.ambientAt = time + 15000;
      } else if (!this.ambientPerson && time > this.ambientAt) {
        const candidates = [...this.actors.values()].filter(
          (actor) => actor.id !== 'owner' && actor.id !== 'treasury' && actor.enabled,
        );
        const actor = candidates[this.ambientIndex++ % candidates.length];
        if (actor) {
          this.route(actor.id, COFFEE_SPOT);
          this.ambientPerson = actor.id;
          this.ambientReturnAt = time + 12000;
        }
      }
    }
  }
}

export function createOffice(
  root: HTMLElement,
  state: DashboardState,
  step: number,
  inspect: (id: OfficePersonId) => void,
): OfficeView {
  const scene = new CompanyOffice(root, state, step, inspect);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: root,
    width: root.clientWidth || 800,
    height: root.clientHeight || 600,
    backgroundColor: '#e0d8c5',
    pixelArt: true,
    roundPixels: true,
    scene: [scene],
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false },
    scale: { mode: Phaser.Scale.NONE },
    fps: { target: 30 },
    callbacks: {
      postBoot: (activeGame) => {
        activeGame.canvas.setAttribute('aria-hidden', 'true');
      },
    },
  });
  const observer = new ResizeObserver(() => {
    if (root.clientWidth > 0 && root.clientHeight > 0) {
      game.scale.resize(root.clientWidth, root.clientHeight);
      scene.resizeView();
    }
  });
  observer.observe(root);
  const motion = (event: MediaQueryListEvent) => scene.setReduced(event.matches);
  scene.media.addEventListener('change', motion);
  const keydown = (event: KeyboardEvent) => {
    const directions: Record<string, Cell> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
    };
    if (!directions[event.key] || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    scene.move(directions[event.key]);
  };
  root.addEventListener('keydown', keydown);
  return {
    sync: (next, selected) => scene.sync(next, selected),
    motion: () => scene.toggleMotion(),
    zoom: (amount) => scene.zoom(amount),
    home: () => scene.home(),
    preview: () => scene.preview(),
    move: (direction) => scene.move(direction),
    destroy() {
      observer.disconnect();
      scene.media.removeEventListener('change', motion);
      root.removeEventListener('keydown', keydown);
      game.destroy(true);
    },
  };
}
