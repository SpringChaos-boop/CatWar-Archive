(() => {
  const $ = id => document.getElementById(id);
  const db = () => window.catwarSupabase;
  let editing = null;
  let saving = false;
  let listMode = 'active';
  let auditMode = false;
  let factionRows = [], rankRows = [], galleryRows = [];
  let validatedBackup = null;
  let authCheckId = 0;
  let imageRows = [];

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

  async function refreshAccess(session = undefined) {
    if (!configured()) return;
    const checkId = ++authCheckId;
    const alreadyVisible = !$('dashboard').hidden;
    if (!alreadyVisible) {
      $('auth-loading').hidden = false;
      $('login-panel').hidden = true;
      $('dashboard').hidden = true;
    }
    let user = session === undefined ? null : session?.user || null;
    if (session === undefined) {
      const { data, error } = await db().auth.getSession();
      if (error) throw error;
      user = data.session?.user || null;
    }
    let allowed = false;
    if (user) {
      const { data, error } = await db().from('archive_admins').select('user_id').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      allowed = !!data;
    }
    if (checkId !== authCheckId) return;
    $('auth-loading').hidden = true;
    $('login-panel').hidden = allowed;
    $('dashboard').hidden = !allowed;
    if (allowed) await loadAdminList();
    else if (user) $('login-message').textContent = 'У этой учётной записи нет прав администратора.';
  }

  async function loadFeaturedManager() {
    const select = $('featured-character-select');
    const message = $('featured-admin-message');
    if (!select) return;
    select.disabled = true;
    message.textContent = 'Загружаем список персонажей…';
    const [{ data: characters, error: charactersError }, { data: setting, error: settingError }] = await Promise.all([
      db().from('characters').select('id,last_name,game_id').is('deleted_at', null).order('last_name').limit(2000),
      db().from('archive_featured_character').select('character_id').eq('slot', true).maybeSingle()
    ]);
    if (charactersError || settingError) {
      select.innerHTML = '<option value="">Не удалось загрузить список</option>';
      message.textContent = `Не удалось загрузить настройки живой карточки: ${(charactersError || settingError).message}. Проверь, что выполнен SQL-файл featured-character.sql.`;
      select.disabled = true;
      return;
    }
    const selectedId = setting?.character_id || '';
    select.innerHTML = '<option value="">— Выбери персонажа —</option>' + (characters || []).map(character =>
      `<option value="${esc(character.id)}">${esc(character.last_name)}${character.game_id ? ` · ID ${esc(character.game_id)}` : ''}</option>`
    ).join('');
    select.value = selectedId;
    select.disabled = false;
    message.textContent = selectedId && !select.value
      ? 'Ранее выбранный персонаж сейчас неактивен или находится в корзине.'
      : selectedId ? 'Сейчас эта карточка отображается в публичном архиве.' : 'Живая карточка пока не выбрана.';
  }

  async function saveFeaturedCharacter() {
    const id = $('featured-character-select').value;
    if (!id) { $('featured-admin-message').textContent = 'Сначала выбери персонажа из списка.'; return; }
    const button = $('save-featured-character');
    button.disabled = true;
    try {
      const { error } = await db().from('archive_featured_character').upsert({
        slot: true, character_id: id, updated_at: new Date().toISOString()
      }, { onConflict: 'slot' });
      if (error) throw error;
      $('featured-admin-message').textContent = 'Карточка сохранена и опубликована в верхней части архива.';
    } catch (error) {
      $('featured-admin-message').textContent = `Не удалось сохранить выбор: ${error.message}`;
    } finally { button.disabled = false; }
  }

  async function clearFeaturedCharacter() {
    const button = $('clear-featured-character');
    button.disabled = true;
    try {
      const { error } = await db().from('archive_featured_character').upsert({
        slot: true, character_id: null, updated_at: new Date().toISOString()
      }, { onConflict: 'slot' });
      if (error) throw error;
      $('featured-character-select').value = '';
      $('featured-admin-message').textContent = 'Карточка снята с главной страницы архива.';
    } catch (error) {
      $('featured-admin-message').textContent = `Не удалось снять карточку: ${error.message}`;
    } finally { button.disabled = false; }
  }

  async function loadAdminList() {
    if (auditMode) { $('admin-list').hidden = true; $('audit-panel').hidden = true; $('images-panel').hidden = true; await loadAuditLog(); return; }
    $('audit-panel').hidden = true; $('images-panel').hidden = true;
    $('admin-list').hidden = false;
    const { data, error } = await db().from('characters')
      .select('id,game_id,last_name,deleted_at').order('last_name').limit(1000);
    if (error) { $('admin-list').textContent = error.message; return; }

    if (listMode === 'active') await loadFeaturedManager();
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
    $('log-tab').classList.remove('active'); $('images-tab').classList.remove('active');
    $('log-tab').setAttribute('aria-selected', 'false'); $('images-tab').setAttribute('aria-selected', 'false');
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

  async function loadImageManager() {
    $('admin-list').hidden = true; $('audit-panel').hidden = true; $('images-panel').hidden = false;
    $('active-tab').classList.remove('active'); $('trash-tab').classList.remove('active'); $('log-tab').classList.remove('active'); $('images-tab').classList.add('active');
    ['active-tab','trash-tab','log-tab'].forEach(id => $(id).setAttribute('aria-selected','false'));
    $('images-tab').setAttribute('aria-selected','true');
    $('new-character').hidden = true;
    $('list-message').textContent = '';
    try {
      const characters = await fetchAllRows('characters','id,last_name,cover_url,deleted_at,gallery_items(id,image_url,caption,position)','created_at');
      imageRows = [];
      for (const c of characters) {
        if (c.cover_url) imageRows.push({kind:'cover',character_id:c.id,character_name:c.last_name,url:c.cover_url,caption:'Основное изображение',deleted:!!c.deleted_at});
        for (const g of c.gallery_items || []) if (g.image_url) imageRows.push({kind:'gallery',character_id:c.id,character_name:c.last_name,url:g.image_url,caption:g.caption || 'Без подписи',item_id:g.id,deleted:!!c.deleted_at});
      }
      renderImageManager();
    } catch (error) { $('image-manager-list').textContent = `Не удалось загрузить изображения: ${error.message}`; }
  }

  function renderImageManager() {
    const q = $('image-search').value.trim().toLocaleLowerCase('ru');
    const kind = $('image-kind').value;
    const rows = imageRows.filter(x => (kind === 'all' || x.kind === kind) && `${x.character_name} ${x.caption}`.toLocaleLowerCase('ru').includes(q));
    $('image-manager-list').innerHTML = rows.map((x,i) => `<article class="managed-image"><img src="${esc(x.url)}" alt="" loading="lazy"><div class="managed-image-info"><strong>${esc(x.character_name)}</strong><span>${x.kind === 'cover' ? 'Основное изображение' : 'Галерея'} · ${esc(x.caption)}</span><small>${x.deleted ? 'Персонаж находится в корзине' : 'Активная запись'}</small><a href="${esc(x.url)}" target="_blank" rel="noopener">Открыть оригинал ↗</a></div><button class="button danger small" type="button" data-remove-image="${i}">Убрать</button></article>`).join('') || '<p class="muted">Изображения не найдены.</p>';
    $('image-manager-list').querySelectorAll('[data-remove-image]').forEach(button => button.onclick = () => removeManagedImage(rows[Number(button.dataset.removeImage)]));
  }

  async function removeManagedImage(item) {
    if (!item || !confirm(`Убрать изображение «${item.caption}» из карточки персонажа «${item.character_name}»?`)) return;
    let result;
    if (item.kind === 'cover') result = await db().from('characters').update({cover_url:null}).eq('id',item.character_id);
    else result = await db().from('gallery_items').delete().eq('id',item.item_id);
    if (result.error) { alert(`Не удалось убрать изображение: ${result.error.message}`); return; }
    const path = storagePathFromPublicUrl(item.url);
    let warning = '';
    if (path) {
      // Один URL может использоваться несколькими карточками. Удаляем объект из Storage
      // только если после снятия текущей ссылки он больше нигде не используется.
      const [{data: coverRefs,error: coverErr},{data: galleryRefs,error: galleryErr}] = await Promise.all([
        db().from('characters').select('id').eq('cover_url', item.url).limit(1),
        db().from('gallery_items').select('id').eq('image_url', item.url).limit(1)
      ]);
      if (coverErr || galleryErr) warning = ' Изображение убрано из карточки, но проверка повторного использования файла не удалась; объект в хранилище оставлен.';
      else if (!(coverRefs || []).length && !(galleryRefs || []).length) {
        const {error} = await db().storage.from('character-images').remove([path]);
        if (error) warning = ` Изображение убрано из карточки, но файл в хранилище удалить не удалось: ${error.message}`;
      }
    }
    await loadImageManager();
    if (warning) alert(warning);
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


  async function fetchAllRows(table, select, orderColumn = 'created_at') {
    const pageSize = 500;
    const result = [];
    for (let from = 0; ; from += pageSize) {
      let query = db().from(table).select(select);
      if (orderColumn) query = query.order(orderColumn, { ascending: true });
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) throw new Error(`Не удалось выгрузить ${table}: ${error.message}`);
      const batch = data || [];
      result.push(...batch);
      if (batch.length < pageSize) break;
    }
    return result;
  }

  async function exportBackup() {
    const button = $('export-backup');
    if (button.disabled) return;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Подготовка копии…';
    try {
      if (!(await isAdmin())) throw new Error('Недостаточно прав для создания резервной копии.');
      const characters = await fetchAllRows(
        'characters',
        '*,character_names(*),faction_periods(*),rank_periods(*),gallery_items(*)',
        'created_at'
      );
      const auditLog = await fetchAllRows(
        'archive_audit_log',
        'id,created_at,actor_id,action,table_name,character_id,character_name,changes',
        'created_at'
      );
      const backup = {
        format: 'catwar-archive-backup',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        note: 'Резервная копия данных и ссылок на изображения. Сами файлы изображений находятся отдельно в Supabase Storage.',
        counts: { characters: characters.length, auditLog: auditLog.length },
        characters,
        auditLog
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `catwar-archive-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      alert(`Резервная копия подготовлена. Персонажей: ${characters.length}; событий журнала: ${auditLog.length}.\n\nХрани файл в надёжном месте. Изображения сохранены в копии как ссылки, а не как файлы.`);
    } catch (error) {
      alert(`Не удалось создать резервную копию: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }


  const backupParentFields = [
    'id','game_id','last_name','birth_date','death_date','death_cause','biography',
    'notes','profile_url','cover_url','deleted_at','created_at','updated_at'
  ];
  const backupChildFields = {
    character_names: ['id','character_id','name','position'],
    faction_periods: ['id','character_id','faction_name','start_date','end_date','position','created_at'],
    rank_periods: ['id','character_id','rank_name','start_date','end_date','position','created_at'],
    gallery_items: ['id','character_id','image_url','caption','position','created_at']
  };
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function pickFields(row, fields) {
    const result = {};
    for (const field of fields) if (Object.prototype.hasOwnProperty.call(row, field)) result[field] = row[field];
    return result;
  }

  function validateBackupObject(data) {
    if (!data || data.format !== 'catwar-archive-backup' || data.formatVersion !== 1 || !Array.isArray(data.characters)) {
      throw new Error('Формат файла не распознан. Нужна резервная копия CatWar Archive версии 1.');
    }
    if (data.characters.length > 100000) throw new Error('В файле слишком много записей.');
    const seen = new Set();
    const normalized = data.characters.map((character, index) => {
      if (!character || typeof character !== 'object' || !uuidPattern.test(character.id || '') || !String(character.last_name || '').trim()) {
        throw new Error(`Некорректная карточка персонажа в строке ${index + 1}: отсутствует UUID или последнее имя.`);
      }
      if (seen.has(character.id)) throw new Error(`В резервной копии повторяется UUID персонажа ${character.id}.`);
      seen.add(character.id);
      const row = pickFields(character, backupParentFields);
      for (const table of Object.keys(backupChildFields)) {
        const values = character[table] ?? [];
        if (!Array.isArray(values)) throw new Error(`Поле ${table} у персонажа «${character.last_name}» имеет неверный формат.`);
        row[table] = values.map((item, childIndex) => {
          if (!item || typeof item !== 'object') throw new Error(`Повреждена связанная запись ${table} у персонажа «${character.last_name}».`);
          const child = pickFields(item, backupChildFields[table]);
          if (child.character_id && child.character_id !== character.id) throw new Error(`Несовпадение character_id в ${table} у персонажа «${character.last_name}».`);
          child.character_id = character.id;
          if (child.id && !uuidPattern.test(child.id)) throw new Error(`Некорректный UUID в ${table} у персонажа «${character.last_name}».`);
          return child;
        });
      }
      return row;
    });
    return { ...data, characters: normalized };
  }

  async function validateBackupFile() {
    const file = $('backup-file').files[0];
    validatedBackup = null;
    $('restore-backup').disabled = true;
    if (!file) { $('backup-preview').textContent = 'Сначала выбери JSON-файл.'; return; }
    if (file.size > 50 * 1024 * 1024) { $('backup-preview').textContent = 'Файл превышает допустимый размер 50 МБ.'; return; }
    try {
      const parsed = JSON.parse(await file.text());
      const backup = validateBackupObject(parsed);
      if (!(await isAdmin())) throw new Error('Недостаточно прав администратора.');
      const ids = backup.characters.map(x => x.id);
      let existing = 0;
      const chunkSize = 200;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const { data, error } = await db().from('characters').select('id').in('id', ids.slice(i, i + chunkSize));
        if (error) throw error;
        existing += (data || []).length;
      }
      validatedBackup = backup;
      const fresh = backup.characters.length - existing;
      $('backup-preview').innerHTML = `<div class="backup-preview-card"><strong>Файл прошёл проверку</strong><span>Дата создания копии: ${esc(backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('ru-RU') : 'не указана')}</span><span>Персонажей в файле: ${backup.characters.length}</span><span>Будет добавлено: ${fresh}</span><span>Будет обновлено по совпадающему UUID: ${existing}</span><span>Исторических событий в файле: ${Number(backup.auditLog?.length || 0)} (они не импортируются повторно)</span></div>`;
      $('restore-backup').disabled = backup.characters.length === 0;
    } catch (error) {
      $('backup-preview').textContent = `Проверка не пройдена: ${error.message}`;
    }
  }

  async function restoreBackup() {
    if (!validatedBackup || saving) return;
    const backup = validatedBackup;
    const confirmed = confirm(`Восстановить ${backup.characters.length} персонажей из резервной копии? Записи с совпадающими UUID будут перезаписаны данными из файла. Записи, которых нет в файле, останутся без изменений. Это действие нельзя автоматически отменить.`);
    if (!confirmed) return;
    saving = true;
    const button = $('restore-backup');
    button.disabled = true;
    const original = button.textContent;
    let completed = 0;
    try {
      if (!(await isAdmin())) throw new Error('Недостаточно прав администратора.');
      for (const character of backup.characters) {
        const parent = pickFields(character, backupParentFields);
        const { error: parentError } = await db().from('characters').upsert(parent, { onConflict: 'id' });
        if (parentError) throw new Error(`Персонаж «${character.last_name}»: ${parentError.message}`);
        for (const table of Object.keys(backupChildFields)) {
          const { error: deleteError } = await db().from(table).delete().eq('character_id', character.id);
          if (deleteError) throw new Error(`Очистка ${table} у «${character.last_name}»: ${deleteError.message}`);
          const rows = (character[table] || []).map(item => pickFields(item, backupChildFields[table]));
          if (rows.length) {
            const { error: insertError } = await db().from(table).insert(rows);
            if (insertError) throw new Error(`Восстановление ${table} у «${character.last_name}»: ${insertError.message}`);
          }
        }
        completed++;
        button.textContent = `Восстановлено ${completed}/${backup.characters.length}…`;
      }
      $('backup-preview').innerHTML = `<div class="backup-preview-card"><strong>Восстановление завершено</strong><span>Обработано персонажей: ${completed}</span><span>Журнал сохранён без повторного импорта старых событий; восстановление будет отражено новыми событиями.</span></div>`;
      validatedBackup = null;
      $('backup-file').value = '';
      await loadAdminList();
      alert(`Восстановление завершено. Обработано персонажей: ${completed}.`);
    } catch (error) {
      $('backup-preview').textContent = `Восстановление остановлено после ${completed} персонажей. ${error.message} Можно повторно выбрать тот же файл: уже восстановленные записи будут обработаны заново.`;
    } finally {
      saving = false;
      button.textContent = original;
      button.disabled = !validatedBackup;
    }
  }

  const auditTableLabels = {
    characters: 'Карточка персонажа', character_names: 'История имён',
    faction_periods: 'История фракций', rank_periods: 'История должностей',
    gallery_items: 'Галерея'
  };
  const auditFieldLabels = {
    game_id: 'Игровой ID', last_name: 'Последнее имя', birth_date: 'Дата рождения',
    death_date: 'Дата смерти', death_cause: 'Причина смерти', biography: 'Биография',
    notes: 'Заметки', profile_url: 'Ссылка на профиль', cover_url: 'Основное изображение',
    deleted_at: 'Статус в архиве', name: 'Имя', faction_name: 'Фракция', rank_name: 'Должность',
    start_date: 'Дата начала', end_date: 'Дата окончания', image_url: 'Изображение',
    caption: 'Подпись', position: 'Порядок'
  };
  const auditActionLabels = { INSERT: 'Создание', UPDATE: 'Изменение', DELETE: 'Окончательное удаление' };
  function auditValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    if (String(value).includes('/storage/v1/object/')) return 'Изображение обновлено';
    return String(value);
  }
  async function loadAuditLog() {
    $('admin-list').hidden = true;
    $('audit-panel').hidden = false;
    $('new-character').hidden = true;
    $('log-tab').classList.add('active');
    $('log-tab').setAttribute('aria-selected', 'true');
    $('active-tab').classList.remove('active'); $('trash-tab').classList.remove('active');
    $('active-tab').setAttribute('aria-selected', 'false'); $('trash-tab').setAttribute('aria-selected', 'false');
    const host = $('audit-list');
    host.innerHTML = '<p class="muted">Загружаем журнал…</p>';
    const { data, error } = await db().from('archive_audit_log')
      .select('id,created_at,actor_id,action,table_name,character_id,character_name,changes')
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      host.innerHTML = `<p class="form-message">Не удалось загрузить журнал: ${esc(error.message)}. Проверь, что SQL-миграция журнала выполнена.</p>`;
      return;
    }
    host.innerHTML = (data || []).map(entry => {
      const details = Object.entries(entry.changes || {}).map(([key, pair]) => {
        const label = auditFieldLabels[key] || key;
        const before = pair && typeof pair === 'object' && 'old' in pair ? auditValue(pair.old) : '—';
        const after = pair && typeof pair === 'object' && 'new' in pair ? auditValue(pair.new) : auditValue(pair);
        return `<li><strong>${esc(label)}:</strong> ${esc(before)} <span aria-hidden="true">→</span> ${esc(after)}</li>`;
      }).join('');
      const actor = entry.actor_id ? `Администратор · ${entry.actor_id.slice(0,8)}…` : 'Системное действие';
      return `<article class="audit-entry"><div class="audit-entry-top"><strong>${esc(auditActionLabels[entry.action] || entry.action)} · ${esc(entry.character_name || 'Персонаж')}</strong><time>${esc(new Date(entry.created_at).toLocaleString('ru-RU'))}</time></div><div class="audit-meta">${esc(auditTableLabels[entry.table_name] || entry.table_name)} · ${esc(actor)}</div>${details ? `<ul>${details}</ul>` : '<p class="audit-no-details">Изменение без отдельных полей.</p>'}</article>`;
    }).join('') || '<p class="muted">Записей пока нет. Новые действия будут появляться здесь.</p>';
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
    // Сохраняем UUID существующих дочерних записей: полная очистка и повторная
    // вставка превращали каждое обычное сохранение в DELETE + INSERT в журнале.
    const { data: existingRows, error: loadError } = await db()
      .from(table).select('*').eq('character_id', characterId);
    if (loadError) throw loadError;

    const existing = existingRows || [];
    const existingById = new Map(existing.map(item => [item.id, item]));
    const keptIds = new Set();
    const pendingInserts = [];

    for (let index = 0; index < rows.length; index++) {
      const source = rows[index];
      const row = { ...source, character_id: characterId };

      // Для периодов и галереи используем сохранённый UUID.
      // Для истории имён (textarea) сопоставляем строки по позиции:
      // изменение имени становится UPDATE, а не удалением и созданием.
      let existingId = row.id || null;
      if (!existingId && table === 'character_names') {
        const match = existing.find(item => Number(item.position) === Number(row.position));
        if (match) existingId = match.id;
      }

      delete row.id;
      if (existingId) {
        const previous = existingById.get(existingId);
        const changed = !previous || Object.entries(row).some(([key, value]) => {
          if (key === 'character_id') return false;
          const before = previous[key] ?? null;
          const after = value ?? null;
          return before !== after;
        });
        if (changed) {
          const { error } = await db().from(table).update(row)
            .eq('id', existingId).eq('character_id', characterId);
          if (error) throw error;
        }
        keptIds.add(existingId);
      } else {
        pendingInserts.push(row);
      }
    }

    const removedIds = existing.map(item => item.id).filter(id => !keptIds.has(id));
    if (removedIds.length) {
      const { error } = await db().from(table).delete()
        .eq('character_id', characterId).in('id', removedIds);
      if (error) throw error;
    }

    if (pendingInserts.length) {
      const { error } = await db().from(table).insert(pendingInserts);
      if (error) throw error;
    }
  }

  $('login-form').onsubmit = async event => {
    event.preventDefault();
    if (!configured()) { $('login-message').textContent = 'Сначала настройте Supabase в js/config.js.'; return; }
    $('login-message').textContent = 'Выполняется вход…';
    const { data, error } = await db().auth.signInWithPassword({ email: $('email').value, password: $('password').value });
    if (error) { $('login-message').textContent = error.message; return; }
    await refreshAccess(data.session);
  };
  $('logout').onclick = async () => { await db().auth.signOut(); location.reload(); };
  $('new-character').onclick = resetForm;
  $('save-featured-character').onclick = saveFeaturedCharacter;
  $('clear-featured-character').onclick = clearFeaturedCharacter;
  $('export-backup').onclick = exportBackup;
  $('import-backup-toggle').onclick = () => { $('backup-restore-panel').hidden = false; $('backup-restore-panel').scrollIntoView({ behavior: 'smooth' }); };
  $('close-import').onclick = () => { $('backup-restore-panel').hidden = true; };
  $('validate-backup').onclick = validateBackupFile;
  $('backup-file').onchange = () => { validatedBackup = null; $('restore-backup').disabled = true; $('backup-preview').textContent = 'Нажми «Проверить файл», чтобы проверить структуру копии.'; };
  $('restore-backup').onclick = restoreBackup;
  $('cancel-edit').onclick = () => { $('editor').hidden = true; };
  $('admin-search').oninput = loadAdminList;
  $('active-tab').onclick = () => { auditMode = false; listMode = 'active'; loadAdminList(); };
  $('trash-tab').onclick = () => { auditMode = false; listMode = 'trash'; loadAdminList(); };
  $('log-tab').onclick = () => { auditMode = true; loadAdminList(); };
  $('images-tab').onclick = () => { auditMode = false; loadImageManager(); };
  $('refresh-images').onclick = loadImageManager;
  $('image-search').oninput = renderImageManager;
  $('image-kind').onchange = renderImageManager;
  $('refresh-audit').onclick = loadAuditLog;
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
        id: row.id, faction_name: row.faction_name.trim(), start_date: row.start_date || null, end_date: row.end_date || null, position
      })));
      await replaceChildren('rank_periods', characterId, rankRows.map((row, position) => ({
        id: row.id, rank_name: row.rank_name.trim(), start_date: row.start_date || null, end_date: row.end_date || null, position
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
        if (image_url) galleryToSave.push({ id: item.id, image_url, caption: (item.caption || '').trim() || null, position });
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
    db().auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Не выполняем запросы Supabase внутри auth callback: это предотвращает блокировки и мигание формы входа.
        setTimeout(() => refreshAccess(session).catch(error => { $('auth-loading').hidden = true; $('login-panel').hidden = false; $('login-message').textContent = error.message; }), 0);
      }
    });
    refreshAccess().catch(error => { $('auth-loading').hidden = true; $('login-panel').hidden = false; $('login-message').textContent = error.message; });
  } else {
    $('login-message').textContent = 'Подключите Supabase: заполните js/config.js и выполните SQL из supabase/schema.sql.';
  }
})();
