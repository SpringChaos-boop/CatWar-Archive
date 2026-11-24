(() => {
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 40;
  let all = [], shown = PAGE_SIZE;

  const demo = [
    {id:'demo-1',game_id:'1382656',last_name:'Лапка',birth_date:'2017-07-02',death_date:'2017-08-08',death_cause:'Жажда',biography:'',cover_url:'',factions:[{faction_name:'Морское племя',position:0}],ranks:[{rank_name:'Оруженосец',position:0}],names:['Доброусочка','Лапка']},
    {id:'demo-2',game_id:'1703006',last_name:'Алый Сорокопут',birth_date:'2019-11-26',death_date:'2020-06-13',death_cause:'Отравление',biography:'',cover_url:'',factions:[{faction_name:'Чернолесье',position:0}],ranks:[{rank_name:'Старейшина',position:0}],names:['Красносолнышко','Котёнок','Ишем','Алый Сорокопут']},
    {id:'demo-3',game_id:'729416',last_name:'Пятнистое Недоразумение',birth_date:'2022-08-05',death_date:'2023-05-31',death_cause:'Отравление',biography:'',cover_url:'',factions:[{faction_name:'Крылатое племя',position:0}],ranks:[{rank_name:'Старейшина',position:0}],names:['Простачок','Рогатый','Сказитель Солнца','Сорокопут','Пятнистое Недоразумение']}
  ];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => value ? formatDate(value) : 'Дата неизвестна';
  const safeHttpUrl = value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch (_) { return ''; }
  };
  function formatDate(value) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return String(value);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'});
  }
  function orderedPeriods(periods) {
    const rows = (periods || []).slice();
    const positions = rows.map(x => x.position).filter(x => x !== null && x !== undefined);
    if (positions.length && new Set(positions).size > 1) return rows.sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
    return rows.sort((a,b) => (a.start_date || '').localeCompare(b.start_date || ''));
  }
  const latest = periods => orderedPeriods(periods).slice(-1)[0] || {};

  async function load() {
    if (window.catwarSupabase) {
      const { data, error } = await window.catwarSupabase.from('characters')
        .select('*,character_names(*),faction_periods(*),rank_periods(*),gallery_items(*)')
        .is('deleted_at', null);
      if (error) throw error;
      all = (data || []).map(character => ({
        ...character,
        names: (character.character_names || []).sort((a,b) => (a.position ?? 0) - (b.position ?? 0)).map(x => x.name),
        factions: orderedPeriods(character.faction_periods),
        ranks: orderedPeriods(character.rank_periods)
      }));
    } else {
      all = demo;
      $('result-count').textContent = 'Демонстрационные данные — подключите Supabase для публикации';
    }
    populateFilters();
    updateStats();
    renderArchiveTimeline();
    render();
  }

  function populateFilters() {
    const factions = [...new Set(all.flatMap(c => (c.factions || []).map(x => x.faction_name)).filter(Boolean))].sort();
    const ranks = [...new Set(all.flatMap(c => (c.ranks || []).map(x => x.rank_name)).filter(Boolean))].sort();
    $('faction-filter').innerHTML = '<option value="">Все фракции</option>' + factions.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    $('rank-filter').innerHTML = '<option value="">Все должности</option>' + ranks.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    const years = [...new Set(all.map(c => c.death_date?.slice(0,4)).filter(Boolean))].sort().reverse();
    const hasUnknownYear = all.some(c => !c.death_date);
    $('year-filter').innerHTML = '<option value="">Любой год смерти</option>' + years.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('') + (hasUnknownYear ? '<option value="unknown">Год смерти неизвестен</option>' : '');
  }

  function updateStats() {
    $('stat-total').textContent = all.length.toLocaleString('ru-RU');
    $('stat-factions').textContent = new Set(all.map(c => latest(c.factions).faction_name).filter(Boolean)).size;
    const years = all.map(c => Number((c.birth_date || c.death_date || '').slice(0,4))).filter(Boolean);
    $('stat-years').textContent = years.length ? new Date().getFullYear() - Math.min(...years) + 1 : '—';
  }

  function renderArchiveTimeline() {
    const groups = new Map();
    all.forEach(character => {
      const year = character.death_date ? String(character.death_date).slice(0,4) : 'unknown';
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(character);
    });
    const years = [...groups.keys()].sort((a,b) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return Number(b) - Number(a);
    });
    $('archive-timeline').innerHTML = years.length ? years.map(year => {
      const people = groups.get(year).slice().sort((a,b) => (a.last_name || '').localeCompare(b.last_name || '', 'ru'));
      const label = year === 'unknown' ? 'Год неизвестен' : year;
      return `<article class="archive-year"><button class="archive-year-button" type="button" data-year="${esc(year)}"><span class="archive-year-label">${esc(label)}</span><span class="archive-year-count">${people.length} ${people.length === 1 ? 'персонаж' : people.length < 5 ? 'персонажа' : 'персонажей'}</span><span class="archive-year-arrow">↗</span></button><div class="archive-year-names">${people.slice(0,8).map(c => `<button type="button" class="timeline-person" data-id="${esc(c.id)}">${esc(c.last_name)}</button>`).join('')}${people.length > 8 ? `<span class="timeline-more">и ещё ${people.length - 8}</span>` : ''}</div></article>`;
    }).join('') : '<p class="muted">Пока нет записей для хронологии.</p>';
    $('archive-timeline').querySelectorAll('.archive-year-button').forEach(button => button.addEventListener('click', () => {
      $('year-filter').value = button.dataset.year;
      shown = PAGE_SIZE; render(); $('character-list').scrollIntoView({behavior:'smooth', block:'start'});
    }));
    $('archive-timeline').querySelectorAll('.timeline-person').forEach(button => button.addEventListener('click', () => openProfile(button.dataset.id)));
  }

  function filteredRows() {
    const query = $('search').value.trim().toLocaleLowerCase('ru');
    const faction = $('faction-filter').value, rank = $('rank-filter').value, year = $('year-filter').value;
    const sort = $('sort').value, imageFilter = $('image-filter').value;
    const rows = all.filter(c => {
      const names = (c.names || []).join(' ');
      const searchable = [c.game_id || '', c.last_name || '', names, c.death_cause || '', c.biography || '', c.notes || ''].join(' ').toLocaleLowerCase('ru');
      const hasImage = !!(c.cover_url || (c.gallery_items || []).length);
      return (!query || searchable.includes(query)) &&
        (!faction || latest(c.factions).faction_name === faction) &&
        (!rank || (c.ranks || []).some(x => x.rank_name === rank)) &&
        (!year || (year === 'unknown' ? !c.death_date : (c.death_date || '').startsWith(year))) &&
        (!imageFilter || (imageFilter === 'yes' ? hasImage : !hasImage));
    });
    rows.sort((a,b) => {
      if (sort === 'name_asc') return (a.last_name || '').localeCompare(b.last_name || '', 'ru');
      if (sort === 'id_asc') return String(a.game_id || '').localeCompare(String(b.game_id || ''), undefined, {numeric:true});
      if (sort === 'birth_asc' || sort === 'birth_desc') { const x = a.birth_date || '9999', y = b.birth_date || '9999'; return sort === 'birth_asc' ? x.localeCompare(y) : y.localeCompare(x); }
      const x = a.death_date || '0000', y = b.death_date || '0000';
      return sort === 'death_asc' ? x.localeCompare(y) : y.localeCompare(x);
    });
    return rows;
  }

  function render() {
    const rows = filteredRows();
    $('result-count').textContent = `Найдено: ${rows.length}`;
    $('character-list').innerHTML = rows.slice(0, shown).map(c => {
      const factionPeriod = latest(c.factions), rankPeriod = latest(c.ranks);
      const previous = Math.max(0, (c.names || []).length - 1);
      return `<article class="character-row" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="Открыть профиль: ${esc(c.last_name)}">
        <div class="avatar">${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="">` : '✦'}</div>
        <div><div class="character-name">${esc(c.last_name)}</div><div class="subline">Игровой ID: ${esc(c.game_id || 'не указан')}${previous ? ` · ещё ${previous} ${previous === 1 ? 'имя' : 'имени'}` : ''}</div></div>
        <div class="faction-cell"><span class="tag">${esc(factionPeriod.faction_name || 'Фракция не указана')}</span></div>
        <div class="rank-cell"><span class="tag rank">${esc(rankPeriod.rank_name || 'Должность не указана')}</span></div>
        <div class="dates">${esc(fmt(c.birth_date))} — ${esc(fmt(c.death_date))}</div><div class="row-arrow">›</div>
      </article>`;
    }).join('') || '<div class="empty-state">По заданным условиям ничего не найдено.</div>';
    $('load-more').hidden = rows.length <= shown;
    $('load-more').onclick = () => { shown += PAGE_SIZE; render(); };
    document.querySelectorAll('.character-row').forEach(element => {
      element.addEventListener('click', () => openProfile(element.dataset.id));
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProfile(element.dataset.id); }
      });
    });
  }

  function renderPeriodTimeline(title, items, key, kind) {
    const rows = orderedPeriods(items);
    return `<section class="profile-section"><div class="section-heading"><h3>${title}</h3><span>${rows.length} ${rows.length === 1 ? 'запись' : 'записей'}</span></div>${rows.length ? `<ol class="life-timeline ${kind}">${rows.map((period, index) => {
      const start = period.start_date ? formatDate(period.start_date) : 'Начало неизвестно';
      const end = period.end_date ? formatDate(period.end_date) : 'Окончание неизвестно';
      return `<li class="life-event"><span class="life-event-marker"></span><div class="life-event-card"><span class="life-event-index">${String(index + 1).padStart(2,'0')}</span><strong>${esc(period[key] || 'Не указано')}</strong><span class="life-event-dates">${esc(start)} — ${esc(end)}</span></div></li>`;
    }).join('')}</ol>` : '<p class="muted">Нет сведений</p>'}</section>`;
  }

  function openProfile(id) {
    const c = all.find(x => String(x.id) === String(id));
    if (!c) return;
    const names = (c.names || []).filter(Boolean);
    const faction = latest(c.factions), rank = latest(c.ranks);
    const gallery = (c.gallery_items || []).slice().sort((a,b) => (a.position ?? 0) - (b.position ?? 0)).map(item =>
      `<figure class="gallery-figure"><img src="${esc(item.image_url)}" alt="${esc(item.caption || '')}" loading="lazy">${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ''}</figure>`
    ).join('');
    const profileUrl = safeHttpUrl(c.profile_url);
    $('profile-content').innerHTML = `
      <div class="profile-hero">
        <div class="profile-portrait">${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="Основное изображение персонажа">` : '<span>✦</span>'}</div>
        <div class="profile-identity"><p class="eyebrow">АРХИВНАЯ ЗАПИСЬ</p><h2>${esc(c.last_name || 'Без имени')}</h2><p class="profile-game-id">Игровой ID: ${esc(c.game_id || 'не указан')}</p>
          <div class="profile-tags"><span class="tag">${esc(faction.faction_name || 'Фракция не указана')}</span><span class="tag rank">${esc(rank.rank_name || 'Должность не указана')}</span></div>
          <div class="profile-life-dates"><div><span>Рождение</span><strong>${esc(fmt(c.birth_date))}</strong></div><div><span>Смерть</span><strong>${esc(fmt(c.death_date))}</strong></div></div>
        </div>
      </div>
      ${c.biography ? `<section class="profile-section biography-section"><h3>Биография</h3><p class="biography-text">${esc(c.biography).replace(/\n/g, '<br>')}</p></section>` : ''}
      <section class="profile-section"><div class="section-heading"><h3>История имён</h3><span>${names.length} ${names.length === 1 ? 'имя' : 'имён'}</span></div>
        ${names.length ? `<ol class="name-history">${names.map((name,index) => `<li><span class="name-history-number">${String(index + 1).padStart(2,'0')}</span><span class="name-history-value">${esc(name)}</span>${index === names.length - 1 ? '<span class="name-current">Последнее</span>' : ''}</li>`).join('')}</ol>` : '<p class="muted">Нет сведений</p>'}
      </section>
      ${renderPeriodTimeline('История фракций', c.factions, 'faction_name', 'faction-timeline')}
      ${renderPeriodTimeline('История должностей', c.ranks, 'rank_name', 'rank-timeline')}
      <section class="profile-section"><h3>Обстоятельства смерти</h3><p>${esc(c.death_cause || 'Причина смерти не указана')}</p>${c.notes ? `<div class="notes-text">${esc(c.notes).replace(/\n/g, '<br>')}</div>` : ''}</section>
      <section class="profile-section"><div class="section-heading"><h3>Галерея</h3><span>${(c.gallery_items || []).length} изображений</span></div><div class="profile-gallery">${gallery || '<p class="muted">Галерея пока пуста</p>'}</div></section>
      ${profileUrl ? `<p class="profile-source"><a target="_blank" rel="noopener noreferrer" href="${esc(profileUrl)}">Открыть профиль CatWar ↗</a></p>` : ''}`;
    $('profile-dialog').showModal();
  }

  ['search','faction-filter','rank-filter','year-filter','sort','image-filter'].forEach(id => $(id).addEventListener('input', () => { shown = PAGE_SIZE; render(); }));
  $('reset').addEventListener('click', () => {
    $('search').value = ''; $('faction-filter').value = ''; $('rank-filter').value = ''; $('year-filter').value = ''; $('image-filter').value = ''; $('sort').value = 'death_desc'; shown = PAGE_SIZE; render();
  });
  $('close-profile').addEventListener('click', () => $('profile-dialog').close());
  $('profile-dialog').addEventListener('click', event => { if (event.target.id === 'profile-dialog') $('profile-dialog').close(); });
  load().catch(error => { $('character-list').innerHTML = `<div class="empty-state">Не удалось загрузить архив: ${esc(error.message)}</div>`; });
})();
