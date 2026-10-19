document.addEventListener('DOMContentLoaded', () => {
    const cardList = document.getElementById('card-list');
    const refreshBtn = document.getElementById('refresh-btn');
    const sizeBtns = document.querySelectorAll('.size-btn');
    const searchBoxContainer = document.getElementById('search-box-container');
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');

    const appLoadingScreen = document.getElementById('app-loading-screen');
    const appMainContent = document.getElementById('app-main-content');

    const loginModal = document.getElementById('login-modal');
    const loginForm = document.getElementById('login-form');
    const loginUsernameInput = document.getElementById('login-username');
    const loginPasswordInput = document.getElementById('login-password');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const loginSubmitBtn = document.getElementById('login-submit-btn');
    const loginUserDisp = document.getElementById('login-user-disp');
    const logoutBtn = document.getElementById('logout-btn');

    const modal = document.getElementById('detail-modal');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalRoomName = document.getElementById('modal-room-name');
    const modalGroupName = document.getElementById('modal-group-name');
    const modalClaimBtn = document.getElementById('modal-claim-btn');
    const modalUnclaimBtn = document.getElementById('modal-unclaim-btn');

    const stepBackBtn = document.getElementById('step-back-btn');
    const stepNextBtn = document.getElementById('step-next-btn');
    const stepTitle = document.getElementById('current-step-name');
    const currentStatusBadgeEl = document.getElementById('current-status-badge');
    const quickStatusActions = document.getElementById('quick-status-actions');

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
    let eventSource = null;

    const checkSteps = [
        { key: '準備1次_表示用', updateKey: '準備1次_Web', name: '準備 1次' },
        { key: '準備2次_表示用', updateKey: '準備2次_Web', name: '準備 2次' },
        { key: '準備3次_表示用', updateKey: '準備3次_Web', name: '準備 3次' },
        { key: '片付け1次_表示用', updateKey: '片付け1次_Web', name: '片付け 1次' },
        { key: '片付け2次_表示用', updateKey: '片付け2次_Web', name: '片付け 2次' },
        { key: '片付け3次_表示用', updateKey: '片付け3次_Web', name: '片付け 3次' }
    ];

    const LAST_GLOBAL_STEP_KEY = 'shibaurafes_last_global_step';
    const ROOM_STEPS_KEY = 'shibaurafes_room_steps';

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isCommitteeUser() {
        return currentUser && currentUser.role === '委員会';
    }

    /* --- カード内短縮表示用ヘルパー関数 --- */
    function getMoveItemHtml(label, moveQty, destStr, unit = '台') {
        const qty = parseInt(moveQty || 0, 10);
        const safeDest = escapeHtml(destStr || '-');

        if (qty === 0) {
            // 移動数が0の場合
            return `
                <div class="card-detail-item no-move">
                    <span class="label-title">${escapeHtml(label)}</span>
                    <span class="colon">:</span>
                    <span class="text-no-move">移動なし</span>
                </div>
            `;
        } else if (qty < 0) {
            // マイナスの場合は「〇〇から〇台」
            const positiveQty = Math.abs(qty);
            return `
                <div class="card-detail-item move-in">
                    <span class="label-title">${escapeHtml(label)}</span>
                    <span class="colon">:</span>
                    <span class="dest-text">${safeDest}</span>
                    <span class="text-particle">から</span>
                    <span class="num-move-unit num-in">${positiveQty}${unit}</span>
                </div>
            `;
        } else {
            // プラスの場合は「〇〇へ〇台」
            return `
                <div class="card-detail-item move-out">
                    <span class="label-title">${escapeHtml(label)}</span>
                    <span class="colon">:</span>
                    <span class="dest-text">${safeDest}</span>
                    <span class="text-particle">へ</span>
                    <span class="num-move-unit num-out">${qty}${unit}</span>
                </div>
            `;
        }
    }

    /* --- 詳細モーダル内テーブル用ヘルパー関数 --- */
    function formatMoveQtyTd(qtyVal, unit = '台') {
        const qty = parseInt(qtyVal || 0, 10);
        if (qty === 0) {
            return `<span class="td-no-move">0 (なし)</span>`;
        } else if (qty < 0) {
            return `<span class="td-move-in">搬入 ${Math.abs(qty)}${unit}</span>`;
        } else {
            return `<span class="td-move-out">搬出 ${qty}${unit}</span>`;
        }
    }

    function getGlobalDefaultStepIndex() {
        if (!classroomData || classroomData.length === 0) return 0;
        let globalStep = 0;
        for (let i = 0; i < checkSteps.length; i++) {
            const step = checkSteps[i];
            const allCompleted = classroomData.every(item => item[step.key] === '完了');
            if (allCompleted) {
                globalStep = (i + 1 < checkSteps.length) ? i + 1 : i;
            } else {
                break;
            }
        }
        return globalStep;
    }

    function getCardDefaultStepIndex(item) {
        const globalStep = getGlobalDefaultStepIndex();
        const savedLastGlobalStep = parseInt(localStorage.getItem(LAST_GLOBAL_STEP_KEY) || '0', 10);

        if (globalStep > savedLastGlobalStep) {
            localStorage.setItem(LAST_GLOBAL_STEP_KEY, globalStep.toString());
            localStorage.removeItem(ROOM_STEPS_KEY);
            delete item._currentStepIndex;
            return globalStep;
        }

        if (item._currentStepIndex !== undefined) {
            return item._currentStepIndex;
        }

        return globalStep;
    }

    function saveRoomStepToLocal(rowIndex, stepIndex) {
        try {
            const savedSteps = JSON.parse(localStorage.getItem(ROOM_STEPS_KEY) || '{}');
            savedSteps[rowIndex] = stepIndex;
            localStorage.setItem(ROOM_STEPS_KEY, JSON.stringify(savedSteps));
        } catch (e) {
            console.error('ローカルストレージ保存エラー:', e);
        }
    }

    function getSavedRoomStepsFromLocal() {
        try {
            return JSON.parse(localStorage.getItem(ROOM_STEPS_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function initSSE() {
        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource('/api/events');

        eventSource.addEventListener('init', (e) => {
            try {
                const data = JSON.parse(e.data);
                updateClassroomData(data);
            } catch (err) {
                console.error('SSE init parse error:', err);
            }
        });

        eventSource.addEventListener('data_updated', (e) => {
            try {
                const data = JSON.parse(e.data);
                updateClassroomData(data);
            } catch (err) {
                console.error('SSE update parse error:', err);
            }
        });

        eventSource.addEventListener('rollback', (e) => {
            try {
                const payload = JSON.parse(e.data);
                const targetRoom = classroomData.find(r => r.rowIndex === payload.rowIndex);
                if (targetRoom) {
                    Object.assign(targetRoom, payload.revertedRoom);
                    if (currentSelectedRoom && currentSelectedRoom.rowIndex === payload.rowIndex) {
                        currentSelectedRoom = targetRoom;
                        updateModalCheckArea();
                    }
                    renderFilteredCards();
                }
                alert(`【自動復元】${payload.message || '保存処理に失敗したため、変更を元に戻しました。'}`);
            } catch (err) {
                console.error('SSE rollback parse error:', err);
            }
        });

        eventSource.addEventListener('update_failed', (e) => {
            try {
                const data = JSON.parse(e.data);
                alert(`【通知】${data.error || '保存に失敗しました'}`);
            } catch (err) {
                console.error('SSE failure parse error:', err);
            }
        });

        eventSource.onerror = () => {};
    }

    function updateClassroomData(newData) {
        const savedRoomSteps = getSavedRoomStepsFromLocal();

        classroomData = newData.map(newItem => {
            const oldItem = classroomData.find(old => old.rowIndex === newItem.rowIndex);
            if (oldItem && oldItem._currentStepIndex !== undefined) {
                newItem._currentStepIndex = oldItem._currentStepIndex;
            } else if (savedRoomSteps[newItem.rowIndex] !== undefined) {
                newItem._currentStepIndex = savedRoomSteps[newItem.rowIndex];
            }
            return newItem;
        });

        if (modal && !modal.classList.contains('hidden') && currentSelectedRoom) {
            const updatedRoom = classroomData.find(r => r.rowIndex === currentSelectedRoom.rowIndex);
            if (updatedRoom) {
                currentSelectedRoom = updatedRoom;
                updateModalCheckArea();
                if (isCommitteeUser()) {
                    updateAssigneeUI(updatedRoom['担当者']);
                }

                setSafeText('td-deskA-orig', updatedRoom['机α（元の数）'] || '0');
                setSafeText('td-deskA-used', updatedRoom['机α（使用数）'] || '0');
                const tdDeskAMove = document.getElementById('td-deskA-move');
                if (tdDeskAMove) tdDeskAMove.innerHTML = formatMoveQtyTd(updatedRoom['机α（移動数）'], '台');

                setSafeText('td-deskB-orig', updatedRoom['机β（元の数）'] || '0');
                setSafeText('td-deskB-used', updatedRoom['机β（使用数）'] || '0');
                const tdDeskBMove = document.getElementById('td-deskB-move');
                if (tdDeskBMove) tdDeskBMove.innerHTML = formatMoveQtyTd(updatedRoom['机β（移動数）'], '台');

                setSafeText('td-chair-orig', updatedRoom['椅子（元の数）'] || '0');
                setSafeText('td-chair-used', updatedRoom['椅子（使用数）'] || '0');
                const tdChairMove = document.getElementById('td-chair-move');
                if (tdChairMove) tdChairMove.innerHTML = formatMoveQtyTd(updatedRoom['椅子（移動数）'], '脚');
            }
        }
        renderFilteredCards();
    }

    async function checkLoginState() {
        if (appLoadingScreen) appLoadingScreen.classList.remove('hidden');

        try {
            const res = await fetch('/api/me');
            if (!res.ok) throw new Error('通信エラー');

            const authInfo = await res.json();

            if (authInfo.authenticated) {
                currentUser = authInfo.user;
                if (loginUserDisp) loginUserDisp.textContent = `${currentUser.username} (${currentUser.role})`;
                if (logoutBtn) logoutBtn.classList.remove('hidden');
                if (loginModal) loginModal.classList.add('hidden');
                if (searchBoxContainer) searchBoxContainer.classList.remove('hidden');

                if (appMainContent) appMainContent.classList.remove('hidden');
                if (appLoadingScreen) appLoadingScreen.classList.add('hidden');

                initSSE();
                await fetchData();
            } else {
                currentUser = null;
                if (loginUserDisp) loginUserDisp.textContent = '未ログイン';
                if (logoutBtn) logoutBtn.classList.add('hidden');
                if (searchBoxContainer) searchBoxContainer.classList.add('hidden');

                if (appLoadingScreen) appLoadingScreen.classList.add('hidden');
                if (loginModal) loginModal.classList.remove('hidden');
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
            }
        } catch (err) {
            console.error('セッション確認エラー:', err);
            if (appLoadingScreen) {
                appLoadingScreen.innerHTML = `
                    <div style="text-align:center; padding: 20px; color: #dc3545;">
                        <h3>通信エラーが発生しました</h3>
                        <p>サーバーとの接続を確認できませんでした。</p>
                        <button id="retry-auth-btn" style="padding: 8px 16px; background:#007bff; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">再試行</button>
                    </div>
                `;
                const retryAuthBtn = document.getElementById('retry-auth-btn');
                if (retryAuthBtn) {
                    retryAuthBtn.addEventListener('click', () => {
                        window.location.reload();
                    });
                }
            }
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
                    await checkLoginState();
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
        logoutBtn.addEventListener('click', async () => {
            await fetch('/api/logout', { method: 'POST' }).catch(() => {});
            window.location.reload();
        });
    }

    async function fetchData() {
        if (!currentUser) return;
        try {
            if (cardList && classroomData.length === 0) {
                cardList.innerHTML = '<div style="text-align:center; padding: 20px; color: #6c757d;">データを読み込み中...</div>';
            }

            const res = await fetch('/api/classrooms');
            if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

            const newData = await res.json();
            updateClassroomData(newData);
        } catch (err) {
            console.error('データ取得失敗:', err);
            if (cardList && classroomData.length === 0) {
                cardList.innerHTML = `
                    <div style="text-align:center; padding: 20px; color: #dc3545;">
                        データの取得に失敗しました。<br>
                        <button id="retry-fetch-btn" style="margin-top:10px; padding:6px 12px; background:#007bff; color:white; border:none; border-radius:4px; cursor:pointer;">再試行</button>
                    </div>`;
                const retryBtn = document.getElementById('retry-fetch-btn');
                if (retryBtn) retryBtn.addEventListener('click', fetchData);
            }
        }
    }

    function renderFilteredCards() {
        const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';
        if (keyword) {
            const filtered = classroomData.filter(item => {
                const roomName = (item['教室名'] || '').toLowerCase();
                const floor = (item['階数'] || '').toLowerCase();
                const group = (item['団体名'] || '').toLowerCase();
                const anteroom = String(item['控え室'] || '').toLowerCase();
                const assignee = isCommitteeUser() ? (item['担当者'] || '').toLowerCase() : '';

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
            floorTitle.textContent = floor;
            floorSection.appendChild(floorTitle);

            const cardGrid = document.createElement('div');
            cardGrid.className = 'card-grid';

            floorMap[floor].forEach(item => {
                const stepIdx = getCardDefaultStepIndex(item);
                const step = checkSteps[stepIdx];
                const status = item[step.key] || '未実施';

                // 移動数表示の最適化ロジック適用
                const deskAMoveHtml = getMoveItemHtml('机α', item['机α（移動数）'], item['机α移動先'], '台');
                const deskBMoveHtml = getMoveItemHtml('机β', item['机β（移動数）'], item['机β移動先'], '台');
                const chairMoveHtml = getMoveItemHtml('椅子', item['椅子（移動数）'], item['椅子移動先'], '脚');

                const anteroom = (item['控え室'] || '').toString().trim();
                const safeAnteroom = escapeHtml(anteroom);
                const anteroomBadge = anteroom
                    ? `<span class="card-anteroom-text" data-room="${safeAnteroom}"><span class="full-label">控室: ${safeAnteroom}</span><span class="short-label">${safeAnteroom}</span></span>`
                    : '';

                let assigneeHtml = '';
                if (isCommitteeUser()) {
                    const assignee = item['担当者'] || '';
                    if (assignee) {
                        assigneeHtml = `<span class="assignee-badge">${escapeHtml(assignee)}</span>`;
                    } else {
                        assigneeHtml = `<button class="claim-card-btn">＋担当する</button>`;
                    }
                }

                const card = document.createElement('div');
                card.className = 'room-card';

                card.innerHTML = `
                    <div class="card-header-top">
                        <span class="room-title">${escapeHtml(item['教室名'] || '')}</span>
                        <span class="group-name">${escapeHtml(item['団体名'] || '未設定')}</span>
                    </div>

                    ${isCommitteeUser() ? `<div class="card-assignee-row">${assigneeHtml}</div>` : ''}

                    <div class="card-detail-rows">
                        ${deskAMoveHtml}
                        ${deskBMoveHtml}
                        ${chairMoveHtml}
                    </div>

                    <div class="card-body">
                        <span class="status-badge" data-status="${escapeHtml(status)}">
                            ${escapeHtml(step.name)}: ${escapeHtml(status)}
                        </span>
                        ${anteroomBadge}
                    </div>
                `;

                if (isCommitteeUser()) {
                    const claimBtn = card.querySelector('.claim-card-btn');
                    if (claimBtn) {
                        claimBtn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const stepIdx = getCardDefaultStepIndex(item);
                            const step = checkSteps[stepIdx];

                            try {
                                claimBtn.disabled = true;
                                const res = await fetch('/api/update', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        rowIndex: item.rowIndex,
                                        roomName: item['教室名'],
                                        columnName: step.updateKey || step.key,
                                        value: item[step.key] || '未実施',
                                        action: 'claim'
                                    })
                                });
                                const result = await res.json();
                                if (!res.ok) {
                                    alert(`担当登録に失敗しました: ${result.error}`);
                                }
                            } catch (err) {
                                alert('通信エラーが発生しました');
                            } finally {
                                claimBtn.disabled = false;
                            }
                        });
                    }
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
        if (!isCommitteeUser()) return;
        const assignee = assigneeStr || '';
        const badgeEl = document.getElementById('modal-assignee-badge') || document.getElementById('modal-assignee');
        if (badgeEl) {
            if (assignee) {
                badgeEl.className = 'assignee-badge';
                badgeEl.textContent = `担当: ${assignee}`;
            } else {
                badgeEl.className = 'assignee-badge unassigned';
                badgeEl.textContent = '未割り当て';
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
        return escapeHtml(destStr).replace(/,\s*/g, '<br>');
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
                    <span class="full-label">控え室: ${escapeHtml(anteroom)}</span>
                    <span class="short-label">${escapeHtml(anteroom)}</span>
                `;
                modalAnteroomEl.classList.remove('hidden');
            } else {
                modalAnteroomEl.classList.add('hidden');
            }
        }

        const modalAssigneeRow = document.querySelector('.modal-assignee-row');
        const assignActionArea = document.getElementById('assign-action-area');

        if (isCommitteeUser()) {
            if (modalAssigneeRow) modalAssigneeRow.classList.remove('hidden');
            if (assignActionArea) assignActionArea.classList.remove('hidden');
            updateAssigneeUI(item['担当者']);
        } else {
            if (modalAssigneeRow) modalAssigneeRow.classList.add('hidden');
            if (assignActionArea) assignActionArea.classList.add('hidden');
        }

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
        const tdDeskAMove = document.getElementById('td-deskA-move');
        if (tdDeskAMove) tdDeskAMove.innerHTML = formatMoveQtyTd(item['机α（移動数）'], '台');

        setSafeText('td-deskB-orig', item['机β（元の数）'] || '0');
        setSafeText('td-deskB-used', item['机β（使用数）'] || '0');
        const tdDeskBMove = document.getElementById('td-deskB-move');
        if (tdDeskBMove) tdDeskBMove.innerHTML = formatMoveQtyTd(item['机β（移動数）'], '台');

        setSafeText('td-chair-orig', item['椅子（元の数）'] || '0');
        setSafeText('td-chair-used', item['椅子（使用数）'] || '0');
        const tdChairMove = document.getElementById('td-chair-move');
        if (tdChairMove) tdChairMove.innerHTML = formatMoveQtyTd(item['椅子（移動数）'], '脚');

        const deskADestEl = document.getElementById('td-deskA-dest');
        if (deskADestEl) deskADestEl.innerHTML = formatDestHtml(item['机α移動先']);

        const deskBDestEl = document.getElementById('td-deskB-dest');
        if (deskBDestEl) deskBDestEl.innerHTML = formatDestHtml(item['机β移動先']);

        const chairDestEl = document.getElementById('td-chair-dest');
        if (chairDestEl) chairDestEl.innerHTML = formatDestHtml(item['椅子移動先']);

        setSafeText('val-remarks', item['備考'] || 'なし');

        const qtyEditBoxes = document.querySelectorAll('.qty-edit-box');

        if (!isCommitteeUser()) {
            if (quickStatusActions) quickStatusActions.classList.add('hidden');
            if (modalClaimBtn) modalClaimBtn.classList.add('hidden');
            if (modalUnclaimBtn) modalUnclaimBtn.classList.add('hidden');
            qtyEditBoxes.forEach(box => box.classList.add('hidden'));

            if (adminDivider) adminDivider.classList.add('hidden');
            if (adminFeatureAccordion) adminFeatureAccordion.classList.add('hidden');
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

        if (isCommitteeUser()) {
            const activeUser = currentUser ? currentUser.username : '';
            const assigneeStr = currentSelectedRoom['担当者'] || '';
            const assignees = assigneeStr.split(',').map(s => s.trim()).filter(Boolean);

            updateAssigneeUI(assigneeStr);

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
                    saveRoomStepToLocal(currentSelectedRoom.rowIndex, currentStepIndex);
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
                    saveRoomStepToLocal(currentSelectedRoom.rowIndex, currentStepIndex);
                }
                updateModalCheckArea();
            }
        });
    }

    if (quickStatusActions) {
        quickStatusActions.querySelectorAll('.btn-action').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!currentSelectedRoom || !isCommitteeUser()) return;

                const targetVal = e.target.getAttribute('data-val');
                const fixedStepIndex = currentStepIndex;
                const step = checkSteps[fixedStepIndex];
                const targetRoomIndex = currentSelectedRoom.rowIndex;
                const targetRoomName = currentSelectedRoom['教室名'];

                if (targetVal === '完了') {
                    if (fixedStepIndex === 1 || fixedStepIndex === 2 || fixedStepIndex === 4 || fixedStepIndex === 5) {
                        const prevStep = checkSteps[fixedStepIndex - 1];
                        const prevStatus = currentSelectedRoom[prevStep.key] || '未実施';

                        if (prevStatus !== '完了') {
                            alert(`前のステップ（${prevStep.name}）が完了していないため、${step.name}を完了にすることはできません。`);
                            return;
                        }
                    }
                }

                const oldDisplayVal = currentSelectedRoom[step.key];
                const oldWebVal = currentSelectedRoom[step.updateKey];

                currentSelectedRoom[step.key] = targetVal;
                currentSelectedRoom[step.updateKey] = targetVal;

                updateModalCheckArea();
                renderFilteredCards();

                try {
                    const res = await fetch('/api/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            rowIndex: targetRoomIndex,
                            roomName: targetRoomName,
                            columnName: step.updateKey || step.key,
                            value: targetVal
                        })
                    });

                    const result = await res.json();
                    if (!res.ok) {
                        currentSelectedRoom[step.key] = oldDisplayVal;
                        currentSelectedRoom[step.updateKey] = oldWebVal;
                        updateModalCheckArea();
                        renderFilteredCards();
                        alert(`ステータス更新に失敗しました: ${result.error || '不明なエラー'}`);
                    }
                } catch (err) {
                    currentSelectedRoom[step.key] = oldDisplayVal;
                    currentSelectedRoom[step.updateKey] = oldWebVal;
                    updateModalCheckArea();
                    renderFilteredCards();
                    alert('通信エラーが発生しました。接続を確認してください。');
                }
            });
        });
    }

    if (modalClaimBtn) {
        modalClaimBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !isCommitteeUser()) return;
            const step = checkSteps[currentStepIndex];

            try {
                modalClaimBtn.disabled = true;

                const res = await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        columnName: step.updateKey || step.key,
                        value: currentSelectedRoom[step.key] || '未実施',
                        action: 'claim'
                    })
                });
                const result = await res.json();
                if (!res.ok) {
                    alert(`担当登録に失敗しました: ${result.error}`);
                }
            } catch (err) {
                alert('通信エラーが発生しました');
            } finally {
                if (modalClaimBtn) modalClaimBtn.disabled = false;
            }
        });
    }

    if (modalUnclaimBtn) {
        modalUnclaimBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !isCommitteeUser()) return;
            const step = checkSteps[currentStepIndex];

            try {
                modalUnclaimBtn.disabled = true;

                const res = await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        columnName: step.updateKey || step.key,
                        value: currentSelectedRoom[step.key] || '未実施',
                        action: 'unclaim'
                    })
                });
                const result = await res.json();
                if (!res.ok) {
                    alert(`担当解除に失敗しました: ${result.error}`);
                }
            } catch (err) {
                alert('通信エラーが発生しました');
            } finally {
                if (modalUnclaimBtn) modalUnclaimBtn.disabled = false;
            }
        });
    }

    async function fetchLogs(roomName) {
        if (!logList || !isCommitteeUser()) return;
        logList.innerHTML = '<li class="empty-log">読み込み中...</li>';
        try {
            const res = await fetch(`/api/logs/${encodeURIComponent(roomName)}`);
            if (res.status === 403) {
                logList.innerHTML = '<li class="empty-log">操作ログの閲覧権限がありません</li>';
                return;
            }
            if (!res.ok) throw new Error('ログ取得失敗');

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
                        <span>${escapeHtml(log.userName)}</span>
                        <span>🕒 ${escapeHtml(log.timestamp)}</span>
                    </div>
                    <div class="log-body">
                        ${escapeHtml(log.itemKey)}: <code>${escapeHtml(log.oldValue)}</code> ➔ <strong>${escapeHtml(log.newValue)}</strong>
                    </div>
                    ${log.note ? `<div class="log-note">💬 ${escapeHtml(log.note)}</div>` : ''}
                `;
                logList.appendChild(li);
            });
        } catch (err) {
            logList.innerHTML = '<li class="empty-log">ログの取得に失敗しました</li>';
        }
    }

    if (saveQtyBtn) {
        saveQtyBtn.addEventListener('click', async () => {
            if (!currentSelectedRoom || !isCommitteeUser()) return;

            const selectedKey = editItemKey.value;
            const oldValue = parseInt(editOldVal.value || 0, 10);
            const newValue = parseInt(editNewVal.value || 0, 10);
            const note = editNote.value.trim();

            if (isNaN(newValue) || newValue < 0) {
                alert('エラー: 有効な正の整数を入力してください。');
                return;
            }

            if (oldValue === newValue) {
                alert('値が変更されていません');
                return;
            }

            try {
                saveQtyBtn.disabled = true;
                saveQtyBtn.textContent = '送信中...';

                const res = await fetch('/api/update-quantity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        itemKey: selectedKey,
                        newValue: String(newValue),
                        note: note
                    })
                });

                const result = await res.json();
                if (result.success) {
                    resetModalForms();
                    setTimeout(() => fetchLogs(currentSelectedRoom['教室名']), 300);
                } else {
                    alert('更新失敗: ' + (result.error || '不明なエラー'));
                }
            } catch (err) {
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
            if (!currentSelectedRoom || !isCommitteeUser()) return;

            const targetItem = document.getElementById('edit-dest-item-key').value;
            const newDestName = document.getElementById('edit-new-dest-name').value.trim();
            const inputQty = parseInt(document.getElementById('edit-dest-qty').value, 10);
            const note = document.getElementById('edit-dest-note').value.trim();

            if (!newDestName) {
                alert('エラー: 新しい移動先を入力してください。');
                return;
            }
            if (isNaN(inputQty) || inputQty <= 0) {
                alert('エラー: 移動する個数は1以上の整数を入力してください。');
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
                saveDestBtn.textContent = '送信中...';

                const detailLogNote = `[${targetItem}の移動先変更: ${updateType}] 新移動先:${newDestName}(${inputQty}脚) ${note ? 'メモ:' + note : ''}`;

                const res = await fetch('/api/update-quantity', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rowIndex: currentSelectedRoom.rowIndex,
                        roomName: currentSelectedRoom['教室名'],
                        itemKey: destColKey,
                        newValue: finalDestValue,
                        note: detailLogNote
                    })
                });

                const result = await res.json();
                if (result.success) {
                    resetModalForms();
                    setTimeout(() => fetchLogs(currentSelectedRoom['教室名']), 300);
                } else {
                    alert('更新失敗: ' + (result.error || '不明なエラー'));
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
});