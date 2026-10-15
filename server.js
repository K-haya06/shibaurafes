const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.SESSION_SECRET) {
    console.error('【エラー】SESSION_SECRET が環境変数に設定されていません。');
    if (process.env.NODE_ENV === 'production') {
        console.error('本番環境では SESSION_SECRET の設定が必須です。安全のため起動を中止します。');
        process.exit(1);
    }
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-for-dev-only',
    resave: false,
    saveUninitialized: false,
    name: 'shibaura_sid',
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

let auth;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else {
    auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-key.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

const rawSheets = google.sheets({ version: 'v4', auth });

// --- パフォーマンス計測・ログ集計 ---
let metricsAggregation = {
    updateSuccessCount: 0,
    updateErrorCount: 0,
    totalUpdateDurationMs: 0
};

setInterval(() => {
    if (metricsAggregation.updateSuccessCount > 0 || metricsAggregation.updateErrorCount > 0) {
        const avgDuration = metricsAggregation.updateSuccessCount > 0
            ? Math.round(metricsAggregation.totalUpdateDurationMs / metricsAggregation.updateSuccessCount)
            : 0;
        console.log(`[PERF-SUMMARY] 5-min Update Summary: Success=${metricsAggregation.updateSuccessCount}, Error=${metricsAggregation.updateErrorCount}, AvgApiTime=${avgDuration}ms`);
        metricsAggregation.updateSuccessCount = 0;
        metricsAggregation.updateErrorCount = 0;
        metricsAggregation.totalUpdateDurationMs = 0;
    }
}, 5 * 60 * 1000);

async function sheetsCall(actionType, rangeLabel, apiFn) {
    const startTime = Date.now();
    try {
        const result = await apiFn();
        const duration = Date.now() - startTime;
        if (duration >= 3000) {
            console.warn(`[GSHEETS-API-SLOW] type=${actionType} range=${rangeLabel || 'N/A'} duration=${duration}ms`);
        }
        return result;
    } catch (err) {
        const duration = Date.now() - startTime;
        console.error(`[GSHEETS-API-ERROR] type=${actionType} range=${rangeLabel || 'N/A'} duration=${duration}ms error="${err.message || 'Unknown'}"`);
        throw err;
    }
}

function colIndexToLetter(index) {
    let temp;
    let letter = '';
    while (index >= 0) {
        temp = index % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
}

function getFormattedTimestamp() {
    const now = new Date();
    const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const yyyy = jst.getUTCFullYear();
    const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(jst.getUTCDate()).padStart(2, '0');
    const hh = String(jst.getUTCHours()).padStart(2, '0');
    const min = String(jst.getUTCMinutes()).padStart(2, '0');
    const ss = String(jst.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
}

function sanitizeClassroomsForUser(dataList, userRole) {
    if (userRole === '委員会') return dataList;
    return dataList.map(item => {
        const copy = { ...item };
        copy['担当者'] = '';
        return copy;
    });
}

const ALLOWED_ROLES = ['委員会', '参加団体', 'ゲスト'];
const ALLOWED_PROGRESS_STATUSES = ['未実施', '依頼中', '対応中', '完了'];
const ALLOWED_PROGRESS_WEB_COLUMNS = [
    '準備1次_Web', '準備2次_Web', '準備3次_Web',
    '片付け1次_Web', '片付け2次_Web', '片付け3次_Web'
];
const ALLOWED_QUANTITY_COLUMNS = [
    '机α（元の数）', '机α（使用数）', '机α（移動数）',
    '机β（元の数）', '机β（使用数）', '机β（移動数）',
    '椅子（元の数）', '椅子（使用数）', '椅子（移動数）',
    '机α移動先', '机β移動先', '椅子移動先',
    '一人用机', '一人用椅子', '備考'
];

// --- サーバー内キャッシュ・排他制御 ---
let cachedClassroomData = [];
let cachedHeaders = [];
let sseClients = [];
let isInitialLoaded = false;
let initPromise = null;

let sheetWriteQueue = Promise.resolve();
let pendingWriteCount = 0;

// --- バックグラウンド操作ログ保存キュー ---
const LOG_PERSIST_FILE = path.join(__dirname, 'data', 'pending_logs.json');
const MAX_LOG_CACHE_SIZE = 100;
let logCache = [];
let pendingLogQueue = [];
let isProcessingLogQueue = false;
const processedLogIds = new Set();

if (!fs.existsSync(path.join(__dirname, 'data'))) {
    try { fs.mkdirSync(path.join(__dirname, 'data')); } catch (e) {}
}

function loadPersistedLogs() {
    try {
        if (fs.existsSync(LOG_PERSIST_FILE)) {
            const data = fs.readFileSync(LOG_PERSIST_FILE, 'utf8');
            pendingLogQueue = JSON.parse(data) || [];
        }
    } catch (e) {
        pendingLogQueue = [];
    }
}

function savePersistedLogs() {
    try {
        fs.writeFileSync(LOG_PERSIST_FILE, JSON.stringify(pendingLogQueue), 'utf8');
    } catch (e) {}
}

function addLogToCache(logEntry) {
    const formatted = {
        logId: logEntry[0],
        timestamp: logEntry[1],
        userName: logEntry[2],
        roomName: logEntry[3],
        itemKey: logEntry[4],
        oldValue: logEntry[5],
        newValue: logEntry[6],
        note: logEntry[7] || ''
    };
    logCache.unshift(formatted);
    if (logCache.length > MAX_LOG_CACHE_SIZE) {
        logCache = logCache.slice(0, MAX_LOG_CACHE_SIZE);
    }
}

function enqueueLog(logEntry) {
    const logObj = {
        id: logEntry[0] || crypto.randomUUID(),
        data: logEntry,
        enqueuedAt: Date.now(),
        attempts: 0
    };
    
    addLogToCache(logEntry);
    pendingLogQueue.push(logObj);
    savePersistedLogs();
    processLogQueue();
}

async function processLogQueue() {
    if (isProcessingLogQueue || pendingLogQueue.length === 0) return;
    isProcessingLogQueue = true;

    while (pendingLogQueue.length > 0) {
        const item = pendingLogQueue[0];

        if (processedLogIds.has(item.id)) {
            pendingLogQueue.shift();
            savePersistedLogs();
            continue;
        }

        item.attempts++;
        try {
            const sheetRow = item.data.slice(1);
            await executeWithRetry(() => sheetsCall('append', '操作ログ', () =>
                rawSheets.spreadsheets.values.append({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: "'操作ログ'!A:G",
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [sheetRow] }
                })
            ), 2);

            processedLogIds.add(item.id);
            if (processedLogIds.size > 300) {
                const oldest = processedLogIds.values().next().value;
                processedLogIds.delete(oldest);
            }

            pendingLogQueue.shift();
            savePersistedLogs();

        } catch (err) {
            if (item.attempts >= 5) {
                pendingLogQueue.shift();
                savePersistedLogs();
            } else {
                await new Promise(r => setTimeout(r, Math.pow(2, item.attempts) * 1000));
                break;
            }
        }
    }

    isProcessingLogQueue = false;
}

// --- SSE ブロードキャスト ---
function broadcastSSE(eventType, rawData) {
    sseClients = sseClients.filter(client => {
        try {
            const role = client.user ? client.user.role : 'ゲスト';
            const sanitizedData = sanitizeClassroomsForUser(rawData, role);
            const payload = `event: ${eventType}\ndata: ${JSON.stringify(sanitizedData)}\n\n`;
            client.res.write(payload);
            return true;
        } catch (err) {
            return false;
        }
    });
}

function broadcastSSERollback(rollbackPayload) {
    sseClients = sseClients.filter(client => {
        try {
            const payload = `event: rollback\ndata: ${JSON.stringify(rollbackPayload)}\n\n`;
            client.res.write(payload);
            return true;
        } catch (err) {
            return false;
        }
    });
}

function broadcastSSEError(message) {
    sseClients = sseClients.filter(client => {
        try {
            const payload = `event: update_failed\ndata: ${JSON.stringify({ error: message })}\n\n`;
            client.res.write(payload);
            return true;
        } catch (err) {
            return false;
        }
    });
}

setInterval(() => {
    sseClients = sseClients.filter(client => {
        try {
            client.res.write(':\n\n');
            return true;
        } catch (e) {
            return false;
        }
    });
}, 25000);

// --- スプレッドシート同期 ---
async function fetchAndSyncFromSpreadsheet() {
    if (pendingWriteCount > 0) return;

    try {
        const response = await sheetsCall('batchGet', '管理データ!A1:AZ100', () =>
            rawSheets.spreadsheets.values.batchGet({
                spreadsheetId: process.env.SPREADSHEET_ID,
                ranges: ["'管理データ'!A1:AZ100"]
            })
        );

        const valueRanges = response.data.valueRanges || [];
        if (valueRanges.length > 0 && valueRanges[0].values && valueRanges[0].values.length >= 2) {
            const rows = valueRanges[0].values;
            const headers = rows[0];
            cachedHeaders = headers;

            const newData = rows.slice(1).map((row, index) => {
                const targetRowIndex = index + 2;
                const existing = cachedClassroomData.find(r => r.rowIndex === targetRowIndex);
                const obj = { rowIndex: targetRowIndex, _rev: existing ? (existing._rev || 1) : 1 };
                headers.forEach((header, colIndex) => {
                    obj[header] = row[colIndex] || '';
                });
                return obj;
            });

            const oldHash = JSON.stringify(cachedClassroomData);
            const newHash = JSON.stringify(newData);

            cachedClassroomData = newData;
            isInitialLoaded = true;

            if (oldHash !== newHash) {
                broadcastSSE('data_updated', cachedClassroomData);
            }
        }
    } catch (err) {
        console.error('スプレッドシートデータ取得エラー:', err.message);
        if (!isInitialLoaded) throw err;
    }
}

async function refreshLogCacheFromSpreadsheet() {
    try {
        const response = await sheetsCall('get', '操作ログ!A2:G', () =>
            rawSheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: "'操作ログ'!A2:G",
            })
        );
        const rows = response.data.values || [];
        const logs = rows.map(row => ({
            logId: crypto.randomUUID(),
            timestamp: row[0],
            userName: row[1] || '不明',
            roomName: row[2],
            itemKey: row[3],
            oldValue: row[4],
            newValue: row[5],
            note: row[6] || ''
        })).reverse();

        logCache = logs.slice(0, MAX_LOG_CACHE_SIZE);
    } catch (err) {
        console.error('ログキャッシュ初期ロード失敗:', err.message);
    }
}

async function ensureInitialLoad() {
    if (isInitialLoaded) return;
    if (!initPromise) {
        initPromise = (async () => {
            loadPersistedLogs();
            await fetchAndSyncFromSpreadsheet();
            await refreshLogCacheFromSpreadsheet();
            processLogQueue();
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }
    await initPromise;
}

ensureInitialLoad().catch(err => console.error('起動時初期データ取得失敗:', err.message));

const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS) || 30000;
setInterval(async () => {
    if (pendingWriteCount === 0) {
        await fetchAndSyncFromSpreadsheet().catch(err => console.error('定期同期エラー:', err.message));
    }
}, POLL_INTERVAL);

async function executeWithRetry(apiFn, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await apiFn();
        } catch (err) {
            attempt++;
            if (attempt >= maxRetries) throw err;
            const delay = Math.pow(2, attempt) * 400;
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: '認証されていません。ログインが必要です。' });
    }
    next();
}

