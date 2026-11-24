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
  const fmt = value => value || 'Дата неизвестна';

  function orderedPeriods(periods) {
    const rows = (periods || []).slice();
    const positions = rows.map(x => x.position).filter(x => x !== null && x !== undefined);
    if (positions.length && new Set(positions).size > 1) {
      return rows.sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
    }
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
        names: (character.character_names || []).sort((a,b) => a.position - b.position).map(x => x.name),
        factions: orderedPeriods(character.faction_periods),
        ranks: orderedPeriods(character.rank_periods)
      }));
    } else {
      all = demo;
      $('result-count').textContent = 'Демонстрационные данные — подключите Supabase для публикации';
    }
    populateFilters();
    updateStats();
    render();
  }

  function populateFilters() {
    const factions = [...new Set(all.map(c => latest(c.factions).faction_name).filter(Boolean))].sort();
    const ranks = [...new Set(all.map(c => latest(c.ranks).rank_name).filter(Boolean))].sort();
    $('faction-filter').innerHTML = '<option value="">Все фракции</option>' + factions.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    $('rank-filter').innerHTML = '<option value="">Все должности</option>' + ranks.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    const years = [...new Set(all.map(c => c.death_date?.slice(0,4)).filter(Boolean))].sort().reverse();
    $('year-filter').innerHTML = '<option value="">Любой год смерти</option>' + years.map(x => `<option>${x}</option>`).join('');
  }

  function updateStats() {
    $('stat-total').textContent = all.length.toLocaleString('ru-RU');
    $('stat-factions').textContent = new Set(all.map(c => latest(c.factions).faction_name).filter(Boolean)).size;
    const years = all.map(c => Number((c.birth_date || c.death_date || '').slice(0,4))).filter(Boolean);
    $('stat-years').textContent = years.length ? new Date().getFullYear() - Math.min(...years) + 1 : '—';
  }

  function render() {
    const query = $('search').value.trim().toLocaleLowerCase('ru');
    const faction = $('faction-filter').value, rank = $('rank-filter').value, year = $('year-filter').value;
    const sort = $('sort').value;
    let rows = all.filter(c => {
      const names = (c.names || []).join(' ');
      const searchable = [c.game_id || '', c.last_name || '', names].join(' ').toLocaleLowerCase('ru');
      return (!query || searchable.includes(query)) &&
        (!faction || latest(c.factions).faction_name === faction) &&
        (!rank || latest(c.ranks).rank_name === rank) &&
        (!year || (c.death_date || '').startsWith(year));
    });
    rows.sort((a,b) => {
      if (sort === 'name_asc') return (a.last_name || '').localeCompare(b.last_name || '', 'ru');
      if (sort === 'id_asc') return String(a.game_id || '').localeCompare(String(b.game_id || ''), undefined, {numeric:true});
      const x = a.death_date || '0000', y = b.death_date || '0000';
      return sort === 'death_asc' ? x.localeCompare(y) : y.localeCompare(x);
    });
    $('result-count').textContent = `Найдено: ${rows.length}`;
    $('character-list').innerHTML = rows.slice(0, shown).map(c => {
      const factionPeriod = latest(c.factions), rankPeriod = latest(c.ranks);
      const previous = Math.max(0, (c.names || []).length - 1);
      return `<article class="character-row" data-id="${esc(c.id)}" tabindex="0" role="button">
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

  function openProfile(id) {
    const c = all.find(x => String(x.id) === String(id));
    if (!c) return;
    const names = (c.names || []).map((name,index) => `<p>${index + 1}. ${esc(name)}</p>`).join('');
    const periods = (title, items, key) => `<section class="profile-section"><h3>${title}</h3>${orderedPeriods(items).map(period =>
      `<p><b>${esc(period[key])}</b> · ${esc(period.start_date || 'Дата начала неизвестна')} — ${esc(period.end_date || 'дата окончания неизвестна')}</p>`
    ).join('') || '<p>Нет сведений</p>'}</section>`;
    const gallery = (c.gallery_items || []).slice().sort((a,b) => (a.position ?? 0) - (b.position ?? 0)).map(item =>
      `<figure class="gallery-figure"><img src="${esc(item.image_url)}" alt="${esc(item.caption || '')}">${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ''}</figure>`
    ).join('');
    $('profile-content').innerHTML = `
      <p class="eyebrow">ПРОФИЛЬ ПЕРСОНАЖА</p>
      <h2>${esc(c.last_name)}</h2>
      <p class="muted">Игровой ID: ${esc(c.game_id || 'не указан')}</p>
      ${c.cover_url ? `<img class="profile-cover" src="${esc(c.cover_url)}" alt="Основное изображение персонажа">` : ''}
      ${c.biography ? `<section class="profile-section biography-section"><h3>Биография</h3><p class="biography-text">${esc(c.biography).replace(/\n/g, '<br>')}</p></section>` : ''}
      ${periods('История имён', (c.names || []).map((name,position) => ({name,position})), 'name')}
      ${periods('История фракций', c.factions, 'faction_name')}
      ${periods('История должностей', c.ranks, 'rank_name')}
      <section class="profile-section"><h3>Жизнь и смерть</h3>
        <p>Рождение: ${esc(fmt(c.birth_date))}</p><p>Смерть: ${esc(fmt(c.death_date))}</p>
        <p>Причина смерти: ${esc(c.death_cause || 'Не указана')}</p>
        ${c.notes ? `<p class="notes-text">${esc(c.notes).replace(/\n/g, '<br>')}</p>` : ''}
      </section>
      <section class="profile-section"><h3>Галерея</h3><div class="profile-gallery">${gallery || '<p>Галерея пока пуста</p>'}</div></section>
      ${c.profile_url ? `<p><a target="_blank" rel="noopener" href="${esc(c.profile_url)}">Открыть профиль CatWar ↗</a></p>` : ''}`;
    $('profile-dialog').showModal();
  }

  ['search','faction-filter','rank-filter','year-filter','sort'].forEach(id => $(id).addEventListener('input', () => { shown = PAGE_SIZE; render(); }));
  $('reset').addEventListener('click', () => {
    $('search').value = ''; $('faction-filter').value = ''; $('rank-filter').value = ''; $('year-filter').value = ''; $('sort').value = 'death_desc'; shown = PAGE_SIZE; render();
  });
  $('close-profile').addEventListener('click', () => $('profile-dialog').close());
  $('profile-dialog').addEventListener('click', event => { if (event.target.id === 'profile-dialog') $('profile-dialog').close(); });
  load().catch(error => { $('character-list').innerHTML = `<div class="empty-state">Не удалось загрузить архив: ${esc(error.message)}</div>`; });
})();
