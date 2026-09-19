import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { World } from '../core/Physics.js';
import { Input } from '../core/Input.js';
import { AudioEngine } from '../core/AudioEngine.js';
import { buildBorder } from '../map/BorderMap.js';
import { NavGrid } from './Nav.js';
import { Effects } from './Effects.js';
import { Ballistics, Weapon } from './Weapon.js';
import { GadgetManager } from './Gadgets.js';
import { Player, Drone } from './Player.js';
import { Bot } from './Bot.js';
import { Match, Presets } from './Match.js';
import { HUD } from '../ui/HUD.js';
import { Operators, OperatorById, Gadgets as GadgetDefs, SecondaryGadgets } from '../data/operators.js';
import { Skins } from '../ui/Menu.js';
import { getMaterial } from '../map/Materials.js';
import { Net } from '../net/Net.js';
import { NetSync } from '../net/Sync.js';
import { Character } from './Character.js';
import { BARRICADE_BUILD_TIME } from '../map/Level.js';
import { CampaignMatch } from '../campaign/CampaignMatch.js';

// Match orchestrator: scene/lighting/post-processing, level lifecycle per round, players
// and bots, interactions, event routing between systems, and the render loop.

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// Time of day presets (campaign missions): sun, sky dome, hemisphere fill, fog and exposure.
const TIME_OF_DAY = {
  day:   { sun: [40, 46, -26], sunI: 3.6, sunC: 0xfff0dc, hemiI: 0.75, hemiSky: 0xc4d8f0, hemiGnd: 0x6a5a48, bg: 0x9fb4c8, top: 0x4a78b8, mid: 0x9fb4c8, bot: 0xcdb9a0, glow: 1.6, env: 0.85, exposure: 0.92, fogK: 1.0, lights: 0 },
  dawn:  { sun: [58, 11, 26], sunI: 2.3, sunC: 0xffc39a, hemiI: 0.5, hemiSky: 0xa9b6d6, hemiGnd: 0x5a4a40, bg: 0xd3ae98, top: 0x35558f, mid: 0xd0a08a, bot: 0xf0c9a2, glow: 2.4, env: 0.6, exposure: 0.88, fogK: 0.8, lights: 1 },
  dusk:  { sun: [-52, 8, -16], sunI: 1.8, sunC: 0xff9a5c, hemiI: 0.4, hemiSky: 0x7f86b4, hemiGnd: 0x4a3a30, bg: 0xb0857a, top: 0x283670, mid: 0xad7a6a, bot: 0xe6a870, glow: 2.6, env: 0.5, exposure: 0.86, fogK: 0.7, lights: 2 },
  night: { sun: [-30, 42, 30], sunI: 0.26, sunC: 0x9fb4ff, hemiI: 0.18, hemiSky: 0x2b3c64, hemiGnd: 0x121110, bg: 0x080b13, top: 0x03060e, mid: 0x0a101e, bot: 0x14171f, glow: 0.35, env: 0.18, exposure: 0.9, fogK: 0.55, lights: 4 },
};

class ViewModelPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; this.clear = false; }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    // a Color background makes three.js force-clear the colour buffer; hide it for this pass
    const bg = this.scene.background, fog = this.scene.fog; this.scene.background = null; this.scene.fog = null;
    const oldAuto = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth();
    renderer.render(this.scene, this.camera); renderer.autoClear = oldAuto;
    this.scene.background = bg; this.scene.fog = fog;
  }
}

