import { CARDS, SPREADS } from './tarot-data.js';

const STORAGE_KEY = 'tarot-table-records-v1';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function localDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function readRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(record => record && SPREADS[record.spread] && Array.isArray(record.cards)
      && record.cards.length === SPREADS[record.spread].pos.length
      && record.cards.every(card => Number.isInteger(card.id) && card.id >= 0 && card.id < CARDS.length))
      .slice(-100);
  } catch { return []; }
}

function saveRecords(records) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-100))); } catch { /* Private mode may block storage. */ }
}

// Rejection sampling avoids modulo bias when shuffling 78 cards.
function randomInt(max) {
  const ceiling = Math.floor(0x100000000 / max) * max;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= ceiling);
  return value[0] % max;
}

function shuffledDeck() {
  const deck = CARDS.map(card => ({ id: card.id, rev: randomInt(100) < 35 }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardHtml(card, revealed = false, interactive = false) {
  const name = CARDS[card.id].zh;
  const tag = interactive ? 'button' : 'div';
  return `<${tag} ${interactive ? 'type="button" data-reveal="true" aria-label="翻开' + escapeHtml(name) + '"' : ''}
    class="card${revealed ? ' is-revealed' : ''}${card.rev ? ' is-reversed' : ''}">
    <span class="card-inner"><span class="card-back" aria-hidden="true"></span>
      <span class="card-front"><img src="./cards/${card.id}.webp" alt="${escapeHtml(name)}" loading="lazy"></span>
    </span></${tag}>`;
}

function backHtml() {
  return '<div class="card"><span class="card-inner"><span class="card-back"></span></span></div>';
}

const state = { spread: 'daily', stage: 'intro', question: '', deck: [], picks: [], record: null,
  revealed: new Set(), records: readRecords() };

function dailyRecord() {
  return state.records.findLast?.(record => record.spread === 'daily' && record.day === localDay())
    || [...state.records].reverse().find(record => record.spread === 'daily' && record.day === localDay());
}

function renderTabs() {
  const labels = { daily: 'DAILY', one: 'ONE CARD', three: 'THREE CARDS', relationship: 'RELATIONSHIP' };
  $('#spread-tabs').innerHTML = Object.entries(SPREADS).map(([key, spread]) => `
    <button class="spread-tab" type="button" role="tab" data-spread="${key}" aria-selected="${state.spread === key}">
      <b>${escapeHtml(spread.name)}</b><small>${labels[key]}</small>
    </button>`).join('');
}

function renderHistory() {
  const entries = [...state.records].reverse().slice(0, 6);
  $('#history').innerHTML = entries.length ? entries.map(record => {
    const index = state.records.indexOf(record);
    const names = record.cards.map(item => CARDS[item.id].zh).join(' · ');
    return `<button type="button" class="history-item" data-history="${index}">
      <small>${escapeHtml(record.day)} · ${escapeHtml(SPREADS[record.spread].name)}</small>
      <span>${escapeHtml(names)}</span></button>`;
  }).join('') : '<p class="history-empty">还没有记录。第一张牌，等你自己来翻。</p>';
}

function renderIntro() {
  const current = state.spread === 'daily' ? dailyRecord() : null;
  if (current) {
    state.record = current;
    state.stage = 'result';
    return renderResult();
  }
  const spread = SPREADS[state.spread];
  const copy = state.spread === 'daily' ? '今天只抽一次。选好以后，牌会留在这台浏览器里。'
    : `这组牌有 ${spread.pos.length} 张。问题可以写下来，也可以只放在心里。`;
  $('#table').innerHTML = `<p class="stage-label">THE DECK IS WAITING</p>
    <h2>${escapeHtml(spread.name)}</h2><p class="table-lead">${copy}</p>
    <div class="deck-preview" aria-hidden="true">${backHtml().repeat(3)}</div>
    ${state.spread === 'daily' ? '' : `<div class="question-wrap"><label for="question">想问什么？（可选）</label>
      <input id="question" maxlength="200" placeholder="把问题留在这里，或者留在心里" value="${escapeHtml(state.question)}"></div>`}
    <button type="button" class="primary" data-action="begin">洗牌，开始抽</button>`;
}

function slotHtml(card, position, index, reveal = false) {
  return `<div class="slot" data-slot="${index}">
    ${card ? cardHtml(card, false, reveal) : '<div class="empty-slot" aria-hidden="true">✧</div>'}
    <span class="slot-name">${escapeHtml(position)}</span></div>`;
}

function renderPicking(scrollLeft = null) {
  const positions = SPREADS[state.spread].pos;
  const used = new Set(state.picks.map(item => item.index));
  $('#table').innerHTML = `<p class="stage-label">CHOOSE YOUR CARDS</p>
    <h2>凭感觉，摸 ${positions.length - state.picks.length} 张</h2>
    <p class="selection-title">牌面先扣着。选完以后，再一张张翻开。</p>
    <div class="slots">${positions.map((pos, index) => slotHtml(state.picks[index]?.card, pos, index)).join('')}</div>
    <div class="fan-wrap"><p class="fan-caption">向左右滑动牌列，点一张带走</p>
      <div class="fan" id="fan" aria-label="待抽的牌">${state.deck.map((card, index) => `
        <button type="button" class="fan-card" data-pick="${index}" aria-label="选择第 ${index + 1} 张扣着的牌"
          style="--tilt:${(index % 7 - 3) * 1.2}deg" ${used.has(index) ? 'disabled' : ''}>${backHtml()}</button>`).join('')}</div></div>`;
  const fan = $('#fan');
  fan.scrollLeft = scrollLeft ?? (fan.scrollWidth - fan.clientWidth) / 2;
}

function renderReveal() {
  const positions = SPREADS[state.spread].pos;
  $('#table').innerHTML = `<p class="stage-label">THE CARDS ARE YOURS</p>
    <h2>一张张翻开</h2><p class="table-lead">看一眼图案，看看它让你想到什么。</p>
    <div class="slots">${positions.map((pos, index) => slotHtml(state.picks[index].card, pos, index, true)).join('')}</div>
    <p class="reveal-tip" id="reveal-tip">点牌翻开 · ${positions.length} 张还扣着</p>`;
}

function resultText(record) {
  const rows = [`${SPREADS[record.spread].name}${record.q ? ' · ' + record.q : ''}`];
  record.cards.forEach(item => {
    const card = CARDS[item.id];
    rows.push(`${item.pos}：${card.zh}${item.rev ? '（逆位）' : '（正位）'} — ${item.rev ? card.rev : card.up}`);
  });
  return rows.join('\n');
}

function renderResult() {
  const record = state.record;
  if (!record) return renderIntro();
  $('#table').innerHTML = `<p class="stage-label">YOUR READING</p>
    <h2>${escapeHtml(SPREADS[record.spread].name)}</h2>
    ${record.q ? `<p class="result-question">「${escapeHtml(record.q)}」</p>` : ''}
    <div class="result-cards">${record.cards.map(item => `<div class="result-card">
      ${cardHtml(item, true)}<span class="pos">${escapeHtml(item.pos)}</span>
      <b>${escapeHtml(CARDS[item.id].zh)}${item.rev ? ' · 逆位' : ''}</b></div>`).join('')}</div>
    <div class="interpretation">${record.cards.map(item => {
      const card = CARDS[item.id];
      return `<div class="meaning"><small>${escapeHtml(item.pos)}</small><h3>${escapeHtml(card.zh)} · ${item.rev ? '逆位' : '正位'}</h3>
        <p>${escapeHtml(item.rev ? card.rev : card.up)}</p></div>`;
    }).join('')}</div>
    <p class="result-footnote">牌面只是一个角度，不替你做决定。</p>
    <div class="actions"><button type="button" class="secondary" data-action="copy">复制这组牌</button>
      ${record.spread === 'daily' && dailyRecord() ? '' : '<button type="button" class="primary" data-action="again">再抽一次</button>'}</div>
    <p id="copy-status" class="result-footnote" role="status" aria-live="polite"></p>`;
}

function render() {
  renderTabs();
  if (state.stage === 'intro') renderIntro();
  else if (state.stage === 'picking') renderPicking();
  else if (state.stage === 'reveal') renderReveal();
  else renderResult();
  renderHistory();
}

function chooseSpread(key) {
  if (!SPREADS[key]) return;
  state.spread = key;
  state.stage = 'intro';
  state.question = '';
  state.record = null;
  render();
}

function begin() {
  if (state.spread === 'daily' && dailyRecord()) return chooseSpread('daily');
  state.question = $('#question')?.value.trim() || '';
  state.deck = shuffledDeck();
  state.picks = [];
  state.record = null;
  state.stage = 'picking';
  render();
}

function pick(index) {
  if (state.stage !== 'picking' || !Number.isInteger(index) || index < 0 || index >= state.deck.length
      || state.picks.some(item => item.index === index)) return;
  const position = SPREADS[state.spread].pos[state.picks.length];
  state.picks.push({ index, card: { ...state.deck[index], pos: position } });
  if (state.picks.length === SPREADS[state.spread].pos.length) {
    state.record = { id: crypto.randomUUID?.() || `${Date.now()}-${randomInt(100000)}`,
      at: new Date().toISOString(), day: localDay(), spread: state.spread, q: state.question,
      cards: state.picks.map(item => item.card) };
    state.records.push(state.record);
    state.records = state.records.slice(-100);
    saveRecords(state.records);
    state.revealed.clear();
    state.stage = 'reveal';
    render();
  } else {
    const scrollLeft = $('#fan')?.scrollLeft ?? 0;
    renderPicking(scrollLeft);
  }
}

function reveal(index) {
  if (state.stage !== 'reveal' || state.revealed.has(index)) return;
  const slot = $(`[data-slot="${index}"]`);
  if (!slot) return;
  slot.querySelector('.card')?.classList.add('is-revealed');
  slot.querySelector('.card')?.setAttribute('aria-label', `${CARDS[state.picks[index].card.id].zh} 已翻开`);
  state.revealed.add(index);
  $('#reveal-tip').textContent = `${SPREADS[state.spread].pos.length - state.revealed.size} 张还扣着`;
  if (state.revealed.size === state.picks.length) {
    setTimeout(() => { if (state.stage === 'reveal') { state.stage = 'result'; render(); } }, 850);
  }
}

async function copyResult() {
  const text = resultText(state.record);
  try {
    await navigator.clipboard.writeText(text);
    $('#copy-status').textContent = '已复制，可以带走。';
  } catch {
    const field = document.createElement('textarea');
    field.value = text; field.style.position = 'fixed'; field.style.opacity = '0';
    document.body.append(field); field.select();
    const copied = document.execCommand('copy'); field.remove();
    $('#copy-status').textContent = copied ? '已复制，可以带走。' : '复制没有成功，请手动选取文字。';
  }
}

$('#spread-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-spread]');
  if (tab) chooseSpread(tab.dataset.spread);
});
$('#table').addEventListener('click', event => {
  const pickButton = event.target.closest('[data-pick]');
  if (pickButton) return pick(Number(pickButton.dataset.pick));
  const revealButton = event.target.closest('[data-reveal]');
  if (revealButton) return reveal(Number(revealButton.closest('[data-slot]').dataset.slot));
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'begin') begin();
  if (action === 'copy') copyResult();
  if (action === 'again') { state.stage = 'intro'; state.record = null; render(); }
});
$('#history').addEventListener('click', event => {
  const index = Number(event.target.closest('[data-history]')?.dataset.history);
  if (!Number.isInteger(index) || !state.records[index]) return;
  state.record = state.records[index];
  state.spread = state.record.spread;
  state.stage = 'result';
  render();
  $('#table').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
render();