function requireCommittee(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: '認証されていません。ログインが必要です。' });
    }
    if (req.session.user.role !== '委員会') {
        return res.status(403).json({ error: 'アクセス権限がありません（委員会権限が必要です）。' });
    }
    next();
}

function scheduleSheetWrite(writeFn) {
    pendingWriteCount++;
    sheetWriteQueue = sheetWriteQueue.then(async () => {
        try {
            await writeFn();
        } catch (e) {
            console.error('[BACKGROUND-WRITE-ERROR]', e.message);
        } finally {
            pendingWriteCount--;
        }
    });
}

// --- エンドポイント ---

app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
            return res.json({ success: false, message: 'ユーザー名とパスワードを入力してください' });
        }

        const response = await sheetsCall('get', 'ユーザー!A2:G', () =>
            rawSheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: "'ユーザー'!A2:G",
            })
        );

        const rows = response.data.values || [];
        const userRow = rows.find(row => {
            const dbUser = (row[1] || '').trim();
            const dbPass = (row[2] || '').trim();
            const isActive = row[6] !== undefined && row[6] !== '' && row[6] !== 'FALSE' && row[6] !== '0';
            return dbUser === username.trim() && dbPass === password.trim() && isActive;
        });

        if (userRow) {
            const rawRole = (userRow[4] || '').trim();
            if (!ALLOWED_ROLES.includes(rawRole)) {
                return res.json({ success: false, message: `アカウントの役割「${rawRole}」は無効です。` });
            }

            req.session.regenerate((err) => {
                if (err) return res.status(500).json({ error: 'セッション処理に失敗しました' });
                const userObj = { username: userRow[1], role: rawRole, assignedRoom: userRow[5] || '' };
                req.session.user = userObj;
                res.json({ success: true, user: userObj });
            });
        } else {
            res.json({ success: false, message: 'ユーザー名またはパスワードが正しくありません' });
        }
    } catch (error) {
        res.status(500).json({ error: 'ログイン処理中にエラーが発生しました' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('shibaura_sid');
        res.json({ success: true });
    });
});

