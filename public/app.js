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
    const modalGroup = document.getElementById('modal-group');
    const modalAssigneeBadge = document.getElementById('modal-assignee-badge');
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

    const valDeskDest = document.getElementById('val-desk-dest');
    const valChairDest = document.getElementById('val-chair-dest');
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

    // ユーザーの権限判定関数（団体側か？）
    function isGroupUser() {
        if (!currentUser) return true;
        return currentUser.role === '団体責任者' || currentUser.role === '団体副責任者';
    }

    // --- 🔒 ログイン状態チェック & 検索バー切り替え ---
    function checkLoginState() {
        const savedUser = localStorage.getItem('shibaurafes_user');

        if (savedUser) {
            currentUser = JSON.parse(savedUser);
            loginUserDisp.textContent = `👤 ${currentUser.username} (${currentUser.role})`;
            logoutBtn.classList.remove('hidden');
            loginModal.classList.add('hidden');

            // 団体側の場合は検索バーを非表示、委員会なら表示
            if (isGroupUser()) {
                searchBoxContainer.classList.add('hidden');
            } else {
                searchBoxContainer.classList.remove('hidden');
            }
        } else {
            currentUser = null;
            loginUserDisp.textContent = '👤 未ログイン';
            logoutBtn.classList.add('hidden');
            loginModal.classList.remove('hidden');
        }
    }

    // ログインフォーム送信
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = loginUsernameInput.value.trim();
        const password = loginPasswordInput.value.trim();

        try {
            loginSubmitBtn.disabled = true;
            loginErrorMsg.classList.add('hidden');

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
                loginErrorMsg.textContent = result.message;
                loginErrorMsg.classList.remove('hidden');
            }
        } catch (err) {
            loginErrorMsg.textContent = '通信エラーが発生しました';
            loginErrorMsg.classList.remove('hidden');
        } finally {
            loginSubmitBtn.disabled = false;
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('shibaurafes_user');
        checkLoginState();
    });

    // --- 1. データ取得 & 表示（権限ごとの絞り込み・検索適用） ---
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

    // 権限・検索キーワードに合わせてカードをフィルタ描画
    function renderFilteredCards() {
        if (isGroupUser()) {
            // 団体側：自分の担当教室1件のみ抽出
            const myRoom = currentUser.assignedRoom ? currentUser.assignedRoom.trim().toLowerCase() : '';
            const filtered = classroomData.filter(item =>
                item['教室名'] && item['教室名'].toLowerCase().trim() === myRoom
            );
            renderCardsByFloor(filtered);
        } else {
            // 委員会：検索キーワードがあれば絞り込み、なければ全件
            const keyword = searchInput.value.toLowerCase().trim();
            if (keyword) {
                const filtered = classroomData.filter(item =>
                    (item['教室名'] && item['教室名'].toLowerCase().includes(keyword)) ||
                    (item['階数'] && item['階数'].toLowerCase().includes(keyword)) ||
                    (item['団体名'] && item['団体名'].toLowerCase().includes(keyword)) ||
                    (item['担当者'] && item['担当者'].toLowerCase().includes(keyword))
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

    // --- 2. カード一覧の階数別描画 ---
    function renderCardsByFloor(data) {
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
        if (!currentSelectedRoom) return;
        const selectedKey = editItemKey.value;
        const currentVal = currentSelectedRoom[selectedKey] || '0';
        editOldVal.value = currentVal;
        editNewVal.value = currentVal;
    }

    // --- 3. 詳細モーダル表示 ---
    async function openModal(item) {
        currentSelectedRoom = item;

        document.getElementById('modal-floor').textContent = item['階数'] || '階未指定';
        modalTitle.textContent = item['教室名'] || '';
        modalGroup.textContent = item['団体名'] || '団体名未設定';

        const assignee = item['担当者'];
        if (assignee) {
            modalAssigneeBadge.className = 'assignee-badge';
            modalAssigneeBadge.textContent = `👤 担当: ${assignee}`;
        } else {
            modalAssigneeBadge.className = 'assignee-badge unassigned';
            modalAssigneeBadge.textContent = '👤 未担当';
        }

        document.getElementById('val-leader').textContent = item['責任者'] || '-';
        document.getElementById('val-subleader').textContent = item['副責任者'] || '-';

        document.getElementById('val-single-desk').textContent = item['一人用机'] || '-';
        document.getElementById('val-single-chair').textContent = item['一人用椅子'] || '-';

        document.getElementById('td-deskA-orig').textContent = item['机α（元の数）'] || '0';
        document.getElementById('td-deskA-used').textContent = item['机α（使用数）'] || '0';
        document.getElementById('td-deskA-move').textContent = item['机α（移動数）'] || '0';
        document.getElementById('td-deskA-dest').textContent = item['机移動先'] || '-';

        document.getElementById('td-deskB-orig').textContent = item['机β（元の数）'] || '0';
        document.getElementById('td-deskB-used').textContent = item['机β（使用数）'] || '0';
        document.getElementById('td-deskB-move').textContent = item['机β（移動数）'] || '0';

        document.getElementById('td-chair-orig').textContent = item['椅子（元の数）'] || '0';
        document.getElementById('td-chair-used').textContent = item['椅子（使用数）'] || '0';
        document.getElementById('td-chair-move').textContent = item['椅子（移動数）'] || '0';
        document.getElementById('td-chair-dest').textContent = item['椅子移動先'] || '-';

        document.getElementById('val-remarks').textContent = item['備考'] || 'なし';

        // 🔒 団体側の権限制限（UI切り替え）
        if (isGroupUser()) {
            modalStatusSelect.disabled = true;
            stepBackBtn.style.display = 'none';

            modalClaimBtn.classList.add('hidden');
            modalUnclaimBtn.classList.add('hidden');

            adminDivider.classList.add('hidden');
            adminFeatureAccordion.classList.add('hidden');
        } else {
            modalStatusSelect.disabled = false;
            stepBackBtn.style.display = 'inline-block';

            adminDivider.classList.remove('hidden');
            adminFeatureAccordion.classList.remove('hidden');

            updateOldValueDisplay();
            await fetchLogs(item['教室名']);
        }

        updateModalCheckArea();
        modal.classList.remove('hidden');

        updateModalCheckArea();
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    }

    // モーダル内の進捗＆ボタン同期制御
    function updateModalCheckArea() {
        if (!currentSelectedRoom) return;
        const stepIdx = getCurrentStepIndex(currentSelectedRoom);
        const step = checkSteps[stepIdx];
        stepTitle.textContent = step.name;
        modalStatusSelect.value = currentSelectedRoom[step.key] || '未実施';
        stepBackBtn.disabled = (stepIdx === 0);

        const activeUser = currentUser ? currentUser.username : '';
        const assigneeStr = currentSelectedRoom['担当者'] || '';
        const assignees = assigneeStr.split(',').map(s => s.trim()).filter(Boolean);

        valAssignedUser.textContent = assigneeStr || '未登録';

        // 委員会アカウントの場合のみボタンの表示制御（団体側は非表示）
        if (!isGroupUser()) {
            const isMeAssigned = assignees.includes(activeUser);

            if (isMeAssigned) {
                // 自分が担当中の場合 ➔ 「担当を外す」ボタンだけを表示
                modalClaimBtn.classList.add('hidden');
                modalUnclaimBtn.classList.remove('hidden');
            } else {
                // まだ自分が担当していない場合 ➔ 「自分が担当する」ボタンだけを表示
                modalClaimBtn.classList.remove('hidden');
                modalUnclaimBtn.classList.add('hidden');
            }
        }
    }

    // 「自分が担当する」ボタン
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
            if (updatedRoom) openModal(updatedRoom);
        } catch (err) {
            alert('担当追加に失敗しました');
        } finally {
            modalClaimBtn.disabled = false;
        }
    });

    // 「担当を外す」ボタン
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
            if (updatedRoom) openModal(updatedRoom);
        } catch (err) {
            alert('担当解除に失敗しました');
        } finally {
            modalUnclaimBtn.disabled = false;
        }
    });

    // ログ取得処理
    async function fetchLogs(roomName) {
        if (isGroupUser()) return;
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

    // ステータス変更時（進捗更新 ＋ ログ保存）
    modalStatusSelect.addEventListener('change', async (e) => {
        if (!currentSelectedRoom || !currentUser || isGroupUser()) return;

        const newVal = e.target.value;
        const stepIdx = getCurrentStepIndex(currentSelectedRoom);
        const step = checkSteps[stepIdx];
        const oldVal = currentSelectedRoom[step.key] || '未実施';

        if (oldVal === newVal) return; // 変更がなければ処理しない

        try {
            modalStatusSelect.disabled = true;

            // APIに更新依頼（旧値・新値・操作者名を送信）
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
                if (updatedRoom) openModal(updatedRoom); // ログ表示を再読み込みして即時更新
            } else {
                alert('進捗の更新に失敗しました');
            }
        } catch (err) {
            alert('通信エラーが発生しました');
        } finally {
            modalStatusSelect.disabled = false;
        }
    });
    // 数量更新ボタン
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
                if (updatedRoom) openModal(updatedRoom);
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

    editItemKey.addEventListener('change', updateOldValueDisplay);

    sizeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            sizeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            cardList.className = `floor-container size-${e.target.dataset.size}`;
        });
    });

    // モーダルを閉じる関数
    function closeModal() {
        modal.classList.add('hidden');

        // ★ body の modal-open クラスを確実に削除してスクロールを復活させる
        document.body.classList.remove('modal-open');

        currentSelectedRoom = null;

        // 必要に応じてカード一覧の表示状態を再描画
        if (typeof renderFilteredCards === 'function') {
            renderFilteredCards();
        }
    }

    stepBackBtn.addEventListener('click', () => {
        if (!currentSelectedRoom) return;
        const stepIdx = getCurrentStepIndex(currentSelectedRoom);
        if (stepIdx > 0) {
            currentSelectedRoom._currentStepIndex = stepIdx - 1;
            updateModalCheckArea();
        }
    });

    // 閉じるボタン（×）クリック時
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', closeModal);
    }

    // モーダル背景（オーバーレイ）クリック時
    if (modalOverlay) {
        modalOverlay.addEventListener('click', closeModal);
    }

    // Escキーが押された時にも確実に閉じてスクロールを解除
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });

    // 委員会アカウント時のリアルタイム検索
    searchInput.addEventListener('input', () => {
        renderFilteredCards();
    });

    refreshBtn.addEventListener('click', fetchData);

    // --- 初期化 ---
    checkLoginState();
    if (currentUser) {
        fetchData();
    }
});