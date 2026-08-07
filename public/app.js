document.addEventListener('DOMContentLoaded', () => {
    const cardList = document.getElementById('card-list');
    const refreshBtn = document.getElementById('refresh-btn');
    const sizeBtns = document.querySelectorAll('.size-btn');
    const searchBoxContainer = document.getElementById('search-box-container');
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');

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
    const modalRoomName = document.getElementById('modal-room-name');
    const modalGroupName = document.getElementById('modal-group-name');
    const modalClaimBtn = document.getElementById('modal-claim-btn');
    const modalUnclaimBtn = document.getElementById('modal-unclaim-btn');

    // 進捗制御用要素
    const stepBackBtn = document.getElementById('step-back-btn');
    const stepNextBtn = document.getElementById('step-next-btn');
    const stepTitle = document.getElementById('current-step-name');
    const currentStatusBadgeEl = document.getElementById('current-status-badge');
    const quickStatusActions = document.getElementById('quick-status-actions');

    // 編集・ログ制御用エレメント
    const adminDivider = document.getElementById('admin-divider');
    const adminFeatureAccordion = document.getElementById('admin-feature-accordion');
    const editItemKey = document.getElementById('edit-item-key');
    const editOldVal = document.getElementById('edit-old-val');
    const editNewVal = document.getElementById('edit-new-val');
    const editNote = document.getElementById('edit-note');
    const saveQtyBtn = document.getElementById('save-qty-btn');
    const saveDestBtn = document.getElementById('save-dest-btn');
    const logList = document.getElementById('log-list');
    const valAssignedUser = document.getElementById('val-assigned-user');

    let classroomData = [];
    let currentSelectedRoom = null;
    let currentUser = null;
    let currentStepIndex = 0;
    let lastDataHash = '';

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

    function isGuestUser() {
        if (!currentUser) return false;
        return currentUser.role === 'ゲスト';
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

    function generateDataHash(data) {
        return JSON.stringify(data.map(item => ({
            id: item.rowIndex,
            p1: item['準備_1次チェック'],
            p2: item['準備_2次チェック'],
            p3: item['準備_3次チェック'],
            c1: item['片付け_1次チェック'],
            c2: item['片付け_2次チェック'],
            c3: item['片付け_3次チェック'],
            assignee: item['担当者']
        })));
    }

    async function fetchData() {
        if (!currentUser) return;
        try {
            const res = await fetch('/api/classrooms');
            const newData = await res.json();

            classroomData = newData.map(newItem => {
                const oldItem = classroomData.find(old => old.rowIndex === newItem.rowIndex);
                if (oldItem && oldItem._currentStepIndex !== undefined) {
                    newItem._currentStepIndex = oldItem._currentStepIndex;
                }
                return newItem;
            });

            lastDataHash = generateDataHash(newData);
            const toast = document.getElementById('update-toast');
            if (toast) toast.classList.remove('show');

            renderFilteredCards();
        } catch (err) {
            console.error('データ取得失敗:', err);
        }
    }

    function showUpdateNotification() {
        let toast = document.getElementById('update-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'update-toast';
            toast.className = 'update-toast';
            toast.innerHTML = `
                <span>✨ 他の人がデータを更新しました</span>
                <button id="toast-refresh-btn">更新する</button>
            `;
            document.body.appendChild(toast);

            document.getElementById('toast-refresh-btn').addEventListener('click', async () => {
                toast.classList.remove('show');
                await fetchData();
            });
        }

        if (modal && modal.classList.contains('hidden')) {
            toast.classList.add('show');
        }
    }

    async function checkSilentUpdate() {
        if (!currentUser) return;
        try {
            const res = await fetch('/api/classrooms');
            const newData = await res.json();
            const newHash = generateDataHash(newData);

            if (lastDataHash && lastDataHash !== newHash) {
                if (modal && !modal.classList.contains('hidden') && currentSelectedRoom) {
                    const activeEl = document.activeElement;
                    const isEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT');

                    if (!isEditing) {
                        classroomData = newData.map(newItem => {
                            const oldItem = classroomData.find(old => old.rowIndex === newItem.rowIndex);
                            if (oldItem && oldItem._currentStepIndex !== undefined) {
                                newItem._currentStepIndex = oldItem._currentStepIndex;
                            }
                            return newItem;
                        });

                        const updatedRoom = classroomData.find(r => r.rowIndex === currentSelectedRoom.rowIndex);
                        if (updatedRoom) {
                            currentSelectedRoom = updatedRoom;
                            
                            updateModalCheckArea();
                            updateAssigneeUI(updatedRoom['担当者']);
                            
                            setSafeText('td-deskA-orig', updatedRoom['机α（元の数）'] || '0');
                            setSafeText('td-deskA-used', updatedRoom['机α（使用数）'] || '0');
                            setSafeText('td-deskA-move', updatedRoom['机α（移動数）'] || '0');
                            setSafeText('td-deskB-orig', updatedRoom['机β（元の数）'] || '0');
                            setSafeText('td-deskB-used', updatedRoom['机β（使用数）'] || '0');
                            setSafeText('td-deskB-move', updatedRoom['机β（移動数）'] || '0');
                            setSafeText('td-chair-orig', updatedRoom['椅子（元の数）'] || '0');
                            setSafeText('td-chair-used', updatedRoom['椅子（使用数）'] || '0');
                            setSafeText('td-chair-move', updatedRoom['椅子（移動数）'] || '0');
                        }

                        renderFilteredCards();
                        lastDataHash = newHash;
                    }
                } else {
                    showUpdateNotification();
                    lastDataHash = newHash;
                }
            } else {
                lastDataHash = newHash;
            }
        } catch (err) {
            console.warn('バックグラウンドチェック失敗:', err);
        }
    }

    setInterval(checkSilentUpdate, 30000);

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
                const filtered = classroomData.filter(item => {
                    const roomName = (item['教室名'] || '').toLowerCase();
                    const floor = (item['階数'] || '').toLowerCase();
                    const group = (item['団体名'] || '').toLowerCase();
                    const assignee = (item['担当者'] || '').toLowerCase();
                    const anteroom = String(item['控え室'] || '').toLowerCase();

                    const stepIdx = getCardDefaultStepIndex(item);
                    const step = checkSteps[stepIdx];
                    const currentStatus = (item[step.key] || '未実施').toLowerCase();
                    const fullStatusText = `${step.name}: ${currentStatus}`.toLowerCase();

                    return roomName.includes(keyword) ||
                        floor.includes(keyword) ||
                        group.includes(keyword) ||
                        assignee.includes(keyword) ||
                        anteroom.includes(keyword) ||
                        currentStatus.includes(keyword) ||
                        step.name.toLowerCase().includes(keyword) ||
                        fullStatusText.includes(keyword);
                });
                renderCardsByFloor(filtered);
            } else {
                renderCardsByFloor(classroomData);
            }
        }
    }

    function getCardDefaultStepIndex(item) {
        if (item._currentStepIndex !== undefined) {
            return item._currentStepIndex;
        }
        for (let i = checkSteps.length - 1; i >= 0; i--) {
            const val = item[checkSteps[i].key];
            if (val && val !== '未実施') {
                return i;
            }
        }
        return 0;
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
                const stepIdx = getCardDefaultStepIndex(item);
                const step = checkSteps[stepIdx];
                const status = item[step.key] || '未実施';
                const assignee = item['担当者'] || '';

                const deskAMove = parseInt(item['机α（移動数）'] || 0, 10);
                const deskBMove = parseInt(item['机β（移動数）'] || 0, 10);
                const chairMove = parseInt(item['椅子（移動数）'] || 0, 10);

                const deskADest = item['机α移動先'] || '-';
                const deskBDest = item['机β移動先'] || '-';
                const chairDest = item['椅子移動先'] || '-';

                const anteroom = (item['控え室'] || '').toString().trim();
                const anteroomBadge = anteroom
                    ? `<span class="card-anteroom-text" data-room="${anteroom}"><span class="full-label">🏠 控室:${anteroom}</span><span class="short-label">🏠 ${anteroom}</span></span>`
                    : '';

                let assigneeHtml = '';
                if (assignee) {
                    assigneeHtml = `<span class="assignee-badge">👤 ${assignee}</span>`;
                } else if (!isGroupUser() && !isGuestUser()) {
                    assigneeHtml = `<button class="claim-card-btn">＋担当する</button>`;
                }

                const card = document.createElement('div');
                card.className = 'room-card';

                card.innerHTML = `
                    <div class="card-header-top">
                        <span class="room-title">${item['教室名'] || ''}</span>
                        <span class="group-name">${item['団体名'] || '未設定'}</span>
                    </div>

                    <div class="card-assignee-row">
                        ${assigneeHtml}
                    </div>

                    <div class="card-detail-rows">
                        <div class="card-detail-item">
                            <span class="label-title">机α</span>
                            <span class="colon">:</span>
                            <span class="dest-text">${deskADest}</span>
                            <span class="text-particle">へ</span>
                            <span class="num-move-unit">${deskAMove}台</span>
                        </div>
                        <div class="card-detail-item">
                            <span class="label-title">机β</span>
                            <span class="colon">:</span>
                            <span class="dest-text">${deskBDest}</span>
                            <span class="text-particle">へ</span>
                            <span class="num-move-unit">${deskBMove}台</span>
                        </div>
                        <div class="card-detail-item">
                            <span class="label-title">椅子</span>
                            <span class="colon">:</span>
                            <span class="dest-text">${chairDest}</span>
                            <span class="text-particle">へ</span>
                            <span class="num-move-unit">${chairMove}脚</span>
                        </div>
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
                        if (!currentUser || isGroupUser() || isGuestUser()) return;
                        const stepIdx = getCardDefaultStepIndex(item);
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

                card.addEventListener('click', () => {
                    openModal(item);
                });

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

    function updateAssigneeUI(assigneeStr) {
        const assignee = assigneeStr || '';
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
        if (valAssignedUser) {
            valAssignedUser.textContent = assignee || '未登録';
        }
    }

    function resetModalForms() {
        if (editNote) editNote.value = '';
        const editDestName = document.getElementById('edit-new-dest-name');
        if (editDestName) editDestName.value = '';
        const editDestQty = document.getElementById('edit-dest-qty');
        if (editDestQty) editDestQty.value = '';
        const editDestNote = document.getElementById('edit-dest-note');
        if (editDestNote) editDestNote.value = '';
    }

    function formatDestHtml(destStr) {
        if (!destStr || destStr === '-') return '-';
        return destStr.replace(/,\s*/g, '<br>');
    }

    async function openModal(item) {
        currentSelectedRoom = item;
        currentStepIndex = getCardDefaultStepIndex(item);

        resetModalForms();

        const roomNameText = item['教室名'] || '';
        if (modalRoomName) modalRoomName.textContent = roomNameText;

        setSafeText('modal-floor', item['階数'] || '階未指定');
        const groupNameText = item['団体名'] || '団体名未設定';
        if (modalGroupName) modalGroupName.textContent = groupNameText;

        const anteroom = (item['控え室'] || '').toString().trim();
        const modalAnteroomEl = document.getElementById('modal-anteroom-info');
        if (modalAnteroomEl) {
            if (anteroom) {
                modalAnteroomEl.setAttribute('data-room', anteroom);
                modalAnteroomEl.innerHTML = `
                    <span class="full-label">🏠 控え室: ${anteroom}</span>
                    <span class="short-label">🏠 ${anteroom}</span>
                `;
                modalAnteroomEl.classList.remove('hidden');
            } else {
                modalAnteroomEl.classList.add('hidden');
            }
        }

        updateAssigneeUI(item['担当者']);

        setSafeText('val-leader', item['責任者'] || '-');
        setSafeText('val-subleader', item['副責任者'] || '-');

        const singleDeskVal = parseInt(item['一人用机'] || 0, 10);
        const singleChairVal = parseInt(item['一人用椅子'] || 0, 10);

        const sectionSpecialEquip = document.getElementById('section-special-equip');
        const boxSingleDesk = document.getElementById('box-single-desk');
        const boxSingleChair = document.getElementById('box-single-chair');

        if (boxSingleDesk) {
            if (singleDeskVal > 0) {
                setSafeText('val-single-desk', `${singleDeskVal}台`);
                boxSingleDesk.classList.remove('hidden');
            } else {
                boxSingleDesk.classList.add('hidden');
            }
        }

        if (boxSingleChair) {
            if (singleChairVal > 0) {
                setSafeText('val-single-chair', `${singleChairVal}脚`);
                boxSingleChair.classList.remove('hidden');
            } else {
                boxSingleChair.classList.add('hidden');
            }
        }

        if (sectionSpecialEquip) {
            if (singleDeskVal > 0 || singleChairVal > 0) {
                sectionSpecialEquip.classList.remove('hidden');
            } else {
                sectionSpecialEquip.classList.add('hidden');
            }
        }

        setSafeText('td-deskA-orig', item['机α（元の数）'] || '0');
        setSafeText('td-deskA-used', item['机α（使用数）'] || '0');
        setSafeText('td-deskA-move', item['机α（移動数）'] || '0');

        setSafeText('td-deskB-orig', item['机β（元の数）'] || '0');
        setSafeText('td-deskB-used', item['机β（使用数）'] || '0');
        setSafeText('td-deskB-move', item['机β（移動数）'] || '0');

        setSafeText('td-chair-orig', item['椅子（元の数）'] || '0');
        setSafeText('td-chair-used', item['椅子（使用数）'] || '0');
        setSafeText('td-chair-move', item['椅子（移動数）'] || '0');

        const deskADestEl = document.getElementById('td-deskA-dest');
        if (deskADestEl) deskADestEl.innerHTML = formatDestHtml(item['机α移動先']);

        const deskBDestEl = document.getElementById('td-deskB-dest');
        if (deskBDestEl) deskBDestEl.innerHTML = formatDestHtml(item['机β移動先']);

        const chairDestEl = document.getElementById('td-chair-dest');
        if (chairDestEl) chairDestEl.innerHTML = formatDestHtml(item['椅子移動先']);

        setSafeText('val-remarks', item['備考'] || 'なし');

        const qtyEditBoxes = document.querySelectorAll('.qty-edit-box');

        if (isGroupUser() || isGuestUser()) {
            if (quickStatusActions) quickStatusActions.classList.add('hidden');
            if (modalClaimBtn) modalClaimBtn.classList.add('hidden');
            if (modalUnclaimBtn) modalUnclaimBtn.classList.add('hidden');

            qtyEditBoxes.forEach(box => box.classList.add('hidden'));

            if (isGroupUser()) {
                if (adminDivider) adminDivider.classList.add('hidden');
                if (adminFeatureAccordion) adminFeatureAccordion.classList.add('hidden');
            } else if (isGuestUser()) {
                if (adminDivider) adminDivider.classList.remove('hidden');
                if (adminFeatureAccordion) adminFeatureAccordion.classList.remove('hidden');
                await fetchLogs(item['教室名']);
            }
        } else {
            if (quickStatusActions) quickStatusActions.classList.remove('hidden');
            if (modalClaimBtn) modalClaimBtn.classList.remove('hidden');
            if (modalUnclaimBtn) modalUnclaimBtn.classList.remove('hidden');

            if (adminDivider) adminDivider.classList.remove('hidden');
            if (adminFeatureAccordion) adminFeatureAccordion.classList.remove('hidden');
            qtyEditBoxes.forEach(box => box.classList.remove('hidden'));

            updateOldValueDisplay();
            await fetchLogs(item['教室名']);
        }

        updateModalCheckArea();
        if (modal) modal.classList.remove('hidden');
        document.body.classList.add('modal-open');
    }

    function updateModalCheckArea() {
        if (!currentSelectedRoom) return;
        const step = checkSteps[currentStepIndex];
        const currentStatus = currentSelectedRoom[step.key] || '未実施';

        if (stepTitle) stepTitle.textContent = step.name;
        if (currentStatusBadgeEl) {
            currentStatusBadgeEl.textContent = currentStatus;
            currentStatusBadgeEl.setAttribute('data-status', currentStatus);
        }

        if (stepBackBtn) stepBackBtn.disabled = (currentStepIndex === 0);
        if (stepNextBtn) stepNextBtn.disabled = (currentStepIndex === checkSteps.length - 1);

        const activeUser = currentUser ? currentUser.username : '';
        const assigneeStr = currentSelectedRoom['担当者'] || '';
        const assignees = assigneeStr.split(',').map(s => s.trim()).filter(Boolean);

        updateAssigneeUI(assigneeStr);

        if (!isGroupUser() && !isGuestUser()) {
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

    if (stepBackBtn) {
        stepBackBtn.addEventListener('click', () => {
            if (currentStepIndex > 0) {
                currentStepIndex--;
                if (currentSelectedRoom) {
                    currentSelectedRoom._currentStepIndex = currentStepIndex;
                }
                updateModalCheckArea();
            }
        });
    }

    if (stepNextBtn) {
        stepNextBtn.addEventListener('click', () => {
            if (currentStepIndex < checkSteps.length - 1) {
                currentStepIndex++;
                if (currentSelectedRoom) {
                    currentSelectedRoom._currentStepIndex = currentStepIndex;
                }
                updateModalCheckArea();
            }
        });
    }

    if (quickStatusActions) {
        quickStatusActions.querySelectorAll('.btn-action').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!currentSelectedRoom || !currentUser || isGroupUser() || isGuestUser()) return;

                const targetVal = e.target.getAttribute('data-val');
                const step = checkSteps[currentStepIndex];
                const targetRoomIndex = currentSelectedRoom.rowIndex;
                const targetRoomName = currentSelectedRoom['教室名'];

                if (targetVal === '完了') {
                    if (currentStepIndex === 1 || currentStepIndex === 2 || currentStepIndex === 4 || currentStepIndex === 5) {
                        const prevStep = checkSteps[currentStepIndex - 1];
                        const prevStatus = currentSelectedRoom[prevStep.key] || '未実施';

                        if (prevStatus !== '完了') {
                            alert(`前のステップ（${prevStep.name}）が完了していないため、${step.name}を完了にすることはできません。`);
                            return;
                        }
                    }
                }

                currentSelectedRoom._currentStepIndex = currentStepIndex;
                currentSelectedRoom[step.key] = targetVal;
                updateModalCheckArea();

                try {
                    const res = await fetch('/api/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            rowIndex: targetRoomIndex,
                            roomName: targetRoomName,
                            columnName: step.key,
                            value: targetVal,
                            userName: currentUser.username
                        })
                    });

                    const result = await res.json();
                    if (result.success) {
                        await fetchData();
                        if (currentSelectedRoom && currentSelectedRoom.rowIndex === targetRoomIndex) {
                            updateModalCheckArea();
                        }
                    }
                } catch (err) {
                    console.warn('ステータス更新中の通信中断またはエラー:', err);
                }
            });
        });
    }

    if (modalClaimBtn) {
        modalClaimBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !currentUser || isGroupUser() || isGuestUser()) return;
            const step = checkSteps[currentStepIndex];

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
                    updateModalCheckArea();
                }
            } catch (err) {
                console.warn('担当登録エラー:', err);
            } finally {
                if (modalClaimBtn) modalClaimBtn.disabled = false;
            }
        });
    }

    if (modalUnclaimBtn) {
        modalUnclaimBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !currentUser || isGroupUser() || isGuestUser()) return;
            const step = checkSteps[currentStepIndex];

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
                    updateModalCheckArea();
                }
            } catch (err) {
                console.warn('担当解除エラー:', err);
            } finally {
                if (modalUnclaimBtn) modalUnclaimBtn.disabled = false;
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

    if (saveQtyBtn) {
        saveQtyBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !currentUser || isGroupUser() || isGuestUser()) return;

            const selectedKey = editItemKey.value;
            const oldValue = parseInt(editOldVal.value || 0, 10);
            const newValue = parseInt(editNewVal.value || 0, 10);
            const note = editNote.value.trim();

            if (isNaN(newValue) || newValue < 0) {
                alert('エラー: 有効な正の数値を入力してください。');
                return;
            }

            if (oldValue === newValue) {
                alert('値が変更されていません');
                return;
            }

            let category = '机α';
            if (selectedKey.includes('机β')) category = '机β';
            else if (selectedKey.includes('椅子')) category = '椅子';

            let targetType = '元の数';
            if (selectedKey.includes('使用数')) targetType = '使用数';
            else if (selectedKey.includes('移動数')) targetType = '移動数';

            let curOrig = parseInt(currentSelectedRoom[`${category}（元の数）`] || 0, 10);
            let curUsed = parseInt(currentSelectedRoom[`${category}（使用数）`] || 0, 10);
            let curMove = parseInt(currentSelectedRoom[`${category}（移動数）`] || 0, 10);

            if (targetType === '使用数' && newValue > curOrig) {
                alert(`エラー: 使用数（${newValue}）が元の数（${curOrig}）を超えています！`);
                return;
            }
            if (targetType === '移動数' && newValue > curOrig) {
                alert(`エラー: 移動数（${newValue}）が元の数（${curOrig}）を超えています！`);
                return;
            }

            if (targetType === '元の数') {
                const diff = newValue - curOrig;
                curOrig = newValue;
                curUsed = Math.max(0, curUsed + diff);
                curMove = Math.max(0, curOrig - curUsed);
            } else if (targetType === '使用数') {
                curUsed = newValue;
                curMove = Math.max(0, curOrig - curUsed);
            } else if (targetType === '移動数') {
                curMove = newValue;
                curUsed = Math.max(0, curOrig - curMove);
            }

            try {
                saveQtyBtn.disabled = true;
                saveQtyBtn.textContent = '更新中...';

                const detailLogNote = `[${selectedKey}を${oldValue}➔${newValue}に変更] (結果➔ 元:${curOrig}, 使用:${curUsed}, 移動:${curMove}) ${note ? 'メモ:' + note : ''}`;

                const updateTargets = [
                    { key: `${category}（元の数）`, val: curOrig, old: parseInt(currentSelectedRoom[`${category}（元の数）`] || 0, 10) },
                    { key: `${category}（使用数）`, val: curUsed, old: parseInt(currentSelectedRoom[`${category}（使用数）`] || 0, 10) },
                    { key: `${category}（移動数）`, val: curMove, old: parseInt(currentSelectedRoom[`${category}（移動数）`] || 0, 10) }
                ];

                for (const u of updateTargets) {
                    await fetch('/api/update-quantity', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            rowIndex: currentSelectedRoom.rowIndex,
                            roomName: currentSelectedRoom['教室名'],
                            userName: currentUser.username,
                            itemKey: u.key,
                            oldValue: String(u.old),
                            newValue: String(u.val),
                            note: detailLogNote
                        })
                    });
                }

                alert(`成功: ${category} の数量（元:${curOrig} / 使用:${curUsed} / 移動:${curMove}）を更新しスプレッドシートに保存しました！`);
                resetModalForms();
                await fetchData();
                const updatedRoom = classroomData.find(r => r.rowIndex === currentSelectedRoom.rowIndex);
                if (updatedRoom) {
                    currentSelectedRoom = updatedRoom;
                    openModal(updatedRoom);
                }
            } catch (err) {
                console.error(err);
                alert('数量更新中にエラーが発生しました');
            } finally {
                if (saveQtyBtn) {
                    saveQtyBtn.disabled = false;
                    saveQtyBtn.textContent = '数量を更新してログを保存';
                }
            }
        });
    }

    if (saveDestBtn) {
        saveDestBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !currentUser || isGroupUser() || isGuestUser()) return;

            const targetItem = document.getElementById('edit-dest-item-key').value;
            const newDestName = document.getElementById('edit-new-dest-name').value.trim();
            const inputQty = parseInt(document.getElementById('edit-dest-qty').value, 10);
            const note = document.getElementById('edit-dest-note').value.trim();

            if (!newDestName) {
                alert('エラー: 新しい移動先を入力してください。');
                return;
            }
            if (isNaN(inputQty) || inputQty <= 0) {
                alert('エラー: 移動する個数は1以上の数値を入力してください。');
                return;
            }

            let totalMoveQty = 0;
            let destColKey = '';

            if (targetItem === '机α') {
                totalMoveQty = parseInt(currentSelectedRoom['机α（移動数）'] || 0, 10);
                destColKey = '机α移動先';
            } else if (targetItem === '机β') {
                totalMoveQty = parseInt(currentSelectedRoom['机β（移動数）'] || 0, 10);
                destColKey = '机β移動先';
            } else {
                totalMoveQty = parseInt(currentSelectedRoom['椅子（移動数）'] || 0, 10);
                destColKey = '椅子移動先';
            }

            if (inputQty > totalMoveQty) {
                alert(`エラー: ${targetItem} の変更個数（${inputQty}脚）が、合計移動数（${totalMoveQty}脚）を超えています！`);
                return;
            }

            const currentDestStr = currentSelectedRoom[destColKey] || '';
            let finalDestValue = '';
            let updateType = '';

            if (inputQty === totalMoveQty) {
                finalDestValue = `${newDestName} (${inputQty}脚)`;
                updateType = '全体上書き';
            } else {
                const remainQty = totalMoveQty - inputQty;
                const baseDestName = currentDestStr ? currentDestStr.split('(')[0].trim() : '元の移動先';
                finalDestValue = `${baseDestName} (${remainQty}脚), ${newDestName} (${inputQty}脚)`;
                updateType = '一部追加';
            }

            try {
                saveDestBtn.disabled = true;
                saveDestBtn.textContent = '更新中...';

                const detailLogNote = `[${targetItem}の移動先変更: ${updateType}] 新移動先:${newDestName}(${inputQty}脚) ${note ? 'メモ:' + note : ''}`;

                const res = await fetch('/api/update-quantity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        userName: currentUser.username,
                        itemKey: destColKey,
                        oldValue: currentDestStr || '-',
                        newValue: finalDestValue,
                        note: detailLogNote
                    })
                });

                const result = await res.json();
                if (result.success) {
                    alert(`成功: ${targetItem} の移動先を「${finalDestValue}」へ保存しました！`);
                    resetModalForms();
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
                alert('通信エラーが発生しました');
            } finally {
                if (saveDestBtn) {
                    saveDestBtn.disabled = false;
                    saveDestBtn.textContent = '移動先を更新してログ保存';
                }
            }
        });
    }

    if (editItemKey) editItemKey.addEventListener('change', updateOldValueDisplay);

    const savedSize = localStorage.getItem('shibaurafes_card_size') || 'md';

    sizeBtns.forEach(btn => {
        if (btn.dataset.size === savedSize) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    if (cardList) {
        cardList.className = `floor-container size-${savedSize}`;
    }

    sizeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            sizeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            const selectedSize = e.target.dataset.size;
            if (cardList) cardList.className = `floor-container size-${selectedSize}`;

            localStorage.setItem('shibaurafes_card_size', selectedSize);
        });
    });

    function closeModal() {
        if (modal) modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
        resetModalForms();
        currentSelectedRoom = null;

        if (typeof renderFilteredCards === 'function') {
            renderFilteredCards();
        }
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
            if (searchClearBtn) {
                if (searchInput.value.trim().length > 0) {
                    searchClearBtn.classList.remove('hidden');
                } else {
                    searchClearBtn.classList.add('hidden');
                }
            }
            renderFilteredCards();
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
            searchClearBtn.classList.add('hidden');
            renderFilteredCards();
        });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', fetchData);

    checkLoginState();
    if (currentUser) {
        fetchData();
    }
});