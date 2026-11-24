(() => {
  const $ = id => document.getElementById(id);
  const db = () => window.catwarSupabase;
  let editing = null;
  let saving = false;
  let listMode = 'active';
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

    const allRows = data || [];
    const activeRows = allRows.filter(c => !c.deleted_at);
    const trashRows = allRows.filter(c => !!c.deleted_at);
    $('active-count').textContent = activeRows.length;
    $('trash-count').textContent = trashRows.length;

    const query = $('admin-search').value.trim().toLocaleLowerCase('ru');
    const source = listMode === 'trash' ? trashRows : activeRows;
    const rows = source.filter(c =>
      (`${c.last_name} ${c.game_id || ''}`).toLocaleLowerCase('ru').includes(query));

    $('active-tab').classList.toggle('active', listMode === 'active');
    $('trash-tab').classList.toggle('active', listMode === 'trash');
    $('active-tab').setAttribute('aria-selected', String(listMode === 'active'));
    $('trash-tab').setAttribute('aria-selected', String(listMode === 'trash'));
    $('new-character').hidden = listMode === 'trash';
    $('admin-list').innerHTML = rows.map(c => listMode === 'active' ? `
      <div class="admin-item">
        <div><strong>${esc(c.last_name)}</strong><small>Игровой ID: ${esc(c.game_id || 'не указан')}</small></div>
        <div class="admin-item-actions">
          <button class="button secondary" data-edit="${esc(c.id)}">Редактировать</button>
          <button class="button danger" data-trash="${esc(c.id)}">В корзину</button>
        </div>
      </div>` : `
      <div class="admin-item">
        <div><strong>${esc(c.last_name)}</strong><small>Удалён: ${esc(new Date(c.deleted_at).toLocaleString('ru-RU'))} · Игровой ID: ${esc(c.game_id || 'не указан')}</small></div>
        <div class="admin-item-actions">
          <button class="button secondary" data-restore="${esc(c.id)}">Восстановить</button>
          <button class="button danger" data-permanent-delete="${esc(c.id)}">Удалить навсегда</button>
        </div>
      </div>`).join('') || (listMode === 'trash'
        ? '<p class="muted">Корзина пуста.</p>'
        : '<p class="muted">Активных записей не найдено.</p>');

    document.querySelectorAll('[data-edit]').forEach(button => {
      button.onclick = () => editCharacter(button.dataset.edit);
    });
    document.querySelectorAll('[data-trash]').forEach(button => {
      button.onclick = () => moveToTrash(button.dataset.trash);
    });
    document.querySelectorAll('[data-restore]').forEach(button => {
      button.onclick = () => restoreCharacter(button.dataset.restore);
    });
    document.querySelectorAll('[data-permanent-delete]').forEach(button => {
      button.onclick = () => permanentlyDeleteCharacter(button.dataset.permanentDelete);
    });
  }

  async function moveToTrash(id) {
    const row = await getCharacterForTrashAction(id);
    if (!row) return;
    if (!confirm(`Переместить персонажа «${row.last_name}» в корзину? Его карточка и связанные данные сохранятся, а из публичного каталога он исчезнет.`)) return;
    const { error } = await db().from('characters').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert(`Не удалось переместить запись в корзину: ${error.message}`); return; }
    if ($('character-id').value === id) $('editor').hidden = true;
    await loadAdminList();
  }

  async function restoreCharacter(id) {
    const row = await getCharacterForTrashAction(id);
    if (!row) return;
    if (!confirm(`Восстановить персонажа «${row.last_name}»? Он снова появится в публичном каталоге.`)) return;
    const { error } = await db().from('characters').update({ deleted_at: null }).eq('id', id);
    if (error) { alert(`Не удалось восстановить запись: ${error.message}`); return; }
    await loadAdminList();
  }

  async function getCharacterForTrashAction(id) {
    const { data, error } = await db().from('characters').select('id,last_name,deleted_at').eq('id', id).single();
    if (error) { alert(`Не удалось получить запись: ${error.message}`); return null; }
    return data;
  }

  function storagePathFromPublicUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const marker = '/storage/v1/object/public/character-images/';
      const index = parsed.pathname.indexOf(marker);
      if (index < 0) return null;
      return decodeURIComponent(parsed.pathname.slice(index + marker.length));
    } catch (_) { return null; }
  }

  async function permanentlyDeleteCharacter(id) {
    const { data, error } = await db().from('characters')
      .select('id,last_name,cover_url,gallery_items(image_url)').eq('id', id).single();
    if (error) { alert(`Не удалось получить запись: ${error.message}`); return; }
    const confirmed = confirm(`Удалить персонажа «${data.last_name}» НАВСЕГДА? Его карточка, история имён, фракций и должностей, а также галерея будут удалены без возможности восстановления.`);
    if (!confirmed) return;

    const imagePaths = [data.cover_url, ...(data.gallery_items || []).map(item => item.image_url)]
      .map(storagePathFromPublicUrl).filter(Boolean);
    const uniquePaths = [...new Set(imagePaths)];

    const { error: deleteError } = await db().from('characters').delete().eq('id', id);
    if (deleteError) { alert(`Не удалось удалить запись: ${deleteError.message}`); return; }

    let storageWarning = '';
    if (uniquePaths.length) {
      const { error: storageError } = await db().storage.from('character-images').remove(uniquePaths);
      if (storageError) storageWarning = `

Запись удалена из базы, но не все файлы изображений удалось удалить из хранилища: ${storageError.message}`;
    }
    await loadAdminList();
    alert(`Персонаж «${data.last_name}» удалён окончательно.${storageWarning}`);
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
  $('active-tab').onclick = () => { listMode = 'active'; loadAdminList(); };
  $('trash-tab').onclick = () => { listMode = 'trash'; loadAdminList(); };
  $('add-faction').onclick = () => { factionRows.push({ faction_name: '', start_date: null, end_date: null }); renderPeriods('faction', factionRows); };
  $('add-rank').onclick = () => { rankRows.push({ rank_name: '', start_date: null, end_date: null }); renderPeriods('rank', rankRows); };
  $('add-gallery').onclick = () => { galleryRows.push({ image_url: '', caption: '' }); renderGallery(); };

  $('character-form').onsubmit = async event => {
    event.preventDefault();
    if (saving) return;

    saving = true;
    const submitButton = $('character-form').querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Сохранение…';
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
      if (coverFile) {
        cover_url = await uploadFile(coverFile, 'covers');
        // Сохраняем полученную ссылку в форме: повторная попытка не загрузит файл заново.
        $('cover-url').value = cover_url;
        $('cover-file').value = '';
      }

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

      // Если предыдущая попытка уже создала основную запись, editing содержит её ID.
      // Повторное сохранение обновит эту запись вместо создания дубля.
      let characterId = editing || $('character-id').value || null;
      if (characterId) {
        const { error } = await db().from('characters').update(payload).eq('id', characterId);
        if (error) throw error;
      } else {
        const { data, error } = await db().from('characters').insert(payload).select('id').single();
        if (error) throw error;
        characterId = data.id;

        // Фиксируем ID немедленно, до сохранения дочерних таблиц.
        editing = characterId;
        $('character-id').value = characterId;
        $('editor-heading').textContent = 'Редактирование записи';
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
        if (item.file) {
          image_url = await uploadFile(item.file, 'gallery');
          // Не загружаем тот же файл повторно, если сохранение таблицы завершится ошибкой.
          item.image_url = image_url;
          item.file = null;
        }
        if (image_url) galleryToSave.push({ image_url, caption: (item.caption || '').trim() || null, position });
      }
      await replaceChildren('gallery_items', characterId, galleryToSave);

      editing = characterId;
      $('character-id').value = characterId;
      $('editor-heading').textContent = 'Редактирование записи';
      notify('Запись сохранена.');
      await loadAdminList();
    } catch (error) {
      notify(
        (error.message || 'Не удалось сохранить запись.') +
        (editing ? ' Запись персонажа уже создана или существует. Исправь проблему и нажми «Сохранить запись» ещё раз — повторная попытка обновит её, а не создаст новую.' : ''),
        true
      );
    } finally {
      saving = false;
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  };

  if (configured()) {
    db().auth.onAuthStateChange(() => refreshAccess());
    refreshAccess().catch(error => $('login-message').textContent = error.message);
  } else {
    $('login-message').textContent = 'Подключите Supabase: заполните js/config.js и выполните SQL из supabase/schema.sql.';
  }
})();