app.get('/api/events', requireAuth, async (req, res) => {
    try {
        await ensureInitialLoad();
    } catch (e) {
        return res.status(500).send('Initial load failed');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now() + Math.random();
    const newClient = { id: clientId, res, user: req.session.user };
    sseClients.push(newClient);

    const userRole = req.session.user ? req.session.user.role : 'ゲスト';
    const sanitizedData = sanitizeClassroomsForUser(cachedClassroomData, userRole);
    res.write(`event: init\ndata: ${JSON.stringify(sanitizedData)}\n\n`);

    const removeClient = () => { sseClients = sseClients.filter(c => c.id !== clientId); };
    req.on('close', removeClient);
    res.on('error', removeClient);
});

app.get('/api/classrooms', requireAuth, async (req, res) => {
    try {
        await ensureInitialLoad();
        const userRole = req.session.user ? req.session.user.role : 'ゲスト';
        const sanitizedData = sanitizeClassroomsForUser(cachedClassroomData, userRole);
        res.json(sanitizedData);
    } catch (error) {
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

// --- 進捗更新 API（仮更新・SSE即時配信・バックグラウンド保存・ロールバック対応） ---
app.post('/api/update', requireCommittee, async (req, res) => {
    const apiStartTime = Date.now();

    try {
        await ensureInitialLoad();

        const { rowIndex, roomName, columnName, value, action } = req.body;
        const sessionUsername = req.session.user.username;
        const targetRowIndex = Number(rowIndex);

        if (!targetRowIndex || isNaN(targetRowIndex) || targetRowIndex < 2) {
            return res.status(400).json({ error: '有効な行番号が指定されていません' });
        }
        if (!roomName || typeof roomName !== 'string' || roomName.length > 100) {
            return res.status(400).json({ error: '不正な教室名です' });
        }

        const targetRoom = cachedClassroomData.find(r => r.rowIndex === targetRowIndex);
        if (!targetRoom || targetRoom['教室名'] !== roomName) {
            return res.status(400).json({ error: '対象の教室データが見つかりません' });
        }

        const headers = cachedHeaders;
        const assigneeColIdx = headers.indexOf('担当者');
        if (assigneeColIdx === -1) {
            return res.status(400).json({ error: '「担当者」列が存在しません' });
        }
        const assigneeColLetter = colIndexToLetter(assigneeColIdx);

        const valueRanges = [];
        const logEntries = [];
        const timestamp = getFormattedTimestamp();

        const previousStateSnapshot = { ...targetRoom };
        const previousRev = targetRoom._rev || 1;
        const newRev = previousRev + 1;
        targetRoom._rev = newRev;

        const affectedRoomsBackup = [];
        let targetColName = columnName;

        if (action === 'claim' || action === 'unclaim') {
            if (action === 'claim') {
                cachedClassroomData.forEach(room => {
                    if (room.rowIndex !== targetRowIndex && room['担当者']) {
                        let assignees = room['担当者'].split(',').map(s => s.trim()).filter(Boolean);
                        if (assignees.includes(sessionUsername)) {
                            affectedRoomsBackup.push({ room, oldAssignee: room['担当者'] });
                            assignees = assignees.filter(name => name !== sessionUsername);
                            const newAssigneeStr = assignees.join(', ');
                            valueRanges.push({
                                range: `'管理データ'!${assigneeColLetter}${room.rowIndex}`,
                                values: [[newAssigneeStr]]
                            });
                            room['担当者'] = newAssigneeStr;
                        }
                    }
                });

                let targetAssignees = (targetRoom['担当者'] || '').split(',').map(s => s.trim()).filter(Boolean);
                if (!targetAssignees.includes(sessionUsername)) {
                    targetAssignees.push(sessionUsername);
                }
                const newTargetAssigneeStr = targetAssignees.join(', ');
                valueRanges.push({
                    range: `'管理データ'!${assigneeColLetter}${targetRowIndex}`,
                    values: [[newTargetAssigneeStr]]
                });

                logEntries.push([
                    crypto.randomUUID(), timestamp, sessionUsername, roomName, '担当者', targetRoom['担当者'] || '未割当', newTargetAssigneeStr, '担当登録'
                ]);
                targetRoom['担当者'] = newTargetAssigneeStr;

            } else if (action === 'unclaim') {
                let assignees = (targetRoom['担当者'] || '').split(',').map(s => s.trim()).filter(Boolean);
                const oldAssigneeStr = targetRoom['担当者'] || '';
                assignees = assignees.filter(name => name !== sessionUsername);
                const newAssigneeStr = assignees.join(', ');

                valueRanges.push({
                    range: `'管理データ'!${assigneeColLetter}${targetRowIndex}`,
                    values: [[newAssigneeStr]]
                });

                logEntries.push([
                    crypto.randomUUID(), timestamp, sessionUsername, roomName, '担当者', oldAssigneeStr, newAssigneeStr, '担当解除'
                ]);
                targetRoom['担当者'] = newAssigneeStr;
            }
        } else {
            if (!columnName || typeof columnName !== 'string') {
                return res.status(400).json({ error: '更新対象の列名が指定されていません' });
            }

            if (!targetColName.endsWith('_Web')) {
                const baseName = targetColName.replace('_表示用', '').replace('_チェック', '').replace('_', '');
                targetColName = `${baseName}_Web`;
            }

            if (!ALLOWED_PROGRESS_WEB_COLUMNS.includes(targetColName)) {
                return res.status(400).json({ error: `列「${targetColName}」への書き込みは許可されていません` });
            }

            if (!value || typeof value !== 'string' || !ALLOWED_PROGRESS_STATUSES.includes(value)) {
                return res.status(400).json({ error: `進捗ステータス「${value}」は無効です。` });
            }

            const targetColIndex = headers.indexOf(targetColName);
            if (targetColIndex === -1) {
                return res.status(400).json({ error: `指定された列「${targetColName}」がシート内に存在しません` });
            }

            const oldValueRaw = targetRoom[columnName] || targetRoom[targetColName] || '未実施';
            const valueWithTimestamp = `${value} ${timestamp}`;
            const colLetter = colIndexToLetter(targetColIndex);

            valueRanges.push({
                range: `'管理データ'!${colLetter}${targetRowIndex}`,
                values: [[valueWithTimestamp]]
            });

            logEntries.push([
                crypto.randomUUID(), timestamp, sessionUsername, roomName, columnName, oldValueRaw, value, '進捗ステータス変更'
            ]);

            // メモリキャッシュを仮更新（表示用＆Web用）
            targetRoom[targetColName] = valueWithTimestamp;
            targetRoom[columnName] = value;
            const displayKey = targetColName.replace('_Web', '_表示用');
            targetRoom[displayKey] = value;
        }

        // 1. 全端末へ SSE で「仮更新」を即時配信 ⚡️
        broadcastSSE('data_updated', cachedClassroomData);

        // 2. メトリクス集計 & リクエスト送信者へ成功を即時応答
        const totalApiMs = Date.now() - apiStartTime;
        metricsAggregation.updateSuccessCount++;
        metricsAggregation.totalUpdateDurationMs += totalApiMs;
        res.json({ success: true, pending: true });

        // 3. バックグラウンドで Google Sheets へ保存開始
        scheduleSheetWrite(async () => {
            try {
                if (valueRanges.length > 0) {
                    await executeWithRetry(() => sheetsCall('batchUpdate', '管理データ', () =>
                        rawSheets.spreadsheets.values.batchUpdate({
                            spreadsheetId: process.env.SPREADSHEET_ID,
                            requestBody: {
                                valueInputOption: 'USER_ENTERED',
                                data: valueRanges
                            }
                        })
                    ));
                }

                // 【成功時】ログ追加
                logEntries.forEach(logEntry => enqueueLog(logEntry));

            } catch (error) {
                // 【失敗時】
                metricsAggregation.updateErrorCount++;
                console.error(`[BACKGROUND-SAVE-FAILED] 教室: ${roomName}, エラー: ${error.message}`);

                const currentRoomInCache = cachedClassroomData.find(r => r.rowIndex === targetRowIndex);
                if (currentRoomInCache && currentRoomInCache._rev === newRev) {
                    // 1) メモリキャッシュを元の値に戻す
                    Object.assign(currentRoomInCache, previousStateSnapshot);
                    currentRoomInCache._rev = previousRev;

                    affectedRoomsBackup.forEach(b => {
                        b.room['担当者'] = b.oldAssignee;
                    });

                    // 2) 全端末へ SSE で「元に戻す（ロールバック）」を通知 🔄
                    broadcastSSERollback({
                        rowIndex: targetRowIndex,
                        roomName: roomName,
                        columnName: targetColName,
                        revertedRoom: currentRoomInCache,
                        message: `「${roomName}」の保存に失敗したため、元の値に戻しました。`
                    });
                }
            }
        });

    } catch (error) {
        metricsAggregation.updateErrorCount++;
        console.error('更新API初期エラー:', error.message);
        res.status(500).json({ error: '更新処理の受付に失敗しました' });
    }
});

// 数量更新 API
app.post('/api/update-quantity', requireCommittee, async (req, res) => {
    try {
        await ensureInitialLoad();

        const { rowIndex, roomName, itemKey, newValue, note } = req.body;
        const sessionUsername = req.session.user.username;
        const targetRowIndex = Number(rowIndex);

        if (!targetRowIndex || isNaN(targetRowIndex) || targetRowIndex < 2) {
            return res.status(400).json({ error: '有効な行番号が指定されていません' });
        }
        if (!roomName || typeof roomName !== 'string' || roomName.length > 100) {
            return res.status(400).json({ error: '不正な教室名です' });
        }
        if (!ALLOWED_QUANTITY_COLUMNS.includes(itemKey)) {
            return res.status(400).json({ error: `列「${itemKey}」の変更は許可されていません` });
        }

        const cleanValue = (newValue !== null && newValue !== undefined) ? String(newValue).trim() : '';
        if (itemKey.includes('数') || itemKey.includes('一人用')) {
            const parsedInt = parseInt(cleanValue, 10);
            if (isNaN(parsedInt) || parsedInt < 0 || String(parsedInt) !== cleanValue) {
                return res.status(400).json({ error: '数量は0以上の整数を入力してください' });
            }
        } else {
            if (cleanValue.length > 300) {
                return res.status(400).json({ error: '入力文字列が長すぎます（最大300文字）' });
            }
        }

        const cleanNote = note ? String(note).trim().slice(0, 300) : '';

        const targetRoom = cachedClassroomData.find(r => r.rowIndex === targetRowIndex);
        if (!targetRoom || targetRoom['教室名'] !== roomName) {
            return res.status(400).json({ error: '対象の教室が見つかりません' });
        }

        const headers = cachedHeaders;
        const targetColIndex = headers.indexOf(itemKey);
        if (targetColIndex === -1) {
            return res.status(400).json({ error: `スプレッドシートに「${itemKey}」列が存在しません` });
        }

        const serverOldValue = String(targetRoom[itemKey] || '0');
        const colLetter = colIndexToLetter(targetColIndex);
        const timestamp = getFormattedTimestamp();

        const previousRev = targetRoom._rev || 1;
        const newRev = previousRev + 1;
        targetRoom._rev = newRev;
        const previousValue = targetRoom[itemKey];

        // 1. 仮更新 ＆ 全端末へ SSE 配信 ⚡️
        targetRoom[itemKey] = cleanValue;
        broadcastSSE('data_updated', cachedClassroomData);

        res.json({ success: true, pending: true });

        const logEntry = [
            crypto.randomUUID(), timestamp, sessionUsername, roomName, itemKey, serverOldValue, cleanValue, cleanNote || '手動変更'
        ];

        // 2. バックグラウンド保存
        scheduleSheetWrite(async () => {
            try {
                await executeWithRetry(() => sheetsCall('update', `管理データ!${colLetter}${targetRowIndex}`, () =>
                    rawSheets.spreadsheets.values.update({
                        spreadsheetId: process.env.SPREADSHEET_ID,
                        range: `'管理データ'!${colLetter}${targetRowIndex}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[cleanValue]] }
                    })
                ));

                enqueueLog(logEntry);
            } catch (error) {
                console.error(`[QTY-SAVE-FAILED] 教室: ${roomName}, エラー: ${error.message}`);
                const currentRoomInCache = cachedClassroomData.find(r => r.rowIndex === targetRowIndex);
                if (currentRoomInCache && currentRoomInCache._rev === newRev) {
                    // ロールバック
                    currentRoomInCache[itemKey] = previousValue;
                    currentRoomInCache._rev = previousRev;

                    broadcastSSERollback({
                        rowIndex: targetRowIndex,
                        roomName: roomName,
                        columnName: itemKey,
                        revertedRoom: currentRoomInCache,
                        message: `「${roomName}」の数量更新保存に失敗したため、元の値に戻しました。`
                    });
                }
            }
        });

    } catch (error) {
        console.error('数量更新エラー:', error.message);
        res.status(500).json({ error: '数量の更新処理受付に失敗しました' });
    }
});

app.get('/api/logs/:roomName', requireCommittee, async (req, res) => {
    try {
        const roomName = req.params.roomName;
        const filteredLogs = logCache.filter(log => log.roomName === roomName);
        res.json(filteredLogs);
    } catch (error) {
        res.status(500).json({ error: 'ログの取得に失敗しました' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});