export class Game {
  constructor(app, settings, gameSettings) {
    this.app = app; this.settings = settings; this.renderer = app.renderer; this.time = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.03, 260); this.camera.layers.set(0); this.scene.add(this.camera);
    this.vmCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 10); this.vmCamera.layers.set(1);
    this.characters = []; this.bots = []; this.player = null;
    this.audio = AudioEngine; this.audio.losCheck = (p) => this.player ? this.world.visible(this.camera.position, p) : true;
    this.paused = false; this.over = false;
    this.net = Net.online ? new NetSync(this) : null;
    this._lighting(); this._environment();
    this.resetLevel();
    this.effects = new Effects(this.scene, this.level, this.audio);
    this.ballistics = new Ballistics(this);
    this.gadgets = new GadgetManager(this);
    const preset = Presets[gameSettings.preset] || Presets.casual;
    this.campaign = gameSettings.campaign || null;
    this.match = this.campaign ? new CampaignMatch(this, settings, this.campaign, gameSettings.difficulty) : new Match(this, { ...preset, side: gameSettings.side, site: gameSettings.site, difficulty: gameSettings.difficulty });
    this.difficulty = gameSettings.difficulty || 'normal';
    this.hud = new HUD(this, app.uiRoot);
    this._post();
    this.applyQuality();
    this.playerOp = null; this.playerLoadout = null;
    this.stats = { kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0 };
    this.pings = [];   // contextual pings: { kind: 'yellow' | 'enemy', pos, t, label, by }
    this.allies = []; this.enemies = []; this.extras = [];   // campaign roster groups
  }

  // ---------- scene setup ----------
  _lighting() {
    const s = this.scene;
    s.background = new THREE.Color(0x9fb4c8);
    s.fog = new THREE.Fog(0x9fb4c8, 60, 220);
    this.hemi = new THREE.HemisphereLight(0xc4d8f0, 0x6a5a48, 0.75); s.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.6); sun.position.set(40, 46, -26); sun.target.position.set(16, 0, 11); s.add(sun); s.add(sun.target);
    sun.castShadow = this.settings.shadows !== 'off';
    const sz = this.settings.shadows === 'ultra' ? 4096 : this.settings.shadows === 'high' ? 2048 : 1536;
    sun.shadow.mapSize.set(sz, sz); sun.shadow.camera.near = 5; sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -34; sun.shadow.camera.right = 34; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2;
    this.sun = sun;
    // sky dome
    const sky = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { top: { value: new THREE.Color(0x4a78b8) }, mid: { value: new THREE.Color(0x9fb4c8) }, bot: { value: new THREE.Color(0xcdb9a0) }, sunDir: { value: sun.position.clone().normalize() }, glow: { value: 1.6 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top, mid, bot, sunDir; uniform float glow; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, pow(-h, 0.7)); float s = pow(max(0.0, dot(vP, sunDir)), 300.0); c += vec3(1.0, 0.95, 0.85) * s * glow; c += vec3(1.0, 0.9, 0.7) * pow(max(0.0, dot(vP, sunDir)), 6.0) * 0.075 * glow; gl_FragColor = vec4(c, 1.0); }` }));
    sky.name = 'sky'; s.add(sky); sky.material.toneMapped = false; sky.material.fog = false; this.sky = sky;
    this.tod = TIME_OF_DAY.day;
  }
  // Campaign missions run at different hours: retune the sun, sky, fill light, fog and exposure.
  setTimeOfDay(name) {
    const t = this.tod = TIME_OF_DAY[name] || TIME_OF_DAY.day; const s = this.scene;
    this.sun.position.set(t.sun[0], t.sun[1], t.sun[2]); this.sun.intensity = t.sunI; this.sun.color.setHex(t.sunC);
    this.hemi.intensity = t.hemiI; this.hemi.color.setHex(t.hemiSky); this.hemi.groundColor.setHex(t.hemiGnd);
    s.background.setHex(t.bg); s.fog.color.setHex(t.bg);
    const u = this.sky.material.uniforms; u.top.value.setHex(t.top); u.mid.value.setHex(t.mid); u.bot.value.setHex(t.bot); u.sunDir.value.copy(this.sun.position).normalize(); u.glow.value = t.glow;
    s.environmentIntensity = t.env; this.renderer.toneMappingExposure = t.exposure;
    this.renderer.shadowMap.needsUpdate = true;
    this.applyQuality();
  }
  _environment() {
    // PMREM from a small synthetic environment for PBR reflections
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    const sph = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x8fa3b8 })); env.add(sph);
    const top = new THREE.Mesh(new THREE.SphereGeometry(48, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x6a8fc0 })); env.add(top);
    const sunP = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff6e8 })); sunP.position.set(25, 30, -15); env.add(sunP);
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x4d4238 })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -3; env.add(gnd);
    this.scene.environment = pm.fromScene(env, 0.02).texture; this.scene.environmentIntensity = 0.85;
    pm.dispose();
  }
  _post() {
    const r = this.renderer; const size = r.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(r); this.composer.setPixelRatio(r.getPixelRatio());
    this.renderPass = new RenderPass(this.scene, this.camera); this.composer.addPass(this.renderPass);
    this.vmPass = new ViewModelPass(this.scene, this.vmCamera); this.composer.addPass(this.vmPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.45, 1.0); this.bloom.enabled = this.settings.bloom !== false; this.composer.addPass(this.bloom);
    this.smaa = new SMAAPass(size.x * r.getPixelRatio(), size.y * r.getPixelRatio()); this.composer.addPass(this.smaa);
    this.composer.addPass(new OutputPass());
  }
  get perf() { return this.settings.quality === 'performance'; }
  // Quality presets: performance trades bloom, SMAA, shadow resolution/rate and light count for frame time.
  applyQuality() {
    const s = this.settings; const perf = this.perf;
    this.bloom.enabled = !!s.bloom && !perf; this.smaa.enabled = !perf;
    this.sun.castShadow = s.shadows !== 'off';
    const sz = perf ? 1024 : s.shadows === 'ultra' ? 4096 : s.shadows === 'high' ? 2048 : 1536;
    if (this.sun.shadow.mapSize.x !== sz) { this.sun.shadow.mapSize.set(sz, sz); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true; this._shadowEvery = perf ? 2 : 1;
    const tod = this.tod || TIME_OF_DAY.day;
    this.lightBudget = (perf ? 5 : s.quality === 'ultra' ? 10 : 8) + tod.lights;   // dark hours lean on the interior lights
    this.scene.fog.far = (perf ? 150 : 220) * tod.fogK;
    if (this.player && this.player.setScopeRes) this.player.setScopeRes(perf ? 640 : 1024);
  }
  // Compile every shader the round can need before the first frame so nothing stalls mid-fight.
  warmup() {
    const P = this.player; const restore = [];
    if (P) { for (const [, g] of P.vmWeapons) { restore.push([g, g.visible]); g.visible = true; const lens = g.userData.lens; if (lens) { restore.push([lens, lens.visible]); lens.visible = true; } } if (P.arms) { restore.push([P.arms, P.arms.visible]); P.arms.visible = true; } }
    // one of every effect, far below the map
    const far = new THREE.Vector3(16, -80, 11); const n = new THREE.Vector3(0, 1, 0);
    try { this.effects.muzzleFlash(far, n, 1, false); this.effects.impact(far, n, 'concrete'); this.effects.impact(far, n, 'drywall'); this.effects.bloodHit(far, n); this.effects.wallDebris(far, n, 'wood'); this.effects.smokeCloud && this.effects.smokeCloud(far, 1, 0.3); this.effects.tracer(far, n, 1, false); this.level.addBulletHole(far, n); this.level.addScorch(far, n); this.level.addBlood(far, n); } catch (e) {}
    // materials that only appear later: barricade boards, bomb device, defuser
    const tmp = new THREE.Group(); tmp.position.copy(far);
    for (const c of [0xffffff, 0xf0e2cc, 0xd9c6ab, 0xe8dcc6, 0xcdb99a]) tmp.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), getMaterial('barricade', { color: c })));
    tmp.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), getMaterial('metal', { color: 0x777777 })));
    this.scene.add(tmp);
    this.renderer.compile(this.scene, this.camera);
    if (P) this.renderer.compile(this.scene, this.vmCamera);
    this.scene.remove(tmp);
    for (const [o, v] of restore) o.visible = v;
  }
  resize(w, h) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); this.smaa.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio()); }
  }

  // ---------- level lifecycle ----------
  resetLevel() {
    if (this.level) { this.scene.remove(this.level.group); this.scene.remove(this.level.dynamicGroup); this.scene.remove(this.level.decalInst); this.scene.remove(this.level.scorchInst); this.scene.remove(this.level.bloodInst); for (const l of this.level.lights) this.scene.remove(l); this.level.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); this.level.dynamicGroup.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
    if (this.player && this.player.usingCam) this.player.exitCam();
    this.world = new World(2);
    this.level = buildBorder(this.world, this.scene);
    this.level.onCellDestroyed = (wall, cell) => { this.effects.wallDebris(cell.center, wall.normal, 'drywall'); };
    this.level.onWallChanged = (wall) => { };
    this.level.onBarricadeKnock = (b, pos, fp) => { this.audio.knock(pos, !!fp); };
    if (this.net && this.net.isHost) {
      const n = this.net; const L = this.level;
      L.onCellGone = (wall, cell) => n.onCell(wall, cell); L.onReinforced = (wall) => n.onReinforce(wall); L.onBarricadeOp = (b, op, data) => n.onBarricade(b, op, data);
      L.onGlassBroken = (pane) => n.onGlass(pane); L.onHatchChanged = (h) => n.onHatch(h); L.onStudsRemoved = (p, r) => n.onStuds(p, r);
    }
    this.level.onCameraDestroyed = (cam, shooter) => { this.effects.shockSparks && this.effects.shockSparks(cam.pos); this.audio.impact(cam.pos, 'metal'); this.audio.glass && this.audio.glass(cam.pos); if (this.player && this.player.side === 'def') this.hud.toast('CAMERA LOST — ' + cam.name, 2); if (shooter && shooter.isPlayer) this.hud.hitmarker(false, false); };
    this.level.onBarricadeChunk = (pos, normal) => { this.effects.wallDebris(pos, normal || new THREE.Vector3(0, 0, 1), 'wood'); };
    this.nav = new NavGrid(this.world, new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(62, 8, 52)), this.level.floorYs);
    if (this.effects) this.effects.level = this.level;
    if (this.gadgets) this.gadgets.reset();
  }

  // ---------- roster ----------
  setupTeams(playerOpId, loadout) {
    // dispose previous
    for (const c of this.characters) { this.scene.remove(c.root); }
    if (this.player) this.player.dispose();
    this.characters = []; this.bots = [];
    const side = this.match.playerSide; const enemySide = side === 'atk' ? 'def' : 'atk';
    const op = OperatorById[playerOpId]; this.playerOp = op; this.playerLoadout = loadout;
    this.player = new Player(this, op, side);
    this._equip(this.player.char, loadout, true);
    this.characters.push(this.player.char); this.scene.add(this.player.char.root);
    // teammates: remaining ops of the side; enemies: all ops of the other side
    const mates = Operators.filter(o => o.side === side && o.id !== op.id);
    const foes = Operators.filter(o => o.side === enemySide);
    const mk = (o) => { const b = new Bot(this, o, o.side, this.difficulty); const lo = this.app.menu.loadoutFor(o.id); this._equip(b.char, lo, false); this.bots.push(b); this.characters.push(b.char); this.scene.add(b.char.root); };
    mates.forEach(mk); foes.forEach(mk);
    this.hud.setOperator(op);
  }
  // Online: every peer builds the same roster in the same order (nid = index). Humans that are not me
  // become remote characters; bots are real AI on the host and remote characters on clients.
  setupTeamsNet(roster) {
    for (const c of this.characters) this.scene.remove(c.root);
    if (this.player) this.player.dispose();
    this.characters = []; this.bots = [];
    const myPid = this.net.myPid;
    roster.forEach((e, i) => {
      const op = OperatorById[e.op];
      let ch;
      if (e.pid === myPid) { this.player = new Player(this, op, e.side); ch = this.player.char; this.playerOp = op; this.playerLoadout = e.lo; this._equip(ch, e.lo, true); this.match.playerSide = e.side; }
      else if (e.human || this.net.isClient) { ch = new Character(this, op, e.side, false); ch.remote = true; ch.isHuman = !!e.human; ch.name = e.human ? e.name : op.name; ch.setWeapons([new Weapon(e.lo.primary, ch), new Weapon(e.lo.secondary, ch)]); ch.gadget2 = e.lo.gadget2; this.characters.push(ch); this.scene.add(ch.root); }
      else { const b = new Bot(this, op, e.side, this.difficulty); this._equip(b.char, e.lo, false); this.bots.push(b); ch = b.char; this.characters.push(ch); this.scene.add(ch.root); }
      ch.nid = i; ch.pid = e.pid || null; ch.side = e.side; ch.wantsDefuser = !!e.def;
      if (e.pid === myPid) { this.characters.push(ch); this.scene.add(ch.root); }
    });
    this.net.roster = roster;
    this.hud.setOperator(this.playerOp);
  }
  _equip(ch, lo, isPlayer) {
    const ws = [new Weapon(lo.primary, ch), new Weapon(lo.secondary, ch)];
    ch.gadget2 = lo.gadget2; ch.gadgetUses = 0; ch.gadget2Uses = 0;
    if (isPlayer) { this.player.setWeapons(ws); this._applySkin(); } else ch.setWeapons(ws);
  }
  _applySkin() {
    const skin = Skins.find(k => k.id === this.settings.skin) || Skins[0];
    const apply = (root) => root && root.traverse(o => { if (o.isMesh && o.material && o.material.map && !o.material.isShaderMaterial) { if (!o.userData.skinMat) { o.material = o.material.clone(); o.userData.skinMat = true; } o.material.color.setHex(skin.color); o.material.metalness = skin.metal; o.material.roughness = skin.rough; } });
    for (const [, g] of this.player.vmWeapons) apply(g.userData.inner);
    apply(this.player.char.tpWeapon);
  }
  // Campaign roster: the player, scripted teammates, enemies and extras (hostage, high-value target).
  // Bots may share operator bodies; each entry can override class, name, health and death rules.
  setupTeamsCampaign(spec) {
    for (const c of this.characters) this.scene.remove(c.root);
    if (this.player) this.player.dispose();
    this.characters = []; this.bots = [];
    const side = spec.player.side; const enemySide = side === 'atk' ? 'def' : 'atk';
    this.match.playerSide = side; this.playerOp = spec.player.op; this.playerLoadout = spec.player.loadout;
    this.player = new Player(this, spec.player.op, side);
    this._equip(this.player.char, spec.player.loadout, true);
    this.characters.push(this.player.char); this.scene.add(this.player.char.root);
    const mk = (e, s) => {
      const Cls = e.cls || Bot; const b = new Cls(this, e.op, s, e.diff || 'normal', ...(e.args || [])); const ch = b.char;
      if (e.loadout) this._equip(ch, e.loadout, false); else ch.setWeapons([]);
      if (e.name) ch.name = e.name; if (e.health) { ch.maxHealth = e.health; ch.health = e.health; }
      ch.noDBNO = !!e.noDBNO; ch.noTarget = !!e.noTarget; ch.campaignKind = e.kind || (s === side ? 'ally' : 'enemy');
      this.bots.push(b); this.characters.push(ch); this.scene.add(ch.root); return b;
    };
    this.allies = spec.allies.map(e => mk(e, side));
    this.enemies = spec.enemies.map(e => mk(e, enemySide));
    this.extras = (spec.extras || []).map(e => mk(e, e.kind === 'hostage' ? side : enemySide));
    this.hud.setOperator(spec.player.op);
  }
  teamPreview(side) {
    if (this.match.teamPreview) return this.match.teamPreview(side);
    const ids = Operators.filter(o => o.side === side);
    return ids.map(o => ({ name: o.name, icon: o.icon, you: this.playerOp && o.id === this.playerOp.id }));
  }

  spawnAll() {
    const M = this.match; const L = this.level; const site = M.site;
    const atkSpawn = L.spawns.atk[M.atkSpawnIdx !== undefined ? M.atkSpawnIdx : Math.floor(Math.random() * L.spawns.atk.length)];
    let ai = 0, di = 0;
    for (const c of this.characters) {
      if (!this.net) c.side = c.op.side; // fixed by operator
      if (c.side === 'atk') { const p = atkSpawn.points[ai++ % atkSpawn.points.length]; const yaw = Math.atan2(-(L.center.x - p.x), -(L.center.z - p.z)); if (c.isPlayer) this.player.spawn(p, yaw); else if (c.bot) c.bot.spawn(p, yaw); else { c.reset(p, yaw); c.setVisible(true); } }
      else { const p = this.findClearSpot(site.defSpawns[di++ % site.defSpawns.length]); const yaw = Math.random() * Math.PI * 2; if (c.isPlayer) this.player.spawn(p, yaw); else if (c.bot) c.bot.spawn(p, yaw); else { c.reset(p, yaw); c.setVisible(true); } }
      c.gadgetUses = 0; c.gadget2Uses = 0; c.hasDefuser = false; c.planting = 0; c.defusing = 0;
      if (c.bot) { c.bot.planBuilt = false; c.bot.plan = []; c.bot.atkPlan = null; c.bot.holdSpot = null; c.bot.coverSpot = null; c.bot.guardSpot = null; }
    }
    this.hud.refreshGadgets();
    this.applyQuality(); this.warmup();
    // attacker player: the preparation phase is played from the drone (two drones per round, like Siege)
    this.player.dronesLeft = 2; this.pings.length = 0;
    if (this.player.side === 'atk') this.enterDrone(atkSpawn.pos);
    this.hud.drone(this.player.usingDrone);
    this.audio.ambience(false);
  }
  // nearest nav node around p where a full body box fits
  findClearSpot(p) {
    const hw = 0.3, h = 1.75; const min = new THREE.Vector3(), max = new THREE.Vector3();
    const fits = (x, y, z) => { min.set(x - hw, y + 0.05, z - hw); max.set(x + hw, y + h, z + hw); return !this.world.overlaps(min, max); };
    let best = null, bestD = Infinity;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      const q = new THREE.Vector3(p.x + dx * 0.5, p.y, p.z + dz * 0.5); const n = this.nav.nearest(q, 0.3); if (!n) continue;
      const [x, z] = this.nav.center(n.ix, n.iz); if (!fits(x, n.y, z)) continue;
      const d = dx * dx + dz * dz; if (d < bestD) { bestD = d; best = new THREE.Vector3(x, n.y, z); }
    }
    return best || p.clone();
  }
  enterDrone(pos) {
    const P = this.player; if (P.drone) P.drone.dispose();
    const p = pos.clone(); p.y = 0.1; P.drone = new Drone(this, p, Math.atan2(-(this.level.center.x - p.x), -(this.level.center.z - p.z))); P.usingDrone = true; P.dronesLeft = Math.max(0, P.dronesLeft - 1); this.hud.drone(true);
    this.hud.toast('DRONE DEPLOYED — HOLD X TO IDENTIFY · Z TO PING', 3.5);
  }
  // throw out a fresh drone from the operator's hands (action phase)
  deployDrone() {
    const P = this.player; const C = P.char; if (P.dronesLeft <= 0) { this.hud.toast('NO DRONES LEFT', 1.5); return; }
    const fwd = C.forwardFlat(new THREE.Vector3()); const eye = C.eyePos(new THREE.Vector3());
    const h = this.world.raycast(eye, fwd, 1.0, { filter: c => c.solid }); const d = h ? Math.max(0.2, h.dist - 0.25) : 0.9;
    const p = C.pos.clone().addScaledVector(fwd, d); p.y = C.pos.y + 0.15;
    if (P.drone) P.drone.dispose();
    P.drone = new Drone(this, p, C.yaw); P.drone.vel.copy(fwd).multiplyScalar(3.5); P.drone.vel.y = 1.5;
    P.dronesLeft--; P.usingDrone = true; this.hud.drone(true); this.audio.click('ui'); this.hud.toast('DRONE DEPLOYED', 1.5); this.noise(C, 10);
  }
  exitDrone() { const P = this.player; P.usingDrone = false; this.hud.drone(false); }
  onActionPhase() {
    // attackers return to their operators; the drone stays in the world (5 / X to check it again, 6 for a new one)
    const P = this.player; if (P.usingDrone) this.exitDrone();
    if (P.side === 'atk') this.hud.toast('5 / X — DRONE VIEW · 6 — DEPLOY DRONE', 3);
    this.hud.refreshGadgets();
  }
  _droneControls() {
    const P = this.player; const M = this.match; const C = P.char;
    if (P.side === 'def') {
      if (C.dead || C.dbno) { if (P.usingCam) P.exitCam(); return; }
      if (P.usingCam) { if (Input.hit('droneExit')) { P.exitCam(); this.audio.click('back'); } return; }
      if (!P.interaction && Input.hit('drone')) P.enterCam(P._lastCam || 0);
      return;
    }
    if (P.side !== 'atk' || C.dead || C.dbno) { if (P.usingDrone) this.exitDrone(); return; }
    // drone phase (and drone-only missions): the operator stays put
    if (M.phase === 'prep' || M.lockDrone) { if (P.drone && !P.usingDrone) { P.usingDrone = true; this.hud.drone(true); } if (Input.hit('droneExit')) this.hud.toast(M.prepExitHint || 'OPERATORS DEPLOY WHEN THE ACTION PHASE STARTS', 1.6); return; }
    if (P.usingDrone) { if (Input.hit('droneExit')) { this.exitDrone(); this.audio.click('back'); } return; }
    if (P.interaction || P.rappel || P.vault) return;
    if (Input.hit('drone')) { if (P.drone && !P.drone.dead) { P.usingDrone = true; this.hud.drone(true); this.audio.click('ui'); } else if (P.dronesLeft > 0) this.deployDrone(); else this.hud.toast('NO DRONES LEFT', 1.5); }
    else if (Input.hit('deployDrone')) this.deployDrone();
  }
  // Contextual ping from a camera ray: enemy under the reticle → red "enemy spotted", otherwise a yellow world ping.
  ping(origin, dir, by) {
    if (this.net && this.net.isClient && by === this.player.char) { this.net.sendIntel({ op: 'ping', o: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z] }); return; }
    const max = 50; let best = null;
    for (const ch of this.characters) { if (ch.side === by.side || ch.dead) continue; const r = ch.raycast(origin, dir, max); if (r && (!best || r.dist < best.r.dist)) best = { ch, r }; }
    const h = this.world.raycast(origin, dir, max, { filter: c => c.solid || c.tag === 'glass' });
    if (best && (!h || h.dist > best.r.dist - 0.05)) {
      const ch = best.ch; const pos = ch.pos.clone(); pos.y += 1.3;
      this.pings.push({ kind: 'enemy', pos, t: 5, label: 'ENEMY', by });
      if (this.net && this.net.isHost) this.net.onPing('enemy', pos, 'ENEMY');
      this.audio.ping('enemy'); this.teamAlert(by.side, ch, ch.pos); if (by.isPlayer) this.hud.toast('ENEMY SPOTTED', 1.2);
    } else if (h) { const pos = h.point.clone().addScaledVector(h.normal, 0.05); this.pings.push({ kind: 'yellow', pos, t: 6, label: '', by }); if (this.net && this.net.isHost) this.net.onPing('yellow', pos, ''); this.audio.ping('yellow'); }
    else { const pos = origin.clone().addScaledVector(dir, 30); this.pings.push({ kind: 'yellow', pos, t: 4, label: '', by }); this.audio.ping('yellow'); }
  }
  // Drone identification: the enemy is marked live for the whole team for a few seconds.
  identify(ch, by) {
    if (this.net && this.net.isClient && by === this.player.char) { this.net.sendIntel({ op: 'ident', n: ch.nid }); ch.pingedUntil = this.time + 3.5; this.audio.identify(); this.hud.toast('IDENTIFIED — ' + ch.name, 1.8); return; }
    ch.pingedUntil = this.time + 3.5; ch.identifiedT = this.time; if (this.net && this.net.isHost) this.net.onIdentify(ch);
    this.audio.identify(); this.teamAlert(by.side, ch, ch.pos);
    if (by.isPlayer) this.hud.toast('IDENTIFIED — ' + ch.name, 1.8);
    if (by.isPlayer && this.match.onIdentify) this.match.onIdentify(ch, by);
  }

  // ---------- interactions ----------
  getInteractions(C, camera, reach = 2.3) {
    const out = []; const M = this.match; const eye = camera.getWorldPosition(_v).clone(); const dir = camera.getWorldDirection(_v2).clone(); const say = (t) => { if (C.isPlayer) this.hud.toast(t); else if (this.net) this.net.toast(C, t); };
    if (C.dbno || C.dead) return out;
    // mission objectives (campaign) come first
    if (M.interactions) out.push(...M.interactions(C, eye, dir));
    // revive
    for (const t of this.characters) { if (t.side === C.side && t.dbno && !t.dead && t !== C && t.pos.distanceTo(C.pos) < 1.7) { out.push({ label: 'REVIVE ' + t.name, dur: 5, net: ['revive', t.nid], start: () => { t.reviver = C; }, done: () => { t.revive(); t.reviver = null; C.score += 50; }, cancel: () => { t.reviver = null; } }); break; } }
    // defuser
    const typing = (mesh) => (out) => { M.defuserHandPoint(mesh, out); out.y += 0.04 + Math.abs(Math.sin(this.time * 9)) * 0.05; out.x += Math.sin(this.time * 3.1) * 0.03; out.z += Math.cos(this.time * 2.3) * 0.03; return out; };
    const b = M.canPlant(C); if (b) out.push({ label: 'PLANT DEFUSER', dur: M.s.plantTime, crouch: true, net: ['plant', b.label], start: () => { C.planting = 0.001; C.plantSound = this.audio.tool('plant', C.pos, M.s.plantTime); this.noise(C, 40); M.placeDevice(C); }, hand: (o) => C.plantDevice ? typing(C.plantDevice)(o) : o.copy(C.pos), done: () => { M._plant(C, b); }, cancel: () => { M.cancelPlant(C); if (C.plantSound) C.plantSound(); } });
    if (M.canDefuse(C)) out.push({ label: 'DISABLE DEFUSER', dur: M.s.defuseTime, crouch: true, net: ['defuse', 0], start: () => { this._defuseStop = this.audio.tool('defuse', M.defuser.pos, M.s.defuseTime); }, hand: (o) => typing(M.defuser.mesh)(o), done: () => { C.score += 100; M.endRound(M.defTeam, 'DEFUSER DISABLED'); }, cancel: () => { this._defuseStop && this._defuseStop(); } });
    if (M.defuserDropped && C.side === 'atk' && M.defuserDropped.pos.distanceTo(C.pos) < 1.6) out.push({ label: 'PICK UP DEFUSER', dur: 0, net: ['pickup', 0], done: () => { M.pickupDefuser(C); this.hud.refreshGadgets(); } });
    // armor pack
    for (const e of this.gadgets.entities) { if (e.type === 'rook' && !e.dead && e.side === C.side && !C.armorPlate && e.pos.distanceTo(C.pos) < 1.6) { out.push({ label: 'TAKE ARMOR PLATE', dur: 0.8, net: ['armor', e.nid || 0], done: () => { e.take(C); say('ARMOR PLATE EQUIPPED'); } }); break; } }
    // level
    const its = this.level.findInteractable(eye, dir, C.side, reach);
    for (const it of its) {
      if (it.type === 'reinforce' && M.reinforcementsLeft > 0 && (M.phase === 'prep' || M.phase === 'action' || M.phase === 'planted')) { out.push({ label: 'REINFORCE WALL', dur: 5, net: ['reinforce', it.wall.id], start: () => { it.stop = this.audio.tool('reinforce', it.wall.center, 5); }, done: () => { M.reinforce(it.wall, C); this.effects.impact(it.point, it.normal, 'metal'); }, cancel: () => it.stop && it.stop() }); break; }
      if (it.type === 'barricade') { const b = it.slot.barricade; out.push({ label: 'BARRICADE', dur: BARRICADE_BUILD_TIME, net: ['barricade', this.level.barricadeSlots.indexOf(it.slot)], localDone: true, start: () => { b.beginBuild(C.pos, true); this.noise(C, 20); }, progress: (t, dt) => b.setProgress(t, dt), hand: (out) => b.handPoint(out), done: () => { b.finish(); }, cancel: () => b.cancelBuild() }); break; }
      if (it.type === 'hatchReinforce' && M.reinforcementsLeft > 0) { out.push({ label: 'REINFORCE HATCH', dur: 3.5, net: ['hatchReinforce', this.level.hatches.indexOf(it.hatch)], start: () => { it.stop = this.audio.tool('reinforce', it.hatch.center, 3.5); }, done: () => { if (it.hatch.reinforce()) { M.reinforcementsLeft--; this.hud.refreshGadgets(); } }, cancel: () => it.stop && it.stop() }); break; }
    }
    return out;
  }

  // ---------- events ----------
  onDeath(victim, killer, headshot) {
    const w = killer && killer.weapon ? killer.weapon.def.name : '';
    if (this.net && this.net.isHost) this.net.onDeath(victim, killer, headshot, w);
    this.hud.feed(killer, victim, w, headshot);
    if (victim.hasDefuser) this.match.dropDefuser(victim);
    if (victim.isPlayer) { this.stats.deaths++; this.hud.big('YOU WERE KILLED', killer ? 'BY ' + killer.name : '', 3); this.player.dead = true; this.player._deathT = 0; this.hud.prompt(null); this.hud.progress(-1); if (this.player.interaction) this.player._cancelInteraction(); }
    if (killer && killer.isPlayer) { this.stats.kills++; if (headshot) this.stats.headshots++; this.hud.hitmarker(true, headshot); }
    victim.reviver = null;
    this.noise(victim, 12);
    if (this.match.onDeath) this.match.onDeath(victim, killer, headshot);
  }
  onDBNO(victim, attacker) {
    if (this.match.onDBNO) this.match.onDBNO(victim, attacker);
    if (this.net && this.net.isHost) this.net.onDBNO(victim, attacker, attacker && attacker.weapon ? attacker.weapon.def.name : '');
    this.hud.feed(attacker, { name: victim.name + ' (DOWNED)', side: victim.side }, attacker && attacker.weapon ? attacker.weapon.def.name : '', false);
    if (victim.hasDefuser) this.match.dropDefuser(victim);
    if (victim.isPlayer) { this.hud.big('DOWNED', 'CRAWL TO SAFETY — WAIT FOR REVIVE', 3); if (this.player.interaction) this.player._cancelInteraction(); this.player.adsBlend = 0; }
    if (attacker && attacker.isPlayer) this.hud.hitmarker(true, false);
    if (victim.bot) victim.bot.stop();
  }
  onRevived(ch) { if (ch.isPlayer) this.hud.toast('REVIVED'); if (this.net && this.net.isHost) this.net.onRevive(ch); }
  onPlayerHit(target, zone, dmg) { this.stats.hits++; this.hud.hitmarker(false, zone === 'head'); }
  onPlayerShot(w) { this.stats.shots++; }
  onPlayerDamaged(attacker) { if (this.match.onPlayerDamaged) this.match.onPlayerDamaged(attacker); }
  teamAlert(side, enemy, pos) { for (const b of this.bots) if (b.char.side === side && !b.char.dead) b.callout(enemy, pos); }
  noise(source, loud) { if (!source) return; for (const b of this.bots) if (b.char.side !== source.side) b.hear(source.pos, loud); }

  onRoundEnd(playerWon, reason) {
    const M = this.match;
    this.app.roundEnd(playerWon, reason, M);
    Input.unlock();
  }
  onOperatorSelect() { if (this.net && this.net.isHost) { Net.broadcast({ t: 'opselect', round: this.match.round }); } this.app.operatorSelectRound(); }
  onSideSwap() { this.hud.toast('SIDES SWAPPED', 3); }
  onMatchEnd(playerWon) { this.over = true; this.app.matchEnd(playerWon, this.match, this.stats); }
  // Online client: the host says the round is over → operator select
  netOpSelect() { if (this.match.phase === 'matchEnd') return; this.match.netNextRound(); }

  // ---------- frame ----------
  update(dt) {
    if (this.paused || this.over) return;
    this.time += dt;
    const M = this.match; M.update(dt);
    // intro fly-over (campaign): only the camera moves, but the light budget must still apply
    if (M.cinematic) { this._cullLights(dt); this.effects.update(dt, this.camera); return; }
    if (M.phase === 'opselect' || M.phase === 'matchEnd') return;
    const P = this.player;
    // drone toggle
    this._droneControls();
    for (let i = this.pings.length - 1; i >= 0; i--) { const pg = this.pings[i]; pg.t -= dt; if (pg.t <= 0) this.pings.splice(i, 1); }
    // operator ping (M): the drone handles its own
    if (!P.usingDrone && !P.char.dead && !P.char.dbno && Input.pressed.has('KeyM') && this.time - (this._pingT || -9) > 0.6) { this._pingT = this.time; this.ping(this.camera.getWorldPosition(new THREE.Vector3()), this.camera.getWorldDirection(new THREE.Vector3()), P.char); }
    if (Input.hit('scoreboard')) this.hud.scoreboard(true); if (Input.up('scoreboard')) this.hud.scoreboard(false);
    this.nav.flush();
    this._cullLights(dt);
    P.update(dt);
    for (const b of this.bots) b.update(dt);
    if (!(this.net && this.net.isClient)) this._separate();
    if (this.net) this.net.tick(dt);
    this.gadgets.update(dt);
    // trapped players stay put; wire slow decay
    P.char.wire = Math.max(0, P.char.wire - dt);
    this.effects.update(dt, this.camera);
    // audio listener
    const fwd = this.camera.getWorldDirection(_v); const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.audio.updateListener(this.camera.position, fwd, up); this.audio.interior = this.level.isInterior(this.camera.position);
    this._ambT = (this._ambT || 0) + dt; if (this._ambT > 1) { this._ambT = 0; this.audio.ambience(this.audio.interior); }
    this.hud.update(dt);
    if (M.site) for (const b of M.site.bombs) if (b.device && b.armed !== false) { const on = Math.sin(this.time * 4 + (b.label === 'A' ? 0 : 1.5)) > 0.6; b.device.userData.led.material.emissiveIntensity = on ? 5 : 0.4; b.device.userData.light.intensity = on ? 1.6 : 0.15; }
    // defuser led blink
    if (M.defuser) { const led = M.defuser.mesh.userData.led; if (led) led.material.emissiveIntensity = (Math.sin(this.time * (6 + (1 - M.timeLeft / M.s.bombTime) * 20)) > 0) ? 5 : 0.3; }
  }
  // Keep characters from standing inside each other (no rigid body collision between them).
  _separate() {
    const cs = this.characters; const R = 0.62;
    for (let i = 0; i < cs.length; i++) { const a = cs[i]; if (a.dead || a.dbno) continue;
      for (let j = i + 1; j < cs.length; j++) { const b = cs[j]; if (b.dead || b.dbno) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z; const d = Math.hypot(dx, dz); if (d >= R || d < 1e-4) continue;
        const push = (R - d) * 0.5; const nx = dx / d, nz = dz / d;
        const wa = a.isPlayer ? 0.35 : 1, wb = b.isPlayer ? 0.35 : 1; const s = wa + wb;
        a.pos.x -= nx * push * (wa / s) * 2; a.pos.z -= nz * push * (wa / s) * 2; b.pos.x += nx * push * (wb / s) * 2; b.pos.z += nz * push * (wb / s) * 2;
      }
    }
  }
  // Only the nearest N point lights are active; the count stays constant so three.js keeps one shader program.
  _cullLights(dt) {
    this._lightT = (this._lightT || 0) - dt; if (this._lightT > 0) return; this._lightT = 0.2;
    const N = this.lightBudget || 8; const cam = this.camera.position; const L = this.level.lights;
    for (const l of L) l._d = l.position.distanceToSquared(cam) * (Math.abs(l.position.y - cam.y) > 3.2 ? 2.5 : 1);
    const sorted = L.slice().sort((a, b) => a._d - b._d);
    for (let i = 0; i < sorted.length; i++) sorted[i].visible = i < N;
  }
  render() {
    const P = this.player;
    // viewmodel camera mirrors the main camera
    this.vmCamera.position.copy(this.camera.position); this.vmCamera.quaternion.copy(this.camera.quaternion); this.vmCamera.fov = P ? P.vmFov : 55; this.vmCamera.updateProjectionMatrix(); this.vmCamera.updateMatrixWorld(true);
    if (P) { P._vmCamera = this.vmCamera; P.renderScope(this.renderer, this.scene); }
    this.sky.position.copy(this.camera.position);
    this._frame = (this._frame || 0) + 1; if (this._frame % (this._shadowEvery || 1) === 0) this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
  }
  dispose() {
    for (const c of this.characters) this.scene.remove(c.root);
    if (this.player) { this.player.dispose(); if (this.player.drone) this.player.drone.dispose(); }
    this.hud.dispose(); this.audio.stopAmbience();
    this.renderer.toneMappingExposure = TIME_OF_DAY.day.exposure;
    this.composer.dispose && this.composer.dispose();
  }
}
