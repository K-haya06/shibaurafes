document.addEventListener('DOMContentLoaded', () => {
    const cardList = document.getElementById('card-list');
    const refreshBtn = document.getElementById('refresh-btn');
    const sizeBtns = document.querySelectorAll('.size-btn');
    const searchBoxContainer = document.getElementById('search-box-container');
    const searchInput = document.getElementById('search-input');

    // ログイン関連要素
    const loginModal = document.getElementById('login-modal');
    const loginForm = document.getElementById('login-form');
    const loginUsernameInput = document.getElementById('login-username');
    const loginPasswordInput = document.getElementById('login-password');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const loginSubmitBtn = document.getElementById('login-submit-btn');
    const loginUserDisp = document.getElementById('login-user-disp');
    const logoutBtn = document.getElementById('logout-btn');

    // モーダル関連要素
    const modal = document.getElementById('detail-modal');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalTitle = document.getElementById('modal-title');
    const modalRoomName = document.getElementById('modal-room-name'); // ★ 教室名表示要素
    const modalGroup = document.getElementById('modal-group');
    const modalGroupName = document.getElementById('modal-group-name'); // ★ 団体名表示要素
    const modalAssigneeBadge = document.getElementById('modal-assignee-badge') || document.getElementById('modal-assignee');
    const modalClaimBtn = document.getElementById('modal-claim-btn');
    const modalUnclaimBtn = document.getElementById('modal-unclaim-btn');

    // 編集・ログ制御用エレメント
    const adminDivider = document.getElementById('admin-divider');
    const adminFeatureAccordion = document.getElementById('admin-feature-accordion');
    const editItemKey = document.getElementById('edit-item-key');
    const editOldVal = document.getElementById('edit-old-val');
    const editNewVal = document.getElementById('edit-new-val');
    const editNote = document.getElementById('edit-note');
    const saveQtyBtn = document.getElementById('save-qty-btn');
    const logList = document.getElementById('log-list');

    const stepTitle = document.getElementById('current-step-name');
    const stepBackBtn = document.getElementById('step-back-btn');
    const modalStatusSelect = document.getElementById('modal-status-select');
    const valAssignedUser = document.getElementById('val-assigned-user');

    let classroomData = [];
    let currentSelectedRoom = null;
    let currentUser = null; // { username, role, assignedRoom }

    const checkSteps = [
        { key: '準備_1次チェック', name: '準備 1次' },
        { key: '準備_2次チェック', name: '準備 2次' },
        { key: '準備_3次チェック', name: '準備 3次' },
        { key: '片付け_1次チェック', name: '片付け 1次' },
        { key: '片付け_2次チェック', name: '片付け 2次' },
        { key: '片付け_3次チェック', name: '片付け 3次' }
    ];

    function isGroupUser() {
        if (!currentUser) return true;
        return currentUser.role === '団体責任者' || currentUser.role === '団体副責任者';
    }

    function checkLoginState() {
        const savedUser = localStorage.getItem('shibaurafes_user');

        if (savedUser) {
            currentUser = JSON.parse(savedUser);
            if (loginUserDisp) loginUserDisp.textContent = `👤 ${currentUser.username} (${currentUser.role})`;
            if (logoutBtn) logoutBtn.classList.remove('hidden');
            if (loginModal) loginModal.classList.add('hidden');

            if (searchBoxContainer) {
                if (isGroupUser()) {
                    searchBoxContainer.classList.add('hidden');
                } else {
                    searchBoxContainer.classList.remove('hidden');
                }
            }
        } else {
            currentUser = null;
            if (loginUserDisp) loginUserDisp.textContent = '👤 未ログイン';
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (loginModal) loginModal.classList.remove('hidden');
        }
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = loginUsernameInput.value.trim();
            const password = loginPasswordInput.value.trim();

            try {
                if (loginSubmitBtn) loginSubmitBtn.disabled = true;
                if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const result = await res.json();
                if (result.success) {
                    localStorage.setItem('shibaurafes_user', JSON.stringify(result.user));
                    checkLoginState();
                    await fetchData();
                } else {
                    if (loginErrorMsg) {
                        loginErrorMsg.textContent = result.message;
                        loginErrorMsg.classList.remove('hidden');
                    }
                }
            } catch (err) {
                if (loginErrorMsg) {
                    loginErrorMsg.textContent = '通信エラーが発生しました';
                    loginErrorMsg.classList.remove('hidden');
                }
            } finally {
                if (loginSubmitBtn) loginSubmitBtn.disabled = false;
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('shibaurafes_user');
            checkLoginState();
        });
    }

    async function fetchData() {
        if (!currentUser) return;
        try {
            const res = await fetch('/api/classrooms');
            classroomData = await res.json();
            renderFilteredCards();
        } catch (err) {
            alert('データの取得に失敗しました');
            console.error(err);
        }
    }

    function renderFilteredCards() {
        if (isGroupUser()) {
            const myRoom = currentUser.assignedRoom ? currentUser.assignedRoom.trim().toLowerCase() : '';
            const filtered = classroomData.filter(item =>
                item['教室名'] && item['教室名'].toLowerCase().trim() === myRoom
            );
            renderCardsByFloor(filtered);
        } else {
            const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';
            if (keyword) {
                const filtered = classroomData.filter(item =>
                    (item['教室名'] && item['教室名'].toLowerCase().includes(keyword)) ||
                    (item['階数'] && item['階数'].toLowerCase().includes(keyword)) ||
                    (item['団体名'] && item['団体名'].toLowerCase().includes(keyword)) ||
                    (item['担当者'] && item['担当者'].toLowerCase().includes(keyword)) ||
                    (item['控え室'] && String(item['控え室']).toLowerCase().includes(keyword))
                );
                renderCardsByFloor(filtered);
            } else {
                renderCardsByFloor(classroomData);
            }
        }
    }

    function getCurrentStepIndex(item) {
        if (item._currentStepIndex !== undefined) return item._currentStepIndex;
        for (let i = 0; i < checkSteps.length; i++) {
            if (item[checkSteps[i].key] !== '完了') return i;
        }
        return checkSteps.length - 1;
    }

    function setSafeText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function renderCardsByFloor(data) {
        if (!cardList) return;
        cardList.innerHTML = '';

        if (data.length === 0) {
            cardList.innerHTML = '<div style="text-align:center; padding: 20px; color: #6c757d;">該当する教室データがありません</div>';
            return;
        }

        const floorMap = {};
        data.forEach(item => {
            const floor = item['階数'] || 'その他';
            if (!floorMap[floor]) floorMap[floor] = [];
            floorMap[floor].push(item);
        });

        Object.keys(floorMap).forEach(floor => {
            const floorSection = document.createElement('div');
            floorSection.className = 'floor-section';

            const floorTitle = document.createElement('div');
            floorTitle.className = 'floor-title';
            floorTitle.innerHTML = `🏢 ${floor}`;
            floorSection.appendChild(floorTitle);

            const cardGrid = document.createElement('div');
            cardGrid.className = 'card-grid';

            floorMap[floor].forEach(item => {
                const stepIdx = getCurrentStepIndex(item);
                const step = checkSteps[stepIdx];
                const status = item[step.key] || '未実施';
                const assignee = item['担当者'] || '';

                const deskAMove = parseInt(item['机α（移動数）'] || 0);
                const deskBMove = parseInt(item['机β（移動数）'] || 0);
                const chairMove = parseInt(item['椅子（移動数）'] || 0);

                const deskDest = item['机移動先'] || '-';
                const chairDest = item['椅子移動先'] || '-';

                const anteroom = (item['控え室'] || '').toString().trim();
                const anteroomBadge = anteroom 
                    ? `<span class="card-anteroom-text">🏠 控え室:${anteroom}</span>` 
                    : '';

                let assigneeHtml = '';
                if (assignee) {
                    assigneeHtml = `<span class="assignee-badge">👤 ${assignee}</span>`;
                } else if (!isGroupUser()) {
                    assigneeHtml = `<button class="claim-card-btn">＋担当する</button>`;
                }

                const card = document.createElement('div');
                card.className = 'room-card';
                card.innerHTML = `
                    <div class="card-header">
                        <div>
                            <span class="room-title">${item['教室名'] || ''}</span>
                            ${assigneeHtml}
                        </div>
                        <span class="group-name">${item['団体名'] || '未設定'}</span>
                    </div>

                    <div class="card-detail-rows">
                        <div>要移動 ➔ 机α: <span class="num-move">${deskAMove}</span> / 机β: <span class="num-move">${deskBMove}</span> / 椅子: <span class="num-move">${chairMove}</span></div>
                        <div>移動先 ➔ 机: <span class="dest-text">${deskDest}</span> / 椅子: <span class="dest-text">${chairDest}</span></div>
                    </div>

                    <div class="card-body">
                        <span class="status-badge" data-status="${status}">
                            ${step.name}: ${status}
                        </span>
                        ${anteroomBadge}
                    </div>
                `;

                const claimBtn = card.querySelector('.claim-card-btn');
                if (claimBtn) {
                    claimBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (!currentUser || isGroupUser()) return;
                        const stepIdx = getCurrentStepIndex(item);
                        const step = checkSteps[stepIdx];

                        await fetch('/api/update', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                rowIndex: item.rowIndex,
                                roomName: item['教室名'],
                                columnName: step.key,
                                value: item[step.key] || '未実施',
                                action: 'claim',
                                userName: currentUser.username
                            })
                        });
                        await fetchData();
                    });
                }

                card.addEventListener('click', () => openModal(item));
                cardGrid.appendChild(card);
            });

            floorSection.appendChild(cardGrid);
            cardList.appendChild(floorSection);
        });
    }

    function updateOldValueDisplay() {
        if (!currentSelectedRoom || !editItemKey) return;
        const selectedKey = editItemKey.value;
        const currentVal = currentSelectedRoom[selectedKey] || '0';
        if (editOldVal) editOldVal.value = currentVal;
        if (editNewVal) editNewVal.value = currentVal;
    }

    // 担当者の表示（バッジと詳細欄）を同期更新する関数
    function updateAssigneeUI(assigneeStr) {
        const assignee = assigneeStr || '';
        
        // 1. ヘッダーの担当バッジを更新（複数のID候補に対応）
        const badgeEl = document.getElementById('modal-assignee-badge') || document.getElementById('modal-assignee');
        if (badgeEl) {
            if (assignee) {
                badgeEl.className = 'assignee-badge';
                badgeEl.textContent = `👤 担当: ${assignee}`;
            } else {
                badgeEl.className = 'assignee-badge unassigned';
                badgeEl.textContent = '👤 未割り当て';
            }
        }

        // 2. 詳細領域の担当者文字を更新
        if (valAssignedUser) {
            valAssignedUser.textContent = assignee || '未登録';
        }
    }

    // --- 3. 詳細モーダル表示 ---
    async function openModal(item) {
        currentSelectedRoom = item;

        // ★ 教室名テキストの確実な反映（ID: modal-title と modal-room-name の両方に対応）
        const roomNameText = item['教室名'] || '';
        if (modalTitle) modalTitle.textContent = roomNameText;
        if (modalRoomName) modalRoomName.textContent = roomNameText;

        // ★ 階数と団体名の反映
        setSafeText('modal-floor', item['階数'] || '階未指定');
        const groupNameText = item['団体名'] || '団体名未設定';
        if (modalGroup) modalGroup.textContent = groupNameText;
        if (modalGroupName) modalGroupName.textContent = groupNameText;

        // ★ 控え室表示処理
        const anteroom = (item['控え室'] || '').toString().trim();
        const modalAnteroomEl = document.getElementById('modal-anteroom-info');
        if (modalAnteroomEl) {
            if (anteroom) {
                modalAnteroomEl.textContent = `🏠 控え室: ${anteroom}`;
                modalAnteroomEl.classList.remove('hidden');
            } else {
                modalAnteroomEl.classList.add('hidden');
            }
        }

        // ★ 担当者バッジのリアルタイム更新
        updateAssigneeUI(item['担当者']);

        setSafeText('val-leader', item['責任者'] || '-');
        setSafeText('val-subleader', item['副責任者'] || '-');

        setSafeText('val-single-desk', item['一人用机'] || '-');
        setSafeText('val-single-chair', item['一人用椅子'] || '-');

        setSafeText('td-deskA-orig', item['机α（元の数）'] || '0');
        setSafeText('td-deskA-used', item['机α（使用数）'] || '0');
        setSafeText('td-deskA-move', item['机α（移動数）'] || '0');
        setSafeText('td-deskA-dest', item['机移動先'] || '-');

        setSafeText('td-deskB-orig', item['机β（元の数）'] || '0');
        setSafeText('td-deskB-used', item['机β（使用数）'] || '0');
        setSafeText('td-deskB-move', item['机β（移動数）'] || '0');

        setSafeText('td-chair-orig', item['椅子（元の数）'] || '0');
        setSafeText('td-chair-used', item['椅子（使用数）'] || '0');
        setSafeText('td-chair-move', item['椅子（移動数）'] || '0');
        setSafeText('td-chair-dest', item['椅子移動先'] || '-');

        setSafeText('val-remarks', item['備考'] || 'なし');

        if (isGroupUser()) {
            if (modalStatusSelect) modalStatusSelect.disabled = true;
            if (stepBackBtn) stepBackBtn.style.display = 'none';

            if (modalClaimBtn) modalClaimBtn.classList.add('hidden');
            if (modalUnclaimBtn) modalUnclaimBtn.classList.add('hidden');

            if (adminDivider) adminDivider.classList.add('hidden');
            if (adminFeatureAccordion) adminFeatureAccordion.classList.add('hidden');
        } else {
            if (modalStatusSelect) modalStatusSelect.disabled = false;
            if (stepBackBtn) stepBackBtn.style.display = 'inline-block';

            if (adminDivider) adminDivider.classList.remove('hidden');
            if (adminFeatureAccordion) adminFeatureAccordion.classList.remove('hidden');

            updateOldValueDisplay();
            await fetchLogs(item['教室名']);
        }

        updateModalCheckArea();
        if (modal) modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    }

    function updateModalCheckArea() {
        if (!currentSelectedRoom) return;
        const stepIdx = getCurrentStepIndex(currentSelectedRoom);
        const step = checkSteps[stepIdx];
        if (stepTitle) stepTitle.textContent = step.name;
        if (modalStatusSelect) modalStatusSelect.value = currentSelectedRoom[step.key] || '未実施';
        if (stepBackBtn) stepBackBtn.disabled = (stepIdx === 0);

        const activeUser = currentUser ? currentUser.username : '';
        const assigneeStr = currentSelectedRoom['担当者'] || '';
        const assignees = assigneeStr.split(',').map(s => s.trim()).filter(Boolean);

        updateAssigneeUI(assigneeStr);

        if (!isGroupUser()) {
            const isMeAssigned = assignees.includes(activeUser);

            if (isMeAssigned) {
                if (modalClaimBtn) modalClaimBtn.classList.add('hidden');
                if (modalUnclaimBtn) modalUnclaimBtn.classList.remove('hidden');
            } else {
                if (modalClaimBtn) modalClaimBtn.classList.remove('hidden');
                if (modalUnclaimBtn) modalUnclaimBtn.classList.add('hidden');
            }
        }
    }

    if (modalClaimBtn) {
        modalClaimBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !currentUser || isGroupUser()) return;
            const stepIdx = getCurrentStepIndex(currentSelectedRoom);
            const step = checkSteps[stepIdx];

            try {
                modalClaimBtn.disabled = true;

                await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        columnName: step.key,
                        value: currentSelectedRoom[step.key] || '未実施',
                        action: 'claim',
                        userName: currentUser.username
                    })
                });

                await fetchData();
                const updatedRoom = classroomData.find(r => r.rowIndex === currentSelectedRoom.rowIndex);
                if (updatedRoom) {
                    currentSelectedRoom = updatedRoom;
                    openModal(updatedRoom);
                }
            } catch (err) {
                alert('担当追加に失敗しました');
            } finally {
                modalClaimBtn.disabled = false;
            }
        });
    }

    if (modalUnclaimBtn) {
        modalUnclaimBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !currentUser || isGroupUser()) return;
            const stepIdx = getCurrentStepIndex(currentSelectedRoom);
            const step = checkSteps[stepIdx];

            try {
                modalUnclaimBtn.disabled = true;

                await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        columnName: step.key,
                        value: currentSelectedRoom[step.key] || '未実施',
                        action: 'unclaim',
                        userName: currentUser.username
                    })
                });

                await fetchData();
                const updatedRoom = classroomData.find(r => r.rowIndex === currentSelectedRoom.rowIndex);
                if (updatedRoom) {
                    currentSelectedRoom = updatedRoom;
                    openModal(updatedRoom);
                }
            } catch (err) {
                alert('担当解除に失敗しました');
            } finally {
                modalUnclaimBtn.disabled = false;
            }
        });
    }

    async function fetchLogs(roomName) {
        if (isGroupUser() || !logList) return;
        logList.innerHTML = '<li class="empty-log">読み込み中...</li>';
        try {
            const res = await fetch(`/api/logs/${encodeURIComponent(roomName)}`);
            const logs = await res.json();

            if (!logs || logs.length === 0) {
                logList.innerHTML = '<li class="empty-log">変更履歴はありません</li>';
                return;
            }

            logList.innerHTML = '';
            logs.forEach(log => {
                const li = document.createElement('li');
                li.className = 'log-item';
                li.innerHTML = `
                    <div class="log-meta">
                        <span>👤 ${log.userName}</span>
                        <span>🕒 ${log.timestamp}</span>
                    </div>
                    <div class="log-body">
                        ${log.itemKey}: <code>${log.oldValue}</code> ➔ <strong>${log.newValue}</strong>
                    </div>
                    ${log.note ? `<div class="log-note">💬 ${log.note}</div>` : ''}
                `;
                logList.appendChild(li);
            });
        } catch (err) {
            logList.innerHTML = '<li class="empty-log">ログの取得に失敗しました</li>';
        }
    }

    if (modalStatusSelect) {
        modalStatusSelect.addEventListener('change', async (e) => {
            if (!currentSelectedRoom || !currentUser || isGroupUser()) return;

            const newVal = e.target.value;
            const stepIdx = getCurrentStepIndex(currentSelectedRoom);
            const step = checkSteps[stepIdx];
            const oldVal = currentSelectedRoom[step.key] || '未実施';

            if (oldVal === newVal) return;

            try {
                modalStatusSelect.disabled = true;

                const res = await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        columnName: step.key,
                        value: newVal,
                        userName: currentUser.username
                    })
                });

                const result = await res.json();
                if (result.success) {
                    currentSelectedRoom[step.key] = newVal;
                    if (newVal === '完了') delete currentSelectedRoom._currentStepIndex;

                    await fetchData();
                    const updatedRoom = classroomData.find(r => r.rowIndex === currentSelectedRoom.rowIndex);
                    if (updatedRoom) {
                        currentSelectedRoom = updatedRoom;
                        openModal(updatedRoom);
                    }
                } else {
                    alert('進捗の更新に失敗しました');
                }
            } catch (err) {
                alert('通信エラーが発生しました');
            } finally {
                modalStatusSelect.disabled = false;
            }
        });
    }

    if (saveQtyBtn) {
        saveQtyBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !currentUser || isGroupUser()) return;

            const itemKey = editItemKey.value;
            const oldValue = editOldVal.value;
            const newValue = editNewVal.value;
            const note = editNote.value.trim();

            if (oldValue === newValue) {
                alert('値が変更されていません');
                return;
            }

            try {
                saveQtyBtn.disabled = true;
                saveQtyBtn.textContent = '更新中...';

                const res = await fetch('/api/update-quantity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        userName: currentUser.username,
                        itemKey,
                        oldValue,
                        newValue,
                        note
                    })
                });

                const result = await res.json();
                if (result.success) {
                    alert('数量を更新し、ログに記録しました！');
                    await fetchData();
                    const updatedRoom = classroomData.find(r => r.rowIndex === currentSelectedRoom.rowIndex);
                    if (updatedRoom) {
                        currentSelectedRoom = updatedRoom;
                        openModal(updatedRoom);
                    }
                } else {
                    alert('更新失敗: ' + result.error);
                }
            } catch (err) {
                alert('更新中にエラーが発生しました');
            } finally {
                saveQtyBtn.disabled = false;
                saveQtyBtn.textContent = '数量を更新してログを保存';
            }
        });
    }

    if (editItemKey) editItemKey.addEventListener('change', updateOldValueDisplay);

    sizeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            sizeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            if (cardList) cardList.className = `floor-container size-${e.target.dataset.size}`;
        });
    });

    function closeModal() {
        if (modal) modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        currentSelectedRoom = null;

        if (typeof renderFilteredCards === 'function') {
            renderFilteredCards();
        }
    }

    if (stepBackBtn) {
        stepBackBtn.addEventListener('click', () => {
            if (!currentSelectedRoom) return;
            const stepIdx = getCurrentStepIndex(currentSelectedRoom);
            if (stepIdx > 0) {
                currentSelectedRoom._currentStepIndex = stepIdx - 1;
                updateModalCheckArea();
            }
        });
    }

    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderFilteredCards();
        });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', fetchData);

    checkLoginState();
    if (currentUser) {
        fetchData();
    }
});