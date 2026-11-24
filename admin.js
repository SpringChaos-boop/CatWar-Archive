(() => {
  const $ = id => document.getElementById(id);
  const db = () => window.catwarSupabase;
  let editing = null;
  let factionRows = [], rankRows = [], galleryRows = [];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notify = (message, bad = false) => {
    $('save-message').textContent = message;
    $('save-message').style.color = bad ? '#a33' : '#61717a';
  };
  const configured = () => !!db();

  async function isAdmin() {
    if (!configured()) return false;
    const { data: { user } } = await db().auth.getUser();
    if (!user) return false;
    const { data, error } = await db().from('archive_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    return !error && !!data;
  }

  async function refreshAccess() {
    if (!configured()) return;
    const { data: { user } } = await db().auth.getUser();
    const allowed = !!user && await isAdmin();
    $('login-panel').hidden = allowed;
    $('dashboard').hidden = !allowed;
    if (allowed) await loadAdminList();
    else if (user) $('login-message').textContent = 'У этой учётной записи нет прав администратора.';
  }

  async function loadAdminList() {
    const { data, error } = await db().from('characters')
      .select('id,game_id,last_name,deleted_at').order('last_name').limit(1000);
    if (error) { $('admin-list').textContent = error.message; return; }
    const query = $('admin-search').value.trim().toLocaleLowerCase('ru');
    const rows = (data || []).filter(c => !c.deleted_at &&
      (`${c.last_name} ${c.game_id || ''}`).toLocaleLowerCase('ru').includes(query));
    $('admin-list').innerHTML = rows.map(c => `
      <div class="admin-item">
        <div><strong>${esc(c.last_name)}</strong><small>Игровой ID: ${esc(c.game_id || 'не указан')}</small></div>
        <button class="button secondary" data-edit="${esc(c.id)}">Редактировать</button>
      </div>`).join('') || '<p class="muted">Записей пока нет.</p>';
    document.querySelectorAll('[data-edit]').forEach(button => {
      button.onclick = () => editCharacter(button.dataset.edit);
    });
  }

  function renderPeriods(kind, rows) {
    const host = $(kind === 'faction' ? 'faction-periods' : 'rank-periods');
    const title = kind === 'faction' ? 'Фракция' : 'Должность';
    const field = kind === 'faction' ? 'faction_name' : 'rank_name';
    host.innerHTML = rows.map((row, index) => `
      <div class="period-card" data-index="${index}">
        <div class="period-top"><span>Период ${index + 1}</span><button type="button" class="text-button remove-period">Удалить</button></div>
        <label>${title}<input class="period-name" value="${esc(row[field] || '')}" placeholder="Название"></label>
        <div class="period-dates">
          <label>Дата начала<input class="period-start" type="date" value="${esc(row.start_date || '')}"></label>
          <label>Дата окончания<input class="period-end" type="date" value="${esc(row.end_date || '')}"></label>
        </div>
      </div>`).join('');
    host.querySelectorAll('.period-card').forEach(card => {
      const index = Number(card.dataset.index);
      card.querySelector('.remove-period').onclick = () => { rows.splice(index, 1); renderPeriods(kind, rows); };
      const sync = () => {
        rows[index][field] = card.querySelector('.period-name').value;
        rows[index].start_date = card.querySelector('.period-start').value || null;
        rows[index].end_date = card.querySelector('.period-end').value || null;
      };
      card.querySelectorAll('input').forEach(input => input.addEventListener('input', sync));
    });
  }

  function renderGallery() {
    $('gallery-items').innerHTML = galleryRows.map((item, index) => `
      <div class="gallery-card" data-index="${index}">
        <div class="period-top"><span>Изображение ${index + 1}</span><button type="button" class="text-button remove-gallery">Удалить</button></div>
        <label>Загрузить файл<input class="gallery-file" type="file" accept="image/*"></label>
        <label>Или ссылка на изображение<input class="gallery-url" type="url" value="${esc(item.image_url || '')}" placeholder="https://..."></label>
        <label>Подпись<input class="gallery-caption" value="${esc(item.caption || '')}"></label>
      </div>`).join('');
    $('gallery-items').querySelectorAll('.gallery-card').forEach(card => {
      const index = Number(card.dataset.index);
      card.querySelector('.remove-gallery').onclick = () => { galleryRows.splice(index, 1); renderGallery(); };
      card.querySelector('.gallery-file').onchange = event => { galleryRows[index].file = event.target.files[0] || null; };
      card.querySelector('.gallery-url').oninput = event => { galleryRows[index].image_url = event.target.value; };
      card.querySelector('.gallery-caption').oninput = event => { galleryRows[index].caption = event.target.value; };
    });
  }

  function resetForm() {
    editing = null;
    $('character-form').reset();
    $('character-id').value = '';
    $('editor-heading').textContent = 'Новая запись';
    factionRows = []; rankRows = []; galleryRows = [];
    renderPeriods('faction', factionRows);
    renderPeriods('rank', rankRows);
    renderGallery();
    notify('');
    $('editor').hidden = false;
    $('editor').scrollIntoView({ behavior: 'smooth' });
  }

  async function uploadFile(file, folder) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await db().storage.from('character-images').upload(path, file, {
      upsert: false, contentType: file.type
    });
    if (error) throw error;
    return db().storage.from('character-images').getPublicUrl(path).data.publicUrl;
  }

  async function editCharacter(id) {
    const { data, error } = await db().from('characters')
      .select('*,character_names(*),faction_periods(*),rank_periods(*),gallery_items(*)')
      .eq('id', id).single();
    if (error) { alert(error.message); return; }
    editing = id;
    $('editor-heading').textContent = 'Редактирование записи';
    $('character-id').value = id;
    $('game-id').value = data.game_id || '';
    $('last-name').value = data.last_name || '';
    $('profile-url').value = data.profile_url || '';
    $('birth-date').value = data.birth_date || '';
    $('death-date').value = data.death_date || '';
    $('death-cause').value = data.death_cause || '';
    $('biography').value = data.biography || '';
    $('notes').value = data.notes || '';
    $('names').value = (data.character_names || []).sort((a,b) => a.position - b.position).map(x => x.name).join('\n');
    $('cover-url').value = data.cover_url || '';
    factionRows = (data.faction_periods || []).sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
    rankRows = (data.rank_periods || []).sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
    galleryRows = data.gallery_items || [];
    renderPeriods('faction', factionRows);
    renderPeriods('rank', rankRows);
    renderGallery();
    $('editor').hidden = false;
    $('editor').scrollIntoView({ behavior: 'smooth' });
  }

  async function replaceChildren(table, characterId, rows) {
    const { error: deleteError } = await db().from(table).delete().eq('character_id', characterId);
    if (deleteError) throw deleteError;
    if (rows.length) {
      const { error } = await db().from(table).insert(rows.map(row => ({ ...row, character_id: characterId })));
      if (error) throw error;
    }
  }

  $('login-form').onsubmit = async event => {
    event.preventDefault();
    if (!configured()) { $('login-message').textContent = 'Сначала настройте Supabase в js/config.js.'; return; }
    $('login-message').textContent = 'Выполняется вход…';
    const { error } = await db().auth.signInWithPassword({ email: $('email').value, password: $('password').value });
    if (error) { $('login-message').textContent = error.message; return; }
    await refreshAccess();
  };
  $('logout').onclick = async () => { await db().auth.signOut(); location.reload(); };
  $('new-character').onclick = resetForm;
  $('cancel-edit').onclick = () => { $('editor').hidden = true; };
  $('admin-search').oninput = loadAdminList;
  $('add-faction').onclick = () => { factionRows.push({ faction_name: '', start_date: null, end_date: null }); renderPeriods('faction', factionRows); };
  $('add-rank').onclick = () => { rankRows.push({ rank_name: '', start_date: null, end_date: null }); renderPeriods('rank', rankRows); };
  $('add-gallery').onclick = () => { galleryRows.push({ image_url: '', caption: '' }); renderGallery(); };

  $('character-form').onsubmit = async event => {
    event.preventDefault();
    notify('Сохранение…');
    try {
      if (!(await isAdmin())) throw new Error('Недостаточно прав.');
      const game_id = $('game-id').value.trim() || null;
      const last_name = $('last-name').value.trim();
      if (!last_name) throw new Error('Укажи последнее имя персонажа.');
      const names = $('names').value.split('\n').map(x => x.trim()).filter(Boolean);
      if (names.length && names[names.length - 1] !== last_name) throw new Error('Последнее имя в истории должно совпадать с основным именем.');
      if (factionRows.some(x => !x.faction_name?.trim())) throw new Error('Заполни название каждой фракции или удали пустой период.');
      if (rankRows.some(x => !x.rank_name?.trim())) throw new Error('Заполни название каждой должности или удали пустой период.');

      let cover_url = $('cover-url').value.trim() || null;
      const coverFile = $('cover-file').files[0];
      if (coverFile) cover_url = await uploadFile(coverFile, 'covers');

      const payload = {
        game_id, last_name,
        birth_date: $('birth-date').value || null,
        death_date: $('death-date').value || null,
        death_cause: $('death-cause').value.trim() || null,
        biography: $('biography').value.trim() || null,
        notes: $('notes').value.trim() || null,
        profile_url: $('profile-url').value.trim() || null,
        cover_url
      };
      let characterId = editing;
      if (editing) {
        const { error } = await db().from('characters').update(payload).eq('id', editing);
        if (error) throw error;
      } else {
        const { data, error } = await db().from('characters').insert(payload).select('id').single();
        if (error) throw error;
        characterId = data.id;
      }

      await replaceChildren('character_names', characterId, names.map((name, position) => ({ name, position })));
      await replaceChildren('faction_periods', characterId, factionRows.map((row, position) => ({
        faction_name: row.faction_name.trim(), start_date: row.start_date || null, end_date: row.end_date || null, position
      })));
      await replaceChildren('rank_periods', characterId, rankRows.map((row, position) => ({
        rank_name: row.rank_name.trim(), start_date: row.start_date || null, end_date: row.end_date || null, position
      })));

      const galleryToSave = [];
      for (const [position, item] of galleryRows.entries()) {
        let image_url = (item.image_url || '').trim();
        if (item.file) image_url = await uploadFile(item.file, 'gallery');
        if (image_url) galleryToSave.push({ image_url, caption: (item.caption || '').trim() || null, position });
      }
      await replaceChildren('gallery_items', characterId, galleryToSave);
      notify('Запись сохранена.');
      await loadAdminList();
    } catch (error) {
      notify(error.message || 'Не удалось сохранить запись.', true);
    }
  };

  if (configured()) {
    db().auth.onAuthStateChange(() => refreshAccess());
    refreshAccess().catch(error => $('login-message').textContent = error.message);
  } else {
    $('login-message').textContent = 'Подключите Supabase: заполните js/config.js и выполните SQL из supabase/schema.sql.';
  }
})();
