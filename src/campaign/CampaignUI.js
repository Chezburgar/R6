import { CAMPAIGN, MISSIONS, MissionById, DIFFICULTIES } from './Story.js';
import { OperatorById } from '../data/operators.js';
import { icon } from '../ui/Icons.js';
import { AudioEngine } from '../core/AudioEngine.js';

// Campaign front-end: the mission select page, briefing / debrief overlays and the saved progress.

const TYPE_NAMES = { recon: 'RECON', assault: 'ASSAULT', defend: 'DEFENCE', hvt: 'HIGH-VALUE TARGET', hostage: 'HOSTAGE RESCUE', defuse: 'DEVICE DISPOSAL' };
const TOD_NAMES = { night: 'NIGHT', dawn: 'DAWN', day: 'DAY', dusk: 'DUSK' };
const fmt = t => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
const stars = n => `<span class="stars">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;

export function campaignState(settings) {
  if (!settings.campaign) settings.campaign = { difficulty: 'normal', progress: {}, selected: MISSIONS[0].id };
  const c = settings.campaign; if (!c.progress) c.progress = {}; if (!c.difficulty) c.difficulty = 'normal'; if (!c.selected) c.selected = MISSIONS[0].id;
  return c;
}
export function missionUnlocked(c, idx) { if (idx <= 0) return true; const prev = c.progress[MISSIONS[idx - 1].id]; return !!(prev && prev.done); }
export function campaignComplete(c) { return MISSIONS.every(m => c.progress[m.id] && c.progress[m.id].done); }

export class CampaignUI {
  constructor(app) { this.app = app; }
  get state() { return campaignState(this.app.settings); }
  selectedFeatured() { const m = MissionById[this.state.selected] || MISSIONS[0]; return m.featured; }

  // ---------- mission select page ----------
  pageHTML() {
    const c = this.state; const sel = MissionById[c.selected] || MISSIONS[0]; const selIdx = MISSIONS.indexOf(sel);
    const done = MISSIONS.filter(m => c.progress[m.id] && c.progress[m.id].done).length;
    const total = MISSIONS.reduce((a, m) => a + ((c.progress[m.id] && c.progress[m.id].stars) || 0), 0);
    const list = MISSIONS.map((m, i) => { const p = c.progress[m.id]; const un = missionUnlocked(c, i); return `<button class="mission ${m.id === sel.id ? 'sel' : ''} ${un ? '' : 'locked'} ${p && p.done ? 'done' : ''}" data-mission="${m.id}"><span class="code">${m.code}</span><span class="name">${m.name}</span><span class="type">${TYPE_NAMES[m.type]}</span>${un ? stars(p ? p.stars : 0) : '<span class="lock">LOCKED</span>'}</button>`; }).join('');
    const p = c.progress[sel.id]; const un = missionUnlocked(c, selIdx);
    const op = OperatorById[sel.featured];
    return `<div class="h1">CAMPAIGN</div>
      <div class="camp-wrap">
        <div class="camp-list">
          <div class="camp-head"><div class="t">${CAMPAIGN.title}</div><div class="s">${CAMPAIGN.tagline}</div><div class="p">${done} / ${MISSIONS.length} MISSIONS · ${total} / ${MISSIONS.length * 3} STARS</div></div>
          <div class="camp-diff"><span class="label">DIFFICULTY</span><div class="seg" data-cdiff>${DIFFICULTIES.map(([v, l]) => `<button data-v="${v}" class="${c.difficulty === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          ${list}
          <div class="camp-links"><button class="btn" data-action="prologue">PROLOGUE</button>${campaignComplete(c) ? '<button class="btn" data-action="epilogue">EPILOGUE</button>' : ''}<button class="btn danger" data-action="resetCampaign">RESET</button></div>
        </div>
        <div class="camp-detail panel">
          <div class="code">${sel.code} · ${TYPE_NAMES[sel.type]} · ${TOD_NAMES[sel.tod]} ${sel.clock}</div>
          <h2>${sel.name}</h2>
          <div class="loc">${sel.location}</div>
          <p class="summary">${sel.summary}</p>
          <div class="cols">
            <div><div class="label">OBJECTIVES</div><ul>${sel.objectives.map(o => `<li>${o.text}</li>`).join('')}</ul></div>
            <div><div class="label">INTEL</div><ul>${sel.intel.map(t => `<li>${t}</li>`).join('')}</ul></div>
          </div>
          <div class="cols">
            <div><div class="label">TEAM</div><div class="team"><div class="mini you" title="${op.name}">${icon(op.icon)}</div>${sel.allies.map(id => `<div class="mini" title="${OperatorById[id].name}">${icon(OperatorById[id].icon)}</div>`).join('')}<span class="value" style="font-size:12px;color:#9aa0aa">${sel.side === 'atk' ? 'ATTACK' : 'DEFEND'} · ${op.name} RECOMMENDED</span></div></div>
            <div><div class="label">STARS</div><div class="value" style="font-size:12px;line-height:1.7;color:#c5c9d1">Complete the mission · Under ${fmt(sel.par)} · ${sel.bonus.text}</div></div>
          </div>
          <div class="best">${p && p.done ? `BEST ${fmt(p.bestTime)} · ${p.kills} KILLS · ${stars(p.stars)}` : un ? 'NOT YET COMPLETED' : 'COMPLETE THE PREVIOUS MISSION TO UNLOCK'}</div>
          <div class="play-actions" style="grid-column:auto"><button class="btn" data-page="operators">LOADOUTS</button><button class="btn primary" data-action="briefing" ${un ? '' : 'disabled'}>BRIEFING</button></div>
        </div>
      </div>`;
  }
  bind(E) {
    const c = this.state;
    E.querySelectorAll('[data-mission]').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); c.selected = b.dataset.mission; this.app.saveSettings(); this.app.menu.render(); }));
    E.querySelectorAll('[data-cdiff] button').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); c.difficulty = b.dataset.v; this.app.saveSettings(); this.app.menu.render(); }));
  }
  action(a) {
    const c = this.state;
    if (a === 'briefing') this.openBriefing(c.selected);
    else if (a === 'prologue') this.openStory(CAMPAIGN.title, CAMPAIGN.prologue, [{ label: 'CLOSE', primary: true, fn: () => this.app.closeOverlay() }]);
    else if (a === 'epilogue') this.openStory('EPILOGUE', CAMPAIGN.epilogue, [{ label: 'CLOSE', primary: true, fn: () => this.app.closeOverlay() }]);
    else if (a === 'resetCampaign') this.app.overlay('RESET CAMPAIGN', '<p style="font-family:var(--font);color:#c5c9d1">Clear all mission progress and stars?</p>', [{ label: 'RESET', danger: true, fn: () => { this.app.settings.campaign = null; campaignState(this.app.settings); this.app.saveSettings(); this.app.closeOverlay(); this.app.menu.render(); } }, { label: 'CANCEL', primary: true, fn: () => this.app.closeOverlay() }]);
    else return false;
    return true;
  }
  openStory(title, paras, actions) { this.app.overlay(title, `<div class="story">${paras.map(p => `<p>${p}</p>`).join('')}</div>`, actions); }

  // ---------- briefing ----------
  openBriefing(id) {
    const m = MissionById[id]; if (!m) return; const idx = MISSIONS.indexOf(m);
    if (!missionUnlocked(this.state, idx)) return;
    const html = `<div class="brief">
        <div class="meta"><span>${TYPE_NAMES[m.type]}</span><span>${m.location}</span><span>${TOD_NAMES[m.tod]} · ${m.clock} LOCAL</span><span>${DIFFICULTIES.find(d => d[0] === this.state.difficulty)[1]}</span></div>
        <div class="story">${m.brief.map(p => `<p>${p}</p>`).join('')}</div>
        <div class="cols"><div><div class="label">OBJECTIVES</div><ol>${m.objectives.map(o => `<li>${o.text}</li>`).join('')}</ol></div><div><div class="label">INTEL</div><ul>${m.intel.map(t => `<li>${t}</li>`).join('')}</ul><div class="label" style="margin-top:10px">BONUS STAR</div><div class="value" style="font-size:13px">${m.bonus.text}</div></div></div>
      </div>`;
    this.app.overlay(m.code + ' — ' + m.name, html, [{ label: 'BACK', fn: () => this.app.closeOverlay() }, { label: 'DEPLOY', primary: true, fn: () => { this.app.closeOverlay(); this.app.startCampaignMission(m.id); } }]);
  }

  // ---------- debrief ----------
  record(result) {
    const c = this.state; const m = result.mission; const p = c.progress[m.id] || (c.progress[m.id] = { done: false, stars: 0, bestTime: Infinity, kills: 0, attempts: 0 });
    p.attempts++;
    if (result.success) { p.done = true; p.stars = Math.max(p.stars, result.stars); p.bestTime = Math.min(p.bestTime, result.time); p.kills = Math.max(p.kills, result.kills); const next = MISSIONS[MISSIONS.indexOf(m) + 1]; if (next) c.selected = next.id; }
    const renown = result.success ? 400 + result.stars * 150 + result.kills * 25 : 50 + result.kills * 25;
    this.app.settings.renown += renown; this.app.saveSettings();
    return renown;
  }
  openDebrief(result) {
    const m = result.mission; const renown = this.record(result); const idx = MISSIONS.indexOf(m); const next = MISSIONS[idx + 1];
    const acc = result.shots ? Math.round(result.hits / result.shots * 100) : 0;
    const html = `<div class="debrief ${result.success ? 'win' : 'lose'}">
        <div class="verdict">${result.success ? 'MISSION COMPLETE' : 'MISSION FAILED'}<small>${result.reason}</small></div>
        ${result.success ? `<div class="bigstars">${stars(result.stars)}</div>` : ''}
        <div class="grid">
          <div><div class="label">TIME</div><div class="value">${fmt(result.time)} <small style="color:#9aa0aa">/ PAR ${fmt(m.par)}</small></div></div>
          <div><div class="label">KILLS</div><div class="value">${result.kills}</div></div>
          <div><div class="label">ACCURACY</div><div class="value">${acc}% <small style="color:#9aa0aa">${result.hits} / ${result.shots}</small></div></div>
          <div><div class="label">HEADSHOTS</div><div class="value">${result.headshots}</div></div>
          <div><div class="label">TEAMMATES LOST</div><div class="value">${result.allyDeaths}</div></div>
          <div><div class="label">RENOWN</div><div class="value">+${renown}</div></div>
        </div>
        ${result.success ? `<div class="starlist"><div class="${true ? 'on' : ''}">★ Mission complete</div><div class="${result.time <= m.par ? 'on' : ''}">★ Under par time (${fmt(m.par)})</div><div class="${result.bonus ? 'on' : ''}">★ ${m.bonus.text}</div></div>` : ''}
      </div>`;
    const actions = [];
    if (result.success && next) actions.push({ label: 'NEXT MISSION', primary: true, fn: () => { this.app.leaveMatch('campaign'); this.openBriefing(next.id); } });
    if (result.success && !next) actions.push({ label: 'EPILOGUE', primary: true, fn: () => { this.app.leaveMatch('campaign'); this.openStory('EPILOGUE', CAMPAIGN.epilogue, [{ label: 'CLOSE', primary: true, fn: () => this.app.closeOverlay() }]); } });
    actions.push({ label: result.success ? 'REPLAY' : 'RETRY', primary: !result.success, fn: () => { this.app.leaveMatch('campaign'); this.app.startCampaignMission(m.id); } });
    actions.push({ label: 'CAMPAIGN MENU', fn: () => this.app.leaveMatch('campaign') });
    this.app.overlay(m.code + ' — ' + m.name, html, actions);
  }
}
